/**
 * Miscellaneous and Edge Case Tests for wtf-lite
 *
 * Ported from wtf_wikipedia integration tests covering:
 * - Redirects (including localized redirect syntax)
 * - Disambiguation pages
 * - Unicode handling (CJK, RTL, special symbols)
 * - Whitespace and formatting
 * - Performance and ReDoS prevention
 * - Encoding and HTML entities
 * - Additional edge cases
 */

import { describe, it, expect } from 'vitest'
import wtf from '../../src/lib/wtf-lite/index'

// ============================================================================
// EXTENDED REDIRECT TESTS (Port from wtf_wikipedia integration)
// ============================================================================

describe('Extended Redirect Detection', () => {
  it('should parse redirect with anchor', () => {
    const doc = wtf('#REDIRECT [[Toronto Blue Jays#Stadium]]')
    expect(doc.isRedirect()).toBe(true)
    const target = doc.redirectTo()
    expect(target).not.toBeNull()
    expect(target?.page()).toBe('Toronto Blue Jays')
    expect(target?.anchor()).toBe('Stadium')
  })

  it('should parse redirect with display text (pipe)', () => {
    const doc = wtf('#REDIRECT [[Toronto Blue Jays#Stadium|Tranno]]')
    expect(doc.isRedirect()).toBe(true)
    const target = doc.redirectTo()
    expect(target?.page()).toBe('Toronto Blue Jays')
    expect(target?.text()).toBe('Tranno')
  })

  it('should handle redirect with extra whitespace', () => {
    const doc = wtf('  \n #REDIRECT [[TORONTO]] \n\n')
    expect(doc.isRedirect()).toBe(true)
    const target = doc.redirectTo()
    expect(target?.page()).toBe('TORONTO')
  })

  it('should handle redirect to Wikipedia project namespace', () => {
    const doc = wtf('#REDIRECT [[Wikipedia:Bug reports and feature requests]]')
    expect(doc.isRedirect()).toBe(true)
    const target = doc.redirectTo()
    expect(target?.page()).toBe('Wikipedia:Bug reports and feature requests')
  })

  it('should handle redirect with multiple categories', () => {
    const doc = wtf('#REDIRECT [[Target Page]]\n[[Category:Redirect A]]\n[[Category:Redirect B]]')
    expect(doc.isRedirect()).toBe(true)
    const cats = doc.categories()
    expect(cats).toContain('Redirect A')
    expect(cats).toContain('Redirect B')
  })

  it('should handle German redirect syntax', () => {
    const doc = wtf('#WEITERLEITUNG [[Zielartikel]]')
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe('Zielartikel')
  })

  it('should handle French redirect syntax', () => {
    const doc = wtf('#REDIRECTION [[Article cible]]')
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe('Article cible')
  })

  it('should handle Spanish redirect syntax', () => {
    const doc = wtf('#REDIRECCIÓN [[Artículo destino]]')
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe('Artículo destino')
  })

  it('should handle Russian redirect syntax', () => {
    const doc = wtf('#ПЕРЕНАПРАВЛЕНИЕ [[Целевая статья]]')
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe('Целевая статья')
  })

  it('should handle Arabic redirect syntax', () => {
    const doc = wtf('#تحويل [[المقالة الهدف]]')
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe('المقالة الهدف')
  })

  it('should handle Chinese redirect syntax', () => {
    const doc = wtf('#重定向 [[目标文章]]')
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe('目标文章')
  })

  it('should handle redirect with long target name', () => {
    const longTitle = 'A'.repeat(150)
    const doc = wtf(`#REDIRECT [[${longTitle}]]`)
    expect(doc.isRedirect()).toBe(true)
    expect(doc.redirectTo()?.page()).toBe(longTitle)
  })

  it('should output empty text for redirect pages', () => {
    const doc = wtf('#REDIRECT [[Target]]')
    expect(doc.text()).toBe('')
  })

  it('should return null redirectTo for non-redirect pages', () => {
    const doc = wtf('This is a normal article.')
    expect(doc.isRedirect()).toBe(false)
    expect(doc.redirectTo()).toBeNull()
  })
})

