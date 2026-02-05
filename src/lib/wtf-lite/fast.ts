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

// Character codes for hot loop optimizations (charCodeAt is 2-3x faster than string indexing)
const CHAR_OPEN_BRACE = 123    // {
const CHAR_CLOSE_BRACE = 125  // }
const CHAR_OPEN_BRACKET = 91  // [
const CHAR_CLOSE_BRACKET = 93 // ]

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
  shortDescription: string | null
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

// Fast short description pattern - case insensitive, captures description text
// Matches: {{Short description|...}} or {{short description|...}}
const SHORT_DESC_REG = /\{\{[Ss]hort description\|([^}|]+)/

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
 * Extract short description from Wikipedia article (<0.5ms CPU target)
 *
 * Wikipedia articles often have a {{Short description|...}} template at the top
 * that contains a pre-written one-line summary. This function extracts it
 * without parsing the full article.
 *
 * @example
 * // Input: {{Short description|German-born theoretical physicist (1879–1955)}}
 * // Returns: "German-born theoretical physicist (1879–1955)"
 *
 * @param wiki - The raw wikitext
 * @returns The short description text, or null if not found
 */
export function extractShortDescription(wiki: string): string | null {
  // Quick bailout if no short description pattern likely exists
  // Check first 2000 chars only - short description is always near the top
  const searchArea = wiki.length > 2000 ? wiki.slice(0, 2000) : wiki

  // Use indexOf for fastest initial check
  const lowerSearch = searchArea.toLowerCase()
  const idx = lowerSearch.indexOf('{{short description|')
  if (idx === -1) return null

  // Found potential match, extract with regex for proper parsing
  const match = searchArea.slice(idx).match(SHORT_DESC_REG)
  if (!match || !match[1]) return null

  // Clean up the description text
  return match[1].trim()
}

/**
 * Parse summary only - first 3 sentences (<5ms CPU target)
 * Skips: infobox, tables, references, most templates
 *
 * NOTE: This now delegates to parseSummaryBounded() for byte-bounded parsing.
 * For large articles, only the first 4KB is processed, achieving <3ms CPU time.
 */
export function parseSummary(wiki: string, options?: { title?: string; maxSentences?: number }): SummaryResult {
  const boundedOptions: { title?: string; maxSentences?: number; maxBytes: number } = {
    maxBytes: 4096 // Default 4KB - sufficient for 3 sentences from any article
  }
  if (options?.title) boundedOptions.title = options.title
  if (options?.maxSentences) boundedOptions.maxSentences = options.maxSentences
  return parseSummaryBounded(wiki, boundedOptions)
}

/**
 * Byte-bounded summary parsing (<3ms CPU target for any article size)
 *
 * Key optimizations:
 * 1. Truncates input to maxBytes BEFORE any processing
 * 2. Finds first section boundary and truncates there if earlier
 * 3. Only processes the truncated content through stripTemplatesAndFiles()
 * 4. Stops sentence extraction once maxSentences reached
 *
 * This ensures consistent sub-3ms CPU time regardless of article size.
 * A 200KB article and a 2KB article take the same time to process.
 *
 * @param wiki - Raw wikitext (can be any size)
 * @param options - Configuration options
 * @param options.title - Article title (optional)
 * @param options.maxBytes - Maximum bytes to process (default: 4096)
 * @param options.maxSentences - Maximum sentences to extract (default: 3)
 */
export function parseSummaryBounded(
  wiki: string,
  options?: { title?: string; maxBytes?: number; maxSentences?: number }
): SummaryResult {
  const title = options?.title || null
  const maxBytes = options?.maxBytes ?? 4096
  const maxSentences = options?.maxSentences ?? 3

  // Check for redirect FIRST (before truncation - redirects are at the start)
  const redirect = checkRedirect(wiki)
  if (redirect.isRedirect) {
    return { title, isRedirect: true, redirectTo: redirect.redirectTo, sentences: [], text: '', shortDescription: null }
  }

  // Extract short description early (before truncating - it's always near the top)
  // extractShortDescription already limits search to first 2000 chars
  const shortDescription = extractShortDescription(wiki)

  // === BYTE BOUNDING: Truncate to maxBytes ===
  // This is the key optimization - we never process more than maxBytes
  // For UTF-8, we truncate at byte boundary to avoid breaking multi-byte chars
  if (wiki.length > maxBytes) {
    // Simple truncation - JavaScript strings are UTF-16, but for wikitext
    // which is mostly ASCII, character count ~ byte count
    // For articles with CJK, we may get slightly less content but that's fine
    wiki = wiki.slice(0, maxBytes)
  }

  // === SECTION BOUNDING: Find first section end ===
  // Summary only needs the lead section (before first == heading)
  // This is typically 500-2000 bytes
  const firstSectionEnd = wiki.search(/\n={2,}[^=\n]+={2,}/)
  if (firstSectionEnd > 0) {
    wiki = wiki.slice(0, firstSectionEnd)
  }

  // Quick preprocessing - remove HTML comments
  // Use pre-compiled pattern for speed
  wiki = wiki.replace(PATTERNS.HTML_COMMENT, '')

  // Strip templates and files - this is the expensive operation
  // Now operating on at most maxBytes of content
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

  // Split into sentences (with early exit once we have enough)
  const sentences = splitIntoSentencesBounded(wiki, maxSentences)
  const text = sentences.join(' ')

  return {
    title: title || extractTitleFromBold(wiki),
    isRedirect: false,
    redirectTo: null,
    sentences,
    text,
    shortDescription
  }
}

/**
 * Split text into sentences with early exit (bounded version)
 * Stops as soon as maxSentences are found - no need to process rest of text
 * Optimized: Uses charCodeAt() for 2-3x faster character comparison
 */
function splitIntoSentencesBounded(text: string, maxSentences: number): string[] {
  if (!text?.trim()) return []

  const sentences: string[] = []
  let current = ''
  const len = text.length

  // Simple split on . ! ? followed by space or end
  for (let i = 0; i < len; i++) {
    const c = text[i]
    current += c

    // charCodeAt is 2-3x faster than string comparison
    const code = text.charCodeAt(i)
    const isSentenceEnd = code === CHAR_PERIOD || code === CHAR_EXCLAIM || code === CHAR_QUESTION

    if (isSentenceEnd) {
      // Check if followed by whitespace or end of string
      const nextCode = i < len - 1 ? text.charCodeAt(i + 1) : -1
      const isFollowedByWhitespace = i === len - 1 ||
        nextCode === CHAR_SPACE || nextCode === CHAR_TAB || nextCode === CHAR_NEWLINE_S

      if (isFollowedByWhitespace) {
        // Check for common abbreviations
        const lastWord = current.slice(-10).match(/\b([A-Za-z]{1,3})\.$/)
        if (lastWord && lastWord[1] && ['Mr', 'Mrs', 'Ms', 'Dr', 'Jr', 'Sr', 'vs', 'etc', 'eg', 'ie', 'No', 'ca'].includes(lastWord[1])) {
          continue
        }

        const trimmed = current.trim()
        if (trimmed.length > 5) {  // Skip very short "sentences"
          sentences.push(trimmed)
          // === EARLY EXIT: Stop once we have enough sentences ===
          if (sentences.length >= maxSentences) {
            return sentences
          }
        }
        current = ''
      }
    }
  }

  // Add any remaining text only if we don't have enough sentences
  const trimmed = current.trim()
  if (trimmed.length > 5 && sentences.length === 0) {
    sentences.push(trimmed)
  }

  return sentences
}

/**
 * Parse infobox only (<10ms CPU target)
 * Only extracts infobox templates, skips all other content
 * Optimized: Uses charCodeAt() for 2-3x faster character comparison in hot loop
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
  // charCodeAt is 2-3x faster than string indexing for character comparison
  let depth = 0
  let start = -1
  let i = 0
  const len = wiki.length

  while (i < len - 1) {
    const code = wiki.charCodeAt(i)
    const code2 = wiki.charCodeAt(i + 1)

    // Template start: {{
    if (code === CHAR_OPEN_BRACE && code2 === CHAR_OPEN_BRACE) {
      if (depth === 0) start = i
      depth++
      i += 2
      continue
    }
    // Template end: }}
    if (code === CHAR_CLOSE_BRACE && code2 === CHAR_CLOSE_BRACE) {
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
 * Optimized: Uses charCodeAt() for 2-3x faster character comparison in hot loop
 */
function stripTemplatesAndFiles(wiki: string): string {
  const filePrefixes = FILE_NS_PREFIXES.map(p => p.toLowerCase())
  const result: string[] = []
  let templateDepth = 0
  let linkDepth = 0
  let lastEnd = 0
  let inFileLink = false
  let i = 0
  const len = wiki.length

  while (i < len - 1) {
    // charCodeAt is 2-3x faster than string indexing for character comparison
    const code = wiki.charCodeAt(i)
    const code2 = wiki.charCodeAt(i + 1)

    // Template start: {{
    if (code === CHAR_OPEN_BRACE && code2 === CHAR_OPEN_BRACE) {
      if (templateDepth === 0 && !inFileLink) {
        result.push(wiki.slice(lastEnd, i))
      }
      templateDepth++
      i += 2
      continue
    }

    // Template end: }}
    if (code === CHAR_CLOSE_BRACE && code2 === CHAR_CLOSE_BRACE && templateDepth > 0) {
      templateDepth--
      if (templateDepth === 0 && !inFileLink) {
        lastEnd = i + 2
      }
      i += 2
      continue
    }

    // Link start: [[
    if (code === CHAR_OPEN_BRACKET && code2 === CHAR_OPEN_BRACKET && templateDepth === 0) {
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

    // Link end: ]]
    if (code === CHAR_CLOSE_BRACKET && code2 === CHAR_CLOSE_BRACKET && inFileLink) {
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
  if (templateDepth === 0 && !inFileLink && lastEnd < len) {
    result.push(wiki.slice(lastEnd))
  }

  return result.join('')
}

// Character codes for sentence splitting
const CHAR_PERIOD = 46        // .
const CHAR_EXCLAIM = 33       // !
const CHAR_QUESTION = 63      // ?
const CHAR_SPACE = 32         // space
const CHAR_TAB = 9            // tab
const CHAR_NEWLINE_S = 10     // \n

/**
 * Split text into sentences (fast approximation)
 * Optimized: Uses charCodeAt() for 2-3x faster character comparison
 * @deprecated Use splitIntoSentencesBounded for better performance with early exit
 */
function _splitIntoSentences(text: string): string[] {
  if (!text?.trim()) return []

  const sentences: string[] = []
  let current = ''
  const len = text.length

  // Simple split on . ! ? followed by space or end
  for (let i = 0; i < len; i++) {
    const c = text[i]
    current += c

    // charCodeAt is 2-3x faster than string comparison
    const code = text.charCodeAt(i)
    const isSentenceEnd = code === CHAR_PERIOD || code === CHAR_EXCLAIM || code === CHAR_QUESTION

    if (isSentenceEnd) {
      // Check if followed by whitespace or end of string
      const nextCode = i < len - 1 ? text.charCodeAt(i + 1) : -1
      const isFollowedByWhitespace = i === len - 1 ||
        nextCode === CHAR_SPACE || nextCode === CHAR_TAB || nextCode === CHAR_NEWLINE_S

      if (isFollowedByWhitespace) {
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
