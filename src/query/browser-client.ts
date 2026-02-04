// @ts-nocheck - Complex async operations with IndexedDB and optional property types
/**
 * Browser-compatible client for querying Wikipedia data
 *
 * Uses HTTP Range requests to efficiently read Parquet files from a CDN,
 * enabling fast article lookups and searches without downloading entire files.
 */

import type {
  Article,
  ArticleType,
  BrowserClientConfig,
  QueryOptions,
  Relationship,
  SearchResult,
} from './browser-types.js';
import { HttpParquetReader, HttpParquetError } from './http-parquet.js';
import { IndexLoader } from './index-loader.js';
import { LRUCache } from '../lib/lru-cache.js';

/**
 * Error thrown by the browser client
 */
export class WikipediaClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'WikipediaClientError';
  }
}

/**
 * Raw article record from Parquet file
 */
interface ArticleRecord {
  $id: string;
  $type: string;
  title: string;
  description: string;
  wikidata_id: string | null;
  coords_lat: number | null;
  coords_lon: number | null;
  infobox: Record<string, unknown> | null;
  content: string;
  updated_at: number;
}

/**
 * Raw forward relationship record from Parquet file
 */
interface ForwardRelRecord {
  from_id: string;
  predicate: string;
  to_id: string;
  to_title: string;
}

/**
 * Raw reverse relationship record from Parquet file
 */
interface ReverseRelRecord {
  to_id: string;
  reverse_predicate: string;
  from_id: string;
  from_title: string;
}

/**
 * Browser-compatible Wikipedia query client
 *
 * Provides efficient access to Wikipedia data stored in Parquet format on a CDN.
 * Uses HTTP Range requests to minimize bandwidth by only fetching needed data.
 */
/** Maximum number of cached Parquet readers */
const MAX_READER_CACHE_SIZE = 50;

export class WikipediaBrowserClient {
  private readonly config: Required<Omit<BrowserClientConfig, 'fetch'>> & { fetch?: typeof fetch };
  private readonly indexLoader: IndexLoader;
  private readonly readerCache: LRUCache<string, HttpParquetReader>;
  private initialized = false;

  /**
   * Create a new Wikipedia browser client
   *
   * @param config - Client configuration
   */
  constructor(config: BrowserClientConfig) {
    this.config = {
      cdnBaseUrl: config.cdnBaseUrl.replace(/\/$/, ''),
      indexCacheTTL: config.indexCacheTTL ?? 5 * 60 * 1000,
      snippetUrl: config.snippetUrl ?? '',
      useIndexedDB: config.useIndexedDB ?? true,
      dbName: config.dbName ?? 'wikipedia-browser-client',
      fetch: config.fetch,
    };

    this.indexLoader = new IndexLoader(this.config.cdnBaseUrl, {
      fetch: this.config.fetch,
      cacheTTL: this.config.indexCacheTTL,
      useIndexedDB: this.config.useIndexedDB,
      dbName: this.config.dbName,
    });

    // Initialize reader cache with LRU eviction and cleanup callback
    this.readerCache = new LRUCache<string, HttpParquetReader>({
      maxSize: MAX_READER_CACHE_SIZE,
      onEvict: (_key, reader) => reader.clearCache(),
    });
  }

