/**
 * Embeddings module exports
 *
 * Provides embedding generation, caching, and storage for Wikipedia articles.
 *
 * Key features:
 * - Pre-computed embedding lookup table for free lookups (6M+ terms)
 * - AI Gateway integration for cache misses
 * - Term normalization for consistent caching
 * - Lance format storage for vector embeddings
 */

// Types
export type {
  Article,
  ArticleType,
  BatchResult,
  Checkpoint,
  EmbeddingModel,
  EmbeddingRecord,
  EmbeddingRequest,
  EmbeddingResponse,
  LanceWriterConfig,
  ModelStats,
  ProcessingError,
  ProcessorConfig,
  ProgressCallback,
  ProgressInfo,
  AIGatewayConfig,
} from './types.js';

export { CF_MODEL_IDS, MODEL_DIMENSIONS, ARTICLE_TYPES } from './types.js';

// AI Gateway client (with lookup table support)
export {
  AIGatewayClient,
  AIGatewayError,
  createAIGatewayClient,
  createAIGatewayClientWithLookup,
  type AIGatewayClientConfig,
} from './ai-gateway.js';

// Embedding lookup table (pre-computed embeddings)
export {
  EmbeddingLookupTable,
  createLookupTable,
  type EmbeddingLookup,
  type EmbeddingSource,
  type LookupTableConfig,
} from './lookup-table.js';

// Lookup table builder
export {
  LookupBuilder,
  IncrementalLookupBuilder,
  createLookupBuilder,
  buildLookupTableFromWikipedia,
  type LookupBuilderConfig,
  type BuildProgress,
} from './lookup-builder.js';

// Term normalizer
export {
  normalizeTerm,
  generateCacheKey,
  hashString,
  generateBloomHashes,
  generateVariants,
  termsMatch,
  levenshteinDistance,
  termSimilarity,
  normalizeTermsBatch,
  extractTerms,
  type NormalizationOptions,
} from './term-normalizer.js';

// Lance writer (enhanced with IVF-PQ indexing)
export {
  LanceWriter,
  createLanceWriter,
  type EmbeddingRecord as LanceEmbeddingRecord,
  type IVFPQConfig,
  type LanceWriterConfig as EnhancedLanceWriterConfig,
} from './lance-writer.js';

// Lance reader (with HTTP Range support)
export {
  LanceReader,
  createLanceReader,
  type SearchResult,
  type SearchFilter,
  type IVFPQSearchConfig,
  type RangeFetchOptions,
  type EmbeddingRecord as LanceReaderEmbeddingRecord,
} from './lance-reader.js';

// Vector search (high-level API)
export {
  VectorSearch,
  createVectorSearch,
  RemoteVectorSearch,
  createRemoteVectorSearch,
  type VectorSearchConfig,
  type SearchOptions,
  type VectorSearchResult,
  type SearchStats,
} from './vector-search.js';

// Main processor
export { EmbeddingProcessor, createProcessor } from './processor.js';

// HTTP Client for embeddings.workers.do API
export {
  EmbeddingsClient,
  createEmbeddingsClient,
  type EmbeddingsClientConfig,
  type EmbeddingsApiModel,
  type EmbeddingsApiResponse,
  type EmbeddingsApiError,
  type EmbeddingsClientStats,
} from './client.js';
