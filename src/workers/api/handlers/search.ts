// @ts-nocheck - Complex IndexManager integration with exactOptionalPropertyTypes issues in search options
/**
 * Search handlers for the Wikipedia API
 *
 * Provides:
 * - Vector similarity search using HNSW index (O(log n) performance)
 * - Hybrid search (vector + metadata filters)
 * - Full-text search using BM25-scored FTS index
 */

import type {
  ArticleType,
  SearchResult,
  SearchOptions,
  RequestContext,
} from '../types.js';
import { isValidArticleType } from '../../../shared/types.js';
import { fromBaseContext, type ScopedRequestContext } from '../context.js';
import {
  jsonResponse,
  errorResponse,
  parsePagination,
} from '../middleware.js';
import type {
  FTSSearchOptions,
  FTSSearchResult,
} from '../../../indexes/fts-index.js';
import type {
  VectorSearchResult as HNSWSearchResult,
} from '../../../indexes/vector-index.js';
import { NotFoundError, InternalError, ValidationError } from '../../../lib/errors.js';
import { MAX_RESULTS_LIMIT } from '../../../lib/constants.js';
import { CF_MODEL_IDS, type EmbeddingModel, isEmbeddingModel } from '../../../embeddings/types.js';

/** Embedding model to use */
const DEFAULT_MODEL: EmbeddingModel = 'bge-m3';

/** Supported embedding models for search */
const SUPPORTED_SEARCH_MODELS: EmbeddingModel[] = ['bge-m3', 'gemma300'];

/**
 * Validate that the model is supported for search
 */
function isValidSearchModel(model: string): model is EmbeddingModel {
  return SUPPORTED_SEARCH_MODELS.includes(model as EmbeddingModel);
}

/**
 * Generate embedding using Cloudflare AI
 */
async function generateEmbedding(
  text: string,
  ai: Ai,
  model: EmbeddingModel = DEFAULT_MODEL
): Promise<Float32Array> {
  // Get the Cloudflare AI model ID
  const cfModelId = CF_MODEL_IDS[model];

  const response = await ai.run(cfModelId as any, {
    text: [text],
  }) as { data?: number[][] };

  if (!response.data || response.data.length === 0) {
    throw new InternalError(`Failed to generate embedding with model ${model}`);
  }

  return new Float32Array(response.data[0]);
}

/**
 * Perform vector similarity search using HNSW index
 *
 * Uses O(log n) approximate nearest neighbor search with high recall.
 * Falls back to brute-force search if HNSW index is not available.
 */
export async function vectorSearch(
  query: string,
  k: number,
  ctx: ScopedRequestContext,
  options: { types?: ArticleType[]; model?: EmbeddingModel; useHnsw?: boolean } = {}
): Promise<SearchResult[]> {
  const model = options.model ?? DEFAULT_MODEL;
  const useHnsw = options.useHnsw ?? true;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query, ctx.ai, model);

  // Try HNSW index first (if enabled and model is default)
  // HNSW index is currently only built for bge-m3
  if (useHnsw && model === 'bge-m3') {
    const index = await ctx.getHNSWIndex();
    if (index) {
      const hnswResults = index.search(queryEmbedding, k, {
        types: options.types,
        efSearch: Math.max(k * 2, 50), // Ensure high recall
      });

      return hnswResults.map((r: HNSWSearchResult) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        score: r.score,
        preview: r.preview,
      }));
    }
  }

  // Fall back to brute-force search
  console.warn('HNSW index not available, falling back to brute-force search');
  return bruteForceVectorSearch(queryEmbedding, k, ctx, options);
}

/**
 * Perform hybrid search combining vector similarity with metadata filtering
 *
 * Supports two strategies:
 * - 'pre-filter': Brute-force over candidate set (efficient for small filters)
 * - 'post-filter': HNSW search with over-fetching (efficient for large/no filters)
 */
