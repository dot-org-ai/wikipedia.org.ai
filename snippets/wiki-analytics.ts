/**
 * Wiki Analytics Cloudflare Snippet
 *
 * Provides observability layer for wiki.org.ai since snippets can't be tailed.
 *
 * Features:
 * 1. Caching Layer - Cache API with stale-while-revalidate
 * 2. Error Logging - Store errors in KV with metadata
 * 3. Analytics Tracking - Request counts, response times, error rates
 * 4. Fallback Routing - Circuit breaker pattern for graceful degradation
 * 5. Monitoring Endpoints - /_analytics, /_errors, /_health
 *
 * Routes to main worker at wikipedia.org.ai
 */

/// <reference types="@cloudflare/workers-types" />

// =============================================================================
// Types
// =============================================================================

interface Env {
  /** KV namespace for analytics storage */
  WIKI_ANALYTICS: KVNamespace;
}

/** Error entry stored in KV */
interface ErrorEntry {
  timestamp: string;
  url: string;
  method: string;
  error: string;
  status: number;
  userAgent: string | null;
  country: string | null;
  colo: string | null;
  latencyMs: number;
}

/** Analytics bucket for time-based aggregation */
interface AnalyticsBucket {
  requests: number;
  errors: number;
  cacheHits: number;
  cacheMisses: number;
  totalLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  latencies: number[]; // Keep last N for percentile calculation
  byEndpoint: Record<string, EndpointStats>;
  byStatus: Record<string, number>;
  updatedAt: string;
}

/** Per-endpoint statistics */
interface EndpointStats {
  requests: number;
  errors: number;
  totalLatencyMs: number;
}

/** Circuit breaker state */
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure: string | null;
  lastSuccess: string | null;
  openedAt: string | null;
  testRequests: number;
}

/** Health status */
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  circuitBreaker: CircuitBreakerState;
  uptime: number;
  version: string;
  timestamp: string;
}

// =============================================================================
// Constants
// =============================================================================

const MAIN_WORKER_URL = 'https://wikipedia.org.ai';
const VERSION = '1.0.0';

// Cache settings
const CACHE_TTL_SUCCESS = 300; // 5 minutes
const CACHE_TTL_ERROR = 60; // 1 minute for error responses
const STALE_WHILE_REVALIDATE = 3600; // 1 hour

// Error log settings
const MAX_ERRORS = 100;
const ERROR_KEY_PREFIX = 'error:';
const ERROR_LIST_KEY = 'errors:list';

// Analytics settings
const ANALYTICS_BUCKET_KEY = 'analytics:current';
const ANALYTICS_HISTORY_PREFIX = 'analytics:history:';
const MAX_LATENCIES_STORED = 1000;

// Circuit breaker settings
const CIRCUIT_BREAKER_KEY = 'circuit:state';
const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60000; // 1 minute
const RECOVERY_TIMEOUT_MS = 30000; // 30 seconds
const HALF_OPEN_TEST_REQUESTS = 3;

// =============================================================================
// Utility Functions
// =============================================================================

