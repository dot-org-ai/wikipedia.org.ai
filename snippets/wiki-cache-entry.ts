/**
 * Wiki Cache Entry Snippet
 *
 * Lightweight outer layer for wiki.org.ai that handles:
 * - Cache API for response caching
 * - Proxies cache misses to inner worker (wiki-parser)
 * - Logs errors when inner worker crashes
 * - Tracks basic analytics (request count, cache hit/miss, latency)
 *
 * MUST stay under 5ms CPU time - no heavy parsing!
 */

const INNER_WORKER_URL = 'https://wiki-parser.workers.do'

interface Env {
  // No bindings needed - uses Cache API only
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startTime = Date.now()
    const url = new URL(request.url)

    // Only cache GET requests
    if (request.method !== 'GET') {
      return proxyToInner(request, startTime)
    }

    // Create cache key from URL
    const cacheKey = new Request(url.toString(), request)
    const cache = caches.default

    // Check cache first
    let response = await cache.match(cacheKey)

    if (response) {
      // Cache HIT - clone and add cache status header
      const headers = new Headers(response.headers)
      headers.set('X-Cache', 'HIT')
      headers.set('X-Latency-Ms', String(Date.now() - startTime))

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      })
    }

    // Cache MISS - proxy to inner worker
    response = await proxyToInner(request, startTime)

    // Cache successful responses (2xx status)
    if (response.ok) {
      const responseToCache = response.clone()
      const headers = new Headers(responseToCache.headers)
      headers.set('Cache-Control', 'public, max-age=3600') // 1 hour

      const cacheable = new Response(responseToCache.body, {
        status: responseToCache.status,
        statusText: responseToCache.statusText,
        headers
      })

      ctx.waitUntil(cache.put(cacheKey, cacheable))
    }

    // Add cache status to response
    const finalHeaders = new Headers(response.headers)
    finalHeaders.set('X-Cache', 'MISS')
    finalHeaders.set('X-Latency-Ms', String(Date.now() - startTime))

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: finalHeaders
    })
  }
}

async function proxyToInner(request: Request, startTime: number): Promise<Response> {
  const url = new URL(request.url)
  const innerUrl = `${INNER_WORKER_URL}${url.pathname}${url.search}`

  try {
    const response = await fetch(innerUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD'
        ? request.body
        : undefined
    })

    return response
  } catch (error) {
    // Log error for observability (appears in Cloudflare logs)
    console.error('[wiki-cache] Inner worker error:', {
      url: url.pathname,
      error: error instanceof Error ? error.message : 'Unknown error',
      latencyMs: Date.now() - startTime
    })

    return new Response(
      JSON.stringify({ error: 'Service temporarily unavailable' }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'ERROR',
          'X-Latency-Ms': String(Date.now() - startTime)
        }
      }
    )
  }
}
