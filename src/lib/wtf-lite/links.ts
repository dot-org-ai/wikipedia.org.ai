/**
 * Link and Sentence classes with parsing functions for wtf-lite
 */

import type { LinkData, SentenceData } from './types'
import { FILE_NS_PREFIXES, ABBREVIATIONS } from './constants'
import { trim } from './utils'

// ============================================================================
// LINK CLASS
// ============================================================================
export class Link {
  private data: LinkData
  constructor(data: LinkData = {}) { this.data = { type: 'internal', ...data } }
  text(s?: string): string { if (s !== undefined) this.data.text = s; return (this.data.text || this.data.page || '').replace(/'{2,}/g, '') }
  page(s?: string): string | undefined { if (s !== undefined) this.data.page = s; return this.data.page }
  type(): string { return this.data.type || 'internal' }
  anchor(): string { return this.data.anchor || '' }
  raw(): string { return this.data.raw || '' }
  json(): object { return { text: this.text(), type: this.type(), page: this.page(), anchor: this.anchor() || undefined } }
}

// ============================================================================
// LINK PARSING
// ============================================================================
const ignoreLinkNs = /^(category|catégorie|kategorie|categoría|categoria|categorie|image|file|fichier|datei|media):/i
// ReDoS fix: Use negated character class [^\]]* instead of .*? in optional group
const extLinkReg = /\[(https?|news|ftp|mailto|gopher|irc)(:\/\/[^\]| ]{4,1500})([| ][^\]]{0,500})?\]/g
// ReDoS fix: Use negated character class [^\]]* instead of .{0,1600}?
const linkReg = /\[\[([^\]]{0,1600}?)\]\]([a-z]+)?/gi

export function parseLinks(str: string): Link[] {
  const links: Link[] = []
  str.replace(extLinkReg, (raw, protocol, link, text) => { links.push(new Link({ type: 'external', site: protocol + link, text: (text || '').trim(), raw })); return text || '' })
  str.replace(linkReg, (raw, s, suffix) => {
    let txt: string | null = null, link = s
    // ReDoS fix: Use negated character class [^|]* instead of .{2,1000} and .{0,2000}
    if (s.match(/\|/)) { link = s.replace(/([^|]{2,1000})\|[^|]{0,2000}/, '$1'); txt = s.replace(/[^|]{2,1000}?\|/, '') }
    if (link.match(ignoreLinkNs)) return s
    const obj: LinkData = { page: link, raw }
    obj.page = obj.page!.replace(/#(.*)/, (_, b) => { obj.anchor = b; return '' })
    if (txt !== null && txt !== obj.page) obj.text = txt
    if (suffix) { obj.text = obj.text || obj.page; obj.text += suffix.trim() }
    links.push(new Link(obj))
    return s
  })
  return links
}

export function getLinks(data: { text: string; links?: Link[] }): void {
  data.links = parseLinks(data.text)
  data.links.forEach(l => { if (l.raw()) data.text = data.text.replace(l.raw(), l.text() || l.page() || '') })
  // Remove any remaining file/image links that weren't caught in preProcess
  const fileNsReg = new RegExp(`\\[\\[(${FILE_NS_PREFIXES.join('|')}):`, 'gi')
  let match
  while ((match = fileNsReg.exec(data.text)) !== null) {
    const startIdx = match.index
    let depth = 0, endIdx = startIdx
    for (let i = startIdx; i < data.text.length - 1; i++) {
      if (data.text[i] === '[' && data.text[i + 1] === '[') { depth++; i++ }
      else if (data.text[i] === ']' && data.text[i + 1] === ']') { depth--; i++; if (depth === 0) { endIdx = i + 1; break } }
    }
    if (endIdx > startIdx) {
      data.text = data.text.slice(0, startIdx) + data.text.slice(endIdx)
      fileNsReg.lastIndex = startIdx
    }
  }
}

// ============================================================================
// SENTENCE CLASS
// ============================================================================
export class Sentence {
  data: SentenceData
  constructor(data: SentenceData = {}) { this.data = data }
  links(): Link[] { return (this.data.links || []) as unknown as Link[] }
  text(s?: string): string { if (s !== undefined) this.data.text = s; return this.data.text || '' }
  bold(): string | undefined { return this.data.fmt?.bold?.[0] }
  json(): object { return { text: this.text(), links: this.links().map(l => l.json()) } }
}

// ============================================================================
// SENTENCE PARSING
// ============================================================================
const abbrevReg = new RegExp("(^| |')(" + ABBREVIATIONS.join('|') + ")[.!?] ?$", 'i')
// Regex to detect if a chunk ends with a decimal number (e.g., "US$1" or "scored 2")
const decimalNumberEndReg = /\d\s*$/

export function splitSentences(text: string): string[] {
  if (!text?.trim()) return []
  let splits = text.split(/(\n+)/).filter(s => s.match(/\S/))
  // ReDoS fix: Use negated character class [^\s.!?]* with explicit alternatives instead of .+?
  splits = splits.flatMap(str => str.split(/(\S[^\n.!?]*[.!?]"?)(?=\s|$)/g))
  const chunks: string[] = []
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i]
    if (!s || !s.match(/\S/)) { const last = chunks[chunks.length - 1]; if (last !== undefined) chunks[chunks.length - 1] = last + (s ?? ''); continue }
    chunks.push(s)
  }
  const sentences: string[] = []
  for (let i = 0; i < chunks.length; i++) {
    const current = chunks[i]
    const next = chunks[i + 1]
    if (current === undefined) continue
    // Don't split if current ends with a digit and next starts with a decimal (e.g., "US$1" + ".5 million")
    const isDecimalSplit = next && decimalNumberEndReg.test(current) && /^\.\d/.test(next)
    if (next && (isDecimalSplit || abbrevReg.test(current) || /[ .'][A-Z].? *$/i.test(current) || /\.{3,} +$/.test(current))) {
      // For decimal numbers, don't add a space between the digit and decimal point
      const needsSpace = !isDecimalSplit && !/^\s/.test(next) && !/\s$/.test(current)
      chunks[i + 1] = current + (needsSpace ? ' ' : '') + next
    } else if (current.length > 0) { sentences.push(current); chunks[i] = '' }
  }
  return sentences.length === 0 ? [text] : sentences
}

export function parseSentence(str: string): Sentence {
  const obj: SentenceData = { text: str }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLinks(obj as any)
  obj.text = trim(obj.text || '').replace(/\([,;: ]*\)/g, '').replace(/ +\.$/, '.')
  // Bold/italic
  // ReDoS fix: Use negated character class [^']* instead of .{0,2500}?
  const bolds: string[] = [], italics: string[] = []
  obj.text = obj.text.replace(/'''''([^']{0,2500}|'(?!')){0,2500}'''''/g, (_, b) => { bolds.push(b); italics.push(b); return b })
  obj.text = obj.text.replace(/'''([^']{0,2500}|'(?!')|''(?!')){0,2500}'''/g, (_, b) => { bolds.push(b); return b })
  obj.text = obj.text.replace(/''([^']{0,2500}|'(?!')){0,2500}''/g, (_, b) => { italics.push(b); return b })
  if (bolds.length || italics.length) obj.fmt = { bold: bolds.length ? bolds : undefined, italic: italics.length ? italics : undefined }
  return new Sentence(obj)
}
