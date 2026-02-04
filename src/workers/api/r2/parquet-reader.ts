/**
 * R2 Parquet Reader
 *
 * Reads Parquet files directly from R2 storage using Range requests.
 * Implements minimal Parquet parsing for Cloudflare Workers environment.
 */

import type { Article, ArticleType } from '../types.js';
import { LRUCache } from '../../../lib/lru-cache.js';
import { NotFoundError, ValidationError } from '../../../lib/errors.js';
import { ThriftDecoder } from './thrift-decoder.js';
import { decompress } from './snappy-decoder.js';

/** Parquet file metadata */
export interface ParquetMetadata {
  version: number;
  schema: SchemaElement[];
  rowCount: number;
  rowGroups: RowGroupMetadata[];
  createdBy?: string;
}

/** Schema element */
export interface SchemaElement {
  name: string;
  type?: string;
  convertedType?: string;
  repetitionType?: string;
  numChildren?: number;
}

/** Row group metadata */
export interface RowGroupMetadata {
  columns: ColumnChunkMetadata[];
  totalByteSize: number;
  rowCount: number;
}

/** Column chunk metadata */
export interface ColumnChunkMetadata {
  path: string[];
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
  codec: string;
  numValues: number;
}

/** Parquet footer magic bytes */
const PARQUET_MAGIC = new Uint8Array([0x50, 0x41, 0x52, 0x31]); // "PAR1"

/** Maximum number of cached metadata entries */
const MAX_METADATA_CACHE_SIZE = 100;

/** Maximum number of cached footer entries */
const MAX_FOOTER_CACHE_SIZE = 50;

/**
 * R2 Parquet Reader for Cloudflare Workers
 *
 * Features:
 * - Range request support for efficient reads
 * - Footer and metadata caching
 * - Row group level access
 * - Streaming decompression
 */
