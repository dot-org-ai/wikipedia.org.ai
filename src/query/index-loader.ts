// @ts-nocheck - Complex async caching with IndexedDB and optional property types
/**
 * Index loader for the Wikipedia browser client
 *
 * Loads and caches title indexes, type manifests, and bloom filters
 * from the CDN. Supports both in-memory caching and IndexedDB persistence.
 */

import type {
  ArticleType,
  BloomFilter,
  CacheEntry,
  TitleIndex,
  TitleIndexEntry,
  TypeManifest,
  TypeManifestEntry,
} from './browser-types.js';
import { LRUCache } from '../lib/lru-cache.js';

/**
 * Error thrown when index loading fails
 */
export class IndexLoadError extends Error {
  constructor(
    message: string,
    public readonly indexType: string,
    public readonly url?: string
  ) {
    super(message);
    this.name = 'IndexLoadError';
  }
}

/**
 * IndexedDB store names
 */
const STORES = {
  TITLES: 'title-index',
  TYPES: 'type-manifest',
  BLOOM: 'bloom-filters',
  META: 'metadata',
} as const;

/** Maximum number of cached bloom filters */
const MAX_BLOOM_FILTER_CACHE_SIZE = 100;

/**
 * IndexedDB interface types (for browser environments)
 */
interface IDBDatabaseLike {
  transaction(
    storeNames: string | string[],
    mode?: 'readonly' | 'readwrite'
  ): IDBTransactionLike;
  objectStoreNames: { contains(name: string): boolean };
  close(): void;
}

interface IDBTransactionLike {
  objectStore(name: string): IDBObjectStoreLike;
}

interface IDBObjectStoreLike {
  get(key: string): IDBRequestLike;
  put(value: unknown, key: string): IDBRequestLike;
  clear(): IDBRequestLike;
}

interface IDBRequestLike {
  onerror: ((event: Event) => void) | null;
  onsuccess: ((event: Event) => void) | null;
  result: unknown;
}

interface IDBOpenDBRequestLike extends IDBRequestLike {
  onupgradeneeded: ((event: Event & { target: { result: IDBDatabaseLike } }) => void) | null;
}

/**
 * Index loader for the Wikipedia browser client
 *
 * Provides efficient loading and caching of:
 * - Title index (maps titles to file locations)
 * - Type manifest (maps article types to partition files)
 * - Bloom filters (fast negative lookups)
 */
export class IndexLoader {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly cacheTTL: number;
  private readonly useIndexedDB: boolean;
  private readonly dbName: string;

  // In-memory caches
  private titleIndexCache: CacheEntry<TitleIndex> | null = null;
  private typeManifestCache: CacheEntry<TypeManifest> | null = null;
  private bloomFilterCache: LRUCache<string, CacheEntry<BloomFilter>>;

  // IndexedDB connection
  private db: IDBDatabaseLike | null = null;
  private dbPromise: Promise<IDBDatabaseLike> | null = null;

  /**
   * Create a new index loader
   *
   * @param baseUrl - CDN base URL
   * @param options - Optional configuration
   */
  constructor(
    baseUrl: string,
    options?: {
      fetch?: typeof fetch;
      cacheTTL?: number;
      useIndexedDB?: boolean;
      dbName?: string;
    }
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetchFn = options?.fetch ?? fetch;
    // Default 5 minute cache
    this.cacheTTL = options?.cacheTTL ?? 5 * 60 * 1000;
    this.useIndexedDB = options?.useIndexedDB ?? true;
    this.dbName = options?.dbName ?? 'wikipedia-index-cache';
    this.bloomFilterCache = new LRUCache<string, CacheEntry<BloomFilter>>(MAX_BLOOM_FILTER_CACHE_SIZE);
  }

  /**
   * Check if IndexedDB is available
   */
  private isIndexedDBAvailable(): boolean {
    return typeof globalThis !== 'undefined' && 'indexedDB' in globalThis;
  }

