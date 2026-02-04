// @ts-nocheck - Complex Parquet schema and hyparquet-writer library interactions requiring extensive type guards
/**
 * Article Parquet Writer
 *
 * Writes Wikipedia articles to Parquet format with:
 * - Shredded columns for fast filtering ($id, $type, title, etc.)
 * - Variant type for flexible infobox schemas
 * - Configurable row group size and file size limits
 */

import {
  parquetWriteBuffer,
  createShreddedVariantColumn,
} from '@dotdo/hyparquet-writer';
import type { SchemaElement } from '@dotdo/hyparquet';
import type {
  ArticleRecord,
  ArticleWriterConfig,
  WriteResult,
  ShreddedInfoboxFields,
} from './types.js';
import { SHREDDED_INFOBOX_FIELDS } from './types.js';

/** Default configuration values */
const DEFAULT_ROW_GROUP_SIZE = 10000;
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const DEFAULT_PAGE_SIZE = 1024 * 1024; // 1MB

/**
 * ArticleParquetWriter - Writes article records to Parquet files
 *
 * Features:
 * - Shredded variant columns for infobox data (enables predicate pushdown)
 * - Automatic file rollover at size limit
 * - Snappy compression for efficient storage
 * - Column statistics for query optimization
 */
export class ArticleParquetWriter {
  private readonly config: Required<ArticleWriterConfig>;
  private buffer: ArticleRecord[] = [];
  private currentFileIndex = 0;
  private writtenFiles: WriteResult[] = [];
  private totalRows = 0;

  constructor(config: ArticleWriterConfig) {
    this.config = {
      outputDir: config.outputDir,
      rowGroupSize: config.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE,
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      statistics: config.statistics ?? true,
      bloomFilters: config.bloomFilters ?? true,
    };
  }

  /**
   * Add articles to the write buffer
   * Will automatically flush when buffer exceeds row group size
   */
  async write(articles: ArticleRecord[]): Promise<void> {
    this.buffer.push(...articles);

    // Flush when buffer reaches row group size
    while (this.buffer.length >= this.config.rowGroupSize) {
      await this.flushRowGroup();
    }
  }

  /**
   * Write a single article
   */
  async writeOne(article: ArticleRecord): Promise<void> {
    await this.write([article]);
  }

  /**
   * Flush current buffer to Parquet file
   * Creates a new file if current exceeds size limit
   */
  async flush(): Promise<WriteResult | null> {
    if (this.buffer.length === 0) {
      return null;
    }

    return this.flushRowGroup();
  }

  /**
   * Finalize writing and return all written files
   */
  async finalize(): Promise<WriteResult[]> {
    // Flush any remaining buffered data
    if (this.buffer.length > 0) {
      await this.flush();
    }

    return this.writtenFiles;
  }

  /**
   * Get statistics about written data
   */
  getStats(): { totalRows: number; totalFiles: number; totalBytes: number } {
    return {
      totalRows: this.totalRows,
      totalFiles: this.writtenFiles.length,
      totalBytes: this.writtenFiles.reduce((sum, f) => sum + f.size, 0),
    };
  }

  /**
   * Flush a row group worth of data
   */
  private async flushRowGroup(): Promise<WriteResult> {
    const rowGroupSize = Math.min(this.buffer.length, this.config.rowGroupSize);
    const articles = this.buffer.splice(0, rowGroupSize);

    const buffer = this.writeArticlesToBuffer(articles);
    const result = await this.saveBuffer(buffer, articles.length);

    this.totalRows += articles.length;

    return result;
  }

  /**
   * Write articles to an ArrayBuffer
   */
  private writeArticlesToBuffer(articles: ArticleRecord[]): ArrayBuffer {
    const { schema, columnData } = this.buildColumnData(articles);

    return parquetWriteBuffer({
      columnData,
      schema,
      statistics: this.config.statistics,
      rowGroupSize: this.config.rowGroupSize,
      pageSize: DEFAULT_PAGE_SIZE,
      kvMetadata: [
        { key: 'writer', value: 'wikipedia.org.ai' },
        { key: 'version', value: '1.0.0' },
      ],
    });
  }

  /**
   * Build schema and column data for articles
   */
  private buildColumnData(articles: ArticleRecord[]): {
    schema: SchemaElement[];
    columnData: Array<{ name: string; data: unknown[] }>;
  } {
    // Extract infobox objects for shredding
    const infoboxes = articles.map((a) => a.infobox ?? {});

    // Create shredded variant column for infobox
    const { schema: infoboxSchema } =
      createShreddedVariantColumn(
        'infobox',
        infoboxes,
        [...SHREDDED_INFOBOX_FIELDS],
        {
          nullable: true,
          fieldTypes: {
            population: 'INT64',
          },
        }
      );

    // Build complete schema
    // Root element with all children (9 base + infobox group)
    const baseChildCount = 9; // $id, $type, title, description, wikidata_id, coords_lat, coords_lon, content, updated_at
    const schema: SchemaElement[] = [
      { name: 'root', num_children: baseChildCount + 1 }, // +1 for infobox group
      {
        name: '$id',
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        repetition_type: 'REQUIRED',
      },
      {
        name: '$type',
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        repetition_type: 'REQUIRED',
      },
      {
        name: 'title',
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        repetition_type: 'REQUIRED',
      },
      {
        name: 'description',
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        repetition_type: 'REQUIRED',
      },
      {
        name: 'wikidata_id',
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        repetition_type: 'OPTIONAL',
      },
      { name: 'coords_lat', type: 'FLOAT', repetition_type: 'OPTIONAL' },
      { name: 'coords_lon', type: 'FLOAT', repetition_type: 'OPTIONAL' },
      // Infobox shredded variant schema inserted here
      ...infoboxSchema,
      {
        name: 'content',
        type: 'BYTE_ARRAY',
        converted_type: 'UTF8',
        repetition_type: 'REQUIRED',
      },
      {
        name: 'updated_at',
        type: 'INT64',
        converted_type: 'TIMESTAMP_MILLIS',
        repetition_type: 'REQUIRED',
      },
    ];

    // Build column data arrays
    const columnData: Array<{ name: string; data: unknown[] }> = [
      { name: '$id', data: articles.map((a) => a.$id) },
      { name: '$type', data: articles.map((a) => a.$type) },
      { name: 'title', data: articles.map((a) => a.title) },
      { name: 'description', data: articles.map((a) => a.description) },
      { name: 'wikidata_id', data: articles.map((a) => a.wikidata_id) },
      { name: 'coords_lat', data: articles.map((a) => a.coords_lat) },
      { name: 'coords_lon', data: articles.map((a) => a.coords_lon) },
      // Infobox column data (shredded variant)
      { name: 'infobox', data: infoboxes },
      { name: 'content', data: articles.map((a) => a.content) },
      {
        name: 'updated_at',
        data: articles.map((a) => {
          // hyparquet-writer expects Date objects for TIMESTAMP_MILLIS
          const date = a.updated_at instanceof Date ? a.updated_at : new Date(a.updated_at as unknown as string);
          return isNaN(date.getTime()) ? new Date() : date;
        }),
      },
    ];

    return { schema, columnData };
  }

