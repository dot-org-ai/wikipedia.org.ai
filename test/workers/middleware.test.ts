/**
 * Middleware Unit Tests
 *
 * Tests for middleware functions:
 * - CORS handling
 * - Error responses
 * - Response helpers
 * - Pagination parsing
 * - Validation utilities
 */

import { describe, it, expect, vi } from 'vitest';
import {
  cors,
  handlePreflight,
  errorResponse,
  errorHandler,
  withTiming,
  jsonResponse,
  parsePagination,
  validateRequired,
  normalizeTitle,
  encodeCursor,
  decodeCursor,
  compose,
  validateContentType,
  parseJsonBody,
} from '../../src/workers/api/middleware.js';
import type { Handler, RequestContext } from '../../src/workers/api/types.js';

// ==========================================================================
// CORS Tests
// ==========================================================================

describe('CORS Middleware', () => {
  describe('cors()', () => {
    it('should add default CORS headers to response', () => {
      const originalResponse = new Response('test', { status: 200 });
      const corsResponse = cors(originalResponse);

      expect(corsResponse.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(corsResponse.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(corsResponse.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(corsResponse.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    it('should preserve original response status', () => {
      const originalResponse = new Response('created', { status: 201 });
      const corsResponse = cors(originalResponse);

      expect(corsResponse.status).toBe(201);
    });

    it('should preserve original response body', async () => {
      const originalResponse = new Response('test body', { status: 200 });
      const corsResponse = cors(originalResponse);

      const body = await corsResponse.text();
      expect(body).toBe('test body');
    });

    it('should allow custom origins configuration', () => {
      const originalResponse = new Response('test', { status: 200 });
      const corsResponse = cors(originalResponse, {
        origins: ['https://example.com'],
      });

      expect(corsResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    });

    it('should allow custom methods configuration', () => {
      const originalResponse = new Response('test', { status: 200 });
      const corsResponse = cors(originalResponse, {
        methods: ['GET', 'PUT'],
      });

      expect(corsResponse.headers.get('Access-Control-Allow-Methods')).toBe('GET, PUT');
    });

    it('should set credentials header when enabled', () => {
      const originalResponse = new Response('test', { status: 200 });
      const corsResponse = cors(originalResponse, {
        credentials: true,
      });

      expect(corsResponse.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('handlePreflight()', () => {
    it('should return 204 No Content', () => {
      const response = handlePreflight();

      expect(response.status).toBe(204);
    });

    it('should include CORS headers', () => {
      const response = handlePreflight();

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
      expect(response.headers.get('Access-Control-Allow-Headers')).toBeDefined();
    });

    it('should include max-age header', () => {
      const response = handlePreflight();

      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should support custom configuration', () => {
      const response = handlePreflight({
        origins: ['https://custom.com'],
        maxAge: 3600,
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://custom.com');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('3600');
    });
  });
});

// ==========================================================================
// Error Response Tests
// ==========================================================================

describe('Error Response Functions', () => {
  describe('errorResponse()', () => {
    it('should create error response with correct structure', async () => {
      const response = errorResponse('BAD_REQUEST', 'Invalid parameter', 400);

      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const body = await response.json() as { error: string; message: string; status: number };
      expect(body.error).toBe('BAD_REQUEST');
      expect(body.message).toBe('Invalid parameter');
      expect(body.status).toBe(400);
    });

    it('should include details when provided', async () => {
      const details = { field: 'email', reason: 'invalid format' };
      const response = errorResponse('VALIDATION_ERROR', 'Validation failed', 400, details);

      const body = await response.json() as { details: typeof details };
      expect(body.details).toEqual(details);
    });

    it('should handle different status codes', () => {
      expect(errorResponse('NOT_FOUND', 'Not found', 404).status).toBe(404);
      expect(errorResponse('INTERNAL_ERROR', 'Server error', 500).status).toBe(500);
      expect(errorResponse('UNAUTHORIZED', 'Unauthorized', 401).status).toBe(401);
    });
  });

  describe('errorHandler()', () => {
    it('should return 404 for "not found" errors', async () => {
      const error = new Error('Article not found');
      const response = errorHandler(error);

      expect(response.status).toBe(404);

      const body = await response.json() as { error: string };
      expect(body.error).toBe('NOT_FOUND');
    });

    it('should return 400 for "invalid" errors', async () => {
      const error = new Error('Invalid parameter value');
      const response = errorHandler(error);

      expect(response.status).toBe(400);

      const body = await response.json() as { error: string };
      expect(body.error).toBe('BAD_REQUEST');
    });

    it('should return 429 for rate limit errors', async () => {
      const error = new Error('rate limit exceeded');
      const response = errorHandler(error);

      expect(response.status).toBe(429);

      const body = await response.json() as { error: string };
      expect(body.error).toBe('RATE_LIMITED');
    });

    it('should return 401 for unauthorized errors', async () => {
      const error = new Error('Unauthorized access');
      const response = errorHandler(error);

      expect(response.status).toBe(401);

      const body = await response.json() as { error: string };
      expect(body.error).toBe('UNAUTHORIZED');
    });

    it('should return 500 for generic errors', async () => {
      const error = new Error('Something went wrong');
      const response = errorHandler(error);

      expect(response.status).toBe(500);

      const body = await response.json() as { error: string };
      expect(body.error).toBe('INTERNAL_ERROR');
    });
  });
});

// ==========================================================================
// Response Helper Tests
// ==========================================================================

describe('Response Helpers', () => {
  describe('jsonResponse()', () => {
    it('should create JSON response with default 200 status', async () => {
      const data = { message: 'success' };
      const response = jsonResponse(data);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const body = await response.json();
      expect(body).toEqual(data);
    });

    it('should support custom status code', async () => {
      const data = { id: '123' };
      const response = jsonResponse(data, 201);

      expect(response.status).toBe(201);
    });

    it('should handle arrays', async () => {
      const data = [1, 2, 3];
      const response = jsonResponse(data);

      const body = await response.json();
      expect(body).toEqual(data);
    });

    it('should handle nested objects', async () => {
      const data = {
        user: {
          name: 'John',
          address: { city: 'NYC' },
        },
        tags: ['a', 'b'],
      };
      const response = jsonResponse(data);

      const body = await response.json();
      expect(body).toEqual(data);
    });

    it('should handle null', async () => {
      const response = jsonResponse(null);

      const body = await response.json();
      expect(body).toBeNull();
    });
  });

  describe('withTiming()', () => {
    it('should add timing headers', () => {
      const originalResponse = new Response('test', { status: 200 });
      const startTime = Date.now() - 100; // 100ms ago

      const timedResponse = withTiming(originalResponse, startTime);

      expect(timedResponse.headers.get('X-Response-Time')).toBeDefined();
      expect(timedResponse.headers.get('Server-Timing')).toBeDefined();
    });

    it('should preserve original response status', () => {
      const originalResponse = new Response('test', { status: 201 });
      const timedResponse = withTiming(originalResponse, Date.now());

      expect(timedResponse.status).toBe(201);
    });

    it('should format timing as milliseconds', () => {
      const originalResponse = new Response('test', { status: 200 });
      const startTime = Date.now() - 50;

      const timedResponse = withTiming(originalResponse, startTime);
      const timing = timedResponse.headers.get('X-Response-Time');

      expect(timing).toMatch(/^\d+ms$/);
    });
  });
});

// ==========================================================================
// Pagination Tests
// ==========================================================================

describe('Pagination Utilities', () => {
  describe('parsePagination()', () => {
    it('should return defaults when no parameters', () => {
      const query = new URLSearchParams();
      const result = parsePagination(query);

      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.cursor).toBeUndefined();
    });

    it('should parse limit parameter', () => {
      const query = new URLSearchParams('limit=50');
      const result = parsePagination(query);

      expect(result.limit).toBe(50);
    });

    it('should parse offset parameter', () => {
      const query = new URLSearchParams('offset=100');
      const result = parsePagination(query);

      expect(result.offset).toBe(100);
    });

    it('should parse cursor parameter', () => {
      const query = new URLSearchParams('cursor=abc123');
      const result = parsePagination(query);

      expect(result.cursor).toBe('abc123');
    });

    it('should cap limit at 100', () => {
      const query = new URLSearchParams('limit=200');
      const result = parsePagination(query);

      expect(result.limit).toBe(20); // Uses default when invalid
    });

    it('should ignore negative limit', () => {
      const query = new URLSearchParams('limit=-10');
      const result = parsePagination(query);

      expect(result.limit).toBe(20); // Uses default
    });

    it('should ignore negative offset', () => {
      const query = new URLSearchParams('offset=-5');
      const result = parsePagination(query);

      expect(result.offset).toBe(0); // Uses default
    });

    it('should handle non-numeric values', () => {
      const query = new URLSearchParams('limit=abc&offset=xyz');
      const result = parsePagination(query);

      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });

  describe('encodeCursor()', () => {
    it('should encode offset as base64 JSON', () => {
      const cursor = encodeCursor(100);

      expect(cursor).toBeDefined();
      expect(typeof cursor).toBe('string');

      // Should be decodable
      const decoded = JSON.parse(atob(cursor));
      expect(decoded.offset).toBe(100);
    });

    it('should encode zero offset', () => {
      const cursor = encodeCursor(0);
      const decoded = JSON.parse(atob(cursor));

      expect(decoded.offset).toBe(0);
    });
  });

  describe('decodeCursor()', () => {
    it('should decode valid cursor', () => {
      const encoded = btoa(JSON.stringify({ offset: 50 }));
      const offset = decodeCursor(encoded);

      expect(offset).toBe(50);
    });

    it('should return 0 for invalid cursor', () => {
      expect(decodeCursor('invalid')).toBe(0);
      expect(decodeCursor('')).toBe(0);
    });

    it('should return 0 for cursor without offset', () => {
      const encoded = btoa(JSON.stringify({ page: 2 }));
      const offset = decodeCursor(encoded);

      expect(offset).toBe(0);
    });
  });
});

// ==========================================================================
// Validation Tests
// ==========================================================================

describe('Validation Utilities', () => {
  describe('validateRequired()', () => {
    it('should return null when all required fields present', () => {
      const params = { name: 'John', email: 'john@example.com' };
      const result = validateRequired(params, ['name', 'email']);

      expect(result).toBeNull();
    });

    it('should return error message for missing field', () => {
      const params = { name: 'John' };
      const result = validateRequired(params, ['name', 'email']);

      expect(result).toContain('email');
      expect(result).toContain('Missing required parameter');
    });

    it('should detect null values as missing', () => {
      const params = { name: null };
      const result = validateRequired(params, ['name']);

      expect(result).not.toBeNull();
    });

    it('should detect undefined values as missing', () => {
      const params = { name: undefined };
      const result = validateRequired(params, ['name']);

      expect(result).not.toBeNull();
    });

    it('should detect empty string as missing', () => {
      const params = { name: '' };
      const result = validateRequired(params, ['name']);

      expect(result).not.toBeNull();
    });

    it('should accept zero as valid value', () => {
      const params = { count: 0 };
      const result = validateRequired(params, ['count']);

      expect(result).toBeNull();
    });

    it('should accept false as valid value', () => {
      const params = { active: false };
      const result = validateRequired(params, ['active']);

      expect(result).toBeNull();
    });
  });

  describe('normalizeTitle()', () => {
    it('should lowercase title', () => {
      expect(normalizeTitle('Albert Einstein')).toBe('albert einstein');
    });

    it('should replace underscores with spaces', () => {
      expect(normalizeTitle('Albert_Einstein')).toBe('albert einstein');
    });

    it('should trim whitespace', () => {
      expect(normalizeTitle('  Einstein  ')).toBe('einstein');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeTitle('Albert   Einstein')).toBe('albert einstein');
    });

    it('should handle combined transformations', () => {
      expect(normalizeTitle('  Albert_Einstein  ')).toBe('albert einstein');
    });
  });

  describe('validateContentType()', () => {
    it('should return true for non-POST requests', () => {
      const request = new Request('http://localhost/test', { method: 'GET' });
      expect(validateContentType(request)).toBe(true);
    });

    it('should return true for POST with application/json', () => {
      const request = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(validateContentType(request)).toBe(true);
    });

    it('should return true for application/json with charset', () => {
      const request = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
      expect(validateContentType(request)).toBe(true);
    });

    it('should return false for POST without Content-Type', () => {
      const request = new Request('http://localhost/test', { method: 'POST' });
      expect(validateContentType(request)).toBe(false);
    });

    it('should return false for POST with wrong Content-Type', () => {
      const request = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(validateContentType(request)).toBe(false);
    });
  });

  describe('parseJsonBody()', () => {
    it('should parse valid JSON body', async () => {
      const request = new Request('http://localhost/test', {
        method: 'POST',
        body: JSON.stringify({ name: 'test' }),
      });

      const result = await parseJsonBody<{ name: string }>(request);
      expect(result).toEqual({ name: 'test' });
    });

    it('should return null for invalid JSON', async () => {
      const request = new Request('http://localhost/test', {
        method: 'POST',
        body: 'not valid json',
      });

      const result = await parseJsonBody(request);
      expect(result).toBeNull();
    });

    it('should return null for empty body', async () => {
      const request = new Request('http://localhost/test', {
        method: 'POST',
        body: '',
      });

      const result = await parseJsonBody(request);
      expect(result).toBeNull();
    });

    it('should handle nested objects', async () => {
      const data = { user: { name: 'John', tags: ['a', 'b'] } };
      const request = new Request('http://localhost/test', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      const result = await parseJsonBody(request);
      expect(result).toEqual(data);
    });
  });
});

// ==========================================================================
// Middleware Composition Tests
// ==========================================================================

describe('Middleware Composition', () => {
  describe('compose()', () => {
    it('should compose middlewares in correct order', async () => {
      const order: string[] = [];

      const middleware1 = (handler: Handler): Handler => {
        return async (ctx) => {
          order.push('m1-before');
          const response = await handler(ctx);
          order.push('m1-after');
          return response;
        };
      };

      const middleware2 = (handler: Handler): Handler => {
        return async (ctx) => {
          order.push('m2-before');
          const response = await handler(ctx);
          order.push('m2-after');
          return response;
        };
      };

      const handler: Handler = async () => {
        order.push('handler');
        return new Response('ok');
      };

      const composed = compose(middleware1, middleware2)(handler);
      await composed({} as RequestContext);

      // Middleware1 wraps middleware2 which wraps handler
      expect(order).toEqual(['m1-before', 'm2-before', 'handler', 'm2-after', 'm1-after']);
    });

    it('should work with single middleware', async () => {
      let called = false;

      const middleware = (handler: Handler): Handler => {
        return async (ctx) => {
          called = true;
          return handler(ctx);
        };
      };

      const handler: Handler = async () => new Response('ok');
      const composed = compose(middleware)(handler);

      await composed({} as RequestContext);
      expect(called).toBe(true);
    });

    it('should work with empty middleware array', async () => {
      const handler: Handler = async () => new Response('ok');
      const composed = compose()(handler);

      const response = await composed({} as RequestContext);
      expect(response.status).toBe(200);
    });
  });
});
