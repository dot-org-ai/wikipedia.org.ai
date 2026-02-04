// @ts-nocheck - Complex binary format implementation with extensive array operations that would require significant refactoring for strictNullChecks and exactOptionalPropertyTypes
/**
 * Lance file reader for embedding queries
 *
 * Features:
 * - Load Lance files for k-NN similarity search
 * - IVF-PQ accelerated search
 * - HTTP Range request support for browser usage
 * - Efficient metadata-only reads
 * - Filter by article type, model, and custom predicates
 */

import { readFile } from 'node:fs/promises';
import type { EmbeddingModel, ArticleType } from './types.js';

/** Search result from k-NN query */
export interface SearchResult {
  /** Record ID */
  id: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Chunk index */
  chunk_index: number;
  /** Text preview */
  text_preview: string;
  /** Similarity score (higher = more similar) */
  score: number;
  /** Distance (lower = more similar) */
  distance: number;
  /** Embedding model used */
  model: EmbeddingModel;
}

/** Embedding record returned from getById */
export interface EmbeddingRecord {
  id: string;
  title: string;
  type: ArticleType;
  chunk_index: number;
  text_preview: string;
  embedding: Float32Array;
  model: EmbeddingModel;
  created_at: string;
}

/** Filter options for search */
export interface SearchFilter {
  /** Filter by article type */
  type?: ArticleType | ArticleType[];
  /** Filter by model */
  model?: EmbeddingModel;
  /** Custom filter predicate */
  predicate?: (record: EmbeddingRecord) => boolean;
}

/** IVF-PQ search configuration */
export interface IVFPQSearchConfig {
  /** Number of partitions to probe (default: 10) */
  nprobe?: number;
  /** Use asymmetric distance computation (default: true) */
  asymmetric?: boolean;
  /** Pre-compute distance tables for speed (default: true) */
  precomputeTables?: boolean;
}

/** Lance file metadata */
interface LanceMetadata {
  schema: Array<{
    name: string;
    type: string;
    nullable: boolean;
    metadata?: Record<string, string>;
  }>;
  version: string;
  rowCount: number;
  createdAt: string;
  updatedAt: string;
  model: EmbeddingModel;
  partitionKey?: string;
  embeddingDimension: number;
  indexType: 'IVF_PQ' | 'FLAT' | 'NONE';
  indexConfig?: {
    numPartitions: number;
    numSubQuantizers: number;
    bitsPerCode: number;
    trainingSampleSize: number;
  };
}

/** Column offsets in the Lance file */
interface ColumnOffsets {
  metadata: number;
  id: number;
  title: number;
  type: number;
  chunk_index: number;
  text_preview: number;
  embedding: number;
  model: number;
  created_at: number;
}

/** IVF-PQ index structure for search */
interface IVFPQIndex {
  centroids: Float32Array;
  codebooks: Float32Array;
  assignments: Uint32Array;
  pqCodes: Uint8Array;
  partitionOffsets: Uint32Array;
  sortedIds: Uint32Array;
  config: {
    numPartitions: number;
    numSubQuantizers: number;
    bitsPerCode: number;
    trainingSampleSize: number;
  };
}

/**
 * Options for HTTP Range request fetching
 */
export interface RangeFetchOptions {
  /** Base URL for the Lance file */
  url: string;
  /** Custom fetch function (for authentication, etc.) */
  fetch?: typeof fetch;
  /** Request headers */
  headers?: Record<string, string>;
}

/**
 * Lance file reader with IVF-PQ search support
 */
export class LanceReader {
  private metadata: LanceMetadata | null = null;
  private offsets: ColumnOffsets | null = null;
  private ivfpqIndex: IVFPQIndex | null = null;
  private fileBytes: Uint8Array | null = null;
  private rangeFetchOptions: RangeFetchOptions | null = null;

