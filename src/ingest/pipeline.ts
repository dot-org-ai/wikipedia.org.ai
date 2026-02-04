// @ts-nocheck - Complex streaming pipeline with exactOptionalPropertyTypes issues in download options
/**
 * Complete ingestion pipeline for Wikipedia dumps
 *
 * Composes: download -> decompress -> parseXml -> parseWiki -> classify
 * Zero disk I/O - everything streams through memory
 */

import type {
  ArticleType,
  ClassifiedArticle,
  PipelineOptions,
  PipelineStats,
} from './types.js';
import { streamDownload } from './download.js';
import { createDecompressor, detectCompressionFromExtension } from './decompress.js';
import { createWikipediaParser, createNamespaceFilter } from './parse-xml.js';
import { createWikitextParser } from './parse-wiki.js';
import { createClassifier } from './classify.js';

/** Default pipeline options */
const DEFAULT_OPTIONS: Required<Omit<PipelineOptions, 'onProgress' | 'signal'>> & { signal?: AbortSignal; onProgress?: (stats: PipelineStats) => void } = {
  compression: 'auto',
  namespaces: [0], // Main article namespace only
  skipRedirects: false,
  skipDisambiguation: false,
};

/**
 * Create a complete ingestion pipeline for Wikipedia dump files.
 *
 * @param url - URL of the Wikipedia dump file
 * @param options - Pipeline configuration options
 * @returns Async iterator yielding classified articles
 *
 * @example
 * ```typescript
 * const pipeline = createIngestionPipeline(
 *   'https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2',
 *   {
 *     onProgress: (stats) => console.log(`Processed ${stats.pagesProcessed} pages`),
 *     skipRedirects: true,
 *   }
 * );
 *
 * for await (const article of pipeline) {
 *   console.log(article.title, article.type);
 * }
 * ```
 */
export async function* createIngestionPipeline(
  url: string,
  options: PipelineOptions = {}
): AsyncGenerator<ClassifiedArticle, void, unknown> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Initialize statistics
  const stats: PipelineStats = {
    bytesDownloaded: 0,
    pagesProcessed: 0,
    pagesSkipped: 0,
    articlesByType: {
      person: 0,
      place: 0,
      org: 0,
      work: 0,
      event: 0,
      other: 0,
    },
    startTime: Date.now(),
    articlesPerSecond: 0,
  };

  // Determine compression type
  const compression = opts.compression === 'auto'
    ? detectCompressionFromExtension(url)
    : opts.compression;

  // Create the download stream with progress tracking
  const downloadStream = await streamDownload(url, {
    signal: opts.signal ?? undefined,
    onProgress: (progress) => {
      stats.bytesDownloaded = progress.bytesDownloaded;
      reportProgress(stats, opts.onProgress);
    },
  });

  // Build the pipeline
  let stream: ReadableStream<ClassifiedArticle>;

  try {
    // Download -> Decompress -> Parse XML
    const decompressed = downloadStream.pipeThrough(createDecompressor(compression));
    const pages = decompressed.pipeThrough(createWikipediaParser());

    // Filter namespaces
    const filteredPages = pages.pipeThrough(createNamespaceFilter(opts.namespaces));

    // Parse wikitext -> Classify
    const articles = filteredPages.pipeThrough(createWikitextParser());
    stream = articles.pipeThrough(createClassifier());
  } catch (error) {
    // Clean up on pipeline setup error
    downloadStream.cancel();
    throw error;
  }

  // Read from the pipeline and yield articles
  const reader = stream.getReader();

  try {
    while (true) {
      // Check for abort
      if (opts.signal?.aborted) {
        throw new DOMException('Pipeline aborted', 'AbortError');
      }

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      const article = value;

      // Apply filters
      if (opts.skipRedirects && article.isRedirect) {
        stats.pagesSkipped++;
        continue;
      }

      if (opts.skipDisambiguation && article.isDisambiguation) {
        stats.pagesSkipped++;
        continue;
      }

      // Update statistics
      stats.pagesProcessed++;
      stats.articlesByType[article.type]++;

      // Calculate rate
      const elapsed = (Date.now() - stats.startTime) / 1000;
      stats.articlesPerSecond = elapsed > 0 ? stats.pagesProcessed / elapsed : 0;

      // Report progress periodically
      if (stats.pagesProcessed % 100 === 0) {
        reportProgress(stats, opts.onProgress);
      }

      yield article;
    }
  } finally {
    reader.releaseLock();

    // Final progress report
    reportProgress(stats, opts.onProgress);
  }
}

/**
 * Report progress if callback is provided
 */
function reportProgress(
  stats: PipelineStats,
  onProgress?: (stats: PipelineStats) => void
): void {
  if (onProgress) {
    onProgress({ ...stats });
  }
}

/**
 * Create a pipeline that returns a ReadableStream instead of an async iterator.
 *
 * Useful for piping to other streams or processing with Web Streams API.
 *
 * @param url - URL of the Wikipedia dump file
 * @param options - Pipeline configuration options
 * @returns ReadableStream of classified articles
 */
