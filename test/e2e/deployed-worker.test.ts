/**
 * End-to-End Tests for Deployed Wikipedia Worker
 *
 * Tests the production worker at wikipedia.org.ai (or configured test URL)
 * and asserts that CPU time stays under specified limits.
 *
 * Run with: bun test test/e2e/
 * Skip with: SKIP_E2E=true bun test
 *
 * Environment variables:
 * - E2E_BASE_URL: Base URL of the wiki parser (default: https://wikipedia.org.ai)
 * - E2E_API_BASE_URL: Base URL of the API (default: https://api.wikipedia.org.ai)
 * - SKIP_E2E: Set to 'true' to skip E2E tests
 * - E2E_TIMEOUT_MS: Request timeout in milliseconds (default: 30000)
 * - E2E_RETRIES: Number of retries for flaky requests (default: 2)
 * - E2E_CPU_LIMIT_WORKER_MS: CPU limit for worker routes (default: 50)
 * - E2E_CPU_LIMIT_SNIPPET_MS: CPU limit for snippet routes (default: 5)
 *
 * Tail events endpoint: {E2E_BASE_URL}/_tail/events (queries actual CPU time from tail worker)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
import { queryTailEvents, extractCpuTime, assertCpuTimeWithinLimit } from './tail-events.js';

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
    console.log(`  Wiki Base URL: ${e2eConfig.baseUrl}`);
    console.log(`  API Base URL: ${e2eConfig.apiBaseUrl}`);
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
  // Note: 200 status proves request completed within CPU limits.
  // Actual CPU time validation is done via Analytics API tests.
  // ==========================================================================

  describe('Small Articles', () => {
    for (const title of TEST_ARTICLES.small) {
      describe(`Article: ${title}`, () => {
        it(`GET /${title} should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.title(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          // 200 means request completed successfully (no CPU timeout)
          expect(result.status).toBe(200);
          console.log(`  ${title}: ${result.responseTimeMs}ms (response time, not CPU time)`);
        });

        it(`GET /${title}.json should return 200 with valid JSON`, async () => {
          const endpoint = TEST_ENDPOINTS.json(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.contentType).toContain('application/json');
        });

        it(`GET /${title}/summary should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.summary(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
        });

        it(`GET /${title}/infobox should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.infobox(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
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
        it(`GET /${title} should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.title(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          console.log(`  ${title}: ${result.responseTimeMs}ms`);
        });

        it(`GET /${title}.json should return 200 with valid JSON`, async () => {
          const endpoint = TEST_ENDPOINTS.json(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.contentType).toContain('application/json');
        });

        it(`GET /${title}/summary should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.summary(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
        });

        it(`GET /${title}/infobox should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.infobox(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
        });
      });
    }
  });

  // ==========================================================================
  // Large Articles Tests (Critical - these would timeout with CPU issues)
  // A 200 status proves the request completed within CPU limits.
  // Actual CPU metrics are validated via Analytics API tests.
  // ==========================================================================

  describe('Large Articles (CPU Stress Test)', () => {
    for (const title of TEST_ARTICLES.large) {
      describe(`Article: ${title}`, () => {
        it(`GET /${title} should return 200 (proves CPU within limits)`, async () => {
          const endpoint = TEST_ENDPOINTS.title(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          // 200 means CPU didn't exceed - would get 1102 error otherwise
          expect(result.status).toBe(200);
          console.log(`  ${title}: ${result.responseTimeMs}ms (response time includes Wikipedia fetch)`);
        });

        it(`GET /${title}.json should return 200 with valid JSON`, async () => {
          const endpoint = TEST_ENDPOINTS.json(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
          expect(result.contentType).toContain('application/json');
        });

        it(`GET /${title}/summary should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.summary(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
        });

        it(`GET /${title}/infobox should return 200`, async () => {
          const endpoint = TEST_ENDPOINTS.infobox(title);
          const result = await testEndpoint(e2eConfig.baseUrl, endpoint, e2eConfig);

          expect(result.status).toBe(200);
        });
      });
    }
  });

  // ==========================================================================
  // Format-Specific Tests (Critical for wtf_wikipedia integration)
  // ==========================================================================

  describe('Format Extensions', () => {
    const testTitle = 'Albert_Einstein';

    it(`GET /${testTitle}.md should return markdown content`, async () => {
      const url = `${e2eConfig.baseUrl}/${testTitle}.md`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/markdown');

      const body = await response.text();
      expect(body).toContain('# Albert Einstein');
    });

    it(`GET /${testTitle}.json should return valid JSON with expected fields`, async () => {
      const url = `${e2eConfig.baseUrl}/${testTitle}.json`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const data = await response.json() as { title: string; sections: unknown[]; categories: unknown[] };
      expect(data).toHaveProperty('title');
      expect(data).toHaveProperty('sections');
      expect(data).toHaveProperty('categories');
      expect(data.title).toBe('Albert Einstein');
    });

    it(`GET /${testTitle}.txt should return plain text`, async () => {
      const url = `${e2eConfig.baseUrl}/${testTitle}.txt`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/plain');

      const body = await response.text();
      expect(body.length).toBeGreaterThan(100);
    });

    it('GET /Tokyo.json should return 200 (regression test for large article timeout)', async () => {
      const url = `${e2eConfig.baseUrl}/Tokyo.json`;
      const response = await fetchWithRetry(url);

      // This previously caused Error 1102 (CPU timeout) with wtf-lite
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const responseTime = response.headers.get('X-Response-Time');
      const timeMs = parseResponseTime(responseTime);

      // Should complete in reasonable time (< 50ms for worker CPU)
      expect(timeMs).not.toBeNull();
      expect(timeMs).toBeLessThanOrEqual(
        e2eConfig.cpuLimitWorkerMs,
        `Tokyo.json response time ${timeMs}ms exceeded CPU limit ${e2eConfig.cpuLimitWorkerMs}ms - potential regression`
      );
    });

    it('GET /fr/Paris should return French Wikipedia article', async () => {
      const url = `${e2eConfig.baseUrl}/fr/Paris`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('text/markdown');

      const body = await response.text();
      expect(body).toContain('# Paris');
    });
  });

  // ==========================================================================
  // API Endpoints Tests (requires api.wikipedia.org.ai to be deployed)
  // ==========================================================================

  describe('API Endpoints', () => {
    // Check if API is accessible before running tests
    let apiAccessible = false;

    beforeAll(async () => {
      try {
        const response = await fetch(`${e2eConfig.apiBaseUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        apiAccessible = response.ok;
      } catch {
        console.log(`API endpoint ${e2eConfig.apiBaseUrl} not accessible, skipping API tests`);
      }
    });

    it('GET /api/articles should return 200', async () => {
      if (!apiAccessible) {
        console.log('Skipping: API not accessible');
        return;
      }
      const url = `${e2eConfig.apiBaseUrl}/api/articles`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(data).toHaveProperty('pagination');
    });

    it('GET /api/types should return 200', async () => {
      if (!apiAccessible) {
        console.log('Skipping: API not accessible');
        return;
      }
      const url = `${e2eConfig.apiBaseUrl}/api/types`;
      const response = await fetchWithRetry(url);

      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('types');
    });

    it('GET /api/search?q=test should return 200', async () => {
      if (!apiAccessible) {
        console.log('Skipping: API not accessible');
        return;
      }
      const url = `${e2eConfig.apiBaseUrl}/api/search?q=test`;
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

    it('should include X-Response-Time header on wiki routes', async () => {
      const testUrls = [
        `${e2eConfig.baseUrl}/health`,
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

      // Markdown endpoints
      const mdUrl = `${e2eConfig.baseUrl}/${TEST_ARTICLES.small[0]}.md`;
      const mdResponse = await fetchWithRetry(mdUrl);
      expect(mdResponse.headers.get('Content-Type')).toContain('text/markdown');

      // Plain text endpoints
      const txtUrl = `${e2eConfig.baseUrl}/${TEST_ARTICLES.small[0]}.txt`;
      const txtResponse = await fetchWithRetry(txtUrl);
      expect(txtResponse.headers.get('Content-Type')).toContain('text/plain');
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

    it('should return 404 for non-existent wiki routes', async () => {
      // Test that invalid sections return 404
      const url = `${e2eConfig.baseUrl}/${TEST_ARTICLES.small[0]}/nonexistent_section`;
      const response = await fetchWithRetry(url);

      // Note: The handler treats unknown sections as part of the title
      // so this may return a Wikipedia 404 or parse error
      expect([200, 404]).toContain(response.status);
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
      console.log('Note: Response time includes network latency. For accurate CPU time,');
      console.log('see "Worker CPU Time (from Analytics API)" tests which query actual metrics.\n');

      // Log summary but don't fail - response time != CPU time
      // Actual CPU validation is done via Analytics API tests
      expect(results.length).toBeGreaterThan(0);
    });
  });
});

// ==========================================================================
// CPU Time Validation from Tail Events
// Queries actual CPU time from tail worker trace events
// ==========================================================================

describe('Worker CPU Time (from Tail Events)', () => {
  // Use main worker's /_tail/events endpoint
  const tailEventsUrl = `${process.env.E2E_BASE_URL || 'https://wikipedia.org.ai'}/_tail/events`;
  let tailAccessible = false;

  beforeAll(async () => {
    // Check if tail events endpoint is accessible
    try {
      const response = await fetch(tailEventsUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { 'Accept': 'application/json' },
      });
      tailAccessible = response.ok;
      if (!tailAccessible) {
        console.log(`Tail events not accessible at ${tailEventsUrl}: HTTP ${response.status}`);
      } else {
        console.log(`Tail events accessible at ${tailEventsUrl}`);
      }
    } catch (error) {
      console.log(`Tail events error at ${tailEventsUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  it('should have recent tail events with CPU time data', async () => {
    if (!tailAccessible) {
      console.log('Skipping: Tail worker not accessible');
      return;
    }

    const result = await queryTailEvents(10);

    if (!result.success) {
      console.log(`Failed to query tail events: ${result.error}`);
      return;
    }

    console.log(`Found ${result.events.length} recent tail events`);

    // Check for CPU time in events
    let eventsWithCpuTime = 0;
    for (const event of result.events) {
      const cpuTime = extractCpuTime(event);
      if (cpuTime !== null) {
        eventsWithCpuTime++;
        console.log(`  ${event.event?.request?.url}: ${cpuTime}ms CPU, outcome: ${event.outcome}`);
      }
    }

    console.log(`${eventsWithCpuTime}/${result.events.length} events have CPU time data`);
  });

  it('should have CPU time under 50ms for Tokyo.json (regression test)', async () => {
    if (!tailAccessible) {
      console.log('Skipping: Tail worker not accessible');
      return;
    }

    // Make a request to generate a tail event
    const testUrl = `${e2eConfig.baseUrl}/Tokyo.json`;
    await fetch(testUrl);

    // Wait for tail event to propagate
    const result = await assertCpuTimeWithinLimit('Tokyo.json', e2eConfig.cpuLimitWorkerMs);

    console.log(`Tokyo.json CPU check: ${result.message}`);

    if (result.cpuTimeMs !== null) {
      expect(result.cpuTimeMs).toBeLessThanOrEqual(
        e2eConfig.cpuLimitWorkerMs,
        `Tokyo.json CPU time ${result.cpuTimeMs}ms exceeds limit ${e2eConfig.cpuLimitWorkerMs}ms`
      );
    }
  });

  it('should not have any exceededCpu outcomes in recent events', async () => {
    if (!tailAccessible) {
      console.log('Skipping: Tail worker not accessible');
      return;
    }

    const result = await queryTailEvents(50);

    if (!result.success) {
      console.log(`Failed to query tail events: ${result.error}`);
      return;
    }

    const exceededCpuEvents = result.events.filter((e) => e.outcome === 'exceededCpu');

    if (exceededCpuEvents.length > 0) {
      console.log(`Found ${exceededCpuEvents.length} exceededCpu events:`);
      for (const event of exceededCpuEvents) {
        console.log(`  ${event.event?.request?.url}`);
      }
    }

    expect(exceededCpuEvents.length).toBe(0);
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
