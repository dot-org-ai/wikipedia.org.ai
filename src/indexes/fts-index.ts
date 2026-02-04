/**
 * Full-Text Search Index for Wikipedia Articles
 *
 * Provides BM25-scored full-text search with weighted fields:
 * - title: weight 2.0
 * - description (summary): weight 1.5
 * - content (plaintext): weight 1.0
 *
 * Based on ParqueDB's FTS implementation.
 */

import type { ArticleRecord, ArticleType } from '../storage/types.js';
import { DEFAULT_RESULTS_LIMIT } from '../lib/constants.js';

// =============================================================================
// Types
// =============================================================================

/** Token extracted from text */
export interface Token {
  /** Original term before normalization */
  original: string;
  /** Normalized/stemmed term */
  term: string;
  /** Position in the text (0-based) */
  position: number;
}

/** Posting in inverted index */
export interface Posting {
  /** Document ID */
  docId: string;
  /** Field the term came from */
  field: string;
  /** Field weight for scoring */
  fieldWeight: number;
  /** Term frequency in this document/field */
  frequency: number;
  /** Positions of the term */
  positions: number[];
}

/** Document stats for scoring */
export interface DocumentStats {
  /** Document ID */
  docId: string;
  /** Field lengths (field -> word count) */
  fieldLengths: Map<string, number>;
  /** Total weighted word count */
  totalLength: number;
  /** Article title for result display */
  title: string;
  /** Article type */
  type: ArticleType;
}

/** Corpus statistics for BM25 */
export interface CorpusStats {
  /** Total number of documents */
  documentCount: number;
  /** Average document length (weighted) */
  avgDocLength: number;
  /** Document frequency for each term (term -> doc count) */
  documentFrequency: Map<string, number>;
}

/** FTS search result */
export interface FTSSearchResult {
  /** Document ID */
  docId: string;
  /** Article title */
  title: string;
  /** Article type */
  type: ArticleType;
  /** BM25 score */
  score: number;
  /** Matched terms */
  matchedTerms: string[];
}

/** FTS search options */
export interface FTSSearchOptions {
  /** Maximum results to return (default: 20) */
  limit?: number;
  /** Minimum score threshold (default: 0) */
  minScore?: number;
  /** Filter by article types */
  types?: ArticleType[];
}

/** BM25 configuration */
export interface BM25Config {
  /** Term frequency saturation (default: 1.2) */
  k1: number;
  /** Document length normalization (default: 0.75) */
  b: number;
}

/** Field weight configuration */
export interface FieldWeights {
  title: number;
  description: number;
  content: number;
}

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
};

const DEFAULT_FIELD_WEIGHTS: FieldWeights = {
  title: 2.0,
  description: 1.5,
  content: 1.0,
};

const MIN_WORD_LENGTH = 2;
const MAX_WORD_LENGTH = 50;

// =============================================================================
// English Stopwords
// =============================================================================

const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for',
  'if', 'in', 'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or',
  'such', 'that', 'the', 'their', 'then', 'there', 'these', 'they',
  'this', 'to', 'was', 'will', 'with', 'would', 'could', 'should',
  'have', 'has', 'had', 'do', 'does', 'did', 'i', 'you', 'he', 'she',
  'we', 'what', 'which', 'who', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'any', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'can', 'just', 'also', 'now', 'here', 'about', 'after', 'before',
  'between', 'during', 'from', 'through', 'under', 'above', 'below',
  'up', 'down', 'out', 'off', 'over', 'again', 'further', 'once',
  'am', 'been', 'being', 'were', 'its', 'your', 'him', 'her', 'my',
  'me', 'our', 'us', 'them', 'his', 'hers', 'ours', 'theirs', 'yours',
]);

// =============================================================================
// Tokenizer
// =============================================================================

/**
 * Tokenize text into normalized terms
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const wordRegex = /[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+/g;

  let match: RegExpExecArray | null;
  let position = 0;

  while ((match = wordRegex.exec(text)) !== null) {
    const original = match[0];

    // Skip if too short or too long
    if (original.length < MIN_WORD_LENGTH || original.length > MAX_WORD_LENGTH) {
      continue;
    }

    // Lowercase
    let term = original.toLowerCase();

    // Skip stopwords
    if (ENGLISH_STOPWORDS.has(term)) {
      position++;
      continue;
    }

    // Apply Porter stemming
    term = porterStem(term);

    tokens.push({
      original,
      term,
      position,
    });

    position++;
  }

  return tokens;
}

/**
 * Tokenize for search query (less aggressive - don't filter stopwords)
 */
