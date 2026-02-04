// @ts-nocheck - Complex processing pipeline with AIGateway and optional property types
/**
 * Main embedding processor for Wikipedia articles
 *
 * Runs in Cloudflare Sandbox environment with:
 * - 12GB RAM, 20GB disk
 * - R2 mounted at /mnt/r2
 * - AI Gateway for cached embedding calls
 * - Checkpoint-based resume capability
 */

import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger, type Logger } from '../lib/logger.js';
import { AIGatewayClient, createAIGatewayClient } from './ai-gateway.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('embeddings:processor');
import { LanceWriter, createLanceWriter } from './lance-writer.js';
import type {
  Article,
  BatchResult,
  Checkpoint,
  EmbeddingModel,
  EmbeddingRecord,
  ModelStats,
  ProcessingError,
  ProcessorConfig,
  ProgressCallback,
  ProgressInfo,
} from './types.js';

/** Default processor configuration */
const DEFAULT_CONFIG: Required<ProcessorConfig> = {
  aiGatewayUrl: 'https://gateway.ai.cloudflare.com/v1',
  r2MountPath: '/mnt/r2',
  models: ['bge-m3'],
  batchSize: 100,
  checkpointInterval: 1000,
  maxRetries: 3,
  timeout: 30_000,
  accountId: '',
};

/** Initial checkpoint state */
function createInitialCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    lastProcessedId: '',
    totalProcessed: 0,
    startedAt: now,
    updatedAt: now,
    batchNumber: 0,
    errors: [],
    modelStats: {
      'bge-m3': { count: 0, tokens: 0, avgTimeMs: 0, cacheHits: 0 },
      'bge-base': { count: 0, tokens: 0, avgTimeMs: 0, cacheHits: 0 },
      'bge-large': { count: 0, tokens: 0, avgTimeMs: 0, cacheHits: 0 },
      'gemma': { count: 0, tokens: 0, avgTimeMs: 0, cacheHits: 0 },
      'gemma300': { count: 0, tokens: 0, avgTimeMs: 0, cacheHits: 0 },
    },
  };
}

/**
 * Embedding processor for Wikipedia articles
 */
export class EmbeddingProcessor {
  private readonly config: Required<Omit<ProcessorConfig, 'logger'>> & { logger?: Logger };
  private readonly aiGateway: AIGatewayClient;
  private readonly lanceWriter: LanceWriter;
  private readonly log: Logger;
  private checkpoint: Checkpoint;
  private progressCallback?: ProgressCallback;
  private processingStartTime: number = 0;
  private articlesProcessedThisSession = 0;

  constructor(config: Partial<ProcessorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = config.logger ?? getLog();

    // Initialize AI Gateway client
    this.aiGateway = createAIGatewayClient({
      baseUrl: this.config.aiGatewayUrl,
      accountId: this.config.accountId,
      timeout: this.config.timeout,
      maxRetries: this.config.maxRetries,
    });

    // Initialize Lance writer
    this.lanceWriter = createLanceWriter({
      outputPath: join(this.config.r2MountPath, 'embeddings'),
      flushSize: this.config.batchSize,
      partitionByType: true,
    });

    // Initialize checkpoint
    this.checkpoint = createInitialCheckpoint();
  }

