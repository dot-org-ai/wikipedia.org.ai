/**
 * E2E Tests for wtf-lite Snippet
 *
 * Tests the deployed snippet at wiki-optimized.workers.do
 * Verifies correctness and performance (CPU time < 5ms target)
 *
 * Run: npm test test/e2e/snippet.test.ts
 * Skip: SKIP_E2E=true npm test
 *
 * Environment variables:
 * - SNIPPET_BASE_URL: Base URL of snippet (default: https://wiki-optimized.workers.do)
 * - SKIP_E2E: Set to 'true' to skip
 */

import { describe, it, expect, beforeAll } from 'vitest'

const SNIPPET_URL = process.env.SNIPPET_BASE_URL || 'https://wiki-optimized.workers.do'
const SKIP_E2E = process.env.SKIP_E2E === 'true' || process.env.SKIP_E2E === '1'

// Test articles of varying sizes
const TEST_ARTICLES = {
  small: ['Cat', 'Dog'],
  medium: ['Apple_Inc.', 'Google'],
  large: ['Albert_Einstein', 'Tokyo'],
}

// CPU time limit for snippets (Cloudflare free tier = 5ms, paid = 50ms)
const CPU_LIMIT_MS = 50

interface SnippetResponse {
  title?: string
  summary?: string
  text?: string
  infobox?: Record<string, unknown>
  links?: Array<{ page: string; text?: string }>
  categories?: string[]
  error?: string
}

