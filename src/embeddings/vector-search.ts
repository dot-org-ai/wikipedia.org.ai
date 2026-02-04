// @ts-nocheck - Complex array operations and optional property handling in search result processing
/**
 * High-level vector search API for Wikipedia embeddings
 *
 * Features:
 * - Text-to-embedding search (generates embedding + searches)
 * - Direct embedding search
 * - Multi-file search across partitions
 * - Filtering by article type and model
 * - Result merging and re-ranking
 * - Configurable AI Gateway for embedding generation
 */

import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { LanceReader, type SearchResult, type SearchFilter, type IVFPQSearchConfig } from './lance-reader.js';
import { AIGatewayClient, createAIGatewayClient } from './ai-gateway.js';
import type { EmbeddingModel, ArticleType, AIGatewayConfig } from './types.js';
import { LRUCache } from '../lib/lru-cache.js';

/** Vector search configuration */
export interface VectorSearchConfig {
  /** Base path for Lance files */
  lanceBasePath: string;
  /** AI Gateway configuration for embedding generation */
  aiGateway?: Partial<AIGatewayConfig>;
  /** Default embedding model */
  defaultModel?: EmbeddingModel;
  /** Maximum concurrent file reads */
  maxConcurrent?: number;
  /** Cache loaded readers */
  cacheReaders?: boolean;
  /** IVF-PQ search configuration */
  ivfpqConfig?: IVFPQSearchConfig;
}

/** Search options */
export interface SearchOptions {
  /** Embedding model to use */
  model?: EmbeddingModel;
  /** Filter by article types */
  types?: ArticleType[];
  /** Number of results per partition (before merging) */
  perPartitionLimit?: number;
  /** Include embeddings in results */
  includeEmbeddings?: boolean;
  /** Use IVF-PQ accelerated search */
  useIndex?: boolean;
  /** IVF-PQ search configuration override */
  ivfpqConfig?: IVFPQSearchConfig;
}

/** Extended search result with optional embedding */
export interface VectorSearchResult extends SearchResult {
  /** Source partition (type) */
  partition: ArticleType;
  /** Full embedding vector (if requested) */
  embedding?: Float32Array;
}

/** Search statistics */
export interface SearchStats {
  /** Total search time in ms */
  totalTimeMs: number;
  /** Embedding generation time in ms */
  embeddingTimeMs: number;
  /** Search time in ms */
  searchTimeMs: number;
  /** Number of partitions searched */
  partitionsSearched: number;
  /** Total candidates before merging */
  totalCandidates: number;
  /** Whether embeddings were cached */
  embeddingCached: boolean;
}

/** Default search configuration */
const DEFAULT_CONFIG: Required<VectorSearchConfig> = {
  lanceBasePath: '/mnt/r2/embeddings',
  aiGateway: {},
  defaultModel: 'bge-m3',
  maxConcurrent: 4,
  cacheReaders: true,
  ivfpqConfig: {
    nprobe: 10,
    asymmetric: true,
    precomputeTables: true,
  },
};

/** All article types for searching all partitions */
const ALL_ARTICLE_TYPES: ArticleType[] = [
  'person',
  'place',
  'org',
  'work',
  'event',
  'other',
];

/** Maximum number of cached Lance readers */
const MAX_READER_CACHE_SIZE = 24;

/**
 * High-level vector search API
 */
export class VectorSearch {
  private readonly config: Required<VectorSearchConfig>;
  private readonly aiGateway: AIGatewayClient;
  private readonly readerCache: LRUCache<string, LanceReader>;
  private availablePartitions: Map<EmbeddingModel, ArticleType[]> = new Map();
  private initialized = false;

  constructor(config: Partial<VectorSearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<VectorSearchConfig>;
    this.aiGateway = createAIGatewayClient(this.config.aiGateway);
    // Initialize reader cache with LRU eviction and cleanup callback
    this.readerCache = new LRUCache<string, LanceReader>({
      maxSize: MAX_READER_CACHE_SIZE,
      onEvict: (_key, reader) => reader.close(),
    });
  }