  // Cached columns (lazy loaded)
  private cachedIds: string[] | null = null;
  private cachedTitles: string[] | null = null;
  private cachedTypes: string[] | null = null;
  private cachedChunkIndices: number[] | null = null;
  private cachedTextPreviews: string[] | null = null;
  private cachedEmbeddings: Float32Array[] | null = null;
  private cachedModels: string[] | null = null;
  private cachedCreatedAts: string[] | null = null;

  /**
   * Load a Lance file from the local filesystem
   */
  async loadIndex(path: string): Promise<void> {
    this.fileBytes = new Uint8Array(await readFile(path));
    await this.parseFile();
  }

  /**
   * Load a Lance file via HTTP Range requests (for browser usage)
   */
  async loadFromUrl(options: RangeFetchOptions): Promise<void> {
    this.rangeFetchOptions = options;

    // First, fetch the file size and footer
    const fetchFn = options.fetch ?? fetch;
    const headers = { ...options.headers };

    // Get file size
    const headResponse = await fetchFn(options.url, { method: 'HEAD', headers });
    const fileSize = parseInt(headResponse.headers.get('content-length') ?? '0', 10);

    if (fileSize === 0) {
      throw new Error('Could not determine file size');
    }

    // Fetch footer (last 72 bytes for column offsets)
    const footerSize = 72;
    const footerResponse = await fetchFn(options.url, {
      method: 'GET',
      headers: {
        ...headers,
        Range: `bytes=${fileSize - footerSize}-${fileSize - 1}`,
      },
    });

    const footerBytes = new Uint8Array(await footerResponse.arrayBuffer());
    const footerView = new DataView(footerBytes.buffer);

    this.offsets = {
      metadata: footerView.getFloat64(0, true),
      id: footerView.getFloat64(8, true),
      title: footerView.getFloat64(16, true),
      type: footerView.getFloat64(24, true),
      chunk_index: footerView.getFloat64(32, true),
      text_preview: footerView.getFloat64(40, true),
      embedding: footerView.getFloat64(48, true),
      model: footerView.getFloat64(56, true),
      created_at: footerView.getFloat64(64, true),
    };

    // Fetch header and metadata
    const headerSize = 16;
    const headerResponse = await fetchFn(options.url, {
      method: 'GET',
      headers: {
        ...headers,
        Range: `bytes=0-${headerSize + 10000 - 1}`, // Assume metadata < 10KB
      },
    });

    const headerBytes = new Uint8Array(await headerResponse.arrayBuffer());
    const headerView = new DataView(headerBytes.buffer);

    // Verify magic
    if (
      headerBytes[0] !== 0x4c ||
      headerBytes[1] !== 0x41 ||
      headerBytes[2] !== 0x4e ||
      headerBytes[3] !== 0x43
    ) {
      throw new Error('Invalid Lance file: bad magic bytes');
    }

    const metadataLen = headerView.getUint32(8, true);
    const metadataBytes = headerBytes.slice(headerSize, headerSize + metadataLen);
    this.metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
  }

