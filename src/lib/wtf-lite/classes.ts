/**
 * Document, Section, Paragraph, Infobox, List classes for wtf-lite
 */

import type { ParsedTemplate } from './types'
import { Link, Sentence, parseSentence, parseLinks, splitSentences } from './links'
import { Image } from './image'
import { Reference, parseReferences } from './reference'
import { Table, findTables } from './table'
import {
  DATA, CATEGORIES, INFOBOXES, REDIRECTS, MONTHS, DAYS, CURRENCY,
  REF_SECTION_NAMES
} from './constants'
import { preProcess, trim, findTemplates } from './utils'
import {
  parseTemplateParams,
  parseBirthDate, parseDeathDate, parseStartDate, parseAsOf,
  parseCoord, parseCurrency,
  parseGoal, parsePlayer, parseSportsTable, parsePlayoffBracket,
  parseConvert, parseFraction, parseVal, parseSortname,
  parseHorizontalList, parseUnbulletedList, parseBulletedList,
  parseURL, parseNihongo,
  // New template parsers
  HARDCODED, EASY_INLINE, ZEROS, TABLE_CELLS, SHIP_PREFIXES,
  ABBREVIATIONS, PRONOUNS,
  parseAge, parseAgeYM, parseAgeYMD, parseTimeAgo,
  parseBirthYearAge, parseDeathYearAge, parseReign, parseOldStyleDate,
  parseFirstWord, parseLastWord, parseTrunc, parseReplace,
  parseSmall, parseRadic, parseDecade, parseCentury, parseMillennium,
  parseDec, parseRA, parseBrSeparated, parseCommaSeparated,
  parseAnchoredList, parsePagelist, parseCatlist, parseTerm, parseLinum,
  parseBlockIndent, parsePercentage, parsePlural, parseMin, parseMax,
  parseRound, parseFormatNum, parseHexadecimal, parseHex2Dec, parseAbbrlink,
  parseLc, parseUc, parseUcfirst, parseLcfirst, parseTitleCase,
  parseBraces, parseTl, parseAbbr, parseLiteralTranslation,
  parseMetro, parseSubway, parseTram, parseFerry, parseLrtStation, parseMrtStation,
  parseShip, parseAutoLink, parseTableCell, parseEasyInline, parseZero,
  parseAbbreviation, parseSportsYear, parseMusic, parseUsPolAbbr, parseUshr,
  parseFontColor, parseColoredLink, parseGaps, parseAngleBracket, parseBracket,
  parseMarriage, resolveTemplateAlias
} from './templates'

// ============================================================================
// LIST CLASS
// ============================================================================
export class List {
  private _data: Sentence[]
  constructor(data: Sentence[]) { this._data = data }
  lines(): Sentence[] { return this._data }
  links(): Link[] { return this._data.flatMap(s => s.links()) }
  text(): string { return this._data.map(s => ' * ' + s.text()).join('\n') }
}

// ============================================================================
// INFOBOX CLASS
// ============================================================================
export class Infobox {
  private _type: string
  data: Record<string, Sentence>
  constructor(obj: { type: string; data: Record<string, Sentence> }) { this._type = obj.type; this.data = obj.data || {} }
  type(): string { return this._type }
  links(): Link[] { return Object.values(this.data).flatMap(s => s?.links?.() || []) }
  get(key: string): Sentence {
    const k = (key || '').toLowerCase().replace(/[-_]/g, ' ').trim()
    for (const [name, val] of Object.entries(this.data)) {
      if (name.toLowerCase().replace(/[-_]/g, ' ').trim() === k) return val
    }
    return new Sentence()
  }
  keyValue(): Record<string, string> {
    const h: Record<string, string> = {}
    for (const [k, v] of Object.entries(this.data)) if (v) h[k] = v.text()
    return h
  }
  json(): object { return { type: this._type, data: this.keyValue() } }
}