  /**
   * Initialize the search engine by scanning available partitions
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const basePath = this.config.lanceBasePath;
      const models = await readdir(basePath);

      for (const model of models) {
        const modelPath = join(basePath, model);
        const stats = await stat(modelPath);
        if (!stats.isDirectory()) continue;

        const files = await readdir(modelPath);
        const types: ArticleType[] = [];

        for (const file of files) {
          if (file.endsWith('.lance')) {
            const type = basename(file, '.lance') as ArticleType;
            if (ALL_ARTICLE_TYPES.includes(type)) {
              types.push(type);
            }
          }
        }

        if (types.length > 0) {
          this.availablePartitions.set(model as EmbeddingModel, types);
        }
      }

      this.initialized = true;
    } catch (error) {
      // Directory doesn't exist yet, that's okay
      this.initialized = true;
    }
  }

  /**
   * Search by text query
   * Generates an embedding from the query text and performs k-NN search
   */
  async searchByText(
    query: string,
    k: number,
    options?: SearchOptions
  ): Promise<{ results: VectorSearchResult[]; stats: SearchStats }> {
    const startTime = Date.now();
    await this.initialize();

    const model = options?.model ?? this.config.defaultModel;

    // Generate embedding
    const embeddingStart = Date.now();
    const response = await this.aiGateway.generateEmbeddings({
      model,
      texts: [query],
    });
    const embeddingTimeMs = Date.now() - embeddingStart;
    const queryEmbedding = new Float32Array(response.embeddings[0]);

    // Perform search
    const searchStart = Date.now();
    const { results, partitionsSearched, totalCandidates } = await this.searchByEmbedding(
      queryEmbedding,
      k,
      { ...options, model }
    );
    const searchTimeMs = Date.now() - searchStart;

    return {
      results,
      stats: {
        totalTimeMs: Date.now() - startTime,
        embeddingTimeMs,
        searchTimeMs,
        partitionsSearched,
        totalCandidates,
        embeddingCached: response.cached,
      },
    };
  }