export async function hybridVectorSearch(
  query: string,
  k: number,
  ctx: ScopedRequestContext,
  options: {
    types?: ArticleType[];
    model?: EmbeddingModel;
    candidateIds?: Set<string>;
    strategy?: 'auto' | 'pre-filter' | 'post-filter';
  } = {}
): Promise<SearchResult[]> {
  const model = options.model ?? DEFAULT_MODEL;

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query, ctx.ai, model);

  // Try HNSW index with hybrid search (only for bge-m3)
  if (model === 'bge-m3') {
    const index = await ctx.getHNSWIndex();
    if (index) {
      const result = index.hybridSearch(queryEmbedding, k, {
        types: options.types,
        candidateIds: options.candidateIds,
        strategy: options.strategy ?? 'auto',
        efSearch: Math.max(k * 2, 50),
      });

      return result.results.map((r: HNSWSearchResult) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        score: r.score,
        preview: r.preview,
      }));
    }
  }

  // Fall back to brute-force search
  return bruteForceVectorSearch(queryEmbedding, k, ctx, options);
}

/**
 * Brute-force vector search (fallback when HNSW not available)
 */
async function bruteForceVectorSearch(
  queryEmbedding: Float32Array,
  k: number,
  ctx: ScopedRequestContext,
  options: { types?: ArticleType[]; model?: EmbeddingModel } = {}
): Promise<SearchResult[]> {
  const model = options.model ?? DEFAULT_MODEL;
  const results: SearchResult[] = [];
  const types = options.types ?? ['person', 'place', 'org', 'work', 'event', 'other'];

  // Search each type partition
  for (const type of types) {
    const lanceFile = `embeddings/${model}/${type}.lance`;

    try {
      // Check if file exists
      const head = await ctx.bucket.head(lanceFile);
      if (!head) continue;

      // Read Lance file and search
      const partitionResults = await searchLanceFile(
        lanceFile,
        queryEmbedding,
        k,
        ctx,
        type
      );

      results.push(...partitionResults);
    } catch (error) {
      console.error(`Error searching ${lanceFile}:`, error);
      continue;
    }
  }

  // Sort by score and return top k
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

/**
 * Search a single Lance file
 */
async function searchLanceFile(
  file: string,
  queryEmbedding: Float32Array,
  k: number,
  ctx: ScopedRequestContext,
  _type: ArticleType
): Promise<SearchResult[]> {
  // Read Lance file metadata and embeddings
  const object = await ctx.bucket.get(file);
  if (!object) {
    throw new NotFoundError(`Lance file not found: ${file}`);
  }

  const data = await object.arrayBuffer();
  const bytes = new Uint8Array(data);

  // Parse Lance file format
  const { records } = parseLanceFile(bytes);

  // Perform brute-force k-NN search
  const scored: Array<{ record: LanceRecord; distance: number }> = [];

  for (const record of records) {
    const distance = squaredEuclideanDistance(queryEmbedding, record.embedding);
    scored.push({ record, distance });
  }

  // Sort by distance (lower is better)
  scored.sort((a, b) => a.distance - b.distance);

  // Take top k and convert to search results
  return scored.slice(0, k).map(({ record, distance }) => ({
    id: record.id,
    title: record.title,
    type: record.type as ArticleType,
    score: 1 / (1 + distance), // Convert distance to similarity score
    preview: record.text_preview,
  }));
}

/** Lance file metadata */
interface LanceMetadata {
  rowCount: number;
  embeddingDimension: number;
  model: string;
}

/** Lance record structure */
interface LanceRecord {
  id: string;
  title: string;
  type: string;
  chunk_index: number;
  text_preview: string;
  embedding: Float32Array;
}

/**
 * Parse Lance file (simplified implementation)
 */
function parseLanceFile(bytes: Uint8Array): { metadata: LanceMetadata; records: LanceRecord[] } {
  // Check magic bytes
  if (
    bytes[0] !== 0x4c || // 'L'
    bytes[1] !== 0x41 || // 'A'
    bytes[2] !== 0x4e || // 'N'
    bytes[3] !== 0x43    // 'C'
  ) {
    throw new ValidationError('Invalid Lance file: bad magic bytes');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Read header
  const metadataLen = view.getUint32(8, true);
  const headerSize = 16;

  // Parse metadata JSON
  const metadataBytes = bytes.slice(headerSize, headerSize + metadataLen);
  const metadata: LanceMetadata = JSON.parse(new TextDecoder().decode(metadataBytes));

  // Read footer to get column offsets
  const footerSize = 72;
  const footerOffset = bytes.length - footerSize;

  const offsets = {
    id: view.getFloat64(footerOffset + 8, true),
    title: view.getFloat64(footerOffset + 16, true),
    type: view.getFloat64(footerOffset + 24, true),
    chunk_index: view.getFloat64(footerOffset + 32, true),
    text_preview: view.getFloat64(footerOffset + 40, true),
    embedding: view.getFloat64(footerOffset + 48, true),
  };

  const rowCount = metadata.rowCount;
  const embeddingDimension = metadata.embeddingDimension;

  // Parse columns
  const ids = parseStringColumn(bytes, offsets.id, offsets.title, rowCount);
  const titles = parseStringColumn(bytes, offsets.title, offsets.type, rowCount);
  const types = parseStringColumn(bytes, offsets.type, offsets.chunk_index, rowCount);
  const chunkIndices = parseInt32Column(view, offsets.chunk_index, rowCount);
  const textPreviews = parseStringColumn(
    bytes,
    offsets.text_preview,
    offsets.embedding,
    rowCount
  );
  const embeddings = parseEmbeddingColumn(
    bytes,
    offsets.embedding,
    rowCount,
    embeddingDimension
  );

  // Build records
  const records: LanceRecord[] = [];
  for (let i = 0; i < rowCount; i++) {
    records.push({
      id: ids[i] ?? '',
      title: titles[i] ?? '',
      type: types[i] ?? 'other',
      chunk_index: chunkIndices[i] ?? 0,
      text_preview: textPreviews[i] ?? '',
      embedding: embeddings[i],
    });
  }

  return { metadata, records };
}

/**
 * Parse string column from Lance file
 */
function parseStringColumn(
  bytes: Uint8Array,
  start: number,
  end: number,
  rowCount: number
): string[] {
  const data = bytes.slice(start, end);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = new TextDecoder();

  // Read offsets
  const offsetsSize = (rowCount + 1) * 4;
  const offsets: number[] = [];
  for (let i = 0; i <= rowCount; i++) {
    offsets.push(view.getUint32(i * 4, true));
  }

  // Read strings
  const strings: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const strStart = offsetsSize + offsets[i];
    const strEnd = offsetsSize + offsets[i + 1];
    if (strEnd <= data.length) {
      strings.push(decoder.decode(data.slice(strStart, strEnd)));
    } else {
      strings.push('');
    }
  }

  return strings;
}

/**
 * Parse int32 column
 */
function parseInt32Column(view: DataView, offset: number, rowCount: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < rowCount; i++) {
    values.push(view.getInt32(offset + i * 4, true));
  }
  return values;
}

