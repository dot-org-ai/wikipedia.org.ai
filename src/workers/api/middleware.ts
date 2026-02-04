/**
 * Middleware functions for the Wikipedia API
 *
 * Provides:
 * - CORS headers
 * - Error handling
 * - Response caching
 * - Rate limiting
 * - Request timing
 * - Request tracing with unique IDs
 * - Metrics collection
 */

import type { Handler, RequestContext, APIError } from './types.js';
import {
  createLogger,
  generateRequestId,
  withRequestContext,
  getRequestId,
  type RequestContext as LogRequestContext,
} from '../../lib/logger.js';
import {
  isTypedError,
  getStatusForKind,
  getErrorCodeForKind,
} from '../../lib/errors.js';
import { getMetrics, recordRequest } from '../../lib/metrics.js';
import {
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_WINDOW_SECONDS,
  DEFAULT_RESULTS_LIMIT,
  MAX_RESULTS_LIMIT,
} from '../../lib/constants.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('api:middleware');

/** Request ID header name */
export const REQUEST_ID_HEADER = 'X-Request-ID';

/** CORS configuration */
interface CORSConfig {
  origins?: string[];
  methods?: string[];
  headers?: string[];
  maxAge?: number;
  credentials?: boolean;
}

/** Default CORS configuration */
const DEFAULT_CORS: Required<CORSConfig> = {
  origins: ['*'],
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
  maxAge: 86400, // 24 hours
  credentials: false,
};

/**
 * Add CORS headers to a response
 */
export function cors(response: Response, config: CORSConfig = {}): Response {
  const corsConfig = { ...DEFAULT_CORS, ...config };

  const headers = new Headers(response.headers);

  // Origin
  const origin = corsConfig.origins.includes('*')
    ? '*'
    : corsConfig.origins.join(', ');
  headers.set('Access-Control-Allow-Origin', origin);

  // Methods
  headers.set('Access-Control-Allow-Methods', corsConfig.methods.join(', '));

  // Headers
  headers.set('Access-Control-Allow-Headers', corsConfig.headers.join(', '));

  // Max age
  headers.set('Access-Control-Max-Age', corsConfig.maxAge.toString());

  // Credentials
  if (corsConfig.credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle CORS preflight requests
 */
export function handlePreflight(config: CORSConfig = {}): Response {
  const corsConfig = { ...DEFAULT_CORS, ...config };

  const headers = new Headers();

  const origin = corsConfig.origins.includes('*')
    ? '*'
    : corsConfig.origins.join(', ');
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
  headers.set('Access-Control-Allow-Headers', corsConfig.headers.join(', '));
  headers.set('Access-Control-Max-Age', corsConfig.maxAge.toString());

  if (corsConfig.credentials) {
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}

/**
 * Create an error response
 */
export function errorResponse(
  error: string,
  message: string,
  status: number,
  details?: unknown
): Response {
  const body: APIError = {
    error,
    message,
    status,
    details,
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Error handler middleware
 * Converts errors to proper HTTP responses
 *
 * Handles typed errors (with `kind` property) first for precise error handling,
 * then falls back to string matching for backwards compatibility.
 */
export function errorHandler(error: Error): Response {
  getLog().error('API error', {
    error: error.message,
    stack: error.stack,
    kind: isTypedError(error) ? error.kind : undefined,
  }, 'errorHandler');

  // Handle typed errors first (preferred)
  if (isTypedError(error)) {
    const status = getStatusForKind(error.kind);
    const errorCode = getErrorCodeForKind(error.kind);
    return errorResponse(errorCode, error.message, status);
  }

  // Fallback: string matching for backwards compatibility
  if (error.message.includes('not found') || error.message.includes('Not found')) {
    return errorResponse('NOT_FOUND', error.message, 404);
  }

  if (error.message.includes('Invalid') || error.message.includes('invalid')) {
    return errorResponse('BAD_REQUEST', error.message, 400);
  }

  if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
    return errorResponse('RATE_LIMITED', error.message, 429);
  }

  if (error.message.includes('unauthorized') || error.message.includes('Unauthorized')) {
    return errorResponse('UNAUTHORIZED', error.message, 401);
  }

  // Generic server error
  return errorResponse(
    'INTERNAL_ERROR',
    'An internal error occurred',
    500,
    process.env.NODE_ENV === 'development' ? error.message : undefined
  );
}

/**
 * Wrap a handler with caching support
 */
export function withCache(handler: Handler, ttl: number): Handler {
  return async (ctx: RequestContext): Promise<Response> => {
    const cacheKey = new Request(ctx.request.url, {
      method: 'GET',
      headers: ctx.request.headers,
    });

    // Check cache first
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      // Add cache hit header
      const headers = new Headers(cachedResponse.headers);
      headers.set('X-Cache', 'HIT');
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        headers,
      });
    }

    // Execute handler
    const response = await handler(ctx);

    // Only cache successful responses
    if (response.status === 200) {
      const responseToCache = response.clone();

      // Add cache headers
      const headers = new Headers(responseToCache.headers);
      headers.set('Cache-Control', `public, max-age=${ttl}`);
      headers.set('X-Cache', 'MISS');

      const cacheable = new Response(responseToCache.body, {
        status: responseToCache.status,
        headers,
      });

      // Store in cache (don't await - fire and forget)
      ctx.ctx.waitUntil(cache.put(cacheKey, cacheable));
    }

    // Add cache miss header to original response
    const headers = new Headers(response.headers);
    headers.set('X-Cache', 'MISS');
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  };
}

/** Rate limit configuration */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/** Default rate limit configuration */
const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRequests: DEFAULT_RATE_LIMIT,
  windowSeconds: DEFAULT_RATE_WINDOW_SECONDS,
};

