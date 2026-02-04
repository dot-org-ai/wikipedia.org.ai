// @ts-nocheck - Complex Parquet schema operations with hyparquet-writer
/**
 * Export Format Writers
 *
 * Generates multiple Parquet files optimized for different use cases:
 * 1. wikipedia-full.parquet - Full articles with VARIANT infobox
 * 2. wikipedia-infoboxes.parquet - Infobox data by type
 * 3. wikipedia-{type}.parquet - Type-specific schemas
 * 4. wikipedia-index.parquet - Minimal search/browse index
 */

import {
  parquetWriteBuffer,
  createShreddedVariantColumn,
} from '@dotdo/hyparquet-writer';
import type { SchemaElement } from '@dotdo/hyparquet';
import type { ArticleRecord, ArticleType, WriteResult } from './types.js';
import { ARTICLE_TYPES, SHREDDED_INFOBOX_FIELDS } from './types.js';

/** Default page size for Parquet files */
const DEFAULT_PAGE_SIZE = 1024 * 1024; // 1MB

/** Export format types */
export type ExportFormat = 'full' | 'infoboxes' | 'index' | ArticleType;

/** Export writer configuration */
export interface ExportWriterConfig {
  /** Output directory for exported files */
  outputDir: string;
  /** Row group size (rows per group) */
  rowGroupSize?: number;
  /** Enable column statistics */
  statistics?: boolean;
  /** Enable bloom filters */
  bloomFilters?: boolean;
}

/** Export result for a single format */
export interface ExportResult {
  /** Export format name */
  format: string;
  /** Output file path */
  path: string;
  /** File size in bytes */
  size: number;
  /** Number of rows written */
  rowCount: number;
  /** Row groups written */
  rowGroups: number;
}

/**
 * Write wikipedia-full.parquet
 *
 * Contains all article data with:
 * - Shredded columns: $id, $type, title, pageid, lastmod
 * - VARIANT column for infobox with common fields shredded
 * - Full content and all metadata
 */
