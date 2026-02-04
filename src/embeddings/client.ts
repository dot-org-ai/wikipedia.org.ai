// @ts-nocheck - Complex HTTP client with optional property types in config
/**
 * HTTP Client for embeddings.workers.do API
 *
 * Provides a simple, focused client for generating embeddings via the
 * deployed Workers service at embeddings.workers.do.
 *
 * Features:
 * - Batch embedding generation
 * - Automatic retries with exponential backoff
 * - Rate limiting handling
 * - Configurable batch sizes
 */

import { createLogger, type Logger } from '../lib/logger.js';
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
} from '../lib/constants.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('embeddings:client');

/** Supported models for the embeddings API */
export type EmbeddingsApiModel = 'bge-m3' | 'bge-base' | 'gemma300';

/** Configuration for the embeddings client */
export interface EmbeddingsClientConfig {
  /** Base URL for the embeddings API (default: https://embeddings.workers.do) */
  baseUrl?: string | undefined;
  /** Maximum texts per API request (default: 50) */
  batchSize?: number | undefined;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number | undefined;
  /** Base delay between retries in ms (default: 1000) */
  retryDelayMs?: number | undefined;
  /** Request timeout in ms (default: 60000) */
  timeout?: number | undefined;
  /** Default model to use (default: bge-m3) */
  defaultModel?: EmbeddingsApiModel | undefined;
  /**
   * Use direct Workers AI REST API instead of embeddings.workers.do
   * This saves on worker invocations by calling Cloudflare AI directly.
   * Requires accountId and apiToken.
   */
  useWorkersAI?: boolean | undefined;
  /** Cloudflare account ID (required if useWorkersAI is true) */
  accountId?: string | undefined;
  /** Cloudflare API token with Workers AI permissions (required if useWorkersAI is true) */
  apiToken?: string | undefined;
  /** Optional logger instance for dependency injection (testing) */
  logger?: Logger | undefined;
}

/** Response from the embeddings API */
export interface EmbeddingsApiResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

/** Error response from the embeddings API */
export interface EmbeddingsApiError {
  error: string;
  details?: string;
}

/** Statistics about embedding generation */
export interface EmbeddingsClientStats {
  totalRequests: number;
  totalTexts: number;
  successfulRequests: number;
  failedRequests: number;
  retries: number;
  averageLatencyMs: number;
  rateLimitHits: number;
}

/** Model name mapping for Workers AI */
const WORKERS_AI_MODELS: Record<EmbeddingsApiModel, string> = {
  'bge-m3': '@cf/baai/bge-m3',
  'bge-base': '@cf/baai/bge-base-en-v1.5',
  'gemma300': '@cf/google/embeddinggemma-300m',
};

/**
 * HTTP Client for embeddings generation
 *
 * Supports two modes:
 * 1. embeddings.workers.do - Uses the deployed worker (default)
 * 2. Workers AI REST API - Direct API calls (cheaper, no worker invocation)
 */
export class EmbeddingsClient {
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeout: number;
  private readonly defaultModel: EmbeddingsApiModel;
  private readonly useWorkersAI: boolean;
  private readonly accountId?: string;
  private readonly apiToken?: string;

  // Statistics
  private stats: EmbeddingsClientStats = {
    totalRequests: 0,
    totalTexts: 0,
    successfulRequests: 0,
    failedRequests: 0,
    retries: 0,
    averageLatencyMs: 0,
    rateLimitHits: 0,
  };
  private totalLatencyMs = 0;

  constructor(config: EmbeddingsClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://embeddings.workers.do';
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultModel = config.defaultModel ?? 'bge-m3';
    this.useWorkersAI = config.useWorkersAI ?? false;
    this.accountId = config.accountId;
    this.apiToken = config.apiToken;

    if (this.useWorkersAI && (!this.accountId || !this.apiToken)) {
      throw new Error('accountId and apiToken are required when useWorkersAI is true');
    }
  }