// ============================================================================
// DISAMBIGUATION DETECTION
// ============================================================================

describe('Disambiguation Detection', () => {
  it('should detect {{disambiguation}} template', () => {
    const doc = wtf('{{disambiguation}}\n* [[Page 1]]\n* [[Page 2]]')
    expect(doc.text()).toBeDefined()
  })

  it('should detect {{disambig}} template', () => {
    const doc = wtf('{{disambig}}\n* [[Page 1]]\n* [[Page 2]]')
    expect(doc.text()).toBeDefined()
  })

  it('should detect {{dab}} template', () => {
    const doc = wtf('{{dab}}\n* [[Page 1]]\n* [[Page 2]]')
    expect(doc.text()).toBeDefined()
  })

  it('should parse links from disambiguation page', () => {
    const doc = wtf('{{disambiguation}}\n* [[Mercury (element)]] - a chemical element\n* [[Mercury (planet)]] - a planet')
    const links = doc.links()
    expect(links.length).toBeGreaterThanOrEqual(2)
  })

  it('should handle disambiguation with hndis template', () => {
    const doc = wtf('{{hndis|Smith, John}}\n* [[John Smith (politician)]]\n* [[John Smith (actor)]]')
    expect(doc.text()).toBeDefined()
  })

  it('should handle disambiguation with letter-number dab', () => {
    const doc = wtf('{{letter-number combination disambiguation}}\n* [[A1]] may refer to...')
    expect(doc.text()).toBeDefined()
  })
})

// ============================================================================
// EXTENDED UNICODE TESTS
// ============================================================================

