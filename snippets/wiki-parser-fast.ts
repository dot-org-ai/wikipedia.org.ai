/**
 * Fast wiki parser snippet for Cloudflare Snippets
 * Optimized for 5ms CPU limit - uses fast parsing mode
 */
import { fastParse } from '../src/lib/wtf-lite/fast'

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname

    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers })
    }

    try {
      // POST: Parse raw wikitext
      if (request.method === 'POST') {
        const body = await request.json() as { wikitext?: string; title?: string }
        const doc = fastParse(body.wikitext || '', { title: body.title })
        return Response.json(doc, {
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        })
      }

      // GET /: API info
      if (pathname === '/' || pathname === '') {
        return Response.json({
          name: 'wiki.org.ai (fast mode)',
          description: 'Fast Wikipedia article parser',
          note: 'Optimized for 5ms CPU limit - no infobox parsing',
          usage: {
            '/Albert_Einstein': 'Get article (Markdown)',
            '/Albert_Einstein.json': 'Get article (JSON)',
            '/Albert_Einstein/text': 'Get plain text',
            '/fr/Paris': 'French Wikipedia article',
          },
        }, { headers })
      }

      // Parse path
      const { title, lang, format } = parsePath(pathname)

      if (!title) {
        return Response.json({ error: 'Invalid path' }, { status: 400, headers })
      }

      // Fetch wikitext from Wikipedia
      const result = await fetchWikitext(title, lang)

      if (!result) {
        return Response.json({ error: 'Article not found', title }, { status: 404, headers })
      }

      // Parse with fast mode
      const doc = fastParse(result.wikitext, { title: result.title })

      // Return based on format
      if (format === 'json') {
        return Response.json(doc, {
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        })
      }

      // Default: Markdown
      return new Response(toMarkdown(doc), {
        headers: { ...headers, 'Content-Type': 'text/markdown; charset=utf-8' },
      })

    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 500, headers })
    }
  },
}

function parsePath(path: string): { title: string; lang: string; format: 'json' | 'md' } {
  let title = decodeURIComponent(path.replace(/^\/+/, ''))
  let lang = 'en'
  let format: 'json' | 'md' = 'md'

  // Check for language prefix
  const langMatch = title.match(/^([a-z]{2})\/(.+)$/)
  if (langMatch) {
    lang = langMatch[1]
    title = langMatch[2]
  }

  // Check for .json extension
  if (title.endsWith('.json')) {
    format = 'json'
    title = title.slice(0, -5)
  }

  // Remove section suffixes (not supported in fast mode)
  title = title.replace(/\/(summary|infobox|links|categories|text)$/, '')

  return { title, lang, format }
}

async function fetchWikitext(title: string, lang: string): Promise<{ title: string; wikitext: string } | null> {
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
    headers: { 'User-Agent': 'wiki.org.ai/1.0' },
  })

  if (!response.ok) {
    throw new Error(`Wikipedia API error: ${response.status}`)
  }

  const data = await response.json() as {
    query?: {
      pages?: Array<{
        title: string
        missing?: boolean
        revisions?: Array<{ slots?: { main?: { content: string } } }>
      }>
    }
  }

  const page = data.query?.pages?.[0]
  if (!page || page.missing) {
    return null
  }

  return {
    title: page.title,
    wikitext: page.revisions?.[0]?.slots?.main?.content || '',
  }
}

function toMarkdown(doc: ReturnType<typeof fastParse>): string {
  const lines: string[] = []

  // Title
  lines.push(`# ${doc.title?.replace(/_/g, ' ') || 'Untitled'}`)
  lines.push('')

  // First few sentences as intro
  const intro = doc.sections[0]?.text.split(/[.!?]/).slice(0, 3).join('. ') + '.'
  if (intro.length > 10) {
    lines.push(intro)
    lines.push('')
  }

  // Sections
  for (const section of doc.sections.slice(1)) {
    if (section.title) {
      const depth = '#'.repeat(Math.min(section.depth + 2, 6))
      lines.push(`${depth} ${section.title}`)
      lines.push('')
    }
    if (section.text) {
      lines.push(section.text.slice(0, 2000))
      lines.push('')
    }
  }

  return lines.join('\n')
}
