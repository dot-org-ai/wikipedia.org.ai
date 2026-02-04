/**
 * Cloudflare Snippet for cached vector search
 *
 * Size budget: <1MB total
 * Strategy:
 * 1. Check inline top-1K term embeddings (FREE, ~256KB)
 * 2. Check R2-cached top-10K embeddings (FREE after first load)
 * 3. Fall back to AI Gateway for embedding (cached, cheap)
 * 4. Return file URLs for client to fetch from R2
 *
 * Endpoints:
 * - GET /lookup?title=X - Title lookup (returns file location)
 * - GET /search?q=X&k=10 - Vector search
 * - GET /types - List article types
 * - GET /health - Health check
 * - GET /metrics - Usage metrics
 */

import { cosineSimilarity, topK, quantize } from './cosine.js';
import { TOP_TERMS, TERM_TO_TITLE, PCA_MATRIX, REDUCED_DIM } from './embeddings-top10k.js';

// Configuration
const CONFIG = {
  // R2 bucket URL for embeddings data
  r2BaseUrl: 'https://wikipedia-embeddings.r2.dev',
  // AI Gateway URL for embedding generation
  aiGatewayUrl: 'https://gateway.ai.cloudflare.com/v1',
  // Account and gateway IDs (set via environment)
  accountId: null,
  gatewayId: null,
  // Cache TTL for embeddings data (24 hours)
  cacheTtl: 86400,
  // Default number of search results
  defaultK: 10,
  // Maximum number of search results
  maxK: 100,
};

// In-memory cache for top-10K embeddings (loaded from R2)
let embeddingsCache = null;
let embeddingsCachePromise = null;

// Bloom filter for title existence check (loaded from R2)
let bloomFilter = null;
let bloomFilterPromise = null;

// Metrics tracking
const metrics = {
  totalRequests: 0,
  successfulRequests: 0,
  erroredRequests: 0,
  lookupRequests: 0,
  searchRequests: 0,
  healthChecks: 0,
  typeRequests: 0,
  cachedResponses: 0,
  r2Fetches: 0,
  aiGatewayRequests: 0,
  cacheHits: 0,
  startTime: Date.now(),
};

/**
 * Main fetch handler
 */
export default {
  async fetch(request, env) {
    // Update config from environment
    if (env) {
      CONFIG.accountId = env.CF_ACCOUNT_ID || CONFIG.accountId;
      CONFIG.gatewayId = env.AI_GATEWAY_ID || CONFIG.gatewayId;
      CONFIG.r2BaseUrl = env.R2_BASE_URL || CONFIG.r2BaseUrl;
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const startTime = Date.now();

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow GET requests
    if (request.method !== 'GET') {
      return jsonResponse(
        { error: 'Method not allowed', method: request.method },
        405,
        corsHeaders
      );
    }

    // Increment total requests
    metrics.totalRequests++;

    try {
      let response;

      // Route to appropriate handler
      switch (path) {
        case '/lookup':
          metrics.lookupRequests++;
          response = await handleLookup(url, env);
          break;
        case '/search':
          metrics.searchRequests++;
          response = await handleSearch(url, env);
          break;
        case '/types':
          metrics.typeRequests++;
          response = handleTypes();
          break;
        case '/health':
          metrics.healthChecks++;
          response = handleHealth();
          break;
        case '/metrics':
          response = handleMetrics();
          break;
        default:
          response = jsonResponse({ error: 'Not found', path }, 404);
      }

      // Log request
      const duration = Date.now() - startTime;
      logRequest(path, request.method, response.status, duration);

      // Add CORS headers and cache headers to response
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }

      // Add cache headers based on endpoint
      if (path === '/health' || path === '/metrics') {
        headers.set('Cache-Control', 'no-cache, no-store');
      } else if (path === '/types') {
        headers.set('Cache-Control', 'public, max-age=86400');
      } else {
        headers.set('Cache-Control', 'public, max-age=3600');
      }

      // Add additional security and performance headers
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('X-Frame-Options', 'DENY');

      // Track success/error
      if (response.status >= 200 && response.status < 300) {
        metrics.successfulRequests++;
      } else if (response.status >= 400) {
        metrics.erroredRequests++;
      }

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      metrics.erroredRequests++;
      const duration = Date.now() - startTime;
      logRequest(path, request.method, 500, duration, error);

      console.error('Snippet error:', {
        path,
        error: error.message,
        stack: error.stack,
      });

      return jsonResponse(
        {
          error: 'Internal server error',
          message: error.message,
        },
        500,
        corsHeaders
      );
    }
  },
};

