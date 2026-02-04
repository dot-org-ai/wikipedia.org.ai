/**
 * Utility functions for wtf-lite Wikipedia parser
 */

import { FILE_NS_PREFIXES, IGNORE_TAGS } from './constants'
import { Image, findImages } from './image'

// Helper function to trim whitespace
export const trim = (s: string): string => (s || '').replace(/^\s+|\s+$/g, '').replace(/ {2,}/g, ' ')

/**
 * Preprocess wiki markup - remove comments, special tags, etc.
 * Now returns both cleaned text and extracted images
 * Optimized to minimize string operations
 */
export function preProcess(wiki: string): { text: string; images: Image[] } {
  // Combine simple replacements into single pass using replaceAll where possible
  wiki = wiki
    .replace(/<!--(?:[^-]|-(?!->)){0,3000}-->/g, '')  // HTML comments
    .replace(/__(NOTOC|NOEDITSECTION|FORCETOC|TOC)__/gi, '')  // Magic words
    .replace(/~{2,3}|\r|----/g, '')  // Signatures, CR, horizontal rules
    .replace(/\u3002/g, '. ')  // CJK period
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&mdash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")

  // Extract [[File:...]], [[Image:...]] - parse and store instead of stripping
  const { images, text: wikiWithoutImages } = findImages(wiki, FILE_NS_PREFIXES)
  wiki = wikiWithoutImages

  // HTML tag cleanup
  wiki = wiki
    .replace(new RegExp(`< ?(${IGNORE_TAGS.join('|')}) ?[^>]{0,200}>(?:[^<]|<(?!\\s?/\\s?(${IGNORE_TAGS.join('|')})\\s?>))+< ?/ ?(${IGNORE_TAGS.join('|')}) ?>`, 'gi'), ' ')
    .replace(/ ?< ?(span|div|table|data) [a-zA-Z0-9=%.\-#:;'" ]{2,100}\/? ?> ?/g, ' ')
    .replace(/<i>([^<]*(?:<(?!\/i>)[^<]*)*)<\/i>/g, "''$1''")
    .replace(/<b>([^<]*(?:<(?!\/b>)[^<]*)*)<\/b>/g, "'''$1'''")
    .replace(/ ?<[ /]?(p|sub|sup|span|nowiki|div|table|br|tr|td|th|pre|hr|u)[ /]?> ?/g, ' ')
    .replace(/ ?< ?br ?\/> ?/g, '\n')
    .replace(/\([,;: ]+\)/g, '')

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
      if (c === '}') { depth--; if (depth === 0) { carry.push(c); const t = carry.join(''); carry = []; if (/\{\{/.test(t) && /\}\}/.test(t)) list.push({ body: t, start: startIdx, end: i + 1 }); continue } }
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
  if (/^\{\{[^\n]+\|/.test(tmpl)) name = (tmpl.match(/^\{\{(.+?)\|/) ?? [])[1]
  else if (tmpl.indexOf('\n') !== -1) name = (tmpl.match(/^\{\{(.+)\n/) ?? [])[1]
  else name = (tmpl.match(/^\{\{(.+?)\}\}$/) ?? [])[1]
  return name ? name.replace(/:.*/, '').trim().toLowerCase().replace(/_/g, ' ') : ''
}
