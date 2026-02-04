/**
 * Request Context for Wikipedia API
 *
 * Provides request-scoped resource management to prevent memory leaks
 * from module-level singletons.
 *
 * Features:
 * - Lazy-initialized readers per request
 * - Automatic cleanup at end of request
 * - Type-safe access to all resources
 */

import type { Env, RequestContext as BaseRequestContext } from './types.js';
import { R2ParquetReader, R2ManifestReader } from './r2-reader.js';
import { GeoIndex, createGeoIndex, type SerializedGeoIndex } from '../../indexes/geo-index.js';
import { WikipediaFTSIndex } from '../../indexes/fts-index.js';
import { VectorIndex, createWikipediaVectorIndex } from '../../indexes/vector-index.js';

/**
 * Resource holder with lazy initialization
 */
interface ResourceHolder<T> {
  instance: T | null;
  loading: Promise<T> | null;
}

/**
 * Request-scoped context with lazy-initialized resources
 *
 * All readers and indexes are created on-demand and scoped to a single request.
 * Call cleanup() at the end of the request to release resources.
 */
export class RequestScopedContext {
  private _parquetReader: R2ParquetReader | null = null;
  private _manifestReader: R2ManifestReader | null = null;
  private _geoIndex: ResourceHolder<GeoIndex> = { instance: null, loading: null };
  private _ftsIndex: ResourceHolder<WikipediaFTSIndex> = { instance: null, loading: null };
  private _hnswIndex: ResourceHolder<VectorIndex> = { instance: null, loading: null };

  constructor(
    public readonly request: Request,
    public readonly env: Env,
    public readonly ctx: ExecutionContext,
    public readonly startTime: number,
    public readonly params: Record<string, string>,
    public readonly query: URLSearchParams
  ) {}

  /**
   * Get the R2 bucket
   */
  get bucket(): R2Bucket {
    return this.env.R2;
  }

  /**
   * Get the AI binding
   */
  get ai(): Ai {
    return this.env.AI;
  }

  /**
   * Get or create Parquet reader (lazy initialization)
   */
  get parquetReader(): R2ParquetReader {
    if (!this._parquetReader) {
      this._parquetReader = new R2ParquetReader(this.env.R2);
    }
    return this._parquetReader;
  }

  /**
   * Get or create manifest reader (lazy initialization)
   */
  get manifestReader(): R2ManifestReader {
    if (!this._manifestReader) {
      this._manifestReader = new R2ManifestReader(this.env.R2);
    }
    return this._manifestReader;
  }

  /**
   * Get or load the geo index (lazy async initialization)
   */
  async getGeoIndex(): Promise<GeoIndex> {
    // Return cached instance if available
    if (this._geoIndex.instance) {
      return this._geoIndex.instance;
    }

    // If already loading, wait for it
    if (this._geoIndex.loading) {
      return this._geoIndex.loading;
    }

    // Start loading
    this._geoIndex.loading = this.loadGeoIndex();

    try {
      this._geoIndex.instance = await this._geoIndex.loading;
      return this._geoIndex.instance;
    } finally {
      this._geoIndex.loading = null;
    }
  }

  /**
   * Get or load the FTS index (lazy async initialization)
   */
  async getFTSIndex(): Promise<WikipediaFTSIndex | null> {
    // Return cached instance if available
    if (this._ftsIndex.instance) {
      return this._ftsIndex.instance;
    }

    // If already loading, wait for it
    if (this._ftsIndex.loading) {
      return this._ftsIndex.loading;
    }

    // Start loading
    this._ftsIndex.loading = this.loadFTSIndex();

    try {
      this._ftsIndex.instance = await this._ftsIndex.loading;
      return this._ftsIndex.instance;
    } catch (error) {
      console.error('Failed to load FTS index:', error);
      return null;
    } finally {
      this._ftsIndex.loading = null;
    }
  }

  /**
   * Get or load the HNSW vector index (lazy async initialization)
   */
  async getHNSWIndex(): Promise<VectorIndex | null> {
    // Return cached instance if available
    if (this._hnswIndex.instance) {
      return this._hnswIndex.instance;
    }

    // If already loading, wait for it
    if (this._hnswIndex.loading) {
      return this._hnswIndex.loading;
    }

    // Start loading
    this._hnswIndex.loading = this.loadHNSWIndex();

    try {
      this._hnswIndex.instance = await this._hnswIndex.loading;
      return this._hnswIndex.instance;
    } catch (error) {
      console.error('Failed to load HNSW index:', error);
      return null;
    } finally {
      this._hnswIndex.loading = null;
    }
  }

