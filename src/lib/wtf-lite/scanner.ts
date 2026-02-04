/**
 * Single-pass scanner for wtf-lite
 *
 * Collects all markers (templates, links, refs, files, comments) in one pass.
 * This avoids multiple string traversals and enables efficient batch processing.
 */

import { FILE_NS_PREFIXES, CATEGORIES, PATTERNS } from './constants'

// ============================================================================
// MARKER TYPES
// ============================================================================

/** Type of marker found during scanning */
export type MarkerType =
  | 'template'    // {{...}}
  | 'link'        // [[...]]
  | 'file'        // [[File:...]] or [[Image:...]]
  | 'category'    // [[Category:...]]
  | 'ref'         // <ref>...</ref>
  | 'ref-named'   // <ref name="...">...</ref>
  | 'ref-self'    // <ref name="..."/>
  | 'comment'     // <!--...-->
  | 'heading'     // == ... ==
  | 'extlink'     // [http://...]

/** A marker found during scanning */
export interface Marker {
  type: MarkerType
  start: number
  end: number
  content: string
  /** For templates: template name (lowercase, normalized) */
  name?: string
  /** For named refs: the name attribute */
  refName?: string
  /** For headings: the depth (0-4 for ==..====) */
  depth?: number
}

/** Result of scanning */
export interface ScanResult {
  markers: Marker[]
  /** Text between markers - for efficient reconstruction */
  textRanges: { start: number; end: number }[]
}

// ============================================================================
// SCANNER IMPLEMENTATION
// ============================================================================

// Pre-computed lowercase file prefixes for fast lookup
const filePrefixesLower = FILE_NS_PREFIXES.map(p => p.toLowerCase())
const categoryPrefixesLower = CATEGORIES.map(p => p.toLowerCase())

/**
 * Scan wiki text for all markers in a single pass
 *
 * This is the core optimization: instead of multiple regex passes,
 * we scan once and collect positions of all special constructs.
 */
export function scan(wiki: string): ScanResult {
  const markers: Marker[] = []
  const len = wiki.length
  let i = 0

  while (i < len) {
    const c = wiki.charCodeAt(i)

    // Comment: <!-- ... -->
    if (c === 60 && wiki.charCodeAt(i + 1) === 33 && wiki.charCodeAt(i + 2) === 45 && wiki.charCodeAt(i + 3) === 45) { // '<', '!', '-', '-'
      const endIdx = wiki.indexOf('-->', i + 4)
      if (endIdx !== -1) {
        markers.push({
          type: 'comment',
          start: i,
          end: endIdx + 3,
          content: wiki.slice(i, endIdx + 3)
        })
        i = endIdx + 3
        continue
      }
    }

    // Ref tag: <ref ...> or <ref/>
    if (c === 60 && (wiki.charCodeAt(i + 1) === 114 || wiki.charCodeAt(i + 1) === 82)) { // '<r' or '<R'
      const after = wiki.slice(i, i + 10).toLowerCase()
      if (after.startsWith('<ref') && (after.charCodeAt(4) === 32 || after.charCodeAt(4) === 62 || after.charCodeAt(4) === 47)) {
        const marker = scanRef(wiki, i)
        if (marker) {
          markers.push(marker)
          i = marker.end
          continue
        }
      }
    }

    // Template: {{...}}
    if (c === 123 && wiki.charCodeAt(i + 1) === 123) { // '{{'
      const marker = scanTemplate(wiki, i)
      if (marker) {
        markers.push(marker)
        i = marker.end
        continue
      }
    }

    // Link: [[...]]
    if (c === 91 && wiki.charCodeAt(i + 1) === 91) { // '[['
      const marker = scanLink(wiki, i)
      if (marker) {
        markers.push(marker)
        i = marker.end
        continue
      }
    }

    // External link: [http://...] or [https://...]
    if (c === 91 && wiki.charCodeAt(i + 1) !== 91) { // '[' but not '[['
      const after = wiki.slice(i + 1, i + 10).toLowerCase()
      if (after.startsWith('http://') || after.startsWith('https://') || after.startsWith('ftp://') || after.startsWith('mailto:')) {
        const marker = scanExtLink(wiki, i)
        if (marker) {
          markers.push(marker)
          i = marker.end
          continue
        }
      }
    }

    // Heading: == ... == (at start of line or start of string)
    if (c === 61 && (i === 0 || wiki.charCodeAt(i - 1) === 10)) { // '=' after newline or at start
      const marker = scanHeading(wiki, i)
      if (marker) {
        markers.push(marker)
        i = marker.end
        continue
      }
    }

    i++
  }

  // Sort by start position (should already be sorted, but ensure)
  markers.sort((a, b) => a.start - b.start)

  // Calculate text ranges between markers
  const textRanges = calculateTextRanges(markers, len)

  return { markers, textRanges }
}

