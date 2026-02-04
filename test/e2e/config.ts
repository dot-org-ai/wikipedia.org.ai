/**
 * E2E Test Configuration
 *
 * Configuration for end-to-end tests against deployed workers.
 * Supports environment variable overrides for different environments.
 */

/**
 * CPU time limits in milliseconds
 */
export const CPU_LIMITS = {
  /** Maximum CPU time for snippet routes (lightweight operations) */
  SNIPPET_MS: 5,
  /** Maximum CPU time for worker routes (full article processing) */
  WORKER_MS: 50,
} as const;

/**
 * E2E test configuration
 */
export interface E2EConfig {
  /** Base URL for the deployed worker */
  baseUrl: string;
  /** Whether to skip E2E tests (for local-only testing) */
  skipE2E: boolean;
  /** Request timeout in milliseconds */
  requestTimeoutMs: number;
  /** Number of retries for flaky network requests */
  retries: number;
  /** CPU time limit for worker routes */
  cpuLimitWorkerMs: number;
  /** CPU time limit for snippet routes */
  cpuLimitSnippetMs: number;
}

/**
 * Load E2E configuration from environment variables
 */
export function loadE2EConfig(): E2EConfig {
  return {
    baseUrl: process.env.E2E_BASE_URL || 'https://wiki.org.ai',
    skipE2E: process.env.SKIP_E2E === 'true' || process.env.SKIP_E2E === '1',
    requestTimeoutMs: parseInt(process.env.E2E_TIMEOUT_MS || '30000', 10),
    retries: parseInt(process.env.E2E_RETRIES || '2', 10),
    cpuLimitWorkerMs: parseInt(process.env.E2E_CPU_LIMIT_WORKER_MS || String(CPU_LIMITS.WORKER_MS), 10),
    cpuLimitSnippetMs: parseInt(process.env.E2E_CPU_LIMIT_SNIPPET_MS || String(CPU_LIMITS.SNIPPET_MS), 10),
  };
}

/**
 * Default configuration instance
 */
export const config = loadE2EConfig();

/**
 * Test articles categorized by size
 */
export const TEST_ARTICLES = {
  /** Small articles (< 10KB typically) */
  small: [
    'Cat',
    'Dog',
    'Apple',
  ],
  /** Medium articles (10-100KB typically) */
  medium: [
    'Apple_Inc.',
    'Microsoft',
    'Google',
  ],
  /** Large articles (> 100KB typically) */
  large: [
    'Tokyo',
    'United_States',
    'World_War_II',
  ],
} as const;

/**
 * All test endpoints with their expected behavior
 */
export const TEST_ENDPOINTS = {
  /** Article title route - returns HTML */
  title: (title: string) => `/${title}`,
  /** JSON route - returns full article JSON */
  json: (title: string) => `/${title}.json`,
  /** Summary route - returns article summary */
  summary: (title: string) => `/${title}/summary`,
  /** Infobox route - returns article infobox */
  infobox: (title: string) => `/${title}/infobox`,
} as const;

/**
 * Route type classification for CPU limit assertions
 */
export type RouteType = 'worker' | 'snippet';

/**
 * Get the route type for CPU limit assertions
 */
export function getRouteType(endpoint: string): RouteType {
  // Summary and infobox are snippet routes (lighter operations)
  if (endpoint.includes('/summary') || endpoint.includes('/infobox')) {
    return 'snippet';
  }
  // Full article and JSON are worker routes
  return 'worker';
}

/**
 * Get the CPU limit for a given route type
 */
export function getCpuLimit(routeType: RouteType, cfg: E2EConfig = config): number {
  return routeType === 'snippet' ? cfg.cpuLimitSnippetMs : cfg.cpuLimitWorkerMs;
}

/**
 * Parse X-Response-Time header to milliseconds
 * Handles formats like "10ms", "10.5ms", "10"
 */
export function parseResponseTime(header: string | null): number | null {
  if (!header) return null;

  // Remove 'ms' suffix if present
  const numStr = header.replace(/ms$/i, '').trim();
  const num = parseFloat(numStr);

  return isNaN(num) ? null : num;
}