  /**
   * Load geo index from R2 or build from data
   */
  private async loadGeoIndex(): Promise<GeoIndex> {
    const index = createGeoIndex();

    // Try to load pre-built index from R2
    try {
      const indexObject = await this.env.R2.get('indexes/geo-index.json');
      if (indexObject) {
        const indexData = await indexObject.json() as SerializedGeoIndex;
        index.deserialize(indexData);
        return index;
      }
    } catch {
      // Index doesn't exist, will build on demand
    }

    // Build index from manifest and data files
    const manifest = this.manifestReader;
    const reader = this.parquetReader;
    const manifestData = await manifest.getManifest();

    for (const file of manifestData.dataFiles) {
      try {
        const metadata = await reader.getMetadata(file.path);

        for (let rgIndex = 0; rgIndex < metadata.rowGroups.length; rgIndex++) {
          const articles = await reader.readRowGroup(file.path, rgIndex);

          for (let row = 0; row < articles.length; row++) {
            const article = articles[row];
            if (article && article.coords) {
              index.insert({
                articleId: article.id,
                lat: article.coords.lat,
                lng: article.coords.lon,
                title: article.title,
                type: article.type,
                file: file.path,
                rowGroup: rgIndex,
                row,
              });
            }
          }
        }
      } catch (error) {
        console.error(`Error indexing file ${file.path}:`, error);
        continue;
      }
    }

    return index;
  }

  /**
   * Load FTS index from R2
   */
  private async loadFTSIndex(): Promise<WikipediaFTSIndex> {
    const indexPath = 'indexes/fts/articles.json.gz';

    const object = await this.env.R2.get(indexPath);
    if (!object) {
      throw new Error(`FTS index not found at ${indexPath}`);
    }

    // Decompress and parse
    const data = await object.arrayBuffer();
    const bytes = new Uint8Array(data);

    // Decompress gzip
    const decompressed = await this.decompressGzip(bytes);
    const json = new TextDecoder().decode(decompressed);

    return WikipediaFTSIndex.fromJSON(json);
  }

  /**
   * Load HNSW vector index from R2 Lance files
   */
  private async loadHNSWIndex(): Promise<VectorIndex> {
    const index = createWikipediaVectorIndex({
      maxNodes: 100000,
      maxBytes: 500 * 1024 * 1024,
    });

    const types = ['person', 'place', 'org', 'work', 'event', 'other'] as const;
    const DEFAULT_MODEL = 'bge-m3';

    for (const type of types) {
      const lanceFile = `embeddings/${DEFAULT_MODEL}/${type}.lance`;

      try {
        const head = await this.env.R2.head(lanceFile);
        if (!head) continue;

        const object = await this.env.R2.get(lanceFile);
        if (!object) continue;

        const data = await object.arrayBuffer();
        const bytes = new Uint8Array(data);

        // Parse Lance file and load into HNSW index
        const { records } = this.parseLanceFile(bytes);

        for (const record of records) {
          const metadata = {
            id: record.id,
            title: record.title,
            type: record.type as typeof types[number],
            preview: record.text_preview,
          };

          const embedding = Array.from(record.embedding);
          index.insert(embedding, metadata);
        }

        console.log(`Loaded ${records.length} vectors from ${lanceFile} into HNSW index`);
      } catch (error) {
        console.error(`Error loading ${lanceFile} into HNSW index:`, error);
      }
    }

    return index;
  }

  /**
   * Parse Lance file (simplified implementation)
   */
  private parseLanceFile(bytes: Uint8Array): { records: LanceRecord[] } {
    // Check magic bytes
    if (
      bytes[0] !== 0x4c || // 'L'
      bytes[1] !== 0x41 || // 'A'
      bytes[2] !== 0x4e || // 'N'
      bytes[3] !== 0x43    // 'C'
    ) {
      throw new Error('Invalid Lance file: bad magic bytes');
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // Read header
    const metadataLen = view.getUint32(8, true);
    const headerSize = 16;

    // Parse metadata JSON
    const metadataBytes = bytes.slice(headerSize, headerSize + metadataLen);
    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes)) as LanceMetadata;

    // Read footer to get column offsets
    const footerSize = 72;
    const footerOffset = bytes.length - footerSize;

    const offsets = {
      id: view.getFloat64(footerOffset + 8, true),
      title: view.getFloat64(footerOffset + 16, true),
      type: view.getFloat64(footerOffset + 24, true),
      chunk_index: view.getFloat64(footerOffset + 32, true),
      text_preview: view.getFloat64(footerOffset + 40, true),
      embedding: view.getFloat64(footerOffset + 48, true),
    };

    const rowCount = metadata.rowCount;
    const embeddingDimension = metadata.embeddingDimension;