/**
 * Scan a template {{...}}
 */
function scanTemplate(wiki: string, start: number): Marker | null {
  let depth = 0
  let i = start

  while (i < wiki.length - 1) {
    if (wiki.charCodeAt(i) === 123 && wiki.charCodeAt(i + 1) === 123) { // '{{'
      depth++
      i += 2
      continue
    }
    if (wiki.charCodeAt(i) === 125 && wiki.charCodeAt(i + 1) === 125) { // '}}'
      depth--
      if (depth === 0) {
        const content = wiki.slice(start, i + 2)
        // Extract template name
        const name = extractTemplateName(content)
        return {
          type: 'template',
          start,
          end: i + 2,
          content,
          name
        }
      }
      i += 2
      continue
    }
    i++
  }

  return null // Unbalanced template
}

/**
 * Scan a link [[...]]
 */
function scanLink(wiki: string, start: number): Marker | null {
  // Check what type of link it is by looking at content after [[
  const prefixEnd = Math.min(start + 30, wiki.length)
  const prefixContent = wiki.slice(start + 2, prefixEnd).toLowerCase()

  // Check for file/image links
  for (const prefix of filePrefixesLower) {
    if (prefixContent.startsWith(prefix + ':')) {
      return scanNestedLink(wiki, start, 'file')
    }
  }

  // Check for category links
  for (const prefix of categoryPrefixesLower) {
    if (prefixContent.startsWith(prefix + ':')) {
      return scanNestedLink(wiki, start, 'category')
    }
  }

  // Regular link - may not need nested scanning if no nested [[
  let depth = 0
  let i = start

  while (i < wiki.length - 1) {
    if (wiki.charCodeAt(i) === 91 && wiki.charCodeAt(i + 1) === 91) { // '[['
      depth++
      i += 2
      continue
    }
    if (wiki.charCodeAt(i) === 93 && wiki.charCodeAt(i + 1) === 93) { // ']]'
      depth--
      if (depth === 0) {
        return {
          type: 'link',
          start,
          end: i + 2,
          content: wiki.slice(start, i + 2)
        }
      }
      i += 2
      continue
    }
    i++
  }

  return null
}

/**
 * Scan a nested link (file/image/category) with proper bracket balancing
 */
function scanNestedLink(wiki: string, start: number, type: 'file' | 'category'): Marker | null {
  let depth = 0
  let i = start

  while (i < wiki.length - 1) {
    if (wiki.charCodeAt(i) === 91 && wiki.charCodeAt(i + 1) === 91) { // '[['
      depth++
      i += 2
      continue
    }
    if (wiki.charCodeAt(i) === 93 && wiki.charCodeAt(i + 1) === 93) { // ']]'
      depth--
      if (depth === 0) {
        return {
          type,
          start,
          end: i + 2,
          content: wiki.slice(start, i + 2)
        }
      }
      i += 2
      continue
    }
    i++
  }

  return null
}

/**
 * Scan an external link [http://...]
 */
function scanExtLink(wiki: string, start: number): Marker | null {
  const closeBracket = wiki.indexOf(']', start + 1)
  if (closeBracket === -1) return null

  // Ensure no newline in between
  const content = wiki.slice(start, closeBracket + 1)
  if (content.includes('\n')) return null

  return {
    type: 'extlink',
    start,
    end: closeBracket + 1,
    content
  }
}

/**
 * Scan a ref tag
 */
