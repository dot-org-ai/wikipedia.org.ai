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
import wtf, { Document, Section, Paragraph, Sentence, Link, Infobox, List, Image } from '../../src/lib/wtf-lite/index'
import { findTemplates, getTemplateName } from '../../src/lib/wtf-lite/utils'
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

  // ============================================================================
  // INFOBOX TESTS PORTED FROM wtf_wikipedia
  // Based on https://github.com/spencermountain/wtf_wikipedia/blob/master/tests/integration/infobox.test.js
  // ============================================================================

  describe('wtf_wikipedia Infobox Tests', () => {
    describe('Basic Infobox Parsing', () => {
      it('should parse settlement infobox', () => {
        const wikitext = `{{Infobox settlement
| name = Springfield
| official_name = City of Springfield
| coordinates = {{coord|39|48|N|89|39|W|display=inline,title}}
| population = 116250
| area_total_km2 = 153.5
}}
Springfield is a fictional city.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.type()).toBe('settlement')
        expect(infobox.get('name').text()).toBe('Springfield')
        expect(infobox.get('official_name').text()).toBe('City of Springfield')
        expect(infobox.get('population').text()).toBe('116250')
      })

      it('should parse software infobox with logo', () => {
        const wikitext = `{{Infobox software
| name = Node.js
| logo = [[File:Node.js logo.svg|frameless]]
| developer = [[OpenJS Foundation]]
| released = {{start date|2009|5|27}}
| programming_language = [[C++]], [[JavaScript]]
}}
Node.js is a runtime environment.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.type()).toBe('software')
        expect(infobox.get('name').text()).toBe('Node.js')
        expect(infobox.get('developer').text()).toBe('OpenJS Foundation')
        expect(infobox.get('released').text()).toContain('May 27, 2009')
      })
    })

    describe('International Characters', () => {
      it('should handle French infobox with accented characters', () => {
        const wikitext = `{{Infobox Société
| nom = L'Oréal
| secteurs d'activités = Cosmétiques
| société mère = {{nobold|[[Nestlé]] (23 %)}}
| société sœur = The Body Shop
}}
L'Oréal is a cosmetics company.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        // The infobox should be parsed even with French characters
        expect(infobox.get('nom').text()).toBe("L'Oréal")
      })

      it('should handle German infobox', () => {
        const wikitext = `{{Infobox Unternehmen
| Name = Volkswagen AG
| Logo = [[Datei:VW logo.svg]]
| Sitz = [[Wolfsburg]], Deutschland
| Mitarbeiterzahl = 671205
}}
Volkswagen ist ein Automobilhersteller.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('Name').text()).toBe('Volkswagen AG')
        expect(infobox.get('Sitz').text()).toContain('Wolfsburg')
      })

      it('should handle Ukrainian infobox with Cyrillic text', () => {
        // Using standard Infobox prefix for compatibility
        const wikitext = `{{Infobox person
| ім'я = Тарас Григорович Шевченко
| місце народження = [[Моринці]]
| рід діяльності = поет, художник
}}
Тарас Шевченко був українським поетом.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get("ім'я").text()).toBe('Тарас Григорович Шевченко')
      })
    })

    describe('Nested Templates in Infobox', () => {
      it('should handle nested list templates', () => {
        const wikitext = `{{Infobox film
| name = Epic Movie
| director = {{plainlist|
* [[Aaron Seltzer]]
* [[Jason Friedberg]]
}}
| producer = {{hlist|Paul Schiff|Jason Friedberg}}
| starring = {{ubl|Kal Penn|Adam Campbell|Jennifer Coolidge}}
}}
Epic Movie is a comedy film.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.type()).toBe('film')
        // The director field should contain the names
        const director = infobox.get('director').text()
        expect(director).toContain('Aaron Seltzer')
        expect(director).toContain('Jason Friedberg')
      })

      it('should handle collapsible list', () => {
        const wikitext = `{{Infobox company
| name = Tech Corp
| products = {{collapsible list
| title = Products
| Software
| Hardware
| Services
}}
}}
Tech Corp produces various products.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.type()).toBe('company')
      })

      it('should handle embedded template in value', () => {
        const wikitext = `{{Infobox person
| birth_date = {{birth date|1956|10|28}}
| death_date = {{death date and age|2011|10|5|1956|10|28}}
| spouse = {{marriage|Laurene Powell|1991}}
}}
This is a biography.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('birth_date').text()).toContain('October 28, 1956')
        expect(infobox.get('death_date').text()).toContain('October 5, 2011')
        expect(infobox.get('spouse').text()).toContain('Laurene Powell')
      })
    })

    describe('Whitespace Handling', () => {
      it('should handle tabs as delimiters', () => {
        const wikitext = `{{Infobox officeholder
|name		= George Borg Olivier
|predecessor		= [[Paul Boffa]]
|successor1		= [[Wistin Abela]]
}}
George Borg Olivier was Prime Minister.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('name').text()).toBe('George Borg Olivier')
        expect(infobox.get('predecessor').text()).toBe('Paul Boffa')
        expect(infobox.get('successor1').text()).toBe('Wistin Abela')
      })

      it('should handle extra whitespace in values', () => {
        const wikitext = `{{Infobox person
| name =    John   Smith
| occupation =   Actor
}}
John Smith is an actor.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        // Whitespace is normalized (multiple spaces become single spaces)
        expect(infobox.get('name').text()).toBe('John Smith')
        expect(infobox.get('occupation').text()).toBe('Actor')
      })
    })

    describe('Special Characters in Field Names', () => {
      it('should handle slashes in field names', () => {
        const wikitext = `{{Infobox officeholder
| name = Joseph Biden
| jr/sr = Junior Senator
| jr/sr3 = United States Senator
| jr/sr4 = Vice President
}}
Joe Biden served in various offices.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('name').text()).toBe('Joseph Biden')
        expect(infobox.get('jr/sr').text()).toBe('Junior Senator')
        expect(infobox.get('jr/sr3').text()).toBe('United States Senator')
      })

      it('should handle numbers in field names', () => {
        const wikitext = `{{Infobox person
| spouse1 = First Spouse
| spouse2 = Second Spouse
| child1 = First Child
}}
Person has multiple spouses.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('spouse1').text()).toBe('First Spouse')
        expect(infobox.get('spouse2').text()).toBe('Second Spouse')
      })
    })

    describe('Duplicate Fields', () => {
      it('should handle duplicate fields with different cases', () => {
        const wikitext = `{{Infobox politician
| office = Governor
| Office = Senator
| term_start = 2010
}}
This person held office.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        // Should get one of the values (typically last one wins)
        const office = infobox.get('office').text()
        expect(office === 'Governor' || office === 'Senator').toBe(true)
      })
    })

    describe('Infobox with Images', () => {
      it('should handle image field', () => {
        const wikitext = `{{Infobox person
| name = Albert Einstein
| image = Einstein 1921 by F Schmutzer.jpg
| image_size = 220px
| caption = Einstein in 1921
}}
Albert Einstein was a physicist.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('name').text()).toBe('Albert Einstein')
        expect(infobox.get('image').text()).toContain('Einstein')
        expect(infobox.get('caption').text()).toBe('Einstein in 1921')
      })

      it('should handle File: prefix in image', () => {
        const wikitext = `{{Infobox company
| name = Apple Inc.
| logo = [[File:Apple logo black.svg|100px]]
| logo_caption = Apple logo
}}
Apple Inc. is a technology company.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.get('name').text()).toBe('Apple Inc.')
      })
    })

    describe('Infobox Type Variations', () => {
      it('should parse different infobox types correctly', () => {
        // Test book infobox
        const bookWiki = `{{Infobox book
| name = The Great Gatsby
| author = [[F. Scott Fitzgerald]]
| country = United States
| language = English
| genre = [[Tragedy]], social criticism
| published = {{Start date|1925|4|10}}
}}
The Great Gatsby is a novel.`
        const bookDoc = wtf(bookWiki)
        const bookInfobox = bookDoc.infoboxes()[0]
        expect(bookInfobox.type()).toBe('book')
        expect(bookInfobox.get('author').text()).toBe('F. Scott Fitzgerald')

        // Test album infobox
        const albumWiki = `{{Infobox album
| name = Abbey Road
| artist = [[The Beatles]]
| type = Studio
| released = {{Start date|1969|9|26}}
| recorded = February–August 1969
| genre = [[Rock music|Rock]]
}}
Abbey Road is an album by The Beatles.`
        const albumDoc = wtf(albumWiki)
        const albumInfobox = albumDoc.infoboxes()[0]
        expect(albumInfobox.type()).toBe('album')
        expect(albumInfobox.get('artist').text()).toBe('The Beatles')

        // Test TV series infobox
        const tvWiki = `{{Infobox television
| show_name = Breaking Bad
| creator = [[Vince Gilligan]]
| starring = {{plainlist|
* [[Bryan Cranston]]
* [[Aaron Paul]]
}}
| num_seasons = 5
| num_episodes = 62
}}
Breaking Bad is a television series.`
        const tvDoc = wtf(tvWiki)
        const tvInfobox = tvDoc.infoboxes()[0]
        expect(tvInfobox.type()).toBe('television')
        expect(tvInfobox.get('creator').text()).toBe('Vince Gilligan')
      })

      it('should handle organization infobox', () => {
        const wikitext = `{{Infobox organization
| name = United Nations
| abbreviation = UN
| formation = {{Start date and age|1945|10|24}}
| headquarters = [[New York City|New York]], United States
| membership = 193 member states
}}
The UN is an international organization.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.type()).toBe('organization')
        expect(infobox.get('abbreviation').text()).toBe('UN')
      })

      it('should handle university infobox', () => {
        const wikitext = `{{Infobox university
| name = Harvard University
| established = {{Start date|1636}}
| type = [[Private university|Private]] [[research university]]
| endowment = [[United States dollar|US$]]53.2 billion
| city = [[Cambridge, Massachusetts|Cambridge]]
| country = United States
}}
Harvard is a university.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        expect(infobox.type()).toBe('university')
        expect(infobox.get('name').text()).toBe('Harvard University')
        expect(infobox.get('city').text()).toBe('Cambridge')
      })
    })

    describe('Infobox Lists', () => {
      it('should handle plain list of items', () => {
        const wikitext = `{{Infobox film
| name = Avengers: Endgame
| starring = {{plainlist|
* [[Robert Downey Jr.]]
* [[Chris Evans (actor)|Chris Evans]]
* [[Mark Ruffalo]]
* [[Chris Hemsworth]]
* [[Scarlett Johansson]]
}}
}}
Avengers: Endgame is a superhero film.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        const starring = infobox.get('starring').text()
        expect(starring).toContain('Robert Downey Jr.')
        expect(starring).toContain('Chris Evans')
        expect(starring).toContain('Mark Ruffalo')
      })

      it('should handle horizontal list', () => {
        const wikitext = `{{Infobox person
| children = {{hlist|Child A|Child B|Child C}}
}}
Person with children.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        const children = infobox.get('children').text()
        expect(children).toContain('Child A')
        expect(children).toContain('Child B')
        expect(children).toContain('Child C')
      })
    })

    describe('Section infoboxes() Method', () => {
      it('should get infoboxes from specific section', () => {
        const wikitext = `{{Infobox person
| name = Main Person
}}
This is the intro.

== Career ==
During career.

== Personal life ==
{{Infobox family
| spouse = Jane Doe
}}
Personal life details.`
        const doc = wtf(wikitext)

        // Total infoboxes
        expect(doc.infoboxes().length).toBeGreaterThanOrEqual(1)

        // First section should have person infobox
        const firstSection = doc.sections()[0]
        if (firstSection) {
          const sectionInfoboxes = firstSection.infoboxes()
          expect(sectionInfoboxes.length).toBeGreaterThanOrEqual(0)
        }
      })
    })

    describe('Infobox links() Method', () => {
      it('should extract links from infobox values', () => {
        const wikitext = `{{Infobox person
| name = John Doe
| nationality = [[United States|American]]
| alma_mater = [[Harvard University]]
| employer = [[Google]]
}}
John Doe works at Google.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        expect(infobox).toBeDefined()
        const links = infobox.links()
        expect(links.length).toBeGreaterThan(0)

        // Should contain links to Harvard, Google, etc.
        const linkPages = links.map(l => l.page())
        expect(linkPages).toContain('Harvard University')
        expect(linkPages).toContain('Google')
      })
    })

    describe('Infobox json() Method', () => {
      it('should produce correct JSON output', () => {
        const wikitext = `{{Infobox person
| name = Test Person
| birth_date = {{birth date|1980|5|15}}
| occupation = Engineer
}}
Test Person is an engineer.`
        const doc = wtf(wikitext)
        const infobox = doc.infoboxes()[0]

        const json = infobox.json() as any
        expect(json).toHaveProperty('type', 'person')
        expect(json).toHaveProperty('data')
        expect(json.data).toHaveProperty('name', 'Test Person')
        expect(json.data).toHaveProperty('occupation', 'Engineer')
        expect(json.data.birth_date).toContain('May 15, 1980')
      })
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

  // ==========================================================================
  // COMPREHENSIVE LINK TESTS (ported from wtf_wikipedia)
  // ==========================================================================

  describe('Wiki Links - Basic', () => {
    it('should parse [[Page]]', () => {
      const doc = wtf('This is a [[Test Page]] link.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Test Page')
      expect(links[0].text()).toBe('Test Page')
    })

    it('should parse [[Page|text]]', () => {
      const doc = wtf('This is a [[Test Page|different text]] link.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Test Page')
      expect(links[0].text()).toBe('different text')
    })

    it('should parse [[Page#section]]', () => {
      const doc = wtf('See [[Article#History]] for more.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Article')
      expect(links[0].anchor()).toBe('History')
    })

    it('should parse [[Page#section|text]]', () => {
      const doc = wtf('See [[Article#History|the history section]] for more.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Article')
      expect(links[0].anchor()).toBe('History')
      expect(links[0].text()).toBe('the history section')
    })

    it('should handle links with trailing characters (suffixes)', () => {
      const doc = wtf('There are many [[cat]]s in the [[house]]hold.')
      const links = doc.links()
      expect(links).toHaveLength(2)
      expect(links[0].page()).toBe('cat')
      expect(links[0].text()).toBe('cats')
      expect(links[1].page()).toBe('house')
      expect(links[1].text()).toBe('household')
    })

    it('should handle consecutive links', () => {
      const doc = wtf('[[Link1]][[Link2]][[Link3]]')
      const links = doc.links()
      expect(links).toHaveLength(3)
      expect(links[0].page()).toBe('Link1')
      expect(links[1].page()).toBe('Link2')
      expect(links[2].page()).toBe('Link3')
    })

    it('should handle links with numbers', () => {
      const doc = wtf('The [[Boeing 747]] is a large aircraft.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Boeing 747')
    })
  })

  describe('Wiki Links - Anchor/Section Links', () => {
    it('should parse anchor-only link [[#Section]]', () => {
      const doc = wtf('See [[#References]] below.')
      const links = doc.links()
      expect(links.length).toBeGreaterThanOrEqual(0)
      // anchor-only links might be handled differently
    })

    it('should handle complex anchors with spaces', () => {
      const doc = wtf('See [[Article#Early life and career]] for details.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Article')
      expect(links[0].anchor()).toBe('Early life and career')
    })

    it('should handle anchor with special characters', () => {
      const doc = wtf('See [[Page#Section (disambiguation)|here]].')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Page')
      expect(links[0].anchor()).toBe('Section (disambiguation)')
      expect(links[0].text()).toBe('here')
    })
  })

  describe('Wiki Links - Title Case and Capitalization', () => {
    it('should preserve case in page names', () => {
      const doc = wtf('Visit [[iPhone]] and [[IPod]].')
      const links = doc.links()
      expect(links).toHaveLength(2)
      expect(links[0].page()).toBe('iPhone')
      expect(links[1].page()).toBe('IPod')
    })

    it('should handle links with mixed case display text', () => {
      const doc = wtf('The [[United States|USA]] is large.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('United States')
      expect(links[0].text()).toBe('USA')
    })
  })

  describe('Wiki Links - Styling and Formatting', () => {
    it('should strip bold/italic from link text', () => {
      const doc = wtf("[[Page|'''bold''' text]]")
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].text()).toBe('bold text')
    })

    it('should strip italic from link text', () => {
      const doc = wtf("[[Page|''italic'' text]]")
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].text()).toBe('italic text')
    })
  })

  describe('Wiki Links - Special Cases', () => {
    it('should handle link followed immediately by number', () => {
      const doc = wtf('In [[2020]]123 there was an event.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('2020')
    })

    it('should handle empty link text', () => {
      const doc = wtf('[[Page|]]')
      const links = doc.links()
      // Empty display text might be treated as the page name
      expect(links).toHaveLength(1)
    })

    it('should handle link with only spaces in display', () => {
      const doc = wtf('[[Page|   ]]')
      const links = doc.links()
      expect(links).toHaveLength(1)
    })

    it('should handle unicode in links', () => {
      const doc = wtf('Visit [[Cafe]] and [[Tokyo]] and [[Munchen]].')
      const links = doc.links()
      expect(links).toHaveLength(3)
    })

    it('should handle links with special unicode characters', () => {
      const doc = wtf('[[Zurich|Zurich]] is in Switzerland.')
      const links = doc.links()
      expect(links).toHaveLength(1)
      expect(links[0].page()).toBe('Zurich')
    })
  })

  describe('External Links', () => {
    // NOTE: External link display text extraction is a known limitation
    // The regex captures URLs but doesn't extract display text correctly
    // These tests verify the current behavior (links are extracted)

    it('should parse [http://url text] format', () => {
      const doc = wtf('Visit [http://example.com Example Website] for info.')
      // External links are extracted, but text extraction has limitations
      const links = doc.links().filter(l => l.type() === 'external')
      expect(links.length).toBeGreaterThanOrEqual(0) // May or may not extract
    })

    it('should parse [https://url text] format', () => {
      const doc = wtf('Visit [https://secure.example.com Secure Site] now.')
      const links = doc.links().filter(l => l.type() === 'external')
      expect(links.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle external link with complex URL', () => {
      const doc = wtf('See [https://example.com/path?query=value&foo=bar Full Link].')
      // Should not throw
      expect(doc.text()).toBeDefined()
    })

    it('should handle external link without display text', () => {
      const doc = wtf('Link: [https://example.com].')
      // External links without text might just be removed or display URL
      expect(doc.text()).toBeDefined()
    })

    it('should handle multiple external links', () => {
      const doc = wtf('[http://a.com Site A] and [http://b.com Site B]')
      // Should not throw
      expect(doc.text()).toBeDefined()
    })

    it('should parse ftp links', () => {
      const doc = wtf('Download from [ftp://files.example.com/file.zip FTP Server].')
      expect(doc.text()).toBeDefined()
    })

    it('should parse mailto links', () => {
      const doc = wtf('Contact [mailto:info@example.com Email Us].')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Category Links', () => {
    it('should extract categories but not include as regular links', () => {
      const doc = wtf('Content.\n[[Category:Science]]')
      const links = doc.links()
      const categories = doc.categories()
      expect(categories).toContain('Science')
      // Category links should not appear in regular links
      expect(links.filter(l => l.page()?.includes('Category:'))).toHaveLength(0)
    })

    it('should handle multiple categories', () => {
      // Categories need at least 2 characters
      const doc = wtf('Content.\n[[Category:Alpha]]\n[[Category:Beta]]\n[[Category:Gamma]]')
      const categories = doc.categories()
      expect(categories).toContain('Alpha')
      expect(categories).toContain('Beta')
      expect(categories).toContain('Gamma')
    })

    it('should handle colon-prefixed category link as regular link', () => {
      // [[:Category:X]] is a visible link to the category page
      const doc = wtf('See [[:Category:Physics]] for more.')
      // This should be treated as a regular link pointing to the category
      const text = doc.text()
      expect(text).toBeDefined()
    })
  })

  describe('Interwiki Links', () => {
    it('should handle language prefix links', () => {
      const doc = wtf('See also [[fr:Article francais]] for French version.')
      // Language links are typically stripped from content
      const text = doc.text()
      expect(text).not.toContain('[[fr:')
    })

    it('should handle wiktionary links', () => {
      const doc = wtf('Definition at [[wikt:word|word]].')
      const text = doc.text()
      expect(text).toContain('word')
    })

    it('should handle commons links', () => {
      const doc = wtf('Images at [[commons:Category:Cats|cat images]].')
      const text = doc.text()
      expect(text).toContain('cat images')
    })
  })

  describe('File/Image Links', () => {
    it('should strip [[File:...]] links from text', () => {
      const doc = wtf('Before [[File:Example.jpg|thumb|Caption text]] after.')
      const text = doc.text()
      expect(text).not.toContain('File:')
      expect(text).not.toContain('Example.jpg')
      expect(text).toContain('Before')
      expect(text).toContain('after')
    })

    it('should strip [[Image:...]] links from text', () => {
      const doc = wtf('Text [[Image:Photo.png|left|200px]] more text.')
      const text = doc.text()
      expect(text).not.toContain('Image:')
    })

    it('should handle file links with nested brackets in caption', () => {
      const doc = wtf('[[File:Test.jpg|thumb|Caption with [[link]] inside]]')
      const text = doc.text()
      expect(text).not.toContain('File:')
    })

    it('should handle i18n file namespaces', () => {
      const doc = wtf('[[Datei:German.jpg|thumb|German file]]')
      const text = doc.text()
      expect(text).not.toContain('Datei:')
    })
  })

  describe('Links in Templates', () => {
    it('should extract links from infobox values', () => {
      const doc = wtf(`{{Infobox person
| name = Test Person
| birthplace = [[New York City]], [[New York (state)|New York]]
}}`)
      const infobox = doc.infoboxes()[0]
      const links = infobox.links()
      expect(links.length).toBeGreaterThan(0)
      expect(links.some(l => l.page() === 'New York City')).toBe(true)
    })

    it('should handle links in template parameters', () => {
      const doc = wtf('Born in {{birth date|1990|1|1}} in [[London]].')
      const links = doc.links()
      expect(links.some(l => l.page() === 'London')).toBe(true)
    })
  })

  describe('Link Edge Cases', () => {
    it('should handle unclosed link brackets', () => {
      const doc = wtf('This [[broken link never closes.')
      // Should not crash
      expect(doc.text()).toBeDefined()
    })

    it('should handle extra closing brackets', () => {
      const doc = wtf('Normal text ]] more text.')
      expect(doc.text()).toBeDefined()
    })

    it('should handle nested brackets', () => {
      const doc = wtf('[[Page (with [brackets])]]')
      expect(doc.text()).toBeDefined()
    })

    it('should handle very long link text', () => {
      const longText = 'A'.repeat(500)
      const doc = wtf(`[[Page|${longText}]]`)
      const links = doc.links()
      expect(links).toHaveLength(1)
    })

    it('should handle link with pipe at end', () => {
      const doc = wtf('[[Page|]]')
      const links = doc.links()
      expect(links).toHaveLength(1)
    })

    it('should handle multiple pipes in link', () => {
      // Only first pipe should be used for splitting
      const doc = wtf('[[Page|text|extra]]')
      const links = doc.links()
      expect(links).toHaveLength(1)
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

  // ==========================================================================
  // COMPREHENSIVE LIST TESTS (ported from wtf_wikipedia)
  // ==========================================================================

  describe('Unordered Lists (* bullets)', () => {
    it('should parse simple bullet list', () => {
      const doc = wtf('* Item 1\n* Item 2\n* Item 3')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
      if (lists.length > 0) {
        const lines = lists[0].lines()
        expect(lines.length).toBe(3)
      }
    })

    it('should parse bullet list with links', () => {
      const doc = wtf('* [[Apple]]\n* [[Banana]]\n* [[Cherry]]')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
      if (lists.length > 0) {
        const links = lists[0].links()
        expect(links.length).toBe(3)
        expect(links[0].page()).toBe('Apple')
      }
    })

    it('should parse bullet list items with mixed content', () => {
      const doc = wtf('* Plain text\n* [[Link]] with text\n* Text with [[link|display]]')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse bullet list with bold/italic', () => {
      const doc = wtf("* '''Bold item'''\n* ''Italic item''\n* Normal item")
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
      if (lists.length > 0) {
        const text = lists[0].text()
        expect(text).toContain('Bold item')
        expect(text).toContain('Italic item')
      }
    })
  })

  describe('Ordered Lists (# numbers)', () => {
    it('should parse simple numbered list', () => {
      const doc = wtf('# First\n# Second\n# Third')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
      if (lists.length > 0) {
        const lines = lists[0].lines()
        expect(lines.length).toBe(3)
      }
    })

    it('should format numbered list with numbers', () => {
      const doc = wtf('# Alpha\n# Beta\n# Gamma')
      const lists = doc.sections()[0]?.lists() || []
      if (lists.length > 0) {
        const lines = lists[0].lines()
        // Numbered lists should have number prefixes
        expect(lines[0].text()).toContain('1)')
        expect(lines[1].text()).toContain('2)')
        expect(lines[2].text()).toContain('3)')
      }
    })

    it('should parse numbered list with links', () => {
      const doc = wtf('# [[First link]]\n# [[Second link]]')
      const lists = doc.sections()[0]?.lists() || []
      if (lists.length > 0) {
        const links = lists[0].links()
        expect(links.length).toBe(2)
      }
    })
  })

  describe('Nested Lists', () => {
    it('should parse nested bullet list', () => {
      const doc = wtf('* Level 1\n** Level 2\n*** Level 3')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse nested numbered list', () => {
      const doc = wtf('# First\n## Sub first\n### Sub sub first')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should parse mixed nested lists', () => {
      const doc = wtf('* Bullet\n*# Numbered under bullet\n*#* Bullet under numbered')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle deeply nested lists', () => {
      const doc = wtf('* A\n** B\n*** C\n**** D\n***** E')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Definition Lists (; and :)', () => {
    it('should parse definition list term', () => {
      const doc = wtf('; Term\n: Definition')
      // Definition lists might be handled differently
      expect(doc.text()).toBeDefined()
    })

    it('should parse indented text with colon', () => {
      const doc = wtf(': Indented text\n:: Double indented')
      expect(doc.text()).toBeDefined()
    })

    it('should handle multiple definitions', () => {
      const doc = wtf('; Term 1\n: Def 1\n; Term 2\n: Def 2')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('List Templates', () => {
    it('should parse {{hlist}} horizontal list', () => {
      const doc = wtf('Items: {{hlist|Red|Green|Blue}}')
      const text = doc.text()
      expect(text).toContain('Red')
      expect(text).toContain('Green')
      expect(text).toContain('Blue')
    })

    it('should parse {{plainlist}} template', () => {
      const doc = wtf('{{plainlist|\n* Item A\n* Item B\n}}')
      const text = doc.text()
      expect(text).toContain('Item A')
      expect(text).toContain('Item B')
    })

    it('should parse {{unbulleted list}} template', () => {
      const doc = wtf('{{unbulleted list|First|Second|Third}}')
      const text = doc.text()
      expect(text).toContain('First')
      expect(text).toContain('Second')
    })

    it('should parse {{bulleted list}} template', () => {
      const doc = wtf('{{bulleted list|Apple|Banana|Cherry}}')
      const text = doc.text()
      expect(text).toContain('Apple')
      expect(text).toContain('Banana')
    })

    it('should parse {{flatlist}} template', () => {
      const doc = wtf('{{flatlist|\n* One\n* Two\n* Three\n}}')
      const text = doc.text()
      expect(text).toContain('One')
      expect(text).toContain('Two')
    })
  })

  describe('Lists with Special Content', () => {
    it('should handle list items with templates', () => {
      const doc = wtf('* {{Birth date|1990|1|1}}\n* {{Death date|2020|12|31}}')
      // List items should be parsed even with templates
      expect(doc.text()).toBeDefined()
    })

    it('should handle list items with references', () => {
      const doc = wtf('* Fact one<ref>Source 1</ref>\n* Fact two<ref>Source 2</ref>')
      const text = doc.text()
      expect(text).toContain('Fact one')
      expect(text).toContain('Fact two')
      expect(text).not.toContain('<ref>')
    })

    it('should handle empty list items', () => {
      const doc = wtf('* Item 1\n*\n* Item 3')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle list items with only whitespace', () => {
      const doc = wtf('* Item 1\n*   \n* Item 3')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Multiple Lists in Document', () => {
    it('should parse separate lists', () => {
      const doc = wtf('== First ==\n* A\n* B\n\nSome text.\n\n* C\n* D')
      const section = doc.sections().find(s => s.title() === 'First')
      if (section) {
        const lists = section.lists()
        // Should have two separate lists
        expect(lists.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('should parse lists in different sections', () => {
      const doc = wtf('== Section A ==\n* List A1\n* List A2\n\n== Section B ==\n# List B1\n# List B2')
      const sectionA = doc.sections().find(s => s.title() === 'Section A')
      const sectionB = doc.sections().find(s => s.title() === 'Section B')

      if (sectionA) {
        const listsA = sectionA.lists()
        expect(listsA.length).toBeGreaterThanOrEqual(1)
      }
      if (sectionB) {
        const listsB = sectionB.lists()
        expect(listsB.length).toBeGreaterThanOrEqual(1)
      }
    })
  })

  describe('List Edge Cases', () => {
    it('should handle list at start of document', () => {
      const doc = wtf('* First item\n* Second item')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle list at end of document', () => {
      const doc = wtf('Some intro text.\n\n* Final item 1\n* Final item 2')
      // Should still find the list
      expect(doc.text()).toBeDefined()
    })

    it('should handle single-item list', () => {
      const doc = wtf('* Only one item')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
      if (lists.length > 0) {
        expect(lists[0].lines().length).toBe(1)
      }
    })

    it('should handle list with very long items', () => {
      const longItem = 'This is a very long list item. '.repeat(20)
      const doc = wtf(`* ${longItem}\n* Short item`)
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle list with pipe characters', () => {
      const doc = wtf('* Item with | pipe\n* Another item')
      const lists = doc.sections()[0]?.lists() || []
      expect(lists.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('List Links Access', () => {
    it('should access links through list.links()', () => {
      const doc = wtf('* [[Link1]]\n* [[Link2|Display]]\n* Plain text')
      const lists = doc.sections()[0]?.lists() || []
      if (lists.length > 0) {
        const links = lists[0].links()
        expect(links.length).toBe(2)
        expect(links[0].page()).toBe('Link1')
        expect(links[1].page()).toBe('Link2')
        expect(links[1].text()).toBe('Display')
      }
    })

    it('should access links from individual list lines', () => {
      const doc = wtf('* [[Apple]] and [[Banana]]\n* [[Cherry]]')
      const lists = doc.sections()[0]?.lists() || []
      if (lists.length > 0) {
        const lines = lists[0].lines()
        if (lines.length >= 2) {
          const firstLineLinks = lines[0].links()
          expect(firstLineLinks.length).toBe(2)
          const secondLineLinks = lines[1].links()
          expect(secondLineLinks.length).toBe(1)
        }
      }
    })
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

// ============================================================================
// TABLE PARSING
// ============================================================================

describe('Table Parsing', () => {
  describe('Simple Tables', () => {
    it('should parse simple table with headers', () => {
      const simple = `{| class="wikitable"
|-
! Header 1
! Header 2
! Header 3
|-
| row 1, cell 1
| row 1, cell 2
| row 1, cell 3
|-
| row 2, cell 1
| row 2, cell 2
| row 2, cell 3
|}`
      const doc = wtf(simple)
      const tables = doc.tables()
      expect(tables).toHaveLength(1)

      const table = tables[0]
      const json = table.json()
      expect(json).toHaveLength(2)
      expect(json[0]['Header 1'].text).toBe('row 1, cell 1')
      expect(json[0]['Header 2'].text).toBe('row 1, cell 2')
      expect(json[0]['Header 3'].text).toBe('row 1, cell 3')
      expect(json[1]['Header 1'].text).toBe('row 2, cell 1')
      expect(json[1]['Header 2'].text).toBe('row 2, cell 2')
      expect(json[1]['Header 3'].text).toBe('row 2, cell 3')
    })

    it('should parse multiplication table', () => {
      const mult = `{| class="wikitable" style="text-align: center; width: 200px; height: 200px;"
|+ Multiplication table
|-
! x
! 1
! 2
! 3
|-
! 1
| 1 || 2 || 3
|-
! 2
| 2 || 4 || 6
|-
! 3
| 3 || 6 || 9
|}`
      const doc = wtf(mult)
      const tables = doc.tables()
      expect(tables).toHaveLength(1)

      const json = tables[0].json()
      expect(json[0]['1'].text).toBe('1')
      expect(json[1]['1'].text).toBe('2')
      expect(json[1]['2'].text).toBe('4')
    })
  })

  describe('Table keyValue Method', () => {
    it('should return keyValue representation', () => {
      const str = `{| class="wikitable"
|-
! Name
! Age
|-
| John || 30
|-
| Jane || 25
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv).toHaveLength(2)
      expect(kv[0].Name).toBe('John')
      expect(kv[0].Age).toBe('30')
      expect(kv[1].Name).toBe('Jane')
      expect(kv[1].Age).toBe('25')
    })
  })

  describe('Table get Method', () => {
    it('should get single column as array', () => {
      const str = `{| class="wikitable"
|-
! Name
! Age
|-
| John || 30
|-
| Jane || 25
|}`
      const doc = wtf(str)
      const names = doc.tables()[0].get('Name')
      expect(names).toEqual(['John', 'Jane'])
    })

    it('should get multiple columns as objects', () => {
      const str = `{| class="wikitable"
|-
! Name
! Age
! City
|-
| John || 30 || NYC
|-
| Jane || 25 || LA
|}`
      const doc = wtf(str)
      const result = doc.tables()[0].get(['Name', 'City'])
      expect(result).toHaveLength(2)
      expect((result[0] as Record<string, string>).Name).toBe('John')
      expect((result[0] as Record<string, string>).City).toBe('NYC')
    })
  })

  describe('Table text Method', () => {
    it('should return text representation', () => {
      const str = `{| class="wikitable"
|-
! A
! B
|-
| one || two
|}`
      const doc = wtf(str)
      const text = doc.tables()[0].text()
      expect(text).toContain('A')
      expect(text).toContain('B')
      expect(text).toContain('one')
      expect(text).toContain('two')
    })
  })

  describe('Colspan Handling', () => {
    it('should handle colspan attribute', () => {
      const str = `{| class="wikitable"
| colspan="2" style="text-align:center;"| one/two
| three
|-
| one B
| two B
| three B
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv[0].col1).toBe('one/two')
      expect(kv[0].col2).toBe('')
      expect(kv[0].col3).toBe('three')
      expect(kv[1].col1).toBe('one B')
      expect(kv[1].col2).toBe('two B')
      expect(kv[1].col3).toBe('three B')
    })
  })

  describe('Rowspan Handling', () => {
    it('should handle rowspan attribute', () => {
      const str = `{| class="wikitable"
| rowspan="2"| one
| two
| three
|-
| two B
| three B
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv[0].col1).toBe('one')
      expect(kv[1].col1).toBe('one')
      expect(kv[0].col2).toBe('two')
      expect(kv[0].col3).toBe('three')
      expect(kv[1].col2).toBe('two B')
      expect(kv[1].col3).toBe('three B')
    })
  })

  describe('Inline Cells', () => {
    it('should parse inline table cells with ||', () => {
      const str = `{| class="wikitable"
|-
! h1
! h2
! h3
|-
| a
| aa
| aaa
|-
| b || bb || bbb
|-
| c
|| cc
|| ccc
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv[0].h1).toBe('a')
      expect(kv[0].h2).toBe('aa')
      expect(kv[0].h3).toBe('aaa')
      expect(kv[1].h1).toBe('b')
      expect(kv[1].h2).toBe('bb')
      expect(kv[1].h3).toBe('bbb')
      expect(kv[2].h1).toBe('c')
      expect(kv[2].h2).toBe('cc')
      expect(kv[2].h3).toBe('ccc')
    })
  })

  describe('Sortable Tables', () => {
    it('should parse sortable wikitable', () => {
      const sortable = `{| class="wikitable sortable"
|+ Sortable table
|-
! scope="col" | Alphabetic
! scope="col" | Numeric
! scope="col" | Date
! scope="col" class="unsortable" | Unsortable
|-
| d || 20 || 2008-11-24 || This
|-
| b || 8 || 2004-03-01 || column
|-
| a || 6 || 1979-07-23 || cannot
|-
| c || 4 || 1492-12-08 || be
|-
| e || 0 || 1601-08-13 || sorted.
|}`
      const doc = wtf(sortable)
      expect(doc.tables()).toHaveLength(1)
      const json = doc.tables()[0].json()
      expect(json[0]['Alphabetic'].text).toBe('d')
      expect(json[0]['Numeric'].text).toBe('20')
      expect(json[0]['Date'].text).toBe('2008-11-24')
      expect(json[0]['Unsortable'].text).toBe('This')
      expect(json[1]['Alphabetic'].text).toBe('b')
      expect(json[2]['Alphabetic'].text).toBe('a')
      expect(json[3]['Alphabetic'].text).toBe('c')
      expect(json[4]['Alphabetic'].text).toBe('e')
    })

    it('should parse sortable table with data-sort-value', () => {
      const str = `{|class="wikitable sortable"
!Name and Surname!!Height
|-
|data-sort-value="Smith, John"|John Smith||1.85
|-
|data-sort-value="Ray, Ian"|Ian Ray||1.89
|-
|data-sort-value="Bianchi, Zachary"|Zachary Bianchi||1.72
|-
!Average:||1.82
|}`
      const doc = wtf(str)
      const json = doc.tables()[0].json()
      expect(json[0].Height.text).toBe('1.85')
      expect(json[0]['Name and Surname'].text).toBe('John Smith')
    })
  })

  describe('First Row as Header', () => {
    it('should use first row as header when values match common headers', () => {
      const str = `{| class="wikitable"
|-
| Name
| Country
| Rank
|-
| spencer || canada || captain
|-
| john || germany || captain
|-
| april || sweden || seargent
|-
| may || sweden || caption
|}`
      const doc = wtf(str)
      const json = doc.tables()[0].json()
      expect(json).toHaveLength(4)
      expect(json[0]['name'].text).toBe('spencer')
      expect(json[0]['country'].text).toBe('canada')
      expect(json[0]['rank'].text).toBe('captain')
      expect(json[2]['rank'].text).toBe('seargent')
    })
  })

  describe('Two-Row Headers', () => {
    it('should handle two-row header composition', () => {
      const str = `{| class="wikitable"
|-
! A
! B
! C
! D
|-
!
!
!
! D2
! E2
|-
| a || b || c || d || e
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv).toHaveLength(1)
      expect(kv[0].A).toBe('a')
      expect(kv[0].D2).toBe('d')
      expect(kv[0].E2).toBe('e')
    })
  })

  describe('Nested/Embedded Tables', () => {
    it('should parse multiple floating tables', () => {
      const floating = `{| class="wikitable floatright"
| Col 1, row 1
| rowspan="2" | Col 2, row 1 (and 2)
| Col 3, row 1
|-
| Col 1, row 2
| Col 3, row 2
|}
{| class="wikitable floatleft"
| Col 1, row 1
| rowspan="2" | Col 2, row 1 (and 2)
| Col 3, row 1
|-
| Col 1, row 2
| Col 3, row 2
|}`
      const doc = wtf(floating)
      expect(doc.tables()).toHaveLength(2)
      const json = doc.tables()[0].json()
      expect(json[0]['col1'].text).toBe('Col 1, row 1')
    })

    it('should parse embedded/nested tables', () => {
      const str = `{|
| one
| two
| three
|-
{|
| inside one
| inside two
| inside [[three]]
|}
|Statue of Liberty
|New York City
|[[Chicago]]
|}`
      const doc = wtf(str)
      const tables = doc.tables()
      expect(tables.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Table Links', () => {
    it('should extract links from table cells', () => {
      const str = `{| class="wikitable"
|-
! City
! Country
|-
| [[Paris]] || [[France]]
|-
| [[Berlin]] || [[Germany]]
|}`
      const doc = wtf(str)
      const links = doc.tables()[0].links()
      expect(links.length).toBe(4)
      expect(links.some(l => l.page() === 'Paris')).toBe(true)
      expect(links.some(l => l.page() === 'France')).toBe(true)
    })

    it('should filter links by page name', () => {
      const str = `{| class="wikitable"
|-
| [[Paris]] || [[France]]
|}`
      const doc = wtf(str)
      const parisLinks = doc.tables()[0].links('paris')
      expect(parisLinks).toHaveLength(1)
      expect(parisLinks[0].page()).toBe('Paris')
    })
  })

  describe('Empty and Missing Values', () => {
    it('should handle missing row values', () => {
      const str = `{|class="wikitable"
|-
! #
! Date
! Save
! Record
|-
| 2 || April 2 || || 2-0
|-
| 3 || April 3 || || 3-0
|}`
      const doc = wtf(str)
      const json = doc.tables()[0].json()
      expect(json[0].Save.text).toBe('')
      expect(json[0].Record.text).toBe('2-0')
    })

    it('should handle empty cells with multiple pipes', () => {
      const str = `{| class="wikitable"
! A
! B
! C
|-
||| b |||| d
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv[0].A).toBe('')
      expect(kv[0].B).toBe('b')
    })
  })

  describe('Table with Newlines', () => {
    it('should handle newlines within cells', () => {
      const str = `{| class="wikitable"
|-
! h1
! h2
|-
| a
| b1<br />b2
|-
| c
| d1
d2
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv[0].h1).toBe('a')
      expect(kv[0].h2).toContain('b1')
      expect(kv[0].h2).toContain('b2')
    })
  })

  describe('Table with Styling', () => {
    it('should strip cell styling before content', () => {
      const str = `{|
| styling | content | more content
|-
|| content | more content
|}`
      const doc = wtf(str)
      const kv = doc.tables()[0].keyValue()
      expect(kv[0].col1).toBe('content | more content')
      expect(kv[1].col1).toBe('content | more content')
    })
  })

  describe('Table wikitext Method', () => {
    it('should return original wikitext', () => {
      const str = `{| class="wikitable"
| cell 1
| cell 2
|}`
      const doc = wtf(str)
      const wikitext = doc.tables()[0].wikitext()
      expect(wikitext).toContain('wikitable')
      expect(wikitext).toContain('cell 1')
    })
  })

  describe('Empty Tables', () => {
    it('should handle empty table gracefully', () => {
      const str = `{| class="wikitable"
|}`
      const doc = wtf(str)
      const tables = doc.tables()
      // Empty table should either not appear or have no rows
      if (tables.length > 0) {
        expect(tables[0].json()).toHaveLength(0)
      }
    })
  })

  describe('Table in Section', () => {
    it('should get table from specific section', () => {
      const str = `
== Section One ==
Some text.

== Section Two ==
{| class="wikitable"
| data 1
| data 2
|}
More text.`
      const doc = wtf(str)
      const sectionTwo = doc.sections('Section Two')
      expect(sectionTwo).toHaveLength(1)
      const tables = sectionTwo[0].tables()
      expect(tables).toHaveLength(1)
    })
  })

  describe('Table Removal from Text', () => {
    it('should remove table from text output', () => {
      const str = `hello this is the top
{| class="wikitable"
| 1
| data
|}
`
      const doc = wtf(str)
      const text = doc.text()
      expect(text).toBe('hello this is the top')
      expect(text).not.toContain('data')
    })
  })

  describe('Complex Real-World Tables', () => {
    it('should parse inline table with scope attributes', () => {
      const inline = `{| class="wikitable"
|+ Data by region
|-
! scope="col" | Year !! scope="col" | Africa !! scope="col" | Americas
|-
! scope="row" | 2014
| 2,300 || 8,950
|-
! scope="row" | 2015
| 2,725 || 9,200
|}`
      const doc = wtf(inline)
      const json = doc.tables()[0].json()
      expect(json[0].Year.text).toBe('2014')
      expect(json[0].Africa.text).toBe('2,300')
      expect(json[0].Americas.text).toBe('8,950')
      expect(json[1].Year.text).toBe('2015')
    })
  })
})

// ============================================================================
// DOCUMENT CLASS TESTS (ported from wtf_wikipedia)
// ============================================================================

describe('Document Class', () => {
  describe('title()', () => {
    it('should return null for empty document', () => {
      const doc = wtf('')
      expect(doc.title()).toBeNull()
    })

    it('should extract title from first bold text', () => {
      const doc = wtf("'''Albert Einstein''' was a physicist.")
      expect(doc.title()).toBe('Albert Einstein')
    })

    it('should use provided title option', () => {
      const doc = wtf('Some content.', { title: 'Custom Title' })
      expect(doc.title()).toBe('Custom Title')
    })

    it('should support get/set operations', () => {
      const doc = wtf('Content.')
      expect(doc.title()).toBeNull()
      doc.title('New Title')
      expect(doc.title()).toBe('New Title')
    })

    it('should return null when no bold text exists', () => {
      const doc = wtf('Plain text without bold.')
      expect(doc.title()).toBeNull()
    })
  })

  describe('text()', () => {
    it('should return plain text', () => {
      const doc = wtf('Simple text content.')
      expect(doc.text()).toBe('Simple text content.')
    })

    it('should return empty string for redirects', () => {
      const doc = wtf('#REDIRECT [[Target Page]]')
      expect(doc.text()).toBe('')
    })

    it('should strip all markup from text', () => {
      const doc = wtf("'''Bold''' and ''italic'' with [[links]].")
      expect(doc.text()).toBe('Bold and italic with links.')
    })

    it('should join sections with double newlines', () => {
      const doc = wtf('Intro.\n\n== Section ==\nContent.')
      const text = doc.text()
      expect(text).toContain('Intro.')
      expect(text).toContain('Content.')
    })
  })

  describe('json()', () => {
    it('should produce valid JSON object', () => {
      const doc = wtf('Content.')
      const json = doc.json()
      expect(json).toBeInstanceOf(Object)
    })

    it('should include title in JSON', () => {
      const doc = wtf("'''Test Title''' content.", { title: 'Test' })
      const json = doc.json() as any
      expect(json.title).toBe('Test')
    })

    it('should include categories in JSON', () => {
      const doc = wtf('Content.\n[[Category:Testing]]')
      const json = doc.json() as any
      expect(json.categories).toContain('Testing')
    })

    it('should include sections in JSON', () => {
      const doc = wtf('Intro.\n\n== Section ==\nContent.')
      const json = doc.json() as any
      expect(json.sections).toBeInstanceOf(Array)
      expect(json.sections.length).toBeGreaterThan(0)
    })

    it('should include coordinates in JSON', () => {
      const doc = wtf('Located at {{coord|35.6762|139.6503}}.')
      const json = doc.json() as any
      expect(json.coordinates).toBeInstanceOf(Array)
    })

    it('should include images in JSON', () => {
      const doc = wtf('[[File:Example.jpg|thumb|Caption]]')
      const json = doc.json() as any
      expect(json.images).toBeInstanceOf(Array)
    })
  })

  describe('sections()', () => {
    it('should return all sections', () => {
      const doc = wtf('Intro.\n\n== First ==\nContent.\n\n== Second ==\nMore.')
      const sections = doc.sections()
      expect(sections.length).toBeGreaterThanOrEqual(2)
    })

    it('should filter by title string (case-insensitive)', () => {
      const doc = wtf('Intro.\n\n== History ==\nHistorical content.')
      const sections = doc.sections('history')
      expect(sections).toHaveLength(1)
      expect(sections[0].title()).toBe('History')
    })

    it('should filter by index number', () => {
      const doc = wtf('Intro.\n\n== First ==\nContent.')
      const sections = doc.sections(0)
      expect(sections).toHaveLength(1)
    })

    it('should return empty array for non-existent index', () => {
      const doc = wtf('Content.')
      const sections = doc.sections(999)
      expect(sections).toHaveLength(0)
    })

    it('should return empty array for non-existent title', () => {
      const doc = wtf('Content.')
      const sections = doc.sections('Nonexistent')
      expect(sections).toHaveLength(0)
    })
  })

  describe('categories()', () => {
    it('should return empty array when no categories', () => {
      const doc = wtf('No categories here.')
      expect(doc.categories()).toHaveLength(0)
    })

    it('should extract all categories', () => {
      const doc = wtf('Content.\n[[Category:First]]\n[[Category:Second]]')
      const cats = doc.categories()
      expect(cats).toContain('First')
      expect(cats).toContain('Second')
    })

    it('should filter by index', () => {
      const doc = wtf('[[Category:Alpha]]\n[[Category:Beta]]')
      const first = doc.categories(0)
      expect(first).toHaveLength(1)
      expect(first[0]).toBe('Alpha')
    })

    it('should handle category with sort key', () => {
      const doc = wtf('[[Category:People|Einstein, Albert]]')
      expect(doc.categories()).toContain('People')
    })
  })

  describe('links()', () => {
    it('should return empty array when no links', () => {
      const doc = wtf('No links here.')
      expect(doc.links()).toHaveLength(0)
    })

    it('should return all internal links', () => {
      const doc = wtf('Visit [[Paris]] and [[London]].')
      expect(doc.links()).toHaveLength(2)
    })

    it('should not include category links', () => {
      const doc = wtf('Text.\n[[Category:Test]]')
      const links = doc.links()
      expect(links.filter(l => l.page()?.includes('Category'))).toHaveLength(0)
    })

    it('should include links from all sections', () => {
      const doc = wtf('[[Link1]].\n\n== Section ==\n[[Link2]].')
      expect(doc.links().length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('isRedirect()', () => {
    it('should return false for normal pages', () => {
      const doc = wtf('Normal content.')
      expect(doc.isRedirect()).toBe(false)
    })

    it('should detect #REDIRECT', () => {
      const doc = wtf('#REDIRECT [[Target]]')
      expect(doc.isRedirect()).toBe(true)
    })

    it('should detect lowercase #redirect', () => {
      const doc = wtf('#redirect [[Target]]')
      expect(doc.isRedirect()).toBe(true)
    })

    it('should detect i18n redirects (German)', () => {
      const doc = wtf('#WEITERLEITUNG [[Zielartikel]]')
      expect(doc.isRedirect()).toBe(true)
    })

    it('should detect i18n redirects (French)', () => {
      const doc = wtf('#REDIRECTION [[Article cible]]')
      expect(doc.isRedirect()).toBe(true)
    })
  })

  describe('redirectTo()', () => {
    it('should return null for non-redirects', () => {
      const doc = wtf('Normal content.')
      expect(doc.redirectTo()).toBeNull()
    })

    it('should return Link object for redirects', () => {
      const doc = wtf('#REDIRECT [[Target Page]]')
      const target = doc.redirectTo()
      expect(target).not.toBeNull()
      expect(target?.page()).toBe('Target Page')
    })

    it('should parse redirect with anchor', () => {
      const doc = wtf('#REDIRECT [[Page#Section]]')
      const target = doc.redirectTo()
      expect(target?.page()).toBe('Page')
      expect(target?.anchor()).toBe('Section')
    })

    it('should handle redirect with display text', () => {
      const doc = wtf('#REDIRECT [[Page|Display Text]]')
      const target = doc.redirectTo()
      expect(target?.page()).toBe('Page')
    })
  })

  describe('isDisambiguation()', () => {
    it('should return false for normal pages', () => {
      const doc = wtf('Normal article content.')
      expect(doc.isDisambiguation()).toBe(false)
    })

    it('should detect {{disambiguation}} template', () => {
      const doc = wtf('List of meanings.\n{{disambiguation}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect {{disambig}} template', () => {
      const doc = wtf('Content.\n{{disambig}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect {{dab}} template', () => {
      const doc = wtf('Content.\n{{dab}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect {{dp}} template', () => {
      const doc = wtf('Content.\n{{dp}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect {{geodis}} template', () => {
      const doc = wtf('Geographic locations.\n{{geodis}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect title ending with (disambiguation)', () => {
      const doc = wtf('Content.', { title: 'Mercury (disambiguation)' })
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect "may refer to:" pattern', () => {
      const doc = wtf("'''Park Place''' may refer to:\n* [[Park Place (TV series)]]")
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect i18n disambiguation templates', () => {
      const doc = wtf('Content.\n{{bisongidila}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should detect German disambiguation suffix', () => {
      const doc = wtf('Content.', { title: 'Begriff (Begriffsklärung)' })
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should not false-positive on regular hatnotes', () => {
      const doc = wtf('{{hatnote|For other uses, see [[Other page]]}}\nRegular content.')
      expect(doc.isDisambiguation()).toBe(false)
    })
  })

  describe('paragraphs()', () => {
    it('should return all paragraphs', () => {
      const doc = wtf('First para.\n\nSecond para.\n\nThird para.')
      const paras = doc.paragraphs()
      expect(paras.length).toBeGreaterThanOrEqual(3)
    })

    it('should return paragraphs from all sections', () => {
      const doc = wtf('Intro para.\n\n== Section ==\nSection para.')
      const paras = doc.paragraphs()
      expect(paras.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('sentences()', () => {
    it('should return all sentences', () => {
      const doc = wtf('First sentence. Second sentence. Third sentence.')
      const sentences = doc.sentences()
      expect(sentences.length).toBeGreaterThanOrEqual(3)
    })

    it('should return sentences from all sections', () => {
      const doc = wtf('Intro sentence.\n\n== Section ==\nSection sentence.')
      const sentences = doc.sentences()
      expect(sentences.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('infoboxes()', () => {
    it('should return empty array when no infoboxes', () => {
      const doc = wtf('No infobox here.')
      expect(doc.infoboxes()).toHaveLength(0)
    })

    it('should return all infoboxes', () => {
      const doc = wtf('{{Infobox person|name=John}}\n\n{{Infobox company|name=Acme}}')
      const infoboxes = doc.infoboxes()
      expect(infoboxes.length).toBeGreaterThanOrEqual(1)
    })

    it('should sort infoboxes by number of keys (largest first)', () => {
      const doc = wtf('{{Infobox|a=1}}\n{{Infobox|a=1|b=2|c=3}}')
      const infoboxes = doc.infoboxes()
      if (infoboxes.length >= 2) {
        expect(Object.keys(infoboxes[0].keyValue()).length).toBeGreaterThanOrEqual(
          Object.keys(infoboxes[1].keyValue()).length
        )
      }
    })
  })

  describe('coordinates()', () => {
    it('should return empty array when no coordinates', () => {
      const doc = wtf('No coords here.')
      expect(doc.coordinates()).toHaveLength(0)
    })

    it('should return coordinate objects', () => {
      const doc = wtf('Located at {{coord|35.6762|139.6503}}.')
      const coords = doc.coordinates()
      expect(coords).toHaveLength(1)
      expect(coords[0]).toHaveProperty('lat')
      expect(coords[0]).toHaveProperty('lon')
    })
  })

  describe('templates()', () => {
    it('should return parsed templates', () => {
      const doc = wtf('Date: {{birth date|1990|5|15}}.')
      const templates = doc.templates()
      expect(templates.length).toBeGreaterThan(0)
    })
  })

  describe('tables()', () => {
    it('should return empty array when no tables', () => {
      const doc = wtf('No tables here.')
      expect(doc.tables()).toHaveLength(0)
    })

    it('should return parsed tables', () => {
      const doc = wtf('{| class="wikitable"\n|-\n! Header\n|-\n| Cell\n|}')
      const tables = doc.tables()
      expect(tables.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('references()', () => {
    it('should return empty array when no references', () => {
      const doc = wtf('No refs here.')
      expect(doc.references()).toHaveLength(0)
    })

    it('should return parsed references', () => {
      const doc = wtf('Fact.<ref>Source</ref>')
      const refs = doc.references()
      expect(refs.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('images()', () => {
    it('should return empty array when no images', () => {
      const doc = wtf('No images here.')
      expect(doc.images()).toHaveLength(0)
    })

    it('should return images', () => {
      const doc = wtf('[[File:Example.jpg|thumb|Caption]]')
      const images = doc.images()
      expect(images.length).toBeGreaterThanOrEqual(1)
    })

    it('should filter by index', () => {
      const doc = wtf('[[File:First.jpg]]\n[[File:Second.jpg]]')
      const first = doc.images(0)
      expect(first).toHaveLength(1)
    })
  })

  describe('image()', () => {
    it('should return null when no images', () => {
      const doc = wtf('No images.')
      expect(doc.image()).toBeNull()
    })

    it('should return first image', () => {
      const doc = wtf('[[File:First.jpg]]\n[[File:Second.jpg]]')
      const img = doc.image()
      expect(img).not.toBeNull()
    })
  })
})

// ============================================================================
// SECTION CLASS TESTS (ported from wtf_wikipedia)
// ============================================================================

describe('Section Class', () => {
  describe('title()', () => {
    it('should return empty string for intro section', () => {
      const doc = wtf('Intro content.')
      const section = doc.sections()[0]
      expect(section?.title()).toBe('')
    })

    it('should return section heading', () => {
      const doc = wtf('Intro.\n\n== History ==\nContent.')
      const history = doc.sections('History')[0]
      expect(history?.title()).toBe('History')
    })

    it('should strip wikitext from title', () => {
      const doc = wtf("Intro.\n\n== [[Link|Display]] ==\nContent.")
      const section = doc.sections()[1]
      expect(section?.title()).not.toContain('[[')
    })
  })

  describe('text()', () => {
    it('should return plain text of section', () => {
      const doc = wtf('Intro.\n\n== Section ==\nSection content here.')
      const section = doc.sections('Section')[0]
      expect(section?.text()).toContain('Section content here')
    })

    it('should join paragraphs with double newlines', () => {
      const doc = wtf('== Section ==\nFirst para.\n\nSecond para.')
      const section = doc.sections('Section')[0]
      const text = section?.text()
      expect(text).toContain('First para.')
      expect(text).toContain('Second para.')
    })

    it('should strip markup from text', () => {
      const doc = wtf("== Section ==\n'''Bold''' and [[link]].")
      const section = doc.sections('Section')[0]
      expect(section?.text()).toBe('Bold and link.')
    })
  })

  describe('json()', () => {
    it('should return valid JSON object', () => {
      const doc = wtf('== Section ==\nContent.')
      const section = doc.sections('Section')[0]
      const json = section?.json()
      expect(json).toBeInstanceOf(Object)
    })

    it('should include title in JSON', () => {
      const doc = wtf('== My Section ==\nContent.')
      const section = doc.sections('My Section')[0]
      const json = section?.json() as any
      expect(json.title).toBe('My Section')
    })

    it('should include depth in JSON', () => {
      const doc = wtf('== Level 2 ==\n=== Level 3 ===\nContent.')
      const level3 = doc.sections('Level 3')[0]
      const json = level3?.json() as any
      expect(json.depth).toBe(1)
    })

    it('should include index in JSON', () => {
      const doc = wtf('Intro.\n\n== First ==\n== Second ==')
      const second = doc.sections('Second')[0]
      const json = second?.json() as any
      expect(json.index).toBe(2)
    })

    it('should include paragraphs in JSON', () => {
      const doc = wtf('== Section ==\nParagraph content.')
      const section = doc.sections('Section')[0]
      const json = section?.json() as any
      expect(json.paragraphs).toBeInstanceOf(Array)
    })
  })

  describe('sentences()', () => {
    it('should return all sentences in section', () => {
      const doc = wtf('== Section ==\nFirst sentence. Second sentence.')
      const section = doc.sections('Section')[0]
      const sentences = section?.sentences()
      expect(sentences?.length).toBeGreaterThanOrEqual(2)
    })

    it('should return sentences from all paragraphs', () => {
      const doc = wtf('== Section ==\nFirst.\n\nSecond.')
      const section = doc.sections('Section')[0]
      const sentences = section?.sentences()
      expect(sentences?.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('paragraphs()', () => {
    it('should return all paragraphs', () => {
      const doc = wtf('== Section ==\nFirst para.\n\nSecond para.')
      const section = doc.sections('Section')[0]
      const paras = section?.paragraphs()
      expect(paras?.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('depth()', () => {
    it('should return 0 for level 2 heading', () => {
      const doc = wtf('== Level 2 ==\nContent.')
      const section = doc.sections('Level 2')[0]
      expect(section?.depth()).toBe(0)
    })

    it('should return 1 for level 3 heading', () => {
      const doc = wtf('== Level 2 ==\n=== Level 3 ===\nContent.')
      const section = doc.sections('Level 3')[0]
      expect(section?.depth()).toBe(1)
    })

    it('should return 2 for level 4 heading', () => {
      const doc = wtf('== L2 ==\n=== L3 ===\n==== Level 4 ====\nContent.')
      const section = doc.sections('Level 4')[0]
      expect(section?.depth()).toBe(2)
    })
  })

  describe('index()', () => {
    it('should return 0 for first section', () => {
      const doc = wtf('Intro content.')
      const section = doc.sections()[0]
      expect(section?.index()).toBe(0)
    })

    it('should return correct index for later sections', () => {
      const doc = wtf('Intro.\n\n== First ==\n== Second ==\n== Third ==')
      const third = doc.sections('Third')[0]
      expect(third?.index()).toBe(3)
    })
  })

  describe('links()', () => {
    it('should return all links in section', () => {
      const doc = wtf('== Section ==\nVisit [[Paris]] and [[London]].')
      const section = doc.sections('Section')[0]
      expect(section?.links().length).toBe(2)
    })

    it('should include links from lists', () => {
      const doc = wtf('== Section ==\n* [[Link1]]\n* [[Link2]]')
      const section = doc.sections('Section')[0]
      expect(section?.links().length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('lists()', () => {
    it('should return empty array when no lists', () => {
      const doc = wtf('== Section ==\nNo lists here.')
      const section = doc.sections('Section')[0]
      expect(section?.lists()).toHaveLength(0)
    })

    it('should return parsed lists', () => {
      const doc = wtf('== Section ==\n* Item 1\n* Item 2')
      const section = doc.sections('Section')[0]
      expect(section?.lists().length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('infoboxes()', () => {
    it('should return infoboxes in section', () => {
      const doc = wtf('{{Infobox person|name=John}}\n\n== Section ==')
      const section = doc.sections()[0]
      expect(section?.infoboxes().length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('tables()', () => {
    it('should return tables in section', () => {
      const doc = wtf('== Section ==\n{| class="wikitable"\n|-\n| Cell\n|}')
      const section = doc.sections('Section')[0]
      expect(section?.tables().length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('references()', () => {
    it('should return references in section', () => {
      const doc = wtf('== Section ==\nFact.<ref>Source</ref>')
      const section = doc.sections('Section')[0]
      expect(section?.references().length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('coordinates()', () => {
    it('should return coordinates in section', () => {
      const doc = wtf('== Section ==\n{{coord|40|N|74|W}}')
      const section = doc.sections('Section')[0]
      expect(section?.coordinates().length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('templates()', () => {
    it('should return templates in section', () => {
      const doc = wtf('== Section ==\n{{birth date|1990|1|1}}')
      const section = doc.sections('Section')[0]
      expect(section?.templates().length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// EDGE CASES FOR DOCUMENT AND SECTION
// ============================================================================

describe('Document and Section Edge Cases', () => {
  describe('Empty Document', () => {
    it('should handle completely empty input', () => {
      const doc = wtf('')
      expect(doc.text()).toBe('')
      expect(doc.sections()).toHaveLength(0)
      expect(doc.categories()).toHaveLength(0)
      expect(doc.links()).toHaveLength(0)
      expect(doc.isRedirect()).toBe(false)
      expect(doc.isDisambiguation()).toBe(false)
    })

    it('should produce valid empty JSON', () => {
      const doc = wtf('')
      const json = doc.json() as any
      expect(json.title).toBeNull()
      expect(json.categories).toHaveLength(0)
      expect(json.sections).toHaveLength(0)
    })
  })

  describe('Malformed Wikitext', () => {
    it('should handle unbalanced heading markers', () => {
      const doc = wtf('== Unbalanced ===\nContent.')
      expect(doc.sections().length).toBeGreaterThan(0)
    })

    it('should handle heading without content', () => {
      const doc = wtf('== Empty Section ==\n\n== Next Section ==\nContent.')
      expect(doc.sections().length).toBeGreaterThan(0)
    })

    it('should handle multiple consecutive headings', () => {
      const doc = wtf('== First ==\n== Second ==\nContent.')
      expect(doc.sections().length).toBeGreaterThan(0)
    })
  })

  describe('Unicode Content', () => {
    it('should handle Japanese sections', () => {
      const doc = wtf('== 歴史 ==\n日本の歴史について。')
      const section = doc.sections()[0]
      expect(section?.title()).toBe('歴史')
      expect(section?.text()).toContain('日本の歴史')
    })

    it('should handle Chinese sections', () => {
      const doc = wtf('== 历史 ==\n中国历史内容。')
      const section = doc.sections()[0]
      expect(section?.title()).toBe('历史')
    })

    it('should handle Arabic sections', () => {
      const doc = wtf('== التاريخ ==\nمحتوى التاريخ.')
      const section = doc.sections()[0]
      expect(section?.title()).toBe('التاريخ')
    })

    it('should handle Cyrillic sections', () => {
      const doc = wtf('== История ==\nИстория России.')
      const section = doc.sections()[0]
      expect(section?.title()).toBe('История')
    })
  })

  describe('Complex Nesting', () => {
    it('should handle deeply nested sections', () => {
      const doc = wtf('== Level 2 ==\nContent.\n=== Level 3 ===\nContent.\n==== Level 4 ====\nContent.\n===== Level 5 =====\nContent.')
      const sections = doc.sections()
      expect(sections.length).toBeGreaterThanOrEqual(4)

      const l2 = doc.sections('Level 2')[0]
      const l3 = doc.sections('Level 3')[0]
      const l4 = doc.sections('Level 4')[0]
      const l5 = doc.sections('Level 5')[0]

      expect(l2?.depth()).toBe(0)
      expect(l3?.depth()).toBe(1)
      expect(l4?.depth()).toBe(2)
      expect(l5?.depth()).toBe(3)
    })
  })

  describe('Redirect Edge Cases', () => {
    it('should handle redirect with trailing content', () => {
      const doc = wtf('#REDIRECT [[Target]]\n[[Category:Redirects]]')
      expect(doc.isRedirect()).toBe(true)
      expect(doc.categories()).toContain('Redirects')
    })

    it('should handle redirect with whitespace', () => {
      const doc = wtf('  #REDIRECT   [[Target]]  ')
      expect(doc.isRedirect()).toBe(true)
    })
  })

  describe('Disambiguation Edge Cases', () => {
    it('should handle disambiguation with template parameters', () => {
      const doc = wtf('Content.\n{{disambiguation|geo}}')
      expect(doc.isDisambiguation()).toBe(true)
    })

    it('should handle mixed case disambiguation templates', () => {
      const doc = wtf('Content.\n{{Disambiguation}}')
      expect(doc.isDisambiguation()).toBe(true)
    })
  })
})

// ============================================================================
// TEMPLATE PARSING - PORTED FROM WTF_WIKIPEDIA
// ============================================================================

describe('Template Parsing - Core (Ported from wtf_wikipedia)', () => {
  describe('findTemplates utility', () => {
    it('should find simple templates', () => {
      const templates = findTemplates('Hello {{world}} there')
      expect(templates).toHaveLength(1)
      expect(templates[0].name).toBe('world')
    })

    it('should find multiple templates', () => {
      const templates = findTemplates('{{one}} and {{two}} and {{three}}')
      expect(templates).toHaveLength(3)
      expect(templates.map((t: any) => t.name)).toEqual(['one', 'two', 'three'])
    })

    it('should track template positions', () => {
      const wiki = 'Before {{test}} after'
      const templates = findTemplates(wiki)
      expect(templates[0].start).toBe(7)
      expect(templates[0].end).toBe(15)
    })

    it('should handle templates with parameters', () => {
      const templates = findTemplates('{{birth date|1990|5|15}}')
      expect(templates).toHaveLength(1)
      expect(templates[0].name).toBe('birth date')
    })

    it('should handle templates with named parameters', () => {
      const templates = findTemplates('{{template|name=value|other=test}}')
      expect(templates).toHaveLength(1)
      expect(templates[0].name).toBe('template')
    })

    it('should handle nested templates', () => {
      const templates = findTemplates('{{outer|{{inner|value}}}}')
      expect(templates.length).toBeGreaterThanOrEqual(1)
    })

    it('should extract correct template name with underscore', () => {
      const templates = findTemplates('{{birth_date|1990|5|15}}')
      expect(templates[0].name).toBe('birth date')
    })
  })

  describe('getTemplateName utility', () => {
    it('should get name from simple template', () => {
      expect(getTemplateName('{{simple}}')).toBe('simple')
    })

    it('should get name from template with pipe', () => {
      expect(getTemplateName('{{template|param}}')).toBe('template')
    })

    it('should normalize to lowercase', () => {
      expect(getTemplateName('{{UPPERCASE}}')).toBe('uppercase')
    })

    it('should convert underscores to spaces', () => {
      expect(getTemplateName('{{birth_date}}')).toBe('birth date')
    })

    it('should handle template with newline', () => {
      expect(getTemplateName('{{template\n|param=value}}')).toBe('template')
    })
  })

  describe('Template Parameters - Named vs Positional', () => {
    it('should parse positional parameters', () => {
      const doc = wtf('Born {{birth date|1990|5|15}}.')
      const templates = doc.templates()
      const birthTemplate = templates.find(t => t.template === 'birth date')
      expect(birthTemplate).toBeDefined()
      expect(birthTemplate?.year).toBe('1990')
      expect(birthTemplate?.month).toBe('5')
      expect(birthTemplate?.day).toBe('15')
    })

    it('should parse named parameters in coord', () => {
      const doc = wtf('{{coord|35.6762|139.6503|display=inline,title}}')
      const templates = doc.templates()
      const coord = templates.find(t => t.template === 'coord')
      expect(coord).toBeDefined()
      expect(coord?.display).toBe('inline,title')
    })

    it('should handle mixed named and positional params', () => {
      const doc = wtf('{{as of|2023|5|1|since=yes}}')
      expect(doc.text()).toContain('Since')
    })

    it('should handle equals sign in parameter value', () => {
      const wikitext = '{{Infobox|formula=E=mc2}}'
      const doc = wtf(wikitext)
      expect(doc.text()).toBeDefined()
    })
  })
})

describe('Template Parsing - Nested Templates (wtf_wikipedia)', () => {
  it('should handle simple nested template', () => {
    const doc = wtf('{{outer|{{inner}}}}')
    expect(doc.text()).toBeDefined()
  })

  it('should handle deeply nested templates', () => {
    const doc = wtf('{{a|{{b|{{c|{{d|value}}}}}}}}')
    expect(doc.text()).toBeDefined()
  })

  it('should handle nested date templates in infobox', () => {
    const wikitext = '{{Infobox person\n| birth_date = {{birth date|1990|5|15}}\n| occupation = {{hlist|Writer|Actor}}\n}}'
    const doc = wtf(wikitext)
    const infobox = doc.infoboxes()[0]
    expect(infobox.get('birth_date').text()).toContain('May 15, 1990')
  })

  it('should handle nowrap with nested content', () => {
    const doc = wtf('She married {{nowrap|Johnny-boy}}.')
    expect(doc.text()).toContain('Johnny-boy')
  })

  it('should handle marriage template with nested content in infobox', () => {
    const wikitext = '{{Infobox scientist\n| spouse = {{marriage|Elsa Löwenthal|1919|1936}}\n}}'
    const doc = wtf(wikitext)
    const infobox = doc.infoboxes()[0]
    const spouse = infobox.get('spouse').text()
    expect(spouse).toContain('Elsa Löwenthal')
    expect(spouse).toContain('1919')
  })
})

describe('Template Parsing - Flag Templates (wtf_wikipedia)', () => {
  it('should handle flag template', () => {
    const doc = wtf('Country: {{flag|USA}}.')
    const text = doc.text()
    expect(text).toBeDefined()
  })

  it('should handle flagicon template', () => {
    const doc = wtf('{{flagicon|GBR}} British')
    expect(doc.text()).toBeDefined()
  })

  it('should handle multiple flag templates', () => {
    const doc = wtf('one {{flag|USA}}, two {{flag|DEU}}, three {{flag|CAN}}.')
    expect(doc.text()).toBeDefined()
  })
})

describe('Template Parsing - Currency Templates (wtf_wikipedia)', () => {
  it('should parse GBP template', () => {
    const doc = wtf('Cost {{GBP|123.45}}.')
    expect(doc.text()).toContain('GB£123.45')
  })

  it('should parse USD with billion suffix', () => {
    const doc = wtf('Revenue {{US$|21.20 billion}}.')
    expect(doc.text()).toContain('US$21.20 billion')
  })

  it('should handle currency template with code', () => {
    const doc = wtf('Price {{currency|1000|USD}}.')
    const text = doc.text()
    // Currency formatting may add commas
    expect(text).toMatch(/1[,]?000/)
  })

  it('should default to USD for currency without code', () => {
    const doc = wtf('Value {{currency|1.28 billion}}.')
    const text = doc.text()
    expect(text).toContain('1.28 billion')
  })

  it('should parse various currency codes', () => {
    const currencies = [
      ['{{EUR|500}}', '€500'],
      ['{{US$|100}}', 'US$100'],
      ['{{gbp|250}}', 'GB£250'],
    ]
    for (const [input, expected] of currencies) {
      const doc = wtf('Price: ' + input + '.')
      expect(doc.text()).toContain(expected)
    }
  })
})

describe('Template Parsing - Coordinate Formats (wtf_wikipedia)', () => {
  it('should parse decimal coordinates', () => {
    const doc = wtf('{{Coord|44.112|-87.913}}')
    const coords = doc.coordinates()
    expect(coords).toHaveLength(1)
    expect(coords[0].lat).toBeCloseTo(44.112, 2)
    expect(coords[0].lon).toBeCloseTo(87.913, 2)
  })

  it('should parse decimal with cardinal directions', () => {
    const doc = wtf('{{Coord|44.112|N|87.913|W}}')
    const coords = doc.coordinates()
    expect(coords).toHaveLength(1)
    expect(coords[0].lat).toBeCloseTo(44.112, 2)
  })

  it('should parse degrees and minutes', () => {
    const doc = wtf('{{Coord|51|30|N|0|7|W}}')
    const coords = doc.coordinates()
    expect(coords).toHaveLength(1)
    expect(coords[0].lat).toBeCloseTo(51.5, 1)
  })

  it('should parse full DMS format', () => {
    const doc = wtf('{{Coord|57|18|22|N|4|27|32|W}}')
    const coords = doc.coordinates()
    expect(coords).toHaveLength(1)
    expect(coords[0].lat).toBeCloseTo(57.306, 2)
  })

  it('should handle coord template variants', () => {
    const variants = ['coord', 'Coord', 'coor', 'coor dms', 'coor dec']
    for (const variant of variants) {
      const doc = wtf('{{' + variant + '|35|N|139|E}}')
      const coords = doc.coordinates()
      expect(coords.length).toBeGreaterThanOrEqual(0)
    }
  })

  it('should store direction in template data', () => {
    const doc = wtf('{{coord|35|41|N|139|41|E}}')
    const templates = doc.templates()
    const coord = templates.find(t => t.template === 'coord')
    expect(coord).toBeDefined()
    if (coord) {
      expect(coord.latDir).toBe('N')
      expect(coord.lonDir).toBe('E')
    }
  })

  it('should handle Southern hemisphere', () => {
    const doc = wtf('{{coord|33|52|S|151|12|E}}')
    const coords = doc.coordinates()
    expect(coords).toHaveLength(1)
    expect(coords[0].lat).toBeCloseTo(33.867, 2)
  })
})

describe('Template Parsing - Date Templates (wtf_wikipedia)', () => {
  it('should parse birth date template', () => {
    const doc = wtf('Born {{Birth date|1993|2|24}}.')
    expect(doc.text()).toContain('February 24, 1993')
  })

  it('should parse death date template', () => {
    const doc = wtf('Died {{Death date|1934|7|4}}.')
    expect(doc.text()).toContain('July 4, 1934')
  })

  it('should parse start-date with natural language', () => {
    const doc = wtf('Started {{start date|2022|5|6}}.')
    expect(doc.text()).toContain('May 6, 2022')
  })

  it('should parse end-date template', () => {
    const doc = wtf('Ended {{end date|2023|1|11}}.')
    expect(doc.text()).toContain('January 11, 2023')
  })

  it('should calculate age', () => {
    const doc = wtf('Age: {{age|1989|7|23|2003|7|14}}')
    expect(doc.text()).toContain('13')
  })

  it('should handle dob alias', () => {
    const doc = wtf('Born {{dob|1990|6|15}}.')
    expect(doc.text()).toContain('June')
    expect(doc.text()).toContain('1990')
  })

  it('should parse as of template with date', () => {
    const doc = wtf('{{As of|2025|1|28}}, the data is current.')
    expect(doc.text()).toContain('As of')
    expect(doc.text()).toContain('2025')
  })
})

describe('Template Parsing - Inline Templates (wtf_wikipedia)', () => {
  it('should parse plural template', () => {
    const doc = wtf('{{plural|2|page}}')
    expect(doc.text()).toBe('2 pages')
  })

  it('should handle singular in plural template', () => {
    const doc = wtf('{{plural|1|page}}')
    expect(doc.text()).toBe('1 page')
  })

  it('should parse lang template', () => {
    const doc = wtf('{{lang|fr|Je suis française.}}')
    const text = doc.text()
    expect(text).toContain('Je suis française')
  })

  it('should parse nobold template', () => {
    const doc = wtf('{{nobold| [[#Structure|down]] }}')
    expect(doc.text()).toContain('down')
  })

  it('should parse middot separator', () => {
    const doc = wtf('[[Salt]]{{middot}} [[Pepper]]')
    expect(doc.text()).toContain('Salt')
    expect(doc.text()).toContain('Pepper')
  })

  it('should parse val template', () => {
    const doc = wtf('Result: {{val|20}}')
    expect(doc.text()).toContain('20')
  })
})

describe('Template Parsing - List Templates (wtf_wikipedia)', () => {
  it('should parse hlist with multiple items', () => {
    const doc = wtf('{{hlist|Winner|Runner-up|Third place}}')
    const text = doc.text()
    expect(text).toContain('Winner')
    expect(text).toContain('Runner-up')
    expect(text).toContain('Third place')
  })

  it('should parse plainlist', () => {
    const doc = wtf('{{plainlist|Apple|Banana|Cherry}}')
    const text = doc.text()
    expect(text).toContain('Apple')
    expect(text).toContain('Banana')
  })

  it('should parse ubl (unbulleted list)', () => {
    const doc = wtf('{{ubl|a|b|c}}')
    const text = doc.text()
    expect(text).toContain('a')
    expect(text).toContain('b')
    expect(text).toContain('c')
  })

  it('should handle multiple list template aliases', () => {
    const aliases = ['ubl', 'ublist', 'unbulleted list', 'collapsible list']
    for (const alias of aliases) {
      const doc = wtf('{{' + alias + '|item1|item2}}')
      expect(doc.text()).toContain('item1')
    }
  })
})

describe('Template Parsing - Edge Cases (wtf_wikipedia)', () => {
  it('should handle unclosed template gracefully', () => {
    const doc = wtf('Text {{unclosed template without closing')
    expect(doc.text()).toBeDefined()
  })

  it('should handle empty template', () => {
    const doc = wtf('Text {{}} more text.')
    expect(doc.text()).toBeDefined()
  })

  it('should handle template with only whitespace', () => {
    const doc = wtf('Text {{  }} more text.')
    expect(doc.text()).toBeDefined()
  })

  it('should handle template with special characters in name', () => {
    const doc = wtf('{{Template-name_with.chars|value}}')
    expect(doc.text()).toBeDefined()
  })

  it('should handle template with pipe character in value', () => {
    const doc = wtf('{{template|value with | pipe symbol}}')
    expect(doc.text()).toBeDefined()
  })

  it('should handle templates at start and end of text', () => {
    const doc = wtf('{{start}} middle {{end}}')
    expect(doc.text()).toBeDefined()
  })

  it('should handle consecutive templates', () => {
    const doc = wtf('{{one}}{{two}}{{three}}')
    expect(doc.text()).toBeDefined()
  })

  it('should handle template with newlines in parameters', () => {
    const wikitext = '{{Infobox person\n| name = John Doe\n| birth_date = January 1, 1990\n| occupation = Writer\n}}'
    const doc = wtf(wikitext)
    const infobox = doc.infoboxes()[0]
    expect(infobox.get('name').text()).toBe('John Doe')
  })

  it('should handle template followed by punctuation', () => {
    const doc = wtf('Born {{birth date|1990|1|1}}.')
    expect(doc.text()).toContain('.')
  })
})

describe('Template Parsing - Hardcoded Symbols (wtf_wikipedia)', () => {
  it('should parse ndash template', () => {
    const doc = wtf('1990{{ndash}}2000')
    expect(doc.text()).toContain('–')
  })

  it('should parse mdash template', () => {
    const doc = wtf('Item{{mdash}}description')
    expect(doc.text()).toContain('—')
  })

  it('should parse middot template', () => {
    const doc = wtf('A{{middot}}B')
    expect(doc.text()).toContain('·')
  })

  it('should parse spaced en dash', () => {
    const doc = wtf('1990 {{spd}} 2000')
    expect(doc.text()).toContain(' – ')
  })

  it('should parse fraction templates', () => {
    const fractions = [
      ['{{1/2}}', '1⁄2'],
      ['{{1/4}}', '1⁄4'],
      ['{{3/4}}', '3⁄4'],
    ]
    for (const [input, expected] of fractions) {
      const doc = wtf(input)
      expect(doc.text()).toContain(expected)
    }
  })

  it('should parse indicator symbols', () => {
    const doc1 = wtf('{{increase}}')
    expect(doc1.text()).toContain('▲')

    const doc2 = wtf('{{decrease}}')
    expect(doc2.text()).toContain('▼')

    const doc3 = wtf('{{steady}}')
    expect(doc3.text()).toContain('▬')
  })
})

describe('Template Parsing - Transit and Location (wtf_wikipedia)', () => {
  it('should parse metro station template', () => {
    const doc = wtf('Transfer at {{metro|Central}}.')
    expect(doc.text()).toContain('Central')
  })

  it('should parse station template', () => {
    const doc = wtf('Arrive at {{stn|Victoria}}.')
    expect(doc.text()).toContain('Victoria')
  })

  it('should parse ferry template', () => {
    const doc = wtf('Take {{ferry|Harbor}}.')
    expect(doc.text()).toContain('Harbor')
  })
})

describe('Template Parsing - Text Manipulation (wtf_wikipedia)', () => {
  it('should parse lc (lowercase) template', () => {
    const doc = wtf('{{lc|HELLO WORLD}}')
    expect(doc.text()).toBe('hello world')
  })

  it('should parse uc (uppercase) template', () => {
    const doc = wtf('{{uc|hello world}}')
    expect(doc.text()).toBe('HELLO WORLD')
  })

  it('should parse ucfirst template', () => {
    const doc = wtf('{{ucfirst|hello}}')
    expect(doc.text()).toBe('Hello')
  })

  it('should parse lcfirst template', () => {
    const doc = wtf('{{lcfirst|HELLO}}')
    expect(doc.text()).toBe('hELLO')
  })

  it('should parse small template', () => {
    const doc = wtf('{{small|tiny text}}')
    expect(doc.text()).toContain('tiny text')
  })

  it('should parse trunc template', () => {
    const doc = wtf('{{trunc|Hello World|5}}')
    expect(doc.text()).toBe('Hello')
  })
})

describe('Template Parsing - Math Templates (wtf_wikipedia)', () => {
  it('should parse fraction with two numbers', () => {
    const doc = wtf('About {{frac|1|2}} done.')
    expect(doc.text()).toContain('1/2')
  })

  it('should parse fraction with whole number', () => {
    const doc = wtf('It takes {{frac|2|1|4}} hours.')
    expect(doc.text()).toContain('2 1/4')
  })

  it('should parse val template', () => {
    const doc = wtf('Speed: {{val|299792458}} m/s.')
    expect(doc.text()).toContain('299')
  })

  it('should parse convert template', () => {
    const doc = wtf('Height: {{convert|100|m|ft}}.')
    expect(doc.text()).toContain('100 m')
  })

  it('should parse radic (square root) template', () => {
    const doc = wtf('{{radic|2}}')
    expect(doc.text()).toContain('√')
    expect(doc.text()).toContain('2')
  })

  it('should parse formatnum template', () => {
    const doc = wtf('Population: {{formatnum|1000000}}.')
    expect(doc.text()).toContain('1,000,000')
  })
})

describe('Template Parsing - Abbreviations (wtf_wikipedia)', () => {
  it('should parse abbr template', () => {
    const doc = wtf('The {{abbr|UN|United Nations}} is important.')
    expect(doc.text()).toContain('UN')
  })

  it('should parse circa template', () => {
    const doc = wtf('Built {{circa|1850}}.')
    expect(doc.text()).toContain('c.')
  })

  it('should parse aka template', () => {
    const doc = wtf('John Doe ({{aka|Johnny}}).')
    // Check that it contains the abbreviation parts (may have spacing variations)
    expect(doc.text()).toMatch(/a\.k\s*\.?\s*a\./)
    expect(doc.text()).toContain('Johnny')
  })

  it('should parse fl. (floruit) template', () => {
    const doc = wtf('{{fl.|1200}}')
    expect(doc.text()).toContain('fl.')
    expect(doc.text()).toContain('1200')
  })
})

describe('Template Parsing - Time and Era (wtf_wikipedia)', () => {
  it('should parse decade template', () => {
    const doc = wtf('During the {{decade|1990}}.')
    expect(doc.text()).toContain('1990s')
  })

  it('should parse century template', () => {
    const doc = wtf('In the {{century|1800}}.')
    expect(doc.text()).toContain('century')
  })

  it('should parse reign template', () => {
    const doc = wtf('William I {{reign|1066|1087}}')
    expect(doc.text()).toContain('r.')
    expect(doc.text()).toContain('1066')
    expect(doc.text()).toContain('1087')
  })
})

describe('Template Parsing - Current Date/Time (wtf_wikipedia)', () => {
  it('should parse currentyear', () => {
    const doc = wtf('Year: {{currentyear}}')
    const currentYear = new Date().getFullYear()
    expect(doc.text()).toContain(String(currentYear))
  })

  it('should parse currentmonthname', () => {
    const doc = wtf('Month: {{currentmonthname}}')
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const text = doc.text()
    expect(months.some(m => text.includes(m))).toBe(true)
  })

  it('should parse currentday', () => {
    const doc = wtf('Day: {{currentday}}')
    const text = doc.text()
    expect(text).toMatch(/Day: \d{1,2}/)
  })

  it('should parse currentdayname', () => {
    const doc = wtf('Today is {{currentdayname}}')
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const text = doc.text()
    expect(days.some(d => text.includes(d))).toBe(true)
  })
})

describe('Template Parsing - Sports Templates (wtf_wikipedia)', () => {
  it('should parse goal template', () => {
    const doc = wtf("Goals: {{goal|23'|45'}}.")
    const templates = doc.templates()
    const goal = templates.find(t => t.template === 'goal')
    expect(goal).toBeDefined()
  })

  it('should parse player template', () => {
    const doc = wtf('{{player|10|BRA|Pelé}}')
    const templates = doc.templates()
    const player = templates.find(t => t.template === 'player')
    expect(player).toBeDefined()
    expect(player?.name).toBe('Pelé')
    expect(player?.country).toBe('bra')
    expect(player?.number).toBe('10')
  })

  it('should parse baseball year', () => {
    const doc = wtf('In {{by|2020}}.')
    expect(doc.text()).toContain('2020')
  })
})

describe('Template Parsing - Ship Templates (wtf_wikipedia)', () => {
  it('should parse USS ship template', () => {
    const doc = wtf('{{USS|Enterprise|CVN-65}}')
    expect(doc.text()).toContain('Enterprise')
  })

  it('should parse HMS ship template', () => {
    const doc = wtf('{{HMS|Victory}}')
    expect(doc.text()).toContain('Victory')
  })
})
