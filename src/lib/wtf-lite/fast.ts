/**
 * Fast mode Wikipedia parser for Cloudflare Snippets
 *
 * Optimized for 5ms CPU limit - skips heavy processing:
 * - No infobox parsing (just strips them)
 * - No template parameter parsing
 * - Minimal link extraction
 * - Simple text extraction only
 *
 * Also provides specialized lazy parsers:
 * - parseSummary(): First 3 sentences only (<5ms target)
 * - parseInfoboxOnly(): Just infobox templates (<10ms target)
 * - parseLinksOnly(): Extract [[links]] only (<5ms target)
 * - parseCategoriesOnly(): Extract [[Category:...]] only (<2ms target)
 */

import { CATEGORIES, FILE_NS_PREFIXES, INFOBOXES, DATA, PATTERNS, buildRedirectPattern, getInfoboxPattern, buildInfoboxPattern, getCategoryPattern, buildCategoryPattern } from './constants'
import { parseTemplateParams } from './templates'
import type { Sentence } from './links'

export interface FastDocument {
  title: string | null
  isRedirect: boolean
  redirectTo: string | null
  categories: string[]
  text: string
  sections: Array<{ title: string; depth: number; text: string }>
}

export interface FastLink {
  page: string
  text: string
  anchor?: string
}

export interface FastInfobox {
  type: string
  data: Record<string, string>
}

export interface SummaryResult {
  title: string | null
  isRedirect: boolean
  redirectTo: string | null
  sentences: string[]
  text: string
}

export interface InfoboxResult {
  title: string | null
  isRedirect: boolean
  infoboxes: FastInfobox[]
}

export interface LinksResult {
  title: string | null
  isRedirect: boolean
  redirectTo: string | null
  links: FastLink[]
}

export interface CategoriesResult {
  title: string | null
  isRedirect: boolean
  categories: string[]
}

// Fast redirect pattern - captures target link
const FAST_REDIRECT_REG = /^\s*#(?:redirect|weiterleitung|redirection|redirección|перенаправление|تحويل|重定向)\s*\[\[([^\]|]+)/i

/**
 * Check if wiki is a redirect and get target
 */
function checkRedirect(wiki: string): { isRedirect: boolean; redirectTo: string | null } {
  // Use fast pre-compiled pattern for common case
  const m = wiki.match(FAST_REDIRECT_REG)
  if (m) {
    return { isRedirect: true, redirectTo: m[1] || null }
  }
  // Fall back to CDN data if available
  if (DATA?.redirects) {
    const redirectReg = buildRedirectPattern(DATA.redirects)
    const dm = wiki.match(redirectReg)
    if (dm) {
      const linkMatch = dm[1]?.match(/\[\[([^\]|]+)/)
      return { isRedirect: true, redirectTo: linkMatch?.[1] || null }
    }
  }
  return { isRedirect: false, redirectTo: null }
}

/**
 * Parse summary only - first 3 sentences (<5ms CPU target)
 * Skips: infobox, tables, references, most templates
 */
export function parseSummary(wiki: string, options?: { title?: string; maxSentences?: number }): SummaryResult {
  const title = options?.title || null
  const maxSentences = options?.maxSentences ?? 3

  // Check for redirect
  const redirect = checkRedirect(wiki)
  if (redirect.isRedirect) {
    return { title, isRedirect: true, redirectTo: redirect.redirectTo, sentences: [], text: '' }
  }

  // Quick preprocessing - use pre-compiled pattern
  wiki = wiki.replace(PATTERNS.HTML_COMMENT, '')  // HTML comments

  // Get only first section (before first == heading)
  const firstSectionEnd = wiki.search(/\n={2,}[^=\n]+={2,}/)
  if (firstSectionEnd > 0) {
    wiki = wiki.slice(0, firstSectionEnd)
  }

  // Strip templates and files quickly
  wiki = stripTemplatesAndFiles(wiki)

  // Clean up - use pre-compiled patterns
  wiki = wiki
    .replace(PATTERNS.HTML_TAG, ' ')  // HTML tags
    .replace(PATTERNS.FILE_LINK, '')  // File links
    .replace(PATTERNS.IMAGE_LINK, '')  // Image links
    .replace(/\[\[(?:Category|Категория|分类)[^\]]*\]\]/gi, '')  // Categories

  // Convert links to text - use pre-compiled patterns
  wiki = wiki.replace(PATTERNS.LINK_PIPED, '$2')
  wiki = wiki.replace(PATTERNS.LINK_SIMPLE, '$1')

  // Strip external links - use pre-compiled pattern
  wiki = wiki.replace(PATTERNS.EXT_LINK_REMOVE, '')

  // Clean formatting - use pre-compiled patterns
  wiki = wiki.replace(PATTERNS.BOLD_ITALIC_MARKERS, '').replace(PATTERNS.MULTI_NEWLINE, '\n\n').trim()

  // Split into sentences (simplified)
  const sentences = splitIntoSentences(wiki).slice(0, maxSentences)
  const text = sentences.join(' ')

  return {
    title: title || extractTitleFromBold(wiki),
    isRedirect: false,
    redirectTo: null,
    sentences,
    text
  }
}

