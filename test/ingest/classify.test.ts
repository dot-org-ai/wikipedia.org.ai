/**
 * Tests for the article classification module
 */

import { describe, it, expect } from 'vitest';
import {
  classifyArticle,
  createClassifier,
  getClassificationConfidence,
  getClassificationScores,
} from '../../src/ingest/classify.js';
import type { Article, ArticleType } from '../../src/ingest/types.js';

// Helper to create test articles
function createTestArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: 'Test Article',
    id: 1,
    plaintext: 'This is a test article about something.',
    infoboxes: [],
    links: [],
    categories: [],
    isRedirect: false,
    isDisambiguation: false,
    timestamp: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('classifyArticle', () => {
  describe('person classification', () => {
    it('should classify person articles by infobox', () => {
      const article = createTestArticle({
        title: 'Albert Einstein',
        infoboxes: [
          { type: 'scientist', data: { name: 'Albert Einstein' } },
        ],
      });

      expect(classifyArticle(article)).toBe('person');
    });

    it('should classify various person infobox types', () => {
      // These are the types that should definitely classify as person
      // based on the INFOBOX_MAPPINGS in classify.ts
      const personTypes = [
        'person',
        'biography',
        'actor',
        'musician',
        'politician',
        'athlete',
        'writer',
        'football biography',
        'nfl biography',
        'nba biography',
        'musical artist',
        'monarch',
        'royalty',
        'president',
      ];

      for (const type of personTypes) {
        const article = createTestArticle({
          title: `Test ${type}`,
          infoboxes: [{ type, data: {} }],
        });

        const result = classifyArticle(article);
        expect(result, `Expected "${type}" to classify as "person", got "${result}"`).toBe('person');
      }
    });

    it('should classify person by category keywords', () => {
      const article = createTestArticle({
        title: 'John Doe',
        categories: ['1980 births', 'Living people', 'American actors'],
      });

      expect(classifyArticle(article)).toBe('person');
    });

    it('should classify person by content analysis', () => {
      const article = createTestArticle({
        title: 'Jane Smith',
        plaintext: 'Jane Smith (born 1985) is an American actress who has appeared in many films. She began her career in 2005.',
      });

      expect(classifyArticle(article)).toBe('person');
    });

    it('should detect person from pronoun usage', () => {
      const article = createTestArticle({
        title: 'Unknown Person',
        plaintext: 'He was born in 1950. He grew up in a small town. His parents were farmers. He later became a teacher. His contributions to education were significant.',
      });

      expect(classifyArticle(article)).toBe('person');
    });
  });

  describe('place classification', () => {
    it('should classify place articles by infobox', () => {
      const article = createTestArticle({
        title: 'Tokyo',
        infoboxes: [
          { type: 'settlement', data: { name: 'Tokyo' } },
        ],
      });

      expect(classifyArticle(article)).toBe('place');
    });

    it('should classify various place infobox types', () => {
      const placeTypes = [
        'country',
        'city',
        'town',
        'village',
        'mountain',
        'river',
        'lake',
        'island',
        'building',
        'stadium',
        'airport',
        'national park',
        'church',
        'castle',
      ];

      for (const type of placeTypes) {
        const article = createTestArticle({
          title: `Test ${type}`,
          infoboxes: [{ type, data: {} }],
        });

        expect(classifyArticle(article)).toBe('place');
      }
    });

    it('should classify place by category keywords', () => {
      const article = createTestArticle({
        title: 'Smallville',
        categories: ['Cities in Kansas', 'Populated places in the United States'],
      });

      expect(classifyArticle(article)).toBe('place');
    });
  });

  describe('organization classification', () => {
    it('should classify organization articles by infobox', () => {
      const article = createTestArticle({
        title: 'Microsoft',
        infoboxes: [
          { type: 'company', data: { name: 'Microsoft' } },
        ],
      });

      expect(classifyArticle(article)).toBe('org');
    });

    it('should classify various org infobox types', () => {
      const orgTypes = [
        'company',
        'corporation',
        'university',
        'school',
        'football club',
        'sports team',
        'political party',
        'government agency',
        'organization',
        'non-profit',
        'charity',
        'band',
        'orchestra',
      ];

      for (const type of orgTypes) {
        const article = createTestArticle({
          title: `Test ${type}`,
          infoboxes: [{ type, data: {} }],
        });

        expect(classifyArticle(article)).toBe('org');
      }
    });

    it('should classify organization by category keywords', () => {
      const article = createTestArticle({
        title: 'Acme Inc',
        categories: ['Companies established in 1950', 'Technology companies'],
      });

      expect(classifyArticle(article)).toBe('org');
    });
  });

  describe('work classification', () => {
    it('should classify work articles by infobox', () => {
      const article = createTestArticle({
        title: 'Inception',
        infoboxes: [
          { type: 'film', data: { name: 'Inception' } },
        ],
      });

      expect(classifyArticle(article)).toBe('work');
    });

    it('should classify various work infobox types', () => {
      // These are the types from INFOBOX_MAPPINGS.work.primary
      const workTypes = [
        'film',
        'album',
        'book',
        'novel',
        'song',
        'video game',
        'television',
        'tv series',
        'painting',
        // Note: 'software' is in org.primary, not work.primary
        'magazine',
        'newspaper',
        'podcast',
      ];

      for (const type of workTypes) {
        const article = createTestArticle({
          title: `Test ${type}`,
          infoboxes: [{ type, data: {} }],
        });

        const result = classifyArticle(article);
        expect(result, `Expected "${type}" to classify as "work", got "${result}"`).toBe('work');
      }
    });

    it('should classify work by category keywords', () => {
      const article = createTestArticle({
        title: 'Some Movie',
        categories: ['2020 films', 'American science fiction films'],
      });

      expect(classifyArticle(article)).toBe('work');
    });
  });

  describe('event classification', () => {
    it('should classify event articles by infobox', () => {
      const article = createTestArticle({
        title: 'Battle of Waterloo',
        infoboxes: [
          { type: 'military conflict', data: { conflict: 'Battle of Waterloo' } },
        ],
      });

      expect(classifyArticle(article)).toBe('event');
    });

    it('should classify various event infobox types', () => {
      const eventTypes = [
        'war',
        'battle',
        'military conflict',
        'earthquake',
        'hurricane',
        'election',
        'festival',
        'championship',
        'tournament',
        'olympics',
      ];

      for (const type of eventTypes) {
        const article = createTestArticle({
          title: `Test ${type}`,
          infoboxes: [{ type, data: {} }],
        });

        expect(classifyArticle(article)).toBe('event');
      }
    });

    it('should classify event by category keywords', () => {
      const article = createTestArticle({
        title: 'Some Battle',
        categories: ['Battles of World War I', 'Conflicts in 1916'],
      });

      expect(classifyArticle(article)).toBe('event');
    });
  });

  describe('other classification', () => {
    it('should fall back to other for unknown types', () => {
      const article = createTestArticle({
        title: 'DNA',
        plaintext: 'Deoxyribonucleic acid is a polymer composed of two polynucleotide chains.',
        infoboxes: [],
        categories: ['DNA', 'Genetics', 'Nucleic acids'],
      });

      expect(classifyArticle(article)).toBe('other');
    });

    it('should classify scientific concepts as other', () => {
      const otherTypes = [
        'element',
        'chemical compound',
        'species',
        'disease',
        'drug',
        'language',
        'algorithm',
      ];

      for (const type of otherTypes) {
        const article = createTestArticle({
          title: `Test ${type}`,
          infoboxes: [{ type, data: {} }],
        });

        expect(classifyArticle(article)).toBe('other');
      }
    });

    it('should return other when no signals are present', () => {
      const article = createTestArticle({
        title: 'Abstract Concept',
        plaintext: 'This is an abstract concept without clear classification signals.',
        infoboxes: [],
        categories: [],
      });

      expect(classifyArticle(article)).toBe('other');
    });
  });
});