export async function writeFullFormat(
  articles: ArticleRecord[],
  config: ExportWriterConfig
): Promise<ExportResult> {
  const { outputDir, rowGroupSize = 10000, statistics = true } = config;

  // Extract infobox objects for shredding
  const infoboxes = articles.map((a) => a.infobox ?? {});

  // Create shredded variant column for infobox
  const { schema: infoboxSchema } = createShreddedVariantColumn(
    'infobox',
    infoboxes,
    [...SHREDDED_INFOBOX_FIELDS],
    {
      nullable: true,
      fieldTypes: {
        population: 'INT64',
      },
    }
  );

  // Build complete schema with shredded columns
  // Root element with all children
  const baseChildCount = 10; // $id, $type, title, pageid, description, wikidata_id, coords_lat, coords_lon, content, lastmod
  const schema: SchemaElement[] = [
    { name: 'root', num_children: baseChildCount + 1 }, // +1 for infobox group
    {
      name: '$id',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: '$type',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'title',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'pageid',
      type: 'INT64',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'description',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'wikidata_id',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    { name: 'coords_lat', type: 'FLOAT', repetition_type: 'OPTIONAL' },
    { name: 'coords_lon', type: 'FLOAT', repetition_type: 'OPTIONAL' },
    // Infobox shredded variant schema
    ...infoboxSchema,
    {
      name: 'content',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'lastmod',
      type: 'INT64',
      converted_type: 'TIMESTAMP_MILLIS',
      repetition_type: 'REQUIRED',
    },
  ];

  // Build column data arrays
  const columnData = [
    { name: '$id', data: articles.map((a) => a.$id) },
    { name: '$type', data: articles.map((a) => a.$type) },
    { name: 'title', data: articles.map((a) => a.title) },
    { name: 'pageid', data: articles.map((a) => parseInt(a.$id, 10) || 0) },
    { name: 'description', data: articles.map((a) => a.description) },
    { name: 'wikidata_id', data: articles.map((a) => a.wikidata_id) },
    { name: 'coords_lat', data: articles.map((a) => a.coords_lat) },
    { name: 'coords_lon', data: articles.map((a) => a.coords_lon) },
    { name: 'infobox', data: infoboxes },
    { name: 'content', data: articles.map((a) => a.content) },
    {
      name: 'lastmod',
      data: articles.map((a) => {
        const date =
          a.updated_at instanceof Date
            ? a.updated_at
            : new Date(a.updated_at as unknown as string);
        return isNaN(date.getTime()) ? new Date() : date;
      }),
    },
  ];

  const buffer = parquetWriteBuffer({
    columnData,
    schema,
    statistics,
    rowGroupSize,
    pageSize: DEFAULT_PAGE_SIZE,
    kvMetadata: [
      { key: 'writer', value: 'wikipedia.org.ai' },
      { key: 'version', value: '1.0.0' },
      { key: 'format', value: 'full' },
    ],
  });

  const path = `${outputDir}/wikipedia-full.parquet`;
  await writeToFile(path, buffer);

  return {
    format: 'full',
    path,
    size: buffer.byteLength,
    rowCount: articles.length,
    rowGroups: Math.ceil(articles.length / rowGroupSize),
  };
}

/**
 * Infobox record for wikipedia-infoboxes.parquet
 */
interface InfoboxRecord {
  /** Article ID */
  article_id: string;
  /** Article title */
  title: string;
  /** Infobox type (e.g., 'person', 'settlement') */
  infobox_type: string;
  /** Infobox data as JSON */
  data: string;
  /** Common shredded fields */
  birth_date: string | null;
  death_date: string | null;
  country: string | null;
  population: number | null;
  founded: string | null;
  release_date: string | null;
  start_date: string | null;
  end_date: string | null;
}

/**
 * Write wikipedia-infoboxes.parquet
 *
 * Contains infobox data organized by type with:
 * - Columnar storage for fast analytical scans
 * - Shredded common fields for predicate pushdown
 * - JSON blob for full infobox access
 */
export async function writeInfoboxesFormat(
  articles: ArticleRecord[],
  config: ExportWriterConfig
): Promise<ExportResult> {
  const { outputDir, rowGroupSize = 10000, statistics = true } = config;

  // Extract infobox records from articles
  const infoboxRecords: InfoboxRecord[] = [];

  for (const article of articles) {
    if (!article.infobox) continue;

    const infobox = article.infobox as Record<string, unknown>;
    const infoboxType = (infobox._type as string) || 'unknown';

    infoboxRecords.push({
      article_id: article.$id,
      title: article.title,
      infobox_type: infoboxType,
      data: JSON.stringify(infobox),
      birth_date: extractString(infobox, 'birth_date'),
      death_date: extractString(infobox, 'death_date'),
      country: extractString(infobox, 'country'),
      population: extractNumber(infobox, 'population'),
      founded: extractString(infobox, 'founded'),
      release_date: extractString(infobox, 'release_date'),
      start_date: extractString(infobox, 'start_date'),
      end_date: extractString(infobox, 'end_date'),
    });
  }

  if (infoboxRecords.length === 0) {
    // Create empty file with schema
    infoboxRecords.push({
      article_id: '',
      title: '',
      infobox_type: '',
      data: '{}',
      birth_date: null,
      death_date: null,
      country: null,
      population: null,
      founded: null,
      release_date: null,
      start_date: null,
      end_date: null,
    });
  }

  const schema: SchemaElement[] = [
    { name: 'root', num_children: 12 },
    {
      name: 'article_id',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'title',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'infobox_type',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'data',
      type: 'BYTE_ARRAY',
      converted_type: 'JSON',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'birth_date',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    {
      name: 'death_date',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    {
      name: 'country',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    { name: 'population', type: 'INT64', repetition_type: 'OPTIONAL' },
    {
      name: 'founded',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    {
      name: 'release_date',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    {
      name: 'start_date',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
    {
      name: 'end_date',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'OPTIONAL',
    },
  ];

  const columnData = [
    { name: 'article_id', data: infoboxRecords.map((r) => r.article_id) },
    { name: 'title', data: infoboxRecords.map((r) => r.title) },
    { name: 'infobox_type', data: infoboxRecords.map((r) => r.infobox_type) },
    { name: 'data', data: infoboxRecords.map((r) => r.data) },
    { name: 'birth_date', data: infoboxRecords.map((r) => r.birth_date) },
    { name: 'death_date', data: infoboxRecords.map((r) => r.death_date) },
    { name: 'country', data: infoboxRecords.map((r) => r.country) },
    { name: 'population', data: infoboxRecords.map((r) => r.population) },
    { name: 'founded', data: infoboxRecords.map((r) => r.founded) },
    { name: 'release_date', data: infoboxRecords.map((r) => r.release_date) },
    { name: 'start_date', data: infoboxRecords.map((r) => r.start_date) },
    { name: 'end_date', data: infoboxRecords.map((r) => r.end_date) },
  ];

  const buffer = parquetWriteBuffer({
    columnData,
    schema,
    statistics,
    rowGroupSize,
    pageSize: DEFAULT_PAGE_SIZE,
    kvMetadata: [
      { key: 'writer', value: 'wikipedia.org.ai' },
      { key: 'version', value: '1.0.0' },
      { key: 'format', value: 'infoboxes' },
    ],
  });

  const path = `${outputDir}/wikipedia-infoboxes.parquet`;
  await writeToFile(path, buffer);

  return {
    format: 'infoboxes',
    path,
    size: buffer.byteLength,
    rowCount: infoboxRecords.length,
    rowGroups: Math.ceil(infoboxRecords.length / rowGroupSize),
  };
}

/**
 * Write wikipedia-index.parquet
 *
 * Minimal file for search/browse with:
 * - id, title, type, description (first paragraph)
 * - Small file size for fast loading
 * - Optimized for title lookups and autocomplete
 */
export async function writeIndexFormat(
  articles: ArticleRecord[],
  config: ExportWriterConfig
): Promise<ExportResult> {
  const { outputDir, rowGroupSize = 50000, statistics = true } = config;

  // Extract first sentence/paragraph for description
  const descriptions = articles.map((a) => {
    const desc = a.description || '';
    // Limit to ~200 chars for compact index
    if (desc.length <= 200) return desc;
    const truncated = desc.slice(0, 200);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 100 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
  });

  const schema: SchemaElement[] = [
    { name: 'root', num_children: 4 },
    {
      name: 'id',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'title',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'type',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
    {
      name: 'description',
      type: 'BYTE_ARRAY',
      converted_type: 'UTF8',
      repetition_type: 'REQUIRED',
    },
  ];

  const columnData = [
    { name: 'id', data: articles.map((a) => a.$id) },
    { name: 'title', data: articles.map((a) => a.title) },
    { name: 'type', data: articles.map((a) => a.$type) },
    { name: 'description', data: descriptions },
  ];

  const buffer = parquetWriteBuffer({
    columnData,
    schema,
    statistics,
    rowGroupSize,
    pageSize: DEFAULT_PAGE_SIZE,
    kvMetadata: [
      { key: 'writer', value: 'wikipedia.org.ai' },
      { key: 'version', value: '1.0.0' },
      { key: 'format', value: 'index' },
    ],
  });

  const path = `${outputDir}/wikipedia-index.parquet`;
  await writeToFile(path, buffer);

  return {
    format: 'index',
    path,
    size: buffer.byteLength,
    rowCount: articles.length,
    rowGroups: Math.ceil(articles.length / rowGroupSize),
  };
}

/**
 * Type-specific schema definitions
 */
interface TypeSchema {
  /** Additional fields beyond base fields */
  fields: Array<{
    name: string;
    type: 'BYTE_ARRAY' | 'INT64' | 'FLOAT' | 'BOOLEAN';
    convertedType?: string;
    required: boolean;
    extractor: (article: ArticleRecord) => unknown;
  }>;
}

const TYPE_SCHEMAS: Record<ArticleType, TypeSchema> = {
  person: {
    fields: [
      {
        name: 'birth_date',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'birth_date'),
      },
      {
        name: 'death_date',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'death_date'),
      },
      {
        name: 'nationality',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'nationality') || extractInfoboxField(a, 'citizenship'),
      },
      {
        name: 'occupation',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'occupation'),
      },
      {
        name: 'birth_place',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'birth_place'),
      },
    ],
  },
  place: {
    fields: [
      {
        name: 'coords_lat',
        type: 'FLOAT',
        required: false,
        extractor: (a) => a.coords_lat,
      },
      {
        name: 'coords_lon',
        type: 'FLOAT',
        required: false,
        extractor: (a) => a.coords_lon,
      },
      {
        name: 'country',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'country'),
      },
      {
        name: 'population',
        type: 'INT64',
        required: false,
        extractor: (a) => extractInfoboxNumber(a, 'population'),
      },
      {
        name: 'area',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'area') || extractInfoboxField(a, 'area_total'),
      },
      {
        name: 'timezone',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'timezone'),
      },
    ],
  },
  org: {
    fields: [
      {
        name: 'founded',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'founded') || extractInfoboxField(a, 'foundation'),
      },
      {
        name: 'headquarters',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'headquarters') || extractInfoboxField(a, 'location'),
      },
      {
        name: 'industry',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'industry'),
      },
      {
        name: 'type',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'type'),
      },
      {
        name: 'employees',
        type: 'INT64',
        required: false,
        extractor: (a) => extractInfoboxNumber(a, 'num_employees') || extractInfoboxNumber(a, 'employees'),
      },
      {
        name: 'website',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'website') || extractInfoboxField(a, 'url'),
      },
    ],
  },
  work: {
    fields: [
      {
        name: 'release_date',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'release_date') || extractInfoboxField(a, 'released'),
      },
      {
        name: 'creator',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) =>
          extractInfoboxField(a, 'author') ||
          extractInfoboxField(a, 'director') ||
          extractInfoboxField(a, 'artist') ||
          extractInfoboxField(a, 'developer'),
      },
      {
        name: 'genre',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'genre'),
      },
      {
        name: 'language',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'language'),
      },
      {
        name: 'runtime',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'runtime') || extractInfoboxField(a, 'length'),
      },
    ],
  },
  event: {
    fields: [
      {
        name: 'start_date',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'start_date') || extractInfoboxField(a, 'date'),
      },
      {
        name: 'end_date',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'end_date'),
      },
      {
        name: 'location',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'location') || extractInfoboxField(a, 'place'),
      },
      {
        name: 'coords_lat',
        type: 'FLOAT',
        required: false,
        extractor: (a) => a.coords_lat,
      },
      {
        name: 'coords_lon',
        type: 'FLOAT',
        required: false,
        extractor: (a) => a.coords_lon,
      },
      {
        name: 'outcome',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => extractInfoboxField(a, 'result') || extractInfoboxField(a, 'outcome'),
      },
    ],
  },
  other: {
    fields: [
      {
        name: 'infobox_type',
        type: 'BYTE_ARRAY',
        convertedType: 'UTF8',
        required: false,
        extractor: (a) => {
          if (!a.infobox) return null;
          return (a.infobox as Record<string, unknown>)._type as string || null;
        },
      },
      {
        name: 'infobox_json',
        type: 'BYTE_ARRAY',
        convertedType: 'JSON',
        required: false,
        extractor: (a) => (a.infobox ? JSON.stringify(a.infobox) : null),
      },
    ],
  },
};

