/**
 * Type definitions for the Wikipedia Sandbox Worker
 *
 * The sandbox worker handles Wikipedia data ingestion and processing,
 * including parsing, classification, and storage to R2/Parquet.
 */

import type { ArticleType } from '../../shared/types.js';

/**
 * Environment bindings for the sandbox worker
 */
export interface Env {
  /** R2 bucket for Wikipedia data input (dumps) */
  INPUT_BUCKET: R2Bucket;
  /** R2 bucket for processed output (Parquet files) */
  OUTPUT_BUCKET: R2Bucket;
  /** Queue for processing jobs */
  INGEST_QUEUE: Queue<IngestMessage>;
  /** Workers AI binding for embeddings */
  AI: Ai;
  /** Environment identifier */
  ENVIRONMENT: 'staging' | 'production';
  /** Optional API keys for authentication */
  API_KEYS?: string;
}

/**
 * Ingestion job configuration
 */
export interface IngestJobConfig {
  /** URL of Wikipedia dump file to process */
  dumpUrl: string;
  /** Output path prefix in R2 */
  outputPrefix: string;
  /** Number of articles per batch */
  batchSize: number;
  /** Skip redirect pages */
  skipRedirects: boolean;
  /** Skip disambiguation pages */
  skipDisambiguation: boolean;
  /** Generate embeddings during ingestion */
  generateEmbeddings: boolean;
  /** Embedding model to use */
  embeddingsModel: 'bge-m3' | 'bge-base';
  /** Maximum number of articles to process (optional limit) */
  limit?: number;
  /** Resume from specific article ID */
  resumeFromId?: number;
}

/**
 * Ingestion job status
 */
export type IngestJobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

/**
 * Ingestion job state
 */
export interface IngestJobState {
  /** Unique job identifier */
  jobId: string;
  /** Current status */
  status: IngestJobStatus;
  /** Job configuration */
  config: IngestJobConfig;
  /** Job start time */
  startedAt: string | null;
  /** Last update time */
  updatedAt: string;
  /** Number of articles processed */
  articlesProcessed: number;
  /** Number of articles skipped */
  articlesSkipped: number;
  /** Bytes downloaded from source */
  bytesDownloaded: number;
  /** Bytes written to output */
  bytesWritten: number;
  /** Articles by type */
  articlesByType: Record<ArticleType, number>;
  /** Current processing rate (articles/sec) */
  currentRate: number;
  /** Estimated time remaining (seconds) */
  estimatedRemaining: number | null;
  /** Number of embeddings generated */
  embeddingsGenerated: number;
  /** Number of embedding errors */
  embeddingErrors: number;
  /** Last processed article ID */
  lastArticleId: number;
  /** Last processed article title */
  lastArticleTitle: string;
  /** Error list */
  errors: JobError[];
}

/**
 * Job error entry
 */
export interface JobError {
  /** Error timestamp */
  timestamp: string;
  /** Error message */
  message: string;
  /** Optional article ID where error occurred */
  articleId?: number;
}

/**
 * Queue message for ingestion jobs
 */
export interface IngestMessage {
  /** Message type */
  type: 'start' | 'process-batch' | 'finalize';
  /** Job ID */
  jobId: string;
  /** Batch data (for process-batch type) */
  batch?: BatchData;
}

/**
 * Batch processing data
 */
export interface BatchData {
  /** Batch number */
  batchNumber: number;
  /** Starting article ID */
  startId: number;
  /** Ending article ID */
  endId: number;
  /** Article IDs in batch */
  articleIds: number[];
}

/**
 * Request to start ingestion
 */
export interface StartIngestRequest {
  /** Wikipedia dump URL */
  dumpUrl: string;
  /** Output path prefix */
  outputPrefix?: string;
  /** Batch size */
  batchSize?: number;
  /** Skip redirects */
  skipRedirects?: boolean;
  /** Skip disambiguation */
  skipDisambiguation?: boolean;
  /** Generate embeddings */
  generateEmbeddings?: boolean;
  /** Embedding model */
  embeddingsModel?: 'bge-m3' | 'bge-base';
  /** Article limit */
  limit?: number;
}