// ============================================================================
// PARAGRAPH CLASS
// ============================================================================
export class Paragraph {
  private _sentences: Sentence[]
  private _lists: List[]
  constructor(data: { sentences: Sentence[]; lists: List[] }) { this._sentences = data.sentences; this._lists = data.lists }
  sentences(): Sentence[] { return this._sentences }
  lists(): List[] { return this._lists }
  links(): Link[] { return this._sentences.flatMap(s => s.links()) }
  text(): string {
    let str = this._sentences.map(s => s.text()).join(' ')
    this._lists.forEach(l => str += '\n' + l.text())
    return str
  }
}

// ============================================================================
// LIST PARSING
// ============================================================================
const listReg = /^[#*:;|]+/
const bulletReg = /^\*+[^:,|]{4}/
const numberReg = /^ ?#[^:,|]{4}/

function parseListItems(paragraph: { wiki: string; lists: List[] }): void {
  const lines = paragraph.wiki.split(/\n/g)
  const lists: Sentence[][] = []
  const theRest: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i]
    if (currentLine === undefined) continue
    if (listReg.test(currentLine) || bulletReg.test(currentLine) || numberReg.test(currentLine)) {
      const sub: Sentence[] = []
      let num = 1
      for (let o = i; o < lines.length; o++) {
        const innerLine = lines[o]
        if (innerLine === undefined) break
        if (!(listReg.test(innerLine) || bulletReg.test(innerLine) || numberReg.test(innerLine))) break
        let line = innerLine
        if (numberReg.test(line)) { line = line.replace(/^ ?#*/, num + ') ') + '\n'; num++ }
        else if (listReg.test(line)) { num = 1; line = line.replace(listReg, '') }
        sub.push(parseSentence(line))
      }
      i += sub.length - 1
      const filtered = sub.filter(s => s.text())
      if (filtered.length) lists.push(filtered)
    } else theRest.push(currentLine)
  }
  paragraph.lists = lists.map(l => new List(l))
  paragraph.wiki = theRest.join('\n')
}

// ============================================================================
// SECTION CLASS
// ============================================================================
export class Section {
  private _title: string
  private _depth: number
  private _wiki: string
  private _paragraphs: Paragraph[] = []
  private _infoboxes: Infobox[] = []
  private _templates: ParsedTemplate[] = []
  private _coordinates: { lat: number; lon: number }[] = []
  private _tables: Table[] = []
  private _references: Reference[] = []

  constructor(data: { title: string; depth: number; wiki: string }, doc: Document) {
    this._title = data.title || ''
    this._depth = data.depth
    this._wiki = data.wiki || ''

    // Parse tables before templates (tables may contain templates)
    this.parseTables()
    // Parse references BEFORE templates so citation templates inside refs are preserved
    const refResult = parseReferences(this._wiki)
    this._references = refResult.references
    this._wiki = refResult.wiki
    this.parseTemplates(doc)
    this.parseParagraphs()
  }

  title(): string { return this._title }
  depth(): number { return this._depth }
  /** Adjust section depth (used when filtering reference sections) */
  adjustDepth(delta: number): void { this._depth += delta }
  paragraphs(): Paragraph[] { return this._paragraphs }
  infoboxes(): Infobox[] { return this._infoboxes }
  templates(): ParsedTemplate[] { return this._templates }
  coordinates(): { lat: number; lon: number }[] { return this._coordinates }
  /** Get tables from this section */
  tables(): Table[] { return this._tables }
  /** Get all references in this section */
  references(): Reference[] { return this._references }
  sentences(): Sentence[] { return this._paragraphs.flatMap(p => p.sentences()) }
  links(): Link[] { return [...this._infoboxes.flatMap(i => i.links()), ...this.sentences().flatMap(s => s.links()), ...this.lists().flatMap(l => l.links()), ...this._tables.flatMap(t => t.links())] }
  lists(): List[] { return this._paragraphs.flatMap(p => p.lists()) }
  text(): string { return this._paragraphs.map(p => p.text()).join('\n\n') }

  private parseTables(): void {
    const result = findTables(this._wiki)
    this._tables = result.tables
    this._wiki = result.wiki
  }

  private parseTemplates(_doc: Document): void {
    const templates = findTemplates(this._wiki)
    const infos = DATA?.infoboxes || INFOBOXES
    const infoReg = new RegExp('^(subst.)?(' + infos.join('|') + ')(?=:| |\\n|$)', 'i')
    const hardcodedCdn = DATA?.hardcoded || {}
    const pronounsCdn = DATA?.pronouns || []

    // Collect replacements: { start, end, replacement }
    const replacements: { start: number; end: number; text: string }[] = []

    for (const tmpl of templates) {
      // Resolve aliases first
      const name = resolveTemplateAlias(tmpl.name.toLowerCase())
      let replacement = ''

      // Infobox templates
      if (infoReg.test(name) || /^infobox /i.test(name) || / infobox$/i.test(name)) {
        const obj = parseTemplateParams(tmpl.body, 'raw')
        let type = (obj['template'] as string) || ''
        const m = type.match(infoReg)
        if (m?.[0]) type = type.replace(m[0], '').trim()
        delete obj['template']; delete obj['list']
        this._infoboxes.push(new Infobox({ type, data: obj as Record<string, Sentence> }))
      }
      // Coordinate templates
      else if (name === 'coord' || name.startsWith('coor')) {
        const coord = parseCoord(tmpl.body)
        if (coord.lat && coord.lon) {
          this._coordinates.push({ lat: coord.lat, lon: coord.lon })
          this._templates.push(coord)
          const display = coord.display || 'inline'
          if (display.includes('inline')) {
            replacement = `${coord.lat}°${coord.latDir}, ${coord.lon}°${coord.lonDir}`
          }
        }
      }
      // Date templates
      else if (name === 'birth date and age' || name === 'bda' || name === 'birth date') {
        replacement = parseBirthDate(tmpl.body, this._templates)
      } else if (name === 'death date and age' || name === 'death date') {
        replacement = parseDeathDate(tmpl.body, this._templates)
      } else if (name === 'start date' || name === 'end date' || name === 'start' || name === 'end' || name === 'start date and age' || name === 'end date and age') {
        replacement = parseStartDate(tmpl.body, this._templates)
      } else if (name === 'birth year and age') {
        replacement = parseBirthYearAge(tmpl.body)
      } else if (name === 'death year and age') {
        replacement = parseDeathYearAge(tmpl.body)
      } else if (name === 'age' || name === 'age nts') {
        replacement = parseAge(tmpl.body)
      } else if (name === 'age in years' || name === 'diff-y') {
        replacement = parseAge(tmpl.body) + ' years'
      } else if (name === 'age in years and months' || name === 'diff-ym') {
        replacement = parseAgeYM(tmpl.body)
      } else if (name === 'age in years, months and days' || name === 'diff-ymd') {
        replacement = parseAgeYMD(tmpl.body)
      } else if (name === 'time ago') {
        replacement = parseTimeAgo(tmpl.body)
      } else if (name === 'reign' || name === 'r.') {
        replacement = parseReign(tmpl.body)
      } else if (name === 'oldstyledate') {
        replacement = parseOldStyleDate(tmpl.body)
      } else if (name === 'as of') {
        replacement = parseAsOf(tmpl.body)
      }
      // Current date/time
      else if (name === 'currentday' || name === 'localday') {
        replacement = String(new Date().getDate())
      } else if (name === 'currentmonth' || name === 'currentmonthname' || name === 'localmonth' || name === 'currentmonthabbrev') {
        replacement = MONTHS[new Date().getMonth()] ?? ''
      } else if (name === 'currentyear' || name === 'localyear') {
        replacement = String(new Date().getFullYear())
      } else if (name === 'currentdayname' || name === 'localdayname') {
        replacement = DAYS[new Date().getDay()] ?? ''
      } else if (name === 'monthyear') {
        const d = new Date()
        replacement = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
      }
      // Currency templates
      else if (CURRENCY[name] || name === 'currency') {
        replacement = parseCurrency(tmpl.body)
      }
      // Sports templates
      else if (name === 'goal') {
        replacement = parseGoal(tmpl.body, this._templates)
      } else if (name === 'player') {
        replacement = parsePlayer(tmpl.body, this._templates)
      } else if (name === 'sports table') {
        parseSportsTable(tmpl.body, this._templates)
      } else if (name === '4teambracket' || name.includes('teambracket')) {
        parsePlayoffBracket(tmpl.body, this._templates)
      } else if (['baseball year', 'by', 'mlb year', 'nlds year', 'nldsy', 'alds year', 'aldsy', 'nfl year', 'nfl playoff year', 'nba year'].includes(name)) {
        replacement = parseSportsYear(tmpl.body)
      }
      // Math/conversion templates
      else if (name === 'convert' || name === 'cvt') {
        replacement = parseConvert(tmpl.body)
      } else if (name === 'fraction' || name === 'frac' || name === 'sfrac') {
        replacement = parseFraction(tmpl.body)
      } else if (name === 'val') {
        replacement = parseVal(tmpl.body)
      } else if (name === 'radic' || name === 'sqrt') {
        replacement = parseRadic(tmpl.body)
      } else if (name === 'percentage' || name === 'pct') {
        replacement = parsePercentage(tmpl.body)
      } else if (name === 'min') {
        replacement = parseMin(tmpl.body)
      } else if (name === 'max') {
        replacement = parseMax(tmpl.body)
      } else if (name === 'round') {
        replacement = parseRound(tmpl.body)
      } else if (name === 'formatnum') {
        replacement = parseFormatNum(tmpl.body)
      } else if (name === 'hexadecimal') {
        replacement = parseHexadecimal(tmpl.body)
      } else if (name === 'hex2dec' || name === 'h2d') {
        replacement = parseHex2Dec(tmpl.body)
      } else if (name === 'dec') {
        replacement = parseDec(tmpl.body)
      } else if (name === 'ra') {
        replacement = parseRA(tmpl.body)
      } else if (name === 'decade') {
        replacement = parseDecade(tmpl.body)
      } else if (name === 'century') {
        replacement = parseCentury(tmpl.body)
      } else if (name === 'millennium') {
        replacement = parseMillennium(tmpl.body)
      } else if (name === 'plural') {
        replacement = parsePlural(tmpl.body)
      }
      // List templates
      else if (name === 'hlist' || name === 'plainlist' || name === 'flatlist' || name === 'plain list') {
        replacement = parseHorizontalList(tmpl.body)
      } else if (name === 'ubl' || name === 'ubil' || name === 'unbulleted list' || name === 'collapsible list') {
        replacement = parseUnbulletedList(tmpl.body)
      } else if (name === 'bulleted list') {
        replacement = parseBulletedList(tmpl.body)
      } else if (name === 'br separated entries') {
        replacement = parseBrSeparated(tmpl.body)
      } else if (name === 'comma separated entries') {
        replacement = parseCommaSeparated(tmpl.body)
      } else if (name === 'anchored list' || name === 'bare anchored list') {
        replacement = parseAnchoredList(tmpl.body)
      } else if (name === 'pagelist') {
        replacement = parsePagelist(tmpl.body)
      } else if (name === 'catlist') {
        replacement = parseCatlist(tmpl.body)
      } else if (name === 'term') {
        replacement = parseTerm(tmpl.body)
      } else if (name === 'linum') {
        replacement = parseLinum(tmpl.body)
      } else if (name === 'block indent') {
        replacement = parseBlockIndent(tmpl.body)
      } else if (name === 'gaps') {
        replacement = parseGaps(tmpl.body)
      }
      // Text manipulation templates
      else if (name === 'sortname') {
        replacement = parseSortname(tmpl.body)
      } else if (name === 'first word') {
        replacement = parseFirstWord(tmpl.body)
      } else if (name === 'last word') {
        replacement = parseLastWord(tmpl.body)
      } else if (name === 'trunc' || name === 'str left' || name === 'str crop') {
        replacement = parseTrunc(tmpl.body)
      } else if (name === 'replace' || name === 'str rep') {
        replacement = parseReplace(tmpl.body)
      } else if (name === 'small') {
        replacement = parseSmall(tmpl.body)
      } else if (name === 'lc') {
        replacement = parseLc(tmpl.body)
      } else if (name === 'uc') {
        replacement = parseUc(tmpl.body)
      } else if (name === 'ucfirst') {
        replacement = parseUcfirst(tmpl.body)
      } else if (name === 'lcfirst') {
        replacement = parseLcfirst(tmpl.body)
      } else if (name === 'title case') {
        replacement = parseTitleCase(tmpl.body)
      } else if (name === 'braces') {
        replacement = parseBraces(tmpl.body)
      } else if (name === 'tl' || name === 'tlu' || name === 'tl2' || name === 'demo') {
        replacement = parseTl(tmpl.body)
      } else if (name === 'angle bracket' || name === 'angbr') {
        replacement = parseAngleBracket(tmpl.body)
      } else if (name === 'bracket' || name === 'brackets') {
        replacement = parseBracket(tmpl.body)
      }
      // Link templates
      else if (name === 'url') {
        replacement = parseURL(tmpl.body)
      } else if (name === 'abbrlink') {
        replacement = parseAbbrlink(tmpl.body)
      } else if (name === 'auto link' || name === 'no redirect' || name === 'bl') {
        replacement = parseAutoLink(tmpl.body)
      } else if (name === 'colored link') {
        replacement = parseColoredLink(tmpl.body)
      }
      // Transit templates
      else if (name === 'metro' || name === 'metrod' || name === 'station' || name === 'stn') {
        replacement = parseMetro(tmpl.body)
      } else if (name === 'subway') {
        replacement = parseSubway(tmpl.body)
      } else if (name === 'tram') {
        replacement = parseTram(tmpl.body)
      } else if (name === 'ferry' || name === 'fw') {
        replacement = parseFerry(tmpl.body)
      } else if (name === 'lrt station' || name === 'lrt' || name === 'lrts') {
        replacement = parseLrtStation(tmpl.body)
      } else if (name === 'mrt station' || name === 'mrt' || name === 'mrts') {
        replacement = parseMrtStation(tmpl.body)
      }
      // Ship templates
      else if (SHIP_PREFIXES.includes(name)) {
        replacement = parseShip(tmpl.body)
      }
      // Language templates
      else if (name === 'nihongo' || name === 'nihongo2' || name === 'nihongo3' || name === 'nihongo-s' || name === 'nihongo foot') {
        replacement = parseNihongo(tmpl.body)
      } else if (name.startsWith('lang-') || name.startsWith('lang ')) {
        // Language templates - just extract the text
        replacement = parseZero(tmpl.body)
      }
      // Abbreviation templates
      else if (name === 'abbr' || name === 'tooltip' || name === 'abbrv' || name === 'define') {
        replacement = parseAbbr(tmpl.body)
      } else if (name === 'literal translation' || name === 'lit' || name === 'literal') {
        replacement = parseLiteralTranslation(tmpl.body)
      } else if (ABBREVIATIONS.some(a => a[0] === name)) {
        replacement = parseAbbreviation(tmpl.body)
      }
      // Marriage template
      else if (name === 'marriage' || name === 'married') {
        replacement = parseMarriage(tmpl.body)
      }
      // US politics templates
      else if (name === 'uspolabbr') {
        replacement = parseUsPolAbbr(tmpl.body)
      } else if (name === 'ushr' || name === 'ushr2') {
        replacement = parseUshr(tmpl.body)
      }
      // Music template
      else if (name === 'music') {
        replacement = parseMusic(tmpl.body)
      }
      // Font/color templates
      else if (name === 'font color') {
        replacement = parseFontColor(tmpl.body)
      }
      // Indicator templates
      else if (name === 'increase' || name === 'up' || name === 'gain') {
        replacement = '▲'
      } else if (name === 'decrease' || name === 'down' || name === 'loss') {
        replacement = '▼'
      } else if (name === 'steady' || name === 'no change') {
        replacement = '▬'
      }
      // Table cell templates
      else if (TABLE_CELLS.includes(name)) {
        replacement = parseTableCell(tmpl.body)
      }
      // Easy inline templates (extract specific parameter)
      else if (EASY_INLINE[name] !== undefined) {
        replacement = parseEasyInline(tmpl.body)
      }
      // Zero templates (extract first parameter)
      else if (ZEROS.includes(name)) {
        replacement = parseZero(tmpl.body)
      }
      // Hardcoded symbol templates
      else if (HARDCODED[name]) {
        replacement = HARDCODED[name]
      } else if (hardcodedCdn[name]) {
        replacement = hardcodedCdn[name]
      }
      // Pronoun templates
      else if (PRONOUNS.includes(name) || pronounsCdn.includes(name)) {
        replacement = name
      }
      // All other templates: replacement stays ''

      replacements.push({ start: tmpl.start, end: tmpl.end, text: replacement })
    }

    // Apply all replacements in one pass (sorted by position)
    if (replacements.length > 0) {
      replacements.sort((a, b) => a.start - b.start)
      const parts: string[] = []
      let lastEnd = 0
      for (const r of replacements) {
        if (r.start > lastEnd) {
          parts.push(this._wiki.slice(lastEnd, r.start))
        }
        parts.push(r.text)
        lastEnd = Math.max(lastEnd, r.end)
      }
      if (lastEnd < this._wiki.length) {
        parts.push(this._wiki.slice(lastEnd))
      }
      this._wiki = parts.join('')
    }
  }

  private parseParagraphs(): void {
    const paras = this._wiki.split(/\r?\n\r?\n/).filter(p => p?.trim())
    this._paragraphs = paras.map(str => {
      const p: { wiki: string; lists: List[]; sentences: Sentence[] } = { wiki: str, lists: [], sentences: [] }
      parseListItems(p)
      p.sentences = splitSentences(p.wiki).map(parseSentence)
      if (p.sentences[0]?.text()?.startsWith(':')) p.sentences = p.sentences.slice(1)
      return new Paragraph(p)
    })
  }
}

// ============================================================================
// SECTION PARSING
// ============================================================================
const sectionReg = /(?:\n|^)(={2,6}[^=\n]{1,200}?={2,6})/g
const headingReg = /^(={1,6})([^=\n]{1,200}?)={1,6}$/

export function parseSections(doc: Document): Section[] {
  const wiki = doc.wiki()
  const splits = wiki.split(sectionReg)
  const sections: Section[] = []
  for (let i = 0; i < splits.length; i += 2) {
    const heading = splits[i - 1] || '', content = splits[i] || ''
    if (!content && !heading) continue
    let title = '', depth = 0
    const m = heading.match(headingReg)
    if (m) { title = trim(parseSentence(m[2] || '').text()); depth = m[1] ? m[1].length - 2 : 0 }
    sections.push(new Section({ title, depth, wiki: content }, doc))
  }
  return sections.filter((s, i) => {
    const refReg = new RegExp('^(' + REF_SECTION_NAMES.join('|') + '):?', 'i')
    if (refReg.test(s.title())) {
      if (s.paragraphs().length || s.templates().length) return true
      const nextSection = sections[i + 1]
      if (nextSection && nextSection.depth() > s.depth()) nextSection.adjustDepth(-1)
      return false
    }
    return true
  })
}

// ============================================================================
// DOCUMENT CLASS
// ============================================================================
export class Document {
  private _wiki: string
  private _title: string | null
  private _categories: string[] = []
  private _sections: Section[] = []
  private _images: Image[] = []
  private _type: string = 'page'
  private _redirectTo: Link | null = null

  constructor(wiki: string, options: { title?: string } = {}) {
    this._wiki = wiki || ''
    this._title = options.title || null

    const reds = DATA?.redirects || REDIRECTS
    const redirectReg = new RegExp('^\\s*#(' + reds.join('|') + ')\\s*(\\[\\[[^\\]]{2,180}?\\]\\])', 'i')

    if (redirectReg.test(this._wiki)) {
      this._type = 'redirect'
      const m = this._wiki.match(redirectReg)
      if (m?.[2]) {
        const links = parseLinks(m[2])
        this._redirectTo = links[0] || null
      }
      this.parseCategories()
      return
    }

    const processed = preProcess(this._wiki)
    this._wiki = processed.text
    this._images = processed.images
    this.parseCategories()
    this._sections = parseSections(this)
  }

  private parseCategories(): void {
    const cats = DATA?.categories || CATEGORIES
    const catReg = new RegExp('\\[\\[(' + cats.join('|') + '):([^\\]]{2,178}?)\\]\\](\\w{0,10})', 'gi')
    const catRemoveReg = new RegExp('^\\[\\[:?(' + cats.join('|') + '):', 'gi')
    const matches = this._wiki.match(catReg) || []
    for (let c of matches) {
      c = c.replace(catRemoveReg, '').replace(/\|?[ *]?\]\]$/, '').replace(/\|.*/, '')
      if (c && !c.match(/[[\]]/)) this._categories.push(c.trim())
    }
    this._wiki = this._wiki.replace(catReg, '')
  }

  /** Get the raw wiki source text */
  wiki(): string { return this._wiki }
  title(s?: string): string | null { if (s !== undefined) { this._title = s; return s }; return this._title || this.sentences()[0]?.bold() || null }
  isRedirect(): boolean { return this._type === 'redirect' }
  redirectTo(): Link | null { return this._redirectTo }
  categories(n?: number): string[] { return typeof n === 'number' ? [this._categories[n] ?? ''] : this._categories }
  sections(clue?: string | number): Section[] {
    if (typeof clue === 'string') return this._sections.filter(s => s.title().toLowerCase() === clue.toLowerCase().trim())
    if (typeof clue === 'number') { const sec = this._sections[clue]; return sec ? [sec] : [] }
    return this._sections
  }
  paragraphs(): Paragraph[] { return this._sections.flatMap(s => s.paragraphs()) }
  sentences(): Sentence[] { return this._sections.flatMap(s => s.sentences()) }
  links(): Link[] { return this._sections.flatMap(s => s.links()) }
  /** Get all images from the document */
  images(n?: number): Image[] { return typeof n === 'number' ? (this._images[n] ? [this._images[n]!] : []) : this._images }
  /** Get the first/main image if available */
  image(): Image | null { return this._images[0] || null }
  infoboxes(): Infobox[] { return this._sections.flatMap(s => s.infoboxes()).sort((a, b) => Object.keys(b.data).length - Object.keys(a.data).length) }
  coordinates(): { lat: number; lon: number }[] { return this._sections.flatMap(s => s.coordinates()) }
  templates(): ParsedTemplate[] { return this._sections.flatMap(s => s.templates()) }
  /** Get all tables from the document */
  tables(): Table[] { return this._sections.flatMap(s => s.tables()) }
  /** Get all references from the document */
  references(): Reference[] { return this._sections.flatMap(s => s.references()) }
  text(): string { return this.isRedirect() ? '' : this._sections.map(s => s.text()).join('\n\n') }
  json(): object {
    return {
      title: this.title(),
      categories: this.categories(),
      coordinates: this.coordinates(),
      images: this._images.map(i => i.json()),
      sections: this._sections.map(s => ({
        title: s.title(),
        depth: s.depth(),
        paragraphs: s.paragraphs().map(p => ({ sentences: p.sentences().map(sen => sen.json()) })),
        infoboxes: s.infoboxes().map(i => i.json()),
        tables: s.tables().map(t => t.json())
      }))
    }
  }
}
