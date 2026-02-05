/**
 * Minimal Wikipedia API Snippet (<32KB)
 *
 * Uses Wikipedia's REST and Action APIs directly - no parsing needed.
 * Achieves <5ms CPU by delegating all parsing to Wikipedia's servers.
 *
 * Endpoints:
 *   /Title/summary -> Wikipedia REST API (0ms parse)
 *   /Title/links -> Wikipedia Action API (0ms parse)
 *   /Title/categories -> Wikipedia Action API (0ms parse)
 *   /Title -> Redirect to /Title/summary
 */

const USER_AGENT = 'wiki.org.ai/1.0 (snippet)'

// ============================================================================
// Wikipedia API Helpers
// ============================================================================

interface WikiSummary {
  title: string
  extract: string
  description?: string
  thumbnail?: { source: string }
  wikibase_item?: string
}

interface WikiPage {
  title: string
  links?: Array<{ title: string }>
  categories?: Array<{ title: string }>
  missing?: boolean
}

async function fetchSummary(title: string, lang: string): Promise<WikiSummary | null> {
  try {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

async function fetchLinks(title: string, lang: string): Promise<string[]> {
  try {
    const links: string[] = []
    let plcontinue: string | undefined

    for (let i = 0; i < 4 && links.length < 500; i++) {
      const params = new URLSearchParams({
        action: 'query',
        titles: title,
        prop: 'links',
        pllimit: '500',
        plnamespace: '0',
        format: 'json',
        formatversion: '2'
      })
      if (plcontinue) params.set('plcontinue', plcontinue)

      const url = `https://${lang}.wikipedia.org/w/api.php?${params}`
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (!res.ok) break

      const data = await res.json()
      const page = data.query?.pages?.[0] as WikiPage | undefined
      if (page?.links) {
        for (const link of page.links) {
          links.push(link.title)
        }
      }

      plcontinue = data.continue?.plcontinue
      if (!plcontinue) break
    }

    return links
  } catch {
    return []
  }
}

async function fetchCategories(title: string, lang: string): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'categories',
      cllimit: '500',
      format: 'json',
      formatversion: '2'
    })

    const url = `https://${lang}.wikipedia.org/w/api.php?${params}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return []

    const data = await res.json()
    const page = data.query?.pages?.[0] as WikiPage | undefined

    if (!page?.categories) return []

    return page.categories.map(c => {
      // Strip "Category:" prefix in any language
      const title = c.title
      const colonIdx = title.indexOf(':')
      return colonIdx >= 0 ? title.slice(colonIdx + 1) : title
    })
  } catch {
    return []
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

function parsePath(path: string): { lang: string; title: string; endpoint: string } {
  // Remove leading slash
  const parts = path.slice(1).split('/')

  // Check for language code (2-3 chars)
  let lang = 'en'
  let titleIdx = 0

  if (parts[0] && /^[a-z]{2,3}$/.test(parts[0])) {
    lang = parts[0]
    titleIdx = 1
  }

  const title = decodeURIComponent(parts[titleIdx] || '').replace(/_/g, ' ')
  const endpoint = parts[titleIdx + 1] || 'summary'

  return { lang, title, endpoint }
}

async function handleSummary(title: string, lang: string): Promise<Response> {
  const summary = await fetchSummary(title, lang)

  if (!summary) {
    return json({ error: `Article not found: ${title}` }, 404)
  }

  return json({
    title: summary.title,
    summary: summary.extract,
    description: summary.description || null,
    thumbnail: summary.thumbnail?.source || null,
    wikibase_item: summary.wikibase_item || null
  })
}

async function handleLinks(title: string, lang: string): Promise<Response> {
  const links = await fetchLinks(title, lang)

  return json({
    title,
    links: links.map(page => ({ page, text: page })),
    totalLinks: links.length
  })
}

async function handleCategories(title: string, lang: string): Promise<Response> {
  const categories = await fetchCategories(title, lang)

  return json({
    title,
    categories
  })
}

// ============================================================================
// Response Helpers
// ============================================================================

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600'
    }
  })
}

// ============================================================================
// Main Handler
// ============================================================================

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      })
    }

    // Root endpoint - API info
    if (path === '/' || path === '') {
      return json({
        name: 'wiki.org.ai',
        description: 'Wikipedia API (Snippet)',
        endpoints: {
          '/Title/summary': 'Get article summary',
          '/Title/links': 'Get article links',
          '/Title/categories': 'Get article categories',
          '/lang/Title/summary': 'Get article in specific language'
        }
      })
    }

    // Parse the path
    const { lang, title, endpoint } = parsePath(path)

    if (!title) {
      return json({ error: 'Title required' }, 400)
    }

    // Route to handler
    switch (endpoint) {
      case 'summary':
        return handleSummary(title, lang)
      case 'links':
        return handleLinks(title, lang)
      case 'categories':
        return handleCategories(title, lang)
      default:
        // Default to summary for unknown endpoints
        return handleSummary(title, lang)
    }
  }
}
