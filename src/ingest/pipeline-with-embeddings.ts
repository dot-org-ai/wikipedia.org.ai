/**
 * Enhanced ingestion pipeline with embeddings generation
 *
 * Wraps the base pipeline to add optional embedding generation.
 * Uses the embeddings.workers.do API for batch embedding generation.
 */

import type {
  ClassifiedArticle,
  EmbeddingsConfig,
  PipelineOptions,
  PipelineStats,
} from './types.js';
import { createIngestionPipeline, batchArticles } from './pipeline.js';
import {
  EmbeddingsClient,
  createEmbeddingsClient,
} from '../embeddings/client.js';
import { createLogger } from '../lib/logger.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('ingest:embeddings');

/** Article with optional embedding */
export interface ArticleWithEmbedding extends ClassifiedArticle {
  /** Generated embedding vector (if embeddings enabled) */
  embedding?: number[] | undefined;
  /** Embedding model used */
  embeddingModel?: string | undefined;
}

/** Enhanced pipeline stats with embedding information */
export interface EnhancedPipelineStats extends PipelineStats {
  embeddingsGenerated: number;
  embeddingErrors: number;
  embeddingBatchesProcessed: number;
}

/** Options for the embeddings-enabled pipeline */
export interface EmbeddingsPipelineOptions extends PipelineOptions {
  /** Embeddings configuration (required for this pipeline) */
  embeddings: EmbeddingsConfig;
  /** Batch size for processing articles (affects embedding batch size) */
  articleBatchSize?: number;
  /** Callback for embedding progress */
  onEmbeddingProgress?: (stats: {
    generated: number;
    errors: number;
    batchNumber: number;
  }) => void;
}

/**
 * Create an ingestion pipeline with integrated embeddings generation.
 *
 * Articles are processed in batches, with embeddings generated for each batch.
 * Failed embeddings don't stop the pipeline - articles are yielded without embeddings.
 *
 * @param url - URL of the Wikipedia dump file
 * @param options - Pipeline options including embeddings configuration
 * @returns Async iterator yielding articles with optional embeddings
 *
 * @example
 * ```typescript
 * const pipeline = createEmbeddingsPipeline(
 *   'https://dumps.wikimedia.org/simplewiki/latest/simplewiki-latest-pages-articles.xml.bz2',
 *   {
 *     skipRedirects: true,
 *     embeddings: {
 *       enabled: true,
 *       model: 'bge-m3',
 *       batchSize: 50,
 *     },
 *   }
 * );
 *
 * for await (const article of pipeline) {
 *   console.log(article.title, article.embedding?.length);
 * }
 * ```
 */
export async function* createEmbeddingsPipeline(
  url: string,
  options: EmbeddingsPipelineOptions
): AsyncGenerator<ArticleWithEmbedding, EnhancedPipelineStats, unknown> {
  const {
    embeddings: embeddingsConfig,
    articleBatchSize = embeddingsConfig.batchSize ?? 50,
    onEmbeddingProgress,
    ...baseOptions
  } = options;

  // Create the base pipeline
  const basePipeline = createIngestionPipeline(url, baseOptions);

  // Initialize stats
  const enhancedStats: EnhancedPipelineStats = {
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
    embeddingsGenerated: 0,
    embeddingErrors: 0,
    embeddingBatchesProcessed: 0,
  };

  // Create embeddings client if enabled
  let embeddingsClient: EmbeddingsClient | null = null;
  if (embeddingsConfig.enabled) {
    embeddingsClient = createEmbeddingsClient({
      baseUrl: embeddingsConfig.apiUrl,
      batchSize: embeddingsConfig.batchSize,
      maxRetries: embeddingsConfig.maxRetries,
      timeout: embeddingsConfig.timeout,
      defaultModel: embeddingsConfig.model,
    });
  }

  // Process in batches
  for await (const batch of batchArticles(basePipeline, articleBatchSize)) {
    // Generate embeddings for the batch if enabled
    let embeddings: Map<number, number[]> | null = null;

    if (embeddingsClient && embeddingsConfig.enabled) {
      try {
        // Create text representations for embedding
        const texts = batch.map((article) => {
          // Use title + first paragraph for embedding
          const firstParagraph = article.plaintext.split('\n\n')[0] || '';
          return `${article.title}\n\n${firstParagraph}`.slice(0, 8000);
        });

        // Generate embeddings
        const embeddingResults = await embeddingsClient.generateEmbeddings(
          texts,
          embeddingsConfig.model
        );

        // Map embeddings by index
        embeddings = new Map();
        for (let i = 0; i < embeddingResults.length; i++) {
          const emb = embeddingResults[i];
          if (emb) {
            embeddings.set(i, emb);
          }
        }

        enhancedStats.embeddingsGenerated += embeddingResults.length;
      } catch (error) {
        getLog().warn('Batch embedding generation failed', {
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        }, 'generateEmbeddings');
        enhancedStats.embeddingErrors += batch.length;
      }

      enhancedStats.embeddingBatchesProcessed++;

      // Report progress
      if (onEmbeddingProgress) {
        onEmbeddingProgress({
          generated: enhancedStats.embeddingsGenerated,
          errors: enhancedStats.embeddingErrors,
          batchNumber: enhancedStats.embeddingBatchesProcessed,
        });
      }
    }

    // Yield articles with embeddings
    for (let i = 0; i < batch.length; i++) {
      const article = batch[i];
      if (!article) continue;

      const articleWithEmbedding: ArticleWithEmbedding = {
        ...article,
      };

      const emb = embeddings?.get(i);
      if (emb) {
        articleWithEmbedding.embedding = emb;
        articleWithEmbedding.embeddingModel = embeddingsConfig.model ?? 'bge-m3';
      }

      // Update stats
      enhancedStats.pagesProcessed++;
      enhancedStats.articlesByType[article.type]++;

      const elapsed = (Date.now() - enhancedStats.startTime) / 1000;
      enhancedStats.articlesPerSecond =
        elapsed > 0 ? enhancedStats.pagesProcessed / elapsed : 0;

      yield articleWithEmbedding;
    }
  }

  return enhancedStats;
}

