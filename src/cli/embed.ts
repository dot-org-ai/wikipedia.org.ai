/**
 * Embed Command
 *
 * Generate embeddings for Wikipedia articles using AI Gateway or local models.
 */

import { Command } from 'commander';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  color,
  createProgressBar,
  createSpinner,
  formatDuration,
  formatNumber,
  loadConfig,
  fatal,
  warn,
  resolvePath,
} from './utils.js';
import type { EmbeddingModel, Checkpoint } from '../embeddings/types.js';

/** Embed command options */
interface EmbedOptions {
  dataDir: string;
  model: string;
  models?: string;
  batchSize: string;
  resume: boolean;
  aiGateway?: string;
  accountId?: string;
  output?: string;
  dryRun: boolean;
  verbose: boolean;
  maxArticles?: string;
}

/** Embedding cost estimates per 1M tokens */
const COST_PER_MILLION_TOKENS: Record<EmbeddingModel, number> = {
  'bge-m3': 0.0001, // Cloudflare AI is very cheap
  'bge-base': 0.0001,
  'bge-large': 0.0001,
  'gemma': 0.0002,
  'gemma300': 0.0001, // EmbeddingGemma-300M is a dedicated embedding model
};

/** Model information */
const MODEL_INFO: Record<EmbeddingModel, { dimensions: number; maxTokens: number }> = {
  'bge-m3': { dimensions: 1024, maxTokens: 8192 },
  'bge-base': { dimensions: 768, maxTokens: 512 },
  'bge-large': { dimensions: 1024, maxTokens: 512 },
  'gemma': { dimensions: 768, maxTokens: 8192 },
  'gemma300': { dimensions: 768, maxTokens: 8192 },
};

