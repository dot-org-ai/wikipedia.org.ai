/**
 * Document, Section, Paragraph, Infobox, List classes for wtf-lite
 */

import type { ParsedTemplate } from './types'
import { Link, Sentence, parseSentence, parseLinks, splitSentences } from './links'
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
  parseURL, parseNihongo
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

  constructor(data: { title: string; depth: number; wiki: string }, doc: Document) {
    this._title = data.title || ''
    this._depth = data.depth
    this._wiki = data.wiki || ''

    this.parseTemplates(doc)
    this._wiki = this._wiki.replace(/<ref[^>]*>(?:[^<]|<(?!\/ref>))*<\/ref>/gi, ' ').replace(/<ref[^>]*\/>/gi, ' ')
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
  sentences(): Sentence[] { return this._paragraphs.flatMap(p => p.sentences()) }
  links(): Link[] { return [...this._infoboxes.flatMap(i => i.links()), ...this.sentences().flatMap(s => s.links()), ...this.lists().flatMap(l => l.links())] }
  lists(): List[] { return this._paragraphs.flatMap(p => p.lists()) }
  text(): string { return this._paragraphs.map(p => p.text()).join('\n\n') }

  private parseTemplates(_doc: Document): void {
    const templates = findTemplates(this._wiki)
    const infos = DATA?.infoboxes || INFOBOXES
    const infoReg = new RegExp('^(subst.)?(' + infos.join('|') + ')(?=:| |\\n|$)', 'i')

    for (const tmpl of templates) {
      const name = tmpl.name.toLowerCase()

      if (infoReg.test(name) || /^infobox /i.test(name) || / infobox$/i.test(name)) {
        const obj = parseTemplateParams(tmpl.body, 'raw')
        let type = (obj['template'] as string) || ''
        const m = type.match(infoReg)
        if (m?.[0]) type = type.replace(m[0], '').trim()
        delete obj['template']; delete obj['list']
        this._infoboxes.push(new Infobox({ type, data: obj as Record<string, Sentence> }))
        this._wiki = this._wiki.replace(tmpl.body, '')
        continue
      }

      if (name === 'coord' || name.startsWith('coor')) {
        const coord = parseCoord(tmpl.body)
        if (coord.lat && coord.lon) {
          this._coordinates.push({ lat: coord.lat, lon: coord.lon })
          this._templates.push(coord)
          const display = coord.display || 'inline'
          if (display.includes('inline')) {
            this._wiki = this._wiki.replace(tmpl.body, `${coord.lat}°${coord.latDir}, ${coord.lon}°${coord.lonDir}`)
          } else {
            this._wiki = this._wiki.replace(tmpl.body, '')
          }
        }
        continue
      }

      if (name === 'birth date and age' || name === 'bda' || name === 'birth date') {
        const text = parseBirthDate(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'death date and age' || name === 'death date') {
        const text = parseDeathDate(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'start date' || name === 'end date' || name === 'start' || name === 'end') {
        const text = parseStartDate(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'currentday' || name === 'localday') {
        this._wiki = this._wiki.replace(tmpl.body, String(new Date().getDate()))
        continue
      }
      if (name === 'currentmonth' || name === 'currentmonthname' || name === 'localmonth') {
        this._wiki = this._wiki.replace(tmpl.body, MONTHS[new Date().getMonth()] ?? '')
        continue
      }
      if (name === 'currentyear' || name === 'localyear') {
        this._wiki = this._wiki.replace(tmpl.body, String(new Date().getFullYear()))
        continue
      }
      if (name === 'currentdayname' || name === 'localdayname') {
        this._wiki = this._wiki.replace(tmpl.body, DAYS[new Date().getDay()] ?? '')
        continue
      }
      if (name === 'as of') {
        const text = parseAsOf(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }

      if (CURRENCY[name] || name === 'currency') {
        const text = parseCurrency(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }

      if (name === 'goal') {
        const text = parseGoal(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'player') {
        const text = parsePlayer(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'sports table') {
        parseSportsTable(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, '')
        continue
      }
      if (name === '4teambracket' || name.includes('teambracket')) {
        parsePlayoffBracket(tmpl.body, this._templates)
        this._wiki = this._wiki.replace(tmpl.body, '')
        continue
      }

      if (name === 'convert' || name === 'cvt') {
        const text = parseConvert(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'fraction' || name === 'frac') {
        const text = parseFraction(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'val') {
        const text = parseVal(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'sortname') {
        const text = parseSortname(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'hlist' || name === 'plainlist' || name === 'flatlist') {
        const text = parseHorizontalList(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'ubl' || name === 'ubil' || name === 'unbulleted list') {
        const text = parseUnbulletedList(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'bulleted list') {
        const text = parseBulletedList(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'url') {
        const text = parseURL(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }
      if (name === 'nihongo' || name === 'nihongo2' || name === 'nihongo3' || name === 'nihongo-s' || name === 'nihongo foot') {
        const text = parseNihongo(tmpl.body)
        this._wiki = this._wiki.replace(tmpl.body, text)
        continue
      }

      const hardcoded = DATA?.hardcoded || {}
      if (hardcoded[name]) {
        this._wiki = this._wiki.replace(tmpl.body, hardcoded[name])
        continue
      }

      const pronouns = DATA?.pronouns || ['they', 'them', 'their', 'theirs', 'themself']
      if (pronouns.includes(name)) {
        this._wiki = this._wiki.replace(tmpl.body, name)
        continue
      }

      this._wiki = this._wiki.replace(tmpl.body, '')
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

    this._wiki = preProcess(this._wiki)
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
  infoboxes(): Infobox[] { return this._sections.flatMap(s => s.infoboxes()).sort((a, b) => Object.keys(b.data).length - Object.keys(a.data).length) }
  coordinates(): { lat: number; lon: number }[] { return this._sections.flatMap(s => s.coordinates()) }
  templates(): ParsedTemplate[] { return this._sections.flatMap(s => s.templates()) }
  text(): string { return this.isRedirect() ? '' : this._sections.map(s => s.text()).join('\n\n') }
  json(): object {
    return {
      title: this.title(),
      categories: this.categories(),
      coordinates: this.coordinates(),
      sections: this._sections.map(s => ({ title: s.title(), depth: s.depth(), paragraphs: s.paragraphs().map(p => ({ sentences: p.sentences().map(sen => sen.json()) })), infoboxes: s.infoboxes().map(i => i.json()) }))
    }
  }
}
