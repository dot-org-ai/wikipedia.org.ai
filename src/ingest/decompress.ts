/**
 * Streaming decompression for gzip and bzip2 formats
 */

import type { CompressionType } from './types.js';

/** Magic bytes for compression format detection */
const GZIP_MAGIC = [0x1f, 0x8b];
const BZIP2_MAGIC = [0x42, 0x5a]; // 'BZ'

/**
 * Create a decompression TransformStream.
 *
 * @param type - Compression type: 'gzip', 'bzip2', or 'auto' for auto-detection
 * @returns TransformStream that decompresses the input
 *
 * @example
 * ```typescript
 * const decompressor = createDecompressor('auto');
 * const decompressedStream = compressedStream.pipeThrough(decompressor);
 * ```
 */
export function createDecompressor(
  type: CompressionType = 'auto'
): TransformStream<Uint8Array, Uint8Array> {
  if (type === 'gzip') {
    return createGzipDecompressor();
  }

  if (type === 'bzip2') {
    return createBzip2Decompressor();
  }

  // Auto-detection mode
  return createAutoDecompressor();
}

/**
 * Create a gzip decompressor using the native DecompressionStream API
 */
function createGzipDecompressor(): TransformStream<Uint8Array, Uint8Array> {
  // Use native DecompressionStream API (available in modern runtimes)
  return new DecompressionStream('gzip');
}

/**
 * Create a bzip2 decompressor using unbzip2-stream
 *
 * This wraps the Node.js stream-based unbzip2-stream library
 * in a Web Streams API TransformStream
 */
function createBzip2Decompressor(): TransformStream<Uint8Array, Uint8Array> {
  // We need to dynamically import unbzip2-stream since it uses Node streams
  // and wrap it in a TransformStream

  let bz2Transform: import('stream').Transform | null = null;
  let resolveReady: () => void;
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve;
  });

  // Buffers for bridging Node streams to Web streams
  const outputChunks: Uint8Array[] = [];
  let outputResolve: ((value: IteratorResult<Uint8Array>) => void) | null = null;
  let inputDone = false;
  let error: Error | null = null;

  // Initialize the bzip2 transform lazily
  const initBzip2 = async () => {
    // Dynamic import for unbzip2-stream
    const unbzip2Module = await import('unbzip2-stream');
    const unbzip2 = unbzip2Module.default || unbzip2Module;
    bz2Transform = unbzip2();

    bz2Transform!.on('data', (chunk: Buffer) => {
      const uint8 = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (outputResolve) {
        const resolve = outputResolve;
        outputResolve = null;
        resolve({ done: false, value: uint8 });
      } else {
        outputChunks.push(uint8);
      }
    });

    bz2Transform!.on('end', () => {
      inputDone = true;
      if (outputResolve) {
        const resolve = outputResolve;
        outputResolve = null;
        resolve({ done: true, value: undefined as unknown as Uint8Array });
      }
    });

    bz2Transform!.on('error', (err: Error) => {
      error = err;
      if (outputResolve) {
        outputResolve = null;
      }
    });

    resolveReady();
  };

  const initPromise = initBzip2();

  return new TransformStream<Uint8Array, Uint8Array>(
    {
      async start() {
        await initPromise;
      },

      async transform(chunk, controller) {
        await ready;
        if (error) {
          controller.error(error);
          return;
        }

        if (!bz2Transform) {
          controller.error(new Error('Bzip2 transform not initialized'));
          return;
        }

        // Write chunk to Node transform
        const canContinue = bz2Transform.write(Buffer.from(chunk));

        // Drain any available output
        while (outputChunks.length > 0) {
          controller.enqueue(outputChunks.shift()!);
        }

        // Handle backpressure
        if (!canContinue) {
          await new Promise<void>(resolve => {
            bz2Transform!.once('drain', resolve);
          });
        }

        // Check for errors
        if (error) {
          controller.error(error);
        }
      },

      async flush(controller) {
        await ready;
        if (!bz2Transform) return;

        // Signal end of input
        bz2Transform.end();

        // Wait for all output
        await new Promise<void>(resolve => {
          if (inputDone) {
            resolve();
          } else {
            bz2Transform!.once('end', resolve);
          }
        });

        // Drain remaining output
        while (outputChunks.length > 0) {
          controller.enqueue(outputChunks.shift()!);
        }

        if (error) {
          controller.error(error);
        }
      },
    },
    // Queuing strategies for backpressure
    { highWaterMark: 1 }, // Input queue
    { highWaterMark: 1 }  // Output queue
  );
}

