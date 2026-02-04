/**
 * Wikipedia API Worker
 *
 * A Cloudflare Worker that serves Wikipedia data from R2 storage.
 *
 * Features:
 * - REST API for articles, relationships, and search
 * - Vector similarity search using embeddings
 * - Parquet file reading directly from R2
 * - Response caching with Cache API
 * - CORS support
 * - Request timing headers
 * - Pre-built index warmup for fast cold starts
 * - Scheduled index refresh via Cron Triggers
 *
 * Routes:
 * - GET /health - Health check
 * - GET /api/articles/:id - Get article by ID
 * - GET /api/articles - List articles with filtering
 * - GET /api/wiki/:title - Get article by title
 * - GET /api/search - Vector search
 * - GET /api/search/text - Full-text search
 * - GET /api/types - List article types with counts
 * - GET /api/relationships/:id - Get article relationships
 * - POST /api/query - Advanced query
 *
 * Scheduled:
 * - Cron trigger for periodic index warmup/refresh
 */

import { createAPIRouter, createWikiRouter } from './router.js';
import type { Env } from './types.js';
import {
  warmupIndexes,
  type WarmupOptions,
  type WarmupResult,
} from './warmup.js';

// Create routers once on cold start
const apiRouter = createAPIRouter();
const wikiRouter = createWikiRouter();

// Track if initial warmup has been triggered
let initialWarmupPromise: Promise<WarmupResult> | null = null;

/**
 * Trigger initial warmup on cold start
 * Uses waitUntil to not block the first request
 */
function triggerInitialWarmup(env: Env, ctx: ExecutionContext): void {
  if (initialWarmupPromise) {
    return; // Already triggered
  }

  const warmupOptions: WarmupOptions = {
    geo: true,
    fts: true,
    vector: true,
    force: false,
  };

  initialWarmupPromise = warmupIndexes(env, warmupOptions);

  // Use waitUntil to ensure warmup completes even if request finishes early
  ctx.waitUntil(
    initialWarmupPromise.then((result) => {
      console.log(
        `[worker] Initial warmup completed: ${result.success ? 'success' : 'failed'} in ${result.duration}ms`
      );
    }).catch((error) => {
      console.error('[worker] Initial warmup failed:', error);
    })
  );
}

export default {
  /**
   * Handle incoming HTTP requests
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Trigger initial warmup on first request (non-blocking)
    triggerInitialWarmup(env, ctx);

    // Check hostname to determine which router to use
    const url = new URL(request.url);
    const hostname = url.hostname;

    // Route wikipedia.org.ai requests to wiki router
    // - wikipedia.org.ai -> wiki router (article parsing)
    // - api.wikipedia.org.ai -> API router (REST API)
    // - wiki.org.ai reserved for wikidata worker
    if (hostname === 'wikipedia.org.ai') {
      return wikiRouter.handle(request, env, ctx);
    }

    // Default to API router
    return apiRouter.handle(request, env, ctx);
  },

  /**
   * Handle scheduled events (Cron Triggers)
   *
   * Configure in wrangler.toml:
   * ```toml
   * [triggers]
   * crons = ["0 * * * *"]  # Run every hour
   * ```
   *
   * This handler refreshes all indexes periodically to ensure
   * they stay up-to-date and warm across isolate restarts.
   */
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log(`[scheduled] Cron trigger fired at ${new Date(event.scheduledTime).toISOString()}`);

    const warmupOptions: WarmupOptions = {
      geo: true,
      fts: true,
      vector: true,
      force: true, // Force refresh on scheduled runs
    };

    ctx.waitUntil(
      warmupIndexes(env, warmupOptions).then((result) => {
        console.log(
          `[scheduled] Index warmup completed: ${result.success ? 'success' : 'failed'} in ${result.duration}ms`
        );

        // Log individual index results
        for (const index of result.indexes) {
          if (index.status === 'error') {
            console.error(`[scheduled] Index ${index.name} failed: ${index.error}`);
          } else {
            console.log(`[scheduled] Index ${index.name}: ${index.status} (${index.duration}ms)`);
          }
        }
      }).catch((error) => {
        console.error('[scheduled] Index warmup failed:', error);
      })
    );
  },
};

// Re-export types for consumers
export type { Env };
export type {
  Article,
  ArticleType,
  Relationship,
  SearchResult,
  PaginatedResult,
  ListOptions,
  SearchOptions,
  QueryRequest,
  QueryFilter,
  TypeStats,
  APIError,
  RequestContext,
  Handler,
} from './types.js';
