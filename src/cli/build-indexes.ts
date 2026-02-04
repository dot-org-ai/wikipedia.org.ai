/**
 * Build Indexes Command
 *
 * Builds title, type, and ID indexes from Parquet files.
 * Reads all parquet files in the data directory and creates:
 * - Title index: maps normalized titles to file locations
 * - Type index: maps article types to file paths
 * - ID index: maps article IDs to file locations
 */

import { Command } from 'commander';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parquetRead } from '@dotdo/hyparquet';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import {
  color,
  createSpinner,
  loadConfig,
  fatal,
  resolvePath,
  formatNumber,
  formatBytes,
  formatDuration,
} from './utils.js';
import type { ArticleType } from '../storage/types.js';
import { ARTICLE_TYPES } from '../storage/types.js';
import type { TitleIndex, TypeIndex, Manifest } from '../storage/types.js';

const gzipAsync = promisify(gzip);

/** Build indexes command options */
interface BuildIndexesOptions {
  dataDir: string;
  output?: string;
  compress: boolean;
  verbose: boolean;
}

/** ID index entry - matches SerializedIDIndex.entries format */
interface IDIndexEntry {
  /** Article type (for partition routing) */
  type: ArticleType;
  /** Parquet file path */
  file: string;
  /** Row group index within file */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/** Serialized ID index format for storage */
interface SerializedIDIndex {
  /** Index version for compatibility */
  version: string;
  /** Creation timestamp */
  created_at: string;
  /** Number of entries */
  count: number;
  /** ID to location mapping */
  entries: Record<string, IDIndexEntry>;
}

export const buildIndexesCommand = new Command('build-indexes')
  .description('Build title, type, and ID indexes from Parquet files')
  .option('-d, --data-dir <path>', 'Data directory containing articles', './data')
  .option('-o, --output <path>', 'Output directory for indexes (defaults to data-dir/indexes)')
  .option('--no-compress', 'Skip gzip compression of index files', false)
  .option('-v, --verbose', 'Show verbose output', false)
  .action(async (options: BuildIndexesOptions) => {
    const config = await loadConfig();
    const dataDir = resolvePath(options.dataDir || config.dataDir || './data');
    const outputDir = options.output ? resolvePath(options.output) : join(dataDir, 'indexes');
    const compress = options.compress;

    console.log('\n  Build Wikipedia Indexes\n');
    console.log(`  Data Directory:   ${color.cyan(dataDir)}`);
    console.log(`  Output Directory: ${color.cyan(outputDir)}`);
    console.log(`  Compression:      ${compress ? color.green('gzip') : color.gray('none')}`);
    console.log('');

    const startTime = Date.now();

    // Create output directory
    await mkdir(outputDir, { recursive: true });

    // Find manifest
    const manifestPath = join(dataDir, 'articles', 'manifest.json');
    let manifest: Manifest | null = null;

    try {
      const manifestData = await readFile(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestData) as Manifest;
      console.log(`  Found manifest: ${color.cyan(formatNumber(manifest.totalArticles))} articles\n`);
    } catch {
      // Try alternative manifest location
      const altManifestPath = join(dataDir, 'manifest.json');
      try {
        const manifestData = await readFile(altManifestPath, 'utf-8');
        manifest = JSON.parse(manifestData) as Manifest;
        console.log(`  Found manifest: ${color.cyan(formatNumber(manifest.totalArticles))} articles\n`);
      } catch {
        console.log(color.yellow('  No manifest found, will scan for parquet files...\n'));
      }
    }

    // Initialize indexes
    const titleIndex: TitleIndex = {};
    const typeIndex: TypeIndex = {} as TypeIndex;
    const idIndexEntries: Record<string, IDIndexEntry> = {};

    // Initialize type index with empty arrays
    for (const type of ARTICLE_TYPES) {
      typeIndex[type] = [];
    }

    // Find all parquet files
    let parquetFiles: string[] = [];
    const articlesDir = join(dataDir, 'articles');

    if (manifest && manifest.dataFiles) {
      // Use manifest to find files
      parquetFiles = manifest.dataFiles.map(f => f.path);
    } else {
      // Scan for parquet files
      parquetFiles = await findParquetFilesRecursive(articlesDir);
    }

    if (parquetFiles.length === 0) {
      fatal('No Parquet files found in data directory');
    }

    console.log(`  Found ${color.cyan(String(parquetFiles.length))} Parquet files\n`);

    // Process each parquet file
    const spinner = createSpinner('Building indexes...');
    let totalArticles = 0;
    let processedFiles = 0;

    for (const file of parquetFiles) {
      const filePath = join(articlesDir, file);

      try {
        await stat(filePath);
      } catch {
        if (options.verbose) {
          console.log(color.yellow(`  Skipping missing file: ${file}`));
        }
        continue;
      }

      if (options.verbose) {
        spinner.update(`Processing ${file}...`);
      }

      try {
        const articles = await readParquetFile(filePath);

        // Determine article type from file path (e.g., data/person/person.0.parquet)
        const fileType = extractTypeFromPath(file);

        // Add file to type index if we can determine the type
        if (fileType && !typeIndex[fileType].includes(file)) {
          typeIndex[fileType].push(file);
        }

        // Process each article
        for (let row = 0; row < articles.length; row++) {
          const article = articles[row];
          if (!article) continue;

          const normalizedTitle = normalizeTitle(article.title);
          const articleType = (article.$type || article.type || fileType || 'other') as ArticleType;

          // Add to title index
          titleIndex[normalizedTitle] = {
            file,
            rowGroup: 0, // Single row group for now
            row,
          };

          // Add to ID index
          const articleId = article.$id || article.id;
          if (articleId) {
            idIndexEntries[articleId] = {
              type: articleType,
              file,
              rowGroup: 0,
              row,
            };
          }

          // Track type for type index if file type unknown
          if (!fileType && articleType && !typeIndex[articleType].includes(file)) {
            typeIndex[articleType].push(file);
          }

          totalArticles++;
        }

        processedFiles++;
      } catch (error) {
        if (options.verbose) {
          console.log(color.yellow(`\n  Error processing ${file}: ${error}`));
        }
      }
    }

    spinner.success(`Processed ${processedFiles} files, ${formatNumber(totalArticles)} articles`);

    // Write indexes
    const writeSpinner = createSpinner('Writing index files...');

    // Write title index
    const titleIndexContent = JSON.stringify(titleIndex, null, compress ? 0 : 2);
    const titleIndexPath = join(outputDir, compress ? 'titles.json.gz' : 'titles.json');

    if (compress) {
      const compressed = await gzipAsync(titleIndexContent);
      await writeFile(titleIndexPath, compressed);
    } else {
      await writeFile(titleIndexPath, titleIndexContent);
    }

    // Also write uncompressed version for local use
    await writeFile(join(outputDir, 'titles.json'), JSON.stringify(titleIndex, null, 2));

    // Write type index
    const typeIndexContent = JSON.stringify(typeIndex, null, compress ? 0 : 2);
    const typeIndexPath = join(outputDir, compress ? 'types.json.gz' : 'types.json');

    if (compress) {
      const compressed = await gzipAsync(typeIndexContent);
      await writeFile(typeIndexPath, compressed);
    } else {
      await writeFile(typeIndexPath, typeIndexContent);
    }

    // Also write uncompressed version for local use
    await writeFile(join(outputDir, 'types.json'), JSON.stringify(typeIndex, null, 2));

    // Build serialized ID index
    const idIndex: SerializedIDIndex = {
      version: '1.0.0',
      created_at: new Date().toISOString(),
      count: Object.keys(idIndexEntries).length,
      entries: idIndexEntries,
    };

    // Write ID index
    const idIndexContent = JSON.stringify(idIndex, null, compress ? 0 : 2);
    const idIndexPath = join(outputDir, compress ? 'ids.json.gz' : 'ids.json');

    if (compress) {
      const compressed = await gzipAsync(idIndexContent);
      await writeFile(idIndexPath, compressed);
    } else {
      await writeFile(idIndexPath, idIndexContent);
    }

    // Also write uncompressed version for local use
    await writeFile(join(outputDir, 'ids.json'), JSON.stringify(idIndex, null, 2));

    writeSpinner.success('Index files written');

    // Calculate file sizes
    const titleSize = Buffer.byteLength(titleIndexContent);
    const typeSize = Buffer.byteLength(typeIndexContent);
    const idSize = Buffer.byteLength(idIndexContent);

    const elapsed = (Date.now() - startTime) / 1000;

    // Summary
    console.log('\n  Index Build Complete\n');
    console.log(`  Total Articles:  ${color.green(formatNumber(totalArticles))}`);
    console.log(`  Files Processed: ${color.cyan(String(processedFiles))}`);
    console.log(`  Time Elapsed:    ${color.cyan(formatDuration(elapsed))}`);
    console.log('');
    console.log('  Index Statistics:');
    console.log(`    Title Index:   ${formatNumber(Object.keys(titleIndex).length)} entries (${formatBytes(titleSize)})`);
    console.log(`    Type Index:    ${ARTICLE_TYPES.filter(t => typeIndex[t].length > 0).length} types (${formatBytes(typeSize)})`);
    for (const type of ARTICLE_TYPES) {
      if (typeIndex[type].length > 0) {
        console.log(`      ${type.padEnd(8)}: ${typeIndex[type].length} files`);
      }
    }
    console.log(`    ID Index:      ${formatNumber(idIndex.count)} entries (${formatBytes(idSize)})`);
    console.log('');
    console.log('  Output Files:');
    console.log(`    ${color.cyan(join(outputDir, 'titles.json'))}`);
    console.log(`    ${color.cyan(join(outputDir, 'types.json'))}`);
    console.log(`    ${color.cyan(join(outputDir, 'ids.json'))}`);
    if (compress) {
      console.log(`    ${color.cyan(join(outputDir, 'titles.json.gz'))}`);
      console.log(`    ${color.cyan(join(outputDir, 'types.json.gz'))}`);
      console.log(`    ${color.cyan(join(outputDir, 'ids.json.gz'))}`);
    }
    console.log('');
  });

/**
 * Normalize a title for index lookup
 */
function normalizeTitle(title: string): string {
  if (!title) return '';

  // Lowercase for case-insensitive lookup
  let normalized = title.toLowerCase();

  // Replace underscores with spaces (Wikipedia convention)
  normalized = normalized.replace(/_/g, ' ');

  // Trim whitespace
  normalized = normalized.trim();

  // Collapse multiple spaces
  normalized = normalized.replace(/\s+/g, ' ');

  return normalized;
}

/**
 * Extract article type from file path
 */
function extractTypeFromPath(filePath: string): ArticleType | null {
  // Match patterns like "data/person/person.0.parquet"
  for (const type of ARTICLE_TYPES) {
    if (filePath.includes(`/${type}/`) || filePath.includes(`/${type}.`)) {
      return type;
    }
  }
  return null;
}

/**
 * Find Parquet files recursively
 */
async function findParquetFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string, prefix: string): Promise<void> {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await scan(join(currentDir, entry.name), relativePath);
        } else if (entry.name.endsWith('.parquet')) {
          files.push(relativePath);
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  await scan(dir, '');
  return files;
}

