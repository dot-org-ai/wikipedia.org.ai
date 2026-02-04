/**
 * Type statistics handlers for the Wikipedia API
 *
 * Provides:
 * - List all article types with counts
 * - Get statistics for a specific type
 */

import type {
  ArticleType,
  TypeStats,
  RequestContext,
} from '../types.js';
import { isValidArticleType, ARTICLE_TYPES } from '../../../shared/types.js';
import { fromBaseContext, type ScopedRequestContext } from '../context.js';
import {
  jsonResponse,
  errorResponse,
} from '../middleware.js';


/**
 * Get statistics for all article types
 */
export async function getTypeStatistics(ctx: ScopedRequestContext): Promise<TypeStats[]> {
  const manifest = ctx.manifestReader;
  const manifestData = await manifest.getManifest();
  const typeIndex = await manifest.getTypeIndex();

  const stats: TypeStats[] = [];

  for (const type of ARTICLE_TYPES) {
    const count = manifestData.articlesByType[type] ?? 0;
    const files = typeIndex[type]?.length ?? 0;

    stats.push({
      type,
      count,
      files,
    });
  }

  return stats;
}

/**
 * Get statistics for a specific type
 */
export async function getTypeStats(type: ArticleType, ctx: ScopedRequestContext): Promise<TypeStats | null> {
  if (!ARTICLE_TYPES.includes(type)) {
    return null;
  }

  const manifest = ctx.manifestReader;
  const manifestData = await manifest.getManifest();
  const typeIndex = await manifest.getTypeIndex();

  const count = manifestData.articlesByType[type] ?? 0;
  const files = typeIndex[type]?.length ?? 0;

  return {
    type,
    count,
    files,
  };
}

// =============================================================================
// HTTP Handlers
// =============================================================================

/**
 * GET /api/types
 */
export async function handleListTypes(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);

  try {
    const stats = await getTypeStatistics(ctx);

    // Calculate totals
    const totalArticles = stats.reduce((sum, s) => sum + s.count, 0);
    const totalFiles = stats.reduce((sum, s) => sum + s.files, 0);

    return jsonResponse({
      types: stats,
      summary: {
        total_articles: totalArticles,
        total_files: totalFiles,
        type_count: stats.length,
      },
    });
  } catch (error) {
    console.error('Error fetching type statistics:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch type statistics', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/types/:type
 */
export async function handleGetTypeStats(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { type } = ctx.params;

  if (!type) {
    return errorResponse('BAD_REQUEST', 'Type parameter is required', 400);
  }

  if (!isValidArticleType(type)) {
    return errorResponse(
      'BAD_REQUEST',
      `Invalid type: ${type}. Valid types: ${ARTICLE_TYPES.join(', ')}`,
      400
    );
  }

  try {
    const stats = await getTypeStats(type, ctx);

    if (!stats) {
      return errorResponse('NOT_FOUND', `Type not found: ${type}`, 404);
    }

    return jsonResponse(stats);
  } catch (error) {
    console.error('Error fetching type stats:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch type statistics', 500);
  } finally {
    ctx.cleanup();
  }
}

