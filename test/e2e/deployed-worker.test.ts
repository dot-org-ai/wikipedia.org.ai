/**
 * End-to-End Tests for Deployed Wikipedia Worker
 *
 * Tests the production worker at wiki.org.ai (or configured test URL)
 * and asserts that CPU time stays under specified limits.
 *
 * Run with: bun test test/e2e/
 * Skip with: SKIP_E2E=true bun test
 *
 * Environment variables:
 * - E2E_BASE_URL: Base URL of the deployed worker (default: https://wiki.org.ai)
 * - SKIP_E2E: Set to 'true' to skip E2E tests
 * - E2E_TIMEOUT_MS: Request timeout in milliseconds (default: 30000)
 * - E2E_RETRIES: Number of retries for flaky requests (default: 2)
 * - E2E_CPU_LIMIT_WORKER_MS: CPU limit for worker routes (default: 50)
 * - E2E_CPU_LIMIT_SNIPPET_MS: CPU limit for snippet routes (default: 5)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  config,
  loadE2EConfig,
  TEST_ARTICLES,
  TEST_ENDPOINTS,
  getRouteType,
  getCpuLimit,
  parseResponseTime,
  type E2EConfig,
  CPU_LIMITS,
} from './config.js';

// Re-load config at test time to pick up any env changes
const e2eConfig = loadE2EConfig();

/**
 * Helper to make a request with retry logic
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries: number = e2eConfig.retries
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), e2eConfig.requestTimeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on abort
      if (lastError.name === 'AbortError') {
        throw new Error(`Request timed out after ${e2eConfig.requestTimeoutMs}ms: ${url}`);
      }

      // Wait before retry (exponential backoff)
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw lastError || new Error(`Failed to fetch ${url} after ${retries + 1} attempts`);
}

/**
 * Test result for a single endpoint
 */
interface EndpointTestResult {
  url: string;
  status: number;
  responseTimeMs: number | null;
  contentType: string | null;
  bodyPreview: string;
  cpuLimitMs: number;
  withinCpuLimit: boolean;
}

/**
 * Test a single endpoint and return results
 */
async function testEndpoint(
  baseUrl: string,
  endpoint: string,
  cfg: E2EConfig
): Promise<EndpointTestResult> {
  const url = `${baseUrl}${endpoint}`;
  const response = await fetchWithRetry(url);

  const responseTimeMs = parseResponseTime(response.headers.get('X-Response-Time'));
  const routeType = getRouteType(endpoint);
  const cpuLimitMs = getCpuLimit(routeType, cfg);

  // Get a preview of the body
  const bodyText = await response.text();
  const bodyPreview = bodyText.substring(0, 200) + (bodyText.length > 200 ? '...' : '');

  return {
    url,
    status: response.status,
    responseTimeMs,
    contentType: response.headers.get('Content-Type'),
    bodyPreview,
    cpuLimitMs,
    withinCpuLimit: responseTimeMs !== null && responseTimeMs <= cpuLimitMs,
  };
}

// Skip all E2E tests if SKIP_E2E is set
const describeE2E = e2eConfig.skipE2E ? describe.skip : describe;

