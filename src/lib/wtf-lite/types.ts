/**
 * TypeScript interfaces and types for wtf-lite
 *
 * These types are exported for library consumers to properly type their code
 * when working with the wtf-lite Wikipedia parser.
 */

// ============================================================================
// CDN/CONFIG TYPES
// ============================================================================

/** CDN data structure for Wikipedia parsing configuration */
export interface WtfData {
  categories?: string[] | undefined
  infoboxes?: string[] | undefined
  redirects?: string[] | undefined
  currency?: Record<string, string> | undefined
  flags?: [string, string, string][] | undefined
  hardcoded?: Record<string, string> | undefined
  pronouns?: string[] | undefined
}

// ============================================================================
// CORE DATA STRUCTURES
// ============================================================================

/** Link data structure */
export interface LinkData {
  page?: string | undefined
  text?: string | undefined
  type?: string | undefined
  anchor?: string | undefined
  site?: string | undefined
  raw?: string | undefined
}

/** JSON representation of a Link */
export interface LinkJson {
  text: string
  type: string
  page: string | undefined
  anchor: string | undefined
}

/** Sentence data structure */
export interface SentenceData {
  text?: string | undefined
  links?: LinkData[] | undefined
  fmt?: { bold?: string[] | undefined; italic?: string[] | undefined } | undefined
}

/** JSON representation of a Sentence */
export interface SentenceJson {
  text: string
  links: LinkJson[]
}

/** JSON representation of an Infobox */
export interface InfoboxJson {
  type: string
  data: Record<string, string>
}

/** JSON representation of a Section */
export interface SectionJson {
  title: string
  depth: number
  paragraphs: { sentences: SentenceJson[] }[]
  infoboxes: InfoboxJson[]
}

/** JSON representation of a Document */
export interface DocumentJson {
  title: string | null
  categories: string[]
  coordinates: { lat: number; lon: number }[]
  sections: SectionJson[]
}

// ============================================================================
// TEMPLATE TYPES - Coordinate
// ============================================================================

/** Coordinate data from {{coord}} template */
export interface Coordinate {
  template: 'coord'
  lat: number
  lon: number
  latDir: 'N' | 'S'
  lonDir: 'E' | 'W'
  display?: string | undefined
}

// ============================================================================
// TEMPLATE TYPES - Dates
// ============================================================================

/** Date template result */
export interface DateTemplate {
  template: 'birth date' | 'death date' | 'start date'
  year?: string | undefined
  month?: string | undefined
  day?: string | undefined
}

// ============================================================================
// TEMPLATE TYPES - Sports
// ============================================================================

/** Goal template result */
export interface GoalTemplate {
  template: 'goal'
  data: GoalData[]
}

/** Individual goal data */
export interface GoalData {
  min: string
  note: string
}

/** Player template result */
export interface PlayerTemplate {
  template: 'player'
  number?: string | undefined
  country: string
  name?: string | undefined
}

/** Team statistics for sports tables */
export interface TeamStats {
  name?: string | undefined
  win: number
  loss: number
  tie: number
  goals_for: number
  goals_against: number
}

/** Sports table template result */
export interface SportsTableTemplate {
  template: 'sports table'
  date?: string | undefined
  teams: Record<string, TeamStats>
}

/** Playoff bracket match data */
export interface BracketMatchTeam {
  team?: string | undefined
  score?: string | undefined
  seed?: string | undefined
}

/** Playoff bracket template result */
export interface PlayoffBracketTemplate {
  template: 'playoffbracket'
  rounds: [BracketMatchTeam, BracketMatchTeam][][]
}

// ============================================================================
// UNION TYPES
// ============================================================================

/** Union type for all parsed templates */
export type ParsedTemplate =
  | Coordinate
  | DateTemplate
  | GoalTemplate
  | PlayerTemplate
  | SportsTableTemplate
  | PlayoffBracketTemplate

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Result from parseTemplateParams - allows flexible property access */
export type TemplateParams = Record<string, unknown>

/** Options for the wtf parser */
export interface WtfOptions {
  title?: string | undefined
}
