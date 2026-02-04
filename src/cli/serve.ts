/**
 * Serve Command
 *
 * Start a local API server for Wikipedia queries.
 */

import { Command } from 'commander';
import { stat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  color,
  createSpinner,
  formatNumber,
  loadConfig,
  fatal,
  resolvePath,
} from './utils.js';

/** Serve command options */
interface ServeOptions {
  port: string;
  dataDir: string;
  cors: boolean;
  host: string;
  verbose: boolean;
}

/** API response types */
interface ArticleResponse {
  id: string;
  title: string;
  type: string;
  description: string;
  content?: string | undefined;
  infobox?: Record<string, unknown> | undefined;
  coords?: { lat: number; lon: number } | undefined;
}

interface SearchResponse {
  results: ArticleResponse[];
  total: number;
  query: string;
  took_ms: number;
}

interface StatsResponse {
  total_articles: number;
  articles_by_type: Record<string, number>;
  embeddings_generated: number;
  last_updated: string;
}

export const serveCommand = new Command('serve')
  .description('Start local API server')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('-d, --data-dir <path>', 'Data directory', './data')
  .option('--cors', 'Enable CORS headers', true)
  .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('-v, --verbose', 'Verbose logging', false)
  .action(async (options: ServeOptions) => {
    const config = await loadConfig();
    const port = parseInt(options.port || String(config.port) || '8080', 10);
    const dataDir = resolvePath(options.dataDir || config.dataDir || './data');
    const host = options.host;
    const enableCors = options.cors;
    const verbose = options.verbose;

    // Check data directory exists
    try {
      await stat(dataDir);
    } catch {
      fatal(`Data directory not found: ${dataDir}\nRun 'wikipedia ingest' first.`);
    }

    // Load manifest
    let manifest: Record<string, unknown> | null = null;
    try {
      const data = await readFile(join(dataDir, 'manifest.json'), 'utf-8');
      manifest = JSON.parse(data) as Record<string, unknown>;
    } catch {
      console.log(color.yellow('  Warning: No manifest found. Statistics may be unavailable.\n'));
    }

    // Load indexes
    const spinner = createSpinner('Loading indexes...');
    let titleIndex: Record<string, { file: string; rowGroup: number; row: number }> = {};

    try {
      const indexPath = join(dataDir, 'indexes', 'titles.json');
      const data = await readFile(indexPath, 'utf-8');
      titleIndex = JSON.parse(data) as typeof titleIndex;
      spinner.success(`Loaded ${formatNumber(Object.keys(titleIndex).length)} titles into index`);
    } catch {
      spinner.success('No title index found, will scan files on demand');
    }

    // CORS headers
    const corsHeaders: Record<string, string> = enableCors
      ? {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        }
      : {};

    // Request handler
    const handleRequest = async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // Log request
      if (verbose) {
        console.log(`${color.dim(new Date().toISOString())} ${color.cyan(method)} ${path}`);
      }

      // Handle CORS preflight
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      // Route handling
      try {
        // Health check
        if (path === '/health' || path === '/') {
          return jsonResponse({ status: 'ok', version: '0.1.0' }, corsHeaders);
        }

        // Stats endpoint
        if (path === '/api/stats' || path === '/stats') {
          const stats = await getStats(dataDir, manifest);
          return jsonResponse(stats, corsHeaders);
        }

        // Search endpoint
        if (path === '/api/search' || path === '/search') {
          const query = url.searchParams.get('q') || url.searchParams.get('query') || '';
          const typeFilter = url.searchParams.get('type');
          const limit = parseInt(url.searchParams.get('limit') || '10', 10);
          const vector = url.searchParams.get('vector') === 'true';

          if (!query) {
            return jsonResponse({ error: 'Missing query parameter' }, corsHeaders, 400);
          }

          const startTime = Date.now();
          const results = await searchArticles(dataDir, titleIndex, {
            query,
            ...(typeFilter ? { type: typeFilter } : {}),
            limit,
            vector,
          });

          const response: SearchResponse = {
            results,
            total: results.length,
            query,
            took_ms: Date.now() - startTime,
          };

          return jsonResponse(response, corsHeaders);
        }

        // Get article by ID
        if (path.startsWith('/api/articles/') || path.startsWith('/articles/')) {
          const id = path.split('/').pop();
          if (!id) {
            return jsonResponse({ error: 'Missing article ID' }, corsHeaders, 400);
          }

          const article = await getArticleById(dataDir, id);
          if (!article) {
            return jsonResponse({ error: 'Article not found' }, corsHeaders, 404);
          }

          return jsonResponse(article, corsHeaders);
        }

        // Get article by title
        if (path.startsWith('/api/wiki/') || path.startsWith('/wiki/')) {
          const title = decodeURIComponent(path.split('/').slice(3).join('/') || path.split('/').pop() || '');
          if (!title) {
            return jsonResponse({ error: 'Missing article title' }, corsHeaders, 400);
          }

          const article = await getArticleByTitle(dataDir, titleIndex, title);
          if (!article) {
            return jsonResponse({ error: 'Article not found' }, corsHeaders, 404);
          }

          return jsonResponse(article, corsHeaders);
        }

        // Types endpoint
        if (path === '/api/types' || path === '/types') {
          const types = ['person', 'place', 'org', 'work', 'event', 'other'];
          const counts = (manifest?.['articlesByType'] || {}) as Record<string, number>;

          return jsonResponse(
            types.map((type) => ({
              type,
              count: counts[type] || 0,
            })),
            corsHeaders
          );
        }

        // 404 for unknown routes
        return jsonResponse({ error: 'Not found', path }, corsHeaders, 404);
      } catch (error) {
        console.error(`Error handling ${path}:`, error);
        return jsonResponse(
          { error: error instanceof Error ? error.message : 'Internal server error' },
          corsHeaders,
          500
        );
      }
    };

    // Start server
    console.log('\n  Wikipedia API Server\n');
    console.log(`  Data Dir:  ${color.cyan(dataDir)}`);
    console.log(`  Host:      ${color.cyan(host)}`);
    console.log(`  Port:      ${color.cyan(String(port))}`);
    console.log(`  CORS:      ${enableCors ? color.green('enabled') : color.gray('disabled')}`);

    if (manifest) {
      console.log(`  Articles:  ${color.cyan(formatNumber(manifest['totalArticles'] as number || 0))}`);
    }

    console.log('');
    console.log(`  API Endpoints:`);
    console.log(`    ${color.dim('GET')}  /health           Health check`);
    console.log(`    ${color.dim('GET')}  /api/stats        Statistics`);
    console.log(`    ${color.dim('GET')}  /api/search       Search articles (?q=query&type=person&limit=10)`);
    console.log(`    ${color.dim('GET')}  /api/articles/:id Get article by ID`);
    console.log(`    ${color.dim('GET')}  /api/wiki/:title  Get article by title`);
    console.log(`    ${color.dim('GET')}  /api/types        List article types`);
    console.log('');

    try {
      const server = Bun.serve({
        port,
        hostname: host,
        fetch: handleRequest,
      });

      console.log(`  ${color.green('Server running at')} ${color.cyan(`http://${host}:${port}`)}`);
      console.log(`  ${color.dim('Press Ctrl+C to stop')}\n`);

      // Handle shutdown
      process.on('SIGINT', () => {
        console.log('\n  Shutting down...');
        server.stop();
        process.exit(0);
      });

      process.on('SIGTERM', () => {
        console.log('\n  Shutting down...');
        server.stop();
        process.exit(0);
      });
    } catch (error) {
      fatal(`Failed to start server: ${error instanceof Error ? error.message : error}`);
    }
  });

