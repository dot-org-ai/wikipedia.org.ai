/**
 * Tests for the streaming download module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  streamDownload,
  getContentLength,
  supportsRangeRequests,
} from '../../src/ingest/download.js';
import type { DownloadProgress } from '../../src/ingest/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('streamDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should stream data from URL', async () => {
    // Create a mock readable stream with test data
    const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(testData);
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: mockStream,
      headers: new Headers({
        'Content-Length': '10',
      }),
    });

    const stream = await streamDownload('https://example.com/file.txt');

    expect(stream).toBeInstanceOf(ReadableStream);

    // Read the stream
    const reader = stream.getReader();
    const { value, done } = await reader.read();

    expect(done).toBe(false);
    expect(value).toEqual(testData);

    const { done: finalDone } = await reader.read();
    expect(finalDone).toBe(true);
  });

  it('should report progress', async () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
    const chunk2 = new Uint8Array([6, 7, 8, 9, 10]);

    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: mockStream,
      headers: new Headers({
        'Content-Length': '10',
      }),
    });

    const progressUpdates: DownloadProgress[] = [];
    const onProgress = vi.fn((progress: DownloadProgress) => {
      progressUpdates.push({ ...progress });
    });

    const stream = await streamDownload('https://example.com/file.txt', {
      onProgress,
    });

    // Consume the stream
    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Progress should have been reported
    expect(onProgress).toHaveBeenCalled();

    // Final progress should show all bytes downloaded
    const lastProgress = progressUpdates[progressUpdates.length - 1];
    expect(lastProgress.bytesDownloaded).toBe(10);
    expect(lastProgress.totalBytes).toBe(10);
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      streamDownload('https://example.com/file.txt', {
        maxRetries: 3,
        retryDelayMs: 10,
      })
    ).rejects.toThrow('Network error');

    // Should have retried
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it('should support abort signal', async () => {
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    mockFetch.mockImplementation(() => {
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(
      streamDownload('https://example.com/file.txt', {
        signal: controller.signal,
      })
    ).rejects.toThrow('aborted');
  });

  it('should handle client errors (4xx) without retry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      body: null,
      headers: new Headers(),
    });

    await expect(
      streamDownload('https://example.com/nonexistent.txt', {
        maxRetries: 3,
        retryDelayMs: 10,
      })
    ).rejects.toThrow('Client error');

    // Should NOT have retried for 4xx errors
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle server errors (5xx) with retry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: null,
      headers: new Headers(),
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: null,
      headers: new Headers(),
    });

    const testData = new Uint8Array([1, 2, 3]);
    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(testData);
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      body: mockStream,
      headers: new Headers(),
    });

    const stream = await streamDownload('https://example.com/file.txt', {
      maxRetries: 3,
      retryDelayMs: 10,
    });

    expect(stream).toBeInstanceOf(ReadableStream);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should support resume from byte offset', async () => {
    const testData = new Uint8Array([6, 7, 8, 9, 10]);
    const mockStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(testData);
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 206,
      statusText: 'Partial Content',
      body: mockStream,
      headers: new Headers({
        'Content-Range': 'bytes 5-9/10',
      }),
    });

    const stream = await streamDownload('https://example.com/file.txt', {
      resumeFrom: 5,
    });

    expect(stream).toBeInstanceOf(ReadableStream);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/file.txt', {
      headers: { Range: 'bytes=5-' },
      signal: undefined,
    });
  });
});

describe('getContentLength', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return content length from HEAD request', async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers({
        'Content-Length': '12345',
      }),
    });

    const length = await getContentLength('https://example.com/file.txt');

    expect(length).toBe(12345);
    expect(mockFetch).toHaveBeenCalledWith('https://example.com/file.txt', {
      method: 'HEAD',
    });
  });

  it('should return undefined when Content-Length is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers(),
    });

    const length = await getContentLength('https://example.com/file.txt');

    expect(length).toBeUndefined();
  });
});

describe('supportsRangeRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when server supports range requests', async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers({
        'Accept-Ranges': 'bytes',
      }),
    });

    const supports = await supportsRangeRequests('https://example.com/file.txt');

    expect(supports).toBe(true);
  });

  it('should return false when server does not support range requests', async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers({
        'Accept-Ranges': 'none',
      }),
    });

    const supports = await supportsRangeRequests('https://example.com/file.txt');

    expect(supports).toBe(false);
  });

  it('should return false when Accept-Ranges header is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      headers: new Headers(),
    });

    const supports = await supportsRangeRequests('https://example.com/file.txt');

    expect(supports).toBe(false);
  });
});
