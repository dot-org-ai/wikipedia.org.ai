/**
 * Optimized Wiki Parser Snippet for Cloudflare Snippets
 *
 * Production-ready Wikipedia parser using wtf-lite's fast mode:
 * - /Title/summary -> Wikipedia REST API (0ms parse CPU) with wtf-lite fallback
 * - /Title/text -> fastParse() + full text (target: 3ms)
 * - /Title/infobox -> regular parse with lazy options (target: 8ms)
 * - /Title/links -> Wikipedia Action API (0ms parse CPU) with wtf-lite fallback
 * - /Title/categories -> Wikipedia Action API (0ms parse CPU) with wtf-lite fallback
 * - /Title.json -> full parse (may exceed 5ms, that's ok)
 * - /Title -> markdown (cached)
 *
 * Bundle optimization:
 * - Loads wtf-data.json from CDN (not bundled)
 * - Tree-shakeable - only imports what's needed per endpoint
 * - Target: <50KB bundle size
 *
 * Designed to work with wikipedia-25m analytics wrapper.
 */

import {
  fastParse,
  parseInfoboxOnly,
  parseLinksOnly,
  parseCategoriesOnly,
  type FastDocument,
} from '../src/lib/wtf-lite/fast'
import wtf, { loadData, type Document } from '../src/lib/wtf-lite/index'

// CDN URL for extended parsing data (loaded lazily)
const DATA_CDN_URL = 'https://wikipedia-embeddings.r2.dev/wtf-data.json'

// Cache-Control header for successful responses
const CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400'

// CORS headers
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Endpoint types that can use fast parsing (no template/infobox processing)
type FastEndpoint = 'summary' | 'text'
type FullEndpoint = 'infobox' | 'links' | 'categories' | 'references' | 'json' | 'full'

interface ParsedPath {
  title: string
  lang: string
  endpoint: FastEndpoint | FullEndpoint
  format: 'json' | 'md' | 'text'
}

interface WikipediaApiResponse {
  query?: {
    pages?: Array<{
      pageid?: number
      title: string
      missing?: boolean
      revisions?: Array<{
        slots?: {
          main?: {
            content: string
          }
        }
      }>
    }>
  }
}

interface WikipediaSummaryResponse {
  title: string
  displaytitle?: string
  extract: string
  extract_html?: string
  description?: string
  thumbnail?: {
    source: string
    width: number
    height: number
  }
  originalimage?: {
    source: string
    width: number
    height: number
  }
  wikibase_item?: string
  pageid?: number
  lang?: string
  dir?: string
  timestamp?: string
  type?: string
}

interface WikipediaCategoriesResponse {
  query?: {
    pages?: Array<{
      pageid?: number
      title: string
      missing?: boolean
      categories?: Array<{
        ns: number
        title: string
      }>
    }>
  }
}

interface WikipediaLinksApiResponse {
  query?: {
    pages?: Array<{
      pageid?: number
      title: string
      missing?: boolean
      links?: Array<{
        ns: number
        title: string
      }>
    }>
  }
  continue?: {
    plcontinue?: string
    continue?: string
  }
}

// Track whether CDN data has been loaded (memory cached between requests)
let dataLoaded = false

export default {
  async fetch(request: Request): Promise<Response> {
    const startTime = performance.now()
    const url = new URL(request.url)
    const pathname = url.pathname

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    try {
      // POST: Parse raw wikitext
      if (request.method === 'POST') {
        return handlePost(request, startTime)
      }

      // GET /: API info
      if (pathname === '/' || pathname === '') {
        return apiInfo(startTime)
      }

      // GET /health: Health check
      if (pathname === '/health') {
        return healthCheck(startTime)
      }

      // Parse path and route to appropriate handler
      const parsed = parsePath(pathname)

      if (!parsed.title) {
        return errorResponse('Invalid path', 400, startTime)
      }

      // Fetch wikitext from Wikipedia
      const article = await fetchWikitext(parsed.title, parsed.lang)

      if (!article) {
        return errorResponse(`Article not found: ${parsed.title}`, 404, startTime)
      }

      // Route to appropriate handler based on endpoint
      const response = await routeEndpoint(article, parsed, startTime)
      return response

    } catch (error) {
      return errorResponse((error as Error).message, 500, startTime)
    }
  },
}