function tokenizeQuery(query: string): string[] {
  const terms: string[] = [];
  const wordRegex = /[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF]+/g;

  let match: RegExpExecArray | null;

  while ((match = wordRegex.exec(query)) !== null) {
    const word = match[0];

    if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) {
      continue;
    }

    let term = word.toLowerCase();
    term = porterStem(term);
    terms.push(term);
  }

  return terms;
}

// =============================================================================
// Porter Stemmer (Simplified)
// =============================================================================

/**
 * Simplified Porter stemmer for English
 */
function porterStem(word: string): string {
  if (word.length <= 2) {
    return word;
  }

  let stem = word;

  // Step 1a: SSES -> SS, IES -> I, SS -> SS, S ->
  if (stem.endsWith('sses')) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith('ies')) {
    stem = stem.slice(0, -2);
  } else if (!stem.endsWith('ss') && stem.endsWith('s')) {
    stem = stem.slice(0, -1);
  }

  // Step 1b: EED -> EE, ED ->, ING ->
  if (stem.endsWith('eed')) {
    if (measureConsonants(stem.slice(0, -3)) > 0) {
      stem = stem.slice(0, -1);
    }
  } else if (stem.endsWith('ed')) {
    const prefix = stem.slice(0, -2);
    if (hasVowel(prefix)) {
      stem = prefix;
      stem = step1bPostProcess(stem);
    }
  } else if (stem.endsWith('ing')) {
    const prefix = stem.slice(0, -3);
    if (hasVowel(prefix)) {
      stem = prefix;
      stem = step1bPostProcess(stem);
    }
  }

  // Step 1c: Y -> I
  if (stem.endsWith('y')) {
    const prefix = stem.slice(0, -1);
    if (hasVowel(prefix)) {
      stem = prefix + 'i';
    }
  }

  return stem;
}

function step1bPostProcess(stem: string): string {
  if (stem.endsWith('at') || stem.endsWith('bl') || stem.endsWith('iz')) {
    return stem + 'e';
  }

  if (stem.length >= 2) {
    const last = stem[stem.length - 1];
    const secondLast = stem[stem.length - 2];
    if (last === secondLast && isConsonant(stem, stem.length - 1)) {
      if (last && !['l', 's', 'z'].includes(last)) {
        return stem.slice(0, -1);
      }
    }
  }

  if (endsWithCVC(stem) && measureConsonants(stem) === 1) {
    return stem + 'e';
  }

  return stem;
}

function isVowel(word: string, index: number): boolean {
  const c = word[index];
  if (!c) return false;
  if ('aeiou'.includes(c)) return true;
  if (c === 'y' && index > 0 && !isVowel(word, index - 1)) return true;
  return false;
}

function isConsonant(word: string, index: number): boolean {
  return !isVowel(word, index);
}

function hasVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (isVowel(word, i)) return true;
  }
  return false;
}

function measureConsonants(word: string): number {
  let m = 0;
  let i = 0;

  while (i < word.length && isConsonant(word, i)) i++;

  while (i < word.length) {
    while (i < word.length && isVowel(word, i)) i++;
    if (i >= word.length) break;

    while (i < word.length && isConsonant(word, i)) i++;
    m++;
  }

  return m;
}

function endsWithCVC(word: string): boolean {
  const len = word.length;
  if (len < 3) return false;

  if (
    isConsonant(word, len - 3) &&
    isVowel(word, len - 2) &&
    isConsonant(word, len - 1)
  ) {
    const lastChar = word[len - 1];
    return lastChar !== undefined && !['w', 'x', 'y'].includes(lastChar);
  }

  return false;
}

// =============================================================================
// BM25 Scorer
// =============================================================================

/**
 * BM25 scorer for document ranking
 */
class BM25Scorer {
  private readonly config: BM25Config;

  constructor(config: Partial<BM25Config> = {}) {
    this.config = { ...DEFAULT_BM25_CONFIG, ...config };
  }

  /**
   * Calculate IDF (Inverse Document Frequency) for a term
   */
  idf(documentFrequency: number, totalDocuments: number): number {
    const n = totalDocuments;
    const df = documentFrequency;
    const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
    return Math.max(0, idf);
  }