  /**
   * Search by embedding vector
   * Performs k-NN search directly with the provided embedding
   */
  async searchByEmbedding(
    embedding: Float32Array,
    k: number,
    options?: SearchOptions
  ): Promise<{
    results: VectorSearchResult[];
    partitionsSearched: number;
    totalCandidates: number;
  }> {
    await this.initialize();

    const model = options?.model ?? this.config.defaultModel;
    const types = options?.types ?? this.getAvailableTypes(model);
    const perPartitionLimit = options?.perPartitionLimit ?? k * 2;
    const useIndex = options?.useIndex ?? true;

    // Get readers for all relevant partitions
    const readers: Array<{ reader: LanceReader; type: ArticleType }> = [];
    for (const type of types) {
      const reader = await this.getReader(model, type);
      if (reader) {
        readers.push({ reader, type });
      }
    }

    if (readers.length === 0) {
      return { results: [], partitionsSearched: 0, totalCandidates: 0 };
    }

    // Build filter
    const filter: SearchFilter = {};
    if (options?.types && options.types.length > 0) {
      filter.type = options.types;
    }

    // Search all partitions concurrently
    const ivfpqConfig = options?.ivfpqConfig ?? this.config.ivfpqConfig;
    const searchPromises = readers.map(async ({ reader, type }) => {
      try {
        const results = await reader.search(
          embedding,
          perPartitionLimit,
          filter,
          useIndex ? ivfpqConfig : undefined
        );
        return results.map((r) => ({ ...r, partition: type }));
      } catch (error) {
        console.error(`Search failed for ${model}/${type}:`, error);
        return [];
      }
    });

    // Limit concurrency
    const allResults: VectorSearchResult[] = [];
    const chunks = this.chunkArray(searchPromises, this.config.maxConcurrent);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk);
      for (const results of chunkResults) {
        allResults.push(...results);
      }
    }

    // Merge and re-rank all results
    allResults.sort((a, b) => a.distance - b.distance);
    const topK = allResults.slice(0, k);

    // Load embeddings if requested
    if (options?.includeEmbeddings) {
      await this.loadEmbeddings(topK, model);
    }

    return {
      results: topK,
      partitionsSearched: readers.length,
      totalCandidates: allResults.length,
    };
  }

  /**
   * Search multiple models and merge results
   */
  async searchMultiModel(
    query: string,
    k: number,
    models: EmbeddingModel[],
    options?: Omit<SearchOptions, 'model'>
  ): Promise<{ results: VectorSearchResult[]; stats: SearchStats }> {
    const startTime = Date.now();
    await this.initialize();

    // Generate embeddings for all models
    const embeddingStart = Date.now();
    const embeddingPromises = models.map((model) =>
      this.aiGateway.generateEmbeddings({ model, texts: [query] })
    );
    const responses = await Promise.all(embeddingPromises);
    const embeddingTimeMs = Date.now() - embeddingStart;

    // Search with each model's embedding
    const searchStart = Date.now();
    const searchPromises = models.map((model, i) => {
      const embedding = new Float32Array(responses[i].embeddings[0]);
      return this.searchByEmbedding(embedding, k, { ...options, model });
    });

    const searchResults = await Promise.all(searchPromises);
    const searchTimeMs = Date.now() - searchStart;

    // Merge results using reciprocal rank fusion
    const mergedResults = this.reciprocalRankFusion(
      searchResults.map((r) => r.results),
      k
    );

    const totalPartitions = searchResults.reduce((sum, r) => sum + r.partitionsSearched, 0);
    const totalCandidates = searchResults.reduce((sum, r) => sum + r.totalCandidates, 0);
    const anyCached = responses.some((r) => r.cached);

    return {
      results: mergedResults,
      stats: {
        totalTimeMs: Date.now() - startTime,
        embeddingTimeMs,
        searchTimeMs,
        partitionsSearched: totalPartitions,
        totalCandidates,
        embeddingCached: anyCached,
      },
    };
  }

  /**
   * Get available article types for a model
   */
  getAvailableTypes(model: EmbeddingModel): ArticleType[] {
    return this.availablePartitions.get(model) ?? [];
  }

  /**
   * Get available models
   */
  getAvailableModels(): EmbeddingModel[] {
    return Array.from(this.availablePartitions.keys());
  }

  /**
   * Get partition stats
   */
  async getPartitionStats(): Promise<Map<string, { rowCount: number; hasIndex: boolean }>> {
    await this.initialize();

    const stats = new Map<string, { rowCount: number; hasIndex: boolean }>();

    for (const [model, types] of this.availablePartitions) {
      for (const type of types) {
        const reader = await this.getReader(model, type);
        if (reader) {
          const key = `${model}/${type}`;
          stats.set(key, {
            rowCount: reader.getRowCount(),
            hasIndex: reader.hasIndex(),
          });
        }
      }
    }

    return stats;
  }

  /**
   * Clear reader cache
   */
  clearCache(): void {
    for (const reader of this.readerCache.values()) {
      reader.close();
    }
    this.readerCache.clear();
  }

  /**
   * Close and release all resources
   */
  close(): void {
    this.clearCache();
    this.availablePartitions.clear();
    this.initialized = false;
  }

  /**
   * Get or create a reader for a partition
   */
  private async getReader(
    model: EmbeddingModel,
    type: ArticleType
  ): Promise<LanceReader | null> {
    const key = `${model}/${type}`;

    if (this.config.cacheReaders && this.readerCache.has(key)) {
      return this.readerCache.get(key)!;
    }

    const filePath = join(this.config.lanceBasePath, model, `${type}.lance`);

    try {
      await stat(filePath);
    } catch {
      return null; // File doesn't exist
    }

    const reader = new LanceReader();
    await reader.loadIndex(filePath);

    if (this.config.cacheReaders) {
      this.readerCache.set(key, reader);
    }

    return reader;
  }

  /**
   * Load embeddings for search results
   */
  private async loadEmbeddings(
    results: VectorSearchResult[],
    model: EmbeddingModel
  ): Promise<void> {
    // Group by partition
    const byPartition = new Map<ArticleType, VectorSearchResult[]>();
    for (const result of results) {
      const partition = result.partition;
      if (!byPartition.has(partition)) {
        byPartition.set(partition, []);
      }
      byPartition.get(partition)!.push(result);
    }

    // Load embeddings from each partition
    for (const [partition, partitionResults] of byPartition) {
      const reader = await this.getReader(model, partition);
      if (!reader) continue;

      for (const result of partitionResults) {
        const record = await reader.getById(result.id);
        if (record) {
          result.embedding = record.embedding;
        }
      }
    }
  }

  /**
   * Reciprocal Rank Fusion for merging results from multiple rankings
   */
  private reciprocalRankFusion(
    rankings: VectorSearchResult[][],
    k: number,
    constant: number = 60
  ): VectorSearchResult[] {
    const scores = new Map<string, { score: number; result: VectorSearchResult }>();

    for (const ranking of rankings) {
      for (let i = 0; i < ranking.length; i++) {
        const result = ranking[i];
        const rrfScore = 1 / (constant + i + 1);

        if (scores.has(result.id)) {
          const existing = scores.get(result.id)!;
          existing.score += rrfScore;
        } else {
          scores.set(result.id, { score: rrfScore, result });
        }
      }
    }

    // Sort by RRF score
    const sorted = Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ result, score }) => ({
        ...result,
        score, // Override with RRF score
      }));

    return sorted;
  }

  /**
   * Split array into chunks for concurrent processing
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

/**
 * Create a vector search instance
 */
