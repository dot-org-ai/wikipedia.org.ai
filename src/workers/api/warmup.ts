/**
 * Index Warmup Module for Wikipedia API Worker
 *
 * Pre-loads and caches indexes at worker startup or via scheduled triggers
 * to avoid lazy-loading latency on first requests.
 *
 * Supported indexes:
 * - Manifest (data file layout)
 * - Title index (title -> file location)
 * - Type index (type -> file list)
 * - ID index (ID -> file location)
 * - Geo index (spatial search)
 * - FTS index (full-text search)
 * - Vector index (HNSW embeddings)
 *
 * Usage:
 * - Call warmupIndexes() at worker startup
 * - Use Cloudflare Cron Triggers for periodic refresh
 * - Access cached indexes via getWarmCache()
 */

import type { Env, Manifest, TitleIndex, TypeIndex, IDIndexEntry } from './types.js';
import { GeoIndex, createGeoIndex, type SerializedGeoIndex } from '../../indexes/geo-index.js';
import { WikipediaFTSIndex } from '../../indexes/fts-index.js';
import { VectorIndex, createWikipediaVectorIndex } from '../../indexes/vector-index.js';
import { decompressGzipToString } from './r2/snappy-decoder.js';

/** Embedding model used for vector search */
const DEFAULT_MODEL = 'bge-m3';

/** Article types to index */
const ARTICLE_TYPES = ['person', 'place', 'org', 'work', 'event', 'other'] as const;

/**
 * Cached index data that persists across requests within a worker isolate
 */
export interface WarmCache {
  /** Manifest data */
  manifest: Manifest | null;
  /** Title to file location index */
  titleIndex: TitleIndex | null;
  /** Type to file list index */
  typeIndex: TypeIndex | null;
  /** ID to file location index */
  idIndex: Map<string, IDIndexEntry> | null;
  /** Geo-spatial index */
  geoIndex: GeoIndex | null;
  /** Full-text search index */
  ftsIndex: WikipediaFTSIndex | null;
  /** HNSW vector index */
  vectorIndex: VectorIndex | null;
  /** Last warmup timestamp */
  lastWarmup: number;
  /** Warmup status for each index */
  status: {
    manifest: 'pending' | 'loading' | 'ready' | 'error';
    titleIndex: 'pending' | 'loading' | 'ready' | 'error';
    typeIndex: 'pending' | 'loading' | 'ready' | 'error';
    idIndex: 'pending' | 'loading' | 'ready' | 'error';
    geoIndex: 'pending' | 'loading' | 'ready' | 'error';
    ftsIndex: 'pending' | 'loading' | 'ready' | 'error';
    vectorIndex: 'pending' | 'loading' | 'ready' | 'error';
  };
}

/**
 * Global warm cache (persists within isolate lifetime)
 */
let warmCache: WarmCache = {
  manifest: null,
  titleIndex: null,
  typeIndex: null,
  idIndex: null,
  geoIndex: null,
  ftsIndex: null,
  vectorIndex: null,
  lastWarmup: 0,
  status: {
    manifest: 'pending',
    titleIndex: 'pending',
    typeIndex: 'pending',
    idIndex: 'pending',
    geoIndex: 'pending',
    ftsIndex: 'pending',
    vectorIndex: 'pending',
  },
};

/**
 * Get the current warm cache
 */
export function getWarmCache(): WarmCache {
  return warmCache;
}

/**
 * Check if an index is warmed up and ready
 */
export function isIndexReady(
  indexName: keyof WarmCache['status']
): boolean {
  return warmCache.status[indexName] === 'ready';
}

/**
 * Check if all critical indexes are warmed up
 */
export function areIndexesReady(): boolean {
  return (
    warmCache.status.manifest === 'ready' &&
    warmCache.status.titleIndex === 'ready' &&
    warmCache.status.typeIndex === 'ready'
  );
}

/**
 * Warmup options
 */
export interface WarmupOptions {
  /** Include geo index (default: true) */
  geo?: boolean;
  /** Include FTS index (default: true) */
  fts?: boolean;
  /** Include vector index (default: true) */
  vector?: boolean;
  /** Force refresh even if already cached (default: false) */
  force?: boolean;
  /** Maximum time for vector index warmup in ms (default: 30000) */
  vectorTimeoutMs?: number;
}

/**
 * Warmup result with timing information
 */