/**
 * Route to the appropriate endpoint handler
 */
async function routeEndpoint(
  article: { title: string; wikitext: string },
  parsed: ParsedPath,
  startTime: number
): Promise<Response> {
  const { endpoint } = parsed

  // Fast mode endpoints (no template parsing needed)
  if (endpoint === 'summary') {
    return handleSummary(article, parsed.lang, startTime)
  }

  if (endpoint === 'text') {
    return handleText(article, startTime)
  }

  // Full mode endpoints (need template/infobox parsing)
  // Load CDN data for better parsing (lazy load, cached in memory)
  if (!dataLoaded) {
    await loadData(DATA_CDN_URL).catch(() => {})
    dataLoaded = true
  }

  if (endpoint === 'infobox') {
    return handleInfobox(article, startTime)
  }

  if (endpoint === 'links') {
    return handleLinks(article, parsed.lang, startTime)
  }

  if (endpoint === 'categories') {
    return handleCategories(article, parsed.lang, startTime)
  }

  if (endpoint === 'references') {
    return handleReferences(article, startTime)
  }

  if (endpoint === 'json') {
    return handleFullJson(article, startTime)
  }

  // Default: Markdown
  return handleMarkdown(article, startTime)
}

/**
 * Handle POST requests for parsing raw wikitext
 */
async function handlePost(request: Request, startTime: number): Promise<Response> {
  const body = await request.json() as { wikitext?: string; title?: string; mode?: 'fast' | 'full' }

  if (!body.wikitext) {
    return errorResponse('Missing wikitext in request body', 400, startTime)
  }

  // Use fast mode by default for POST, unless 'full' is specified
  if (body.mode !== 'full') {
    const doc = fastParse(body.wikitext, { title: body.title })
    return jsonResponse(doc, startTime, 'fast')
  }

  // Full mode requested
  if (!dataLoaded) {
    await loadData(DATA_CDN_URL).catch(() => {})
    dataLoaded = true
  }

  const doc = wtf(body.wikitext, { title: body.title })
  return jsonResponse(toFullJson(doc), startTime, 'full')
}

/**
 * Fetch pre-computed summary from Wikipedia REST API
 * Returns null if the API fails or article not found
 */
async function fetchWikipediaSummary(
  title: string,
  lang: string
): Promise<WikipediaSummaryResponse | null> {
  const encodedTitle = encodeURIComponent(title.replace(/ /g, '_'))
  const apiUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'wiki.org.ai/1.0 (optimized-snippet)',
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      return null
    }

    return await response.json() as WikipediaSummaryResponse
  } catch {
    return null
  }
}

/**
 * /Title/summary - Use Wikipedia's pre-computed summary endpoint
 * Target: 0ms parsing CPU (summary is pre-computed by Wikipedia)
 *
 * First tries Wikipedia's REST API for pre-computed summaries.
 * Falls back to wtf-lite parsing if the API fails.
 */
