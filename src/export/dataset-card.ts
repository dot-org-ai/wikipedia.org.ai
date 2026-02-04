/**
 * HuggingFace dataset card (README.md) generator
 *
 * Generates a comprehensive dataset card following HuggingFace's
 * dataset card specification with proper metadata and documentation.
 */

import { MODEL_DIMENSIONS, ARTICLE_TYPES } from './schema.js';
import type { ExportEmbeddingModel, DatasetStats } from './schema.js';

/**
 * Configuration for dataset card generation
 */
export interface DatasetCardConfig {
  /** Dataset name on HuggingFace (e.g., 'dotdo/wikipedia-embeddings-en') */
  name: string;

  /** Dataset description */
  description: string;

  /** Embedding models included */
  models: ExportEmbeddingModel[];

  /** Total number of articles */
  articleCount: number;

  /** Total number of embedding vectors */
  embeddingCount: number;

  /** License identifier (e.g., 'cc-by-sa-4.0') */
  license: string;

  /** Languages included (ISO 639-1 codes) */
  languages: string[];

  /** Whether content is included */
  includeContent?: boolean;

  /** Dataset version */
  version?: string;

  /** Creation date (ISO 8601) */
  createdAt?: string;

  /** Optional extended statistics */
  stats?: DatasetStats;

  /** Source Wikipedia dump date */
  wikipediaDumpDate?: string;

  /** Contact/maintainer information */
  maintainer?: string;

  /** Repository URL */
  repositoryUrl?: string;
}

/**
 * Generate a HuggingFace dataset card (README.md) with YAML frontmatter
 */
export function generateDatasetCard(config: DatasetCardConfig): string {
  const {
    name,
    description,
    models,
    articleCount,
    embeddingCount,
    license,
    languages,
    includeContent = false,
    version = '1.0.0',
    createdAt = new Date().toISOString().split('T')[0] ?? new Date().toISOString().substring(0, 10),
    stats,
    wikipediaDumpDate,
    maintainer,
    repositoryUrl,
  } = config;

  // Determine size category
  const sizeCategory = getSizeCategory(articleCount);

  // Build YAML frontmatter
  const frontmatter = buildFrontmatter({
    license,
    languages,
    models,
    sizeCategory,
    articleCount,
  });

  // Build markdown sections
  const sections: string[] = [
    frontmatter,
    '',
    buildTitle(name),
    '',
    buildDescription(description),
    '',
    buildDatasetSummary(articleCount, embeddingCount, models, includeContent, version, createdAt, wikipediaDumpDate),
    '',
    buildModelsSection(models),
    '',
    buildSchemaSection(models, includeContent),
    '',
    buildUsageSection(name, models),
    '',
    buildStatisticsSection(stats),
    '',
    buildLicenseSection(license),
    '',
    buildCitationSection(name, maintainer, repositoryUrl),
    '',
    buildAcknowledgments(),
  ];

  return sections.filter(Boolean).join('\n');
}

/**
 * Build YAML frontmatter for HuggingFace
 */
function buildFrontmatter(config: {
  license: string;
  languages: string[];
  models: ExportEmbeddingModel[];
  sizeCategory: string;
  articleCount: number;
}): string {
  const { license, languages, models, sizeCategory, articleCount } = config;

  const lines: string[] = [
    '---',
    `license: ${license}`,
    'language:',
    ...languages.map((lang) => `- ${lang}`),
    'tags:',
    '- wikipedia',
    '- embeddings',
    '- semantic-search',
    '- text-embeddings',
    ...models.map((m) => `- ${m}`),
    'task_categories:',
    '- feature-extraction',
    '- sentence-similarity',
    'size_categories:',
    `- ${sizeCategory}`,
    'configs:',
    '- config_name: default',
    '  data_files:',
    '    - split: train',
    '      path: "data/*.parquet"',
    `dataset_info:`,
    `  dataset_size: ${articleCount}`,
    '---',
  ];

  return lines.join('\n');
}

/**
 * Get HuggingFace size category from article count
 */
function getSizeCategory(count: number): string {
  if (count < 1000) return 'n<1K';
  if (count < 10000) return '1K<n<10K';
  if (count < 100000) return '10K<n<100K';
  if (count < 1000000) return '100K<n<1M';
  if (count < 10000000) return '1M<n<10M';
  return 'n>10M';
}

/**
 * Build the title section
 */
function buildTitle(name: string): string {
  const shortName = name.split('/').pop() ?? name;
  return `# ${shortName.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}`;
}

/**
 * Build the description section
 */
function buildDescription(description: string): string {
  return `## Dataset Description\n\n${description}`;
}

/**
 * Build the dataset summary table
 */
