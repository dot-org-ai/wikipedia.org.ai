/**
 * Type definitions for the Wikipedia Parquet storage layer
 */

import type { SchemaElement } from '@dotdo/hyparquet';

// Re-export shared types for convenience
export { ARTICLE_TYPES } from '../shared/types.js';
export type { ArticleType } from '../shared/types.js';
import type { ArticleType } from '../shared/types.js';

/**
 * Core article record for Parquet storage
 * Uses shredded columns for fast filtering + Variant for flexible infobox
 */
export interface ArticleRecord {
  /** Unique article ID (ULID) */
  $id: string;
  /** Article type for partitioning */
  $type: ArticleType;
  /** Article title */
  title: string;
  /** First paragraph description */
  description: string;
  /** Wikidata Q-number if available */
  wikidata_id: string | null;
  /** Latitude for places */
  coords_lat: number | null;
  /** Longitude for places */
  coords_lon: number | null;
  /** Infobox data (heterogeneous per type) - stored as Variant */
  infobox: Record<string, unknown> | null;
  /** Full plaintext content */
  content: string;
  /** Last update timestamp */
  updated_at: Date;
}

/**
 * Common infobox fields to shred for statistics
 * These fields appear across multiple article types
 */
export interface ShreddedInfoboxFields {
  /** Birth date for persons */
  birth_date?: string;
  /** Death date for persons */
  death_date?: string;
  /** Country for places/orgs */
  country?: string;
  /** Population for places */
  population?: number;
  /** Founded date for orgs */
  founded?: string;
  /** Release date for works */
  release_date?: string;
  /** Start date for events */
  start_date?: string;
  /** End date for events */
  end_date?: string;
}

/** Fields to shred from infobox for predicate pushdown */
export const SHREDDED_INFOBOX_FIELDS: readonly string[] = [
  'birth_date',
  'death_date',
  'country',
  'population',
  'founded',
  'release_date',
  'start_date',
  'end_date',
] as const;

/**
 * Fields to shred from $data VARIANT column for predicate pushdown.
 *
 * These are "hot" filter fields commonly used in WHERE clauses:
 * - title: Article title lookups
 * - $type: Type-based filtering (person, place, org, etc.)
 * - wikidata_id: Wikidata Q-number lookups
 * - updated_at: Time-based filtering (lastmod)
 *
 * The $data column stores the full article as VARIANT for fast SELECT *,
 * while these shredded columns enable statistics-based row group skipping.
 */
export const VARIANT_SHRED_FIELDS: readonly string[] = [
  'title',
  '$type',
  'wikidata_id',
  'updated_at',
] as const;

/**
 * Forward relationship record
 * Links from source article to target
 */
export interface ForwardRelationship {
  /** Source article ID (ULID) */
  from_id: string;
  /** Relationship predicate (e.g., 'links_to', 'born_in', 'member_of') */
  predicate: string;
  /** Target article ID (ULID) */
  to_id: string;
  /** Target article title (for display without lookup) */
  to_title: string;
}

/**
 * Reverse relationship record
 * Links from target article back to sources
 */
export interface ReverseRelationship {
  /** Target article ID (ULID) */
  to_id: string;
  /** Reverse predicate (e.g., 'linked_from', 'birthplace_of') */
  reverse_predicate: string;
  /** Source article ID (ULID) */
  from_id: string;
  /** Source article title (for display without lookup) */
  from_title: string;
}

/**
 * Title lookup index entry
 * Maps article title to file location
 */
