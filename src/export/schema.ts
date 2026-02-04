/**
 * HuggingFace dataset schema definitions
 *
 * Defines the Parquet schema for exporting Wikipedia embeddings
 * in a HuggingFace-compatible format.
 */

import type { SchemaElement } from '@dotdo/hyparquet';

/**
 * Embedding model types supported for export
 */
export type ExportEmbeddingModel = 'bge-m3' | 'gemma' | 'gemma300';

/**
 * Article type classification
 */
export type ArticleType = 'person' | 'place' | 'org' | 'work' | 'event' | 'other';

/**
 * All valid article types
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
 * Model embedding dimensions
 */
export const MODEL_DIMENSIONS: Record<ExportEmbeddingModel, number> = {
  'bge-m3': 1024,
  'gemma': 768,
  'gemma300': 768,
} as const;

/**
 * HuggingFace dataset row schema
 *
 * This interface represents a single row in the exported Parquet files.
 * Designed to be compatible with HuggingFace datasets library.
 */
export interface DatasetRow {
  /** Unique article identifier (ULID or Wikipedia page ID) */
  id: string;

  /** Article title */
  title: string;

  /** Article type classification */
  type: ArticleType;

  /** Wikidata Q-number if available (e.g., Q5 for humans) */
  wikidata_id: string | null;

  /** Full article content (optional, may be omitted to reduce size) */
  content: string | null;

  /** Content length in characters */
  content_length: number;

  /** BGE-M3 embedding vector (1024-dim, always present) */
  embedding_bge_m3: Float32Array;

  /** Gemma embedding vector (768-dim, optional, legacy) */
  embedding_gemma: Float32Array | null;

  /** EmbeddingGemma-300M embedding vector (768-dim, optional) */
  embedding_gemma300: Float32Array | null;

  /** Model version used to generate embeddings */
  model_version: string;

  /** Creation timestamp (ISO 8601) */
  created_at: string;
}

/**
 * Schema field type descriptions for documentation
 */
export const SCHEMA_FIELD_DESCRIPTIONS: Record<keyof DatasetRow, string> = {
  id: 'Unique article identifier',
  title: 'Wikipedia article title',
  type: 'Article type: person, place, org, work, event, or other',
  wikidata_id: 'Wikidata Q-number (e.g., Q5 for humans)',
  content: 'Full article plaintext content (optional)',
  content_length: 'Content length in characters',
  embedding_bge_m3: '1024-dimensional BGE-M3 embedding vector',
  embedding_gemma: '768-dimensional Gemma embedding vector (optional, legacy)',
  embedding_gemma300: '768-dimensional EmbeddingGemma-300M embedding vector (optional)',
  model_version: 'Embedding model version identifier',
  created_at: 'ISO 8601 timestamp when embeddings were generated',
};

/**
 * Parquet schema for HuggingFace dataset export
 *
 * Uses standard Parquet types compatible with Arrow and HuggingFace datasets.
 */
