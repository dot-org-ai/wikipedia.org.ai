// @ts-nocheck - Complex index building with Parquet integration requiring extensive type guards
/**
 * Lookup Index Generation
 *
 * Builds secondary indexes for fast article lookup:
 * - titles.json: Map titles to file locations
 * - types.json: Map types to partition files
 * - Bloom filters: Per-file title membership test
 */

import type {
  ArticleRecord,
  ArticleType,
  TitleIndex,
  TitleIndexEntry,
  TypeIndex,
  FileBloomFilter,
  BloomFilterConfig,
  Manifest,
} from './types.js';
import { ARTICLE_TYPES } from './types.js';
import { IDIndex, type IDIndexEntry, type ArticleLocation } from '../indexes/id-index.js';
import { LRUCache } from '../lib/lru-cache.js';

/** Default bloom filter configuration */
const DEFAULT_FALSE_POSITIVE_RATE = 0.01;

/** Maximum number of bloom filters to cache in memory */
const MAX_BLOOM_FILTER_CACHE_SIZE = 100;

/**
 * IndexBuilder - Builds lookup indexes from Parquet files
 *
 * Features:
 * - Title -> file location index
 * - Type -> files index
 * - Bloom filters for fast negative lookups
 * - Gzip compression for small download sizes
 */
export class IndexBuilder {
  private titleIndex: TitleIndex = {};
  private typeIndex: TypeIndex = {} as TypeIndex;
  private idIndex: IDIndex = new IDIndex();
  private bloomFilters: LRUCache<string, BloomFilter>;
  private readonly outputDir: string;
  private readonly bloomConfig: BloomFilterConfig;

  constructor(
    outputDir: string,
    bloomConfig: Partial<BloomFilterConfig> = {}
  ) {
    this.outputDir = outputDir;
    this.bloomConfig = {
      expectedItems: bloomConfig.expectedItems ?? 10000,
      falsePositiveRate: bloomConfig.falsePositiveRate ?? DEFAULT_FALSE_POSITIVE_RATE,
    };
    this.bloomFilters = new LRUCache<string, BloomFilter>(MAX_BLOOM_FILTER_CACHE_SIZE);

    // Initialize type index
    for (const type of ARTICLE_TYPES) {
      this.typeIndex[type] = [];
    }
  }