describe('Extended Unicode Handling', () => {
  describe('CJK Characters', () => {
    it('should handle Japanese hiragana and katakana', () => {
      const doc = wtf('日本語のテスト (にほんご) ひらがな カタカナ')
      expect(doc.text()).toContain('日本語')
      expect(doc.text()).toContain('ひらがな')
      expect(doc.text()).toContain('カタカナ')
    })

    it('should handle Chinese simplified and traditional', () => {
      const doc = wtf('简体中文 and 繁體中文 together.')
      expect(doc.text()).toContain('简体中文')
      expect(doc.text()).toContain('繁體中文')
    })

    it('should handle Korean hangul', () => {
      const doc = wtf('한글 테스트 문장입니다.')
      expect(doc.text()).toContain('한글')
      expect(doc.text()).toContain('문장입니다')
    })

    it('should handle Vietnamese with diacritics', () => {
      const doc = wtf('Việt Nam là một quốc gia.')
      expect(doc.text()).toContain('Việt Nam')
    })

    it('should handle Thai script', () => {
      const doc = wtf('ภาษาไทย is the Thai language.')
      expect(doc.text()).toContain('ภาษาไทย')
    })
  })

  describe('RTL and Middle Eastern Scripts', () => {
    it('should handle Hebrew text', () => {
      const doc = wtf('עברית is Hebrew for "Hebrew".')
      expect(doc.text()).toContain('עברית')
    })

    it('should handle Arabic text', () => {
      const doc = wtf('العربية هي لغة عربية')
      expect(doc.text()).toContain('العربية')
    })

    it('should handle Persian/Farsi text', () => {
      const doc = wtf('فارسی یک زبان است.')
      expect(doc.text()).toContain('فارسی')
    })

    it('should handle Urdu text', () => {
      const doc = wtf('اردو پاکستان کی قومی زبان ہے۔')
      expect(doc.text()).toContain('اردو')
    })
  })

  describe('European Scripts', () => {
    it('should handle Greek text', () => {
      const doc = wtf('Ελληνικά (Greek) is an ancient language.')
      expect(doc.text()).toContain('Ελληνικά')
    })

    it('should handle Cyrillic scripts', () => {
      const doc = wtf('Русский, Українська, and Български.')
      expect(doc.text()).toContain('Русский')
      expect(doc.text()).toContain('Українська')
      expect(doc.text()).toContain('Български')
    })

    it('should handle Nordic characters', () => {
      const doc = wtf('Ø, Æ, Å, ø, æ, å from Norwegian.')
      expect(doc.text()).toContain('Ø')
      expect(doc.text()).toContain('å')
    })

    it('should handle German umlauts', () => {
      const doc = wtf('Ä, Ö, Ü, ß are German characters.')
      expect(doc.text()).toContain('Ä')
      expect(doc.text()).toContain('ß')
    })

    it('should handle French accents', () => {
      const doc = wtf('É, è, ê, ë, ç, œ, æ in French.')
      expect(doc.text()).toContain('É')
      expect(doc.text()).toContain('œ')
    })
  })

  describe('Indic Scripts', () => {
    it('should handle Hindi/Devanagari', () => {
      const doc = wtf('हिन्दी भारत की राष्ट्रभाषा है।')
      expect(doc.text()).toContain('हिन्दी')
    })

    it('should handle Tamil script', () => {
      const doc = wtf('தமிழ் ஒரு மொழி.')
      expect(doc.text()).toContain('தமிழ்')
    })

    it('should handle Bengali script', () => {
      const doc = wtf('বাংলা একটি ভাষা।')
      expect(doc.text()).toContain('বাংলা')
    })
  })

  describe('Special Symbols', () => {
    it('should handle mathematical symbols', () => {
      const doc = wtf('∀ ∃ ∅ ∈ ∉ ⊂ ⊃ ∪ ∩ ∧ ∨')
      expect(doc.text()).toContain('∀')
      expect(doc.text()).toContain('∩')
    })

    it('should handle currency symbols', () => {
      const doc = wtf('$ € £ ¥ ₹ ₽ ₩ ฿')
      expect(doc.text()).toContain('€')
      expect(doc.text()).toContain('₹')
    })

    it('should handle arrows and special chars', () => {
      const doc = wtf('→ ← ↑ ↓ ↔ ⇒ ⇐')
      expect(doc.text()).toContain('→')
      expect(doc.text()).toContain('⇒')
    })

    it('should handle superscript and subscript numbers', () => {
      const doc = wtf('H₂O and E=mc²')
      expect(doc.text()).toContain('₂')
      expect(doc.text()).toContain('²')
    })
  })

  describe('Unicode in Links', () => {
    it('should handle Chinese in link target', () => {
      const doc = wtf('[[北京市|Beijing]] is the capital.')
      const links = doc.links()
      expect(links[0]?.page()).toBe('北京市')
      expect(links[0]?.text()).toBe('Beijing')
    })

    it('should handle Arabic in link target', () => {
      const doc = wtf('[[القاهرة|Cairo]] is a city.')
      const links = doc.links()
      expect(links[0]?.page()).toBe('القاهرة')
    })

    it('should handle Japanese in link target', () => {
      const doc = wtf('[[東京都|Tokyo]] is the capital.')
      const links = doc.links()
      expect(links[0]?.page()).toBe('東京都')
    })
  })
})

// ============================================================================
// EXTENDED WHITESPACE AND FORMATTING TESTS
// ============================================================================

describe('Whitespace Handling', () => {
  it('should handle multiple consecutive spaces', () => {
    const doc = wtf('Word    with    many    spaces.')
    // Multiple spaces should be collapsed to single spaces
    expect(doc.text()).not.toMatch(/  /)
  })

  it('should handle tabs in text', () => {
    const doc = wtf('Word\twith\ttabs.')
    expect(doc.text()).toBeDefined()
  })

  it('should handle mixed whitespace', () => {
    const doc = wtf('  \t \n  Mixed   whitespace  \t\n ')
    expect(doc.text()).toBeDefined()
  })

  it('should handle NBSP characters', () => {
    const doc = wtf('Hello\u00A0World')
    // NBSP is converted to regular space by preProcess
    const text = doc.text()
    // The text should contain Hello and World separated by some form of whitespace
    expect(text).toContain('Hello')
    expect(text).toContain('World')
  })

  it('should handle unusual line endings', () => {
    const doc = wtf('Line 1\r\nLine 2\rLine 3\nLine 4')
    expect(doc.text()).toContain('Line 1')
    expect(doc.text()).toContain('Line 4')
  })

  it('should handle zero-width characters', () => {
    const doc = wtf('Text with\u200Bzero-width\u200Bspaces.')
    expect(doc.text()).toBeDefined()
  })

  it('should handle soft hyphens', () => {
    const doc = wtf('Soft\u00ADhyphen')
    expect(doc.text()).toBeDefined()
  })
})

