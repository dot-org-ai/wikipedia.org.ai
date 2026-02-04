/**
 * R2 Manifest Reader
 *
 * Reads manifest and index files from R2 storage.
 * Provides caching for frequently accessed data.
 */

import type {
  Manifest,
  TitleIndex,
  TypeIndex,
  SerializedIDIndex,
  IDIndexEntry,
} from '../types.js';
import { NotFoundError } from '../../../lib/errors.js';
import { decompressGzipToString } from './snappy-decoder.js';

/**
 * Manifest reader from R2
 */
export class R2ManifestReader {
  private bucket: R2Bucket;
  private cachedManifest: Manifest | null = null;
  private cachedTitleIndex: TitleIndex | null = null;
  private cachedTypeIndex: TypeIndex | null = null;
  private cachedIDIndex: Map<string, IDIndexEntry> | null = null;

  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  /**
   * Load the manifest file
   */
  async getManifest(): Promise<Manifest> {
    if (this.cachedManifest) {
      return this.cachedManifest;
    }

    const object = await this.bucket.get('manifest.json');
    if (!object) {
      throw new NotFoundError('Manifest not found');
    }

    const text = await object.text();
    this.cachedManifest = JSON.parse(text);
    return this.cachedManifest!;
  }

  /**
   * Load title index
   */
  async getTitleIndex(): Promise<TitleIndex> {
    if (this.cachedTitleIndex) {
      return this.cachedTitleIndex;
    }

    const manifest = await this.getManifest();
    const object = await this.bucket.get(manifest.indexFiles.titles);

    if (!object) {
      throw new NotFoundError('Title index not found');
    }

    let text: string;
    if (manifest.indexFiles.titles.endsWith('.gz')) {
      const compressed = await object.arrayBuffer();
      text = await decompressGzipToString(new Uint8Array(compressed));
    } else {
      text = await object.text();
    }

    this.cachedTitleIndex = JSON.parse(text);
    return this.cachedTitleIndex!;
  }

  /**
   * Load type index
   */
  async getTypeIndex(): Promise<TypeIndex> {
    if (this.cachedTypeIndex) {
      return this.cachedTypeIndex;
    }

    const manifest = await this.getManifest();
    const object = await this.bucket.get(manifest.indexFiles.types);

    if (!object) {
      throw new NotFoundError('Type index not found');
    }

    let text: string;
    if (manifest.indexFiles.types.endsWith('.gz')) {
      const compressed = await object.arrayBuffer();
      text = await decompressGzipToString(new Uint8Array(compressed));
    } else {
      text = await object.text();
    }

    this.cachedTypeIndex = JSON.parse(text);
    return this.cachedTypeIndex!;
  }

  /**
   * Load ID index for O(1) article lookup by ID
   */
  async getIDIndex(): Promise<Map<string, IDIndexEntry>> {
    if (this.cachedIDIndex) {
      return this.cachedIDIndex;
    }

    const manifest = await this.getManifest();

    // ID index is optional - return empty map if not present
    if (!manifest.indexFiles.ids) {
      this.cachedIDIndex = new Map();
      return this.cachedIDIndex;
    }

    const object = await this.bucket.get(manifest.indexFiles.ids);

    if (!object) {
      // Index file not found - return empty map
      this.cachedIDIndex = new Map();
      return this.cachedIDIndex;
    }

    let text: string;
    if (manifest.indexFiles.ids.endsWith('.gz')) {
      const compressed = await object.arrayBuffer();
      text = await decompressGzipToString(new Uint8Array(compressed));
    } else {
      text = await object.text();
    }

    const serialized: SerializedIDIndex = JSON.parse(text);

    // Convert to Map for O(1) lookup
    this.cachedIDIndex = new Map();
    for (const [id, entry] of Object.entries(serialized.entries)) {
      this.cachedIDIndex.set(id, entry);
    }

    return this.cachedIDIndex;
  }

  /**
   * Look up an article location by ID
   * Returns null if not found or index not available
   */
  async lookupByID(id: string): Promise<IDIndexEntry | null> {
    const index = await this.getIDIndex();
    return index.get(id) ?? null;
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    this.cachedManifest = null;
    this.cachedTitleIndex = null;
    this.cachedTypeIndex = null;
    this.cachedIDIndex = null;
  }
}

/**
 * Create an R2 manifest reader
 */
export function createR2ManifestReader(bucket: R2Bucket): R2ManifestReader {
  return new R2ManifestReader(bucket);
}
