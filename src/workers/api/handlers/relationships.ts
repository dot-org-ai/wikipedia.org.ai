/**
 * Relationship handlers for the Wikipedia API
 *
 * Provides:
 * - Get outgoing relationships (links from an article)
 * - Get incoming relationships (links to an article)
 *
 * Relationship data is sourced from:
 * 1. Pre-computed relationship Parquet files (if available in manifest)
 * 2. On-demand extraction from article content (fallback)
 */

import type {
  Article,
  Relationship,
  RequestContext,
  Manifest,
} from '../types.js';
import { fromBaseContext, type ScopedRequestContext } from '../context.js';
import { R2ParquetReader } from '../r2-reader.js';
import {
  jsonResponse,
  errorResponse,
  parsePagination,
  encodeCursor,
  normalizeTitle,
} from '../middleware.js';

// Cache for title-to-ID lookups (built on demand per request)
// Note: This is request-scoped now, not module-level

/** Forward relationship from Parquet */
interface ForwardRelRecord {
  from_id: string;
  predicate: string;
  to_id: string;
  to_title: string;
}

/** Reverse relationship from Parquet */
interface ReverseRelRecord {
  to_id: string;
  reverse_predicate: string;
  from_id: string;
  from_title: string;
}

/** Extracted link from article content */
interface ExtractedLink {
  targetTitle: string;
  predicate: string;
}

/**
 * Predicate types for relationships
 */
const PREDICATES = {
  LINKS_TO: 'links_to',
  BORN_IN: 'born_in',
  DIED_IN: 'died_in',
  MEMBER_OF: 'member_of',
  CREATED_BY: 'created_by',
  OCCURRED_AT: 'occurred_at',
  LOCATED_IN: 'located_in',
  HEADQUARTERED_AT: 'headquartered_at',
} as const;

/**
 * Reverse predicates mapping
 */
const REVERSE_PREDICATES: Record<string, string> = {
  links_to: 'linked_from',
  born_in: 'birthplace_of',
  died_in: 'deathplace_of',
  member_of: 'has_member',
  created_by: 'creator_of',
  occurred_at: 'event_location',
  located_in: 'contains',
  headquartered_at: 'headquarters_of',
};

/**
 * Build title-to-ID cache from all articles
 * This enables resolving link targets to their IDs
 */
async function buildTitleToIdCache(ctx: ScopedRequestContext): Promise<Map<string, { id: string; title: string }>> {
  const titleToIdCache = new Map<string, { id: string; title: string }>();
  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;
  const manifestData = await manifest.getManifest();

  // Build cache from all data files
  for (const file of manifestData.dataFiles) {
    try {
      const metadata = await reader.getMetadata(file.path);
      for (let rgIndex = 0; rgIndex < metadata.rowGroups.length; rgIndex++) {
        const articles = await reader.readRowGroup(file.path, rgIndex);
        for (const article of articles) {
          const normalized = normalizeTitle(article.title);
          titleToIdCache.set(normalized, { id: article.id, title: article.title });
        }
      }
    } catch (error) {
      console.error(`Error building title cache from ${file.path}:`, error);
    }
  }

  return titleToIdCache;
}

/**
 * Extract links from article content
 */
