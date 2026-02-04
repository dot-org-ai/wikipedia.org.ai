/**
 * Reference class for parsing <ref> tags in wtf-lite
 */

import type { ReferenceData, ReferenceJson } from './types'
import { findTemplates } from './utils'
import { parseTemplateParams } from './templates'
import { parseSentence, Sentence } from './links'
import { PATTERNS } from './constants'

// ============================================================================
// REFERENCE CLASS
// ============================================================================

/**
 * Reference class representing a <ref> tag citation
 */
export class Reference {
  private _data: ReferenceData
  private _wiki: string

  constructor(data: ReferenceData, wiki: string = '') {
    this._data = data
    this._wiki = wiki
  }

  /**
   * Get the title of the reference (from citation template or inline text)
   */
  title(): string {
    const d = this._data
    return d.title || d.encyclopedia || d.work || d.newspaper || d.journal || d.website || d.author || ''
  }

  /**
   * Get the external URL if present
   */
  url(): string {
    return this._data.url || ''
  }

  /**
   * Get the plain text of the reference
   */
  text(): string {
    // For inline references, return the inline text
    if (this._data.inline) {
      // Handle both Sentence objects and plain objects (from json() reuse)
      if (typeof this._data.inline.text === 'function') {
        return this._data.inline.text()
      }
      // Plain object with text property
      if (typeof this._data.inline === 'object' && 'text' in this._data.inline) {
        return (this._data.inline as { text: string }).text || ''
      }
    }
    // For citation templates, build a text representation
    const parts: string[] = []
    if (this._data.author) parts.push(this._data.author)
    if (this._data.title) parts.push(`"${this._data.title}"`)
    if (this._data.work || this._data.newspaper || this._data.journal) {
      parts.push(this._data.work || this._data.newspaper || this._data.journal || '')
    }
    if (this._data.publisher) parts.push(this._data.publisher)
    if (this._data.date) parts.push(`(${this._data.date})`)
    return parts.join('. ')
  }

  /**
   * Get the raw wikitext of the reference
   */
  wikitext(): string {
    return this._wiki
  }

  /**
   * Get the reference name (for named references)
   */
  name(): string {
    return this._data.name || ''
  }

  /**
   * Get the reference type (citation template type or 'inline')
   */
  type(): string {
    return this._data.type || 'inline'
  }

  /**
   * Get the raw data for copying (internal use)
   */
  getData(): ReferenceData {
    return this._data
  }

  /**
   * Get structured JSON representation of the reference
   */
  json(): ReferenceJson {
    const json: ReferenceJson = {
      template: this._data.template || 'citation',
      type: this._data.type || 'inline'
    }

    // Add name if present
    if (this._data.name) json.name = this._data.name

    // Add citation data if present
    if (this._data.title) json.title = this._data.title
    if (this._data.url) json.url = this._data.url
    if (this._data.author) json.author = this._data.author
    if (this._data.date) json.date = this._data.date
    if (this._data.publisher) json.publisher = this._data.publisher
    if (this._data.work) json.work = this._data.work
    if (this._data.newspaper) json.newspaper = this._data.newspaper
    if (this._data.journal) json.journal = this._data.journal
    if (this._data.website) json.website = this._data.website
    if (this._data.accessDate) json.accessDate = this._data.accessDate
    if (this._data.encyclopedia) json.encyclopedia = this._data.encyclopedia

    // Add inline text if present
    if (this._data.inline) {
      json.inline = this._data.inline.json()
    }

    return json
  }
}

// ============================================================================
// REFERENCE PARSING
// ============================================================================

/**
 * Check if a string contains a structured citation template
 */
function hasCitation(str: string): boolean {
  return PATTERNS.CITATION_START.test(str) &&
    PATTERNS.CITATION_END.test(str) &&
    !PATTERNS.CITATION_NEEDED.test(str)
}

/**
 * Parse a citation template into structured data
 */
