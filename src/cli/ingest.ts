/**
 * Ingest Command
 *
 * Download and process Wikipedia dump files into local Parquet storage.
 */

import { Command } from 'commander';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  color,
  createProgressBar,
  createSpinner,
  formatBytes,
  formatDuration,
  formatNumber,
  loadConfig,
  fatal,
  warn,
  resolvePath,
  parseList,
} from './utils.js';
import {
  createIngestionPipeline,
  filterByType,
  takeArticles,
  batchArticles,
} from '../ingest/index.js';
import type { ArticleType, ClassifiedArticle } from '../ingest/types.js';
import { PartitionedWriter } from '../storage/index.js';

/** Ingest command options */
interface IngestOptions {
  output: string;
  types?: string;
  limit?: string;
  skipRedirects: boolean;
  skipDisambiguation: boolean;
  batchSize: string;
  resume: boolean;
  dryRun: boolean;
  verbose: boolean;
}

/** Resume state */
interface ResumeState {
  url: string;
  articlesProcessed: number;
  lastArticleId: number;
  startedAt: string;
  lastUpdatedAt: string;
}

export const ingestCommand = new Command('ingest')
  .description('Download and process Wikipedia dump into Parquet files')
  .argument('<url>', 'Wikipedia dump URL (e.g., https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2)')
  .option('-o, --output <dir>', 'Output directory', './data')
  .option('-t, --types <types>', 'Filter to article types (comma-separated: person,place,org,work,event,other)')
  .option('-l, --limit <count>', 'Maximum number of articles to process')
  .option('--skip-redirects', 'Skip redirect pages', false)
  .option('--skip-disambiguation', 'Skip disambiguation pages', false)
  .option('-b, --batch-size <size>', 'Batch size for writing', '1000')
  .option('-r, --resume', 'Resume from previous checkpoint', false)
  .option('--dry-run', 'Show what would be done without processing', false)
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (url: string, options: IngestOptions) => {
    const config = await loadConfig();
    const outputDir = resolvePath(options.output || config.dataDir || './data');
    const batchSize = parseInt(options.batchSize, 10);
    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    const types = options.types ? parseList(options.types) as ArticleType[] : undefined;

    // Validate types
    const validTypes: ArticleType[] = ['person', 'place', 'org', 'work', 'event', 'other'];
    if (types) {
      for (const t of types) {
        if (!validTypes.includes(t)) {
          fatal(`Invalid type: ${t}. Valid types: ${validTypes.join(', ')}`);
        }
      }
    }

    // Validate URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fatal('URL must start with http:// or https://');
    }

    // Show configuration
    console.log('\n  Wikipedia Ingestion\n');
    console.log(`  URL:           ${color.cyan(url)}`);
    console.log(`  Output:        ${color.cyan(outputDir)}`);
    if (types) {
      console.log(`  Types:         ${color.cyan(types.join(', '))}`);
    }
    if (limit) {
      console.log(`  Limit:         ${color.cyan(formatNumber(limit))}`);
    }
    console.log(`  Batch Size:    ${color.cyan(formatNumber(batchSize))}`);
    console.log(`  Skip Redirect: ${options.skipRedirects ? color.green('yes') : color.gray('no')}`);
    console.log(`  Skip Disambig: ${options.skipDisambiguation ? color.green('yes') : color.gray('no')}`);
    console.log('');

    if (options.dryRun) {
      console.log(color.yellow('  Dry run mode - no files will be written.\n'));
      return;
    }

    // Create output directories
    const spinner = createSpinner('Creating output directories...');
    try {
      await mkdir(outputDir, { recursive: true });
      await mkdir(join(outputDir, 'articles'), { recursive: true });
      await mkdir(join(outputDir, 'indexes'), { recursive: true });
      spinner.success('Output directories ready');
    } catch (error) {
      spinner.fail(`Failed to create directories: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Check for resume state
    let resumeState: ResumeState | null = null;
    const resumePath = join(outputDir, '.ingest-state.json');

    if (options.resume) {
      try {
        const data = await readFile(resumePath, 'utf-8');
        resumeState = JSON.parse(data) as ResumeState;
        if (resumeState.url !== url) {
          warn(`Resume state is for different URL: ${resumeState.url}`);
          resumeState = null;
        } else {
          console.log(`  Resuming from ${color.cyan(formatNumber(resumeState.articlesProcessed))} articles\n`);
        }
      } catch {
        // No resume state
      }
    }

    // Initialize writer
    const writer = new PartitionedWriter({
      outputDir: join(outputDir, 'articles'),
      rowGroupSize: 10000,
      maxFileSize: 25 * 1024 * 1024, // 25MB
      statistics: true,
      bloomFilters: true,
    });

    // Initialize stats
    let totalArticles = 0;
    let bytesDownloaded = 0;
    const startTime = Date.now();
    const articlesByType: Record<ArticleType, number> = {
      person: 0,
      place: 0,
      org: 0,
      work: 0,
      event: 0,
      other: 0,
    };

    // Create progress bar
    const progress = createProgressBar({
      total: limit || 1000000, // Default estimate if no limit
      format: '  :bar :percent | :current articles | :rate/s | ETA :eta | :type',
      showEta: true,
    });

    // Abort controller for graceful shutdown
    const abortController = new AbortController();
    let shuttingDown = false;

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      progress.interrupt(color.yellow('\nShutting down gracefully...'));
      abortController.abort();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      // Create pipeline
      const progressSpinner = createSpinner('Connecting to Wikipedia dump server...');

      let pipeline = createIngestionPipeline(url, {
        signal: abortController.signal,
        skipRedirects: options.skipRedirects,
        skipDisambiguation: options.skipDisambiguation,
        onProgress: (stats) => {
          bytesDownloaded = stats.bytesDownloaded;
        },
      });

      progressSpinner.success('Connected to dump server');

      // Apply filters
      if (types && types.length > 0) {
        pipeline = filterByType(pipeline, types);
      }

      if (limit) {
        pipeline = takeArticles(pipeline, limit + (resumeState?.articlesProcessed || 0));
      }

      // Process in batches
      let batchNumber = 0;
      let lastProgressUpdate = Date.now();

      for await (const batch of batchArticles(pipeline, batchSize)) {
        if (shuttingDown) break;

        // Skip if resuming and already processed
        if (resumeState) {
          const filtered = batch.filter((a) => a.id > resumeState!.lastArticleId);
          if (filtered.length === 0) continue;
        }

        // Convert to storage format
        const articles = batch.map((article) => convertToStorageFormat(article));

        // Write batch
        await writer.write(articles);

        // Update stats
        totalArticles += batch.length;
        batchNumber++;

        for (const article of batch) {
          articlesByType[article.type]++;
        }

        // Update progress (throttled)
        if (Date.now() - lastProgressUpdate > 100) {
          const lastBatchItem = batch[batch.length - 1];
          const currentType = lastBatchItem?.type ?? 'other';
          progress.update(limit ? Math.min(totalArticles, limit) : totalArticles, {
            type: color.dim(currentType),
          });
          lastProgressUpdate = Date.now();
        }

        // Save resume state periodically
        if (batchNumber % 10 === 0) {
          const lastBatchItem = batch[batch.length - 1];
          if (lastBatchItem) {
            const state: ResumeState = {
              url,
              articlesProcessed: totalArticles,
              lastArticleId: lastBatchItem.id,
              startedAt: resumeState?.startedAt || new Date(startTime).toISOString(),
              lastUpdatedAt: new Date().toISOString(),
            };
            await writeFile(resumePath, JSON.stringify(state, null, 2));
          }
        }

        if (options.verbose && batchNumber % 100 === 0) {
          progress.interrupt(
            `  Batch ${batchNumber}: ${formatNumber(totalArticles)} articles, ` +
            `${formatBytes(bytesDownloaded)} downloaded`
          );
        }
      }

      progress.complete();

      // Flush remaining data and finalize
      const flushSpinner = createSpinner('Flushing remaining data...');
      const manifest = await writer.finalize();
      flushSpinner.success('Data flushed');

      // Build indexes
      const indexSpinner = createSpinner('Building indexes...');
      await buildIndexes(outputDir, manifest);
      indexSpinner.success('Indexes built');

      // Write additional manifest info
      const manifestSpinner = createSpinner('Writing manifest...');
      await writeManifest(outputDir, {
        url,
        totalArticles,
        articlesByType,
        startTime,
        endTime: Date.now(),
        manifest,
      });
      manifestSpinner.success('Manifest written');

      // Clean up resume state
      try {
        const { unlink } = await import('node:fs/promises');
        await unlink(resumePath);
      } catch {
        // File might not exist
      }

      // Final summary
      const elapsed = (Date.now() - startTime) / 1000;
      console.log('\n  Ingestion Complete\n');
      console.log(`  Total Articles: ${color.green(formatNumber(totalArticles))}`);
      console.log(`  Time Elapsed:   ${color.cyan(formatDuration(elapsed))}`);
      console.log(`  Rate:           ${color.cyan(formatNumber(Math.round(totalArticles / elapsed)))}/s`);
      if (bytesDownloaded > 0) {
        console.log(`  Downloaded:     ${color.cyan(formatBytes(bytesDownloaded))}`);
      }
      console.log('');
      console.log('  Articles by Type:');
      for (const [type, count] of Object.entries(articlesByType)) {
        if (count > 0) {
          const pct = ((count / totalArticles) * 100).toFixed(1);
          console.log(`    ${type.padEnd(8)} ${formatNumber(count).padStart(10)} (${pct}%)`);
        }
      }
      console.log('');
    } catch (error) {
      progress.complete();
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(color.yellow('\nIngestion interrupted. Use --resume to continue.\n'));
      } else {
        fatal(`Ingestion failed: ${error instanceof Error ? error.message : error}`);
      }
    } finally {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    }
  });

/**
 * Convert classified article to storage format
 */
function convertToStorageFormat(article: ClassifiedArticle): {
  $id: string;
  $type: ArticleType;
  title: string;
  description: string;
  wikidata_id: string | null;
  coords_lat: number | null;
  coords_lon: number | null;
  infobox: Record<string, unknown> | null;
  content: string;
  updated_at: Date;
} {
  // Extract first paragraph as description
  const firstParagraph = article.plaintext.split('\n\n')[0] || '';
  const description = firstParagraph.slice(0, 500);

  // Extract coordinates if available
  let coordsLat: number | null = null;
  let coordsLon: number | null = null;

  if (article.infoboxes.length > 0) {
    const infobox = article.infoboxes[0];
    if (infobox) {
      const coordinates = infobox.data['coordinates'];
      if (typeof coordinates === 'string') {
        const match = coordinates.match(/([-\d.]+)[,\s]+([-\d.]+)/);
        if (match) {
          const lat = match[1];
          const lon = match[2];
          if (lat && lon) {
            coordsLat = parseFloat(lat);
            coordsLon = parseFloat(lon);
          }
        }
      }
    }
  }

  // Parse timestamp with fallback to current time
  const parsedDate = article.timestamp ? new Date(article.timestamp) : new Date();
  const updated_at = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  return {
    $id: String(article.id),
    $type: article.type,
    title: article.title,
    description,
    wikidata_id: null, // Would need additional processing to extract
    coords_lat: coordsLat,
    coords_lon: coordsLon,
    infobox: article.infoboxes.length > 0 ? (article.infoboxes[0]?.data ?? null) : null,
    content: article.plaintext,
    updated_at,
  };
}

/**
 * Build indexes for the written data
 */
async function buildIndexes(
  outputDir: string,
  _manifest: { dataFiles: Array<{ path: string; rowCount: number }> }
): Promise<void> {
  // Import and use the real index builder
  const { buildIndexes: buildRealIndexes } = await import('./build-indexes.js');
  await buildRealIndexes(outputDir);
}

/**
 * Write manifest file
 */
async function writeManifest(
  outputDir: string,
  data: {
    url: string;
    totalArticles: number;
    articlesByType: Record<string, number>;
    startTime: number;
    endTime: number;
    manifest: { dataFiles: Array<{ path: string; rowCount: number; size?: number }> };
  }
): Promise<void> {
  const manifestData = {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    source: {
      url: data.url,
      processed_at: new Date(data.startTime).toISOString(),
    },
    totalArticles: data.totalArticles,
    articlesByType: data.articlesByType,
    processing: {
      startTime: new Date(data.startTime).toISOString(),
      endTime: new Date(data.endTime).toISOString(),
      durationMs: data.endTime - data.startTime,
    },
    dataFiles: data.manifest.dataFiles.map((f) => ({
      path: f.path,
      rowCount: f.rowCount,
      size: f.size || 0,
    })),
    indexFiles: {
      titles: 'indexes/titles.json',
      types: 'indexes/types.json',
      ids: 'indexes/ids.json',
      bloomFilters: [],
    },
  };

  await writeFile(join(outputDir, 'manifest.json'), JSON.stringify(manifestData, null, 2));
}