/**
 * Create JSON response
 */
function jsonResponse(
  data: unknown,
  additionalHeaders: Record<string, string> = {},
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    },
  });
}

/**
 * Get statistics
 */
async function getStats(
  dataDir: string,
  manifest: Record<string, unknown> | null
): Promise<StatsResponse> {
  // Try to get checkpoint info for embeddings
  let embeddingsGenerated = 0;
  try {
    const checkpointPath = join(dataDir, 'embeddings', 'checkpoint.json');
    const data = await readFile(checkpointPath, 'utf-8');
    const checkpoint = JSON.parse(data) as { totalProcessed?: number };
    embeddingsGenerated = checkpoint.totalProcessed || 0;
  } catch {
    // No checkpoint
  }

  return {
    total_articles: (manifest?.['totalArticles'] as number) || 0,
    articles_by_type: (manifest?.['articlesByType'] as Record<string, number>) || {},
    embeddings_generated: embeddingsGenerated,
    last_updated: (manifest?.['created_at'] as string) || new Date().toISOString(),
  };
}

/**
 * Search articles
 */
async function searchArticles(
  dataDir: string,
  titleIndex: Record<string, { file: string; rowGroup: number; row: number }>,
  options: {
    query: string;
    type?: string;
    limit: number;
    vector: boolean;
  }
): Promise<ArticleResponse[]> {
  const results: ArticleResponse[] = [];
  const normalizedQuery = options.query.toLowerCase().replace(/_/g, ' ');

  // Search title index
  for (const [title, _location] of Object.entries(titleIndex)) {
    const normalizedTitle = title.toLowerCase().replace(/_/g, ' ');

    if (normalizedTitle.includes(normalizedQuery)) {
      results.push({
        id: '', // Would load from file
        title,
        type: 'other', // Would load from file
        description: '',
      });

      if (results.length >= options.limit) break;
    }
  }

  // If no index or not enough results, scan files
  if (results.length < options.limit) {
    const articlesDir = join(dataDir, 'articles');

    try {
      const parquetFiles = await findParquetFiles(articlesDir);

      for (const file of parquetFiles.slice(0, 5)) {
        // Limit files for performance
        const matches = await searchParquetFile(join(articlesDir, file), normalizedQuery, {
          ...(options.type ? { type: options.type } : {}),
          limit: options.limit - results.length,
        });

        results.push(...matches);

        if (results.length >= options.limit) break;
      }
    } catch {
      // Directory might not exist
    }
  }

  return results.slice(0, options.limit);
}

