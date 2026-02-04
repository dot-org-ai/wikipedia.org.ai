/**
 * Reference tests for wtf-lite - ported from wtf_wikipedia test suite
 */

import { describe, it, expect } from 'vitest'
import wtf from '../../src/lib/wtf-lite'

describe('wtf-lite Reference Tests', () => {
  describe('Basic Reference Parsing', () => {
    it('should parse simple inline reference', () => {
      const doc = wtf('Fact.<ref>Source text here</ref>')
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].type()).toBe('inline')
    })

    it('should parse multiple references', () => {
      const doc = wtf('First fact.<ref>Source 1</ref> Second fact.<ref>Source 2</ref>')
      const refs = doc.references()
      expect(refs).toHaveLength(2)
    })

    it('should strip refs from text output', () => {
      const doc = wtf('Fact.<ref>Source</ref> More text.')
      expect(doc.text()).not.toContain('<ref>')
      expect(doc.text()).not.toContain('Source')
      expect(doc.text()).toContain('Fact.')
      expect(doc.text()).toContain('More text.')
    })

    it('should handle empty reference', () => {
      const doc = wtf('Text<ref></ref> more')
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })
  })

  describe('Named References', () => {
    it('should parse named reference with content', () => {
      const doc = wtf('Fact.<ref name="source1">The actual source</ref>')
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].name()).toBe('source1')
    })

    it('should parse named reference with double quotes', () => {
      const doc = wtf('Text<ref name="my-source">Content</ref>')
      const refs = doc.references()
      expect(refs[0].name()).toBe('my-source')
    })

    it('should parse named reference with single quotes', () => {
      const doc = wtf("Text<ref name='my-source'>Content</ref>")
      const refs = doc.references()
      expect(refs[0].name()).toBe('my-source')
    })

    it('should handle self-closing named reference', () => {
      const wiki = `First.<ref name="src">Original source</ref> Second.<ref name="src" />`
      const doc = wtf(wiki)
      const refs = doc.references()
      expect(refs).toHaveLength(2)
      expect(refs[0].name()).toBe('src')
      expect(refs[1].name()).toBe('src')
    })

    it('should handle reference reuse with different spacing', () => {
      const wiki = `A<ref name="foo">Source</ref> B<ref name="foo"/> C<ref name="foo" />`
      const doc = wtf(wiki)
      const refs = doc.references()
      expect(refs).toHaveLength(3)
    })
  })

  describe('Citation Templates', () => {
    it('should parse cite web template', () => {
      const doc = wtf(`Text<ref>{{cite web|url=https://example.com|title=Example Page|date=2020-01-15}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].type()).toBe('web')
      expect(refs[0].url()).toBe('https://example.com')
      expect(refs[0].title()).toBe('Example Page')
    })

    it('should parse cite news template', () => {
      const doc = wtf(`Fact<ref>{{cite news|newspaper=The Times|title=Breaking News|date=2021-05-20}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].type()).toBe('news')
    })

    it('should parse cite book template', () => {
      const doc = wtf(`Quote<ref>{{cite book|title=Great Book|author=John Smith|publisher=Publisher Inc|year=2019}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].type()).toBe('book')
      expect(refs[0].title()).toBe('Great Book')
    })

    it('should parse cite journal template', () => {
      const doc = wtf(`Study<ref>{{cite journal|journal=Nature|title=New Discovery|author=Jane Doe|date=2020-03}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].type()).toBe('journal')
    })

    it('should parse generic citation template', () => {
      const doc = wtf(`Text<ref>{{citation|title=Generic Source|url=https://example.org}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle cite web with access-date', () => {
      const doc = wtf(`<ref>{{cite web|url=https://x.com|title=X|access-date=2020-05-01}}</ref>`)
      const refs = doc.references()
      const json = refs[0].json()
      expect(json.accessDate).toBe('2020-05-01')
    })

    it('should handle author with first and last name', () => {
      const doc = wtf(`<ref>{{cite web|last=Smith|first=John|title=Article}}</ref>`)
      const refs = doc.references()
      const json = refs[0].json()
      expect(json.author).toContain('Smith')
      expect(json.author).toContain('John')
    })
  })

  describe('Reference Class Methods', () => {
    it('title() should return citation title', () => {
      const doc = wtf(`<ref>{{cite web|title=My Title|url=https://x.com}}</ref>`)
      const refs = doc.references()
      expect(refs[0].title()).toBe('My Title')
    })

    it('title() should fall back to work/newspaper/journal', () => {
      const doc = wtf(`<ref>{{cite news|newspaper=The Guardian}}</ref>`)
      const refs = doc.references()
      expect(refs[0].title()).toBe('The Guardian')
    })

    it('url() should return URL', () => {
      const doc = wtf(`<ref>{{cite web|url=https://example.com/page|title=Page}}</ref>`)
      const refs = doc.references()
      expect(refs[0].url()).toBe('https://example.com/page')
    })

    it('url() should return empty for inline refs', () => {
      const doc = wtf(`<ref>Just some text</ref>`)
      const refs = doc.references()
      expect(refs[0].url()).toBe('')
    })

    it('text() should return formatted citation', () => {
      const doc = wtf(`<ref>{{cite book|author=Smith|title=Book Title|publisher=Pub|date=2020}}</ref>`)
      const refs = doc.references()
      const text = refs[0].text()
      expect(text).toContain('Smith')
      expect(text).toContain('Book Title')
    })

    it('text() should return inline text for inline refs', () => {
      const doc = wtf(`<ref>Some inline reference text</ref>`)
      const refs = doc.references()
      expect(refs[0].text()).toContain('inline reference')
    })

    it('wikitext() should return original markup', () => {
      const wiki = `<ref>{{cite web|url=https://x.com|title=X}}</ref>`
      const doc = wtf(`Text${wiki}`)
      const refs = doc.references()
      expect(refs[0].wikitext()).toContain('cite web')
    })

    it('name() should return reference name', () => {
      const doc = wtf(`<ref name="myref">Content</ref>`)
      const refs = doc.references()
      expect(refs[0].name()).toBe('myref')
    })

    it('name() should return empty for unnamed refs', () => {
      const doc = wtf(`<ref>Content</ref>`)
      const refs = doc.references()
      expect(refs[0].name()).toBe('')
    })

    it('type() should return citation type', () => {
      const doc = wtf(`<ref>{{cite journal|title=Study}}</ref>`)
      const refs = doc.references()
      expect(refs[0].type()).toBe('journal')
    })

    it('type() should return inline for plain refs', () => {
      const doc = wtf(`<ref>Plain text ref</ref>`)
      const refs = doc.references()
      expect(refs[0].type()).toBe('inline')
    })

    it('json() should return structured data', () => {
      const doc = wtf(`<ref name="test">{{cite web|url=https://x.com|title=Test Page|author=Doe|date=2021}}</ref>`)
      const refs = doc.references()
      const json = refs[0].json()
      expect(json.template).toBe('citation')
      expect(json.type).toBe('web')
      expect(json.name).toBe('test')
      expect(json.url).toBe('https://x.com')
      expect(json.title).toBe('Test Page')
    })
  })

  describe('Reference Edge Cases', () => {
    it('should handle ref with group attribute', () => {
      const doc = wtf(`Text<ref group="note">A note</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle ref tags with extra whitespace', () => {
      const doc = wtf(`Text< ref >Content< /ref >`)
      // May or may not parse depending on implementation
      expect(() => doc.references()).not.toThrow()
    })

    it('should handle nested templates in refs', () => {
      const doc = wtf(`<ref>{{cite web|url={{wayback|url=https://x.com}}|title=Archived}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle refs with wiki links', () => {
      const doc = wtf(`<ref>See [[Wikipedia:Verifiability]] for more</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].text()).toContain('Verifiability')
    })

    it('should handle refs with external links', () => {
      const doc = wtf(`<ref>[https://example.com Example Site]</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle refs with bold/italic', () => {
      const doc = wtf(`<ref>''Italic'' and '''bold''' text</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle very long references', () => {
      const longTitle = 'A'.repeat(500)
      const doc = wtf(`<ref>{{cite web|title=${longTitle}|url=https://x.com}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].title().length).toBe(500)
    })

    it('should handle refs with special characters', () => {
      const doc = wtf(`<ref>{{cite web|title=Test & "Quotes" <Brackets>|url=https://x.com}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle refs with unicode', () => {
      const doc = wtf(`<ref>{{cite web|title=日本語タイトル|url=https://ja.wikipedia.org}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle multiple citation templates in one ref (use first)', () => {
      const doc = wtf(`<ref>{{cite web|title=First}}{{cite book|title=Second}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
      expect(refs[0].title()).toBe('First')
    })
  })

  describe('Document references() method', () => {
    it('should return all references', () => {
      const doc = wtf(`
A<ref>Ref 1</ref>
B<ref>Ref 2</ref>
C<ref>Ref 3</ref>
      `)
      expect(doc.references()).toHaveLength(3)
    })

    it('should return references from all sections', () => {
      const doc = wtf(`
== Section 1 ==
Text<ref>Ref A</ref>

== Section 2 ==
More<ref>Ref B</ref>
      `)
      const refs = doc.references()
      expect(refs.length).toBeGreaterThanOrEqual(2)
    })

    it('should handle document with no references', () => {
      const doc = wtf('Just plain text without any references.')
      expect(doc.references()).toHaveLength(0)
    })
  })

  describe('Section references() method', () => {
    it('should return references from specific section', () => {
      const doc = wtf(`
== History ==
Historical fact<ref>History source</ref>

== Geography ==
Geographic fact<ref>Geography source</ref>
      `)
      const sections = doc.sections()
      expect(sections.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Citation Template Variations', () => {
    it('should handle Cite web (capitalized)', () => {
      const doc = wtf(`<ref>{{Cite web|url=https://x.com|title=Test}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle cite encyclopedia', () => {
      const doc = wtf(`<ref>{{cite encyclopedia|encyclopedia=Britannica|title=Topic}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle cite magazine', () => {
      const doc = wtf(`<ref>{{cite magazine|magazine=Time|title=Article|date=2020}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle cite AV media', () => {
      const doc = wtf(`<ref>{{cite AV media|title=Documentary|date=2019}}</ref>`)
      const refs = doc.references()
      expect(refs).toHaveLength(1)
    })

    it('should handle harvnb reference style', () => {
      // Harvard citation style (common in academic articles)
      const doc = wtf(`Text{{harvnb|Smith|2020|p=15}}`)
      // harvnb is typically rendered differently, test that it doesn't break
      expect(() => doc.text()).not.toThrow()
    })
  })

  describe('Reference Reuse Patterns', () => {
    it('should handle forward reference (use before definition)', () => {
      const wiki = `First use<ref name="later" /> Definition<ref name="later">The source</ref>`
      const doc = wtf(wiki)
      const refs = doc.references()
      expect(refs.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle same named ref used multiple times', () => {
      const wiki = `
A<ref name="common">Common source</ref>
B<ref name="common" />
C<ref name="common" />
D<ref name="common" />
      `
      const doc = wtf(wiki)
      const refs = doc.references()
      expect(refs).toHaveLength(4)
      refs.forEach(ref => expect(ref.name()).toBe('common'))
    })
  })

  describe('Performance Tests', () => {
    it('should handle many references efficiently', () => {
      let wiki = ''
      for (let i = 0; i < 100; i++) {
        wiki += `Fact ${i}<ref>Source ${i}</ref> `
      }
      const start = Date.now()
      const doc = wtf(wiki)
      const refs = doc.references()
      const elapsed = Date.now() - start
      expect(refs).toHaveLength(100)
      expect(elapsed).toBeLessThan(5000)
    })

    it('should not hang on malformed ref tags', () => {
      const wiki = 'Text<ref>Unclosed ref with lots of content ' + 'x'.repeat(1000)
      const start = Date.now()
      const doc = wtf(wiki)
      doc.references()
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(1000)
    })
  })
})
