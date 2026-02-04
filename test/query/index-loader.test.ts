/**
 * Tests for IndexLoader
 *
 * Tests for index caching, bloom filter loading, title lookup,
 * and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  IndexLoader,
  IndexLoadError,
  createIndexLoader,
} from '../../src/query/index-loader.js';

describe('IndexLoader', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create loader with base URL', () => {
      const loader = new IndexLoader('https://cdn.example.com/wikipedia', {
        fetch: mockFetch,
        useIndexedDB: false,
      });
      expect(loader).toBeInstanceOf(IndexLoader);
    });

    it('should strip trailing slash from base URL', () => {
      const loader = new IndexLoader('https://cdn.example.com/wikipedia/', {
        fetch: mockFetch,
        useIndexedDB: false,
      });
      expect(loader).toBeInstanceOf(IndexLoader);
    });

    it('should use default cache TTL when not specified', () => {
      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });
      expect(loader).toBeInstanceOf(IndexLoader);
    });

    it('should accept custom cache TTL', () => {
      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        cacheTTL: 10 * 60 * 1000, // 10 minutes
        useIndexedDB: false,
      });
      expect(loader).toBeInstanceOf(IndexLoader);
    });
  });

  describe('getTitleIndex', () => {
    it('should fetch and return title index', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
        'tokyo': { file: 'data/place/part-0.parquet', rowGroup: 0, row: 10 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const index = await loader.getTitleIndex();

      expect(index).toBeInstanceOf(Map);
      expect(index.get('albert_einstein')).toEqual({
        file: 'data/person/part-0.parquet',
        rowGroup: 0,
        row: 5,
      });
      expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/indexes/titles.json');
    });

    it('should cache title index in memory', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await loader.getTitleIndex();
      await loader.getTitleIndex();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw IndexLoadError when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await expect(loader.getTitleIndex()).rejects.toThrow(IndexLoadError);
    });
  });

  describe('getTypeManifest', () => {
    it('should fetch and return type manifest', async () => {
      const mockManifest = {
        person: { type: 'person', count: 100, files: ['data/person/part-0.parquet'] },
        place: { type: 'place', count: 50, files: ['data/place/part-0.parquet'] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const manifest = await loader.getTypeManifest();

      expect(manifest).toBeInstanceOf(Map);
      expect(manifest.get('person')).toEqual({
        type: 'person',
        count: 100,
        files: ['data/person/part-0.parquet'],
      });
      expect(mockFetch).toHaveBeenCalledWith('https://cdn.example.com/indexes/types.json');
    });

    it('should cache type manifest in memory', async () => {
      const mockManifest = {
        person: { type: 'person', count: 100, files: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await loader.getTypeManifest();
      await loader.getTypeManifest();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw IndexLoadError when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await expect(loader.getTypeManifest()).rejects.toThrow(IndexLoadError);
    });
  });

  describe('getBloomFilter', () => {
    it('should fetch and parse bloom filter', async () => {
      // Create a mock bloom filter binary
      // Format: [4 bytes hashCount][4 bytes bitCount][bits...]
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint32(0, 3, true); // hashCount = 3
      view.setUint32(4, 64, true); // bitCount = 64
      // 8 bytes of bits follow

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const filter = await loader.getBloomFilter('data/person/part-0.parquet');

      expect(filter.hashCount).toBe(3);
      expect(filter.bitCount).toBe(64);
      expect(filter.bits).toBeInstanceOf(Uint8Array);
    });

    it('should normalize file path', async () => {
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint32(0, 3, true);
      view.setUint32(4, 64, true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await loader.getBloomFilter('/data/person/part-0.parquet');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://cdn.example.com/indexes/bloom/data/person/part-0.bloom'
      );
    });

    it('should cache bloom filter in memory', async () => {
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint32(0, 3, true);
      view.setUint32(4, 64, true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await loader.getBloomFilter('data/person/part-0.parquet');
      await loader.getBloomFilter('data/person/part-0.parquet');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw IndexLoadError when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      await expect(loader.getBloomFilter('data/person/part-0.parquet')).rejects.toThrow(
        IndexLoadError
      );
    });
  });

  describe('lookupTitle', () => {
    it('should return entry for existing title', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const entry = await loader.lookupTitle('Albert Einstein');

      expect(entry).toEqual({
        file: 'data/person/part-0.parquet',
        rowGroup: 0,
        row: 5,
      });
    });

    it('should normalize title before lookup', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      // Various input formats should all find the same entry
      const entry1 = await loader.lookupTitle('Albert Einstein');
      const entry2 = await loader.lookupTitle('ALBERT EINSTEIN');
      const entry3 = await loader.lookupTitle('  albert   einstein  ');

      expect(entry1).toEqual(entry2);
      expect(entry2).toEqual(entry3);
    });

    it('should return null for non-existent title', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const entry = await loader.lookupTitle('Non Existent Article');

      expect(entry).toBeNull();
    });
  });

  describe('titleExists', () => {
    it('should return true for existing title', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const exists = await loader.titleExists('Albert Einstein');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent title', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 5 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const exists = await loader.titleExists('Non Existent');
      expect(exists).toBe(false);
    });
  });

  describe('titleMayExistInFile', () => {
    it('should return true when bloom filter may contain title', async () => {
      // Create a bloom filter where all bits are set (always returns true)
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint32(0, 1, true); // hashCount = 1
      view.setUint32(4, 64, true); // bitCount = 64
      // Set all bits to 1
      const bits = new Uint8Array(buffer, 8, 8);
      bits.fill(0xff);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const mayExist = await loader.titleMayExistInFile(
        'Albert Einstein',
        'data/person/part-0.parquet'
      );

      expect(mayExist).toBe(true);
    });

    it('should return false when bloom filter definitely does not contain title', async () => {
      // Create a bloom filter where all bits are 0 (always returns false)
      const buffer = new ArrayBuffer(16);
      const view = new DataView(buffer);
      view.setUint32(0, 3, true); // hashCount = 3
      view.setUint32(4, 64, true); // bitCount = 64
      // All bits are already 0 from ArrayBuffer initialization

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const mayExist = await loader.titleMayExistInFile(
        'Albert Einstein',
        'data/person/part-0.parquet'
      );

      expect(mayExist).toBe(false);
    });

    it('should return true when bloom filter fails to load', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      // Should return true (assume title may exist) when bloom filter unavailable
      const mayExist = await loader.titleMayExistInFile(
        'Albert Einstein',
        'data/person/part-0.parquet'
      );

      expect(mayExist).toBe(true);
    });
  });

  describe('getFilesForType', () => {
    it('should return files for existing type', async () => {
      const mockManifest = {
        person: { type: 'person', count: 100, files: ['data/person/part-0.parquet', 'data/person/part-1.parquet'] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const files = await loader.getFilesForType('person');

      expect(files).toEqual(['data/person/part-0.parquet', 'data/person/part-1.parquet']);
    });

    it('should return empty array for non-existent type', async () => {
      const mockManifest = {
        person: { type: 'person', count: 100, files: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const files = await loader.getFilesForType('nonexistent' as any);

      expect(files).toEqual([]);
    });
  });

  describe('getTypeCount', () => {
    it('should return count for existing type', async () => {
      const mockManifest = {
        person: { type: 'person', count: 42, files: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const count = await loader.getTypeCount('person');

      expect(count).toBe(42);
    });

    it('should return 0 for non-existent type', async () => {
      const mockManifest = {
        person: { type: 'person', count: 42, files: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockManifest),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const count = await loader.getTypeCount('nonexistent' as any);

      expect(count).toBe(0);
    });
  });

  describe('getAutocompleteSuggestions', () => {
    it('should return matching titles', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
        'albert_camus': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 1 },
        'albert_brooks': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 2 },
        'barack_obama': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 3 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const suggestions = await loader.getAutocompleteSuggestions('albert', 10);

      expect(suggestions).toHaveLength(3);
      expect(suggestions).toContain('albert_einstein');
      expect(suggestions).toContain('albert_camus');
      expect(suggestions).toContain('albert_brooks');
      expect(suggestions).not.toContain('barack_obama');
    });

    it('should respect limit parameter', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
        'albert_camus': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 1 },
        'albert_brooks': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 2 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const suggestions = await loader.getAutocompleteSuggestions('albert', 2);

      expect(suggestions).toHaveLength(2);
    });

    it('should return empty array when no matches', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      const suggestions = await loader.getAutocompleteSuggestions('xyz', 10);

      expect(suggestions).toHaveLength(0);
    });
  });

  describe('clearCache', () => {
    it('should clear all memory caches', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      // Load and cache
      await loader.getTitleIndex();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Clear cache
      await loader.clearCache();

      // Should fetch again
      await loader.getTitleIndex();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      const mockTitleIndex = {
        'albert_einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTitleIndex),
      });

      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      // Before loading
      let stats = loader.getCacheStats();
      expect(stats.titleIndex).toBe(false);
      expect(stats.typeManifest).toBe(false);
      expect(stats.bloomFilters).toBe(0);

      // After loading title index
      await loader.getTitleIndex();
      stats = loader.getCacheStats();
      expect(stats.titleIndex).toBe(true);
    });
  });

  describe('close', () => {
    it('should close without errors', () => {
      const loader = new IndexLoader('https://cdn.example.com', {
        fetch: mockFetch,
        useIndexedDB: false,
      });

      expect(() => loader.close()).not.toThrow();
    });
  });
});

describe('IndexLoadError', () => {
  it('should create error with message and index type', () => {
    const error = new IndexLoadError('Test error', 'title-index');
    expect(error.message).toBe('Test error');
    expect(error.indexType).toBe('title-index');
    expect(error.name).toBe('IndexLoadError');
  });

  it('should include URL when provided', () => {
    const error = new IndexLoadError(
      'Failed to fetch',
      'bloom-filter',
      'https://cdn.example.com/indexes/bloom/data.bloom'
    );
    expect(error.url).toBe('https://cdn.example.com/indexes/bloom/data.bloom');
  });
});

describe('createIndexLoader', () => {
  it('should create a loader instance', () => {
    const loader = createIndexLoader('https://cdn.example.com');
    expect(loader).toBeInstanceOf(IndexLoader);
  });

  it('should pass options to constructor', () => {
    const mockFetch = vi.fn();
    const loader = createIndexLoader('https://cdn.example.com', {
      fetch: mockFetch,
      cacheTTL: 10000,
      useIndexedDB: false,
    });
    expect(loader).toBeInstanceOf(IndexLoader);
  });
});