  /**
   * Save buffer to file, handling size limits
   */
  private async saveBuffer(
    buffer: ArrayBuffer,
    rowCount: number
  ): Promise<WriteResult> {
    const path = this.generateFilePath();

    // Check if we need to roll over to new file
    const lastFile = this.writtenFiles[this.writtenFiles.length - 1];
    if (lastFile && lastFile.size + buffer.byteLength > this.config.maxFileSize) {
      this.currentFileIndex++;
    }

    const result: WriteResult = {
      path,
      size: buffer.byteLength,
      rowCount,
      rowGroups: 1,
    };

    // Write to filesystem (platform-specific)
    await this.writeToFile(path, buffer);

    this.writtenFiles.push(result);
    return result;
  }

  /**
   * Generate file path for current write
   */
  private generateFilePath(): string {
    return `${this.config.outputDir}/articles.${this.currentFileIndex}.parquet`;
  }

  /**
   * Platform-specific file write
   */
  private async writeToFile(path: string, buffer: ArrayBuffer): Promise<void> {
    // Use Bun's file API if available, otherwise Node's fs
    if (typeof Bun !== 'undefined') {
      await Bun.write(path, buffer);
    } else {
      // Node.js fallback
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');

      // Ensure directory exists
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(buffer));
    }
  }
}

/**
 * Create a simple article buffer for writing
 * Useful for one-shot writes without the full writer class
 */
export function writeArticlesToBuffer(articles: ArticleRecord[]): ArrayBuffer {
  const writer = new ArticleParquetWriter({
    outputDir: '/tmp', // Not used for buffer-only writes
    rowGroupSize: articles.length,
  });

  // Access private method via any cast for simple API
  return (writer as unknown as { writeArticlesToBuffer(a: ArticleRecord[]): ArrayBuffer }).writeArticlesToBuffer(articles);
}

/**
 * Infer common infobox fields from articles for schema optimization
 */
export function inferShreddedFields(
  articles: ArticleRecord[]
): ShreddedInfoboxFields {
  const fields: ShreddedInfoboxFields = {};

  for (const article of articles) {
    if (!article.infobox) continue;

    const infobox = article.infobox as Record<string, unknown>;

    // Check for common fields
    if ('birth_date' in infobox && typeof infobox.birth_date === 'string') {
      fields.birth_date = infobox.birth_date;
    }
    if ('death_date' in infobox && typeof infobox.death_date === 'string') {
      fields.death_date = infobox.death_date;
    }
    if ('country' in infobox && typeof infobox.country === 'string') {
      fields.country = infobox.country;
    }
    if ('population' in infobox && typeof infobox.population === 'number') {
      fields.population = infobox.population;
    }
    if ('founded' in infobox && typeof infobox.founded === 'string') {
      fields.founded = infobox.founded;
    }
    if ('release_date' in infobox && typeof infobox.release_date === 'string') {
      fields.release_date = infobox.release_date;
    }
    if ('start_date' in infobox && typeof infobox.start_date === 'string') {
      fields.start_date = infobox.start_date;
    }
    if ('end_date' in infobox && typeof infobox.end_date === 'string') {
      fields.end_date = infobox.end_date;
    }
  }

  return fields;
}

/**
 * Streaming article writer for large datasets
 * Handles backpressure and memory management
 */
export class StreamingArticleWriter {
  private writer: ArticleParquetWriter;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(config: ArticleWriterConfig) {
    this.writer = new ArticleParquetWriter(config);
  }

  /**
   * Write articles with backpressure handling
   */
  async write(articles: ArticleRecord[]): Promise<void> {
    if (this.closed) {
      throw new Error('Writer is closed');
    }

    // Chain writes to maintain order
    this.pending = this.pending.then(() => this.writer.write(articles));
    await this.pending;
  }

  /**
   * Write a single article
   */
  async writeOne(article: ArticleRecord): Promise<void> {
    await this.write([article]);
  }

  /**
   * Close the writer and return results
   */
  async close(): Promise<WriteResult[]> {
    if (this.closed) {
      throw new Error('Writer already closed');
    }

    this.closed = true;
    await this.pending;
    return this.writer.finalize();
  }

  /**
   * Get current statistics
   */
  getStats(): { totalRows: number; totalFiles: number; totalBytes: number } {
    return this.writer.getStats();
  }
}