export interface WarmupResult {
  success: boolean;
  duration: number;
  indexes: {
    name: string;
    status: 'ready' | 'error' | 'skipped';
    duration: number;
    error?: string;
  }[];
}

/**
 * Load manifest from R2
 */
async function loadManifest(bucket: R2Bucket): Promise<Manifest> {
  const object = await bucket.get('manifest.json');
  if (!object) {
    throw new Error('Manifest not found');
  }
  return object.json() as Promise<Manifest>;
}

/**
 * Load title index from R2
 */
async function loadTitleIndex(
  bucket: R2Bucket,
  manifest: Manifest
): Promise<TitleIndex> {
  const object = await bucket.get(manifest.indexFiles.titles);
  if (!object) {
    throw new Error('Title index not found');
  }

  let text: string;
  if (manifest.indexFiles.titles.endsWith('.gz')) {
    const compressed = await object.arrayBuffer();
    text = await decompressGzipToString(new Uint8Array(compressed));
  } else {
    text = await object.text();
  }

  return JSON.parse(text) as TitleIndex;
}

/**
 * Load type index from R2
 */
async function loadTypeIndex(
  bucket: R2Bucket,
  manifest: Manifest
): Promise<TypeIndex> {
  const object = await bucket.get(manifest.indexFiles.types);
  if (!object) {
    throw new Error('Type index not found');
  }

  let text: string;
  if (manifest.indexFiles.types.endsWith('.gz')) {
    const compressed = await object.arrayBuffer();
    text = await decompressGzipToString(new Uint8Array(compressed));
  } else {
    text = await object.text();
  }

  return JSON.parse(text) as TypeIndex;
}

/**
 * Load ID index from R2
 */
async function loadIDIndex(
  bucket: R2Bucket,
  manifest: Manifest
): Promise<Map<string, IDIndexEntry>> {
  if (!manifest.indexFiles.ids) {
    return new Map();
  }

  const object = await bucket.get(manifest.indexFiles.ids);
  if (!object) {
    return new Map();
  }

  let text: string;
  if (manifest.indexFiles.ids.endsWith('.gz')) {
    const compressed = await object.arrayBuffer();
    text = await decompressGzipToString(new Uint8Array(compressed));
  } else {
    text = await object.text();
  }

  const serialized = JSON.parse(text) as { entries: Record<string, IDIndexEntry> };
  const map = new Map<string, IDIndexEntry>();
  for (const [id, entry] of Object.entries(serialized.entries)) {
    map.set(id, entry);
  }
  return map;
}

/**
 * Load geo index from R2
 */
async function loadGeoIndex(bucket: R2Bucket): Promise<GeoIndex> {
  const index = createGeoIndex();

  const object = await bucket.get('indexes/geo-index.json');
  if (object) {
    const data = await object.json() as SerializedGeoIndex;
    index.deserialize(data);
  }

  return index;
}

/**
 * Load FTS index from R2
 */
async function loadFTSIndex(bucket: R2Bucket): Promise<WikipediaFTSIndex> {
  const indexPath = 'indexes/fts/articles.json.gz';
  const object = await bucket.get(indexPath);

  if (!object) {
    throw new Error(`FTS index not found at ${indexPath}`);
  }

  const data = await object.arrayBuffer();
  const bytes = new Uint8Array(data);

  // Decompress gzip
  const stream = new Response(bytes).body;
  if (!stream) {
    throw new Error('Failed to create stream from data');
  }

  const decompressor = new DecompressionStream('gzip');
  const decompressedStream = stream.pipeThrough(decompressor);
  const response = new Response(decompressedStream);
  const buffer = await response.arrayBuffer();
  const json = new TextDecoder().decode(new Uint8Array(buffer));

  return WikipediaFTSIndex.fromJSON(json);
}

/** Lance file metadata */
interface LanceMetadata {
  rowCount: number;
  embeddingDimension: number;
  model: string;
}

/**
 * Load vector index from R2 Lance files
 */