function extractLinksFromContent(content: string, infobox: Record<string, unknown> | null): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seenTargets = new Set<string>();

  // Extract wiki links from content using regex
  // Pattern: [[Target|Display]] or [[Target]]
  const linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    const matchedTitle = match[1];
    if (!matchedTitle) continue;
    const targetTitle = normalizeWikiTitle(matchedTitle);
    if (targetTitle && !seenTargets.has(targetTitle)) {
      seenTargets.add(targetTitle);
      links.push({
        targetTitle,
        predicate: PREDICATES.LINKS_TO,
      });
    }
  }

  // Extract semantic relationships from infobox
  if (infobox) {
    // Birth place
    const birthPlace = infobox['birth_place'];
    if (birthPlace && typeof birthPlace === 'string') {
      const place = extractPlaceFromText(birthPlace);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.BORN_IN,
        });
      }
    }

    // Death place
    const deathPlace = infobox['death_place'];
    if (deathPlace && typeof deathPlace === 'string') {
      const place = extractPlaceFromText(deathPlace);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.DIED_IN,
        });
      }
    }

    // Organization membership
    const employer = infobox['employer'];
    if (employer && typeof employer === 'string') {
      const org = extractPlaceFromText(employer);
      if (org && !seenTargets.has(org)) {
        seenTargets.add(org);
        links.push({
          targetTitle: org,
          predicate: PREDICATES.MEMBER_OF,
        });
      }
    }

    // Location
    const location = infobox['location'];
    if (location && typeof location === 'string') {
      const place = extractPlaceFromText(location);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.LOCATED_IN,
        });
      }
    }

    // Headquarters
    const headquarters = infobox['headquarters'];
    if (headquarters && typeof headquarters === 'string') {
      const place = extractPlaceFromText(headquarters);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.HEADQUARTERED_AT,
        });
      }
    }

    // Creator/Author
    const creatorFields = ['author', 'creator', 'director', 'composer', 'artist'];
    for (const field of creatorFields) {
      if (infobox[field] && typeof infobox[field] === 'string') {
        const creator = extractPlaceFromText(infobox[field] as string);
        if (creator && !seenTargets.has(creator)) {
          seenTargets.add(creator);
          links.push({
            targetTitle: creator,
            predicate: PREDICATES.CREATED_BY,
          });
        }
      }
    }
  }

  return links;
}

/**
 * Normalize a wiki title
 */
function normalizeWikiTitle(title: string): string | null {
  // Remove leading/trailing whitespace
  let normalized = title.trim();

  // Skip empty titles
  if (!normalized) return null;

  // Skip special namespaces
  if (normalized.includes(':')) {
    const namespace = normalized.split(':')[0]?.toLowerCase() ?? '';
    const skipNamespaces = [
      'file',
      'image',
      'category',
      'template',
      'wikipedia',
      'help',
      'portal',
      'special',
      'mediawiki',
    ];
    if (skipNamespaces.includes(namespace)) {
      return null;
    }
  }

  // Capitalize first letter (Wikipedia convention)
  normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);

  // Replace underscores with spaces
  normalized = normalized.replace(/_/g, ' ');

  return normalized;
}

/**
 * Extract place name from wiki text
 * Handles [[Place]] and plain text
 */