/**
 * Parse infobox only (<10ms CPU target)
 * Only extracts infobox templates, skips all other content
 */
export function parseInfoboxOnly(wiki: string, options?: { title?: string }): InfoboxResult {
  const title = options?.title || null

  // Check for redirect
  const redirect = checkRedirect(wiki)
  if (redirect.isRedirect) {
    return { title, isRedirect: true, infoboxes: [] }
  }

  const infoboxes: FastInfobox[] = []
  const infos = DATA?.infoboxes || INFOBOXES
  const infoReg = DATA?.infoboxes ? buildInfoboxPattern(infos) : getInfoboxPattern()

  // Find templates using simple bracket matching (no full parsing)
  let depth = 0
  let start = -1
  let i = 0

  while (i < wiki.length - 1) {
    if (wiki[i] === '{' && wiki[i + 1] === '{') {
      if (depth === 0) start = i
      depth++
      i += 2
      continue
    }
    if (wiki[i] === '}' && wiki[i + 1] === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        const tmplBody = wiki.slice(start, i + 2)
        // Extract template name (first line before | or newline)
        const nameMatch = tmplBody.match(/^\{\{([^|\n]+)/)
        if (nameMatch && nameMatch[1]) {
          const name = nameMatch[1].trim().toLowerCase().replace(PATTERNS.UNDERSCORE, ' ')
          if (infoReg.test(name) || PATTERNS.INFOBOX_PREFIX.test(name) || PATTERNS.INFOBOX_SUFFIX.test(name)) {
            // Parse this infobox
            const obj = parseTemplateParams(tmplBody)
            let type = (obj['template'] as string) || ''
            const m = type.match(infoReg)
            if (m?.[0]) type = type.replace(m[0], '').trim()
            delete obj['template']; delete obj['list']

            // Convert Sentence values to strings
            const data: Record<string, string> = {}
            for (const [k, v] of Object.entries(obj)) {
              if (v && typeof v === 'object' && 'text' in v) {
                data[k] = (v as Sentence).text()
              } else if (typeof v === 'string') {
                data[k] = v
              }
            }
            infoboxes.push({ type, data })
          }
        }
        start = -1
      }
      i += 2
      continue
    }
    i++
  }

  return { title, isRedirect: false, infoboxes }
}

/**
 * Parse links only (<5ms CPU target)
 * Only extracts [[wiki links]], skips templates/content
 */
export function parseLinksOnly(wiki: string, options?: { title?: string }): LinksResult {
  const title = options?.title || null

  // Check for redirect
  const redirect = checkRedirect(wiki)
  if (redirect.isRedirect) {
    return { title, isRedirect: true, redirectTo: redirect.redirectTo, links: [] }
  }

  const links: FastLink[] = []
  const seen = new Set<string>()

  // Fast link extraction using regex
  const linkReg = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let match

  while ((match = linkReg.exec(wiki)) !== null) {
    let page = match[1] || ''
    const text = match[2] || page

    // Skip file/image/category links
    if (/^(File|Image|Category|Категория|分类):/i.test(page)) continue

    // Handle anchors
    let anchor: string | undefined
    const hashIdx = page.indexOf('#')
    if (hashIdx >= 0) {
      anchor = page.slice(hashIdx + 1)
      page = page.slice(0, hashIdx)
    }

    // Dedupe by page name
    const key = page.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const link: FastLink = { page, text }
    if (anchor) link.anchor = anchor
    links.push(link)
  }

  return { title, isRedirect: false, redirectTo: null, links }
}

/**
 * Parse categories only (<2ms CPU target)
 * Fastest possible - only extracts [[Category:...]]
 */
export function parseCategoriesOnly(wiki: string, options?: { title?: string }): CategoriesResult {
  const title = options?.title || null

  // Check for redirect
  const redirect = checkRedirect(wiki)
  if (redirect.isRedirect) {
    return { title, isRedirect: true, categories: [] }
  }

  const cats = DATA?.categories || CATEGORIES
  const catReg = DATA?.categories ? buildCategoryPattern(cats) : getCategoryPattern()

  const categories: string[] = []
  let match

  while ((match = catReg.exec(wiki)) !== null) {
    if (match[2]) {
      categories.push(match[2].trim())
    }
  }

  return { title, isRedirect: false, categories }
}

/**
 * Fast parse Wikipedia markup - optimized for 5ms CPU limit
 */
export function fastParse(wiki: string, options?: { title?: string }): FastDocument {
  const title = options?.title || null

  // Check for redirect
  const redirect = checkRedirect(wiki)
  if (redirect.isRedirect) {
    return {
      title,
      isRedirect: true,
      redirectTo: redirect.redirectTo,
      categories: [],
      text: '',
      sections: []
    }
  }

  // Quick preprocessing - use pre-compiled patterns
  wiki = wiki
    .replace(PATTERNS.HTML_COMMENT, '')  // HTML comments
    .replace(/\r/g, '')  // CR
    .replace(PATTERNS.ENTITY_NBSP, ' ')
    .replace(PATTERNS.HTML_ENTITIES, ' ')  // All HTML entities

  // Strip templates AND file links in single pass
  wiki = stripTemplatesAndFiles(wiki)

  // Extract categories before removing them
  const categories = extractCategories(wiki)
  wiki = wiki.replace(/\[\[(?:Category|Категория|分类)[^\]]*\]\]/gi, '')

  // Strip remaining tags - use pre-compiled patterns
  wiki = wiki
    .replace(PATTERNS.HTML_TAG, ' ')  // All HTML tags
    .replace(PATTERNS.FILE_LINK, '')  // File links
    .replace(PATTERNS.IMAGE_LINK, '')  // Image links

  // Convert links to text - use pre-compiled patterns
  wiki = wiki.replace(PATTERNS.LINK_PIPED, '$2')  // [[Page|Text]] -> Text
  wiki = wiki.replace(PATTERNS.LINK_SIMPLE, '$1')  // [[Page]] -> Page

  // Strip external links - use pre-compiled pattern
  wiki = wiki.replace(PATTERNS.EXT_LINK_REMOVE, '')

  // Clean up - use pre-compiled patterns
  wiki = wiki
    .replace(PATTERNS.BOLD_ITALIC_MARKERS, '')  // Bold/italic markers
    .replace(PATTERNS.MULTI_NEWLINE, '\n\n')  // Multiple newlines
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
 * Split text into sentences (fast approximation)
 */
function splitIntoSentences(text: string): string[] {
  if (!text?.trim()) return []

  const sentences: string[] = []
  let current = ''

  // Simple split on . ! ? followed by space or end
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    current += c

    if ((c === '.' || c === '!' || c === '?') &&
        (i === text.length - 1 || /\s/.test(text[i + 1] || ''))) {
      // Check for common abbreviations
      const lastWord = current.slice(-10).match(/\b([A-Za-z]{1,3})\.$/)
      if (lastWord && lastWord[1] && ['Mr', 'Mrs', 'Ms', 'Dr', 'Jr', 'Sr', 'vs', 'etc', 'eg', 'ie', 'No', 'ca'].includes(lastWord[1])) {
        continue
      }

      const trimmed = current.trim()
      if (trimmed.length > 5) {  // Skip very short "sentences"
        sentences.push(trimmed)
      }
      current = ''
    }
  }

  // Add any remaining text
  const trimmed = current.trim()
  if (trimmed.length > 5 && sentences.length === 0) {
    sentences.push(trimmed)
  }

  return sentences
}

/**
 * Extract title from bold text at start
 */
function extractTitleFromBold(text: string): string | null {
  const boldMatch = text.match(PATTERNS.BOLD_START)
  return boldMatch?.[1] || null
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
  // Use pre-compiled pattern for section split
  const sectionReg = /(?:\n|^)(={2,6})([^=\n]+)\1/g  // Keep local copy since we need lastIndex

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

    lastTitle = (match[2] || '').trim()
    lastDepth = (match[1] || '').length - 2
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
  // Look for bold text at start - use pre-compiled pattern
  const boldMatch = firstLine.match(PATTERNS.BOLD_START)
  return boldMatch?.[1] || null
}
