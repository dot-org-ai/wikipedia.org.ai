// @ts-nocheck - Complex AI response handling and optional property types
/**
 * AI Gateway client for cached embedding generation
 *
 * Provides access to Cloudflare AI models via AI Gateway with:
 * - Pre-computed embedding lookup table (free lookups)
 * - Automatic caching for repeated requests
 * - Batch embedding support
 * - Retry logic with exponential backoff
 * - Cache key normalization
 */

import {
  type AIGatewayConfig,
  CF_MODEL_IDS,
  type EmbeddingModel,
  type EmbeddingRequest,
  type EmbeddingResponse,
  MODEL_DIMENSIONS,
} from './types.js';
import type { EmbeddingLookupTable } from './lookup-table.js';
import { normalizeTerm } from './term-normalizer.js';

/** Default AI Gateway configuration */
const DEFAULT_CONFIG: AIGatewayConfig = {
  baseUrl: 'https://gateway.ai.cloudflare.com/v1',
  timeout: 30_000,
  maxRetries: 3,
  retryDelayMs: 1000,
};

/** Error thrown when AI Gateway request fails */
export class AIGatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'AIGatewayError';
  }
}

/** Extended configuration with lookup table support */
export interface AIGatewayClientConfig extends Partial<AIGatewayConfig> {
  /** Pre-computed embedding lookup table for free lookups */
  lookupTable?: EmbeddingLookupTable;
  /** Whether to skip lookup table for batch requests (default: false) */
  skipLookupForBatch?: boolean;
}

/**
 * AI Gateway client for embedding generation
 *
 * Checks lookup table FIRST before calling AI Gateway to minimize costs.
 * Only calls AI Gateway on cache miss.
 */
export class AIGatewayClient {
  private readonly config: AIGatewayConfig;
  private lookupTable?: EmbeddingLookupTable;
  private skipLookupForBatch: boolean;

  // Statistics
  private cacheHits = 0;
  private totalRequests = 0;
  private lookupHits = 0;
  private lookupMisses = 0;
  private aiGatewayRequests = 0;

  constructor(config: AIGatewayClientConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lookupTable = config.lookupTable;
    this.skipLookupForBatch = config.skipLookupForBatch ?? false;
  }

  /**
   * Set or update the lookup table
   */
  setLookupTable(table: EmbeddingLookupTable): void {
    this.lookupTable = table;
  }

  /**
   * Generate embeddings for a batch of texts
   *
   * First checks the lookup table for each text, then only sends
   * cache misses to the AI Gateway.
   */
  async generateEmbeddings(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startTime = Date.now();
    const { model, texts } = request;

    if (texts.length === 0) {
      return {
        embeddings: [],
        cached: false,
        processingTimeMs: 0,
        model,
      };
    }

    this.totalRequests++;

    // Track results in order
    const results: Array<{ embedding: number[]; fromLookup: boolean }> = new Array(texts.length);
    const misses: Array<{ index: number; text: string }> = [];

    // Phase 1: Check lookup table for each text
    if (this.lookupTable && !this.skipLookupForBatch) {
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const normalizedText = normalizeTerm(text);

        if (normalizedText) {
          const lookup = await this.lookupTable.lookup(normalizedText);

          if (lookup) {
            // Found in lookup table - use appropriate embedding
            const embedding = model.startsWith('bge') || model === 'bge-m3'
              ? Array.from(lookup.embedding_m3)
              : (model === 'gemma300' || model === 'gemma') && lookup.embedding_gemma
                ? Array.from(lookup.embedding_gemma)
                : Array.from(lookup.embedding_m3); // Fallback to M3

            results[i] = { embedding, fromLookup: true };
            this.lookupHits++;
            continue;
          }
        }

        // Cache miss - need to fetch from AI Gateway
        misses.push({ index: i, text });
        this.lookupMisses++;
      }
    } else {
      // No lookup table - all texts need to be fetched
      for (let i = 0; i < texts.length; i++) {
        misses.push({ index: i, text: texts[i] });
        this.lookupMisses++;
      }
    }

