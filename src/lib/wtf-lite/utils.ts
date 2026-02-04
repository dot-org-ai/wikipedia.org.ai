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
    .replace(PATTERNS.ENTITY_NBSP, ' ')
    .replace(PATTERNS.ENTITY_NDASH, '-')
    .replace(PATTERNS.ENTITY_MDASH, '-')
    .replace(PATTERNS.ENTITY_AMP, '&')
    .replace(PATTERNS.ENTITY_QUOT, '"')
    .replace(PATTERNS.ENTITY_APOS, "'")

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
 */
export function findTemplates(wiki: string): { body: string; name: string; start: number; end: number }[] {
  const list: { body: string; start: number; end: number }[] = []
  let depth = 0, carry: string[] = [], startIdx = 0
  for (let i = wiki.indexOf('{'); i !== -1 && i < wiki.length; depth > 0 ? i++ : (i = wiki.indexOf('{', i + 1))) {
    const c = wiki[i]
    if (c === undefined) continue
    if (c === '{') { if (depth === 0) startIdx = i; depth++ }
    if (depth > 0) {
      if (c === '}') { depth--; if (depth === 0) { carry.push(c); const t = carry.join(''); carry = []; if (PATTERNS.TEMPLATE_OPEN.test(t) && PATTERNS.TEMPLATE_CLOSE.test(t)) list.push({ body: t, start: startIdx, end: i + 1 }); continue } }
      if (depth === 1 && c !== '{' && c !== '}') { depth = 0; carry = []; continue }
      carry.push(c)
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
 */
export function getTemplateName(tmpl: string): string {
  let name: string | undefined
  // Use pre-compiled patterns for template name extraction
  if (PATTERNS.TEMPLATE_WITH_PIPE.test(tmpl)) {
    name = (tmpl.match(PATTERNS.TEMPLATE_NAME_PIPE) ?? [])[1]
  } else if (tmpl.indexOf('\n') !== -1) {
    name = (tmpl.match(PATTERNS.TEMPLATE_NAME_NEWLINE) ?? [])[1]
  } else {
    name = (tmpl.match(PATTERNS.TEMPLATE_NAME_SIMPLE) ?? [])[1]
  }
  return name ? name.replace(/:.*/, '').trim().toLowerCase().replace(PATTERNS.UNDERSCORE, ' ') : ''
}
