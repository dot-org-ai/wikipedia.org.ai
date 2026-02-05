/**
 * Minimal Wikipedia API Snippet (<32KB)
 *
 * Uses Wikipedia's REST and Action APIs directly where possible.
 * Includes minimal infobox parsing for /infobox endpoint.
 *
 * Endpoints:
 *   /Title/summary -> Wikipedia REST API (0ms parse)
 *   /Title/links -> Wikipedia Action API (0ms parse)
 *   /Title/categories -> Wikipedia Action API (0ms parse)
 *   /Title/infobox -> Fetch wikitext + parse infobox (~3-5ms)
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
// Infobox Parser (Minimal)
// ============================================================================

interface Infobox {
  type: string
  data: Record<string, string>
}

async function fetchWikitext(title: string, lang: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'revisions',
      rvprop: 'content',
      rvslots: 'main',
      format: 'json',
      formatversion: '2'
    })

    const url = `https://${lang}.wikipedia.org/w/api.php?${params}`
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!res.ok) return null

    const data = await res.json()
    const page = data.query?.pages?.[0]
    return page?.revisions?.[0]?.slots?.main?.content || null
  } catch {
    return null
  }
}

function parseInfoboxes(wiki: string): Infobox[] {
  const infoboxes: Infobox[] = []

  // Find all {{Infobox ...}} templates
  let depth = 0
  let start = -1

  for (let i = 0; i < wiki.length - 1; i++) {
    if (wiki.charCodeAt(i) === 123 && wiki.charCodeAt(i + 1) === 123) { // {{
      if (depth === 0) start = i
      depth++
      i++
    } else if (wiki.charCodeAt(i) === 125 && wiki.charCodeAt(i + 1) === 125) { // }}
      depth--
      if (depth === 0 && start >= 0) {
        const tmpl = wiki.slice(start + 2, i)

        // Check if it's an infobox
        const firstLine = tmpl.split(/[|\n]/)[0].trim().toLowerCase()
        if (firstLine.startsWith('infobox') || firstLine.includes(' infobox')) {
          const infobox = parseInfoboxContent(tmpl)
          if (infobox) infoboxes.push(infobox)
        }
        start = -1
      }
      i++
    }
  }

  return infoboxes
}

function parseInfoboxContent(tmpl: string): Infobox | null {
  const lines = tmpl.split('\n')
  const firstLine = lines[0].trim()

  // Extract type from first line
  let type = firstLine.replace(/^infobox\s*/i, '').trim()

  // Parse key-value pairs
  const data: Record<string, string> = {}
  let currentKey = ''
  let currentValue = ''
  let depth = 0

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]

    // Track nested templates/links
    for (const c of line) {
      if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') depth--
    }

    // New parameter at depth 0
    if (depth <= 0 && line.trim().startsWith('|')) {
      // Save previous
      if (currentKey) {
        data[currentKey] = cleanValue(currentValue)
      }

      // Parse new key=value
      const match = line.match(/^\s*\|\s*([^=]+?)\s*=\s*(.*)$/)
      if (match) {
        currentKey = match[1].trim().toLowerCase()
        currentValue = match[2]
      } else {
        currentKey = ''
        currentValue = ''
      }
      depth = 0
    } else if (currentKey) {
      // Continue current value
      currentValue += '\n' + line
    }
  }

  // Save last
  if (currentKey) {
    data[currentKey] = cleanValue(currentValue)
  }

  return { type, data }
}

function cleanValue(val: string): string {
  return val
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1') // [[Link|Text]] -> Text
    .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
    .replace(/<[^>]+>/g, '') // Remove HTML
    .replace(/'{2,}/g, '') // Remove bold/italic
    .replace(/\s+/g, ' ')
    .trim()
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

async function handleInfobox(title: string, lang: string): Promise<Response> {
  const wikitext = await fetchWikitext(title, lang)

  if (!wikitext) {
    return json({ error: `Article not found: ${title}` }, 404)
  }

  const infoboxes = parseInfoboxes(wikitext)

  return json({
    title,
    infoboxes
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
          '/Title/infobox': 'Get article infobox data',
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
      case 'infobox':
        return handleInfobox(title, lang)
      default:
        // Default to summary for unknown endpoints
        return handleSummary(title, lang)
    }
  }
}
