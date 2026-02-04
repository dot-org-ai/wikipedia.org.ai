#!/usr/bin/env bun
/**
 * Local testing script for Wikipedia Snippet
 *
 * Tests each endpoint locally before deployment.
 *
 * Usage:
 *   bun run snippets/test.ts
 */

import lookup from './lookup.js';

// Mock environment with test configuration
const env = {
  CF_ACCOUNT_ID: 'test-account-id',
  AI_GATEWAY_ID: 'test-gateway-id',
  R2_BASE_URL: 'https://test-r2.example.com',
};

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

/**
 * Make a test request
 */
async function makeRequest(url: string, method = 'GET') {
  const req = new Request(`https://test.example.com${url}`, { method });
  return lookup.fetch(req, env);
}

/**
 * Test case interface
 */
interface TestCase {
  url: string;
  method?: string;
  expectedStatus?: number;
  name?: string;
}

/**
 * Run test suite
 */
async function test() {
  console.log(`\n${colors.blue}=== Wikipedia Snippet Test Suite ===${colors.reset}\n`);

  const testCases: TestCase[] = [
    // Health check
    {
      name: 'Health check endpoint',
      url: '/health',
      expectedStatus: 200,
    },
    // Types endpoint
    {
      name: 'Types endpoint',
      url: '/types',
      expectedStatus: 200,
    },
    // Lookup endpoints
    {
      name: 'Lookup - valid title',
      url: '/lookup?title=Albert%20Einstein',
      expectedStatus: 200,
    },
    {
      name: 'Lookup - missing parameter',
      url: '/lookup',
      expectedStatus: 400,
    },
    // Search endpoints
    {
      name: 'Search - basic query',
      url: '/search?q=physicist',
      expectedStatus: 200,
    },
    {
      name: 'Search - with k parameter',
      url: '/search?q=science&k=5',
      expectedStatus: 200,
    },
    {
      name: 'Search - missing parameter',
      url: '/search',
      expectedStatus: 400,
    },
    {
      name: 'Search - max k limit',
      url: '/search?q=test&k=200',
      expectedStatus: 200,
    },
    // Metrics endpoint
    {
      name: 'Metrics endpoint',
      url: '/metrics',
      expectedStatus: 200,
    },
    // 404 handling
    {
      name: 'Not found endpoint',
      url: '/notfound',
      expectedStatus: 404,
    },
    // CORS handling
    {
      name: 'OPTIONS request (CORS)',
      url: '/health',
      method: 'OPTIONS',
      expectedStatus: 200,
    },
    // Invalid method
    {
      name: 'Invalid HTTP method (POST)',
      url: '/health',
      method: 'POST',
      expectedStatus: 405,
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const name = testCase.name || testCase.url;
    const method = testCase.method || 'GET';
    const expectedStatus = testCase.expectedStatus || 200;

    try {
      const response = await makeRequest(testCase.url, method);
      const status = response.status;
      const success = status === expectedStatus;

      if (success) {
        console.log(`${colors.green}✓${colors.reset} ${name}`);
        console.log(`  ${method} ${testCase.url} → ${status}`);
        passed++;

        // Log response for inspection
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          try {
            const text = await response.clone().text();
            const data = JSON.parse(text);
            console.log(`  Response: ${JSON.stringify(data, null, 2).split('\n')[0]}...`);
          } catch (e) {
            // Response parsing failed, skip
          }
        }
      } else {
        console.log(`${colors.red}✗${colors.reset} ${name}`);
        console.log(`  ${method} ${testCase.url}`);
        console.log(`  Expected: ${expectedStatus}, Got: ${status}`);
        failed++;
      }

      // Check cache headers
      const cacheControl = response.headers.get('cache-control');
      const hasSecurityHeaders =
        response.headers.has('x-content-type-options') &&
        response.headers.has('x-frame-options') &&
        response.headers.has('access-control-allow-origin');

      if (!hasSecurityHeaders) {
        console.log(`  ${colors.yellow}⚠ Missing security headers${colors.reset}`);
      }

      console.log();
    } catch (error: any) {
      console.log(`${colors.red}✗${colors.reset} ${name}`);
      console.log(`  Error: ${error.message}`);
      console.log();
      failed++;
    }
  }

  // Summary
  console.log(`${colors.blue}=== Test Summary ===${colors.reset}`);
  console.log(`Passed: ${colors.green}${passed}${colors.reset}`);
  console.log(`Failed: ${colors.red}${failed}${colors.reset}`);
  console.log(`Total:  ${passed + failed}\n`);

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Run advanced tests
 */
async function advancedTests() {
  console.log(`\n${colors.blue}=== Advanced Tests ===${colors.reset}\n`);

  // Test CORS headers
  console.log('Testing CORS headers...');
  const req = new Request('https://test.example.com/health');
  const res = await lookup.fetch(req, env);
  const corsOrigin = res.headers.get('access-control-allow-origin');
  const corsMethods = res.headers.get('access-control-allow-methods');

  if (corsOrigin === '*' && corsMethods?.includes('GET')) {
    console.log(`${colors.green}✓ CORS headers correct${colors.reset}`);
  } else {
    console.log(`${colors.red}✗ CORS headers incorrect${colors.reset}`);
  }

  // Test response content types
  console.log('\nTesting content types...');
  const endpoints = ['/health', '/types', '/lookup?title=Test', '/search?q=test', '/metrics'];

  for (const url of endpoints) {
    const res = await makeRequest(url);
    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      console.log(`${colors.green}✓${colors.reset} ${url} → application/json`);
    } else {
      console.log(`${colors.red}✗${colors.reset} ${url} → ${contentType || 'unknown'}`);
    }
  }

  console.log();
}

// Run tests
test().catch(console.error);

// Uncomment to run advanced tests
// advancedTests().catch(console.error);
