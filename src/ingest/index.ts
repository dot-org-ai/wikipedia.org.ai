/**
 * Wikipedia ingestion pipeline
 *
 * Streaming components to download, decompress, and parse Wikipedia dumps
 * without disk I/O.
 *
 * @example
 * ```typescript
 * import { createIngestionPipeline } from 'wikipedia.org.ai/ingest';
 *
 * const pipeline = createIngestionPipeline(
 *   'https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2',
 *   { skipRedirects: true }
 * );
 *
 * for await (const article of pipeline) {
 *   console.log(article.title, article.type);
 * }
 * ```
 */

// Type exports
export type {
  WikiPage,
  Article,
  Infobox,
  WikiLink,
  ArticleType,
  CompressionType,
  DownloadProgress,
  DownloadOptions,
  PipelineStats,
  PipelineOptions,
  ClassifiedArticle,
  EmbeddingsConfig,
} from './types.js';

// Download
export {
  streamDownload,
  getContentLength,
  supportsRangeRequests,
} from './download.js';

// Decompression
export {
  createDecompressor,
  detectCompressionFromExtension,
} from './decompress.js';

// XML parsing
export {
  createWikipediaParser,
  createNamespaceFilter,
  createPageCounter,
} from './parse-xml.js';

// Wikitext parsing
export {
  parseWikitext,
  createWikitextParser,
  getArticleSummary,
  extractInfoboxData,
} from './parse-wiki.js';

// Classification
export {
  classifyArticle,
  createClassifier,
  getClassificationConfidence,
  getClassificationScores,
} from './classify.js';

// Pipeline
export {
  createIngestionPipeline,
  createIngestionStream,
  batchArticles,
  collectPipelineStats,
  filterByType,
  takeArticles,
  mapArticles,
} from './pipeline.js';

// Pipeline with embeddings
export {
  createEmbeddingsPipeline,
  addEmbeddingsToArticles,
  withEmbeddings,
  type ArticleWithEmbedding,
  type EnhancedPipelineStats,
  type EmbeddingsPipelineOptions,
} from './pipeline-with-embeddings.js';