/**
 * Create an auto-detecting decompressor that inspects magic bytes
 */
function createAutoDecompressor(): TransformStream<Uint8Array, Uint8Array> {
  let detectedType: 'gzip' | 'bzip2' | 'none' | null = null;
  let innerTransform: TransformStream<Uint8Array, Uint8Array> | null = null;
  let innerWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  let innerReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let headerBuffer: Uint8Array | null = new Uint8Array(2);
  let headerOffset = 0;

  return new TransformStream<Uint8Array, Uint8Array>(
    {
      async transform(chunk, controller) {
        // If we've already detected the format, pass through
        if (detectedType !== null && innerWriter && innerReader) {
          await innerWriter.write(chunk);

          // Drain output from inner transform
          while (true) {
            const result = await Promise.race([
              innerReader.read(),
              Promise.resolve({ done: false, value: undefined, pending: true } as const),
            ]);

            if ('pending' in result) break;
            if (result.done) break;
            if (result.value) {
              controller.enqueue(result.value);
            }
          }
          return;
        }

        // Accumulate header bytes for detection
        if (headerBuffer) {
          const needed = 2 - headerOffset;
          const available = Math.min(needed, chunk.byteLength);

          headerBuffer.set(chunk.subarray(0, available), headerOffset);
          headerOffset += available;

          if (headerOffset >= 2) {
            // Detect format from magic bytes
            detectedType = detectFormat(headerBuffer);
            const header = headerBuffer;
            headerBuffer = null;

            // Create appropriate decompressor
            if (detectedType === 'gzip') {
              innerTransform = createGzipDecompressor();
            } else if (detectedType === 'bzip2') {
              innerTransform = createBzip2Decompressor();
            } else {
              // No compression detected, pass through
              controller.enqueue(header);
              if (available < chunk.byteLength) {
                controller.enqueue(chunk.subarray(available));
              }
              detectedType = 'none';
              return;
            }

            innerWriter = innerTransform.writable.getWriter();
            innerReader = innerTransform.readable.getReader();

            // Write the header bytes we buffered
            await innerWriter.write(header);

            // Write remaining chunk if any
            if (available < chunk.byteLength) {
              await innerWriter.write(chunk.subarray(available));
            }

            // Drain any output
            await drainReader(innerReader, controller);
          }
        }
      },

      async flush(controller) {
        if (headerBuffer && headerOffset > 0) {
          // We have unflushed header bytes - no compression detected
          controller.enqueue(headerBuffer.subarray(0, headerOffset));
          return;
        }

        if (innerWriter && innerReader) {
          await innerWriter.close();

          // Drain remaining output
          while (true) {
            const result = await innerReader.read();
            if (result.done) break;
            if (result.value) {
              controller.enqueue(result.value);
            }
          }
        }
      },
    },
    { highWaterMark: 1 },
    { highWaterMark: 1 }
  );
}

/**
 * Detect compression format from magic bytes
 */
function detectFormat(header: Uint8Array): 'gzip' | 'bzip2' | 'none' {
  if (header[0] === GZIP_MAGIC[0] && header[1] === GZIP_MAGIC[1]) {
    return 'gzip';
  }
  if (header[0] === BZIP2_MAGIC[0] && header[1] === BZIP2_MAGIC[1]) {
    return 'bzip2';
  }
  return 'none';
}

/**
 * Drain available chunks from a reader without blocking
 */
async function drainReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: TransformStreamDefaultController<Uint8Array>
): Promise<void> {
  // Use a non-blocking approach with Promise.race
  const timeoutPromise = new Promise<{ timeout: true }>(resolve =>
    setTimeout(() => resolve({ timeout: true }), 0)
  );

  while (true) {
    const result = await Promise.race([reader.read(), timeoutPromise]);
    if ('timeout' in result) break;
    if (result.done) break;
    if (result.value) {
      controller.enqueue(result.value);
    }
  }
}

/**
 * Detect compression type from file extension
 */
export function detectCompressionFromExtension(filename: string): CompressionType {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.gz') || lower.endsWith('.gzip')) {
    return 'gzip';
  }
  if (lower.endsWith('.bz2') || lower.endsWith('.bzip2')) {
    return 'bzip2';
  }
  return 'auto';
}
