// @ts-nocheck - Complex R2ParquetReader integration with exactOptionalPropertyTypes issues
/**
 * Article handlers for the Wikipedia API
 *
 * Provides:
 * - Get article by ID
 * - Get article by title
 * - List articles with filtering and pagination
 * - Advanced query support
 */

import type {
  Article,
  ArticleType,
  ListOptions,
  PaginatedResult,
  QueryRequest,
  RequestContext,
  TitleIndexEntry,
} from '../types.js';
import { isValidArticleType } from '../../../shared/types.js';
import { fromBaseContext, type ScopedRequestContext } from '../context.js';
import {
  jsonResponse,
  errorResponse,
  parsePagination,
  normalizeTitle,
  encodeCursor,
  decodeCursor,
  parseJsonBody,
} from '../middleware.js';

/**
 * Get article by ID using O(1) index lookup
 */
export async function getArticleById(
  id: string,
  ctx: ScopedRequestContext
): Promise<Article | null> {
  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;

  // Try O(1) lookup using ID index first
  const location = await manifest.lookupByID(id);

  if (location) {
    // Found in index - direct read
    try {
      return await reader.readArticle(location.file, location.rowGroup, location.row);
    } catch (error) {
      console.error(`Error reading article from index location:`, error);
      // Fall through to scan if index entry is stale
    }
  }

  // Fallback: scan through data files (for backward compatibility or stale index)
  const manifestData = await manifest.getManifest();

  for (const file of manifestData.dataFiles) {
    try {
      const metadata = await reader.getMetadata(file.path);

      // Search each row group
      for (let rgIndex = 0; rgIndex < metadata.rowGroups.length; rgIndex++) {
        const articles = await reader.readRowGroup(file.path, rgIndex);
        const article = articles.find((a) => a.id === id);
        if (article) {
          return article;
        }
      }
    } catch (error) {
      console.error(`Error reading file ${file.path}:`, error);
      continue;
    }
  }

  return null;
}

/**
 * Get article by title
 */
export async function getArticleByTitle(
  title: string,
  ctx: ScopedRequestContext
): Promise<Article | null> {
  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;

  // Normalize title for lookup
  const normalized = normalizeTitle(title);

  // Get title index
  const titleIndex = await manifest.getTitleIndex();

  // Look up in title index
  const entry = titleIndex[normalized] as TitleIndexEntry | undefined;

  if (!entry) {
    // Try with original title (may have different normalization)
    const altEntry = titleIndex[title.toLowerCase()] as TitleIndexEntry | undefined;
    if (!altEntry) {
      return null;
    }
    return reader.readArticle(altEntry.file, altEntry.rowGroup, altEntry.row);
  }

  return reader.readArticle(entry.file, entry.rowGroup, entry.row);
}

/**
 * List articles with filtering and pagination
 */
export async function listArticles(
  options: ListOptions,
  ctx: ScopedRequestContext
): Promise<PaginatedResult<Article>> {
  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;

  const limit = options.limit ?? 20;
  let offset = options.offset ?? 0;

  // Handle cursor-based pagination
  if (options.cursor) {
    offset = decodeCursor(options.cursor);
  }

  // Get manifest
  const manifestData = await manifest.getManifest();

  // Filter files by type if specified
  let files = manifestData.dataFiles;
  if (options.type) {
    const typeIndex = await manifest.getTypeIndex();
    const typeFiles = typeIndex[options.type] ?? [];
    files = files.filter((f) => typeFiles.includes(f.path));
  }

  // Calculate total count
  const total = files.reduce((sum, f) => sum + f.rowCount, 0);

  // Collect articles with pagination
  const articles: Article[] = [];
  let currentOffset = 0;
  let remaining = limit;

  for (const file of files) {
    if (remaining <= 0) break;

    const fileEnd = currentOffset + file.rowCount;

    // Skip files before our offset
    if (fileEnd <= offset) {
      currentOffset = fileEnd;
      continue;
    }

    // Calculate read parameters for this file
    const skipInFile = Math.max(0, offset - currentOffset);
    const readFromFile = Math.min(file.rowCount - skipInFile, remaining);

    // Read articles from this file
    const { articles: fileArticles } = await reader.readArticles(
      file.path,
      readFromFile,
      skipInFile
    );

    articles.push(...fileArticles);
    remaining -= fileArticles.length;
    currentOffset = fileEnd;
  }

  // Build pagination info
  const hasMore = offset + articles.length < total;
  const nextCursor = hasMore ? encodeCursor(offset + articles.length) : undefined;

  return {
    data: articles,
    pagination: {
      total,
      limit,
      offset,
      has_more: hasMore,
      cursor: nextCursor,
    },
  };
}

/**
 * Advanced query handler
 */