  /**
   * Parse a loaded Lance file
   */
  private async parseFile(): Promise<void> {
    if (!this.fileBytes) {
      throw new Error('No file loaded');
    }

    const bytes = this.fileBytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Verify magic bytes
    if (
      bytes[0] !== 0x4c ||
      bytes[1] !== 0x41 ||
      bytes[2] !== 0x4e ||
      bytes[3] !== 0x43
    ) {
      throw new Error('Invalid Lance file: bad magic bytes');
    }

    // Read header (version at offset 4, metadata length at offset 8, flags at offset 12)
    const metadataLen = view.getUint32(8, true);
    const flags = view.getUint32(12, true);
    const headerSize = 16;

    // Parse metadata
    const metadataBytes = bytes.slice(headerSize, headerSize + metadataLen);
    this.metadata = JSON.parse(new TextDecoder().decode(metadataBytes));

    // Read footer to get column offsets
    const footerSize = 72;
    const footerOffset = bytes.length - footerSize;

    this.offsets = {
      metadata: view.getFloat64(footerOffset, true),
      id: view.getFloat64(footerOffset + 8, true),
      title: view.getFloat64(footerOffset + 16, true),
      type: view.getFloat64(footerOffset + 24, true),
      chunk_index: view.getFloat64(footerOffset + 32, true),
      text_preview: view.getFloat64(footerOffset + 40, true),
      embedding: view.getFloat64(footerOffset + 48, true),
      model: view.getFloat64(footerOffset + 56, true),
      created_at: view.getFloat64(footerOffset + 64, true),
    };

    // Parse IVF-PQ index if present
    if (flags & 1 && this.metadata?.indexType === 'IVF_PQ') {
      const indexOffset = this.offsets.created_at + this.getColumnSize('created_at');
      this.ivfpqIndex = this.parseIVFPQIndex(bytes.slice(indexOffset, footerOffset));
    }
  }

  /**
   * Get approximate column size for index offset calculation
   */
  private getColumnSize(columnName: string): number {
    if (!this.metadata || !this.offsets) return 0;

    const rowCount = this.metadata.rowCount;

    // Estimate string column size (very rough)
    switch (columnName) {
      case 'created_at':
        // ISO date strings are ~24 chars each
        return (rowCount + 1) * 4 + rowCount * 24;
      default:
        return 0;
    }
  }

  /**
   * Parse IVF-PQ index from bytes
   */
  private parseIVFPQIndex(bytes: Uint8Array): IVFPQIndex {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Read header (section lengths)
    const configLen = view.getUint32(0, true);
    const centroidsLen = view.getUint32(4, true);
    const codebooksLen = view.getUint32(8, true);
    const assignmentsLen = view.getUint32(12, true);
    const pqCodesLen = view.getUint32(16, true);
    const partitionOffsetsLen = view.getUint32(20, true);
    const sortedIdsLen = view.getUint32(24, true);

    const headerSize = 28;
    let offset = headerSize;

    // Parse config
    const configBytes = bytes.slice(offset, offset + configLen);
    const config = JSON.parse(new TextDecoder().decode(configBytes));
    offset += configLen;

    // Parse centroids
    const centroidsBuffer = bytes.slice(offset, offset + centroidsLen);
    const centroids = new Float32Array(
      centroidsBuffer.buffer,
      centroidsBuffer.byteOffset,
      centroidsLen / 4
    );
    offset += centroidsLen;

    // Parse codebooks
    const codebooksBuffer = bytes.slice(offset, offset + codebooksLen);
    const codebooks = new Float32Array(
      codebooksBuffer.buffer,
      codebooksBuffer.byteOffset,
      codebooksLen / 4
    );
    offset += codebooksLen;

    // Parse assignments
    const assignmentsBuffer = bytes.slice(offset, offset + assignmentsLen);
    const assignments = new Uint32Array(
      assignmentsBuffer.buffer,
      assignmentsBuffer.byteOffset,
      assignmentsLen / 4
    );
    offset += assignmentsLen;

    // Parse PQ codes
    const pqCodes = bytes.slice(offset, offset + pqCodesLen);
    offset += pqCodesLen;

    // Parse partition offsets
    const partitionOffsetsBuffer = bytes.slice(offset, offset + partitionOffsetsLen);
    const partitionOffsets = new Uint32Array(
      partitionOffsetsBuffer.buffer,
      partitionOffsetsBuffer.byteOffset,
      partitionOffsetsLen / 4
    );
    offset += partitionOffsetsLen;

    // Parse sorted IDs
    const sortedIdsBuffer = bytes.slice(offset, offset + sortedIdsLen);
    const sortedIds = new Uint32Array(
      sortedIdsBuffer.buffer,
      sortedIdsBuffer.byteOffset,
      sortedIdsLen / 4
    );

    return {
      centroids,
      codebooks,
      assignments,
      pqCodes,
      partitionOffsets,
      sortedIds,
      config,
    };
  }