async function handleSummary(
  article: { title: string; wikitext: string },
  lang: string,
  requestStart: number
): Promise<Response> {
  // Try Wikipedia's REST API first (0ms parsing CPU)
  const wikiSummary = await fetchWikipediaSummary(article.title, lang)

  if (wikiSummary) {
    const result = {
      title: wikiSummary.title,
      summary: wikiSummary.extract,
      description: wikiSummary.description || null,
      thumbnail: wikiSummary.thumbnail?.source || null,
      wikibase_item: wikiSummary.wikibase_item || null,
      source: 'wikipedia-rest-api',
    }

    return jsonResponse(result, requestStart, 'api', 0)
  }

  // Fallback: Use wtf-lite parsing if REST API fails
  const doc = fastParse(article.wikitext, { title: article.title })

  // Get first 3 sentences from intro section
  const intro = doc.sections[0]?.text || ''
  const sentences = extractSentences(intro, 3)

  const result = {
    title: doc.title || article.title,
    summary: sentences.join(' '),
    description: null,
    thumbnail: null,
    wikibase_item: null,
    isRedirect: doc.isRedirect,
    redirectTo: doc.redirectTo,
    source: 'wtf-lite-fallback',
  }

  return jsonResponse(result, requestStart, 'fast')
}

/**
 * /Title/text - Fast parse, full text
 * Target: 3ms CPU
 */
function handleText(article: { title: string; wikitext: string }, requestStart: number): Response {
  const parseStart = performance.now()
  const doc = fastParse(article.wikitext, { title: article.title })
  const parseTime = performance.now() - parseStart

  return new Response(doc.text, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      ...timingHeaders(requestStart, 'fast', parseTime),
    },
  })
}

/**
 * /Title/infobox - Regular parse, infobox data only
 * Target: 8ms CPU
 */
function handleInfobox(article: { title: string; wikitext: string }, requestStart: number): Response {
  const parseStart = performance.now()
  // Use specialized fast parser for infoboxes
  const result = parseInfoboxOnly(article.wikitext, { title: article.title })
  const parseTime = performance.now() - parseStart

  return jsonResponse({
    title: result.title || article.title,
    infoboxes: result.infoboxes,
    isRedirect: result.isRedirect,
  }, requestStart, 'fast', parseTime)
}

/**
 * /Title/links - Use Wikipedia's Action API for pre-computed links (0ms parse CPU)
 * Falls back to wtf-lite parsing if API fails
 */
async function handleLinks(
  article: { title: string; wikitext: string },
  lang: string,
  requestStart: number
): Promise<Response> {
  // Try Wikipedia's Action API first (0ms parse CPU - pre-computed)
  try {
    const apiLinks = await fetchLinksFromApi(article.title, lang)
    if (apiLinks !== null) {
      // Map to our output format { page, text }
      const links = apiLinks.slice(0, 100).map(link => ({
        page: link.title,
        text: link.title,
      }))

      return jsonResponse({
        title: article.title,
        links,
        totalLinks: apiLinks.length,
        isRedirect: false,
        redirectTo: null,
        source: 'api',
      }, requestStart, 'api', 0)
    }
  } catch {
    // Fall through to parsing fallback
  }

  // Fallback: parse wikitext with wtf-lite
  const parseStart = performance.now()
  const result = parseLinksOnly(article.wikitext, { title: article.title })
  const parseTime = performance.now() - parseStart

  // Limit to first 100 links to keep response size reasonable
  const links = result.links.slice(0, 100)

  return jsonResponse({
    title: result.title || article.title,
    links,
    totalLinks: result.links.length,
    isRedirect: result.isRedirect,
    redirectTo: result.redirectTo,
    source: 'parse',
  }, requestStart, 'fast', parseTime)
}

/**
 * Fetch links from Wikipedia's Action API
 * Returns pre-computed links with 0ms parse CPU
 * Handles pagination (plcontinue) for articles with many links
 */