/**
 * Handle title lookup - returns file location for an article
 * GET /lookup?title=United+States
 */
async function handleLookup(url, env) {
  const title = url.searchParams.get('title');
  if (!title) {
    return jsonResponse({ error: 'Missing title parameter' }, 400);
  }

  // Normalize title
  const normalizedTitle = normalizeTitle(title);

  // Check alias map first
  const canonicalTitle = TERM_TO_TITLE.get(normalizedTitle.toLowerCase()) || normalizedTitle;

  // Check bloom filter for existence (fast negative check)
  const bloom = await loadBloomFilter(env);
  if (bloom && !bloomFilterContains(bloom, canonicalTitle)) {
    return jsonResponse({
      found: false,
      title: canonicalTitle,
      suggestion: 'Article not found. Try search?',
    });
  }

  // Compute partition info for the title
  const location = computeArticleLocation(canonicalTitle);

  return jsonResponse({
    found: true,
    title: canonicalTitle,
    location: {
      type: location.type,
      partition: location.partition,
      url: `${CONFIG.r2BaseUrl}/articles/${location.type}/${location.partition}.parquet`,
      embeddingsUrl: `${CONFIG.r2BaseUrl}/embeddings/${location.type}/${location.partition}.lance`,
    },
  });
}

/**
 * Handle vector search
 * GET /search?q=history+of+computers&k=10
 */
async function handleSearch(url, env) {
  const query = url.searchParams.get('q');
  if (!query) {
    return jsonResponse({ error: 'Missing q parameter' }, 400);
  }

  const k = Math.min(parseInt(url.searchParams.get('k') || CONFIG.defaultK, 10), CONFIG.maxK);

  // Step 1: Check inline top-1K embeddings (FREE)
  const inlineResults = searchInlineEmbeddings(query, k);
  if (inlineResults.length >= k && inlineResults[0].score > 0.9) {
    return jsonResponse({
      results: inlineResults.map((r) => ({
        title: r.term,
        score: r.score,
        location: computeArticleLocation(r.term),
        source: 'inline',
      })),
      source: 'inline',
      cached: true,
    });
  }

  // Step 2: Try R2-cached top-10K embeddings
  const cachedEmbeddings = await loadEmbeddingsFromR2(env);
  if (cachedEmbeddings) {
    const queryEmbedding = await getQueryEmbedding(query, env);
    if (queryEmbedding) {
      const results = topK(queryEmbedding, cachedEmbeddings, k);
      return jsonResponse({
        results: results.map((r) => ({
          title: r.term,
          score: r.score,
          location: computeArticleLocation(r.term),
          source: 'r2-cache',
        })),
        source: 'r2-cache',
        cached: true,
      });
    }
  }

  // Step 3: Fall back to AI Gateway for full search
  // This requires client to fetch from full embeddings index
  return jsonResponse({
    results: inlineResults.map((r) => ({
      title: r.term,
      score: r.score,
      location: computeArticleLocation(r.term),
      source: 'inline-partial',
    })),
    source: 'inline-partial',
    fallback: {
      message: 'For more results, use full vector search',
      embeddingsIndex: `${CONFIG.r2BaseUrl}/embeddings/index.lance`,
    },
    cached: false,
  });
}

/**
 * Handle types list
 * GET /types
 */
function handleTypes() {
  return jsonResponse({
    types: ['article', 'category', 'disambiguation', 'redirect', 'template', 'file', 'portal', 'other'],
    description: 'Article types used for partitioning',
  });
}

/**
 * Handle health check
 * GET /health
 */
function handleHealth() {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    config: {
      r2BaseUrl: CONFIG.r2BaseUrl,
      hasInlineEmbeddings: TOP_TERMS.size > 0,
      inlineTermCount: TOP_TERMS.size,
      hasCachedEmbeddings: embeddingsCache !== null,
    },
  });
}

/**
 * Search inline embeddings (top-1K terms)
 */
