/**
 * Wikipedia Sandbox Worker
 *
 * A Cloudflare Worker for Wikipedia data ingestion and processing.
 * Handles parsing Wikipedia dumps, extracting infoboxes, and storing
 * processed data to R2 as Parquet files.
 *
 * Features:
 * - Trigger ingestion jobs via HTTP API
 * - Process Wikipedia articles through wtf-lite parser
 * - Classify articles by type (person, place, org, work, event, other)
 * - Generate embeddings via Workers AI
 * - Store parsed data to R2 as Parquet files
 * - Track batch processing progress
 * - Support job pause/resume
 *
 * Routes:
 * - GET /health - Health check
 * - POST /ingest/start - Start ingestion job
 * - GET /ingest/status - Get current job status
 * - GET /ingest/status/:jobId - Get specific job status
 * - POST /ingest/process-batch - Process a batch of articles
 * - POST /ingest/pause - Pause current job
 * - POST /ingest/resume - Resume paused job
 */

import type {
  Env,
  IngestJobConfig,
  IngestJobState,
  StartIngestRequest,
  StartIngestResponse,
  JobStatusResponse,
  ProcessBatchRequest,
  ProcessBatchResponse,
  RawArticle,
  ParsedArticle,
  ArticleRecord,
  APIError,
  HealthResponse,
} from './types.js';
import type { ArticleType } from '../../shared/types.js';
import wtf from '../../lib/wtf-lite/index.js';

// ============================================================================
// In-memory job state (would use Durable Objects for production)
// ============================================================================

const jobs = new Map<string, IngestJobState>();
let startTime = Date.now();

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create initial job state
 */
function createJobState(
  jobId: string,
  config: IngestJobConfig
): IngestJobState {
  const now = new Date().toISOString();
  return {
    jobId,
    status: 'pending',
    config,
    startedAt: null,
    updatedAt: now,
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
    embeddingsGenerated: 0,
    embeddingErrors: 0,
    lastArticleId: 0,
    lastArticleTitle: '',
    errors: [],
  };
}

/**
 * Parse default config values
 */