/** Rate limit entry for tracking requests */
interface RateLimitEntry {
  /** Timestamps of requests within the current window */
  timestamps: number[];
}

/** In-memory store for rate limiting (single instance) */
const rateLimitStore = new Map<string, RateLimitEntry>();

/** Interval for cleaning up expired entries (5 minutes) */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Last cleanup timestamp */
let lastCleanup = Date.now();

/**
 * Clean up expired rate limit entries
 */
function cleanupExpiredEntries(windowSeconds: number): void {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  for (const [key, entry] of rateLimitStore.entries()) {
    // Filter out timestamps outside the window
    entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs);

    // Remove entry if no timestamps remain
    if (entry.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Get client IP address from request headers
 * Uses Cloudflare's CF-Connecting-IP header, falling back to X-Forwarded-For
 */
export function getClientIP(request: Request): string {
  // Cloudflare's connecting IP header (most reliable)
  const cfIP = request.headers.get('CF-Connecting-IP');
  if (cfIP) return cfIP;

  // X-Forwarded-For header (first IP in the chain)
  const forwardedFor = request.headers.get('X-Forwarded-For');
  if (forwardedFor) {
    const firstIP = forwardedFor.split(',')[0]?.trim();
    if (firstIP) return firstIP;
  }

  // X-Real-IP header
  const realIP = request.headers.get('X-Real-IP');
  if (realIP) return realIP;

  // Fallback to unknown
  return 'unknown';
}

/**
 * Check rate limit using sliding window algorithm
 * Returns true if request should be rate limited (rejected)
 *
 * Uses in-memory Map for single-instance rate limiting.
 * For distributed rate limiting across multiple workers, use KV namespace.
 */
export function rateLimit(
  request: Request,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): boolean {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Periodic cleanup of expired entries
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    cleanupExpiredEntries(config.windowSeconds);
    lastCleanup = now;
  }

  // Get client IP for rate limiting key
  const clientIP = getClientIP(request);
  const key = `ratelimit:${clientIP}`;

  // Get or create entry for this IP
  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Filter out timestamps outside the sliding window
  entry.timestamps = entry.timestamps.filter(ts => now - ts < windowMs);

  // Check if rate limit exceeded
  if (entry.timestamps.length >= config.maxRequests) {
    return true; // Rate limited
  }

  // Record this request
  entry.timestamps.push(now);

  return false; // Not rate limited
}

/**
 * Get rate limit info for a request
 * Returns current count and remaining requests
 */
export function getRateLimitInfo(
  request: Request,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): { current: number; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  const clientIP = getClientIP(request);
  const key = `ratelimit:${clientIP}`;

  const entry = rateLimitStore.get(key);
  if (!entry) {
    return {
      current: 0,
      remaining: config.maxRequests,
      resetMs: windowMs,
    };
  }

  // Filter to current window
  const validTimestamps = entry.timestamps.filter(ts => now - ts < windowMs);
  const current = validTimestamps.length;
  const remaining = Math.max(0, config.maxRequests - current);

  // Calculate time until oldest request expires
  const oldestTimestamp = validTimestamps.length > 0 ? Math.min(...validTimestamps) : now;
  const resetMs = Math.max(0, windowMs - (now - oldestTimestamp));

  return { current, remaining, resetMs };
}

/**
 * Reset rate limit for a specific IP (useful for testing)
 */
export function resetRateLimit(ip: string): void {
  const key = `ratelimit:${ip}`;
  rateLimitStore.delete(key);
}

/**
 * Clear all rate limit entries (useful for testing)
 */
export function clearAllRateLimits(): void {
  rateLimitStore.clear();
}

/**
 * Rate limit middleware
 * Adds rate limit headers to responses and returns 429 when exceeded
 */
export function withRateLimit(
  handler: Handler,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT_CONFIG
): Handler {
  return async (ctx: RequestContext): Promise<Response> => {
    // Check if rate limited
    if (rateLimit(ctx.request, config)) {
      const info = getRateLimitInfo(ctx.request, config);
      const response = errorResponse(
        'RATE_LIMITED',
        `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${config.windowSeconds} seconds.`,
        429
      );

      // Add rate limit headers
      const headers = new Headers(response.headers);
      headers.set('X-RateLimit-Limit', config.maxRequests.toString());
      headers.set('X-RateLimit-Remaining', '0');
      headers.set('X-RateLimit-Reset', Math.ceil(info.resetMs / 1000).toString());
      headers.set('Retry-After', Math.ceil(info.resetMs / 1000).toString());

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    // Execute handler
    const response = await handler(ctx);

    // Add rate limit headers to successful responses
    const info = getRateLimitInfo(ctx.request, config);
    const headers = new Headers(response.headers);
    headers.set('X-RateLimit-Limit', config.maxRequests.toString());
    headers.set('X-RateLimit-Remaining', info.remaining.toString());
    headers.set('X-RateLimit-Reset', Math.ceil(info.resetMs / 1000).toString());

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Add timing headers to response
 */
export function withTiming(response: Response, startTime: number): Response {
  const duration = Date.now() - startTime;

  const headers = new Headers(response.headers);
  headers.set('X-Response-Time', `${duration}ms`);
  headers.set('Server-Timing', `total;dur=${duration}`);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create a JSON response with proper headers
 */
export function jsonResponse<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Parse and validate pagination parameters
 */
export function parsePagination(query: URLSearchParams): { limit: number; offset: number; cursor?: string } {
  const limitParam = query.get('limit');
  const offsetParam = query.get('offset');
  const cursor = query.get('cursor') ?? undefined;

  let limit = DEFAULT_RESULTS_LIMIT;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= MAX_RESULTS_LIMIT) {
      limit = parsed;
    }
  }

  let offset = 0;
  if (offsetParam) {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  }

  // Only include cursor if it's defined
  if (cursor !== undefined) {
    return { limit, offset, cursor };
  }
  return { limit, offset };
}

/**
 * Validate required parameters
 */
export function validateRequired(
  params: Record<string, unknown>,
  required: string[]
): string | null {
  for (const key of required) {
    if (params[key] === undefined || params[key] === null || params[key] === '') {
      return `Missing required parameter: ${key}`;
    }
  }
  return null;
}

/**
 * Normalize a title for lookup
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/_/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Create a cursor from offset
 */
export function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }));
}

