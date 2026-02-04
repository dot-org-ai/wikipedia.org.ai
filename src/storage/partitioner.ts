// @ts-nocheck - Complex Parquet schema operations with hyparquet-writer
/**
 * Type-based Partitioner
 *
 * Routes articles to type-specific Parquet files with:
 * - Automatic file rollover at size limits
 * - Manifest generation for discovery
 * - Partition paths: data/{type}/{type}.{shard}.parquet
 */

import { parquetWriteBuffer } from '@dotdo/hyparquet-writer';
import type { SchemaElement } from '@dotdo/hyparquet';
import type {
  ArticleRecord,
  ArticleType,
  PartitionedWriterConfig,
  WriteResult,
  Manifest,
  ManifestFile,
} from './types.js';
import { ARTICLE_TYPES } from './types.js';

/** Default configuration values */
const DEFAULT_ROW_GROUP_SIZE = 10000;
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const DEFAULT_DATA_PATH = 'data';

/**
 * Per-partition buffer state
 */
interface PartitionState {
  /** Buffered articles */
  buffer: ArticleRecord[];
  /** Current shard index */
  shardIndex: number;
  /** Written files for this partition */
  files: WriteResult[];
  /** Total rows in this partition */
  totalRows: number;
  /** Total bytes in this partition */
  totalBytes: number;
}

/**
 * PartitionedWriter - Routes articles to type-specific Parquet files
 *
 * Features:
 * - Separate files per article type for efficient queries
 * - Automatic shard rollover at file size limit
 * - Manifest generation for dataset discovery
 * - Memory-efficient streaming writes
 */
export class PartitionedWriter {
  private readonly config: Required<PartitionedWriterConfig>;
  private readonly partitions: Map<ArticleType, PartitionState>;
  private closed = false;

  constructor(config: PartitionedWriterConfig) {
    this.config = {
      outputDir: config.outputDir,
      rowGroupSize: config.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE,
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
      statistics: config.statistics ?? true,
      bloomFilters: config.bloomFilters ?? true,
      dataPath: config.dataPath ?? DEFAULT_DATA_PATH,
    };

    // Initialize partition states
    this.partitions = new Map();
    for (const type of ARTICLE_TYPES) {
      this.partitions.set(type, {
        buffer: [],
        shardIndex: 0,
        files: [],
        totalRows: 0,
        totalBytes: 0,
      });
    }
  }

  /**
   * Write articles to appropriate partitions
   */
  async write(articles: ArticleRecord[]): Promise<void> {
    if (this.closed) {
      throw new Error('Writer is closed');
    }

    // Route articles to their type partitions
    for (const article of articles) {
      const partition = this.partitions.get(article.$type);
      if (!partition) {
        throw new Error(`Unknown article type: ${article.$type}`);
      }

      partition.buffer.push(article);

      // Flush when buffer reaches row group size
      if (partition.buffer.length >= this.config.rowGroupSize) {
        await this.flushPartition(article.$type);
      }
    }
  }

  /**
   * Write a single article
   */
  async writeOne(article: ArticleRecord): Promise<void> {
    await this.write([article]);
  }

  /**
   * Flush all partitions
   */
  async flush(): Promise<void> {
    for (const type of ARTICLE_TYPES) {
      await this.flushPartition(type);
    }
  }

  /**
   * Finalize writing and generate manifest
   */
  async finalize(): Promise<Manifest> {
    if (this.closed) {
      throw new Error('Writer already closed');
    }

    this.closed = true;

    // Flush remaining buffers
    await this.flush();

    // Build manifest
    const manifest = this.buildManifest();

    // Write manifest file
    await this.writeManifest(manifest);

    return manifest;
  }