/** Get current hour bucket key */
function getHourBucket(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}`;
}

/** Get current day bucket key */
function getDayBucket(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** Calculate percentile from sorted array */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

/** Normalize endpoint path for grouping */
function normalizeEndpoint(path: string): string {
  // Group similar endpoints together
  // /Albert_Einstein -> /:title
  // /fr/Paris -> /:lang/:title
  // /Albert_Einstein/summary -> /:title/:section

  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return '/';

  // Check for known sections
  const sections = ['summary', 'infobox', 'links', 'categories', 'text'];

  // Check for monitoring endpoints
  if (parts[0]?.startsWith('_')) {
    return '/' + parts[0];
  }

  // Check for language prefix (2 letter code)
  if (parts[0]?.length === 2 && /^[a-z]{2}$/.test(parts[0])) {
    if (parts.length === 2) return '/:lang/:title';
    if (parts.length === 3 && sections.includes(parts[2] ?? '')) {
      return '/:lang/:title/:section';
    }
    return '/:lang/:title/*';
  }

  // No language prefix
  if (parts.length === 1) {
    if (parts[0]?.endsWith('.json')) return '/:title.json';
    return '/:title';
  }

  if (parts.length === 2 && sections.includes(parts[1] ?? '')) {
    return '/:title/:section';
  }

  return '/:title/*';
}

// =============================================================================
// Circuit Breaker
// =============================================================================

async function getCircuitState(kv: KVNamespace): Promise<CircuitBreakerState> {
  const stored = await kv.get<CircuitBreakerState>(CIRCUIT_BREAKER_KEY, 'json');
  return stored ?? {
    state: 'closed',
    failures: 0,
    lastFailure: null,
    lastSuccess: null,
    openedAt: null,
    testRequests: 0,
  };
}

async function updateCircuitState(
  kv: KVNamespace,
  state: CircuitBreakerState
): Promise<void> {
  await kv.put(CIRCUIT_BREAKER_KEY, JSON.stringify(state));
}

async function recordSuccess(kv: KVNamespace): Promise<void> {
  const state = await getCircuitState(kv);
  const now = new Date().toISOString();

  if (state.state === 'half-open') {
    state.testRequests++;
    if (state.testRequests >= HALF_OPEN_TEST_REQUESTS) {
      // Recovery successful, close circuit
      state.state = 'closed';
      state.failures = 0;
      state.openedAt = null;
      state.testRequests = 0;
    }
  } else if (state.state === 'closed') {
    // Reset failure count on success
    state.failures = 0;
  }

  state.lastSuccess = now;
  await updateCircuitState(kv, state);
}

async function recordFailure(kv: KVNamespace): Promise<void> {
  const state = await getCircuitState(kv);
  const now = new Date();
  const nowIso = now.toISOString();

  state.failures++;
  state.lastFailure = nowIso;

  if (state.state === 'half-open') {
    // Failed during recovery, re-open circuit
    state.state = 'open';
    state.openedAt = nowIso;
    state.testRequests = 0;
  } else if (state.state === 'closed' && state.failures >= FAILURE_THRESHOLD) {
    // Too many failures, open circuit
    state.state = 'open';
    state.openedAt = nowIso;
  }

  await updateCircuitState(kv, state);
}

async function shouldAllowRequest(kv: KVNamespace): Promise<boolean> {
  const state = await getCircuitState(kv);

  if (state.state === 'closed') {
    return true;
  }

  if (state.state === 'open') {
    // Check if recovery timeout has passed
    if (state.openedAt) {
      const openedAt = new Date(state.openedAt).getTime();
      const now = Date.now();
      if (now - openedAt >= RECOVERY_TIMEOUT_MS) {
        // Move to half-open state
        state.state = 'half-open';
        state.testRequests = 0;
        await updateCircuitState(kv, state);
        return true;
      }
    }
    return false;
  }

  // Half-open: allow limited requests for testing
  return true;
}

// =============================================================================
// Error Logging
// =============================================================================

async function logError(
  kv: KVNamespace,
  error: ErrorEntry
): Promise<void> {
  const errorId = `${error.timestamp}-${Math.random().toString(36).slice(2, 8)}`;
  const errorKey = `${ERROR_KEY_PREFIX}${errorId}`;

  // Store the error entry with 7 day TTL
  await kv.put(errorKey, JSON.stringify(error), {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  // Update error list (keep last N errors)
  const listStr = await kv.get(ERROR_LIST_KEY);
  let errorIds: string[] = listStr ? JSON.parse(listStr) : [];

  errorIds.unshift(errorId);
  if (errorIds.length > MAX_ERRORS) {
    // Clean up old errors
    const toDelete = errorIds.slice(MAX_ERRORS);
    errorIds = errorIds.slice(0, MAX_ERRORS);

    // Delete old error entries (fire and forget)
    for (const oldId of toDelete) {
      kv.delete(`${ERROR_KEY_PREFIX}${oldId}`).catch(() => {});
    }
  }

  await kv.put(ERROR_LIST_KEY, JSON.stringify(errorIds));
}

async function getRecentErrors(
  kv: KVNamespace,
  limit: number = 20
): Promise<ErrorEntry[]> {
  const listStr = await kv.get(ERROR_LIST_KEY);
  if (!listStr) return [];

  const errorIds: string[] = JSON.parse(listStr);
  const errors: ErrorEntry[] = [];

  for (const errorId of errorIds.slice(0, limit)) {
    const errorStr = await kv.get(`${ERROR_KEY_PREFIX}${errorId}`);
    if (errorStr) {
      errors.push(JSON.parse(errorStr));
    }
  }

  return errors;
}

// =============================================================================
// Analytics Tracking
// =============================================================================

async function getAnalyticsBucket(kv: KVNamespace): Promise<AnalyticsBucket> {
  const stored = await kv.get<AnalyticsBucket>(ANALYTICS_BUCKET_KEY, 'json');
  return stored ?? {
    requests: 0,
    errors: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalLatencyMs: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0,
    latencies: [],
    byEndpoint: {},
    byStatus: {},
    updatedAt: new Date().toISOString(),
  };
}

async function recordRequest(
  kv: KVNamespace,
  endpoint: string,
  latencyMs: number,
  status: number,
  cacheHit: boolean
): Promise<void> {
  const bucket = await getAnalyticsBucket(kv);

  bucket.requests++;
  bucket.totalLatencyMs += latencyMs;

  if (cacheHit) {
    bucket.cacheHits++;
  } else {
    bucket.cacheMisses++;
  }

  if (status >= 400) {
    bucket.errors++;
  }

  // Track latencies for percentile calculation
  bucket.latencies.push(latencyMs);
  if (bucket.latencies.length > MAX_LATENCIES_STORED) {
    bucket.latencies = bucket.latencies.slice(-MAX_LATENCIES_STORED);
  }

  // Recalculate percentiles
  bucket.p50LatencyMs = percentile(bucket.latencies, 50);
  bucket.p95LatencyMs = percentile(bucket.latencies, 95);
  bucket.p99LatencyMs = percentile(bucket.latencies, 99);

  // Update endpoint stats
  const normalizedEndpoint = normalizeEndpoint(endpoint);
  if (!bucket.byEndpoint[normalizedEndpoint]) {
    bucket.byEndpoint[normalizedEndpoint] = {
      requests: 0,
      errors: 0,
      totalLatencyMs: 0,
    };
  }
  const endpointStats = bucket.byEndpoint[normalizedEndpoint]!;
  endpointStats.requests++;
  endpointStats.totalLatencyMs += latencyMs;
  if (status >= 400) {
    endpointStats.errors++;
  }

  // Update status counts
  const statusKey = String(status);
  bucket.byStatus[statusKey] = (bucket.byStatus[statusKey] || 0) + 1;

  bucket.updatedAt = new Date().toISOString();

  await kv.put(ANALYTICS_BUCKET_KEY, JSON.stringify(bucket));
}

async function rollupAnalytics(kv: KVNamespace): Promise<void> {
  const bucket = await getAnalyticsBucket(kv);
  const hourKey = `${ANALYTICS_HISTORY_PREFIX}${getHourBucket()}`;

  // Store hourly snapshot
  await kv.put(hourKey, JSON.stringify({
    ...bucket,
    latencies: [], // Don't store raw latencies in history
  }), {
    expirationTtl: 7 * 24 * 60 * 60, // 7 days
  });
}

// =============================================================================
// Caching
// =============================================================================

async function getCachedResponse(
  cache: Cache,
  request: Request
): Promise<{ response: Response | null; stale: boolean }> {
  const url = new URL(request.url);
  const cacheKey = new Request(url.toString(), request);

  const cached = await cache.match(cacheKey);
  if (!cached) {
    return { response: null, stale: false };
  }

  // Check if stale
  const cachedAt = cached.headers.get('X-Cached-At');
  if (cachedAt) {
    const age = Date.now() - new Date(cachedAt).getTime();
    const maxAge = cached.ok ? CACHE_TTL_SUCCESS * 1000 : CACHE_TTL_ERROR * 1000;

    if (age > maxAge) {
      // Stale but within stale-while-revalidate window
      if (age <= STALE_WHILE_REVALIDATE * 1000) {
        return { response: cached, stale: true };
      }
      return { response: null, stale: false };
    }
  }

  return { response: cached, stale: false };
}

async function cacheResponse(
  cache: Cache,
  request: Request,
  response: Response,
  ctx: ExecutionContext
): Promise<void> {
  const url = new URL(request.url);
  const cacheKey = new Request(url.toString(), request);

  // Only cache GET requests with successful responses or specific errors
  if (request.method !== 'GET') return;
  if (!response.ok && response.status !== 404) return;

  const ttl = response.ok ? CACHE_TTL_SUCCESS : CACHE_TTL_ERROR;

  const headers = new Headers(response.headers);
  headers.set('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`);
  headers.set('X-Cached-At', new Date().toISOString());

  const cacheable = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  ctx.waitUntil(cache.put(cacheKey, cacheable));
}