function scanRef(wiki: string, start: number): Marker | null {
  // Look for self-closing: <ref .../>
  const selfCloseEnd = wiki.indexOf('/>', start)
  const openTagEnd = wiki.indexOf('>', start)

  if (openTagEnd === -1) return null

  // Self-closing tag?
  if (selfCloseEnd !== -1 && selfCloseEnd < openTagEnd + 2) {
    const content = wiki.slice(start, selfCloseEnd + 2)
    const refName = extractRefName(content)
    return {
      type: 'ref-self',
      start,
      end: selfCloseEnd + 2,
      content,
      refName
    }
  }

  // Regular ref with content: <ref>...</ref> or <ref name="...">...</ref>
  const closeTag = wiki.indexOf('</ref>', openTagEnd)
  if (closeTag === -1) return null

  const content = wiki.slice(start, closeTag + 6)
  const openTag = wiki.slice(start, openTagEnd + 1)
  const refName = extractRefName(openTag)

  return {
    type: refName ? 'ref-named' : 'ref',
    start,
    end: closeTag + 6,
    content,
    refName
  }
}

/**
 * Scan a heading == ... ==
 */
function scanHeading(wiki: string, start: number): Marker | null {
  // Count leading =
  let depth = 0
  let i = start
  while (i < wiki.length && wiki.charCodeAt(i) === 61) { // '='
    depth++
    i++
  }

  if (depth < 2 || depth > 6) return null

  // Find end of heading (matching = count at end of line)
  const lineEnd = wiki.indexOf('\n', i)
  const searchEnd = lineEnd === -1 ? wiki.length : lineEnd

  // Look for closing =
  let j = searchEnd - 1
  let closeDepth = 0
  while (j >= i && wiki.charCodeAt(j) === 61) { // '='
    closeDepth++
    j--
  }

  if (closeDepth < 2) return null

  // Use minimum of open/close depth
  const actualDepth = Math.min(depth, closeDepth, 6)

  return {
    type: 'heading',
    start,
    end: lineEnd === -1 ? wiki.length : lineEnd,
    content: wiki.slice(start, lineEnd === -1 ? wiki.length : lineEnd),
    depth: actualDepth - 2 // 0-4 for == to ======
  }
}

/**
 * Extract template name from template body
 */
function extractTemplateName(tmpl: string): string {
  // Remove {{ and }}
  let inner = tmpl.slice(2, -2)

  // Get first line/pipe segment
  const pipeIdx = inner.indexOf('|')
  const newlineIdx = inner.indexOf('\n')

  let name: string
  if (pipeIdx !== -1 && (newlineIdx === -1 || pipeIdx < newlineIdx)) {
    name = inner.slice(0, pipeIdx)
  } else if (newlineIdx !== -1) {
    name = inner.slice(0, newlineIdx)
  } else {
    name = inner
  }

  // Normalize: lowercase, trim, replace _ with space, remove anything after :
  return name.replace(/:.*$/, '').trim().toLowerCase().replace(/_/g, ' ')
}

/**
 * Extract ref name attribute
 */
function extractRefName(tag: string): string | undefined {
  const match = tag.match(/name\s*=\s*["']?([^"'\s/>]+)["']?/i)
  return match ? match[1] : undefined
}

/**
 * Calculate text ranges between markers
 */
function calculateTextRanges(markers: Marker[], totalLen: number): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  let lastEnd = 0

  for (const m of markers) {
    if (m.start > lastEnd) {
      ranges.push({ start: lastEnd, end: m.start })
    }
    lastEnd = Math.max(lastEnd, m.end)
  }

  if (lastEnd < totalLen) {
    ranges.push({ start: lastEnd, end: totalLen })
  }

  return ranges
}

// ============================================================================
// BATCH PROCESSING
// ============================================================================

/** Result of processing markers */
export interface ProcessResult {
  /** Final text with markers replaced */
  text: string
  /** Extracted templates with positions */
  templates: { name: string; body: string; replacement: string }[]
  /** Extracted links */
  links: { page: string; text: string; anchor?: string }[]
  /** Extracted categories */
  categories: string[]
  /** Extracted file/image info */
  files: { file: string; caption?: string }[]
  /** Extracted references */
  references: { type: string; content: string; name?: string }[]
  /** Section headings */
  sections: { title: string; depth: number; startPos: number }[]
}

/**
 * Process scanned markers and build final text in one pass
 */
