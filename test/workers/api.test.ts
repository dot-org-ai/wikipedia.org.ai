/**
 * API Handler Tests using Miniflare
 *
 * Tests for the Cloudflare Workers API endpoints:
 * - Request routing
 * - Response formats
 * - Error handling
 * - Edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Miniflare } from 'miniflare';

// Mock data for R2 bucket
const MOCK_MANIFEST = {
  version: '1.0.0',
  created_at: '2024-01-01T00:00:00Z',
  totalArticles: 100,
  articlesByType: {
    person: 30,
    place: 25,
    org: 15,
    work: 15,
    event: 10,
    other: 5,
  },
  dataFiles: [
    { path: 'data/person/part-0.parquet', size: 1024, rowCount: 30, rowGroups: 1, type: 'person', shard: 0 },
    { path: 'data/place/part-0.parquet', size: 1024, rowCount: 25, rowGroups: 1, type: 'place', shard: 0 },
    { path: 'data/org/part-0.parquet', size: 1024, rowCount: 15, rowGroups: 1, type: 'org', shard: 0 },
    { path: 'data/work/part-0.parquet', size: 1024, rowCount: 15, rowGroups: 1, type: 'work', shard: 0 },
    { path: 'data/event/part-0.parquet', size: 1024, rowCount: 10, rowGroups: 1, type: 'event', shard: 0 },
    { path: 'data/other/part-0.parquet', size: 1024, rowCount: 5, rowGroups: 1, type: 'other', shard: 0 },
  ],
  forwardRelFiles: [],
  reverseRelFiles: [],
  indexFiles: {
    titles: 'indexes/titles.json',
    types: 'indexes/types.json',
    ids: 'indexes/ids.json',
    bloomFilters: [],
  },
};

const MOCK_TITLE_INDEX = {
  'albert einstein': { file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
  'tokyo': { file: 'data/place/part-0.parquet', rowGroup: 0, row: 0 },
  'microsoft': { file: 'data/org/part-0.parquet', rowGroup: 0, row: 0 },
};

const MOCK_TYPE_INDEX = {
  person: ['data/person/part-0.parquet'],
  place: ['data/place/part-0.parquet'],
  org: ['data/org/part-0.parquet'],
  work: ['data/work/part-0.parquet'],
  event: ['data/event/part-0.parquet'],
  other: ['data/other/part-0.parquet'],
};

const MOCK_ID_INDEX = {
  version: '1.0.0',
  created_at: '2024-01-01T00:00:00Z',
  count: 3,
  entries: {
    'wiki-123': { type: 'person', file: 'data/person/part-0.parquet', rowGroup: 0, row: 0 },
    'wiki-456': { type: 'place', file: 'data/place/part-0.parquet', rowGroup: 0, row: 0 },
    'wiki-789': { type: 'org', file: 'data/org/part-0.parquet', rowGroup: 0, row: 0 },
  },
};

const MOCK_GEO_INDEX = {
  entries: [
    { articleId: 'wiki-456', lat: 35.6762, lng: 139.6503, title: 'Tokyo', type: 'place' },
    { articleId: 'wiki-457', lat: 40.7128, lng: -74.0060, title: 'New York City', type: 'place' },
  ],
};

// Simplified worker script for testing
const WORKER_SCRIPT = `
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // Helper to return JSON
    const json = (data, status = 200) => {
      const response = new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Response-Time': '10ms',
        },
      });
      return response;
    };

    // Helper to return error
    const error = (code, message, status) => {
      return json({ error: code, message, status }, status);
    };

    try {
      // Health check
      if (path === '/health') {
        return json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        });
      }

      // API info (root)
      if (path === '/') {
        return json({
          name: 'Wikipedia API',
          version: '1.0.0',
          description: 'REST API for Wikipedia data served from R2',
          endpoints: {
            health: 'GET /health',
            articles: {
              byId: 'GET /api/articles/:id',
              byTitle: 'GET /api/wiki/:title',
              list: 'GET /api/articles',
              query: 'POST /api/query',
              near: 'GET /api/articles/near?lat=X&lng=Y&radius=Z',
            },
            search: {
              vector: 'GET /api/search',
              text: 'GET /api/search/text',
            },
            relationships: {
              all: 'GET /api/relationships/:id',
              outgoing: 'GET /api/relationships/:id/outgoing',
              incoming: 'GET /api/relationships/:id/incoming',
            },
            types: {
              list: 'GET /api/types',
              stats: 'GET /api/types/:type',
            },
            geo: {
              stats: 'GET /api/geo/stats',
            },
          },
        });
      }

      // GET /api/articles/near - must come before :id pattern
      if (path === '/api/articles/near') {
        const lat = url.searchParams.get('lat');
        const lng = url.searchParams.get('lng');

        if (!lat || !lng) {
          return error('BAD_REQUEST', 'Missing required parameters: lat and lng', 400);
        }

        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);

        if (isNaN(latNum) || isNaN(lngNum)) {
          return error('BAD_REQUEST', 'Invalid coordinates: lat and lng must be numbers', 400);
        }

        if (latNum < -90 || latNum > 90) {
          return error('BAD_REQUEST', 'Invalid latitude: must be between -90 and 90', 400);
        }

        if (lngNum < -180 || lngNum > 180) {
          return error('BAD_REQUEST', 'Invalid longitude: must be between -180 and 180', 400);
        }

        const radius = parseFloat(url.searchParams.get('radius') || '10');
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);

        return json({
          query: { lat: latNum, lng: lngNum, radius, limit, types: 'all' },
          data: [
            { id: 'wiki-456', title: 'Tokyo', type: 'place', distance: 1000, distanceKm: 1 },
          ],
          count: 1,
        });
      }

      // GET /api/articles/:id
      const articlesMatch = path.match(/^\\/api\\/articles\\/([^/]+)$/);
      if (articlesMatch && method === 'GET') {
        const id = articlesMatch[1];

        // Simulate lookup
        const manifest = await env.R2.get('manifest.json');
        if (!manifest) {
          return error('INTERNAL_ERROR', 'Manifest not found', 500);
        }

        const idIndex = await env.R2.get('indexes/ids.json');
        if (idIndex) {
          const index = JSON.parse(await idIndex.text());
          if (index.entries && index.entries[id]) {
            return json({
              id,
              type: index.entries[id].type,
              title: id === 'wiki-123' ? 'Albert Einstein' : id === 'wiki-456' ? 'Tokyo' : 'Microsoft',
              description: 'A test article',
              wikidata_id: 'Q' + id.replace('wiki-', ''),
              coords: id === 'wiki-456' ? { lat: 35.6762, lon: 139.6503 } : null,
              infobox: null,
              content: 'Test content',
              updated_at: '2024-01-01T00:00:00Z',
            });
          }
        }

        return error('NOT_FOUND', 'Article not found: ' + id, 404);
      }

      // GET /api/articles (list)
      if (path === '/api/articles' && method === 'GET') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const type = url.searchParams.get('type');

        const manifest = await env.R2.get('manifest.json');
        if (!manifest) {
          return error('INTERNAL_ERROR', 'Manifest not found', 500);
        }
        const manifestData = JSON.parse(await manifest.text());

        let total = manifestData.totalArticles;
        if (type && manifestData.articlesByType[type]) {
          total = manifestData.articlesByType[type];
        }

        return json({
          data: [
            { id: 'wiki-123', title: 'Albert Einstein', type: 'person', description: 'Physicist' },
          ],
          pagination: {
            total,
            limit,
            offset,
            has_more: offset + 1 < total,
            cursor: offset + 1 < total ? btoa(JSON.stringify({ offset: offset + 1 })) : undefined,
          },
        });
      }

      // GET /api/wiki/:title
      const wikiMatch = path.match(/^\\/api\\/wiki\\/(.+)$/);
      if (wikiMatch && method === 'GET') {
        const title = decodeURIComponent(wikiMatch[1]);
        const normalized = title.toLowerCase().replace(/_/g, ' ').trim();

        const titleIndex = await env.R2.get('indexes/titles.json');
        if (titleIndex) {
          const index = JSON.parse(await titleIndex.text());
          if (index[normalized]) {
            return json({
              id: 'wiki-123',
              type: 'person',
              title: title,
              description: 'A test article',
              wikidata_id: 'Q123',
              coords: null,
              infobox: null,
              content: 'Test content',
              updated_at: '2024-01-01T00:00:00Z',
            });
          }
        }

        return error('NOT_FOUND', 'Article not found: ' + title, 404);
      }

      // POST /api/query
      if (path === '/api/query' && method === 'POST') {
        const contentType = request.headers.get('Content-Type');
        if (!contentType || !contentType.includes('application/json')) {
          return error('BAD_REQUEST', 'Content-Type must be application/json', 400);
        }

        let body;
        try {
          body = await request.json();
        } catch {
          return error('BAD_REQUEST', 'Invalid JSON body', 400);
        }

        // Validate filters
        if (body.filters) {
          for (const filter of body.filters) {
            if (!filter.field || !filter.operator) {
              return error('BAD_REQUEST', 'Each filter must have field and operator', 400);
            }
            const validOperators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'starts_with'];
            if (!validOperators.includes(filter.operator)) {
              return error('BAD_REQUEST', 'Invalid operator: ' + filter.operator + '. Valid operators: ' + validOperators.join(', '), 400);
            }
          }
        }

        return json({
          data: [],
          pagination: {
            total: 0,
            limit: body.limit || 20,
            offset: body.offset || 0,
            has_more: false,
          },
        });
      }

      // GET /api/search (vector search)
      if (path === '/api/search' && method === 'GET') {
        const q = url.searchParams.get('q');
        if (!q) {
          return error('BAD_REQUEST', 'Query parameter "q" is required', 400);
        }

        const k = parseInt(url.searchParams.get('k') || '10', 10);
        const model = url.searchParams.get('model') || 'bge-m3';

        return json({
          query: q,
          k,
          model,
          useHnsw: true,
          results: [
            { id: 'wiki-123', title: 'Albert Einstein', type: 'person', score: 0.95, preview: 'Physicist who developed the theory of relativity' },
          ],
          count: 1,
          searchTimeMs: 50,
        });
      }

      // GET /api/search/text
      if (path === '/api/search/text' && method === 'GET') {
        const q = url.searchParams.get('q');
        if (!q) {
          return error('BAD_REQUEST', 'Query parameter "q" is required', 400);
        }

        return json({
          query: q,
          results: [
            { id: 'wiki-123', title: 'Albert Einstein', type: 'person', score: 0.9 },
          ],
          count: 1,
        });
      }

      // GET /api/relationships/:id
      const relMatch = path.match(/^\\/api\\/relationships\\/([^/]+)$/);
      if (relMatch && method === 'GET') {
        const id = relMatch[1];
        const direction = url.searchParams.get('direction') || 'both';

        if (!['outgoing', 'incoming', 'both'].includes(direction)) {
          return error('BAD_REQUEST', 'Direction must be "outgoing", "incoming", or "both"', 400);
        }

        return json({
          id,
          direction,
          data: [
            { id, predicate: 'links_to', target_id: 'wiki-456', target_title: 'Tokyo', direction: 'outgoing' },
          ],
          pagination: { total: 1, limit: 20, offset: 0, has_more: false },
          outgoing_count: 1,
          incoming_count: 0,
        });
      }

      // GET /api/relationships/:id/outgoing
      const relOutMatch = path.match(/^\\/api\\/relationships\\/([^/]+)\\/outgoing$/);
      if (relOutMatch && method === 'GET') {
        const id = relOutMatch[1];
        return json({
          id,
          direction: 'outgoing',
          data: [
            { id, predicate: 'links_to', target_id: 'wiki-456', target_title: 'Tokyo', direction: 'outgoing' },
          ],
          pagination: { total: 1, limit: 20, offset: 0, has_more: false },
        });
      }

      // GET /api/relationships/:id/incoming
      const relInMatch = path.match(/^\\/api\\/relationships\\/([^/]+)\\/incoming$/);
      if (relInMatch && method === 'GET') {
        const id = relInMatch[1];
        return json({
          id,
          direction: 'incoming',
          data: [],
          pagination: { total: 0, limit: 20, offset: 0, has_more: false },
        });
      }

      // GET /api/types
      if (path === '/api/types' && method === 'GET') {
        const manifest = await env.R2.get('manifest.json');
        if (!manifest) {
          return error('INTERNAL_ERROR', 'Manifest not found', 500);
        }
        const manifestData = JSON.parse(await manifest.text());

        const types = Object.entries(manifestData.articlesByType).map(([type, count]) => ({
          type,
          count,
          files: 1,
        }));

        return json({
          types,
          summary: {
            total_articles: manifestData.totalArticles,
            total_files: types.length,
            type_count: types.length,
          },
        });
      }

      // GET /api/types/:type
      const typeMatch = path.match(/^\\/api\\/types\\/([^/]+)$/);
      if (typeMatch && method === 'GET') {
        const type = typeMatch[1];
        const validTypes = ['person', 'place', 'org', 'work', 'event', 'other'];

        if (!validTypes.includes(type)) {
          return error('BAD_REQUEST', 'Invalid type: ' + type + '. Valid types: ' + validTypes.join(', '), 400);
        }

        const manifest = await env.R2.get('manifest.json');
        if (!manifest) {
          return error('INTERNAL_ERROR', 'Manifest not found', 500);
        }
        const manifestData = JSON.parse(await manifest.text());

        return json({
          type,
          count: manifestData.articlesByType[type] || 0,
          files: 1,
        });
      }

      // GET /api/geo/stats
      if (path === '/api/geo/stats' && method === 'GET') {
        return json({
          indexed_articles: 2,
          geohash_buckets: 5,
          status: 'ready',
        });
      }

      // 404 for unknown routes
      return error('NOT_FOUND', 'Route not found: ' + path, 404);

    } catch (err) {
      console.error('Worker error:', err);
      return error('INTERNAL_ERROR', 'An internal error occurred', 500);
    }
  },
};
`;

describe('API Handler Tests with Miniflare', () => {
  let mf: Miniflare;

  beforeAll(async () => {
    // Create Miniflare instance
    mf = new Miniflare({
      modules: true,
      script: WORKER_SCRIPT,
      r2Buckets: ['R2'],
      bindings: {
        ENVIRONMENT: 'test',
        AI_GATEWAY_URL: 'https://test.gateway.ai.cloudflare.com',
      },
    });

    // Populate R2 with mock data
    const r2 = await mf.getR2Bucket('R2');
    await r2.put('manifest.json', JSON.stringify(MOCK_MANIFEST));
    await r2.put('indexes/titles.json', JSON.stringify(MOCK_TITLE_INDEX));
    await r2.put('indexes/types.json', JSON.stringify(MOCK_TYPE_INDEX));
    await r2.put('indexes/ids.json', JSON.stringify(MOCK_ID_INDEX));
    await r2.put('indexes/geo-index.json', JSON.stringify(MOCK_GEO_INDEX));
  });

  afterAll(async () => {
    await mf.dispose();
  });

  // ==========================================================================
  // Health & Info Routes
  // ==========================================================================

  describe('Health & Info Routes', () => {
    it('should return health status', async () => {
      const response = await mf.dispatchFetch('http://localhost/health');
      expect(response.status).toBe(200);

      const data = await response.json() as { status: string; version: string; timestamp: string };
      expect(data.status).toBe('healthy');
      expect(data.version).toBe('1.0.0');
      expect(data.timestamp).toBeDefined();
    });

    it('should return API info at root', async () => {
      const response = await mf.dispatchFetch('http://localhost/');
      expect(response.status).toBe(200);

      const data = await response.json() as { name: string; version: string; endpoints: object };
      expect(data.name).toBe('Wikipedia API');
      expect(data.version).toBe('1.0.0');
      expect(data.endpoints).toBeDefined();
      expect(data.endpoints).toHaveProperty('health');
      expect(data.endpoints).toHaveProperty('articles');
      expect(data.endpoints).toHaveProperty('search');
    });
  });

  // ==========================================================================
  // CORS Tests
  // ==========================================================================

  describe('CORS Support', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles', {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    it('should include CORS headers in responses', async () => {
      const response = await mf.dispatchFetch('http://localhost/health');

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  // ==========================================================================
  // Article Routes
  // ==========================================================================

  describe('Article Routes', () => {
    describe('GET /api/articles/:id', () => {
      it('should return article by ID', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/wiki-123');
        expect(response.status).toBe(200);

        const data = await response.json() as { id: string; title: string; type: string };
        expect(data.id).toBe('wiki-123');
        expect(data.title).toBe('Albert Einstein');
        expect(data.type).toBe('person');
      });

      it('should return 404 for non-existent article', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/non-existent-id');
        expect(response.status).toBe(404);

        const data = await response.json() as { error: string; message: string };
        expect(data.error).toBe('NOT_FOUND');
        expect(data.message).toContain('not found');
      });
    });

    describe('GET /api/articles', () => {
      it('should list articles with default pagination', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles');
        expect(response.status).toBe(200);

        const data = await response.json() as { data: unknown[]; pagination: { total: number; limit: number; offset: number; has_more: boolean } };
        expect(data.data).toBeDefined();
        expect(Array.isArray(data.data)).toBe(true);
        expect(data.pagination).toBeDefined();
        expect(data.pagination.total).toBe(100);
        expect(data.pagination.limit).toBe(20);
        expect(data.pagination.offset).toBe(0);
      });

      it('should respect limit and offset parameters', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles?limit=10&offset=5');
        expect(response.status).toBe(200);

        const data = await response.json() as { pagination: { limit: number; offset: number } };
        expect(data.pagination.limit).toBe(10);
        expect(data.pagination.offset).toBe(5);
      });

      it('should filter by type', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles?type=person');
        expect(response.status).toBe(200);

        const data = await response.json() as { pagination: { total: number } };
        expect(data.pagination.total).toBe(30); // person count from manifest
      });
    });

    describe('GET /api/wiki/:title', () => {
      it('should return article by title', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/wiki/Albert%20Einstein');
        expect(response.status).toBe(200);

        const data = await response.json() as { title: string; type: string };
        expect(data.title).toBe('Albert Einstein');
        expect(data.type).toBe('person');
      });

      it('should handle URL-encoded titles', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/wiki/Albert_Einstein');
        expect(response.status).toBe(200);

        const data = await response.json() as { title: string };
        expect(data.title).toBe('Albert_Einstein');
      });

      it('should return 404 for non-existent title', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/wiki/Non_Existent_Article');
        expect(response.status).toBe(404);
      });
    });

    describe('POST /api/query', () => {
      it('should accept valid query request', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: [{ field: 'type', operator: 'eq', value: 'person' }],
            limit: 10,
          }),
        });
        expect(response.status).toBe(200);

        const data = await response.json() as { data: unknown[]; pagination: object };
        expect(data.data).toBeDefined();
        expect(data.pagination).toBeDefined();
      });

      it('should reject missing Content-Type', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/query', {
          method: 'POST',
          body: JSON.stringify({ filters: [] }),
        });
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string; message: string };
        expect(data.error).toBe('BAD_REQUEST');
        expect(data.message).toContain('Content-Type');
      });

      it('should reject invalid JSON', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json',
        });
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string };
        expect(data.error).toBe('BAD_REQUEST');
      });

      it('should validate filter operators', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: [{ field: 'type', operator: 'invalid_op', value: 'person' }],
          }),
        });
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string; message: string };
        expect(data.error).toBe('BAD_REQUEST');
        expect(data.message).toContain('Invalid operator');
      });

      it('should reject filters without required fields', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filters: [{ field: 'type' }], // missing operator
          }),
        });
        expect(response.status).toBe(400);
      });
    });
  });

  // ==========================================================================
  // Search Routes
  // ==========================================================================

  describe('Search Routes', () => {
    describe('GET /api/search (vector search)', () => {
      it('should require query parameter', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/search');
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string; message: string };
        expect(data.error).toBe('BAD_REQUEST');
        expect(data.message).toContain('"q" is required');
      });

      it('should return search results', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/search?q=einstein');
        expect(response.status).toBe(200);

        const data = await response.json() as { query: string; results: unknown[]; k: number; searchTimeMs: number };
        expect(data.query).toBe('einstein');
        expect(data.results).toBeDefined();
        expect(Array.isArray(data.results)).toBe(true);
        expect(data.k).toBeDefined();
        expect(data.searchTimeMs).toBeDefined();
      });

      it('should respect k parameter', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/search?q=test&k=5');
        expect(response.status).toBe(200);

        const data = await response.json() as { k: number };
        expect(data.k).toBe(5);
      });
    });

    describe('GET /api/search/text', () => {
      it('should require query parameter', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/search/text');
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string };
        expect(data.error).toBe('BAD_REQUEST');
      });

      it('should return text search results', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/search/text?q=einstein');
        expect(response.status).toBe(200);

        const data = await response.json() as { query: string; results: unknown[]; count: number };
        expect(data.query).toBe('einstein');
        expect(data.results).toBeDefined();
        expect(data.count).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // Relationship Routes
  // ==========================================================================

  describe('Relationship Routes', () => {
    describe('GET /api/relationships/:id', () => {
      it('should return relationships for article', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/relationships/wiki-123');
        expect(response.status).toBe(200);

        const data = await response.json() as { id: string; direction: string; data: unknown[]; pagination: object };
        expect(data.id).toBe('wiki-123');
        expect(data.direction).toBe('both');
        expect(data.data).toBeDefined();
        expect(data.pagination).toBeDefined();
      });

      it('should filter by direction', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/relationships/wiki-123?direction=outgoing');
        expect(response.status).toBe(200);

        const data = await response.json() as { direction: string };
        expect(data.direction).toBe('outgoing');
      });

      it('should reject invalid direction', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/relationships/wiki-123?direction=invalid');
        expect(response.status).toBe(400);
      });
    });

    describe('GET /api/relationships/:id/outgoing', () => {
      it('should return outgoing relationships', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/relationships/wiki-123/outgoing');
        expect(response.status).toBe(200);

        const data = await response.json() as { direction: string; data: Array<{ direction: string }> };
        expect(data.direction).toBe('outgoing');
        expect(data.data.every((r) => r.direction === 'outgoing')).toBe(true);
      });
    });

    describe('GET /api/relationships/:id/incoming', () => {
      it('should return incoming relationships', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/relationships/wiki-123/incoming');
        expect(response.status).toBe(200);

        const data = await response.json() as { direction: string };
        expect(data.direction).toBe('incoming');
      });
    });
  });

  // ==========================================================================
  // Type Routes
  // ==========================================================================

  describe('Type Routes', () => {
    describe('GET /api/types', () => {
      it('should return all types with statistics', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/types');
        expect(response.status).toBe(200);

        const data = await response.json() as { types: Array<{ type: string; count: number; files: number }>; summary: { total_articles: number; type_count: number } };
        expect(data.types).toBeDefined();
        expect(Array.isArray(data.types)).toBe(true);
        expect(data.summary).toBeDefined();
        expect(data.summary.total_articles).toBe(100);
        expect(data.summary.type_count).toBe(6);
      });
    });

    describe('GET /api/types/:type', () => {
      it('should return stats for valid type', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/types/person');
        expect(response.status).toBe(200);

        const data = await response.json() as { type: string; count: number; files: number };
        expect(data.type).toBe('person');
        expect(data.count).toBe(30);
        expect(data.files).toBeDefined();
      });

      it('should reject invalid type', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/types/invalid');
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string; message: string };
        expect(data.error).toBe('BAD_REQUEST');
        expect(data.message).toContain('Invalid type');
        expect(data.message).toContain('Valid types');
      });
    });
  });

  // ==========================================================================
  // Geo Routes
  // ==========================================================================

  describe('Geo Routes', () => {
    describe('GET /api/articles/near', () => {
      it('should require lat and lng parameters', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/near');
        expect(response.status).toBe(400);

        const data = await response.json() as { error: string; message: string };
        expect(data.error).toBe('BAD_REQUEST');
        expect(data.message).toContain('lat and lng');
      });

      it('should reject invalid coordinates', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/near?lat=abc&lng=xyz');
        expect(response.status).toBe(400);

        const data = await response.json() as { message: string };
        expect(data.message).toContain('must be numbers');
      });

      it('should reject out-of-range latitude', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/near?lat=100&lng=0');
        expect(response.status).toBe(400);

        const data = await response.json() as { message: string };
        expect(data.message).toContain('latitude');
        expect(data.message).toContain('-90');
      });

      it('should reject out-of-range longitude', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/near?lat=0&lng=200');
        expect(response.status).toBe(400);

        const data = await response.json() as { message: string };
        expect(data.message).toContain('longitude');
        expect(data.message).toContain('-180');
      });

      it('should return nearby articles', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/near?lat=35.6762&lng=139.6503');
        expect(response.status).toBe(200);

        const data = await response.json() as { query: { lat: number; lng: number; radius: number }; data: Array<{ distance: number }>; count: number };
        expect(data.query).toBeDefined();
        expect(data.query.lat).toBe(35.6762);
        expect(data.query.lng).toBe(139.6503);
        expect(data.data).toBeDefined();
        expect(data.count).toBeDefined();
      });

      it('should respect radius parameter', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/articles/near?lat=35.6762&lng=139.6503&radius=50');
        expect(response.status).toBe(200);

        const data = await response.json() as { query: { radius: number } };
        expect(data.query.radius).toBe(50);
      });
    });

    describe('GET /api/geo/stats', () => {
      it('should return geo index statistics', async () => {
        const response = await mf.dispatchFetch('http://localhost/api/geo/stats');
        expect(response.status).toBe(200);

        const data = await response.json() as { indexed_articles: number; geohash_buckets: number; status: string };
        expect(data.indexed_articles).toBeDefined();
        expect(data.geohash_buckets).toBeDefined();
        expect(data.status).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/unknown');
      expect(response.status).toBe(404);

      const data = await response.json() as { error: string; message: string; status: number };
      expect(data.error).toBe('NOT_FOUND');
      expect(data.message).toContain('Route not found');
      expect(data.status).toBe(404);
    });

    it('should include Content-Type header in error responses', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/unknown');
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return valid JSON for all error responses', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles/non-existent');
      expect(response.status).toBe(404);

      const text = await response.text();
      expect(() => JSON.parse(text)).not.toThrow();
    });
  });

  // ==========================================================================
  // Response Format Tests
  // ==========================================================================

  describe('Response Format', () => {
    it('should include timing headers', async () => {
      const response = await mf.dispatchFetch('http://localhost/health');
      expect(response.headers.get('X-Response-Time')).toBeDefined();
    });

    it('should return proper Content-Type for JSON responses', async () => {
      const response = await mf.dispatchFetch('http://localhost/health');
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should return pagination in list responses', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles');
      const data = await response.json() as { pagination: { total: number; limit: number; offset: number; has_more: boolean } };

      expect(data.pagination).toHaveProperty('total');
      expect(data.pagination).toHaveProperty('limit');
      expect(data.pagination).toHaveProperty('offset');
      expect(data.pagination).toHaveProperty('has_more');
    });

    it('should include cursor for pagination when has_more is true', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles?limit=1');
      const data = await response.json() as { pagination: { has_more: boolean; cursor?: string } };

      if (data.pagination.has_more) {
        expect(data.pagination.cursor).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty query strings', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles?');
      expect(response.status).toBe(200);
    });

    it('should handle special characters in path parameters', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/wiki/Test%20(disambiguation)');
      // Should not crash - may return 404 if not found
      expect([200, 404]).toContain(response.status);
    });

    it('should handle very long query strings', async () => {
      const longQuery = 'a'.repeat(1000);
      const response = await mf.dispatchFetch(`http://localhost/api/search?q=${longQuery}`);
      expect(response.status).toBe(200);
    });

    it('should handle unicode in search queries', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/search?q=%E4%B8%AD%E6%96%87');
      expect(response.status).toBe(200);
    });

    it('should handle negative pagination values gracefully', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles?limit=-1&offset=-5');
      // Should use defaults or handle gracefully
      expect(response.status).toBe(200);
    });

    it('should handle zero limit gracefully', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles?limit=0');
      expect(response.status).toBe(200);
    });

    it('should handle very large limit values', async () => {
      const response = await mf.dispatchFetch('http://localhost/api/articles?limit=10000');
      expect(response.status).toBe(200);
    });

    it('should handle concurrent requests', async () => {
      const requests = Array(10).fill(null).map(() =>
        mf.dispatchFetch('http://localhost/health')
      );

      const responses = await Promise.all(requests);
      expect(responses.every((r) => r.status === 200)).toBe(true);
    });
  });
});
