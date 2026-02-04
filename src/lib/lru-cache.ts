/**
 * LRU Cache Utility
 *
 * A simple, efficient Least Recently Used (LRU) cache implementation
 * with configurable maximum size. Automatically evicts the least recently
 * used items when the cache reaches capacity.
 *
 * @module lib/lru-cache
 */

/**
 * Configuration options for LRUCache
 */
export interface LRUCacheOptions<K = string, V = unknown> {
  /** Maximum number of entries the cache can hold */
  maxSize: number;
  /** Maximum total size in bytes (requires sizeCalculator) */
  maxBytes?: number;
  /** Optional callback when an entry is evicted */
  onEvict?: ((key: K, value: V) => void) | undefined;
  /** Function to calculate the size of a value in bytes */
  sizeCalculator?: ((value: V) => number) | undefined;
}

/**
 * LRU Cache implementation using Map's insertion order
 *
 * Uses Map's natural iteration order (insertion order) to track access.
 * On each access, the entry is deleted and re-inserted to move it to the end.
 * Eviction removes entries from the beginning (oldest/least recently used).
 *
 * @template K - Key type (defaults to string)
 * @template V - Value type
 *
 * @example
 * ```typescript
 * const cache = new LRUCache<string, Article>({ maxSize: 100 });
 * cache.set('key1', article1);
 * const article = cache.get('key1'); // Marks as recently used
 * ```
 */
export class LRUCache<K = string, V = unknown> {
  private readonly maxSize: number;
  private readonly maxBytes: number;
  private readonly cache: Map<K, V>;
  private readonly sizeMap: Map<K, number>;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;
  private readonly sizeCalculator: ((value: V) => number) | undefined;
  private currentBytes: number = 0;

  /**
   * Create a new LRU cache
   *
   * @param options - Cache configuration
   */
  constructor(options: LRUCacheOptions<K, V> | number) {
    if (typeof options === 'number') {
      this.maxSize = options;
      this.maxBytes = Infinity;
      this.onEvict = undefined;
      this.sizeCalculator = undefined;
    } else {
      this.maxSize = options.maxSize;
      this.maxBytes = options.maxBytes ?? Infinity;
      this.onEvict = options.onEvict;
      this.sizeCalculator = options.sizeCalculator;
    }

    if (this.maxSize < 1) {
      throw new Error('LRUCache maxSize must be at least 1');
    }

    this.cache = new Map();
    this.sizeMap = new Map();
  }

  /**
   * Get a value from the cache
   *
   * If found, marks the entry as recently used (moves to end of Map).
   *
   * @param key - The key to look up
   * @returns The value if found, undefined otherwise
   */
  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Move to end (most recently used) by re-inserting
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Set a value in the cache
   *
   * If the cache is at capacity, evicts the least recently used entry.
   *
   * @param key - The key to set
   * @param value - The value to store
   * @returns The cache instance for chaining
   */
  set(key: K, value: V): this {
    const newSize = this.sizeCalculator ? this.sizeCalculator(value) : 0;

    // If key exists, delete it first to update insertion order
    if (this.cache.has(key)) {
      const oldSize = this.sizeMap.get(key) ?? 0;
      this.currentBytes -= oldSize;
      this.cache.delete(key);
      this.sizeMap.delete(key);
    }

    // Evict entries until we have room (count and bytes)
    while (
      this.cache.size > 0 &&
      (this.cache.size >= this.maxSize || this.currentBytes + newSize > this.maxBytes)
    ) {
      this.evictOldest();
    }

    this.cache.set(key, value);
    this.sizeMap.set(key, newSize);
    this.currentBytes += newSize;
    return this;
  }

  /**
   * Check if a key exists in the cache
   *
   * Note: This does NOT mark the entry as recently used.
   * Use get() if you want to update access time.
   *
   * @param key - The key to check
   * @returns True if the key exists
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Delete a key from the cache
   *
   * @param key - The key to delete
   * @returns True if the key was found and deleted
   */
  delete(key: K): boolean {
    const value = this.cache.get(key);
    const deleted = this.cache.delete(key);

    if (deleted) {
      const size = this.sizeMap.get(key) ?? 0;
      this.currentBytes -= size;
      this.sizeMap.delete(key);

      if (this.onEvict && value !== undefined) {
        this.onEvict(key, value);
      }
    }

    return deleted;
  }