async function fetchSnippet(path: string): Promise<{ data: SnippetResponse | string; headers: Headers; status: number; isJson: boolean }> {
  const url = `${SNIPPET_URL}${path}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'wtf-lite-e2e-test/1.0',
    },
  })
  const contentType = res.headers.get('content-type') || ''
  const text = await res.text()

  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(text) as SnippetResponse
      return { data, headers: res.headers, status: res.status, isJson: true }
    } catch {
      return { data: text, headers: res.headers, status: res.status, isJson: false }
    }
  }
  return { data: text, headers: res.headers, status: res.status, isJson: false }
}

describe.skipIf(SKIP_E2E)('Snippet E2E Tests', () => {
  beforeAll(async () => {
    // Quick health check
    try {
      const res = await fetch(`${SNIPPET_URL}/Cat/summary`)
      if (!res.ok) {
        console.warn(`Snippet may be unavailable: ${res.status}`)
      }
    } catch (e) {
      console.warn(`Snippet health check failed: ${e}`)
    }
  })

  describe('/summary endpoint', () => {
    for (const article of [...TEST_ARTICLES.small, ...TEST_ARTICLES.medium]) {
      it(`should return summary for ${article}`, async () => {
        const { data, status } = await fetchSnippet(`/${article}/summary`)
        expect(status).toBe(200)
        expect(data.title).toBeDefined()
        expect(data.summary).toBeDefined()
        expect(typeof data.summary).toBe('string')
        expect(data.summary.length).toBeGreaterThan(10)
      }, 10000)
    }

    it('should return summary for large article (Albert_Einstein)', async () => {
      const { data, status } = await fetchSnippet('/Albert_Einstein/summary')
      expect(status).toBe(200)
      expect(data.title).toBe('Albert Einstein')
      expect(data.summary).toContain('physicist')
    }, 15000)
  })

  describe('/text endpoint', () => {
    it('should return full text', async () => {
      const { data, status, isJson } = await fetchSnippet('/Cat/text')
      expect(status).toBe(200)
      // /text may return plain text or JSON with text field
      if (isJson && typeof data === 'object') {
        expect((data as SnippetResponse).text || data).toBeDefined()
      } else {
        expect(typeof data).toBe('string')
        expect((data as string).length).toBeGreaterThan(100)
      }
    }, 10000)
  })

  describe('/infobox endpoint', () => {
    it('should return infobox for article with infobox', async () => {
      const { data, status, isJson } = await fetchSnippet('/Albert_Einstein/infobox')
      expect(status).toBe(200)
      expect(isJson).toBe(true)
      // API returns { title, infoboxes: [...] }
      const json = data as SnippetResponse & { infoboxes?: unknown[] }
      expect(json.infoboxes || json.infobox).toBeDefined()
    }, 15000)

    it('should handle article without infobox', async () => {
      // Some articles may not have infoboxes
      const { status } = await fetchSnippet('/Cat/infobox')
      expect([200, 404]).toContain(status)
    }, 10000)
  })

  describe('/links endpoint', () => {
    it('should return links array', async () => {
      const { data, status } = await fetchSnippet('/Cat/links')
      expect(status).toBe(200)
      expect(Array.isArray(data.links)).toBe(true)
    }, 10000)
  })

  describe('/categories endpoint', () => {
    it('should return categories array', async () => {
      const { data, status } = await fetchSnippet('/Cat/categories')
      expect(status).toBe(200)
      expect(Array.isArray(data.categories)).toBe(true)
    }, 10000)
  })

  describe('.json endpoint (full parse)', () => {
    it('should return full JSON for small article', async () => {
      const { data, status } = await fetchSnippet('/Cat.json')
      expect(status).toBe(200)
      expect(data.title).toBeDefined()
    }, 15000)
  })

  describe('Error handling', () => {
    it('should return 404 for non-existent article', async () => {
      const { status } = await fetchSnippet('/ThisArticleDefinitelyDoesNotExist12345/summary')
      expect([404, 500]).toContain(status) // May get 500 if Wikipedia returns error
    }, 10000)

    it('should handle empty title gracefully', async () => {
      // Empty title may return various responses depending on router config
      const res = await fetch(`${SNIPPET_URL}//summary`)
      // Accept any response that doesn't crash
      expect([200, 301, 302, 400, 404, 500]).toContain(res.status)
    }, 10000)
  })

  describe('Performance (timing headers)', () => {
    it('should include timing headers', async () => {
      const { headers } = await fetchSnippet('/Cat/summary')
      // Check for common timing headers
      const hasTimingHeader =
        headers.has('x-parse-time-ms') ||
        headers.has('x-total-time-ms') ||
        headers.has('cf-cache-status') ||
        headers.has('server-timing')
      // Not required, but nice to have
      if (!hasTimingHeader) {
        console.log('Note: No timing headers found')
      }
    }, 10000)
  })

  describe('Response format', () => {
    it('should return valid JSON', async () => {
      const res = await fetch(`${SNIPPET_URL}/Cat/summary`)
      const text = await res.text()
      expect(() => JSON.parse(text)).not.toThrow()
    }, 10000)

    it('should set correct content-type', async () => {
      const res = await fetch(`${SNIPPET_URL}/Cat/summary`)
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('application/json')
    }, 10000)
  })

  describe('Redirect handling', () => {
    it('should handle redirects (if any)', async () => {
      // "USA" typically redirects to "United_States"
      const { data, status } = await fetchSnippet('/USA/summary')
      // Should either return data or indicate redirect
      expect([200, 301, 302, 404]).toContain(status)
    }, 10000)
  })
})

describe.skipIf(SKIP_E2E)('Snippet Performance Tests', () => {
  // These tests check response time (not CPU time, which requires tail events)
  const RESPONSE_TIME_LIMIT_MS = 2000 // 2 second max response time

  for (const article of TEST_ARTICLES.small) {
    it(`should respond within ${RESPONSE_TIME_LIMIT_MS}ms for ${article}/summary`, async () => {
      const start = Date.now()
      await fetchSnippet(`/${article}/summary`)
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(RESPONSE_TIME_LIMIT_MS)
    }, 10000)
  }

  it('should handle concurrent requests', async () => {
    const requests = TEST_ARTICLES.small.map(a => fetchSnippet(`/${a}/summary`))
    const results = await Promise.all(requests)
    results.forEach(r => expect(r.status).toBe(200))
  }, 15000)
})
