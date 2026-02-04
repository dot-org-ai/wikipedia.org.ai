// @ts-nocheck - Complex embedding batch processing with array operations requiring extensive null checks
/**
 * Lookup Table Builder
 *
 * Builds the embedding lookup table from Wikipedia data sources:
 * - Article titles (~6M terms)
 * - Category names
 * - Named entities from infoboxes
 * - Common search queries (if logs available)
 *
 * Generates embeddings in batches and writes to Parquet.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parquetRead, parquetMetadata, type AsyncBuffer } from '@dotdo/hyparquet';
import { EmbeddingLookupTable, createLookupTable, type EmbeddingSource } from './lookup-table.js';
import { AIGatewayClient, createAIGatewayClient } from './ai-gateway.js';
import { normalizeTerm } from './term-normalizer.js';
import type { EmbeddingModel } from './types.js';

/**
 * Configuration for the lookup table builder
 */
export interface LookupBuilderConfig {
  /** Path to Wikipedia article Parquet files */
  articlesPath: string;
  /** Output path for lookup table */
  outputPath: string;
  /** AI Gateway configuration */
  aiGateway: {
    baseUrl?: string;
    accountId?: string;
    gatewayId?: string;
  };
  /** Embedding models to use */
  models: EmbeddingModel[];
  /** Batch size for embedding generation */
  batchSize: number;
  /** Checkpoint interval (terms) */
  checkpointInterval: number;
  /** Maximum terms to process (0 = unlimited) */
  maxTerms: number;
  /** Include article titles */
  includeTitles: boolean;
  /** Include categories */
  includeCategories: boolean;
  /** Include named entities from infoboxes */
  includeEntities: boolean;
  /** Path to search query logs (optional) */
  queryLogsPath?: string;
}

/** Default configuration */
const DEFAULT_CONFIG: LookupBuilderConfig = {
  articlesPath: 'data/articles',
  outputPath: 'indexes/embeddings-cache.parquet',
  aiGateway: {},
  models: ['bge-m3'],
  batchSize: 100,
  checkpointInterval: 10000,
  maxTerms: 0,
  includeTitles: true,
  includeCategories: true,
  includeEntities: true,
};

/**
 * Progress information during building
 */
export interface BuildProgress {
  /** Current phase */
  phase: 'extracting' | 'deduplicating' | 'embedding' | 'saving';
  /** Total terms extracted */
  termsExtracted: number;
  /** Unique terms after deduplication */
  uniqueTerms: number;
  /** Terms embedded so far */
  termsEmbedded: number;
  /** Current batch number */
  batchNumber: number;
  /** Errors encountered */
  errors: number;
  /** Processing rate (terms/second) */
  rate: number;
  /** Estimated time remaining (seconds) */
  estimatedTimeRemaining?: number;
}

/** Checkpoint for resume capability */
interface BuilderCheckpoint {
  /** Last batch processed */
  lastBatch: number;
  /** Terms processed */
  termsProcessed: number;
  /** Timestamp */
  timestamp: string;
  /** Remaining terms to process */
  remainingTerms: string[];
}

/**
 * Extracted term with metadata
 */
interface ExtractedTerm {
  term: string;
  normalizedTerm: string;
  source: EmbeddingSource;
  articleId?: string;
}

/**
 * Lookup Table Builder
 *
 * Extracts terms from Wikipedia data and generates embeddings
 * for fast lookup during search.
 */
export class LookupBuilder {
  private readonly config: LookupBuilderConfig;
  private readonly aiGateway: AIGatewayClient;
  private lookupTable: EmbeddingLookupTable;
  private progressCallback?: (progress: BuildProgress) => void;
  private startTime: number = 0;
  private termsProcessed = 0;
  private errors = 0;

  constructor(config: Partial<LookupBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.aiGateway = createAIGatewayClient(this.config.aiGateway);
    this.lookupTable = createLookupTable({
      storagePath: this.config.outputPath,
    });
  }