async function fetchLinksFromApi(
  title: string,
  lang: string
): Promise<Array<{ ns: number; title: string }> | null> {
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`
  const allLinks: Array<{ ns: number; title: string }> = []
  let plcontinue: string | undefined

  // Paginate through results (max 500 per request)
  do {
    const params = new URLSearchParams({
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: '500',
      plnamespace: '0', // Main namespace only (articles)
      format: 'json',
      formatversion: '2',
    })

    if (plcontinue) {
      params.set('plcontinue', plcontinue)
    }

    const response = await fetch(`${apiUrl}?${params}`, {
      headers: { 'User-Agent': 'wiki.org.ai/1.0 (optimized-snippet)' },
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json() as WikipediaLinksApiResponse
    const page = data.query?.pages?.[0]

    if (!page || page.missing) {
      return null
    }

    // Collect links from this page
    if (page.links) {
      allLinks.push(...page.links)
    }

    // Check for continuation
    plcontinue = data.continue?.plcontinue

    // Safety limit: don't fetch more than 2000 links total
    if (allLinks.length >= 2000) {
      break
    }
  } while (plcontinue)

  return allLinks
}

/**
 * /Title/categories - Use Wikipedia's Action API for pre-computed categories (0ms parse CPU)
 * Falls back to wtf-lite parsing if API fails
 */
async function handleCategories(
  article: { title: string; wikitext: string },
  lang: string,
  requestStart: number
): Promise<Response> {
  // Try Wikipedia's Action API first (0ms parse CPU - pre-computed)
  try {
    const categories = await fetchCategoriesFromApi(article.title, lang)
    if (categories !== null) {
      return jsonResponse({
        title: article.title,
        categories,
        source: 'api',
      }, requestStart, 'api', 0)
    }
  } catch {
    // Fall through to parsing fallback
  }

  // Fallback: parse wikitext with wtf-lite
  const parseStart = performance.now()
  const result = parseCategoriesOnly(article.wikitext, { title: article.title })
  const parseTime = performance.now() - parseStart

  return jsonResponse({
    title: result.title || article.title,
    categories: result.categories,
    isRedirect: result.isRedirect,
    source: 'parse',
  }, requestStart, 'fast', parseTime)
}

/**
 * Fetch categories from Wikipedia's Action API
 * Returns pre-computed categories with 0ms parse CPU
 */
async function fetchCategoriesFromApi(
  title: string,
  lang: string
): Promise<string[] | null> {
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'categories',
    cllimit: '500',
    format: 'json',
    formatversion: '2',
  })

  const response = await fetch(`${apiUrl}?${params}`, {
    headers: { 'User-Agent': 'wiki.org.ai/1.0 (optimized-snippet)' },
  })

  if (!response.ok) {
    return null
  }

  const data = await response.json() as WikipediaCategoriesResponse
  const page = data.query?.pages?.[0]

  if (!page || page.missing || !page.categories) {
    return null
  }

  // Strip "Category:" prefix from each category title
  // Handle different language prefixes (e.g., "Category:", "Kategorie:", "Catégorie:")
  return page.categories.map(cat => {
    const colonIndex = cat.title.indexOf(':')
    return colonIndex !== -1 ? cat.title.slice(colonIndex + 1) : cat.title
  })
}

/**
 * /Title/references - Regular parse for references
 */
function handleReferences(article: { title: string; wikitext: string }, requestStart: number): Response {
  const parseStart = performance.now()
  // Use lazy parsing - only need refs, skip infobox/tables
  const doc = wtf(article.wikitext, {
    title: article.title,
    parseInfobox: false,
    parseTables: false,
  })
  const parseTime = performance.now() - parseStart

  const references = doc.references().map(r => r.json())

  return jsonResponse({
    title: doc.title(),
    references,
    totalReferences: references.length,
  }, requestStart, 'full', parseTime)
}

/**
 * /Title.json - Full parse, complete JSON
 * May exceed 5ms for large articles - that's ok
 */
function handleFullJson(article: { title: string; wikitext: string }, requestStart: number): Response {
  const parseStart = performance.now()
  const doc = wtf(article.wikitext, { title: article.title })
  const parseTime = performance.now() - parseStart
  return jsonResponse(toFullJson(doc), requestStart, 'full', parseTime)
}

/**
 * /Title - Markdown output (default)
 */
function handleMarkdown(article: { title: string; wikitext: string }, requestStart: number): Response {
  const parseStart = performance.now()
  // Use fast parse for markdown - templates become text
  const doc = fastParse(article.wikitext, { title: article.title })
  const markdown = toMarkdown(doc)
  const parseTime = performance.now() - parseStart

  return new Response(markdown, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      ...timingHeaders(requestStart, 'fast', parseTime),
    },
  })
}

/**
 * Parse URL path into components
 */
function parsePath(path: string): ParsedPath {
  let p = decodeURIComponent(path.replace(/^\/+/, ''))
  let lang = 'en'
  let endpoint: ParsedPath['endpoint'] = 'full'
  let format: ParsedPath['format'] = 'md'

  // Check for language prefix (2-letter code)
  const langMatch = p.match(/^([a-z]{2})\/(.+)$/)
  if (langMatch) {
    lang = langMatch[1]
    p = langMatch[2]
  }

  // Check for .json extension
  if (p.endsWith('.json')) {
    format = 'json'
    endpoint = 'json'
    p = p.slice(0, -5)
  }

  // Check for endpoint suffix
  const endpoints: (FastEndpoint | FullEndpoint)[] = [
    'summary', 'text', 'infobox', 'links', 'categories', 'references'
  ]
  for (const ep of endpoints) {
    if (p.endsWith('/' + ep)) {
      endpoint = ep
      p = p.slice(0, -(ep.length + 1))
      // summary/text/infobox return JSON by default
      if (['summary', 'infobox', 'links', 'categories', 'references'].includes(ep)) {
        format = 'json'
      } else if (ep === 'text') {
        format = 'text'
      }
      break
    }
  }

  return { title: p, lang, endpoint, format }
}

/**
 * Fetch wikitext from Wikipedia API
 */
async function fetchWikitext(
  title: string,
  lang: string
): Promise<{ title: string; wikitext: string } | null> {
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  })

  const response = await fetch(`${apiUrl}?${params}`, {
    headers: { 'User-Agent': 'wiki.org.ai/1.0 (optimized-snippet)' },
  })

  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status}`)
  }

  const data = await response.json() as WikipediaApiResponse
  const page = data.query?.pages?.[0]

  if (!page || page.missing) {
    return null
  }

  return {
    title: page.title,
    wikitext: page.revisions?.[0]?.slots?.main?.content || '',
  }
}

