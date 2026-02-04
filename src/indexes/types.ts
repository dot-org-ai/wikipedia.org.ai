/**
 * Index Types for Wikipedia.org.ai
 *
 * Type definitions for search indexes including FTS, Vector, and Geo search.
 * These types are designed to work with ParqueDB's index infrastructure.
 */

import type { ArticleType } from '../shared/types.js';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Base search result with common fields
 */
export interface BaseSearchResult {
  /** Document/Article ID */
  docId: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Row group hint for efficient Parquet reading */
  rowGroup?: number;
  /** Row offset within row group */
  rowOffset?: number;
}

/**
 * Index configuration options
 */
export interface IndexConfig {
  /** Base path for index files */
  basePath: string;
  /** Whether to cache loaded indexes in memory */
  cacheIndexes?: boolean;
  /** Maximum number of cached indexes */
  maxCacheSize?: number;
  /** Index refresh interval in ms (0 = no auto-refresh) */
  refreshInterval?: number;
}

/**
 * Index statistics
 */
export interface IndexStats {
  /** Type of index */
  type: 'fts' | 'vector' | 'geo';
  /** Number of documents indexed */
  documentCount: number;
  /** Size of index in bytes */
  sizeBytes: number;
  /** Last update timestamp */
  lastUpdated?: Date;
  /** Whether the index is ready for queries */
  ready: boolean;
}

// =============================================================================
// Full-Text Search Types
// =============================================================================

/**
 * FTS search result
 */
export interface FTSSearchResult extends BaseSearchResult {
  /** BM25 relevance score */
  score: number;
  /** Matched tokens from the query */
  matchedTokens: string[];
  /** Highlighted snippets with matched terms */
  highlights?: Record<string, string[]>;
}

/**
 * FTS search options
 */
export interface FTSSearchOptions {
  /** Maximum number of results */
  limit?: number;
  /** Minimum relevance score threshold */
  minScore?: number;
  /** Filter by article types */
  types?: ArticleType[];
  /** Language for stemming and stopwords */
  language?: string;
  /** Enable highlighting of matched terms */
  highlight?: boolean | FTSHighlightOptions;
  /** Enable fuzzy matching for typo tolerance */
  fuzzy?: boolean | FTSFuzzyOptions;
}

/**
 * FTS highlight options
 */
export interface FTSHighlightOptions {
  /** Tag to wrap before matched terms (default: '<mark>') */
  preTag?: string;
  /** Tag to wrap after matched terms (default: '</mark>') */
  postTag?: string;
  /** Maximum number of snippets per field */
  maxSnippets?: number;
  /** Maximum length of each snippet */
  maxSnippetLength?: number;
}

/**
 * FTS fuzzy matching options
 */
export interface FTSFuzzyOptions {
  /** Maximum edit distance (default: 2) */
  maxDistance?: number;
  /** Minimum term length to apply fuzzy matching (default: 4) */
  minTermLength?: number;
  /** Characters that must match exactly at the start (default: 1) */
  prefixLength?: number;
}

/**
 * FTS index configuration
 */
export interface FTSIndexConfig {
  /** Fields to index */
  fields: Array<{
    /** Field path in the document */
    path: string;
    /** Weight for this field (default: 1.0) */
    weight?: number;
  }>;
  /** Language for stemming/stopwords (default: 'english') */
  language?: string;
  /** Minimum word length to index (default: 2) */
  minWordLength?: number;
  /** Maximum word length to index (default: 50) */
  maxWordLength?: number;
  /** Custom stopwords to exclude */
  stopwords?: string[];
  /** Enable position indexing for phrase queries */
  indexPositions?: boolean;
}

// =============================================================================
// Vector Search Types
// =============================================================================

/**
 * Vector search result
 */
export interface VectorSearchResult extends BaseSearchResult {
  /** Similarity score (interpretation depends on metric) */
  score: number;
  /** Distance from query vector */
  distance: number;
  /** Partition/type the result came from */
  partition?: ArticleType;
  /** Full embedding vector (if requested) */
  embedding?: Float32Array;
}

/**
 * Vector search options
 */
export interface VectorSearchOptions {
  /** Filter by article types */
  types?: ArticleType[];
  /** Minimum similarity score threshold */
  minScore?: number;
  /** Include the embedding vector in results */
  includeEmbedding?: boolean;
  /** HNSW efSearch parameter (higher = more accurate, slower) */
  efSearch?: number;
  /** Use approximate search (HNSW) vs exact search */
  approximate?: boolean;
}

