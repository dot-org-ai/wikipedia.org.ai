/**
 * Type definitions for the embedding processor
 */

// Re-export shared types for convenience
export { ARTICLE_TYPES } from '../shared/types.js';
export type { ArticleType } from '../shared/types.js';
import type { ArticleType } from '../shared/types.js';

/** Supported embedding model identifiers */
export type EmbeddingModel = 'bge-m3' | 'bge-base' | 'bge-large' | 'gemma' | 'gemma300';

/** Cloudflare AI model IDs */
export const CF_MODEL_IDS: Record<EmbeddingModel, string> = {
  'bge-m3': '@cf/baai/bge-m3',
  'bge-base': '@cf/baai/bge-base-en-v1.5',
  'bge-large': '@cf/baai/bge-large-en-v1.5',
  'gemma': '@cf/google/gemma-7b-it-lora',
  'gemma300': '@cf/google/embeddinggemma-300m',
} as const;

/** Model embedding dimensions */
export const MODEL_DIMENSIONS: Record<EmbeddingModel, number> = {
  'bge-m3': 1024,
  'bge-base': 768,
  'bge-large': 1024,
  'gemma': 768,
  'gemma300': 768, // EmbeddingGemma-300M uses 768-dimensional embeddings
} as const;

/** Default embedding models for multi-model ingestion */
export const DEFAULT_EMBEDDING_MODELS: EmbeddingModel[] = ['bge-m3'] as const;

/** Check if a model is a dedicated embedding model (vs text generation) */
export function isEmbeddingModel(model: EmbeddingModel): boolean {
  // These models are specifically designed for embedding generation
  return ['bge-m3', 'bge-base', 'bge-large', 'gemma300'].includes(model);
}

/** Input article structure */
export interface Article {
  /** Unique Wikipedia article ID */
  id: string;
  /** Article title */
  title: string;
  /** Article content (plain text) */
  content: string;
  /** Article type for partitioning */
  type: ArticleType;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/** Generated embedding record */
export interface EmbeddingRecord {
  /** Article ID (or article_id + chunk_index for chunked embeddings) */
  id: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Chunk index within article (0 for single-chunk articles) */
  chunk_index?: number;
  /** Preview of the text content (first 200 chars) */
  text_preview?: string;
  /** Embedding vector */
  embedding: Float32Array;
  /** Model used to generate embedding */
  model: EmbeddingModel;
  /** Creation timestamp (ISO 8601) */
  created_at: string;
}

/** Checkpoint for resumable processing */
export interface Checkpoint {
  /** Last successfully processed article ID */
  lastProcessedId: string;
  /** Total articles processed so far */
  totalProcessed: number;
  /** Processing start time */
  startedAt: string;
  /** Last checkpoint update time */
  updatedAt: string;
  /** Current batch number */
  batchNumber: number;
  /** Errors encountered (limited to last 100) */
  errors: ProcessingError[];
  /** Per-model statistics */
  modelStats: Record<EmbeddingModel, ModelStats>;
}

/** Model processing statistics */
export interface ModelStats {
  /** Total embeddings generated */
  count: number;
  /** Total tokens processed (if available) */
  tokens: number;
  /** Average embedding time in ms */
  avgTimeMs: number;
  /** Cache hit count */
  cacheHits: number;
}

/** Processing error record */
export interface ProcessingError {
  /** Article ID that failed */
  articleId: string;
  /** Error message */
  message: string;
  /** Error timestamp */
  timestamp: string;
  /** Retry count */
  retryCount: number;
}

/** Processor configuration */
export interface ProcessorConfig {
  /** AI Gateway URL for embedding calls */
  aiGatewayUrl: string;
  /** R2 mount path for output files */
  r2MountPath: string;
  /** Models to generate embeddings for */
  models: EmbeddingModel[];
  /** Maximum batch size (default: 100) */
  batchSize?: number;
  /** Checkpoint interval in articles (default: 1000) */
  checkpointInterval?: number;
  /** Maximum retries per article (default: 3) */
  maxRetries?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Account ID for AI Gateway */
  accountId?: string;
  /** Optional logger instance for dependency injection (testing) */
  logger?: import('../lib/logger.js').Logger | undefined;
}

/** AI Gateway configuration */
export interface AIGatewayConfig {
  /** Base URL for AI Gateway */
  baseUrl: string;
  /** Account ID */
  accountId?: string;
  /** Gateway ID */
  gatewayId?: string;
  /** API Token for direct Workers AI access */
  apiToken?: string;
  /** Request timeout in ms */
  timeout: number;
  /** Maximum retries */
  maxRetries: number;
  /** Retry delay base in ms */
  retryDelayMs: number;
}

/** Embedding request to AI Gateway */
export interface EmbeddingRequest {
  /** Model identifier */
  model: EmbeddingModel;
  /** Texts to embed */
  texts: string[];
}

/** Embedding response from AI Gateway */
export interface EmbeddingResponse {
  /** Generated embeddings */
  embeddings: number[][];
  /** Whether result was cached */
  cached: boolean;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Model used */
  model: EmbeddingModel;
}

/** Lance writer configuration */
export interface LanceWriterConfig {
  /** Output directory path */
  outputPath: string;
  /** Flush buffer size (default: 1000) */
  flushSize?: number;
  /** Whether to partition by article type */
  partitionByType?: boolean;
}

/** Progress callback for tracking */
export type ProgressCallback = (progress: ProgressInfo) => void;

/** Progress information */
export interface ProgressInfo {
  /** Current article being processed */
  currentArticle: string;
  /** Articles processed in current batch */
  processedInBatch: number;
  /** Total articles processed */
  totalProcessed: number;
  /** Estimated articles remaining (if known) */
  remaining?: number;
  /** Processing rate (articles per second) */
  rate: number;
  /** Current batch number */
  batchNumber: number;
  /** Errors in current batch */
  errorsInBatch: number;
}

/** Batch processing result */
export interface BatchResult {
  /** Number of articles successfully processed */
  success: number;
  /** Number of articles that failed */
  failed: number;
  /** Processing time in ms */
  timeMs: number;
  /** Error details for failures */
  errors: ProcessingError[];
}
