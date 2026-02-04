/**
 * Wikipedia Parser Cloudflare Snippet
 *
 * DEPRECATED: This snippet has been replaced by src/workers/api/handlers/wiki.ts
 * The main worker now handles wiki.org.ai traffic with 50ms+ CPU limit.
 * The snippet's 5ms CPU limit caused Error 1102 on large articles like Tokyo.
 * See: wikipedia-es7
 *
 * Keeping this file for reference.
 *
 * Routes (now handled by main worker):
 *   /Albert_Einstein         → Markdown (default)
 *   /Albert_Einstein.json    → Full JSON
 *   /Albert_Einstein/summary → Concise summary
 *   /Albert_Einstein/infobox → Infobox data
 *   /Albert_Einstein/links   → Links only
 *   /Albert_Einstein/text    → Plain text
 *   POST / with { wikitext }  → Parse raw wikitext
 */

import wtf, { loadData, Document } from '../src/lib/wtf-lite/index'

const DATA_CDN_URL = 'https://wikipedia-embeddings.r2.dev/wtf-data.json'

// TypeScript interfaces for Wikipedia API responses

/** POST request body for parsing raw wikitext */
interface ParseRequest {
  wikitext?: string
  title?: string
  format?: 'json' | 'md' | 'markdown'
}

/** Wikipedia API query response structure */
interface WikipediaApiResponse {
  query?: {
    pages?: Array<{
      pageid?: number
      ns?: number
      title: string
      missing?: boolean
      revisions?: Array<{
        slots?: {
          main?: {
            content: string
            contentmodel?: string
            contentformat?: string
          }
        }
      }>
    }>
  }
  batchcomplete?: boolean
}

/** Section data in full JSON response */
interface SectionJson {
  title: string | null
  depth: number
  text: string
}

/** Infobox data in full JSON response */
interface InfoboxJson {
  type: string | null
  data: object
}

/** Link data from document */
interface LinkJson {
  text?: string
  page?: string
  type?: string
  site?: string
}

/** Full JSON response from toFullJson */
interface FullJsonResponse {
  title: string | null
  isRedirect: boolean
  redirectTo: string | null
  categories: string[]
  sections: SectionJson[]
  infoboxes: InfoboxJson[]
  links: LinkJson[]
  coordinates: unknown[]
  templates: unknown[]
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Load extended data (fire and forget - no ctx.waitUntil in snippets)
    loadData(DATA_CDN_URL).catch(() => {})

    try {
      // POST: Parse raw wikitext
      if (request.method === 'POST') {
        const body = await request.json() as ParseRequest
        const doc = wtf(body.wikitext || '', { title: body.title || 'Untitled' })
        const format = body.format || 'json'

        if (format === 'md' || format === 'markdown') {
          return new Response(toMarkdown(doc), {
            headers: { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8' }
          })
        }
        return Response.json(toFullJson(doc), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        })
      }

      // Root: Show usage
      if (path === '/' || path === '') {
        return Response.json({
          name: 'wiki.org.ai',
          description: 'Wikipedia article parser API',
          usage: {
            '/Albert_Einstein': 'Get article as Markdown (default)',
            '/Albert_Einstein.json': 'Get full article as JSON',
            '/Albert_Einstein/summary': 'Get concise summary',
            '/Albert_Einstein/infobox': 'Get infobox data only',
            '/Albert_Einstein/links': 'Get links only',
            '/Albert_Einstein/text': 'Get plain text',
            '/fr/Paris': 'French Wikipedia article',
            'POST / { wikitext, title }': 'Parse raw wikitext'
          }
        }, { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } })
      }

      // Parse path: /[lang/]Title[.json][/section]
      const { title, lang, format, section } = parsePath(path)

      if (!title) {
        return Response.json({ error: 'Invalid path' }, {
          status: 400, headers: corsHeaders
        })
      }

      // Fetch article
      const article = await fetchWikipediaArticle(title, lang)
      if (!article) {
        return Response.json({ error: 'Article not found', title }, {
          status: 404, headers: corsHeaders
        })
      }

      // Parse
      const doc = wtf(article.wikitext, { title: article.title })

      // Handle sections
      if (section === 'summary') {
        const summary = doc.sentences().slice(0, 3).map(s => s.text()).join(' ')
        if (format === 'json') {
          return Response.json({ title: doc.title(), summary }, {
            headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
          })
        }
        return new Response(`# ${doc.title()}\n\n${summary}`, {
          headers: { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8' }
        })
      }

      if (section === 'infobox') {
        const infoboxes = doc.infoboxes().map(i => ({ type: i.type(), data: i.json() }))
        return Response.json({ title: doc.title(), infoboxes }, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        })
      }

