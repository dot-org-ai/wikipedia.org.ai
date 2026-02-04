/**
 * Request Router for Wikipedia API
 *
 * A minimal, dependency-free router for Cloudflare Workers.
 * Supports:
 * - Path parameters (:param)
 * - Query string parsing
 * - Method-based routing (GET, POST, etc.)
 * - Middleware composition
 */

import type { Handler, RequestContext, Env } from './types.js';
import { createLogger } from '../../lib/logger.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('api:router');
import {
  cors,
  handlePreflight,
  errorHandler,
  withTiming,
  errorResponse,
} from './middleware.js';

/** Route definition */
interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

/** Router configuration */
interface RouterConfig {
  /** Enable CORS headers */
  cors?: boolean;
  /** Enable request timing headers */
  timing?: boolean;
  /** Base path prefix */
  basePath?: string;
}

/**
 * Simple router without external dependencies
 */
export class Router {
  private routes: Route[] = [];
  private config: RouterConfig;

  constructor(config: RouterConfig = {}) {
    this.config = {
      cors: true,
      timing: true,
      basePath: '',
      ...config,
    };
  }

  /**
   * Register a GET route
   */
  get(path: string, handler: Handler): this {
    return this.addRoute('GET', path, handler);
  }

  /**
   * Register a POST route
   */
  post(path: string, handler: Handler): this {
    return this.addRoute('POST', path, handler);
  }

  /**
   * Register a PUT route
   */
  put(path: string, handler: Handler): this {
    return this.addRoute('PUT', path, handler);
  }

  /**
   * Register a DELETE route
   */
  delete(path: string, handler: Handler): this {
    return this.addRoute('DELETE', path, handler);
  }

  /**
   * Register a PATCH route
   */
  patch(path: string, handler: Handler): this {
    return this.addRoute('PATCH', path, handler);
  }

  /**
   * Register a route for all methods
   */
  all(path: string, handler: Handler): this {
    return this.addRoute('*', path, handler);
  }

  /**
   * Add a route with custom method
   */
  private addRoute(method: string, path: string, handler: Handler): this {
    const fullPath = this.config.basePath + path;
    const { pattern, paramNames } = this.compilePath(fullPath);

    this.routes.push({
      method,
      pattern,
      paramNames,
      handler,
    });

    return this;
  }

  /**
   * Compile a path pattern into a regex
   */
  private compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];

    // Escape special regex characters except for :param patterns
    let regexPattern = path
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      });

    // Handle wildcard at end
    regexPattern = regexPattern.replace(/\\\*$/, '(.*)');

    return {
      pattern: new RegExp(`^${regexPattern}$`),
      paramNames,
    };
  }

  /**
   * Handle an incoming request
   */
  async handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS' && this.config.cors) {
      return handlePreflight();
    }

    // Find matching route
    const pathname = url.pathname;
    let matchedRoute: Route | null = null;
    let params: Record<string, string> = {};

    for (const route of this.routes) {
      // Check method
      if (route.method !== '*' && route.method !== request.method) {
        continue;
      }

      // Check pattern
      const match = pathname.match(route.pattern);
      if (match) {
        matchedRoute = route;

        // Extract params
        for (let i = 0; i < route.paramNames.length; i++) {
          const paramName = route.paramNames[i];
          const matchValue = match[i + 1];
          if (paramName !== undefined && matchValue !== undefined) {
            params[paramName] = decodeURIComponent(matchValue);
          }
        }

        break;
      }
    }

    // No route found
    if (!matchedRoute) {
      let response = errorResponse('NOT_FOUND', `Route not found: ${pathname}`, 404);

      if (this.config.cors) {
        response = cors(response);
      }

      if (this.config.timing) {
        response = withTiming(response, startTime);
      }

      return response;
    }

    // Build request context
    const requestContext: RequestContext = {
      request,
      env,
      ctx,
      startTime,
      params,
      query: url.searchParams,
    };

    // Execute handler with error handling
    try {
      let response = await matchedRoute.handler(requestContext);

      // Add CORS headers
      if (this.config.cors) {
        response = cors(response);
      }

      // Add timing headers
      if (this.config.timing) {
        response = withTiming(response, startTime);
      }

      return response;
    } catch (error) {
      getLog().error('Route handler error', {
        path: pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, 'handleRequest');

      let response = errorHandler(error instanceof Error ? error : new Error(String(error)));

      if (this.config.cors) {
        response = cors(response);
      }

      if (this.config.timing) {
        response = withTiming(response, startTime);
      }

      return response;
    }
  }
}

/**
 * Create a new router instance
 */
export function createRouter(config?: RouterConfig): Router {
  return new Router(config);
}

// =============================================================================
// Route Registration
// =============================================================================

