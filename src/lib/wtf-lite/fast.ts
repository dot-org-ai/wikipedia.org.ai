/**
 * Fast mode Wikipedia parser for Cloudflare Snippets
 *
 * Optimized for 5ms CPU limit - skips heavy processing:
 * - No infobox parsing (just strips them)
 * - No template parameter parsing
 * - Minimal link extraction
 * - Simple text extraction only
 */

import { CATEGORIES, REDIRECTS, FILE_NS_PREFIXES } from './constants'

export interface FastDocument {
  title: string | null
  isRedirect: boolean
  redirectTo: string | null
  categories: string[]
  text: string
  sections: Array<{ title: string; depth: number; text: string }>
}

/**
 * Fast parse Wikipedia markup - optimized for 5ms CPU limit
 */
export function fastParse(wiki: string, options?: { title?: string }): FastDocument {
  const title = options?.title || null

  // Check for redirect
  const redirectReg = new RegExp('^\\s*#(' + REDIRECTS.join('|') + ')\\s*(\\[\\[[^\\]]{2,180}?\\]\\])', 'i')
  if (redirectReg.test(wiki)) {
    const m = wiki.match(redirectReg)
    const redirectMatch = m?.[2]?.match(/\[\[([^\]|]+)/)
    return {
      title,
      isRedirect: true,
      redirectTo: redirectMatch?.[1] || null,
      categories: [],
      text: '',
      sections: []
    }
  }

  // Quick preprocessing - minimal regex passes
  wiki = wiki
    .replace(/<!--[\s\S]*?-->/g, '')  // HTML comments
    .replace(/\r/g, '')  // CR
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')  // All HTML entities

  // Strip templates AND file links in single pass
  wiki = stripTemplatesAndFiles(wiki)

  // Extract categories before removing them
  const categories = extractCategories(wiki)
  wiki = wiki.replace(/\[\[(?:Category|Категория|分类)[^\]]*\]\]/gi, '')

  // Strip remaining tags
  wiki = wiki
    .replace(/<[^>]+>/g, ' ')  // All HTML tags
    .replace(/\[\[File:[^\]]*\]\]/gi, '')  // File links
    .replace(/\[\[Image:[^\]]*\]\]/gi, '')  // Image links

  // Convert links to text
  wiki = wiki.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')  // [[Page|Text]] -> Text
  wiki = wiki.replace(/\[\[([^\]]+)\]\]/g, '$1')  // [[Page]] -> Page

  // Strip external links
  wiki = wiki.replace(/\[https?:\/\/[^\]]+\]/g, '')

  // Clean up
  wiki = wiki
    .replace(/''+/g, '')  // Bold/italic markers
    .replace(/\n{3,}/g, '\n\n')  // Multiple newlines
    .trim()

  // Split into sections
  const sections = splitSections(wiki)

  // Get plain text
  const text = sections.map(s => s.text).join('\n\n')

  return {
    title: title || extractTitleFromText(sections[0]?.text || ''),
    isRedirect: false,
    redirectTo: null,
    categories,
    text,
    sections
  }
}

/**
 * Strip templates AND file links in a single pass
 */
function stripTemplatesAndFiles(wiki: string): string {
  const filePrefixes = FILE_NS_PREFIXES.map(p => p.toLowerCase())
  const result: string[] = []
  let templateDepth = 0
  let linkDepth = 0
  let lastEnd = 0
  let inFileLink = false
  let i = 0

  while (i < wiki.length - 1) {
    const c = wiki[i]
    const c2 = wiki[i + 1]

    // Template start
    if (c === '{' && c2 === '{') {
      if (templateDepth === 0 && !inFileLink) {
        result.push(wiki.slice(lastEnd, i))
      }
      templateDepth++
      i += 2
      continue
    }

    // Template end
    if (c === '}' && c2 === '}' && templateDepth > 0) {
      templateDepth--
      if (templateDepth === 0 && !inFileLink) {
        lastEnd = i + 2
      }
      i += 2
      continue
    }

    // Link start
    if (c === '[' && c2 === '[' && templateDepth === 0) {
      // Check if file link
      const after = wiki.slice(i + 2, i + 20).toLowerCase()
      const isFile = filePrefixes.some(p => after.startsWith(p + ':'))

      if (isFile && !inFileLink) {
        result.push(wiki.slice(lastEnd, i))
        inFileLink = true
        linkDepth = 1
        i += 2
        continue
      } else if (inFileLink) {
        linkDepth++
        i += 2
        continue
      }
    }

    // Link end
    if (c === ']' && c2 === ']' && inFileLink) {
      linkDepth--
      if (linkDepth === 0) {
        inFileLink = false
        lastEnd = i + 2
      }
      i += 2
      continue
    }

    i++
  }

  // Handle remaining content
  if (templateDepth === 0 && !inFileLink && lastEnd < wiki.length) {
    result.push(wiki.slice(lastEnd))
  }

  return result.join('')
}

/**
 * Extract categories
 */
function extractCategories(wiki: string): string[] {
  const cats: string[] = []
  const catReg = /\[\[(Category|Категория|分类):([^\]|]+)/gi
  let match
  while ((match = catReg.exec(wiki)) !== null) {
    if (match[2]) cats.push(match[2].trim())
  }
  return cats
}

/**
 * Split into sections
 */
function splitSections(wiki: string): Array<{ title: string; depth: number; text: string }> {
  const sections: Array<{ title: string; depth: number; text: string }> = []
  const sectionReg = /(?:\n|^)(={2,6})([^=\n]+)\1/g

  let lastEnd = 0
  let lastTitle = ''
  let lastDepth = 0
  let match

  while ((match = sectionReg.exec(wiki)) !== null) {
    // Save previous section
    const text = wiki.slice(lastEnd, match.index).trim()
    if (text || sections.length === 0) {
      sections.push({ title: lastTitle, depth: lastDepth, text })
    }

    lastTitle = match[2].trim()
    lastDepth = match[1].length - 2
    lastEnd = match.index + match[0].length
  }

  // Add final section
  const finalText = wiki.slice(lastEnd).trim()
  if (finalText) {
    sections.push({ title: lastTitle, depth: lastDepth, text: finalText })
  }

  return sections
}

/**
 * Extract title from first sentence
 */
function extractTitleFromText(text: string): string | null {
  const firstLine = text.split('\n')[0] || ''
  // Look for bold text at start
  const boldMatch = firstLine.match(/^'''([^']+)'''/)
  return boldMatch?.[1] || null
}
