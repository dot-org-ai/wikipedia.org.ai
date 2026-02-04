/**
 * Type definitions for the query module
 */

// Import shared types
// ArticleType describes content classification (person/place/org/etc.)
// PageType describes Wikipedia page structure (namespace/special pages)
export { ARTICLE_TYPES, PAGE_TYPES } from '../shared/types.js';
export type { ArticleType, PageType } from '../shared/types.js';
import type { ArticleType, PageType } from '../shared/types.js';

/**
 * @deprecated Use PageType from shared/types.ts instead.
 * This type describes Wikipedia page structure, not content classification.
 */
export type WikiPageType = PageType;

/**
 * Vector search result with article metadata
 */
export interface VectorSearchResult {
  /** Article ID */
  id: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Similarity score (0-1) */
  score: number;
  /** Distance metric value (if applicable) */
  distance?: number;
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Number of results to return */
  k?: number;
  /** Minimum similarity score threshold */
  minScore?: number;
  /** Filter by article type */
  type?: ArticleType | ArticleType[];
  /** Whether to include embeddings in results */
  includeEmbeddings?: boolean;
}

/**
 * Lookup options
 */
export interface LookupOptions {
  /** Whether to follow redirects */
  followRedirects?: boolean;
  /** Maximum redirect depth */
  maxRedirects?: number;
}

/**
 * Article data returned from R2
 */
export interface ArticleData {
  /** Article ID */
  id: string;
  /** Article title */
  title: string;
  /** Article content (plain text) */
  content: string;
  /** Article type */
  type: ArticleType;
  /** Article metadata */
  metadata: {
    /** Last modified date */
    lastModified?: string;
    /** Categories */
    categories?: string[];
    /** Infobox data */
    infobox?: Record<string, string>;
    /** Article summary/excerpt */
    summary?: string;
    /** Pageview count (if available) */
    pageviews?: number;
  };
}

/**
 * Embedding data returned from R2
 */
export interface EmbeddingData {
  /** Article ID */
  id: string;
  /** Embedding vector (Float32Array) */
  embedding: Float32Array;
  /** Model used to generate embedding */
  model: string;
  /** Creation timestamp */
  createdAt: string;
}

/**
 * Batch operation result
 */
export interface BatchResult<T> {
  /** Successful results */
  success: Map<string, T>;
  /** Failed items with error messages */
  failed: Map<string, string>;
  /** Total processing time in ms */
  timeMs: number;
}
