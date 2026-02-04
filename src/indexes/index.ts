/**
 * Wikipedia Index Module
 *
 * Main entry point for the Wikipedia search index infrastructure.
 * Provides FTS, Vector, and Geo search capabilities integrated with ParqueDB.
 */

// Re-export all types
export * from './types.js';

// Re-export FTS index
export {
  WikipediaFTSIndex,
  type Token,
  type Posting,
  type DocumentStats,
  type FTSSearchResult as FTSResult,
  type FTSSearchOptions as FTSOptions,
  type BM25Config,
  type FieldWeights,
  tokenize,
  tokenizeQuery,
  porterStem,
  BM25Scorer,
  ENGLISH_STOPWORDS,
  DEFAULT_FIELD_WEIGHTS,
  DEFAULT_BM25_CONFIG,
} from './fts-index.js';

// Re-export Vector index
export {
  VectorIndex,
  type VectorIndexConfig,
  type VectorSearchOptions as VectorOptions,
  type VectorSearchResult as VectorResult,
  type HybridSearchOptions as VectorHybridOptions,
  type HybridSearchResult as VectorHybridResult,
  type VectorMetric,
  type VectorIndexStats,
  type ArticleMetadata,
  createVectorIndex,
  createWikipediaVectorIndex,
  EMBEDDING_DIMENSIONS,
} from './vector-index.js';

// Re-export Geo index
export {
  GeoIndex,
  type GeoEntry,
  type GeoSearchResult as GeoResult,
  type GeoSearchOptions as GeoOptions,
  type BoundingBox,
  type SerializedGeoIndex,
  type GeohashDecodeResult,
  encodeGeohash,
  decodeGeohash,
  geohashBounds,
  geohashesInRadius,
  haversineDistance,
  boundingBox,
  isWithinBoundingBox,
  createGeoIndex,
} from './geo-index.js';

// Re-export ID index
export {
  IDIndex,
  createIDIndex,
  loadIDIndex,
  saveIDIndex,
  type IDIndexEntry,
  type SerializedIDIndex,
  type ArticleLocation,
} from './id-index.js';

// Re-export shared types for convenience
export { ARTICLE_TYPES } from '../shared/types.js';
export type { ArticleType } from '../shared/types.js';

import type {
  IndexConfig,
  IndexStats,
  FTSSearchResult,
  FTSSearchOptions,
  VectorSearchResult,
  VectorSearchOptions,
  VectorSearchStats,
  GeoSearchResult,
  GeoSearchOptions,
  GeoBoundingBox,
  CombinedSearchResult,
  HybridSearchOptions,
  IndexEvent,
  IndexEventListener,
} from './types.js';
import { LRUCache } from '../lib/lru-cache.js';
import { WikipediaFTSIndex } from './fts-index.js';
import { VectorIndex } from './vector-index.js';
import { GeoIndex, haversineDistance } from './geo-index.js';
import { IDIndex } from './id-index.js';
import type { ArticleType } from '../shared/types.js';

// =============================================================================
// Index Manager
// =============================================================================

/**
 * Options for IndexManager initialization
 */
export interface IndexManagerOptions extends IndexConfig {
  /** Enable FTS index */
  enableFTS?: boolean;
  /** Enable Vector index */
  enableVector?: boolean;
  /** Enable Geo index */
  enableGeo?: boolean;
  /** Embedding model for vector search */
  embeddingModel?: string;
  /** AI Gateway configuration for embedding generation */
  aiGatewayConfig?: {
    baseUrl?: string;
    accountId?: string;
    gatewayId?: string;
    apiToken?: string;
  };
}

/**
 * Default configuration
 */
const DEFAULT_OPTIONS: Required<Omit<IndexManagerOptions, 'aiGatewayConfig'>> & { aiGatewayConfig?: IndexManagerOptions['aiGatewayConfig'] } = {
  basePath: '/data/indexes',
  cacheIndexes: true,
  maxCacheSize: 100,
  refreshInterval: 0,
  enableFTS: true,
  enableVector: true,
  enableGeo: true,
  embeddingModel: 'bge-m3',
};

