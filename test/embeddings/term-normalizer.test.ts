/**
 * Tests for Term Normalizer
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTerm,
  generateCacheKey,
  hashString,
  generateBloomHashes,
  generateVariants,
  termsMatch,
  levenshteinDistance,
  termSimilarity,
  normalizeTermsBatch,
  extractTerms,
} from '../../src/embeddings/term-normalizer.js';

describe('normalizeTerm', () => {
  describe('basic normalization', () => {
    it('should convert to lowercase', () => {
      expect(normalizeTerm('HELLO WORLD')).toBe('hello world');
      expect(normalizeTerm('Albert Einstein')).toBe('albert einstein');
    });

    it('should trim whitespace', () => {
      expect(normalizeTerm('  hello  ')).toBe('hello');
      expect(normalizeTerm('\t\ntest\r\n')).toBe('test');
    });

    it('should collapse multiple spaces', () => {
      expect(normalizeTerm('hello    world')).toBe('hello world');
      expect(normalizeTerm('a  b  c')).toBe('a b c');
    });

    it('should handle empty string', () => {
      expect(normalizeTerm('')).toBe('');
    });
  });

  describe('diacritic removal', () => {
    it('should remove common accents', () => {
      expect(normalizeTerm('cafe\u0301')).toBe('cafe'); // e with combining acute
      expect(normalizeTerm('\u00E9')).toBe('e'); // e-acute
      expect(normalizeTerm('\u00E0')).toBe('a'); // a-grave
      expect(normalizeTerm('\u00E2')).toBe('a'); // a-circumflex
    });

    it('should handle special characters', () => {
      expect(normalizeTerm('\u00E6')).toBe('ae'); // ae ligature
      expect(normalizeTerm('\u00DF')).toBe('ss'); // German sharp s
      expect(normalizeTerm('\u0153')).toBe('oe'); // oe ligature
      expect(normalizeTerm('\u00F1')).toBe('n'); // n with tilde
    });

    it('should handle Polish characters', () => {
      expect(normalizeTerm('\u0142')).toBe('l'); // l with stroke
      expect(normalizeTerm('\u0144')).toBe('n'); // n with acute
    });

    it('should preserve diacritics when removeDiacritics is false', () => {
      const result = normalizeTerm('\u00E9', { removeDiacritics: false });
      // Should still be lowercase but keep the accent
      expect(result).toBe('\u00E9');
    });
  });

  describe('special character removal', () => {
    it('should remove punctuation', () => {
      expect(normalizeTerm('hello, world!')).toBe('hello world');
      // Apostrophe becomes space, which collapses
      expect(normalizeTerm("it's a test")).toBe('it s a test');
    });

    it('should remove symbols', () => {
      expect(normalizeTerm('C++ programming')).toBe('c programming');
      expect(normalizeTerm('email@test.com')).toBe('email test com');
    });

    it('should keep alphanumeric characters', () => {
      expect(normalizeTerm('test123')).toBe('test123');
      expect(normalizeTerm('AB12CD34')).toBe('ab12cd34');
    });

    it('should preserve special chars when removeSpecialChars is false', () => {
      const result = normalizeTerm("hello, it's me", { removeSpecialChars: false });
      expect(result).toContain("'");
    });
  });

  describe('stemming', () => {
    it('should stem plural forms when enabled', () => {
      expect(normalizeTerm('countries', { stem: true })).toBe('country');
      expect(normalizeTerm('wolves', { stem: true })).toBe('wolf');
      expect(normalizeTerm('boxes', { stem: true })).toBe('box');
    });

    it('should stem verb forms when enabled', () => {
      expect(normalizeTerm('running', { stem: true })).toBe('runn');
      expect(normalizeTerm('jumped', { stem: true })).toBe('jump');
      expect(normalizeTerm('tried', { stem: true })).toBe('try');
    });

    it('should not stem very short words', () => {
      expect(normalizeTerm('as', { stem: true })).toBe('as');
      expect(normalizeTerm('is', { stem: true })).toBe('is');
    });

    it('should not stem when disabled', () => {
      expect(normalizeTerm('countries')).toBe('countries');
      expect(normalizeTerm('running')).toBe('running');
    });
  });

  describe('abbreviation expansion', () => {
    it('should expand abbreviations when enabled', () => {
      expect(normalizeTerm('usa', { expandAbbreviations: true })).toBe('united states of america');
      expect(normalizeTerm('uk', { expandAbbreviations: true })).toBe('united kingdom');
      expect(normalizeTerm('nyc', { expandAbbreviations: true })).toBe('new york city');
    });

    it('should not expand when disabled', () => {
      expect(normalizeTerm('usa')).toBe('usa');
      expect(normalizeTerm('uk')).toBe('uk');
    });
  });

  describe('maxLength', () => {
    it('should truncate long strings', () => {
      const longTerm = 'a'.repeat(300);
      expect(normalizeTerm(longTerm).length).toBe(256);
    });

    it('should respect custom maxLength', () => {
      const longTerm = 'a'.repeat(100);
      expect(normalizeTerm(longTerm, { maxLength: 50 }).length).toBe(50);
    });

    it('should not truncate short strings', () => {
      expect(normalizeTerm('short', { maxLength: 256 })).toBe('short');
    });
  });
});

describe('generateCacheKey', () => {
  it('should generate consistent keys', () => {
    const key1 = generateCacheKey('Albert Einstein');
    const key2 = generateCacheKey('Albert Einstein');
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different terms', () => {
    const key1 = generateCacheKey('Albert Einstein');
    const key2 = generateCacheKey('Isaac Newton');
    expect(key1).not.toBe(key2);
  });

  it('should normalize before hashing', () => {
    const key1 = generateCacheKey('ALBERT EINSTEIN');
    const key2 = generateCacheKey('albert einstein');
    expect(key1).toBe(key2);
  });

  it('should start with emb: prefix', () => {
    const key = generateCacheKey('test');
    expect(key.startsWith('emb:')).toBe(true);
  });
});

describe('hashString', () => {
  it('should return bigint', () => {
    const hash = hashString('test');
    expect(typeof hash).toBe('bigint');
  });

  it('should be deterministic', () => {
    const hash1 = hashString('test');
    const hash2 = hashString('test');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = hashString('hello');
    const hash2 = hashString('world');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', () => {
    const hash = hashString('');
    expect(typeof hash).toBe('bigint');
  });

  it('should handle unicode', () => {
    const hash = hashString('\u00E9\u00E0\u00FC');
    expect(typeof hash).toBe('bigint');
  });
});

describe('generateBloomHashes', () => {
  it('should return array of numbers', () => {
    const hashes = generateBloomHashes('test', 5, 1000);
    expect(Array.isArray(hashes)).toBe(true);
    expect(hashes.length).toBe(5);
    hashes.forEach(h => expect(typeof h).toBe('number'));
  });

  it('should generate values within size bounds', () => {
    const size = 1000;
    const hashes = generateBloomHashes('test', 10, size);
    hashes.forEach(h => {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(size);
    });
  });

  it('should be deterministic', () => {
    const hashes1 = generateBloomHashes('test', 5, 1000);
    const hashes2 = generateBloomHashes('test', 5, 1000);
    expect(hashes1).toEqual(hashes2);
  });

  it('should produce different positions for different inputs', () => {
    const hashes1 = generateBloomHashes('hello', 5, 1000);
    const hashes2 = generateBloomHashes('world', 5, 1000);
    expect(hashes1).not.toEqual(hashes2);
  });
});

describe('generateVariants', () => {
  it('should include base normalized form', () => {
    const variants = generateVariants('Albert Einstein');
    expect(variants).toContain('albert einstein');
  });

  it('should include stemmed form', () => {
    const variants = generateVariants('running fast');
    expect(variants.some(v => v !== 'running fast')).toBe(true);
  });

  it('should include individual words for multi-word terms', () => {
    const variants = generateVariants('Albert Einstein');
    expect(variants).toContain('albert');
    expect(variants).toContain('einstein');
  });

  it('should not include very short words', () => {
    const variants = generateVariants('I am here');
    // 'i' and 'am' are too short (< 3 chars)
    variants.forEach(v => {
      if (v !== 'i am here' && !v.includes(' ')) {
        expect(v.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  it('should return unique values', () => {
    const variants = generateVariants('test test test');
    const unique = new Set(variants);
    expect(variants.length).toBe(unique.size);
  });
});

describe('termsMatch', () => {
  it('should match identical terms', () => {
    expect(termsMatch('test', 'test')).toBe(true);
  });

  it('should match after normalization', () => {
    expect(termsMatch('HELLO', 'hello')).toBe(true);
    expect(termsMatch('  test  ', 'test')).toBe(true);
  });

  it('should not match different terms without fuzzy', () => {
    expect(termsMatch('hello', 'world')).toBe(false);
  });

  it('should match with fuzzy for variants', () => {
    // 'running' and 'run' should match with stemming
    expect(termsMatch('running', 'runn', true)).toBe(true);
  });

  it('should match abbreviations with fuzzy', () => {
    expect(termsMatch('usa', 'united states of america', true)).toBe(true);
  });
});

describe('levenshteinDistance', () => {
  it('should return 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('should handle empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('hello', '')).toBe(5);
    expect(levenshteinDistance('', 'hello')).toBe(5);
  });

  it('should count single character edits', () => {
    expect(levenshteinDistance('cat', 'bat')).toBe(1); // substitution
    expect(levenshteinDistance('cat', 'cats')).toBe(1); // insertion
    expect(levenshteinDistance('cats', 'cat')).toBe(1); // deletion
  });

  it('should compute correct distance for complex cases', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
  });

  it('should be symmetric', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(levenshteinDistance('xyz', 'abc'));
  });
});

describe('termSimilarity', () => {
  it('should return 1.0 for identical terms', () => {
    expect(termSimilarity('hello', 'hello')).toBe(1.0);
  });

  it('should return 1.0 for terms that normalize to same', () => {
    expect(termSimilarity('HELLO', 'hello')).toBe(1.0);
  });

  it('should return 0 for completely different terms', () => {
    expect(termSimilarity('aaa', 'zzz')).toBe(0);
  });

  it('should return value between 0 and 1', () => {
    const sim = termSimilarity('hello', 'hallo');
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it('should handle empty strings', () => {
    expect(termSimilarity('', '')).toBe(1.0);
  });

  it('should give higher similarity for more similar strings', () => {
    const sim1 = termSimilarity('hello', 'helo');  // 1 deletion
    const sim2 = termSimilarity('hello', 'hiiii'); // multiple changes
    expect(sim1).toBeGreaterThan(sim2);
  });
});

describe('normalizeTermsBatch', () => {
  it('should normalize multiple terms', () => {
    const terms = ['HELLO', 'World', '  test  '];
    const result = normalizeTermsBatch(terms);

    expect(result.get('HELLO')).toBe('hello');
    expect(result.get('World')).toBe('world');
    expect(result.get('  test  ')).toBe('test');
  });

  it('should return Map with all terms', () => {
    const terms = ['a', 'b', 'c'];
    const result = normalizeTermsBatch(terms);
    expect(result.size).toBe(3);
  });

  it('should apply options to all terms', () => {
    const terms = ['USA', 'UK'];
    const result = normalizeTermsBatch(terms, { expandAbbreviations: true });

    expect(result.get('USA')).toBe('united states of america');
    expect(result.get('UK')).toBe('united kingdom');
  });

  it('should handle empty array', () => {
    const result = normalizeTermsBatch([]);
    expect(result.size).toBe(0);
  });
});

describe('extractTerms', () => {
  it('should extract words from content', () => {
    const terms = extractTerms('Hello World');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
  });

  it('should skip very short words', () => {
    const terms = extractTerms('I am a test');
    expect(terms).not.toContain('i');
    expect(terms).not.toContain('a');
    expect(terms).toContain('am'); // 2 chars is minimum
    expect(terms).toContain('test');
  });

  it('should return unique terms', () => {
    const terms = extractTerms('hello hello hello world world');
    expect(terms.filter(t => t === 'hello').length).toBe(1);
    expect(terms.filter(t => t === 'world').length).toBe(1);
  });

  it('should normalize extracted terms', () => {
    const terms = extractTerms('HELLO World');
    // All terms should be lowercase
    terms.forEach(t => expect(t).toBe(t.toLowerCase()));
  });

  it('should handle punctuation', () => {
    const terms = extractTerms('Hello, world! How are you?');
    expect(terms).toContain('hello');
    expect(terms).toContain('world');
    expect(terms).toContain('how');
    expect(terms).toContain('are');
    expect(terms).toContain('you');
  });

  it('should handle empty content', () => {
    const terms = extractTerms('');
    expect(terms).toEqual([]);
  });

  it('should handle content with only short words', () => {
    const terms = extractTerms('a i o');
    expect(terms).toEqual([]);
  });
});
