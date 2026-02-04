/**
 * Table class for parsing Wikipedia tables in wtf-lite
 */

import { Link, Sentence, parseSentence } from './links'
import type { TableCellJson, TableJson, TableRowJson } from './types'
import { PATTERNS } from './constants'

// Re-export types from types.ts for backward compatibility
export type { TableCellJson, TableRowJson, TableJson } from './types'

// ============================================================================
// TABLE PARSING HELPERS
// ============================================================================

// Common header names for auto-detection
const headings: Record<string, boolean> = {
  name: true,
  age: true,
  born: true,
  date: true,
  year: true,
  city: true,
  country: true,
  population: true,
  count: true,
  number: true,
}

/**
 * Clean up table lines (remove caption, table start/end markers)
 */
function cleanup(lines: string[]): string[] {
  lines = lines.filter(line => {
    // A '|+' row is a 'table caption', remove it
    return line && !PATTERNS.TABLE_CAPTION.test(line)
  })
  if (PATTERNS.TABLE_OPEN.test(lines[0] || '')) {
    lines.shift()
  }
  if (PATTERNS.TABLE_CLOSE.test(lines[lines.length - 1] || '')) {
    lines.pop()
  }
  if (PATTERNS.ROW_SEPARATOR.test(lines[0] || '')) {
    lines.shift()
  }
  return lines
}

/**
 * Split lines into rows based on |- separator
 */
function findRows(lines: string[]): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  lines = cleanup(lines)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue

    // '|-' is a row separator
    if (PATTERNS.ROW_SEPARATOR.test(line)) {
      if (row.length > 0) {
        rows.push(row)
        row = []
      }
    } else {
      // Remove leading | or ! for the ||/!! splitting
      let startChar = line.charAt(0)
      let processedLine = line
      if (startChar === '|' || startChar === '!') {
        processedLine = line.substring(1)
      }

      // Look for '||' inline row-splitter
      const cells = processedLine.split(PATTERNS.CELL_SEPARATOR)

      // Add leading ! back for header detection
      if (startChar === '!') {
        cells[0] = startChar + cells[0]
      }

      cells.forEach(cell => {
        row.push(cell.trim())
      })
    }
  }

  // Finish the last row
  if (row.length > 0) {
    rows.push(row)
  }

  return rows
}

/**
 * Handle colspan: stretch cells left/right
 */
function doColSpan(rows: string[][]): string[][] {
  rows.forEach(row => {
    for (let c = 0; c < row.length; c++) {
      const str = row[c]
      if (!str) continue
      const m = str.match(PATTERNS.COLSPAN)
      if (m !== null) {
        const num = parseInt(m[1] || '1', 10)
        // Remove colspan attribute from cell
        row[c] = str.replace(PATTERNS.COLSPAN, '')
        // Splice in empty columns
        for (let i = 1; i < num; i++) {
          row.splice(c + 1, 0, '')
        }
      }
    }
  })
  return rows.filter(r => r.length > 0)
}

/**
 * Handle rowspan: stretch cells up/down
 */
function doRowSpan(rows: string[][]): string[][] {
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      const str = row[c]
      if (!str) continue
      const m = str.match(PATTERNS.ROWSPAN)
      if (m !== null) {
        const num = parseInt(m[1] || '1', 10)
        // Remove rowspan attribute from cell
        const cleanStr = str.replace(PATTERNS.ROWSPAN, '')
        row[c] = cleanStr
        // Copy this cell down n rows
        for (let i = r + 1; i < r + num; i++) {
          if (!rows[i]) break
          rows[i]!.splice(c, 0, cleanStr)
        }
      }
    }
  })
  return rows
}

/**
 * Handle both colspan and rowspan
 */
function handleSpans(rows: string[][]): string[][] {
  rows = doColSpan(rows)
  rows = doRowSpan(rows)
  return rows
}

/**
 * Clean cell text for header comparison
 */
function cleanText(str: string): string {
  str = parseSentence(str).text()
  // Anything before a single-pipe is styling, remove it (use indexOf for speed)
  if (str.indexOf('|') !== -1) {
    str = str.replace(PATTERNS.CELL_STYLE, '')
  }
  str = str.replace(PATTERNS.STYLE_ATTR, '')
  // '!' is used as a highlighted column
  str = str.replace(PATTERNS.TABLE_HEADING, '')
  str = str.trim()
  return str
}

/**
 * Check if a row is mostly empty (skip span rows)
 */
