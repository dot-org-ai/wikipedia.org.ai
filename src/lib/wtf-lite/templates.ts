/**
 * Template parsing functions for wtf-lite Wikipedia parser
 *
 * This file contains 70+ template parsers ported from wtf_wikipedia:
 * - Hardcoded symbols (dots, dashes, math symbols, Greek letters)
 * - Date/time templates (age, duration, time ago)
 * - List templates (hlist, plainlist, br separated entries)
 * - Formatting templates (small, big, nowrap, nobold)
 * - Table cell templates (yes, no, maybe, etc.)
 * - Transit templates (metro, station, ferry)
 * - Ship link templates (hms, uss, ss, etc.)
 * - Math templates (min, max, round, percentage)
 * - Text manipulation (trunc, replace, first word, last word)
 * - Sports templates (goal, player, sports table)
 */

import type { TemplateParams, Coordinate, ParsedTemplate, TeamStats, BracketMatchTeam } from './types'
import { MONTHS, DATA, CURRENCY, FLAGS } from './constants'
import { findTemplates } from './utils'
import { parseSentence } from './links'

// ============================================================================
// HARDCODED SYMBOL TEMPLATES
// Maps template names to their text/symbol output
// ============================================================================

/**
 * Hardcoded templates that return simple text/symbols
 * Usage: HARDCODED['ndash'] => '–'
 */
export const HARDCODED: Record<string, string> = {
  // Punctuation & separators
  '·': '·', 'dot': '·', 'middot': '·', '•': ' • ',
  ',': ',', '=': '=', ';': ';', 'colon': ':', 'pipe': '|',
  '!': '|', "'": "'", '\\': ' /', '`': '`',
  '[': '[', '*': '*', 'asterisk': '*',

  // Dashes
  '–': '–', 'ndash': '–', 'en dash': '–',
  '—': '—', 'mdash': '—', 'em dash': '—',
  'spd': ' – ', 'snds': ' – ', 'snd': ' – ',
  'spaced ndash': ' – ', 'long dash': '———',
  'mdashb': '—‌', 'spaced en dash': ' –', 'spaced en dash space': ' – ',

  // Fractions
  '1/2': '1⁄2', '1/3': '1⁄3', '2/3': '2⁄3', '1/4': '1⁄4', '3/4': '3⁄4',

  // Symbols
  'number sign': '#', 'hash-tag': '#', 'no.': '#',
  'ibeam': 'I', '&': '&', 'ampersand': '&',
  'dagger': '†', 'double-dagger': '‡',
  '^': ' ', '-?': '?',
  'flat': '♭', 'sharp': '♯',
  'lbf': 'lbF', 'lbm': 'lbm',
  'tombstone': '◻', 'ell': 'ℓ',
  'shy': '-',

  // Spacing
  'clear': '\n\n', 'zwsp': ' ', 'sp': ' ', 'px2': ' ',
  'indent': '    ', 'nb5': '    ', 'ns': '    ',
  'quad': '    ', 'spaces': '    ', 'in5': '     ',
  'thin space': ' ', 'thinspace': ' ', 'very thin space': ' ',
  'word joiner': ' ', 'figure space': ' ', 'zero width joiner': ' ',
  'hair space': ' ', 'narrow no-break space': ' ', 'non breaking hyphen': '-',

  // Wiki escapes
  '!((': '[[', '))!': ']]',
  '(': '{', '((': '{{', '(((': '{{{',
  ')': '}', '))': '}}', ')))': '}}}',
  '(!': '{|', '!+': '|+', '!-': '|-', '!)': '|}',

  // Tildes
  '1~': '~', '2~': '~~', '3~': '~~~', '4~': '~~~~', '5~': '~~~~~',

  // Emoji/status indicators
  'goldmedal': '🥇', 'silvermedal': '🥈', 'bronzemedal': '🥉',
  'done': '✅', 'xmark': '❌', 'checked': '✔️',
  'thumbs up': '👍', 'thumbs down': '👎',
  'profit': '▲',

  // Math symbols
  'minusplus': '∓', 'plusminus': '±',
  'langle': '⟨', 'rangle': '⟩',

  // Greek letters (common ones)
  'epsilon': 'ε', 'xi': '𝜉', 'Φ': 'Φ', 'phi': '𝜙', 'varphi': '𝜑',
  'upsilon': '𝜐', 'tau': '𝜏', 'varsigma': '𝜍', 'sigma': '𝜎',
  'pi': 'π', 'mu': '𝜇', 'lambda': '𝜆', 'kappa': '𝜘',
  'vartheta': '𝜗', 'theta': '𝜃', 'varepsilon': '𝜀', 'gamma': '𝛾',

  // Pronunciation
  'h.': 'ḥ',
}

// ============================================================================
// EASY INLINE TEMPLATES
// Templates that grab a specific parameter (0, 1, or 2)
// ============================================================================

/**
 * Easy inline templates - maps template name to parameter index to extract
 * e.g., 'p1': 0 means extract first positional parameter
 */
export const EASY_INLINE: Record<string, number> = {
  'p1': 0, 'p2': 1, 'p3': 2,
  'resize': 1, 'lang': 1, 'rtl-lang': 1,
  'line-height': 1, 'l': 2, 'h': 1,
  'sort': 1, 'color': 1, 'background color': 1,
}

/**
 * Zero-index templates - just grab the first parameter as-is
 */
export const ZEROS: string[] = [
  'defn', 'lino', 'finedetail', 'nobold', 'noitalic', 'nocaps',
  'vanchor', 'rnd', 'date', 'taste', 'monthname',
  'baseball secondary style', 'nowrap', 'nobr',
  'big', 'cquote', 'pull quote', 'smaller', 'midsize', 'larger',
  'kbd', 'bigger', 'large', 'mono', 'strongbad', 'stronggood', 'huge',
  'xt', 'xt2', '!xt', 'xtn', 'xtd', 'dc', 'dcr',
  'mxt', '!mxt', 'mxtn', 'mxtd', 'bxt', '!bxt', 'bxtn', 'bxtd',
  'delink', 'pre', 'var', 'mvar', 'pre2', 'code', 'char',
  'angle bracket', 'symb', 'dabsearch', 'key press',
  'nowiki', 'nowiki2', 'unstrip', 'unstripnowiki',
  'plain text', 'make code', 'killmarkers',
  'longitem', 'longlink', 'strikethrough', 'underline', 'uuline',
  'not a typo', 'text', 'var serif', 'double underline',
  'nee', 'ne', 'left', 'right', 'center', 'centered', 'justify',
  'smalldiv', 'bold div', 'monodiv', 'italic div', 'bigdiv',
  'strikethroughdiv', 'strikethrough color',
  'pbpe', 'video game release/abbr', 'nobel abbr',
  'gloss', 'gcl', 'overline', 'overarc', 'normal', 'norm',
  'tmath', 'vec', 'subst', 'highlight', 'tq',
  'subst:nft', 'subst:nwft', 'subst:nfa',
]