  /**
   * Initialize IndexedDB connection
   */
  private async initDB(): Promise<IDBDatabaseLike> {
    if (this.db) {
      return this.db;
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      // Check if IndexedDB is available
      if (!this.isIndexedDBAvailable()) {
        reject(new Error('IndexedDB not available'));
        return;
      }

      // biome-ignore lint/suspicious/noExplicitAny: IndexedDB is a browser API
      const idb = (globalThis as any).indexedDB;
      const request: IDBOpenDBRequestLike = idb.open(this.dbName, 1);

      request.onerror = () => {
        reject(new IndexLoadError('Failed to open IndexedDB', 'database'));
      };

      request.onsuccess = () => {
        this.db = request.result as IDBDatabaseLike;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        // biome-ignore lint/suspicious/noExplicitAny: IndexedDB event typing
        const db = (event as any).target.result;

        // Create object stores
        if (!db.objectStoreNames.contains(STORES.TITLES)) {
          db.createObjectStore(STORES.TITLES);
        }
        if (!db.objectStoreNames.contains(STORES.TYPES)) {
          db.createObjectStore(STORES.TYPES);
        }
        if (!db.objectStoreNames.contains(STORES.BLOOM)) {
          db.createObjectStore(STORES.BLOOM);
        }
        if (!db.objectStoreNames.contains(STORES.META)) {
          db.createObjectStore(STORES.META);
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Get item from IndexedDB
   */
  private async getFromDB<T>(store: string, key: string): Promise<CacheEntry<T> | null> {
    if (!this.useIndexedDB || !this.isIndexedDBAvailable()) {
      return null;
    }

    try {
      const db = await this.initDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(store, 'readonly');
        const objectStore = transaction.objectStore(store);
        const request = objectStore.get(key);

        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const result = request.result as CacheEntry<T> | undefined;
          if (result && Date.now() - result.timestamp < this.cacheTTL) {
            resolve(result);
          } else {
            resolve(null);
          }
        };
      });
    } catch {
      return null;
    }
  }

  /**
   * Put item into IndexedDB
   */
  private async putToDB<T>(store: string, key: string, data: T): Promise<void> {
    if (!this.useIndexedDB || !this.isIndexedDBAvailable()) {
      return;
    }

    try {
      const db = await this.initDB();
      return new Promise((resolve) => {
        const transaction = db.transaction(store, 'readwrite');
        const objectStore = transaction.objectStore(store);
        const entry: CacheEntry<T> = {
          data,
          timestamp: Date.now(),
        };
        const request = objectStore.put(entry, key);

        request.onerror = () => resolve(); // Silently fail
        request.onsuccess = () => resolve();
      });
    } catch {
      // Silently fail - cache is optional
    }
  }

  /**
   * Load the title index
   *
   * The title index maps normalized article titles to their file locations.
   * This enables O(1) lookup by title.
   *
   * @returns Title index map
   */
  async getTitleIndex(): Promise<TitleIndex> {
    // Check in-memory cache
    if (this.titleIndexCache && Date.now() - this.titleIndexCache.timestamp < this.cacheTTL) {
      return this.titleIndexCache.data;
    }

    // Check IndexedDB cache
    const cached = await this.getFromDB<Record<string, TitleIndexEntry>>(STORES.TITLES, 'index');
    if (cached) {
      const index = new Map(Object.entries(cached.data));
      this.titleIndexCache = { data: index, timestamp: cached.timestamp };
      return index;
    }

    // Fetch from CDN
    const url = `${this.baseUrl}/indexes/titles.json`;
    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw new IndexLoadError(
        `Failed to load title index: ${response.status}`,
        'title-index',
        url
      );
    }

    const data: Record<string, TitleIndexEntry> = await response.json();
    const index: TitleIndex = new Map(Object.entries(data));

    // Cache in memory
    this.titleIndexCache = { data: index, timestamp: Date.now() };

    // Cache in IndexedDB (store as plain object for JSON serialization)
    await this.putToDB(STORES.TITLES, 'index', data);

    return index;
  }

  /**
   * Load the type manifest
   *
   * The type manifest maps article types to their partition files and counts.
   *
   * @returns Type manifest map
   */
  async getTypeManifest(): Promise<TypeManifest> {
    // Check in-memory cache
    if (this.typeManifestCache && Date.now() - this.typeManifestCache.timestamp < this.cacheTTL) {
      return this.typeManifestCache.data;
    }

    // Check IndexedDB cache
    const cached = await this.getFromDB<Record<string, TypeManifestEntry>>(STORES.TYPES, 'manifest');
    if (cached) {
      const manifest: TypeManifest = new Map();
      for (const [key, value] of Object.entries(cached.data)) {
        manifest.set(key as ArticleType, value);
      }
      this.typeManifestCache = { data: manifest, timestamp: cached.timestamp };
      return manifest;
    }

    // Fetch from CDN
    const url = `${this.baseUrl}/indexes/types.json`;
    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw new IndexLoadError(
        `Failed to load type manifest: ${response.status}`,
        'type-manifest',
        url
      );
    }