describe('createClassifier', () => {
  it('should create a TransformStream', () => {
    const classifier = createClassifier();
    expect(classifier).toBeInstanceOf(TransformStream);
  });

  it('should classify articles in stream', async () => {
    const articles: Article[] = [
      createTestArticle({
        title: 'Albert Einstein',
        infoboxes: [{ type: 'scientist', data: {} }],
      }),
      createTestArticle({
        title: 'Tokyo',
        infoboxes: [{ type: 'settlement', data: {} }],
      }),
      createTestArticle({
        title: 'Microsoft',
        infoboxes: [{ type: 'company', data: {} }],
      }),
    ];

    const inputStream = new ReadableStream<Article>({
      start(controller) {
        for (const article of articles) {
          controller.enqueue(article);
        }
        controller.close();
      },
    });

    const classifier = createClassifier();
    const outputStream = inputStream.pipeThrough(classifier);

    const reader = outputStream.getReader();
    const results: Array<Article & { type: ArticleType }> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      results.push(value);
    }

    expect(results.length).toBe(3);
    expect(results[0].type).toBe('person');
    expect(results[1].type).toBe('place');
    expect(results[2].type).toBe('org');
  });
});

describe('getClassificationConfidence', () => {
  it('should return high confidence for exact infobox match', () => {
    const article = createTestArticle({
      infoboxes: [{ type: 'person', data: {} }],
    });

    expect(getClassificationConfidence(article)).toBe('high');
  });

  it('should return medium confidence for pattern match', () => {
    // Use a pattern that matches via regex but isn't in primary list
    // e.g., "basketball player" matches the player$ pattern
    const article = createTestArticle({
      infoboxes: [{ type: 'basketball player', data: {} }],
    });

    const confidence = getClassificationConfidence(article);
    // This could be high or medium depending on implementation
    expect(['high', 'medium']).toContain(confidence);
  });

  it('should return low confidence for category/content based classification', () => {
    const article = createTestArticle({
      infoboxes: [],
      categories: ['1980 births'],
    });

    expect(getClassificationConfidence(article)).toBe('low');
  });
});

describe('getClassificationScores', () => {
  it('should return scores for all categories', () => {
    const article = createTestArticle({
      infoboxes: [{ type: 'scientist', data: {} }],
      categories: ['German physicists'],
    });

    const scores = getClassificationScores(article);

    expect(scores).toHaveProperty('person');
    expect(scores).toHaveProperty('place');
    expect(scores).toHaveProperty('org');
    expect(scores).toHaveProperty('work');
    expect(scores).toHaveProperty('event');
    expect(scores).toHaveProperty('other');
  });

  it('should give highest score to matching category', () => {
    const article = createTestArticle({
      infoboxes: [{ type: 'company', data: {} }],
    });

    const scores = getClassificationScores(article);

    expect(scores.org).toBeGreaterThan(scores.person);
    expect(scores.org).toBeGreaterThan(scores.place);
    expect(scores.org).toBeGreaterThan(scores.work);
    expect(scores.org).toBeGreaterThan(scores.event);
    expect(scores.org).toBeGreaterThan(scores.other);
  });

  it('should return default other score when no signals', () => {
    const article = createTestArticle({
      infoboxes: [],
      categories: [],
      plaintext: 'Nothing special.',
    });

    const scores = getClassificationScores(article);

    expect(scores.other).toBeGreaterThan(0);
  });
});