function parseConfig(request: StartIngestRequest): IngestJobConfig {
  const config: IngestJobConfig = {
    dumpUrl: request.dumpUrl,
    outputPrefix: request.outputPrefix ?? 'wikipedia',
    batchSize: request.batchSize ?? 1000,
    skipRedirects: request.skipRedirects ?? true,
    skipDisambiguation: request.skipDisambiguation ?? true,
    generateEmbeddings: request.generateEmbeddings ?? false,
    embeddingsModel: request.embeddingsModel ?? 'bge-m3',
  };
  if (request.limit !== undefined) {
    config.limit = request.limit;
  }
  return config;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Create JSON response
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

/**
 * Create error response
 */
function errorResponse(
  error: string,
  message: string,
  status: number,
  details?: unknown
): Response {
  const body: APIError = { error, message, status };
  if (details !== undefined) {
    body.details = details;
  }
  return jsonResponse(body, status);
}

// ============================================================================
// Article Parsing (using wtf-lite)
// ============================================================================

/**
 * Patterns for identifying special page types
 */
const REDIRECT_PATTERN = /^#REDIRECT\s*\[\[/i;
const DISAMBIG_TEMPLATES = new Set([
  'disambiguation',
  'disambig',
  'disamb',
  'dab',
  'surname',
  'given name',
  'hndis',
  'geodis',
]);

/**
 * Infobox type to article type mapping
 */
const INFOBOX_TYPE_MAP: Record<string, ArticleType> = {
  // Person types
  person: 'person',
  biography: 'person',
  officeholder: 'person',
  politician: 'person',
  scientist: 'person',
  artist: 'person',
  musician: 'person',
  actor: 'person',
  writer: 'person',
  athlete: 'person',
  'football biography': 'person',
  'basketball biography': 'person',
  'baseball biography': 'person',
  military: 'person',
  royalty: 'person',

  // Place types
  settlement: 'place',
  city: 'place',
  country: 'place',
  'country or territory': 'place',
  state: 'place',
  province: 'place',
  region: 'place',
  building: 'place',
  venue: 'place',
  park: 'place',
  mountain: 'place',
  body_of_water: 'place',
  river: 'place',
  lake: 'place',

  // Organization types
  company: 'org',
  organization: 'org',
  organisation: 'org',
  university: 'org',
  school: 'org',
  'football club': 'org',
  'sports team': 'org',
  political_party: 'org',
  government_agency: 'org',

  // Work types
  film: 'work',
  album: 'work',
  book: 'work',
  song: 'work',
  television: 'work',
  'video game': 'work',
  software: 'work',
  artwork: 'work',

  // Event types
  event: 'event',
  election: 'event',
  war: 'event',
  battle: 'event',
  disaster: 'event',
  pandemic: 'event',
};

/**
 * Classify article type based on infoboxes and categories
 */
function classifyArticle(
  infoboxes: Array<{ type: string; data: Record<string, string> }>,
  categories: string[]
): ArticleType {
  // Check infobox types first
  for (const infobox of infoboxes) {
    const normalizedType = infobox.type.toLowerCase().replace(/^infobox\s+/i, '').trim();

    // Direct match
    const directMatch = INFOBOX_TYPE_MAP[normalizedType];
    if (directMatch !== undefined) {
      return directMatch;
    }

    // Partial match
    for (const [pattern, type] of Object.entries(INFOBOX_TYPE_MAP)) {
      if (normalizedType.includes(pattern)) {
        return type;
      }
    }
  }

  // Check categories
  const categoryText = categories.join(' ').toLowerCase();

  if (
    categoryText.includes('birth') ||
    categoryText.includes('death') ||
    categoryText.includes('people from') ||
    categoryText.includes('living people')
  ) {
    return 'person';
  }

  if (
    categoryText.includes('cities') ||
    categoryText.includes('countries') ||
    categoryText.includes('populated places') ||
    categoryText.includes('geography')
  ) {
    return 'place';
  }

  if (
    categoryText.includes('companies') ||
    categoryText.includes('organizations') ||
    categoryText.includes('universities') ||
    categoryText.includes('sports teams')
  ) {
    return 'org';
  }

  if (
    categoryText.includes('films') ||
    categoryText.includes('albums') ||
    categoryText.includes('books') ||
    categoryText.includes('video games') ||
    categoryText.includes('songs')
  ) {
    return 'work';
  }

  if (
    categoryText.includes('events') ||
    categoryText.includes('wars') ||
    categoryText.includes('battles') ||
    categoryText.includes('elections')
  ) {
    return 'event';
  }

  return 'other';
}

/**
 * Parse a raw article using wtf-lite
 */
function parseArticle(raw: RawArticle): ParsedArticle {
  // Check for redirect
  const isRedirect = REDIRECT_PATTERN.test(raw.text);
  let redirectTarget: string | undefined;

  if (isRedirect) {
    const match = raw.text.match(/\[\[([^\]|]+)/);
    if (match?.[1]) {
      redirectTarget = match[1].trim();
    } else if (raw.redirect) {
      redirectTarget = raw.redirect;
    }
  }

  // Parse with wtf-lite
  const doc = wtf(raw.text, { title: raw.title });

  // Extract plain text
  const plaintext = doc.text() || '';

  // Extract infoboxes
  const infoboxes: Array<{ type: string; data: Record<string, string> }> = [];
  try {
    const rawInfoboxes = doc.infoboxes();
    for (const box of rawInfoboxes) {
      const boxJson = box.json() as { type?: string; data?: Record<string, string> };
      infoboxes.push({
        type: boxJson.type ?? 'unknown',
        data: boxJson.data ?? {},
      });
    }
  } catch {
    // Ignore infobox extraction errors
  }

  // Extract links
  const links: Array<{ page: string; text: string }> = [];
  try {
    const docJson = doc.json() as {
      sections?: Array<{
        paragraphs?: Array<{
          sentences?: Array<{
            links?: Array<{ page?: string; text?: string }>
          }>
        }>
      }>
    };
    for (const section of docJson.sections ?? []) {
      for (const para of section.paragraphs ?? []) {
        for (const sentence of para.sentences ?? []) {
          for (const link of sentence.links ?? []) {
            if (link.page && !link.page.startsWith('http')) {
              links.push({
                page: link.page,
                text: link.text ?? link.page,
              });
            }
          }
        }
      }
    }
  } catch {
    // Ignore link extraction errors
  }

  // Extract categories
  const categories = doc.categories() || [];

  // Check for disambiguation
  let isDisambiguation = false;
  try {
    const templates = doc.templates();
    for (const template of templates) {
      // ParsedTemplate already has template name as property (no .json() needed)
      const templateName = (template.template ?? '').toLowerCase();
      if (DISAMBIG_TEMPLATES.has(templateName)) {
        isDisambiguation = true;
        break;
      }
    }
    if (!isDisambiguation) {
      for (const cat of categories) {
        if (cat.toLowerCase().includes('disambiguation')) {
          isDisambiguation = true;
          break;
        }
      }
    }
  } catch {
    // Ignore template extraction errors
  }

  // Classify article type
  const type = classifyArticle(infoboxes, categories);

  const article: ParsedArticle = {
    title: raw.title,
    id: raw.id,
    plaintext,
    infoboxes,
    links,
    categories,
    isRedirect,
    isDisambiguation,
    type,
    timestamp: raw.timestamp,
  };

  if (redirectTarget !== undefined) {
    article.redirectTarget = redirectTarget;
  }

  return article;
}

/**
 * Convert parsed article to storage record
 */
function toStorageRecord(
  article: ParsedArticle,
  embedding?: number[],
  embeddingModel?: string
): ArticleRecord {
  // Extract description (first paragraph)
  const firstParagraph = article.plaintext.split('\n\n')[0] || '';
  const description = firstParagraph.slice(0, 500);

  // Extract coordinates
  let coordsLat: number | null = null;
  let coordsLon: number | null = null;

  if (article.infoboxes.length > 0) {
    const infobox = article.infoboxes[0];
    if (infobox) {
      const coordsStr = infobox.data['coordinates'] ?? infobox.data['coord'] ?? infobox.data['coords'];
      if (coordsStr) {
        const match = coordsStr.match(/([-\d.]+)[,\s]+([-\d.]+)/);
        if (match?.[1] && match[2]) {
          coordsLat = parseFloat(match[1]);
          coordsLon = parseFloat(match[2]);
        }
      }
    }
  }

  // Parse timestamp
  const parsedDate = article.timestamp ? new Date(article.timestamp) : new Date();
  const updatedAt = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

  const record: ArticleRecord = {
    $id: String(article.id),
    $type: article.type,
    title: article.title,
    description,
    wikidata_id: null,
    coords_lat: coordsLat,
    coords_lon: coordsLon,
    infobox: article.infoboxes.length > 0 && article.infoboxes[0] ? article.infoboxes[0].data : null,
    content: article.plaintext,
    updated_at: updatedAt,
  };

  if (embedding && embeddingModel) {
    record.embedding = embedding;
    record.embedding_model = embeddingModel;
  }

  return record;
}

// ============================================================================
// Embeddings Generation
// ============================================================================

/**
 * Generate embeddings for articles using Workers AI
 */
async function generateEmbeddings(
  ai: Ai,
  articles: ParsedArticle[],
  model: 'bge-m3' | 'bge-base'
): Promise<Map<number, number[]>> {
  const embeddings = new Map<number, number[]>();

  // Create text representations
  const texts = articles.map((article) => {
    const firstParagraph = article.plaintext.split('\n\n')[0] || '';
    return `${article.title}\n\n${firstParagraph}`.slice(0, 8000);
  });

  // Determine model name
  const modelName = model === 'bge-m3'
    ? '@cf/baai/bge-m3'
    : '@cf/baai/bge-base-en-v1.5';

  try {
    // Generate embeddings in batches of 100
    const batchSize = 100;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batchTexts = texts.slice(i, i + batchSize);
      const batchArticles = articles.slice(i, i + batchSize);

      const result = await ai.run(modelName, {
        text: batchTexts,
      }) as { data?: number[][] };

      if (result && Array.isArray(result.data)) {
        for (let j = 0; j < result.data.length; j++) {
          const article = batchArticles[j];
          const embeddingData = result.data[j];
          if (article && embeddingData) {
            embeddings.set(article.id, embeddingData);
          }
        }
      }
    }
  } catch (error) {
    console.error('Embedding generation failed:', error);
    throw error;
  }

  return embeddings;
}

// ============================================================================
// HTTP Handlers
// ============================================================================

/**
 * Handle health check
 */
function handleHealth(_env: Env): Response {
  const activeJobs = Array.from(jobs.values()).filter(
    (j) => j.status === 'running' || j.status === 'pending'
  ).length;

  const response: HealthResponse = {
    status: 'ok',
    service: 'wikipedia-sandbox',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeJobs,
  };

  return jsonResponse(response);
}

/**
 * Handle start ingestion request
 */
async function handleStartIngest(
  request: Request,
  env: Env
): Promise<Response> {
  // Parse request body
  let body: StartIngestRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad_request', 'Invalid JSON body', 400);
  }

  // Validate required fields
  if (!body.dumpUrl) {
    return errorResponse('bad_request', 'dumpUrl is required', 400);
  }

  // Create job
  const jobId = generateJobId();
  const config = parseConfig(body);
  const state = createJobState(jobId, config);

  // Store job state
  jobs.set(jobId, state);

  // Update state to running
  state.status = 'running';
  state.startedAt = new Date().toISOString();
  state.updatedAt = state.startedAt;

  // Queue the job for processing (if queue is available)
  if (env.INGEST_QUEUE) {
    try {
      await env.INGEST_QUEUE.send({
        type: 'start',
        jobId,
      });
    } catch (error) {
      console.error('Failed to queue job:', error);
      // Continue without queue - job can be processed via batch endpoint
    }
  }

  const response: StartIngestResponse = {
    success: true,
    jobId,
    message: 'Ingestion job started',
    state,
  };

  return jsonResponse(response, 202);
}

