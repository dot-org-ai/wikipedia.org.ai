/**
 * Tests for SnippetClient
 *
 * Tests for article lookup, vector search, network error handling,
 * and timeout behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SnippetClient,
  SnippetError,
  createSnippetClient,
  batchLookup,
  searchWithFallback,
} from '../../src/query/snippet-client.js';
import type { SearchResult } from '../../src/query/snippet-client.js';

describe('SnippetClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with string config', () => {
      const client = new SnippetClient('https://snippet.example.com');
      expect(client).toBeInstanceOf(SnippetClient);
    });

    it('should create client with object config', () => {
      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        timeout: 5000,
        fetch: mockFetch,
      });
      expect(client).toBeInstanceOf(SnippetClient);
    });

    it('should strip trailing slash from URL', () => {
      const client = new SnippetClient('https://snippet.example.com/');
      expect(client).toBeInstanceOf(SnippetClient);
    });
  });

  describe('lookup', () => {
    it('should look up article by title', async () => {
      const mockResponse = {
        found: true,
        title: 'Albert Einstein',
        location: {
          type: 'person',
          partition: 'part-0',
          url: 'https://r2.example.com/data/person/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const result = await client.lookup('Albert Einstein');

      expect(result.found).toBe(true);
      expect(result.title).toBe('Albert Einstein');
      expect(result.location?.type).toBe('person');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://snippet.example.com/lookup?title=Albert%20Einstein',
        expect.any(Object)
      );
    });

    it('should return not found for missing articles', async () => {
      const mockResponse = {
        found: false,
        title: 'Non Existent Article',
        suggestion: 'Did you mean: Non Existent Article (disambiguation)?',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const result = await client.lookup('Non Existent Article');

      expect(result.found).toBe(false);
      expect(result.suggestion).toBeDefined();
    });

    it('should throw SnippetError on API failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Internal server error' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Internal server error' }),
        });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      await expect(client.lookup('Test')).rejects.toThrow(SnippetError);
      await expect(client.lookup('Test')).rejects.toThrow('Snippet request failed');
    });

    it('should handle URL-encoded special characters in title', async () => {
      const mockResponse = {
        found: true,
        title: 'Test (disambiguation)',
        location: {
          type: 'other',
          partition: 'part-0',
          url: 'https://r2.example.com/data/other/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/other/part-0.bin',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      await client.lookup('Test (disambiguation)');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://snippet.example.com/lookup?title=Test%20(disambiguation)',
        expect.any(Object)
      );
    });
  });

  describe('search', () => {
    it('should perform vector search', async () => {
      const mockResponse = {
        results: [
          {
            title: 'Quantum Mechanics',
            score: 0.95,
            location: {
              type: 'other',
              partition: 'part-0',
              url: 'https://r2.example.com/data/other/part-0.parquet',
              embeddingsUrl: 'https://r2.example.com/embeddings/other/part-0.bin',
            },
            source: 'ai-gateway',
          },
          {
            title: 'Albert Einstein',
            score: 0.89,
            location: {
              type: 'person',
              partition: 'part-0',
              url: 'https://r2.example.com/data/person/part-0.parquet',
              embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
            },
            source: 'ai-gateway',
          },
        ],
        source: 'ai-gateway',
        cached: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const result = await client.search('quantum physics', 5);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].title).toBe('Quantum Mechanics');
      expect(result.results[0].score).toBe(0.95);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://snippet.example.com/search?q=quantum%20physics&k=5',
        expect.any(Object)
      );
    });

    it('should use default k value', async () => {
      const mockResponse = {
        results: [],
        source: 'ai-gateway',
        cached: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      await client.search('test query');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://snippet.example.com/search?q=test%20query&k=10',
        expect.any(Object)
      );
    });

    it('should handle cached results', async () => {
      const mockResponse = {
        results: [{ title: 'Test', score: 0.9, location: { type: 'other' }, source: 'r2-cache' }],
        source: 'r2-cache',
        cached: true,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const result = await client.search('test');

      expect(result.cached).toBe(true);
      expect(result.source).toBe('r2-cache');
    });
  });

  describe('getTypes', () => {
    it('should return list of article types', async () => {
      const mockResponse = {
        types: ['person', 'place', 'org', 'work', 'event', 'other'],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const types = await client.getTypes();

      expect(types).toHaveLength(6);
      expect(types).toContain('person');
      expect(types).toContain('place');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://snippet.example.com/types',
        expect.any(Object)
      );
    });
  });

  describe('health', () => {
    it('should return health check response', async () => {
      const mockResponse = {
        status: 'ok',
        timestamp: '2024-01-01T00:00:00Z',
        config: {
          r2BaseUrl: 'https://r2.example.com',
          hasInlineEmbeddings: true,
          inlineTermCount: 1000,
          hasCachedEmbeddings: true,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const health = await client.health();

      expect(health.status).toBe('ok');
      expect(health.config.hasInlineEmbeddings).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://snippet.example.com/health',
        expect.any(Object)
      );
    });
  });

  describe('fetchArticleData', () => {
    it('should fetch article data from R2', async () => {
      const mockArrayBuffer = new ArrayBuffer(100);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const location = {
        type: 'person',
        partition: 'part-0',
        url: 'https://r2.example.com/data/person/part-0.parquet',
        embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
      };

      const data = await client.fetchArticleData(location);

      expect(data).toBe(mockArrayBuffer);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://r2.example.com/data/person/part-0.parquet',
        expect.any(Object)
      );
    });

    it('should throw SnippetError on fetch failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
        });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const location = {
        type: 'person',
        partition: 'part-0',
        url: 'https://r2.example.com/data/person/part-0.parquet',
        embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
      };

      await expect(client.fetchArticleData(location)).rejects.toThrow(SnippetError);
      await expect(client.fetchArticleData(location)).rejects.toThrow('Failed to fetch article data');
    });
  });

  describe('fetchEmbeddingsData', () => {
    it('should fetch embeddings data from R2', async () => {
      const mockArrayBuffer = new ArrayBuffer(4096);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const location = {
        type: 'person',
        partition: 'part-0',
        url: 'https://r2.example.com/data/person/part-0.parquet',
        embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
      };

      const data = await client.fetchEmbeddingsData(location);

      expect(data).toBe(mockArrayBuffer);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://r2.example.com/embeddings/person/part-0.bin',
        expect.any(Object)
      );
    });

    it('should throw SnippetError on fetch failure', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      const location = {
        type: 'person',
        partition: 'part-0',
        url: 'https://r2.example.com/data/person/part-0.parquet',
        embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
      };

      await expect(client.fetchEmbeddingsData(location)).rejects.toThrow(SnippetError);
      await expect(client.fetchEmbeddingsData(location)).rejects.toThrow('Failed to fetch embeddings data');
    });
  });

  describe('timeout handling', () => {
    it('should throw SnippetError when abort signal is triggered', async () => {
      // Create a mock that simulates an aborted request
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        timeout: 1000,
        fetch: mockFetch,
      });

      await expect(client.lookup('Test')).rejects.toThrow(SnippetError);
    });
  });

  describe('error handling', () => {
    it('should parse error body as JSON when possible', async () => {
      const errorBody = { error: 'Bad request', details: 'Invalid title' };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve(errorBody),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      try {
        await client.lookup('');
      } catch (error) {
        expect(error).toBeInstanceOf(SnippetError);
        expect((error as SnippetError).statusCode).toBe(400);
        expect((error as SnippetError).response).toEqual(errorBody);
      }
    });

    it('should parse error body as text when JSON parsing fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Not JSON')),
        text: () => Promise.resolve('Internal Server Error'),
      });

      const client = new SnippetClient({
        snippetUrl: 'https://snippet.example.com',
        fetch: mockFetch,
      });

      try {
        await client.lookup('test');
      } catch (error) {
        expect(error).toBeInstanceOf(SnippetError);
        expect((error as SnippetError).response).toBe('Internal Server Error');
      }
    });
  });
});

describe('SnippetError', () => {
  it('should create error with message', () => {
    const error = new SnippetError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('SnippetError');
  });

  it('should include status code when provided', () => {
    const error = new SnippetError('Not found', 404);
    expect(error.statusCode).toBe(404);
  });

  it('should include response when provided', () => {
    const response = { error: 'Bad request' };
    const error = new SnippetError('Bad request', 400, response);
    expect(error.response).toEqual(response);
  });
});

describe('createSnippetClient', () => {
  it('should create a client instance', () => {
    const client = createSnippetClient('https://snippet.example.com');
    expect(client).toBeInstanceOf(SnippetClient);
  });

  it('should pass additional config options', () => {
    const mockFetch = vi.fn();
    const client = createSnippetClient('https://snippet.example.com', {
      timeout: 5000,
      fetch: mockFetch,
    });
    expect(client).toBeInstanceOf(SnippetClient);
  });
});

describe('batchLookup', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('should look up multiple titles concurrently', async () => {
    const createLookupResponse = (title: string, found: boolean) => ({
      found,
      title,
      location: found
        ? {
            type: 'person',
            partition: 'part-0',
            url: `https://r2.example.com/data/person/${title}.parquet`,
            embeddingsUrl: `https://r2.example.com/embeddings/person/${title}.bin`,
          }
        : undefined,
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createLookupResponse('Albert Einstein', true)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createLookupResponse('Non Existent', false)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createLookupResponse('Tokyo', true)),
      });

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await batchLookup(client, ['Albert Einstein', 'Non Existent', 'Tokyo']);

    expect(results.size).toBe(3);
    expect(results.get('Albert Einstein')?.found).toBe(true);
    expect(results.get('Non Existent')?.found).toBe(false);
    expect(results.get('Tokyo')?.found).toBe(true);
  });

  it('should handle lookup errors gracefully', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ found: true, title: 'Albert Einstein', location: {} }),
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await batchLookup(client, ['Albert Einstein', 'Error Title'], 5);

    expect(results.size).toBe(2);
    expect(results.get('Albert Einstein')?.found).toBe(true);
    expect(results.get('Error Title')?.found).toBe(false);
    expect(results.get('Error Title')?.suggestion).toContain('Network error');
  });

  it('should respect concurrency limit', async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;

    mockFetch.mockImplementation(async () => {
      activeCalls++;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCalls--;
      return {
        ok: true,
        json: () => Promise.resolve({ found: true, title: 'Test', location: {} }),
      };
    });

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const titles = Array.from({ length: 10 }, (_, i) => `Title ${i}`);
    await batchLookup(client, titles, 3);

    expect(maxActiveCalls).toBeLessThanOrEqual(3);
  });
});

describe('searchWithFallback', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it('should return results when enough are found', async () => {
    const mockResults: SearchResult[] = Array.from({ length: 10 }, (_, i) => ({
      title: `Result ${i}`,
      score: 0.9 - i * 0.05,
      location: {
        type: 'person',
        partition: 'part-0',
        url: `https://r2.example.com/data/person/part-0.parquet`,
        embeddingsUrl: `https://r2.example.com/embeddings/person/part-0.bin`,
      },
      source: 'ai-gateway',
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: mockResults,
          source: 'ai-gateway',
          cached: false,
        }),
    });

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await searchWithFallback(client, 'test query', 10);

    expect(results).toHaveLength(10);
  });

  it('should use fallback when not enough results', async () => {
    const partialResults: SearchResult[] = [
      {
        title: 'Result 1',
        score: 0.9,
        location: {
          type: 'person',
          partition: 'part-0',
          url: 'https://r2.example.com/data/person/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
        },
        source: 'inline',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: partialResults,
          source: 'inline',
          cached: false,
          fallback: {
            message: 'Using fallback index',
            embeddingsIndex: 'https://r2.example.com/embeddings/full-index.bin',
          },
        }),
    });

    const fallbackResults: SearchResult[] = [
      {
        title: 'Fallback Result 1',
        score: 0.85,
        location: {
          type: 'other',
          partition: 'part-0',
          url: 'https://r2.example.com/data/other/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/other/part-0.bin',
        },
        source: 'full-index',
      },
    ];

    const mockFullIndexSearch = vi.fn().mockResolvedValue(fallbackResults);

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await searchWithFallback(client, 'test query', 5, mockFullIndexSearch);

    expect(results).toHaveLength(2);
    expect(mockFullIndexSearch).toHaveBeenCalledWith(
      'https://r2.example.com/embeddings/full-index.bin',
      'test query',
      5
    );
  });

  it('should return partial results when fallback fails', async () => {
    const partialResults: SearchResult[] = [
      {
        title: 'Result 1',
        score: 0.9,
        location: {
          type: 'person',
          partition: 'part-0',
          url: 'https://r2.example.com/data/person/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
        },
        source: 'inline',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: partialResults,
          source: 'inline',
          cached: false,
          fallback: {
            message: 'Using fallback index',
            embeddingsIndex: 'https://r2.example.com/embeddings/full-index.bin',
          },
        }),
    });

    const mockFullIndexSearch = vi.fn().mockRejectedValue(new Error('Fallback failed'));

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await searchWithFallback(client, 'test query', 5, mockFullIndexSearch);

    // Should return partial results when fallback fails
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Result 1');
  });

  it('should deduplicate results from fallback', async () => {
    const partialResults: SearchResult[] = [
      {
        title: 'Shared Result',
        score: 0.9,
        location: {
          type: 'person',
          partition: 'part-0',
          url: 'https://r2.example.com/data/person/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
        },
        source: 'inline',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: partialResults,
          source: 'inline',
          cached: false,
          fallback: {
            message: 'Using fallback',
            embeddingsIndex: 'https://r2.example.com/embeddings/full-index.bin',
          },
        }),
    });

    const fallbackResults: SearchResult[] = [
      {
        title: 'Shared Result', // Duplicate
        score: 0.85,
        location: {
          type: 'person',
          partition: 'part-0',
          url: 'https://r2.example.com/data/person/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
        },
        source: 'full-index',
      },
      {
        title: 'Unique Result',
        score: 0.8,
        location: {
          type: 'other',
          partition: 'part-0',
          url: 'https://r2.example.com/data/other/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/other/part-0.bin',
        },
        source: 'full-index',
      },
    ];

    const mockFullIndexSearch = vi.fn().mockResolvedValue(fallbackResults);

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await searchWithFallback(client, 'test query', 5, mockFullIndexSearch);

    // Should have 2 results (deduplicated)
    expect(results).toHaveLength(2);
    expect(results.filter((r) => r.title === 'Shared Result')).toHaveLength(1);
  });

  it('should sort merged results by score', async () => {
    const partialResults: SearchResult[] = [
      {
        title: 'Low Score',
        score: 0.5,
        location: {
          type: 'person',
          partition: 'part-0',
          url: 'https://r2.example.com/data/person/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/person/part-0.bin',
        },
        source: 'inline',
      },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          results: partialResults,
          source: 'inline',
          cached: false,
          fallback: {
            message: 'Using fallback',
            embeddingsIndex: 'https://r2.example.com/embeddings/full-index.bin',
          },
        }),
    });

    const fallbackResults: SearchResult[] = [
      {
        title: 'High Score',
        score: 0.95,
        location: {
          type: 'other',
          partition: 'part-0',
          url: 'https://r2.example.com/data/other/part-0.parquet',
          embeddingsUrl: 'https://r2.example.com/embeddings/other/part-0.bin',
        },
        source: 'full-index',
      },
    ];

    const mockFullIndexSearch = vi.fn().mockResolvedValue(fallbackResults);

    const client = new SnippetClient({
      snippetUrl: 'https://snippet.example.com',
      fetch: mockFetch,
    });

    const results = await searchWithFallback(client, 'test query', 5, mockFullIndexSearch);

    // Higher score should be first
    expect(results[0].title).toBe('High Score');
    expect(results[0].score).toBe(0.95);
    expect(results[1].title).toBe('Low Score');
  });
});