    // Phase 2: Fetch missing embeddings from AI Gateway
    if (misses.length > 0) {
      this.aiGatewayRequests++;

      const normalizedTexts = misses.map((m) => this.normalizeText(m.text));
      const url = this.buildUrl(model);
      const body = this.buildRequestBody(model, normalizedTexts);

      let lastError: Error | null = null;
      let attempt = 0;
      let fetchedEmbeddings: number[][] | null = null;
      let wasGatewayCached = false;

      while (attempt < this.config.maxRetries) {
        try {
          const response = await this.fetchWithTimeout(url, body);
          fetchedEmbeddings = await this.parseResponse(response, model);

          wasGatewayCached = response.headers.get('cf-cache-status') === 'HIT';
          if (wasGatewayCached) {
            this.cacheHits++;
          }

          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (error instanceof AIGatewayError && !error.retryable) {
            throw error;
          }

          attempt++;
          if (attempt < this.config.maxRetries) {
            await this.delay(this.config.retryDelayMs * Math.pow(2, attempt - 1));
          }
        }
      }

      if (!fetchedEmbeddings) {
        throw new AIGatewayError(
          `Failed after ${this.config.maxRetries} attempts: ${lastError?.message}`,
          undefined,
          false
        );
      }

      // Place fetched embeddings in results
      for (let i = 0; i < misses.length; i++) {
        const { index } = misses[i];
        results[index] = { embedding: fetchedEmbeddings[i], fromLookup: false };
      }
    }

    // Check if all embeddings came from lookup
    const allFromLookup = misses.length === 0;

