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

// Fast mode for snippets (5ms CPU limit)
export { fastParse } from './fast.js'
export type { FastDocument } from './fast.js'

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

/**
 * Parse Wikipedia markup into a Document
 * @param wiki - The raw wikitext to parse
 * @param options - Optional configuration (title, etc.)
 * @returns A Document instance with parsed content
 */
export default function wtf(wiki: string, options?: { title?: string }): Document {
  return new Document(wiki, options)
}