  /**
   * Set progress callback for tracking
   */
  onProgress(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Process a single article
   */
  async processArticle(article: Article): Promise<EmbeddingRecord[]> {
    const records: EmbeddingRecord[] = [];
    const now = new Date().toISOString();

    for (const model of this.config.models) {
      try {
        const startTime = Date.now();
        const embedding = await this.aiGateway.generateEmbedding(model, article.content);
        const timeMs = Date.now() - startTime;

        const record: EmbeddingRecord = {
          id: article.id,
          title: article.title,
          type: article.type,
          embedding: new Float32Array(embedding),
          model,
          created_at: now,
        };

        records.push(record);

        // Update model stats
        this.updateModelStats(model, timeMs, false);
      } catch (error) {
        this.recordError(article.id, error);
        // Continue with other models even if one fails
      }
    }

    // Write records to Lance
    if (records.length > 0) {
      await this.lanceWriter.writeBatch(records);
    }

    return records;
  }

  /**
   * Process a batch of articles
   */
  async processBatch(articles: Article[]): Promise<BatchResult> {
    const startTime = Date.now();
    const errors: ProcessingError[] = [];
    let success = 0;

    // Process in sub-batches per model for efficient batching
    for (const model of this.config.models) {
      const texts = articles.map((a) => a.content);

      try {
        const modelStartTime = Date.now();
        const response = await this.aiGateway.generateEmbeddings({
          model,
          texts,
        });

        const timeMs = Date.now() - modelStartTime;
        const avgTimePerArticle = timeMs / articles.length;

        // Create embedding records
        const now = new Date().toISOString();
        const records: EmbeddingRecord[] = articles.map((article, i) => ({
          id: article.id,
          title: article.title,
          type: article.type,
          embedding: new Float32Array(response.embeddings[i]),
          model,
          created_at: now,
        }));

        // Write to Lance
        await this.lanceWriter.writeBatch(records);

        // Update stats
        this.updateModelStats(model, avgTimePerArticle, response.cached);
        success += articles.length;
      } catch (error) {
        // Fall back to individual processing on batch failure
        for (const article of articles) {
          try {
            await this.processArticle(article);
            success++;
          } catch (individualError) {
            const procError = this.recordError(article.id, individualError);
            errors.push(procError);
          }
        }
      }
    }

    // Update checkpoint
    if (articles.length > 0) {
      const lastArticle = articles[articles.length - 1];
      this.checkpoint.lastProcessedId = lastArticle.id;
      this.checkpoint.totalProcessed += articles.length;
      this.checkpoint.batchNumber++;
      this.checkpoint.updatedAt = new Date().toISOString();
      this.articlesProcessedThisSession += articles.length;

      // Report progress
      this.reportProgress(lastArticle.title, articles.length, errors.length);

      // Save checkpoint if interval reached
      if (this.checkpoint.totalProcessed % this.config.checkpointInterval === 0) {
        await this.saveCheckpoint();
      }
    }

    return {
      success,
      failed: errors.length,
      timeMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Load checkpoint from file
   */
  async loadCheckpoint(): Promise<Checkpoint | null> {
    const checkpointPath = this.getCheckpointPath();

    try {
      const data = await readFile(checkpointPath, 'utf-8');
      this.checkpoint = JSON.parse(data) as Checkpoint;
      this.log.info('Checkpoint loaded', {
        totalProcessed: this.checkpoint.totalProcessed,
        lastId: this.checkpoint.lastProcessedId,
      }, 'loadCheckpoint');
      return this.checkpoint;
    } catch {
      this.log.info('No existing checkpoint found, starting fresh', undefined, 'loadCheckpoint');
      return null;
    }
  }

  /**
   * Save checkpoint to file
   */
  async saveCheckpoint(): Promise<void> {
    const checkpointPath = this.getCheckpointPath();

    // Ensure directory exists
    await this.ensureDirectory(dirname(checkpointPath));

    // Update timestamp
    this.checkpoint.updatedAt = new Date().toISOString();

    // Write checkpoint
    await writeFile(checkpointPath, JSON.stringify(this.checkpoint, null, 2));

    this.log.info('Checkpoint saved', {
      totalProcessed: this.checkpoint.totalProcessed,
      batchNumber: this.checkpoint.batchNumber,
    }, 'saveCheckpoint');
  }

  /**
   * Get current checkpoint state
   */
  getCheckpoint(): Checkpoint {
    return { ...this.checkpoint };
  }

  /**
   * Check if an article should be skipped (already processed)
   */
  shouldSkip(articleId: string): boolean {
    // Simple numeric comparison for Wikipedia article IDs
    if (!this.checkpoint.lastProcessedId) {
      return false;
    }

    const lastId = parseInt(this.checkpoint.lastProcessedId, 10);
    const currentId = parseInt(articleId, 10);

    if (isNaN(lastId) || isNaN(currentId)) {
      // Fall back to string comparison
      return articleId <= this.checkpoint.lastProcessedId;
    }

    return currentId <= lastId;
  }

  /**
   * Flush all pending writes
   */
  async flush(): Promise<void> {
    await this.lanceWriter.flush();
    await this.saveCheckpoint();
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    totalProcessed: number;
    sessionProcessed: number;
    rate: number;
    errors: number;
    modelStats: Record<EmbeddingModel, ModelStats>;
    cacheStats: { hits: number; total: number; hitRate: number };
  } {
    const elapsedSeconds = (Date.now() - this.processingStartTime) / 1000;
    const rate =
      elapsedSeconds > 0 ? this.articlesProcessedThisSession / elapsedSeconds : 0;

    return {
      totalProcessed: this.checkpoint.totalProcessed,
      sessionProcessed: this.articlesProcessedThisSession,
      rate,
      errors: this.checkpoint.errors.length,
      modelStats: this.checkpoint.modelStats,
      cacheStats: this.aiGateway.getCacheStats(),
    };
  }

  /**
   * Start processing session
   */
  startSession(): void {
    this.processingStartTime = Date.now();
    this.articlesProcessedThisSession = 0;
  }

  /**
   * Get checkpoint file path
   */
  private getCheckpointPath(): string {
    return join(this.config.r2MountPath, 'checkpoint.json');
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
   * Update model statistics
   */
  private updateModelStats(
    model: EmbeddingModel,
    timeMs: number,
    cached: boolean
  ): void {
    const stats = this.checkpoint.modelStats[model];
    const oldCount = stats.count;
    const newCount = oldCount + 1;

    // Update running average
    stats.avgTimeMs = (stats.avgTimeMs * oldCount + timeMs) / newCount;
    stats.count = newCount;

    if (cached) {
      stats.cacheHits++;
    }
  }

  /**
   * Record a processing error
   */
  private recordError(articleId: string, error: unknown): ProcessingError {
    const procError: ProcessingError = {
      articleId,
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
      retryCount: 0,
    };

    // Keep only last 100 errors
    this.checkpoint.errors.push(procError);
    if (this.checkpoint.errors.length > 100) {
      this.checkpoint.errors = this.checkpoint.errors.slice(-100);
    }

    return procError;
  }

  /**
   * Report progress via callback
   */
  private reportProgress(
    currentArticle: string,
    processedInBatch: number,
    errorsInBatch: number
  ): void {
    if (!this.progressCallback) return;

    const elapsedSeconds = (Date.now() - this.processingStartTime) / 1000;
    const rate =
      elapsedSeconds > 0 ? this.articlesProcessedThisSession / elapsedSeconds : 0;

    const progress: ProgressInfo = {
      currentArticle,
      processedInBatch,
      totalProcessed: this.checkpoint.totalProcessed,
      rate,
      batchNumber: this.checkpoint.batchNumber,
      errorsInBatch,
    };

    this.progressCallback(progress);
  }
}

/**
 * Create an embedding processor instance
 */
export function createProcessor(config: Partial<ProcessorConfig> = {}): EmbeddingProcessor {
  return new EmbeddingProcessor(config);
}
