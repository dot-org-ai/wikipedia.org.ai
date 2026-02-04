/**
 * Storage Layer - Wikipedia Parquet Storage
 *
 * Provides efficient storage and retrieval of Wikipedia articles using:
 * - Parquet format for columnar storage
 * - Variant types for flexible infobox schemas
 * - Type-based partitioning for fast queries
 * - Bloom filters for efficient lookups
 */

// Type definitions
export type {
  ArticleType,
  ArticleRecord,
  ShreddedInfoboxFields,
  ForwardRelationship,
  ReverseRelationship,
  TitleIndexEntry,
  TitleIndex,
  TypeIndex,
  ManifestFile,
  Manifest,
  ArticleWriterConfig,
  VariantWriterConfig,
  PartitionedWriterConfig,
  RelationshipWriterConfig,
  BloomFilterConfig,
  FileBloomFilter,
  WriteResult,
  ArticleBatch,
  FileLimitThresholds,
  FileLimitWarningCallback,
} from './types.js';

// Constants
export {
  ARTICLE_TYPES,
  SHREDDED_INFOBOX_FIELDS,
  VARIANT_SHRED_FIELDS,
  ARTICLE_SCHEMA,
  FORWARD_REL_SCHEMA,
  REVERSE_REL_SCHEMA,
  PREDICATES,
  REVERSE_PREDICATES,
} from './types.js';

// Article Parquet Writer
export {
  ArticleParquetWriter,
  StreamingArticleWriter,
  writeArticlesToBuffer,
  inferShreddedFields,
  // VARIANT shredding writer
  VariantArticleWriter,
  StreamingVariantArticleWriter,
  writeVariantArticlesToBuffer,
} from './parquet-writer.js';

// Partitioned Writer
export {
  PartitionedWriter,
  StreamingPartitionedWriter,
  createPartitionedWriter,
  mergeManifests,
  FileLimitExceededError,
} from './partitioner.js';

// Relationship Writer
export {
  RelationshipWriter,
  createRelationshipWriter,
  extractLinks,
  extractAndWriteRelationships,
} from './relationships.js';
export type { ExtractedLink } from './relationships.js';

// Index Builder
export {
  IndexBuilder,
  BloomFilter,
  createIndexBuilder,
  normalizeTitle,
  loadTitleIndex,
  loadTypeIndex,
  loadBloomFilter,
  gzipDecompress,
  lookupByTitle,
  getFilesForType,
  buildTitleToIdMap,
} from './indexes.js';

// Re-export ID index from indexes module
export {
  IDIndex,
  createIDIndex,
  loadIDIndex,
  saveIDIndex,
  type IDIndexEntry,
  type SerializedIDIndex,
  type ArticleLocation,
} from '../indexes/id-index.js';

// Export Formats
export {
  exportAllFormats,
  writeFullFormat,
  writeInfoboxesFormat,
  writeIndexFormat,
  writeTypeFormat,
  type ExportFormat,
  type ExportWriterConfig,
  type ExportResult,
} from './export-formats.js';
