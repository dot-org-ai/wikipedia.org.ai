/**
 * Browser entry point for Wikipedia query client
 *
 * This module re-exports only browser-safe code with no Node.js dependencies.
 * Use this entry point for browser/web applications.
 *
 * @example
 * ```typescript
 * import { WikipediaBrowserClient } from 'wikipedia.org.ai/query/browser';
 *
 * const client = new WikipediaBrowserClient({
 *   cdnBaseUrl: 'https://cdn.workers.do/wikipedia',
 *   snippetUrl: 'https://wiki.workers.do/snippet',
 * });
 *
 * await client.init();
 *
 * // Look up an article
 * const article = await client.getArticle('Albert Einstein');
 *
 * // Search for similar articles
 * const results = await client.searchSimilar('quantum physics', 10);
 *
 * // Get articles by type
 * const people = await client.getArticlesByType('person', { limit: 50 });
 *
 * // Autocomplete
 * const suggestions = await client.autocomplete('Einst', 5);
 * ```
 */

// Main client
export {
  WikipediaBrowserClient,
  WikipediaClientError,
  createWikipediaBrowserClient,
} from './browser-client.js';

// HTTP Parquet reader
export {
  HttpParquetReader,
  HttpParquetError,
  createHttpParquetReader,
} from './http-parquet.js';

// Index loader
export {
  IndexLoader,
  IndexLoadError,
  createIndexLoader,
} from './index-loader.js';

// Types
export type {
  // Core types
  Article,
  ArticleType,
  SearchResult,
  Relationship,
  AutocompleteResult,

  // Index types
  TitleIndex,
  TitleIndexEntry,
  TypeManifest,
  TypeManifestEntry,
  BloomFilter,

  // Configuration
  BrowserClientConfig,
  QueryOptions,

  // Parquet types
  ParquetMetadata,
  RowGroupInfo,
  ColumnChunkInfo,
  SchemaElement,

  // Cache types
  CacheEntry,
} from './browser-types.js';

// Constants
export { ARTICLE_TYPES } from './browser-types.js';
