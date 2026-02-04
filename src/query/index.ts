/**
 * Query module for Wikipedia search and lookup
 *
 * Provides clients for interacting with the Cloudflare Snippet API
 * and helper functions for common operations.
 *
 * For browser-only usage, import from './browser.js' instead.
 */

// Snippet API client
export {
  SnippetClient,
  SnippetError,
  createSnippetClient,
  batchLookup,
  searchWithFallback,
  type ArticleLocation,
  type LookupResponse,
  type SearchResult as SnippetSearchResult,
  type SearchResponse,
  type HealthResponse,
  type SnippetClientConfig,
} from './snippet-client.js';

// Browser client (HTTP Range + Parquet)
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
  Article,
  ArticleType,
  SearchResult,
  Relationship,
  AutocompleteResult,
  TitleIndex,
  TitleIndexEntry,
  TypeManifest,
  TypeManifestEntry,
  BloomFilter,
  BrowserClientConfig,
  QueryOptions,
  ParquetMetadata,
  RowGroupInfo,
  ColumnChunkInfo,
  SchemaElement,
  CacheEntry,
} from './browser-types.js';

// Constants
export { ARTICLE_TYPES } from './browser-types.js';