/**
 * Convert fast-parsed document to Markdown
 */
function toMarkdown(doc: FastDocument): string {
  const lines: string[] = []

  // Title
  lines.push(`# ${doc.title?.replace(/_/g, ' ') || 'Untitled'}`)
  lines.push('')

  // Handle redirect
  if (doc.isRedirect) {
    lines.push(`> Redirects to: [[${doc.redirectTo}]]`)
    return lines.join('\n')
  }

  // First section as intro
  const intro = doc.sections[0]?.text || ''
  if (intro.length > 10) {
    const introSentences = extractSentences(intro, 5)
    lines.push(introSentences.join(' '))
    lines.push('')
  }

  // Rest of sections
  for (const section of doc.sections.slice(1)) {
    if (section.title) {
      const depth = '#'.repeat(Math.min(section.depth + 2, 6))
      lines.push(`${depth} ${section.title}`)
      lines.push('')
    }
    if (section.text) {
      // Truncate very long sections
      lines.push(section.text.slice(0, 3000))
      lines.push('')
    }
  }

  // Categories
  if (doc.categories.length > 0) {
    lines.push('---')
    lines.push(`Categories: ${doc.categories.slice(0, 10).join(', ')}`)
  }

  return lines.join('\n')
}

/**
 * Convert full document to JSON
 */
