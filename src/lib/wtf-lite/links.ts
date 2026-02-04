/**
 * Link and Sentence classes with parsing functions for wtf-lite
 */

import type { LinkData, SentenceData } from './types'
import { PATTERNS, getFileNsPattern, getAbbrevPattern } from './constants'
import { trim } from './utils'

// ============================================================================
// LINK CLASS
// ============================================================================
export class Link {
  private data: LinkData
  constructor(data: LinkData = {}) { this.data = { type: 'internal', ...data } }
  text(s?: string): string { if (s !== undefined) this.data.text = s; return (this.data.text || this.data.page || '').replace(PATTERNS.BOLD_ITALIC_MARKERS, '') }
  page(s?: string): string | undefined { if (s !== undefined) this.data.page = s; return this.data.page }
  type(): string { return this.data.type || 'internal' }
  anchor(): string { return this.data.anchor || '' }
  raw(): string { return this.data.raw || '' }
  json(): object { return { text: this.text(), type: this.type(), page: this.page(), anchor: this.anchor() || undefined } }
}

// ============================================================================
// LINK PARSING
// ============================================================================
// Use pre-compiled patterns from constants

export function parseLinks(str: string): Link[] {
  const links: Link[] = []
  // External links
  str.replace(PATTERNS.EXTERNAL_LINK, (raw, link, text) => {
    // Protocol is captured in the full match, link starts with ://
    const protocolMatch = raw.match(/\[(https?|news|ftp|mailto|gopher|irc)/)
    const protocol = protocolMatch?.[1] || 'http'
    const displayText = typeof text === 'string' ? text.trim() : ''
    links.push(new Link({ type: 'external', site: protocol + link, text: displayText, raw }))
    return displayText || ''
  })
  // Wiki links
  str.replace(PATTERNS.WIKI_LINK, (raw, s, suffix) => {
    let txt: string | null = null, link = s
    // Check for pipe using indexOf (faster than regex for simple check)
    if (s.indexOf('|') !== -1) {
      link = s.replace(PATTERNS.LINK_BEFORE_PIPE, '$1')
      txt = s.replace(PATTERNS.LINK_AFTER_PIPE, '')
    }
    if (PATTERNS.IGNORE_LINK_NS.test(link)) return s
    const obj: LinkData = { page: link, raw }
    obj.page = obj.page!.replace(PATTERNS.ANCHOR_HASH, (_, b) => { obj.anchor = b; return '' })
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
  // Use cached pattern instead of building new one each time
  const fileNsReg = getFileNsPattern()
  // Reset lastIndex since this is a global regex that may have been used before
  fileNsReg.lastIndex = 0
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
// Use cached abbreviation pattern

export function splitSentences(text: string): string[] {
  if (!text?.trim()) return []
  let splits = text.split(PATTERNS.NEWLINE_SPLIT).filter(s => PATTERNS.HAS_CONTENT.test(s))
  // Use pre-compiled sentence split pattern
  splits = splits.flatMap(str => str.split(PATTERNS.SENTENCE_SPLIT))
  const chunks: string[] = []
  for (let i = 0; i < splits.length; i++) {
    const s = splits[i]
    if (!s || !PATTERNS.HAS_CONTENT.test(s)) { const last = chunks[chunks.length - 1]; if (last !== undefined) chunks[chunks.length - 1] = last + (s ?? ''); continue }
    chunks.push(s)
  }
  const sentences: string[] = []
  // Get cached abbreviation pattern
  const abbrevReg = getAbbrevPattern()
  for (let i = 0; i < chunks.length; i++) {
    const current = chunks[i]
    const next = chunks[i + 1]
    if (current === undefined) continue
    // Don't split if current ends with a digit and next starts with a decimal (e.g., "US$1" + ".5 million")
    const isDecimalSplit = next && PATTERNS.DECIMAL_END.test(current) && next.charCodeAt(0) === 46 && next.charCodeAt(1) >= 48 && next.charCodeAt(1) <= 57
    if (next && (isDecimalSplit || abbrevReg.test(current) || PATTERNS.INITIAL_END.test(current) || PATTERNS.ELLIPSIS_END.test(current))) {
      // For decimal numbers, don't add a space between the digit and decimal point
      const needsSpace = !isDecimalSplit && next.charCodeAt(0) > 32 && current.charCodeAt(current.length - 1) > 32
      chunks[i + 1] = current + (needsSpace ? ' ' : '') + next
    } else if (current.length > 0) { sentences.push(current); chunks[i] = '' }
  }
  return sentences.length === 0 ? [text] : sentences
}

export function parseSentence(str: string): Sentence {
  const obj: SentenceData = { text: str }
  // Early exit optimizations using indexOf (faster than includes for single char)
  const hasLinks = str.indexOf('[') !== -1
  const hasBold = str.indexOf("'''") !== -1
  const hasItalic = str.indexOf("''") !== -1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (hasLinks) getLinks(obj as any)
  obj.text = trim(obj.text || '').replace(PATTERNS.EMPTY_PARENS, '').replace(PATTERNS.TRAILING_PERIOD, '.')

  // Bold/italic - skip if no markers present
  if (hasBold || hasItalic) {
    const bolds: string[] = [], italics: string[] = []
    obj.text = obj.text.replace(PATTERNS.BOLD_ITALIC, (_, b) => { bolds.push(b); italics.push(b); return b })
    obj.text = obj.text.replace(PATTERNS.BOLD, (_, b) => { bolds.push(b); return b })
    obj.text = obj.text.replace(PATTERNS.ITALIC, (_, b) => { italics.push(b); return b })
    if (bolds.length || italics.length) obj.fmt = { bold: bolds.length ? bolds : undefined, italic: italics.length ? italics : undefined }
  }
  return new Sentence(obj)
}