/**
 * Parse embedding column
 */
function parseEmbeddingColumn(
  bytes: Uint8Array,
  offset: number,
  rowCount: number,
  dimension: number
): Float32Array[] {
  const embeddings: Float32Array[] = [];
  const floatView = new Float32Array(
    bytes.buffer,
    bytes.byteOffset + offset,
    rowCount * dimension
  );

  for (let i = 0; i < rowCount; i++) {
    embeddings.push(floatView.slice(i * dimension, (i + 1) * dimension));
  }

  return embeddings;
}

/**
 * Squared Euclidean distance
 */
function squaredEuclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return sum;
}

/**
 * Full-text search using BM25-scored FTS index
 *
 * Uses a pre-built inverted index with weighted fields:
 * - title (2.0): Most important for matching
 * - description/summary (1.5): Second most important
 * - content/plaintext (1.0): Full article text
 *
 * Falls back to basic title matching if FTS index is not available.
 */
export async function textSearch(
  query: string,
  options: SearchOptions,
  ctx: ScopedRequestContext
): Promise<SearchResult[]> {
  const limit = options.limit ?? 20;

  // Try to use FTS index first
  const index = await ctx.getFTSIndex();

  if (index) {
    // Use FTS index with BM25 scoring
    const ftsOptions: FTSSearchOptions = {
      limit,
      minScore: 0,
      types: options.types,
    };

    const ftsResults = index.search(query, ftsOptions);

    // Convert FTS results to SearchResult format
    return ftsResults.map((result: FTSSearchResult) => ({
      id: result.docId,
      title: result.title,
      type: result.type,
      score: result.score,
      preview: undefined, // Could add snippet generation here
    }));
  }

  // Fallback to basic title matching if FTS index not available
  console.warn('FTS index not available, falling back to title matching');
  return fallbackTitleSearch(query, options, ctx);
}

