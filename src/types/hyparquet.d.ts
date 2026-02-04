/**
 * Type declarations for @dotdo/hyparquet
 *
 * Re-exports and extends the types from the hyparquet library for use
 * in this project. The hyparquet library provides its own types, but
 * this file provides additional type utilities and re-exports for
 * convenience.
 */

// Re-export all types from hyparquet for convenient access
export type {
  // Core types
  AsyncBuffer,
  Awaitable,
  DataReader,

  // Metadata types
  FileMetaData,
  SchemaTree,
  SchemaElement,
  ParquetType,
  FieldRepetitionType,
  ConvertedType,
  TimeUnit,
  LogicalType,
  LogicalTypeType,

  // Row group and column types
  RowGroup,
  ColumnChunk,
  ColumnMetaData,
  Encoding,
  CompressionCodec,
  Compressors,
  KeyValue,
  Statistics,

  // Page types
  PageType,
  PageHeader,
  DataPageHeader,
  DictionaryPageHeader,
  DecodedArray,

  // Index types
  OffsetIndex,
  ColumnIndex,
  BoundaryOrder,
  ColumnData,

  // Query types
  ParquetReadOptions,
  MetadataOptions,
  ParquetParsers,

  // Geospatial types
  Position,
  BoundingBox,
  GeospatialStatistics,
  Geometry,
} from '@dotdo/hyparquet';

/**
 * Raw hyparquet metadata structure.
 * This represents the actual structure returned by parquetMetadataAsync.
 */
export interface HyparquetRawMetadata {
  version: number;
  schema: HyparquetSchemaElement[];
  num_rows: bigint;
  row_groups: HyparquetRowGroup[];
  key_value_metadata?: { key: string; value?: string }[];
  created_by?: string;
  metadata_length: number;
}

/**
 * Schema element as returned by hyparquet
 */
export interface HyparquetSchemaElement {
  type?: string;
  type_length?: number;
  repetition_type?: 'REQUIRED' | 'OPTIONAL' | 'REPEATED';
  name: string;
  num_children?: number;
  converted_type?: string;
  scale?: number;
  precision?: number;
  field_id?: number;
  logical_type?: {
    type: string;
    [key: string]: unknown;
  };
}

/**
 * Row group as returned by hyparquet
 */
export interface HyparquetRowGroup {
  columns: HyparquetColumnChunk[];
  total_byte_size: bigint;
  num_rows: bigint;
  sorting_columns?: { column_idx: number; descending: boolean; nulls_first: boolean }[];
  file_offset?: bigint;
  total_compressed_size?: bigint;
  ordinal?: number;
}

/**
 * Column chunk as returned by hyparquet
 */
export interface HyparquetColumnChunk {
  file_path?: string;
  file_offset: bigint;
  meta_data?: HyparquetColumnMetaData;
  offset_index_offset?: bigint;
  offset_index_length?: number;
  column_index_offset?: bigint;
  column_index_length?: number;
}

/**
 * Column metadata as returned by hyparquet
 */
export interface HyparquetColumnMetaData {
  type: string;
  encodings: string[];
  path_in_schema: string[];
  codec: string;
  num_values: bigint;
  total_uncompressed_size: bigint;
  total_compressed_size: bigint;
  key_value_metadata?: { key: string; value?: string }[];
  data_page_offset: bigint;
  index_page_offset?: bigint;
  dictionary_page_offset?: bigint;
  statistics?: {
    max?: unknown;
    min?: unknown;
    null_count?: bigint;
    distinct_count?: bigint;
    max_value?: unknown;
    min_value?: unknown;
  };
}

/**
 * Type guard to check if a value is a HyparquetRawMetadata
 */
export function isHyparquetMetadata(value: unknown): value is HyparquetRawMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    'schema' in obj &&
    Array.isArray(obj['schema']) &&
    'row_groups' in obj &&
    Array.isArray(obj['row_groups']) &&
    'num_rows' in obj
  );
}
