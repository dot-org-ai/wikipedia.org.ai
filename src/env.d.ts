/**
 * Global environment bindings for Cloudflare Workers.
 *
 * NOTE: The canonical definition is in src/workers/api/types.ts.
 * This ambient declaration provides type hints for files that don't
 * explicitly import Env. Keep this in sync with types.ts.
 */
interface Env {
  /** R2 bucket for Wikipedia data storage */
  R2: R2Bucket;
  /** Cloudflare AI binding for embeddings and inference */
  AI: Ai;
  /** AI Gateway URL for routing AI requests */
  AI_GATEWAY_URL: string;
  /** Deployment environment */
  ENVIRONMENT: 'staging' | 'production';
  /** Comma-separated list of valid API keys (optional) */
  API_KEYS?: string;
}
