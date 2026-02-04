/**
 * Shared type definitions for the Wikipedia project
 *
 * This is the single source of truth for common types used across modules.
 */

/**
 * Article type classification for content categorization and partitioning.
 *
 * Used for:
 * - Storage partitioning (Parquet files organized by type)
 * - Search filtering (filter by article type)
 * - Embeddings organization (partition embeddings by type)
 *
 * Values:
 * - 'person': Biographical articles about individuals
 * - 'place': Geographic locations (cities, countries, landmarks)
 * - 'org': Organizations (companies, institutions, groups)
 * - 'work': Creative works (books, films, albums, games)
 * - 'event': Historical events, incidents, occasions
 * - 'other': Articles that don't fit other categories
 */
export type ArticleType = 'person' | 'place' | 'org' | 'work' | 'event' | 'other';

/**
 * All valid article types as a readonly array.
 *
 * Useful for:
 * - Iteration over all types
 * - Runtime validation
 * - UI dropdowns/filters
 */
export const ARTICLE_TYPES: readonly ArticleType[] = [
  'person',
  'place',
  'org',
  'work',
  'event',
  'other',
] as const;

/**
 * Type guard to check if a string is a valid ArticleType.
 *
 * @param type - The string to check
 * @returns True if the string is a valid ArticleType
 */
export function isValidArticleType(type: string): type is ArticleType {
  return ARTICLE_TYPES.includes(type as ArticleType);
}

/**
 * Wikipedia page type classification based on namespace/structure.
 *
 * This is distinct from ArticleType - it describes the Wikipedia page structure,
 * not the content classification. Used for filtering during ingestion.
 *
 * Values:
 * - 'article': Regular encyclopedia article (namespace 0)
 * - 'category': Category page (namespace 14)
 * - 'disambiguation': Disambiguation page
 * - 'redirect': Redirect page
 * - 'template': Template page (namespace 10)
 * - 'file': File/media page (namespace 6)
 * - 'portal': Portal page (namespace 100)
 * - 'other': Other page types
 */
export type PageType =
  | 'article'
  | 'category'
  | 'disambiguation'
  | 'redirect'
  | 'template'
  | 'file'
  | 'portal'
  | 'other';

/**
 * All valid page types as a readonly array.
 */
export const PAGE_TYPES: readonly PageType[] = [
  'article',
  'category',
  'disambiguation',
  'redirect',
  'template',
  'file',
  'portal',
  'other',
] as const;