  /**
   * Add articles from a file to the indexes
   */
  addArticles(
    articles: ArticleRecord[],
    file: string,
    rowGroup: number,
    startRow: number
  ): void {
    // Get or create bloom filter for this file
    if (!this.bloomFilters.has(file)) {
      this.bloomFilters.set(
        file,
        new BloomFilter(this.bloomConfig.expectedItems, this.bloomConfig.falsePositiveRate)
      );
    }
    const bloom = this.bloomFilters.get(file)!;

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const normalizedTitle = normalizeTitle(article.title);

      // Add to title index
      this.titleIndex[normalizedTitle] = {
        file,
        rowGroup,
        row: startRow + i,
      };

      // Add to ID index
      this.idIndex.addArticle(article.$id, {
        type: article.$type,
        file,
        rowGroup,
        row: startRow + i,
      });

      // Add to bloom filter
      bloom.add(normalizedTitle);
    }
  }

  /**
   * Register a file for a type partition
   */
  registerTypeFile(type: ArticleType, file: string): void {
    if (!this.typeIndex[type].includes(file)) {
      this.typeIndex[type].push(file);
    }
  }

  /**
   * Build indexes from a manifest
   */
  async buildFromManifest(manifest: Manifest): Promise<void> {
    // Register all data files by type
    for (const file of manifest.dataFiles) {
      if (file.type) {
        this.registerTypeFile(file.type, file.path);
      }
    }
  }

  /**
   * Finalize and write all indexes
   */
  async finalize(): Promise<{
    titlesPath: string;
    typesPath: string;
    idsPath: string;
    bloomPaths: string[];
  }> {
    // Write title index
    const titlesPath = await this.writeTitleIndex();

    // Write type index
    const typesPath = await this.writeTypeIndex();

    // Write ID index
    const idsPath = await this.writeIDIndex();

    // Write bloom filters
    const bloomPaths = await this.writeBloomFilters();

    return { titlesPath, typesPath, idsPath, bloomPaths };
  }

  /**
   * Get the title index
   */
  getTitleIndex(): TitleIndex {
    return this.titleIndex;
  }

  /**
   * Get the type index
   */
  getTypeIndex(): TypeIndex {
    return this.typeIndex;
  }

  /**
   * Get the ID index
   */
  getIDIndex(): IDIndex {
    return this.idIndex;
  }

  /**
   * Write title index with gzip compression
   */
  private async writeTitleIndex(): Promise<string> {
    const path = `${this.outputDir}/indexes/titles.json.gz`;
    const json = JSON.stringify(this.titleIndex);
    const compressed = await gzipCompress(json);

    await this.writeFile(path, compressed);
    return path.replace(this.outputDir + '/', '');
  }

  /**
   * Write type index with gzip compression
   */
  private async writeTypeIndex(): Promise<string> {
    const path = `${this.outputDir}/indexes/types.json.gz`;
    const json = JSON.stringify(this.typeIndex);
    const compressed = await gzipCompress(json);

    await this.writeFile(path, compressed);
    return path.replace(this.outputDir + '/', '');
  }

  /**
   * Write ID index with gzip compression
   */
  private async writeIDIndex(): Promise<string> {
    const path = `${this.outputDir}/indexes/ids.json.gz`;
    const json = this.idIndex.toJSON();
    const compressed = await gzipCompress(json);

    await this.writeFile(path, compressed);
    return path.replace(this.outputDir + '/', '');
  }

  /**
   * Write bloom filters
   */
  private async writeBloomFilters(): Promise<string[]> {
    const paths: string[] = [];

    for (const [file, bloom] of this.bloomFilters) {
      const filterData: FileBloomFilter = {
        file,
        filter: bloom.toBase64(),
        hashCount: bloom.hashCount,
        bitCount: bloom.bitCount,
      };

      // Generate a safe filename from the parquet file path
      const safeName = file.replace(/[\/\\]/g, '_').replace(/\.parquet$/, '');
      const path = `${this.outputDir}/indexes/bloom/${safeName}.json`;

      await this.writeFile(path, JSON.stringify(filterData));
      paths.push(path.replace(this.outputDir + '/', ''));
    }

    return paths;
  }

  /**
   * Platform-specific file write
   */
  private async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    if (typeof Bun !== 'undefined') {
      await Bun.write(path, data);
    } else {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    }
  }
}

/**
 * Simple Bloom filter implementation
 *
 * Features:
 * - Configurable false positive rate
 * - Multiple hash functions using double hashing
 * - Base64 serialization for storage
 */
export class BloomFilter {
  private bits: Uint8Array;
  readonly bitCount: number;
  readonly hashCount: number;

  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Calculate optimal filter size
    // m = -n * ln(p) / (ln(2)^2)
    this.bitCount = Math.ceil(
      (-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2)
    );

    // Calculate optimal number of hash functions
    // k = m/n * ln(2)
    this.hashCount = Math.ceil((this.bitCount / expectedItems) * Math.LN2);

    // Initialize bit array
    this.bits = new Uint8Array(Math.ceil(this.bitCount / 8));
  }

  /**
   * Add an item to the filter
   */
  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.bitCount;
      this.bits[Math.floor(index / 8)] |= 1 << (index % 8);
    }
  }

  /**
   * Check if an item might be in the filter
   * False means definitely not in set
   * True means probably in set (may be false positive)
   */
  mightContain(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.bitCount;
      if ((this.bits[Math.floor(index / 8)] & (1 << (index % 8))) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Export filter as base64 string
   */
  toBase64(): string {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(this.bits).toString('base64');
    }
    // Browser fallback
    let binary = '';
    for (let i = 0; i < this.bits.length; i++) {
      binary += String.fromCharCode(this.bits[i]);
    }
    return btoa(binary);
  }

  /**
   * Import filter from base64 string
   */
  static fromBase64(data: string, bitCount: number, hashCount: number): BloomFilter {
    const filter = Object.create(BloomFilter.prototype);
    filter.bitCount = bitCount;
    filter.hashCount = hashCount;

    if (typeof Buffer !== 'undefined') {
      filter.bits = new Uint8Array(Buffer.from(data, 'base64'));
    } else {
      // Browser fallback
      const binary = atob(data);
      filter.bits = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        filter.bits[i] = binary.charCodeAt(i);
      }
    }

    return filter;
  }

  /**
   * Generate hash values for an item using double hashing
   */
  private getHashes(item: string): number[] {
    const hash1 = this.fnv1a(item);
    const hash2 = this.djb2(item);

    const hashes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      // Double hashing: h(i) = h1 + i*h2
      hashes.push(Math.abs((hash1 + i * hash2) >>> 0));
    }

    return hashes;
  }

  /**
   * FNV-1a hash function
   */
  private fnv1a(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return hash;
  }

  /**
   * DJB2 hash function
   */
  private djb2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }
}

