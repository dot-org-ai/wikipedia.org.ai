/**
 * Image class for handling [[File:...]] and [[Image:...]] links in wtf-lite
 */

import type { ImageData } from './types'
import { parseSentence } from './links'
import { PATTERNS, getFileNsPrefixPattern } from './constants'

// Default server for Wikimedia image URLs
const DEFAULT_SERVER = 'wikipedia.org'

/**
 * Encode a file title for URL generation
 */
function encodeTitle(file: string): string {
  let title = file.replace(/^(image|file?):/i, '')
  // Titlecase first character
  title = title.charAt(0).toUpperCase() + title.substring(1)
  // Spaces to underscores
  title = title.trim().replace(/ /g, '_')
  return title
}

/**
 * Make a URL-safe source string from a file name
 */
function makeSrc(file: string): string {
  const title = encodeTitle(file)
  return encodeURIComponent(title)
}

/**
 * Image class for Wikipedia/Wikimedia images
 */
export class Image {
  private _data: ImageData

  constructor(data: ImageData) {
    this._data = data
  }

  /**
   * Get the file name with File: prefix
   */
  file(): string {
    let file = this._data.file || ''
    if (file) {
      // Check if it already has a file namespace prefix (any language)
      // Use cached pattern instead of building new one each time
      if (!getFileNsPrefixPattern().test(file)) {
        // If there's no 'File:', add it
        file = `File:${file}`
      }
      file = file.trim()
      // Titlecase first character
      file = file.charAt(0).toUpperCase() + file.substring(1)
      // Spaces to underscores
      file = file.replace(PATTERNS.UNDERSCORE, '_')
    }
    return file
  }

  /**
   * Get alt text for the image
   */
  alt(): string {
    let str = this._data.alt || this._data.file || ''
    // Strip any file namespace prefix using cached pattern
    str = str.replace(getFileNsPrefixPattern(), '')
    str = str.replace(PATTERNS.IMAGE_EXTENSION, '')
    return str.replace(PATTERNS.UNDERSCORE, ' ')
  }

  /**
   * Get the image caption as text
   */
  caption(): string {
    if (this._data.caption) {
      return this._data.caption.text()
    }
    return ''
  }

  /**
   * Get links from the caption
   */
  links(): import('./links').Link[] {
    if (this._data.caption) {
      return this._data.caption.links()
    }
    return []
  }

  /**
   * Generate the Wikimedia image URL
   */
  url(): string {
    const fileName = makeSrc(this.file())
    const domain = this._data.domain || DEFAULT_SERVER
    const path = 'wiki/Special:Redirect/file'
    return `https://${domain}/${path}/${fileName}`
  }

  /**
   * Alias for url()
   */
  src(): string {
    return this.url()
  }

  /**
   * Get a thumbnail URL at the specified size
   */
  thumbnail(size?: number): string {
    size = size || 300
    return this.url() + '?width=' + size
  }

  /**
   * Alias for thumbnail()
   */
  thumb(size?: number): string {
    return this.thumbnail(size)
  }

  /**
   * Get the file format/extension
   */
  format(): string | null {
    const arr = this.file().split('.')
    if (arr[arr.length - 1]) {
      return arr[arr.length - 1]!.toLowerCase()
    }
    return null
  }

  /**
   * Get width if specified
   */
  width(): number | null {
    return this._data.width ?? null
  }

  /**
   * Get height if specified
   */
  height(): number | null {
    return this._data.height ?? null
  }

  /**
   * Convert to JSON representation
   */
  json(): object {
    return {
      file: this.file(),
      url: this.url(),
      caption: this.caption() || undefined,
      alt: this.alt() || undefined,
      width: this.width() ?? undefined,
      height: this.height() ?? undefined,
      format: this.format() || undefined,
    }
  }

  /**
   * Return empty string for text (images don't have text content)
   */
  text(): string {
    return ''
  }

  /**
   * Return original wikitext
   */
  wikitext(): string {
    return this._data.wiki || ''
  }
}

/**
 * Split image content by pipe character, respecting nested brackets
 * e.g., "File:foo.jpg|thumb|caption with [[link]]" -> ["File:foo.jpg", "thumb", "caption with [[link]]"]
 */
function splitImageParts(content: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    const next = content[i + 1]

    if (c === '[' && next === '[') {
      depth++
      current += '[['
      i++
    } else if (c === ']' && next === ']') {
      depth--
      current += ']]'
      i++
    } else if (c === '{' && next === '{') {
      depth++
      current += '{{'
      i++
    } else if (c === '}' && next === '}') {
      depth--
      current += '}}'
      i++
    } else if (c === '|' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += c
    }
  }

  if (current) {
    parts.push(current)
  }

  return parts
}

/**
 * Parse image parameters from wiki markup
 * Handles [[File:name.jpg|thumb|300px|alt=description|caption text]]
 * Also handles nested links in captions: [[File:foo.jpg|caption with [[link]]]]
 */