// =============================================================================
// Request Handling
// =============================================================================

async function proxyToWorker(
  request: Request,
  kv: KVNamespace
): Promise<Response> {
  const url = new URL(request.url);

  // Build target URL to main worker
  const targetUrl = new URL(url.pathname + url.search, MAIN_WORKER_URL);

  // Forward the request
  const response = await fetch(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD'
      ? request.body
      : undefined,
  });

  // Track success/failure for circuit breaker
  if (response.ok || response.status === 404) {
    await recordSuccess(kv);
  } else if (response.status >= 500) {
    await recordFailure(kv);
  }

  return response;
}

// =============================================================================
// Monitoring Endpoints
// =============================================================================

async function handleHealth(kv: KVNamespace): Promise<Response> {
  const circuitBreaker = await getCircuitState(kv);
  const bucket = await getAnalyticsBucket(kv);

  const errorRate = bucket.requests > 0
    ? bucket.errors / bucket.requests
    : 0;

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  if (circuitBreaker.state === 'open') {
    status = 'unhealthy';
  } else if (circuitBreaker.state === 'half-open' || errorRate > 0.1) {
    status = 'degraded';
  }

  const health: HealthStatus = {
    status,
    circuitBreaker,
    uptime: Date.now(), // Would need persistent storage for actual uptime
    version: VERSION,
    timestamp: new Date().toISOString(),
  };

  const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;

  return new Response(JSON.stringify(health, null, 2), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleAnalytics(kv: KVNamespace): Promise<Response> {
  const bucket = await getAnalyticsBucket(kv);

  // Calculate derived metrics
  const avgLatencyMs = bucket.requests > 0
    ? bucket.totalLatencyMs / bucket.requests
    : 0;

  const errorRate = bucket.requests > 0
    ? bucket.errors / bucket.requests
    : 0;

  const cacheHitRate = (bucket.cacheHits + bucket.cacheMisses) > 0
    ? bucket.cacheHits / (bucket.cacheHits + bucket.cacheMisses)
    : 0;

  const analytics = {
    summary: {
      totalRequests: bucket.requests,
      totalErrors: bucket.errors,
      errorRate: Math.round(errorRate * 10000) / 100, // Percentage with 2 decimals
      cacheHitRate: Math.round(cacheHitRate * 10000) / 100,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      p50LatencyMs: bucket.p50LatencyMs,
      p95LatencyMs: bucket.p95LatencyMs,
      p99LatencyMs: bucket.p99LatencyMs,
    },
    byEndpoint: Object.entries(bucket.byEndpoint).map(([endpoint, stats]) => ({
      endpoint,
      requests: stats.requests,
      errors: stats.errors,
      errorRate: stats.requests > 0
        ? Math.round((stats.errors / stats.requests) * 10000) / 100
        : 0,
      avgLatencyMs: stats.requests > 0
        ? Math.round((stats.totalLatencyMs / stats.requests) * 100) / 100
        : 0,
    })).sort((a, b) => b.requests - a.requests),
    byStatus: bucket.byStatus,
    lastUpdated: bucket.updatedAt,
    version: VERSION,
  };

  return new Response(JSON.stringify(analytics, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleErrors(
  kv: KVNamespace,
  query: URLSearchParams
): Promise<Response> {
  const limit = parseInt(query.get('limit') || '20', 10);
  const errors = await getRecentErrors(kv, Math.min(limit, MAX_ERRORS));

  return new Response(JSON.stringify({
    count: errors.length,
    errors,
    version: VERSION,
  }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleCircuitReset(kv: KVNamespace): Promise<Response> {
  await updateCircuitState(kv, {
    state: 'closed',
    failures: 0,
    lastFailure: null,
    lastSuccess: new Date().toISOString(),
    openedAt: null,
    testRequests: 0,
  });

  return new Response(JSON.stringify({
    message: 'Circuit breaker reset',
    timestamp: new Date().toISOString(),
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

// =============================================================================
// Main Handler
// =============================================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;
    const kv = env.WIKI_ANALYTICS;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ==========================================================================
    // Monitoring Endpoints
    // ==========================================================================

    if (path === '/_health') {
      return handleHealth(kv);
    }

    if (path === '/_analytics') {
      return handleAnalytics(kv);
    }

    if (path === '/_errors') {
      return handleErrors(kv, url.searchParams);
    }

    if (path === '/_circuit/reset' && request.method === 'POST') {
      return handleCircuitReset(kv);
    }

    // ==========================================================================
    // Main Request Handling
    // ==========================================================================

    const cache = (caches as unknown as { default: Cache }).default;
    let cacheHit = false;
    let response: Response;

    try {
      // Check circuit breaker
      const allowed = await shouldAllowRequest(kv);

      if (!allowed) {
        // Circuit is open - try to serve from cache
        const { response: cached } = await getCachedResponse(cache, request);
        if (cached) {
          cacheHit = true;
          response = new Response(cached.body, {
            status: cached.status,
            statusText: cached.statusText,
            headers: cached.headers,
          });
          response.headers.set('X-Cache', 'HIT-CIRCUIT-OPEN');
        } else {
          // No cache available, return service unavailable
          response = new Response(
            JSON.stringify({
              error: 'Service temporarily unavailable',
              message: 'Circuit breaker is open due to high error rate',
              retryAfter: Math.ceil(RECOVERY_TIMEOUT_MS / 1000),
            }),
            {
              status: 503,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(Math.ceil(RECOVERY_TIMEOUT_MS / 1000)),
                ...corsHeaders,
              },
            }
          );
        }
      } else {
        // Check cache first (for GET requests)
        if (request.method === 'GET') {
          const { response: cached, stale } = await getCachedResponse(cache, request);

          if (cached && !stale) {
            // Fresh cache hit
            cacheHit = true;
            response = new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers: cached.headers,
            });
            response.headers.set('X-Cache', 'HIT');
          } else if (cached && stale) {
            // Stale cache hit - serve stale and revalidate in background
            cacheHit = true;
            response = new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers: cached.headers,
            });
            response.headers.set('X-Cache', 'STALE');

            // Revalidate in background
            ctx.waitUntil(
              proxyToWorker(request, kv)
                .then((freshResponse) => {
                  if (freshResponse.ok) {
                    return cacheResponse(cache, request, freshResponse, ctx);
                  }
                })
                .catch(() => {
                  // Ignore revalidation errors
                })
            );
          } else {
            // Cache miss - fetch from worker
            response = await proxyToWorker(request, kv);
            response.headers.set('X-Cache', 'MISS');

            // Cache the response
            await cacheResponse(cache, request, response, ctx);
          }
        } else {
          // Non-GET request - proxy directly
          response = await proxyToWorker(request, kv);
          response.headers.set('X-Cache', 'BYPASS');
        }
      }
    } catch (error) {
      // Error during request handling
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Try to serve from cache on error
      const { response: cached } = await getCachedResponse(cache, request);
      if (cached) {
        cacheHit = true;
        response = new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: cached.headers,
        });
        response.headers.set('X-Cache', 'HIT-ERROR-FALLBACK');
      } else {
        response = new Response(
          JSON.stringify({ error: 'Internal error', message: errorMessage }),
          {
            status: 500,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );
      }

      // Log the error
      await logError(kv, {
        timestamp: new Date().toISOString(),
        url: url.pathname + url.search,
        method: request.method,
        error: errorMessage,
        status: 500,
        userAgent: request.headers.get('User-Agent'),
        country: request.headers.get('CF-IPCountry'),
        colo: request.headers.get('CF-Ray')?.split('-')[1] ?? null,
        latencyMs: Date.now() - startTime,
      });

      // Record failure for circuit breaker
      await recordFailure(kv);
    }

    // ==========================================================================
    // Response Processing
    // ==========================================================================

    const latencyMs = Date.now() - startTime;

    // Add observability headers
    const finalHeaders = new Headers(response.headers);
    finalHeaders.set('X-Latency-Ms', String(latencyMs));
    finalHeaders.set('X-Served-By', 'wiki-analytics');
    finalHeaders.set('X-Version', VERSION);

    // Add CORS headers
    for (const [key, value] of Object.entries(corsHeaders)) {
      finalHeaders.set(key, value);
    }

    const finalResponse = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: finalHeaders,
    });

    // Record analytics (fire and forget)
    ctx.waitUntil(
      recordRequest(kv, path, latencyMs, response.status, cacheHit).catch(() => {})
    );

    // Log errors to KV
    if (response.status >= 400 && response.status !== 404) {
      ctx.waitUntil(
        logError(kv, {
          timestamp: new Date().toISOString(),
          url: url.pathname + url.search,
          method: request.method,
          error: `HTTP ${response.status}`,
          status: response.status,
          userAgent: request.headers.get('User-Agent'),
          country: request.headers.get('CF-IPCountry'),
          colo: request.headers.get('CF-Ray')?.split('-')[1] ?? null,
          latencyMs,
        }).catch(() => {})
      );
    }

    // Periodically rollup analytics (every 100 requests)
    if (Math.random() < 0.01) {
      ctx.waitUntil(rollupAnalytics(kv).catch(() => {}));
    }

    return finalResponse;
  },
};
