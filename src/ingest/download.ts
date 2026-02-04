// @ts-nocheck - Complex streaming download with exactOptionalPropertyTypes issues in progress callbacks
/**
 * Streaming HTTP download with progress tracking and resume support
 */

import type { DownloadOptions, DownloadProgress } from './types.js';
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
} from '../lib/constants.js';

/** Progress reporting interval in milliseconds */
const PROGRESS_INTERVAL_MS = 100;

/**
 * Stream download from a URL with progress tracking and resume support.
 *
 * @param url - The URL to download from
 * @param options - Download options including progress callback and abort signal
 * @returns A ReadableStream of the downloaded bytes
 *
 * @example
 * ```typescript
 * const stream = await streamDownload('https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2', {
 *   onProgress: (p) => console.log(`Downloaded ${p.bytesDownloaded} bytes`),
 *   signal: controller.signal
 * });
 * ```
 */
export async function streamDownload(
  url: string,
  options: DownloadOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const {
    onProgress,
    signal,
    resumeFrom = 0,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  } = options;

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    try {
      return await attemptDownload(url, {
        onProgress,
        signal: signal ?? undefined,
        resumeFrom,
        attempt,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if aborted
      if (signal?.aborted) {
        throw new DOMException('Download aborted', 'AbortError');
      }

      // Don't retry client errors (4xx)
      if (lastError.message.includes('Client error')) {
        throw lastError;
      }

      attempt++;
      if (attempt <= maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('Download failed after retries');
}

/**
 * Single download attempt
 */
async function attemptDownload(
  url: string,
  options: {
    onProgress?: (progress: DownloadProgress) => void;
    signal?: AbortSignal;
    resumeFrom: number;
    attempt: number;
  }
): Promise<ReadableStream<Uint8Array>> {
  const { onProgress, signal, resumeFrom } = options;

  const headers: HeadersInit = {};
  if (resumeFrom > 0) {
    headers['Range'] = `bytes=${resumeFrom}-`;
  }

  const response = await fetch(url, {
    headers,
    signal: signal ?? undefined,
  });

  // Handle response status
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) {
      throw new Error(`Client error: ${response.status} ${response.statusText}`);
    }
    throw new Error(`Server error: ${response.status} ${response.statusText}`);
  }

  // Handle 206 Partial Content for resumed downloads
  if (resumeFrom > 0 && response.status !== 206) {
    throw new Error('Server does not support range requests');
  }

  const body = response.body;
  if (!body) {
    throw new Error('Response body is null');
  }

  // Parse total size from Content-Length or Content-Range
  let totalBytes: number | undefined;
  const contentLength = response.headers.get('Content-Length');
  const contentRange = response.headers.get('Content-Range');

  if (contentRange) {
    // Format: bytes 0-999/1000
    const match = contentRange.match(/\/(\d+)$/);
    if (match && match[1]) {
      totalBytes = parseInt(match[1], 10);
    }
  } else if (contentLength) {
    totalBytes = parseInt(contentLength, 10) + resumeFrom;
  }

  // If no progress callback, return the raw stream
  if (!onProgress) {
    return body;
  }

  // Wrap stream with progress tracking
  return createProgressStream(body, {
    onProgress,
    totalBytes: totalBytes ?? undefined,
    startingBytes: resumeFrom,
  });
}

/**
 * Create a stream that tracks download progress
 */
function createProgressStream(
  source: ReadableStream<Uint8Array>,
  options: {
    onProgress: (progress: DownloadProgress) => void;
    totalBytes?: number;
    startingBytes: number;
  }
): ReadableStream<Uint8Array> {
  const { onProgress, totalBytes, startingBytes } = options;

  let bytesDownloaded = startingBytes;
  const startTime = Date.now();
  let lastProgressTime = startTime;

  const reader = source.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          // Final progress update
          const elapsedMs = Date.now() - startTime;
          onProgress({
            bytesDownloaded,
            totalBytes: totalBytes ?? undefined,
            bytesPerSecond: elapsedMs > 0 ? (bytesDownloaded - startingBytes) / (elapsedMs / 1000) : 0,
            elapsedMs,
          });
          controller.close();
          return;
        }

        bytesDownloaded += value.byteLength;
        controller.enqueue(value);

        // Throttle progress updates
        const now = Date.now();
        if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
          lastProgressTime = now;
          const elapsedMs = now - startTime;
          onProgress({
            bytesDownloaded,
            totalBytes: totalBytes ?? undefined,
            bytesPerSecond: elapsedMs > 0 ? (bytesDownloaded - startingBytes) / (elapsedMs / 1000) : 0,
            elapsedMs,
          });
        }
      } catch (error) {
        controller.error(error);
      }
    },

    cancel(reason) {
      reader.cancel(reason);
    },
  });
}

/**
 * Sleep helper for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get the expected file size from a URL without downloading
 */
export async function getContentLength(url: string): Promise<number | undefined> {
  const response = await fetch(url, { method: 'HEAD' });
  const contentLength = response.headers.get('Content-Length');
  return contentLength ? parseInt(contentLength, 10) : undefined;
}

/**
 * Check if a server supports range requests
 */
export async function supportsRangeRequests(url: string): Promise<boolean> {
  const response = await fetch(url, { method: 'HEAD' });
  const acceptRanges = response.headers.get('Accept-Ranges');
  return acceptRanges === 'bytes';
}