/**
 * Article record from parquet
 */
interface ArticleRecord {
  $id?: string;
  id?: string;
  $type?: string;
  type?: string;
  title: string;
}

/**
 * Read articles from a Parquet file
 */
async function readParquetFile(filePath: string): Promise<ArticleRecord[]> {
  const buffer = await readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const articles: ArticleRecord[] = [];

  await parquetRead({
    file: arrayBuffer,
    columns: ['$id', 'title', '$type'],
    onComplete: (rawData: unknown) => {
      // hyparquet returns row-oriented data with numeric indices as keys
      // Each row is an array like [id, title, type] (in column order)
      const data = rawData as Record<string, unknown[]>;

      for (const [key, row] of Object.entries(data)) {
        // Skip non-numeric keys
        if (!/^\d+$/.test(key)) continue;

        if (!Array.isArray(row)) continue;

        // Row contains [$id, title, $type] in column order
        const [$id, title, $type] = row;

        const article: ArticleRecord = {
          title: String(title || ''),
        };
        if ($id != null) {
          article.$id = String($id);
        }
        if ($type != null) {
          article.$type = String($type);
        }
        articles.push(article);
      }
    },
  });

  return articles;
}

/**
 * Build indexes programmatically (for use from ingest command)
 */
export async function buildIndexes(
  dataDir: string,
  manifest?: Manifest
): Promise<{
  titleIndex: TitleIndex;
  typeIndex: TypeIndex;
  idIndex: SerializedIDIndex;
}> {
  const outputDir = join(dataDir, 'indexes');
  await mkdir(outputDir, { recursive: true });

  // Initialize indexes
  const titleIndex: TitleIndex = {};
  const typeIndex: TypeIndex = {} as TypeIndex;
  const idIndexEntries: Record<string, IDIndexEntry> = {};

  // Initialize type index with empty arrays
  for (const type of ARTICLE_TYPES) {
    typeIndex[type] = [];
  }

  // Find all parquet files
  let parquetFiles: string[] = [];
  const articlesDir = join(dataDir, 'articles');

  if (manifest && manifest.dataFiles) {
    parquetFiles = manifest.dataFiles.map(f => f.path);
  } else {
    // Try to find manifest
    try {
      const manifestPath = join(articlesDir, 'manifest.json');
      const manifestData = await readFile(manifestPath, 'utf-8');
      const loadedManifest = JSON.parse(manifestData) as Manifest;
      parquetFiles = loadedManifest.dataFiles.map(f => f.path);
    } catch {
      parquetFiles = await findParquetFilesRecursive(articlesDir);
    }
  }

  // Process each parquet file
  for (const file of parquetFiles) {
    const filePath = join(articlesDir, file);

    try {
      await stat(filePath);
    } catch {
      continue;
    }

    try {
      const articles = await readParquetFile(filePath);
      const fileType = extractTypeFromPath(file);

      if (fileType && !typeIndex[fileType].includes(file)) {
        typeIndex[fileType].push(file);
      }

      for (let row = 0; row < articles.length; row++) {
        const article = articles[row];
        if (!article) continue;

        const normalizedTitle = normalizeTitle(article.title);
        const articleType = (article.$type || article.type || fileType || 'other') as ArticleType;

        titleIndex[normalizedTitle] = {
          file,
          rowGroup: 0,
          row,
        };

        const articleId = article.$id || article.id;
        if (articleId) {
          idIndexEntries[articleId] = {
            type: articleType,
            file,
            rowGroup: 0,
            row,
          };
        }

        if (!fileType && articleType && !typeIndex[articleType].includes(file)) {
          typeIndex[articleType].push(file);
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Build serialized ID index
  const idIndex: SerializedIDIndex = {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    count: Object.keys(idIndexEntries).length,
    entries: idIndexEntries,
  };

  // Write indexes
  await writeFile(join(outputDir, 'titles.json'), JSON.stringify(titleIndex, null, 2));
  await writeFile(join(outputDir, 'types.json'), JSON.stringify(typeIndex, null, 2));
  await writeFile(join(outputDir, 'ids.json'), JSON.stringify(idIndex, null, 2));

  // Write compressed versions
  const titleCompressed = await gzipAsync(JSON.stringify(titleIndex));
  await writeFile(join(outputDir, 'titles.json.gz'), titleCompressed);

  const typeCompressed = await gzipAsync(JSON.stringify(typeIndex));
  await writeFile(join(outputDir, 'types.json.gz'), typeCompressed);

  const idCompressed = await gzipAsync(JSON.stringify(idIndex));
  await writeFile(join(outputDir, 'ids.json.gz'), idCompressed);

  return { titleIndex, typeIndex, idIndex };
}