function parseCitation(tmpl: string): ReferenceData {
  const obj = parseTemplateParams(tmpl)

  // Get the template name and extract citation type
  const templateName = (obj['template'] as string) || ''
  const type = templateName.replace(/^cite /, '').replace(/^citation$/, 'general')

  const data: ReferenceData = {
    template: 'citation',
    type: type || 'general'
  }

  // Extract common citation fields
  const getString = (key: string): string => {
    const val = obj[key]
    if (!val) return ''
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && 'text' in val) return (val as Sentence).text()
    return String(val)
  }

  // Map citation template parameters to our data structure
  if (getString('title')) data.title = getString('title')
  if (getString('url')) data.url = getString('url')
  if (getString('author') || getString('last') || getString('author1')) {
    const author = getString('author') || getString('last') || getString('author1')
    const first = getString('first') || getString('first1')
    data.author = first ? `${author}, ${first}` : author
  }
  if (getString('date') || getString('year')) {
    data.date = getString('date') || getString('year')
  }
  if (getString('publisher')) data.publisher = getString('publisher')
  if (getString('work')) data.work = getString('work')
  if (getString('newspaper')) data.newspaper = getString('newspaper')
  if (getString('journal')) data.journal = getString('journal')
  if (getString('website')) data.website = getString('website')
  if (getString('access-date') || getString('accessdate')) {
    data.accessDate = getString('access-date') || getString('accessdate')
  }
  if (getString('encyclopedia')) data.encyclopedia = getString('encyclopedia')

  return data
}

/**
 * Parse inline (unstructured) reference text
 */
function parseInline(str: string): ReferenceData {
  const sentence = parseSentence(str)
  return {
    template: 'citation',
    type: 'inline',
    inline: sentence
  }
}

/**
 * Extract the name attribute from a ref tag
 */
function extractRefName(tag: string): string | undefined {
  const match = tag.match(PATTERNS.REF_NAME)
  return match ? match[1] : undefined
}

/**
 * Parse references from wiki text
 * Returns { references, wiki } where wiki has refs replaced with spaces
 */
export function parseReferences(wiki: string): { references: Reference[]; wiki: string } {
  const references: Reference[] = []
  const namedRefs: Map<string, Reference> = new Map()

  // Parse <ref>...</ref> (anonymous refs) - use pre-compiled pattern
  wiki = wiki.replace(PATTERNS.REF_ANON, (all, txt: string) => {
    let found = false

    // Check for citation templates inside the ref
    const templates = findTemplates(txt)
    for (const tmpl of templates) {
      if (hasCitation(tmpl.body)) {
        const data = parseCitation(tmpl.body)
        references.push(new Reference(data, all))
        found = true
        break // Only process first citation template
      }
    }

    // If no citation template found, parse as inline reference
    if (!found) {
      const data = parseInline(txt)
      references.push(new Reference(data, all))
    }

    return ' '
  })

  // Parse <ref name="...">...</ref> (named refs with content) - use pre-compiled pattern
  wiki = wiki.replace(PATTERNS.REF_NAMED, (all, attrs: string, txt: string) => {
    const name = extractRefName(attrs)
    let found = false

    // Check for citation templates inside the ref
    const templates = findTemplates(txt)
    for (const tmpl of templates) {
      if (hasCitation(tmpl.body)) {
        const data = parseCitation(tmpl.body)
        if (name) data.name = name
        const ref = new Reference(data, all)
        references.push(ref)
        if (name) namedRefs.set(name, ref)
        found = true
        break
      }
    }

    // If no citation template found, parse as inline reference
    if (!found) {
      const data = parseInline(txt)
      if (name) data.name = name
      const ref = new Reference(data, all)
      references.push(ref)
      if (name) namedRefs.set(name, ref)
    }

    return ' '
  })

  // Parse <ref name="..." /> (reference reuse - self-closing) - use pre-compiled pattern
  wiki = wiki.replace(PATTERNS.REF_SELF_CLOSE, (all, attrs: string) => {
    const name = extractRefName(attrs)
    if (name && namedRefs.has(name)) {
      // Reuse the existing reference - copy the data structure
      const existingRef = namedRefs.get(name)!
      const data = existingRef.getData()
      references.push(new Reference({ ...data }, all))
    } else if (name) {
      // Named ref that references a definition elsewhere (or not yet seen)
      references.push(new Reference({ template: 'citation', type: 'reuse', name }, all))
    }
    return ' '
  })

  return { references, wiki }
}
