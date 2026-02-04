/**
 * R2 Reader Module
 *
 * This module provides utilities for reading Parquet files and manifests
 * from Cloudflare R2 storage.
 *
 * @module r2
 */

// Re-export Thrift decoder
export { ThriftDecoder } from './thrift-decoder.js';
export type { ThriftFieldHeader, ThriftListHeader } from './thrift-decoder.js';

// Re-export decompression utilities
export {
  readVarint,
  decompressSnappy,
  decompressGzip,
  decompressGzipToString,
  decompressZstd,
  decompress,
} from './snappy-decoder.js';
export type { VarintResult } from './snappy-decoder.js';

// Re-export Parquet reader
export { R2ParquetReader, createR2ParquetReader } from './parquet-reader.js';
export type {
  ParquetMetadata,
  SchemaElement,
  RowGroupMetadata,
  ColumnChunkMetadata,
} from './parquet-reader.js';

// Re-export Manifest reader
export { R2ManifestReader, createR2ManifestReader } from './manifest-reader.js';