function searchInlineEmbeddings(query, k) {
  if (TOP_TERMS.size === 0) {
    return [];
  }

  // For now, use simple text matching on inline terms
  // Real implementation would use pre-computed query embedding
  const normalizedQuery = query.toLowerCase().trim();
  const results = [];

  for (const [term] of TOP_TERMS) {
    const score = computeTextSimilarity(normalizedQuery, term);
    if (score > 0) {
      results.push({ term, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

/**
 * Simple text similarity for fallback
 */
function computeTextSimilarity(query, term) {
  const queryWords = new Set(query.split(/\s+/));
  const termWords = new Set(term.split(/\s+/));

  let matches = 0;
  for (const word of queryWords) {
    if (termWords.has(word)) {
      matches++;
    }
  }

  // Jaccard-like similarity
  const union = new Set([...queryWords, ...termWords]);
  return matches / union.size;
}

/**
 * Load bloom filter from R2 (for title existence check)
 */
async function loadBloomFilter(env) {
  if (bloomFilter) {
    metrics.cacheHits++;
    return bloomFilter;
  }

  if (bloomFilterPromise) {
    return bloomFilterPromise;
  }

  bloomFilterPromise = (async () => {
    try {
      metrics.r2Fetches++;
      const response = await fetch(`${CONFIG.r2BaseUrl}/index/bloom-filter.bin`, {
        cf: { cacheTtl: CONFIG.cacheTtl },
      });

      if (!response.ok) {
        console.warn('Failed to load bloom filter:', {
          status: response.status,
          url: `${CONFIG.r2BaseUrl}/index/bloom-filter.bin`,
        });
        return null;
      }

      const buffer = await response.arrayBuffer();
      bloomFilter = {
        data: new Uint8Array(buffer),
        size: buffer.byteLength * 8, // bits
        hashCount: 7, // k hash functions
      };

      return bloomFilter;
    } catch (error) {
      console.error('Error loading bloom filter:', {
        error: error.message,
        url: `${CONFIG.r2BaseUrl}/index/bloom-filter.bin`,
      });
      return null;
    }
  })();

  return bloomFilterPromise;
}

/**
 * Check if bloom filter might contain a title
 */
function bloomFilterContains(bloom, title) {
  const hashes = computeBloomHashes(title, bloom.hashCount, bloom.size);

  for (const hash of hashes) {
    const byteIndex = Math.floor(hash / 8);
    const bitIndex = hash % 8;
    if ((bloom.data[byteIndex] & (1 << bitIndex)) === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Compute bloom filter hashes for a string
 */
function computeBloomHashes(str, k, size) {
  const hashes = [];
  let h1 = fnv1a(str);
  let h2 = fnv1a(str + str);

  for (let i = 0; i < k; i++) {
    hashes.push(Math.abs((h1 + i * h2) % size));
  }

  return hashes;
}

/**
 * FNV-1a hash function
 */
function fnv1a(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Load embeddings from R2 cache
 */
async function loadEmbeddingsFromR2(env) {
  if (embeddingsCache) {
    metrics.cacheHits++;
    return embeddingsCache;
  }

  if (embeddingsCachePromise) {
    return embeddingsCachePromise;
  }

  embeddingsCachePromise = (async () => {
    try {
      metrics.r2Fetches++;
      const response = await fetch(`${CONFIG.r2BaseUrl}/index/top10k-embeddings.bin`, {
        cf: { cacheTtl: CONFIG.cacheTtl },
      });

      if (!response.ok) {
        console.warn('Failed to load R2 embeddings:', {
          status: response.status,
          url: `${CONFIG.r2BaseUrl}/index/top10k-embeddings.bin`,
        });
        return null;
      }

      // Parse binary format: [termLength(2), term(utf8), embedding(256)]
      const buffer = await response.arrayBuffer();
      const view = new DataView(buffer);
      const decoder = new TextDecoder();

      embeddingsCache = new Map();
      let offset = 0;

      while (offset < buffer.byteLength) {
        const termLength = view.getUint16(offset, true);
        offset += 2;

        const termBytes = new Uint8Array(buffer, offset, termLength);
        const term = decoder.decode(termBytes);
        offset += termLength;

        const embedding = new Uint8Array(buffer, offset, REDUCED_DIM);
        offset += REDUCED_DIM;

        embeddingsCache.set(term, embedding);
      }

      return embeddingsCache;
    } catch (error) {
      console.error('Error loading R2 embeddings:', {
        error: error.message,
        url: `${CONFIG.r2BaseUrl}/index/top10k-embeddings.bin`,
      });
      return null;
    }
  })();

  return embeddingsCachePromise;
}

/**
 * Get query embedding (from cache or AI Gateway)
 */
async function getQueryEmbedding(query, env) {
  // Check if we have inline embedding for this exact query
  const normalizedQuery = query.toLowerCase().trim();
  const inlineEmbedding = TOP_TERMS.get(normalizedQuery);
  if (inlineEmbedding) {
    return inlineEmbedding;
  }

  // Check alias map
  const canonicalQuery = TERM_TO_TITLE.get(normalizedQuery);
  if (canonicalQuery) {
    const aliasEmbedding = TOP_TERMS.get(canonicalQuery.toLowerCase());
    if (aliasEmbedding) {
      return aliasEmbedding;
    }
  }

  // Fall back to AI Gateway
  if (!CONFIG.accountId || !CONFIG.gatewayId) {
    console.warn('AI Gateway not configured - missing account or gateway ID');
    return null;
  }

  try {
    metrics.aiGatewayRequests++;
    const response = await fetch(
      `${CONFIG.aiGatewayUrl}/${CONFIG.accountId}/${CONFIG.gatewayId}/workers-ai/@cf/baai/bge-m3`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: [normalizedQuery] }),
        cf: { cacheTtl: CONFIG.cacheTtl },
      }
    );

    if (!response.ok) {
      console.error('AI Gateway error:', {
        status: response.status,
        query: normalizedQuery,
      });
      return null;
    }

    const data = await response.json();
    const embedding = data.result?.data?.[0] || data.data?.[0];

    if (!embedding) {
      console.warn('No embedding returned from AI Gateway');
      return null;
    }

    // Apply PCA and quantize if we have a PCA matrix
    if (PCA_MATRIX) {
      const reduced = applyPCA(embedding, PCA_MATRIX);
      return quantize(reduced);
    }

    // Otherwise just quantize (assuming 256-dim model or truncation)
    return quantize(embedding.slice(0, REDUCED_DIM));
  } catch (error) {
    console.error('Error getting query embedding:', {
      error: error.message,
      query: normalizedQuery,
    });
    return null;
  }
}

/**
 * Apply PCA projection
 */
function applyPCA(embedding, matrix) {
  const result = new Float32Array(matrix.length);
  for (let i = 0; i < matrix.length; i++) {
    let sum = 0;
    for (let j = 0; j < matrix[i].length; j++) {
      sum += embedding[j] * matrix[i][j];
    }
    result[i] = sum;
  }
  return result;
}

/**
 * Normalize title for lookup
 */
function normalizeTitle(title) {
  return title
    .trim()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Compute article location (partition info)
 */
function computeArticleLocation(title) {
  // Simple hash-based partitioning
  const hash = fnv1a(title.toLowerCase());
  const partitionCount = 1000;
  const partition = hash % partitionCount;

  // Detect type from title patterns
  let type = 'article';
  if (title.startsWith('Category:')) type = 'category';
  else if (title.startsWith('Template:')) type = 'template';
  else if (title.startsWith('File:')) type = 'file';
  else if (title.startsWith('Portal:')) type = 'portal';
  else if (title.includes('(disambiguation)')) type = 'disambiguation';

  return {
    type,
    partition: partition.toString().padStart(4, '0'),
    hash,
  };
}

/**
 * Handle metrics endpoint
 * GET /metrics
 */
function handleMetrics() {
  const uptime = Date.now() - metrics.startTime;
  const successRate = metrics.totalRequests > 0 ? (metrics.successfulRequests / metrics.totalRequests * 100).toFixed(2) : 0;

  return jsonResponse({
    metrics: {
      uptime,
      totalRequests: metrics.totalRequests,
      successfulRequests: metrics.successfulRequests,
      erroredRequests: metrics.erroredRequests,
      successRate: parseFloat(successRate),
      byEndpoint: {
        lookup: metrics.lookupRequests,
        search: metrics.searchRequests,
        health: metrics.healthChecks,
        types: metrics.typeRequests,
      },
      cache: {
        inlineEmbeddings: TOP_TERMS.size,
        cachedR2Embeddings: embeddingsCache ? embeddingsCache.size : 0,
        bloomFilterLoaded: bloomFilter !== null,
        cacheHits: metrics.cacheHits,
        r2Fetches: metrics.r2Fetches,
      },
      requests: {
        aiGatewayRequests: metrics.aiGatewayRequests,
        cachedResponses: metrics.cachedResponses,
      },
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Log request details
 */
function logRequest(path, method, status, duration, error = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    path,
    method,
    status,
    duration: `${duration}ms`,
  };

  if (error) {
    logEntry.error = error.message;
  }

  console.log(JSON.stringify(logEntry));
}

/**
 * JSON response helper
 */
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