export function processMarkers(
  wiki: string,
  result: ScanResult,
  options?: {
    /** Process templates (call handler for each) */
    processTemplates?: (name: string, body: string) => string
    /** Keep links as wiki markup (don't convert to text) */
    keepLinks?: boolean
    /** Keep categories in text */
    keepCategories?: boolean
    /** Keep refs in text */
    keepRefs?: boolean
  }
): ProcessResult {
  const { markers } = result
  const processTemplates = options?.processTemplates
  const keepLinks = options?.keepLinks ?? false
  const keepCategories = options?.keepCategories ?? false
  const keepRefs = options?.keepRefs ?? false

  const templates: ProcessResult['templates'] = []
  const links: ProcessResult['links'] = []
  const categories: string[] = []
  const files: ProcessResult['files'] = []
  const references: ProcessResult['references'] = []
  const sections: ProcessResult['sections'] = []

  // Build replacement map: position -> replacement text
  const replacements: { start: number; end: number; text: string }[] = []

  for (const marker of markers) {
    let replacement = ''

    switch (marker.type) {
      case 'comment':
        // Remove comments
        replacement = ''
        break

      case 'template':
        if (processTemplates && marker.name) {
          replacement = processTemplates(marker.name, marker.content)
          templates.push({ name: marker.name, body: marker.content, replacement })
        }
        break

      case 'link':
        const linkData = parseLinkContent(marker.content)
        links.push(linkData)
        replacement = keepLinks ? marker.content : linkData.text
        break

      case 'file':
        const fileData = parseFileContent(marker.content)
        files.push(fileData)
        replacement = '' // Files are stripped from text
        break

      case 'category':
        const catName = parseCategoryContent(marker.content)
        categories.push(catName)
        replacement = keepCategories ? marker.content : ''
        break

      case 'ref':
      case 'ref-named':
      case 'ref-self':
        references.push({
          type: marker.type,
          content: marker.content,
          name: marker.refName
        })
        replacement = keepRefs ? marker.content : ''
        break

      case 'heading':
        sections.push({
          title: parseHeadingContent(marker.content),
          depth: marker.depth ?? 0,
          startPos: marker.start
        })
        // Keep headings in text
        replacement = marker.content
        break

      case 'extlink':
        // External links: [http://... text] -> text or just remove
        const extText = parseExtLinkContent(marker.content)
        replacement = extText
        break
    }

    replacements.push({ start: marker.start, end: marker.end, text: replacement })
  }

  // Build final text using position-based assembly
  const text = assembleText(wiki, replacements)

  return {
    text,
    templates,
    links,
    categories,
    files,
    references,
    sections
  }
}

/**
 * Assemble final text from original + replacements
 */
function assembleText(wiki: string, replacements: { start: number; end: number; text: string }[]): string {
  if (replacements.length === 0) return wiki

  // Sort by position
  replacements.sort((a, b) => a.start - b.start)

  const parts: string[] = []
  let lastEnd = 0

  for (const r of replacements) {
    // Add text before this replacement
    if (r.start > lastEnd) {
      parts.push(wiki.slice(lastEnd, r.start))
    }
    // Add replacement
    parts.push(r.text)
    lastEnd = Math.max(lastEnd, r.end)
  }

  // Add remaining text
  if (lastEnd < wiki.length) {
    parts.push(wiki.slice(lastEnd))
  }

  return parts.join('')
}

/**
 * Parse link content: [[Page|Text]] -> { page, text, anchor? }
 */
function parseLinkContent(content: string): { page: string; text: string; anchor?: string } {
  // Remove [[ and ]]
  const inner = content.slice(2, -2)

  const pipeIdx = inner.indexOf('|')
  let page: string
  let text: string

  if (pipeIdx !== -1) {
    page = inner.slice(0, pipeIdx)
    text = inner.slice(pipeIdx + 1)
  } else {
    page = inner
    text = inner
  }

  // Handle anchor
  let anchor: string | undefined
  const hashIdx = page.indexOf('#')
  if (hashIdx !== -1) {
    anchor = page.slice(hashIdx + 1)
    page = page.slice(0, hashIdx)
  }

  return { page, text, anchor }
}

/**
 * Parse file content
 */
function parseFileContent(content: string): { file: string; caption?: string } {
  // Remove [[ and ]]
  const inner = content.slice(2, -2)
  const parts = inner.split('|')

  const file = parts[0]?.replace(/^[^:]+:/, '') ?? ''
  // Last non-keyword part is usually caption
  const caption = parts.length > 1 ? parts[parts.length - 1] : undefined

  return { file, caption }
}

/**
 * Parse category content
 */