      if (section === 'links') {
        const links = doc.links().map(l => l.json())
        return Response.json({ title: doc.title(), links }, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        })
      }

      if (section === 'categories') {
        return Response.json({ title: doc.title(), categories: doc.categories() }, {
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        })
      }

      if (section === 'text') {
        return new Response(doc.text(), {
          headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }

      // Full response
      if (format === 'json') {
        return Response.json(toFullJson(doc), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        })
      }

      // Default: Markdown
      return new Response(toMarkdown(doc), {
        headers: { ...corsHeaders, 'Content-Type': 'text/markdown; charset=utf-8' }
      })

    } catch (error) {
      return Response.json({ error: (error as Error).message }, {
        status: 500, headers: corsHeaders
      })
    }
  }
}

function parsePath(path: string): { title: string; lang: string; format: string; section: string | null } {
  // Remove leading slash and decode URL
  let p = decodeURIComponent(path.replace(/^\/+/, ''))

  let lang = 'en'
  let format = 'md'
  let section: string | null = null

  // Check for language prefix (2 letter code)
  const langMatch = p.match(/^([a-z]{2})\/(.+)$/)
  if (langMatch) {
    lang = langMatch[1]
    p = langMatch[2]
  }

  // Check for .json extension
  if (p.endsWith('.json')) {
    format = 'json'
    p = p.slice(0, -5)
  }

  // Check for section suffix
  const sections = ['summary', 'infobox', 'links', 'categories', 'text']
  for (const s of sections) {
    if (p.endsWith('/' + s)) {
      section = s
      p = p.slice(0, -(s.length + 1))
      break
    }
  }

  return { title: p, lang, format, section }
}

async function fetchWikipediaArticle(title: string, lang: string): Promise<{ title: string; wikitext: string } | null> {
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2'
  })

  const response = await fetch(`${apiUrl}?${params}`, {
    headers: { 'User-Agent': 'wiki.org.ai/1.0' }
  })

  if (!response.ok) throw new Error(`Wikipedia API error: ${response.status}`)

  const data = await response.json() as WikipediaApiResponse
  const page = data.query?.pages?.[0]

  if (!page || page.missing) return null

  return {
    title: page.title,
    wikitext: page.revisions?.[0]?.slots?.main?.content || ''
  }
}

function toFullJson(doc: Document): FullJsonResponse {
  return {
    title: doc.title(),
    isRedirect: doc.isRedirect(),
    redirectTo: doc.redirectTo()?.page?.() || null,
    categories: doc.categories(),
    sections: doc.sections().map(s => ({
      title: s.title(),
      depth: s.depth(),
      text: s.text().slice(0, 2000)
    })),
    infoboxes: doc.infoboxes().map(i => ({ type: i.type(), data: i.json() })),
    links: doc.links().slice(0, 100).map(l => l.json()),
    coordinates: doc.coordinates(),
    templates: doc.templates().slice(0, 50)
  }
}

function toMarkdown(doc: Document): string {
  const lines: string[] = []

  lines.push(`# ${doc.title()?.replace(/_/g, ' ') || 'Untitled'}`)
  lines.push('')

  // Summary
  const firstSentences = doc.sentences().slice(0, 3)
  if (firstSentences.length) {
    lines.push(firstSentences.map(s => s.text()).join(' '))
    lines.push('')
  }

  // Infobox as table
  const infoboxes = doc.infoboxes()
  if (infoboxes.length > 0) {
    const infobox = infoboxes[0]
    lines.push(`## ${infobox.type()}`)
    lines.push('')
    lines.push('| Field | Value |')
    lines.push('|-------|-------|')
    const data = infobox.json()
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length < 100) {
        lines.push(`| ${key.replace(/_/g, ' ')} | ${value} |`)
      }
    }
    lines.push('')
  }

  // Sections
  for (const section of doc.sections()) {
    const title = section.title()
    if (title && title !== 'Introduction') {
      const heading = '#'.repeat(Math.min(section.depth() + 2, 6))
      lines.push(`${heading} ${title}`)
      lines.push('')
      const text = section.text().trim()
      if (text) {
        lines.push(text.slice(0, 2000))
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}