/**
 * Fallback title-based search when FTS index is not available
 */
async function fallbackTitleSearch(
  query: string,
  options: SearchOptions,
  ctx: ScopedRequestContext
): Promise<SearchResult[]> {
  const manifest = ctx.manifestReader;
  const titleIndex = await manifest.getTitleIndex();

  const normalizedQuery = query.toLowerCase().trim();
  const limit = options.limit ?? 20;
  const results: SearchResult[] = [];

  // Search through title index
  for (const [title] of Object.entries(titleIndex)) {
    if (results.length >= limit * 2) break; // Get extra for sorting

    // Check if title contains query
    if (title.includes(normalizedQuery)) {
      // Calculate basic relevance score
      const exactMatch = title === normalizedQuery;
      const startsWithMatch = title.startsWith(normalizedQuery);

      let score = 0.5; // Base score for contains
      if (exactMatch) score = 1.0;
      else if (startsWithMatch) score = 0.8;

      results.push({
        id: '', // Would need to read article to get ID
        title: title.charAt(0).toUpperCase() + title.slice(1), // Capitalize
        type: 'other', // Would need to read to get type
        score,
      });
    }
  }

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, limit);
}

// =============================================================================
// HTTP Handlers
// =============================================================================

/**
 * GET /api/search?q=X&k=N&hnsw=true
 *
 * Vector similarity search endpoint.
 *
 * Query parameters:
 * - q: Search query (required)
 * - k: Number of results (default: 10, max: 100)
 * - types: Comma-separated article types to filter by
 * - model: Embedding model (default: bge-m3)
 * - hnsw: Use HNSW index (default: true)
 */
export async function handleVectorSearch(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { query } = ctx;

  const q = query.get('q');
  if (!q) {
    return errorResponse('BAD_REQUEST', 'Query parameter "q" is required', 400);
  }

  // Parse k (number of results)
  let k = 10;
  const kParam = query.get('k');
  if (kParam) {
    const parsed = parseInt(kParam, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= MAX_RESULTS_LIMIT) {
      k = parsed;
    }
  }

  // Parse optional type filter
  const typesParam = query.get('types');
  let types: ArticleType[] | undefined;
  if (typesParam) {
    types = typesParam.split(',').filter(isValidArticleType) as ArticleType[];
    if (types.length === 0) {
      types = undefined;
    }
  }

  // Parse and validate model
  const modelParam = query.get('model') ?? DEFAULT_MODEL;
  const model: EmbeddingModel = isValidSearchModel(modelParam) ? modelParam : DEFAULT_MODEL;

  // Parse HNSW flag (default: true, only available for bge-m3)
  const useHnsw = query.get('hnsw') !== 'false';

  try {
    const startTime = Date.now();
    const results = await vectorSearch(q, k, ctx, { types, model, useHnsw });
    const searchTimeMs = Date.now() - startTime;

    return jsonResponse({
      query: q,
      k,
      model,
      useHnsw,
      results,
      count: results.length,
      searchTimeMs,
    });
  } catch (error) {
    console.error('Error performing vector search:', error);
    return errorResponse('INTERNAL_ERROR', 'Search failed', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/search/text?q=X
 */
export async function handleTextSearch(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { query } = ctx;

  const q = query.get('q');
  if (!q) {
    return errorResponse('BAD_REQUEST', 'Query parameter "q" is required', 400);
  }

  const pagination = parsePagination(query);

  // Parse optional type filter
  const typesParam = query.get('types');
  let types: ArticleType[] | undefined;
  if (typesParam) {
    types = typesParam.split(',').filter(isValidArticleType) as ArticleType[];
  }

  const options: SearchOptions = {
    query: q,
    limit: pagination.limit,
    types,
  };

  try {
    const results = await textSearch(q, options, ctx);

    return jsonResponse({
      query: q,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error('Error performing text search:', error);
    return errorResponse('INTERNAL_ERROR', 'Search failed', 500);
  } finally {
    ctx.cleanup();
  }
}