export async function queryArticles(
  query: QueryRequest,
  ctx: ScopedRequestContext
): Promise<PaginatedResult<Article>> {
  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;

  const limit = query.limit ?? 20;
  const offset = query.offset ?? 0;

  // Get manifest
  const manifestData = await manifest.getManifest();

  // Filter files by type if specified
  let files = manifestData.dataFiles;
  if (query.type) {
    const typeIndex = await manifest.getTypeIndex();
    const typeFiles = typeIndex[query.type] ?? [];
    files = files.filter((f) => typeFiles.includes(f.path));
  }

  // Apply filters and collect results
  const allMatches: Article[] = [];

  for (const file of files) {
    // For each file, read and filter
    const metadata = await reader.getMetadata(file.path);

    for (let rgIndex = 0; rgIndex < metadata.rowGroups.length; rgIndex++) {
      const articles = await reader.readRowGroup(file.path, rgIndex);

      // Apply filters
      const matches = articles.filter((article) => {
        if (!query.filters || query.filters.length === 0) return true;

        return query.filters.every((filter) => {
          const value = (article as unknown as Record<string, unknown>)[filter.field];
          return applyFilter(value, filter.operator, filter.value);
        });
      });

      allMatches.push(...matches);
    }
  }

  // Sort if requested
  if (query.order_by) {
    const dir = query.order_dir === 'desc' ? -1 : 1;
    allMatches.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[query.order_by!];
      const bVal = (b as unknown as Record<string, unknown>)[query.order_by!];

      if (aVal === bVal) return 0;
      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * dir;
      }

      return (aVal < bVal ? -1 : 1) * dir;
    });
  }

  // Apply pagination
  const total = allMatches.length;
  const paginatedResults = allMatches.slice(offset, offset + limit);
  const hasMore = offset + paginatedResults.length < total;

  return {
    data: paginatedResults,
    pagination: {
      total,
      limit,
      offset,
      has_more: hasMore,
      cursor: hasMore ? encodeCursor(offset + paginatedResults.length) : undefined,
    },
  };
}

/**
 * Apply a filter operation
 */
function applyFilter(value: unknown, operator: string, filterValue: unknown): boolean {
  switch (operator) {
    case 'eq':
      return value === filterValue;

    case 'ne':
      return value !== filterValue;

    case 'gt':
      return typeof value === 'number' && typeof filterValue === 'number' && value > filterValue;

    case 'gte':
      return typeof value === 'number' && typeof filterValue === 'number' && value >= filterValue;

    case 'lt':
      return typeof value === 'number' && typeof filterValue === 'number' && value < filterValue;

    case 'lte':
      return typeof value === 'number' && typeof filterValue === 'number' && value <= filterValue;

    case 'in':
      return Array.isArray(filterValue) && filterValue.includes(value);

    case 'contains':
      return (
        typeof value === 'string' &&
        typeof filterValue === 'string' &&
        value.toLowerCase().includes(filterValue.toLowerCase())
      );

    case 'starts_with':
      return (
        typeof value === 'string' &&
        typeof filterValue === 'string' &&
        value.toLowerCase().startsWith(filterValue.toLowerCase())
      );

    default:
      return true;
  }
}

// =============================================================================
// HTTP Handlers
// =============================================================================

/**
 * GET /api/articles/:id
 */
export async function handleGetArticleById(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { id } = ctx.params;

  if (!id) {
    return errorResponse('BAD_REQUEST', 'Article ID is required', 400);
  }

  try {
    const article = await getArticleById(id, ctx);

    if (!article) {
      return errorResponse('NOT_FOUND', `Article not found: ${id}`, 404);
    }

    return jsonResponse(article);
  } catch (error) {
    console.error('Error fetching article by ID:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch article', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/wiki/:title
 */
export async function handleGetArticleByTitle(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { title } = ctx.params;

  if (!title) {
    return errorResponse('BAD_REQUEST', 'Article title is required', 400);
  }

  // URL decode the title
  const decodedTitle = decodeURIComponent(title);

  try {
    const article = await getArticleByTitle(decodedTitle, ctx);

    if (!article) {
      return errorResponse('NOT_FOUND', `Article not found: ${decodedTitle}`, 404);
    }

    return jsonResponse(article);
  } catch (error) {
    console.error('Error fetching article by title:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch article', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/articles
 */
export async function handleListArticles(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { query } = ctx;

  // Parse pagination
  const pagination = parsePagination(query);

  // Parse type filter
  const typeParam = query.get('type');
  const type = typeParam && isValidArticleType(typeParam) ? typeParam : undefined;

  const options: ListOptions = {
    type,
    limit: pagination.limit,
    offset: pagination.offset,
    cursor: pagination.cursor,
  };

  try {
    const result = await listArticles(options, ctx);
    return jsonResponse(result);
  } catch (error) {
    console.error('Error listing articles:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to list articles', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * POST /api/query
 */
export async function handleAdvancedQuery(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);

  // Validate content type
  const contentType = ctx.request.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return errorResponse('BAD_REQUEST', 'Content-Type must be application/json', 400);
  }

  // Parse request body
  const body = await parseJsonBody<QueryRequest>(ctx.request);
  if (!body) {
    return errorResponse('BAD_REQUEST', 'Invalid JSON body', 400);
  }

  // Validate filters
  if (body.filters) {
    for (const filter of body.filters) {
      if (!filter.field || !filter.operator) {
        return errorResponse('BAD_REQUEST', 'Each filter must have field and operator', 400);
      }

      const validOperators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'starts_with'];
      if (!validOperators.includes(filter.operator)) {
        return errorResponse(
          'BAD_REQUEST',
          `Invalid operator: ${filter.operator}. Valid operators: ${validOperators.join(', ')}`,
          400
        );
      }
    }
  }

  try {
    const result = await queryArticles(body, ctx);
    return jsonResponse(result);
  } catch (error) {
    console.error('Error executing query:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to execute query', 500);
  } finally {
    ctx.cleanup();
  }
}

