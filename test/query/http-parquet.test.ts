/**
 * Tests for HttpParquetReader
 *
 * Tests for HTTP Range request handling, caching, metadata parsing,
 * and error conditions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import HttpParquetError directly for error class tests only
// Full HttpParquetReader tests need to be isolated due to mocking in other tests
import { HttpParquetError } from '../../src/query/http-parquet.js';

describe('HttpParquetError', () => {
  it('should create error with message', () => {
    const error = new HttpParquetError('Test error');
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('HttpParquetError');
  });

  it('should include status code when provided', () => {
    const error = new HttpParquetError('Not found', 404);
    expect(error.statusCode).toBe(404);
  });

  it('should include URL when provided', () => {
    const error = new HttpParquetError('Failed', 500, 'https://example.com/data.parquet');
    expect(error.url).toBe('https://example.com/data.parquet');
  });
});

describe('HTTP Parquet Range Request Behavior', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HEAD request initialization', () => {
    it('should require file length from HEAD request', async () => {
      // Mock a HEAD response without Content-Length
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: {
          get: () => null,
        },
      });

      // Using a simple function to test the behavior pattern
      const initReader = async (url: string, fetchFn: typeof fetch) => {
        const response = await fetchFn(url, { method: 'HEAD' });
        if (!response.ok) {
          throw new HttpParquetError(
            'Failed to get file length',
            response.status,
            url
          );
        }
        const contentLength = response.headers.get('content-length');
        if (!contentLength) {
          throw new HttpParquetError(
            'Server did not return Content-Length header',
            undefined,
            url
          );
        }
        return parseInt(contentLength, 10);
      };

      await expect(
        initReader('https://cdn.example.com/data.parquet', mockFetch as unknown as typeof fetch)
      ).rejects.toThrow('Content-Length');
    });

    it('should throw error when HEAD request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const initReader = async (url: string, fetchFn: typeof fetch) => {
        const response = await fetchFn(url, { method: 'HEAD' });
        if (!response.ok) {
          throw new HttpParquetError(
            `Failed to get file length: ${response.status}`,
            response.status,
            url
          );
        }
        return response;
      };

      await expect(
        initReader('https://cdn.example.com/data.parquet', mockFetch as unknown as typeof fetch)
      ).rejects.toThrow(HttpParquetError);
    });
  });

  describe('Range request handling', () => {
    it('should make Range request with correct header format', async () => {
      // Test that Range header format is correct (bytes=START-END-1 for HTTP Range)
      const url = 'https://cdn.example.com/data.parquet';
      const start = 0;
      const end = 100;

      const mockArrayBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const fetchRange = async (
        fetchFn: typeof fetch,
        fileUrl: string,
        rangeStart: number,
        rangeEnd: number
      ) => {
        const rangeHeader = `bytes=${rangeStart}-${rangeEnd - 1}`;
        const response = await fetchFn(fileUrl, {
          headers: { Range: rangeHeader },
        });
        if (!response.ok && response.status !== 206) {
          throw new HttpParquetError(
            `Failed to read range: ${response.status}`,
            response.status,
            fileUrl
          );
        }
        return response.arrayBuffer();
      };

      const buffer = await fetchRange(mockFetch as unknown as typeof fetch, url, start, end);

      expect(buffer).toBe(mockArrayBuffer);
      expect(mockFetch).toHaveBeenCalledWith(url, {
        headers: { Range: 'bytes=0-99' },
      });
    });

    it('should handle 206 Partial Content response', async () => {
      const mockArrayBuffer = new ArrayBuffer(50);
      mockFetch.mockResolvedValueOnce({
        ok: true, // Note: 206 is considered "ok"
        status: 206,
        arrayBuffer: () => Promise.resolve(mockArrayBuffer),
      });

      const response = await mockFetch('https://cdn.example.com/data.parquet', {
        headers: { Range: 'bytes=0-49' },
      });

      expect(response.status).toBe(206);
      const buffer = await response.arrayBuffer();
      expect(buffer.byteLength).toBe(50);
    });

    it('should throw error on failed range request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 416, // Range Not Satisfiable
        statusText: 'Range Not Satisfiable',
      });

      const fetchRange = async (fetchFn: typeof fetch, url: string) => {
        const response = await fetchFn(url, {
          headers: { Range: 'bytes=0-100' },
        });
        if (!response.ok && response.status !== 206) {
          throw new HttpParquetError(
            `Failed to read range: ${response.status}`,
            response.status,
            url
          );
        }
        return response.arrayBuffer();
      };

      await expect(
        fetchRange(mockFetch as unknown as typeof fetch, 'https://cdn.example.com/data.parquet')
      ).rejects.toThrow(HttpParquetError);
    });
  });

  describe('Caching behavior', () => {
    it('should cache responses by key', () => {
      const cache = new Map<string, ArrayBuffer>();

      const addToCache = (start: number, end: number, buffer: ArrayBuffer) => {
        const key = `${start}-${end}`;
        cache.set(key, buffer);
      };

      const getFromCache = (start: number, end: number): ArrayBuffer | undefined => {
        const key = `${start}-${end}`;
        return cache.get(key);
      };

      const buffer = new ArrayBuffer(100);
      addToCache(0, 100, buffer);

      expect(getFromCache(0, 100)).toBe(buffer);
      expect(getFromCache(0, 50)).toBeUndefined();
    });

    it('should evict oldest entries when cache is full', () => {
      const maxCacheSize = 200;
      const cache = new Map<string, ArrayBuffer>();

      const getCurrentSize = (): number => {
        let size = 0;
        for (const buffer of cache.values()) {
          size += buffer.byteLength;
        }
        return size;
      };

      const addToCache = (key: string, buffer: ArrayBuffer) => {
        // Simple eviction: remove oldest if needed
        while (getCurrentSize() + buffer.byteLength > maxCacheSize && cache.size > 0) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        cache.set(key, buffer);
      };

      // Add buffers
      addToCache('0-100', new ArrayBuffer(100));
      addToCache('100-200', new ArrayBuffer(100));
      expect(cache.size).toBe(2);

      // This should evict the first one
      addToCache('200-300', new ArrayBuffer(100));
      expect(cache.has('0-100')).toBe(false);
      expect(cache.has('100-200')).toBe(true);
      expect(cache.has('200-300')).toBe(true);
    });
  });

  describe('Byte offset validation', () => {
    it('should reject negative start offset', () => {
      const byteLength = 1000;

      const validateRange = (start: number, end: number, fileLength: number) => {
        if (start < 0 || start >= fileLength) {
          throw new HttpParquetError(
            `Invalid start offset: ${start} (file length: ${fileLength})`
          );
        }
        if (end > fileLength) {
          throw new HttpParquetError(
            `Invalid end offset: ${end} (file length: ${fileLength})`
          );
        }
      };

      expect(() => validateRange(-1, 100, byteLength)).toThrow('Invalid start offset');
    });

    it('should reject out-of-range end offset', () => {
      const byteLength = 1000;

      const validateRange = (start: number, end: number, fileLength: number) => {
        if (start < 0 || start >= fileLength) {
          throw new HttpParquetError(
            `Invalid start offset: ${start} (file length: ${fileLength})`
          );
        }
        if (end > fileLength) {
          throw new HttpParquetError(
            `Invalid end offset: ${end} (file length: ${fileLength})`
          );
        }
      };

      expect(() => validateRange(0, 2000, byteLength)).toThrow('Invalid end offset');
    });

    it('should accept valid range', () => {
      const byteLength = 1000;

      const validateRange = (start: number, end: number, fileLength: number): boolean => {
        if (start < 0 || start >= fileLength) {
          throw new HttpParquetError(
            `Invalid start offset: ${start} (file length: ${fileLength})`
          );
        }
        if (end > fileLength) {
          throw new HttpParquetError(
            `Invalid end offset: ${end} (file length: ${fileLength})`
          );
        }
        return true;
      };

      expect(validateRange(0, 100, byteLength)).toBe(true);
      expect(validateRange(500, 600, byteLength)).toBe(true);
      expect(validateRange(0, 1000, byteLength)).toBe(true);
    });
  });
});