/**
 * Handle job status request
 */
function handleJobStatus(
  jobId: string | null,
  _env: Env
): Response {
  // If no jobId, return all jobs
  if (!jobId) {
    const allJobs = Array.from(jobs.values());
    return jsonResponse({
      jobs: allJobs,
      total: allJobs.length,
    });
  }

  // Find specific job
  const state = jobs.get(jobId);
  if (!state) {
    return errorResponse('not_found', `Job ${jobId} not found`, 404);
  }

  // Calculate progress
  let progress = 0;
  let eta: string | null = null;

  if (state.config.limit && state.articlesProcessed > 0) {
    progress = Math.min(
      100,
      Math.round((state.articlesProcessed / state.config.limit) * 100)
    );

    if (state.currentRate > 0) {
      const remaining = state.config.limit - state.articlesProcessed;
      const etaSeconds = remaining / state.currentRate;
      eta = formatDuration(etaSeconds);
    }
  }

  const response: JobStatusResponse = {
    state,
    progress,
    eta,
  };

  return jsonResponse(response);
}

/**
 * Handle batch processing request
 */
async function handleProcessBatch(
  request: Request,
  env: Env
): Promise<Response> {
  const startMs = Date.now();

  // Parse request body
  let body: ProcessBatchRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad_request', 'Invalid JSON body', 400);
  }

  // Validate
  if (!body.jobId) {
    return errorResponse('bad_request', 'jobId is required', 400);
  }
  if (!body.articles || !Array.isArray(body.articles)) {
    return errorResponse('bad_request', 'articles array is required', 400);
  }

  // Find job
  const state = jobs.get(body.jobId);
  if (!state) {
    return errorResponse('not_found', `Job ${body.jobId} not found`, 404);
  }

  // Process articles
  const errors: string[] = [];
  const records: ArticleRecord[] = [];
  let processed = 0;
  let skipped = 0;

  for (const raw of body.articles) {
    try {
      // Parse article
      const parsed = parseArticle(raw);

      // Skip if configured
      if (state.config.skipRedirects && parsed.isRedirect) {
        skipped++;
        state.articlesSkipped++;
        continue;
      }
      if (state.config.skipDisambiguation && parsed.isDisambiguation) {
        skipped++;
        state.articlesSkipped++;
        continue;
      }

      // Convert to storage record
      const record = toStorageRecord(parsed);
      records.push(record);
      processed++;

      // Update stats
      state.articlesProcessed++;
      state.articlesByType[parsed.type]++;
      state.lastArticleId = parsed.id;
      state.lastArticleTitle = parsed.title;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Article ${raw.id}: ${message}`);
      state.errors.push({
        timestamp: new Date().toISOString(),
        message,
        articleId: raw.id,
      });
    }
  }

  // Generate embeddings if enabled
  let embeddingsGenerated = 0;
  if (state.config.generateEmbeddings && records.length > 0) {
    try {
      const articlesToEmbed = body.articles
        .filter((a) => {
          const parsed = parseArticle(a);
          return !(
            (state.config.skipRedirects && parsed.isRedirect) ||
            (state.config.skipDisambiguation && parsed.isDisambiguation)
          );
        })
        .map((a) => parseArticle(a));

      const embeddings = await generateEmbeddings(
        env.AI,
        articlesToEmbed,
        state.config.embeddingsModel
      );

      // Add embeddings to records
      for (const record of records) {
        const embedding = embeddings.get(parseInt(record.$id, 10));
        if (embedding) {
          record.embedding = embedding;
          record.embedding_model = state.config.embeddingsModel;
          embeddingsGenerated++;
        }
      }

      state.embeddingsGenerated += embeddingsGenerated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Embeddings: ${message}`);
      state.embeddingErrors += records.length;
    }
  }

  // Write to R2 (simplified - actual implementation would use Parquet writer)
  if (records.length > 0 && env.OUTPUT_BUCKET) {
    try {
      const batchKey = `${state.config.outputPrefix}/batch_${state.articlesProcessed}.json`;
      await env.OUTPUT_BUCKET.put(batchKey, JSON.stringify(records));
      state.bytesWritten += JSON.stringify(records).length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`R2 write: ${message}`);
    }
  }

  // Update job state
  const now = Date.now();
  const elapsedSeconds = (now - Date.parse(state.startedAt || state.updatedAt)) / 1000;
  state.currentRate = elapsedSeconds > 0 ? state.articlesProcessed / elapsedSeconds : 0;
  state.updatedAt = new Date().toISOString();

  // Check if limit reached
  if (state.config.limit && state.articlesProcessed >= state.config.limit) {
    state.status = 'completed';
  }

  const response: ProcessBatchResponse = {
    success: errors.length === 0,
    processed,
    skipped,
    embeddingsGenerated,
    processingTimeMs: Date.now() - startMs,
    errors,
  };

  return jsonResponse(response);
}