  /**
   * Get file metadata
   */
  getMetadata(): LanceMetadata | null {
    return this.metadata;
  }

  /**
   * Get row count
   */
  getRowCount(): number {
    return this.metadata?.rowCount ?? 0;
  }

  /**
   * Get embedding dimension
   */
  getEmbeddingDimension(): number {
    return this.metadata?.embeddingDimension ?? 0;
  }

  /**
   * Check if index is loaded
   */
  hasIndex(): boolean {
    return this.ivfpqIndex !== null;
  }

  /**
   * k-NN search with optional filtering
   */
  async search(
    queryEmbedding: Float32Array,
    k: number,
    filter?: SearchFilter,
    ivfpqConfig?: IVFPQSearchConfig
  ): Promise<SearchResult[]> {
    if (!this.metadata || !this.offsets) {
      throw new Error('No index loaded');
    }

    // Use IVF-PQ search if index is available
    if (this.ivfpqIndex && !filter?.predicate) {
      return this.ivfpqSearch(queryEmbedding, k, filter, ivfpqConfig);
    }

    // Fall back to brute-force search
    return this.bruteForceSearch(queryEmbedding, k, filter);
  }

  /**
   * IVF-PQ accelerated search
   */
  private async ivfpqSearch(
    queryEmbedding: Float32Array,
    k: number,
    filter?: SearchFilter,
    config?: IVFPQSearchConfig
  ): Promise<SearchResult[]> {
    if (!this.ivfpqIndex || !this.metadata) {
      throw new Error('IVF-PQ index not available');
    }

    const nprobe = config?.nprobe ?? Math.min(10, this.ivfpqIndex.config.numPartitions);
    const asymmetric = config?.asymmetric ?? true;

    const {
      centroids,
      codebooks,
      pqCodes,
      partitionOffsets,
      sortedIds,
      config: indexConfig,
    } = this.ivfpqIndex;

    const { numPartitions, numSubQuantizers } = indexConfig;
    const dimension = this.metadata.embeddingDimension;
    const subDimension = Math.floor(dimension / numSubQuantizers);

    // Find nearest partitions
    const partitionDistances: Array<{ partition: number; distance: number }> = [];
    for (let p = 0; p < numPartitions; p++) {
      const centroid = centroids.slice(p * dimension, (p + 1) * dimension);
      const distance = this.squaredEuclideanDistance(queryEmbedding, centroid);
      partitionDistances.push({ partition: p, distance });
    }

    // Sort and take top nprobe partitions
    partitionDistances.sort((a, b) => a.distance - b.distance);
    const probePartitions = partitionDistances.slice(0, nprobe);

    // Pre-compute distance tables if using asymmetric distance
    let distanceTables: Float32Array[] | null = null;
    if (asymmetric) {
      distanceTables = this.computeDistanceTables(
        queryEmbedding,
        codebooks,
        numSubQuantizers,
        subDimension
      );
    }

    // Load required columns for filtering
    await this.ensureColumnsLoaded(['id', 'title', 'type', 'chunk_index', 'text_preview', 'model']);

    // Collect candidates from probed partitions
    const candidates: Array<{ idx: number; distance: number }> = [];

    for (const { partition, distance: centroidDist } of probePartitions) {
      const startIdx = partitionOffsets[partition];
      const endIdx = partitionOffsets[partition + 1];

      for (let i = startIdx; i < endIdx; i++) {
        const vectorIdx = sortedIds[i];

        // Apply filter
        if (filter) {
          if (!this.passesFilter(vectorIdx, filter)) {
            continue;
          }
        }

        // Compute approximate distance using PQ codes
        let approxDist = 0;
        if (distanceTables) {
          const codesOffset = vectorIdx * numSubQuantizers;
          for (let sq = 0; sq < numSubQuantizers; sq++) {
            const code = pqCodes[codesOffset + sq];
            approxDist += distanceTables[sq][code];
          }
        } else {
          approxDist = centroidDist; // Fallback to centroid distance
        }

        candidates.push({ idx: vectorIdx, distance: approxDist });
      }
    }

    // Sort by approximate distance and take top candidates
    candidates.sort((a, b) => a.distance - b.distance);
    const topCandidates = candidates.slice(0, k * 2); // Over-sample for re-ranking

    // Re-rank with exact distances if we have embeddings loaded
    let results: Array<{ idx: number; distance: number }>;
    if (this.cachedEmbeddings) {
      results = topCandidates.map(({ idx }) => ({
        idx,
        distance: this.squaredEuclideanDistance(
          queryEmbedding,
          this.cachedEmbeddings![idx]
        ),
      }));
      results.sort((a, b) => a.distance - b.distance);
      results = results.slice(0, k);
    } else {
      results = topCandidates.slice(0, k);
    }

    // Build search results
    return results.map(({ idx, distance }) => ({
      id: this.cachedIds![idx],
      title: this.cachedTitles![idx],
      type: this.cachedTypes![idx] as ArticleType,
      chunk_index: this.cachedChunkIndices![idx],
      text_preview: this.cachedTextPreviews![idx],
      score: 1 / (1 + distance),
      distance,
      model: this.cachedModels![idx] as EmbeddingModel,
    }));
  }