/**
 * Gzip compress a string
 */
async function gzipCompress(data: string): Promise<Uint8Array> {
  if (typeof Bun !== 'undefined') {
    // Bun's native gzip
    return Bun.gzipSync(Buffer.from(data));
  }

  // Node.js zlib
  const { gzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  const gzipAsync = promisify(gzip);
  return gzipAsync(Buffer.from(data));
}

/**
 * Gzip decompress data
 */
export async function gzipDecompress(data: Uint8Array): Promise<string> {
  if (typeof Bun !== 'undefined') {
    return Bun.gunzipSync(new Uint8Array(data) as Uint8Array<ArrayBuffer>).toString();
  }

  const { gunzip } = await import('node:zlib');
  const { promisify } = await import('node:util');
  const gunzipAsync = promisify(gunzip);
  const result = await gunzipAsync(Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  return result.toString();
}

/**
 * Normalize a title for index lookup
 */
export function normalizeTitle(title: string): string {
  // Lowercase for case-insensitive lookup
  let normalized = title.toLowerCase();

  // Replace underscores with spaces
  normalized = normalized.replace(/_/g, ' ');

  // Trim whitespace
  normalized = normalized.trim();

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized;
}

/**
 * Load title index from file
 */
export async function loadTitleIndex(path: string): Promise<TitleIndex> {
  const data = await readFile(path);

  if (path.endsWith('.gz')) {
    const decompressed = await gzipDecompress(data);
    return JSON.parse(decompressed);
  }

  return JSON.parse(new TextDecoder().decode(data));
}

/**
 * Load type index from file
 */
export async function loadTypeIndex(path: string): Promise<TypeIndex> {
  const data = await readFile(path);

  if (path.endsWith('.gz')) {
    const decompressed = await gzipDecompress(data);
    return JSON.parse(decompressed);
  }

  return JSON.parse(new TextDecoder().decode(data));
}

/**
 * Load bloom filter from file
 */
export async function loadBloomFilter(path: string): Promise<BloomFilter> {
  const data = await readFile(path);
  const json: FileBloomFilter = JSON.parse(new TextDecoder().decode(data));

  return BloomFilter.fromBase64(json.filter, json.bitCount, json.hashCount);
}

/**
 * Platform-specific file read
 */
async function readFile(path: string): Promise<Uint8Array> {
  if (typeof Bun !== 'undefined') {
    const file = Bun.file(path);
    return new Uint8Array(await file.arrayBuffer());
  }

  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

/**
 * Create an index builder with default settings
 */
export function createIndexBuilder(outputDir: string): IndexBuilder {
  return new IndexBuilder(outputDir);
}

/**
 * Lookup an article by title using the index
 */
export async function lookupByTitle(
  title: string,
  titleIndex: TitleIndex,
  bloomFilters?: Map<string, BloomFilter>
): Promise<TitleIndexEntry | null> {
  const normalized = normalizeTitle(title);

  // Direct lookup
  const entry = titleIndex[normalized];
  if (entry) {
    return entry;
  }

  // If bloom filters provided, check if title is definitely not in any file
  if (bloomFilters) {
    for (const bloom of bloomFilters.values()) {
      if (bloom.mightContain(normalized)) {
        // Title might be in this file, but index says no
        // This could be a false positive from the bloom filter
        return null;
      }
    }
  }

  return null;
}

/**
 * Get files for a specific article type
 */
export function getFilesForType(type: ArticleType, typeIndex: TypeIndex): string[] {
  return typeIndex[type] ?? [];
}

/**
 * Build a complete title-to-ID map from the title index
 * Useful for relationship resolution
 */
export function buildTitleToIdMap(
  _titleIndex: TitleIndex,
  articles: ArticleRecord[]
): Map<string, string> {
  const map = new Map<string, string>();

  for (const article of articles) {
    const normalized = normalizeTitle(article.title);
    map.set(normalized, article.$id);
  }

  return map;
}