function buildDatasetSummary(
  articleCount: number,
  embeddingCount: number,
  models: ExportEmbeddingModel[],
  includeContent: boolean,
  version: string,
  createdAt: string,
  wikipediaDumpDate?: string
): string {
  const totalDimensions = models.reduce((sum, m) => sum + MODEL_DIMENSIONS[m], 0);
  const estimatedSize = estimateDatasetSize(articleCount, models, includeContent);

  const rows: string[] = [
    '## Dataset Summary',
    '',
    '| Property | Value |',
    '|----------|-------|',
    `| Articles | ${formatNumber(articleCount)} |`,
    `| Embeddings | ${formatNumber(embeddingCount)} |`,
    `| Models | ${models.join(', ')} |`,
    `| Total Dimensions | ${totalDimensions} |`,
    `| Estimated Size | ${formatBytes(estimatedSize)} |`,
    `| Content Included | ${includeContent ? 'Yes' : 'No'} |`,
    `| Version | ${version} |`,
    `| Created | ${createdAt} |`,
  ];

  if (wikipediaDumpDate) {
    rows.push(`| Wikipedia Dump | ${wikipediaDumpDate} |`);
  }

  return rows.join('\n');
}

/**
 * Build the models section
 */
function buildModelsSection(models: ExportEmbeddingModel[]): string {
  const lines: string[] = ['## Embedding Models', ''];

  for (const model of models) {
    const dim = MODEL_DIMENSIONS[model];
    lines.push(`### ${model.toUpperCase()}`);
    lines.push('');

    if (model === 'bge-m3') {
      lines.push('- **Model**: BAAI/bge-m3');
      lines.push(`- **Dimensions**: ${dim}`);
      lines.push('- **Type**: Dense multilingual embedding model');
      lines.push('- **Description**: State-of-the-art multilingual embedding model supporting 100+ languages with strong performance on retrieval tasks.');
    } else if (model === 'gemma') {
      lines.push('- **Model**: Google Gemma');
      lines.push(`- **Dimensions**: ${dim}`);
      lines.push('- **Type**: Dense embedding model');
      lines.push('- **Description**: Google\'s efficient embedding model optimized for semantic similarity and retrieval.');
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build the schema section
 */
function buildSchemaSection(models: ExportEmbeddingModel[], includeContent: boolean): string {
  const lines: string[] = [
    '## Schema',
    '',
    '```',
    '{',
    '  // Article metadata',
    '  "id": "string",              // Unique article identifier',
    '  "title": "string",           // Article title',
    '  "type": "string",            // person, place, org, work, event, other',
    '  "wikidata_id": "string?",    // Wikidata Q-number (nullable)',
    '',
  ];

  if (includeContent) {
    lines.push('  // Content');
    lines.push('  "content": "string?",        // Full article text (nullable)');
  }

  lines.push('  "content_length": "int32",   // Character count');
  lines.push('');
  lines.push('  // Embeddings');

  for (const model of models) {
    const dim = MODEL_DIMENSIONS[model];
    const columnName = `embedding_${model.replace('-', '_')}`;
    const isOptional = model !== models[0];
    lines.push(`  "${columnName}": "list<float32>",  // ${dim}-dimensional${isOptional ? ' (optional)' : ''}`);
  }

  lines.push('');
  lines.push('  // Metadata');
  lines.push('  "model_version": "string",   // Embedding model version');
  lines.push('  "created_at": "timestamp"    // Creation timestamp');
  lines.push('}');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Build the usage section with code examples
 */
function buildUsageSection(name: string, models: ExportEmbeddingModel[]): string {
  const primaryModel = models[0] ?? 'bge-m3';
  const embeddingColumn = `embedding_${primaryModel.replace('-', '_')}`;

  return `## Usage

### Loading the Dataset

\`\`\`python
from datasets import load_dataset

# Load the full dataset
ds = load_dataset("${name}")

# Stream for large datasets
ds = load_dataset("${name}", streaming=True)

# Access embeddings
for example in ds["train"]:
    title = example["title"]
    embedding = example["${embeddingColumn}"]
    print(f"{title}: {len(embedding)} dimensions")
\`\`\`

### Semantic Search Example

\`\`\`python
import numpy as np
from datasets import load_dataset
from sentence_transformers import SentenceTransformer

# Load dataset and model
ds = load_dataset("${name}")
model = SentenceTransformer("BAAI/bge-m3")

# Get all embeddings as numpy array
embeddings = np.array(ds["train"]["${embeddingColumn}"])
titles = ds["train"]["title"]

# Query
query = "What is machine learning?"
query_embedding = model.encode(query)

# Cosine similarity
similarities = np.dot(embeddings, query_embedding) / (
    np.linalg.norm(embeddings, axis=1) * np.linalg.norm(query_embedding)
)

# Top 5 results
top_indices = np.argsort(similarities)[-5:][::-1]
for idx in top_indices:
    print(f"{titles[idx]}: {similarities[idx]:.4f}")
\`\`\`

### With FAISS for Efficient Search

\`\`\`python
import faiss
import numpy as np
from datasets import load_dataset

ds = load_dataset("${name}")
embeddings = np.array(ds["train"]["${embeddingColumn}"], dtype=np.float32)

# Build FAISS index
dimension = embeddings.shape[1]
index = faiss.IndexFlatIP(dimension)  # Inner product (cosine after normalization)

# Normalize for cosine similarity
faiss.normalize_L2(embeddings)
index.add(embeddings)

# Search
query = np.random.rand(1, dimension).astype(np.float32)
faiss.normalize_L2(query)
distances, indices = index.search(query, k=10)
\`\`\`

### Filtering by Article Type

\`\`\`python
# Filter to only people articles
people = ds["train"].filter(lambda x: x["type"] == "person")

# Filter to places with coordinates
places = ds["train"].filter(lambda x: x["type"] == "place")
\`\`\``;
}

/**
 * Build statistics section
 */
function buildStatisticsSection(stats?: DatasetStats): string {
  if (!stats) {
    return '## Statistics\n\n*Statistics will be available after export completion.*';
  }

  const lines: string[] = [
    '## Statistics',
    '',
    '### Articles by Type',
    '',
    '| Type | Count | Percentage |',
    '|------|-------|------------|',
  ];

  for (const type of ARTICLE_TYPES) {
    const count = stats.rowsByType[type];
    const pct = ((count / stats.rowCount) * 100).toFixed(1);
    lines.push(`| ${type} | ${formatNumber(count)} | ${pct}% |`);
  }

  lines.push('');
  lines.push(`**Total**: ${formatNumber(stats.rowCount)} articles`);
  lines.push('');
  lines.push(`**Files**: ${stats.fileCount} Parquet files`);
  lines.push('');
  lines.push(`**Size**: ~${formatBytes(stats.totalSizeBytes)}`);

  return lines.join('\n');
}

/**
 * Build license section
 */
function buildLicenseSection(license: string): string {
  const licenseInfo: Record<string, { name: string; url: string; description: string }> = {
    'cc-by-sa-4.0': {
      name: 'Creative Commons Attribution-ShareAlike 4.0 International',
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      description: 'This dataset is derived from Wikipedia and is released under the same license as Wikipedia content.',
    },
    'cc-by-4.0': {
      name: 'Creative Commons Attribution 4.0 International',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      description: 'You are free to share and adapt this dataset with attribution.',
    },
    'mit': {
      name: 'MIT License',
      url: 'https://opensource.org/licenses/MIT',
      description: 'Permission is granted to use, copy, modify, and distribute.',
    },
  };

  const info = licenseInfo[license] ?? {
    name: license.toUpperCase(),
    url: '',
    description: 'See license file for details.',
  };

  return `## License

This dataset is released under the **${info.name}** license.

${info.description}

${info.url ? `License details: ${info.url}` : ''}

### Attribution

When using this dataset, please cite both this dataset and Wikipedia:

> Wikipedia contributors. Wikipedia, The Free Encyclopedia. https://www.wikipedia.org/`;
}

/**
 * Build citation section
 */
function buildCitationSection(name: string, maintainer?: string, repositoryUrl?: string): string {
  const year = new Date().getFullYear();
  const shortName = name.split('/').pop() ?? name;

  return `## Citation

If you use this dataset in your research, please cite:

\`\`\`bibtex
@dataset{${shortName.replace(/-/g, '_')}_${year},
  title = {Wikipedia Embeddings Dataset},
  author = {${maintainer ?? 'DotDo'}},
  year = {${year}},
  publisher = {HuggingFace},
  url = {https://huggingface.co/datasets/${name}},
  note = {Pre-computed embeddings for English Wikipedia articles}
}
\`\`\`${repositoryUrl ? `\n\nSource code: ${repositoryUrl}` : ''}`;
}

/**
 * Build acknowledgments section
 */
function buildAcknowledgments(): string {
  return `## Acknowledgments

- **Wikipedia** and all its contributors for creating and maintaining this invaluable resource
- **BAAI** for the BGE-M3 embedding model
- **Google** for the Gemma model
- **HuggingFace** for hosting and dataset infrastructure
- **Cloudflare** for AI inference infrastructure

---

*Generated by wikipedia.org.ai*`;
}

/**
 * Format a number with commas for readability
 */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Estimate dataset size in bytes
 */
function estimateDatasetSize(
  articleCount: number,
  models: ExportEmbeddingModel[],
  includeContent: boolean
): number {
  // Embedding sizes: 4 bytes per float32
  let embeddingSize = 0;
  for (const model of models) {
    embeddingSize += MODEL_DIMENSIONS[model] * 4;
  }

  // Metadata overhead per row (approximate)
  const metadataOverhead = 200; // id, title, type, etc.

  // Content estimate (average Wikipedia article ~5KB)
  const contentSize = includeContent ? 5000 : 0;

  const rowSize = embeddingSize + metadataOverhead + contentSize;
  return articleCount * rowSize;
}

/**
 * Generate a minimal dataset card for quick exports
 */
export function generateMinimalDatasetCard(config: {
  name: string;
  models: ExportEmbeddingModel[];
  articleCount: number;
  license?: string;
}): string {
  return generateDatasetCard({
    name: config.name,
    description: `Pre-computed embeddings for ${formatNumber(config.articleCount)} English Wikipedia articles using ${config.models.join(' and ')} models.`,
    models: config.models,
    articleCount: config.articleCount,
    embeddingCount: config.articleCount * config.models.length,
    license: config.license ?? 'cc-by-sa-4.0',
    languages: ['en'],
  });
}
