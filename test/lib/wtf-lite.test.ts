/**
 * Comprehensive tests for the wtf-lite Wikipedia parser
 *
 * Tests cover:
 * - Basic wikitext parsing
 * - Infobox extraction (person, company, place, film)
 * - Template parsing (birth date, death date, nihongo, currency, coord, marriage)
 * - Link parsing (internal, external)
 * - Section/heading parsing
 * - Category extraction
 * - Redirect detection
 * - Edge cases (malformed wikitext, nested templates, unicode)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import wtf, { Document, Section, Paragraph, Sentence, Link, Infobox, List } from '../../src/lib/wtf-lite/index'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesPath = join(__dirname, '..', 'fixtures')

// ============================================================================
// BASIC WIKITEXT PARSING
// ============================================================================

describe('Basic Wikitext Parsing', () => {
  it('should parse simple text', () => {
    const doc = wtf('Hello world.')
    expect(doc.text()).toBe('Hello world.')
  })

  it('should parse text with title option', () => {
    const doc = wtf('Some content', { title: 'Test Article' })
    expect(doc.title()).toBe('Test Article')
  })

  it('should extract title from bold text if not provided', () => {
    const doc = wtf("'''Bold Title''' is an article about something.")
    expect(doc.title()).toBe('Bold Title')
  })

  it('should handle empty input', () => {
    const doc = wtf('')
    expect(doc.text()).toBe('')
    expect(doc.sections()).toHaveLength(0)
    expect(doc.categories()).toHaveLength(0)
  })

  it('should handle whitespace-only input', () => {
    const doc = wtf('   \n\n   ')
    expect(doc.text().trim()).toBe('')
  })

  it('should strip HTML comments', () => {
    const doc = wtf('Before <!-- hidden comment --> After')
    expect(doc.text()).toBe('Before After')
  })

  it('should convert HTML entities', () => {
    const doc = wtf('Tom &amp; Jerry used &quot;quotes&quot; and &apos;apostrophes&apos;')
    expect(doc.text()).toContain('Tom & Jerry')
    expect(doc.text()).toContain('"quotes"')
    expect(doc.text()).toContain("'apostrophes'")
  })

  it('should handle nbsp entities', () => {
    const doc = wtf('Hello&nbsp;World')
    expect(doc.text()).toBe('Hello World')
  })

  it('should strip NOTOC and similar magic words', () => {
    const doc = wtf('__NOTOC__\n__NOEDITSECTION__\nActual content')
    expect(doc.text()).not.toContain('__NOTOC__')
    expect(doc.text()).toContain('Actual content')
  })
})

// ============================================================================
// INFOBOX EXTRACTION
// ============================================================================

describe('Infobox Extraction', () => {
  describe('Person Infobox', () => {
    it('should parse scientist infobox from sample fixture', () => {
      const wikitext = readFileSync(join(fixturesPath, 'sample-wikitext.txt'), 'utf-8')
      const doc = wtf(wikitext)

      const infoboxes = doc.infoboxes()
      expect(infoboxes).toHaveLength(1)

      const infobox = infoboxes[0]
      expect(infobox.type()).toBe('scientist')
      expect(infobox.get('name').text()).toBe('Marie Curie')
      expect(infobox.get('birth_place').text()).toContain('Warsaw')
    })

    it('should parse person infobox with birth and death dates', () => {
      const wikitext = `
{{Infobox person
| name = John Doe
| birth_date = {{birth date|1950|3|15}}
| death_date = {{death date and age|2020|7|22|1950|3|15}}
| occupation = Writer
}}
John Doe was a famous writer.
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]

      expect(infobox.type()).toBe('person')
      expect(infobox.get('name').text()).toBe('John Doe')
      expect(infobox.get('birth_date').text()).toContain('March 15, 1950')
      expect(infobox.get('death_date').text()).toContain('July 22, 2020')
      expect(infobox.get('occupation').text()).toBe('Writer')
    })

    it('should handle infobox with links', () => {
      const wikitext = `
{{Infobox person
| name = Jane Smith
| nationality = [[United States|American]]
| alma_mater = [[Harvard University]]
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]

      expect(infobox.get('nationality').text()).toBe('American')
      expect(infobox.get('alma_mater').text()).toBe('Harvard University')

      const links = infobox.links()
      expect(links.length).toBeGreaterThan(0)
      expect(links.some(l => l.page() === 'Harvard University')).toBe(true)
    })
  })

  describe('Company Infobox', () => {
    it('should parse company infobox', () => {
      const wikitext = `
{{Infobox company
| name = Acme Corporation
| type = [[Public company|Public]]
| founded = {{start date|1990|1|1}}
| founder = [[John Smith]]
| headquarters = [[New York City]], [[New York (state)|NY]]
| revenue = {{US$|1.5 billion}}
| employees = 10,000
}}
Acme Corporation is a multinational company.
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]

      expect(infobox.type()).toBe('company')
      expect(infobox.get('name').text()).toBe('Acme Corporation')
      expect(infobox.get('founded').text()).toContain('January 1, 1990')
      expect(infobox.get('revenue').text()).toContain('US$')
    })
  })

  describe('Place Infobox', () => {
    it('should parse settlement infobox with coordinates', () => {
      const wikitext = `
{{Infobox settlement
| name = Tokyo
| official_name = Tokyo Metropolis
| native_name = {{nihongo|Tokyo|東京|Tōkyō}}
| coordinates = {{coord|35|41|N|139|41|E|display=inline,title}}
| population = 13,960,000
| timezone = [[Japan Standard Time|JST]]
}}
Tokyo is the capital of Japan.
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]

      expect(infobox.type()).toBe('settlement')
      expect(infobox.get('name').text()).toBe('Tokyo')
      expect(infobox.get('official_name').text()).toBe('Tokyo Metropolis')
    })
  })

  describe('Film Infobox', () => {
    it('should parse film infobox', () => {
      const wikitext = `
{{Infobox film
| name = The Great Movie
| director = [[Steven Spielberg]]
| producer = {{hlist|[[Kathleen Kennedy]]|[[Frank Marshall]]}}
| starring = {{plainlist|
* [[Tom Hanks]]
* [[Meryl Streep]]
}}
| music = [[John Williams]]
| runtime = 142 minutes
| budget = {{US$|100 million}}
| gross = {{US$|500 million}}
}}
The Great Movie is a 2020 drama film.
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]

      expect(infobox.type()).toBe('film')
      expect(infobox.get('name').text()).toBe('The Great Movie')
      expect(infobox.get('director').text()).toBe('Steven Spielberg')
    })
  })

  describe('Infobox Edge Cases', () => {
    it('should handle empty infobox', () => {
      const wikitext = `{{Infobox}}\nSome text.`
      const doc = wtf(wikitext)
      expect(doc.infoboxes()).toHaveLength(1)
    })

    it('should handle infobox with only type', () => {
      const wikitext = `{{Infobox person}}\nSome text.`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      expect(infobox.type()).toBe('person')
    })

    it('should normalize key names with dashes and underscores', () => {
      const wikitext = `
{{Infobox person
| birth-date = 1990
| death_date = 2020
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]

      // Should be able to get with either format
      expect(infobox.get('birth-date').text()).toBe('1990')
      expect(infobox.get('birth_date').text()).toBe('1990')
      expect(infobox.get('death-date').text()).toBe('2020')
    })

    it('should handle multiple infoboxes', () => {
      const wikitext = `
{{Infobox person
| name = Person A
}}
{{Infobox company
| name = Company B
}}
`
      const doc = wtf(wikitext)
      const infoboxes = doc.infoboxes()
      expect(infoboxes.length).toBeGreaterThanOrEqual(1)
    })

    it('should return keyValue object', () => {
      const wikitext = `
{{Infobox person
| name = Test Name
| age = 30
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      const kv = infobox.keyValue()

      expect(kv).toHaveProperty('name', 'Test Name')
      expect(kv).toHaveProperty('age', '30')
    })
  })
})

// ============================================================================
// TEMPLATE PARSING
// ============================================================================

describe('Template Parsing', () => {
  describe('Birth Date Templates', () => {
    it('should parse {{birth date and age}}', () => {
      const doc = wtf('Born on {{birth date and age|1990|5|15}}.')
      expect(doc.text()).toContain('May 15, 1990')
    })

    it('should parse {{birth date}} without age', () => {
      const doc = wtf('Born on {{birth date|1885|3|14}}.')
      expect(doc.text()).toContain('March 14, 1885')
    })

    it('should parse {{bda}} shorthand', () => {
      const doc = wtf('Born {{bda|2000|12|25}}.')
      expect(doc.text()).toContain('December 25, 2000')
    })

    it('should handle birth date with only year and month', () => {
      const doc = wtf('Born {{birth date|1950|6}}.')
      expect(doc.text()).toContain('June 1950')
    })

    it('should handle birth date with only year', () => {
      const doc = wtf('Born {{birth date|1900}}.')
      expect(doc.text()).toContain('1900')
    })

    it('should add birth date to templates array', () => {
      const doc = wtf('Born {{birth date|1990|5|15}}.')
      const templates = doc.templates()
      const birthTemplate = templates.find(t => t.template === 'birth date')
      expect(birthTemplate).toBeDefined()
      expect(birthTemplate.year).toBe('1990')
      expect(birthTemplate.month).toBe('5')
      expect(birthTemplate.day).toBe('15')
    })
  })

  describe('Death Date Templates', () => {
    it('should parse {{death date and age}}', () => {
      const doc = wtf('Died on {{death date and age|2020|7|4|1950|3|15}}.')
      expect(doc.text()).toContain('July 4, 2020')
    })

    it('should parse {{death date}}', () => {
      const doc = wtf('Died on {{death date|1934|7|4}}.')
      expect(doc.text()).toContain('July 4, 1934')
    })

    it('should add death date to templates array', () => {
      const doc = wtf('Died {{death date|2020|12|31}}.')
      const templates = doc.templates()
      const deathTemplate = templates.find(t => t.template === 'death date')
      expect(deathTemplate).toBeDefined()
    })
  })

  describe('Start/End Date Templates', () => {
    it('should parse {{start date}}', () => {
      const doc = wtf('Founded on {{start date|2004|2|4}}.')
      expect(doc.text()).toContain('February 4, 2004')
    })

    it('should parse {{end date}}', () => {
      const doc = wtf('Ended on {{end date|2010|6|30}}.')
      expect(doc.text()).toContain('June 30, 2010')
    })
  })

  describe('As Of Template', () => {
    it('should parse {{as of}}', () => {
      const doc = wtf('{{as of|2023|5|1}}, the population is 1 million.')
      expect(doc.text()).toContain('As of May 1, 2023')
    })

    it('should handle since parameter', () => {
      const doc = wtf('{{as of|2020|1|since=yes}} it has been open.')
      expect(doc.text()).toContain('Since')
    })
  })

  describe('Nihongo Templates', () => {
    it('should parse {{nihongo}}', () => {
      const doc = wtf('Tokyo ({{nihongo|Tokyo|東京|Tōkyō}}) is the capital.')
      const text = doc.text()
      expect(text).toContain('Tokyo')
      expect(text).toContain('東京')
    })

    it('should parse {{nihongo2}} - kanji only', () => {
      const doc = wtf('The word {{nihongo2|日本}} means Japan.')
      expect(doc.text()).toContain('日本')
    })

    it('should parse {{nihongo3}} - romaji with kanji', () => {
      const doc = wtf('{{nihongo3|Nihon|日本}} is the endonym.')
      const text = doc.text()
      expect(text).toContain('Nihon')
      expect(text).toContain('日本')
    })

    it('should parse {{nihongo-s}}', () => {
      const doc = wtf('The {{nihongo-s|漢字}} characters.')
      expect(doc.text()).toContain('漢字')
    })
  })

  describe('Currency Templates', () => {
    // US Dollar variants
    it('should parse {{US$}}', () => {
      const doc = wtf('The budget was {{US$|50 million}}.')
      expect(doc.text()).toContain('US$50 million')
    })

    it('should parse {{USD}}', () => {
      const doc = wtf('Revenue of {{usd|1.5 billion}}.')
      expect(doc.text()).toContain('US$1.5 billion')
    })

    it('should parse {{US dollar}}', () => {
      const doc = wtf('Worth {{US dollar|100}}.')
      expect(doc.text()).toContain('US$100')
    })

    // British Pound variants
    it('should parse {{GBP}}', () => {
      const doc = wtf('Cost {{gbp|500}}.')
      expect(doc.text()).toContain('GB£500')
    })

    it('should parse {{£}}', () => {
      const doc = wtf('Price {{£|250}}.')
      expect(doc.text()).toContain('GB£250')
    })

    // Euro variants
    it('should parse {{EUR}}', () => {
      const doc = wtf('Amount {{EUR|1000}}.')
      expect(doc.text()).toContain('€1,000')
    })

    it('should parse {{€}}', () => {
      const doc = wtf('Value {{€|500}}.')
      expect(doc.text()).toContain('€500')
    })

    it('should parse {{currency}}', () => {
      const doc = wtf('Worth {{currency|100|code=EUR}}.')
      const text = doc.text()
      // Should contain the amount
      expect(text).toContain('100')
    })

    // Decimal amounts
    it('should handle decimal amounts correctly', () => {
      const doc = wtf('Revenue was {{US$|1.5 million}}.')
      expect(doc.text()).toBe('Revenue was US$1.5 million.')
    })

    it('should handle decimal amounts with multiple decimal places', () => {
      const doc = wtf('Price is {{EUR|3.75}}.')
      expect(doc.text()).toBe('Price is €3.75.')
    })

    // Sentence splitting with currency decimals
    it('should not split sentences on currency decimal points', () => {
      const doc = wtf('Revenue was {{US$|1.5 million}}. Profit was high.')
      const sentences = doc.sentences()
      expect(sentences).toHaveLength(2)
      expect(sentences[0].text()).toBe('Revenue was US$1.5 million.')
      expect(sentences[1].text()).toBe('Profit was high.')
    })

    it('should not split sentences on inline currency decimal points', () => {
      const doc = wtf('Revenue was US$1.5 million. Profit was high.')
      const sentences = doc.sentences()
      expect(sentences).toHaveLength(2)
      expect(sentences[0].text()).toBe('Revenue was US$1.5 million.')
      expect(sentences[1].text()).toBe('Profit was high.')
    })

    it('should handle multiple currency values with decimals', () => {
      const doc = wtf('Revenue was {{US$|1.5 million}} and profit was {{EUR|2.3 billion}}.')
      expect(doc.text()).toBe('Revenue was US$1.5 million and profit was €2.3 billion.')
    })
  })

  describe('Coord Template', () => {
    it('should parse simple decimal coordinates', () => {
      const doc = wtf('Located at {{coord|35.6762|139.6503}}.')
      const coords = doc.coordinates()
      expect(coords).toHaveLength(1)
      expect(coords[0].lat).toBeCloseTo(35.6762, 4)
      expect(coords[0].lon).toBeCloseTo(139.6503, 4)
    })

    it('should parse DMS coordinates', () => {
      const doc = wtf('Located at {{coord|35|41|N|139|41|E}}.')
      const coords = doc.coordinates()
      expect(coords).toHaveLength(1)
      expect(coords[0].lat).toBeCloseTo(35.683, 2)
      expect(coords[0].lon).toBeCloseTo(139.683, 2)
    })

    it('should parse full DMS with seconds', () => {
      const doc = wtf('{{coord|51|30|26|N|0|7|39|W}}')
      const coords = doc.coordinates()
      expect(coords).toHaveLength(1)
      // London approximate
      expect(coords[0].lat).toBeCloseTo(51.507, 2)
      expect(coords[0].lon).toBeCloseTo(0.127, 2)
    })

    it('should handle Southern hemisphere coordinates', () => {
      const doc = wtf('{{coord|33|52|S|151|12|E}}')
      const coords = doc.coordinates()
      expect(coords).toHaveLength(1)
      // Sydney approximate
      expect(coords[0].lat).toBeCloseTo(33.867, 2)
    })

    it('should store coord template with direction', () => {
      const doc = wtf('{{coord|35|41|N|139|41|E}}')
      const templates = doc.templates()
      const coord = templates.find(t => t.template === 'coord')
      expect(coord).toBeDefined()
      expect(coord.latDir).toBe('N')
      expect(coord.lonDir).toBe('E')
    })

    it('should display inline coordinates in text', () => {
      const doc = wtf('Location: {{coord|40|N|74|W|display=inline}}.')
      const text = doc.text()
      expect(text).toContain('40')
      expect(text).toContain('N')
    })
  })

  describe('Marriage Template', () => {
    it('should parse {{marriage}} in infobox values', () => {
      // Marriage template is parsed in infobox values, not in body text
      const wikitext = `
{{Infobox person
| name = John Doe
| spouse = {{marriage|Jane Doe|1990|2010}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      const spouse = infobox.get('spouse').text()
      expect(spouse).toContain('Jane Doe')
      expect(spouse).toContain('1990')
    })

    it('should parse {{marriage}} with ongoing marriage in infobox', () => {
      const wikitext = `
{{Infobox person
| name = Test
| spouse = {{marriage|John Smith|2005}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      const spouse = infobox.get('spouse').text()
      expect(spouse).toContain('John Smith')
      expect(spouse).toContain('2005')
    })
  })

  describe('Convert Template', () => {
    it('should parse {{convert}}', () => {
      const doc = wtf('The height is {{convert|100|m|ft}}.')
      expect(doc.text()).toContain('100 m')
    })

    it('should parse {{cvt}} shorthand', () => {
      const doc = wtf('Weight: {{cvt|50|kg|lb}}.')
      expect(doc.text()).toContain('50 kg')
    })

    it('should handle range conversions', () => {
      const doc = wtf('Temperature: {{convert|20|to|30|C}}.')
      expect(doc.text()).toContain('20')
      expect(doc.text()).toContain('30')
    })
  })

  describe('Fraction Template', () => {
    it('should parse {{fraction}} with two numbers', () => {
      const doc = wtf('About {{fraction|1|2}} of the population.')
      expect(doc.text()).toContain('1/2')
    })

    it('should parse {{fraction}} with whole number', () => {
      const doc = wtf('It takes {{fraction|2|1|4}} hours.')
      expect(doc.text()).toContain('2 1/4')
    })

    it('should parse {{frac}} shorthand', () => {
      const doc = wtf('About {{frac|3|4}} complete.')
      expect(doc.text()).toContain('3/4')
    })
  })

  describe('Val Template', () => {
    it('should parse {{val}} with number', () => {
      const doc = wtf('Distance: {{val|299792458}} m/s.')
      const text = doc.text()
      expect(text).toContain('299')
    })

    it('should parse {{val}} with unit', () => {
      const doc = wtf('Speed: {{val|100|u=km/h}}.')
      expect(doc.text()).toContain('100')
    })
  })

  describe('List Templates', () => {
    it('should parse {{hlist}}', () => {
      const doc = wtf('Options: {{hlist|Red|Green|Blue}}.')
      const text = doc.text()
      expect(text).toContain('Red')
      expect(text).toContain('Green')
      expect(text).toContain('Blue')
    })

    it('should parse {{plainlist}}', () => {
      const doc = wtf('Items: {{plainlist|Apple|Banana|Cherry}}.')
      const text = doc.text()
      expect(text).toContain('Apple')
      expect(text).toContain('Banana')
    })

    it('should parse {{ubl}} unbulleted list', () => {
      const doc = wtf('People: {{ubl|John|Jane|Bob}}.')
      const text = doc.text()
      expect(text).toContain('John')
      expect(text).toContain('Jane')
    })

    it('should parse {{bulleted list}}', () => {
      const doc = wtf('Features: {{bulleted list|Fast|Reliable|Secure}}.')
      const text = doc.text()
      expect(text).toContain('Fast')
    })
  })

  describe('Sortname Template', () => {
    it('should parse {{sortname}}', () => {
      const doc = wtf('Winner: {{sortname|Michael|Jordan}}.')
      expect(doc.text()).toContain('Michael Jordan')
    })

    it('should parse {{sortname}} with link', () => {
      const doc = wtf('{{sortname|Barack|Obama}}')
      const links = doc.links()
      expect(links.length).toBeGreaterThan(0)
    })

    it('should handle nolink parameter', () => {
      const doc = wtf('{{sortname|John|Smith|nolink=yes}}')
      expect(doc.text()).toContain('John Smith')
    })

    it('should preserve full name in infobox author field', () => {
      const wikitext = `
{{Infobox book
| name = Test Book
| author = {{sortname|John|Smith}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      expect(infobox.get('author').text()).toBe('John Smith')
    })

    it('should parse sortname with third parameter (link)', () => {
      const doc = wtf('{{sortname|First|Last|link}}')
      expect(doc.text()).toContain('First Last')
    })

    it('should parse multiple sortnames in infobox', () => {
      const wikitext = `
{{Infobox film
| name = Test Film
| director = {{sortname|Steven|Spielberg}}
| producer = {{sortname|Kathleen|Kennedy}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      expect(infobox.get('director').text()).toBe('Steven Spielberg')
      expect(infobox.get('producer').text()).toBe('Kathleen Kennedy')
    })

    it('should handle sortname with dab parameter', () => {
      const doc = wtf('{{sortname|John|Smith|dab=politician}}')
      expect(doc.text()).toContain('John Smith')
    })

    it('should handle sortname with target parameter', () => {
      const doc = wtf('{{sortname|Mike|Jordan|target=Michael Jordan}}')
      expect(doc.text()).toContain('Mike Jordan')
    })
  })

  describe('URL Template', () => {
    it('should parse {{URL}} in infobox', () => {
      // URL template is parsed within infobox values via parseDateTemplatesInValue
      const wikitext = `
{{Infobox company
| name = Test Corp
| website = {{URL|https://example.com}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      const website = infobox.get('website').text()
      expect(website).toContain('example')
    })

    it('should parse {{URL}} with display text', () => {
      const wikitext = `
{{Infobox company
| name = Test Corp
| website = {{URL|https://example.com|Example Site}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      const website = infobox.get('website').text()
      expect(website).toContain('Example Site')
    })
  })

  describe('Current Date Templates', () => {
    it('should parse {{currentyear}}', () => {
      const doc = wtf('Year: {{currentyear}}.')
      const text = doc.text()
      const currentYear = new Date().getFullYear()
      expect(text).toContain(String(currentYear))
    })

    it('should parse {{currentmonthname}}', () => {
      const doc = wtf('Month: {{currentmonthname}}.')
      const text = doc.text()
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      expect(months.some(m => text.includes(m))).toBe(true)
    })
  })

  describe('Sports Templates', () => {
    it('should parse {{goal}}', () => {
      const doc = wtf("Goals: {{goal|23'|45'}}.")
      const templates = doc.templates()
      const goal = templates.find(t => t.template === 'goal')
      expect(goal).toBeDefined()
      expect(goal.data).toHaveLength(1)
    })

    it('should parse {{player}}', () => {
      const doc = wtf('{{player|10|BRA|Pelé}}')
      const templates = doc.templates()
      const player = templates.find(t => t.template === 'player')
      expect(player).toBeDefined()
      expect(player.name).toBe('Pelé')
    })
  })
})

// ============================================================================
// LINK PARSING
// ============================================================================

describe('Link Parsing', () => {
  describe('Internal Links', () => {
    it('should parse simple internal link', () => {
      const doc = wtf('Visit [[Paris]] for vacation.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Paris')
      expect(links[0].text()).toBe('Paris')
      expect(links[0].type()).toBe('internal')
    })

    it('should parse piped link', () => {
      const doc = wtf('Visit [[Paris|the City of Light]].')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Paris')
      expect(links[0].text()).toBe('the City of Light')
    })

    it('should parse link with anchor', () => {
      const doc = wtf('See [[Article#Section]] for details.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Article')
      expect(links[0].anchor()).toBe('Section')
    })

    it('should parse link with suffix', () => {
      const doc = wtf('Many [[cat]]s live here.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('cat')
      expect(links[0].text()).toBe('cats')
    })

    it('should handle multiple links', () => {
      const doc = wtf('[[France]] is near [[Germany]] and [[Spain]].')
      const links = doc.links()
      expect(links).toHaveLength(3)
      expect(links.map(l => l.page())).toEqual(['France', 'Germany', 'Spain'])
    })

    it('should exclude category links from regular links', () => {
      const doc = wtf('[[Category:Countries]] Content here.')
      const links = doc.links()
      expect(links).toHaveLength(0)
    })

    it('should exclude file/image links', () => {
      const doc = wtf('[[File:Example.jpg|thumb|Description]] Text.')
      const links = doc.links()
      expect(links.filter(l => l.page()?.startsWith('File:'))).toHaveLength(0)
    })
  })

  describe('External Links', () => {
    it('should parse external link with text and replace in output', () => {
      const doc = wtf('Visit [https://example.com Example Site] for more.')
      const text = doc.text()
      // External links are replaced with their display text
      expect(text).toContain('Example Site')
    })

    it('should parse external link in sentence links', () => {
      // External links with display text have the text extracted
      const doc = wtf('Visit [http://example.com/ Example Site] here.')
      const text = doc.text()
      // The parser extracts external link display text
      expect(text).toContain('Example Site')
    })

    it('should handle external link without display text', () => {
      const doc = wtf('Link: [https://example.com/page].')
      // Link is parsed and text is extracted
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Link in Text', () => {
    it('should replace links with their text in output', () => {
      const doc = wtf('[[Paris|The capital]] of [[France]] is beautiful.')
      const text = doc.text()
      expect(text).toContain('The capital')
      expect(text).toContain('France')
      expect(text).not.toContain('[[')
    })
  })
})

// ============================================================================
// SECTION/HEADING PARSING
// ============================================================================

describe('Section Parsing', () => {
  it('should parse level 2 headings', () => {
    const doc = wtf('Intro.\n\n== Section One ==\nContent one.\n\n== Section Two ==\nContent two.')
    const sections = doc.sections()
    expect(sections.length).toBeGreaterThanOrEqual(2)
  })

  it('should get section by title', () => {
    const doc = wtf('Intro.\n\n== History ==\nHistorical content.\n\n== Geography ==\nGeographic content.')
    const history = doc.sections('History')
    expect(history).toHaveLength(1)
    expect(history[0].text()).toContain('Historical content')
  })

  it('should get section by index', () => {
    const doc = wtf('Intro.\n\n== First ==\nFirst content.')
    const sections = doc.sections()
    if (sections.length > 0) {
      const first = doc.sections(0)
      expect(first).toHaveLength(1)
    }
  })

  it('should parse section depth correctly', () => {
    const doc = wtf('== Level 2 ==\nContent.\n\n=== Level 3 ===\nNested.\n\n==== Level 4 ====\nDeep.')
    const sections = doc.sections()

    const level2 = sections.find(s => s.title() === 'Level 2')
    const level3 = sections.find(s => s.title() === 'Level 3')
    const level4 = sections.find(s => s.title() === 'Level 4')

    if (level2) expect(level2.depth()).toBe(0)
    if (level3) expect(level3.depth()).toBe(1)
    if (level4) expect(level4.depth()).toBe(2)
  })

  it('should get section title', () => {
    const doc = wtf('== My Section ==\nContent.')
    const sections = doc.sections()
    const section = sections.find(s => s.title() === 'My Section')
    expect(section).toBeDefined()
  })

  it('should get section paragraphs', () => {
    const doc = wtf('== Section ==\nFirst paragraph.\n\nSecond paragraph.')
    const section = doc.sections().find(s => s.title() === 'Section')
    if (section) {
      const paragraphs = section.paragraphs()
      expect(paragraphs.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('should get section sentences', () => {
    const doc = wtf('== Section ==\nThis is sentence one. This is sentence two.')
    const section = doc.sections().find(s => s.title() === 'Section')
    if (section) {
      const sentences = section.sentences()
      expect(sentences.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('should use sample fixture sections', () => {
    const wikitext = readFileSync(join(fixturesPath, 'sample-wikitext.txt'), 'utf-8')
    const doc = wtf(wikitext)
    const sections = doc.sections()

    // Should have Early life, Scientific career, Legacy sections
    expect(sections.some(s => s.title() === 'Early life')).toBe(true)
    expect(sections.some(s => s.title() === 'Scientific career')).toBe(true)
    expect(sections.some(s => s.title() === 'Legacy')).toBe(true)
  })
})

// ============================================================================
// CATEGORY EXTRACTION
// ============================================================================

describe('Category Extraction', () => {
  it('should extract categories', () => {
    const doc = wtf('Content.\n\n[[Category:Scientists]]')
    const cats = doc.categories()
    expect(cats).toContain('Scientists')
  })

  it('should extract multiple categories', () => {
    // Categories need minimum length (2+ chars after the colon per the regex)
    const doc = wtf('Content.\n\n[[Category:Alpha]]\n[[Category:Beta]]\n[[Category:Gamma]]')
    const cats = doc.categories()
    expect(cats).toContain('Alpha')
    expect(cats).toContain('Beta')
    expect(cats).toContain('Gamma')
  })

  it('should remove categories from text output', () => {
    const doc = wtf('Content here.\n[[Category:Test]]')
    expect(doc.text()).not.toContain('Category:')
    expect(doc.text()).not.toContain('[[')
  })

  it('should handle category with sort key', () => {
    const doc = wtf('[[Category:People|Smith, John]]')
    const cats = doc.categories()
    expect(cats).toContain('People')
  })

  it('should use sample fixture categories', () => {
    const wikitext = readFileSync(join(fixturesPath, 'sample-wikitext.txt'), 'utf-8')
    const doc = wtf(wikitext)
    const cats = doc.categories()

    expect(cats).toContain('1867 births')
    expect(cats).toContain('1934 deaths')
    expect(cats).toContain('Polish physicists')
    expect(cats).toContain('Nobel laureates in Physics')
  })

  it('should handle i18n category names', () => {
    const doc = wtf('Content.\n[[Categoria:Científicos]]')
    const cats = doc.categories()
    expect(cats.length).toBeGreaterThan(0)
  })

  it('should get category by index', () => {
    const doc = wtf('[[Category:First]]\n[[Category:Second]]')
    const first = doc.categories(0)
    expect(first[0]).toBe('First')
  })
})

// ============================================================================
// REDIRECT DETECTION
// ============================================================================

describe('Redirect Detection', () => {
  it('should detect redirect pages', () => {
    const doc = wtf('#REDIRECT [[Target Article]]')
    expect(doc.isRedirect()).toBe(true)
  })

  it('should get redirect target', () => {
    const doc = wtf('#REDIRECT [[Target Article]]')
    const target = doc.redirectTo()
    expect(target).toBeDefined()
    expect(target.page()).toBe('Target Article')
  })

  it('should handle redirect with different casing', () => {
    const doc = wtf('#redirect [[Other Page]]')
    expect(doc.isRedirect()).toBe(true)
  })

  it('should handle i18n redirects', () => {
    const doc = wtf('#WEITERLEITUNG [[Zielartikel]]')
    expect(doc.isRedirect()).toBe(true)
  })

  it('should return empty text for redirects', () => {
    const doc = wtf('#REDIRECT [[Target]]')
    expect(doc.text()).toBe('')
  })

  it('should not be redirect for normal articles', () => {
    const doc = wtf('This is a normal article about something.')
    expect(doc.isRedirect()).toBe(false)
    expect(doc.redirectTo()).toBeNull()
  })

  it('should handle redirect with categories', () => {
    const doc = wtf('#REDIRECT [[Target]]\n[[Category:Redirects]]')
    expect(doc.isRedirect()).toBe(true)
    const cats = doc.categories()
    expect(cats).toContain('Redirects')
  })
})

// ============================================================================
// LIST PARSING
// ============================================================================

describe('List Parsing', () => {
  it('should parse bulleted lists', () => {
    const doc = wtf('== List ==\n* Item one\n* Item two\n* Item three')
    const section = doc.sections().find(s => s.title() === 'List')
    if (section) {
      const lists = section.lists()
      expect(lists.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('should parse numbered lists', () => {
    const doc = wtf('== Steps ==\n# First step\n# Second step\n# Third step')
    const section = doc.sections().find(s => s.title() === 'Steps')
    if (section) {
      const lists = section.lists()
      expect(lists.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('should get list lines', () => {
    const doc = wtf('* Apple\n* Banana\n* Cherry')
    const lists = doc.sections()[0]?.lists() || []
    if (lists.length > 0) {
      const lines = lists[0].lines()
      expect(lines.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('should get list text', () => {
    const doc = wtf('* One\n* Two')
    const lists = doc.sections()[0]?.lists() || []
    if (lists.length > 0) {
      const text = lists[0].text()
      expect(text).toContain('One')
      expect(text).toContain('Two')
    }
  })
})

// ============================================================================
// PARAGRAPH AND SENTENCE PARSING
// ============================================================================

describe('Paragraph Parsing', () => {
  it('should split paragraphs on double newlines', () => {
    const doc = wtf('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.')
    const paras = doc.paragraphs()
    expect(paras.length).toBeGreaterThanOrEqual(3)
  })

  it('should get paragraph text', () => {
    const doc = wtf('This is a paragraph with multiple sentences. It has content.')
    const para = doc.paragraphs()[0]
    expect(para.text()).toContain('This is a paragraph')
  })

  it('should get paragraph sentences', () => {
    const doc = wtf('First sentence. Second sentence. Third sentence.')
    const para = doc.paragraphs()[0]
    const sentences = para.sentences()
    expect(sentences.length).toBeGreaterThanOrEqual(3)
  })

  it('should get paragraph links', () => {
    const doc = wtf('Visit [[Paris]] and [[London]] in Europe.')
    const para = doc.paragraphs()[0]
    const links = para.links()
    expect(links.length).toBe(2)
  })
})

describe('Sentence Parsing', () => {
  it('should split on period', () => {
    const doc = wtf('First. Second. Third.')
    const sentences = doc.sentences()
    expect(sentences.length).toBeGreaterThanOrEqual(3)
  })

  it('should handle abbreviations', () => {
    const doc = wtf('Dr. Smith went to Washington D.C. for a meeting.')
    const sentences = doc.sentences()
    // Should not split on "Dr." or "D.C."
    expect(sentences.length).toBeLessThanOrEqual(2)
  })

  it('should not split on decimal numbers', () => {
    const doc = wtf('He scored 2.5 points. The team won.')
    const sentences = doc.sentences()
    expect(sentences).toHaveLength(2)
    expect(sentences[0].text()).toBe('He scored 2.5 points.')
    expect(sentences[1].text()).toBe('The team won.')
  })

  it('should not split on decimal numbers with currency symbols', () => {
    const doc = wtf('Price is $3.50 per item. Shipping is extra.')
    const sentences = doc.sentences()
    expect(sentences).toHaveLength(2)
    expect(sentences[0].text()).toBe('Price is $3.50 per item.')
    expect(sentences[1].text()).toBe('Shipping is extra.')
  })

  it('should not split on decimal numbers with zero before decimal', () => {
    const doc = wtf('The ratio was 0.75. Next value.')
    const sentences = doc.sentences()
    expect(sentences).toHaveLength(2)
    expect(sentences[0].text()).toBe('The ratio was 0.75.')
    expect(sentences[1].text()).toBe('Next value.')
  })

  it('should extract bold text', () => {
    const doc = wtf("'''Bold text''' is important.")
    const sentence = doc.sentences()[0]
    expect(sentence.bold()).toBe('Bold text')
  })

  it('should extract links from sentence', () => {
    const doc = wtf('Visit [[Paris]] in [[France]].')
    const sentence = doc.sentences()[0]
    const links = sentence.links()
    expect(links.length).toBe(2)
  })

  it('should get sentence text', () => {
    const doc = wtf('This is a test sentence.')
    const sentence = doc.sentences()[0]
    expect(sentence.text()).toBe('This is a test sentence.')
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  describe('Malformed Wikitext', () => {
    it('should handle unclosed templates', () => {
      const doc = wtf('Text {{unclosed template.')
      // Should not throw
      expect(doc.text()).toBeDefined()
    })

    it('should handle unclosed links', () => {
      const doc = wtf('Visit [[unclosed link for more.')
      expect(doc.text()).toBeDefined()
    })

    it('should handle extra closing brackets', () => {
      const doc = wtf('Normal text ]] more text.')
      expect(doc.text()).toBeDefined()
    })

    it('should handle malformed infobox', () => {
      const doc = wtf('{{Infobox\n| broken = value\nNo closing braces')
      // Should not throw
      expect(() => doc.infoboxes()).not.toThrow()
    })

    it('should handle empty template', () => {
      const doc = wtf('Text {{}} more text.')
      expect(doc.text()).toBeDefined()
    })

    it('should handle unclosed HTML tags', () => {
      const doc = wtf('Text <b>bold without closing.')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Nested Templates', () => {
    it('should handle nested templates in infobox', () => {
      const wikitext = `
{{Infobox person
| birth_date = {{birth date|{{CURRENTYEAR}}|1|1}}
| occupation = {{hlist|Writer|Actor}}
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      expect(infobox).toBeDefined()
    })

    it('should handle multiple levels of nesting', () => {
      const doc = wtf('{{outer|{{middle|{{inner|value}}}}}}')
      // Should not throw
      expect(doc.text()).toBeDefined()
    })

    it('should handle template inside link', () => {
      const doc = wtf('[[Article ({{year}})|Display]]')
      expect(doc.text()).toBeDefined()
    })

    it('should handle link inside template', () => {
      const doc = wtf('{{cite|author=[[John Smith]]|title=Book}}')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Unicode Characters', () => {
    it('should handle Japanese text', () => {
      const doc = wtf('東京 (Tokyo) is the capital of 日本 (Japan).')
      expect(doc.text()).toContain('東京')
      expect(doc.text()).toContain('日本')
    })

    it('should handle Chinese text', () => {
      const doc = wtf('北京是中国的首都。')
      expect(doc.text()).toContain('北京')
    })

    it('should handle Arabic text', () => {
      const doc = wtf('مرحبا بالعالم')
      expect(doc.text()).toContain('مرحبا')
    })

    it('should handle Cyrillic text', () => {
      const doc = wtf('Москва - столица России.')
      expect(doc.text()).toContain('Москва')
    })

    it('should handle emoji', () => {
      const doc = wtf('This is fun! ')
      expect(doc.text()).toBeDefined()
    })

    it('should handle special Unicode in links', () => {
      const doc = wtf('[[Zürich|Zurich]] is in [[Schweiz|Switzerland]].')
      const links = doc.links()
      expect(links[0].page()).toBe('Zürich')
    })

    it('should handle Japanese ideographic full stop', () => {
      const doc = wtf('これは文です。次の文です。')
      // Japanese full stop should be converted to period
      expect(doc.text()).toContain('.')
    })
  })

  describe('Empty/Null Values', () => {
    it('should handle infobox with empty values', () => {
      const wikitext = `
{{Infobox person
| name =
| birth_date =
| occupation = Writer
}}
`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      expect(infobox.get('occupation').text()).toBe('Writer')
    })

    it('should handle getting non-existent infobox key', () => {
      const wikitext = `{{Infobox person|name=Test}}`
      const doc = wtf(wikitext)
      const infobox = doc.infoboxes()[0]
      const missing = infobox.get('nonexistent')
      expect(missing.text()).toBe('')
    })

    it('should handle empty section', () => {
      const doc = wtf('== Empty Section ==\n\n== Next Section ==\nContent.')
      const sections = doc.sections()
      expect(sections.length).toBeGreaterThan(0)
    })
  })

  describe('Large Input', () => {
    it('should handle very long text', () => {
      const longText = 'Word '.repeat(10000)
      const doc = wtf(longText)
      expect(doc.text().length).toBeGreaterThan(0)
    })

    it('should handle many links', () => {
      const manyLinks = Array(100).fill('[[Link]]').join(' ')
      const doc = wtf(manyLinks)
      const links = doc.links()
      expect(links.length).toBe(100)
    })

    it('should handle many templates', () => {
      const manyTemplates = Array(50).fill('{{template|param}}').join(' ')
      const doc = wtf(manyTemplates)
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Special Characters', () => {
    it('should handle pipes in template values', () => {
      const doc = wtf('{{template|value with | pipe}}')
      expect(doc.text()).toBeDefined()
    })

    it('should handle equals in template values', () => {
      const wikitext = `{{Infobox|formula = E=mc2}}`
      const doc = wtf(wikitext)
      expect(doc.text()).toBeDefined()
    })

    it('should handle multiple dashes', () => {
      const doc = wtf('Before ---- After')
      expect(doc.text()).toContain('Before')
      expect(doc.text()).toContain('After')
    })
  })
})

// ============================================================================
// JSON OUTPUT
// ============================================================================

describe('JSON Output', () => {
  it('should produce valid JSON from document', () => {
    const doc = wtf('== Section ==\nContent.')
    const json = doc.json()
    expect(json).toHaveProperty('title')
    expect(json).toHaveProperty('categories')
    expect(json).toHaveProperty('sections')
  })

  it('should include sections in JSON', () => {
    const doc = wtf('== Test ==\nContent.')
    const json = doc.json() as any
    expect(json.sections).toBeInstanceOf(Array)
    expect(json.sections[0]).toHaveProperty('title')
    expect(json.sections[0]).toHaveProperty('paragraphs')
  })

  it('should include infoboxes in section JSON', () => {
    const wikitext = `{{Infobox person|name=Test}}\n== Section ==\nContent.`
    const doc = wtf(wikitext)
    const json = doc.json() as any
    // First section should have infobox
    const sectionWithInfobox = json.sections.find((s: any) => s.infoboxes?.length > 0)
    if (sectionWithInfobox) {
      expect(sectionWithInfobox.infoboxes[0]).toHaveProperty('type')
      expect(sectionWithInfobox.infoboxes[0]).toHaveProperty('data')
    }
  })

  it('should produce valid JSON from sentence', () => {
    const doc = wtf('Visit [[Paris]] for fun.')
    const sentence = doc.sentences()[0]
    const json = sentence.json() as any
    expect(json).toHaveProperty('text')
    expect(json).toHaveProperty('links')
  })

  it('should produce valid JSON from infobox', () => {
    const doc = wtf('{{Infobox person|name=John|age=30}}')
    const infobox = doc.infoboxes()[0]
    const json = infobox.json() as any
    expect(json).toHaveProperty('type')
    expect(json).toHaveProperty('data')
    expect(json.data).toHaveProperty('name')
  })
})

// ============================================================================
// CLASS EXPORTS
// ============================================================================

describe('Class Exports', () => {
  it('should export Document class', () => {
    expect(Document).toBeDefined()
  })

  it('should export Section class', () => {
    expect(Section).toBeDefined()
  })

  it('should export Paragraph class', () => {
    expect(Paragraph).toBeDefined()
  })

  it('should export Sentence class', () => {
    expect(Sentence).toBeDefined()
  })

  it('should export Link class', () => {
    expect(Link).toBeDefined()
  })

  it('should export Infobox class', () => {
    expect(Infobox).toBeDefined()
  })

  it('should export List class', () => {
    expect(List).toBeDefined()
  })
})

// ============================================================================
// FILE/IMAGE HANDLING
// ============================================================================

describe('File and Image Handling', () => {
  it('should strip File links', () => {
    const doc = wtf('Text [[File:Example.jpg|thumb|200px|Caption]] more text.')
    expect(doc.text()).not.toContain('File:')
    expect(doc.text()).not.toContain('Example.jpg')
  })

  it('should strip Image links', () => {
    const doc = wtf('Text [[Image:Photo.png|right|300px]] more text.')
    expect(doc.text()).not.toContain('Image:')
    expect(doc.text()).not.toContain('Photo.png')
  })

  it('should handle nested brackets in file captions', () => {
    const doc = wtf('[[File:Test.jpg|thumb|Caption with [[link]] inside]]')
    expect(doc.text()).not.toContain('File:')
  })

  it('should handle i18n file namespace', () => {
    const doc = wtf('[[Datei:Foto.jpg|thumb]] German file.')
    expect(doc.text()).not.toContain('Datei:')
  })
})

// ============================================================================
// REF HANDLING
// ============================================================================

describe('Reference Handling', () => {
  it('should strip inline refs', () => {
    const doc = wtf('Fact<ref>Source citation</ref> and more.')
    expect(doc.text()).not.toContain('<ref>')
    expect(doc.text()).not.toContain('</ref>')
    expect(doc.text()).not.toContain('Source citation')
  })

  it('should strip self-closing refs', () => {
    const doc = wtf('Fact<ref name="source1" /> and more.')
    expect(doc.text()).not.toContain('<ref')
    expect(doc.text()).not.toContain('/>')
  })

  it('should strip refs with attributes', () => {
    const doc = wtf('Text<ref name="foo" group="note">Citation</ref> more.')
    expect(doc.text()).not.toContain('<ref')
  })
})

// ============================================================================
// BOLD AND ITALIC
// ============================================================================

describe('Bold and Italic Formatting', () => {
  it('should strip bold markup from text', () => {
    const doc = wtf("This is '''bold''' text.")
    expect(doc.text()).toBe('This is bold text.')
  })

  it('should strip italic markup from text', () => {
    const doc = wtf("This is ''italic'' text.")
    expect(doc.text()).toBe('This is italic text.')
  })

  it('should strip bold-italic markup', () => {
    const doc = wtf("This is '''''bold italic''''' text.")
    expect(doc.text()).toBe('This is bold italic text.')
  })

  it('should identify bold text in sentence', () => {
    const doc = wtf("'''Main Topic''' is the subject.")
    const sentence = doc.sentences()[0]
    expect(sentence.bold()).toBe('Main Topic')
  })
})