    return {
      embeddings: results.map((r) => r.embedding),
      cached: allFromLookup,
      processingTimeMs: Date.now() - startTime,
      model,
    };
  }

  /**
   * Generate embeddings for a single text
   *
   * Optimized path for single-text requests with lookup table.
   */
  async generateEmbedding(model: EmbeddingModel, text: string): Promise<number[]> {
    this.totalRequests++;

    // Try lookup table first
    if (this.lookupTable) {
      const normalizedText = normalizeTerm(text);

      if (normalizedText) {
        const lookup = await this.lookupTable.lookup(normalizedText);

        if (lookup) {
          this.lookupHits++;

          // Return appropriate embedding for the model
          if (model.startsWith('bge') || model === 'bge-m3') {
            return Array.from(lookup.embedding_m3);
          } else if ((model === 'gemma300' || model === 'gemma') && lookup.embedding_gemma) {
            return Array.from(lookup.embedding_gemma);
          } else {
            // Fallback to M3 if requested model not available
            return Array.from(lookup.embedding_m3);
          }
        }
      }

      this.lookupMisses++;
    }

    // Cache miss - call AI Gateway
    const response = await this.generateEmbeddings({ model, texts: [text] });
    return response.embeddings[0];
  }

  /**
   * Batch lookup with partial results
   *
   * Returns embeddings from lookup table only, without calling AI Gateway.
   * Useful for checking which terms are cached.
   */
  async lookupOnly(
    texts: string[],
    model: EmbeddingModel = 'bge-m3'
  ): Promise<{
    embeddings: Map<number, number[]>;
    hits: number;
    misses: number;
  }> {
    const embeddings = new Map<number, number[]>();
    let hits = 0;
    let misses = 0;

    if (!this.lookupTable) {
      return { embeddings, hits: 0, misses: texts.length };
    }

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i];
      const normalizedText = normalizeTerm(text);

      if (normalizedText) {
        const lookup = await this.lookupTable.lookup(normalizedText);

        if (lookup) {
          const embedding = model.startsWith('bge') || model === 'bge-m3'
            ? Array.from(lookup.embedding_m3)
            : (model === 'gemma300' || model === 'gemma') && lookup.embedding_gemma
              ? Array.from(lookup.embedding_gemma)
              : Array.from(lookup.embedding_m3);

          embeddings.set(i, embedding);
          hits++;
          continue;
        }
      }

      misses++;
    }

    return { embeddings, hits, misses };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    hits: number;
    total: number;
    hitRate: number;
    lookupHits: number;
    lookupMisses: number;
    lookupHitRate: number;
    aiGatewayRequests: number;
  } {
    const lookupTotal = this.lookupHits + this.lookupMisses;

    return {
      hits: this.cacheHits,
      total: this.totalRequests,
      hitRate: this.totalRequests > 0 ? this.cacheHits / this.totalRequests : 0,
      lookupHits: this.lookupHits,
      lookupMisses: this.lookupMisses,
      lookupHitRate: lookupTotal > 0 ? this.lookupHits / lookupTotal : 0,
      aiGatewayRequests: this.aiGatewayRequests,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.cacheHits = 0;
    this.totalRequests = 0;
    this.lookupHits = 0;
    this.lookupMisses = 0;
    this.aiGatewayRequests = 0;
  }

  /**
   * Check if lookup table is configured
   */
  hasLookupTable(): boolean {
    return this.lookupTable !== undefined;
  }

  /**
   * Get lookup table statistics (if configured)
   */
  getLookupTableStats(): {
    entryCount: number;
    lookupCount: number;
    hitCount: number;
    hitRate: number;
  } | null {
    if (!this.lookupTable) {
      return null;
    }

    const stats = this.lookupTable.getStats();
    return {
      entryCount: stats.entryCount,
      lookupCount: stats.lookupCount,
      hitCount: stats.hitCount,
      hitRate: stats.hitRate,
    };
  }

  /**
   * Build URL for the AI Gateway endpoint
   */
  private buildUrl(model: EmbeddingModel): string {
    const { baseUrl, accountId, gatewayId } = this.config;

    if (accountId && gatewayId) {
      // AI Gateway path format: /v1/{account_id}/{gateway_id}/workers-ai/{model}
      const cfModel = CF_MODEL_IDS[model];
      return `${baseUrl}/${accountId}/${gatewayId}/workers-ai/${encodeURIComponent(cfModel)}`;
    }

    if (accountId) {
      // Direct Workers AI API format
      const cfModel = CF_MODEL_IDS[model];
      return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(cfModel)}`;
    }

    // No account ID - use Workers AI via AI Gateway default endpoint (will likely fail)
    const cfModel = CF_MODEL_IDS[model];
    return `${baseUrl}/workers-ai/${encodeURIComponent(cfModel)}`;
  }

  /**
   * Build request body for the embedding model
   */
  private buildRequestBody(
    model: EmbeddingModel,
    texts: string[]
  ): { text: string[] } | { messages: Array<{ role: string; content: string }> } {
    // BGE models and gemma300 (dedicated embedding model) use text input format
    if (model.startsWith('bge') || model === 'gemma300') {
      return { text: texts };
    }

    // Gemma and other LLMs use messages format with a special prompt
    // We use the last hidden state as an embedding
    return {
      messages: texts.map((text) => ({
        role: 'user',
        content: `[EMBED]${text}`,
      })),
    };
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      // Build headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Cache key is derived from the normalized request body
        'cf-cache-key': this.generateCacheKey(body),
      };

      // Add Authorization header for direct Workers AI API
      if (this.config.apiToken && url.includes('api.cloudflare.com')) {
        headers['Authorization'] = `Bearer ${this.config.apiToken}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const isRetryable = response.status >= 500 || response.status === 429;
        throw new AIGatewayError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          isRetryable
        );
      }

      return response;
    } catch (error) {
      if (error instanceof AIGatewayError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AIGatewayError('Request timeout', undefined, true);
      }
      throw new AIGatewayError(
        error instanceof Error ? error.message : 'Unknown error',
        undefined,
        true
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse embedding response
   */
  private async parseResponse(response: Response, model: EmbeddingModel): Promise<number[][]> {
    const json = (await response.json()) as {
      result?: { data?: number[][] };
      data?: number[][];
      embeddings?: number[][];
      success?: boolean;
      errors?: Array<{ message: string }>;
    };

    // Handle Cloudflare AI response format
    if (json.result?.data) {
      return this.validateEmbeddings(json.result.data, model);
    }

    // Handle direct embedding array response
    if (json.data) {
      return this.validateEmbeddings(json.data, model);
    }

    // Handle alternative response format
    if (json.embeddings) {
      return this.validateEmbeddings(json.embeddings, model);
    }

    // Check for errors
    if (json.errors && json.errors.length > 0) {
      throw new AIGatewayError(
        `AI Gateway error: ${json.errors.map((e) => e.message).join(', ')}`,
        undefined,
        false
      );
    }

    throw new AIGatewayError('Invalid response format: no embeddings found', undefined, false);
  }

  /**
   * Validate embedding dimensions
   */
  private validateEmbeddings(embeddings: number[][], model: EmbeddingModel): number[][] {
    const expectedDim = MODEL_DIMENSIONS[model];

    for (const embedding of embeddings) {
      if (embedding.length !== expectedDim) {
        throw new AIGatewayError(
          `Invalid embedding dimension: expected ${expectedDim}, got ${embedding.length}`,
          undefined,
          false
        );
      }
    }

    return embeddings;
  }

  /**
   * Normalize text for consistent caching
   */
  private normalizeText(text: string): string {
    return text
      .trim()
      .replace(/\s+/g, ' ') // Collapse whitespace
      .slice(0, 8192); // Limit length for embedding models
  }

  /**
   * Generate cache key for request
   */
  private generateCacheKey(body: unknown): string {
    // Create a deterministic hash of the request body
    const str = JSON.stringify(body);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `emb-${Math.abs(hash).toString(36)}`;
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create an AI Gateway client with configuration
 */
export function createAIGatewayClient(config: AIGatewayClientConfig = {}): AIGatewayClient {
  return new AIGatewayClient(config);
}

/**
 * Create an AI Gateway client with lookup table support
 */
export function createAIGatewayClientWithLookup(
  config: Partial<AIGatewayConfig>,
  lookupTable: EmbeddingLookupTable
): AIGatewayClient {
  return new AIGatewayClient({
    ...config,
    lookupTable,
  });
}
