/**
 * Utility functions for wtf-lite Wikipedia parser
 */

import { FILE_NS_PREFIXES, IGNORE_TAGS } from './constants'

// Helper function to trim whitespace
export const trim = (s: string): string => (s || '').replace(/^\s+|\s+$/g, '').replace(/ {2,}/g, ' ')

/**
 * Preprocess wiki markup - remove comments, special tags, etc.
 */
export function preProcess(wiki: string): string {
  // ReDoS fix: Use negated character class instead of [\s\S]{0,3000}? to prevent backtracking
  wiki = wiki.replace(/<!--(?:[^-]|-(?!->)){0,3000}-->/g, '')
  wiki = wiki.replace(/__(NOTOC|NOEDITSECTION|FORCETOC|TOC)__/gi, '')
  wiki = wiki.replace(/~{2,3}/g, '').replace(/\r/g, '').replace(/\u3002/g, '. ').replace(/----/g, '')
  wiki = wiki.replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '-').replace(/&mdash;/g, '-')
  wiki = wiki.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

  // Strip [[File:...]], [[Image:...]] and i18n variants (handles nested brackets)
  const fileNsReg = new RegExp(`\\[\\[(${FILE_NS_PREFIXES.join('|')}):`, 'gi')
  let match
  while ((match = fileNsReg.exec(wiki)) !== null) {
    const startIdx = match.index
    let depth = 0, endIdx = startIdx
    for (let i = startIdx; i < wiki.length - 1; i++) {
      if (wiki[i] === '[' && wiki[i + 1] === '[') { depth++; i++ }
      else if (wiki[i] === ']' && wiki[i + 1] === ']') { depth--; i++; if (depth === 0) { endIdx = i + 1; break } }
    }
    if (endIdx > startIdx) {
      wiki = wiki.slice(0, startIdx) + wiki.slice(endIdx)
      fileNsReg.lastIndex = startIdx
    }
  }

  // ReDoS fix: Use negated character class with controlled lookahead instead of [\s\S]+?
  wiki = wiki.replace(new RegExp(`< ?(${IGNORE_TAGS.join('|')}) ?[^>]{0,200}>(?:[^<]|<(?!\\s?/\\s?(${IGNORE_TAGS.join('|')})\\s?>))+< ?/ ?(${IGNORE_TAGS.join('|')}) ?>`, 'gi'), ' ')
  wiki = wiki.replace(/ ?< ?(span|div|table|data) [a-zA-Z0-9=%.\-#:;'" ]{2,100}\/? ?> ?/g, ' ')
  // ReDoS fix: Use negated character class [^<]* instead of .*? to prevent backtracking
  wiki = wiki.replace(/<i>([^<]*(?:<(?!\/i>)[^<]*)*)<\/i>/g, "''$1''").replace(/<b>([^<]*(?:<(?!\/b>)[^<]*)*)<\/b>/g, "'''$1'''")
  wiki = wiki.replace(/ ?<[ /]?(p|sub|sup|span|nowiki|div|table|br|tr|td|th|pre|hr|u)[ /]?> ?/g, ' ')
  wiki = wiki.replace(/ ?< ?br ?\/> ?/g, '\n').replace(/\([,;: ]+\)/g, '')
  return wiki.trim()
}

/**
 * Find all templates in wiki markup
 */
export function findTemplates(wiki: string): { body: string; name: string }[] {
  const list: string[] = []
  let depth = 0, carry: string[] = []
  for (let i = wiki.indexOf('{'); i !== -1 && i < wiki.length; depth > 0 ? i++ : (i = wiki.indexOf('{', i + 1))) {
    const c = wiki[i]
    if (c === undefined) continue
    if (c === '{') depth++
    if (depth > 0) {
      if (c === '}') { depth--; if (depth === 0) { carry.push(c); const t = carry.join(''); carry = []; if (/\{\{/.test(t) && /\}\}/.test(t)) list.push(t); continue } }
      if (depth === 1 && c !== '{' && c !== '}') { depth = 0; carry = []; continue }
      carry.push(c)
    }
  }
  return list.map(body => ({ body, name: getTemplateName(body) }))
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