describeE2E('Deployed Worker E2E Tests', () => {
  beforeAll(() => {
    console.log(`E2E Test Configuration:`);
    console.log(`  Base URL: ${e2eConfig.baseUrl}`);
    console.log(`  Request Timeout: ${e2eConfig.requestTimeoutMs}ms`);
    console.log(`  Retries: ${e2eConfig.retries}`);
    console.log(`  CPU Limit (Worker): ${e2eConfig.cpuLimitWorkerMs}ms`);
    console.log(`  CPU Limit (Snippet): ${e2eConfig.cpuLimitSnippetMs}ms`);
  });

  // ==========================================================================
  // Health Check
  // ==========================================================================

  describe('Health Check', () => {
    it('should return healthy status from /health', async () => {
      const url = `${e2eConfig.baseUrl}/health`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('status', 'healthy');
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('timestamp');
    });

    it('should include X-Response-Time header', async () => {
      const url = `${e2eConfig.baseUrl}/health`;
      const response = await fetchWithRetry(url);

      const responseTime = response.headers.get('X-Response-Time');
      expect(responseTime).toBeDefined();
      expect(responseTime).not.toBeNull();

      const timeMs = parseResponseTime(responseTime);
      expect(timeMs).not.toBeNull();
      expect(timeMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Small Articles Tests
  // ==========================================================================

  describe('Small Articles', () => {
    for (const title of TEST_ARTICLES.small) {
      describe(`Article: ${title}`, () => {
        it(`GET /${title} should return 200 with response time under ${CPU_LIMITS.WORKER_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.title(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitWorkerMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms for ${result.url}`
          );
        });

        it(`GET /${title}.json should return 200 with valid JSON and response time under ${CPU_LIMITS.WORKER_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.json(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.contentType).toContain('application/json');
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitWorkerMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms for ${result.url}`
          );
        });

        it(`GET /${title}/summary should return 200 with response time under ${CPU_LIMITS.SNIPPET_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.summary(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitSnippetMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitSnippetMs}ms for ${result.url}`
          );
        });

        it(`GET /${title}/infobox should return 200 with response time under ${CPU_LIMITS.SNIPPET_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.infobox(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitSnippetMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitSnippetMs}ms for ${result.url}`
          );
        });
      });
    }
  });

  // ==========================================================================
  // Medium Articles Tests
  // ==========================================================================

  describe('Medium Articles', () => {
    for (const title of TEST_ARTICLES.medium) {
      describe(`Article: ${title}`, () => {
        it(`GET /${title} should return 200 with response time under ${CPU_LIMITS.WORKER_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.title(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitWorkerMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms for ${result.url}`
          );
        });

        it(`GET /${title}.json should return 200 with valid JSON and response time under ${CPU_LIMITS.WORKER_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.json(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.contentType).toContain('application/json');
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitWorkerMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms for ${result.url}`
          );
        });

        it(`GET /${title}/summary should return 200 with response time under ${CPU_LIMITS.SNIPPET_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.summary(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitSnippetMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitSnippetMs}ms for ${result.url}`
          );
        });

        it(`GET /${title}/infobox should return 200 with response time under ${CPU_LIMITS.SNIPPET_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.infobox(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitSnippetMs,
            `Response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitSnippetMs}ms for ${result.url}`
          );
        });
      });
    }
  });

  // ==========================================================================
  // Large Articles Tests (Critical for CPU limit validation)
  // ==========================================================================

  describe('Large Articles (CPU Stress Test)', () => {
    for (const title of TEST_ARTICLES.large) {
      describe(`Article: ${title}`, () => {
        it(`GET /${title} should return 200 with response time under ${CPU_LIMITS.WORKER_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.title(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitWorkerMs,
            `CRITICAL: Large article response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms for ${result.url}. This may cause production failures.`
          );
        });

        it(`GET /${title}.json should return 200 with valid JSON and response time under ${CPU_LIMITS.WORKER_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.json(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.contentType).toContain('application/json');
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitWorkerMs,
            `CRITICAL: Large article response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms for ${result.url}. This may cause production failures.`
          );
        });

        it(`GET /${title}/summary should return 200 with response time under ${CPU_LIMITS.SNIPPET_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.summary(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitSnippetMs,
            `CRITICAL: Large article summary response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitSnippetMs}ms for ${result.url}. This may cause production failures.`
          );
        });

        it(`GET /${title}/infobox should return 200 with response time under ${CPU_LIMITS.SNIPPET_MS}ms`, async () => {
          const endpoint = TEST_ENDPOINTS.infobox(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.responseTimeMs).not.toBeNull();
          expect(result.responseTimeMs).toBeLessThanOrEqual(
            e2eConfig.cpuLimitSnippetMs,
            `CRITICAL: Large article infobox response time ${result.responseTimeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitSnippetMs}ms for ${result.url}. This may cause production failures.`
          );
        });
      });
    }
  });

  // ==========================================================================
  // API Endpoints Tests
  // ==========================================================================

  describe('API Endpoints', () => {
    it('GET /api/articles should return 200', async () => {
      const url = `${e2eConfig.baseUrl}/api/articles`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
    });

    it('GET /api/types should return 200', async () => {
      const url = `${e2eConfig.baseUrl}/api/types`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('types');
    });

    it('GET /api/search?q=test should return 200', async () => {
      const url = `${e2eConfig.baseUrl}/api/search?q=test`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('query');
      expect(data).toHaveProperty('results');
    });
  });

  // ==========================================================================
  // Response Headers Tests
  // ==========================================================================

  describe('Response Headers', () => {
    it('should include CORS headers', async () => {
      const url = `${e2eConfig.baseUrl}/health`;
      const response = await fetchWithRetry(url);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });

    it('should include X-Response-Time header on all routes', async () => {
      const testUrls = [
        `${e2eConfig.baseUrl}/health`,
        `${e2eConfig.baseUrl}/api/articles`,
        `${e2eConfig.baseUrl}/${TEST_ARTICLES.small[0]}`,
      ];

      for (const url of testUrls) {
        const response = await fetchWithRetry(url);
        const responseTime = response.headers.get('X-Response-Time');
        expect(responseTime).not.toBeNull();
        expect(parseResponseTime(responseTime)).not.toBeNull();
      }
    });

    it('should include proper Content-Type headers', async () => {
      // JSON endpoints
      const jsonUrl = `${e2eConfig.baseUrl}/${TEST_ARTICLES.small[0]}.json`;
      const jsonResponse = await fetchWithRetry(jsonUrl);
      expect(jsonResponse.headers.get('Content-Type')).toContain('application/json');

      // API endpoints
      const apiUrl = `${e2eConfig.baseUrl}/api/articles`;
      const apiResponse = await fetchWithRetry(apiUrl);
      expect(apiResponse.headers.get('Content-Type')).toContain('application/json');
    });
  });

  // ==========================================================================
  // Error Handling Tests
  // ==========================================================================

  describe('Error Handling', () => {
    it('should return 404 for non-existent articles', async () => {
      const url = `${e2eConfig.baseUrl}/This_Article_Does_Not_Exist_12345`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(404);
    });

    it('should return 404 for non-existent API routes', async () => {
      const url = `${e2eConfig.baseUrl}/api/nonexistent`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(404);
    });
  });

  // ==========================================================================
  // Performance Summary Test
  // ==========================================================================

  describe('Performance Summary', () => {
    it('should log performance metrics for all test articles', async () => {
      const results: Array<{
        title: string;
        size: string;
        endpoint: string;
        responseTimeMs: number | null;
        cpuLimitMs: number;
        passed: boolean;
      }> = [];

      const allArticles = [
        ...TEST_ARTICLES.small.map((t) => ({ title: t, size: 'small' })),
        ...TEST_ARTICLES.medium.map((t) => ({ title: t, size: 'medium' })),
        ...TEST_ARTICLES.large.map((t) => ({ title: t, size: 'large' })),
      ];

      for (const { title, size } of allArticles) {
        for (const [endpointName, endpointFn] of Object.entries(TEST_ENDPOINTS)) {
          const endpoint = endpointFn(title);
          try {
            const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);
            results.push({
              title,
              size,
              endpoint: endpointName,
              responseTimeMs: result.responseTimeMs,
              cpuLimitMs: result.cpuLimitMs,
              passed: result.withinCpuLimit,
            });
          } catch (error) {
            results.push({
              title,
              size,
              endpoint: endpointName,
              responseTimeMs: null,
              cpuLimitMs: getCpuLimit(getRouteType(endpoint), e2eConfig),
              passed: false,
            });
          }
        }
      }

      // Log summary
      console.log('\n=== E2E Performance Summary ===\n');
      console.log('Article Size | Article | Endpoint | Response Time | CPU Limit | Status');
      console.log('-------------|---------|----------|---------------|-----------|-------');

      for (const r of results) {
        const status = r.passed ? 'PASS' : 'FAIL';
        const timeStr = r.responseTimeMs !== null ? `${r.responseTimeMs}ms` : 'N/A';
        console.log(
          `${r.size.padEnd(12)} | ${r.title.padEnd(7)} | ${r.endpoint.padEnd(8)} | ${timeStr.padStart(13)} | ${String(r.cpuLimitMs + 'ms').padStart(9)} | ${status}`
        );
      }

      const passed = results.filter((r) => r.passed).length;
      const failed = results.filter((r) => !r.passed).length;

      console.log(`\nTotal: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
      console.log('===============================\n');

      // Assert no failures in summary test
      expect(failed).toBe(0);
    });
  });
});

// ==========================================================================
// Configuration Validation Tests (always run)
// ==========================================================================

describe('E2E Config Validation', () => {
  it('should load valid configuration', () => {
    const cfg = loadE2EConfig();

    expect(cfg.baseUrl).toBeDefined();
    expect(cfg.baseUrl).toMatch(/^https?:\/\//);
    expect(cfg.requestTimeoutMs).toBeGreaterThan(0);
    expect(cfg.retries).toBeGreaterThanOrEqual(0);
    expect(cfg.cpuLimitWorkerMs).toBeGreaterThan(0);
    expect(cfg.cpuLimitSnippetMs).toBeGreaterThan(0);
  });

  it('should parse response time header correctly', () => {
    expect(parseResponseTime('10ms')).toBe(10);
    expect(parseResponseTime('10.5ms')).toBe(10.5);
    expect(parseResponseTime('10')).toBe(10);
    expect(parseResponseTime('0ms')).toBe(0);
    expect(parseResponseTime(null)).toBeNull();
    expect(parseResponseTime('')).toBeNull();
    expect(parseResponseTime('invalid')).toBeNull();
  });

  it('should correctly identify route types', () => {
    expect(getRouteType('/Cat')).toBe('worker');
    expect(getRouteType('/Cat.json')).toBe('worker');
    expect(getRouteType('/Cat/summary')).toBe('snippet');
    expect(getRouteType('/Cat/infobox')).toBe('snippet');
  });

  it('should return correct CPU limits for route types', () => {
    const cfg = loadE2EConfig();

    expect(getCpuLimit('worker', cfg)).toBe(cfg.cpuLimitWorkerMs);
    expect(getCpuLimit('snippet', cfg)).toBe(cfg.cpuLimitSnippetMs);
  });
});