function skipSpanRow(row: string[]): boolean {
  row = row || []
  const len = row.length
  const hasTxt = row.filter(str => str).length
  // Does it have 3+ empty spaces?
  return len - hasTxt > 3
}

/**
 * Remove non-header span rows (single-cell rows with colspan)
 */
function removeMidSpans(rows: string[][]): string[][] {
  return rows.filter(row => {
    if (row.length === 1 && row[0] && PATTERNS.TABLE_HEADING.test(row[0]) && row[0].toLowerCase().indexOf('rowspan') === -1) {
      return false
    }
    return true
  })
}

/**
 * Find header rows (start with !)
 */
function findHeaders(rows: string[][]): string[] {
  let headers: string[] = []

  // Skip if first row is mostly colspan
  if (skipSpanRow(rows[0] || [])) {
    rows.shift()
  }

  const first = rows[0]
  // Use charAt for faster single-char check
  if (first && first[0] && first[1] && (first[0].charAt(0) === '!' || first[1].charAt(0) === '!')) {
    headers = first.map(h => {
      if (h.charAt(0) === '!') h = h.substring(1).trimStart()
      h = cleanText(h)
      return h
    })
    rows.shift()
  }

  // Try the second row too (overwrite first-row if it exists)
  const second = rows[0]
  if (second && second[0] && second[1] && second[0].charAt(0) === '!' && second[1].charAt(0) === '!') {
    second.forEach((h, i) => {
      if (h.charAt(0) === '!') h = h.substring(1).trimStart()
      h = cleanText(h)
      if (h) {
        headers[i] = h
      }
    })
    rows.shift()
  }

  return headers
}

/**
 * Try using first row as headers if they match common header names
 */
function firstRowHeader(rows: string[][]): string[] {
  if (rows.length <= 3) {
    return []
  }

  const first = rows[0]
  if (!first) return []

  let headers = first.slice(0).map(h => {
    // Use charAt for faster single-char check
    if (h.charAt(0) === '!') h = h.substring(1).trimStart()
    h = parseSentence(h).text()
    h = cleanText(h)
    h = h.toLowerCase()
    return h
  })

  for (let i = 0; i < headers.length; i++) {
    if (headings.hasOwnProperty(headers[i] || '')) {
      rows.shift()
      return headers
    }
  }

  return []
}

/**
 * Parse a row array into a keyed object
 */
function parseRow(arr: string[], headers: string[]): Record<string, Sentence> {
  const row: Record<string, Sentence> = {}
  arr.forEach((str, i) => {
    const h = headers[i] || 'col' + (i + 1)
    const s = parseSentence(str)
    s.text(cleanText(s.text()))
    row[h] = s
  })
  return row
}

/**
 * Parse a table wiki string into an array of row objects
 */