// ============================================================================
// TABLE CELL TEMPLATES
// Used for yes/no/status cells in tables
// ============================================================================

/**
 * Table cell templates that return the text or their titlecased name
 */
export const TABLE_CELLS: string[] = [
  'rh', 'rh2', 'yes', 'no', 'maybe', 'eliminated', 'lost', 'safe',
  'active', 'site active', 'coming soon', 'good', 'won', 'nom', 'sho',
  'longlisted', 'tba', 'success', 'operational', 'failure', 'partial',
  'regional', 'maybecheck', 'partial success', 'partial failure',
  'okay', 'yes-no', 'some', 'nonpartisan', 'pending', 'unofficial',
  'unofficial2', 'usually', 'rarely', 'sometimes', 'any', 'varies',
  'black', 'non-album single', 'unreleased', 'unknown', 'perhaps',
  'depends', 'included', 'dropped', 'terminated', 'beta',
  'table-experimental', 'free', 'proprietary', 'nonfree', 'needs',
  'nightly', 'release-candidate', 'planned', 'scheduled', 'incorrect',
  'no result', 'cmain', 'calso starring', 'crecurring', 'cguest',
  'not yet', 'optional',
]

/**
 * Table cell templates with specific output values
 */
export const TABLE_CELL_VALUES: [string, string][] = [
  ['active fire', 'Active'], ['site active', 'Active'],
  ['site inactive', 'Inactive'], ['yes2', ''], ['no2', ''],
  ['ya', '✅'], ['na', '❌'], ['nom', 'Nominated'],
  ['sho', 'Shortlisted'], ['tba', 'TBA'], ['maybecheck', '✔️'],
  ['okay', 'Neutral'], ['n/a', 'N/A'], ['sdash', '—'],
  ['dunno', '?'], ['draw', ''], ['cnone', ''], ['nocontest', ''],
]

// ============================================================================
// ABBREVIATION TEMPLATES
// ============================================================================

/**
 * Abbreviation shorthand templates [name, prefix]
 */
export const ABBREVIATIONS: [string, string][] = [
  ['bwv', 'BWV'], ['hwv', 'HWV'], ['d.', 'D '],
  ['aka', 'a.k.a. '], ['cf.', 'cf. '], ['fl.', 'fl. '],
  ['circa', 'c. '], ['born in', 'b. '], ['died-in', 'd. '], ['married-in', 'm. '],
]

/**
 * Pronoun templates that just return their name
 */
export const PRONOUNS: string[] = [
  'they', 'them', 'their', 'theirs', 'themself',
  'they are', 'they were', 'they have', 'they do',
  'he or she', 'him or her', 'his or her', 'his or hers',
  'he/she', 'him/her', 'his/her',
]

// ============================================================================
// SHIP LINK TEMPLATES
// {{HSC|Ship Name|ID}} -> [[HSC Name (id)]]
// ============================================================================

export const SHIP_PREFIXES: string[] = [
  'mv', 'm/v', 'gts', 'hsc', 'ms', 'm/s', 'my', 'm/y', 'ps',
  'rms', 'rv', 'r/v', 'sb', 'ss', 's/s', 'sv', 's/v', 'sy', 's/y',
  'tss', 'ans', 'hmas', 'hmbs', 'bns', 'hmcs', 'ccgs', 'arc',
  'hdms', 'bae', 'ens', 'rfns', 'fns', 'hs', 'sms', 'smu', 'gs',
  'icgv', 'ins', 'kri', 'lé', 'jsub', 'jds', 'js', 'hnlms', 'hmnzs',
  'nns', 'hnoms', 'hmpngs', 'bap', 'rps', 'brp', 'orp', 'nrp', 'nms',
  'rss', 'sas', 'hmsas', 'roks', 'hswms', 'htms', 'tcg', 'hms', 'hmt',
  'rfaux', 'usat', 'uscgc', 'usns', 'usrc', 'uss', 'usav',
]

// ============================================================================
// ALIAS MAP
// Maps alias template names to canonical names
// ============================================================================