/**
 * Process articles and add embeddings to an existing batch.
 *
 * Utility function for adding embeddings to pre-fetched articles.
 *
 * @param articles - Array of classified articles
 * @param embeddingsConfig - Embeddings configuration
 * @returns Array of articles with embeddings
 */
export async function addEmbeddingsToArticles(
  articles: ClassifiedArticle[],
  embeddingsConfig: EmbeddingsConfig
): Promise<ArticleWithEmbedding[]> {
  if (!embeddingsConfig.enabled || articles.length === 0) {
    return articles.map((a) => ({ ...a }));
  }

  const client = createEmbeddingsClient({
    baseUrl: embeddingsConfig.apiUrl,
    batchSize: embeddingsConfig.batchSize,
    maxRetries: embeddingsConfig.maxRetries,
    timeout: embeddingsConfig.timeout,
    defaultModel: embeddingsConfig.model,
  });

  // Create text representations
  const texts = articles.map((article) => {
    const firstParagraph = article.plaintext.split('\n\n')[0] || '';
    return `${article.title}\n\n${firstParagraph}`.slice(0, 8000);
  });

  try {
    const embeddings = await client.generateEmbeddings(
      texts,
      embeddingsConfig.model
    );

    return articles.map((article, i) => ({
      ...article,
      embedding: embeddings[i],
      embeddingModel: embeddingsConfig.model ?? 'bge-m3',
    }));
  } catch (error) {
    getLog().error('Failed to generate embeddings for article batch', {
      articleCount: articles.length,
      error: error instanceof Error ? error.message : String(error),
    }, 'addEmbeddingsToArticles');
    // Return articles without embeddings on failure
    return articles.map((a) => ({ ...a }));
  }
}

/**
 * Batch iterator with embeddings for an existing async iterable.
 *
 * Wraps any async iterable of ClassifiedArticle and adds embeddings.
 *
 * @param source - Source async iterable of articles
 * @param embeddingsConfig - Embeddings configuration
 * @param batchSize - Number of articles per batch
 */
export async function* withEmbeddings(
  source: AsyncIterable<ClassifiedArticle>,
  embeddingsConfig: EmbeddingsConfig,
  batchSize: number = 50
): AsyncGenerator<ArticleWithEmbedding[], void, unknown> {
  if (!embeddingsConfig.enabled) {
    // Just batch and pass through without embeddings
    let batch: ArticleWithEmbedding[] = [];
    for await (const article of source) {
      batch.push({ ...article });
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    if (batch.length > 0) {
      yield batch;
    }
    return;
  }

  const client = createEmbeddingsClient({
    baseUrl: embeddingsConfig.apiUrl,
    batchSize: embeddingsConfig.batchSize,
    maxRetries: embeddingsConfig.maxRetries,
    timeout: embeddingsConfig.timeout,
    defaultModel: embeddingsConfig.model,
  });

  let batch: ClassifiedArticle[] = [];

  for await (const article of source) {
    batch.push(article);

    if (batch.length >= batchSize) {
      // Generate embeddings for the batch
      const texts = batch.map((a) => {
        const firstParagraph = a.plaintext.split('\n\n')[0] || '';
        return `${a.title}\n\n${firstParagraph}`.slice(0, 8000);
      });

      let embeddings: number[][] | null = null;
      try {
        embeddings = await client.generateEmbeddings(
          texts,
          embeddingsConfig.model
        );
      } catch (error) {
        getLog().warn('Batch embedding generation failed', {
          batchSize: batch.length,
          error: error instanceof Error ? error.message : String(error),
        }, 'withEmbeddings');
      }

      // Yield articles with embeddings
      const articlesWithEmbeddings: ArticleWithEmbedding[] = batch.map(
        (article, i) => ({
          ...article,
          embedding: embeddings?.[i],
          embeddingModel: embeddings
            ? (embeddingsConfig.model ?? 'bge-m3')
            : undefined,
        })
      );

      yield articlesWithEmbeddings;
      batch = [];
    }
  }

  // Process remaining articles
  if (batch.length > 0) {
    const texts = batch.map((a) => {
      const firstParagraph = a.plaintext.split('\n\n')[0] || '';
      return `${a.title}\n\n${firstParagraph}`.slice(0, 8000);
    });

    let embeddings: number[][] | null = null;
    try {
      embeddings = await client.generateEmbeddings(
        texts,
        embeddingsConfig.model
      );
    } catch (error) {
      getLog().warn('Final batch embedding generation failed', {
        batchSize: batch.length,
        error: error instanceof Error ? error.message : String(error),
      }, 'withEmbeddings');
    }

    const articlesWithEmbeddings: ArticleWithEmbedding[] = batch.map(
      (article, i) => ({
        ...article,
        embedding: embeddings?.[i],
        embeddingModel: embeddings
          ? (embeddingsConfig.model ?? 'bge-m3')
          : undefined,
      })
    );

    yield articlesWithEmbeddings;
  }
}