export class R2ParquetReader {
  private bucket: R2Bucket;
  private metadataCache: LRUCache<string, ParquetMetadata>;
  private footerCache: LRUCache<string, Uint8Array>;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
    this.metadataCache = new LRUCache<string, ParquetMetadata>(MAX_METADATA_CACHE_SIZE);
    this.footerCache = new LRUCache<string, Uint8Array>(MAX_FOOTER_CACHE_SIZE);
  }

  /**
   * Get Parquet file metadata
   */
  async getMetadata(file: string): Promise<ParquetMetadata> {
    // Check cache
    const cached = this.metadataCache.get(file);
    if (cached) {
      return cached;
    }

    // Get file size first
    const head = await this.bucket.head(file);
    if (!head) {
      throw new NotFoundError(`File not found: ${file}`);
    }

    const fileSize = head.size;

    // Read footer (last 8 bytes contain footer length + magic)
    const footerSizeBytes = await this.readRange(file, fileSize - 8, 8);
    const footerView = new DataView(footerSizeBytes.buffer);
    const footerLength = footerView.getInt32(0, true);

    // Verify magic bytes
    const magic = footerSizeBytes.slice(4);
    if (!this.bytesEqual(magic, PARQUET_MAGIC)) {
      throw new ValidationError(`Invalid Parquet file: ${file}`);
    }

    // Read footer
    const footerStart = fileSize - 8 - footerLength;
    const footerBytes = await this.readRange(file, footerStart, footerLength);

    // Parse Thrift-encoded footer
    const metadata = this.parseFooter(footerBytes);

    // Cache metadata
    this.metadataCache.set(file, metadata);

    return metadata;
  }

  /**
   * Read a specific article by file location
   */
  async readArticle(file: string, rowGroup: number, row: number): Promise<Article> {
    const rows = await this.readRowGroup(file, rowGroup);

    if (row < 0 || row >= rows.length) {
      throw new NotFoundError(`Row ${row} out of bounds in row group ${rowGroup}`);
    }

    const article = rows[row];
    if (!article) {
      throw new NotFoundError(`Row ${row} not found in row group ${rowGroup}`);
    }
    return article;
  }

  /**
   * Read all articles in a row group
   */
  async readRowGroup(file: string, rowGroupIndex: number): Promise<Article[]> {
    const metadata = await this.getMetadata(file);

    if (rowGroupIndex < 0 || rowGroupIndex >= metadata.rowGroups.length) {
      throw new NotFoundError(`Row group ${rowGroupIndex} out of bounds`);
    }

    const rowGroup = metadata.rowGroups[rowGroupIndex];
    if (!rowGroup) {
      throw new NotFoundError(`Row group ${rowGroupIndex} not found`);
    }

    // Calculate the range to read (all columns in the row group)
    const minOffset = Math.min(...rowGroup.columns.map((c) => c.offset));
    const maxEnd = Math.max(...rowGroup.columns.map((c) => c.offset + c.compressedSize));
    const totalSize = maxEnd - minOffset;

    // Read the entire row group data
    const data = await this.readRange(file, minOffset, totalSize);

    // Parse columns
    const columnData = new Map<string, unknown[]>();

    for (const column of rowGroup.columns) {
      const columnName = column.path[column.path.length - 1] ?? '';
      const relativeOffset = column.offset - minOffset;
      const columnBytes = data.slice(relativeOffset, relativeOffset + column.compressedSize);

      // Decompress if needed
      const decompressed = await decompress(columnBytes, column.codec);

      // Parse column values
      const values = this.parseColumnValues(decompressed, columnName, column.numValues);
      columnData.set(columnName, values);
    }

    // Assemble articles from columns
    const articles: Article[] = [];
    const rowCount = rowGroup.rowCount;
    for (let i = 0; i < rowCount; i++) {
      const coordsLat = columnData.get('coords_lat')?.[i] as number | null;
      const coordsLon = columnData.get('coords_lon')?.[i] as number | null;

      const article: Article = {
        id: (columnData.get('$id')?.[i] as string) ?? '',
        type: (columnData.get('$type')?.[i] as ArticleType) ?? 'other',
        title: (columnData.get('title')?.[i] as string) ?? '',
        description: (columnData.get('description')?.[i] as string) ?? '',
        wikidata_id: (columnData.get('wikidata_id')?.[i] as string) ?? null,
        coords:
          coordsLat !== null && coordsLon !== null ? { lat: coordsLat, lon: coordsLon } : null,
        infobox: (columnData.get('infobox')?.[i] as Record<string, unknown>) ?? null,
        content: (columnData.get('content')?.[i] as string) ?? '',
        updated_at: this.formatDate(columnData.get('updated_at')?.[i] as number),
      };

      articles.push(article);
    }

    return articles;
  }

  /**
   * Read articles with pagination
   */
  async readArticles(
    file: string,
    limit: number,
    offset: number
  ): Promise<{ articles: Article[]; total: number }> {
    const metadata = await this.getMetadata(file);

    // Calculate which row groups to read
    let currentOffset = 0;
    let remaining = limit;
    const articles: Article[] = [];

    for (let rgIndex = 0; rgIndex < metadata.rowGroups.length && remaining > 0; rgIndex++) {
      const rg = metadata.rowGroups[rgIndex];
      if (!rg) continue;
      const rgEnd = currentOffset + rg.rowCount;

      // Skip row groups before our offset
      if (rgEnd <= offset) {
        currentOffset = rgEnd;
        continue;
      }

      // Read this row group
      const rgArticles = await this.readRowGroup(file, rgIndex);

      // Calculate slice within this row group
      const startInRg = Math.max(0, offset - currentOffset);
      const rgRowCount = rg.rowCount;
      const endInRg = Math.min(rgRowCount, startInRg + remaining);

      articles.push(...rgArticles.slice(startInRg, endInRg));
      remaining -= endInRg - startInRg;

      currentOffset = rgEnd;
    }

    return {
      articles,
      total: metadata.rowCount,
    };
  }

  /**
   * Search articles in a file by a field value
   */
  async searchByField(
    file: string,
    field: string,
    value: unknown,
    limit: number
  ): Promise<Article[]> {
    const metadata = await this.getMetadata(file);
    const results: Article[] = [];

    for (let rgIndex = 0; rgIndex < metadata.rowGroups.length && results.length < limit; rgIndex++) {
      const articles = await this.readRowGroup(file, rgIndex);

      for (const article of articles) {
        if (results.length >= limit) break;

        const fieldValue = (article as unknown as Record<string, unknown>)[field];
        if (fieldValue === value) {
          results.push(article);
        }
      }
    }

    return results;
  }

  /**
   * Read a range of bytes from R2
   */
  private async readRange(file: string, offset: number, length: number): Promise<Uint8Array> {
    const object = await this.bucket.get(file, {
      range: { offset, length },
    });

    if (!object) {
      throw new NotFoundError(`Failed to read ${file} at offset ${offset}`);
    }

    const buffer = await object.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Parse Parquet footer (simplified Thrift parsing)
   */
  private parseFooter(bytes: Uint8Array): ParquetMetadata {
    const decoder = new ThriftDecoder(bytes);

    const metadata: ParquetMetadata = {
      version: 1,
      schema: [],
      rowCount: 0,
      rowGroups: [],
    };

    // Parse FileMetaData structure
    while (decoder.hasMore()) {
      const field = decoder.readFieldHeader();
      if (field.type === 0) break; // STOP

      switch (field.id) {
        case 1: // version
          metadata.version = decoder.readI32();
          break;
        case 2: // schema
          metadata.schema = this.parseSchemaList(decoder);
          break;
        case 3: // num_rows
          metadata.rowCount = Number(decoder.readI64());
          break;
        case 4: // row_groups
          metadata.rowGroups = this.parseRowGroupList(decoder);
          break;
        case 6: // created_by
          metadata.createdBy = decoder.readString();
          break;
        default:
          decoder.skip(field.type);
      }
    }

    return metadata;
  }

  /**
   * Parse schema list from Thrift
   */
  private parseSchemaList(decoder: ThriftDecoder): SchemaElement[] {
    const listHeader = decoder.readListHeader();
    const elements: SchemaElement[] = [];

    for (let i = 0; i < listHeader.size; i++) {
      elements.push(this.parseSchemaElement(decoder));
    }

    return elements;
  }

  /**
   * Parse a single schema element
   */
  private parseSchemaElement(decoder: ThriftDecoder): SchemaElement {
    const element: SchemaElement = { name: '' };

    while (decoder.hasMore()) {
      const field = decoder.readFieldHeader();
      if (field.type === 0) break;

      switch (field.id) {
        case 1: // type
          element.type = this.parquetTypeToString(decoder.readI32());
          break;
        case 4: // name
          element.name = decoder.readString();
          break;
        case 5: // num_children
          element.numChildren = decoder.readI32();
          break;
        case 6: // converted_type
          element.convertedType = this.convertedTypeToString(decoder.readI32());
          break;
        case 7: // repetition_type
          element.repetitionType = this.repetitionTypeToString(decoder.readI32());
          break;
        default:
          decoder.skip(field.type);
      }
    }

    return element;
  }

  /**
   * Parse row group list from Thrift
   */
  private parseRowGroupList(decoder: ThriftDecoder): RowGroupMetadata[] {
    const listHeader = decoder.readListHeader();
    const rowGroups: RowGroupMetadata[] = [];

    for (let i = 0; i < listHeader.size; i++) {
      rowGroups.push(this.parseRowGroup(decoder));
    }

    return rowGroups;
  }

  /**
   * Parse a single row group
   */
  private parseRowGroup(decoder: ThriftDecoder): RowGroupMetadata {
    const rg: RowGroupMetadata = {
      columns: [],
      totalByteSize: 0,
      rowCount: 0,
    };

    while (decoder.hasMore()) {
      const field = decoder.readFieldHeader();
      if (field.type === 0) break;

      switch (field.id) {
        case 1: // columns
          rg.columns = this.parseColumnChunkList(decoder);
          break;
        case 2: // total_byte_size
          rg.totalByteSize = Number(decoder.readI64());
          break;
        case 3: // num_rows
          rg.rowCount = Number(decoder.readI64());
          break;
        default:
          decoder.skip(field.type);
      }
    }

    return rg;
  }

  /**
   * Parse column chunk list
   */
  private parseColumnChunkList(decoder: ThriftDecoder): ColumnChunkMetadata[] {
    const listHeader = decoder.readListHeader();
    const columns: ColumnChunkMetadata[] = [];

    for (let i = 0; i < listHeader.size; i++) {
      columns.push(this.parseColumnChunk(decoder));
    }

    return columns;
  }

  /**
   * Parse a single column chunk
   */
  private parseColumnChunk(decoder: ThriftDecoder): ColumnChunkMetadata {
    const chunk: ColumnChunkMetadata = {
      path: [],
      offset: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      codec: 'UNCOMPRESSED',
      numValues: 0,
    };

    while (decoder.hasMore()) {
      const field = decoder.readFieldHeader();
      if (field.type === 0) break;

      switch (field.id) {
        case 2: // meta_data (ColumnMetaData)
          this.parseColumnMetaData(decoder, chunk);
          break;
        default:
          decoder.skip(field.type);
      }
    }

    return chunk;
  }

  /**
   * Parse column metadata
   */
  private parseColumnMetaData(decoder: ThriftDecoder, chunk: ColumnChunkMetadata): void {
    while (decoder.hasMore()) {
      const field = decoder.readFieldHeader();
      if (field.type === 0) break;

      switch (field.id) {
        case 1: // type
          decoder.readI32(); // Skip type
          break;
        case 2: // encodings
          decoder.skip(field.type);
          break;
        case 3: // path_in_schema
          const pathHeader = decoder.readListHeader();
          for (let i = 0; i < pathHeader.size; i++) {
            chunk.path.push(decoder.readString());
          }
          break;
        case 4: // codec
          chunk.codec = this.codecToString(decoder.readI32());
          break;
        case 5: // num_values
          chunk.numValues = Number(decoder.readI64());
          break;
        case 6: // total_uncompressed_size
          chunk.uncompressedSize = Number(decoder.readI64());
          break;
        case 7: // total_compressed_size
          chunk.compressedSize = Number(decoder.readI64());
          break;
        case 9: // data_page_offset
          chunk.offset = Number(decoder.readI64());
          break;
        default:
          decoder.skip(field.type);
      }
    }
  }

  /**
   * Parse column values from decompressed data
   */
  private parseColumnValues(
    data: Uint8Array,
    columnName: string,
    numValues: number
  ): unknown[] {
    // Skip page header
    const { offset: dataOffset, definitionLevels } = this.parsePageHeader(data, numValues);

    const values: unknown[] = [];
    const view = new DataView(data.buffer, data.byteOffset + dataOffset, data.byteLength - dataOffset);

    // Determine column type and parse accordingly
    if (
      columnName === '$id' ||
      columnName === 'title' ||
      columnName === 'description' ||
      columnName === 'wikidata_id' ||
      columnName === 'content' ||
      columnName === '$type'
    ) {
      // String columns
      return this.parseStringColumn(data.slice(dataOffset), numValues, definitionLevels);
    } else if (columnName === 'coords_lat' || columnName === 'coords_lon') {
      // Float columns
      return this.parseFloatColumn(view, numValues, definitionLevels);
    } else if (columnName === 'updated_at') {
      // Timestamp column (INT64)
      return this.parseInt64Column(view, numValues, definitionLevels);
    } else if (columnName === 'infobox') {
      // JSON/Variant column
      return this.parseJsonColumn(data.slice(dataOffset), numValues, definitionLevels);
    }

    return values;
  }

  /**
   * Parse page header to get data offset and definition levels
   */
  private parsePageHeader(
    _data: Uint8Array,
    _numValues: number
  ): { offset: number; definitionLevels: number[] | null } {
    // Simplified: assume data page v1 with no definition levels for required fields
    // In production, parse the full PageHeader Thrift struct

    // Return offset past header (estimate)
    return { offset: 0, definitionLevels: null };
  }

  /**
   * Parse string column using length-prefixed encoding
   */
  private parseStringColumn(
    data: Uint8Array,
    numValues: number,
    definitionLevels: number[] | null
  ): (string | null)[] {
    const values: (string | null)[] = [];
    const decoder = new TextDecoder();
    let offset = 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    for (let i = 0; i < numValues && offset < data.length - 4; i++) {
      if (definitionLevels && definitionLevels[i] === 0) {
        values.push(null);
        continue;
      }

      const length = view.getInt32(offset, true);
      offset += 4;

      if (length > 0 && offset + length <= data.length) {
        const str = decoder.decode(data.slice(offset, offset + length));
        values.push(str);
        offset += length;
      } else {
        values.push('');
      }
    }

    return values;
  }

  /**
   * Parse float column
   */
  private parseFloatColumn(
    view: DataView,
    numValues: number,
    definitionLevels: number[] | null
  ): (number | null)[] {
    const values: (number | null)[] = [];

    for (let i = 0; i < numValues && i * 4 < view.byteLength; i++) {
      if (definitionLevels && definitionLevels[i] === 0) {
        values.push(null);
        continue;
      }

      values.push(view.getFloat32(i * 4, true));
    }

    return values;
  }

  /**
   * Parse INT64 column
   */
  private parseInt64Column(
    view: DataView,
    numValues: number,
    definitionLevels: number[] | null
  ): (number | null)[] {
    const values: (number | null)[] = [];

    for (let i = 0; i < numValues && i * 8 < view.byteLength; i++) {
      if (definitionLevels && definitionLevels[i] === 0) {
        values.push(null);
        continue;
      }

      // Read as BigInt then convert to number (may lose precision for very large values)
      const low = view.getUint32(i * 8, true);
      const high = view.getInt32(i * 8 + 4, true);
      values.push(high * 0x100000000 + low);
    }

    return values;
  }

  /**
   * Parse JSON/Variant column
   */
  private parseJsonColumn(
    data: Uint8Array,
    numValues: number,
    definitionLevels: number[] | null
  ): (Record<string, unknown> | null)[] {
    const strings = this.parseStringColumn(data, numValues, definitionLevels);
    return strings.map((s) => {
      if (s === null) return null;
      try {
        return JSON.parse(s);
      } catch {
        return null;
      }
    });
  }

  /**
   * Format timestamp as ISO string
   */
  private formatDate(timestamp: number | null | undefined): string {
    if (timestamp === null || timestamp === undefined) {
      return new Date().toISOString();
    }
    return new Date(timestamp).toISOString();
  }

  /**
   * Compare byte arrays
   */
  private bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Convert Parquet type enum to string
   */
  private parquetTypeToString(type: number): string {
    const types = [
      'BOOLEAN',
      'INT32',
      'INT64',
      'INT96',
      'FLOAT',
      'DOUBLE',
      'BYTE_ARRAY',
      'FIXED_LEN_BYTE_ARRAY',
    ];
    return types[type] ?? 'UNKNOWN';
  }

  /**
   * Convert converted type enum to string
   */
  private convertedTypeToString(type: number): string {
    const types: Record<number, string> = {
      0: 'UTF8',
      1: 'MAP',
      2: 'MAP_KEY_VALUE',
      3: 'LIST',
      5: 'ENUM',
      6: 'DECIMAL',
      7: 'DATE',
      8: 'TIME_MILLIS',
      9: 'TIME_MICROS',
      10: 'TIMESTAMP_MILLIS',
      11: 'TIMESTAMP_MICROS',
      12: 'UINT_8',
      13: 'UINT_16',
      14: 'UINT_32',
      15: 'UINT_64',
      16: 'INT_8',
      17: 'INT_16',
      18: 'INT_32',
      19: 'INT_64',
      20: 'JSON',
      21: 'BSON',
      22: 'INTERVAL',
    };
    return types[type] ?? 'NONE';
  }

  /**
   * Convert repetition type enum to string
   */
  private repetitionTypeToString(type: number): string {
    const types = ['REQUIRED', 'OPTIONAL', 'REPEATED'];
    return types[type] ?? 'REQUIRED';
  }

  /**
   * Convert codec enum to string
   */
  private codecToString(codec: number): string {
    const codecs = ['UNCOMPRESSED', 'SNAPPY', 'GZIP', 'LZO', 'BROTLI', 'LZ4', 'ZSTD', 'LZ4_RAW'];
    return codecs[codec] ?? 'UNCOMPRESSED';
  }

  /**
   * Clear metadata cache
   */
  clearCache(): void {
    this.metadataCache.clear();
    this.footerCache.clear();
  }
}

/**
 * Create an R2 Parquet reader
 */
export function createR2ParquetReader(bucket: R2Bucket): R2ParquetReader {
  return new R2ParquetReader(bucket);
}
