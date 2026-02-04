/**
 * Type definitions for the Wikipedia API
 */

import type { ArticleType as StorageArticleType } from '../../storage/types.js';

/** Re-export ArticleType for consistency */
export type ArticleType = StorageArticleType;

/** Environment bindings */
export interface Env {
  R2: R2Bucket;
  AI: Ai;
  AI_GATEWAY_URL: string;
  ENVIRONMENT: 'staging' | 'production';
  /** Comma-separated list of valid API keys */
  API_KEYS?: string;
}

/** Article response from the API */
export interface Article {
  id: string;
  type: ArticleType;
  title: string;
  description: string;
  wikidata_id: string | null;
  coords: { lat: number; lon: number } | null;
  infobox: Record<string, unknown> | null;
  content: string;
  updated_at: string;
}

/** Relationship between articles */
export interface Relationship {
  id: string;
  predicate: string;
  target_id: string;
  target_title: string;
  direction: 'outgoing' | 'incoming';
}

/** Search result */
export interface SearchResult {
  id: string;
  title: string;
  type: ArticleType;
  score: number;
  preview?: string;
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
    cursor?: string;
  };
}

/** List options for articles */
export interface ListOptions {
  type?: ArticleType;
  limit?: number;
  offset?: number;
  cursor?: string;
}

/** Search options */
export interface SearchOptions {
  query: string;
  limit?: number;
  types?: ArticleType[];
  include_preview?: boolean;
}

/** Query filter for advanced queries */
export interface QueryFilter {
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'starts_with';
  value: unknown;
}

/** Advanced query request */
export interface QueryRequest {
  filters?: QueryFilter[];
  type?: ArticleType;
  limit?: number;
  offset?: number;
  order_by?: string;
  order_dir?: 'asc' | 'desc';
}

/** Type statistics */
export interface TypeStats {
  type: ArticleType;
  count: number;
  files: number;
}

/** API error response */
export interface APIError {
  error: string;
  message: string;
  status: number;
  details?: unknown;
}

/** Request context with timing */
export interface RequestContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  startTime: number;
  params: Record<string, string>;
  query: URLSearchParams;
}

/** Route handler function */
export type Handler = (ctx: RequestContext) => Promise<Response>;

/** Manifest file structure */
export interface Manifest {
  version: string;
  created_at: string;
  totalArticles: number;
  articlesByType: Record<ArticleType, number>;
  dataFiles: Array<{
    path: string;
    size: number;
    rowCount: number;
    rowGroups: number;
    type?: ArticleType;
    shard?: number;
  }>;
  forwardRelFiles: Array<{
    path: string;
    size: number;
    rowCount: number;
    rowGroups: number;
  }>;
  reverseRelFiles: Array<{
    path: string;
    size: number;
    rowCount: number;
    rowGroups: number;
  }>;
  indexFiles: {
    titles: string;
    types: string;
    ids?: string;
    bloomFilters: string[];
  };
}

/** Title index entry */
export interface TitleIndexEntry {
  file: string;
  rowGroup: number;
  row: number;
}

/** Title index */
export type TitleIndex = Record<string, TitleIndexEntry>;

/** Type index */
export type TypeIndex = Record<ArticleType, string[]>;

/** ID index entry - location of article by ID */
export interface IDIndexEntry {
  /** Article type */
  type: ArticleType;
  /** Parquet file path */
  file: string;
  /** Row group index within file */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/** Serialized ID index format */
export interface SerializedIDIndex {
  version: string;
  created_at: string;
  count: number;
  entries: Record<string, IDIndexEntry>;
}
