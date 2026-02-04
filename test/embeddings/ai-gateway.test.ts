/**
 * Tests for the AI Gateway client
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AIGatewayClient,
  AIGatewayError,
  createAIGatewayClient,
  createAIGatewayClientWithLookup,
} from '../../src/embeddings/ai-gateway.js';
import type { EmbeddingModel } from '../../src/embeddings/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock lookup table
function createMockLookupTable(entries: Map<string, { embedding_m3: Float32Array; embedding_gemma?: Float32Array }> = new Map()) {
  return {
    lookup: vi.fn(async (term: string) => {
      return entries.get(term) ?? null;
    }),
    getStats: vi.fn(() => ({
      entryCount: entries.size,
      lookupCount: 0,
      hitCount: 0,
      hitRate: 0,
    })),
  };
}

describe('AIGatewayClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateEmbedding', () => {
    it('should generate embeddings', async () => {
      const mockEmbedding = Array(1024).fill(0.1);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [mockEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        baseUrl: 'https://gateway.ai.cloudflare.com/v1',
        accountId: 'test-account',
        gatewayId: 'test-gateway',
      });

      const embedding = await client.generateEmbedding('bge-m3', 'Test text');

      expect(embedding).toHaveLength(1024);
      expect(embedding[0]).toBe(0.1);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should batch multiple texts', async () => {
      const mockEmbeddings = [
        Array(1024).fill(0.1),
        Array(1024).fill(0.2),
        Array(1024).fill(0.3),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: mockEmbeddings },
        }),
      });

      const client = createAIGatewayClient();
      const response = await client.generateEmbeddings({
        model: 'bge-m3',
        texts: ['Text 1', 'Text 2', 'Text 3'],
      });

      expect(response.embeddings).toHaveLength(3);
      expect(response.embeddings[0]).toHaveLength(1024);
      expect(response.embeddings[1]).toHaveLength(1024);
      expect(response.embeddings[2]).toHaveLength(1024);

      // Should make only one request for batch
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should use lookup table when available', async () => {
      const cachedEmbedding = new Float32Array(1024).fill(0.5);
      const lookupTable = createMockLookupTable(
        new Map([['test text', { embedding_m3: cachedEmbedding }]])
      );

      const client = createAIGatewayClient({
        lookupTable: lookupTable as any,
      });

      // Generate embedding for cached term
      const embedding = await client.generateEmbedding('bge-m3', 'test text');

      // Should return cached embedding
      expect(embedding).toHaveLength(1024);
      expect(embedding[0]).toBe(0.5);

      // Should NOT call fetch
      expect(mockFetch).not.toHaveBeenCalled();

      // Lookup should have been called
      expect(lookupTable.lookup).toHaveBeenCalled();
    });

    it('should fall back to AI Gateway on lookup miss', async () => {
      const lookupTable = createMockLookupTable(new Map());
      const mockEmbedding = Array(1024).fill(0.7);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [mockEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        lookupTable: lookupTable as any,
      });

      const embedding = await client.generateEmbedding('bge-m3', 'uncached term');

      expect(embedding).toHaveLength(1024);
      expect(embedding[0]).toBe(0.7);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const mockEmbedding = Array(1024).fill(0.3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [mockEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        maxRetries: 3,
        retryDelayMs: 10,
      });

      const embedding = await client.generateEmbedding('bge-m3', 'Test text');

      expect(embedding).toHaveLength(1024);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent error'));

      const client = createAIGatewayClient({
        maxRetries: 2,
        retryDelayMs: 10,
      });

      await expect(
        client.generateEmbedding('bge-m3', 'Test text')
      ).rejects.toThrow('Failed after');

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Headers(),
      });

      const client = createAIGatewayClient({
        maxRetries: 3,
        retryDelayMs: 10,
      });

      await expect(
        client.generateEmbedding('bge-m3', 'Test text')
      ).rejects.toThrow('HTTP 401');

      // Should not retry for 401
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should retry on 5xx errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
      });

      const mockEmbedding = Array(1024).fill(0.2);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [mockEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        maxRetries: 3,
        retryDelayMs: 10,
      });

      const embedding = await client.generateEmbedding('bge-m3', 'Test text');

      expect(embedding).toHaveLength(1024);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should retry on rate limit (429)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers(),
      });

      const mockEmbedding = Array(1024).fill(0.4);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [mockEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        maxRetries: 3,
        retryDelayMs: 10,
      });

      const embedding = await client.generateEmbedding('bge-m3', 'Test text');

      expect(embedding).toHaveLength(1024);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('generateEmbeddings (batch)', () => {
    it('should handle empty texts array', async () => {
      const client = createAIGatewayClient();
      const response = await client.generateEmbeddings({
        model: 'bge-m3',
        texts: [],
      });

      expect(response.embeddings).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should use partial lookup and fetch missing', async () => {
      const cachedEmbedding = new Float32Array(1024).fill(0.1);
      const lookupTable = createMockLookupTable(
        new Map([['cached term', { embedding_m3: cachedEmbedding }]])
      );

      const fetchedEmbedding = Array(1024).fill(0.9);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [fetchedEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        lookupTable: lookupTable as any,
      });

      const response = await client.generateEmbeddings({
        model: 'bge-m3',
        texts: ['cached term', 'uncached term'],
      });

      expect(response.embeddings).toHaveLength(2);
      // First should be from lookup (close to 0.1 due to Float32 precision)
      expect(response.embeddings[0][0]).toBeCloseTo(0.1, 5);
      // Second should be from fetch (0.9)
      expect(response.embeddings[1][0]).toBeCloseTo(0.9, 5);

      // Should only fetch the uncached one
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should track cache statistics', async () => {
      const cachedEmbedding = new Float32Array(1024).fill(0.5);
      const lookupTable = createMockLookupTable(
        new Map([['cached', { embedding_m3: cachedEmbedding }]])
      );

      const fetchedEmbedding = Array(1024).fill(0.5);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [fetchedEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        lookupTable: lookupTable as any,
      });

      // Make several requests
      await client.generateEmbedding('bge-m3', 'cached');
      await client.generateEmbedding('bge-m3', 'not-cached-1');
      await client.generateEmbedding('bge-m3', 'not-cached-2');

      const stats = client.getCacheStats();

      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.lookupHits).toBeGreaterThanOrEqual(1);
      expect(stats.lookupMisses).toBeGreaterThanOrEqual(2);
      expect(stats.aiGatewayRequests).toBeGreaterThanOrEqual(2);
    });
  });

  describe('lookupOnly', () => {
    it('should return only cached embeddings', async () => {
      const cachedEmbedding = new Float32Array(1024).fill(0.3);
      const lookupTable = createMockLookupTable(
        new Map([
          ['term1', { embedding_m3: cachedEmbedding }],
          ['term2', { embedding_m3: cachedEmbedding }],
        ])
      );

      const client = createAIGatewayClient({
        lookupTable: lookupTable as any,
      });

      const result = await client.lookupOnly(['term1', 'term2', 'term3']);

      expect(result.hits).toBe(2);
      expect(result.misses).toBe(1);
      expect(result.embeddings.size).toBe(2);
      expect(result.embeddings.has(0)).toBe(true);
      expect(result.embeddings.has(1)).toBe(true);
      expect(result.embeddings.has(2)).toBe(false);

      // Should NOT call fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return empty when no lookup table', async () => {
      const client = createAIGatewayClient();

      const result = await client.lookupOnly(['term1', 'term2']);

      expect(result.hits).toBe(0);
      expect(result.misses).toBe(2);
      expect(result.embeddings.size).toBe(0);
    });
  });

  describe('cache stats', () => {
    it('should track and reset stats', async () => {
      const mockEmbedding = Array(1024).fill(0.1);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'HIT' }),
        json: async () => ({
          result: { data: [mockEmbedding] },
        }),
      });

      const client = createAIGatewayClient();

      await client.generateEmbedding('bge-m3', 'test');

      const stats = client.getCacheStats();
      expect(stats.total).toBeGreaterThanOrEqual(1);

      client.resetStats();

      const resetStats = client.getCacheStats();
      expect(resetStats.total).toBe(0);
      expect(resetStats.hits).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should validate embedding dimensions', async () => {
      // Wrong dimension for bge-m3 (should be 1024)
      const wrongDimEmbedding = Array(768).fill(0.1);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'cf-cache-status': 'MISS' }),
        json: async () => ({
          result: { data: [wrongDimEmbedding] },
        }),
      });

      const client = createAIGatewayClient({
        maxRetries: 1,
        retryDelayMs: 10,
      });

      await expect(
        client.generateEmbedding('bge-m3', 'test')
      ).rejects.toThrow('Invalid embedding dimension');
    });

    it('should handle AI Gateway error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          success: false,
          errors: [{ message: 'Model not available' }],
        }),
      });

      const client = createAIGatewayClient({
        maxRetries: 1,
        retryDelayMs: 10,
      });

      await expect(
        client.generateEmbedding('bge-m3', 'test')
      ).rejects.toThrow('Model not available');
    });
  });
});

describe('AIGatewayError', () => {
  it('should create error with status code and retryable flag', () => {
    const error = new AIGatewayError('Test error', 500, true);

    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(500);
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('AIGatewayError');
  });

  it('should default retryable to false', () => {
    const error = new AIGatewayError('Test error');

    expect(error.retryable).toBe(false);
  });
});

describe('createAIGatewayClientWithLookup', () => {
  it('should create client with lookup table', async () => {
    const cachedEmbedding = new Float32Array(1024).fill(0.8);
    const lookupTable = createMockLookupTable(
      new Map([['test', { embedding_m3: cachedEmbedding }]])
    );

    const client = createAIGatewayClientWithLookup(
      { baseUrl: 'https://test.gateway.ai' },
      lookupTable as any
    );

    expect(client.hasLookupTable()).toBe(true);

    const embedding = await client.generateEmbedding('bge-m3', 'test');
    expect(embedding[0]).toBeCloseTo(0.8, 5);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('gemma300 model support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate embeddings with gemma300 model', async () => {
    const mockEmbedding = Array(768).fill(0.1);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'cf-cache-status': 'MISS' }),
      json: async () => ({
        result: { data: [mockEmbedding] },
      }),
    });

    const client = createAIGatewayClient({
      baseUrl: 'https://gateway.ai.cloudflare.com/v1',
      accountId: 'test-account',
      gatewayId: 'test-gateway',
    });

    const embedding = await client.generateEmbedding('gemma300', 'Test text');

    expect(embedding).toHaveLength(768);
    expect(embedding[0]).toBe(0.1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Verify the correct model ID was used
    const fetchCall = mockFetch.mock.calls[0];
    expect(fetchCall[0]).toContain('embeddinggemma-300m');
  });

  it('should batch multiple texts with gemma300', async () => {
    const mockEmbeddings = [
      Array(768).fill(0.1),
      Array(768).fill(0.2),
      Array(768).fill(0.3),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'cf-cache-status': 'MISS' }),
      json: async () => ({
        result: { data: mockEmbeddings },
      }),
    });

    const client = createAIGatewayClient();
    const response = await client.generateEmbeddings({
      model: 'gemma300',
      texts: ['Text 1', 'Text 2', 'Text 3'],
    });

    expect(response.embeddings).toHaveLength(3);
    expect(response.embeddings[0]).toHaveLength(768);
    expect(response.embeddings[1]).toHaveLength(768);
    expect(response.embeddings[2]).toHaveLength(768);
  });

  it('should use lookup table for gemma300 when available', async () => {
    const cachedM3Embedding = new Float32Array(1024).fill(0.5);
    const cachedGemmaEmbedding = new Float32Array(768).fill(0.7);
    const lookupTable = createMockLookupTable(
      new Map([['test text', {
        embedding_m3: cachedM3Embedding,
        embedding_gemma: cachedGemmaEmbedding
      }]])
    );

    const client = createAIGatewayClient({
      lookupTable: lookupTable as any,
    });

    // Generate embedding for cached term with gemma300
    const embedding = await client.generateEmbedding('gemma300', 'test text');

    // Should return cached gemma embedding
    expect(embedding).toHaveLength(768);
    expect(embedding[0]).toBeCloseTo(0.7, 5);

    // Should NOT call fetch
    expect(mockFetch).not.toHaveBeenCalled();

    // Lookup should have been called
    expect(lookupTable.lookup).toHaveBeenCalled();
  });

  it('should fall back to m3 embedding when gemma embedding not in lookup table', async () => {
    const cachedM3Embedding = new Float32Array(1024).fill(0.5);
    const lookupTable = createMockLookupTable(
      new Map([['test text', { embedding_m3: cachedM3Embedding }]])
    );

    const client = createAIGatewayClient({
      lookupTable: lookupTable as any,
    });

    // Generate embedding for cached term with gemma300 (but no gemma embedding stored)
    const embedding = await client.generateEmbedding('gemma300', 'test text');

    // Should fall back to M3 embedding
    expect(embedding).toHaveLength(1024);
    expect(embedding[0]).toBe(0.5);
  });

  it('should validate gemma300 embedding dimensions', async () => {
    // Wrong dimension for gemma300 (should be 768)
    const wrongDimEmbedding = Array(1024).fill(0.1);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'cf-cache-status': 'MISS' }),
      json: async () => ({
        result: { data: [wrongDimEmbedding] },
      }),
    });

    const client = createAIGatewayClient({
      maxRetries: 1,
      retryDelayMs: 10,
    });

    await expect(
      client.generateEmbedding('gemma300', 'test')
    ).rejects.toThrow('Invalid embedding dimension');
  });

  it('should use text input format for gemma300 (not messages)', async () => {
    const mockEmbedding = Array(768).fill(0.1);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'cf-cache-status': 'MISS' }),
      json: async () => ({
        result: { data: [mockEmbedding] },
      }),
    });

    const client = createAIGatewayClient();
    await client.generateEmbedding('gemma300', 'Test text');

    // Check that the request body uses 'text' format (for embedding models)
    // rather than 'messages' format (for LLM models)
    const fetchCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.text).toBeDefined();
    expect(requestBody.messages).toBeUndefined();
  });
});
