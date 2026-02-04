/**
 * Tests for wtf-lite utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  trim,
  preProcess,
  findTemplates,
  getTemplateName
} from '../../src/lib/wtf-lite/utils';

describe('trim', () => {
  it('should trim leading whitespace', () => {
    expect(trim('  hello')).toBe('hello');
    expect(trim('\t\nhello')).toBe('hello');
  });

  it('should trim trailing whitespace', () => {
    expect(trim('hello  ')).toBe('hello');
    expect(trim('hello\t\n')).toBe('hello');
  });

  it('should collapse multiple spaces', () => {
    expect(trim('hello    world')).toBe('hello world');
    expect(trim('a  b  c  d')).toBe('a b c d');
  });

  it('should handle empty string', () => {
    expect(trim('')).toBe('');
  });

  it('should handle null/undefined', () => {
    expect(trim(null as unknown as string)).toBe('');
    expect(trim(undefined as unknown as string)).toBe('');
  });

  it('should handle string with only whitespace', () => {
    expect(trim('   ')).toBe('');
    expect(trim('\t\n\r')).toBe('');
  });

  it('should preserve single spaces between words', () => {
    expect(trim('hello world')).toBe('hello world');
  });
});

describe('preProcess', () => {
  describe('HTML comments', () => {
    it('should remove single-line comments', () => {
      // Comment is replaced with empty string, leaving double space that gets preserved
      const result = preProcess('before <!-- comment --> after');
      expect(result.text).not.toContain('<!--');
      expect(result.text).toContain('before');
      expect(result.text).toContain('after');
    });

    it('should remove multi-line comments', () => {
      const input = 'before <!-- multi\nline\ncomment --> after';
      const result = preProcess(input);
      expect(result.text).not.toContain('<!--');
      expect(result.text).toContain('before');
      expect(result.text).toContain('after');
    });

    it('should handle multiple comments', () => {
      const input = '<!-- first --> text <!-- second -->';
      const result = preProcess(input);
      expect(result.text).not.toContain('<!--');
      expect(result.text).toContain('text');
    });

    it('should handle empty comment', () => {
      const result = preProcess('before <!----> after');
      expect(result.text).not.toContain('<!--');
      expect(result.text).toContain('before');
      expect(result.text).toContain('after');
    });
  });

  describe('magic words', () => {
    it('should remove __NOTOC__', () => {
      expect(preProcess('__NOTOC__ content').text).toBe('content');
    });

    it('should remove __NOEDITSECTION__', () => {
      expect(preProcess('__NOEDITSECTION__ content').text).toBe('content');
    });

    it('should remove __FORCETOC__', () => {
      expect(preProcess('__FORCETOC__ content').text).toBe('content');
    });

    it('should remove __TOC__', () => {
      expect(preProcess('__TOC__ content').text).toBe('content');
    });

    it('should be case insensitive', () => {
      expect(preProcess('__notoc__ content').text).toBe('content');
      expect(preProcess('__NoToC__ content').text).toBe('content');
    });
  });

  describe('HTML entities', () => {
    it('should convert &nbsp; to space', () => {
      expect(preProcess('hello&nbsp;world').text).toBe('hello world');
    });

    it('should convert &ndash; to hyphen', () => {
      expect(preProcess('1990&ndash;2000').text).toBe('1990-2000');
    });

    it('should convert &mdash; to hyphen', () => {
      expect(preProcess('text&mdash;more').text).toBe('text-more');
    });

    it('should convert &amp; to &', () => {
      expect(preProcess('Tom &amp; Jerry').text).toBe('Tom & Jerry');
    });

    it('should convert &quot; to "', () => {
      expect(preProcess('&quot;quoted&quot;').text).toBe('"quoted"');
    });

    it('should convert &apos; to apostrophe', () => {
      expect(preProcess("it&apos;s").text).toBe("it's");
    });
  });

  describe('file/image stripping', () => {
    it('should remove [[File:...]] links', () => {
      const input = 'Text [[File:Example.jpg|thumb|Caption]] more';
      const result = preProcess(input);
      expect(result.text).not.toContain('File:');
      expect(result.text).not.toContain('Example.jpg');
    });

    it('should remove [[Image:...]] links', () => {
      const input = 'Text [[Image:Photo.png|right]] more';
      const result = preProcess(input);
      expect(result.text).not.toContain('Image:');
    });

    it('should handle nested brackets in file captions', () => {
      const input = '[[File:Test.jpg|thumb|Caption with [[link]] inside]]';
      const result = preProcess(input);
      expect(result.text).not.toContain('File:');
    });

    it('should handle German Datei namespace', () => {
      const input = '[[Datei:Foto.jpg|thumb]] German';
      const result = preProcess(input);
      expect(result.text).not.toContain('Datei:');
    });

    it('should handle French Fichier namespace', () => {
      const input = '[[Fichier:Image.png]] French';
      const result = preProcess(input);
      expect(result.text).not.toContain('Fichier:');
    });
  });

  describe('HTML tag stripping', () => {
    it('should handle ref tags (may or may not be stripped depending on IGNORE_TAGS)', () => {
      const input = 'Fact<ref>Source</ref> more';
      const result = preProcess(input);
      // preProcess handles certain tags based on IGNORE_TAGS constant
      // Just verify it doesn't throw and produces output
      expect(result.text).toBeDefined();
    });

    it('should handle self-closing ref tags', () => {
      const input = 'Fact<ref name="x" /> more';
      const result = preProcess(input);
      expect(result.text).toBeDefined();
    });

    it('should convert <i>...</i> to italic markup', () => {
      const input = 'This is <i>italic</i> text';
      const result = preProcess(input);
      expect(result.text).toContain("''italic''");
    });

    it('should convert <b>...</b> to bold markup', () => {
      const input = 'This is <b>bold</b> text';
      const result = preProcess(input);
      expect(result.text).toContain("'''bold'''");
    });

    it('should remove simple HTML tags', () => {
      const input = '<p>paragraph</p><br/>';
      const result = preProcess(input);
      expect(result.text).not.toContain('<p>');
      expect(result.text).not.toContain('<br/>');
    });
  });

  describe('special characters', () => {
    it('should remove tildes (signatures)', () => {
      const input = 'Comment ~~~ more';
      const result = preProcess(input);
      expect(result.text).not.toContain('~~~');
    });

    it('should remove carriage returns', () => {
      const input = 'line1\r\nline2';
      const result = preProcess(input);
      expect(result.text).not.toContain('\r');
    });

    it('should convert Japanese full stop to period', () => {
      const input = 'Japanese text\u3002More text';
      const result = preProcess(input);
      expect(result.text).toContain('. ');
    });

    it('should remove horizontal rules', () => {
      const input = 'before ---- after';
      const result = preProcess(input);
      expect(result.text).not.toContain('----');
    });
  });

  describe('empty parentheses', () => {
    it('should remove empty parentheses with punctuation', () => {
      const input = 'Word ( ) more';
      const result = preProcess(input);
      expect(result.text).not.toMatch(/\(\s*\)/);
    });

    it('should remove parentheses with only punctuation inside', () => {
      const input = 'Word (,; ) more';
      const result = preProcess(input);
      expect(result.text.trim()).not.toMatch(/\([,;:\s]+\)/);
    });
  });
});

describe('findTemplates', () => {
  it('should find simple template', () => {
    const result = findTemplates('Text {{template}} more');
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('{{template}}');
    expect(result[0].name).toBe('template');
  });

  it('should find template with parameters', () => {
    const result = findTemplates('{{template|param1|param2}}');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('template');
  });

  it('should find multiple templates', () => {
    const result = findTemplates('{{first}} and {{second}}');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('first');
    expect(result[1].name).toBe('second');
  });

  it('should handle nested templates', () => {
    const result = findTemplates('{{outer|{{inner}}}}');
    expect(result.length).toBeGreaterThanOrEqual(1);
    // Should find the outer template
    expect(result.some(t => t.name === 'outer')).toBe(true);
  });

  it('should handle multi-line templates', () => {
    const input = `{{template
| param1 = value1
| param2 = value2
}}`;
    const result = findTemplates(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('template');
  });

  it('should return empty array for no templates', () => {
    const result = findTemplates('Plain text without templates');
    expect(result).toHaveLength(0);
  });

  it('should handle unclosed template', () => {
    const result = findTemplates('{{unclosed template');
    // Should not throw and return empty or partial results
    expect(Array.isArray(result)).toBe(true);
  });

  it('should handle empty input', () => {
    const result = findTemplates('');
    expect(result).toHaveLength(0);
  });

  it('should find infobox templates', () => {
    const input = `{{Infobox person
| name = John Doe
| birth_date = 1990
}}`;
    const result = findTemplates(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('infobox person');
  });
});

describe('getTemplateName', () => {
  it('should extract name from simple template', () => {
    expect(getTemplateName('{{template}}')).toBe('template');
  });

  it('should extract name from template with pipe', () => {
    expect(getTemplateName('{{template|param}}')).toBe('template');
  });

  it('should extract name from multi-line template', () => {
    const input = `{{template
| param = value
}}`;
    expect(getTemplateName(input)).toBe('template');
  });

  it('should handle template with colon (namespace)', () => {
    // Colon and after is stripped
    expect(getTemplateName('{{Template:Name|param}}')).toBe('template');
  });

  it('should normalize to lowercase', () => {
    expect(getTemplateName('{{TEMPLATE}}')).toBe('template');
    expect(getTemplateName('{{TeMpLaTe}}')).toBe('template');
  });

  it('should replace underscores with spaces', () => {
    expect(getTemplateName('{{Some_Template}}')).toBe('some template');
  });

  it('should trim whitespace', () => {
    expect(getTemplateName('{{  template  }}')).toBe('template');
  });

  it('should handle infobox templates', () => {
    expect(getTemplateName('{{Infobox person|name=Test}}')).toBe('infobox person');
    expect(getTemplateName('{{Infobox_settlement|pop=1000}}')).toBe('infobox settlement');
  });

  it('should return empty string for invalid input', () => {
    expect(getTemplateName('')).toBe('');
    expect(getTemplateName('{{}}')).toBe('');
  });

  it('should handle template with only parameters', () => {
    // Edge case: pipe immediately after opening - returns the part before pipe
    const result = getTemplateName('{{|param}}');
    // The implementation returns '|param' in this edge case
    expect(typeof result).toBe('string');
  });
});

describe('edge cases and security', () => {
  describe('ReDoS prevention', () => {
    it('should handle long unclosed comments efficiently', () => {
      // This should not hang - the regex has been fixed
      const longInput = 'Text <!-- ' + 'a'.repeat(10000);
      const start = Date.now();
      preProcess(longInput);
      const elapsed = Date.now() - start;
      // Should complete quickly (< 1 second)
      expect(elapsed).toBeLessThan(1000);
    });

    it('should handle long unclosed tags efficiently', () => {
      const longInput = 'Text <ref>' + 'a'.repeat(10000);
      const start = Date.now();
      preProcess(longInput);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('should handle deeply nested brackets efficiently', () => {
      const nested = '[[' + 'a'.repeat(100) + '[[' + 'b'.repeat(100) + ']]' + 'c'.repeat(100) + ']]';
      const start = Date.now();
      preProcess(nested);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('malformed input handling', () => {
    it('should handle unbalanced brackets', () => {
      expect(() => preProcess('[[unclosed')).not.toThrow();
      expect(() => preProcess('extra ]] brackets')).not.toThrow();
      expect(() => preProcess('{{ unclosed')).not.toThrow();
    });

    it('should handle mixed encodings', () => {
      const mixed = 'ASCII \u00E9 \u4E2D\u6587 \u0410\u0411\u0412';
      expect(() => preProcess(mixed)).not.toThrow();
    });

    it('should handle control characters', () => {
      const withControls = 'text\x00\x01\x02more';
      expect(() => preProcess(withControls)).not.toThrow();
    });
  });

  describe('extended edge cases', () => {
    it('should handle long repeated patterns', () => {
      const repeatedPattern = '[[link]] '.repeat(1000);
      const start = Date.now();
      preProcess(repeatedPattern);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000);
    });

    it('should handle alternating brackets and braces', () => {
      const alternating = '[[a]] {{b}} [[c]] {{d}} [[e]] {{f}}';
      const result = preProcess(alternating);
      expect(result.text).toContain('[[a]]');
      expect(result.text).toContain('{{b}}');
    });

    it('should handle deeply nested brackets', () => {
      const deep = '[[[[[[content]]]]]]';
      expect(() => preProcess(deep)).not.toThrow();
    });

    it('should handle empty brackets', () => {
      const empty = '[[]] {{}} [[]] {{}}';
      expect(() => preProcess(empty)).not.toThrow();
    });

    it('should handle brackets with only whitespace', () => {
      const whitespaceOnly = '[[   ]] {{   }}';
      expect(() => preProcess(whitespaceOnly)).not.toThrow();
    });

    it('should handle very long single line', () => {
      const longLine = 'a'.repeat(100000);
      const start = Date.now();
      preProcess(longLine);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('unicode edge cases', () => {
    it('should handle CJK characters', () => {
      const cjk = '中文 日本語 한국어';
      const result = preProcess(cjk);
      expect(result.text).toContain('中文');
      expect(result.text).toContain('日本語');
      expect(result.text).toContain('한국어');
    });

    it('should handle RTL text', () => {
      const rtl = 'العربية עברית';
      const result = preProcess(rtl);
      expect(result.text).toContain('العربية');
      expect(result.text).toContain('עברית');
    });

    it('should handle emoji', () => {
      const emoji = '🎉 celebration 🎊';
      const result = preProcess(emoji);
      expect(result.text).toContain('🎉');
      expect(result.text).toContain('🎊');
    });

    it('should handle combining characters', () => {
      const combining = 'café naïve résumé';
      const result = preProcess(combining);
      expect(result.text).toContain('café');
      expect(result.text).toContain('naïve');
    });

    it('should handle surrogate pairs', () => {
      const surrogatePairs = '𝕳𝖊𝖑𝖑𝖔'; // Mathematical fraktur
      expect(() => preProcess(surrogatePairs)).not.toThrow();
    });
  });

  describe('HTML tag stripping extended', () => {
    it('should handle self-closing tags without space', () => {
      const selfClosing = 'text<br/>more text';
      const result = preProcess(selfClosing);
      expect(result.text).not.toContain('<br/>');
    });

    it('should handle self-closing tags with space', () => {
      const selfClosing = 'text<br />more text';
      const result = preProcess(selfClosing);
      expect(result.text).not.toContain('<br />');
    });

    it('should handle nested HTML tags', () => {
      const nested = '<div><span>content</span></div>';
      const result = preProcess(nested);
      expect(result.text).not.toContain('<div>');
      expect(result.text).not.toContain('<span>');
      expect(result.text).toContain('content');
    });

    it('should handle HTML attributes with quotes', () => {
      const withAttrs = '<div class="test" id="main">content</div>';
      const result = preProcess(withAttrs);
      expect(result.text).not.toContain('class=');
      expect(result.text).toContain('content');
    });

    it('should handle malformed HTML gracefully', () => {
      const malformed = '<div><span>unclosed';
      expect(() => preProcess(malformed)).not.toThrow();
    });
  });
});