/**
 * IndexManager - Coordinates all index operations for Wikipedia
 *
 * Provides a unified interface for:
 * - Full-text search (FTS) with BM25 ranking
 * - Vector similarity search with HNSW
 * - Geo proximity search with geohash bucketing
 * - Hybrid search combining multiple index types
 */
export class IndexManager {
  private readonly options: Required<Omit<IndexManagerOptions, 'aiGatewayConfig'>> & { aiGatewayConfig?: IndexManagerOptions['aiGatewayConfig'] };
  private readonly listeners: Set<IndexEventListener> = new Set();
  private initialized: boolean = false;

  // Index state tracking
  private indexStats: Map<string, IndexStats> = new Map();
  private indexCache: LRUCache<string, unknown>;

  // Actual index instances
  private ftsIndex: WikipediaFTSIndex | null = null;
  private vectorIndex: VectorIndex | null = null;
  private geoIndex: GeoIndex | null = null;
  private idIndex: IDIndex | null = null;

  constructor(options: Partial<IndexManagerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.indexCache = new LRUCache<string, unknown>(this.options.maxCacheSize);
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize the index manager and load indexes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.emit({
      type: 'index_loading',
      indexType: 'fts',
      timestamp: new Date(),
    });

    try {
      // Initialize enabled indexes
      if (this.options.enableFTS) {
        await this.initializeFTSIndex();
      }

      if (this.options.enableVector) {
        await this.initializeVectorIndex();
      }

      if (this.options.enableGeo) {
        await this.initializeGeoIndex();
      }

      this.initialized = true;

      this.emit({
        type: 'index_loaded',
        indexType: 'fts',
        timestamp: new Date(),
      });
    } catch (error) {
      this.emit({
        type: 'index_error',
        indexType: 'fts',
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Check if the manager is initialized and ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  // ===========================================================================
  // Full-Text Search
  // ===========================================================================

  /**
   * Perform a full-text search
   *
   * @param query - Search query string
   * @param options - Search options
   * @returns Array of FTS search results
   */
  async searchFTS(
    query: string,
    options?: FTSSearchOptions
  ): Promise<FTSSearchResult[]> {
    await this.ensureInitialized();

    if (!this.options.enableFTS) {
      throw new Error('FTS index is not enabled');
    }

    const startTime = Date.now();

    this.emit({
      type: 'search_started',
      indexType: 'fts',
      timestamp: new Date(),
      metadata: { query, options },
    });

    try {
      if (!this.ftsIndex) {
        throw new Error('FTS index not loaded');
      }

      // Use the FTS index's search method
      // Build options object with only defined values
      const ftsOptions: { limit?: number; minScore?: number; types?: ArticleType[] } = {};
      if (options?.limit !== undefined) ftsOptions.limit = options.limit;
      if (options?.minScore !== undefined) ftsOptions.minScore = options.minScore;
      if (options?.types !== undefined) ftsOptions.types = options.types;

      const ftsResults = this.ftsIndex.search(query, ftsOptions);

      // Map FTS results to the IndexManager's FTSSearchResult type
      const results: FTSSearchResult[] = ftsResults.map(r => ({
        docId: r.docId,
        title: r.title,
        type: r.type,
        score: r.score,
        matchedTokens: r.matchedTerms,
      }));

      const durationMs = Date.now() - startTime;

      this.emit({
        type: 'search_completed',
        indexType: 'fts',
        timestamp: new Date(),
        durationMs,
        metadata: { resultCount: results.length },
      });

      return results;
    } catch (error) {
      this.emit({
        type: 'index_error',
        indexType: 'fts',
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  // ===========================================================================
  // Vector Search
  // ===========================================================================

  /**
   * Perform a vector similarity search by text query
   *
   * Generates an embedding for the query and searches for similar articles.
   *
   * @param query - Text query to embed and search
   * @param k - Number of results to return
   * @param options - Search options
   * @returns Results and search statistics
   */
  async searchVectorByText(
    query: string,
    k: number,
    options?: VectorSearchOptions
  ): Promise<{ results: VectorSearchResult[]; stats: VectorSearchStats }> {
    await this.ensureInitialized();

    if (!this.options.enableVector) {
      throw new Error('Vector index is not enabled');
    }

    const startTime = Date.now();

    this.emit({
      type: 'search_started',
      indexType: 'vector',
      timestamp: new Date(),
      metadata: { query, k, options },
    });

    try {
      if (!this.vectorIndex) {
        throw new Error('Vector index not loaded');
      }

      // Generate embedding for the query text
      // This requires an external embedding service - for now we'll throw if no AI gateway is configured
      const embeddingStartTime = Date.now();
      const queryEmbedding = await this.generateEmbedding(query);
      const embeddingTimeMs = Date.now() - embeddingStartTime;

      // Search the vector index
      const searchStartTime = Date.now();
      // Build options object with only defined values
      const vectorOptions: { efSearch?: number; minScore?: number; types?: ArticleType[] } = {};
      if (options?.efSearch !== undefined) vectorOptions.efSearch = options.efSearch;
      if (options?.minScore !== undefined) vectorOptions.minScore = options.minScore;
      if (options?.types !== undefined) vectorOptions.types = options.types;

      const vectorResults = this.vectorIndex.search(queryEmbedding, k, vectorOptions);
      const searchTimeMs = Date.now() - searchStartTime;

      // Map vector results to the IndexManager's VectorSearchResult type
      const results: VectorSearchResult[] = vectorResults.map(r => ({
        docId: r.id,
        title: r.title,
        type: r.type,
        score: r.score,
        distance: 1 - r.score, // Convert similarity to distance for cosine metric
      }));

      const stats: VectorSearchStats = {
        totalTimeMs: Date.now() - startTime,
        embeddingTimeMs,
        searchTimeMs,
        partitionsSearched: 1,
        totalCandidates: this.vectorIndex.size,
        embeddingCached: false,
      };

      this.emit({
        type: 'search_completed',
        indexType: 'vector',
        timestamp: new Date(),
        durationMs: stats.totalTimeMs,
        metadata: { resultCount: results.length },
      });

      return { results, stats };
    } catch (error) {
      this.emit({
        type: 'index_error',
        indexType: 'vector',
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Perform a vector similarity search by embedding
   *
   * @param embedding - Query embedding vector
   * @param k - Number of results to return
   * @param options - Search options
   * @returns Array of vector search results
   */
  async searchVectorByEmbedding(
    embedding: Float32Array | number[],
    k: number,
    options?: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    await this.ensureInitialized();

    if (!this.options.enableVector) {
      throw new Error('Vector index is not enabled');
    }

    const startTime = Date.now();

    this.emit({
      type: 'search_started',
      indexType: 'vector',
      timestamp: new Date(),
      metadata: { k, options, embeddingSize: embedding.length },
    });

    try {
      if (!this.vectorIndex) {
        throw new Error('Vector index not loaded');
      }

      // Convert Float32Array to number[] if needed
      const queryVector = Array.isArray(embedding) ? embedding : Array.from(embedding);

      // Search the vector index
      // Build options object with only defined values
      const searchOptions: { efSearch?: number; minScore?: number; types?: ArticleType[] } = {};
      if (options?.efSearch !== undefined) searchOptions.efSearch = options.efSearch;
      if (options?.minScore !== undefined) searchOptions.minScore = options.minScore;
      if (options?.types !== undefined) searchOptions.types = options.types;

      const vectorResults = this.vectorIndex.search(queryVector, k, searchOptions);

      // Map vector results to the IndexManager's VectorSearchResult type
      const results: VectorSearchResult[] = vectorResults.map(r => ({
        docId: r.id,
        title: r.title,
        type: r.type,
        score: r.score,
        distance: 1 - r.score, // Convert similarity to distance for cosine metric
      }));

      this.emit({
        type: 'search_completed',
        indexType: 'vector',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        metadata: { resultCount: results.length },
      });

      return results;
    } catch (error) {
      this.emit({
        type: 'index_error',
        indexType: 'vector',
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  // ===========================================================================
  // Geo Search
  // ===========================================================================

  /**
   * Search for articles near a geographic point
   *
   * @param lat - Latitude of search center
   * @param lng - Longitude of search center
   * @param options - Search options including maxDistance
   * @returns Array of geo search results ordered by distance
   */
  async searchGeoNear(
    lat: number,
    lng: number,
    options?: GeoSearchOptions
  ): Promise<GeoSearchResult[]> {
    await this.ensureInitialized();

    if (!this.options.enableGeo) {
      throw new Error('Geo index is not enabled');
    }

    const startTime = Date.now();

    this.emit({
      type: 'search_started',
      indexType: 'geo',
      timestamp: new Date(),
      metadata: { lat, lng, options },
    });

    try {
      if (!this.geoIndex) {
        throw new Error('Geo index not loaded');
      }

      // Search the geo index
      // Build options object with only defined values
      const geoOptions: { maxDistance?: number; minDistance?: number; limit?: number; types?: ArticleType[] } = {};
      if (options?.maxDistance !== undefined) geoOptions.maxDistance = options.maxDistance;
      if (options?.minDistance !== undefined) geoOptions.minDistance = options.minDistance;
      if (options?.limit !== undefined) geoOptions.limit = options.limit;
      if (options?.types !== undefined) geoOptions.types = options.types;

      const geoResults = this.geoIndex.search(lat, lng, geoOptions);

      // Map geo results to the IndexManager's GeoSearchResult type
      const results: GeoSearchResult[] = geoResults.map(r => ({
        docId: r.entry.articleId,
        title: r.entry.title,
        type: r.entry.type,
        distance: r.distance,
        lat: r.entry.lat,
        lng: r.entry.lng,
        geohash: r.entry.geohash,
      }));

      this.emit({
        type: 'search_completed',
        indexType: 'geo',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        metadata: { resultCount: results.length },
      });

      return results;
    } catch (error) {
      this.emit({
        type: 'index_error',
        indexType: 'geo',
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Search for articles within a geographic bounding box
   *
   * @param bbox - Bounding box coordinates
   * @param options - Search options
   * @returns Array of geo search results
   */
  async searchGeoBoundingBox(
    bbox: GeoBoundingBox,
    options?: Omit<GeoSearchOptions, 'maxDistance' | 'minDistance'>
  ): Promise<GeoSearchResult[]> {
    await this.ensureInitialized();

    if (!this.options.enableGeo) {
      throw new Error('Geo index is not enabled');
    }

    const startTime = Date.now();

    this.emit({
      type: 'search_started',
      indexType: 'geo',
      timestamp: new Date(),
      metadata: { bbox, options },
    });

    try {
      if (!this.geoIndex) {
        throw new Error('Geo index not loaded');
      }

      // Calculate center of bounding box for distance calculations
      const centerLat = (bbox.north + bbox.south) / 2;
      const centerLng = (bbox.east + bbox.west) / 2;

      // Calculate max distance as diagonal of bounding box
      const maxDistance = haversineDistance(bbox.south, bbox.west, bbox.north, bbox.east);

      // Search with bounding box as maxDistance filter
      // Build options object with only defined values
      const bboxGeoOptions: { maxDistance: number; limit?: number; types?: ArticleType[] } = { maxDistance };
      if (options?.limit !== undefined) bboxGeoOptions.limit = options.limit;
      if (options?.types !== undefined) bboxGeoOptions.types = options.types;

      const geoResults = this.geoIndex.search(centerLat, centerLng, bboxGeoOptions);

      // Filter results to only those within the bounding box
      const filteredResults = geoResults.filter(r => {
        return (
          r.entry.lat >= bbox.south &&
          r.entry.lat <= bbox.north &&
          r.entry.lng >= bbox.west &&
          r.entry.lng <= bbox.east
        );
      });

      // Map geo results to the IndexManager's GeoSearchResult type
      const results: GeoSearchResult[] = filteredResults.map(r => ({
        docId: r.entry.articleId,
        title: r.entry.title,
        type: r.entry.type,
        distance: r.distance,
        lat: r.entry.lat,
        lng: r.entry.lng,
        geohash: r.entry.geohash,
      }));

      this.emit({
        type: 'search_completed',
        indexType: 'geo',
        timestamp: new Date(),
        durationMs: Date.now() - startTime,
        metadata: { resultCount: results.length },
      });

      return results;
    } catch (error) {
      this.emit({
        type: 'index_error',
        indexType: 'geo',
        timestamp: new Date(),
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  // ===========================================================================
  // Hybrid Search
  // ===========================================================================

  /**
   * Perform a hybrid search combining FTS and vector search
   *
   * Uses reciprocal rank fusion (RRF) to combine results from both indexes.
   *
   * @param query - Search query string
   * @param k - Number of results to return
   * @param options - Hybrid search options
   * @returns Combined and ranked results
   */
  async searchHybrid(
    query: string,
    k: number,
    options?: HybridSearchOptions
  ): Promise<CombinedSearchResult[]> {
    await this.ensureInitialized();

    const startTime = Date.now();

    // Determine weights
    const ftsWeight = options?.ftsWeight ?? 0.5;
    const vectorWeight = options?.vectorWeight ?? 0.5;
    const rrfConstant = options?.rrfConstant ?? 60;

    const results: CombinedSearchResult[] = [];
    const rankScores = new Map<string, { ftsRank?: number; vectorRank?: number; ftsScore?: number; vectorScore?: number }>();
    const docMetadata = new Map<string, { title: string; type: ArticleType }>();

    // Run FTS search if enabled and weighted
    if (this.options.enableFTS && ftsWeight > 0) {
      const ftsResults = await this.searchFTS(query, {
        ...options?.ftsOptions,
        limit: k * 2, // Over-fetch for better fusion
      });

      ftsResults.forEach((result, rank) => {
        const existing = rankScores.get(result.docId) ?? {};
        existing.ftsRank = rank;
        existing.ftsScore = result.score;
        rankScores.set(result.docId, existing);
        // Store metadata
        if (!docMetadata.has(result.docId)) {
          docMetadata.set(result.docId, { title: result.title, type: result.type });
        }
      });
    }

    // Run vector search if enabled and weighted
    if (this.options.enableVector && vectorWeight > 0) {
      const { results: vectorResults } = await this.searchVectorByText(
        query,
        k * 2, // Over-fetch for better fusion
        options?.vectorOptions
      );

      vectorResults.forEach((result, rank) => {
        const existing = rankScores.get(result.docId) ?? {};
        existing.vectorRank = rank;
        existing.vectorScore = result.score;
        rankScores.set(result.docId, existing);
        // Store metadata (prefer FTS metadata if already set)
        if (!docMetadata.has(result.docId)) {
          docMetadata.set(result.docId, { title: result.title, type: result.type });
        }
      });
    }

    // Calculate RRF scores and build combined results
    for (const [docId, ranks] of rankScores) {
      let rrfScore = 0;

      if (ranks.ftsRank !== undefined) {
        rrfScore += ftsWeight * (1 / (rrfConstant + ranks.ftsRank + 1));
      }

      if (ranks.vectorRank !== undefined) {
        rrfScore += vectorWeight * (1 / (rrfConstant + ranks.vectorRank + 1));
      }

      // Determine primary source and original score
      const source: 'fts' | 'vector' =
        ranks.ftsRank !== undefined &&
        (ranks.vectorRank === undefined || ranks.ftsRank < ranks.vectorRank)
          ? 'fts'
          : 'vector';

      const originalScore = source === 'fts'
        ? (ranks.ftsScore ?? 0)
        : (ranks.vectorScore ?? 0);

      const metadata = docMetadata.get(docId) ?? { title: '', type: 'other' as ArticleType };

      results.push({
        docId,
        title: metadata.title,
        type: metadata.type,
        source,
        normalizedScore: rrfScore,
        originalScore,
      });
    }

    // Sort by RRF score and limit
    results.sort((a, b) => b.normalizedScore - a.normalizedScore);
    const topK = results.slice(0, k);

    this.emit({
      type: 'search_completed',
      indexType: 'fts', // Using FTS as primary for hybrid
      timestamp: new Date(),
      durationMs: Date.now() - startTime,
      metadata: { resultCount: topK.length, hybridSearch: true },
    });

    return topK;
  }

  // ===========================================================================
  // Statistics & Management
  // ===========================================================================

  /**
   * Get statistics for all indexes
   */
  getStats(): Map<string, IndexStats> {
    // Update stats from actual indexes
    if (this.ftsIndex) {
      const ftsStats = this.ftsIndex.getStats();
      this.indexStats.set('fts', {
        type: 'fts',
        documentCount: ftsStats.documentCount,
        sizeBytes: ftsStats.totalPostings * 8,
        ready: true,
      });
    }

    if (this.vectorIndex) {
      const vectorStats = this.vectorIndex.getStats();
      this.indexStats.set('vector', {
        type: 'vector',
        documentCount: vectorStats.totalVectors,
        sizeBytes: vectorStats.memoryBytes,
        ready: true,
      });
    }

    if (this.geoIndex) {
      const geoStats = this.geoIndex.getStats();
      this.indexStats.set('geo', {
        type: 'geo',
        documentCount: geoStats.entryCount,
        sizeBytes: geoStats.entryCount * 100,
        ready: true,
      });
    }

    return new Map(this.indexStats);
  }

  /**
   * Get statistics for a specific index type
   */
  getIndexStats(indexType: 'fts' | 'vector' | 'geo'): IndexStats | undefined {
    // Refresh stats first
    this.getStats();
    return this.indexStats.get(indexType);
  }

  /**
   * Clear the index cache
   */
  clearCache(): void {
    this.indexCache.clear();
  }

  /**
   * Close the index manager and release resources
   */
  async close(): Promise<void> {
    this.clearCache();
    this.indexStats.clear();
    this.ftsIndex = null;
    this.vectorIndex = null;
    this.geoIndex = null;
    this.idIndex = null;
    this.initialized = false;
  }

  // ===========================================================================
  // Index Access & Management
  // ===========================================================================

  /**
   * Get the underlying FTS index
   */
  getFTSIndex(): WikipediaFTSIndex | null {
    return this.ftsIndex;
  }

  /**
   * Get the underlying Vector index
   */
  getVectorIndex(): VectorIndex | null {
    return this.vectorIndex;
  }

  /**
   * Get the underlying Geo index
   */
  getGeoIndex(): GeoIndex | null {
    return this.geoIndex;
  }

  /**
   * Get the ID index
   */
  getIDIndex(): IDIndex | null {
    return this.idIndex;
  }

  /**
   * Set the FTS index (for external initialization)
   */
  setFTSIndex(index: WikipediaFTSIndex): void {
    this.ftsIndex = index;
    const stats = index.getStats();
    this.indexStats.set('fts', {
      type: 'fts',
      documentCount: stats.documentCount,
      sizeBytes: stats.totalPostings * 8,
      ready: true,
    });
  }

  /**
   * Set the Vector index (for external initialization)
   */
  setVectorIndex(index: VectorIndex): void {
    this.vectorIndex = index;
    const stats = index.getStats();
    this.indexStats.set('vector', {
      type: 'vector',
      documentCount: stats.totalVectors,
      sizeBytes: stats.memoryBytes,
      ready: true,
    });
  }

  /**
   * Set the Geo index (for external initialization)
   */
  setGeoIndex(index: GeoIndex): void {
    this.geoIndex = index;
    const stats = index.getStats();
    this.indexStats.set('geo', {
      type: 'geo',
      documentCount: stats.entryCount,
      sizeBytes: stats.entryCount * 100,
      ready: true,
    });
  }

  /**
   * Set the ID index (for external initialization)
   */
  setIDIndex(index: IDIndex): void {
    this.idIndex = index;
  }

  // ===========================================================================
  // Event Handling
  // ===========================================================================

  /**
   * Add an event listener
   */
  addEventListener(listener: IndexEventListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(listener: IndexEventListener): void {
    this.listeners.delete(listener);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async initializeFTSIndex(): Promise<void> {
    // Create FTS index instance
    this.ftsIndex = new WikipediaFTSIndex();

    // Try to load from basePath if available
    const ftsPath = `${this.options.basePath}/fts-index.json`;
    try {
      const data = await this.loadIndexFile(ftsPath);
      if (data) {
        this.ftsIndex = WikipediaFTSIndex.fromJSON(data);
      }
    } catch {
      // Index file not found or invalid - start with empty index
    }

    const stats = this.ftsIndex.getStats();
    this.indexStats.set('fts', {
      type: 'fts',
      documentCount: stats.documentCount,
      sizeBytes: stats.totalPostings * 8, // Rough estimate
      ready: true,
    });
  }

  private async initializeVectorIndex(): Promise<void> {
    // Create Vector index instance
    this.vectorIndex = new VectorIndex({
      dimensions: 1024, // BGE-M3 dimensions
      metric: 'cosine',
    });

    // Note: Vector index loading from files would require binary format support
    // For now, start with empty index - can be populated via insert()

    const stats = this.vectorIndex.getStats();
    this.indexStats.set('vector', {
      type: 'vector',
      documentCount: stats.totalVectors,
      sizeBytes: stats.memoryBytes,
      ready: true,
    });
  }

  private async initializeGeoIndex(): Promise<void> {
    // Create Geo index instance
    this.geoIndex = new GeoIndex();

    // Try to load from basePath if available
    const geoPath = `${this.options.basePath}/geo-index.json`;
    try {
      const data = await this.loadIndexFile(geoPath);
      if (data) {
        this.geoIndex.deserialize(JSON.parse(data));
      }
    } catch {
      // Index file not found or invalid - start with empty index
    }

    const stats = this.geoIndex.getStats();
    this.indexStats.set('geo', {
      type: 'geo',
      documentCount: stats.entryCount,
      sizeBytes: stats.entryCount * 100, // Rough estimate
      ready: true,
    });
  }

  /**
   * Load an index file from the basePath
   * Supports both file system and HTTP loading
   */
  private async loadIndexFile(path: string): Promise<string | null> {
    // Check if path is a URL
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        const response = await fetch(path);
        if (!response.ok) return null;
        return await response.text();
      } catch {
        return null;
      }
    }

    // File system loading (Node.js/Bun environment)
    if (typeof Bun !== 'undefined') {
      try {
        const file = Bun.file(path);
        if (await file.exists()) {
          return await file.text();
        }
      } catch {
        return null;
      }
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      try {
        const { readFile } = await import('node:fs/promises');
        return await readFile(path, 'utf-8');
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Generate an embedding for a text query using the configured AI gateway
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    const config = this.options.aiGatewayConfig;
    if (!config) {
      throw new Error('AI Gateway not configured - cannot generate embeddings');
    }

    // Build the AI Gateway URL
    let url: string;
    if (config.baseUrl) {
      url = config.baseUrl;
    } else if (config.accountId && config.gatewayId) {
      url = `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/workers-ai/@cf/baai/bge-m3`;
    } else {
      throw new Error('AI Gateway configuration incomplete');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiToken) {
      headers['Authorization'] = `Bearer ${config.apiToken}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: [text] }),
    });

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.statusText}`);
    }

    const result = await response.json() as { result?: { data?: number[][] } };
    const embedding = result?.result?.data?.[0];
    if (!embedding) {
      throw new Error('Invalid embedding response');
    }

    return embedding;
  }

  private emit(event: IndexEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Silently ignore listener errors
      }
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an IndexManager instance with the given options
 */
export function createIndexManager(options?: Partial<IndexManagerOptions>): IndexManager {
  return new IndexManager(options);
}

/**
 * Create an IndexManager configured for browser/edge environments
 */
export function createBrowserIndexManager(
  baseUrl: string,
  options?: Partial<Omit<IndexManagerOptions, 'basePath'>>
): IndexManager {
  return new IndexManager({
    ...options,
    basePath: baseUrl,
    enableGeo: options?.enableGeo ?? false, // Geo typically not needed in browser
  });
}
