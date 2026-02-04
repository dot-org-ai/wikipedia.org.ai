/**
 * Wikipedia Ingestion Container Worker
 *
 * This Worker exposes the WikipediaIngestContainer which runs long-running
 * Wikipedia dump processing jobs in a Cloudflare Container.
 *
 * The container:
 * - Streams Wikipedia dump from dumps.wikimedia.org
 * - Decompresses bzip2/gzip on-the-fly
 * - Parses XML and extracts articles
 * - Classifies articles by type (person, place, org, work, event, other)
 * - Writes Parquet files to R2 via S3 API
 * - Supports resume from checkpoint
 * - Exposes HTTP API for status and control
 */

import { Container } from '@cloudflare/containers';

interface Env {
  // Durable Object binding
  INGEST_CONTAINER: DurableObjectNamespace<WikipediaIngestContainer>;

  // R2 credentials (passed as secrets)
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ENDPOINT: string;
  R2_BUCKET_NAME: string;

  // R2 bucket binding (for direct API access if needed)
  R2: R2Bucket;

  // AI binding for embeddings
  AI: Ai;

  // Configuration
  MODE: string;
  WIKIPEDIA_DUMP_URL: string;
  OUTPUT_DIR: string;
  BATCH_SIZE: string;
  CHECKPOINT_INTERVAL: string;
  HTTP_PORT: string;
  SKIP_REDIRECTS: string;
  SKIP_DISAMBIGUATION: string;
  LOG_INTERVAL: string;
  LIMIT?: string;
}

/**
 * Container class for Wikipedia ingestion
 *
 * Extends Cloudflare Container to run long-running jobs.
 */
export class WikipediaIngestContainer extends Container<Env> {
  // Default port for HTTP health checks and status API
  defaultPort = 8080;

  // Keep container alive for 6 hours (max timeout for full Wikipedia ingestion)
  sleepAfter = '6h';

  // Enable internet access for downloading Wikipedia dumps
  enableInternet = true;

  // Pass environment variables to the container
  // These are read by scripts/run-local-ingest.ts which loads them from the container env
  get envVars() {
    return {
      // R2 credentials (used by S3 API in the script)
      R2_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID ?? '',
      R2_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY ?? '',
      R2_URL: this.env.R2_ENDPOINT ?? '',

      // Ingestion configuration
      MODE: this.env.MODE ?? 'ingest',
      WIKIPEDIA_DUMP_URL: this.env.WIKIPEDIA_DUMP_URL ?? '',
      BATCH_SIZE: this.env.BATCH_SIZE ?? '5000',
      CHECKPOINT_INTERVAL: this.env.CHECKPOINT_INTERVAL ?? '10000',
      HTTP_PORT: this.env.HTTP_PORT ?? '8080',
      SKIP_REDIRECTS: this.env.SKIP_REDIRECTS ?? 'true',
      SKIP_DISAMBIGUATION: this.env.SKIP_DISAMBIGUATION ?? 'true',
      LOG_INTERVAL: this.env.LOG_INTERVAL ?? '1000',
      LIMIT: this.env.LIMIT ?? '',
    };
  }

  /**
   * Lifecycle hook called when container starts
   */
  override onStart() {
    console.log('[WikipediaIngestContainer] Container started');
  }

  /**
   * Lifecycle hook called when container stops
   */
  override onStop(params: { exitCode: number; reason: string }) {
    console.log(`[WikipediaIngestContainer] Container stopped: ${params.reason} (exit code: ${params.exitCode})`);
  }

  /**
   * Lifecycle hook called on container errors
   */
  override onError(error: unknown) {
    console.error('[WikipediaIngestContainer] Container error:', error);
    throw error;
  }
}

/**
 * Worker fetch handler
 *
 * Routes requests to the container's HTTP API for status monitoring and control.
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint (doesn't require container)
    if (url.pathname === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'wikipedia-ingest' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get or create the container instance
    const id = env.INGEST_CONTAINER.idFromName('wikipedia-ingest');
    const container = env.INGEST_CONTAINER.get(id);

    // Forward the request to the container
    try {
      const containerResponse = await container.fetch(request);
      return containerResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Check if container is still starting up
      if (message.includes('not ready') || message.includes('starting') || message.includes('not running')) {
        return new Response(
          JSON.stringify({
            status: 'starting',
            message: 'Container is starting up. This may take a few minutes for initial provisioning.',
            hint: 'Try again in 30-60 seconds. Containers take time to provision on first request.',
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '30',
            },
          }
        );
      }

      return new Response(
        JSON.stringify({
          error: 'Container error',
          message,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