    const data: Record<string, TypeManifestEntry> = await response.json();
    const manifest: TypeManifest = new Map();
    for (const [key, value] of Object.entries(data)) {
      manifest.set(key as ArticleType, value);
    }

    // Cache in memory
    this.typeManifestCache = { data: manifest, timestamp: Date.now() };

    // Cache in IndexedDB
    await this.putToDB(STORES.TYPES, 'manifest', data);

    return manifest;
  }

  /**
   * Load a bloom filter for a specific file
   *
   * Bloom filters enable fast negative lookups - if the filter says a title
   * is NOT present, we can skip reading the file entirely.
   *
   * @param file - Parquet file path (relative to CDN base)
   * @returns Bloom filter for the file
   */
  async getBloomFilter(file: string): Promise<BloomFilter> {
    // Normalize file path
    const normalizedFile = file.replace(/^\//, '');

    // Check in-memory cache
    const memCached = this.bloomFilterCache.get(normalizedFile);
    if (memCached && Date.now() - memCached.timestamp < this.cacheTTL) {
      return memCached.data;
    }

    // Check IndexedDB cache
    const dbCached = await this.getFromDB<BloomFilter>(STORES.BLOOM, normalizedFile);
    if (dbCached) {
      // Reconstruct Uint8Array from stored data
      const filter: BloomFilter = {
        bits: new Uint8Array(dbCached.data.bits),
        hashCount: dbCached.data.hashCount,
        bitCount: dbCached.data.bitCount,
      };
      this.bloomFilterCache.set(normalizedFile, { data: filter, timestamp: dbCached.timestamp });
      return filter;
    }

    // Fetch from CDN
    const url = `${this.baseUrl}/indexes/bloom/${normalizedFile.replace(/\.parquet$/, '.bloom')}`;
    const response = await this.fetchFn(url);

    if (!response.ok) {
      throw new IndexLoadError(
        `Failed to load bloom filter: ${response.status}`,
        'bloom-filter',
        url
      );
    }

    // Parse bloom filter binary format
    // Format: [4 bytes hashCount][4 bytes bitCount][bits...]
    const buffer = await response.arrayBuffer();
    const view = new DataView(buffer);
    const hashCount = view.getUint32(0, true);
    const bitCount = view.getUint32(4, true);
    const bits = new Uint8Array(buffer, 8);

    const filter: BloomFilter = { bits, hashCount, bitCount };

    // Cache in memory
    this.bloomFilterCache.set(normalizedFile, { data: filter, timestamp: Date.now() });

    // Cache in IndexedDB (Uint8Array is directly serializable)
    await this.putToDB(STORES.BLOOM, normalizedFile, {
      bits: Array.from(bits),
      hashCount,
      bitCount,
    });

    return filter;
  }

  /**
   * Check if a title exists using bloom filter (fast negative lookup)
   *
   * Returns true if the title MAY exist (requires further lookup)
   * Returns false if the title definitely does NOT exist
   *
   * @param title - Article title to check
   * @returns True if title may exist, false if definitely not
   */
  async titleExists(title: string): Promise<boolean> {
    const normalizedTitle = this.normalizeTitle(title);

    // Get title index to find which file(s) to check
    const titleIndex = await this.getTitleIndex();

    // If we have the title index, check directly
    if (titleIndex.has(normalizedTitle)) {
      return true;
    }

    // Title not in index
    return false;
  }

  /**
   * Check if a title may exist in a specific file using bloom filter
   *
   * @param title - Article title
   * @param file - Parquet file path
   * @returns True if title may be in file, false if definitely not
   */
  async titleMayExistInFile(title: string, file: string): Promise<boolean> {
    const normalizedTitle = this.normalizeTitle(title);

    try {
      const filter = await this.getBloomFilter(file);
      return this.bloomContains(filter, normalizedTitle);
    } catch {
      // If bloom filter fails to load, assume title may exist
      return true;
    }
  }

  /**
   * Check if a bloom filter contains a value
   */
  private bloomContains(filter: BloomFilter, value: string): boolean {
    const hashes = this.getBloomHashes(value, filter.hashCount, filter.bitCount);

    for (const hash of hashes) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;

      if (byteIndex >= filter.bits.length) {
        return false;
      }

      if ((filter.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate bloom filter hashes for a value
   * Uses double hashing: h(i) = h1 + i * h2
   */
  private getBloomHashes(value: string, hashCount: number, bitCount: number): number[] {
    const h1 = this.hash32(value, 0);
    const h2 = this.hash32(value, h1);

    const hashes: number[] = [];
    for (let i = 0; i < hashCount; i++) {
      const hash = Math.abs((h1 + i * h2) % bitCount);
      hashes.push(hash);
    }

    return hashes;
  }

  /**
   * 32-bit hash function (FNV-1a variant)
   */
  private hash32(str: string, seed: number): number {
    let hash = seed ^ 2166136261;

    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  /**
   * Normalize a title for lookup
   * Converts to lowercase and replaces spaces with underscores
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_');
  }

  /**
   * Look up a title in the index
   *
   * @param title - Article title to look up
   * @returns Title index entry or null if not found
   */
  async lookupTitle(title: string): Promise<TitleIndexEntry | null> {
    const normalizedTitle = this.normalizeTitle(title);
    const index = await this.getTitleIndex();
    return index.get(normalizedTitle) ?? null;
  }

  /**
   * Get files for an article type
   *
   * @param type - Article type
   * @returns Array of Parquet file paths
   */
  async getFilesForType(type: ArticleType): Promise<string[]> {
    const manifest = await this.getTypeManifest();
    const entry = manifest.get(type);
    return entry?.files ?? [];
  }

  /**
   * Get article count for a type
   *
   * @param type - Article type
   * @returns Number of articles of this type
   */
  async getTypeCount(type: ArticleType): Promise<number> {
    const manifest = await this.getTypeManifest();
    const entry = manifest.get(type);
    return entry?.count ?? 0;
  }

  /**
   * Get autocomplete suggestions for a title prefix
   *
   * @param prefix - Title prefix to search
   * @param limit - Maximum number of suggestions
   * @returns Array of matching titles
   */
  async getAutocompleteSuggestions(prefix: string, limit: number = 10): Promise<string[]> {
    const normalizedPrefix = this.normalizeTitle(prefix);
    const index = await this.getTitleIndex();
    const suggestions: string[] = [];

    for (const title of index.keys()) {
      if (title.startsWith(normalizedPrefix)) {
        suggestions.push(title);
        if (suggestions.length >= limit) {
          break;
        }
      }
    }

    return suggestions;
  }

  /**
   * Clear all caches (memory and IndexedDB)
   */
  async clearCache(): Promise<void> {
    // Clear memory caches
    this.titleIndexCache = null;
    this.typeManifestCache = null;
    this.bloomFilterCache.clear();

    // Clear IndexedDB
    if (this.useIndexedDB && this.db && this.isIndexedDBAvailable()) {
      try {
        const transaction = this.db.transaction(
          [STORES.TITLES, STORES.TYPES, STORES.BLOOM, STORES.META],
          'readwrite'
        );
        transaction.objectStore(STORES.TITLES).clear();
        transaction.objectStore(STORES.TYPES).clear();
        transaction.objectStore(STORES.BLOOM).clear();
        transaction.objectStore(STORES.META).clear();
      } catch {
        // Ignore errors during cache clear
      }
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    titleIndex: boolean;
    typeManifest: boolean;
    bloomFilters: number;
  } {
    return {
      titleIndex: this.titleIndexCache !== null,
      typeManifest: this.typeManifestCache !== null,
      bloomFilters: this.bloomFilterCache.size,
    };
  }

  /**
   * Close IndexedDB connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.dbPromise = null;
    }
  }
}

/**
 * Create an IndexLoader instance
 *
 * @param baseUrl - CDN base URL
 * @param options - Optional configuration
 * @returns IndexLoader instance
 */
export function createIndexLoader(
  baseUrl: string,
  options?: {
    fetch?: typeof fetch;
    cacheTTL?: number;
    useIndexedDB?: boolean;
    dbName?: string;
  }
): IndexLoader {
  return new IndexLoader(baseUrl, options);
}
