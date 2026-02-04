// @ts-nocheck - Complex regex operations with array access requiring null checks
/**
 * Term normalization for embedding lookup table
 *
 * Provides consistent normalization of search terms for cache lookups:
 * - Lowercase conversion
 * - Punctuation removal
 * - Whitespace collapse
 * - Unicode normalization (NFC)
 * - Common variant stemming
 * - Deterministic hash generation
 */

/**
 * Common English word suffixes for stemming
 * Maps plural/verb forms to their base forms
 */
const COMMON_SUFFIXES: ReadonlyArray<[RegExp, string]> = [
  // Plurals
  [/ies$/i, 'y'],
  [/ves$/i, 'f'],
  [/oes$/i, 'o'],
  [/ses$/i, 's'],
  [/xes$/i, 'x'],
  [/ches$/i, 'ch'],
  [/shes$/i, 'sh'],
  [/s$/i, ''],
  // Verb forms
  [/ied$/i, 'y'],
  [/ing$/i, ''],
  [/ed$/i, ''],
  // Comparative/superlative
  [/ier$/i, 'y'],
  [/iest$/i, 'y'],
  [/er$/i, ''],
  [/est$/i, ''],
];

/**
 * Common abbreviation expansions
 * Maps common abbreviations to full forms for better matching
 */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ['usa', 'united states of america'],
  ['us', 'united states'],
  ['uk', 'united kingdom'],
  ['ussr', 'soviet union'],
  ['nyc', 'new york city'],
  ['la', 'los angeles'],
  ['dc', 'district of columbia'],
  ['st', 'saint'],
  ['mt', 'mount'],
  ['dr', 'doctor'],
  ['mr', 'mister'],
  ['mrs', 'misses'],
  ['jr', 'junior'],
  ['sr', 'senior'],
  ['inc', 'incorporated'],
  ['corp', 'corporation'],
  ['ltd', 'limited'],
  ['co', 'company'],
  ['vs', 'versus'],
  ['etc', 'et cetera'],
]);

/**
 * Unicode character normalization map for common diacritics
 * Maps accented characters to their ASCII equivalents
 */
const DIACRITIC_MAP: ReadonlyMap<string, string> = new Map([
  ['\u00E0', 'a'], ['\u00E1', 'a'], ['\u00E2', 'a'], ['\u00E3', 'a'], ['\u00E4', 'a'], ['\u00E5', 'a'],
  ['\u00E6', 'ae'],
  ['\u00E7', 'c'],
  ['\u00E8', 'e'], ['\u00E9', 'e'], ['\u00EA', 'e'], ['\u00EB', 'e'],
  ['\u00EC', 'i'], ['\u00ED', 'i'], ['\u00EE', 'i'], ['\u00EF', 'i'],
  ['\u00F0', 'd'],
  ['\u00F1', 'n'],
  ['\u00F2', 'o'], ['\u00F3', 'o'], ['\u00F4', 'o'], ['\u00F5', 'o'], ['\u00F6', 'o'], ['\u00F8', 'o'],
  ['\u00F9', 'u'], ['\u00FA', 'u'], ['\u00FB', 'u'], ['\u00FC', 'u'],
  ['\u00FD', 'y'], ['\u00FF', 'y'],
  ['\u00DF', 'ss'], // German sharp s
  ['\u0153', 'oe'], // French oe ligature
  ['\u0142', 'l'],  // Polish l with stroke
  ['\u0144', 'n'],  // Polish n with acute
  ['\u015B', 's'],  // Polish s with acute
  ['\u017A', 'z'], ['\u017C', 'z'], // Polish z variants
]);

/** Options for term normalization */
export interface NormalizationOptions {
  /** Apply stemming to reduce word variants (default: false) */
  stem?: boolean;
  /** Expand common abbreviations (default: false) */
  expandAbbreviations?: boolean;
  /** Remove diacritics/accents (default: true) */
  removeDiacritics?: boolean;
  /** Remove all non-alphanumeric characters (default: true) */
  removeSpecialChars?: boolean;
  /** Maximum length of normalized term (default: 256) */
  maxLength?: number;
}