import { handleGetArticleById, handleGetArticleByTitle, handleListArticles, handleAdvancedQuery } from './handlers/articles.js';
import { handleVectorSearch, handleTextSearch } from './handlers/search.js';
import { handleGetRelationships, handleGetOutgoingRelationships, handleGetIncomingRelationships } from './handlers/relationships.js';
import { handleListTypes, handleGetTypeStats } from './handlers/types.js';
import { handleNearbySearch, handleGeoStats } from './handlers/geo.js';
import { handleOpenApiSpec, handleOpenApiJson, handleSwaggerUi } from './handlers/docs.js';
import { handleWikiRoot, handleWikiParsePost, handleWikiArticle } from './handlers/wiki.js';
import { jsonResponse, withCache } from './middleware.js';

/**
 * Create and configure the API router with all routes
 */
export function createAPIRouter(): Router {
  const router = createRouter({
    cors: true,
    timing: true,
    basePath: '',
  });

  // ==========================================================================
  // Health & Info Routes
  // ==========================================================================

  // Health check
  router.get('/health', async () => {
    return jsonResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  });

  // API info
  router.get('/', async () => {
    return jsonResponse({
      name: 'Wikipedia API',
      version: '1.0.0',
      description: 'REST API for Wikipedia data served from R2',
      documentation: 'GET /docs',
      endpoints: {
        health: 'GET /health',
        docs: {
          swagger: 'GET /docs',
          openapi_yaml: 'GET /docs/openapi.yaml',
          openapi_json: 'GET /docs/openapi.json',
        },
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
  });

  // ==========================================================================
  // Documentation Routes (Public)
  // ==========================================================================

  // Swagger UI
  router.get('/docs', handleSwaggerUi);

  // OpenAPI spec in YAML format
  router.get('/docs/openapi.yaml', handleOpenApiSpec);

  // OpenAPI spec in JSON format
  router.get('/docs/openapi.json', handleOpenApiJson);

  // ==========================================================================
  // Article Routes
  // ==========================================================================

  // Search articles near a location (must come before :id to avoid matching)
  router.get('/api/articles/near', withCache(handleNearbySearch, 300));

  // Get article by ID
  router.get('/api/articles/:id', withCache(handleGetArticleById, 3600));

  // List articles
  router.get('/api/articles', withCache(handleListArticles, 300));

  // Get article by title (URL encoded)
  router.get('/api/wiki/:title', withCache(handleGetArticleByTitle, 3600));

  // Advanced query
  router.post('/api/query', handleAdvancedQuery);

  // ==========================================================================
  // Search Routes
  // ==========================================================================

  // Vector search
  router.get('/api/search', handleVectorSearch);

  // Text search
  router.get('/api/search/text', withCache(handleTextSearch, 300));

  // ==========================================================================
  // Relationship Routes
  // ==========================================================================

  // Get all relationships for an article
  router.get('/api/relationships/:id', withCache(handleGetRelationships, 3600));

  // Get outgoing relationships
  router.get('/api/relationships/:id/outgoing', withCache(handleGetOutgoingRelationships, 3600));

  // Get incoming relationships
  router.get('/api/relationships/:id/incoming', withCache(handleGetIncomingRelationships, 3600));

  // ==========================================================================
  // Type Routes
  // ==========================================================================

  // List all types with counts
  router.get('/api/types', withCache(handleListTypes, 3600));

  // Get stats for a specific type
  router.get('/api/types/:type', withCache(handleGetTypeStats, 3600));

  // ==========================================================================
  // Geo Routes
  // ==========================================================================

  // Get geo index statistics
  router.get('/api/geo/stats', withCache(handleGeoStats, 300));

  return router;
}

/**
 * Create and configure the Wiki Parser router for wiki.org.ai
 *
 * Routes:
 *   /                       -> API usage info
 *   POST /                  -> Parse raw wikitext
 *   /:title                 -> Article as Markdown
 *   /:title.json            -> Article as JSON
 *   /:title/summary         -> Concise summary
 *   /:title/infobox         -> Infobox data only
 *   /:title/links           -> Links only
 *   /:title/categories      -> Categories only
 *   /:title/text            -> Plain text
 *   /:lang/:title           -> Article in specific language
 *   /:lang/:title.json      -> etc.
 */
export function createWikiRouter(): Router {
  const router = createRouter({
    cors: true,
    timing: true,
    basePath: '',
  });

  // ==========================================================================
  // Wiki Parser Routes (wiki.org.ai)
  // ==========================================================================

  // Root: Show usage info
  router.get('/', handleWikiRoot);

  // POST: Parse raw wikitext
  router.post('/', handleWikiParsePost);

  // Catch-all for article routes - the handler will parse the path
  // Order matters: more specific routes first
  // Note: Using wildcard to match all article paths including language prefixes

  // Language + title + section (e.g., /fr/Paris/summary)
  router.get('/:lang/:title/:section', withCache(handleWikiArticle, 300));

  // Language + title.json (e.g., /fr/Paris.json)
  router.get('/:lang/:titleJson', withCache(handleWikiArticle, 300));

  // Title + section (e.g., /Albert_Einstein/summary)
  router.get('/:title/:section', withCache(handleWikiArticle, 300));

  // Title only (e.g., /Albert_Einstein or /Albert_Einstein.json)
  router.get('/:title', withCache(handleWikiArticle, 300));

  return router;
}