function parseTableContent(wiki: string): Record<string, Sentence>[] {
  const lines = wiki
    .replace(/\r/g, '')
    .replace(/\n(\s*[^|!{\s])/g, ' $1') // Remove unnecessary newlines
    .split(/\n/)
    .map(l => l.trim())

  let rows = findRows(lines)
  rows = rows.filter(r => r)
  if (rows.length === 0) {
    return []
  }

  // Remove non-header span rows
  rows = removeMidSpans(rows)
  // Support colspan, rowspan
  rows = handleSpans(rows)
  // Grab the header rows
  let headers = findHeaders(rows)

  if (!headers || headers.length <= 1) {
    headers = firstRowHeader(rows)
    const want = rows[rows.length - 1] || []
    // Try the second row
    if (headers.length <= 1 && want.length > 2) {
      headers = firstRowHeader(rows.slice(1))
      if (headers.length > 0) {
        rows = rows.slice(2) // Remove them
      }
    }
  }

  // Index each column by its header
  return rows.map(arr => parseRow(arr, headers))
}

// ============================================================================
// TABLE CLASS
// ============================================================================

/**
 * Normalize a key for comparison (lowercase, remove underscores/dashes, trim)
 */
function normalize(key: string = ''): string {
  key = key.toLowerCase()
  key = key.replace(/[_-]/g, ' ')
  key = key.replace(PATTERNS.KEY_PARENS, '')
  key = key.trim()
  return key
}

/**
 * Table class representing a parsed Wikipedia table
 */
export class Table {
  private _data: Record<string, Sentence>[]
  private _wiki: string

  constructor(data: Record<string, Sentence>[], wiki: string = '') {
    this._data = data
    this._wiki = wiki
  }

  /**
   * Get all links from the table
   * @param n - Optional page name to filter by
   */
  links(n?: string): Link[] {
    let links: Link[] = []
    this._data.forEach(row => {
      Object.keys(row).forEach(k => {
        const cell = row[k]
        if (cell?.links) {
          links = links.concat(cell.links())
        }
      })
    })

    if (typeof n === 'string') {
      // Grab a specific link by page name
      const pageName = n.charAt(0).toUpperCase() + n.substring(1)
      const link = links.find(l => l.page() === pageName)
      return link === undefined ? [] : [link]
    }

    return links
  }

  /**
   * Extract specific columns from the table
   * @param keys - Single key (returns string[]) or array of keys (returns object[])
   */
  get(keys: string | string[]): string[] | Record<string, string>[] {
    // Normalize mappings
    const have = this._data[0] || {}
    const mapping: Record<string, string> = Object.keys(have).reduce((h, k) => {
      h[normalize(k)] = k
      return h
    }, {} as Record<string, string>)

    // String gets a flat list
    if (typeof keys === 'string') {
      let key = normalize(keys)
      key = mapping[key] || key
      return this._data.map(row => {
        const cell = row[key]
        return cell ? cell.text() : ''
      })
    }

    // Array gets object list
    const normalizedKeys = keys.map(normalize).map(k => mapping[k] || k)
    return this._data.map(row => {
      return normalizedKeys.reduce((h, k) => {
        const cell = row[k]
        h[k] = cell ? cell.text() : ''
        return h
      }, {} as Record<string, string>)
    })
  }

  /**
   * Get table as key-value rows (text only)
   */
  keyValue(): Record<string, string>[] {
    const rows = this.json()
    rows.forEach(row => {
      Object.keys(row).forEach(k => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (row as any)[k] = (row[k] as TableCellJson).text
      })
    })
    return rows as unknown as Record<string, string>[]
  }

  /**
   * Get JSON representation of the table
   */
  json(): TableJson {
    return this._data.map(tableRow => {
      const row: TableRowJson = {}
      Object.keys(tableRow).forEach(k => {
        const cell = tableRow[k]
        if (cell) {
          row[k] = cell.json() as TableCellJson
        }
      })
      return row
    })
  }

  /**
   * Get plain text representation of the table
   */
  text(): string {
    if (this._data.length === 0) return ''

    // Get all column headers
    const headers = Object.keys(this._data[0] || {})
    if (headers.length === 0) return ''

    // Build text representation
    const lines: string[] = []

    // Header row
    lines.push(headers.join(' | '))
    lines.push(headers.map(() => '---').join(' | '))

    // Data rows
    this._data.forEach(row => {
      const cells = headers.map(h => {
        const cell = row[h]
        return cell ? cell.text() : ''
      })
      lines.push(cells.join(' | '))
    })

    return lines.join('\n')
  }

  /**
   * Get the original wikitext
   */
  wikitext(): string {
    return this._wiki
  }
}

// Alias methods
Table.prototype.keyValue = Table.prototype.keyValue
// @ts-expect-error - Alias for keyValue
Table.prototype.keyvalue = Table.prototype.keyValue
// @ts-expect-error - Alias for keyValue
Table.prototype.keyval = Table.prototype.keyValue

// ============================================================================
// TABLE FINDER
// ============================================================================

/**
 * Find and parse tables from wiki text
 * Tables can be nested, so we use a stack-based approach
 */
export function findTables(wiki: string): { tables: Table[]; wiki: string } {
  const list: string[] = []
  const lines = wiki.split('\n')
  const stack: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || ''

    // Start a table (use pre-compiled pattern)
    if (PATTERNS.TABLE_OPEN.test(line)) {
      stack.push(line)
      continue
    }

    // Close a table
    if (PATTERNS.TABLE_CLOSE.test(line)) {
      if (stack.length > 0) {
        stack[stack.length - 1] += '\n' + line
        const table = stack.pop()
        if (table) {
          list.push(table)
        }
      }
      continue
    }

    // Keep going on current table
    if (stack.length > 0) {
      stack[stack.length - 1] += '\n' + line
    }
  }

  // Build Table instances and remove table markup from wiki
  const tables: Table[] = []
  let cleanedWiki = wiki

  list.forEach(str => {
    if (str) {
      // Remove the table from wiki text
      cleanedWiki = cleanedWiki.replace(str + '\n', '')
      cleanedWiki = cleanedWiki.replace(str, '')

      const data = parseTableContent(str)
      if (data && data.length > 0) {
        tables.push(new Table(data, str))
      }
    }
  })

  return { tables, wiki: cleanedWiki }
}