  /**
   * Set progress callback
   */
  onProgress(callback: (progress: BuildProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Build the complete lookup table
   */
  async build(): Promise<{
    totalTerms: number;
    uniqueTerms: number;
    embedded: number;
    errors: number;
    durationMs: number;
  }> {
    this.startTime = Date.now();
    this.termsProcessed = 0;
    this.errors = 0;

    console.log('[LookupBuilder] Starting build process...');

    // Phase 1: Extract terms
    this.reportProgress('extracting', 0, 0);
    const extractedTerms = await this.extractAllTerms();
    console.log(`[LookupBuilder] Extracted ${extractedTerms.length} terms`);

    // Phase 2: Deduplicate
    this.reportProgress('deduplicating', extractedTerms.length, 0);
    const uniqueTerms = this.deduplicateTerms(extractedTerms);
    console.log(`[LookupBuilder] Deduplicated to ${uniqueTerms.size} unique terms`);

    // Apply max terms limit if set
    let termsToProcess = Array.from(uniqueTerms.values());
    if (this.config.maxTerms > 0 && termsToProcess.length > this.config.maxTerms) {
      termsToProcess = termsToProcess.slice(0, this.config.maxTerms);
      console.log(`[LookupBuilder] Limited to ${termsToProcess.length} terms`);
    }

    // Phase 3: Generate embeddings
    this.reportProgress('embedding', extractedTerms.length, uniqueTerms.size);
    const embedded = await this.generateEmbeddings(termsToProcess);

    // Phase 4: Save
    this.reportProgress('saving', extractedTerms.length, uniqueTerms.size);
    await this.lookupTable.save();

    const durationMs = Date.now() - this.startTime;
    console.log(`[LookupBuilder] Build complete in ${(durationMs / 1000).toFixed(1)}s`);

    return {
      totalTerms: extractedTerms.length,
      uniqueTerms: uniqueTerms.size,
      embedded,
      errors: this.errors,
      durationMs,
    };
  }

  /**
   * Resume build from checkpoint
   */
  async resumeBuild(checkpointPath: string): Promise<{
    totalTerms: number;
    embedded: number;
    errors: number;
    durationMs: number;
  }> {
    this.startTime = Date.now();

    // Load checkpoint
    const checkpointData = await readFile(checkpointPath, 'utf-8');
    const checkpoint: BuilderCheckpoint = JSON.parse(checkpointData);

    console.log(`[LookupBuilder] Resuming from checkpoint: ${checkpoint.termsProcessed} terms processed`);

    // Load existing lookup table
    await this.lookupTable.load();

    // Process remaining terms
    const remainingTerms = checkpoint.remainingTerms.map((term) => ({
      term,
      normalizedTerm: normalizeTerm(term),
      source: 'title' as EmbeddingSource,
    }));

    const embedded = await this.generateEmbeddings(remainingTerms);

    // Save final result
    await this.lookupTable.save();

    const durationMs = Date.now() - this.startTime;

    return {
      totalTerms: checkpoint.termsProcessed + remainingTerms.length,
      embedded: checkpoint.termsProcessed + embedded,
      errors: this.errors,
      durationMs,
    };
  }

  /**
   * Extract terms from all sources
   */
  private async extractAllTerms(): Promise<ExtractedTerm[]> {
    const allTerms: ExtractedTerm[] = [];

    // Extract from article files
    const articleFiles = await this.findArticleFiles();

    for (const filePath of articleFiles) {
      try {
        const terms = await this.extractTermsFromFile(filePath);
        allTerms.push(...terms);

        // Report progress periodically
        if (allTerms.length % 100000 === 0) {
          this.reportProgress('extracting', allTerms.length, 0);
        }
      } catch (error) {
        console.error(`[LookupBuilder] Error processing ${filePath}:`, error);
        this.errors++;
      }
    }

    // Extract from query logs if available
    if (this.config.queryLogsPath) {
      try {
        const queryTerms = await this.extractFromQueryLogs();
        allTerms.push(...queryTerms);
      } catch (error) {
        console.warn('[LookupBuilder] Could not load query logs:', error);
      }
    }

    return allTerms;
  }

  /**
   * Find all article Parquet files
   */
  private async findArticleFiles(): Promise<string[]> {
    const files: string[] = [];

    async function scanDir(dirPath: string): Promise<void> {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.parquet')) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Directory doesn't exist or can't be read
      }
    }

    await scanDir(this.config.articlesPath);
    return files;
  }

  /**
   * Extract terms from a single Parquet file
   */
  private async extractTermsFromFile(filePath: string): Promise<ExtractedTerm[]> {
    const terms: ExtractedTerm[] = [];

    const fileBuffer = await this.readFileAsBuffer(filePath);
    const asyncBuffer: AsyncBuffer = {
      byteLength: fileBuffer.byteLength,
      slice: (start: number, end?: number) =>
        Promise.resolve(fileBuffer.slice(start, end)),
    };

    const metadata = await parquetMetadata(asyncBuffer as unknown as ArrayBuffer);
    const rowCount = Number(metadata.num_rows);

    // Read articles
    const rows: Array<{
      $id?: string;
      title?: string;
      categories?: string[];
      infobox?: Record<string, unknown>;
    }> = [];

    await parquetRead({
      file: asyncBuffer,
      rowEnd: rowCount,
      columns: ['$id', 'title', 'categories', 'infobox'],
      onComplete: (data) => {
        rows.push(...(data as typeof rows));
      },
    });

    for (const row of rows) {
      // Extract title
      if (this.config.includeTitles && row.title) {
        const normalized = normalizeTerm(row.title);
        if (normalized) {
          terms.push({
            term: row.title,
            normalizedTerm: normalized,
            source: 'title',
            articleId: row.$id,
          });
        }
      }

      // Extract categories
      if (this.config.includeCategories && row.categories) {
        for (const category of row.categories) {
          const normalized = normalizeTerm(category);
          if (normalized) {
            terms.push({
              term: category,
              normalizedTerm: normalized,
              source: 'category',
              articleId: row.$id,
            });
          }
        }
      }

      // Extract named entities from infobox
      if (this.config.includeEntities && row.infobox) {
        const entities = this.extractEntitiesFromInfobox(row.infobox);
        for (const entity of entities) {
          const normalized = normalizeTerm(entity);
          if (normalized && normalized.length >= 2) {
            terms.push({
              term: entity,
              normalizedTerm: normalized,
              source: 'entity',
              articleId: row.$id,
            });
          }
        }
      }
    }

    return terms;
  }

  /**
   * Extract named entities from infobox data
   */
  private extractEntitiesFromInfobox(infobox: Record<string, unknown>): string[] {
    const entities: string[] = [];

    // Fields that typically contain named entities
    const entityFields = [
      'name',
      'birth_name',
      'birth_place',
      'death_place',
      'nationality',
      'occupation',
      'employer',
      'spouse',
      'children',
      'parents',
      'relatives',
      'location',
      'headquarters',
      'founder',
      'director',
      'author',
      'artist',
      'producer',
      'developer',
      'publisher',
      'manufacturer',
      'country',
      'city',
      'state',
      'region',
      'capital',
    ];

    for (const field of entityFields) {
      const value = infobox[field];
      if (typeof value === 'string' && value.length >= 2) {
        entities.push(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && item.length >= 2) {
            entities.push(item);
          }
        }
      }
    }

    return entities;
  }

