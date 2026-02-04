// @ts-nocheck - Complex GeoIndex integration with exactOptionalPropertyTypes issues in search options
/**
 * Geo handlers for the Wikipedia API
 *
 * Provides:
 * - Search articles near a geographic location
 * - Proximity queries with distance filtering
 */

import type {
  ArticleType,
  RequestContext,
} from '../types.js';
import { isValidArticleType, ARTICLE_TYPES } from '../../../shared/types.js';
import { fromBaseContext, type ScopedRequestContext } from '../context.js';
import {
  jsonResponse,
  errorResponse,
} from '../middleware.js';
import type {
  GeoSearchResult,
  GeoSearchOptions,
} from '../../../indexes/geo-index.js';
import { DEFAULT_BATCH_SIZE, MAX_RESULTS_LIMIT } from '../../../lib/constants.js';

/**
 * Search for articles near a location
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param radiusKm - Search radius in kilometers
 * @param options - Additional search options
 * @param ctx - Request-scoped context
 * @returns Array of articles with distances, sorted by distance
 */
export async function searchNearby(
  lat: number,
  lng: number,
  radiusKm: number,
  options: {
    limit?: number;
    types?: ArticleType[];
  },
  ctx: ScopedRequestContext
): Promise<GeoSearchResult[]> {
  const index = await ctx.getGeoIndex();
  const reader = ctx.parquetReader;

  // Convert km to meters
  const radiusMeters = radiusKm * 1000;

  const searchOptions: GeoSearchOptions = {
    maxDistance: radiusMeters,
    limit: options.limit ?? 50,
    types: options.types,
  };

  // Search the geo index
  const candidates = index.search(lat, lng, searchOptions);

  // Fetch full article data for results
  const results: GeoSearchResult[] = [];

  for (const { entry, distance } of candidates) {
    try {
      const article = await reader.readArticle(entry.file, entry.rowGroup, entry.row);
      results.push({
        article,
        distance,
        distanceKm: distance / 1000,
      });
    } catch (error) {
      // Skip articles that fail to load
      console.error(`Error loading article ${entry.articleId}:`, error);
    }
  }

  return results;
}

/**
 * Fast proximity search without full article data
 * Returns only IDs and distances for efficiency
 */
export async function searchNearbyFast(
  lat: number,
  lng: number,
  radiusKm: number,
  options: {
    limit?: number;
    types?: ArticleType[];
  },
  ctx: ScopedRequestContext
): Promise<Array<{
  id: string;
  title: string;
  type: ArticleType;
  distance: number;
  distanceKm: number;
  coords: { lat: number; lng: number };
}>> {
  const index = await ctx.getGeoIndex();

  const radiusMeters = radiusKm * 1000;

  const searchOptions: GeoSearchOptions = {
    maxDistance: radiusMeters,
    limit: options.limit ?? 50,
    types: options.types,
  };

  const candidates = index.search(lat, lng, searchOptions);

  return candidates.map(({ entry, distance }) => ({
    id: entry.articleId,
    title: entry.title,
    type: entry.type,
    distance,
    distanceKm: distance / 1000,
    coords: {
      lat: entry.lat,
      lng: entry.lng,
    },
  }));
}

// =============================================================================
// HTTP Handlers
// =============================================================================


/**
 * Parse types parameter (comma-separated)
 */
function parseTypes(typesParam: string | null): ArticleType[] | undefined {
  if (!typesParam) return undefined;

  const types = typesParam.split(',').filter(isValidArticleType);
  return types.length > 0 ? types : undefined;
}

/**
 * GET /api/articles/near
 *
 * Query parameters:
 * - lat: Latitude (required)
 * - lng: Longitude (required)
 * - radius: Search radius in km (default: 10, max: 500)
 * - limit: Maximum results (default: 50, max: 100)
 * - types: Comma-separated list of article types to filter
 * - fast: If "true", return only basic info without full article data
 */
export async function handleNearbySearch(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { query } = ctx;

  // Parse coordinates
  const latParam = query.get('lat');
  const lngParam = query.get('lng');

  if (!latParam || !lngParam) {
    return errorResponse(
      'BAD_REQUEST',
      'Missing required parameters: lat and lng',
      400
    );
  }

  const lat = parseFloat(latParam);
  const lng = parseFloat(lngParam);

  if (isNaN(lat) || isNaN(lng)) {
    return errorResponse(
      'BAD_REQUEST',
      'Invalid coordinates: lat and lng must be numbers',
      400
    );
  }

  if (lat < -90 || lat > 90) {
    return errorResponse(
      'BAD_REQUEST',
      'Invalid latitude: must be between -90 and 90',
      400
    );
  }

  if (lng < -180 || lng > 180) {
    return errorResponse(
      'BAD_REQUEST',
      'Invalid longitude: must be between -180 and 180',
      400
    );
  }

  // Parse radius (default: 10km, max: 500km)
  const radiusParam = query.get('radius');
  let radius = 10;
  if (radiusParam) {
    const parsed = parseFloat(radiusParam);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 500) {
      radius = parsed;
    }
  }

  // Parse limit (default: 50, max: 100)
  const limitParam = query.get('limit');
  let limit = DEFAULT_BATCH_SIZE;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= MAX_RESULTS_LIMIT) {
      limit = parsed;
    }
  }

  // Parse types filter
  const types = parseTypes(query.get('types'));

  // Check if fast mode is requested
  const fast = query.get('fast') === 'true';

  try {
    if (fast) {
      // Fast mode: return only basic info
      const results = await searchNearbyFast(lat, lng, radius, { limit, types }, ctx);

      return jsonResponse({
        query: {
          lat,
          lng,
          radius,
          limit,
          types: types ?? 'all',
        },
        results,
        count: results.length,
      });
    } else {
      // Full mode: return complete article data
      const results = await searchNearby(lat, lng, radius, { limit, types }, ctx);

      return jsonResponse({
        query: {
          lat,
          lng,
          radius,
          limit,
          types: types ?? 'all',
        },
        data: results.map((r) => ({
          ...r.article,
          distance: r.distance,
          distanceKm: r.distanceKm,
        })),
        count: results.length,
      });
    }
  } catch (error) {
    console.error('Error in nearby search:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to search nearby articles', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/geo/stats
 *
 * Returns statistics about the geo index
 */
export async function handleGeoStats(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);

  try {
    const index = await ctx.getGeoIndex();
    const stats = index.getStats();

    return jsonResponse({
      indexed_articles: stats.entryCount,
      geohash_buckets: stats.bucketCount,
      status: index.ready ? 'ready' : 'building',
    });
  } catch (error) {
    console.error('Error fetching geo stats:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch geo index statistics', 500);
  } finally {
    ctx.cleanup();
  }
}