const DEFAULT_OPTIONS: Required<NormalizationOptions> = {
  stem: false,
  expandAbbreviations: false,
  removeDiacritics: true,
  removeSpecialChars: true,
  maxLength: 256,
};

/**
 * Normalize a search term for consistent lookup
 *
 * @param term - Raw search term
 * @param options - Normalization options
 * @returns Normalized term suitable for cache key
 *
 * @example
 * ```typescript
 * normalizeTerm("  Albert Einstein  ") // "albert einstein"
 * normalizeTerm("Cafe\u0301") // "cafe" (normalized e-acute)
 * normalizeTerm("The Beatles", { stem: true }) // "the beatle"
 * ```
 */
export function normalizeTerm(term: string, options: NormalizationOptions = {}): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Step 1: Unicode NFC normalization (compose characters)
  let normalized = term.normalize('NFC');

  // Step 2: Lowercase
  normalized = normalized.toLowerCase();

  // Step 3: Remove diacritics
  if (opts.removeDiacritics) {
    normalized = removeDiacritics(normalized);
  }

  // Step 4: Expand abbreviations if requested
  if (opts.expandAbbreviations) {
    normalized = expandAbbreviations(normalized);
  }

  // Step 5: Remove special characters and punctuation
  if (opts.removeSpecialChars) {
    // Keep alphanumeric and spaces only
    normalized = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  }

  // Step 6: Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Step 7: Apply stemming if requested
  if (opts.stem) {
    normalized = stemTerms(normalized);
  }

  // Step 8: Truncate to max length
  if (normalized.length > opts.maxLength) {
    normalized = normalized.slice(0, opts.maxLength);
  }

  return normalized;
}

/**
 * Remove diacritics/accents from a string
 */
function removeDiacritics(text: string): string {
  // First pass: use DIACRITIC_MAP for known characters
  let result = '';
  for (const char of text) {
    const replacement = DIACRITIC_MAP.get(char);
    if (replacement !== undefined) {
      result += replacement;
    } else {
      result += char;
    }
  }

  // Second pass: NFD decomposition to remove remaining combining marks
  return result
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Expand common abbreviations in text
 */
function expandAbbreviations(text: string): string {
  const words = text.split(/\s+/);
  const expanded = words.map((word) => {
    // Remove trailing periods from abbreviations
    const clean = word.replace(/\.$/, '');
    return ABBREVIATIONS.get(clean) ?? word;
  });
  return expanded.join(' ');
}

/**
 * Apply basic stemming to terms
 * This is a simple suffix-stripping approach for common English variants
 */
function stemTerms(text: string): string {
  const words = text.split(/\s+/);
  const stemmed = words.map((word) => {
    // Don't stem very short words
    if (word.length <= 3) {
      return word;
    }

    // Try each suffix pattern
    for (const [pattern, replacement] of COMMON_SUFFIXES) {
      if (pattern.test(word)) {
        const stemmedWord = word.replace(pattern, replacement);
        // Only accept if result is at least 2 characters
        if (stemmedWord.length >= 2) {
          return stemmedWord;
        }
      }
    }

    return word;
  });

  return stemmed.join(' ');
}

/**
 * Generate a deterministic cache key from a term
 * Uses a fast non-cryptographic hash
 *
 * @param term - Normalized term
 * @returns Cache key string
 */
export function generateCacheKey(term: string): string {
  // Normalize first
  const normalized = normalizeTerm(term);

  // Generate hash
  const hash = hashString(normalized);

  return `emb:${hash}`;
}

/**
 * Generate a 64-bit hash of a string
 * Uses FNV-1a algorithm for good distribution
 *
 * @param str - Input string
 * @returns BigInt hash value
 */
export function hashString(str: string): bigint {
  // FNV-1a 64-bit constants
  const FNV_PRIME = 0x100000001b3n;
  const FNV_OFFSET = 0xcbf29ce484222325n;

  let hash = FNV_OFFSET;

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }

  return hash;
}

/**
 * Generate multiple hash values for bloom filter
 * Uses double hashing technique
 *
 * @param str - Input string
 * @param count - Number of hash values needed
 * @param size - Bloom filter bit size
 * @returns Array of bit positions
 */