export const TEMPLATE_ALIASES: Record<string, string> = {
  // Common aliases
  'imdb': 'imdb name', 'imdb episodes': 'imdb episode',
  'localday': 'currentday', 'localdayname': 'currentdayname',
  'localyear': 'currentyear', 'localmonth': 'currentmonth',
  'cvt': 'convert', 'cricon': 'flagicon',
  'sfrac': 'frac', 'sqrt': 'radic',
  'unreferenced section': 'unreferenced',
  'redir': 'redirect', 'sisterlinks': 'sister project links',
  'main article': 'main', 'by': 'baseball year',
  'str rep': 'replace', 'ushr2': 'ushr',
  'stn': 'station', 'metrod': 'metro', 'fw': 'ferry',
  'rws': 'stnlnk', 'sclass2': 'sclass', 'under': 'underline',
  'brackets': 'bracket', 'raise': 'lower',
  'born-in': 'born in', 'c.': 'circa', 'r.': 'reign',
  'frac': 'fraction', 'rdelim': 'ldelim',
  'abs': 'pipe', 'pp.': 'p.', 'iss.': 'vol.', 'h2d': 'hex2dec',
  'bda': 'birth date and age', 'b-da': 'birth date and age',
  'death date and age': 'birth date and age',

  // List aliases
  'flatlist': 'plainlist', 'plain list': 'plainlist',
  'nblist': 'collapsible list', 'nonbulleted list': 'collapsible list',
  'ubl': 'collapsible list', 'ublist': 'collapsible list',
  'ubt': 'collapsible list', 'unbullet': 'collapsible list',
  'unbulleted list': 'collapsible list', 'unbulleted': 'collapsible list',
  'unbulletedlist': 'collapsible list', 'vunblist': 'collapsible list',

  // Coord aliases
  'coor': 'coord', 'coor title dms': 'coord', 'coor title dec': 'coord',
  'coor dms': 'coord', 'coor dm': 'coord', 'coor dec': 'coord',

  // Date aliases
  'dob': 'start', 'birthdate': 'start', 'birth date': 'start',
  'end date': 'start', 'death date': 'start', 'birth': 'start',
  'death': 'start', 'start date': 'start', 'end': 'start',
  'start date and age': 'start', 'end date and age': 'start',

  // Transit aliases
  'lrt': 'lrt station', 'lrts': 'lrt station',
  'mrt': 'mrt station', 'mrts': 'mrt station',

  // Dash aliases
  'nsndns': 'en dash', 'spnd': 'spaced en dash',
  'sndash': 'spaced en dash', 'spndash': 'spaced en dash',
  'snds': 'spaced en dash space', 'spndsp': 'spaced en dash space',
  'sndashs': 'spaced en dash space', 'spndashsp': 'spaced en dash space',

  // Status aliases
  'colour': 'color', 'colored text': 'color', 'fgcolor': 'color',

  // Citation aliases
  'cite': 'citation', 'source': 'citation',

  // Link aliases
  'no redirect': 'auto link', 'tl-r': 'auto link',
  'template link no redirect': 'auto link', 'redirect?': 'auto link',
  'subatomic particle': 'auto link', 'bl': 'auto link',

  // Abbreviation aliases
  'a.k.a.': 'aka', 'also known as': 'aka',
  'lit': 'literal translation', 'literal': 'literal translation',
  'literally': 'literal translation',

  // Tooltip/abbr aliases
  'tooltip': 'abbr', 'abbrv': 'abbr', 'define': 'abbr',
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert string to title case
 */
function titlecase(str: string): string {
  if (!str) return ''
  return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Convert number to ordinal (1st, 2nd, 3rd, etc.)
 */
function toOrdinal(num: number): string {
  const n = Math.abs(num)
  if (n % 100 >= 11 && n % 100 <= 13) return n + 'th'
  switch (n % 10) {
    case 1: return n + 'st'
    case 2: return n + 'nd'
    case 3: return n + 'rd'
    default: return n + 'th'
  }
}

/**
 * Calculate percentage
 */
function percentage(opts: { numerator: string | number; denominator: string | number; decimals?: string | number }): string | null {
  const num = Number(opts.numerator) / Number(opts.denominator)
  if (isNaN(num)) return null
  const dec = Number(opts.decimals) || 0
  return (num * 100).toFixed(dec) + '%'
}

/**
 * Convert to number, handling various formats
 * Exported for use in weather/climate templates
 */
export function toNumber(str: string): number {
  if (!str) return 0
  str = String(str).replace(/[−–—]/g, '-').replace(/,/g, '')
  return Number(str) || 0
}

/**
 * Calculate age difference between two dates
 */
function calcAgeDiff(from: { year: number; month: number; day: number }, to: { year: number; month: number; day: number }): { years: number; months: number; days: number } {
  let years = to.year - from.year
  let months = to.month - from.month
  let days = to.day - from.day
  if (days < 0) { months--; days += 30 }
  if (months < 0) { years--; months += 12 }
  return { years, months, days }
}

/**
 * Parse date parts from array [year, month, day]
 */
function parseYMD(arr: string[]): { year: number; month: number; day: number } {
  return {
    year: Number(arr[0]) || 0,
    month: Number(arr[1]) || 0,
    day: Number(arr[2]) || 1,
  }
}

/**
 * Time since a date in human-readable format
 */
function timeSince(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days < 1) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  if (months < 12) return `${months} months ago`
  const years = Math.floor(days / 365)
  if (years === 1) return '1 year ago'
  return `${years} years ago`
}

// ============================================================================
// TEMPLATE PARAMS PARSING
// ============================================================================

/**
 * Parse template parameters into an object
 */
export function parseTemplateParams(tmpl: string, fmt?: 'raw'): TemplateParams {
  tmpl = tmpl.replace(/^\{\{/, '').replace(/\}\}$/, '')
  let arr = tmpl.split(/\n?\|/)
  arr.forEach((a, i) => {
    if (a === null) return
    if (/\[\[[^\]]+$/.test(a) || /\{\{[^}]+$/.test(a) || a.split('{{').length !== a.split('}}').length || a.split('[[').length !== a.split(']]').length) {
      arr[i + 1] = arr[i] + '|' + arr[i + 1]; arr[i] = ''
    }
  })
  arr = arr.filter(a => a !== null && a !== '').map(a => (a || '').trim())
  const name = arr.shift() || ''
  const obj: TemplateParams = {}
  arr.forEach(str => {
    str = (str || '').trim()
    if (/^[\p{Letter}0-9._/\- '()\t]+=/iu.test(str)) {
      const parts = str.split('='), key = (parts[0] || '').toLowerCase().trim(), val = parts.slice(1).join('=').trim()
      if (!obj[key] || val) obj[key] = val
    } else { obj['list'] = obj['list'] || []; (obj['list'] as string[]).push(str) }
  })
  for (const k of Object.keys(obj)) {
    if (['classname', 'style', 'align', 'margin', 'left', 'break', 'boxsize'].includes(k.toLowerCase())) delete obj[k]
    if (obj[k] === null || obj[k] === '') delete obj[k]
  }
  for (const k of Object.keys(obj)) {
    if (k === 'list') {
      const listArr = obj[k] as string[]
      obj[k] = listArr.map((v: string) => {
        if (fmt === 'raw') v = parseDateTemplatesInValue(v)
        return fmt === 'raw' ? parseSentence(v) : parseSentence(v).text()
      })
    } else {
      let val = obj[k] as string
      if (fmt === 'raw') val = parseDateTemplatesInValue(val)
      obj[k] = fmt === 'raw' ? parseSentence(val) : parseSentence(val).text()
    }
  }
  if (name) obj['template'] = name.trim().toLowerCase().replace(/_/g, ' ')
  return obj
}

// ============================================================================
// DATE TEMPLATES
// ============================================================================

function extractDateFromTemplate(obj: TemplateParams): { year?: string | undefined; month?: string | undefined; day?: string | undefined } {
  const list = obj['list'] as string[] | undefined
  return {
    year: (obj['year'] || obj['1'] || list?.[0]) as string | undefined,
    month: (obj['month'] || obj['2'] || list?.[1]) as string | undefined,
    day: (obj['day'] || obj['3'] || list?.[2]) as string | undefined
  }
}

function formatDate(year?: string, month?: string, day?: string): string {
  if (year && month && day) {
    const m = MONTHS[Number(month) - 1] || month
    return `${m} ${day}, ${year}`
  }
  if (year && month) {
    return `${MONTHS[Number(month) - 1] || month} ${year}`
  }
  return year || ''
}

export function parseBirthDate(tmpl: string, list: ParsedTemplate[]): string {
  const obj = parseTemplateParams(tmpl)
  const { year, month, day } = extractDateFromTemplate(obj)
  list.push({ template: 'birth date', year, month, day })
  return formatDate(year, month, day)
}

export function parseDeathDate(tmpl: string, list: ParsedTemplate[]): string {
  const obj = parseTemplateParams(tmpl)
  const { year, month, day } = extractDateFromTemplate(obj)
  list.push({ template: 'death date', year, month, day })
  return formatDate(year, month, day)
}

export function parseStartDate(tmpl: string, list: ParsedTemplate[]): string {
  const obj = parseTemplateParams(tmpl)
  const { year, month, day } = extractDateFromTemplate(obj)
  list.push({ template: 'start date', year, month, day })
  return formatDate(year, month, day)
}

export function parseAsOf(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const { year, month, day } = extractDateFromTemplate(obj)
  let out = obj['since'] ? 'Since ' : 'As of '
  if (obj['lc']) out = out.toLowerCase()
  if (obj['bare']) out = ''
  out += formatDate(year, month, day)
  return out
}

export function parseMarriage(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const spouse = String(obj['spouse'] || obj['1'] || list?.[0] || '')
  const from = String(obj['from'] || obj['2'] || list?.[1] || '')
  const to = String(obj['to'] || obj['3'] || list?.[2] || '')
  let str = spouse
  if (from) {
    if (to) {
      str += ` (m. ${from}-${to})`
    } else {
      str += ` (m. ${from})`
    }
  }
  return str
}

// ============================================================================
// COORDINATE TEMPLATES
// ============================================================================
export function parseCoord(tmpl: string): Coordinate {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  let lat = 0, lon = 0

  const parseDMS = (arr: string[]): number => {
    const hem = String(arr.pop() || '').toUpperCase()
    const deg = Number(arr[0] || 0), min = Number(arr[1] || 0), sec = Number(arr[2] || 0)
    const sign = hem === 'S' || hem === 'W' ? -1 : 1
    return sign * (deg + min / 60 + sec / 3600)
  }

  const l0 = list[0] ?? '', l1 = list[1] ?? '', l2 = list[2] ?? '', l3 = list[3] ?? ''
  if (list.length === 2 && !isNaN(Number(l0)) && !isNaN(Number(l1))) {
    lat = Number(l0); lon = Number(l1)
  } else if (list.length === 4) {
    lat = /[SN]/i.test(l1) ? parseDMS([l0, l1]) : Number(l0)
    lon = /[EW]/i.test(l3) ? parseDMS([l2, l3]) : Number(l2)
  } else if (list.length === 6) {
    lat = parseDMS(list.slice(0, 3)); lon = parseDMS(list.slice(3))
  } else if (list.length === 8) {
    lat = parseDMS(list.slice(0, 4)); lon = parseDMS(list.slice(4))
  }

  const latDir: 'N' | 'S' = lat >= 0 ? 'N' : 'S'
  const lonDir: 'E' | 'W' = lon >= 0 ? 'E' : 'W'
  return { template: 'coord', lat: Math.round(Math.abs(lat) * 100000) / 100000, lon: Math.round(Math.abs(lon) * 100000) / 100000, latDir, lonDir, display: obj['display'] as string | undefined }
}

// ============================================================================
// CURRENCY TEMPLATES
// ============================================================================
function formatCurrencyAmount(amount: string): string {
  if (!amount) return amount
  const cleaned = amount.replace(/,/g, '').trim()
  const match = cleaned.match(/^(-?\d+)(\.\d+)?(.*)$/)
  if (match) {
    const intPart = match[1] ?? ''
    const decPart = match[2] || ''
    const suffix = match[3] || ''
    const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${formatted}${decPart}${suffix}`
  }
  return amount
}

export function parseCurrency(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  let code = (obj['template'] || obj['code'] || '') as string
  if (code === 'currency') code = (obj['code'] || 'usd') as string
  code = code.toLowerCase()
  if (code === 'us') code = 'usd'
  if (code === 'uk') code = 'gbp'
  const symbol = (DATA?.currency || CURRENCY)[code] || ''
  const rawAmount = (obj['amount'] || obj['1'] || objList?.[0] || '') as string
  const amount = formatCurrencyAmount(rawAmount)
  return `${symbol}${amount}${!symbol && obj['code'] ? ' ' + obj['code'] : ''}`
}

// ============================================================================
// SPORTS TEMPLATES
// ============================================================================
export function parseGoal(tmpl: string, list: ParsedTemplate[]): string {
  const obj = parseTemplateParams(tmpl)
  const arr = (obj['list'] || []) as string[]
  const data: { min: string; note: string }[] = []
  for (let i = 0; i < arr.length; i += 2) data.push({ min: arr[i] ?? '', note: arr[i + 1] || '' })
  list.push({ template: 'goal', data })
  return '⚽ ' + data.map(o => o.min + "'" + (o.note ? ` (${o.note})` : '')).join(', ')
}

export function parsePlayer(tmpl: string, list: ParsedTemplate[]): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  const num = (obj['number'] || obj['1'] || objList?.[0]) as string | undefined
  const country = String(obj['country'] || obj['2'] || objList?.[1] || '').toLowerCase()
  const name = (obj['name'] || obj['3'] || objList?.[2]) as string | undefined
  list.push({ template: 'player', number: num, country, name })
  const flags = DATA?.flags || FLAGS
  const flag = flags.find((f: [string, string, string]) => country === f[1] || country === f[2])
  let str = `[[${name}]]`
  if (flag?.[0]) str = flag[0] + '  ' + str
  if (num) str = num + ' ' + str
  return str
}

export function parseSportsTable(tmpl: string, list: ParsedTemplate[]): void {
  const obj = parseTemplateParams(tmpl)
  const teams = Object.keys(obj).filter(k => /^team[0-9]/.test(k)).map(k => String(obj[k] || '').toLowerCase())
  const byTeam: Record<string, TeamStats> = {}
  teams.forEach(team => {
    byTeam[team] = {
      name: obj[`name_${team}`] as string | undefined, win: Number(obj[`win_${team}`]) || 0, loss: Number(obj[`loss_${team}`]) || 0,
      tie: Number(obj[`tie_${team}`]) || 0, goals_for: Number(obj[`gf_${team}`]) || 0, goals_against: Number(obj[`ga_${team}`]) || 0
    }
  })
  list.push({ template: 'sports table', date: obj['update'] as string | undefined, teams: byTeam })
}

export function parsePlayoffBracket(tmpl: string, list: ParsedTemplate[]): void {
  const obj = parseTemplateParams(tmpl)
  const rounds: [BracketMatchTeam, BracketMatchTeam][][] = []
  const zeroPad = (n: number) => String(n).padStart(2, '0')
  for (let r = 1; r < 7; r++) {
    const round: [BracketMatchTeam, BracketMatchTeam][] = []
    for (let t = 1; t < 16; t += 2) {
      const key = `rd${r}-team`
      if (obj[key + t] || obj[key + zeroPad(t)]) {
        const getTeam = (team: number): BracketMatchTeam => {
          const k = obj[`rd${r}-team${zeroPad(team)}`] ? zeroPad(team) : team
          return { team: obj[`rd${r}-team${k}`] as string | undefined, score: obj[`rd${r}-score${k}`] as string | undefined, seed: obj[`rd${r}-seed${k}`] as string | undefined }
        }
        round.push([getTeam(t), getTeam(t + 1)])
      } else break
    }
    if (round.length) rounds.push(round)
  }
  list.push({ template: 'playoffbracket', rounds })
}

// ============================================================================
// TEXT UTILITY TEMPLATES
// ============================================================================
export function parseConvert(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  const num = obj['num'] || obj['1'] || objList?.[0]
  const unit = obj['two'] || obj['2'] || objList?.[1]
  const to = obj['three'] || obj['3'] || objList?.[2]
  if (unit === '-' || unit === 'to' || unit === 'and') return `${num} ${unit} ${to}`
  return `${num} ${unit}`
}

export function parseFraction(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  const a = obj['a'] || obj['1'] || objList?.[0]
  const b = obj['b'] || obj['2'] || objList?.[1]
  const c = obj['c'] || obj['3'] || objList?.[2]
  if (c) return `${a} ${b}/${c}`
  if (b) return `${a}/${b}`
  return `1/${a}`
}

export function parseVal(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  let num = obj['number'] || obj['1'] || objList?.[0]
  if (num && Number(num)) num = Number(num).toLocaleString()
  let str = (num || '') as string
  if (obj['p']) str = obj['p'] + str
  if (obj['s']) str = obj['s'] + str
  if (obj['u'] || obj['ul'] || obj['upl']) str += ' ' + (obj['u'] || obj['ul'] || obj['upl'])
  return str
}

export function parseSortname(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  const first = obj['first'] || obj['1'] || objList?.[0] || ''
  const last = obj['last'] || obj['2'] || objList?.[1] || ''
  const name = `${first} ${last}`.trim()
  if (obj['nolink']) return (obj['target'] || name) as string
  if (obj['dab']) return `[[${obj['target'] || name} (${obj['dab']})|${name}]]`
  return obj['target'] ? `[[${obj['target']}|${name}]]` : `[[${name}]]`
}

export function parseHorizontalList(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.filter((f: string) => f).join(', ')
}

export function parseUnbulletedList(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.filter((f: string) => f).join(', ')
}

export function parseBulletedList(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.filter((f: string) => f).map((s: string) => '• ' + s).join('\n\n')
}

export function parseURL(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  const url = String(obj['1'] || objList?.[0] || '')
  const displayText = String(obj['2'] || objList?.[1] || '')
  if (displayText) return displayText
  let domain = url
  domain = domain.replace(/^https?:\/\//, '')
  domain = domain.replace(/^www\./, '')
  domain = domain.replace(/\/.*$/, '')
  return domain || url
}

export function parseNihongo(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const objList = obj['list'] as string[] | undefined
  const name = ((obj['template'] || '') as string).toLowerCase()
  if (name === 'nihongo2' || name === 'nihongo-s') {
    return (obj['1'] || objList?.[0] || '') as string
  }
  if (name === 'nihongo3') {
    const romaji = (obj['1'] || objList?.[0] || '') as string
    const kanji = (obj['2'] || objList?.[1] || '') as string
    if (kanji) return `${romaji} (${kanji})`
    return romaji
  }
  const english = (obj['1'] || objList?.[0] || '') as string
  const kanji = (obj['2'] || objList?.[1] || '') as string
  const romaji = (obj['3'] || objList?.[2] || '') as string
  let str = english || romaji || ''
  if (kanji) str += ` (${kanji})`
  return str
}

// Simple list item parser that doesn't call parseTemplateParams
function parseListItems_simple(tmpl: string): string[] {
  tmpl = tmpl.replace(/^\{\{/, '').replace(/\}\}$/, '')
  let arr = tmpl.split(/\n?\|/)
  arr.forEach((a, i) => {
    if (a === null) return
    if (/\[\[[^\]]+$/.test(a) || /\{\{[^}]+$/.test(a) || a.split('{{').length !== a.split('}}').length || a.split('[[').length !== a.split(']]').length) {
      arr[i + 1] = arr[i] + '|' + arr[i + 1]; arr[i] = ''
    }
  })
  arr = arr.filter(a => a !== null && a !== '').map(a => (a || '').trim())
  arr.shift()
  return arr
    .filter(s => !/^[\p{Letter}0-9._/\- '()\t]+=/iu.test(s))
    .map(s => s.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, page, text) => text || page).trim())
    .filter(s => s)
}

/**
 * Parse templates in a string value (for infobox values)
 */
export function parseDateTemplatesInValue(value: string): string {
  if (!value || typeof value !== 'string') return value
  // Early exit: if no {{ then no templates to process
  if (!value.includes('{{')) return value

  const templates = findTemplates(value)
  for (const tmpl of templates) {
    const name = tmpl.name.toLowerCase()

    if (name === 'coord' || name.startsWith('coor')) {
      const coord = parseCoord(tmpl.body)
      if (coord.lat && coord.lon) {
        const coordText = `${coord.lat}\u00B0${coord.latDir}, ${coord.lon}\u00B0${coord.lonDir}`
        value = value.replace(tmpl.body, coordText)
      }
      continue
    }

    if (name === 'birth date and age' || name === 'bda' || name === 'birth date') {
      const obj = parseTemplateParams(tmpl.body)
      const { year, month, day } = extractDateFromTemplate(obj)
      value = value.replace(tmpl.body, formatDate(year, month, day))
      continue
    }

    if (name === 'death date and age' || name === 'death date') {
      const obj = parseTemplateParams(tmpl.body)
      const { year, month, day } = extractDateFromTemplate(obj)
      value = value.replace(tmpl.body, formatDate(year, month, day))
      continue
    }

    if (name === 'start date' || name === 'end date' || name === 'start date and age' || name === 'end date and age' || name === 'start' || name === 'end') {
      const obj = parseTemplateParams(tmpl.body)
      const { year, month, day } = extractDateFromTemplate(obj)
      value = value.replace(tmpl.body, formatDate(year, month, day))
      continue
    }

    if (name === 'url') {
      const text = parseURL(tmpl.body)
      value = value.replace(tmpl.body, text)
      continue
    }

    if (name === 'nihongo' || name === 'nihongo2' || name === 'nihongo3' || name === 'nihongo-s' || name === 'nihongo foot') {
      const text = parseNihongo(tmpl.body)
      value = value.replace(tmpl.body, text)
      continue
    }

    if (name === 'hlist' || name === 'plainlist' || name === 'flatlist' || name === 'ubl' || name === 'ubil' || name === 'unbulleted list' || name === 'bulleted list') {
      const items = parseListItems_simple(tmpl.body)
      value = value.replace(tmpl.body, items.join(', '))
      continue
    }

    // Handle all currency templates using the CURRENCY map and parseCurrency function
    if (CURRENCY[name] || name === 'currency') {
      const text = parseCurrency(tmpl.body)
      value = value.replace(tmpl.body, text)
      continue
    }

    if (name === 'increase' || name === 'up' || name === 'gain') {
      value = value.replace(tmpl.body, '\u25B2')
      continue
    }
    if (name === 'decrease' || name === 'down' || name === 'loss') {
      value = value.replace(tmpl.body, '\u25BC')
      continue
    }
    if (name === 'steady' || name === 'no change') {
      value = value.replace(tmpl.body, '\u25AC')
      continue
    }

    if (name === 'nobold' || name === 'no bold') {
      const obj = parseTemplateParams(tmpl.body)
      const objList = obj['list'] as string[] | undefined
      const text = (obj['1'] || objList?.[0] || '') as string
      value = value.replace(tmpl.body, text)
      continue
    }

    if (name === 'marriage' || name === 'married') {
      const text = parseMarriage(tmpl.body)
      value = value.replace(tmpl.body, text)
      continue
    }

    if (name === 'sortname') {
      const text = parseSortname(tmpl.body)
      value = value.replace(tmpl.body, text)
      continue
    }

    // Handle hardcoded symbol templates
    if (HARDCODED[name]) {
      value = value.replace(tmpl.body, HARDCODED[name])
      continue
    }
  }

  return value
}

// ============================================================================
// ADDITIONAL TEMPLATE PARSERS (30+ new templates)
// ============================================================================

/**
 * Parse age template - calculate years between two dates
 * {{age|1990|1|1}} or {{age|1990|1|1|2020|1|1}}
 */
export function parseAge(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  const from = parseYMD(list.slice(0, 3))
  let to: { year: number; month: number; day: number }
  if (list.length >= 6) {
    to = parseYMD(list.slice(3, 6))
  } else {
    const d = new Date()
    to = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
  }
  const diff = calcAgeDiff(from, to)
  return String(diff.years || 0)
}

/**
 * Parse age in years and months
 */
export function parseAgeYM(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  const from = parseYMD(list.slice(0, 3))
  let to: { year: number; month: number; day: number }
  if (list.length >= 6) {
    to = parseYMD(list.slice(3, 6))
  } else {
    const d = new Date()
    to = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
  }
  const diff = calcAgeDiff(from, to)
  const parts: string[] = []
  if (diff.years === 1) parts.push('1 year')
  else if (diff.years) parts.push(`${diff.years} years`)
  if (diff.months === 1) parts.push('1 month')
  else if (diff.months) parts.push(`${diff.months} months`)
  return parts.join(', ')
}

/**
 * Parse age in years, months, and days
 */
export function parseAgeYMD(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  const from = parseYMD(list.slice(0, 3))
  let to: { year: number; month: number; day: number }
  if (list.length >= 6) {
    to = parseYMD(list.slice(3, 6))
  } else {
    const d = new Date()
    to = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
  }
  const diff = calcAgeDiff(from, to)
  const parts: string[] = []
  if (diff.years === 1) parts.push('1 year')
  else if (diff.years) parts.push(`${diff.years} years`)
  if (diff.months === 1) parts.push('1 month')
  else if (diff.months) parts.push(`${diff.months} months`)
  if (diff.days === 1) parts.push('1 day')
  else if (diff.days) parts.push(`${diff.days} days`)
  return parts.join(', ')
}

/**
 * Parse time ago template
 */
export function parseTimeAgo(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const date = (obj['date'] || obj['1'] || (obj['list'] as string[])?.[0] || '') as string
  return timeSince(date)
}

/**
 * Parse birth year and age - {{birth year and age|1990|1}}
 */
export function parseBirthYearAge(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const birthYear = obj['birth_year'] || obj['1'] || list?.[0]
  const birthMonth = obj['birth_month'] || obj['2'] || list?.[1]
  const year = Number(birthYear)
  const age = new Date().getFullYear() - year
  let str = String(year)
  if (birthMonth) {
    const m = MONTHS[Number(birthMonth) - 1] || birthMonth
    str = `${m} ${year}`
  }
  if (age) str += ` (age ${age})`
  return str
}

/**
 * Parse death year and age - {{death year and age|2020|1990}}
 */
export function parseDeathYearAge(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const deathYear = obj['death_year'] || obj['1'] || list?.[0]
  const deathMonth = obj['death_month'] || obj['3'] || list?.[2]
  let str = String(deathYear)
  if (deathMonth) {
    const m = MONTHS[Number(deathMonth) - 1] || deathMonth
    str = `${m} ${deathYear}`
  }
  return str
}

/**
 * Parse reign template - {{reign|1066|1087}}
 */
export function parseReign(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const start = obj['start'] || obj['1'] || list?.[0] || ''
  const end = obj['end'] || obj['2'] || list?.[1] || ''
  return `(r. ${start} – ${end})`
}

/**
 * Parse OldStyleDate template
 */
export function parseOldStyleDate(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const date = (obj['date'] || obj['1'] || list?.[0] || '') as string
  const year = (obj['year'] || obj['2'] || list?.[1] || '') as string
  return year ? `${date} ${year}` : date
}

/**
 * Parse first word template
 */
export function parseFirstWord(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  const sep = (obj['sep'] || ' ') as string
  return text.split(sep)[0] || ''
}

/**
 * Parse last word template
 */
export function parseLastWord(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  const parts = text.split(/ /g)
  return parts[parts.length - 1] || ''
}

/**
 * Parse trunc template - truncate string
 */
export function parseTrunc(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const str = (obj['str'] || obj['1'] || list?.[0] || '') as string
  const len = Number(obj['len'] || obj['2'] || list?.[1]) || str.length
  return str.substring(0, len)
}

/**
 * Parse replace template
 */
export function parseReplace(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  const from = (obj['from'] || obj['2'] || list?.[1]) as string
  const to = (obj['to'] || obj['3'] || list?.[2] || '') as string
  if (!from) return text
  return text.replace(new RegExp(from, 'g'), to)
}

/**
 * Parse small template
 */
export function parseSmall(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  return (obj['1'] || list?.[0] || '') as string
}

/**
 * Parse radic (root) template
 */
export function parseRadic(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const after = (obj['after'] || obj['1'] || list?.[0] || '') as string
  const before = (obj['before'] || obj['2'] || list?.[1] || '') as string
  return `${before}√${after}`
}

/**
 * Parse decade template - {{decade|1990}} -> 1990s
 */
export function parseDecade(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const year = Number(obj['year'] || obj['1'] || list?.[0])
  const decade = Math.floor(year / 10) * 10
  return `${decade}s`
}

/**
 * Parse century template
 */
export function parseCentury(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const year = Number(obj['year'] || obj['1'] || list?.[0])
  const century = Math.floor(year / 100) + 1
  return `${toOrdinal(century)} century`
}

/**
 * Parse millennium template
 */
export function parseMillennium(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const year = Number(obj['year'] || obj['1'] || list?.[0])
  const millennium = Math.floor(year / 1000) + 1
  if (obj['abbr'] === 'y') return toOrdinal(millennium)
  return `${toOrdinal(millennium)} millennium`
}

/**
 * Parse DEC template - degrees minutes seconds
 */
export function parseDec(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const deg = obj['degrees'] || obj['1'] || list?.[0] || 0
  const min = obj['minutes'] || obj['2'] || list?.[1]
  const sec = obj['seconds'] || obj['3'] || list?.[2]
  let str = `${deg}°`
  if (min) str += `${min}′`
  if (sec) str += `${sec}″`
  return str
}

/**
 * Parse RA template - right ascension (hours:minutes:seconds)
 */
export function parseRA(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const hours = obj['hours'] || obj['1'] || list?.[0] || 0
  const minutes = obj['minutes'] || obj['2'] || list?.[1] || 0
  const seconds = obj['seconds'] || obj['3'] || list?.[2] || 0
  return [hours, minutes, seconds].join(':')
}

/**
 * Parse br separated entries
 */
export function parseBrSeparated(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.join('\n\n')
}

/**
 * Parse comma separated entries
 */
export function parseCommaSeparated(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.join(', ')
}

/**
 * Parse anchored list
 */
export function parseAnchoredList(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.map((str, i) => `${i + 1}. ${str}`).join('\n\n')
}

/**
 * Parse pagelist
 */
export function parsePagelist(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.join(', ')
}

/**
 * Parse catlist
 */
export function parseCatlist(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.join(', ')
}

/**
 * Parse term template
 */
export function parseTerm(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const term = (obj['term'] || obj['1'] || list?.[0] || '') as string
  return `${term}:`
}

/**
 * Parse linum template - numbered item
 */
export function parseLinum(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const num = (obj['num'] || obj['1'] || list?.[0] || '') as string
  const text = (obj['text'] || obj['2'] || list?.[1] || '') as string
  return `${num}. ${text}`
}

/**
 * Parse block indent
 */
export function parseBlockIndent(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['1'] || list?.[0] || '') as string
  return text ? `\n${text}\n` : ''
}

/**
 * Parse percentage template
 */
export function parsePercentage(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const numerator = (obj['numerator'] || obj['1'] || list?.[0] || 0) as string | number
  const denominator = (obj['denominator'] || obj['2'] || list?.[1] || 1) as string | number
  const decimals = (obj['decimals'] || obj['3'] || list?.[2] || 0) as string | number
  const result = percentage({ numerator, denominator, decimals })
  return result || ''
}

/**
 * Parse plural template
 */
export function parsePlural(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const num = Number(obj['num'] || obj['1'] || list?.[0])
  let word = (obj['word'] || obj['2'] || list?.[1] || '') as string
  if (num !== 1) {
    if (/.y$/.test(word)) {
      word = word.replace(/y$/, 'ies')
    } else {
      word += 's'
    }
  }
  return `${num} ${word}`
}

/**
 * Parse min template
 */
export function parseMin(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  let min = Number(list[0]) || 0
  list.forEach(s => {
    const n = Number(s)
    if (!isNaN(n) && n < min) min = n
  })
  return String(min)
}

/**
 * Parse max template
 */
export function parseMax(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  let max = Number(list[0]) || 0
  list.forEach(s => {
    const n = Number(s)
    if (!isNaN(n) && n > max) max = n
  })
  return String(max)
}

/**
 * Parse round template
 */
export function parseRound(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const val = Number(obj['val'] || obj['1'] || list?.[0])
  return String(Math.round(val) || '')
}

/**
 * Parse formatnum template
 */
export function parseFormatNum(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  let num = (obj['number'] || obj['1'] || list?.[0] || '') as string
  num = num.replace(/,/g, '')
  const n = Number(num)
  return n.toLocaleString() || ''
}

/**
 * Parse hexadecimal template
 */
export function parseHexadecimal(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const val = Number(obj['val'] || obj['1'] || list?.[0])
  if (!val) return String(obj['val'] || obj['1'] || list?.[0] || '')
  return val.toString(16).toUpperCase()
}

/**
 * Parse hex2dec template
 */
export function parseHex2Dec(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const val = (obj['val'] || obj['1'] || list?.[0] || '') as string
  return String(parseInt(val, 16) || val)
}

/**
 * Parse abbrlink template
 */
export function parseAbbrlink(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const abbr = (obj['abbr'] || obj['1'] || list?.[0] || '') as string
  const page = (obj['page'] || obj['2'] || list?.[1]) as string
  if (page) return `[[${page}|${abbr}]]`
  return `[[${abbr}]]`
}

/**
 * Parse lc (lowercase) template
 */
export function parseLc(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  return text.toLowerCase()
}

/**
 * Parse uc (uppercase) template
 */
export function parseUc(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  return text.toUpperCase()
}

/**
 * Parse ucfirst template
 */
export function parseUcfirst(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.substring(1)
}

/**
 * Parse lcfirst template
 */
export function parseLcfirst(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  if (!text) return ''
  return text.charAt(0).toLowerCase() + text.substring(1)
}

/**
 * Parse title case template
 */
export function parseTitleCase(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  return text.split(' ').map((w, i) => {
    if (i > 0 && (w === 'the' || w === 'of')) return w
    return titlecase(w)
  }).join(' ')
}

/**
 * Parse braces template - wraps text in braces
 */
export function parseBraces(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0] || '') as string
  let attrs = ''
  if (list && list.length > 0) attrs = '|' + list.join('|')
  return `{{${text}${attrs}}}`
}

/**
 * Parse tl template (template link)
 */
export function parseTl(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const first = (obj['first'] || obj['1'] || list?.[0] || '') as string
  const second = (obj['second'] || obj['2'] || list?.[1]) as string
  return second || first
}

/**
 * Parse abbr template (abbreviation with tooltip)
 */
export function parseAbbr(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  return (obj['abbr'] || obj['1'] || list?.[0] || '') as string
}

/**
 * Parse literal translation template
 */
export function parseLiteralTranslation(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  const items = list.map(s => `'${s}'`)
  return 'lit. ' + items.join(' or ')
}

/**
 * Parse metro/station template
 */
export function parseMetro(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  const dab = (obj['dab'] || obj['2'] || list?.[1]) as string
  if (dab) return `[[${name} station (${dab})|${name}]]`
  return `[[${name} station|${name}]]`
}

/**
 * Parse subway template
 */
export function parseSubway(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  return `[[${name} subway station|${name}]]`
}

/**
 * Parse tram template
 */
export function parseTram(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  const dab = (obj['dab'] || obj['2'] || list?.[1]) as string
  if (dab) return `[[${name} tram stop (${dab})|${name}]]`
  return `[[${name} tram stop|${name}]]`
}

/**
 * Parse ferry template
 */
export function parseFerry(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  return `[[${name} ferry wharf|${name}]]`
}

/**
 * Parse LRT station template
 */
export function parseLrtStation(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  return `[[${name} LRT station|${name}]]`
}

/**
 * Parse MRT station template
 */
export function parseMrtStation(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  return `[[${name} MRT station|${name}]]`
}

/**
 * Parse ship template {{SS|Ship Name|ID}}
 */
export function parseShip(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const prefix = ((obj['template'] || '') as string).toUpperCase()
  const name = (obj['name'] || obj['1'] || list?.[0] || '') as string
  const id = obj['id'] || obj['2'] || list?.[1]
  if (id) return `[[${prefix} ${name} (${id})]]`
  return `[[${prefix} ${name}]]`
}

/**
 * Parse auto link template
 */
export function parseAutoLink(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const page = (obj['page'] || obj['1'] || list?.[0] || '') as string
  const text = (obj['text'] || obj['2'] || list?.[1]) as string
  if (text && text !== page) return `[[${page}|${text}]]`
  return `[[${page}]]`
}

/**
 * Parse table cell template - yes/no/maybe etc.
 */
export function parseTableCell(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = ((obj['template'] || '') as string).toLowerCase()
  const text = (obj['text'] || obj['1'] || list?.[0]) as string

  // Check for specific values
  for (const [key, val] of TABLE_CELL_VALUES) {
    if (name === key) return text || val
  }

  // Default: return text or titlecased name
  return text || titlecase(name)
}

/**
 * Parse easy inline template - extract specific parameter
 */
export function parseEasyInline(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = ((obj['template'] || '') as string).toLowerCase()
  const idx = EASY_INLINE[name]
  if (idx !== undefined && list) {
    return (list[idx] || '') as string
  }
  return (obj['1'] || list?.[0] || '') as string
}

/**
 * Parse zero-index template - just return first parameter
 */
export function parseZero(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  return (obj['1'] || list?.[0] || '') as string
}

/**
 * Parse abbreviation template
 */
export function parseAbbreviation(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = ((obj['template'] || '') as string).toLowerCase()

  // Find matching abbreviation
  for (const [key, prefix] of ABBREVIATIONS) {
    if (name === key) {
      const first = obj['first'] || obj['1'] || list?.[0]
      return first ? prefix + first : prefix
    }
  }

  return (obj['1'] || list?.[0] || '') as string
}

/**
 * Parse sports year templates (baseball, NFL, NBA, etc.)
 */
export function parseSportsYear(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const name = ((obj['template'] || '') as string).toLowerCase()
  const year = (obj['year'] || obj['1'] || list?.[0] || '') as string
  const other = (obj['other'] || obj['2'] || list?.[1]) as string

  if (name === 'baseball year' || name === 'by') {
    return `[[${year} in baseball|${year}]]`
  }
  if (name === 'mlb year') {
    return `[[${year} Major League Baseball season|${year}]]`
  }
  if (name === 'nlds year' || name === 'nldsy') {
    return `[[${year} National League Division Series|${year}]]`
  }
  if (name === 'alds year' || name === 'aldsy') {
    return `[[${year} American League Division Series|${year}]]`
  }
  if (name === 'nfl year') {
    if (other && year) {
      return `[[${year} NFL season|${year}]]–[[${other} NFL season|${other}]]`
    }
    return `[[${year} NFL season|${year}]]`
  }
  if (name === 'nfl playoff year') {
    const y = Number(year)
    return `[[${y}–${y + 1} NFL playoffs|${year}]]`
  }
  if (name === 'nba year') {
    const y = Number(year)
    return `[[${y}–${y + 1} NBA season|${y}–${y + 1}]]`
  }

  return year
}

/**
 * Parse music template - musical symbols
 */
export function parseMusic(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const glyph = (obj['glyph'] || obj['1'] || list?.[0] || '') as string

  const glyphs: Record<string, string> = {
    'flat': '♭', 'b': '♭', 'sharp': '♯', '#': '♯',
    'natural': '♮', 'n': '♮', 'doubleflat': '𝄫', 'bb': '𝄫',
    '##': '𝄪', 'doublesharp': '𝄪',
    'quarternote': '♩', 'quarter': '♩',
    'treble': '𝄞', 'trebleclef': '𝄞',
    'bass': '𝄢', 'bassclef': '𝄢',
    'altoclef': '𝄡', 'alto': '𝄡', 'tenor': '𝄡', 'tenorclef': '𝄡',
  }

  return glyphs[glyph.toLowerCase()] || ''
}

/**
 * Parse US political abbreviation
 */
export function parseUsPolAbbr(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const party = (obj['party'] || obj['1'] || list?.[0] || '') as string
  const state = (obj['state'] || obj['2'] || list?.[1] || '') as string
  const house = obj['house'] || obj['3'] || list?.[2]
  if (!party || !state) return ''
  let out = `${party}‑${state}`
  if (house) out += ` ${toOrdinal(Number(house))}`
  return out
}

/**
 * Parse US House Representative template
 */
export function parseUshr(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const state = (obj['state'] || obj['1'] || list?.[0] || '') as string
  let num = (obj['num'] || obj['2'] || list?.[1] || '') as string

  if (num === 'AL') {
    return `${state}'s at-large congressional district`
  }
  const ordinal = toOrdinal(Number(num))
  return `${state}'s ${ordinal} congressional district`
}

/**
 * Parse font color template
 */
export function parseFontColor(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const bg = (obj['bg'] || obj['2'] || list?.[1]) as string
  const text = (obj['text'] || obj['3'] || list?.[2]) as string
  if (bg && text) return text
  return bg || ''
}

/**
 * Parse colored link template
 */
export function parseColoredLink(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const title = (obj['title'] || obj['2'] || list?.[1] || '') as string
  const text = (obj['text'] || obj['3'] || list?.[2]) as string
  return `[[${title}|${text || title}]]`
}

/**
 * Parse gaps template - join with double spaces
 */
export function parseGaps(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = (obj['list'] || []) as string[]
  return list.join('  ')
}

/**
 * Parse angle bracket template
 */
export function parseAngleBracket(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const txt = (obj['txt'] || obj['1'] || list?.[0] || '') as string
  return `⟨${txt}⟩`
}

/**
 * Parse bracket template
 */
export function parseBracket(tmpl: string): string {
  const obj = parseTemplateParams(tmpl)
  const list = obj['list'] as string[] | undefined
  const text = (obj['text'] || obj['1'] || list?.[0]) as string
  if (text) return `[${text}]`
  return '['
}

/**
 * Get a template by canonical name (resolving aliases)
 */
export function resolveTemplateAlias(name: string): string {
  const lower = name.toLowerCase()
  return TEMPLATE_ALIASES[lower] || lower
}
