/**
 * Comprehensive tests for the wtf-lite Image class
 * Ported from wtf_wikipedia image tests
 *
 * Tests cover:
 * - Image class: url(), thumbnail(), caption(), alt(), file(), json()
 * - File namespaces: File:, Image:, Datei:, Fichier: (localized)
 * - Options: thumb, left, right, center, framed, frameless, px sizes
 * - Captions: simple, with links, with templates
 * - Edge cases: nested brackets in captions, special characters in filenames
 */

import { describe, it, expect } from 'vitest'
import wtf, { Image } from '../../src/lib/wtf-lite/index'

// ============================================================================
// IMAGE CLASS TESTS (ported from wtf_wikipedia)
// ============================================================================

describe('Image Class', () => {
  describe('Basic Image Methods', () => {
    it('should export Image class', () => {
      expect(Image).toBeDefined()
    })

    it('should parse simple file link', () => {
      const doc = wtf('[[File:Example.jpg]]')
      const img = doc.image()
      expect(img).not.toBeNull()
      expect(img?.file()).toBe('File:Example.jpg')
    })

    it('should get image url', () => {
      const str = '[[File:Wikipedesketch1.png|thumb|alt=A cartoon centipede detailed description.|The Wikipede edits Myriapoda.]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img).not.toBeNull()
      expect(img?.url()).toBe('https://wikipedia.org/wiki/Special:Redirect/file/Wikipedesketch1.png')
    })

    it('should get thumbnail url with default size', () => {
      const str = '[[File:Wikipedesketch1.png|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.thumbnail()).toBe('https://wikipedia.org/wiki/Special:Redirect/file/Wikipedesketch1.png?width=300')
    })

    it('should get thumbnail url with custom size', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.thumbnail(500)).toBe('https://wikipedia.org/wiki/Special:Redirect/file/Test.jpg?width=500')
    })

    it('should get thumb alias for thumbnail', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.thumb(200)).toBe('https://wikipedia.org/wiki/Special:Redirect/file/Test.jpg?width=200')
    })

    it('should get caption text', () => {
      const str = '[[File:Wikipedesketch1.png|thumb|The Wikipede edits Myriapoda.]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.caption()).toBe('The Wikipede edits Myriapoda.')
    })

    it('should get alt text', () => {
      const str = '[[File:Wikipedesketch1.png|thumb|alt=A cartoon centipede detailed description.|The Wikipede]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.alt()).toBe('A cartoon centipede detailed description.')
    })

    it('should generate alt from filename when not specified', () => {
      const str = '[[File:My_Test_Image.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.alt()).toBe('My Test Image')
    })

    it('should get file format', () => {
      const str = '[[File:Example.png]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.format()).toBe('png')
    })

    it('should return empty string for text()', () => {
      const str = '[[File:Example.png|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.text()).toBe('')
    })

    it('should get original wikitext', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.wikitext()).toBe('[[File:Test.jpg|thumb|Caption]]')
    })
  })

  describe('Image JSON Output', () => {
    it('should produce valid json from image', () => {
      const str = '[[File:Wikipedesketch1.png|thumb|alt=A cartoon centipede.|The Wikipede]]'
      const doc = wtf(str)
      const img = doc.image()
      const json = img?.json() as any
      expect(json).toHaveProperty('file')
      expect(json).toHaveProperty('url')
      expect(json).toHaveProperty('caption')
      expect(json).toHaveProperty('alt')
      expect(json.file).toBe('File:Wikipedesketch1.png')
      expect(json.caption).toBe('The Wikipede')
      expect(json.alt).toBe('A cartoon centipede.')
    })

    it('should include format in json', () => {
      const str = '[[File:Test.jpg]]'
      const doc = wtf(str)
      const img = doc.image()
      const json = img?.json() as any
      expect(json.format).toBe('jpg')
    })

    it('should include width in json when specified', () => {
      const str = '[[File:Test.jpg|300px]]'
      const doc = wtf(str)
      const img = doc.image()
      const json = img?.json() as any
      expect(json.width).toBe(300)
    })

    it('should include url in json', () => {
      const str = '[[File:Test.jpg]]'
      const doc = wtf(str)
      const img = doc.image()
      const json = img?.json() as any
      expect(json.url).toContain('wikipedia.org')
      expect(json.url).toContain('Test.jpg')
    })
  })

  describe('File Namespaces (i18n)', () => {
    it('should parse File: namespace', () => {
      const doc = wtf('[[File:Example.jpg|thumb|Caption]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toBe('File:Example.jpg')
    })

    it('should parse Image: namespace', () => {
      const doc = wtf('[[Image:Photo.png|right|300px|Caption]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Photo.png')
    })

    it('should parse Datei: namespace (German)', () => {
      const doc = wtf('[[Datei:Foto.jpg|thumb|Beschreibung]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Foto.jpg')
    })

    it('should parse Fichier: namespace (French)', () => {
      const doc = wtf('[[Fichier:Image.png|thumb|Description]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Image.png')
    })

    it('should parse Archivo: namespace (Spanish)', () => {
      const doc = wtf('[[Archivo:Imagen.gif|thumb|Descripcion]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Imagen.gif')
    })

    it('should parse Bestand: namespace (Dutch)', () => {
      const doc = wtf('[[Bestand:Foto.jpg|thumb|Beschrijving]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Foto.jpg')
    })

    it('should parse Bild: namespace (German alt)', () => {
      const doc = wtf('[[Bild:Bild.jpg|thumb|Beschreibung]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Bild.jpg')
    })

    it('should parse Plik: namespace (Polish)', () => {
      const doc = wtf('[[Plik:Zdjecie.jpg|thumb|Opis]]')
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Zdjecie.jpg')
    })
  })

  describe('Image Options', () => {
    it('should parse thumb option', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img).not.toBeNull()
    })

    it('should parse thumbnail option (synonym of thumb)', () => {
      const str = '[[File:Test.jpg|thumbnail|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img).not.toBeNull()
    })

    it('should parse left alignment', () => {
      const str = '[[File:Test.jpg|left|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse right alignment', () => {
      const str = '[[File:Test.jpg|right|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse center alignment', () => {
      const str = '[[File:Test.jpg|center|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse none alignment', () => {
      const str = '[[File:Test.jpg|none|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse framed option', () => {
      const str = '[[File:Test.jpg|framed|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse frame option (synonym of framed)', () => {
      const str = '[[File:Test.jpg|frame|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse frameless option', () => {
      const str = '[[File:Test.jpg|frameless|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse border option', () => {
      const str = '[[File:Test.jpg|border|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse upright option', () => {
      const str = '[[File:Test.jpg|upright|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse upright with factor', () => {
      const str = '[[File:Test.jpg|upright=0.5|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse link option', () => {
      const str = '[[File:Test.jpg|link=Main Page|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should parse lang option', () => {
      const str = '[[File:Test.svg|lang=de|German version]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })
  })

  describe('Image Sizes', () => {
    it('should parse width in pixels', () => {
      const str = '[[File:Test.jpg|300px|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.width()).toBe(300)
    })

    it('should parse width x height', () => {
      const str = '[[File:Test.jpg|200x150px|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.width()).toBe(200)
      expect(img?.height()).toBe(150)
    })

    it('should handle various size formats', () => {
      const str = '[[File:Test.jpg|100px]]'
      const doc = wtf(str)
      expect(doc.image()?.width()).toBe(100)
    })

    it('should handle size with spaces', () => {
      const str = '[[File:Test.jpg|200 x 100px|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.width()).toBe(200)
      expect(img?.height()).toBe(100)
    })

    it('should return null for unspecified width', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      expect(doc.image()?.width()).toBeNull()
    })

    it('should return null for unspecified height', () => {
      const str = '[[File:Test.jpg|300px|Caption]]'
      const doc = wtf(str)
      expect(doc.image()?.height()).toBeNull()
    })
  })

  describe('Image Captions', () => {
    it('should parse simple caption', () => {
      const str = '[[File:Test.jpg|thumb|This is a simple caption.]]'
      const doc = wtf(str)
      expect(doc.image()?.caption()).toBe('This is a simple caption.')
    })

    it('should parse caption with links', () => {
      const str = '[[File:Volkswagen_W12.jpg|thumb|[[Volkswagen Group]] W12 engine]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.caption()).toContain('Volkswagen Group')
      expect(img?.caption()).toContain('W12 engine')
    })

    it('should strip link markup from caption text', () => {
      const str = '[[File:Test.jpg|thumb|A [[link]] in caption]]'
      const doc = wtf(str)
      const caption = doc.image()?.caption()
      expect(caption).toContain('link')
      expect(caption).not.toContain('[[')
      expect(caption).not.toContain(']]')
    })

    it('should get links from caption', () => {
      const str = '[[File:Test.jpg|thumb|See [[Paris]] and [[London]]]]'
      const doc = wtf(str)
      const img = doc.image()
      const links = img?.links() || []
      expect(links.length).toBeGreaterThanOrEqual(2)
    })

    it('should parse caption with multiple links (wtf_wikipedia test)', () => {
      const str = '[[File:Volkswagen W12.jpg|thumb|upright|[[Volkswagen Group]] W12 engine from the [[Volkswagen Phaeton|Volkswagen Phaeton W12]]]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.caption()).toBe('Volkswagen Group W12 engine from the Volkswagen Phaeton W12')
    })

    it('should handle empty caption', () => {
      const str = '[[File:Test.jpg|thumb]]'
      const doc = wtf(str)
      expect(doc.image()?.caption()).toBe('')
    })

    it('should parse caption with italic text', () => {
      const str = "[[File:Test.jpg|thumb|The ''Myriapoda'' article]]"
      const doc = wtf(str)
      const caption = doc.image()?.caption()
      expect(caption).toContain('Myriapoda')
    })
  })

  describe('Nested Brackets in Captions', () => {
    it('should handle nested link in caption', () => {
      const str = '[[File:Test.jpg|thumb|Caption with [[nested link]] inside]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.caption()).toContain('nested link')
    })

    it('should handle multiple nested links', () => {
      const str = '[[File:Test.jpg|thumb|[[First]] and [[Second]] links]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should handle piped links in caption', () => {
      const str = '[[File:Test.jpg|thumb|A [[Display|piped link]] here]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
      const caption = doc.image()?.caption()
      expect(caption).toContain('piped link')
    })

    it('should handle nested template in caption', () => {
      const str = '[[File:Test.jpg|thumb|Caption with {{small|text}}]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })
  })

  describe('Special Characters in Filenames', () => {
    it('should handle spaces in filename', () => {
      const str = '[[File:Test Image With Spaces.jpg|thumb|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Test_Image_With_Spaces.jpg')
    })

    it('should handle underscores in filename', () => {
      const str = '[[File:Test_Image_Underscored.jpg|thumb|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
      expect(doc.image()?.file()).toContain('Test_Image_Underscored.jpg')
    })

    it('should handle unicode in filename', () => {
      const str = '[[File:Tokyo_東京.jpg|thumb|Tokyo]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should handle parentheses in filename', () => {
      const str = '[[File:Image (v1).jpg|thumb|Caption]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(1)
    })

    it('should encode filename for URL', () => {
      const str = '[[File:Test Image.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const url = doc.image()?.url()
      expect(url).toContain('Test_Image.jpg')
    })

    it('should titlecase first character', () => {
      const str = '[[File:lowercase.jpg|thumb|Caption]]'
      const doc = wtf(str)
      expect(doc.image()?.file()).toBe('File:Lowercase.jpg')
    })
  })

  describe('Document Image Methods', () => {
    it('should get all images with images()', () => {
      const str = 'Text [[File:One.jpg]] and [[File:Two.jpg]] and [[File:Three.jpg]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(3)
    })

    it('should get first image with image()', () => {
      const str = '[[File:First.jpg]] [[File:Second.jpg]]'
      const doc = wtf(str)
      expect(doc.image()?.file()).toContain('First.jpg')
    })

    it('should get image by index', () => {
      const str = '[[File:Zero.jpg]] [[File:One.jpg]] [[File:Two.jpg]]'
      const doc = wtf(str)
      expect(doc.images(1)[0]?.file()).toContain('One.jpg')
    })

    it('should return empty array for out-of-range index', () => {
      const str = '[[File:Only.jpg]]'
      const doc = wtf(str)
      expect(doc.images(5)).toHaveLength(0)
    })

    it('should return null for image() when no images', () => {
      const doc = wtf('No images here.')
      expect(doc.image()).toBeNull()
    })

    it('should include images in document json', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const json = doc.json() as any
      expect(json.images).toBeDefined()
      expect(json.images).toHaveLength(1)
      expect(json.images[0].file).toContain('Test.jpg')
    })
  })

  describe('Image Stripping from Text', () => {
    it('should strip File links from text', () => {
      const doc = wtf('Text [[File:Example.jpg|thumb|200px|Caption]] more text.')
      expect(doc.text()).not.toContain('File:')
      expect(doc.text()).not.toContain('Example.jpg')
    })

    it('should strip Image links from text', () => {
      const doc = wtf('Text [[Image:Photo.png|right|300px]] more text.')
      expect(doc.text()).not.toContain('Image:')
      expect(doc.text()).not.toContain('Photo.png')
    })

    it('should handle nested brackets in file captions', () => {
      const doc = wtf('[[File:Test.jpg|thumb|Caption with [[link]] inside]]')
      expect(doc.text()).not.toContain('File:')
    })

    it('should handle i18n file namespace in text stripping', () => {
      const doc = wtf('[[Datei:Foto.jpg|thumb]] German file.')
      expect(doc.text()).not.toContain('Datei:')
    })

    it('should preserve surrounding text', () => {
      const doc = wtf('Before image [[File:Test.jpg|thumb|Caption]] after image.')
      const text = doc.text()
      expect(text).toContain('Before image')
      expect(text).toContain('after image')
    })
  })

  describe('Multiple Images', () => {
    it('should parse multiple images in same paragraph', () => {
      const str = '[[File:One.jpg|thumb|First]] Some text [[File:Two.jpg|thumb|Second]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(2)
    })

    it('should parse images in different sections', () => {
      const str = '== Section 1 ==\n[[File:First.jpg]]\n\n== Section 2 ==\n[[File:Second.jpg]]'
      const doc = wtf(str)
      expect(doc.images()).toHaveLength(2)
    })

    it('should maintain image order', () => {
      const str = '[[File:A.jpg]] [[File:B.jpg]] [[File:C.jpg]]'
      const doc = wtf(str)
      const images = doc.images()
      expect(images[0]?.file()).toContain('A.jpg')
      expect(images[1]?.file()).toContain('B.jpg')
      expect(images[2]?.file()).toContain('C.jpg')
    })
  })

  describe('Image Format Detection', () => {
    it('should detect jpg format', () => {
      const str = '[[File:Test.jpg]]'
      expect(wtf(str).image()?.format()).toBe('jpg')
    })

    it('should detect jpeg format', () => {
      const str = '[[File:Test.jpeg]]'
      expect(wtf(str).image()?.format()).toBe('jpeg')
    })

    it('should detect png format', () => {
      const str = '[[File:Test.png]]'
      expect(wtf(str).image()?.format()).toBe('png')
    })

    it('should detect gif format', () => {
      const str = '[[File:Test.gif]]'
      expect(wtf(str).image()?.format()).toBe('gif')
    })

    it('should detect svg format', () => {
      const str = '[[File:Test.svg]]'
      expect(wtf(str).image()?.format()).toBe('svg')
    })

    it('should detect webp format', () => {
      const str = '[[File:Test.webp]]'
      expect(wtf(str).image()?.format()).toBe('webp')
    })

    it('should handle uppercase extensions', () => {
      const str = '[[File:Test.JPG]]'
      expect(wtf(str).image()?.format()).toBe('jpg')
    })
  })

  describe('src() Alias', () => {
    it('should have src() as alias for url()', () => {
      const str = '[[File:Test.jpg|thumb|Caption]]'
      const doc = wtf(str)
      const img = doc.image()
      expect(img?.src()).toBe(img?.url())
    })
  })

  describe('wtf_wikipedia Compatibility (img-alt test)', () => {
    it('should match wtf_wikipedia img-alt test', () => {
      const str = `[[File:Wikipedesketch1.png|thumb|alt=A cartoon centipede detailed description.|The Wikipede edits ''[[Myriapoda]]''.]]`
      const doc = wtf(str)
      const img = doc.image()
      const json = img?.json() as any
      expect(json.file).toBe('File:Wikipedesketch1.png')
      expect(json.url).toBe('https://wikipedia.org/wiki/Special:Redirect/file/Wikipedesketch1.png')
      expect(img?.caption()).toContain('The Wikipede edits')
      expect(img?.caption()).toContain('Myriapoda')
      expect(json.alt).toBe('A cartoon centipede detailed description.')
    })
  })
})