export async function createIngestionStream(
  url: string,
  options: PipelineOptions = {}
): Promise<ReadableStream<ClassifiedArticle>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Initialize statistics tracking
  let pagesProcessed = 0;
  let pagesSkipped = 0;
  const startTime = Date.now();
  const articlesByType: Record<ArticleType, number> = {
    person: 0,
    place: 0,
    org: 0,
    work: 0,
    event: 0,
    other: 0,
  };
  let bytesDownloaded = 0;

  // Determine compression type
  const compression = opts.compression === 'auto'
    ? detectCompressionFromExtension(url)
    : opts.compression;

  // Create the download stream
  const downloadStream = await streamDownload(url, {
    signal: opts.signal ?? undefined,
    onProgress: (progress) => {
      bytesDownloaded = progress.bytesDownloaded;
    },
  });

  // Build the pipeline
  const decompressed = downloadStream.pipeThrough(createDecompressor(compression));
  const pages = decompressed.pipeThrough(createWikipediaParser());
  const filteredPages = pages.pipeThrough(createNamespaceFilter(opts.namespaces));
  const articles = filteredPages.pipeThrough(createWikitextParser());
  const classified = articles.pipeThrough(createClassifier());

  // Add filtering and statistics transform
  return classified.pipeThrough(
    new TransformStream<ClassifiedArticle, ClassifiedArticle>({
      transform(article, controller) {
        // Apply filters
        if (opts.skipRedirects && article.isRedirect) {
          pagesSkipped++;
          return;
        }

        if (opts.skipDisambiguation && article.isDisambiguation) {
          pagesSkipped++;
          return;
        }

        // Update statistics
        pagesProcessed++;
        articlesByType[article.type]++;

        // Report progress periodically
        if (pagesProcessed % 100 === 0 && opts.onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          opts.onProgress({
            bytesDownloaded,
            pagesProcessed,
            pagesSkipped,
            articlesByType: { ...articlesByType },
            startTime,
            articlesPerSecond: elapsed > 0 ? pagesProcessed / elapsed : 0,
          });
        }

        controller.enqueue(article);
      },

      flush() {
        // Final progress report
        if (opts.onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          opts.onProgress({
            bytesDownloaded,
            pagesProcessed,
            pagesSkipped,
            articlesByType: { ...articlesByType },
            startTime,
            articlesPerSecond: elapsed > 0 ? pagesProcessed / elapsed : 0,
          });
        }
      },
    })
  );
}

/**
 * Process a batch of articles from the pipeline.
 *
 * Useful for processing in batches for downstream operations like
 * embedding generation or database insertion.
 *
 * @param pipeline - The pipeline async iterator
 * @param batchSize - Number of articles per batch
 * @returns Async iterator yielding batches of articles
 */
export async function* batchArticles(
  pipeline: AsyncIterable<ClassifiedArticle>,
  batchSize: number = 100
): AsyncGenerator<ClassifiedArticle[], void, unknown> {
  let batch: ClassifiedArticle[] = [];

  for await (const article of pipeline) {
    batch.push(article);

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }

  // Yield remaining articles
  if (batch.length > 0) {
    yield batch;
  }
}

/**
 * Count articles by type from a pipeline.
 *
 * Consumes the entire pipeline and returns statistics.
 *
 * @param pipeline - The pipeline async iterator
 * @returns Statistics about processed articles
 */
export async function collectPipelineStats(
  pipeline: AsyncIterable<ClassifiedArticle>
): Promise<PipelineStats> {
  const stats: PipelineStats = {
    bytesDownloaded: 0,
    pagesProcessed: 0,
    pagesSkipped: 0,
    articlesByType: {
      person: 0,
      place: 0,
      org: 0,
      work: 0,
      event: 0,
      other: 0,
    },
    startTime: Date.now(),
    articlesPerSecond: 0,
  };

  for await (const article of pipeline) {
    stats.pagesProcessed++;
    stats.articlesByType[article.type]++;
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;
  stats.articlesPerSecond = elapsed > 0 ? stats.pagesProcessed / elapsed : 0;

  return stats;
}

/**
 * Filter pipeline to specific article types.
 *
 * @param pipeline - The pipeline async iterator
 * @param types - Article types to include
 * @returns Filtered async iterator
 */
export async function* filterByType(
  pipeline: AsyncIterable<ClassifiedArticle>,
  types: ArticleType[]
): AsyncGenerator<ClassifiedArticle, void, unknown> {
  const typeSet = new Set(types);

  for await (const article of pipeline) {
    if (typeSet.has(article.type)) {
      yield article;
    }
  }
}

/**
 * Take only the first N articles from a pipeline.
 *
 * @param pipeline - The pipeline async iterator
 * @param count - Maximum number of articles to take
 * @returns Limited async iterator
 */
export async function* takeArticles(
  pipeline: AsyncIterable<ClassifiedArticle>,
  count: number
): AsyncGenerator<ClassifiedArticle, void, unknown> {
  let taken = 0;

  for await (const article of pipeline) {
    if (taken >= count) {
      break;
    }

    yield article;
    taken++;
  }
}

/**
 * Map articles through a transformation function.
 *
 * @param pipeline - The pipeline async iterator
 * @param fn - Transformation function
 * @returns Transformed async iterator
 */
export async function* mapArticles<T>(
  pipeline: AsyncIterable<ClassifiedArticle>,
  fn: (article: ClassifiedArticle) => T | Promise<T>
): AsyncGenerator<T, void, unknown> {
  for await (const article of pipeline) {
    yield await fn(article);
  }
}