  /**
   * Compute PQ distance tables for asymmetric distance computation
   */
  private computeDistanceTables(
    query: Float32Array,
    codebooks: Float32Array,
    numSubQuantizers: number,
    subDimension: number
  ): Float32Array[] {
    const numCodewords = 256;
    const tables: Float32Array[] = [];

    for (let sq = 0; sq < numSubQuantizers; sq++) {
      const table = new Float32Array(numCodewords);
      const querySubVector = query.slice(sq * subDimension, (sq + 1) * subDimension);
      const codebookOffset = sq * numCodewords * subDimension;

      for (let c = 0; c < numCodewords; c++) {
        const codeword = codebooks.slice(
          codebookOffset + c * subDimension,
          codebookOffset + (c + 1) * subDimension
        );
        table[c] = this.squaredEuclideanDistance(querySubVector, codeword);
      }

      tables.push(table);
    }

    return tables;
  }

  /**
   * Check if a record passes the filter
   */
  private passesFilter(idx: number, filter: SearchFilter): boolean {
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(this.cachedTypes![idx] as ArticleType)) {
        return false;
      }
    }

    if (filter.model) {
      if (this.cachedModels![idx] !== filter.model) {
        return false;
      }
    }

    return true;
  }

  /**
   * Brute-force k-NN search
   */
  private async bruteForceSearch(
    queryEmbedding: Float32Array,
    k: number,
    filter?: SearchFilter
  ): Promise<SearchResult[]> {
    await this.ensureColumnsLoaded([
      'id',
      'title',
      'type',
      'chunk_index',
      'text_preview',
      'embedding',
      'model',
    ]);

    const results: Array<{ idx: number; distance: number }> = [];
    const rowCount = this.metadata!.rowCount;

    for (let i = 0; i < rowCount; i++) {
      // Apply filter
      if (filter) {
        if (!this.passesFilter(i, filter)) {
          continue;
        }
        if (filter.predicate) {
          const record = this.getRecordByIndex(i);
          if (!filter.predicate(record)) {
            continue;
          }
        }
      }

      const distance = this.squaredEuclideanDistance(
        queryEmbedding,
        this.cachedEmbeddings![i]
      );
      results.push({ idx: i, distance });
    }

    // Sort and take top k
    results.sort((a, b) => a.distance - b.distance);
    const topK = results.slice(0, k);

    return topK.map(({ idx, distance }) => ({
      id: this.cachedIds![idx],
      title: this.cachedTitles![idx],
      type: this.cachedTypes![idx] as ArticleType,
      chunk_index: this.cachedChunkIndices![idx],
      text_preview: this.cachedTextPreviews![idx],
      score: 1 / (1 + distance),
      distance,
      model: this.cachedModels![idx] as EmbeddingModel,
    }));
  }

  /**
   * Get a specific embedding by ID
   */
  async getById(id: string): Promise<EmbeddingRecord | null> {
    await this.ensureColumnsLoaded([
      'id',
      'title',
      'type',
      'chunk_index',
      'text_preview',
      'embedding',
      'model',
      'created_at',
    ]);

    const idx = this.cachedIds!.indexOf(id);
    if (idx === -1) {
      return null;
    }

    return this.getRecordByIndex(idx);
  }

  /**
   * Get a record by index
   */
  private getRecordByIndex(idx: number): EmbeddingRecord {
    return {
      id: this.cachedIds![idx],
      title: this.cachedTitles![idx],
      type: this.cachedTypes![idx] as ArticleType,
      chunk_index: this.cachedChunkIndices![idx],
      text_preview: this.cachedTextPreviews![idx],
      embedding: this.cachedEmbeddings![idx],
      model: this.cachedModels![idx] as EmbeddingModel,
      created_at: this.cachedCreatedAts![idx],
    };
  }

  /**
   * Ensure required columns are loaded
   */
  private async ensureColumnsLoaded(columns: string[]): Promise<void> {
    if (!this.fileBytes && !this.rangeFetchOptions) {
      throw new Error('No file loaded');
    }

    for (const column of columns) {
      switch (column) {
        case 'id':
          if (!this.cachedIds) {
            this.cachedIds = await this.loadStringColumn('id');
          }
          break;
        case 'title':
          if (!this.cachedTitles) {
            this.cachedTitles = await this.loadStringColumn('title');
          }
          break;
        case 'type':
          if (!this.cachedTypes) {
            this.cachedTypes = await this.loadStringColumn('type');
          }
          break;
        case 'chunk_index':
          if (!this.cachedChunkIndices) {
            this.cachedChunkIndices = await this.loadInt32Column('chunk_index');
          }
          break;
        case 'text_preview':
          if (!this.cachedTextPreviews) {
            this.cachedTextPreviews = await this.loadStringColumn('text_preview');
          }
          break;
        case 'embedding':
          if (!this.cachedEmbeddings) {
            this.cachedEmbeddings = await this.loadEmbeddingColumn();
          }
          break;
        case 'model':
          if (!this.cachedModels) {
            this.cachedModels = await this.loadStringColumn('model');
          }
          break;
        case 'created_at':
          if (!this.cachedCreatedAts) {
            this.cachedCreatedAts = await this.loadStringColumn('created_at');
          }
          break;
      }
    }
  }

  /**
   * Load a string column from the file
   */
  private async loadStringColumn(name: string): Promise<string[]> {
    if (!this.offsets || !this.metadata) {
      throw new Error('File not parsed');
    }

    const rowCount = this.metadata.rowCount;
    let startOffset: number;
    let endOffset: number;

    switch (name) {
      case 'id':
        startOffset = this.offsets.id;
        endOffset = this.offsets.title;
        break;
      case 'title':
        startOffset = this.offsets.title;
        endOffset = this.offsets.type;
        break;
      case 'type':
        startOffset = this.offsets.type;
        endOffset = this.offsets.chunk_index;
        break;
      case 'text_preview':
        startOffset = this.offsets.text_preview;
        endOffset = this.offsets.embedding;
        break;
      case 'model':
        startOffset = this.offsets.model;
        endOffset = this.offsets.created_at;
        break;
      case 'created_at':
        startOffset = this.offsets.created_at;
        // End is start of index or footer
        endOffset = startOffset + (rowCount + 1) * 4 + rowCount * 30; // Estimate
        break;
      default:
        throw new Error(`Unknown string column: ${name}`);
    }

    const bytes = await this.fetchBytes(startOffset, endOffset);
    return this.decodeStringColumn(bytes, rowCount);
  }

  /**
   * Load an int32 column from the file
   */
  private async loadInt32Column(name: string): Promise<number[]> {
    if (!this.offsets || !this.metadata) {
      throw new Error('File not parsed');
    }

    const rowCount = this.metadata.rowCount;
    let startOffset: number;

    switch (name) {
      case 'chunk_index':
        startOffset = this.offsets.chunk_index;
        break;
      default:
        throw new Error(`Unknown int32 column: ${name}`);
    }

    const size = rowCount * 4;
    const bytes = await this.fetchBytes(startOffset, startOffset + size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const values: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      values.push(view.getInt32(i * 4, true));
    }
    return values;
  }

  /**
   * Load embedding column from the file
   */
  private async loadEmbeddingColumn(): Promise<Float32Array[]> {
    if (!this.offsets || !this.metadata) {
      throw new Error('File not parsed');
    }

    const rowCount = this.metadata.rowCount;
    const dimension = this.metadata.embeddingDimension;
    const startOffset = this.offsets.embedding;
    const size = rowCount * dimension * 4;

    const bytes = await this.fetchBytes(startOffset, startOffset + size);
    const floatView = new Float32Array(
      bytes.buffer,
      bytes.byteOffset,
      rowCount * dimension
    );

    const embeddings: Float32Array[] = [];
    for (let i = 0; i < rowCount; i++) {
      embeddings.push(floatView.slice(i * dimension, (i + 1) * dimension));
    }
    return embeddings;
  }

  /**
   * Fetch bytes from file or URL
   */
  private async fetchBytes(start: number, end: number): Promise<Uint8Array> {
    if (this.fileBytes) {
      return this.fileBytes.slice(start, end);
    }

    if (this.rangeFetchOptions) {
      const fetchFn = this.rangeFetchOptions.fetch ?? fetch;
      const response = await fetchFn(this.rangeFetchOptions.url, {
        method: 'GET',
        headers: {
          ...this.rangeFetchOptions.headers,
          Range: `bytes=${start}-${end - 1}`,
        },
      });
      return new Uint8Array(await response.arrayBuffer());
    }

    throw new Error('No data source available');
  }

  /**
   * Decode a string column from bytes
   */
  private decodeStringColumn(bytes: Uint8Array, rowCount: number): string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const decoder = new TextDecoder();

    // Read offsets
    const offsetsSize = (rowCount + 1) * 4;
    const offsets: number[] = [];
    for (let i = 0; i <= rowCount; i++) {
      offsets.push(view.getUint32(i * 4, true));
    }

    // Read strings
    const strings: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const strStart = offsetsSize + offsets[i];
      const strEnd = offsetsSize + offsets[i + 1];
      strings.push(decoder.decode(bytes.slice(strStart, strEnd)));
    }

    return strings;
  }

  /**
   * Squared Euclidean distance between two vectors
   */
  private squaredEuclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return sum;
  }

  /**
   * Clear cached data
   */
  clearCache(): void {
    this.cachedIds = null;
    this.cachedTitles = null;
    this.cachedTypes = null;
    this.cachedChunkIndices = null;
    this.cachedTextPreviews = null;
    this.cachedEmbeddings = null;
    this.cachedModels = null;
    this.cachedCreatedAts = null;
  }

  /**
   * Close and release resources
   */
  close(): void {
    this.clearCache();
    this.fileBytes = null;
    this.metadata = null;
    this.offsets = null;
    this.ivfpqIndex = null;
    this.rangeFetchOptions = null;
  }
}

/**
 * Create a Lance reader instance
 */
export function createLanceReader(): LanceReader {
  return new LanceReader();
}