/**
 * Response from starting ingestion
 */
export interface StartIngestResponse {
  /** Success indicator */
  success: boolean;
  /** Job ID */
  jobId: string;
  /** Status message */
  message: string;
  /** Current job state */
  state: IngestJobState;
}

/**
 * Response for job status
 */
export interface JobStatusResponse {
  /** Job state */
  state: IngestJobState;
  /** Progress percentage */
  progress: number;
  /** ETA in human-readable format */
  eta: string | null;
}

/**
 * Request to process a batch
 */
export interface ProcessBatchRequest {
  /** Job ID */
  jobId: string;
  /** Raw wikitext articles to process */
  articles: RawArticle[];
}

/**
 * Raw article data for batch processing
 */
export interface RawArticle {
  /** Article ID */
  id: number;
  /** Article title */
  title: string;
  /** Namespace */
  ns: number;
  /** Raw wikitext content */
  text: string;
  /** Timestamp */
  timestamp: string;
  /** Redirect target (if redirect) */
  redirect?: string;
}

/**
 * Response from batch processing
 */
export interface ProcessBatchResponse {
  /** Success indicator */
  success: boolean;
  /** Number of articles processed */
  processed: number;
  /** Number of articles skipped */
  skipped: number;
  /** Number of embeddings generated */
  embeddingsGenerated: number;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Errors encountered */
  errors: string[];
}

/**
 * Processed article record for storage
 */
export interface ArticleRecord {
  /** Article ID */
  $id: string;
  /** Article type */
  $type: ArticleType;
  /** Article title */
  title: string;
  /** Short description */
  description: string;
  /** Wikidata ID (if available) */
  wikidata_id: string | null;
  /** Latitude coordinate */
  coords_lat: number | null;
  /** Longitude coordinate */
  coords_lon: number | null;
  /** Infobox data */
  infobox: Record<string, unknown> | null;
  /** Full text content */
  content: string;
  /** Last update timestamp */
  updated_at: Date;
  /** Embedding vector */
  embedding?: number[];
  /** Embedding model used */
  embedding_model?: string;
}

/**
 * Parsed article from wtf-lite
 */
export interface ParsedArticle {
  /** Article title */
  title: string;
  /** Article ID */
  id: number;
  /** Plain text content */
  plaintext: string;
  /** Extracted infoboxes */
  infoboxes: ParsedInfobox[];
  /** Internal links */
  links: ParsedLink[];
  /** Categories */
  categories: string[];
  /** Is redirect page */
  isRedirect: boolean;
  /** Redirect target */
  redirectTarget?: string;
  /** Is disambiguation page */
  isDisambiguation: boolean;
  /** Article type classification */
  type: ArticleType;
  /** Timestamp */
  timestamp: string;
}

/**
 * Parsed infobox data
 */
export interface ParsedInfobox {
  /** Infobox type */
  type: string;
  /** Key-value data */
  data: Record<string, string>;
}

/**
 * Parsed link data
 */
export interface ParsedLink {
  /** Target page */
  page: string;
  /** Display text */
  text: string;
}

/**
 * API error response
 */
export interface APIError {
  /** Error type */
  error: string;
  /** Error message */
  message: string;
  /** HTTP status code */
  status: number;
  /** Additional details */
  details?: unknown;
}

/**
 * Health check response
 */
export interface HealthResponse {
  /** Service status */
  status: 'ok' | 'degraded' | 'down';
  /** Service name */
  service: string;
  /** Uptime in seconds */
  uptime: number;
  /** Active jobs count */
  activeJobs: number;
  /** Memory usage info */
  memory?: {
    heapUsed: number;
    heapTotal: number;
  };
}