function parseCategoryContent(content: string): string {
  // Remove [[ and ]]
  const inner = content.slice(2, -2)
  // Remove Category: prefix and any sort key after |
  const colonIdx = inner.indexOf(':')
  let name = colonIdx !== -1 ? inner.slice(colonIdx + 1) : inner
  const pipeIdx = name.indexOf('|')
  if (pipeIdx !== -1) {
    name = name.slice(0, pipeIdx)
  }
  return name.trim()
}

/**
 * Parse heading content
 */
function parseHeadingContent(content: string): string {
  // Remove leading/trailing =
  return content.replace(/^=+\s*/, '').replace(/\s*=+$/, '').trim()
}

/**
 * Parse external link content
 */
function parseExtLinkContent(content: string): string {
  // [url text] -> text, or just empty if no text
  const inner = content.slice(1, -1)
  const spaceIdx = inner.indexOf(' ')
  if (spaceIdx !== -1) {
    return inner.slice(spaceIdx + 1).trim()
  }
  return ''
}

// ============================================================================
// SINGLE-PASS FAST PARSE
// ============================================================================

export interface FastScanDocument {
  title: string | null
  isRedirect: boolean
  redirectTo: string | null
  categories: string[]
  links: { page: string; text: string; anchor?: string }[]
  text: string
  sections: { title: string; depth: number; text: string }[]
}

/**
 * Fast parse using single-pass scanner
 *
 * This is the most efficient parsing mode:
 * - Single pass to find all markers
 * - Batch processing of markers
 * - Position-based text assembly (no repeated string replacements)
 *
 * Performance target: <10ms for 200KB article
 */
export function fastScanParse(wiki: string, options?: { title?: string }): FastScanDocument {
  const title = options?.title || null

  // Check for redirect first (quick regex check)
  const redirectMatch = wiki.match(/^\s*#(?:redirect|weiterleitung|redirection|redirección|перенаправление|تحويل|重定向)\s*\[\[([^\]|]+)/i)
  if (redirectMatch) {
    return {
      title,
      isRedirect: true,
      redirectTo: redirectMatch[1] || null,
      categories: [],
      links: [],
      text: '',
      sections: []
    }
  }

  // Single-pass scan
  const scanResult = scan(wiki)

  // Process markers
  const processed = processMarkers(wiki, scanResult, {
    // Don't process templates (too expensive for fast mode)
    processTemplates: undefined,
    // Keep links as text
    keepLinks: false,
    // Remove categories and refs from text
    keepCategories: false,
    keepRefs: false
  })

  // Clean up the text
  let text = processed.text
    .replace(/<[^>]+>/g, ' ')  // HTML tags
    .replace(/''+/g, '')        // Bold/italic markers
    .replace(/\n{3,}/g, '\n\n') // Multiple newlines
    .trim()

  // Build sections from headings
  const sections: { title: string; depth: number; text: string }[] = []
  const sectionBreaks = processed.sections

  if (sectionBreaks.length === 0) {
    // No headings - entire text is one section
    sections.push({ title: '', depth: 0, text })
  } else {
    // Split text by heading positions
    // First, get the text before the first heading
    const firstHeadingPos = sectionBreaks[0]?.startPos ?? 0
    if (firstHeadingPos > 0) {
      const introText = text.slice(0, firstHeadingPos).trim()
      if (introText) {
        sections.push({ title: '', depth: 0, text: introText })
      }
    }

    // Then each heading starts a new section
    for (let i = 0; i < sectionBreaks.length; i++) {
      const current = sectionBreaks[i]!
      const next = sectionBreaks[i + 1]
      const startPos = current.startPos
      const endPos = next?.startPos ?? text.length

      // Find the actual heading in the text and skip past it
      const headingEnd = text.indexOf('\n', startPos)
      const sectionTextStart = headingEnd !== -1 ? headingEnd + 1 : startPos
      const sectionText = text.slice(sectionTextStart, endPos).trim()

      sections.push({
        title: current.title,
        depth: current.depth,
        text: sectionText
      })
    }
  }

  // Combine section texts for final text
  const finalText = sections.map(s => s.text).join('\n\n')

  return {
    title: title || extractTitleFromBoldText(finalText),
    isRedirect: false,
    redirectTo: null,
    categories: processed.categories,
    links: processed.links,
    text: finalText,
    sections
  }
}

/**
 * Extract title from bold text at start
 */
function extractTitleFromBoldText(text: string): string | null {
  const boldMatch = text.match(/^'''([^']+)'''/)
  return boldMatch?.[1] || null
}