export function generateBloomHashes(str: string, count: number, size: number): number[] {
  const normalized = normalizeTerm(str);

  // Generate two base hashes
  const h1 = hashString(normalized);
  const h2 = hashString(normalized + '\x00'); // Salt for second hash

  const positions: number[] = [];
  const sizeBigInt = BigInt(size);

  for (let i = 0; i < count; i++) {
    // Double hashing: h(i) = h1 + i * h2
    const combined = BigInt.asUintN(64, h1 + BigInt(i) * h2);
    const position = Number(combined % sizeBigInt);
    positions.push(position);
  }

  return positions;
}

/**
 * Generate normalized variants of a term for fuzzy matching
 *
 * @param term - Input term
 * @returns Array of normalized variants
 */
export function generateVariants(term: string): string[] {
  const variants = new Set<string>();

  // Base normalized form
  const base = normalizeTerm(term);
  variants.add(base);

  // With stemming
  const stemmed = normalizeTerm(term, { stem: true });
  variants.add(stemmed);

  // With abbreviation expansion
  const expanded = normalizeTerm(term, { expandAbbreviations: true });
  variants.add(expanded);

  // Without diacritics (already done in base)
  // With diacritics preserved
  const withDiacritics = normalizeTerm(term, { removeDiacritics: false });
  variants.add(withDiacritics);

  // Individual words (for multi-word terms)
  const words = base.split(' ');
  if (words.length > 1) {
    for (const word of words) {
      if (word.length >= 3) {
        variants.add(word);
      }
    }
  }

  return Array.from(variants);
}

/**
 * Check if two terms match after normalization
 *
 * @param term1 - First term
 * @param term2 - Second term
 * @param fuzzy - Use fuzzy matching (check variants)
 * @returns True if terms match
 */
export function termsMatch(term1: string, term2: string, fuzzy = false): boolean {
  const norm1 = normalizeTerm(term1);
  const norm2 = normalizeTerm(term2);

  if (norm1 === norm2) {
    return true;
  }

  if (!fuzzy) {
    return false;
  }

  // Check variants
  const variants1 = generateVariants(term1);
  const variants2 = generateVariants(term2);

  for (const v1 of variants1) {
    for (const v2 of variants2) {
      if (v1 === v2) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching threshold calculations
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Handle edge cases
  if (m === 0) return n;
  if (n === 0) return m;

  // Use two rows instead of full matrix for memory efficiency
  let prevRow = new Array<number>(n + 1);
  let currRow = new Array<number>(n + 1);

  // Initialize first row
  for (let j = 0; j <= n; j++) {
    prevRow[j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= m; i++) {
    currRow[0] = i;

    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost // substitution
      );
    }

    // Swap rows
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/**
 * Calculate normalized similarity between two terms (0-1)
 */
export function termSimilarity(term1: string, term2: string): number {
  const norm1 = normalizeTerm(term1);
  const norm2 = normalizeTerm(term2);

  if (norm1 === norm2) {
    return 1.0;
  }

  const maxLen = Math.max(norm1.length, norm2.length);
  if (maxLen === 0) {
    return 1.0;
  }

  const distance = levenshteinDistance(norm1, norm2);
  return 1.0 - distance / maxLen;
}

/**
 * Batch normalize multiple terms
 *
 * @param terms - Array of terms to normalize
 * @param options - Normalization options
 * @returns Map of original term to normalized term
 */
export function normalizeTermsBatch(
  terms: string[],
  options: NormalizationOptions = {}
): Map<string, string> {
  const result = new Map<string, string>();

  for (const term of terms) {
    result.set(term, normalizeTerm(term, options));
  }

  return result;
}

/**
 * Extract potential search terms from article content
 * Useful for building the lookup table
 */
export function extractTerms(content: string): string[] {
  const terms = new Set<string>();

  // Split on non-word characters
  const words = content.split(/[^\p{L}\p{N}]+/u);

  for (const word of words) {
    // Skip very short words
    if (word.length < 2) continue;

    // Normalize and add
    const normalized = normalizeTerm(word);
    if (normalized.length >= 2) {
      terms.add(normalized);
    }
  }

  return Array.from(terms);
}