export const DATASET_PARQUET_SCHEMA: SchemaElement[] = [
  { name: 'root', num_children: 11 },

  // Article metadata
  { name: 'id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'title', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'type', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'wikidata_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },

  // Content (optional)
  { name: 'content', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' },
  { name: 'content_length', type: 'INT32', repetition_type: 'REQUIRED' },

  // Embeddings - stored as fixed-size float32 arrays
  // Note: These are represented as lists in Parquet for HF compatibility
  { name: 'embedding_bge_m3', type: 'FLOAT', repetition_type: 'REPEATED' },
  { name: 'embedding_gemma', type: 'FLOAT', repetition_type: 'OPTIONAL' },
  { name: 'embedding_gemma300', type: 'FLOAT', repetition_type: 'OPTIONAL' },

  // Metadata
  { name: 'model_version', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' },
  { name: 'created_at', type: 'INT64', converted_type: 'TIMESTAMP_MILLIS', repetition_type: 'REQUIRED' },
];

/**
 * Schema configuration for different export modes
 */
export interface SchemaConfig {
  /** Include content column */
  includeContent: boolean;

  /** Models to include embeddings for */
  models: ExportEmbeddingModel[];
}

/**
 * Build a dynamic schema based on configuration
 */
export function buildDynamicSchema(config: SchemaConfig): SchemaElement[] {
  const schema: SchemaElement[] = [];

  // Count children based on config
  let numChildren = 7; // id, title, type, wikidata_id, content_length, model_version, created_at
  if (config.includeContent) numChildren++;
  numChildren += config.models.length; // One embedding column per model

  schema.push({ name: 'root', num_children: numChildren });

  // Article metadata (always present)
  schema.push({ name: 'id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' });
  schema.push({ name: 'title', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' });
  schema.push({ name: 'type', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' });
  schema.push({ name: 'wikidata_id', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' });

  // Content (optional based on config)
  if (config.includeContent) {
    schema.push({ name: 'content', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'OPTIONAL' });
  }
  schema.push({ name: 'content_length', type: 'INT32', repetition_type: 'REQUIRED' });

  // Embeddings based on selected models
  for (const model of config.models) {
    const columnName = `embedding_${model.replace('-', '_')}`;
    // First model is required, others are optional
    const repetitionType = model === config.models[0] ? 'REPEATED' : 'OPTIONAL';
    schema.push({ name: columnName, type: 'FLOAT', repetition_type: repetitionType });
  }

  // Metadata (always present)
  schema.push({ name: 'model_version', type: 'BYTE_ARRAY', converted_type: 'UTF8', repetition_type: 'REQUIRED' });
  schema.push({ name: 'created_at', type: 'INT64', converted_type: 'TIMESTAMP_MILLIS', repetition_type: 'REQUIRED' });

  return schema;
}

/**
 * Validate a dataset row against the schema
 */
export function validateRow(row: Partial<DatasetRow>, config: SchemaConfig): string[] {
  const errors: string[] = [];

  // Required fields
  if (!row.id || typeof row.id !== 'string') {
    errors.push('id is required and must be a string');
  }

  if (!row.title || typeof row.title !== 'string') {
    errors.push('title is required and must be a string');
  }

  if (!row.type || !ARTICLE_TYPES.includes(row.type)) {
    errors.push(`type must be one of: ${ARTICLE_TYPES.join(', ')}`);
  }

  if (typeof row.content_length !== 'number' || row.content_length < 0) {
    errors.push('content_length is required and must be a non-negative number');
  }

  // Validate embeddings
  for (const model of config.models) {
    const key = `embedding_${model.replace('-', '_')}` as keyof DatasetRow;
    const embedding = row[key];
    const expectedDim = MODEL_DIMENSIONS[model];

    if (model === config.models[0]) {
      // First model is required
      if (!(embedding instanceof Float32Array)) {
        errors.push(`${key} is required and must be a Float32Array`);
      } else if (embedding.length !== expectedDim) {
        errors.push(`${key} must have ${expectedDim} dimensions, got ${embedding.length}`);
      }
    } else if (embedding !== null && embedding !== undefined) {
      // Optional models: validate if present
      if (!(embedding instanceof Float32Array)) {
        errors.push(`${key} must be a Float32Array or null`);
      } else if (embedding.length !== expectedDim) {
        errors.push(`${key} must have ${expectedDim} dimensions, got ${embedding.length}`);
      }
    }
  }

  if (!row.model_version || typeof row.model_version !== 'string') {
    errors.push('model_version is required and must be a string');
  }

  if (!row.created_at || typeof row.created_at !== 'string') {
    errors.push('created_at is required and must be an ISO 8601 string');
  }

  return errors;
}

/**
 * Dataset statistics for tracking export progress
 */
export interface DatasetStats {
  /** Total number of rows */
  rowCount: number;

  /** Rows by article type */
  rowsByType: Record<ArticleType, number>;

  /** Total size in bytes (approximate) */
  totalSizeBytes: number;

  /** Number of Parquet files written */
  fileCount: number;

  /** Models included */
  models: ExportEmbeddingModel[];

  /** Whether content is included */
  includeContent: boolean;
}

/**
 * Create initial empty statistics
 */
export function createEmptyStats(config: SchemaConfig): DatasetStats {
  const rowsByType: Record<ArticleType, number> = {
    person: 0,
    place: 0,
    org: 0,
    work: 0,
    event: 0,
    other: 0,
  };

  return {
    rowCount: 0,
    rowsByType,
    totalSizeBytes: 0,
    fileCount: 0,
    models: config.models,
    includeContent: config.includeContent,
  };
}

/**
 * Estimate row size in bytes for progress tracking
 */
export function estimateRowSize(row: Partial<DatasetRow>, config: SchemaConfig): number {
  let size = 0;

  // String fields: estimate average sizes
  size += (row.id?.length ?? 10) * 2; // UTF-8 overhead
  size += (row.title?.length ?? 30) * 2;
  size += (row.type?.length ?? 6) * 2;
  size += (row.wikidata_id?.length ?? 0) * 2;
  size += (row.model_version?.length ?? 20) * 2;
  size += 26; // created_at ISO string

  // Content if included
  if (config.includeContent && row.content) {
    size += row.content.length * 2;
  }

  // Fixed-size fields
  size += 4; // content_length (int32)
  size += 8; // created_at timestamp

  // Embeddings: 4 bytes per float32
  for (const model of config.models) {
    size += MODEL_DIMENSIONS[model] * 4;
  }

  return size;
}