    // Parse columns
    const ids = this.parseStringColumn(bytes, offsets.id, offsets.title, rowCount);
    const titles = this.parseStringColumn(bytes, offsets.title, offsets.type, rowCount);
    const types = this.parseStringColumn(bytes, offsets.type, offsets.chunk_index, rowCount);
    const chunkIndices = this.parseInt32Column(view, offsets.chunk_index, rowCount);
    const textPreviews = this.parseStringColumn(
      bytes,
      offsets.text_preview,
      offsets.embedding,
      rowCount
    );
    const embeddings = this.parseEmbeddingColumn(
      bytes,
      offsets.embedding,
      rowCount,
      embeddingDimension
    );

    // Build records
    const records: LanceRecord[] = [];
    for (let i = 0; i < rowCount; i++) {
      records.push({
        id: ids[i] ?? '',
        title: titles[i] ?? '',
        type: types[i] ?? 'other',
        chunk_index: chunkIndices[i] ?? 0,
        text_preview: textPreviews[i] ?? '',
        embedding: embeddings[i] ?? new Float32Array(0),
      });
    }

    return { records };
  }

  /**
   * Parse string column from Lance file
   */
  private parseStringColumn(
    bytes: Uint8Array,
    start: number,
    end: number,
    rowCount: number
  ): string[] {
    const data = bytes.slice(start, end);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = new TextDecoder();

    const offsetsSize = (rowCount + 1) * 4;
    const offsets: number[] = [];
    for (let i = 0; i <= rowCount; i++) {
      offsets.push(view.getUint32(i * 4, true));
    }

    const strings: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const startOffset = offsets[i];
      const endOffset = offsets[i + 1];
      if (startOffset !== undefined && endOffset !== undefined) {
        const strStart = offsetsSize + startOffset;
        const strEnd = offsetsSize + endOffset;
        if (strEnd <= data.length) {
          strings.push(decoder.decode(data.slice(strStart, strEnd)));
        } else {
          strings.push('');
        }
      } else {
        strings.push('');
      }
    }

    return strings;
  }

  /**
   * Parse int32 column
   */
  private parseInt32Column(view: DataView, offset: number, rowCount: number): number[] {
    const values: number[] = [];
    for (let i = 0; i < rowCount; i++) {
      values.push(view.getInt32(offset + i * 4, true));
    }
    return values;
  }

  /**
   * Parse embedding column
   */
  private parseEmbeddingColumn(
    bytes: Uint8Array,
    offset: number,
    rowCount: number,
    dimension: number
  ): Float32Array[] {
    const embeddings: Float32Array[] = [];
    const floatView = new Float32Array(
      bytes.buffer,
      bytes.byteOffset + offset,
      rowCount * dimension
    );

    for (let i = 0; i < rowCount; i++) {
      embeddings.push(floatView.slice(i * dimension, (i + 1) * dimension));
    }

    return embeddings;
  }

  /**
   * Decompress gzip data
   */
  private async decompressGzip(data: Uint8Array): Promise<Uint8Array> {
    const stream = new Response(data).body;
    if (!stream) {
      throw new Error('Failed to create stream from data');
    }

    const decompressor = new DecompressionStream('gzip');
    const decompressedStream = stream.pipeThrough(decompressor);
    const response = new Response(decompressedStream);
    const buffer = await response.arrayBuffer();

    return new Uint8Array(buffer);
  }

  /**
   * Clean up all resources
   *
   * Call this at the end of each request to prevent memory leaks.
   */
  cleanup(): void {
    // Clear Parquet reader cache
    if (this._parquetReader) {
      this._parquetReader.clearCache();
      this._parquetReader = null;
    }

    // Clear manifest reader cache
    if (this._manifestReader) {
      this._manifestReader.clearCache();
      this._manifestReader = null;
    }

    // Clear geo index
    this._geoIndex.instance = null;
    this._geoIndex.loading = null;

    // Clear FTS index
    this._ftsIndex.instance = null;
    this._ftsIndex.loading = null;

    // Clear HNSW index
    this._hnswIndex.instance = null;
    this._hnswIndex.loading = null;
  }
}

/** Lance file metadata */
interface LanceMetadata {
  rowCount: number;
  embeddingDimension: number;
  model: string;
}

/** Lance record structure */
interface LanceRecord {
  id: string;
  title: string;
  type: string;
  chunk_index: number;
  text_preview: string;
  embedding: Float32Array;
}

/**
 * Create a request-scoped context from the base request context
 */
export function createRequestContext(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  startTime: number,
  params: Record<string, string>,
  query: URLSearchParams
): RequestScopedContext {
  return new RequestScopedContext(request, env, ctx, startTime, params, query);
}

/**
 * Create a request-scoped context from an existing base context
 */
export function fromBaseContext(base: BaseRequestContext): RequestScopedContext {
  return new RequestScopedContext(
    base.request,
    base.env,
    base.ctx,
    base.startTime,
    base.params,
    base.query
  );
}

/**
 * Type alias for the scoped context
 */
export type ScopedRequestContext = RequestScopedContext;
