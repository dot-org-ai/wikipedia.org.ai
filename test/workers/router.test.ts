/**
 * Router Unit Tests
 *
 * Tests for the internal router implementation:
 * - Route pattern matching
 * - Path parameter extraction
 * - Method-based routing
 * - Middleware composition
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing router
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

import { Router, createRouter } from '../../src/workers/api/router.js';
import type { RequestContext, Handler } from '../../src/workers/api/types.js';

// Helper to create mock RequestContext
function createMockContext(
  url: string,
  method: string = 'GET',
  options: Partial<{
    params: Record<string, string>;
    body: unknown;
    headers: Record<string, string>;
  }> = {}
): RequestContext {
  const urlObj = new URL(url, 'http://localhost');
  const headers = new Headers(options.headers || {});

  const request = new Request(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    request,
    env: {
      R2: {} as R2Bucket,
      AI: {} as Ai,
      AI_GATEWAY_URL: 'https://test.gateway.ai.cloudflare.com',
      ENVIRONMENT: 'staging',
    },
    ctx: {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext,
    startTime: Date.now(),
    params: options.params || {},
    query: urlObj.searchParams,
  };
}

// Helper to create mock handler
function createMockHandler(responseData: unknown, status: number = 200): Handler {
  return vi.fn(async () => {
    return new Response(JSON.stringify(responseData), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = createRouter({ cors: false, timing: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Basic Route Registration
  // ==========================================================================

  describe('Route Registration', () => {
    it('should register GET routes', () => {
      const handler = createMockHandler({ message: 'success' });
      router.get('/test', handler);

      // Router should be chainable
      expect(router.get('/test2', handler)).toBe(router);
    });

    it('should register POST routes', () => {
      const handler = createMockHandler({ message: 'created' }, 201);
      router.post('/test', handler);

      expect(router.post('/test2', handler)).toBe(router);
    });

    it('should register PUT routes', () => {
      const handler = createMockHandler({ message: 'updated' });
      router.put('/test', handler);

      expect(router.put('/test2', handler)).toBe(router);
    });

    it('should register DELETE routes', () => {
      const handler = createMockHandler({ message: 'deleted' });
      router.delete('/test', handler);

      expect(router.delete('/test2', handler)).toBe(router);
    });

    it('should register PATCH routes', () => {
      const handler = createMockHandler({ message: 'patched' });
      router.patch('/test', handler);

      expect(router.patch('/test2', handler)).toBe(router);
    });

    it('should register routes for all methods', () => {
      const handler = createMockHandler({ message: 'any method' });
      router.all('/test', handler);

      expect(router.all('/test2', handler)).toBe(router);
    });
  });

  // ==========================================================================
  // Route Matching
  // ==========================================================================

  describe('Route Matching', () => {
    it('should match exact paths', async () => {
      const handler = createMockHandler({ matched: true });
      router.get('/api/health', handler);

      const request = new Request('http://localhost/api/health', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/health').env,
        createMockContext('http://localhost/api/health').ctx
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ matched: true });
    });

    it('should not match partial paths', async () => {
      const handler = createMockHandler({ matched: true });
      router.get('/api/health', handler);

      const request = new Request('http://localhost/api/healthcheck', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/healthcheck').env,
        createMockContext('http://localhost/api/healthcheck').ctx
      );

      expect(response.status).toBe(404);
    });

    it('should match by HTTP method', async () => {
      const getHandler = createMockHandler({ method: 'GET' });
      const postHandler = createMockHandler({ method: 'POST' });

      router.get('/test', getHandler);
      router.post('/test', postHandler);

      // GET request
      const getRequest = new Request('http://localhost/test', { method: 'GET' });
      const getResponse = await router.handle(
        getRequest,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );
      expect((await getResponse.json() as { method: string }).method).toBe('GET');

      // POST request
      const postRequest = new Request('http://localhost/test', { method: 'POST' });
      const postResponse = await router.handle(
        postRequest,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );
      expect((await postResponse.json() as { method: string }).method).toBe('POST');
    });

    it('should return 404 for unmatched methods', async () => {
      const handler = createMockHandler({ matched: true });
      router.get('/test', handler);

      const request = new Request('http://localhost/test', { method: 'POST' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );

      expect(response.status).toBe(404);
    });

    it('should match all methods with all()', async () => {
      const handler = createMockHandler({ matched: true });
      router.all('/test', handler);

      const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of methods) {
        const request = new Request('http://localhost/test', { method });
        const response = await router.handle(
          request,
          createMockContext('http://localhost/test').env,
          createMockContext('http://localhost/test').ctx
        );
        expect(response.status).toBe(200);
      }
    });
  });

  // ==========================================================================
  // Path Parameters
  // ==========================================================================

  describe('Path Parameters', () => {
    it('should extract single path parameter', async () => {
      let capturedParams: Record<string, string> = {};

      const handler: Handler = async (ctx) => {
        capturedParams = ctx.params;
        return new Response(JSON.stringify({ id: ctx.params.id }), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/articles/:id', handler);

      const request = new Request('http://localhost/api/articles/wiki-123', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/articles/wiki-123').env,
        createMockContext('http://localhost/api/articles/wiki-123').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedParams.id).toBe('wiki-123');
    });

    it('should extract multiple path parameters', async () => {
      let capturedParams: Record<string, string> = {};

      const handler: Handler = async (ctx) => {
        capturedParams = ctx.params;
        return new Response(JSON.stringify(ctx.params), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/:resource/:id/relationships/:relType', handler);

      const request = new Request('http://localhost/api/articles/wiki-123/relationships/outgoing', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/articles/wiki-123/relationships/outgoing').env,
        createMockContext('http://localhost/api/articles/wiki-123/relationships/outgoing').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedParams.resource).toBe('articles');
      expect(capturedParams.id).toBe('wiki-123');
      expect(capturedParams.relType).toBe('outgoing');
    });

    it('should URL-decode path parameters', async () => {
      let capturedParams: Record<string, string> = {};

      const handler: Handler = async (ctx) => {
        capturedParams = ctx.params;
        return new Response(JSON.stringify(ctx.params), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/wiki/:title', handler);

      const request = new Request('http://localhost/api/wiki/Albert%20Einstein', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/wiki/Albert%20Einstein').env,
        createMockContext('http://localhost/api/wiki/Albert%20Einstein').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedParams.title).toBe('Albert Einstein');
    });

    it('should handle special characters in parameters', async () => {
      let capturedParams: Record<string, string> = {};

      const handler: Handler = async (ctx) => {
        capturedParams = ctx.params;
        return new Response(JSON.stringify(ctx.params), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/wiki/:title', handler);

      const request = new Request('http://localhost/api/wiki/Test%20(disambiguation)', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/wiki/Test%20(disambiguation)').env,
        createMockContext('http://localhost/api/wiki/Test%20(disambiguation)').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedParams.title).toBe('Test (disambiguation)');
    });
  });

  // ==========================================================================
  // Query Parameters
  // ==========================================================================

  describe('Query Parameters', () => {
    it('should parse query parameters', async () => {
      let capturedQuery: URLSearchParams | null = null;

      const handler: Handler = async (ctx) => {
        capturedQuery = ctx.query;
        return new Response(JSON.stringify({ limit: ctx.query.get('limit') }), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/articles', handler);

      const request = new Request('http://localhost/api/articles?limit=10&offset=20', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/articles?limit=10&offset=20').env,
        createMockContext('http://localhost/api/articles?limit=10&offset=20').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedQuery).toBeDefined();
      expect(capturedQuery?.get('limit')).toBe('10');
      expect(capturedQuery?.get('offset')).toBe('20');
    });

    it('should handle empty query string', async () => {
      let capturedQuery: URLSearchParams | null = null;

      const handler: Handler = async (ctx) => {
        capturedQuery = ctx.query;
        return new Response(JSON.stringify({}), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/articles', handler);

      const request = new Request('http://localhost/api/articles', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/articles').env,
        createMockContext('http://localhost/api/articles').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedQuery).toBeDefined();
      expect(capturedQuery?.get('limit')).toBeNull();
    });

    it('should handle array-like query parameters', async () => {
      let capturedQuery: URLSearchParams | null = null;

      const handler: Handler = async (ctx) => {
        capturedQuery = ctx.query;
        return new Response(JSON.stringify({}), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/api/search', handler);

      const request = new Request('http://localhost/api/search?types=person,place,org', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/search?types=person,place,org').env,
        createMockContext('http://localhost/api/search?types=person,place,org').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedQuery?.get('types')).toBe('person,place,org');
    });
  });

  // ==========================================================================
  // CORS Handling
  // ==========================================================================

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight with cors enabled', async () => {
      const corsRouter = createRouter({ cors: true, timing: false });
      corsRouter.get('/test', createMockHandler({ ok: true }));

      const request = new Request('http://localhost/test', { method: 'OPTIONS' });
      const response = await corsRouter.handle(
        request,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should add CORS headers to responses when enabled', async () => {
      const corsRouter = createRouter({ cors: true, timing: false });
      corsRouter.get('/test', createMockHandler({ ok: true }));

      const request = new Request('http://localhost/test', { method: 'GET' });
      const response = await corsRouter.handle(
        request,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should not add CORS headers when disabled', async () => {
      const noCorsRouter = createRouter({ cors: false, timing: false });
      noCorsRouter.get('/test', createMockHandler({ ok: true }));

      const request = new Request('http://localhost/test', { method: 'GET' });
      const response = await noCorsRouter.handle(
        request,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  // ==========================================================================
  // Timing Headers
  // ==========================================================================

  describe('Timing Headers', () => {
    it('should add timing headers when enabled', async () => {
      const timingRouter = createRouter({ cors: false, timing: true });
      timingRouter.get('/test', createMockHandler({ ok: true }));

      const request = new Request('http://localhost/test', { method: 'GET' });
      const response = await timingRouter.handle(
        request,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );

      expect(response.headers.get('X-Response-Time')).toBeDefined();
      expect(response.headers.get('Server-Timing')).toBeDefined();
    });

    it('should not add timing headers when disabled', async () => {
      const noTimingRouter = createRouter({ cors: false, timing: false });
      noTimingRouter.get('/test', createMockHandler({ ok: true }));

      const request = new Request('http://localhost/test', { method: 'GET' });
      const response = await noTimingRouter.handle(
        request,
        createMockContext('http://localhost/test').env,
        createMockContext('http://localhost/test').ctx
      );

      expect(response.headers.get('X-Response-Time')).toBeNull();
      expect(response.headers.get('Server-Timing')).toBeNull();
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should catch and handle handler errors', async () => {
      const errorHandler: Handler = async () => {
        throw new Error('Test error');
      };

      router.get('/error', errorHandler);

      const request = new Request('http://localhost/error', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/error').env,
        createMockContext('http://localhost/error').ctx
      );

      expect(response.status).toBe(500);
    });

    it('should handle "not found" errors with 404', async () => {
      const notFoundHandler: Handler = async () => {
        throw new Error('Article not found');
      };

      router.get('/article/:id', notFoundHandler);

      const request = new Request('http://localhost/article/xyz', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/article/xyz').env,
        createMockContext('http://localhost/article/xyz').ctx
      );

      expect(response.status).toBe(404);
    });

    it('should handle "invalid" errors with 400', async () => {
      const invalidHandler: Handler = async () => {
        throw new Error('Invalid parameter');
      };

      router.get('/validate', invalidHandler);

      const request = new Request('http://localhost/validate', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/validate').env,
        createMockContext('http://localhost/validate').ctx
      );

      expect(response.status).toBe(400);
    });
  });

  // ==========================================================================
  // Route Priority
  // ==========================================================================

  describe('Route Priority', () => {
    it('should match routes in registration order', async () => {
      const generalHandler = createMockHandler({ route: 'general' });
      const specificHandler = createMockHandler({ route: 'specific' });

      // Register specific route first
      router.get('/api/articles/near', specificHandler);
      router.get('/api/articles/:id', generalHandler);

      // Should match specific route
      const request = new Request('http://localhost/api/articles/near', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/articles/near').env,
        createMockContext('http://localhost/api/articles/near').ctx
      );

      const data = await response.json() as { route: string };
      expect(data.route).toBe('specific');
    });

    it('should fall back to parameter route for non-matching paths', async () => {
      const specificHandler = createMockHandler({ route: 'specific' });
      const generalHandler = createMockHandler({ route: 'general' });

      router.get('/api/articles/near', specificHandler);
      router.get('/api/articles/:id', generalHandler);

      const request = new Request('http://localhost/api/articles/wiki-123', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/api/articles/wiki-123').env,
        createMockContext('http://localhost/api/articles/wiki-123').ctx
      );

      const data = await response.json() as { route: string };
      expect(data.route).toBe('general');
    });
  });

  // ==========================================================================
  // Base Path
  // ==========================================================================

  describe('Base Path', () => {
    it('should prepend base path to routes', async () => {
      const apiRouter = createRouter({ basePath: '/api/v1', cors: false, timing: false });
      apiRouter.get('/users', createMockHandler({ users: [] }));

      const request = new Request('http://localhost/api/v1/users', { method: 'GET' });
      const response = await apiRouter.handle(
        request,
        createMockContext('http://localhost/api/v1/users').env,
        createMockContext('http://localhost/api/v1/users').ctx
      );

      expect(response.status).toBe(200);
    });

    it('should not match without base path', async () => {
      const apiRouter = createRouter({ basePath: '/api/v1', cors: false, timing: false });
      apiRouter.get('/users', createMockHandler({ users: [] }));

      const request = new Request('http://localhost/users', { method: 'GET' });
      const response = await apiRouter.handle(
        request,
        createMockContext('http://localhost/users').env,
        createMockContext('http://localhost/users').ctx
      );

      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // Path Pattern Compilation
  // ==========================================================================

  describe('Path Pattern Compilation', () => {
    it('should escape regex special characters in paths', async () => {
      router.get('/test.json', createMockHandler({ ok: true }));

      const request = new Request('http://localhost/test.json', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/test.json').env,
        createMockContext('http://localhost/test.json').ctx
      );

      expect(response.status).toBe(200);
    });

    it('should handle paths with special characters', async () => {
      let capturedParams: Record<string, string> = {};

      const handler: Handler = async (ctx) => {
        capturedParams = ctx.params;
        return new Response(JSON.stringify(ctx.params), {
          headers: { 'Content-Type': 'application/json' },
        });
      };

      router.get('/items/:id/price$', handler);

      // The $ should be escaped and treated as literal
      const request = new Request('http://localhost/items/123/price$', { method: 'GET' });
      const response = await router.handle(
        request,
        createMockContext('http://localhost/items/123/price$').env,
        createMockContext('http://localhost/items/123/price$').ctx
      );

      expect(response.status).toBe(200);
      expect(capturedParams.id).toBe('123');
    });
  });
});