export function createVectorSearch(config: Partial<VectorSearchConfig> = {}): VectorSearch {
  return new VectorSearch(config);
}

/**
 * URL-based vector search for browser/edge environments
 * Uses HTTP Range requests to access Lance files
 */
export class RemoteVectorSearch {
  private readonly baseUrl: string;
  private readonly aiGateway: AIGatewayClient;
  private readonly defaultModel: EmbeddingModel;
  private readonly readerCache: LRUCache<string, LanceReader>;
  private manifest: { models: Record<string, string[]> } | null = null;

  constructor(config: {
    baseUrl: string;
    aiGateway?: Partial<AIGatewayConfig>;
    defaultModel?: EmbeddingModel;
  }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.aiGateway = createAIGatewayClient(config.aiGateway ?? {});
    this.defaultModel = config.defaultModel ?? 'bge-m3';
    // Initialize reader cache with LRU eviction and cleanup callback
    this.readerCache = new LRUCache<string, LanceReader>({
      maxSize: MAX_READER_CACHE_SIZE,
      onEvict: (_key, reader) => reader.close(),
    });
  }

  /**
   * Initialize by loading manifest
   */
  async initialize(): Promise<void> {
    if (this.manifest) return;

    try {
      const response = await fetch(`${this.baseUrl}/manifest.json`);
      if (response.ok) {
        this.manifest = await response.json();
      }
    } catch {
      // Manifest not available, will discover on demand
      this.manifest = { models: {} };
    }
  }

  /**
   * Search by text query
   */
  async searchByText(
    query: string,
    k: number,
    options?: {
      model?: EmbeddingModel;
      types?: ArticleType[];
    }
  ): Promise<VectorSearchResult[]> {
    await this.initialize();

    const model = options?.model ?? this.defaultModel;

    // Generate embedding
    const response = await this.aiGateway.generateEmbeddings({
      model,
      texts: [query],
    });
    const queryEmbedding = new Float32Array(response.embeddings[0]);

    return this.searchByEmbedding(queryEmbedding, k, options);
  }

  /**
   * Search by embedding
   */
  async searchByEmbedding(
    embedding: Float32Array,
    k: number,
    options?: {
      model?: EmbeddingModel;
      types?: ArticleType[];
    }
  ): Promise<VectorSearchResult[]> {
    await this.initialize();

    const model = options?.model ?? this.defaultModel;
    const types = options?.types ?? ALL_ARTICLE_TYPES;

    const allResults: VectorSearchResult[] = [];

    // Search each type partition
    for (const type of types) {
      try {
        const reader = await this.getRemoteReader(model, type);
        if (!reader) continue;

        const results = await reader.search(embedding, k * 2);
        for (const result of results) {
          allResults.push({ ...result, partition: type });
        }
      } catch (error) {
        // Partition might not exist
        console.warn(`Partition ${model}/${type} not available:`, error);
      }
    }

    // Merge and return top k
    allResults.sort((a, b) => a.distance - b.distance);
    return allResults.slice(0, k);
  }

  /**
   * Get a remote reader for a partition
   */
  private async getRemoteReader(
    model: EmbeddingModel,
    type: ArticleType
  ): Promise<LanceReader | null> {
    const key = `${model}/${type}`;

    if (this.readerCache.has(key)) {
      return this.readerCache.get(key)!;
    }

    const reader = new LanceReader();
    try {
      await reader.loadFromUrl({
        url: `${this.baseUrl}/${model}/${type}.lance`,
      });
      this.readerCache.set(key, reader);
      return reader;
    } catch {
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    for (const reader of this.readerCache.values()) {
      reader.close();
    }
    this.readerCache.clear();
  }
}

/**
 * Create a remote vector search instance for browser usage
 */
export function createRemoteVectorSearch(config: {
  baseUrl: string;
  aiGateway?: Partial<AIGatewayConfig>;
  defaultModel?: EmbeddingModel;
}): RemoteVectorSearch {
  return new RemoteVectorSearch(config);
}