  /**
   * Clear all entries from the cache
   *
   * Calls onEvict for each entry if configured.
   */
  clear(): void {
    if (this.onEvict) {
      for (const [key, value] of this.cache) {
        this.onEvict(key, value);
      }
    }
    this.cache.clear();
    this.sizeMap.clear();
    this.currentBytes = 0;
  }

  /**
   * Get the current number of entries in the cache
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum capacity of the cache
   */
  get capacity(): number {
    return this.maxSize;
  }

  /**
   * Get the current total size in bytes
   * (only meaningful if sizeCalculator was provided)
   */
  get bytes(): number {
    return this.currentBytes;
  }

  /**
   * Get the maximum bytes capacity
   */
  get maxBytesCapacity(): number {
    return this.maxBytes;
  }

  /**
   * Iterate over all keys in the cache
   *
   * Iteration order is from least to most recently used.
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Iterate over all values in the cache
   *
   * Iteration order is from least to most recently used.
   */
  values(): IterableIterator<V> {
    return this.cache.values();
  }

  /**
   * Iterate over all entries in the cache
   *
   * Iteration order is from least to most recently used.
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * Execute a callback for each entry
   *
   * Iteration order is from least to most recently used.
   */
  forEach(callback: (value: V, key: K, cache: LRUCache<K, V>) => void): void {
    this.cache.forEach((value, key) => callback(value, key, this));
  }

  /**
   * Get statistics about the cache
   */
  getStats(): {
    size: number;
    capacity: number;
    utilization: number;
    bytes: number;
    maxBytes: number;
    bytesUtilization: number;
  } {
    return {
      size: this.cache.size,
      capacity: this.maxSize,
      utilization: this.cache.size / this.maxSize,
      bytes: this.currentBytes,
      maxBytes: this.maxBytes,
      bytesUtilization: this.maxBytes === Infinity ? 0 : this.currentBytes / this.maxBytes,
    };
  }

  /**
   * Peek at a value without marking it as recently used
   *
   * @param key - The key to look up
   * @returns The value if found, undefined otherwise
   */
  peek(key: K): V | undefined {
    return this.cache.get(key);
  }

  /**
   * Evict the oldest (least recently used) entry
   */
  private evictOldest(): void {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      const value = this.cache.get(oldestKey);
      const size = this.sizeMap.get(oldestKey) ?? 0;
      this.cache.delete(oldestKey);
      this.sizeMap.delete(oldestKey);
      this.currentBytes -= size;

      if (this.onEvict && value !== undefined) {
        this.onEvict(oldestKey, value);
      }
    }
  }

  /**
   * Make the cache iterable
   */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.cache.entries();
  }
}

/**
 * Create an LRU cache with the specified maximum size
 *
 * @param maxSize - Maximum number of entries
 * @param onEvict - Optional callback when entries are evicted
 * @returns A new LRU cache instance
 *
 * @example
 * ```typescript
 * const cache = createLRUCache<string, number>(100);
 * ```
 */
export function createLRUCache<K = string, V = unknown>(
  maxSize: number,
  onEvict?: ((key: K, value: V) => void) | undefined
): LRUCache<K, V> {
  const opts: LRUCacheOptions<K, V> = { maxSize };
  if (onEvict !== undefined) {
    opts.onEvict = onEvict;
  }
  return new LRUCache<K, V>(opts);
}

/**
 * Create an LRU cache with byte-based eviction
 *
 * @param options - Cache configuration including maxSize and maxBytes
 * @returns A new LRU cache instance with byte tracking
 *
 * @example
 * ```typescript
 * const cache = createByteLimitedLRUCache<number, MyData>({
 *   maxSize: 100000,
 *   maxBytes: 500 * 1024 * 1024, // 500MB
 *   sizeCalculator: (data) => data.buffer.byteLength,
 *   onEvict: (key, value) => console.log(`Evicted ${key}`),
 * });
 * ```
 */
export function createByteLimitedLRUCache<K = string, V = unknown>(
  options: LRUCacheOptions<K, V>
): LRUCache<K, V> {
  return new LRUCache<K, V>(options);
}

export default LRUCache;
