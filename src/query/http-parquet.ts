/**
 * HTTP Range request Parquet reader
 *
 * Implements the AsyncBuffer interface for hyparquet to read Parquet files
 * from HTTP servers using Range requests. This allows efficient partial reads
 * without downloading entire files.
 */

import { parquetMetadataAsync, parquetRead } from '@dotdo/hyparquet';
import type { AsyncBuffer } from '@dotdo/hyparquet';
import type {
  HyparquetRawMetadata,
  HyparquetSchemaElement,
  HyparquetRowGroup,
  HyparquetColumnChunk,
} from '../types/hyparquet.js';
import type {
  ColumnChunkInfo,
  ParquetMetadata,
  RowGroupInfo,
  SchemaElement,
} from './browser-types.js';

/**
 * Error thrown when HTTP requests fail
 */
export class HttpParquetError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string
  ) {
    super(message);
    this.name = 'HttpParquetError';
  }
}

/**
 * AsyncBuffer implementation for hyparquet that reads from HTTP using Range requests.
 *
 * This is the internal buffer class that implements the AsyncBuffer interface.
 * Use HttpParquetReader for a higher-level API.
 */
class HttpAsyncBuffer implements AsyncBuffer {
  readonly byteLength: number;
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly rangeCache: Map<string, ArrayBuffer> = new Map();
  private readonly maxCacheSize: number;

  constructor(
    url: string,
    byteLength: number,
    fetchFn: typeof fetch,
    maxCacheSize: number
  ) {
    this.url = url;
    this.byteLength = byteLength;
    this.fetchFn = fetchFn;
    this.maxCacheSize = maxCacheSize;
  }

  /**
   * Read a slice of the file using HTTP Range request
   * Implements the AsyncBuffer interface for hyparquet
   *
   * @param start - Start byte offset
   * @param end - End byte offset (exclusive)
   * @returns ArrayBuffer containing the requested bytes
   */
  async slice(start: number, end?: number): Promise<ArrayBuffer> {
    const actualEnd = end ?? this.byteLength;

    // Validate range
    if (start < 0 || start >= this.byteLength) {
      throw new HttpParquetError(
        `Invalid start offset: ${start} (file length: ${this.byteLength})`,
        undefined,
        this.url
      );
    }

    if (actualEnd > this.byteLength) {
      throw new HttpParquetError(
        `Invalid end offset: ${actualEnd} (file length: ${this.byteLength})`,
        undefined,
        this.url
      );
    }

    // Check cache
    const cacheKey = `${start}-${actualEnd}`;
    const cached = this.rangeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // HTTP Range header is inclusive on both ends
    const rangeHeader = `bytes=${start}-${actualEnd - 1}`;

    const response = await this.fetchFn(this.url, {
      headers: {
        Range: rangeHeader,
      },
    });

    if (!response.ok && response.status !== 206) {
      throw new HttpParquetError(
        `Failed to read range ${rangeHeader}: ${response.status} ${response.statusText}`,
        response.status,
        this.url
      );
    }

    const buffer = await response.arrayBuffer();

    // Cache small-to-medium sized ranges
    if (buffer.byteLength <= this.maxCacheSize / 10) {
      this.addToCache(cacheKey, buffer);
    }

    return buffer;
  }

  /**
   * Add to range cache with LRU-style eviction
   */
  private addToCache(key: string, buffer: ArrayBuffer): void {
    // Calculate current cache size
    let currentSize = 0;
    for (const cached of this.rangeCache.values()) {
      currentSize += cached.byteLength;
    }

    // Evict oldest entries if needed
    while (currentSize + buffer.byteLength > this.maxCacheSize && this.rangeCache.size > 0) {
      const firstKey = this.rangeCache.keys().next().value;
      if (firstKey) {
        const removed = this.rangeCache.get(firstKey);
        if (removed) {
          currentSize -= removed.byteLength;
        }
        this.rangeCache.delete(firstKey);
      }
    }

    this.rangeCache.set(key, buffer);
  }

  /**
   * Clear the range cache
   */
  clearCache(): void {
    this.rangeCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; bytes: number } {
    let bytes = 0;
    for (const buffer of this.rangeCache.values()) {
      bytes += buffer.byteLength;
    }
    return { entries: this.rangeCache.size, bytes };
  }
}

/**
 * High-level HTTP Parquet reader
 *
 * Wraps HttpAsyncBuffer to provide convenient methods for reading Parquet files
 * from HTTP servers using Range requests.
 */
export class HttpParquetReader {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly maxCacheSize: number;
  private buffer: HttpAsyncBuffer | null = null;
  private metadataCache: ParquetMetadata | null = null;
  private initPromise: Promise<void> | null = null;

  /**
   * Create a new HTTP Parquet reader
   *
   * @param url - URL of the Parquet file
   * @param options - Optional configuration
   */
  constructor(
    url: string,
    options?: {
      fetch?: typeof fetch;
      maxCacheSize?: number;
    }
  ) {
    this.url = url;
    this.fetchFn = options?.fetch ?? fetch;
    // Default 10MB cache per file
    this.maxCacheSize = options?.maxCacheSize ?? 10 * 1024 * 1024;
  }