  /**
   * Initialize the client by loading indexes
   *
   * This preloads the title index and type manifest for faster subsequent queries.
   * Called automatically on first query if not called explicitly.
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Preload indexes in parallel
      await Promise.all([
        this.indexLoader.getTitleIndex(),
        this.indexLoader.getTypeManifest(),
      ]);

      this.initialized = true;
    } catch (error) {
      throw new WikipediaClientError(
        'Failed to initialize client',
        'INIT_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Ensure the client is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Get or create a Parquet reader for a file
   */
  private getReader(file: string): HttpParquetReader {
    const normalizedFile = file.replace(/^\//, '');

    let reader = this.readerCache.get(normalizedFile);
    if (!reader) {
      const url = `${this.config.cdnBaseUrl}/${normalizedFile}`;
      reader = new HttpParquetReader(url, {
        fetch: this.config.fetch,
      });
      this.readerCache.set(normalizedFile, reader);
    }

    return reader;
  }

  /**
   * Convert raw article record to Article interface
   */
  private recordToArticle(record: ArticleRecord): Article {
    return {
      id: record.$id,
      type: record.$type as ArticleType,
      title: record.title,
      description: record.description,
      wikidataId: record.wikidata_id,
      coords:
        record.coords_lat !== null && record.coords_lon !== null
          ? { lat: record.coords_lat, lon: record.coords_lon }
          : null,
      infobox: record.infobox,
      content: record.content,
      updatedAt: new Date(record.updated_at),
    };
  }

  /**
   * Get an article by title
   *
   * @param title - Article title to look up
   * @returns Article if found, null otherwise
   */
  async getArticle(title: string): Promise<Article | null> {
    await this.ensureInitialized();

    // Look up title in index
    const location = await this.indexLoader.lookupTitle(title);
    if (!location) {
      return null;
    }

    try {
      // Read the specific row from the Parquet file
      const reader = this.getReader(location.file);
      const record = await reader.readRow<ArticleRecord>(
        location.rowGroup,
        location.row
      );

      if (!record) {
        return null;
      }

      return this.recordToArticle(record);
    } catch (error) {
      if (error instanceof HttpParquetError) {
        throw new WikipediaClientError(
          `Failed to read article: ${error.message}`,
          'READ_FAILED',
          error
        );
      }
      throw error;
    }
  }

  /**
   * Get an article by ID
   *
   * @param id - Article ID (ULID)
   * @returns Article if found, null otherwise
   */
  async getArticleById(id: string): Promise<Article | null> {
    await this.ensureInitialized();

    // We need to search through type partitions to find the article
    // This is less efficient than lookup by title
    const manifest = await this.indexLoader.getTypeManifest();

    for (const [_type, entry] of manifest) {
      for (const file of entry.files) {
        const reader = this.getReader(file);

        try {
          // Stream through the file looking for the ID
          for await (const record of reader.streamRows<ArticleRecord>({
            columns: ['$id', '$type', 'title', 'description', 'wikidata_id', 'coords_lat', 'coords_lon', 'infobox', 'content', 'updated_at'],
            batchSize: 100,
          })) {
            if (record.$id === id) {
              return this.recordToArticle(record);
            }
          }
        } catch (error) {
          // Continue searching other files
          console.warn(`Error reading file ${file}:`, error);
        }
      }
    }

    return null;
  }

  /**
   * Get articles by type
   *
   * @param type - Article type to filter by
   * @param options - Query options (limit, offset)
   * @returns Array of articles
   */
  async getArticlesByType(
    type: ArticleType,
    options?: QueryOptions
  ): Promise<Article[]> {
    await this.ensureInitialized();

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const columns = options?.columns ?? [
      '$id', '$type', 'title', 'description', 'wikidata_id',
      'coords_lat', 'coords_lon', 'infobox', 'content', 'updated_at',
    ];

    const files = await this.indexLoader.getFilesForType(type);
    if (files.length === 0) {
      return [];
    }

    const articles: Article[] = [];
    let skipped = 0;

    for (const file of files) {
      if (articles.length >= limit) {
        break;
      }

      const reader = this.getReader(file);

      try {
        for await (const record of reader.streamRows<ArticleRecord>({
          columns,
          batchSize: Math.min(limit - articles.length + 100, 1000),
        })) {
          // Handle offset
          if (skipped < offset) {
            skipped++;
            continue;
          }

          articles.push(this.recordToArticle(record));

          if (articles.length >= limit) {
            break;
          }
        }
      } catch (error) {
        console.warn(`Error reading file ${file}:`, error);
      }
    }

    return articles;
  }

  /**
   * Search for similar articles using vector similarity
   *
   * This method calls the snippet API endpoint for vector search,
   * as embeddings are not stored in the Parquet files accessible via CDN.
   *
   * @param query - Search query text
   * @param k - Number of results to return (default: 10)
   * @returns Array of search results with scores
   */
  async searchSimilar(query: string, k: number = 10): Promise<SearchResult[]> {
    await this.ensureInitialized();

    if (!this.config.snippetUrl) {
      throw new WikipediaClientError(
        'Snippet URL not configured for vector search',
        'NO_SNIPPET_URL'
      );
    }

    const url = `${this.config.snippetUrl}/search?q=${encodeURIComponent(query)}&k=${k}`;
    const fetchFn = this.config.fetch ?? fetch;

    try {
      const response = await fetchFn(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new WikipediaClientError(
          `Search request failed: ${response.status}`,
          'SEARCH_FAILED'
        );
      }

      interface SnippetSearchResult {
        title: string;
        score: number;
        location: {
          type: string;
        };
      }

      interface SnippetSearchResponse {
        results: SnippetSearchResult[];
      }

      const data: SnippetSearchResponse = await response.json();

      return data.results.map((r) => ({
        id: '', // ID not returned by snippet API
        title: r.title,
        type: r.location.type as ArticleType,
        score: r.score,
      }));
    } catch (error) {
      if (error instanceof WikipediaClientError) {
        throw error;
      }
      throw new WikipediaClientError(
        'Vector search failed',
        'SEARCH_FAILED',
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Get relationships for an article
   *
   * @param articleId - Article ID
   * @param direction - 'outgoing' for links from this article, 'incoming' for links to this article
   * @returns Array of relationships
   */
  async getRelationships(
    articleId: string,
    direction: 'outgoing' | 'incoming'
  ): Promise<Relationship[]> {
    await this.ensureInitialized();

    const relationships: Relationship[] = [];

    if (direction === 'outgoing') {
      // Read forward relationships
      const forwardFile = `data/relationships/forward/${articleId.substring(0, 2)}.parquet`;
      const reader = this.getReader(forwardFile);

      try {
        for await (const record of reader.streamRows<ForwardRelRecord>({
          columns: ['from_id', 'predicate', 'to_id', 'to_title'],
          batchSize: 100,
        })) {
          if (record.from_id === articleId) {
            relationships.push({
              fromId: record.from_id,
              fromTitle: '', // Not available in forward relationships
              toId: record.to_id,
              toTitle: record.to_title,
              predicate: record.predicate,
            });
          }
        }
      } catch (error) {
        // File may not exist for this prefix
        if (!(error instanceof HttpParquetError && error.statusCode === 404)) {
          console.warn(`Error reading forward relationships:`, error);
        }
      }
    } else {
      // Read reverse relationships
      const reverseFile = `data/relationships/reverse/${articleId.substring(0, 2)}.parquet`;
      const reader = this.getReader(reverseFile);

      try {
        for await (const record of reader.streamRows<ReverseRelRecord>({
          columns: ['to_id', 'reverse_predicate', 'from_id', 'from_title'],
          batchSize: 100,
        })) {
          if (record.to_id === articleId) {
            relationships.push({
              fromId: record.from_id,
              fromTitle: record.from_title,
              toId: record.to_id,
              toTitle: '', // Not available in reverse relationships
              predicate: record.reverse_predicate,
            });
          }
        }
      } catch (error) {
        // File may not exist for this prefix
        if (!(error instanceof HttpParquetError && error.statusCode === 404)) {
          console.warn(`Error reading reverse relationships:`, error);
        }
      }
    }

    return relationships;
  }

  /**
   * Get autocomplete suggestions for a title prefix
   *
   * @param prefix - Title prefix to search
   * @param limit - Maximum number of suggestions (default: 10)
   * @returns Array of matching titles
   */
  async autocomplete(prefix: string, limit: number = 10): Promise<string[]> {
    await this.ensureInitialized();

    return this.indexLoader.getAutocompleteSuggestions(prefix, limit);
  }

  /**
   * Check if a title exists
   *
   * @param title - Article title to check
   * @returns True if the article exists
   */
  async titleExists(title: string): Promise<boolean> {
    await this.ensureInitialized();

    return this.indexLoader.titleExists(title);
  }

  /**
   * Get the count of articles for a type
   *
   * @param type - Article type
   * @returns Number of articles of this type
   */
  async getTypeCount(type: ArticleType): Promise<number> {
    await this.ensureInitialized();

    return this.indexLoader.getTypeCount(type);
  }

  /**
   * Get all available article types with their counts
   *
   * @returns Map of article types to counts
   */
  async getTypeCounts(): Promise<Map<ArticleType, number>> {
    await this.ensureInitialized();

    const manifest = await this.indexLoader.getTypeManifest();
    const counts = new Map<ArticleType, number>();

    for (const [type, entry] of manifest) {
      counts.set(type, entry.count);
    }

    return counts;
  }

  /**
   * Get multiple articles by their titles (batch lookup)
   *
   * @param titles - Array of article titles
   * @param options - Query options
   * @returns Map of title to article (or null if not found)
   */
  async getArticles(
    titles: string[],
    options?: { concurrency?: number }
  ): Promise<Map<string, Article | null>> {
    await this.ensureInitialized();

    const concurrency = options?.concurrency ?? 5;
    const results = new Map<string, Article | null>();
    const queue = [...titles];

    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const title = queue.shift();
        if (!title) break;

        try {
          const article = await this.getArticle(title);
          results.set(title, article);
        } catch (error) {
          console.warn(`Failed to get article "${title}":`, error);
          results.set(title, null);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Search articles with text matching (basic substring search)
   *
   * For vector similarity search, use searchSimilar() instead.
   *
   * @param query - Text to search for
   * @param options - Search options
   * @returns Array of matching articles
   */
  async searchText(
    query: string,
    options?: {
      type?: ArticleType;
      limit?: number;
      searchContent?: boolean;
    }
  ): Promise<Article[]> {
    await this.ensureInitialized();

    const limit = options?.limit ?? 20;
    const searchContent = options?.searchContent ?? false;
    const normalizedQuery = query.toLowerCase();

    const results: Article[] = [];
    const manifest = await this.indexLoader.getTypeManifest();

    // Determine which types to search
    const typesToSearch = options?.type
      ? [options.type]
      : Array.from(manifest.keys());

    for (const type of typesToSearch) {
      if (results.length >= limit) {
        break;
      }

      const files = await this.indexLoader.getFilesForType(type);

      for (const file of files) {
        if (results.length >= limit) {
          break;
        }

        const reader = this.getReader(file);
        const columns = searchContent
          ? ['$id', '$type', 'title', 'description', 'wikidata_id', 'coords_lat', 'coords_lon', 'infobox', 'content', 'updated_at']
          : ['$id', '$type', 'title', 'description', 'wikidata_id', 'coords_lat', 'coords_lon', 'infobox', 'updated_at'];

        try {
          for await (const record of reader.streamRows<ArticleRecord>({
            columns,
            batchSize: 100,
          })) {
            const matchesTitle = record.title.toLowerCase().includes(normalizedQuery);
            const matchesDescription = record.description.toLowerCase().includes(normalizedQuery);
            const matchesContent = searchContent && record.content?.toLowerCase().includes(normalizedQuery);

            if (matchesTitle || matchesDescription || matchesContent) {
              results.push(this.recordToArticle(record));

              if (results.length >= limit) {
                break;
              }
            }
          }
        } catch (error) {
          console.warn(`Error searching file ${file}:`, error);
        }
      }
    }

    return results;
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    // Clear reader cache
    for (const reader of this.readerCache.values()) {
      reader.clearCache();
    }
    this.readerCache.clear();

    // Clear index cache
    await this.indexLoader.clearCache();

    this.initialized = false;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    readers: number;
    indexCache: { titleIndex: boolean; typeManifest: boolean; bloomFilters: number };
  } {
    return {
      readers: this.readerCache.size,
      indexCache: this.indexLoader.getCacheStats(),
    };
  }

  /**
   * Close the client and release resources
   */
  close(): void {
    for (const reader of this.readerCache.values()) {
      reader.clearCache();
    }
    this.readerCache.clear();
    this.indexLoader.close();
    this.initialized = false;
  }
}

/**
 * Create a Wikipedia browser client
 *
 * @param config - Client configuration
 * @returns WikipediaBrowserClient instance
 */
export function createWikipediaBrowserClient(
  config: BrowserClientConfig
): WikipediaBrowserClient {
  return new WikipediaBrowserClient(config);
}