/**
 * Decode a cursor to offset
 */
export function decodeCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(atob(cursor));
    return decoded.offset ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Compose multiple middleware functions
 */
export function compose(...middlewares: ((handler: Handler) => Handler)[]): (handler: Handler) => Handler {
  return (handler: Handler): Handler => {
    return middlewares.reduceRight((acc, middleware) => middleware(acc), handler);
  };
}

/**
 * Logging middleware with request tracing
 * Generates a unique request ID and includes it in all logs
 */
export function withLogging(handler: Handler): Handler {
  return async (ctx: RequestContext): Promise<Response> => {
    const { request, startTime } = ctx;
    const url = new URL(request.url);
    const metrics = getMetrics();

    // Get request ID from header or generate a new one
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? generateRequestId();
    const clientIP = getClientIP(request);

    // Track active requests
    metrics.activeRequests.inc({ path: url.pathname });

    const log = getLog();

    log.info('Request received', {
      method: request.method,
      path: url.pathname,
      query: url.search || undefined,
      clientIP,
      userAgent: request.headers.get('User-Agent') ?? undefined,
      requestId,
    }, 'withLogging');

    // Create request context for tracing
    const reqContext: LogRequestContext = {
      requestId,
      fields: {
        method: request.method,
        path: url.pathname,
        clientIP,
      },
    };

    try {
      // Execute handler with request context
      const response = await withRequestContext(reqContext, () => handler(ctx));

      const duration = Date.now() - startTime;
      const cacheHeader = response.headers.get('X-Cache');
      const cacheStatus: 'hit' | 'miss' | undefined =
        cacheHeader === 'HIT' ? 'hit' : cacheHeader === 'MISS' ? 'miss' : undefined;

      // Record metrics (only pass cacheStatus if defined)
      const metricsOptions: Parameters<typeof recordRequest>[1] = {
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: duration,
      };
      if (cacheStatus) {
        metricsOptions.cacheStatus = cacheStatus;
      }
      recordRequest(metrics, metricsOptions);

      log.info('Request completed', {
        status: response.status,
        durationMs: duration,
        requestId,
        cacheStatus: cacheHeader,
      }, 'withLogging');

      // Decrement active requests
      metrics.activeRequests.dec({ path: url.pathname });

      // Add request ID to response headers
      const headers = new Headers(response.headers);
      headers.set(REQUEST_ID_HEADER, requestId);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

      // Record error metrics
      recordRequest(metrics, {
        method: request.method,
        path: url.pathname,
        status: 500,
        durationMs: duration,
        error: errorType,
      });

      log.error('Request failed', {
        durationMs: duration,
        error: error instanceof Error ? error.message : String(error),
        errorType,
        stack: error instanceof Error ? error.stack : undefined,
        requestId,
      }, 'withLogging');

      // Decrement active requests
      metrics.activeRequests.dec({ path: url.pathname });

      throw error;
    }
  };
}