export interface TitleIndexEntry {
  /** Parquet file path */
  file: string;
  /** Row group index within file */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/**
 * Title lookup index
 * Maps normalized titles to file locations
 */
export type TitleIndex = Record<string, TitleIndexEntry>;

/**
 * Type index
 * Maps article types to their partition files
 */
export type TypeIndex = Record<ArticleType, string[]>;

/**
 * Manifest entry for a single Parquet file
 */
export interface ManifestFile {
  /** Relative file path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Number of rows in file */
  rowCount: number;
  /** Number of row groups */
  rowGroups: number;
  /** Article type (for data files) */
  type?: ArticleType;
  /** Shard number within type */
  shard?: number;
}

/**
 * Complete manifest for the dataset
 */
export interface Manifest {
  /** Schema version */
  version: string;
  /** Creation timestamp */
  created_at: string;
  /** Total article count */
  totalArticles: number;
  /** Article count by type */
  articlesByType: Record<ArticleType, number>;
  /** Data partition files */
  dataFiles: ManifestFile[];
  /** Forward relationship files */
  forwardRelFiles: ManifestFile[];
  /** Reverse relationship files */
  reverseRelFiles: ManifestFile[];
  /** Index files */
  indexFiles: {
    titles: string;
    types: string;
    ids?: string;
    bloomFilters: string[];
  };
}

/**
 * Configuration for ArticleParquetWriter
 */
export interface ArticleWriterConfig {
  /** Output directory for Parquet files */
  outputDir: string;
  /** Target row group size (rows per group) */
  rowGroupSize?: number;
  /** Maximum file size in bytes (default: 25MB) */
  maxFileSize?: number;
  /** Enable column statistics (default: true) */
  statistics?: boolean;
  /** Enable bloom filters (default: true) */
  bloomFilters?: boolean;
}

/**
 * Configuration for VariantArticleWriter
 *
 * Uses VARIANT shredding approach where:
 * - $data column stores full article as VARIANT (fast SELECT *)
 * - Hot filter fields are shredded for statistics-based row group skipping
 */
export interface VariantWriterConfig extends ArticleWriterConfig {
  /**
   * Fields to shred from the article for predicate pushdown.
   * Defaults to VARIANT_SHRED_FIELDS: ['title', '$type', 'wikidata_id', 'updated_at']
   */
  shredFields?: readonly string[];
}

/**
 * File limit warning thresholds
 */
export interface FileLimitThresholds {
  /** Warn at this count (default: 50,000) */
  warnAt?: number;
  /** Second warning at this count (default: 75,000) */
  warnHighAt?: number;
  /** Critical warning at this count (default: 90,000) */
  criticalAt?: number;
  /** Error at this count (default: 100,000) */
  maxFiles?: number;
}

/**
 * File limit warning callback
 */
export type FileLimitWarningCallback = (
  currentCount: number,
  threshold: number,
  level: 'warn' | 'warn-high' | 'critical' | 'error',
  suggestion?: string
) => void;

/**
 * Configuration for PartitionedWriter
 */
export interface PartitionedWriterConfig extends ArticleWriterConfig {
  /** Base path for data partitions */
  dataPath?: string;
  /** File limit thresholds for Cloudflare Workers 100k limit */
  fileLimits?: FileLimitThresholds;
  /** Callback for file limit warnings (defaults to console.warn/error) */
  onFileLimitWarning?: FileLimitWarningCallback;
}

/**
 * Configuration for RelationshipWriter
 */
export interface RelationshipWriterConfig {
  /** Output directory */
  outputDir: string;
  /** Row group size */
  rowGroupSize?: number;
  /** Maximum file size in bytes */
  maxFileSize?: number;
}

/**
 * Bloom filter configuration
 */
export interface BloomFilterConfig {
  /** Expected number of items */
  expectedItems: number;
  /** Target false positive rate (default: 0.01) */
  falsePositiveRate?: number;
}

/**
 * Bloom filter data for a file
 */
export interface FileBloomFilter {
  /** File path */
  file: string;
  /** Bloom filter bit array (base64 encoded) */
  filter: string;
  /** Number of hash functions used */
  hashCount: number;
  /** Filter size in bits */
  bitCount: number;
}

/**
 * Article Parquet schema elements
 */
export const ARTICLE_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 10 },
  { name: '$id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: '$type', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'title', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'description', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'wikidata_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
  { name: 'coords_lat', type: 'FLOAT', repetition_type: 'OPTIONAL' },
  { name: 'coords_lon', type: 'FLOAT', repetition_type: 'OPTIONAL' },
  // infobox is a shredded VARIANT column - schema built dynamically
  { name: 'content', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'updated_at', type: 'INT64', converted_type: 'TIMESTAMP_MILLIS', repetition_type: 'REQUIRED' },
];

/**
 * Forward relationship Parquet schema
 */
export const FORWARD_REL_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 4 },
  { name: 'from_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'predicate', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'to_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'to_title', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
];

/**
 * Reverse relationship Parquet schema
 */
export const REVERSE_REL_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 4 },
  { name: 'to_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'reverse_predicate', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'from_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'from_title', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
];

/**
 * Write result from a Parquet writer
 */
export interface WriteResult {
  /** Output file path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Number of rows written */
  rowCount: number;
  /** Number of row groups */
  rowGroups: number;
}

/**
 * Batch of articles to write
 */
export interface ArticleBatch {
  /** Articles to write */
  articles: ArticleRecord[];
  /** Flush buffer after this batch */
  flush?: boolean;
}

/**
 * Predicate types for relationships
 */
export const PREDICATES = {
  /** Generic link */
  LINKS_TO: 'links_to',
  /** Person born in place */
  BORN_IN: 'born_in',
  /** Person died in place */
  DIED_IN: 'died_in',
  /** Person member of org */
  MEMBER_OF: 'member_of',
  /** Work created by person */
  CREATED_BY: 'created_by',
  /** Event occurred at place */
  OCCURRED_AT: 'occurred_at',
  /** Place located in place */
  LOCATED_IN: 'located_in',
  /** Org headquartered at place */
  HEADQUARTERED_AT: 'headquartered_at',
} as const;

/**
 * Reverse predicates mapping
 */
export const REVERSE_PREDICATES: Record<string, string> = {
  links_to: 'linked_from',
  born_in: 'birthplace_of',
  died_in: 'deathplace_of',
  member_of: 'has_member',
  created_by: 'creator_of',
  occurred_at: 'event_location',
  located_in: 'contains',
  headquartered_at: 'headquarters_of',
};