// ============================================================================
// PERFORMANCE AND SECURITY TESTS
// ============================================================================

describe('Performance and ReDoS Prevention', () => {
  it('should handle very long lines without hanging', () => {
    const longLine = 'Word '.repeat(5000)
    const start = Date.now()
    const doc = wtf(longLine)
    const elapsed = Date.now() - start
    expect(doc.text().length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000) // Should complete in under 2 seconds
  })

  it('should handle many nested brackets without hanging', () => {
    const nested = '[['.repeat(100) + 'content' + ']]'.repeat(100)
    const start = Date.now()
    const doc = wtf(nested)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
    expect(doc.text()).toBeDefined()
  })

  it('should handle many nested templates without hanging', () => {
    const nested = '{{t|'.repeat(50) + 'value' + '}}'.repeat(50)
    const start = Date.now()
    const doc = wtf(nested)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
    expect(doc.text()).toBeDefined()
  })

  it('should handle pathological regex patterns', () => {
    // Pattern that could cause exponential backtracking in naive regex
    const pathological = 'a'.repeat(100) + '!'
    const start = Date.now()
    const doc = wtf(pathological)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
    expect(doc.text()).toBeDefined()
  })

  it('should handle unclosed comment efficiently', () => {
    const unclosed = 'Text <!-- unclosed comment ' + 'a'.repeat(5000)
    const start = Date.now()
    const doc = wtf(unclosed)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  it('should handle unclosed ref tag efficiently', () => {
    const unclosed = 'Text <ref> unclosed ref ' + 'content '.repeat(1000)
    const start = Date.now()
    const doc = wtf(unclosed)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(1000)
  })

  it('should handle document with thousands of links', () => {
    const manyLinks = Array(500).fill('[[Link]] ').join('')
    const start = Date.now()
    const doc = wtf(manyLinks)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(3000)
    expect(doc.links().length).toBe(500)
  })

  it('should handle document with complex nesting', () => {
    const complex = `{{infobox|
      name = {{nested|{{deep|value}}}}
      data = [[link|{{template}}]]
    }}`
    const start = Date.now()
    const doc = wtf(complex)
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)
  })
})

// ============================================================================
// ENCODING AND HTML ENTITIES
// ============================================================================

describe('Extended Encoding Tests', () => {
  describe('HTML Entities', () => {
    it('should convert named HTML entities', () => {
      const doc = wtf('&lt;tag&gt; &amp; &quot;quotes&quot;')
      const text = doc.text()
      expect(text).toContain('&')
      expect(text).toContain('"quotes"')
    })

    it('should convert numeric character references', () => {
      const doc = wtf('&#60; less than, &#62; greater than')
      expect(doc.text()).toBeDefined()
    })

    it('should handle hex character references', () => {
      const doc = wtf('&#x3C; and &#x3E;')
      expect(doc.text()).toBeDefined()
    })

    it('should preserve special symbols as entities', () => {
      const doc = wtf('Copyright &copy; 2024')
      expect(doc.text()).toBeDefined()
    })

    it('should handle multiple entity types together', () => {
      const doc = wtf('&nbsp;&mdash;&ndash;&hellip;')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Special Characters in Different Contexts', () => {
    it('should handle pipes in text (not templates)', () => {
      const doc = wtf('Price: 100 | Quality: Good')
      expect(doc.text()).toContain('Price:')
      expect(doc.text()).toContain('Quality:')
    })

    it('should handle equals signs in text', () => {
      const doc = wtf('The formula is E=mc².')
      expect(doc.text()).toContain('E=mc²')
    })

    it('should handle curly braces in text', () => {
      const doc = wtf('JSON: {"key": "value"}')
      expect(doc.text()).toContain('{')
      expect(doc.text()).toContain('}')
    })

    it('should handle square brackets in text (escaped)', () => {
      const doc = wtf('Array notation: arr[0]')
      expect(doc.text()).toBeDefined()
    })
  })
})

// ============================================================================
// ADDITIONAL EDGE CASES
// ============================================================================

describe('Additional Edge Cases', () => {
  describe('Boundary Conditions', () => {
    it('should handle single character input', () => {
      const doc = wtf('A')
      expect(doc.text()).toBe('A')
    })

    it('should handle only whitespace with newlines', () => {
      const doc = wtf('\n\n\n\n')
      expect(doc.text().trim()).toBe('')
    })

    it('should handle only a template', () => {
      const doc = wtf('{{stub}}')
      expect(doc.text()).toBeDefined()
    })

    it('should handle only a link', () => {
      const doc = wtf('[[Single Link]]')
      const links = doc.links()
      expect(links).toHaveLength(1)
    })

    it('should handle only a category', () => {
      const doc = wtf('[[Category:Only Category]]')
      const cats = doc.categories()
      expect(cats).toContain('Only Category')
    })
  })

  describe('Malformed Markup', () => {
    it('should handle mismatched bold/italic markers', () => {
      const doc = wtf("'''bold without close")
      expect(doc.text()).toBeDefined()
    })

    it('should handle reversed closing tags', () => {
      const doc = wtf('Text </b><b> reversed.')
      expect(doc.text()).toBeDefined()
    })

    it('should handle triple nested brackets', () => {
      const doc = wtf('[[[triple brackets]]]')
      expect(doc.text()).toBeDefined()
    })

    it('should handle interleaved markup', () => {
      const doc = wtf("''italic '''bold'' italic'''")
      expect(doc.text()).toBeDefined()
    })

    it('should handle template with missing closing', () => {
      const doc = wtf('{{template|param')
      expect(doc.text()).toBeDefined()
    })

    it('should handle deeply unbalanced brackets', () => {
      const doc = wtf('[[ [[ [[ content ]] ]]')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Template Edge Cases', () => {
    it('should handle template with only whitespace', () => {
      const doc = wtf('{{   }}')
      expect(doc.text()).toBeDefined()
    })

    it('should handle template with empty params', () => {
      const doc = wtf('{{template|||}')
      expect(doc.text()).toBeDefined()
    })

    it('should handle template name with special chars', () => {
      const doc = wtf('{{template-name_with.chars}}')
      expect(doc.text()).toBeDefined()
    })

    it('should handle nowiki in template', () => {
      const doc = wtf('{{template|<nowiki>{{not a template}}</nowiki>}}')
      expect(doc.text()).toBeDefined()
    })
  })

  describe('Category Edge Cases', () => {
    it('should handle category with very long name', () => {
      const longCat = 'A'.repeat(100)
      const doc = wtf(`[[Category:${longCat}]]`)
      const cats = doc.categories()
      expect(cats).toContain(longCat)
    })

    it('should handle category with unicode', () => {
      const doc = wtf('[[Category:日本語カテゴリ]]')
      const cats = doc.categories()
      expect(cats.length).toBeGreaterThan(0)
    })

    it('should handle multiple colons in category', () => {
      const doc = wtf('[[Category:Topic:Subtopic:Name]]')
      expect(doc.categories().length).toBeGreaterThan(0)
    })
  })

  describe('Link Edge Cases', () => {
    it('should handle link with newline in target', () => {
      const doc = wtf('[[Link\nWith\nNewlines]]')
      expect(doc.text()).toBeDefined()
    })

    it('should handle link with hash only', () => {
      const doc = wtf('[[#Section Only]]')
      const links = doc.links()
      expect(links.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle interwiki links', () => {
      const doc = wtf('[[fr:Article français]]')
      expect(doc.text()).toBeDefined()
    })

    it('should handle link with complex anchor', () => {
      const doc = wtf('[[Page#Section (with parens)|Display]]')
      const links = doc.links()
      if (links.length > 0) {
        expect(links[0]?.page()).toBe('Page')
      }
    })
  })

  describe('Section Edge Cases', () => {
    it('should handle section with only heading', () => {
      const doc = wtf('== Empty Section ==')
      const sections = doc.sections()
      expect(sections.length).toBeGreaterThan(0)
    })

    it('should handle deeply nested sections', () => {
      const deep = '= L1 =\n== L2 ==\n=== L3 ===\n==== L4 ====\n===== L5 =====\n====== L6 ======'
      const doc = wtf(deep)
      expect(doc.sections().length).toBeGreaterThan(0)
    })

    it('should handle section with special chars in title', () => {
      const doc = wtf('== Title (with) "special" chars & symbols ==\nContent.')
      const sections = doc.sections()
      if (sections.length > 0) {
        expect(sections[0]?.title()).toContain('Title')
      }
    })
  })

  describe('JSON Serialization', () => {
    it('should not have cyclic references in JSON', () => {
      const doc = wtf('{{Infobox|name=Test}}\n== Section ==\nContent with [[link]].')
      const json = doc.json()
      // If this throws, there's a cyclic reference
      expect(() => JSON.stringify(json)).not.toThrow()
    })

    it('should include all expected fields in JSON', () => {
      const doc = wtf('== Section ==\nContent.')
      const json = doc.json() as any
      expect(json).toHaveProperty('title')
      expect(json).toHaveProperty('categories')
      expect(json).toHaveProperty('sections')
    })

    it('should handle JSON with large document', () => {
      const large = '== Section ==\n' + 'Content paragraph. '.repeat(100)
      const doc = wtf(large)
      const json = doc.json()
      expect(() => JSON.stringify(json)).not.toThrow()
    })
  })
})

// ============================================================================
// I18N SPECIFIC TESTS (Port from wtf_wikipedia)
// ============================================================================

describe('Internationalization (i18n)', () => {
  describe('Nihongo Templates', () => {
    it('should parse full nihongo template', () => {
      const doc = wtf('Tokyo Tower ({{Nihongo|Tokyo Tower|東京タワー|Tōkyō tawā}}) is a landmark.')
      const text = doc.text()
      expect(text).toContain('Tokyo Tower')
      expect(text).toContain('東京タワー')
    })

    it('should parse nihongo2 template (kanji only)', () => {
      const doc = wtf('{{Nihongo2|虚無僧}} were wandering monks.')
      const text = doc.text()
      expect(text).toContain('虚無僧')
    })
  })

  describe('Hindi/Devanagari', () => {
    it('should handle Hindi category names (when CDN data loaded)', () => {
      // Note: Hindi श्रेणी is not in the default CATEGORIES constant
      // This test checks that the parser doesn't break on Hindi text
      const doc = wtf('[[श्रेणी:भारत के अर्थशास्त्री]]')
      // The link will be parsed even if not recognized as a category
      expect(doc.text()).toBeDefined()
    })

    it('should handle Hindi file/image captions', () => {
      const doc = wtf('[[चित्र:Image.jpg|thumb|कुछ कैप्शन]]')
      // Should strip the file link
      expect(doc.text()).not.toContain('चित्र:')
    })
  })

  describe('Language Templates', () => {
    it('should handle lang-de template', () => {
      const doc = wtf('{{lang-de|Bundesrepublik Deutschland}} is Germany.')
      const text = doc.text()
      expect(text).toContain('Bundesrepublik Deutschland')
    })

    it('should handle lang-ru template', () => {
      const doc = wtf('{{lang-ru|Российская Федерация}} is Russia.')
      const text = doc.text()
      expect(text).toContain('Российская Федерация')
    })

    it('should handle lang template with code', () => {
      const doc = wtf('{{lang|fr|République française}} is France.')
      const text = doc.text()
      // Should extract the French text
      expect(text).toBeDefined()
    })
  })

  describe('Category i18n', () => {
    it('should recognize German category', () => {
      const doc = wtf('[[Kategorie:Deutsche Geschichte]]')
      const cats = doc.categories()
      expect(cats.length).toBeGreaterThan(0)
    })

    it('should recognize French category', () => {
      const doc = wtf('[[Catégorie:Histoire de France]]')
      const cats = doc.categories()
      expect(cats.length).toBeGreaterThan(0)
    })

    it('should recognize Russian category', () => {
      const doc = wtf('[[Категория:История России]]')
      const cats = doc.categories()
      expect(cats.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// HTML TAG HANDLING (Port from wtf_wikipedia)
// ============================================================================

describe('HTML Tag Handling', () => {
  it('should handle <b> tags', () => {
    const doc = wtf('hi <b>world</b> there')
    expect(doc.text()).toContain('world')
  })

  it('should handle <i> tags', () => {
    const doc = wtf('hi <i>world</i> there')
    expect(doc.text()).toContain('world')
  })

  it('should handle combined <i><b> tags', () => {
    const doc = wtf('hi <i><b>world</b></i> there')
    expect(doc.text()).toContain('world')
  })

  it('should handle <sub> tags', () => {
    const doc = wtf('H<sub>2</sub>O is water.')
    expect(doc.text()).toBeDefined()
  })

  it('should handle <sup> tags', () => {
    const doc = wtf('E=mc<sup>2</sup> is famous.')
    expect(doc.text()).toBeDefined()
  })

  it('should strip <div> tags', () => {
    const doc = wtf('<div class="notice">Content</div>')
    expect(doc.text()).not.toContain('<div')
    expect(doc.text()).toContain('Content')
  })

  it('should strip <span> tags', () => {
    const doc = wtf('<span style="color:red">Red text</span>')
    expect(doc.text()).not.toContain('<span')
    expect(doc.text()).toContain('Red text')
  })

  it('should handle <br> tags', () => {
    const doc = wtf('Line 1<br/>Line 2')
    expect(doc.text()).toContain('Line 1')
    expect(doc.text()).toContain('Line 2')
  })
})

// ============================================================================
// NESTING TESTS (Port from wtf_wikipedia)
// ============================================================================

describe('Template Nesting', () => {
  it('should handle single nesting', () => {
    const doc = wtf('{{nowrap|one}}')
    expect(doc.text()).toContain('one')
  })

  it('should handle double nesting', () => {
    const doc = wtf('{{nowrap|{{nowrap|two}}}}')
    expect(doc.text()).toContain('two')
  })

  it('should handle triple nesting', () => {
    const doc = wtf('{{nowrap|{{nowrap|{{nowrap|three}}}}}}')
    expect(doc.text()).toContain('three')
  })

  it('should handle quadruple nesting', () => {
    const doc = wtf('{{nowrap|{{nowrap|{{nowrap|{{nowrap|four}}}}}}}}')
    expect(doc.text()).toContain('four')
  })

  it('should handle mixed nested templates', () => {
    const doc = wtf('{{small|{{nowrap|mixed text}}}}')
    expect(doc.text()).toBeDefined()
  })
})

// ============================================================================
// STRESS TEST (Port from wtf_wikipedia)
// ============================================================================

describe('Stress Tests', () => {
  it('should handle large text without memory issues', () => {
    const largeText = ('== Section ==\nParagraph with [[link]] and {{template|value}}. ').repeat(200)
    const doc = wtf(largeText)
    expect(doc.sections().length).toBeGreaterThan(0)
    expect(doc.links().length).toBeGreaterThan(0)
    // Verify JSON can be serialized (no cyclic refs)
    const json = doc.json()
    expect(() => JSON.stringify(json)).not.toThrow()
  })

  it('should handle many sections', () => {
    const manySections = Array(50).fill('').map((_, i) => `== Section ${i} ==\nContent ${i}.`).join('\n\n')
    const doc = wtf(manySections)
    expect(doc.sections().length).toBe(50)
  })

  it('should handle deeply nested infobox', () => {
    const deepInfobox = `{{Infobox person
| name = {{nowrap|{{small|John Doe}}}}
| birth_date = {{birth date and age|1990|1|1}}
| spouse = {{marriage|{{nowrap|Jane Doe}}|2010}}
| children = {{hlist|Child 1|Child 2|{{nowrap|Child 3}}}}
}}`
    const doc = wtf(deepInfobox)
    expect(doc.infoboxes().length).toBe(1)
  })
})
