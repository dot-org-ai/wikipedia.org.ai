/**
 * Export Command
 *
 * Generate multiple Parquet files optimized for different use cases:
 * 1. wikipedia-full.parquet - Full articles with VARIANT infobox
 * 2. wikipedia-infoboxes.parquet - Infobox data by type
 * 3. wikipedia-{type}.parquet - Type-specific schemas
 * 4. wikipedia-index.parquet - Minimal search/browse index
 */

import { Command } from 'commander';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parquetRead } from '@dotdo/hyparquet';
import {
  color,
  createSpinner,
  createProgressBar,
  loadConfig,
  fatal,
  resolvePath,
  formatNumber,
  formatBytes,
  formatDuration,
  parseList,
} from './utils.js';
import type { ArticleRecord, ArticleType } from '../storage/types.js';
import { ARTICLE_TYPES } from '../storage/types.js';
import {
  writeFullFormat,
  writeInfoboxesFormat,
  writeIndexFormat,
  writeTypeFormat,
  type ExportResult,
  type ExportWriterConfig,
} from '../storage/export-formats.js';

/** Export command options */
interface ExportOptions {
  dataDir: string;
  output: string;
  formats?: string;
  types?: string;
  rowGroupSize: string;
  limit?: string;
  verbose: boolean;
}

/** Valid export formats */
const EXPORT_FORMATS = ['full', 'infoboxes', 'index', ...ARTICLE_TYPES] as const;
type ExportFormatName = (typeof EXPORT_FORMATS)[number];

