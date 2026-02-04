/**
 * Rate Limiting Tests
 *
 * Tests for sliding window rate limiting implementation:
 * - Request tracking per IP
 * - Rate limit enforcement
 * - Rate limit headers
 * - Client IP detection
 * - Cleanup of expired entries
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  rateLimit,
  getRateLimitInfo,
  getClientIP,
  resetRateLimit,
  clearAllRateLimits,
  withRateLimit,
  type RateLimitConfig,
} from '../../src/workers/api/middleware.js';
import type { Handler, RequestContext } from '../../src/workers/api/types.js';

// ==========================================================================
// Test Helpers
// ==========================================================================

function createRequest(ip: string, url = 'https://api.example.com/test'): Request {
  return new Request(url, {
    headers: {
      'CF-Connecting-IP': ip,
    },
  });
}

function createRequestContext(request: Request): RequestContext {
  return {
    request,
    env: {} as RequestContext['env'],
    ctx: {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
    startTime: Date.now(),
    params: {},
    query: new URL(request.url).searchParams,
  };
}

// ==========================================================================
// Client IP Detection Tests
// ==========================================================================

describe('getClientIP', () => {
  it('should use CF-Connecting-IP header when present', () => {
    const request = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '192.168.1.100' },
    });
    expect(getClientIP(request)).toBe('192.168.1.100');
  });

  it('should fall back to X-Forwarded-For when CF header missing', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Forwarded-For': '10.0.0.1, 10.0.0.2' },
    });
    expect(getClientIP(request)).toBe('10.0.0.1');
  });

  it('should use X-Real-IP as last resort', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Real-IP': '172.16.0.1' },
    });
    expect(getClientIP(request)).toBe('172.16.0.1');
  });

  it('should prioritize CF-Connecting-IP over other headers', () => {
    const request = new Request('https://example.com', {
      headers: {
        'CF-Connecting-IP': '192.168.1.1',
        'X-Forwarded-For': '10.0.0.1',
        'X-Real-IP': '172.16.0.1',
      },
    });
    expect(getClientIP(request)).toBe('192.168.1.1');
  });

  it('should return "unknown" when no IP headers present', () => {
    const request = new Request('https://example.com');
    expect(getClientIP(request)).toBe('unknown');
  });

  it('should handle empty X-Forwarded-For header', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Forwarded-For': '' },
    });
    expect(getClientIP(request)).toBe('unknown');
  });

  it('should trim whitespace from X-Forwarded-For', () => {
    const request = new Request('https://example.com', {
      headers: { 'X-Forwarded-For': '  192.168.1.1  , 10.0.0.1' },
    });
    expect(getClientIP(request)).toBe('192.168.1.1');
  });
});

// ==========================================================================
// Rate Limit Function Tests
// ==========================================================================

describe('rateLimit', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should allow requests under the limit', () => {
    const config: RateLimitConfig = { maxRequests: 5, windowSeconds: 60 };
    const request = createRequest('192.168.1.1');

    // Make 5 requests - all should be allowed
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(request, config)).toBe(false);
    }
  });

  it('should block requests over the limit', () => {
    const config: RateLimitConfig = { maxRequests: 3, windowSeconds: 60 };
    const request = createRequest('192.168.1.2');

    // Make 3 requests - all allowed
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);

    // 4th request should be blocked
    expect(rateLimit(request, config)).toBe(true);
  });

  it('should track different IPs separately', () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const request1 = createRequest('192.168.1.10');
    const request2 = createRequest('192.168.1.20');

    // Fill up limit for IP1
    expect(rateLimit(request1, config)).toBe(false);
    expect(rateLimit(request1, config)).toBe(false);
    expect(rateLimit(request1, config)).toBe(true); // Blocked

    // IP2 should still be allowed
    expect(rateLimit(request2, config)).toBe(false);
    expect(rateLimit(request2, config)).toBe(false);
    expect(rateLimit(request2, config)).toBe(true); // Now blocked
  });

  it('should use default config when not provided', () => {
    const request = createRequest('192.168.1.3');

    // Default is 100 requests per minute
    // Making one request should work
    expect(rateLimit(request)).toBe(false);
  });

  it('should reset rate limit after window expires', () => {
    vi.useFakeTimers();

    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 1 };
    const request = createRequest('192.168.1.4');

    // Fill up the limit
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(true); // Blocked

    // Advance time past the window
    vi.advanceTimersByTime(1500); // 1.5 seconds

    // Should be allowed again
    expect(rateLimit(request, config)).toBe(false);

    vi.useRealTimers();
  });

  it('should implement sliding window correctly', () => {
    vi.useFakeTimers();

    const config: RateLimitConfig = { maxRequests: 3, windowSeconds: 10 };
    const request = createRequest('192.168.1.5');

    // Make 2 requests at t=0
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);

    // Advance 6 seconds
    vi.advanceTimersByTime(6000);

    // Make 1 more request at t=6
    expect(rateLimit(request, config)).toBe(false);

    // Now at 3 requests, next should be blocked
    expect(rateLimit(request, config)).toBe(true);

    // Advance another 5 seconds (t=11)
    // First 2 requests should have expired
    vi.advanceTimersByTime(5000);

    // Should allow 2 more requests
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(true); // Now blocked again

    vi.useRealTimers();
  });
});

// ==========================================================================
// Rate Limit Info Tests
// ==========================================================================

describe('getRateLimitInfo', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it('should return full remaining for new IP', () => {
    const config: RateLimitConfig = { maxRequests: 100, windowSeconds: 60 };
    const request = createRequest('192.168.2.1');

    const info = getRateLimitInfo(request, config);

    expect(info.current).toBe(0);
    expect(info.remaining).toBe(100);
  });

  it('should track current request count', () => {
    const config: RateLimitConfig = { maxRequests: 10, windowSeconds: 60 };
    const request = createRequest('192.168.2.2');

    // Make 5 requests
    for (let i = 0; i < 5; i++) {
      rateLimit(request, config);
    }

    const info = getRateLimitInfo(request, config);

    expect(info.current).toBe(5);
    expect(info.remaining).toBe(5);
  });

  it('should return 0 remaining when limit exceeded', () => {
    const config: RateLimitConfig = { maxRequests: 3, windowSeconds: 60 };
    const request = createRequest('192.168.2.3');

    // Exceed limit
    for (let i = 0; i < 5; i++) {
      rateLimit(request, config);
    }

    const info = getRateLimitInfo(request, config);

    expect(info.current).toBe(3); // Only 3 counted (limit)
    expect(info.remaining).toBe(0);
  });

  it('should calculate reset time correctly', () => {
    vi.useFakeTimers();

    const config: RateLimitConfig = { maxRequests: 10, windowSeconds: 60 };
    const request = createRequest('192.168.2.4');

    rateLimit(request, config);

    const info = getRateLimitInfo(request, config);

    // Reset time should be approximately the full window (60000ms)
    expect(info.resetMs).toBeGreaterThan(59000);
    expect(info.resetMs).toBeLessThanOrEqual(60000);

    vi.useRealTimers();
  });
});

// ==========================================================================
// Reset Functions Tests
// ==========================================================================

describe('resetRateLimit', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it('should reset rate limit for specific IP', () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const request = createRequest('192.168.3.1');

    // Fill up limit
    rateLimit(request, config);
    rateLimit(request, config);
    expect(rateLimit(request, config)).toBe(true); // Blocked

    // Reset this IP
    resetRateLimit('192.168.3.1');

    // Should be allowed again
    expect(rateLimit(request, config)).toBe(false);
  });

  it('should not affect other IPs', () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const request1 = createRequest('192.168.3.10');
    const request2 = createRequest('192.168.3.20');

    // Fill up both
    rateLimit(request1, config);
    rateLimit(request1, config);
    rateLimit(request2, config);
    rateLimit(request2, config);

    // Reset only IP1
    resetRateLimit('192.168.3.10');

    // IP1 allowed, IP2 still blocked
    expect(rateLimit(request1, config)).toBe(false);
    expect(rateLimit(request2, config)).toBe(true);
  });
});

describe('clearAllRateLimits', () => {
  it('should clear all rate limits', () => {
    const config: RateLimitConfig = { maxRequests: 1, windowSeconds: 60 };

    // Create multiple IPs at limit
    for (let i = 1; i <= 5; i++) {
      const request = createRequest(`192.168.4.${i}`);
      rateLimit(request, config);
      expect(rateLimit(request, config)).toBe(true); // All blocked
    }

    // Clear all
    clearAllRateLimits();

    // All should be allowed again
    for (let i = 1; i <= 5; i++) {
      const request = createRequest(`192.168.4.${i}`);
      expect(rateLimit(request, config)).toBe(false);
    }
  });
});

// ==========================================================================
// withRateLimit Middleware Tests
// ==========================================================================

describe('withRateLimit middleware', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it('should allow requests under the limit', async () => {
    const config: RateLimitConfig = { maxRequests: 5, windowSeconds: 60 };
    const handler: Handler = async () => new Response('OK', { status: 200 });
    const wrappedHandler = withRateLimit(handler, config);

    const request = createRequest('192.168.5.1');
    const ctx = createRequestContext(request);

    const response = await wrappedHandler(ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('OK');
  });

  it('should return 429 when rate limit exceeded', async () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const handler: Handler = async () => new Response('OK', { status: 200 });
    const wrappedHandler = withRateLimit(handler, config);

    const request = createRequest('192.168.5.2');
    const ctx = createRequestContext(request);

    // First 2 requests OK
    await wrappedHandler(ctx);
    await wrappedHandler(ctx);

    // 3rd request should be rate limited
    const response = await wrappedHandler(ctx);

    expect(response.status).toBe(429);

    const body = await response.json() as { error: string; message: string };
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.message).toContain('Rate limit exceeded');
  });

  it('should add X-RateLimit headers to successful responses', async () => {
    const config: RateLimitConfig = { maxRequests: 10, windowSeconds: 60 };
    const handler: Handler = async () => new Response('OK', { status: 200 });
    const wrappedHandler = withRateLimit(handler, config);

    const request = createRequest('192.168.5.3');
    const ctx = createRequestContext(request);

    const response = await wrappedHandler(ctx);

    expect(response.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('9');
    expect(response.headers.get('X-RateLimit-Reset')).toBeDefined();
  });

  it('should add X-RateLimit headers to 429 responses', async () => {
    const config: RateLimitConfig = { maxRequests: 1, windowSeconds: 60 };
    const handler: Handler = async () => new Response('OK', { status: 200 });
    const wrappedHandler = withRateLimit(handler, config);

    const request = createRequest('192.168.5.4');
    const ctx = createRequestContext(request);

    // First request OK
    await wrappedHandler(ctx);

    // Second request rate limited
    const response = await wrappedHandler(ctx);

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('Retry-After')).toBeDefined();
  });

  it('should decrement remaining count with each request', async () => {
    const config: RateLimitConfig = { maxRequests: 5, windowSeconds: 60 };
    const handler: Handler = async () => new Response('OK', { status: 200 });
    const wrappedHandler = withRateLimit(handler, config);

    const request = createRequest('192.168.5.5');
    const ctx = createRequestContext(request);

    const response1 = await wrappedHandler(ctx);
    expect(response1.headers.get('X-RateLimit-Remaining')).toBe('4');

    const response2 = await wrappedHandler(ctx);
    expect(response2.headers.get('X-RateLimit-Remaining')).toBe('3');

    const response3 = await wrappedHandler(ctx);
    expect(response3.headers.get('X-RateLimit-Remaining')).toBe('2');
  });

  it('should preserve original response status and body', async () => {
    const config: RateLimitConfig = { maxRequests: 10, windowSeconds: 60 };
    const handler: Handler = async () =>
      new Response(JSON.stringify({ id: 123 }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    const wrappedHandler = withRateLimit(handler, config);

    const request = createRequest('192.168.5.6');
    const ctx = createRequestContext(request);

    const response = await wrappedHandler(ctx);

    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toBe('application/json');

    const body = await response.json() as { id: number };
    expect(body.id).toBe(123);
  });

  it('should handle different IPs independently', async () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const handler: Handler = async () => new Response('OK', { status: 200 });
    const wrappedHandler = withRateLimit(handler, config);

    const request1 = createRequest('192.168.5.10');
    const request2 = createRequest('192.168.5.20');
    const ctx1 = createRequestContext(request1);
    const ctx2 = createRequestContext(request2);

    // Exhaust IP1's limit
    await wrappedHandler(ctx1);
    await wrappedHandler(ctx1);
    const response1 = await wrappedHandler(ctx1);
    expect(response1.status).toBe(429);

    // IP2 should still work
    const response2 = await wrappedHandler(ctx2);
    expect(response2.status).toBe(200);
  });
});

// ==========================================================================
// Edge Cases and Error Handling
// ==========================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    clearAllRateLimits();
  });

  it('should handle very high request volumes', () => {
    const config: RateLimitConfig = { maxRequests: 1000, windowSeconds: 60 };
    const request = createRequest('192.168.6.1');

    // Make 1000 requests
    for (let i = 0; i < 1000; i++) {
      expect(rateLimit(request, config)).toBe(false);
    }

    // 1001st should be blocked
    expect(rateLimit(request, config)).toBe(true);
  });

  it('should handle zero maxRequests config', () => {
    const config: RateLimitConfig = { maxRequests: 0, windowSeconds: 60 };
    const request = createRequest('192.168.6.2');

    // First request should be blocked
    expect(rateLimit(request, config)).toBe(true);
  });

  it('should handle very short window', () => {
    vi.useFakeTimers();

    const config: RateLimitConfig = { maxRequests: 1, windowSeconds: 1 };
    const request = createRequest('192.168.6.3');

    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(true); // Blocked

    // Wait just over 1 second
    vi.advanceTimersByTime(1100);

    // Should be allowed again
    expect(rateLimit(request, config)).toBe(false);

    vi.useRealTimers();
  });

  it('should handle IPv6 addresses', () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const request = new Request('https://example.com', {
      headers: { 'CF-Connecting-IP': '2001:db8::1' },
    });

    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(true); // Blocked
  });

  it('should handle requests with no IP headers', () => {
    const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };
    const request = new Request('https://example.com');

    // All requests from "unknown" IP share the same bucket
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(false);
    expect(rateLimit(request, config)).toBe(true);
  });
});
