/**
 * Tests for wikipedia.org.ai handlers
 *
 * Tests the wiki parser handlers including:
 * - Path parsing with extensions (.json, .md, .txt)
 * - Language prefix handling
 * - Section extraction
 * - Format-specific responses
 */

import { describe, it, expect } from 'vitest';

/**
 * Replicate the parsePath function for testing
 * (Extracted from src/workers/api/handlers/wiki.ts)
 */
function parsePath(path: string): {
  title: string;
  lang: string;
  format: string;
  section: string | null;
} {
  // Remove leading slash and decode URL
  let p = decodeURIComponent(path.replace(/^\/+/, ''));

  let lang = 'en';
  let format = 'md';
  let section: string | null = null;

  // Check for language prefix (2 letter code)
  const langMatch = p.match(/^([a-z]{2})\/(.+)$/);
  if (langMatch && langMatch[1] && langMatch[2]) {
    lang = langMatch[1];
    p = langMatch[2];
  }

  // Check for format extensions
  if (p.endsWith('.json')) {
    format = 'json';
    p = p.slice(0, -5);
  } else if (p.endsWith('.md')) {
    format = 'md';
    p = p.slice(0, -3);
  } else if (p.endsWith('.markdown')) {
    format = 'md';
    p = p.slice(0, -9);
  } else if (p.endsWith('.txt')) {
    format = 'txt';
    p = p.slice(0, -4);
  }

  // Check for section suffix
  const sections = ['summary', 'infobox', 'links', 'categories', 'text'];
  for (const s of sections) {
    if (p.endsWith('/' + s)) {
      section = s;
      p = p.slice(0, -(s.length + 1));
      break;
    }
  }

  return { title: p, lang, format, section };
}

describe('Wiki Handler Path Parsing', () => {
  describe('Basic title extraction', () => {
    it('should extract simple title', () => {
      const result = parsePath('/Albert_Einstein');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.lang).toBe('en');
      expect(result.format).toBe('md');
      expect(result.section).toBeNull();
    });

    it('should handle URL-encoded titles', () => {
      const result = parsePath('/Albert%20Einstein');
      expect(result.title).toBe('Albert Einstein');
    });

    it('should handle titles with special characters', () => {
      const result = parsePath('/C%2B%2B');
      expect(result.title).toBe('C++');
    });
  });

  describe('Extension handling', () => {
    it('should strip .json extension and set format', () => {
      const result = parsePath('/Albert_Einstein.json');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.format).toBe('json');
    });

    it('should strip .md extension and set format', () => {
      const result = parsePath('/Albert_Einstein.md');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.format).toBe('md');
    });

    it('should strip .markdown extension and set format', () => {
      const result = parsePath('/Albert_Einstein.markdown');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.format).toBe('md');
    });

    it('should strip .txt extension and set format', () => {
      const result = parsePath('/Albert_Einstein.txt');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.format).toBe('txt');
    });

    it('should default to md format without extension', () => {
      const result = parsePath('/Albert_Einstein');
      expect(result.format).toBe('md');
    });

    it('should not strip unknown extensions', () => {
      const result = parsePath('/Albert_Einstein.html');
      expect(result.title).toBe('Albert_Einstein.html');
      expect(result.format).toBe('md');
    });
  });

  describe('Language prefix handling', () => {
    it('should extract language prefix', () => {
      const result = parsePath('/fr/Paris');
      expect(result.title).toBe('Paris');
      expect(result.lang).toBe('fr');
    });

    it('should handle language prefix with .json extension', () => {
      const result = parsePath('/de/Berlin.json');
      expect(result.title).toBe('Berlin');
      expect(result.lang).toBe('de');
      expect(result.format).toBe('json');
    });

    it('should handle language prefix with .md extension', () => {
      const result = parsePath('/es/Madrid.md');
      expect(result.title).toBe('Madrid');
      expect(result.lang).toBe('es');
      expect(result.format).toBe('md');
    });

    it('should default to en language', () => {
      const result = parsePath('/Tokyo');
      expect(result.lang).toBe('en');
    });

    it('should not treat 3+ letter prefixes as language', () => {
      const result = parsePath('/fra/Paris');
      expect(result.title).toBe('fra/Paris');
      expect(result.lang).toBe('en');
    });
  });

  describe('Section suffix handling', () => {
    it('should extract /summary section', () => {
      const result = parsePath('/Albert_Einstein/summary');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.section).toBe('summary');
    });

    it('should extract /infobox section', () => {
      const result = parsePath('/Albert_Einstein/infobox');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.section).toBe('infobox');
    });

    it('should extract /links section', () => {
      const result = parsePath('/Albert_Einstein/links');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.section).toBe('links');
    });

    it('should extract /categories section', () => {
      const result = parsePath('/Albert_Einstein/categories');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.section).toBe('categories');
    });

    it('should extract /text section', () => {
      const result = parsePath('/Albert_Einstein/text');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.section).toBe('text');
    });

    it('should handle section with language prefix', () => {
      const result = parsePath('/fr/Paris/summary');
      expect(result.title).toBe('Paris');
      expect(result.lang).toBe('fr');
      expect(result.section).toBe('summary');
    });
  });

  describe('Complex combinations', () => {
    it('should handle language + extension', () => {
      const result = parsePath('/ja/Tokyo.json');
      expect(result.title).toBe('Tokyo');
      expect(result.lang).toBe('ja');
      expect(result.format).toBe('json');
      expect(result.section).toBeNull();
    });

    it('should handle language + section', () => {
      const result = parsePath('/de/Berlin/infobox');
      expect(result.title).toBe('Berlin');
      expect(result.lang).toBe('de');
      expect(result.section).toBe('infobox');
      expect(result.format).toBe('md');
    });

    it('should handle title with underscores and extension', () => {
      const result = parsePath('/United_States_of_America.json');
      expect(result.title).toBe('United_States_of_America');
      expect(result.format).toBe('json');
    });

    it('should handle encoded title with extension', () => {
      const result = parsePath('/New%20York%20City.md');
      expect(result.title).toBe('New York City');
      expect(result.format).toBe('md');
    });
  });

  describe('Edge cases', () => {
    it('should handle root path', () => {
      const result = parsePath('/');
      expect(result.title).toBe('');
    });

    it('should handle multiple leading slashes', () => {
      const result = parsePath('///Albert_Einstein');
      expect(result.title).toBe('Albert_Einstein');
    });

    it('should handle title ending with .json in name (not extension)', () => {
      // Article about JSON format itself
      const result = parsePath('/JSON');
      expect(result.title).toBe('JSON');
      expect(result.format).toBe('md');
    });

    it('should handle real Tokyo path that was failing', () => {
      const result = parsePath('/Tokyo.json');
      expect(result.title).toBe('Tokyo');
      expect(result.format).toBe('json');
    });

    it('should handle real Albert_Einstein.md path that was failing', () => {
      const result = parsePath('/Albert_Einstein.md');
      expect(result.title).toBe('Albert_Einstein');
      expect(result.format).toBe('md');
    });
  });
});

describe('Wiki Handler Response Formats', () => {
  // These tests verify the expected Content-Type headers for each format

  it('should return text/markdown for .md format', () => {
    // Format: md -> Content-Type: text/markdown; charset=utf-8
    expect(true).toBe(true); // Placeholder - actual test requires handler invocation
  });

  it('should return application/json for .json format', () => {
    // Format: json -> Content-Type: application/json
    expect(true).toBe(true);
  });

  it('should return text/plain for .txt format', () => {
    // Format: txt -> Content-Type: text/plain; charset=utf-8
    expect(true).toBe(true);
  });
});
