/**
 * ID Index for O(1) Article Lookup
 *
 * Maps article IDs (ULIDs) to their physical storage location
 * for efficient direct lookup without scanning all files.
 *
 * Structure: { id: { type, file, rowGroup, row } }
 */

import type { ArticleType } from '../shared/types.js';

/**
 * Location of an article in the Parquet storage
 */
export interface IDIndexEntry {
  /** Article type (for partition routing) */
  type: ArticleType;
  /** Parquet file path */
  file: string;
  /** Row group index within file */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/**
 * Serialized ID index format for storage
 */
export interface SerializedIDIndex {
  /** Index version for compatibility */
  version: string;
  /** Creation timestamp */
  created_at: string;
  /** Number of entries */
  count: number;
  /** ID to location mapping */
  entries: Record<string, IDIndexEntry>;
}

/**
 * Article info for bulk building
 */
export interface ArticleLocation {
  /** Article ID (ULID) */
  id: string;
  /** Article type */
  type: ArticleType;
  /** File path */
  file: string;
  /** Row group index */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/**
 * IDIndex - O(1) article lookup by ID
 *
 * Features:
 * - Fast O(1) lookup by article ID
 * - Maps ID to exact file location (file, rowGroup, row)
 * - Serializable to JSON for R2 storage
 * - Supports incremental and bulk building
 */
export class IDIndex {
  private entries: Map<string, IDIndexEntry>;
  private readonly version: string = '1.0.0';

  constructor() {
    this.entries = new Map();
  }

  /**
   * Add an article's location to the index
   *
   * @param id - Article ID (ULID)
   * @param location - Physical storage location
   */
  addArticle(
    id: string,
    location: Omit<IDIndexEntry, 'type'> & { type?: ArticleType }
  ): void {
    this.entries.set(id, {
      type: location.type ?? 'other',
      file: location.file,
      rowGroup: location.rowGroup,
      row: location.row,
    });
  }

  /**
   * Look up an article's location by ID
   *
   * @param id - Article ID (ULID)
   * @returns Entry with file location, or null if not found
   */
  lookup(id: string): IDIndexEntry | null {
    return this.entries.get(id) ?? null;
  }

  /**
   * Check if an article exists in the index
   *
   * @param id - Article ID (ULID)
   * @returns True if article exists in index
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Remove an article from the index
   *
   * @param id - Article ID (ULID)
   * @returns True if article was removed
   */
  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  /**
   * Get the number of entries in the index
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries from the index
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get all IDs in the index
   */
  getIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get IDs filtered by type
   *
   * @param type - Article type to filter by
   * @returns Array of IDs of that type
   */
  getIdsByType(type: ArticleType): string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.entries) {
      if (entry.type === type) {
        ids.push(id);
      }
    }
    return ids;
  }

  /**
   * Serialize the index for storage
   *
   * @returns JSON-serializable object
   */
  serialize(): SerializedIDIndex {
    const entries: Record<string, IDIndexEntry> = {};
    for (const [id, entry] of this.entries) {
      entries[id] = entry;
    }

    return {
      version: this.version,
      created_at: new Date().toISOString(),
      count: this.entries.size,
      entries,
    };
  }

  /**
   * Serialize the index to a JSON string
   *
   * @returns JSON string
   */
  toJSON(): string {
    return JSON.stringify(this.serialize());
  }

  /**
   * Deserialize an index from a serialized object
   *
   * @param data - Serialized index data
   * @returns IDIndex instance
   */
  static deserialize(data: SerializedIDIndex): IDIndex {
    const index = new IDIndex();

    for (const [id, entry] of Object.entries(data.entries)) {
      index.entries.set(id, entry);
    }

    return index;
  }

  /**
   * Deserialize an index from a JSON string
   *
   * @param json - JSON string
   * @returns IDIndex instance
   */
  static fromJSON(json: string): IDIndex {
    const data = JSON.parse(json) as SerializedIDIndex;
    return IDIndex.deserialize(data);
  }

  /**
   * Build an index from a list of article locations
   *
   * @param articles - Array of article locations
   * @returns IDIndex instance
   */
  static buildFromArticles(articles: ArticleLocation[]): IDIndex {
    const index = new IDIndex();

    for (const article of articles) {
      index.addArticle(article.id, {
        type: article.type,
        file: article.file,
        rowGroup: article.rowGroup,
        row: article.row,
      });
    }

    return index;
  }

  /**
   * Merge multiple indexes into one
   *
   * Later indexes take precedence for duplicate IDs.
   *
   * @param indexes - Array of indexes to merge
   * @returns Merged IDIndex instance
   */
  static merge(...indexes: IDIndex[]): IDIndex {
    const merged = new IDIndex();

    for (const index of indexes) {
      for (const [id, entry] of index.entries) {
        merged.entries.set(id, entry);
      }
    }

    return merged;
  }
}

/**
 * Create a new empty IDIndex
 */
export function createIDIndex(): IDIndex {
  return new IDIndex();
}

/**
 * Load an IDIndex from a file path (Node.js/Bun)
 *
 * @param path - File path to load from
 * @returns IDIndex instance
 */
export async function loadIDIndex(path: string): Promise<IDIndex> {
  let data: Uint8Array;

  if (typeof Bun !== 'undefined') {
    const file = Bun.file(path);
    data = new Uint8Array(await file.arrayBuffer());
  } else {
    const { readFile } = await import('node:fs/promises');
    data = await readFile(path);
  }

  // Check if gzipped
  let json: string;
  if (path.endsWith('.gz')) {
    json = await decompressGzip(data);
  } else {
    json = new TextDecoder().decode(data);
  }

  return IDIndex.fromJSON(json);
}

/**
 * Save an IDIndex to a file path (Node.js/Bun)
 *
 * @param index - IDIndex to save
 * @param path - File path to save to
 * @param compress - Whether to gzip compress (default: true if path ends with .gz)
 */
export async function saveIDIndex(
  index: IDIndex,
  path: string,
  compress?: boolean
): Promise<void> {
  const shouldCompress = compress ?? path.endsWith('.gz');
  const json = index.toJSON();

  let data: Uint8Array | string;
  if (shouldCompress) {
    data = await compressGzip(json);
  } else {
    data = json;
  }

  if (typeof Bun !== 'undefined') {
    await Bun.write(path, data);
  } else {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
}

/**
 * Gzip compress a string
 */
async function compressGzip(data: string): Promise<Uint8Array> {
  if (typeof Bun !== 'undefined') {
    return Bun.gzipSync(Buffer.from(data));
  }

  const { gzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  const gzipAsync = promisify(gzip);
  return gzipAsync(Buffer.from(data));
}

/**
 * Gzip decompress data
 */
async function decompressGzip(data: Uint8Array): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return Bun.gunzipSync(new Uint8Array(data) as Uint8Array<ArrayBuffer>).toString();
  }

  const { gunzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  const gunzipAsync = promisify(gunzip);
  const result = await gunzipAsync(Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  return result.toString();
}