  /**
   * Calculate BM25 score for a single term in a document
   */
  termScore(
    termFrequency: number,
    documentLength: number,
    avgDocLength: number,
    idf: number,
    fieldWeight: number = 1.0
  ): number {
    const { k1, b } = this.config;
    const tf = termFrequency;

    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (documentLength / avgDocLength));

    return idf * (numerator / denominator) * fieldWeight;
  }

  /**
   * Score documents for a query
   */
  scoreQuery(
    queryTerms: string[],
    getPostings: (term: string) => Posting[],
    getDocStats: (docId: string) => DocumentStats | null,
    corpusStats: CorpusStats
  ): Array<{ docId: string; score: number; matchedTerms: string[]; title: string; type: ArticleType }> {
    // Pre-compute IDFs for query terms
    const termIdfs = new Map<string, number>();
    for (const term of queryTerms) {
      const df = corpusStats.documentFrequency.get(term) ?? 0;
      termIdfs.set(term, this.idf(df, corpusStats.documentCount));
    }

    // Aggregate postings by document
    const docScores = new Map<
      string,
      { termFreqs: Map<string, { freq: number; weight: number }>; matchedTerms: Set<string> }
    >();

    for (const term of queryTerms) {
      const postings = getPostings(term);
      const idf = termIdfs.get(term) ?? 0;

      if (idf === 0) continue;

      for (const posting of postings) {
        let docData = docScores.get(posting.docId);
        if (!docData) {
          docData = { termFreqs: new Map(), matchedTerms: new Set() };
          docScores.set(posting.docId, docData);
        }

        // Aggregate term frequency with field weight
        const existing = docData.termFreqs.get(term);
        if (existing) {
          // Take the max weight if term appears in multiple fields
          existing.freq += posting.frequency;
          existing.weight = Math.max(existing.weight, posting.fieldWeight);
        } else {
          docData.termFreqs.set(term, { freq: posting.frequency, weight: posting.fieldWeight });
        }
        docData.matchedTerms.add(term);
      }
    }

    // Calculate final scores
    const results: Array<{ docId: string; score: number; matchedTerms: string[]; title: string; type: ArticleType }> = [];

    for (const [docId, { termFreqs, matchedTerms }] of docScores) {
      const docStats = getDocStats(docId);
      if (!docStats) continue;

      let score = 0;

      for (const [term, { freq, weight }] of termFreqs) {
        const idf = termIdfs.get(term) ?? 0;
        score += this.termScore(
          freq,
          docStats.totalLength,
          corpusStats.avgDocLength,
          idf,
          weight
        );
      }

      results.push({
        docId,
        score,
        matchedTerms: Array.from(matchedTerms),
        title: docStats.title,
        type: docStats.type,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }
}

// =============================================================================
// FTS Index
// =============================================================================

/**
 * Full-text search index for Wikipedia articles
 *
 * Creates an inverted index on article content with weighted fields:
 * - title (2.0): Most important for matching
 * - description/summary (1.5): Second most important
 * - content/plaintext (1.0): Full article text
 */
export class WikipediaFTSIndex {
  /** Term -> Postings map */
  private readonly index: Map<string, Posting[]> = new Map();
  /** Document stats for scoring */
  private readonly docStats: Map<string, DocumentStats> = new Map();
  /** Corpus statistics */
  private corpusStats: CorpusStats = {
    documentCount: 0,
    avgDocLength: 0,
    documentFrequency: new Map(),
  };
  /** BM25 scorer */
  private readonly scorer: BM25Scorer;
  /** Field weights */
  private readonly fieldWeights: FieldWeights;

  constructor(
    fieldWeights: Partial<FieldWeights> = {},
    bm25Config: Partial<BM25Config> = {}
  ) {
    this.fieldWeights = { ...DEFAULT_FIELD_WEIGHTS, ...fieldWeights };
    this.scorer = new BM25Scorer(bm25Config);
  }

  // ===========================================================================
  // Indexing Operations
  // ===========================================================================

  /**
   * Add an article to the index
   */
  addDocument(article: ArticleRecord): void {
    const docId = article.$id;
    const fieldLengths = new Map<string, number>();
    let totalLength = 0;

    // Track terms we've already counted for DF in this document
    const termsInDoc = new Set<string>();

    // Index title field (weight: 2.0)
    const titleTokens = tokenize(article.title);
    fieldLengths.set('title', titleTokens.length);
    totalLength += titleTokens.length * this.fieldWeights.title;
    this.indexField(docId, 'title', titleTokens, this.fieldWeights.title, termsInDoc);

    // Index description field (weight: 1.5)
    const descTokens = tokenize(article.description);
    fieldLengths.set('description', descTokens.length);
    totalLength += descTokens.length * this.fieldWeights.description;
    this.indexField(docId, 'description', descTokens, this.fieldWeights.description, termsInDoc);

    // Index content field (weight: 1.0)
    const contentTokens = tokenize(article.content);
    fieldLengths.set('content', contentTokens.length);
    totalLength += contentTokens.length * this.fieldWeights.content;
    this.indexField(docId, 'content', contentTokens, this.fieldWeights.content, termsInDoc);

    // Store document stats
    this.docStats.set(docId, {
      docId,
      fieldLengths,
      totalLength,
      title: article.title,
      type: article.$type,
    });

    // Update corpus stats
    this.corpusStats.documentCount++;
    this.updateAvgDocLength();
  }

  /**
   * Index a single field
   */
  private indexField(
    docId: string,
    field: string,
    tokens: Token[],
    fieldWeight: number,
    termsInDoc: Set<string>
  ): void {
    // Count term frequencies
    const termFreqs = new Map<string, { freq: number; positions: number[] }>();

    for (const token of tokens) {
      const existing = termFreqs.get(token.term);
      if (existing) {
        existing.freq++;
        existing.positions.push(token.position);
      } else {
        termFreqs.set(token.term, { freq: 1, positions: [token.position] });
      }
    }

    // Add postings
    for (const [term, { freq, positions }] of termFreqs) {
      const posting: Posting = {
        docId,
        field,
        fieldWeight,
        frequency: freq,
        positions,
      };

      let postings = this.index.get(term);
      if (!postings) {
        postings = [];
        this.index.set(term, postings);
      }
      postings.push(posting);

      // Update document frequency (only once per document)
      if (!termsInDoc.has(term)) {
        termsInDoc.add(term);
        const df = this.corpusStats.documentFrequency.get(term) ?? 0;
        this.corpusStats.documentFrequency.set(term, df + 1);
      }
    }
  }

  /**
   * Remove a document from the index
   */
  removeDocument(docId: string): boolean {
    const stats = this.docStats.get(docId);
    if (!stats) return false;

    // Remove postings for this document
    const termsToCheck: string[] = [];
    for (const [term, postings] of this.index) {
      const filtered = postings.filter(p => p.docId !== docId);
      if (filtered.length === 0) {
        this.index.delete(term);
      } else {
        this.index.set(term, filtered);
      }

      if (filtered.length < postings.length) {
        termsToCheck.push(term);
      }
    }

    // Update document frequencies
    for (const term of termsToCheck) {
      const df = this.corpusStats.documentFrequency.get(term) ?? 0;
      if (df > 0) {
        this.corpusStats.documentFrequency.set(term, df - 1);
      }
    }

    // Remove document stats
    this.docStats.delete(docId);

    // Update corpus stats
    this.corpusStats.documentCount--;
    this.updateAvgDocLength();

    return true;
  }

  /**
   * Clear the entire index
   */
  clear(): void {
    this.index.clear();
    this.docStats.clear();
    this.corpusStats = {
      documentCount: 0,
      avgDocLength: 0,
      documentFrequency: new Map(),
    };
  }

  /**
   * Build index from an array of articles
   */
  buildFromArticles(articles: ArticleRecord[]): void {
    this.clear();
    for (const article of articles) {
      this.addDocument(article);
    }
  }

  /**
   * Build index from an async iterable of articles
   */
  async build(
    articles: AsyncIterable<ArticleRecord>,
    onProgress?: (count: number) => void
  ): Promise<void> {
    this.clear();

    let count = 0;
    for await (const article of articles) {
      this.addDocument(article);
      count++;

      if (onProgress && count % 10000 === 0) {
        onProgress(count);
      }
    }
  }

  // ===========================================================================
  // Search Operations
  // ===========================================================================

  /**
   * Execute a full-text search
   */
  search(query: string, options: FTSSearchOptions = {}): FTSSearchResult[] {
    const { limit = DEFAULT_RESULTS_LIMIT, minScore = 0, types } = options;

    // Tokenize query
    const queryTerms = tokenizeQuery(query);

    if (queryTerms.length === 0) {
      return [];
    }

    if (this.corpusStats.documentCount === 0) {
      return [];
    }

    // Score documents
    const scored = this.scorer.scoreQuery(
      queryTerms,
      term => this.index.get(term) ?? [],
      docId => this.docStats.get(docId) ?? null,
      this.corpusStats
    );

    // Filter by type if specified
    let filtered = scored;
    if (types && types.length > 0) {
      const typeSet = new Set(types);
      filtered = scored.filter(r => typeSet.has(r.type));
    }

    // Filter by minimum score and limit
    return filtered
      .filter(r => r.score >= minScore)
      .slice(0, limit)
      .map(r => ({
        docId: r.docId,
        title: r.title,
        type: r.type,
        score: r.score,
        matchedTerms: r.matchedTerms,
      }));
  }

  /**
   * Get document frequency for a term
   */
  getDocumentFrequency(term: string): number {
    return this.corpusStats.documentFrequency.get(term) ?? 0;
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  /**
   * Get index statistics
   */
  getStats(): {
    documentCount: number;
    vocabularySize: number;
    avgDocLength: number;
    totalPostings: number;
  } {
    let totalPostings = 0;
    for (const postings of this.index.values()) {
      totalPostings += postings.length;
    }

    return {
      documentCount: this.corpusStats.documentCount,
      vocabularySize: this.index.size,
      avgDocLength: this.corpusStats.avgDocLength,
      totalPostings,
    };
  }

  /**
   * Get document count
   */
  get documentCount(): number {
    return this.corpusStats.documentCount;
  }

  /**
   * Get vocabulary size
   */
  get vocabularySize(): number {
    return this.index.size;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private updateAvgDocLength(): void {
    if (this.docStats.size === 0) {
      this.corpusStats.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    for (const stats of this.docStats.values()) {
      totalLength += stats.totalLength;
    }

    this.corpusStats.avgDocLength = totalLength / this.docStats.size;
  }

  // ===========================================================================
  // Serialization (for persistence)
  // ===========================================================================

  /**
   * Serialize the index to JSON
   */
  toJSON(): string {
    const indexArray: Array<[string, Posting[]]> = [];
    for (const [term, postings] of this.index) {
      indexArray.push([term, postings]);
    }

    const docStatsArray: Array<{
      docId: string;
      fieldLengths: Array<[string, number]>;
      totalLength: number;
      title: string;
      type: ArticleType;
    }> = [];
    for (const stats of this.docStats.values()) {
      docStatsArray.push({
        docId: stats.docId,
        fieldLengths: Array.from(stats.fieldLengths.entries()),
        totalLength: stats.totalLength,
        title: stats.title,
        type: stats.type,
      });
    }

    return JSON.stringify({
      version: 1,
      index: indexArray,
      docStats: docStatsArray,
      corpusStats: {
        documentCount: this.corpusStats.documentCount,
        avgDocLength: this.corpusStats.avgDocLength,
        documentFrequency: Array.from(this.corpusStats.documentFrequency.entries()),
      },
    });
  }

  /**
   * Deserialize the index from JSON
   */
  static fromJSON(json: string): WikipediaFTSIndex {
    const parsed = JSON.parse(json) as {
      version: number;
      index: Array<[string, Posting[]]>;
      docStats: Array<{
        docId: string;
        fieldLengths: Array<[string, number]>;
        totalLength: number;
        title: string;
        type: ArticleType;
      }>;
      corpusStats: {
        documentCount: number;
        avgDocLength: number;
        documentFrequency: Array<[string, number]>;
      };
    };

    const instance = new WikipediaFTSIndex();

    // Restore index
    for (const [term, postings] of parsed.index) {
      instance.index.set(term, postings);
    }

    // Restore doc stats
    for (const stats of parsed.docStats) {
      instance.docStats.set(stats.docId, {
        docId: stats.docId,
        fieldLengths: new Map(stats.fieldLengths),
        totalLength: stats.totalLength,
        title: stats.title,
        type: stats.type,
      });
    }

    // Restore corpus stats
    instance.corpusStats = {
      documentCount: parsed.corpusStats.documentCount,
      avgDocLength: parsed.corpusStats.avgDocLength,
      documentFrequency: new Map(parsed.corpusStats.documentFrequency),
    };

    return instance;
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  tokenize,
  tokenizeQuery,
  porterStem,
  BM25Scorer,
  ENGLISH_STOPWORDS,
  DEFAULT_FIELD_WEIGHTS,
  DEFAULT_BM25_CONFIG,
};