export function parseImageParams(wiki: string): ImageData {
  const data: ImageData = { wiki }

  // Check it starts with [[ and ends with ]]
  if (!wiki.startsWith('[[') || !wiki.endsWith(']]')) {
    return data
  }

  // Extract content between outer [[ and ]]
  const content = wiki.slice(2, -2)

  // Split by | while respecting nested brackets
  const parts = splitImageParts(content)

  // First part is always the file name - strip any localized file namespace prefix
  const fileName = parts[0]?.trim() || ''
  // Use cached pattern instead of building new one each time
  data.file = fileName.replace(getFileNsPrefixPattern(), '')

  // Parse remaining parameters
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]?.trim() || ''

    // Check for named parameters (key=value)
    if (part.includes('=') && !part.startsWith('[[')) {
      const eqIndex = part.indexOf('=')
      const key = part.slice(0, eqIndex).toLowerCase().trim()
      const value = part.slice(eqIndex + 1).trim()

      if (key === 'alt') {
        data.alt = value
      } else if (key === 'link') {
        data.link = value
      } else if (key === 'class') {
        data.class = value
      } else if (key === 'lang') {
        data.lang = value
      } else if (key === 'page') {
        data.page = value
      } else if (key === 'upright') {
        // upright=factor
        data.upright = parseFloat(value) || 0.75
      }
    }
    // Check for size (e.g., 300px, 200x150px)
    else if (PATTERNS.IMAGE_SIZE.test(part)) {
      const sizeMatch = part.match(PATTERNS.IMAGE_SIZE_EXTRACT)
      if (sizeMatch) {
        if (sizeMatch[2]) {
          // Width x Height format
          data.width = parseInt(sizeMatch[1]!, 10)
          data.height = parseInt(sizeMatch[2], 10)
        } else {
          // Width only
          data.width = parseInt(sizeMatch[1]!, 10)
        }
      }
    }
    // Check for upright without value
    else if (part.toLowerCase() === 'upright') {
      data.upright = 0.75 // default upright factor
    }
    // Check for type keywords
    else if (['thumb', 'thumbnail', 'frame', 'framed', 'frameless'].includes(part.toLowerCase())) {
      const typeValue = part.toLowerCase()
      if (typeValue === 'thumbnail' || typeValue === 'thumb') {
        data.type = 'thumb'
      } else if (typeValue === 'framed' || typeValue === 'frame') {
        data.type = 'frame'
      } else if (typeValue === 'frameless') {
        data.type = 'frameless'
      }
    }
    // Check for horizontal alignment
    else if (['left', 'right', 'center', 'none'].includes(part.toLowerCase())) {
      data.align = part.toLowerCase() as 'left' | 'right' | 'center' | 'none'
    }
    // Check for vertical alignment
    else if (['baseline', 'middle', 'sub', 'super', 'text-top', 'text-bottom', 'top', 'bottom'].includes(part.toLowerCase())) {
      data.valign = part.toLowerCase()
    }
    // Check for border
    else if (part.toLowerCase() === 'border') {
      data.border = true
    }
    // Last unrecognized part is typically the caption
    else if (i === parts.length - 1 && part.length > 0) {
      data.caption = parseSentence(part)
    }
  }

  return data
}

/**
 * Find and extract all image links from wiki text
 * Returns the images found and the modified text with images removed
 */
export function findImages(wiki: string, fileNsPrefixes: string[]): { images: Image[]; text: string } {
  const images: Image[] = []
  const fileNsReg = new RegExp(`\\[\\[(${fileNsPrefixes.join('|')}):`, 'gi')
  const positions: { start: number; end: number; wiki: string }[] = []

  let match
  while ((match = fileNsReg.exec(wiki)) !== null) {
    const startIdx = match.index
    let depth = 0
    let endIdx = startIdx

    for (let i = startIdx; i < wiki.length - 1; i++) {
      if (wiki[i] === '[' && wiki[i + 1] === '[') {
        depth++
        i++
      } else if (wiki[i] === ']' && wiki[i + 1] === ']') {
        depth--
        i++
        if (depth === 0) {
          endIdx = i + 1
          break
        }
      }
    }

    if (endIdx > startIdx) {
      const imageWiki = wiki.slice(startIdx, endIdx)
      positions.push({ start: startIdx, end: endIdx, wiki: imageWiki })
      fileNsReg.lastIndex = endIdx
    }
  }

  // Parse each image
  for (const pos of positions) {
    const imageData = parseImageParams(pos.wiki)
    images.push(new Image(imageData))
  }

  // Remove images from text in one pass
  if (positions.length > 0) {
    const sorted = [...positions].sort((a, b) => a.start - b.start)
    const parts: string[] = []
    let lastEnd = 0
    for (const pos of sorted) {
      if (pos.start > lastEnd) {
        parts.push(wiki.slice(lastEnd, pos.start))
      }
      lastEnd = Math.max(lastEnd, pos.end)
    }
    if (lastEnd < wiki.length) {
      parts.push(wiki.slice(lastEnd))
    }
    wiki = parts.join('')
  }

  return { images, text: wiki }
}
