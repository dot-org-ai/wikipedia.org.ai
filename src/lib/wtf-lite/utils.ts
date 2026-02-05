/**
 * Utility functions for wtf-lite Wikipedia parser
 */

import { FILE_NS_PREFIXES, PATTERNS, getIgnoreTagsPattern } from './constants'
import { Image, findImages } from './image'

// Helper function to trim whitespace (uses pre-compiled patterns)
export const trim = (s: string): string => {
  if (!s) return ''
  return s.replace(PATTERNS.TRIM_WHITESPACE, '').replace(PATTERNS.COLLAPSE_SPACES, ' ')
}

// Character codes for hot loop optimizations (charCodeAt is 2-3x faster than string indexing)
const CHAR_OPEN_BRACE = 123   // {
const CHAR_CLOSE_BRACE = 125  // }

// HTML entity lookup map for single-pass replacement
const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&ndash;': '-',
  '&mdash;': '-',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
}

// Pre-compiled pattern for HTML entity single-pass replacement
const HTML_ENTITY_PATTERN = /&(?:nbsp|ndash|mdash|amp|quot|apos);/g

/**
 * Preprocess wiki markup - remove comments, special tags, etc.
 * Now returns both cleaned text and extracted images
 * Optimized to minimize string operations
 */
export function preProcess(wiki: string): { text: string; images: Image[] } {
  // Combine simple replacements into single pass using pre-compiled patterns
  wiki = wiki
    .replace(PATTERNS.HTML_COMMENT, '')  // HTML comments
    .replace(PATTERNS.MAGIC_WORDS, '')   // Magic words
    .replace(PATTERNS.SIGNATURES_HR, '') // Signatures, CR, horizontal rules
    .replace(PATTERNS.CJK_PERIOD, '. ')  // CJK period
    // Single-pass HTML entity replacement (6 regexes -> 1 with map lookup)
    .replace(HTML_ENTITY_PATTERN, (match) => HTML_ENTITY_MAP[match] || match)

  // Extract [[File:...]], [[Image:...]] - parse and store instead of stripping
  const { images, text: wikiWithoutImages } = findImages(wiki, FILE_NS_PREFIXES)
  wiki = wikiWithoutImages

  // HTML tag cleanup (use cached pattern for ignore tags)
  wiki = wiki
    .replace(getIgnoreTagsPattern(), ' ')
    .replace(PATTERNS.SELF_CLOSE_TAG, ' ')
    .replace(/<i>([^<]*(?:<(?!\/i>)[^<]*)*)<\/i>/g, "''$1''")
    .replace(/<b>([^<]*(?:<(?!\/b>)[^<]*)*)<\/b>/g, "'''$1'''")
    .replace(PATTERNS.INLINE_TAG, ' ')
    .replace(PATTERNS.BR_TAG, '\n')
    .replace(PATTERNS.EMPTY_PARENS, '')

  return { text: wiki.trim(), images }
}

/**
 * Find all templates in wiki markup with positions for efficient removal
 * Optimized: Uses charCodeAt() for 2-3x faster character comparison in hot loop
 */
export function findTemplates(wiki: string): { body: string; name: string; start: number; end: number }[] {
  const list: { body: string; start: number; end: number }[] = []
  let depth = 0, carry: string[] = [], startIdx = 0
  const len = wiki.length

  for (let i = wiki.indexOf('{'); i !== -1 && i < len; depth > 0 ? i++ : (i = wiki.indexOf('{', i + 1))) {
    // charCodeAt is 2-3x faster than string indexing for character comparison
    const code = wiki.charCodeAt(i)
    if (Number.isNaN(code)) continue

    if (code === CHAR_OPEN_BRACE) {
      if (depth === 0) startIdx = i
      depth++
    }
    if (depth > 0) {
      if (code === CHAR_CLOSE_BRACE) {
        depth--
        if (depth === 0) {
          carry.push(String.fromCharCode(code))
          const t = carry.join('')
          carry = []
          // Validate it's a proper template with {{ and }}
          if (PATTERNS.TEMPLATE_OPEN.test(t) && PATTERNS.TEMPLATE_CLOSE.test(t)) {
            list.push({ body: t, start: startIdx, end: i + 1 })
          }
          continue
        }
      }
      // At depth 1, if char isn't { or }, reset (invalid template)
      if (depth === 1 && code !== CHAR_OPEN_BRACE && code !== CHAR_CLOSE_BRACE) {
        depth = 0
        carry = []
        continue
      }
      carry.push(String.fromCharCode(code))
    }
  }
  return list.map(t => ({ ...t, name: getTemplateName(t.body) }))
}

/**
 * Remove templates from text in a single pass (O(n) instead of O(n*m))
 */
export function stripTemplates(wiki: string, templates: { start: number; end: number }[]): string {
  if (templates.length === 0) return wiki
  // Sort by start position
  const sorted = [...templates].sort((a, b) => a.start - b.start)
  const parts: string[] = []
  let lastEnd = 0
  for (const t of sorted) {
    if (t.start > lastEnd) {
      parts.push(wiki.slice(lastEnd, t.start))
    }
    lastEnd = Math.max(lastEnd, t.end)
  }
  if (lastEnd < wiki.length) {
    parts.push(wiki.slice(lastEnd))
  }
  return parts.join('')
}

/**
 * Get the name of a template
 * Optimized: Uses indexOf instead of regex for delimiter detection
 */
export function getTemplateName(tmpl: string): string {
  // Skip leading {{ using indexOf check (faster than regex)
  if (tmpl.charCodeAt(0) !== CHAR_OPEN_BRACE || tmpl.charCodeAt(1) !== CHAR_OPEN_BRACE) {
    return ''
  }

  // Find end delimiter: first of |, \n, or }}
  // Using indexOf is faster than regex for simple substring searches
  const startPos = 2
  const pipePos = tmpl.indexOf('|', startPos)
  const newlinePos = tmpl.indexOf('\n', startPos)
  const closePos = tmpl.indexOf('}}', startPos)

  // Find minimum valid position
  let endPos = tmpl.length
  if (pipePos !== -1 && pipePos < endPos) endPos = pipePos
  if (newlinePos !== -1 && newlinePos < endPos) endPos = newlinePos
  if (closePos !== -1 && closePos < endPos) endPos = closePos

  if (endPos <= startPos) return ''

  let name = tmpl.slice(startPos, endPos)

  // Remove namespace prefix (colon-delimited) using indexOf
  const colonPos = name.indexOf(':')
  if (colonPos !== -1) {
    name = name.slice(0, colonPos)
  }

  // Normalize: trim, lowercase, underscores to spaces
  return name.trim().toLowerCase().replace(PATTERNS.UNDERSCORE, ' ')
}
