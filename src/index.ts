/**
 * wikipedia.org.ai - Main Library Entry Point
 *
 * This module re-exports key functionality from the various sub-modules
 * for convenient access by library consumers.
 */

// ============================================================================
// WTF-LITE PARSER - Lightweight Wikipedia markup parser
// ============================================================================
export {
  default as wtf,
  loadData as loadWtfData,
  Document,
  Section,
  Paragraph,
  Sentence,
  Link,
  Infobox,
  List,
} from './lib/wtf-lite/index.js'

// Re-export all types from wtf-lite
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
} from './lib/wtf-lite/index.js'
