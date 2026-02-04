/**
 * Tests for the WikipediaBrowserClient
 *
 * Tests for article fetching by title/ID, network error handling,
 * and client lifecycle management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WikipediaBrowserClient,
  WikipediaClientError,
  createWikipediaBrowserClient,
} from '../../src/query/browser-client.js';
import type { BrowserClientConfig } from '../../src/query/browser-types.js';

describe('WikipediaBrowserClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let config: BrowserClientConfig;

  beforeEach(() => {
    mockFetch = vi.fn();
    config = {
      cdnBaseUrl: 'https://cdn.example.com/wikipedia',
      indexCacheTTL: 60000,
      snippetUrl: 'https://snippet.example.com',
      useIndexedDB: false,
      fetch: mockFetch,
    };
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create a client with valid configuration', () => {
      const client = new WikipediaBrowserClient(config);
      expect(client).toBeInstanceOf(WikipediaBrowserClient);
    });

    it('should strip trailing slash from CDN URL', () => {
      const clientWithSlash = new WikipediaBrowserClient({
        ...config,
        cdnBaseUrl: 'https://cdn.example.com/wikipedia/',
      });
      expect(clientWithSlash).toBeInstanceOf(WikipediaBrowserClient);
    });

    it('should use default values for optional config', () => {
      const minimalConfig: BrowserClientConfig = {
        cdnBaseUrl: 'https://cdn.example.com',
      };
      const client = new WikipediaBrowserClient(minimalConfig);
      expect(client).toBeInstanceOf(WikipediaBrowserClient);
    });
  });

  describe('init', () => {
    it('should initialize by loading indexes', async () => {
      // Mock the title index and type manifest requests
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 'test': { file: 'test.parquet', rowGroup: 0, row: 0 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 'person': { type: 'person', count: 10, files: [] } }),
        });

      const client = new WikipediaBrowserClient(config);
      await client.init();

      // Should have made 2 requests for indexes
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw WikipediaClientError on initialization failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const client = new WikipediaBrowserClient(config);

      await expect(client.init()).rejects.toThrow(WikipediaClientError);
    });
  });

  describe('getArticle', () => {
    it('should return null when article title not found in index', async () => {
      // Mock empty title index
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const client = new WikipediaBrowserClient(config);
      const article = await client.getArticle('Non-existent Article');

      expect(article).toBeNull();
    });
  });

  describe('searchSimilar', () => {
    it('should throw error when snippet URL not configured', async () => {
      // Mock indexes
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const client = new WikipediaBrowserClient({
        ...config,
        snippetUrl: '',
      });

      await expect(client.searchSimilar('test query')).rejects.toThrow(WikipediaClientError);
    });

    it('should return search results from snippet API', async () => {
      // Mock indexes then search response
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [
              { title: 'Quantum Physics', score: 0.95, location: { type: 'other' } },
              { title: 'Albert Einstein', score: 0.89, location: { type: 'person' } },
            ],
          }),
        });

      const client = new WikipediaBrowserClient(config);
      const results = await client.searchSimilar('quantum mechanics', 5);

      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Quantum Physics');
      expect(results[0].score).toBe(0.95);
    });

    it('should throw WikipediaClientError on API failure', async () => {
      // Mock indexes then failed search
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });

      const client = new WikipediaBrowserClient(config);

      await expect(client.searchSimilar('test')).rejects.toThrow(WikipediaClientError);
    });

    it('should handle network errors', async () => {
      // Mock indexes then network error
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const client = new WikipediaBrowserClient(config);

      await expect(client.searchSimilar('test')).rejects.toThrow(WikipediaClientError);
    });
  });

  describe('titleExists', () => {
    it('should return true for existing title', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ 'albert_einstein': { file: 'test.parquet', rowGroup: 0, row: 0 } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const client = new WikipediaBrowserClient(config);
      const exists = await client.titleExists('Albert Einstein');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent title', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const client = new WikipediaBrowserClient(config);
      const exists = await client.titleExists('Non Existent Title');

      expect(exists).toBe(false);
    });
  });

  describe('autocomplete', () => {
    it('should return autocomplete suggestions', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            'albert_einstein': { file: 'test.parquet', rowGroup: 0, row: 0 },
            'albert_camus': { file: 'test.parquet', rowGroup: 0, row: 1 },
            'albert_brooks': { file: 'test.parquet', rowGroup: 0, row: 2 },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const client = new WikipediaBrowserClient(config);
      const suggestions = await client.autocomplete('Albert', 10);

      expect(suggestions).toHaveLength(3);
      expect(suggestions).toContain('albert_einstein');
    });
  });

  describe('getTypeCount', () => {
    it('should return count for article type', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            'person': { type: 'person', count: 42, files: [] },
          }),
        });

      const client = new WikipediaBrowserClient(config);
      const count = await client.getTypeCount('person');

      expect(count).toBe(42);
    });
  });

  describe('getTypeCounts', () => {
    it('should return counts for all article types', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            'person': { type: 'person', count: 100, files: [] },
            'place': { type: 'place', count: 50, files: [] },
            'org': { type: 'org', count: 30, files: [] },
          }),
        });

      const client = new WikipediaBrowserClient(config);
      const counts = await client.getTypeCounts();

      expect(counts.get('person')).toBe(100);
      expect(counts.get('place')).toBe(50);
      expect(counts.get('org')).toBe(30);
    });
  });

  describe('clearCache', () => {
    it('should clear all caches', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      const client = new WikipediaBrowserClient(config);
      await client.init();
      await client.clearCache();

      // After clearing, should be uninitialized
      const stats = client.getCacheStats();
      expect(stats.indexCache.titleIndex).toBe(false);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', () => {
      const client = new WikipediaBrowserClient(config);
      const stats = client.getCacheStats();

      expect(stats.readers).toBe(0);
      expect(stats.indexCache).toBeDefined();
    });
  });

  describe('close', () => {
    it('should release all resources', () => {
      const client = new WikipediaBrowserClient(config);
      expect(() => client.close()).not.toThrow();
    });
  });
});

describe('WikipediaClientError', () => {
  it('should create error with message and code', () => {
    const error = new WikipediaClientError('Test error', 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('WikipediaClientError');
  });

  it('should include cause when provided', () => {
    const cause = new Error('Original error');
    const error = new WikipediaClientError('Wrapped error', 'WRAPPED', cause);
    expect(error.cause).toBe(cause);
  });
});

describe('createWikipediaBrowserClient', () => {
  it('should create a client instance', () => {
    const client = createWikipediaBrowserClient({
      cdnBaseUrl: 'https://cdn.example.com',
    });
    expect(client).toBeInstanceOf(WikipediaBrowserClient);
  });
});
