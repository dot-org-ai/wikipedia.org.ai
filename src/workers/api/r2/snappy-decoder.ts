/**
 * Snappy Decompression
 *
 * Implements Snappy decompression algorithm for Parquet column data.
 * Also includes Gzip decompression using the standard DecompressionStream API.
 */

import { InternalError } from '../../../lib/errors.js';

/**
 * Varint read result
 */
export interface VarintResult {
  value: number;
  bytesRead: number;
}

/**
 * Read a varint from data at the given offset
 */
export function readVarint(data: Uint8Array, offset: number): VarintResult {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < data.length) {
    const byte = data[offset + bytesRead];
    if (byte === undefined) break;
    value |= (byte & 0x7f) << shift;
    bytesRead++;

    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { value, bytesRead };
}

/**
 * Snappy decompression
 *
 * Decompresses Snappy-compressed data.
 * Snappy format: varint uncompressed length, then chunks of literals and copies.
 */
export function decompressSnappy(data: Uint8Array): Uint8Array {
  let offset = 0;

  // Read uncompressed length
  const uncompressedLength = readVarint(data, offset);
  offset = uncompressedLength.bytesRead;

  const output = new Uint8Array(uncompressedLength.value);
  let outputOffset = 0;

  while (offset < data.length && outputOffset < output.length) {
    const tag = data[offset++];
    if (tag === undefined) break;
    const tagType = tag & 0x03;

    if (tagType === 0) {
      // Literal
      let length = (tag >> 2) + 1;
      if (length > 60) {
        const extraBytes = length - 60;
        length = 1;
        for (let i = 0; i < extraBytes; i++) {
          const byte = data[offset++];
          if (byte !== undefined) {
            length += byte << (i * 8);
          }
        }
      }
      output.set(data.slice(offset, offset + length), outputOffset);
      offset += length;
      outputOffset += length;
    } else {
      // Copy
      let length: number;
      let copyOffset: number;

      if (tagType === 1) {
        length = ((tag >> 2) & 0x07) + 4;
        const byte = data[offset++];
        copyOffset = ((tag >> 5) << 8) + (byte ?? 0);
      } else if (tagType === 2) {
        length = (tag >> 2) + 1;
        copyOffset = (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
        offset += 2;
      } else {
        length = (tag >> 2) + 1;
        copyOffset =
          (data[offset] ?? 0) |
          ((data[offset + 1] ?? 0) << 8) |
          ((data[offset + 2] ?? 0) << 16) |
          ((data[offset + 3] ?? 0) << 24);
        offset += 4;
      }

      const copyStart = outputOffset - copyOffset;
      for (let i = 0; i < length; i++) {
        const srcByte = output[copyStart + i];
        if (srcByte !== undefined) {
          output[outputOffset++] = srcByte;
        }
      }
    }
  }

  return output;
}

/**
 * Gzip decompression using DecompressionStream
 */
export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Gzip decompression that returns a string
 */
export async function decompressGzipToString(data: Uint8Array): Promise<string> {
  const decompressed = await decompressGzip(data);
  return new TextDecoder().decode(decompressed);
}

/**
 * Zstd decompression (placeholder - would need WASM module)
 */
export function decompressZstd(_data: Uint8Array): Uint8Array {
  throw new InternalError('ZSTD decompression not yet implemented');
}

/**
 * Decompress data based on codec type
 */
export async function decompress(data: Uint8Array, codec: string): Promise<Uint8Array> {
  switch (codec) {
    case 'UNCOMPRESSED':
      return data;

    case 'SNAPPY':
      return decompressSnappy(data);

    case 'GZIP':
      return decompressGzip(data);

    case 'ZSTD':
      return decompressZstd(data);

    default:
      throw new InternalError(`Unsupported codec: ${codec}`);
  }
}
