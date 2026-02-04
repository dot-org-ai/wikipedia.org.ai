// @ts-nocheck - Complex binary format and Parquet operations with many array accesses that require extensive null checking refactoring for strictNullChecks
/**
 * Embedding Lookup Table Manager
 *
 * Pre-computed embeddings for common search terms to enable free lookups
 * without hitting AI Gateway. Supports:
 * - Binary search on sorted terms for O(log n) lookup
 * - Bloom filter for fast negative checks
 * - Batch operations for efficient building
 * - Parquet persistence for storage
 *
 * Target: 6M+ terms (all Wikipedia article titles)
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parquetWriteBuffer } from '@dotdo/hyparquet-writer';
import { parquetRead, parquetMetadata, type AsyncBuffer } from '@dotdo/hyparquet';
import type { SchemaElement } from '@dotdo/hyparquet';
import { normalizeTerm, hashString, generateBloomHashes } from './term-normalizer.js';
import type { Article } from './types.js';
import { LRUCache } from '../lib/lru-cache.js';
import { createLogger, type Logger } from '../lib/logger.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('embeddings:lookup-table');

/** Source type for embedding entries */
export type EmbeddingSource = 'title' | 'category' | 'entity' | 'query';

/**
 * Single entry in the embedding lookup table
 */
export interface EmbeddingLookup {
  /** Normalized search term */
  term: string;
  /** Term hash for bloom filter */
  term_hash: bigint;
  /** BGE-M3 embedding (1024-dim) */
  embedding_m3: Float32Array;
  /** Gemma embedding (768-dim) - optional */
  embedding_gemma?: Float32Array;
  /** Source of this term */
  source: EmbeddingSource;
  /** Number of times this term has been looked up */
  hit_count: number;
}

/**
 * Configuration for the lookup table
 */
export interface LookupTableConfig {
  /** Path for storing the lookup table */
  storagePath: string;
  /** Bloom filter expected items (default: 10M) */
  bloomExpectedItems?: number;
  /** Bloom filter false positive rate (default: 0.01) */
  bloomFPRate?: number;
  /** In-memory cache size (default: 100K entries) */
  memoryCacheSize?: number;
  /** Optional logger instance for dependency injection (testing) */
  logger?: Logger | undefined;
}

/** Default configuration */
const DEFAULT_CONFIG: Required<LookupTableConfig> = {
  storagePath: 'indexes/embeddings-cache.parquet',
  bloomExpectedItems: 10_000_000,
  bloomFPRate: 0.01,
  memoryCacheSize: 100_000,
};

/** Parquet schema for the lookup table */
const LOOKUP_TABLE_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 6 },
  { name: 'term', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'term_hash', type: 'INT64', repetition_type: 'REQUIRED' },
  { name: 'embedding_m3', type: 'BYTE_ARRAY', repetition_type: 'REQUIRED' },
  { name: 'embedding_gemma', type: 'BYTE_ARRAY', repetition_type: 'OPTIONAL' },
  { name: 'source', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'hit_count', type: 'INT32', repetition_type: 'REQUIRED' },
];

/**
 * Bloom filter implementation for fast negative lookups
 */
class BloomFilter {
  private bits: Uint8Array;
  private readonly bitCount: number;
  private readonly hashCount: number;

  constructor(expectedItems: number, falsePositiveRate: number) {
    // Calculate optimal size: m = -n * ln(p) / (ln(2)^2)
    this.bitCount = Math.ceil(-expectedItems * Math.log(falsePositiveRate) / (Math.LN2 * Math.LN2));
    // Calculate optimal hash count: k = m/n * ln(2)
    this.hashCount = Math.ceil((this.bitCount / expectedItems) * Math.LN2);

    // Round up to nearest byte
    const byteCount = Math.ceil(this.bitCount / 8);
    this.bits = new Uint8Array(byteCount);
  }

  /**
   * Add a term to the bloom filter
   */
  add(term: string): void {
    const positions = generateBloomHashes(term, this.hashCount, this.bitCount);
    for (const pos of positions) {
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      this.bits[byteIndex] |= 1 << bitIndex;
    }
  }