export const exportCommand = new Command('export')
  .description('Export Wikipedia data to multiple Parquet formats')
  .option('-d, --data-dir <path>', 'Data directory containing ingested articles', './data')
  .option('-o, --output <path>', 'Output directory for exported files', './export')
  .option(
    '-f, --formats <formats>',
    'Formats to export (comma-separated: full,infoboxes,index,person,place,org,work,event,other)'
  )
  .option('-t, --types <types>', 'Article types for type-specific exports (comma-separated)')
  .option('--row-group-size <size>', 'Row group size for Parquet files', '10000')
  .option('-l, --limit <count>', 'Maximum number of articles to export')
  .option('-v, --verbose', 'Show verbose output', false)
  .action(async (options: ExportOptions) => {
    const config = await loadConfig();
    const dataDir = resolvePath(options.dataDir || config.dataDir || './data');
    const outputDir = resolvePath(options.output);
    const rowGroupSize = parseInt(options.rowGroupSize, 10);
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;

    // Parse formats
    let formats: ExportFormatName[] = [...EXPORT_FORMATS];
    if (options.formats) {
      const requested = parseList(options.formats) as ExportFormatName[];
      // Validate formats
      for (const f of requested) {
        if (!EXPORT_FORMATS.includes(f)) {
          fatal(`Invalid format: ${f}. Valid formats: ${EXPORT_FORMATS.join(', ')}`);
        }
      }
      formats = requested;
    }

    // Parse types for type-specific exports
    let types: ArticleType[] = [...ARTICLE_TYPES];
    if (options.types) {
      const requested = parseList(options.types) as ArticleType[];
      for (const t of requested) {
        if (!ARTICLE_TYPES.includes(t)) {
          fatal(`Invalid type: ${t}. Valid types: ${ARTICLE_TYPES.join(', ')}`);
        }
      }
      types = requested;
    }

    // Show configuration
    console.log('\n  Wikipedia Export\n');
    console.log(`  Data Directory:   ${color.cyan(dataDir)}`);
    console.log(`  Output Directory: ${color.cyan(outputDir)}`);
    console.log(`  Formats:          ${color.cyan(formats.join(', '))}`);
    if (limit) {
      console.log(`  Limit:            ${color.cyan(formatNumber(limit))}`);
    }
    console.log(`  Row Group Size:   ${color.cyan(formatNumber(rowGroupSize))}`);
    console.log('');

    const startTime = Date.now();

    // Create output directory
    const mkdirSpinner = createSpinner('Creating output directory...');
    try {
      await mkdir(outputDir, { recursive: true });
      mkdirSpinner.success('Output directory ready');
    } catch (error) {
      mkdirSpinner.fail(`Failed to create output directory: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Load articles from parquet files
    const loadSpinner = createSpinner('Loading articles from Parquet files...');
    let articles: ArticleRecord[];

    try {
      articles = await loadArticles(dataDir, limit, options.verbose);
      loadSpinner.success(`Loaded ${formatNumber(articles.length)} articles`);
    } catch (error) {
      loadSpinner.fail(`Failed to load articles: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    if (articles.length === 0) {
      fatal('No articles found in data directory');
    }

    // Show article type distribution
    console.log('\n  Article Distribution:');
    const typeCounts: Record<ArticleType, number> = {} as Record<ArticleType, number>;
    for (const type of ARTICLE_TYPES) {
      typeCounts[type] = 0;
    }
    for (const article of articles) {
      typeCounts[article.$type]++;
    }
    for (const [type, count] of Object.entries(typeCounts)) {
      if (count > 0) {
        const pct = ((count / articles.length) * 100).toFixed(1);
        console.log(`    ${type.padEnd(8)} ${formatNumber(count).padStart(10)} (${pct}%)`);
      }
    }
    console.log('');

    // Export configuration
    const exportConfig: ExportWriterConfig = {
      outputDir,
      rowGroupSize,
      statistics: true,
      bloomFilters: true,
    };

    // Create progress bar
    const progress = createProgressBar({
      total: formats.length,
      format: '  :bar :percent | :current/:total formats | :format',
    });

    const results: ExportResult[] = [];
    let formatIndex = 0;

    // Export each format
    for (const format of formats) {
      progress.update(formatIndex, { format: color.dim(format) });

      try {
        let result: ExportResult | ExportResult[];

        if (format === 'full') {
          result = await writeFullFormat(articles, exportConfig);
        } else if (format === 'infoboxes') {
          result = await writeInfoboxesFormat(articles, exportConfig);
        } else if (format === 'index') {
          result = await writeIndexFormat(articles, exportConfig);
        } else {
          // Type-specific format
          const articleType = format as ArticleType;
          if (types.includes(articleType)) {
            result = await writeTypeFormat(articles, articleType, exportConfig);
          } else {
            formatIndex++;
            continue;
          }
        }

        if (Array.isArray(result)) {
          results.push(...result);
        } else if (result.rowCount > 0) {
          results.push(result);
        }

        formatIndex++;
      } catch (error) {
        progress.interrupt(color.yellow(`Warning: Failed to export ${format}: ${error instanceof Error ? error.message : error}`));
        formatIndex++;
      }
    }

    progress.complete();

    // Calculate totals
    const totalSize = results.reduce((sum, r) => sum + r.size, 0);
    const totalRows = results.reduce((sum, r) => sum + r.rowCount, 0);
    const elapsed = (Date.now() - startTime) / 1000;

    // Summary
    console.log('\n  Export Complete\n');
    console.log(`  Total Files:     ${color.green(String(results.length))}`);
    console.log(`  Total Size:      ${color.cyan(formatBytes(totalSize))}`);
    console.log(`  Total Rows:      ${color.cyan(formatNumber(totalRows))}`);
    console.log(`  Time Elapsed:    ${color.cyan(formatDuration(elapsed))}`);
    console.log('');

    // File details
    console.log('  Exported Files:');
    for (const result of results) {
      const sizeStr = formatBytes(result.size).padStart(10);
      const rowStr = formatNumber(result.rowCount).padStart(12);
      console.log(`    ${color.cyan(result.format.padEnd(12))} ${sizeStr} ${rowStr} rows  ${color.dim(result.path)}`);
    }
    console.log('');

    // Usage examples
    console.log('  Usage Examples:');
    console.log('');
    console.log('    # Query full articles');
    console.log('    ' + color.dim("duckdb -c \"SELECT title, description FROM read_parquet('wikipedia-full.parquet') LIMIT 10\""));
    console.log('');
    console.log('    # Filter by type');
    console.log('    ' + color.dim("duckdb -c \"SELECT * FROM read_parquet('wikipedia-person.parquet') WHERE birth_date IS NOT NULL\""));
    console.log('');
    console.log('    # Search infoboxes');
    console.log('    ' + color.dim("duckdb -c \"SELECT title, infobox_type FROM read_parquet('wikipedia-infoboxes.parquet') WHERE country = 'United States'\""));
    console.log('');
    console.log('    # Fast title lookup');
    console.log('    ' + color.dim("duckdb -c \"SELECT * FROM read_parquet('wikipedia-index.parquet') WHERE title ILIKE '%einstein%'\""));
    console.log('');
  });

/**
 * Load articles from Parquet files in data directory
 */
async function loadArticles(
  dataDir: string,
  limit?: number,
  verbose?: boolean
): Promise<ArticleRecord[]> {
  const articles: ArticleRecord[] = [];
  const articlesDir = join(dataDir, 'articles');

  // Find all parquet files
  const parquetFiles = await findParquetFiles(articlesDir);

  if (parquetFiles.length === 0) {
    // Try looking in data directory directly
    const directFiles = await findParquetFiles(dataDir);
    if (directFiles.length === 0) {
      throw new Error(`No Parquet files found in ${dataDir}`);
    }
    parquetFiles.push(...directFiles);
  }

  for (const file of parquetFiles) {
    if (limit && articles.length >= limit) break;

    const filePath = file.startsWith(dataDir) ? file : join(articlesDir, file);

    try {
      const fileArticles = await readParquetArticles(filePath);

      for (const article of fileArticles) {
        if (limit && articles.length >= limit) break;
        articles.push(article);
      }

      if (verbose) {
        console.log(`  Loaded ${fileArticles.length} articles from ${file}`);
      }
    } catch (error) {
      if (verbose) {
        console.log(`  Warning: Failed to read ${file}: ${error}`);
      }
    }
  }

  return articles;
}

/**
 * Find all Parquet files recursively
 */
async function findParquetFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string): Promise<void> {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.name.endsWith('.parquet')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  await scan(dir);
  return files;
}

/**
 * Read articles from a Parquet file
 */
async function readParquetArticles(filePath: string): Promise<ArticleRecord[]> {
  const buffer = await readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const articles: ArticleRecord[] = [];

  await parquetRead({
    file: arrayBuffer,
    onComplete: (rawData: unknown) => {
      const data = rawData as Record<string, unknown[]>;

      for (const [key, row] of Object.entries(data)) {
        // Skip non-numeric keys (metadata)
        if (!/^\d+$/.test(key)) continue;
        if (!Array.isArray(row)) continue;

        // Map row array to article object
        // Column order: $id, $type, title, description, wikidata_id, coords_lat, coords_lon, infobox, content, updated_at
        const [$id, $type, title, description, wikidata_id, coords_lat, coords_lon, infobox, content, updated_at] = row;

        let parsedInfobox: Record<string, unknown> | null = null;
        if (infobox) {
          try {
            parsedInfobox = typeof infobox === 'string' ? JSON.parse(infobox) : infobox as Record<string, unknown>;
          } catch {
            // Invalid JSON, ignore
          }
        }

        const article: ArticleRecord = {
          $id: String($id || ''),
          $type: (String($type || 'other') as ArticleType),
          title: String(title || ''),
          description: String(description || ''),
          wikidata_id: wikidata_id ? String(wikidata_id) : null,
          coords_lat: typeof coords_lat === 'number' ? coords_lat : null,
          coords_lon: typeof coords_lon === 'number' ? coords_lon : null,
          infobox: parsedInfobox,
          content: String(content || ''),
          updated_at: updated_at instanceof Date ? updated_at : new Date(updated_at as string || Date.now()),
        };

        articles.push(article);
      }
    },
  });

  return articles;
}

export default exportCommand;
