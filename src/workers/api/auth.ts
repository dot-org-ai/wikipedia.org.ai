/**
 * Authentication module for the Wikipedia API
 *
 * Provides API key validation and rate limiting for protected routes.
 *
 * API keys can be provided via:
 * - X-API-Key header
 * - ?api_key query parameter
 *
 * Rate limiting is tracked per API key using an in-memory store.
 * In production, consider using Cloudflare KV or Durable Objects for
 * distributed rate limiting.
 */

import type { Handler, RequestContext, Env } from './types.js';
import { errorResponse } from './middleware.js';
import { createLogger } from '../../lib/logger.js';

/** Module-level logger */
const getLog = () => createLogger('api:auth');

/** Rate limit configuration per API key */
export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
}

/** Default rate limit: 1000 requests per minute */
const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 1000,
  windowSeconds: 60,
};

/** Rate limit entry for tracking request counts */
interface RateLimitEntry {
  count: number;
  windowStart: number;
}

/** In-memory rate limit store (per-isolate) */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Extract API key from request
 * Checks X-API-Key header first, then ?api_key query parameter
 */
export function extractApiKey(request: Request, query: URLSearchParams): string | null {
  // Check header first (preferred method)
  const headerKey = request.headers.get('X-API-Key');
  if (headerKey) {
    return headerKey;
  }

  // Fall back to query parameter
  const queryKey = query.get('api_key');
  if (queryKey) {
    return queryKey;
  }

  return null;
}

/**
 * Validate an API key against the configured keys
 *
 * API_KEYS is expected to be a comma-separated list of valid API keys
 * stored as a Cloudflare Workers secret/environment variable.
 */
export function validateApiKey(apiKey: string, env: Env): boolean {
  const apiKeys = env.API_KEYS;

  if (!apiKeys) {
    getLog().warn('API_KEYS not configured, rejecting all requests', {}, 'validateApiKey');
    return false;
  }

  // Parse comma-separated list of valid keys
  const validKeys = apiKeys.split(',').map((key) => key.trim());

  return validKeys.includes(apiKey);
}

/**
 * Check rate limit for an API key
 *
 * Returns true if the request should be allowed, false if rate limited.
 * Also returns the remaining requests and reset time for headers.
 */
export function checkRateLimit(
  apiKey: string,
  config: RateLimitConfig = DEFAULT_RATE_LIMIT
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  let entry = rateLimitStore.get(apiKey);

  // Check if we need to start a new window
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = {
      count: 1,
      windowStart: now,
    };
    rateLimitStore.set(apiKey, entry);

    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + windowMs,
    };
  }

  // Increment count within current window
  entry.count++;
  const resetAt = entry.windowStart + windowMs;

  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
    };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt,
  };
}

/**
 * Clear rate limit entries for testing or maintenance
 */
export function clearRateLimits(): void {
  rateLimitStore.clear();
}

/**
 * Get rate limit entry for an API key (for testing)
 */
export function getRateLimitEntry(apiKey: string): RateLimitEntry | undefined {
  return rateLimitStore.get(apiKey);
}

/** Auth configuration */
export interface AuthConfig {
  /** Enable rate limiting (default: true) */
  rateLimit?: boolean;
  /** Rate limit configuration */
  rateLimitConfig?: RateLimitConfig;
  /** Paths to bypass authentication (default: ['/health']) */
  bypassPaths?: string[];
}

/** Default auth configuration */
const DEFAULT_AUTH_CONFIG: Required<AuthConfig> = {
  rateLimit: true,
  rateLimitConfig: DEFAULT_RATE_LIMIT,
  bypassPaths: ['/health', '/'],
};

/**
 * Authentication middleware
 *
 * Validates API keys and optionally enforces rate limits.
 * Returns 401 Unauthorized for missing/invalid API keys.
 * Returns 429 Too Many Requests for rate-limited requests.
 */
export function withAuth(handler: Handler, config: AuthConfig = {}): Handler {
  const authConfig = { ...DEFAULT_AUTH_CONFIG, ...config };

  return async (ctx: RequestContext): Promise<Response> => {
    const url = new URL(ctx.request.url);
    const pathname = url.pathname;

    // Check if path should bypass auth
    if (authConfig.bypassPaths.some((path) => pathname === path || pathname.startsWith(path + '/'))) {
      // Still check for API key if provided (for rate limiting), but don't require it
      const apiKey = extractApiKey(ctx.request, ctx.query);
      if (apiKey && authConfig.rateLimit) {
        const { allowed, remaining, resetAt } = checkRateLimit(apiKey, authConfig.rateLimitConfig);
        if (!allowed) {
          return createRateLimitResponse(remaining, resetAt);
        }
      }
      return handler(ctx);
    }

    // Extract API key
    const apiKey = extractApiKey(ctx.request, ctx.query);

    if (!apiKey) {
      getLog().debug('Missing API key', { path: pathname }, 'withAuth');
      return errorResponse(
        'UNAUTHORIZED',
        'API key is required. Provide via X-API-Key header or api_key query parameter.',
        401
      );
    }

    // Validate API key
    if (!validateApiKey(apiKey, ctx.env)) {
      getLog().warn('Invalid API key attempt', { path: pathname }, 'withAuth');
      return errorResponse('UNAUTHORIZED', 'Invalid API key.', 401);
    }

    // Check rate limit
    if (authConfig.rateLimit) {
      const { allowed, remaining, resetAt } = checkRateLimit(apiKey, authConfig.rateLimitConfig);

      if (!allowed) {
        getLog().warn('Rate limit exceeded', { apiKey: apiKey.slice(0, 8) + '...' }, 'withAuth');
        return createRateLimitResponse(remaining, resetAt);
      }

      // Execute handler and add rate limit headers to response
      const response = await handler(ctx);
      return addRateLimitHeaders(response, remaining, resetAt);
    }

    return handler(ctx);
  };
}

/**
 * Create a rate limit exceeded response
 */
function createRateLimitResponse(remaining: number, resetAt: number): Response {
  const response = errorResponse(
    'RATE_LIMITED',
    'Rate limit exceeded. Please try again later.',
    429
  );

  return addRateLimitHeaders(response, remaining, resetAt);
}

/**
 * Add rate limit headers to a response
 */
function addRateLimitHeaders(response: Response, remaining: number, resetAt: number): Response {
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Remaining', remaining.toString());
  headers.set('X-RateLimit-Reset', Math.ceil(resetAt / 1000).toString());

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Create auth middleware with custom configuration
 */
export function createAuthMiddleware(config: AuthConfig = {}): (handler: Handler) => Handler {
  return (handler: Handler) => withAuth(handler, config);
}
