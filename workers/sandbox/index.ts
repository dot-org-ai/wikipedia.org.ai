/**
 * Cloudflare Sandbox Worker - Full Wikipedia Ingestion
 *
 * Environment:
 * - 12GB RAM, 20GB disk, 4 vCPU
 * - Long-running jobs (up to 6 hours)
 * - R2 mounted at /mnt/r2
 *
 * Capabilities:
 * - Stream Wikipedia dump from dumps.wikimedia.org
 * - Decompress bzip2/gzip on-the-fly
 * - Parse XML and extract articles
 * - Classify articles by type (person, place, org, work, event, other)
 * - Write partitioned Parquet files to R2
 * - Report progress via HTTP API
 * - Support resume from checkpoint
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import {
  createIngestionPipeline,
  batchArticles,
  type ClassifiedArticle,
  type PipelineStats,
  type ArticleType,
} from '../../src/ingest/index.js';
import { PartitionedWriter, type Manifest } from '../../src/storage/index.js';
import {
  EmbeddingsClient,
  createEmbeddingsClient,
  createWorkersAIClient,
  type EmbeddingsApiModel,
} from '../../src/embeddings/client.js';

// ============================================================================
// Configuration
// ============================================================================

interface SandboxConfig {
  mode: 'ingest' | 'http' | 'stdin';
  dumpUrl: string;
  outputDir: string;
  batchSize: number;
  checkpointInterval: number;
  httpPort: number;
  skipRedirects: boolean;
  skipDisambiguation: boolean;
  logInterval: number;
  limit?: number;
  // Embeddings configuration
  generateEmbeddings: boolean;
  embeddingsApiUrl: string;
  embeddingsModel: EmbeddingsApiModel;
  embeddingsBatchSize: number;
  // Direct Workers AI (cheaper than using embeddings.workers.do)
  useWorkersAI: boolean;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
}

interface IngestState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt: string | null;
  lastCheckpointAt: string | null;
  dumpUrl: string;
  articlesProcessed: number;
  articlesSkipped: number;
  bytesDownloaded: number;
  bytesWritten: number;
  articlesByType: Record<ArticleType, number>;
  currentRate: number;
  estimatedRemaining: number | null;
  errors: Array<{ timestamp: string; message: string }>;
  lastArticleId: number;
  lastArticleTitle: string;
  // Embeddings stats
  embeddingsGenerated: number;
  embeddingErrors: number;
}

interface CheckpointData {
  dumpUrl: string;
  articlesProcessed: number;
  lastArticleId: number;
  lastArticleTitle: string;
  articlesByType: Record<ArticleType, number>;
  bytesDownloaded: number;
  startedAt: string;
  checkpointedAt: string;
}

// ============================================================================
// Global State
// ============================================================================

let config: SandboxConfig;
let state: IngestState;
let writer: PartitionedWriter | null = null;
let embeddingsClient: EmbeddingsClient | null = null;
let abortController: AbortController | null = null;
let isShuttingDown = false;

// ============================================================================
// Configuration Parsing
// ============================================================================

function parseConfig(): SandboxConfig {
  const env = process.env;

  return {
    mode: (env.MODE ?? 'ingest') as SandboxConfig['mode'],
    dumpUrl: env.WIKIPEDIA_DUMP_URL ?? 'https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2',
    outputDir: env.OUTPUT_DIR ?? '/mnt/r2/wikipedia',
    batchSize: parseInt(env.BATCH_SIZE ?? '5000', 10),
    checkpointInterval: parseInt(env.CHECKPOINT_INTERVAL ?? '10000', 10),
    httpPort: parseInt(env.HTTP_PORT ?? '8080', 10),
    skipRedirects: env.SKIP_REDIRECTS === 'true',
    skipDisambiguation: env.SKIP_DISAMBIGUATION === 'true',
    logInterval: parseInt(env.LOG_INTERVAL ?? '1000', 10),
    limit: env.LIMIT ? parseInt(env.LIMIT, 10) : undefined,
    // Embeddings configuration
    generateEmbeddings: env.GENERATE_EMBEDDINGS !== 'false', // Default to true
    embeddingsApiUrl: env.EMBEDDINGS_API_URL ?? 'https://embeddings.workers.do',
    embeddingsModel: (env.EMBEDDINGS_MODEL ?? 'bge-m3') as EmbeddingsApiModel,
    embeddingsBatchSize: parseInt(env.EMBEDDINGS_BATCH_SIZE ?? '50', 10),
    // Direct Workers AI (cheaper - avoids worker invocations)
    useWorkersAI: env.USE_WORKERS_AI === 'true' || !!(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN),
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN,
  };
}

function initState(): IngestState {
  return {
    status: 'idle',
    startedAt: null,
    lastCheckpointAt: null,
    dumpUrl: config.dumpUrl,
    articlesProcessed: 0,
    articlesSkipped: 0,
    bytesDownloaded: 0,
    bytesWritten: 0,
    articlesByType: {
      person: 0,
      place: 0,
      org: 0,
      work: 0,
      event: 0,
      other: 0,
    },
    currentRate: 0,
    estimatedRemaining: null,
    errors: [],
    lastArticleId: 0,
    lastArticleTitle: '',
    embeddingsGenerated: 0,
    embeddingErrors: 0,
  };
}

// ============================================================================
// Checkpoint Management
// ============================================================================

function getCheckpointPath(): string {
  return join(config.outputDir, '.ingest-checkpoint.json');
}

async function loadCheckpoint(): Promise<CheckpointData | null> {
  try {
    const data = await readFile(getCheckpointPath(), 'utf-8');
    const checkpoint = JSON.parse(data) as CheckpointData;

    // Validate checkpoint matches current config
    if (checkpoint.dumpUrl !== config.dumpUrl) {
      console.log('[Sandbox] Checkpoint URL mismatch, starting fresh');
      return null;
    }

    console.log(`[Sandbox] Loaded checkpoint: ${checkpoint.articlesProcessed} articles processed`);
    return checkpoint;
  } catch (err) {
    console.debug('[sandbox] Failed to load checkpoint:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function saveCheckpoint(): Promise<void> {
  const checkpoint: CheckpointData = {
    dumpUrl: state.dumpUrl,
    articlesProcessed: state.articlesProcessed,
    lastArticleId: state.lastArticleId,
    lastArticleTitle: state.lastArticleTitle,
    articlesByType: { ...state.articlesByType },
    bytesDownloaded: state.bytesDownloaded,
    startedAt: state.startedAt!,
    checkpointedAt: new Date().toISOString(),
  };

  const checkpointPath = getCheckpointPath();
  await mkdir(dirname(checkpointPath), { recursive: true });
  await writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));

  state.lastCheckpointAt = checkpoint.checkpointedAt;
  console.log(`[Checkpoint] Saved at ${state.articlesProcessed} articles`);
}

async function clearCheckpoint(): Promise<void> {
  try {
    await unlink(getCheckpointPath());
  } catch (err) {
    // File might not exist, which is expected
    console.debug('[sandbox] Could not clear checkpoint (may not exist):', err instanceof Error ? err.message : err);
  }
}

// ============================================================================
// Article Conversion
// ============================================================================

interface ArticleRecord {
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
  embedding?: number[];
  embedding_model?: string;
}

function convertToStorageFormat(
  article: ClassifiedArticle,
  embedding?: number[],
  embeddingModel?: string
): ArticleRecord {
  // Extract first paragraph as description
  const firstParagraph = article.plaintext.split('\n\n')[0] || '';
  const description = firstParagraph.slice(0, 500);

  // Extract coordinates if available
  let coordsLat: number | null = null;
  let coordsLon: number | null = null;

  if (article.infoboxes.length > 0) {
    const infobox = article.infoboxes[0];
    if (infobox.data.coordinates) {
      const match = infobox.data.coordinates.match(/([-\d.]+)[,\s]+([-\d.]+)/);
      if (match) {
        coordsLat = parseFloat(match[1]);
        coordsLon = parseFloat(match[2]);
      }
    }
  }

  // Parse timestamp with fallback
  const parsedDate = article.timestamp ? new Date(article.timestamp) : new Date();
  const updated_at = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  const record: ArticleRecord = {
    $id: String(article.id),
    $type: article.type,
    title: article.title,
    description,
    wikidata_id: null,
    coords_lat: coordsLat,
    coords_lon: coordsLon,
    infobox: article.infoboxes.length > 0 ? article.infoboxes[0].data : null,
    content: article.plaintext,
    updated_at,
  };

  // Add embedding if provided
  if (embedding) {
    record.embedding = embedding;
    record.embedding_model = embeddingModel;
  }

  return record;
}

// ============================================================================
// Ingestion Pipeline
// ============================================================================

async function runIngestion(): Promise<void> {
  console.log('[Sandbox] Starting Wikipedia ingestion pipeline...');
  console.log(`[Sandbox] Dump URL: ${config.dumpUrl}`);
  console.log(`[Sandbox] Output: ${config.outputDir}`);
  console.log(`[Sandbox] Batch size: ${config.batchSize}`);
  console.log(`[Sandbox] Embeddings: ${config.generateEmbeddings ? `enabled (${config.embeddingsModel})` : 'disabled'}`);
  if (config.limit) {
    console.log(`[Sandbox] Limit: ${config.limit} articles`);
  }

  // Initialize state
  state = initState();
  state.status = 'running';
  state.startedAt = new Date().toISOString();

  // Check for existing checkpoint
  const checkpoint = await loadCheckpoint();
  if (checkpoint) {
    state.articlesProcessed = checkpoint.articlesProcessed;
    state.lastArticleId = checkpoint.lastArticleId;
    state.lastArticleTitle = checkpoint.lastArticleTitle;
    state.articlesByType = { ...checkpoint.articlesByType };
    state.bytesDownloaded = checkpoint.bytesDownloaded;
    state.startedAt = checkpoint.startedAt;
    console.log(`[Sandbox] Resuming from article ${checkpoint.lastArticleId}: "${checkpoint.lastArticleTitle}"`);
  }

  // Create output directories
  await mkdir(join(config.outputDir, 'data'), { recursive: true });
  await mkdir(join(config.outputDir, 'indexes'), { recursive: true });

  // Initialize writer
  writer = new PartitionedWriter({
    outputDir: config.outputDir,
    rowGroupSize: 10000,
    maxFileSize: 50 * 1024 * 1024, // 50MB per file for R2 efficiency
    statistics: true,
    bloomFilters: true,
  });

  // Initialize embeddings client if enabled
  if (config.generateEmbeddings) {
    if (config.useWorkersAI && config.cloudflareAccountId && config.cloudflareApiToken) {
      // Use Workers AI REST API directly (cheaper - no worker invocations)
      embeddingsClient = createWorkersAIClient(
        config.cloudflareAccountId,
        config.cloudflareApiToken,
        {
          batchSize: config.embeddingsBatchSize,
          defaultModel: config.embeddingsModel,
          maxRetries: 3,
          timeout: 60000,
        }
      );
      console.log(`[Sandbox] Embeddings client initialized (Workers AI REST API - direct)`);
    } else {
      // Use embeddings.workers.do
      embeddingsClient = createEmbeddingsClient({
        baseUrl: config.embeddingsApiUrl,
        batchSize: config.embeddingsBatchSize,
        defaultModel: config.embeddingsModel,
        maxRetries: 3,
        timeout: 60000,
      });
      console.log(`[Sandbox] Embeddings client initialized (${config.embeddingsApiUrl})`);
    }
  }

  // Create abort controller for graceful shutdown
  abortController = new AbortController();

  // Track progress
  const startTime = Date.now();
  let lastLogTime = startTime;
  let articlesAtLastLog = state.articlesProcessed;

  try {
    // Create the ingestion pipeline
    const pipeline = createIngestionPipeline(config.dumpUrl, {
      signal: abortController.signal,
      skipRedirects: config.skipRedirects,
      skipDisambiguation: config.skipDisambiguation,
      onProgress: (stats: PipelineStats) => {
        state.bytesDownloaded = stats.bytesDownloaded;
        state.currentRate = stats.articlesPerSecond;
      },
    });

    // Process in batches
    let batchNumber = 0;

    for await (const batch of batchArticles(pipeline, config.batchSize)) {
      if (isShuttingDown || abortController.signal.aborted) {
        console.log('[Sandbox] Ingestion interrupted');
        break;
      }

      // Skip already processed articles when resuming
      const articlesToProcess = batch.filter((a) => a.id > state.lastArticleId);
      if (articlesToProcess.length === 0) {
        continue;
      }

      // Generate embeddings if enabled
      let embeddings: Map<number, number[]> | null = null;
      if (embeddingsClient && config.generateEmbeddings) {
        try {
          // Create text representations for embedding
          const texts = articlesToProcess.map((article) => {
            const firstParagraph = article.plaintext.split('\n\n')[0] || '';
            return `${article.title}\n\n${firstParagraph}`.slice(0, 8000);
          });

          // Generate embeddings in sub-batches
          const embeddingResults = await embeddingsClient.generateEmbeddings(
            texts,
            config.embeddingsModel
          );

          // Map embeddings by index
          embeddings = new Map();
          for (let i = 0; i < embeddingResults.length; i++) {
            embeddings.set(i, embeddingResults[i]);
          }

          state.embeddingsGenerated += embeddingResults.length;
        } catch (error) {
          // Log error but continue pipeline
          console.error(
            `[Embeddings] Batch failed: ${error instanceof Error ? error.message : error}`
          );
          state.embeddingErrors += articlesToProcess.length;
          state.errors.push({
            timestamp: new Date().toISOString(),
            message: `Embedding generation failed: ${error instanceof Error ? error.message : error}`,
          });
        }
      }

      // Convert and write batch with embeddings
      const records = articlesToProcess.map((article, i) =>
        convertToStorageFormat(
          article,
          embeddings?.get(i),
          embeddings?.has(i) ? config.embeddingsModel : undefined
        )
      );
      await writer.write(records);

      // Update state
      batchNumber++;
      state.articlesProcessed += articlesToProcess.length;

      for (const article of articlesToProcess) {
        state.articlesByType[article.type]++;
      }

      const lastArticle = articlesToProcess[articlesToProcess.length - 1];
      state.lastArticleId = lastArticle.id;
      state.lastArticleTitle = lastArticle.title;

      // Check limit
      if (config.limit && state.articlesProcessed >= config.limit) {
        console.log(`[Sandbox] Reached limit of ${config.limit} articles`);
        break;
      }

      // Log progress periodically
      const now = Date.now();
      if (state.articlesProcessed % config.logInterval === 0 || now - lastLogTime >= 10000) {
        const elapsed = (now - startTime) / 1000;
        const rate = (state.articlesProcessed - articlesAtLastLog) / ((now - lastLogTime) / 1000);
        state.currentRate = rate;

        const embeddingsInfo = config.generateEmbeddings
          ? ` | ${state.embeddingsGenerated} embeddings`
          : '';

        console.log(
          `[Progress] ${state.articlesProcessed.toLocaleString()} articles | ` +
          `${rate.toFixed(0)}/s | ` +
          `${formatBytes(state.bytesDownloaded)} downloaded${embeddingsInfo} | ` +
          `${formatDuration(elapsed)}`
        );

        lastLogTime = now;
        articlesAtLastLog = state.articlesProcessed;
      }

      // Checkpoint periodically
      if (state.articlesProcessed % config.checkpointInterval === 0) {
        await saveCheckpoint();
      }
    }

    // Finalize writing
    console.log('[Sandbox] Finalizing Parquet files...');
    const manifest = await writer.finalize();

    // Write detailed manifest
    await writeManifest(manifest);

    // Clear checkpoint on successful completion
    await clearCheckpoint();

    state.status = 'completed';
    const totalTime = (Date.now() - startTime) / 1000;

    console.log('\n[Sandbox] Ingestion Complete');
    console.log(`  Total Articles: ${state.articlesProcessed.toLocaleString()}`);
    if (config.generateEmbeddings) {
      console.log(`  Embeddings Generated: ${state.embeddingsGenerated.toLocaleString()}`);
      if (state.embeddingErrors > 0) {
        console.log(`  Embedding Errors: ${state.embeddingErrors.toLocaleString()}`);
      }
    }
    console.log(`  Total Time: ${formatDuration(totalTime)}`);
    console.log(`  Average Rate: ${(state.articlesProcessed / totalTime).toFixed(0)} articles/sec`);
    console.log(`  Downloaded: ${formatBytes(state.bytesDownloaded)}`);
    console.log('\n  Articles by Type:');
    for (const [type, count] of Object.entries(state.articlesByType)) {
      if (count > 0) {
        const pct = ((count / state.articlesProcessed) * 100).toFixed(1);
        console.log(`    ${type.padEnd(8)} ${count.toLocaleString().padStart(10)} (${pct}%)`);
      }
    }
    console.log('');

  } catch (error) {
    state.status = 'failed';
    const message = error instanceof Error ? error.message : String(error);
    state.errors.push({ timestamp: new Date().toISOString(), message });
    console.error('[Sandbox] Ingestion failed:', message);

    // Save checkpoint for resume
    await saveCheckpoint();

    throw error;
  }
}

async function writeManifest(parquetManifest: Manifest): Promise<void> {
  const manifest = {
    version: '1.0.0',
    created_at: new Date().toISOString(),
    source: {
      url: config.dumpUrl,
      downloaded_at: state.startedAt,
    },
    statistics: {
      totalArticles: state.articlesProcessed,
      articlesByType: state.articlesByType,
      bytesDownloaded: state.bytesDownloaded,
      processingTimeSeconds: state.startedAt
        ? (Date.now() - new Date(state.startedAt).getTime()) / 1000
        : 0,
    },
    embeddings: config.generateEmbeddings ? {
      enabled: true,
      model: config.embeddingsModel,
      generated: state.embeddingsGenerated,
      errors: state.embeddingErrors,
      apiUrl: config.embeddingsApiUrl,
    } : {
      enabled: false,
    },
    dataFiles: parquetManifest.dataFiles,
    indexFiles: parquetManifest.indexFiles,
  };

  const manifestPath = join(config.outputDir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[Sandbox] Manifest written to ${manifestPath}`);
}

// ============================================================================
// HTTP API
// ============================================================================

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${config.httpPort}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    }));
    return;
  }

  // Get ingestion status
  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  // Get detailed progress
  if (req.method === 'GET' && url.pathname === '/progress') {
    const writerStats = writer?.getStats();
    const embeddingsStats = embeddingsClient?.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...state,
      writer: writerStats,
      embeddings: config.generateEmbeddings ? {
        enabled: true,
        model: config.embeddingsModel,
        clientStats: embeddingsStats,
      } : { enabled: false },
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    }));
    return;
  }

  // Start ingestion (if idle)
  if (req.method === 'POST' && url.pathname === '/start') {
    if (state.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ingestion already running' }));
      return;
    }

    // Start ingestion in background
    runIngestion().catch((error) => {
      console.error('[Sandbox] Background ingestion error:', error);
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Ingestion started', status: state.status }));
    return;
  }

  // Pause ingestion
  if (req.method === 'POST' && url.pathname === '/pause') {
    if (state.status !== 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ingestion not running' }));
      return;
    }

    abortController?.abort();
    state.status = 'paused';

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Ingestion paused', articlesProcessed: state.articlesProcessed }));
    return;
  }

  // Get checkpoint info
  if (req.method === 'GET' && url.pathname === '/checkpoint') {
    const checkpoint = await loadCheckpoint();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(checkpoint ?? { message: 'No checkpoint found' }));
    return;
  }

  // Clear checkpoint
  if (req.method === 'DELETE' && url.pathname === '/checkpoint') {
    await clearCheckpoint();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Checkpoint cleared' }));
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

function startHttpServer(): void {
  const server = createServer((req, res) => {
    handleHttpRequest(req, res).catch((error) => {
      console.error('[Sandbox] HTTP handler error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  });

  server.listen(config.httpPort, () => {
    console.log(`[Sandbox] HTTP server listening on port ${config.httpPort}`);
    console.log(`[Sandbox] Endpoints:`);
    console.log(`  GET  /health     - Health check`);
    console.log(`  GET  /status     - Ingestion status`);
    console.log(`  GET  /progress   - Detailed progress`);
    console.log(`  POST /start      - Start ingestion`);
    console.log(`  POST /pause      - Pause ingestion`);
    console.log(`  GET  /checkpoint - Get checkpoint info`);
    console.log(`  DELETE /checkpoint - Clear checkpoint`);
  });

  server.on('close', () => {
    console.log('[Sandbox] HTTP server closed');
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    console.log('[Sandbox] Already shutting down...');
    return;
  }

  console.log(`[Sandbox] Received ${signal}, shutting down gracefully...`);
  isShuttingDown = true;

  // Abort ongoing ingestion
  abortController?.abort();

  try {
    // Save checkpoint
    if (state.status === 'running') {
      console.log('[Sandbox] Saving final checkpoint...');
      await saveCheckpoint();
    }

    // Flush writer
    if (writer) {
      console.log('[Sandbox] Flushing pending writes...');
      await writer.flush();
    }

    console.log('[Sandbox] Shutdown complete');
    console.log(`[Sandbox] Processed ${state.articlesProcessed} articles`);

    process.exit(0);
  } catch (error) {
    console.error('[Sandbox] Error during shutdown:', error);
    process.exit(1);
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  Wikipedia Ingestion Sandbox');
  console.log('='.repeat(60));
  console.log(`  Node.js: ${process.version}`);
  console.log(`  PID: ${process.pid}`);
  console.log(`  Memory: ${formatBytes(process.memoryUsage().heapTotal)} heap`);
  console.log('');

  // Parse configuration
  config = parseConfig();
  state = initState();

  console.log('  Configuration:');
  console.log(`    Mode: ${config.mode}`);
  console.log(`    Dump URL: ${config.dumpUrl}`);
  console.log(`    Output: ${config.outputDir}`);
  console.log(`    Batch Size: ${config.batchSize}`);
  console.log(`    Checkpoint Interval: ${config.checkpointInterval}`);
  if (config.limit) {
    console.log(`    Limit: ${config.limit} articles`);
  }
  console.log(`    Embeddings: ${config.generateEmbeddings ? 'enabled' : 'disabled'}`);
  if (config.generateEmbeddings) {
    console.log(`      Model: ${config.embeddingsModel}`);
    console.log(`      API URL: ${config.embeddingsApiUrl}`);
    console.log(`      Batch Size: ${config.embeddingsBatchSize}`);
  }
  console.log('');

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Unhandled rejection handler
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[Sandbox] Unhandled rejection:', reason);
    state.errors.push({
      timestamp: new Date().toISOString(),
      message: `Unhandled rejection: ${reason}`,
    });
  });

  // Start based on mode
  if (config.mode === 'http') {
    // HTTP mode: Start server and wait for /start command
    startHttpServer();
  } else if (config.mode === 'ingest') {
    // Auto-start mode: Begin ingestion immediately, also start HTTP for monitoring
    startHttpServer();

    // Small delay to ensure server is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      await runIngestion();
    } catch (error) {
      console.error('[Sandbox] Fatal ingestion error:', error);
      process.exit(1);
    }
  }
}

// Run main
main().catch((error) => {
  console.error('[Sandbox] Fatal error:', error);
  process.exit(1);
});
