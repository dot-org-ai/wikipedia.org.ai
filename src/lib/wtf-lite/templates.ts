/**
 * Template parsing functions for wtf-lite Wikipedia parser
 */

import type { TemplateParams, Coordinate, ParsedTemplate, TeamStats, BracketMatchTeam } from './types'
import { MONTHS, DATA, CURRENCY, FLAGS } from './constants'
import { findTemplates } from './utils'
import { parseSentence } from './links'

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
  }

  return value
}
