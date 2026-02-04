/**
 * Tests for API Authentication Module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractApiKey,
  validateApiKey,
  checkRateLimit,
  clearRateLimits,
  getRateLimitEntry,
  withAuth,
  createAuthMiddleware,
  type RateLimitConfig,
  type AuthConfig,
} from '../../src/workers/api/auth.js';
import type { RequestContext, Env, Handler } from '../../src/workers/api/types.js';

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('API Key Extraction', () => {
  describe('extractApiKey', () => {
    it('should extract API key from X-API-Key header', () => {
      const request = new Request('https://example.com/api/test', {
        headers: { 'X-API-Key': 'test-api-key-123' },
      });
      const query = new URLSearchParams();

      expect(extractApiKey(request, query)).toBe('test-api-key-123');
    });

    it('should extract API key from query parameter', () => {
      const request = new Request('https://example.com/api/test');
      const query = new URLSearchParams('api_key=query-key-456');

      expect(extractApiKey(request, query)).toBe('query-key-456');
    });

    it('should prefer header over query parameter', () => {
      const request = new Request('https://example.com/api/test', {
        headers: { 'X-API-Key': 'header-key' },
      });
      const query = new URLSearchParams('api_key=query-key');

      expect(extractApiKey(request, query)).toBe('header-key');
    });

    it('should return null when no API key provided', () => {
      const request = new Request('https://example.com/api/test');
      const query = new URLSearchParams();

      expect(extractApiKey(request, query)).toBeNull();
    });

    it('should handle empty header value', () => {
      const request = new Request('https://example.com/api/test', {
        headers: { 'X-API-Key': '' },
      });
      const query = new URLSearchParams('api_key=fallback-key');

      // Empty header should fall through to query param
      expect(extractApiKey(request, query)).toBe('fallback-key');
    });
  });
});

describe('API Key Validation', () => {
  describe('validateApiKey', () => {
    it('should validate a valid API key', () => {
      const env = {
        API_KEYS: 'key1,key2,key3',
      } as unknown as Env;

      expect(validateApiKey('key1', env)).toBe(true);
      expect(validateApiKey('key2', env)).toBe(true);
      expect(validateApiKey('key3', env)).toBe(true);
    });

    it('should reject an invalid API key', () => {
      const env = {
        API_KEYS: 'key1,key2,key3',
      } as unknown as Env;

      expect(validateApiKey('invalid-key', env)).toBe(false);
      expect(validateApiKey('key4', env)).toBe(false);
    });

    it('should reject when API_KEYS is not configured', () => {
      const env = {} as Env;

      expect(validateApiKey('any-key', env)).toBe(false);
    });

    it('should handle whitespace in API_KEYS', () => {
      const env = {
        API_KEYS: ' key1 , key2 , key3 ',
      } as unknown as Env;

      expect(validateApiKey('key1', env)).toBe(true);
      expect(validateApiKey('key2', env)).toBe(true);
      expect(validateApiKey('key3', env)).toBe(true);
    });

    it('should handle single API key', () => {
      const env = {
        API_KEYS: 'single-key',
      } as unknown as Env;

      expect(validateApiKey('single-key', env)).toBe(true);
      expect(validateApiKey('other-key', env)).toBe(false);
    });
  });
});

describe('Rate Limiting', () => {
  beforeEach(() => {
    clearRateLimits();
  });

  afterEach(() => {
    clearRateLimits();
  });

  describe('checkRateLimit', () => {
    it('should allow requests within limit', () => {
      const config: RateLimitConfig = { maxRequests: 5, windowSeconds: 60 };

      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit('test-key', config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }
    });

    it('should block requests exceeding limit', () => {
      const config: RateLimitConfig = { maxRequests: 3, windowSeconds: 60 };

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        checkRateLimit('test-key', config);
      }

      // Next request should be blocked
      const result = checkRateLimit('test-key', config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should track different API keys separately', () => {
      const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };

      // Use up limit for key1
      checkRateLimit('key1', config);
      checkRateLimit('key1', config);
      const blocked = checkRateLimit('key1', config);
      expect(blocked.allowed).toBe(false);

      // key2 should still have requests available
      const result = checkRateLimit('key2', config);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should reset after window expires', async () => {
      const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 0.1 }; // 100ms window

      // Use up the limit
      checkRateLimit('test-key', config);
      checkRateLimit('test-key', config);
      expect(checkRateLimit('test-key', config).allowed).toBe(false);

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be allowed again
      const result = checkRateLimit('test-key', config);
      expect(result.allowed).toBe(true);
    });

    it('should return correct reset time', () => {
      const config: RateLimitConfig = { maxRequests: 10, windowSeconds: 60 };
      const before = Date.now();
      const result = checkRateLimit('test-key', config);
      const after = Date.now();

      // Reset should be approximately 60 seconds from now
      const expectedReset = before + 60000;
      expect(result.resetAt).toBeGreaterThanOrEqual(expectedReset);
      expect(result.resetAt).toBeLessThanOrEqual(after + 60000);
    });
  });

  describe('clearRateLimits', () => {
    it('should clear all rate limit entries', () => {
      const config: RateLimitConfig = { maxRequests: 1, windowSeconds: 60 };

      checkRateLimit('key1', config);
      checkRateLimit('key2', config);

      expect(getRateLimitEntry('key1')).toBeDefined();
      expect(getRateLimitEntry('key2')).toBeDefined();

      clearRateLimits();

      expect(getRateLimitEntry('key1')).toBeUndefined();
      expect(getRateLimitEntry('key2')).toBeUndefined();
    });
  });
});

describe('Auth Middleware', () => {
  let mockEnv: Env;
  let mockCtx: ExecutionContext;

  beforeEach(() => {
    clearRateLimits();
    mockEnv = {
      API_KEYS: 'valid-key-1,valid-key-2',
    } as unknown as Env;
    mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;
  });

  afterEach(() => {
    clearRateLimits();
  });

  const createContext = (url: string, headers: Record<string, string> = {}): RequestContext => {
    const request = new Request(url, { headers });
    const urlObj = new URL(url);
    return {
      request,
      env: mockEnv,
      ctx: mockCtx,
      startTime: Date.now(),
      params: {},
      query: urlObj.searchParams,
    };
  };

  const successHandler: Handler = async () => {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  describe('withAuth', () => {
    it('should allow requests with valid API key in header', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/api/test', {
        'X-API-Key': 'valid-key-1',
      });

      const response = await handler(ctx);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    it('should allow requests with valid API key in query param', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/api/test?api_key=valid-key-2');

      const response = await handler(ctx);

      expect(response.status).toBe(200);
    });

    it('should reject requests without API key', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/api/test');

      const response = await handler(ctx);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('UNAUTHORIZED');
      expect(body.message).toContain('API key is required');
    });

    it('should reject requests with invalid API key', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/api/test', {
        'X-API-Key': 'invalid-key',
      });

      const response = await handler(ctx);

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('UNAUTHORIZED');
      expect(body.message).toContain('Invalid API key');
    });

    it('should bypass auth for health endpoint', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/health');

      const response = await handler(ctx);

      expect(response.status).toBe(200);
    });

    it('should bypass auth for root endpoint', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/');

      const response = await handler(ctx);

      expect(response.status).toBe(200);
    });

    it('should add rate limit headers to response', async () => {
      const handler = withAuth(successHandler);
      const ctx = createContext('https://example.com/api/test', {
        'X-API-Key': 'valid-key-1',
      });

      const response = await handler(ctx);

      expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined();
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('should enforce rate limits', async () => {
      const config: AuthConfig = {
        rateLimit: true,
        rateLimitConfig: { maxRequests: 2, windowSeconds: 60 },
        bypassPaths: [],
      };
      const handler = withAuth(successHandler, config);
      const ctx = createContext('https://example.com/api/test', {
        'X-API-Key': 'valid-key-1',
      });

      // First two requests should succeed
      const response1 = await handler(ctx);
      expect(response1.status).toBe(200);

      const response2 = await handler(ctx);
      expect(response2.status).toBe(200);

      // Third request should be rate limited
      const response3 = await handler(ctx);
      expect(response3.status).toBe(429);
      const body = await response3.json();
      expect(body.error).toBe('RATE_LIMITED');
    });

    it('should allow disabling rate limiting', async () => {
      const config: AuthConfig = {
        rateLimit: false,
        bypassPaths: [],
      };
      const handler = withAuth(successHandler, config);

      // Make many requests - all should succeed
      for (let i = 0; i < 10; i++) {
        const ctx = createContext('https://example.com/api/test', {
          'X-API-Key': 'valid-key-1',
        });
        const response = await handler(ctx);
        expect(response.status).toBe(200);
      }
    });

    it('should support custom bypass paths', async () => {
      const config: AuthConfig = {
        bypassPaths: ['/custom-public', '/another-public'],
      };
      const handler = withAuth(successHandler, config);

      const ctx1 = createContext('https://example.com/custom-public');
      const response1 = await handler(ctx1);
      expect(response1.status).toBe(200);

      const ctx2 = createContext('https://example.com/another-public');
      const response2 = await handler(ctx2);
      expect(response2.status).toBe(200);
    });

    it('should rate limit bypassed paths if API key is provided', async () => {
      const config: AuthConfig = {
        rateLimit: true,
        rateLimitConfig: { maxRequests: 1, windowSeconds: 60 },
        bypassPaths: ['/health'],
      };
      const handler = withAuth(successHandler, config);

      // First request with API key on bypass path
      const ctx1 = createContext('https://example.com/health', {
        'X-API-Key': 'valid-key-1',
      });
      const response1 = await handler(ctx1);
      expect(response1.status).toBe(200);

      // Second request should be rate limited
      const ctx2 = createContext('https://example.com/health', {
        'X-API-Key': 'valid-key-1',
      });
      const response2 = await handler(ctx2);
      expect(response2.status).toBe(429);
    });
  });

  describe('createAuthMiddleware', () => {
    it('should create a reusable middleware function', async () => {
      const middleware = createAuthMiddleware({
        bypassPaths: ['/public'],
      });

      const handler = middleware(successHandler);

      // Protected route without key should fail
      const ctx1 = createContext('https://example.com/api/protected');
      const response1 = await handler(ctx1);
      expect(response1.status).toBe(401);

      // Public route should succeed
      const ctx2 = createContext('https://example.com/public');
      const response2 = await handler(ctx2);
      expect(response2.status).toBe(200);
    });
  });
});

describe('Auth Integration', () => {
  beforeEach(() => {
    clearRateLimits();
  });

  afterEach(() => {
    clearRateLimits();
  });

  it('should work with missing API_KEYS environment variable', async () => {
    const mockEnv = {} as Env;
    const mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const handler = withAuth(async () => new Response('ok'));
    const request = new Request('https://example.com/api/test', {
      headers: { 'X-API-Key': 'any-key' },
    });

    const ctx: RequestContext = {
      request,
      env: mockEnv,
      ctx: mockCtx,
      startTime: Date.now(),
      params: {},
      query: new URLSearchParams(),
    };

    const response = await handler(ctx);
    expect(response.status).toBe(401);
  });

  it('should handle concurrent requests from different API keys', async () => {
    const mockEnv = {
      API_KEYS: 'key-a,key-b',
    } as unknown as Env;
    const mockCtx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const config: AuthConfig = {
      rateLimit: true,
      rateLimitConfig: { maxRequests: 2, windowSeconds: 60 },
      bypassPaths: [],
    };
    const handler = withAuth(async () => new Response('ok'), config);

    // Make requests from key-a
    for (let i = 0; i < 2; i++) {
      const ctx: RequestContext = {
        request: new Request('https://example.com/api/test', {
          headers: { 'X-API-Key': 'key-a' },
        }),
        env: mockEnv,
        ctx: mockCtx,
        startTime: Date.now(),
        params: {},
        query: new URLSearchParams(),
      };
      const response = await handler(ctx);
      expect(response.status).toBe(200);
    }

    // key-a should be rate limited
    const ctxLimited: RequestContext = {
      request: new Request('https://example.com/api/test', {
        headers: { 'X-API-Key': 'key-a' },
      }),
      env: mockEnv,
      ctx: mockCtx,
      startTime: Date.now(),
      params: {},
      query: new URLSearchParams(),
    };
    const limitedResponse = await handler(ctxLimited);
    expect(limitedResponse.status).toBe(429);

    // key-b should still work
    const ctxB: RequestContext = {
      request: new Request('https://example.com/api/test', {
        headers: { 'X-API-Key': 'key-b' },
      }),
      env: mockEnv,
      ctx: mockCtx,
      startTime: Date.now(),
      params: {},
      query: new URLSearchParams(),
    };
    const responseB = await handler(ctxB);
    expect(responseB.status).toBe(200);
  });
});