/**
 * Get article by ID
 */
async function getArticleById(dataDir: string, id: string): Promise<ArticleResponse | null> {
  // Would need to implement proper lookup
  // For now, scan files
  const articlesDir = join(dataDir, 'articles');

  try {
    const parquetFiles = await findParquetFiles(articlesDir);

    for (const file of parquetFiles) {
      const article = await findArticleInFile(join(articlesDir, file), '$id', id);
      if (article) return article;
    }
  } catch {
    // Directory might not exist
  }

  return null;
}

/**
 * Get article by title
 */
async function getArticleByTitle(
  dataDir: string,
  titleIndex: Record<string, { file: string; rowGroup: number; row: number }>,
  title: string
): Promise<ArticleResponse | null> {
  // Check index first
  const location = titleIndex[title] || titleIndex[title.replace(/ /g, '_')];

  if (location) {
    const article = await findArticleInFile(join(dataDir, 'articles', location.file), 'title', title);
    if (article) return article;
  }

  // Fall back to scanning
  const articlesDir = join(dataDir, 'articles');

  try {
    const parquetFiles = await findParquetFiles(articlesDir);

    for (const file of parquetFiles) {
      const article = await findArticleInFile(join(articlesDir, file), 'title', title);
      if (article) return article;
    }
  } catch {
    // Directory might not exist
  }

  return null;
}

/**
 * Find Parquet files
 */
async function findParquetFiles(dir: string): Promise<string[]> {
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
 * Search Parquet file for matching articles
 */
async function searchParquetFile(
  filePath: string,
  query: string,
  options: { type?: string; limit: number }
): Promise<ArticleResponse[]> {
  const results: ArticleResponse[] = [];

  try {
    const { parquetRead } = await import('@dotdo/hyparquet');
    const buffer = await readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    await parquetRead({
      file: arrayBuffer,
      columns: ['$id', 'title', '$type', 'description', 'content', 'coords_lat', 'coords_lon'],
      onComplete: (rawData: unknown) => {
        const data = rawData as Record<string, unknown[]>;
        const ids = (data['$id'] || data['id'] || []) as string[];
        const titles = (data['title'] || []) as string[];
        const types = (data['$type'] || data['type'] || []) as string[];
        const descriptions = (data['description'] || []) as string[];

        for (let i = 0; i < titles.length && results.length < options.limit; i++) {
          const title = String(titles[i] || '');
          const type = String(types[i] || 'other');

          // Apply type filter
          if (options.type && type !== options.type) continue;

          // Check if matches
          if (title.toLowerCase().includes(query)) {
            results.push({
              id: String(ids[i] || ''),
              title,
              type,
              description: String(descriptions[i] || ''),
            });
          }
        }
      },
    });
  } catch {
    // File might not be readable
  }

  return results;
}

/**
 * Find article in Parquet file by field value
 */
async function findArticleInFile(
  filePath: string,
  field: string,
  value: string
): Promise<ArticleResponse | null> {
  try {
    const { parquetRead } = await import('@dotdo/hyparquet');
    const buffer = await readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    let result: ArticleResponse | null = null;

    await parquetRead({
      file: arrayBuffer,
      onComplete: (rawData: unknown) => {
        const data = rawData as Record<string, unknown[]>;
        const ids = (data['$id'] || data['id'] || []) as string[];
        const titles = (data['title'] || []) as string[];
        const types = (data['$type'] || data['type'] || []) as string[];
        const descriptions = (data['description'] || []) as string[];
        const contents = (data['content'] || []) as string[];
        const infoboxes = (data['infobox'] || []) as Array<Record<string, unknown>>;
        const lats = (data['coords_lat'] || []) as number[];
        const lons = (data['coords_lon'] || []) as number[];

        const searchArray =
          field === '$id' ? ids : field === 'title' ? titles : (data[field] || []) as string[];

        for (let i = 0; i < searchArray.length; i++) {
          const searchVal = searchArray[i];
          if (String(searchVal) === value || String(searchVal).toLowerCase() === value.toLowerCase()) {
            const lat = lats[i];
            const lon = lons[i];
            result = {
              id: String(ids[i] || ''),
              title: String(titles[i] || ''),
              type: String(types[i] || 'other'),
              description: String(descriptions[i] || ''),
              content: String(contents[i] || ''),
              infobox: infoboxes[i] || undefined,
              coords:
                lat != null && lon != null
                  ? { lat, lon }
                  : undefined,
            };
            break;
          }
        }
      },
    });

    return result;
  } catch {
    return null;
  }
}