function extractPlaceFromText(text: string): string | null {
  // Check for wiki link
  const linkMatch = text.match(/\[\[([^\]|]+)/);
  if (linkMatch && linkMatch[1]) {
    return normalizeWikiTitle(linkMatch[1]);
  }

  // Use plain text (first part before comma)
  const plainMatch = text.split(',')[0]?.trim();
  return plainMatch || null;
}

/**
 * Get article by ID
 */
async function getArticleById(id: string, ctx: ScopedRequestContext): Promise<Article | null> {
  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;

  // Try O(1) lookup using ID index first
  const location = await manifest.lookupByID(id);

  if (location) {
    try {
      return await reader.readArticle(location.file, location.rowGroup, location.row);
    } catch (error) {
      console.error(`Error reading article from index location:`, error);
    }
  }

  // Fallback: scan through data files
  const manifestData = await manifest.getManifest();

  for (const file of manifestData.dataFiles) {
    try {
      const metadata = await reader.getMetadata(file.path);

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
 * Get outgoing relationships for an article
 *
 * First tries to read from pre-computed relationship files.
 * Falls back to extracting from article content if no relationship files exist.
 */
export async function getOutgoingRelationships(
  id: string,
  ctx: ScopedRequestContext,
  options: { limit?: number; offset?: number; predicate?: string } = {}
): Promise<{ relationships: Relationship[]; total: number }> {
  const manifest = ctx.manifestReader;
  const manifestData = await manifest.getManifest();

  // Check if we have pre-computed relationship files
  if (manifestData.forwardRelFiles && manifestData.forwardRelFiles.length > 0) {
    return getOutgoingFromParquet(id, ctx, manifestData, options);
  }

  // Fall back to extracting from article content
  return getOutgoingFromContent(id, ctx, options);
}

/**
 * Get outgoing relationships from pre-computed Parquet files
 */
async function getOutgoingFromParquet(
  id: string,
  ctx: ScopedRequestContext,
  manifestData: Manifest,
  options: { limit?: number; offset?: number; predicate?: string }
): Promise<{ relationships: Relationship[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const relationships: Relationship[] = [];
  let total = 0;

  for (const file of manifestData.forwardRelFiles) {
    const matches = await searchRelationshipFile(
      file.path,
      'from_id',
      id,
      ctx,
      'outgoing',
      options.predicate
    );

    total += matches.length;

    // Apply pagination
    if (total > offset && relationships.length < limit) {
      const startInBatch = Math.max(0, offset - (total - matches.length));
      const remaining = limit - relationships.length;
      relationships.push(...matches.slice(startInBatch, startInBatch + remaining));
    }
  }

  return { relationships, total };
}

/**
 * Get outgoing relationships by extracting from article content
 */
async function getOutgoingFromContent(
  id: string,
  ctx: ScopedRequestContext,
  options: { limit?: number; offset?: number; predicate?: string }
): Promise<{ relationships: Relationship[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  // Get the article
  const article = await getArticleById(id, ctx);
  if (!article) {
    return { relationships: [], total: 0 };
  }

  // Build title-to-ID cache for resolving link targets
  const titleCache = await buildTitleToIdCache(ctx);

  // Extract links from content
  const links = extractLinksFromContent(
    article.content,
    article.infobox as Record<string, unknown> | null
  );

  // Filter by predicate if specified
  let filteredLinks = links;
  if (options.predicate) {
    filteredLinks = links.filter((link) => link.predicate === options.predicate);
  }

  // Convert to relationships with resolved IDs
  const allRelationships: Relationship[] = [];
  for (const link of filteredLinks) {
    const normalized = normalizeTitle(link.targetTitle);
    const target = titleCache.get(normalized);

    // Include relationship even if target not found in our dataset
    // (external links are still valid outgoing relationships)
    allRelationships.push({
      id: article.id,
      predicate: link.predicate,
      target_id: target?.id ?? '',
      target_title: target?.title ?? link.targetTitle,
      direction: 'outgoing',
    });
  }

  // Apply pagination
  const total = allRelationships.length;
  const paginatedRelationships = allRelationships.slice(offset, offset + limit);

  return { relationships: paginatedRelationships, total };
}

/**
 * Get incoming relationships for an article
 *
 * First tries to read from pre-computed relationship files.
 * Falls back to scanning all articles for backlinks if no relationship files exist.
 */
export async function getIncomingRelationships(
  id: string,
  ctx: ScopedRequestContext,
  options: { limit?: number; offset?: number; predicate?: string } = {}
): Promise<{ relationships: Relationship[]; total: number }> {
  const manifest = ctx.manifestReader;
  const manifestData = await manifest.getManifest();

  // Check if we have pre-computed relationship files
  if (manifestData.reverseRelFiles && manifestData.reverseRelFiles.length > 0) {
    return getIncomingFromParquet(id, ctx, manifestData, options);
  }

  // Fall back to scanning all articles for backlinks
  return getIncomingFromContent(id, ctx, options);
}

/**
 * Get incoming relationships from pre-computed Parquet files
 */
async function getIncomingFromParquet(
  id: string,
  ctx: ScopedRequestContext,
  manifestData: Manifest,
  options: { limit?: number; offset?: number; predicate?: string }
): Promise<{ relationships: Relationship[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const relationships: Relationship[] = [];
  let total = 0;

  for (const file of manifestData.reverseRelFiles) {
    const matches = await searchRelationshipFile(
      file.path,
      'to_id',
      id,
      ctx,
      'incoming',
      options.predicate
    );

    total += matches.length;

    // Apply pagination
    if (total > offset && relationships.length < limit) {
      const startInBatch = Math.max(0, offset - (total - matches.length));
      const remaining = limit - relationships.length;
      relationships.push(...matches.slice(startInBatch, startInBatch + remaining));
    }
  }

  return { relationships, total };
}

/**
 * Get incoming relationships by scanning all articles for backlinks
 * This is computationally expensive but necessary when no pre-computed index exists
 */
async function getIncomingFromContent(
  id: string,
  ctx: ScopedRequestContext,
  options: { limit?: number; offset?: number; predicate?: string }
): Promise<{ relationships: Relationship[]; total: number }> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  // First, get the target article to know its title
  const targetArticle = await getArticleById(id, ctx);
  if (!targetArticle) {
    return { relationships: [], total: 0 };
  }

  const targetTitleNormalized = normalizeTitle(targetArticle.title);

  const reader = ctx.parquetReader;
  const manifest = ctx.manifestReader;
  const manifestData = await manifest.getManifest();

  const allRelationships: Relationship[] = [];

  // Scan all articles for links to our target
  for (const file of manifestData.dataFiles) {
    try {
      const metadata = await reader.getMetadata(file.path);

      for (let rgIndex = 0; rgIndex < metadata.rowGroups.length; rgIndex++) {
        const articles = await reader.readRowGroup(file.path, rgIndex);

        for (const article of articles) {
          // Skip self-references
          if (article.id === id) continue;

          // Extract links from this article
          const links = extractLinksFromContent(
            article.content,
            article.infobox as Record<string, unknown> | null
          );

          // Check if any link points to our target
          for (const link of links) {
            const linkTitleNormalized = normalizeTitle(link.targetTitle);

            if (linkTitleNormalized === targetTitleNormalized) {
              // Filter by predicate if specified
              const reversePredicate = REVERSE_PREDICATES[link.predicate] ?? `reverse_${link.predicate}`;

              if (!options.predicate || reversePredicate === options.predicate) {
                allRelationships.push({
                  id: targetArticle.id,
                  predicate: reversePredicate,
                  target_id: article.id,
                  target_title: article.title,
                  direction: 'incoming',
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning file ${file.path} for backlinks:`, error);
      continue;
    }
  }

  // Apply pagination
  const total = allRelationships.length;
  const paginatedRelationships = allRelationships.slice(offset, offset + limit);

  return { relationships: paginatedRelationships, total };
}

/**
 * Search a relationship Parquet file using the R2ParquetReader
 */
async function searchRelationshipFile(
  file: string,
  _keyField: string,
  keyValue: string,
  ctx: ScopedRequestContext,
  direction: 'outgoing' | 'incoming',
  predicateFilter?: string
): Promise<Relationship[]> {
  const reader = ctx.parquetReader;
  const relationships: Relationship[] = [];

  try {
    const metadata = await reader.getMetadata(file);

    // Read each row group and filter
    for (let rgIndex = 0; rgIndex < metadata.rowGroups.length; rgIndex++) {
      const records = await readRelationshipRowGroup(reader, file, rgIndex, direction);

      // Filter by key
      for (const record of records) {
        if (direction === 'outgoing') {
          const fwdRecord = record as ForwardRelRecord;
          if (fwdRecord.from_id === keyValue) {
            if (!predicateFilter || fwdRecord.predicate === predicateFilter) {
              relationships.push({
                id: fwdRecord.from_id,
                predicate: fwdRecord.predicate,
                target_id: fwdRecord.to_id,
                target_title: fwdRecord.to_title,
                direction: 'outgoing',
              });
            }
          }
        } else {
          const revRecord = record as ReverseRelRecord;
          if (revRecord.to_id === keyValue) {
            if (!predicateFilter || revRecord.reverse_predicate === predicateFilter) {
              relationships.push({
                id: revRecord.to_id,
                predicate: revRecord.reverse_predicate,
                target_id: revRecord.from_id,
                target_title: revRecord.from_title,
                direction: 'incoming',
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error reading relationship file ${file}:`, error);
  }

  return relationships;
}

/**
 * Read relationship records from a row group
 * Uses a dedicated method to parse relationship-specific columns
 */
async function readRelationshipRowGroup(
  reader: R2ParquetReader,
  file: string,
  rowGroupIndex: number,
  direction: 'outgoing' | 'incoming'
): Promise<(ForwardRelRecord | ReverseRelRecord)[]> {
  // Use the reader's generic row group reading capability
  // The R2ParquetReader already has column parsing logic we can leverage

  // For relationship files, we read the raw column data
  const metadata = await reader.getMetadata(file);

  if (rowGroupIndex < 0 || rowGroupIndex >= metadata.rowGroups.length) {
    return [];
  }

  const rowGroup = metadata.rowGroups[rowGroupIndex];
  if (!rowGroup) {
    return [];
  }

  // Read raw data using range requests
  const records: (ForwardRelRecord | ReverseRelRecord)[] = [];

  // Parse columns based on direction
  // The column structure matches what's defined in the schema
  const columnData = await readRelationshipColumns(reader, file, rowGroupIndex, direction);

  if (direction === 'outgoing') {
    const fromIds = columnData.get('from_id') ?? [];
    const predicates = columnData.get('predicate') ?? [];
    const toIds = columnData.get('to_id') ?? [];
    const toTitles = columnData.get('to_title') ?? [];

    for (let i = 0; i < fromIds.length; i++) {
      records.push({
        from_id: fromIds[i] as string,
        predicate: predicates[i] as string,
        to_id: toIds[i] as string,
        to_title: toTitles[i] as string,
      });
    }
  } else {
    const toIds = columnData.get('to_id') ?? [];
    const reversePredicates = columnData.get('reverse_predicate') ?? [];
    const fromIds = columnData.get('from_id') ?? [];
    const fromTitles = columnData.get('from_title') ?? [];

    for (let i = 0; i < toIds.length; i++) {
      records.push({
        to_id: toIds[i] as string,
        reverse_predicate: reversePredicates[i] as string,
        from_id: fromIds[i] as string,
        from_title: fromTitles[i] as string,
      });
    }
  }

  return records;
}

/**
 * Read relationship columns from a Parquet file
 * This wraps the reader's internal column parsing
 */
async function readRelationshipColumns(
  reader: R2ParquetReader,
  file: string,
  rowGroupIndex: number,
  direction: 'outgoing' | 'incoming'
): Promise<Map<string, unknown[]>> {
  // The R2ParquetReader has internal methods for reading columns
  // We need to use its public interface or extend it

  // For now, we use a simplified approach that reads the entire row group
  // This matches the article reading pattern

  const columnData = new Map<string, unknown[]>();

  try {
    // Attempt to use the reader's internal column parsing
    // by reading at the file level
    const articles = await reader.readRowGroup(file, rowGroupIndex) as unknown[];

    // The readRowGroup method returns Article objects for data files
    // For relationship files, we need to handle the different schema
    // Check if this is relationship data by inspecting the first record
    if (articles.length > 0) {
      const firstRecord = articles[0] as Record<string, unknown>;

      if (direction === 'outgoing' && 'from_id' in firstRecord) {
        // This is forward relationship data
        columnData.set('from_id', articles.map((r: unknown) => (r as ForwardRelRecord).from_id));
        columnData.set('predicate', articles.map((r: unknown) => (r as ForwardRelRecord).predicate));
        columnData.set('to_id', articles.map((r: unknown) => (r as ForwardRelRecord).to_id));
        columnData.set('to_title', articles.map((r: unknown) => (r as ForwardRelRecord).to_title));
      } else if (direction === 'incoming' && 'to_id' in firstRecord) {
        // This is reverse relationship data
        columnData.set('to_id', articles.map((r: unknown) => (r as ReverseRelRecord).to_id));
        columnData.set('reverse_predicate', articles.map((r: unknown) => (r as ReverseRelRecord).reverse_predicate));
        columnData.set('from_id', articles.map((r: unknown) => (r as ReverseRelRecord).from_id));
        columnData.set('from_title', articles.map((r: unknown) => (r as ReverseRelRecord).from_title));
      }
    }
  } catch (error) {
    // If reading fails (e.g., schema mismatch), return empty
    console.error(`Error reading relationship columns from ${file}:`, error);
  }

  return columnData;
}

// =============================================================================
// HTTP Handlers
// =============================================================================

/**
 * GET /api/relationships/:id
 */
export async function handleGetRelationships(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { id } = ctx.params;
  const { query } = ctx;

  if (!id) {
    return errorResponse('BAD_REQUEST', 'Article ID is required', 400);
  }

  // Parse direction
  const direction = query.get('direction') ?? 'both';
  if (!['outgoing', 'incoming', 'both'].includes(direction)) {
    return errorResponse(
      'BAD_REQUEST',
      'Direction must be "outgoing", "incoming", or "both"',
      400
    );
  }

  // Parse pagination
  const pagination = parsePagination(query);

  // Parse optional predicate filter
  const predicateParam = query.get('predicate');

  // Build options object, only including predicate if defined
  const options: { limit: number; offset: number; predicate?: string } = {
    limit: pagination.limit,
    offset: pagination.offset,
  };
  if (predicateParam) {
    options.predicate = predicateParam;
  }

  try {
    let outgoing: { relationships: Relationship[]; total: number } = {
      relationships: [],
      total: 0,
    };
    let incoming: { relationships: Relationship[]; total: number } = {
      relationships: [],
      total: 0,
    };

    if (direction === 'outgoing' || direction === 'both') {
      outgoing = await getOutgoingRelationships(id, ctx, options);
    }

    if (direction === 'incoming' || direction === 'both') {
      incoming = await getIncomingRelationships(id, ctx, options);
    }

    const total = outgoing.total + incoming.total;
    const relationships = [...outgoing.relationships, ...incoming.relationships];
    const hasMore = pagination.offset + relationships.length < total;

    return jsonResponse({
      id,
      direction,
      data: relationships,
      pagination: {
        total,
        limit: pagination.limit,
        offset: pagination.offset,
        has_more: hasMore,
        cursor: hasMore ? encodeCursor(pagination.offset + relationships.length) : undefined,
      },
      outgoing_count: outgoing.total,
      incoming_count: incoming.total,
    });
  } catch (error) {
    console.error('Error fetching relationships:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch relationships', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/relationships/:id/outgoing
 */
export async function handleGetOutgoingRelationships(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { id } = ctx.params;
  const { query } = ctx;

  if (!id) {
    return errorResponse('BAD_REQUEST', 'Article ID is required', 400);
  }

  const pagination = parsePagination(query);
  const predicateParam = query.get('predicate');

  const options: { limit: number; offset: number; predicate?: string } = {
    limit: pagination.limit,
    offset: pagination.offset,
  };
  if (predicateParam) {
    options.predicate = predicateParam;
  }

  try {
    const { relationships, total } = await getOutgoingRelationships(id, ctx, options);
    const hasMore = pagination.offset + relationships.length < total;

    return jsonResponse({
      id,
      direction: 'outgoing',
      data: relationships,
      pagination: {
        total,
        limit: pagination.limit,
        offset: pagination.offset,
        has_more: hasMore,
        cursor: hasMore ? encodeCursor(pagination.offset + relationships.length) : undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching outgoing relationships:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch relationships', 500);
  } finally {
    ctx.cleanup();
  }
}

/**
 * GET /api/relationships/:id/incoming
 */
export async function handleGetIncomingRelationships(baseCtx: RequestContext): Promise<Response> {
  const ctx = fromBaseContext(baseCtx);
  const { id } = ctx.params;
  const { query } = ctx;

  if (!id) {
    return errorResponse('BAD_REQUEST', 'Article ID is required', 400);
  }

  const pagination = parsePagination(query);
  const predicateParam = query.get('predicate');

  const options: { limit: number; offset: number; predicate?: string } = {
    limit: pagination.limit,
    offset: pagination.offset,
  };
  if (predicateParam) {
    options.predicate = predicateParam;
  }

  try {
    const { relationships, total } = await getIncomingRelationships(id, ctx, options);
    const hasMore = pagination.offset + relationships.length < total;

    return jsonResponse({
      id,
      direction: 'incoming',
      data: relationships,
      pagination: {
        total,
        limit: pagination.limit,
        offset: pagination.offset,
        has_more: hasMore,
        cursor: hasMore ? encodeCursor(pagination.offset + relationships.length) : undefined,
      },
    });
  } catch (error) {
    console.error('Error fetching incoming relationships:', error);
    return errorResponse('INTERNAL_ERROR', 'Failed to fetch relationships', 500);
  } finally {
    ctx.cleanup();
  }
}