  /**
   * Get statistics for all partitions
   */
  getStats(): {
    byType: Record<ArticleType, { rows: number; files: number; bytes: number }>;
    total: { rows: number; files: number; bytes: number };
  } {
    const byType: Record<ArticleType, { rows: number; files: number; bytes: number }> =
      {} as Record<ArticleType, { rows: number; files: number; bytes: number }>;

    let totalRows = 0;
    let totalFiles = 0;
    let totalBytes = 0;

    for (const [type, state] of this.partitions) {
      byType[type] = {
        rows: state.totalRows,
        files: state.files.length,
        bytes: state.totalBytes,
      };
      totalRows += state.totalRows;
      totalFiles += state.files.length;
      totalBytes += state.totalBytes;
    }

    return {
      byType,
      total: { rows: totalRows, files: totalFiles, bytes: totalBytes },
    };
  }

  /**
   * Flush a single partition's buffer
   */
  private async flushPartition(type: ArticleType): Promise<void> {
    const partition = this.partitions.get(type)!;
    if (partition.buffer.length === 0) {
      return;
    }

    const articles = partition.buffer.splice(0, partition.buffer.length);
    const buffer = this.writeArticlesToBuffer(articles);

    // Check if we need to roll over to new shard
    const lastFile = partition.files[partition.files.length - 1];
    if (lastFile && partition.totalBytes + buffer.byteLength > this.config.maxFileSize * partition.files.length) {
      // Current shard is full, check if adding to it would exceed limit
      const currentShardBytes = partition.files
        .filter(f => f.path.includes(`.${partition.shardIndex}.`))
        .reduce((sum, f) => sum + f.size, 0);

      if (currentShardBytes + buffer.byteLength > this.config.maxFileSize) {
        partition.shardIndex++;
      }
    }

    const path = this.generatePartitionPath(type, partition.shardIndex);
    await this.writeToFile(path, buffer);

    const result: WriteResult = {
      path,
      size: buffer.byteLength,
      rowCount: articles.length,
      rowGroups: 1,
    };

    partition.files.push(result);
    partition.totalRows += articles.length;
    partition.totalBytes += buffer.byteLength;
  }

