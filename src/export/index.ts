/**
 * Export Module - HuggingFace Dataset Export
 *
 * Provides tools for exporting Wikipedia embeddings as
 * HuggingFace-compatible datasets with proper licensing
 * and documentation.
 */

// Main exporter
export {
  HuggingFaceExporter,
  createHuggingFaceExporter,
  exportToHuggingFace,
} from './huggingface.js';
export type {
  DatasetConfig,
  ExportResult,
  ExportProgress,
  ExportProgressCallback,
} from './huggingface.js';

// Dataset card generator
export { generateDatasetCard, generateMinimalDatasetCard } from './dataset-card.js';
export type { DatasetCardConfig } from './dataset-card.js';

// Schema definitions
export {
  DATASET_PARQUET_SCHEMA,
  MODEL_DIMENSIONS,
  ARTICLE_TYPES,
  SCHEMA_FIELD_DESCRIPTIONS,
  buildDynamicSchema,
  validateRow,
  createEmptyStats,
  estimateRowSize,
} from './schema.js';
export type {
  DatasetRow,
  DatasetStats,
  ExportEmbeddingModel,
  ArticleType,
  SchemaConfig,
} from './schema.js';