  /**
   * Initialize the reader by fetching file length
   * This must be called before using the reader with hyparquet
   */
  private async init(): Promise<void> {
    if (this.buffer) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const response = await this.fetchFn(this.url, {
        method: 'HEAD',
      });

      if (!response.ok) {
        throw new HttpParquetError(
          `Failed to get file length: ${response.status} ${response.statusText}`,
          response.status,
          this.url
        );
      }

      const contentLength = response.headers.get('content-length');
      if (!contentLength) {
        throw new HttpParquetError(
          'Server did not return Content-Length header',
          undefined,
          this.url
        );
      }

      const byteLength = parseInt(contentLength, 10);
      this.buffer = new HttpAsyncBuffer(
        this.url,
        byteLength,
        this.fetchFn,
        this.maxCacheSize
      );
    })();

    return this.initPromise;
  }

  /**
   * Get the underlying AsyncBuffer for use with hyparquet
   * Initializes the reader if not already done
   */
  async getBuffer(): Promise<AsyncBuffer> {
    await this.init();
    if (!this.buffer) {
      throw new HttpParquetError('Failed to initialize buffer', undefined, this.url);
    }
    return this.buffer;
  }

  /**
   * Get the total byte length of the file
   */
  async getByteLength(): Promise<number> {
    const buffer = await this.getBuffer();
    return buffer.byteLength;
  }

  /**
   * Read a slice of the file
   */
  async slice(start: number, end?: number): Promise<ArrayBuffer> {
    const buffer = await this.getBuffer();
    return buffer.slice(start, end);
  }

  /**
   * Get Parquet file metadata
   * Caches the result for subsequent calls
   */
  async getMetadata(): Promise<ParquetMetadata> {
    if (this.metadataCache) {
      return this.metadataCache;
    }

    const buffer = await this.getBuffer();

    // hyparquet's parquetMetadataAsync reads footer and metadata
    // Cast to our typed interface for proper type checking
    const metadata = (await parquetMetadataAsync(buffer)) as unknown as HyparquetRawMetadata;

    // Convert to our metadata format
    this.metadataCache = this.convertMetadata(metadata);
    return this.metadataCache;
  }

  /**
   * Convert hyparquet metadata to our format
   */
  private convertMetadata(raw: HyparquetRawMetadata): ParquetMetadata {
    const schema: SchemaElement[] = (raw.schema ?? []).map(
      (el: HyparquetSchemaElement) => ({
        name: el.name,
        type: el.type,
        convertedType: el.converted_type,
        repetitionType: el.repetition_type,
        numChildren: el.num_children,
      })
    );

    const rowGroups: RowGroupInfo[] = (raw.row_groups ?? []).map(
      (rg: HyparquetRowGroup, index: number) => {
        const columns: ColumnChunkInfo[] = (rg.columns ?? []).map(
          (col: HyparquetColumnChunk) => ({
            name: col.meta_data?.path_in_schema?.[0] ?? '',
            offset: Number(col.file_offset ?? col.meta_data?.data_page_offset ?? 0),
            compressedSize: Number(col.meta_data?.total_compressed_size ?? 0),
            uncompressedSize: Number(col.meta_data?.total_uncompressed_size ?? 0),
            numValues: Number(col.meta_data?.num_values ?? 0),
          })
        );

        return {
          index,
          numRows: Number(rg.num_rows ?? 0),
          offset: Number(rg.file_offset ?? columns[0]?.offset ?? 0),
          compressedSize: Number(rg.total_compressed_size ?? 0),
          columns,
        };
      }
    );

    return {
      schema,
      rowGroups,
      numRows: Number(raw.num_rows ?? 0),
      createdBy: raw.created_by,
    };
  }

  /**
   * Read a specific row group from the Parquet file
   *
   * @param index - Row group index (0-based)
   * @param columns - Optional column names to project
   * @returns Array of row objects
   */
  async readRowGroup<T = Record<string, unknown>>(
    index: number,
    columns?: string[]
  ): Promise<T[]> {
    const buffer = await this.getBuffer();
    const metadata = await this.getMetadata();

    if (index < 0 || index >= metadata.rowGroups.length) {
      throw new HttpParquetError(
        `Invalid row group index: ${index} (file has ${metadata.rowGroups.length} row groups)`,
        undefined,
        this.url
      );
    }

    const rows: T[] = [];

    const readOptions: Parameters<typeof parquetRead>[0] = {
      file: buffer,
      rowStart: this.getRowStart(metadata, index),
      rowEnd: this.getRowEnd(metadata, index),
      onComplete: (data) => {
        rows.push(...(data as T[]));
      },
    };

    if (columns) {
      readOptions.columns = columns;
    }

    await parquetRead(readOptions);

    return rows;
  }

  /**
   * Read specific columns from the Parquet file
   *
   * @param columns - Column names to read
   * @param rowGroups - Optional row group indices (reads all if not specified)
   * @returns Array of row objects with only the specified columns
   */
  async readColumns<T = Record<string, unknown>>(
    columns: string[],
    rowGroups?: number[]
  ): Promise<T[]> {
    const buffer = await this.getBuffer();
    const rows: T[] = [];

    if (rowGroups) {
      // Read specific row groups
      for (const rgIndex of rowGroups) {
        const rgRows = await this.readRowGroup<T>(rgIndex, columns);
        rows.push(...rgRows);
      }
    } else {
      // Read all data with column projection
      await parquetRead({
        file: buffer,
        columns,
        onComplete: (data) => {
          rows.push(...(data as T[]));
        },
      });
    }

    return rows;
  }

  /**
   * Read a single row by row group and row index
   *
   * @param rowGroup - Row group index
   * @param rowIndex - Row index within the row group
   * @param columns - Optional column projection
   * @returns Single row object or null if not found
   */
  async readRow<T = Record<string, unknown>>(
    rowGroup: number,
    rowIndex: number,
    columns?: string[]
  ): Promise<T | null> {
    const buffer = await this.getBuffer();
    const metadata = await this.getMetadata();

    if (rowGroup < 0 || rowGroup >= metadata.rowGroups.length) {
      return null;
    }

    const rgInfo = metadata.rowGroups[rowGroup];
    if (!rgInfo || rowIndex < 0 || rowIndex >= rgInfo.numRows) {
      return null;
    }

    const absoluteRow = this.getRowStart(metadata, rowGroup) + rowIndex;
    let result: T | null = null;

    const readOptions: Parameters<typeof parquetRead>[0] = {
      file: buffer,
      rowStart: absoluteRow,
      rowEnd: absoluteRow + 1,
      onComplete: (data) => {
        if (data.length > 0) {
          result = data[0] as T;
        }
      },
    };

    if (columns) {
      readOptions.columns = columns;
    }

    await parquetRead(readOptions);

    return result;
  }

  /**
   * Stream rows from the file with optional filtering
   *
   * @param options - Read options
   * @yields Row objects
   */
  async *streamRows<T = Record<string, unknown>>(options?: {
    columns?: string[];
    rowGroups?: number[];
    batchSize?: number;
  }): AsyncGenerator<T, void, unknown> {
    const buffer = await this.getBuffer();
    const metadata = await this.getMetadata();
    const batchSize = options?.batchSize ?? 1000;
    const rowGroupIndices = options?.rowGroups ?? metadata.rowGroups.map((_, i) => i);

    for (const rgIndex of rowGroupIndices) {
      const rgInfo = metadata.rowGroups[rgIndex];
      if (!rgInfo) continue;
      const numRows = rgInfo.numRows;

      for (let offset = 0; offset < numRows; offset += batchSize) {
        const rowStart = this.getRowStart(metadata, rgIndex) + offset;
        const rowEnd = Math.min(rowStart + batchSize, this.getRowEnd(metadata, rgIndex));

        const batch: T[] = [];

        const readOptions: Parameters<typeof parquetRead>[0] = {
          file: buffer,
          rowStart,
          rowEnd,
          onComplete: (data) => {
            batch.push(...(data as T[]));
          },
        };

        if (options?.columns) {
          readOptions.columns = options.columns;
        }

        await parquetRead(readOptions);

        for (const row of batch) {
          yield row;
        }
      }
    }
  }

  /**
   * Get the absolute row start for a row group
   */
  private getRowStart(metadata: ParquetMetadata, rowGroupIndex: number): number {
    let start = 0;
    for (let i = 0; i < rowGroupIndex; i++) {
      const rg = metadata.rowGroups[i];
      if (rg) {
        start += rg.numRows;
      }
    }
    return start;
  }

  /**
   * Get the absolute row end for a row group
   */
  private getRowEnd(metadata: ParquetMetadata, rowGroupIndex: number): number {
    const rg = metadata.rowGroups[rowGroupIndex];
    const numRows = rg?.numRows ?? 0;
    return this.getRowStart(metadata, rowGroupIndex) + numRows;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.buffer?.clearCache();
    this.metadataCache = null;
    this.buffer = null;
    this.initPromise = null;
  }

  /**
   * Get the URL of this reader
   */
  getUrl(): string {
    return this.url;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { entries: number; bytes: number } {
    return this.buffer?.getCacheStats() ?? { entries: 0, bytes: 0 };
  }
}

/**
 * Create an HttpParquetReader for a URL
 *
 * @param url - URL of the Parquet file
 * @param options - Optional configuration
 * @returns HttpParquetReader instance
 */
export function createHttpParquetReader(
  url: string,
  options?: {
    fetch?: typeof fetch;
    maxCacheSize?: number;
  }
): HttpParquetReader {
  return new HttpParquetReader(url, options);
}