/**
 * Write wikipedia-{type}.parquet
 *
 * Type-specific schemas with relevant shredded fields:
 * - Person: birth_date, death_date, nationality
 * - Place: coords_lat, coords_lon, country, population
 * - Company/Org: founded, headquarters, industry
 * - Work: release_date, creator, genre
 * - Event: start_date, end_date, location
 */
export async function writeTypeFormat(
  articles: ArticleRecord[],
  type: ArticleType,
  config: ExportWriterConfig
): Promise<ExportResult> {
  const { outputDir, rowGroupSize = 10000, statistics = true } = config;

  // Filter articles to specified type
  const typeArticles = articles.filter((a) => a.$type === type);

  if (typeArticles.length === 0) {
    // Return empty result for types with no articles
    return {
      format: type,
      path: `${outputDir}/wikipedia-${type}.parquet`,
      size: 0,
      rowCount: 0,
      rowGroups: 0,
    };
  }

  const typeSchema = TYPE_SCHEMAS[type];

  // Base fields for all types
  const baseFields = [
    { name: '$id', type: 'BYTE_ARRAY', convertedType: 'UTF8', required: true },
    { name: 'title', type: 'BYTE_ARRAY', convertedType: 'UTF8', required: true },
    { name: 'description', type: 'BYTE_ARRAY', convertedType: 'UTF8', required: true },
    { name: 'wikidata_id', type: 'BYTE_ARRAY', convertedType: 'UTF8', required: false },
    { name: 'content', type: 'BYTE_ARRAY', convertedType: 'UTF8', required: true },
    { name: 'updated_at', type: 'INT64', convertedType: 'TIMESTAMP_MILLIS', required: true },
  ];

  const totalFields = baseFields.length + typeSchema.fields.length;

  // Build schema
  const schema: SchemaElement[] = [
    { name: 'root', num_children: totalFields },
    ...baseFields.map((f) => ({
      name: f.name,
      type: f.type as 'BYTE_ARRAY' | 'INT64',
      converted_type: f.convertedType,
      repetition_type: f.required ? 'REQUIRED' : 'OPTIONAL',
    })),
    ...typeSchema.fields.map((f) => ({
      name: f.name,
      type: f.type,
      converted_type: f.convertedType,
      repetition_type: f.required ? 'REQUIRED' : 'OPTIONAL',
    })),
  ];

  // Build column data
  const columnData = [
    { name: '$id', data: typeArticles.map((a) => a.$id) },
    { name: 'title', data: typeArticles.map((a) => a.title) },
    { name: 'description', data: typeArticles.map((a) => a.description) },
    { name: 'wikidata_id', data: typeArticles.map((a) => a.wikidata_id) },
    { name: 'content', data: typeArticles.map((a) => a.content) },
    {
      name: 'updated_at',
      data: typeArticles.map((a) => {
        const date =
          a.updated_at instanceof Date
            ? a.updated_at
            : new Date(a.updated_at as unknown as string);
        return isNaN(date.getTime()) ? new Date() : date;
      }),
    },
    ...typeSchema.fields.map((f) => ({
      name: f.name,
      data: typeArticles.map(f.extractor),
    })),
  ];

  const buffer = parquetWriteBuffer({
    columnData,
    schema,
    statistics,
    rowGroupSize,
    pageSize: DEFAULT_PAGE_SIZE,
    kvMetadata: [
      { key: 'writer', value: 'wikipedia.org.ai' },
      { key: 'version', value: '1.0.0' },
      { key: 'format', value: type },
      { key: 'article_type', value: type },
    ],
  });

  const path = `${outputDir}/wikipedia-${type}.parquet`;
  await writeToFile(path, buffer);

  return {
    format: type,
    path,
    size: buffer.byteLength,
    rowCount: typeArticles.length,
    rowGroups: Math.ceil(typeArticles.length / rowGroupSize),
  };
}