  /**
   * Write articles to an ArrayBuffer
   * Uses simple JSON for infobox (Variant shredding can be added later)
   */
  private writeArticlesToBuffer(articles: ArticleRecord[]): ArrayBuffer {
    // Convert infobox to JSON strings (simpler than Variant for now)
    const infoboxJsons = articles.map((a) =>
      a.infobox ? JSON.stringify(a.infobox) : null
    );

    // Build schema - simple flat structure
    const schema: SchemaElement[] = [
      { name: 'root', num_children: 10 },
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
      {
        name: 'infobox',
        type: 'BYTE_ARRAY',
        converted_type: 'JSON',
        repetition_type: 'OPTIONAL',
      },
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

    // Build column data
    const columnData = [
      { name: '$id', data: articles.map((a) => a.$id) },
      { name: '$type', data: articles.map((a) => a.$type) },
      { name: 'title', data: articles.map((a) => a.title) },
      { name: 'description', data: articles.map((a) => a.description) },
      { name: 'wikidata_id', data: articles.map((a) => a.wikidata_id) },
      { name: 'coords_lat', data: articles.map((a) => a.coords_lat) },
      { name: 'coords_lon', data: articles.map((a) => a.coords_lon) },
      { name: 'infobox', data: infoboxJsons },
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

    return parquetWriteBuffer({
      columnData,
      schema,
      statistics: this.config.statistics,
      rowGroupSize: this.config.rowGroupSize,
      kvMetadata: [
        { key: 'writer', value: 'wikipedia.org.ai' },
        { key: 'version', value: '1.0.0' },
        { key: 'partition_type', value: 'type' },
      ],
    });
  }

  /**
   * Generate partition file path
   */
  private generatePartitionPath(type: ArticleType, shard: number): string {
    return `${this.config.outputDir}/${this.config.dataPath}/${type}/${type}.${shard}.parquet`;
  }

  /**
   * Build the manifest object
   */
  private buildManifest(): Manifest {
    const dataFiles: ManifestFile[] = [];
    const articlesByType: Record<ArticleType, number> = {} as Record<ArticleType, number>;
    let totalArticles = 0;

    for (const [type, state] of this.partitions) {
      articlesByType[type] = state.totalRows;
      totalArticles += state.totalRows;

      for (const file of state.files) {
        const shardMatch = file.path.match(/\.(\d+)\.parquet$/);
        const shard = shardMatch ? parseInt(shardMatch[1], 10) : 0;

        dataFiles.push({
          path: file.path.replace(this.config.outputDir + '/', ''),
          size: file.size,
          rowCount: file.rowCount,
          rowGroups: file.rowGroups,
          type,
          shard,
        });
      }
    }

    return {
      version: '1.0.0',
      created_at: new Date().toISOString(),
      totalArticles,
      articlesByType,
      dataFiles,
      forwardRelFiles: [],
      reverseRelFiles: [],
      indexFiles: {
        titles: 'indexes/titles.json.gz',
        types: 'indexes/types.json.gz',
        bloomFilters: [],
      },
    };
  }

  /**
   * Write manifest to file
   */
  private async writeManifest(manifest: Manifest): Promise<void> {
    const path = `${this.config.outputDir}/manifest.json`;
    const content = JSON.stringify(manifest, null, 2);

    if (typeof Bun !== 'undefined') {
      await Bun.write(path, content);
    } else {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
  }

  /**
   * Platform-specific file write
   */
  private async writeToFile(path: string, buffer: ArrayBuffer): Promise<void> {
    if (typeof Bun !== 'undefined') {
      await Bun.write(path, buffer);
    } else {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(buffer));
    }
  }
}

/**
 * Create a partitioned writer with default settings
 */
export function createPartitionedWriter(outputDir: string): PartitionedWriter {
  return new PartitionedWriter({ outputDir });
}

/**
 * Streaming partitioned writer for large datasets
 * Handles backpressure and maintains write order per partition
 */
export class StreamingPartitionedWriter {
  private writer: PartitionedWriter;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(config: PartitionedWriterConfig) {
    this.writer = new PartitionedWriter(config);
  }

  /**
   * Write articles with backpressure handling
   */
  async write(articles: ArticleRecord[]): Promise<void> {
    if (this.closed) {
      throw new Error('Writer is closed');
    }

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
   * Close and finalize
   */
  async close(): Promise<Manifest> {
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
  getStats() {
    return this.writer.getStats();
  }
}

/**
 * Utility to merge multiple manifests (for parallel writes)
 */
export function mergeManifests(manifests: Manifest[]): Manifest {
  if (manifests.length === 0) {
    throw new Error('No manifests to merge');
  }

  const merged: Manifest = {
    version: manifests[0].version,
    created_at: new Date().toISOString(),
    totalArticles: 0,
    articlesByType: {} as Record<ArticleType, number>,
    dataFiles: [],
    forwardRelFiles: [],
    reverseRelFiles: [],
    indexFiles: {
      titles: 'indexes/titles.json.gz',
      types: 'indexes/types.json.gz',
      bloomFilters: [],
    },
  };

  // Initialize type counts
  for (const type of ARTICLE_TYPES) {
    merged.articlesByType[type] = 0;
  }

  // Merge all manifests
  for (const manifest of manifests) {
    merged.totalArticles += manifest.totalArticles;

    for (const type of ARTICLE_TYPES) {
      merged.articlesByType[type] += manifest.articlesByType[type] ?? 0;
    }

    merged.dataFiles.push(...manifest.dataFiles);
    merged.forwardRelFiles.push(...manifest.forwardRelFiles);
    merged.reverseRelFiles.push(...manifest.reverseRelFiles);
    merged.indexFiles.bloomFilters.push(...manifest.indexFiles.bloomFilters);
  }

  return merged;
}