export const embedCommand = new Command('embed')
  .description('Generate embeddings for Wikipedia articles')
  .option('-d, --data-dir <path>', 'Data directory with Parquet files', './data')
  .option('-m, --model <model>', 'Embedding model (bge-m3, bge-base, bge-large, gemma, gemma300)', 'bge-m3')
  .option('--models <models>', 'Comma-separated list of models to generate embeddings for (e.g., bge-m3,gemma300)')
  .option('-b, --batch-size <size>', 'Batch size for embedding requests', '50')
  .option('-r, --resume', 'Resume from checkpoint', false)
  .option('--ai-gateway <url>', 'AI Gateway URL')
  .option('--account-id <id>', 'Cloudflare Account ID')
  .option('-o, --output <dir>', 'Output directory for embeddings (default: <data-dir>/embeddings)')
  .option('--dry-run', 'Show what would be done without processing', false)
  .option('-v, --verbose', 'Verbose output', false)
  .option('--max-articles <count>', 'Maximum number of articles to embed')
  .action(async (options: EmbedOptions) => {
    const config = await loadConfig();

    const dataDir = resolvePath(options.dataDir || config.dataDir || './data');
    const outputDir = options.output ? resolvePath(options.output) : join(dataDir, 'embeddings');
    const batchSize = parseInt(options.batchSize || String(config.batchSize) || '50', 10);
    const aiGatewayUrl = options.aiGateway || config.aiGatewayUrl || 'https://gateway.ai.cloudflare.com/v1';
    const accountId = options.accountId || config.accountId || '';
    const apiToken = config.apiToken || '';
    const maxArticles = options.maxArticles ? parseInt(options.maxArticles, 10) : undefined;

    // Validate models
    const validModels: EmbeddingModel[] = ['bge-m3', 'bge-base', 'bge-large', 'gemma', 'gemma300'];

    // Parse models from comma-separated list or single model option
    let modelsToUse: EmbeddingModel[];
    if (options.models) {
      modelsToUse = options.models.split(',').map(m => m.trim()) as EmbeddingModel[];
      for (const m of modelsToUse) {
        if (!validModels.includes(m)) {
          fatal(`Invalid model: ${m}. Valid models: ${validModels.join(', ')}`);
        }
      }
    } else {
      const model = (options.model || config.defaultModel || 'bge-m3') as EmbeddingModel;
      if (!validModels.includes(model)) {
        fatal(`Invalid model: ${model}. Valid models: ${validModels.join(', ')}`);
      }
      modelsToUse = [model];
    }

    // For backwards compatibility, use the first model as the primary model
    const model = modelsToUse[0] ?? 'bge-m3';

    // Show configuration
    console.log('\n  Wikipedia Embedding Generation\n');
    console.log(`  Data Dir:      ${color.cyan(dataDir)}`);
    console.log(`  Output Dir:    ${color.cyan(outputDir)}`);
    if (modelsToUse.length === 1) {
      console.log(`  Model:         ${color.cyan(model)}`);
      const modelInfo = MODEL_INFO[model];
      console.log(`  Dimensions:    ${color.cyan(String(modelInfo?.dimensions ?? 1024))}`);
    } else {
      console.log(`  Models:        ${color.cyan(modelsToUse.join(', '))}`);
      for (const m of modelsToUse) {
        const mInfo = MODEL_INFO[m];
        console.log(`    - ${m}: ${mInfo?.dimensions ?? 1024}d`);
      }
    }
    const primaryModelInfo = MODEL_INFO[model];
    console.log(`  Max Tokens:    ${color.cyan(formatNumber(primaryModelInfo?.maxTokens ?? 8192))}`);
    console.log(`  Batch Size:    ${color.cyan(String(batchSize))}`);
    console.log(`  AI Gateway:    ${color.cyan(aiGatewayUrl)}`);
    if (maxArticles) {
      console.log(`  Max Articles:  ${color.cyan(formatNumber(maxArticles))}`);
    }
    console.log('');

    if (options.dryRun) {
      console.log(color.yellow('  Dry run mode - no embeddings will be generated.\n'));
      return;
    }

    // Check for account ID
    if (!accountId) {
      warn('No Cloudflare Account ID provided. Set --account-id or CLOUDFLARE_ACCOUNT_ID');
    }

    // Check data directory exists
    try {
      await stat(dataDir);
    } catch {
      fatal(`Data directory not found: ${dataDir}\nRun 'wikipedia ingest' first.`);
    }

    // Create output directory
    const spinner = createSpinner('Creating output directories...');
    try {
      await mkdir(outputDir, { recursive: true });
      spinner.success('Output directories ready');
    } catch (error) {
      spinner.fail(`Failed to create directories: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }

    // Load checkpoint if resuming
    let checkpoint: Checkpoint | null = null;
    const checkpointPath = join(outputDir, 'checkpoint.json');

    if (options.resume) {
      try {
        const data = await readFile(checkpointPath, 'utf-8');
        checkpoint = JSON.parse(data) as Checkpoint;
        console.log(`  Resuming from ${color.cyan(formatNumber(checkpoint.totalProcessed))} articles`);
        console.log(`  Last processed: ${color.cyan(checkpoint.lastProcessedId)}\n`);
      } catch {
        console.log(color.dim('  No checkpoint found, starting fresh\n'));
      }
    }

    // Find Parquet files
    const articlesDir = join(dataDir, 'articles');
    let parquetFiles: string[] = [];

    try {
      parquetFiles = await findParquetFiles(articlesDir);
    } catch {
      fatal(`Could not read articles directory: ${articlesDir}`);
    }

    if (parquetFiles.length === 0) {
      fatal(`No Parquet files found in ${articlesDir}`);
    }

    console.log(`  Found ${color.cyan(String(parquetFiles.length))} Parquet files\n`);

    // Estimate total articles
    let totalEstimate = 0;
    for (const file of parquetFiles) {
      try {
        const stats = await stat(join(articlesDir, file));
        // Rough estimate: ~500 bytes per article in Parquet
        totalEstimate += Math.round(stats.size / 500);
      } catch {
        // Skip
      }
    }

    if (maxArticles) {
      totalEstimate = Math.min(totalEstimate, maxArticles);
    }

    // Initialize progress bar
    const progress = createProgressBar({
      total: totalEstimate,
      format: '  :bar :percent | :current/:total | :rate/s | ETA :eta | Cost ~$:cost',
      showEta: true,
    });

    // Processing state
    let totalProcessed = checkpoint?.totalProcessed || 0;
    let totalTokens = 0;
    let totalCost = 0;
    let errors: Array<{ id: string; error: string }> = [];
    const startTime = Date.now();
    let lastProgressUpdate = Date.now();
    let articlesThisSession = 0;

    // Abort controller for graceful shutdown
    const abortController = new AbortController();
    let shuttingDown = false;

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      progress.interrupt(color.yellow('\nShutting down gracefully, saving checkpoint...'));
      abortController.abort();
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    try {
      // Import the AI Gateway client dynamically
      const { createAIGatewayClient } = await import('../embeddings/ai-gateway.js');
      const { createLanceWriter } = await import('../embeddings/lance-writer.js');

      const aiClient = createAIGatewayClient({
        baseUrl: aiGatewayUrl,
        accountId,
        apiToken,
        timeout: 30000,
        maxRetries: 3,
        retryDelayMs: 1000,
      });

      const lanceWriter = createLanceWriter({
        outputPath: outputDir,
        flushSize: batchSize * 2,
        partitionByType: true,
      });

      // Process each Parquet file
      for (const parquetFile of parquetFiles) {
        if (shuttingDown) break;
        if (maxArticles && totalProcessed >= maxArticles) break;

        const filePath = join(articlesDir, parquetFile);

        try {
          // Read articles from Parquet file
          const articles = await readArticlesFromParquet(filePath);

          // Process in batches
          for (let i = 0; i < articles.length; i += batchSize) {
            if (shuttingDown) break;
            if (maxArticles && totalProcessed >= maxArticles) break;

            const batch = articles.slice(i, i + batchSize);

            // Skip if already processed (resume mode)
            const firstBatchItem = batch[0];
            if (checkpoint && firstBatchItem && firstBatchItem.$id <= checkpoint.lastProcessedId) {
              continue;
            }

            try {
              // Prepare texts for embedding
              const texts = batch.map((a) => {
                // Truncate to max tokens (rough estimate: 4 chars per token)
                const modelInfo = MODEL_INFO[model];
                const maxChars = (modelInfo?.maxTokens ?? 8192) * 4;
                const text = `${a.title}\n\n${a.content}`.slice(0, maxChars);
                return text;
              });

              // Generate embeddings for all configured models in parallel
              const embeddingResults = await Promise.all(
                modelsToUse.map(async (m) => {
                  const response = await aiClient.generateEmbeddings({
                    model: m,
                    texts,
                  });
                  return { model: m, response };
                })
              );

              // Create embedding records for each model
              const now = new Date().toISOString();
              for (const { model: currentModel, response } of embeddingResults) {
                const records = batch.map((article, idx) => {
                  const embeddingData = response.embeddings[idx];
                  if (!embeddingData) {
                    throw new Error(`Missing embedding for article ${article.$id} with model ${currentModel}`);
                  }
                  return {
                    id: article.$id,
                    title: article.title,
                    type: article.$type as import('../embeddings/types.js').ArticleType,
                    chunk_index: 0,
                    text_preview: article.content.slice(0, 200),
                    embedding: new Float32Array(embeddingData),
                    model: currentModel,
                    created_at: now,
                  };
                });

                // Write to Lance (partitioned by model)
                await lanceWriter.writeBatch(records);

                if (response.cached && options.verbose && batch[0]) {
                  progress.interrupt(color.dim(`  Cache hit for ${currentModel} batch starting ${batch[0].title}`));
                }
              }

              // Update stats
              totalProcessed += batch.length;
              articlesThisSession += batch.length;

              // Estimate tokens (rough: 1 token per 4 chars average) - multiply by number of models
              const batchTokens = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0) * modelsToUse.length;
              totalTokens += batchTokens;

              // Calculate cost based on all models used
              const costPerBatch = modelsToUse.reduce((sum, m) => {
                const modelTokens = texts.reduce((tSum, t) => tSum + Math.ceil(t.length / 4), 0);
                return sum + (modelTokens / 1_000_000) * COST_PER_MILLION_TOKENS[m];
              }, 0);
              totalCost += costPerBatch;

              // Update progress (throttled)
              if (Date.now() - lastProgressUpdate > 100) {
                progress.update(totalProcessed, {
                  cost: totalCost.toFixed(4),
                });
                lastProgressUpdate = Date.now();
              }
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);

              // Record errors but continue
              for (const article of batch) {
                errors.push({ id: article.$id, error: errorMsg });
              }

              if (options.verbose) {
                progress.interrupt(color.red(`  Error processing batch: ${errorMsg}`));
              }
            }

            // Save checkpoint periodically
            if (articlesThisSession % 1000 === 0) {
              const lastBatchItem = batch[batch.length - 1];
              if (lastBatchItem) {
                await saveCheckpoint(checkpointPath, {
                  lastProcessedId: lastBatchItem.$id,
                  totalProcessed,
                  model,
                  errors: errors.slice(-100), // Keep last 100 errors
                  startedAt: checkpoint?.startedAt || new Date(startTime).toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
            }
          }
        } catch (error) {
          if (options.verbose) {
            progress.interrupt(
              color.red(`  Error reading ${parquetFile}: ${error instanceof Error ? error.message : error}`)
            );
          }
        }
      }

      progress.complete();

      // Final flush
      const flushSpinner = createSpinner('Flushing remaining embeddings...');
      await lanceWriter.flush();
      flushSpinner.success('Embeddings flushed');

      // Save final checkpoint
      await saveCheckpoint(checkpointPath, {
        lastProcessedId: '',
        totalProcessed,
        model,
        errors: errors.slice(-100),
        startedAt: checkpoint?.startedAt || new Date(startTime).toISOString(),
        updatedAt: new Date().toISOString(),
        completed: true,
      });

      // Summary
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = elapsed > 0 ? articlesThisSession / elapsed : 0;
      const cacheStats = aiClient.getCacheStats();

      console.log('\n  Embedding Generation Complete\n');
      console.log(`  Articles Processed: ${color.green(formatNumber(totalProcessed))}`);
      console.log(`  This Session:       ${color.cyan(formatNumber(articlesThisSession))}`);
      console.log(`  Time Elapsed:       ${color.cyan(formatDuration(elapsed))}`);
      console.log(`  Rate:               ${color.cyan(formatNumber(Math.round(rate)))}/s`);
      console.log(`  Tokens Processed:   ${color.cyan(formatNumber(totalTokens))}`);
      console.log(`  Estimated Cost:     ${color.cyan(`$${totalCost.toFixed(4)}`)}`);
      console.log(`  Cache Hit Rate:     ${color.cyan(`${((cacheStats.hits / Math.max(1, cacheStats.total)) * 100).toFixed(1)}%`)}`);

      if (errors.length > 0) {
        console.log(`  Errors:             ${color.yellow(String(errors.length))}`);
      }

      console.log('');
    } catch (error) {
      progress.complete();
      if (error instanceof Error && error.name === 'AbortError') {
        console.log(color.yellow('\nEmbedding generation interrupted. Use --resume to continue.\n'));
      } else {
        fatal(`Embedding generation failed: ${error instanceof Error ? error.message : error}`);
      }
    } finally {
      process.removeListener('SIGINT', shutdown);
      process.removeListener('SIGTERM', shutdown);
    }
  });

/**
 * Find all Parquet files in directory recursively
 */
async function findParquetFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string, prefix: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await scan(join(currentDir, entry.name), relativePath);
      } else if (entry.name.endsWith('.parquet')) {
        files.push(relativePath);
      }
    }
  }

  await scan(dir, '');
  return files.sort();
}

/**
 * Read articles from a Parquet file
 */
async function readArticlesFromParquet(
  filePath: string
): Promise<Array<{ $id: string; $type: string; title: string; content: string }>> {
  try {
    // Dynamic import of hyparquet
    const { parquetRead } = await import('@dotdo/hyparquet');

    const buffer = await readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    // Read all rows
    const rows: Array<Record<string, unknown>> = [];

    await parquetRead({
      file: arrayBuffer,
      onComplete: (data: unknown) => {
        // Convert columnar to row format
        const columnarData = data as Record<string, unknown[]>;
        const columnNames = Object.keys(columnarData);
        const firstColumnName = columnNames[0];
        const numRows = firstColumnName ? (columnarData[firstColumnName]?.length ?? 0) : 0;

        for (let i = 0; i < numRows; i++) {
          const row: Record<string, unknown> = {};
          for (const col of columnNames) {
            const colData = columnarData[col];
            row[col] = colData?.[i];
          }
          rows.push(row);
        }
      },
    });

    return rows.map((row) => ({
      $id: String(row['$id'] || row['id'] || ''),
      $type: String(row['$type'] || row['type'] || 'other'),
      title: String(row['title'] || ''),
      content: String(row['content'] || ''),
    }));
  } catch (error) {
    // If hyparquet fails, return empty array
    console.error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Save checkpoint to file
 */
async function saveCheckpoint(
  path: string,
  data: {
    lastProcessedId: string;
    totalProcessed: number;
    model: string;
    errors: Array<{ id: string; error: string }>;
    startedAt: string;
    updatedAt: string;
    completed?: boolean;
  }
): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2));
}
