/**
 * Type definitions for the Wikipedia ingestion pipeline
 */

// Re-export shared types for convenience
export { ARTICLE_TYPES } from '../shared/types.js';
export type { ArticleType } from '../shared/types.js';
import type { ArticleType } from '../shared/types.js';

/** Raw page data extracted from Wikipedia XML dump */
export interface WikiPage {
  /** Page title */
  title: string;
  /** Unique page ID */
  id: number;
  /** Namespace (0 = article, 1 = talk, etc.) */
  ns: number;
  /** Raw wikitext content */
  text: string;
  /** Last revision timestamp */
  timestamp: string;
  /** Redirect target if this is a redirect page */
  redirect?: string;
}

/** Processed article with extracted structured data */
export interface Article {
  /** Article title */
  title: string;
  /** Wikipedia page ID */
  id: number;
  /** Plain text content with markup removed */
  plaintext: string;
  /** Extracted infoboxes with their data */
  infoboxes: Infobox[];
  /** Internal wiki links */
  links: WikiLink[];
  /** Article categories */
  categories: string[];
  /** True if this is a redirect page */
  isRedirect: boolean;
  /** Redirect target if isRedirect is true */
  redirectTarget?: string;
  /** True if this is a disambiguation page */
  isDisambiguation: boolean;
  /** Article type classification */
  type?: ArticleType;
  /** Last revision timestamp */
  timestamp: string;
}

/** Extracted infobox data */
export interface Infobox {
  /** Infobox template type (e.g., "person", "settlement") */
  type: string;
  /** Key-value pairs from the infobox */
  data: Record<string, string>;
}

/** Internal wiki link */
export interface WikiLink {
  /** Link target page title */
  page: string;
  /** Display text (may differ from target) */
  text: string;
}

// ArticleType is imported and re-exported from shared/types.ts

/** Compression types supported by the decompressor */
export type CompressionType = 'gzip' | 'bzip2' | 'auto';

/** Progress information for downloads */
export interface DownloadProgress {
  /** Bytes downloaded so far */
  bytesDownloaded: number;
  /** Total bytes if known from Content-Length */
  totalBytes?: number;
  /** Download speed in bytes per second */
  bytesPerSecond: number;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
}

/** Options for streaming download */
export interface DownloadOptions {
  /** Progress callback */
  onProgress?: (progress: DownloadProgress) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Starting byte for resume (uses Range header) */
  resumeFrom?: number;
  /** Maximum retries on failure */
  maxRetries?: number;
  /** Initial retry delay in ms (doubles each retry) */
  retryDelayMs?: number;
}

/** Pipeline statistics */
export interface PipelineStats {
  /** Total bytes downloaded */
  bytesDownloaded: number;
  /** Total pages processed */
  pagesProcessed: number;
  /** Pages skipped (non-article namespaces) */
  pagesSkipped: number;
  /** Articles classified by type */
  articlesByType: Record<ArticleType, number>;
  /** Processing start time */
  startTime: number;
  /** Current processing rate (articles per second) */
  articlesPerSecond: number;
  /** Number of embeddings generated (if enabled) */
  embeddingsGenerated?: number;
  /** Embedding errors encountered */
  embeddingErrors?: number;
}

/** Supported embedding models for ingestion */
export type IngestionEmbeddingModel = 'bge-m3' | 'bge-base' | 'gemma300';

/** Embeddings configuration for the pipeline */
export interface EmbeddingsConfig {
  /** Enable embedding generation (default: false) */
  enabled: boolean;
  /** Embeddings API base URL (default: https://embeddings.workers.do) */
  apiUrl?: string;
  /** Model to use for embeddings (default: bge-m3) */
  model?: IngestionEmbeddingModel;
  /**
   * Multiple models to generate embeddings for during ingestion.
   * If specified, embeddings will be generated in parallel for all models.
   * Takes precedence over single 'model' option.
   */
  models?: IngestionEmbeddingModel[];
  /** Batch size for embedding requests (default: 50) */
  batchSize?: number;
  /** Maximum retries for failed requests (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 60000) */
  timeout?: number;
}

/** Options for the ingestion pipeline */
export interface PipelineOptions {
  /** Progress callback */
  onProgress?: (stats: PipelineStats) => void;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Compression type (default: auto) */
  compression?: CompressionType;
  /** Filter to specific namespaces (default: [0] for articles only) */
  namespaces?: number[];
  /** Skip redirect pages */
  skipRedirects?: boolean;
  /** Skip disambiguation pages */
  skipDisambiguation?: boolean;
  /** Embeddings configuration */
  embeddings?: EmbeddingsConfig;
}

/** Classified article with type information */
export interface ClassifiedArticle extends Article {
  type: ArticleType;
}