async function loadVectorIndex(bucket: R2Bucket): Promise<VectorIndex> {
  const index = createWikipediaVectorIndex({
    maxNodes: 100000,
    maxBytes: 500 * 1024 * 1024,
  });

  for (const type of ARTICLE_TYPES) {
    const lanceFile = `embeddings/${DEFAULT_MODEL}/${type}.lance`;

    try {
      const head = await bucket.head(lanceFile);
      if (!head) continue;

      const object = await bucket.get(lanceFile);
      if (!object) continue;

      const data = await object.arrayBuffer();
      const bytes = new Uint8Array(data);

      // Parse Lance file
      const { records } = parseLanceFile(bytes);

      for (const record of records) {
        const metadata = {
          id: record.id,
          title: record.title,
          type: record.type as typeof ARTICLE_TYPES[number],
          preview: record.text_preview,
        };

        const embedding = Array.from(record.embedding);
        index.insert(embedding, metadata);
      }

      console.log(`[warmup] Loaded ${records.length} vectors from ${lanceFile}`);
    } catch (error) {
      console.error(`[warmup] Error loading ${lanceFile}:`, error);
    }
  }

  return index;
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
function parseLanceFile(bytes: Uint8Array): { records: LanceRecord[] } {
  // Check magic bytes
  if (
    bytes[0] !== 0x4c || // 'L'
    bytes[1] !== 0x41 || // 'A'
    bytes[2] !== 0x4e || // 'N'
    bytes[3] !== 0x43    // 'C'
  ) {
    throw new Error('Invalid Lance file: bad magic bytes');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Read header
  const metadataLen = view.getUint32(8, true);
  const headerSize = 16;

  // Parse metadata JSON
  const metadataBytes = bytes.slice(headerSize, headerSize + metadataLen);
  const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as LanceMetadata;

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
      embedding: embeddings[i] ?? new Float32Array(0),
    });
  }

  return { records };
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

  const offsetsSize = (rowCount + 1) * 4;
  const offsets: number[] = [];
  for (let i = 0; i <= rowCount; i++) {
    offsets.push(view.getUint32(i * 4, true));
  }

  const strings: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    const startOffset = offsets[i];
    const endOffset = offsets[i + 1];
    if (startOffset !== undefined && endOffset !== undefined) {
      const strStart = offsetsSize + startOffset;
      const strEnd = offsetsSize + endOffset;
      if (strEnd <= data.length) {
        strings.push(decoder.decode(data.slice(strStart, strEnd)));
      } else {
        strings.push('');
      }
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
 * Pre-load all indexes at worker startup
 *
 * This function should be called during worker initialization or via
 * a scheduled trigger to ensure indexes are ready before requests arrive.
 *
 * @param env - Worker environment with R2 bucket binding
 * @param options - Warmup configuration options
 * @returns Warmup result with timing information
 */
export async function warmupIndexes(
  env: Env,
  options: WarmupOptions = {}
): Promise<WarmupResult> {
  const startTime = Date.now();
  const results: WarmupResult['indexes'] = [];
  const {
    geo = true,
    fts = true,
    vector = true,
    force = false,
  } = options;

  const bucket = env.R2;

  // Load manifest (required for other indexes)
  const manifestStart = Date.now();
  try {
    if (force || !warmCache.manifest) {
      warmCache.status.manifest = 'loading';
      warmCache.manifest = await loadManifest(bucket);
      warmCache.status.manifest = 'ready';
    }
    results.push({
      name: 'manifest',
      status: 'ready',
      duration: Date.now() - manifestStart,
    });
  } catch (error) {
    warmCache.status.manifest = 'error';
    results.push({
      name: 'manifest',
      status: 'error',
      duration: Date.now() - manifestStart,
      error: error instanceof Error ? error.message : String(error),
    });
    // Can't continue without manifest
    return {
      success: false,
      duration: Date.now() - startTime,
      indexes: results,
    };
  }

  const manifest = warmCache.manifest!;

  // Load title index
  const titleStart = Date.now();
  try {
    if (force || !warmCache.titleIndex) {
      warmCache.status.titleIndex = 'loading';
      warmCache.titleIndex = await loadTitleIndex(bucket, manifest);
      warmCache.status.titleIndex = 'ready';
    }
    results.push({
      name: 'titleIndex',
      status: 'ready',
      duration: Date.now() - titleStart,
    });
  } catch (error) {
    warmCache.status.titleIndex = 'error';
    results.push({
      name: 'titleIndex',
      status: 'error',
      duration: Date.now() - titleStart,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Load type index
  const typeStart = Date.now();
  try {
    if (force || !warmCache.typeIndex) {
      warmCache.status.typeIndex = 'loading';
      warmCache.typeIndex = await loadTypeIndex(bucket, manifest);
      warmCache.status.typeIndex = 'ready';
    }
    results.push({
      name: 'typeIndex',
      status: 'ready',
      duration: Date.now() - typeStart,
    });
  } catch (error) {
    warmCache.status.typeIndex = 'error';
    results.push({
      name: 'typeIndex',
      status: 'error',
      duration: Date.now() - typeStart,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Load ID index
  const idStart = Date.now();
  try {
    if (force || !warmCache.idIndex) {
      warmCache.status.idIndex = 'loading';
      warmCache.idIndex = await loadIDIndex(bucket, manifest);
      warmCache.status.idIndex = 'ready';
    }
    results.push({
      name: 'idIndex',
      status: 'ready',
      duration: Date.now() - idStart,
    });
  } catch (error) {
    warmCache.status.idIndex = 'error';
    results.push({
      name: 'idIndex',
      status: 'error',
      duration: Date.now() - idStart,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Load geo index (optional)
  if (geo) {
    const geoStart = Date.now();
    try {
      if (force || !warmCache.geoIndex) {
        warmCache.status.geoIndex = 'loading';
        warmCache.geoIndex = await loadGeoIndex(bucket);
        warmCache.status.geoIndex = 'ready';
      }
      results.push({
        name: 'geoIndex',
        status: 'ready',
        duration: Date.now() - geoStart,
      });
    } catch (error) {
      warmCache.status.geoIndex = 'error';
      results.push({
        name: 'geoIndex',
        status: 'error',
        duration: Date.now() - geoStart,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    results.push({ name: 'geoIndex', status: 'skipped', duration: 0 });
  }

  // Load FTS index (optional)
  if (fts) {
    const ftsStart = Date.now();
    try {
      if (force || !warmCache.ftsIndex) {
        warmCache.status.ftsIndex = 'loading';
        warmCache.ftsIndex = await loadFTSIndex(bucket);
        warmCache.status.ftsIndex = 'ready';
      }
      results.push({
        name: 'ftsIndex',
        status: 'ready',
        duration: Date.now() - ftsStart,
      });
    } catch (error) {
      warmCache.status.ftsIndex = 'error';
      results.push({
        name: 'ftsIndex',
        status: 'error',
        duration: Date.now() - ftsStart,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    results.push({ name: 'ftsIndex', status: 'skipped', duration: 0 });
  }

  // Load vector index (optional, can be slow)
  if (vector) {
    const vectorStart = Date.now();
    try {
      if (force || !warmCache.vectorIndex) {
        warmCache.status.vectorIndex = 'loading';
        warmCache.vectorIndex = await loadVectorIndex(bucket);
        warmCache.status.vectorIndex = 'ready';
      }
      results.push({
        name: 'vectorIndex',
        status: 'ready',
        duration: Date.now() - vectorStart,
      });
    } catch (error) {
      warmCache.status.vectorIndex = 'error';
      results.push({
        name: 'vectorIndex',
        status: 'error',
        duration: Date.now() - vectorStart,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    results.push({ name: 'vectorIndex', status: 'skipped', duration: 0 });
  }

  warmCache.lastWarmup = Date.now();

  const allSuccess = results.every(
    (r) => r.status === 'ready' || r.status === 'skipped'
  );

  console.log(
    `[warmup] Completed in ${Date.now() - startTime}ms:`,
    results.map((r) => `${r.name}=${r.status}(${r.duration}ms)`).join(', ')
  );

  return {
    success: allSuccess,
    duration: Date.now() - startTime,
    indexes: results,
  };
}

/**
 * Clear the warm cache (useful for testing or forced refresh)
 */
export function clearWarmCache(): void {
  warmCache = {
    manifest: null,
    titleIndex: null,
    typeIndex: null,
    idIndex: null,
    geoIndex: null,
    ftsIndex: null,
    vectorIndex: null,
    lastWarmup: 0,
    status: {
      manifest: 'pending',
      titleIndex: 'pending',
      typeIndex: 'pending',
      idIndex: 'pending',
      geoIndex: 'pending',
      ftsIndex: 'pending',
      vectorIndex: 'pending',
    },
  };
}

/**
 * Get warmup status summary
 */
export function getWarmupStatus(): {
  ready: boolean;
  lastWarmup: number;
  indexes: Record<string, string>;
} {
  return {
    ready: areIndexesReady(),
    lastWarmup: warmCache.lastWarmup,
    indexes: { ...warmCache.status },
  };
}
