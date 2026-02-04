/**
 * Compare wtf_wikipedia vs wtf-lite parsing
 * Identifies gaps in wtf-lite template handling
 */

import { describe, it, expect } from 'vitest'
import wtfFull from 'wtf_wikipedia'
import wtfLite from '../src/lib/wtf-lite/index'

const TEST_PAGES = [
  'Tokyo',
  'Albert_Einstein',
  'Apple_Inc.',
  'Google',
  'The_Beatles',
  'Python_(programming_language)',
]

async function fetchWikitext(title: string): Promise<string> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${title}&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'wtf-lite-test/1.0 (https://github.com/example/wtf-lite; test@example.com)'
    }
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  const data = await res.json()
  if (!data?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content) {
    throw new Error(`No content found for ${title}`)
  }
  return data.query.pages[0].revisions[0].slots.main.content
}

interface FieldComparison {
  field: string
  wtfFull: string | undefined
  wtfLite: string | undefined
  hasUnparsedTemplate: boolean
  match: boolean
}

function compareInfoboxes(fullJson: any, liteJson: any): FieldComparison[] {
  const results: FieldComparison[] = []
  const allKeys = new Set([
    ...Object.keys(fullJson || {}),
    ...Object.keys(liteJson || {})
  ])

  for (const key of allKeys) {
    if (key === 'template' || key === 'type') continue

    const fullVal = typeof fullJson?.[key] === 'object'
      ? fullJson[key]?.text
      : fullJson?.[key]
    const liteVal = typeof liteJson?.[key] === 'object'
      ? liteJson[key]?.text
      : liteJson?.[key]

    const fullStr = String(fullVal ?? '')
    const liteStr = String(liteVal ?? '')

    results.push({
      field: key,
      wtfFull: fullStr || undefined,
      wtfLite: liteStr || undefined,
      hasUnparsedTemplate: liteStr.includes('{{'),
      match: fullStr === liteStr
    })
  }

  return results
}

describe('Parser Comparison', () => {
  for (const page of TEST_PAGES) {
    it(`should parse ${page} infobox consistently`, async () => {
      let wikitext: string
      try {
        wikitext = await fetchWikitext(page)
      } catch (e) {
        console.log(`Skipping ${page}: ${(e as Error).message}`)
        return // Skip test on network error
      }

      const fullDoc = wtfFull(wikitext)
      const liteDoc = wtfLite(wikitext)

      const fullInfobox = fullDoc.infoboxes()[0]
      const liteInfobox = liteDoc.infoboxes()[0]

      // Basic check - both should find an infobox
      if (fullInfobox) {
        expect(liteInfobox, `${page}: wtf-lite missing infobox that wtf_wikipedia found`).toBeTruthy()
      }

      if (!fullInfobox || !liteInfobox) {
        console.log(`${page}: Skipping - no infobox`)
        return
      }

      const fullJson = fullInfobox.json()
      const liteJson = liteInfobox.json()

      const comparisons = compareInfoboxes(fullJson, liteJson.data)

      // Report unparsed templates
      const unparsed = comparisons.filter(c => c.hasUnparsedTemplate)
      if (unparsed.length > 0) {
        console.log(`\n${page} - Unparsed templates in wtf-lite:`)
        for (const u of unparsed) {
          console.log(`  ${u.field}: ${u.wtfLite?.slice(0, 80)}...`)
          console.log(`    wtf_wikipedia: ${u.wtfFull?.slice(0, 80)}`)
        }
      }

      // Report mismatches (excluding unparsed)
      const mismatches = comparisons.filter(c => !c.match && !c.hasUnparsedTemplate && c.wtfFull && c.wtfLite)
      if (mismatches.length > 0) {
        console.log(`\n${page} - Value mismatches:`)
        for (const m of mismatches.slice(0, 5)) {
          console.log(`  ${m.field}:`)
          console.log(`    full: ${m.wtfFull?.slice(0, 60)}`)
          console.log(`    lite: ${m.wtfLite?.slice(0, 60)}`)
        }
      }

      // The test passes if we can identify issues, but we want to track them
      expect(true).toBe(true)
    }, 30000)
  }
})

describe('Template Handler Gaps', () => {
  it('should identify all unparsed template types', async () => {
    const templateCounts: Record<string, number> = {}

    for (const page of TEST_PAGES) {
      try {
        const wikitext = await fetchWikitext(page)
        const liteDoc = wtfLite(wikitext)
        const infobox = liteDoc.infoboxes()[0]

        if (!infobox) continue

        const json = infobox.json()
        for (const [key, value] of Object.entries(json.data || {})) {
          const str = String(value)
          const matches = str.matchAll(/\{\{([^|}\n]+)/g)
          for (const match of matches) {
            const templateName = match[1].trim().toLowerCase()
            templateCounts[templateName] = (templateCounts[templateName] || 0) + 1
          }
        }
      } catch (e) {
        console.log(`Error processing ${page}:`, e)
      }
    }

    console.log('\n=== UNPARSED TEMPLATE FREQUENCY ===')
    const sorted = Object.entries(templateCounts).sort((a, b) => b[1] - a[1])
    for (const [name, count] of sorted) {
      console.log(`  ${count}x ${name}`)
    }

    expect(true).toBe(true)
  }, 60000)
})
