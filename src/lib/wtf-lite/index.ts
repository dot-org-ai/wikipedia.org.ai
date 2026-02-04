/**
 * wtf-lite: Full-featured Wikipedia markup parser
 * Optimized for Cloudflare Snippets - data loaded from CDN
 *
 * Features: dates, coords, sports, currency, infoboxes, links, categories
 */

// ============================================================================
// TYPE RE-EXPORTS - For library consumers
// ============================================================================
export type {
  // CDN/Config types
  WtfData,
  WtfOptions,
  // Core data structures
  LinkData,
  LinkJson,
  SentenceData,
  SentenceJson,
  InfoboxJson,
  SectionJson,
  DocumentJson,
  ImageData,
  ImageJson,
  // Table types
  TableCellJson,
  TableRowJson,
  TableJson,
  // Reference types
  ReferenceData,
  ReferenceJson,
  // Template types
  Coordinate,
  DateTemplate,
  GoalTemplate,
  GoalData,
  PlayerTemplate,
  TeamStats,
  SportsTableTemplate,
  BracketMatchTeam,
  PlayoffBracketTemplate,
  ParsedTemplate,
  TemplateParams,
} from './types.js'

// ============================================================================
// CLASS RE-EXPORTS
// ============================================================================
export { Link, Sentence } from './links.js'
export { Document, Section, Paragraph, Infobox, List } from './classes.js'
export { Image } from './image.js'
export { Table } from './table.js'
export { Reference } from './reference.js'

// Fast mode for snippets (5ms CPU limit)
export { fastParse, parseSummary, parseInfoboxOnly, parseLinksOnly, parseCategoriesOnly } from './fast.js'
export type { FastDocument, FastLink, FastInfobox, SummaryResult, InfoboxResult, LinksResult, CategoriesResult } from './fast.js'

// Single-pass scanner (experimental - for advanced use)
export { scan, processMarkers, fastScanParse } from './scanner.js'
export type { Marker, MarkerType, ScanResult, ProcessResult, FastScanDocument } from './scanner.js'

// Parsing options for lazy parsing
export type { ParseOptions } from './classes.js'

// ============================================================================
// CDN DATA LOADING
// ============================================================================
import { CDN_URL, setData } from './constants.js'
import type { WtfData } from './types.js'
import { Document } from './classes.js'

/**
 * Load data from CDN (async, optional)
 * Call this to load extended i18n data for better parsing
 */
export async function loadData(url?: string): Promise<void> {
  try {
    const res = await fetch(url || CDN_URL)
    if (res.ok) setData(await res.json() as WtfData)
  } catch (err) {
    console.debug('[wtf-lite] CDN data load failed, using inline defaults:', err instanceof Error ? err.message : err)
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================
import type { ParseOptions } from './classes.js'

/**
 * Parse Wikipedia markup into a Document
 * @param wiki - The raw wikitext to parse
 * @param options - Optional configuration (title, parsing options for lazy parsing)
 * @returns A Document instance with parsed content
 *
 * @example
 * // Full parse (default)
 * const doc = wtf(wiki)
 *
 * @example
 * // Summary only - skip infobox, tables, refs
 * const doc = wtf(wiki, {
 *   parseInfobox: false,
 *   parseTables: false,
 *   parseRefs: false,
 *   maxSections: 1,
 *   firstParagraphOnly: true
 * })
 *
 * @example
 * // Infobox only - skip section content parsing
 * const doc = wtf(wiki, {
 *   parseTables: false,
 *   parseRefs: false,
 *   parseTemplates: false,  // Skip most template parsing
 *   parseInfobox: true,     // But still parse infoboxes
 *   maxSections: 1
 * })
 */
export default function wtf(wiki: string, options?: ParseOptions): Document {
  return new Document(wiki, options)
}