/**
 * Validate content type for POST requests
 */
export function validateContentType(request: Request): boolean {
  if (request.method !== 'POST') return true;

  const contentType = request.headers.get('Content-Type');
  return contentType?.includes('application/json') ?? false;
}

/**
 * Parse JSON body safely
 */
export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const text = await request.text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Request ID middleware
 * Adds request ID to all requests for tracing
 * This is a lighter alternative to withLogging when you don't need full logging
 */
export function withRequestId(handler: Handler): Handler {
  return async (ctx: RequestContext): Promise<Response> => {
    const { request } = ctx;

    // Get request ID from header or generate a new one
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? generateRequestId();

    // Create request context for tracing
    const reqContext: LogRequestContext = {
      requestId,
    };

    // Execute handler with request context
    const response = await withRequestContext(reqContext, () => handler(ctx));

    // Add request ID to response headers
    const headers = new Headers(response.headers);
    headers.set(REQUEST_ID_HEADER, requestId);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Metrics middleware
 * Records request metrics without full logging
 */
export function withMetrics(handler: Handler): Handler {
  return async (ctx: RequestContext): Promise<Response> => {
    const { request, startTime } = ctx;
    const url = new URL(request.url);
    const metrics = getMetrics();

    // Track active requests
    metrics.activeRequests.inc({ path: url.pathname });

    try {
      const response = await handler(ctx);
      const duration = Date.now() - startTime;
      const cacheHeader = response.headers.get('X-Cache');
      const cacheStatus: 'hit' | 'miss' | undefined =
        cacheHeader === 'HIT' ? 'hit' : cacheHeader === 'MISS' ? 'miss' : undefined;

      // Record metrics (only pass cacheStatus if defined)
      const metricsOptions: Parameters<typeof recordRequest>[1] = {
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: duration,
      };
      if (cacheStatus) {
        metricsOptions.cacheStatus = cacheStatus;
      }
      recordRequest(metrics, metricsOptions);

      // Decrement active requests
      metrics.activeRequests.dec({ path: url.pathname });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

      // Record error metrics
      recordRequest(metrics, {
        method: request.method,
        path: url.pathname,
        status: 500,
        durationMs: duration,
        error: errorType,
      });

      // Decrement active requests
      metrics.activeRequests.dec({ path: url.pathname });

      throw error;
    }
  };
}

/**
 * Get the current request ID from context
 * Returns undefined if not within a request context
 */
export function getCurrentRequestId(): string | undefined {
  return getRequestId();
}

// Re-export auth middleware for convenience
export { withAuth, createAuthMiddleware, type AuthConfig } from './auth.js';