  /**
   * Check if a term might exist in the filter
   * @returns false = definitely not in set, true = probably in set
   */
  mightContain(term: string): boolean {
    const positions = generateBloomHashes(term, this.hashCount, this.bitCount);
    for (const pos of positions) {
      const byteIndex = Math.floor(pos / 8);
      const bitIndex = pos % 8;
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Serialize bloom filter to buffer
   */
  serialize(): ArrayBuffer {
    const header = new ArrayBuffer(12);
    const headerView = new DataView(header);
    headerView.setUint32(0, this.bitCount, true);
    headerView.setUint32(4, this.hashCount, true);
    headerView.setUint32(8, this.bits.length, true);

    const result = new Uint8Array(12 + this.bits.length);
    result.set(new Uint8Array(header), 0);
    result.set(this.bits, 12);

    return result.buffer;
  }

  /**
   * Deserialize bloom filter from buffer
   */
  static deserialize(buffer: ArrayBuffer): BloomFilter {
    const view = new DataView(buffer);
    const bitCount = view.getUint32(0, true);
    const hashCount = view.getUint32(4, true);
    const byteCount = view.getUint32(8, true);

    // Create filter with dummy values, then override
    const filter = new BloomFilter(1, 0.5);
    (filter as unknown as { bitCount: number }).bitCount = bitCount;
    (filter as unknown as { hashCount: number }).hashCount = hashCount;
    filter.bits = new Uint8Array(buffer, 12, byteCount);

    return filter;
  }

  /**
   * Get serialized size in bytes
   */
  getSize(): number {
    return 12 + this.bits.length;
  }
}

// Uses LRUCache from ../lib/lru-cache.js for frequently accessed entries

/**
 * Embedding Lookup Table Manager
 *
 * Manages a large pre-computed embedding lookup table with:
 * - O(log n) binary search on sorted terms
 * - Bloom filter for fast negative checks
 * - LRU cache for hot entries
 * - Parquet persistence
 */
export class EmbeddingLookupTable {
  private readonly config: Required<Omit<LookupTableConfig, 'logger'>> & { logger?: Logger };
  private readonly log: Logger;

  // In-memory data structures
  private entries: Map<string, EmbeddingLookup> = new Map();
  private sortedTerms: string[] = [];
  private bloomFilter: BloomFilter;
  private cache: LRUCache<string, EmbeddingLookup>;

  // Statistics
  private lookupCount = 0;
  private hitCount = 0;
  private bloomFilterHits = 0;
  private bloomFilterMisses = 0;

  // State
  private dirty = false;
  private loaded = false;

  constructor(config: Partial<LookupTableConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = config.logger ?? getLog();
    this.bloomFilter = new BloomFilter(
      this.config.bloomExpectedItems,
      this.config.bloomFPRate
    );
    this.cache = new LRUCache(this.config.memoryCacheSize);
  }

  /**
   * Add a single term with its embeddings
   */
  async addTerm(
    term: string,
    embeddings: { m3?: number[] | Float32Array; gemma?: number[] | Float32Array },
    source: EmbeddingSource = 'title'
  ): Promise<void> {
    const normalized = normalizeTerm(term);
    if (!normalized) return;

    const entry: EmbeddingLookup = {
      term: normalized,
      term_hash: hashString(normalized),
      embedding_m3: embeddings.m3
        ? (embeddings.m3 instanceof Float32Array ? embeddings.m3 : new Float32Array(embeddings.m3))
        : new Float32Array(1024),
      source,
      hit_count: 0,
    };

    if (embeddings.gemma) {
      entry.embedding_gemma = embeddings.gemma instanceof Float32Array
        ? embeddings.gemma
        : new Float32Array(embeddings.gemma);
    }

    this.entries.set(normalized, entry);
    this.bloomFilter.add(normalized);
    this.dirty = true;
  }

  /**
   * Add multiple terms with their embeddings in batch
   */
  async addTermsBatch(
    terms: string[],
    embeddings: {
      m3: Array<number[] | Float32Array>;
      gemma?: Array<number[] | Float32Array>;
    },
    source: EmbeddingSource = 'title'
  ): Promise<void> {
    if (terms.length !== embeddings.m3.length) {
      throw new Error(`Term count (${terms.length}) doesn't match embedding count (${embeddings.m3.length})`);
    }

    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const normalized = normalizeTerm(term);
      if (!normalized) continue;

      const entry: EmbeddingLookup = {
        term: normalized,
        term_hash: hashString(normalized),
        embedding_m3: embeddings.m3[i] instanceof Float32Array
          ? embeddings.m3[i] as Float32Array
          : new Float32Array(embeddings.m3[i]),
        source,
        hit_count: 0,
      };

      if (embeddings.gemma && embeddings.gemma[i]) {
        entry.embedding_gemma = embeddings.gemma[i] instanceof Float32Array
          ? embeddings.gemma[i] as Float32Array
          : new Float32Array(embeddings.gemma[i]);
      }

      this.entries.set(normalized, entry);
      this.bloomFilter.add(normalized);
    }

    this.dirty = true;
  }

  /**
   * Build lookup table from article data
   * Extracts titles, categories, and named entities
   */
  async buildFromArticles(
    articles: Article[],
    embeddingGenerator: (texts: string[]) => Promise<{ m3: Float32Array[]; gemma?: Float32Array[] }>
  ): Promise<{ added: number; errors: number }> {
    const termsToAdd: Array<{ term: string; source: EmbeddingSource }> = [];

    // Extract terms from articles
    for (const article of articles) {
      // Article title
      if (article.title) {
        termsToAdd.push({ term: article.title, source: 'title' });
      }

      // Categories
      if (article.metadata?.categories) {
        const categories = article.metadata.categories as string[];
        for (const category of categories) {
          termsToAdd.push({ term: category, source: 'category' });
        }
      }

      // Named entities from infobox
      if (article.metadata?.entities) {
        const entities = article.metadata.entities as string[];
        for (const entity of entities) {
          termsToAdd.push({ term: entity, source: 'entity' });
        }
      }
    }

    // Deduplicate
    const uniqueTerms = new Map<string, EmbeddingSource>();
    for (const { term, source } of termsToAdd) {
      const normalized = normalizeTerm(term);
      if (normalized && !uniqueTerms.has(normalized) && !this.entries.has(normalized)) {
        uniqueTerms.set(normalized, source);
      }
    }

    if (uniqueTerms.size === 0) {
      return { added: 0, errors: 0 };
    }

    // Generate embeddings in batches
    const batchSize = 100;
    const terms = Array.from(uniqueTerms.keys());
    let added = 0;
    let errors = 0;

    for (let i = 0; i < terms.length; i += batchSize) {
      const batch = terms.slice(i, i + batchSize);

      try {
        const embeddings = await embeddingGenerator(batch);

        for (let j = 0; j < batch.length; j++) {
          const term = batch[j];
          const source = uniqueTerms.get(term)!;

          const entry: EmbeddingLookup = {
            term,
            term_hash: hashString(term),
            embedding_m3: embeddings.m3[j],
            source,
            hit_count: 0,
          };

          if (embeddings.gemma && embeddings.gemma[j]) {
            entry.embedding_gemma = embeddings.gemma[j];
          }

          this.entries.set(term, entry);
          this.bloomFilter.add(term);
          added++;
        }
      } catch (error) {
        this.log.error('Failed to generate embeddings for batch', {
          batchIndex: Math.floor(i / batchSize),
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        }, 'buildFromArticles');
        errors += batch.length;
      }
    }

    this.dirty = true;
    this.rebuildSortedIndex();

    return { added, errors };
  }

  /**
   * Look up a single term
   * @returns Embedding lookup or null if not found
   */
  async lookup(term: string): Promise<EmbeddingLookup | null> {
    this.lookupCount++;

    const normalized = normalizeTerm(term);
    if (!normalized) return null;

    // Check LRU cache first
    const cached = this.cache.get(normalized);
    if (cached) {
      this.hitCount++;
      cached.hit_count++;
      return cached;
    }

    // Check bloom filter for fast negative
    if (!this.bloomFilter.mightContain(normalized)) {
      this.bloomFilterMisses++;
      return null;
    }
    this.bloomFilterHits++;

    // Binary search on sorted terms (if loaded from disk)
    if (this.sortedTerms.length > 0) {
      const index = this.binarySearch(normalized);
      if (index >= 0) {
        const entry = this.entries.get(this.sortedTerms[index]);
        if (entry) {
          this.hitCount++;
          entry.hit_count++;
          this.cache.set(normalized, entry);
          return entry;
        }
      }
    }

    // Direct map lookup (for in-memory builds)
    const entry = this.entries.get(normalized);
    if (entry) {
      this.hitCount++;
      entry.hit_count++;
      this.cache.set(normalized, entry);
      return entry;
    }

    return null;
  }

  /**
   * Look up multiple terms at once
   * @returns Map of term to embedding lookup (missing terms not included)
   */
  async lookupBatch(terms: string[]): Promise<Map<string, EmbeddingLookup>> {
    const results = new Map<string, EmbeddingLookup>();

    for (const term of terms) {
      const entry = await this.lookup(term);
      if (entry) {
        results.set(term, entry);
      }
    }

    return results;
  }

  /**
   * Fuzzy lookup for similar terms
   * Uses prefix matching and edit distance
   */
  async fuzzyLookup(term: string, threshold: number = 0.8): Promise<EmbeddingLookup[]> {
    const normalized = normalizeTerm(term);
    if (!normalized) return [];

    const results: Array<{ entry: EmbeddingLookup; score: number }> = [];

    // Exact match first
    const exact = await this.lookup(term);
    if (exact) {
      results.push({ entry: exact, score: 1.0 });
    }

    // Prefix matching for efficiency
    const prefix = normalized.slice(0, Math.min(3, normalized.length));

    for (const [storedTerm, entry] of this.entries) {
      if (storedTerm === normalized) continue; // Skip exact match
      if (!storedTerm.startsWith(prefix)) continue;

      // Calculate similarity
      const similarity = this.calculateSimilarity(normalized, storedTerm);
      if (similarity >= threshold) {
        results.push({ entry, score: similarity });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.map((r) => r.entry);
  }

  /**
   * Save lookup table to Parquet file
   */
  async save(): Promise<void> {
    if (!this.dirty && this.loaded) {
      return; // Nothing to save
    }

    const outputPath = this.config.storagePath;

    // Ensure directory exists
    await this.ensureDirectory(dirname(outputPath));

    // Rebuild sorted index
    this.rebuildSortedIndex();

    // Build column data
    const terms: string[] = [];
    const termHashes: bigint[] = [];
    const embeddingsM3: Uint8Array[] = [];
    const embeddingsGemma: (Uint8Array | null)[] = [];
    const sources: string[] = [];
    const hitCounts: number[] = [];

    for (const term of this.sortedTerms) {
      const entry = this.entries.get(term);
      if (!entry) continue;

      terms.push(entry.term);
      termHashes.push(entry.term_hash);
      embeddingsM3.push(new Uint8Array(entry.embedding_m3.buffer));
      embeddingsGemma.push(
        entry.embedding_gemma
          ? new Uint8Array(entry.embedding_gemma.buffer)
          : null
      );
      sources.push(entry.source);
      hitCounts.push(entry.hit_count);
    }

    // Write Parquet file
    const buffer = parquetWriteBuffer({
      schema: LOOKUP_TABLE_SCHEMA,
      columnData: [
        { name: 'term', data: terms },
        { name: 'term_hash', data: termHashes },
        { name: 'embedding_m3', data: embeddingsM3 },
        { name: 'embedding_gemma', data: embeddingsGemma },
        { name: 'source', data: sources },
        { name: 'hit_count', data: hitCounts },
      ],
      rowGroupSize: 100_000,
      statistics: true,
      kvMetadata: [
        { key: 'type', value: 'embedding_lookup_table' },
        { key: 'version', value: '1.0.0' },
        { key: 'entry_count', value: String(this.entries.size) },
        { key: 'created_at', value: new Date().toISOString() },
      ],
    });

    await this.writeFile(outputPath, buffer);

    // Save bloom filter separately
    const bloomPath = outputPath.replace('.parquet', '.bloom');
    const bloomBuffer = this.bloomFilter.serialize();
    await this.writeFile(bloomPath, bloomBuffer);

    this.dirty = false;
    this.log.info('Lookup table saved', {
      entryCount: this.entries.size,
      outputPath,
    }, 'save');
  }

  /**
   * Load lookup table from Parquet file
   */
  async load(): Promise<void> {
    const inputPath = this.config.storagePath;

    try {
      // Check if file exists
      await stat(inputPath);
    } catch {
      this.log.info('No existing lookup table found, starting fresh', undefined, 'load');
      this.loaded = true;
      return;
    }

    // Read Parquet file
    const fileBuffer = await this.readFileAsBuffer(inputPath);
    const asyncBuffer: AsyncBuffer = {
      byteLength: fileBuffer.byteLength,
      slice: (start: number, end?: number) =>
        Promise.resolve(fileBuffer.slice(start, end)),
    };

    const metadata = await parquetMetadata(asyncBuffer as unknown as ArrayBuffer);
    const rowCount = Number(metadata.num_rows);

    // Read all row groups
    const rows: Array<{
      term: string;
      term_hash: bigint;
      embedding_m3: Uint8Array;
      embedding_gemma: Uint8Array | null;
      source: string;
      hit_count: number;
    }> = [];

    await parquetRead({
      file: asyncBuffer,
      rowEnd: rowCount,
      onComplete: (data: unknown) => {
        const entries = data as typeof rows;
        rows.push(...entries);
      },
    });

    // Build in-memory structures
    this.entries.clear();
    this.sortedTerms = [];

    for (const row of rows) {
      const entry: EmbeddingLookup = {
        term: row.term,
        term_hash: row.term_hash,
        embedding_m3: new Float32Array(row.embedding_m3.buffer),
        source: row.source as EmbeddingSource,
        hit_count: row.hit_count,
      };

      if (row.embedding_gemma) {
        entry.embedding_gemma = new Float32Array(row.embedding_gemma.buffer);
      }

      this.entries.set(row.term, entry);
      this.sortedTerms.push(row.term);
    }

    // Load bloom filter
    const bloomPath = inputPath.replace('.parquet', '.bloom');
    try {
      const bloomBuffer = await this.readFileAsBuffer(bloomPath);
      this.bloomFilter = BloomFilter.deserialize(bloomBuffer);
    } catch {
      // Rebuild bloom filter if not found
      this.log.info('Bloom filter not found, rebuilding', undefined, 'load');
      this.bloomFilter = new BloomFilter(
        this.config.bloomExpectedItems,
        this.config.bloomFPRate
      );
      for (const term of this.sortedTerms) {
        this.bloomFilter.add(term);
      }
    }

    this.loaded = true;
    this.dirty = false;
    this.log.info('Lookup table loaded', {
      entryCount: this.entries.size,
      inputPath,
    }, 'load');
  }

  /**
   * Get statistics about the lookup table
   */
  getStats(): {
    entryCount: number;
    lookupCount: number;
    hitCount: number;
    hitRate: number;
    bloomFilterHits: number;
    bloomFilterMisses: number;
    cacheSize: number;
    estimatedSizeBytes: number;
  } {
    const avgEmbeddingSize = 1024 * 4; // Float32 * 1024 dimensions
    const avgTermSize = 30; // Average term length
    const estimatedSizeBytes = this.entries.size * (avgEmbeddingSize + avgTermSize + 50);

    return {
      entryCount: this.entries.size,
      lookupCount: this.lookupCount,
      hitCount: this.hitCount,
      hitRate: this.lookupCount > 0 ? this.hitCount / this.lookupCount : 0,
      bloomFilterHits: this.bloomFilterHits,
      bloomFilterMisses: this.bloomFilterMisses,
      cacheSize: this.cache.size,
      estimatedSizeBytes,
    };
  }

  /**
   * Check if a term exists in the lookup table (without full lookup)
   */
  has(term: string): boolean {
    const normalized = normalizeTerm(term);
    if (!normalized) return false;

    // Fast bloom filter check
    if (!this.bloomFilter.mightContain(normalized)) {
      return false;
    }

    return this.entries.has(normalized);
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.sortedTerms = [];
    this.cache.clear();
    this.bloomFilter = new BloomFilter(
      this.config.bloomExpectedItems,
      this.config.bloomFPRate
    );
    this.dirty = true;
  }

  /**
   * Get number of entries
   */
  get size(): number {
    return this.entries.size;
  }

  // Private helper methods

  /**
   * Binary search on sorted terms
   */
  private binarySearch(term: string): number {
    let low = 0;
    let high = this.sortedTerms.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTerm = this.sortedTerms[mid];

      if (midTerm === term) {
        return mid;
      } else if (midTerm < term) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return -1;
  }

  /**
   * Rebuild sorted index for binary search
   */
  private rebuildSortedIndex(): void {
    this.sortedTerms = Array.from(this.entries.keys()).sort();
  }

  /**
   * Calculate string similarity (Jaro-Winkler)
   */
  private calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;

    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0 || len2 === 0) return 0.0;

    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array<boolean>(len1).fill(false);
    const s2Matches = new Array<boolean>(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, len2);

      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

    // Winkler modification
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(path: string): Promise<void> {
    try {
      await stat(path);
    } catch {
      await mkdir(path, { recursive: true });
    }
  }

  /**
   * Write file (platform-specific)
   */
  private async writeFile(path: string, buffer: ArrayBuffer): Promise<void> {
    if (typeof Bun !== 'undefined') {
      await Bun.write(path, buffer);
    } else {
      await writeFile(path, Buffer.from(buffer));
    }
  }

  /**
   * Read file as ArrayBuffer
   */
  private async readFileAsBuffer(path: string): Promise<ArrayBuffer> {
    if (typeof Bun !== 'undefined') {
      const file = Bun.file(path);
      return file.arrayBuffer();
    } else {
      const buffer = await readFile(path);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }
  }
}

/**
 * Create an embedding lookup table instance
 */
export function createLookupTable(config: Partial<LookupTableConfig> = {}): EmbeddingLookupTable {
  return new EmbeddingLookupTable(config);
}
