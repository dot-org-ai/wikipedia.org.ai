#!/usr/bin/env bun
/**
 * Local Wikipedia Ingestion Runner
 *
 * Runs the Wikipedia ingestion pipeline locally, uploading results to R2.
 * Uses @aws-sdk/client-s3 for R2 access instead of filesystem mounts.
 *
 * Usage:
 *   bun run scripts/run-local-ingest.ts [--limit N] [--simple]
 *
 * Environment:
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_URL from ~/projects/parquedb/.env
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, writeFile, readFile, unlink, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  createIngestionPipeline,
  batchArticles,
  type ClassifiedArticle,
  type PipelineStats,
  type ArticleType,
} from '../src/ingest/index.js';
import { PartitionedWriter, type Manifest } from '../src/storage/index.js';
import {
  EmbeddingsClient,
  createEmbeddingsClient,
  createEmbeddingsClientFromEnv,
  type EmbeddingsApiModel,
} from '../src/embeddings/client.js';

// ============================================================================
// Load Environment
// ============================================================================

async function loadEnv(): Promise<Record<string, string>> {
  // First, check if R2 credentials are already in environment (e.g., from Cloudflare Container)
  if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_URL) {
    console.log('[Setup] Using R2 credentials from environment variables');
    return {
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
      R2_URL: process.env.R2_URL,
    };
  }

  // Fall back to loading from .env file (for local development)
  const envPath = join(process.env.HOME || '~', 'projects/parquedb/.env');
  try {
    const content = await readFile(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key) {
          env[key] = valueParts.join('=');
        }
      }
    }
    console.log('[Setup] Loaded R2 credentials from .env file');
    return env;
  } catch (error) {
    console.error('Failed to load .env file:', error);
    throw error;
  }
}

// ============================================================================
// R2 Client
// ============================================================================

class R2Storage {
  private client: S3Client;
  private bucket: string;

  constructor(accessKeyId: string, secretAccessKey: string, endpoint: string) {
    // Extract bucket name from endpoint or use default
    this.bucket = 'wikipedia-data';

    this.client = new S3Client({
      region: 'auto',
      endpoint: endpoint,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async put(key: string, data: Buffer | ArrayBuffer | string): Promise<void> {
    const body = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
    }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
      if (response.Body) {
        const chunks: Buffer[] = [];
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      }
      return null;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
    } catch {
      // Ignore delete errors
    }
  }

  async list(prefix: string): Promise<string[]> {
    const response = await this.client.send(new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    }));
    return (response.Contents || []).map(obj => obj.Key!).filter(Boolean);
  }
}

// EmbeddingsClient is now imported from src/embeddings/client.js

// ============================================================================
// Configuration
// ============================================================================

interface LocalConfig {
  mode: 'ingest' | 'http';
  dumpUrl: string;
  outputPrefix: string;
  localOutputDir: string;
  batchSize: number;
  checkpointInterval: number;
  httpPort: number;
  skipRedirects: boolean;
  skipDisambiguation: boolean;
  logInterval: number;
  limit?: number;
  generateEmbeddings: boolean;
  embeddingsModel: EmbeddingsApiModel;
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
  embeddingsGenerated: number;
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
// Article Record with Embeddings
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
}

// ============================================================================
// Global State
// ============================================================================

let config: LocalConfig;
let state: IngestState;
let r2: R2Storage;
let embeddings: EmbeddingsClient;
let writer: PartitionedWriter | null = null;
let abortController: AbortController | null = null;
let isShuttingDown = false;

// ============================================================================
// Configuration Parsing
// ============================================================================

function parseConfig(): LocalConfig {
  const args = process.argv.slice(2);
  const isSimple = args.includes('--simple');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;
  const noEmbeddings = args.includes('--no-embeddings');
  const batchSizeIndex = args.indexOf('--batch-size');
  const batchSize = batchSizeIndex !== -1 ? parseInt(args[batchSizeIndex + 1], 10) : (limit && limit < 1000 ? limit : 1000);

  return {
    mode: 'ingest',
    dumpUrl: isSimple
      ? 'https://dumps.wikimedia.org/simplewiki/latest/simplewiki-latest-pages-articles.xml.bz2'
      : 'https://dumps.wikimedia.org/enwiki/latest/enwiki-latest-pages-articles.xml.bz2',
    outputPrefix: isSimple ? 'wikipedia-simple' : 'wikipedia',
    localOutputDir: join(process.cwd(), '.local-output'),
    batchSize,
    checkpointInterval: 5000,
    httpPort: 8080,
    skipRedirects: true,
    skipDisambiguation: true,
    logInterval: 500,
    limit,
    generateEmbeddings: !noEmbeddings,
    embeddingsModel: 'bge-m3',
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
  };
}

// ============================================================================
// Checkpoint Management (Local + R2)
// ============================================================================

function getCheckpointKey(): string {
  return `${config.outputPrefix}/.ingest-checkpoint.json`;
}

function getLocalCheckpointPath(): string {
  return join(config.localOutputDir, '.ingest-checkpoint.json');
}

async function loadCheckpoint(): Promise<CheckpointData | null> {
  try {
    // Try R2 first
    const r2Data = await r2.get(getCheckpointKey());
    if (r2Data) {
      const checkpoint = JSON.parse(r2Data.toString()) as CheckpointData;
      if (checkpoint.dumpUrl === config.dumpUrl) {
        console.log(`[Sandbox] Loaded checkpoint from R2: ${checkpoint.articlesProcessed} articles processed`);
        return checkpoint;
      }
    }

    // Fall back to local
    const localPath = getLocalCheckpointPath();
    if (existsSync(localPath)) {
      const data = await readFile(localPath, 'utf-8');
      const checkpoint = JSON.parse(data) as CheckpointData;
      if (checkpoint.dumpUrl === config.dumpUrl) {
        console.log(`[Sandbox] Loaded checkpoint from local: ${checkpoint.articlesProcessed} articles processed`);
        return checkpoint;
      }
    }

    return null;
  } catch {
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

  const content = JSON.stringify(checkpoint, null, 2);

  // Save locally
  const localPath = getLocalCheckpointPath();
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, content);

  // Save to R2
  try {
    await r2.put(getCheckpointKey(), content);
  } catch (error) {
    console.warn('[Checkpoint] Failed to save to R2:', error);
  }

  state.lastCheckpointAt = checkpoint.checkpointedAt;
  console.log(`[Checkpoint] Saved at ${state.articlesProcessed} articles`);
}

async function clearCheckpoint(): Promise<void> {
  try {
    await unlink(getLocalCheckpointPath());
  } catch {
    // Ignore
  }
  try {
    await r2.delete(getCheckpointKey());
  } catch {
    // Ignore
  }
}

// ============================================================================
// Article Conversion
// ============================================================================

function convertToStorageFormat(article: ClassifiedArticle, embedding?: number[]): ArticleRecord {
  const firstParagraph = article.plaintext.split('\n\n')[0] || '';
  const description = firstParagraph.slice(0, 500);

  let coordsLat: number | null = null;
  let coordsLon: number | null = null;

  if (article.infoboxes.length > 0) {
    const infobox = article.infoboxes[0];
    if (infobox.data.coordinates) {
      const match = String(infobox.data.coordinates).match(/([-\d.]+)[,\s]+([-\d.]+)/);
      if (match) {
        coordsLat = parseFloat(match[1]);
        coordsLon = parseFloat(match[2]);
      }
    }
  }

  const parsedDate = article.timestamp ? new Date(article.timestamp) : new Date();
  const updated_at = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  return {
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
    embedding,
  };
}

// ============================================================================
// Ingestion Pipeline with Embeddings
// ============================================================================

async function runIngestion(): Promise<void> {
  console.log('[Sandbox] Starting Wikipedia ingestion pipeline (LOCAL)...');
  console.log(`[Sandbox] Dump URL: ${config.dumpUrl}`);
  console.log(`[Sandbox] Output prefix: ${config.outputPrefix}`);
  console.log(`[Sandbox] Local output: ${config.localOutputDir}`);
  console.log(`[Sandbox] Batch size: ${config.batchSize}`);
  console.log(`[Sandbox] Generate embeddings: ${config.generateEmbeddings}`);
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

  // Create local output directories
  const localDataDir = join(config.localOutputDir, 'data');
  const localIndexDir = join(config.localOutputDir, 'indexes');
  await mkdir(localDataDir, { recursive: true });
  await mkdir(localIndexDir, { recursive: true });

  // Initialize writer
  writer = new PartitionedWriter({
    outputDir: config.localOutputDir,
    rowGroupSize: 10000,
    maxFileSize: 50 * 1024 * 1024,
    statistics: true,
    bloomFilters: true,
  });

  // Create abort controller
  abortController = new AbortController();

  // Track progress
  const startTime = Date.now();
  let lastLogTime = startTime;
  let articlesAtLastLog = state.articlesProcessed;

  try {
    const pipeline = createIngestionPipeline(config.dumpUrl, {
      signal: abortController.signal,
      skipRedirects: config.skipRedirects,
      skipDisambiguation: config.skipDisambiguation,
      onProgress: (stats: PipelineStats) => {
        state.bytesDownloaded = stats.bytesDownloaded;
        state.currentRate = stats.articlesPerSecond;
      },
    });

    let batchNumber = 0;

    for await (const batch of batchArticles(pipeline, config.batchSize)) {
      if (isShuttingDown || abortController.signal.aborted) {
        console.log('[Sandbox] Ingestion interrupted');
        break;
      }

      // Skip already processed articles
      const articlesToProcess = batch.filter((a) => a.id > state.lastArticleId);
      if (articlesToProcess.length === 0) {
        continue;
      }

      // Generate embeddings if enabled
      let articleEmbeddings: number[][] | undefined;
      if (config.generateEmbeddings) {
        try {
          const texts = articlesToProcess.map(a => {
            // Use title + description for embedding
            const desc = a.plaintext.split('\n\n')[0] || '';
            return `${a.title}\n\n${desc}`.slice(0, 8000);
          });

          articleEmbeddings = await embeddings.generateEmbeddings(texts, config.embeddingsModel);
          state.embeddingsGenerated += articleEmbeddings.length;
        } catch (error) {
          console.warn(`[Embeddings] Failed for batch, continuing without: ${error}`);
          state.errors.push({
            timestamp: new Date().toISOString(),
            message: `Embedding generation failed: ${error}`,
          });
        }
      }

      // Convert and write batch
      const records = articlesToProcess.map((article, i) =>
        convertToStorageFormat(article, articleEmbeddings?.[i])
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

      // Log progress
      const now = Date.now();
      if (state.articlesProcessed % config.logInterval === 0 || now - lastLogTime >= 10000) {
        const elapsed = (now - startTime) / 1000;
        const rate = (state.articlesProcessed - articlesAtLastLog) / ((now - lastLogTime) / 1000);
        state.currentRate = rate;

        console.log(
          `[Progress] ${state.articlesProcessed.toLocaleString()} articles | ` +
          `${rate.toFixed(0)}/s | ` +
          `${formatBytes(state.bytesDownloaded)} downloaded | ` +
          `${state.embeddingsGenerated} embeddings | ` +
          `${formatDuration(elapsed)}`
        );

        lastLogTime = now;
        articlesAtLastLog = state.articlesProcessed;
      }

      // Checkpoint
      if (state.articlesProcessed % config.checkpointInterval === 0) {
        await saveCheckpoint();
      }
    }

    // Finalize
    console.log('[Sandbox] Finalizing Parquet files...');
    const manifest = await writer.finalize();

    // Upload to R2
    console.log('[Sandbox] Uploading to R2...');
    await uploadToR2(manifest);

    // Write manifest
    await writeManifest(manifest);

    // Clear checkpoint
    await clearCheckpoint();

    state.status = 'completed';
    const totalTime = (Date.now() - startTime) / 1000;

    console.log('\n[Sandbox] Ingestion Complete');
    console.log(`  Total Articles: ${state.articlesProcessed.toLocaleString()}`);
    console.log(`  Embeddings Generated: ${state.embeddingsGenerated.toLocaleString()}`);
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
    await saveCheckpoint();
    throw error;
  }
}

async function uploadToR2(manifest: Manifest): Promise<void> {
  const localDir = config.localOutputDir;

  // Upload data files
  for (const file of manifest.dataFiles) {
    const localPath = join(localDir, file.path);
    const r2Key = `${config.outputPrefix}/${file.path}`;

    try {
      const data = await readFile(localPath);
      await r2.put(r2Key, data);
      console.log(`  Uploaded: ${r2Key} (${formatBytes(file.size)})`);
      state.bytesWritten += file.size;
    } catch (error) {
      console.error(`  Failed to upload ${r2Key}:`, error);
    }
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
      embeddingsGenerated: state.embeddingsGenerated,
      embeddingsModel: config.generateEmbeddings ? config.embeddingsModel : null,
      processingTimeSeconds: state.startedAt
        ? (Date.now() - new Date(state.startedAt).getTime()) / 1000
        : 0,
    },
    dataFiles: parquetManifest.dataFiles,
    indexFiles: parquetManifest.indexFiles,
  };

  const content = JSON.stringify(manifest, null, 2);

  // Save locally
  const localPath = join(config.localOutputDir, 'manifest.json');
  await writeFile(localPath, content);

  // Upload to R2
  const r2Key = `${config.outputPrefix}/manifest.json`;
  await r2.put(r2Key, content);
  console.log(`[Sandbox] Manifest written to ${r2Key}`);
}

// ============================================================================
// HTTP API
// ============================================================================

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${config.httpPort}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      mode: 'local',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(state));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/progress') {
    const writerStats = writer?.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...state,
      writer: writerStats,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/start') {
    if (state.status === 'running') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Ingestion already running' }));
      return;
    }

    runIngestion().catch((error) => {
      console.error('[Sandbox] Background ingestion error:', error);
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Ingestion started', status: state.status }));
    return;
  }

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
    console.log(`  GET  /health   - Health check`);
    console.log(`  GET  /status   - Ingestion status`);
    console.log(`  GET  /progress - Detailed progress`);
    console.log(`  POST /start    - Start ingestion`);
    console.log(`  POST /pause    - Pause ingestion`);
  });
}

// ============================================================================
// Utilities
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

  abortController?.abort();

  try {
    if (state.status === 'running') {
      console.log('[Sandbox] Saving final checkpoint...');
      await saveCheckpoint();
    }

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
  console.log('  Wikipedia Ingestion - LOCAL MODE');
  console.log('='.repeat(60));
  console.log(`  Runtime: ${typeof Bun !== 'undefined' ? 'Bun' : 'Node.js'} ${process.version}`);
  console.log(`  PID: ${process.pid}`);
  console.log(`  Memory: ${formatBytes(process.memoryUsage().heapTotal)} heap`);
  console.log('');

  // Load environment
  console.log('[Setup] Loading environment...');
  const env = await loadEnv();

  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_URL) {
    console.error('[Error] Missing R2 credentials in ~/projects/parquedb/.env');
    console.error('  Required: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_URL');
    process.exit(1);
  }

  // Initialize R2 client
  console.log('[Setup] Initializing R2 client...');
  r2 = new R2Storage(env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY, env.R2_URL);

  // Initialize embeddings client (uses Workers AI directly if credentials available)
  console.log('[Setup] Initializing embeddings client...');
  embeddings = createEmbeddingsClientFromEnv({
    batchSize: 50,
    defaultModel: 'bge-m3',
  });

  // Parse configuration
  config = parseConfig();
  state = initState();

  console.log('');
  console.log('  Configuration:');
  console.log(`    Mode: ${config.mode}`);
  console.log(`    Dump URL: ${config.dumpUrl}`);
  console.log(`    Output prefix: ${config.outputPrefix}`);
  console.log(`    Batch Size: ${config.batchSize}`);
  console.log(`    Embeddings: ${config.generateEmbeddings ? config.embeddingsModel : 'disabled'}`);
  if (config.limit) {
    console.log(`    Limit: ${config.limit} articles`);
  }
  console.log('');

  // Register signal handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('[Sandbox] Unhandled rejection:', reason);
    state.errors.push({
      timestamp: new Date().toISOString(),
      message: `Unhandled rejection: ${reason}`,
    });
  });

  // Start HTTP server for monitoring
  startHttpServer();

  // Small delay for server readiness
  await new Promise((resolve) => setTimeout(resolve, 100));

  try {
    await runIngestion();
  } catch (error) {
    console.error('[Sandbox] Fatal ingestion error:', error);
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('[Sandbox] Fatal error:', error);
  process.exit(1);
});