function toFullJson(doc: Document): object {
  return {
    title: doc.title(),
    isRedirect: doc.isRedirect(),
    redirectTo: doc.redirectTo()?.page?.() || null,
    categories: doc.categories(),
    coordinates: doc.coordinates(),
    images: doc.images().map(i => i.json()),
    sections: doc.sections().map(s => ({
      title: s.title(),
      depth: s.depth(),
      text: s.text().slice(0, 5000), // Truncate for response size
    })),
    infoboxes: doc.infoboxes().map(i => ({
      type: i.type(),
      data: i.keyValue(),
    })),
    links: doc.links().slice(0, 100).map(l => l.json()),
    tables: doc.tables().map(t => t.json()),
    references: doc.references().slice(0, 50).map(r => r.json()),
    templates: doc.templates().slice(0, 50),
  }
}

/**
 * Extract N sentences from text
 */
function extractSentences(text: string, n: number): string[] {
  // Simple sentence extraction using regex
  const sentences: string[] = []
  // Match sentences ending with . ? or ! followed by space or end
  const parts = text.split(/(?<=[.!?])\s+/)

  for (const part of parts) {
    if (sentences.length >= n) break
    const trimmed = part.trim()
    if (trimmed.length > 20) { // Skip very short fragments
      sentences.push(trimmed)
    }
  }

  return sentences
}

/**
 * Create JSON response with timing headers
 */
function jsonResponse(
  data: object,
  startTime: number,
  mode: 'fast' | 'full' | 'api',
  parseTime?: number
): Response {
  return Response.json(data, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CACHE_CONTROL,
      ...timingHeaders(startTime, mode, parseTime),
    },
  })
}

/**
 * Create error response
 */
function errorResponse(message: string, status: number, startTime: number): Response {
  return Response.json({ error: message }, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...timingHeaders(startTime, 'error'),
    },
  })
}

/**
 * Generate timing headers for analytics integration
 */
function timingHeaders(startTime: number, mode: string, parseTime?: number): Record<string, string> {
  const totalTime = (performance.now() - startTime).toFixed(2)
  const parseMs = parseTime?.toFixed(2) || totalTime
  return {
    'X-Parse-Mode': mode,
    'X-Parse-Time-Ms': parseMs,
    'X-Total-Time-Ms': totalTime,
    'Server-Timing': `parse;dur=${parseMs};desc="${mode}",total;dur=${totalTime}`,
  }
}

/**
 * API info response
 */
function apiInfo(startTime: number): Response {
  return jsonResponse({
    name: 'wiki.org.ai',
    version: '2.0-optimized',
    description: 'Wikipedia parser API with fast and full parsing modes',
    endpoints: {
      '/Title': 'Get article as Markdown (fast mode)',
      '/Title.json': 'Get full article as JSON (full mode)',
      '/Title/summary': 'Get summary via Wikipedia REST API (0ms parse CPU)',
      '/Title/text': 'Get plain text (fast mode, 3ms)',
      '/Title/infobox': 'Get infobox data (full mode, 8ms)',
      '/Title/links': 'Get links via Wikipedia API (0ms parse CPU)',
      '/Title/categories': 'Get categories via Wikipedia API (0ms parse CPU)',
      '/Title/references': 'Get references (full mode)',
      '/fr/Paris': 'French Wikipedia article',
      'POST /': 'Parse raw wikitext (mode: fast|full)',
    },
    modes: {
      api: 'Pre-computed data from Wikipedia APIs (0ms parse CPU)',
      fast: 'Text extraction only - no template parsing (2-3ms)',
      full: 'Complete parsing with templates, infoboxes, links (5-15ms)',
    },
    headers: {
      'X-Parse-Mode': 'api, fast, or full',
      'X-Parse-Time-Ms': 'Parse time in milliseconds (0 for api mode)',
      'Server-Timing': 'Standard timing header for analytics',
    },
    caching: {
      'Cache-Control': CACHE_CONTROL,
      note: 'Responses are cached for 1 hour, stale-while-revalidate for 24 hours',
    },
  }, startTime, 'fast')
}

/**
 * Health check endpoint
 */
function healthCheck(startTime: number): Response {
  return jsonResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dataLoaded,
  }, startTime, 'fast')
}
