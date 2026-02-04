/**
 * Client for calling the Cloudflare Snippet API
 *
 * Provides a typed interface for:
 * - Title lookup (get file location for an article)
 * - Vector search (find similar articles)
 * - Type listing (get available article types)
 * - Health check
 */

/**
 * Article location information returned by lookup
 */
export interface ArticleLocation {
  /** Article type (article, category, etc.) */
  type: string;
  /** Partition identifier */
  partition: string;
  /** URL to fetch the article data */
  url: string;
  /** URL to fetch the embeddings data */
  embeddingsUrl: string;
}

/**
 * Lookup response
 */
export interface LookupResponse {
  /** Whether the article was found */
  found: boolean;
  /** Canonical title */
  title: string;
  /** Location information (if found) */
  location?: ArticleLocation;
  /** Suggestion message (if not found) */
  suggestion?: string;
}

/**
 * Search result
 */
export interface SearchResult {
  /** Article title */
  title: string;
  /** Similarity score (0-1) */
  score: number;
  /** Article location */
  location: ArticleLocation;
  /** Source of the result (inline, r2-cache, ai-gateway) */
  source: string;
}

/**
 * Search response
 */
export interface SearchResponse {
  /** Search results */
  results: SearchResult[];
  /** Source used for search */
  source: string;
  /** Whether results came from cache */
  cached: boolean;
  /** Fallback information (if partial results) */
  fallback?: {
    message: string;
    embeddingsIndex: string;
  };
}

/**
 * Health check response
 */
export interface HealthResponse {
  /** Status (ok or error) */
  status: string;
  /** Timestamp */
  timestamp: string;
  /** Configuration info */
  config: {
    r2BaseUrl: string;
    hasInlineEmbeddings: boolean;
    inlineTermCount: number;
    hasCachedEmbeddings: boolean;
  };
}

/**
 * Snippet client configuration
 */
export interface SnippetClientConfig {
  /** Snippet URL */
  snippetUrl: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof fetch;
}

/**
 * Error thrown by snippet client
 */
export class SnippetError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown
  ) {
    super(message);
    this.name = 'SnippetError';
  }
}

/**
 * Client for the Cloudflare Snippet API
 */
export class SnippetClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly fetchFn: typeof fetch;

  /**
   * Create a new snippet client
   * @param config - Client configuration
   */
  constructor(config: SnippetClientConfig | string) {
    if (typeof config === 'string') {
      this.baseUrl = config.replace(/\/$/, '');
      this.timeout = 10_000;
      this.fetchFn = fetch;
    } else {
      this.baseUrl = config.snippetUrl.replace(/\/$/, '');
      this.timeout = config.timeout ?? 10_000;
      this.fetchFn = config.fetch ?? fetch;
    }
  }

  /**
   * Look up an article by title
   * Returns file location for the article if found
   *
   * @param title - Article title to look up
   * @returns Lookup response with location info
   */
  async lookup(title: string): Promise<LookupResponse> {
    const url = `${this.baseUrl}/lookup?title=${encodeURIComponent(title)}`;
    const response = await this.request<LookupResponse>(url);

    return response;
  }

  /**
   * Search for articles using vector similarity
   *
   * @param query - Search query
   * @param k - Number of results to return (default: 10)
   * @returns Search response with results
   */
  async search(query: string, k: number = 10): Promise<SearchResponse> {
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&k=${k}`;
    const response = await this.request<SearchResponse>(url);

    return response;
  }

  /**
   * Get list of available article types
   *
   * @returns Array of article type names
   */
  async getTypes(): Promise<string[]> {
    const url = `${this.baseUrl}/types`;
    const response = await this.request<{ types: string[] }>(url);

    return response.types;
  }

  /**
   * Check snippet health
   *
   * @returns Health check response
   */
  async health(): Promise<HealthResponse> {
    const url = `${this.baseUrl}/health`;
    const response = await this.request<HealthResponse>(url);

    return response;
  }

  /**
   * Fetch article data from R2 location
   *
   * @param location - Article location from lookup/search
   * @returns Article data as ArrayBuffer
   */
  async fetchArticleData(location: ArticleLocation): Promise<ArrayBuffer> {
    const response = await this.fetchWithTimeout(location.url);

    if (!response.ok) {
      throw new SnippetError(
        `Failed to fetch article data: ${response.status}`,
        response.status
      );
    }

    return response.arrayBuffer();
  }

  /**
   * Fetch embeddings data from R2 location
   *
   * @param location - Article location from lookup/search
   * @returns Embeddings data as ArrayBuffer
   */
  async fetchEmbeddingsData(location: ArticleLocation): Promise<ArrayBuffer> {
    const response = await this.fetchWithTimeout(location.embeddingsUrl);

    if (!response.ok) {
      throw new SnippetError(
        `Failed to fetch embeddings data: ${response.status}`,
        response.status
      );
    }

    return response.arrayBuffer();
  }

  /**
   * Make a request to the snippet API
   */
  private async request<T>(url: string): Promise<T> {
    const response = await this.fetchWithTimeout(url);

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text();
      }

      throw new SnippetError(
        `Snippet request failed: ${response.status}`,
        response.status,
        errorBody
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new SnippetError('Request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Create a snippet client
 *
 * @param snippetUrl - URL of the snippet endpoint
 * @param config - Optional additional configuration
 * @returns Snippet client instance
 */
export function createSnippetClient(
  snippetUrl: string,
  config?: Omit<SnippetClientConfig, 'snippetUrl'>
): SnippetClient {
  return new SnippetClient({
    snippetUrl,
    ...config,
  });
}

/**
 * Helper to batch multiple lookups efficiently
 *
 * @param client - Snippet client
 * @param titles - Titles to look up
 * @param concurrency - Maximum concurrent requests
 * @returns Map of title -> lookup response
 */
export async function batchLookup(
  client: SnippetClient,
  titles: string[],
  concurrency: number = 5
): Promise<Map<string, LookupResponse>> {
  const results = new Map<string, LookupResponse>();
  const queue = [...titles];

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const title = queue.shift();
      if (!title) break;

      try {
        const response = await client.lookup(title);
        results.set(title, response);
      } catch (error) {
        results.set(title, {
          found: false,
          title,
          suggestion: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Helper to perform search with automatic fallback to full index
 *
 * @param client - Snippet client
 * @param query - Search query
 * @param k - Number of results
 * @param fullIndexSearch - Optional function to search full index
 * @returns Search results
 */
export async function searchWithFallback(
  client: SnippetClient,
  query: string,
  k: number,
  fullIndexSearch?: (indexUrl: string, query: string, k: number) => Promise<SearchResult[]>
): Promise<SearchResult[]> {
  const response = await client.search(query, k);

  // If we got enough results from cache, return them
  if (response.results.length >= k || !response.fallback) {
    return response.results;
  }

  // If we have a fallback function and fallback info, use full index
  if (fullIndexSearch && response.fallback) {
    try {
      const fullResults = await fullIndexSearch(
        response.fallback.embeddingsIndex,
        query,
        k
      );

      // Merge and deduplicate results
      const seen = new Set(response.results.map((r) => r.title));
      const merged = [...response.results];

      for (const result of fullResults) {
        if (!seen.has(result.title)) {
          seen.add(result.title);
          merged.push(result);
        }
      }

      // Sort by score and take top k
      merged.sort((a, b) => b.score - a.score);
      return merged.slice(0, k);
    } catch (error) {
      console.warn('Full index search failed:', error);
    }
  }

  // Return partial results
  return response.results;
}