  /**
   * Extract terms from query logs
   */
  private async extractFromQueryLogs(): Promise<ExtractedTerm[]> {
    const terms: ExtractedTerm[] = [];

    if (!this.config.queryLogsPath) {
      return terms;
    }

    try {
      const logContent = await readFile(this.config.queryLogsPath, 'utf-8');
      const lines = logContent.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Assume format: query\tcount or just query
        const parts = trimmed.split('\t');
        const query = parts[0];
        const normalized = normalizeTerm(query);

        if (normalized && normalized.length >= 2) {
          terms.push({
            term: query,
            normalizedTerm: normalized,
            source: 'query',
          });
        }
      }
    } catch (error) {
      console.warn('[LookupBuilder] Could not read query logs:', error);
    }

    return terms;
  }

  /**
   * Deduplicate terms by normalized form
   * Keeps the first occurrence and prefers higher-priority sources
   */
  private deduplicateTerms(
    terms: ExtractedTerm[]
  ): Map<string, ExtractedTerm> {
    const unique = new Map<string, ExtractedTerm>();

    // Source priority: title > entity > category > query
    const sourcePriority: Record<EmbeddingSource, number> = {
      title: 4,
      entity: 3,
      category: 2,
      query: 1,
    };

    for (const term of terms) {
      const existing = unique.get(term.normalizedTerm);

      if (!existing) {
        unique.set(term.normalizedTerm, term);
      } else {
        // Keep higher priority source
        const existingPriority = sourcePriority[existing.source];
        const newPriority = sourcePriority[term.source];

        if (newPriority > existingPriority) {
          unique.set(term.normalizedTerm, term);
        }
      }
    }

    return unique;
  }

  /**
   * Generate embeddings for all terms
   */
  private async generateEmbeddings(terms: ExtractedTerm[]): Promise<number> {
    const batchSize = this.config.batchSize;
    let embedded = 0;

    for (let i = 0; i < terms.length; i += batchSize) {
      const batch = terms.slice(i, i + batchSize);
      const batchTerms = batch.map((t) => t.term);

      try {
        // Generate embeddings for BGE-M3
        const m3Response = await this.aiGateway.generateEmbeddings({
          model: 'bge-m3',
          texts: batchTerms,
        });

        // Optionally generate Gemma embeddings
        let gemmaEmbeddings: Float32Array[] | undefined;
        if (this.config.models.includes('gemma')) {
          const gemmaResponse = await this.aiGateway.generateEmbeddings({
            model: 'gemma',
            texts: batchTerms,
          });
          gemmaEmbeddings = gemmaResponse.embeddings.map((e) => new Float32Array(e));
        }

        // Add to lookup table
        await this.lookupTable.addTermsBatch(
          batchTerms,
          {
            m3: m3Response.embeddings.map((e) => new Float32Array(e)),
            gemma: gemmaEmbeddings,
          },
          batch[0].source // Use first term's source for batch
        );

        embedded += batch.length;
        this.termsProcessed += batch.length;

        // Report progress
        this.reportProgress(
          'embedding',
          terms.length,
          terms.length,
          embedded,
          Math.floor(i / batchSize)
        );

        // Checkpoint periodically
        if (this.termsProcessed % this.config.checkpointInterval === 0) {
          await this.saveCheckpoint(terms.slice(i + batchSize).map((t) => t.term));
        }
      } catch (error) {
        console.error(`[LookupBuilder] Batch ${i / batchSize} failed:`, error);
        this.errors += batch.length;
      }
    }

    return embedded;
  }

  /**
   * Save checkpoint for resume capability
   */
  private async saveCheckpoint(remainingTerms: string[]): Promise<void> {
    const checkpoint: BuilderCheckpoint = {
      lastBatch: Math.floor(this.termsProcessed / this.config.batchSize),
      termsProcessed: this.termsProcessed,
      timestamp: new Date().toISOString(),
      remainingTerms,
    };

    const checkpointPath = this.config.outputPath.replace('.parquet', '.checkpoint.json');

    if (typeof Bun !== 'undefined') {
      await Bun.write(checkpointPath, JSON.stringify(checkpoint, null, 2));
    } else {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
    }

    // Also save partial lookup table
    await this.lookupTable.save();
  }

  /**
   * Report progress to callback
   */
  private reportProgress(
    phase: BuildProgress['phase'],
    termsExtracted: number,
    uniqueTerms: number,
    termsEmbedded: number = 0,
    batchNumber: number = 0
  ): void {
    if (!this.progressCallback) return;

    const elapsed = Date.now() - this.startTime;
    const rate = elapsed > 0 ? (termsEmbedded * 1000) / elapsed : 0;
    const remaining = uniqueTerms - termsEmbedded;
    const estimatedTimeRemaining = rate > 0 ? remaining / rate : undefined;

    this.progressCallback({
      phase,
      termsExtracted,
      uniqueTerms,
      termsEmbedded,
      batchNumber,
      errors: this.errors,
      rate,
      estimatedTimeRemaining,
    });
  }

  /**
   * Get the built lookup table
   */
  getLookupTable(): EmbeddingLookupTable {
    return this.lookupTable;
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
 * Create a lookup builder instance
 */
export function createLookupBuilder(
  config: Partial<LookupBuilderConfig> = {}
): LookupBuilder {
  return new LookupBuilder(config);
}

/**
 * Build lookup table from Wikipedia dump
 * Convenience function for common use case
 */
export async function buildLookupTableFromWikipedia(options: {
  articlesPath: string;
  outputPath: string;
  aiGateway?: {
    baseUrl?: string;
    accountId?: string;
    gatewayId?: string;
  };
  maxTerms?: number;
  onProgress?: (progress: BuildProgress) => void;
}): Promise<{
  totalTerms: number;
  uniqueTerms: number;
  embedded: number;
  errors: number;
  durationMs: number;
}> {
  const builder = createLookupBuilder({
    articlesPath: options.articlesPath,
    outputPath: options.outputPath,
    aiGateway: options.aiGateway ?? {},
    maxTerms: options.maxTerms ?? 0,
  });

  if (options.onProgress) {
    builder.onProgress(options.onProgress);
  }

  return builder.build();
}

/**
 * Incremental builder for adding new terms
 */
export class IncrementalLookupBuilder {
  private readonly lookupTable: EmbeddingLookupTable;
  private readonly aiGateway: AIGatewayClient;
  private readonly batchSize: number;
  private pendingTerms: Map<string, EmbeddingSource> = new Map();

  constructor(
    lookupTable: EmbeddingLookupTable,
    aiGateway: AIGatewayClient,
    batchSize: number = 100
  ) {
    this.lookupTable = lookupTable;
    this.aiGateway = aiGateway;
    this.batchSize = batchSize;
  }

  /**
   * Queue a term for embedding
   */
  queueTerm(term: string, source: EmbeddingSource = 'query'): void {
    const normalized = normalizeTerm(term);
    if (!normalized) return;

    // Skip if already in lookup table
    if (this.lookupTable.has(normalized)) return;

    // Skip if already queued
    if (this.pendingTerms.has(normalized)) return;

    this.pendingTerms.set(normalized, source);
  }

  /**
   * Process all pending terms
   */
  async flush(): Promise<number> {
    if (this.pendingTerms.size === 0) {
      return 0;
    }

    const terms = Array.from(this.pendingTerms.entries());
    let processed = 0;

    for (let i = 0; i < terms.length; i += this.batchSize) {
      const batch = terms.slice(i, i + this.batchSize);
      const batchTerms = batch.map(([term]) => term);
      const batchSources = batch.map(([, source]) => source);

      try {
        const response = await this.aiGateway.generateEmbeddings({
          model: 'bge-m3',
          texts: batchTerms,
        });

        for (let j = 0; j < batchTerms.length; j++) {
          await this.lookupTable.addTerm(
            batchTerms[j],
            { m3: response.embeddings[j] },
            batchSources[j]
          );
        }

        processed += batch.length;
      } catch (error) {
        console.error('[IncrementalBuilder] Batch failed:', error);
      }
    }

    this.pendingTerms.clear();
    return processed;
  }

  /**
   * Get number of pending terms
   */
  get pendingCount(): number {
    return this.pendingTerms.size;
  }

  /**
   * Save the lookup table
   */
  async save(): Promise<void> {
    await this.flush();
    await this.lookupTable.save();
  }
}