/**
 * Handle pause request
 */
function handlePause(jobId: string | null): Response {
  if (!jobId) {
    return errorResponse('bad_request', 'jobId is required', 400);
  }

  const state = jobs.get(jobId);
  if (!state) {
    return errorResponse('not_found', `Job ${jobId} not found`, 404);
  }

  if (state.status !== 'running') {
    return errorResponse('conflict', 'Job is not running', 409);
  }

  state.status = 'paused';
  state.updatedAt = new Date().toISOString();

  return jsonResponse({
    success: true,
    message: 'Job paused',
    state,
  });
}

/**
 * Handle resume request
 */
function handleResume(jobId: string | null): Response {
  if (!jobId) {
    return errorResponse('bad_request', 'jobId is required', 400);
  }

  const state = jobs.get(jobId);
  if (!state) {
    return errorResponse('not_found', `Job ${jobId} not found`, 404);
  }

  if (state.status !== 'paused') {
    return errorResponse('conflict', 'Job is not paused', 409);
  }

  state.status = 'running';
  state.updatedAt = new Date().toISOString();

  return jsonResponse({
    success: true,
    message: 'Job resumed',
    state,
  });
}

// ============================================================================
// Router
// ============================================================================

/**
 * Route incoming requests
 */
async function handleRequest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Health check
  if (path === '/health' && method === 'GET') {
    return handleHealth(env);
  }

  // Start ingestion
  if (path === '/ingest/start' && method === 'POST') {
    return handleStartIngest(request, env);
  }

  // Get job status
  if (path === '/ingest/status' && method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    return handleJobStatus(jobId, env);
  }

  // Get specific job status
  if (path.startsWith('/ingest/status/') && method === 'GET') {
    const jobId = path.replace('/ingest/status/', '');
    return handleJobStatus(jobId, env);
  }

  // Process batch
  if (path === '/ingest/process-batch' && method === 'POST') {
    return handleProcessBatch(request, env);
  }

  // Pause job
  if (path === '/ingest/pause' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { jobId?: string };
    return handlePause(body.jobId ?? null);
  }

  // Resume job
  if (path === '/ingest/resume' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { jobId?: string };
    return handleResume(body.jobId ?? null);
  }

  // 404 for unknown routes
  return errorResponse('not_found', `Route ${method} ${path} not found`, 404);
}

// ============================================================================
// Worker Export
// ============================================================================

export default {
  /**
   * Handle incoming HTTP requests
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error('Unhandled error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      return errorResponse('internal_error', message, 500);
    }
  },

  /**
   * Handle queue messages
   */
  async queue(
    batch: MessageBatch<unknown>,
    _env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        const data = message.body as { type: string; jobId: string };
        console.log(`Processing queue message: ${data.type} for job ${data.jobId}`);

        // Handle different message types
        switch (data.type) {
          case 'start':
            // Job start logic would go here
            // For now, just acknowledge
            console.log(`Job ${data.jobId} start acknowledged`);
            break;

          case 'process-batch':
            // Batch processing logic
            console.log(`Processing batch for job ${data.jobId}`);
            break;

          case 'finalize':
            // Finalization logic
            console.log(`Finalizing job ${data.jobId}`);
            break;

          default:
            console.warn(`Unknown message type: ${data.type}`);
        }

        // Acknowledge message
        message.ack();
      } catch (error) {
        console.error('Queue message processing failed:', error);
        message.retry();
      }
    }
  },
};

// Re-export types
export type { Env } from './types.js';