/**
 * Export all formats
 */
export async function exportAllFormats(
  articles: ArticleRecord[],
  config: ExportWriterConfig,
  options: {
    /** Include full format */
    full?: boolean;
    /** Include infoboxes format */
    infoboxes?: boolean;
    /** Include index format */
    index?: boolean;
    /** Include type-specific formats */
    types?: ArticleType[] | boolean;
  } = {}
): Promise<ExportResult[]> {
  const {
    full = true,
    infoboxes = true,
    index = true,
    types = true,
  } = options;

  const results: ExportResult[] = [];

  // Create output directory
  await ensureDir(config.outputDir);

  // Write full format
  if (full) {
    results.push(await writeFullFormat(articles, config));
  }

  // Write infoboxes format
  if (infoboxes) {
    results.push(await writeInfoboxesFormat(articles, config));
  }

  // Write index format
  if (index) {
    results.push(await writeIndexFormat(articles, config));
  }

  // Write type-specific formats
  if (types) {
    const typeList = Array.isArray(types) ? types : [...ARTICLE_TYPES];
    for (const type of typeList) {
      const result = await writeTypeFormat(articles, type, config);
      if (result.rowCount > 0) {
        results.push(result);
      }
    }
  }

  return results;
}

// Helper functions

function extractString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key];
  if (typeof value === 'string') return value;
  if (value != null) return String(value);
  return null;
}

function extractNumber(obj: Record<string, unknown>, key: string): number | null {
  const value = obj[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value.replace(/[,\s]/g, ''), 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractInfoboxField(article: ArticleRecord, field: string): string | null {
  if (!article.infobox) return null;
  const infobox = article.infobox as Record<string, unknown>;
  return extractString(infobox, field);
}

function extractInfoboxNumber(article: ArticleRecord, field: string): number | null {
  if (!article.infobox) return null;
  const infobox = article.infobox as Record<string, unknown>;
  return extractNumber(infobox, field);
}

async function writeToFile(path: string, buffer: ArrayBuffer): Promise<void> {
  if (typeof Bun !== 'undefined') {
    await Bun.write(path, buffer);
  } else {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(buffer));
  }
}

async function ensureDir(dir: string): Promise<void> {
  if (typeof Bun !== 'undefined') {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
  } else {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dir, { recursive: true });
  }
}