/**
 * Vector search statistics
 */
export interface VectorSearchStats {
  /** Total search time in milliseconds */
  totalTimeMs: number;
  /** Time spent generating query embedding */
  embeddingTimeMs: number;
  /** Time spent searching the index */
  searchTimeMs: number;
  /** Number of partitions searched */
  partitionsSearched: number;
  /** Total candidates considered before final ranking */
  totalCandidates: number;
  /** Whether the query embedding was cached */
  embeddingCached: boolean;
}

/**
 * Vector index configuration
 */
export interface VectorIndexConfig {
  /** Number of dimensions in the vectors */
  dimensions: number;
  /** Distance metric */
  metric?: 'cosine' | 'euclidean' | 'dot';
  /** HNSW M parameter (connections per layer, default: 16) */
  m?: number;
  /** HNSW efConstruction (construction quality, default: 200) */
  efConstruction?: number;
}

// =============================================================================
// Geo Search Types
// =============================================================================

/**
 * Geo search result
 */
export interface GeoSearchResult extends BaseSearchResult {
  /** Distance from query point in meters */
  distance: number;
  /** Latitude of the result */
  lat: number;
  /** Longitude of the result */
  lng: number;
  /** Geohash of the location */
  geohash?: string;
}

/**
 * Geo search options
 */
export interface GeoSearchOptions {
  /** Maximum distance from query point in meters */
  maxDistance?: number;
  /** Minimum distance from query point in meters */
  minDistance?: number;
  /** Maximum number of results */
  limit?: number;
  /** Filter by article types */
  types?: ArticleType[];
}

/**
 * Geo bounding box
 */
export interface GeoBoundingBox {
  /** North latitude (top) */
  north: number;
  /** South latitude (bottom) */
  south: number;
  /** East longitude (right) */
  east: number;
  /** West longitude (left) */
  west: number;
}

/**
 * Geo index configuration
 */
export interface GeoIndexConfig {
  /** Geohash precision for bucketing (1-12, default: 6 = ~1.2km cells) */
  bucketPrecision?: number;
  /** Field paths for lat/lng */
  latField?: string;
  lngField?: string;
}

// =============================================================================
// Combined/Hybrid Search Types
// =============================================================================

/**
 * Combined search result that can contain results from multiple index types
 */
export interface CombinedSearchResult extends BaseSearchResult {
  /** Source of the result */
  source: 'fts' | 'vector' | 'geo';
  /** Normalized score (0-1) for cross-index comparison */
  normalizedScore: number;
  /** Original score from the source index */
  originalScore: number;
  /** Additional source-specific data */
  sourceData?: {
    /** FTS highlights */
    highlights?: Record<string, string[]>;
    /** FTS matched tokens */
    matchedTokens?: string[];
    /** Vector distance */
    distance?: number;
    /** Geo distance in meters */
    geoDistance?: number;
    /** Geo coordinates */
    coordinates?: { lat: number; lng: number };
  };
}

/**
 * Hybrid search options combining FTS and vector search
 */
export interface HybridSearchOptions {
  /** Weight for FTS results (0-1, default: 0.5) */
  ftsWeight?: number;
  /** Weight for vector results (0-1, default: 0.5) */
  vectorWeight?: number;
  /** Reciprocal rank fusion constant (default: 60) */
  rrfConstant?: number;
  /** FTS-specific options */
  ftsOptions?: FTSSearchOptions;
  /** Vector-specific options */
  vectorOptions?: VectorSearchOptions;
}

// =============================================================================
// Index Events
// =============================================================================

/**
 * Index event types
 */
export type IndexEventType =
  | 'index_loading'
  | 'index_loaded'
  | 'index_error'
  | 'search_started'
  | 'search_completed'
  | 'cache_hit'
  | 'cache_miss';

/**
 * Index event
 */
export interface IndexEvent {
  /** Event type */
  type: IndexEventType;
  /** Index type */
  indexType: 'fts' | 'vector' | 'geo';
  /** Timestamp */
  timestamp: Date;
  /** Duration in ms (for completed events) */
  durationMs?: number;
  /** Error (for error events) */
  error?: Error;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Index event listener
 */
export type IndexEventListener = (event: IndexEvent) => void;
