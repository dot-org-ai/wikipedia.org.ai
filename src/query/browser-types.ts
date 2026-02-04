/**
 * Type definitions for the browser query client
 *
 * These types are browser-safe and contain no Node.js dependencies.
 */

// Re-export shared types for convenience
export { ARTICLE_TYPES } from '../shared/types.js';
export type { ArticleType } from '../shared/types.js';
import type { ArticleType } from '../shared/types.js';

/**
 * Core article data returned by the browser client
 */
export interface Article {
  /** Unique article ID (ULID) */
  id: string;
  /** Article type */
  type: ArticleType;
  /** Article title */
  title: string;
  /** First paragraph description */
  description: string;
  /** Wikidata Q-number if available */
  wikidataId: string | null;
  /** Coordinates for places */
  coords: { lat: number; lon: number } | null;
  /** Infobox data (heterogeneous per type) */
  infobox: Record<string, unknown> | null;
  /** Full plaintext content */
  content: string;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Search result from vector similarity search
 */
export interface SearchResult {
  /** Article ID */
  id: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Similarity score (0-1, higher is more similar) */
  score: number;
  /** Article description (if available) */
  description?: string;
}

/**
 * Relationship between two articles
 */
export interface Relationship {
  /** Source article ID */
  fromId: string;
  /** Source article title */
  fromTitle: string;
  /** Target article ID */
  toId: string;
  /** Target article title */
  toTitle: string;
  /** Relationship predicate (e.g., 'links_to', 'born_in') */
  predicate: string;
}

/**
 * Title index entry mapping title to file location
 */
export interface TitleIndexEntry {
  /** Parquet file path (relative to CDN base) */
  file: string;
  /** Row group index within file */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/**
 * Title index mapping normalized titles to locations
 */
export type TitleIndex = Map<string, TitleIndexEntry>;

/**
 * Type manifest entry for an article type partition
 */
export interface TypeManifestEntry {
  /** Article type */
  type: ArticleType;
  /** Total article count for this type */
  count: number;
  /** Parquet files for this type */
  files: string[];
}

/**
 * Type manifest mapping types to their partition files
 */
export type TypeManifest = Map<ArticleType, TypeManifestEntry>;

/**
 * Bloom filter for fast negative lookups
 */
export interface BloomFilter {
  /** Bloom filter bit array */
  bits: Uint8Array;
  /** Number of hash functions */
  hashCount: number;
  /** Total bit count */
  bitCount: number;
}

/**
 * Row group metadata from Parquet file
 */
export interface RowGroupInfo {
  /** Index of this row group */
  index: number;
  /** Number of rows in this group */
  numRows: number;
  /** Byte offset in file */
  offset: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Column chunk info */
  columns: ColumnChunkInfo[];
}

/**
 * Column chunk metadata
 */
export interface ColumnChunkInfo {
  /** Column name */
  name: string;
  /** Byte offset in file */
  offset: number;
  /** Compressed size */
  compressedSize: number;
  /** Uncompressed size */
  uncompressedSize: number;
  /** Number of values */
  numValues: number;
}

/**
 * Browser client configuration
 */
export interface BrowserClientConfig {
  /** CDN base URL (e.g., 'https://cdn.workers.do/wikipedia') */
  cdnBaseUrl: string;
  /** Index cache TTL in milliseconds (default: 5 minutes) */
  indexCacheTTL?: number;
  /** Snippet API URL for vector search */
  snippetUrl?: string;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof fetch;
  /** Enable IndexedDB caching (default: true) */
  useIndexedDB?: boolean;
  /** IndexedDB database name */
  dbName?: string;
}

/**
 * Query options for article retrieval
 */
export interface QueryOptions {
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Columns to include (projection) */
  columns?: string[];
}

/**
 * HTTP cache entry
 */
export interface CacheEntry<T> {
  /** Cached data */
  data: T;
  /** Cache timestamp */
  timestamp: number;
  /** ETag for conditional requests */
  etag?: string;
}

/**
 * Parquet file metadata
 */
export interface ParquetMetadata {
  /** Schema elements */
  schema: SchemaElement[];
  /** Row group metadata */
  rowGroups: RowGroupInfo[];
  /** Total number of rows */
  numRows: number;
  /** File creation timestamp */
  createdBy?: string | undefined;
}

/**
 * Schema element from Parquet file
 */
export interface SchemaElement {
  /** Column name */
  name: string;
  /** Parquet type */
  type?: string | undefined;
  /** Converted type */
  convertedType?: string | undefined;
  /** Repetition type */
  repetitionType?: 'REQUIRED' | 'OPTIONAL' | 'REPEATED' | undefined;
  /** Number of children (for nested types) */
  numChildren?: number | undefined;
}

/**
 * Autocomplete result
 */
export interface AutocompleteResult {
  /** Matching title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Whether this is an exact match */
  exact: boolean;
}