  /**
   * Generate embeddings for a batch of texts
   *
   * Automatically splits into sub-batches if texts exceeds batchSize.
   * Handles retries and rate limiting.
   */
  async generateEmbeddings(
    texts: string[],
    model?: EmbeddingsApiModel
  ): Promise<number[][]> {
    const modelToUse = model ?? this.defaultModel;

    if (texts.length === 0) {
      return [];
    }

    this.stats.totalTexts += texts.length;

    // Split into batches
    const batches: string[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      batches.push(texts.slice(i, i + this.batchSize));
    }

    // Process batches and collect results
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
      const embeddings = await this.processBatch(batch, modelToUse);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(
    text: string,
    model?: EmbeddingsApiModel
  ): Promise<number[]> {
    const results = await this.generateEmbeddings([text], model);
    const embedding = results[0];
    if (!embedding) {
      throw new Error('No embedding returned for text');
    }
    return embedding;
  }

  /**
   * Process a single batch of texts with retries
   */
  private async processBatch(
    texts: string[],
    model: EmbeddingsApiModel
  ): Promise<number[][]> {
    const truncatedTexts = texts.map((t) => this.truncateText(t));

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      this.stats.totalRequests++;
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          let response: Response;

          if (this.useWorkersAI) {
            // Direct Workers AI REST API call (cheaper)
            const workersAIModel = WORKERS_AI_MODELS[model];
            const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${workersAIModel}`;
            response = await fetch(url, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ text: truncatedTexts }),
              signal: controller.signal,
            });
          } else {
            // embeddings.workers.do endpoint
            response = await fetch(`${this.baseUrl}/embed`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                texts: truncatedTexts,
                model,
              }),
              signal: controller.signal,
            });
          }

          clearTimeout(timeoutId);

          if (response.status === 429) {
            // Rate limited
            this.stats.rateLimitHits++;
            const retryAfter = parseInt(
              response.headers.get('Retry-After') ?? '5',
              10
            );
            await this.delay(retryAfter * 1000);
            this.stats.retries++;
            continue;
          }

          if (!response.ok) {
            const errorBody = await response.json() as any;
            const errorMsg = this.useWorkersAI
              ? errorBody.errors?.[0]?.message ?? JSON.stringify(errorBody)
              : `${errorBody.error}${errorBody.details ? ` - ${errorBody.details}` : ''}`;
            throw new Error(`Embeddings API error ${response.status}: ${errorMsg}`);
          }

          let embeddings: number[][];

          if (this.useWorkersAI) {
            // Workers AI response format: { result: { data: [[...], [...]] }, success: true }
            const result = await response.json() as { result: { data: number[][] }; success: boolean };
            embeddings = result.result.data;
          } else {
            // embeddings.workers.do response format
            const result = (await response.json()) as EmbeddingsApiResponse;
            embeddings = result.embeddings;
          }

          // Update stats
          const latency = Date.now() - startTime;
          this.totalLatencyMs += latency;
          this.stats.successfulRequests++;
          this.stats.averageLatencyMs =
            this.totalLatencyMs / this.stats.successfulRequests;

          return embeddings;
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new Error(`Request timeout after ${this.timeout}ms`);
        }

        // Check if we should retry
        const shouldRetry = this.isRetryableError(error);
        if (shouldRetry && attempt < this.maxRetries - 1) {
          this.stats.retries++;
          await this.delay(this.retryDelayMs * Math.pow(2, attempt));
          continue;
        }

        this.stats.failedRequests++;
        throw lastError;
      }
    }

    this.stats.failedRequests++;
    throw lastError ?? new Error('Max retries exceeded');
  }

  /**
   * Truncate text to a reasonable length for embedding
   */
  private truncateText(text: string, maxLength = 8000): string {
    if (text.length <= maxLength) {
      return text;
    }
    // Truncate at word boundary if possible
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxLength - 100) {
      return truncated.slice(0, lastSpace);
    }
    return truncated;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('503') ||
        message.includes('502') ||
        message.includes('504') ||
        message.includes('abort')
      );
    }
    return false;
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current statistics
   */
  getStats(): EmbeddingsClientStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      totalTexts: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retries: 0,
      averageLatencyMs: 0,
      rateLimitHits: 0,
    };
    this.totalLatencyMs = 0;
  }

  /**
   * Check API health
   */
  async checkHealth(): Promise<{
    status: 'ok' | 'error';
    service?: string;
    models?: string[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
      });

      if (!response.ok) {
        return {
          status: 'error',
          error: `HTTP ${response.status}`,
        };
      }

      return (await response.json()) as {
        status: 'ok';
        service: string;
        models: string[];
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Create an embeddings client instance
 */
export function createEmbeddingsClient(
  config: EmbeddingsClientConfig = {}
): EmbeddingsClient {
  return new EmbeddingsClient(config);
}

/**
 * Create an embeddings client that uses Workers AI REST API directly
 * This is cheaper than using embeddings.workers.do as it avoids worker invocations.
 *
 * @param accountId - Cloudflare account ID
 * @param apiToken - Cloudflare API token with Workers AI permissions
 * @param config - Additional configuration options
 */
export function createWorkersAIClient(
  accountId: string,
  apiToken: string,
  config: Omit<EmbeddingsClientConfig, 'useWorkersAI' | 'accountId' | 'apiToken'> = {}
): EmbeddingsClient {
  return new EmbeddingsClient({
    ...config,
    useWorkersAI: true,
    accountId,
    apiToken,
  });
}

/**
 * Create an embeddings client from environment variables
 *
 * If CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set, uses Workers AI directly.
 * Otherwise falls back to embeddings.workers.do.
 */
export function createEmbeddingsClientFromEnv(
  config: Omit<EmbeddingsClientConfig, 'useWorkersAI' | 'accountId' | 'apiToken'> = {}
): EmbeddingsClient {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  const log = config.logger ?? getLog();
  if (accountId && apiToken) {
    log.info('Using Workers AI REST API (direct, cheaper)', { accountId }, 'createClient');
    return createWorkersAIClient(accountId, apiToken, config);
  }

  log.info('Using embeddings.workers.do service', undefined, 'createClient');
  return createEmbeddingsClient(config);
}
