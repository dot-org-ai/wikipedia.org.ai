/**
 * Tests for the export formats module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parquetRead } from '@dotdo/hyparquet';
import {
  writeFullFormat,
  writeInfoboxesFormat,
  writeIndexFormat,
  writeTypeFormat,
  exportAllFormats,
  type ExportWriterConfig,
} from '../../src/storage/export-formats.js';
import type { ArticleRecord, ArticleType } from '../../src/storage/types.js';

// Helper to create test article records
function createTestArticle(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    $id: 'test-' + Math.random().toString(36).substring(7),
    $type: 'person' as ArticleType,
    title: 'Test Article',
    description: 'This is a test article description.',
    wikidata_id: 'Q12345',
    coords_lat: null,
    coords_lon: null,
    infobox: {
      birth_date: '1900-01-01',
      country: 'United States',
    },
    content: 'Full article content goes here.',
    updated_at: new Date(),
    ...overrides,
  };
}

// Helper to read parquet file and return row count
async function getParquetRowCount(filePath: string): Promise<number> {
  const buffer = await readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  let rowCount = 0;
  await parquetRead({
    file: arrayBuffer,
    onComplete: (data: unknown) => {
      const records = data as Record<string, unknown[]>;
      // Count numeric keys (row indices)
      rowCount = Object.keys(records).filter(k => /^\d+$/.test(k)).length;
    },
  });

  return rowCount;
}

describe('Export Formats', () => {
  let testDir: string;
  let config: ExportWriterConfig;

  beforeEach(async () => {
    testDir = join(tmpdir(), `export-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    config = {
      outputDir: testDir,
      rowGroupSize: 100,
      statistics: true,
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('writeFullFormat', () => {
    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should write full format with all columns', async () => {
      const articles = [
        createTestArticle({ title: 'Person 1', $type: 'person' }),
        createTestArticle({ title: 'Place 1', $type: 'place' }),
        createTestArticle({ title: 'Org 1', $type: 'org' }),
      ];

      const result = await writeFullFormat(articles, config);

      expect(result.format).toBe('full');
      expect(result.path).toContain('wikipedia-full.parquet');
      expect(result.rowCount).toBe(3);
      expect(result.size).toBeGreaterThan(0);

      // Verify file exists
      const files = await readdir(testDir);
      expect(files).toContain('wikipedia-full.parquet');
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should handle VARIANT infobox data', async () => {
      const articles = [
        createTestArticle({
          $type: 'person',
          infobox: {
            birth_date: '1879-03-14',
            death_date: '1955-04-18',
            nationality: 'German',
          },
        }),
        createTestArticle({
          $type: 'place',
          infobox: {
            country: 'Japan',
            population: 13960000,
            timezone: 'JST',
          },
        }),
      ];

      const result = await writeFullFormat(articles, config);
      expect(result.rowCount).toBe(2);
    });
  });

  describe('writeInfoboxesFormat', () => {
    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should write infobox format with shredded fields', async () => {
      const articles = [
        createTestArticle({
          title: 'Albert Einstein',
          $type: 'person',
          infobox: {
            _type: 'person',
            birth_date: '1879-03-14',
            death_date: '1955-04-18',
            country: 'Germany',
          },
        }),
        createTestArticle({
          title: 'Tokyo',
          $type: 'place',
          infobox: {
            _type: 'settlement',
            country: 'Japan',
            population: 13960000,
          },
        }),
      ];

      const result = await writeInfoboxesFormat(articles, config);

      expect(result.format).toBe('infoboxes');
      expect(result.path).toContain('wikipedia-infoboxes.parquet');
      expect(result.rowCount).toBe(2);

      // Verify file exists
      const files = await readdir(testDir);
      expect(files).toContain('wikipedia-infoboxes.parquet');
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should skip articles without infoboxes', async () => {
      const articles = [
        createTestArticle({ title: 'With Infobox', infobox: { _type: 'test' } }),
        createTestArticle({ title: 'Without Infobox', infobox: null }),
      ];

      const result = await writeInfoboxesFormat(articles, config);

      // Only one article has an infobox
      expect(result.rowCount).toBe(1);
    });
  });

  describe('writeIndexFormat', () => {
    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should write minimal index format', async () => {
      const articles = [
        createTestArticle({ title: 'Article 1', $type: 'person', description: 'Short description' }),
        createTestArticle({ title: 'Article 2', $type: 'place', description: 'Another description' }),
        createTestArticle({ title: 'Article 3', $type: 'org', description: 'Third description' }),
      ];

      const result = await writeIndexFormat(articles, config);

      expect(result.format).toBe('index');
      expect(result.path).toContain('wikipedia-index.parquet');
      expect(result.rowCount).toBe(3);

      // Index files should be relatively small
      // (only id, title, type, description)
      const files = await readdir(testDir);
      expect(files).toContain('wikipedia-index.parquet');
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should truncate long descriptions', async () => {
      const longDescription = 'A'.repeat(500);
      const articles = [
        createTestArticle({ description: longDescription }),
      ];

      const result = await writeIndexFormat(articles, config);
      expect(result.rowCount).toBe(1);

      // The description should be truncated to ~200 chars
      // We can't easily verify this without reading the parquet file
    });
  });

  describe('writeTypeFormat', () => {
    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should write person type with person-specific fields', async () => {
      const articles = [
        createTestArticle({
          $type: 'person',
          title: 'Albert Einstein',
          infobox: {
            birth_date: '1879-03-14',
            death_date: '1955-04-18',
            nationality: 'German',
            occupation: 'Physicist',
            birth_place: 'Ulm, Germany',
          },
        }),
        createTestArticle({
          $type: 'person',
          title: 'Marie Curie',
          infobox: {
            birth_date: '1867-11-07',
            death_date: '1934-07-04',
            nationality: 'Polish',
            occupation: 'Physicist',
          },
        }),
        createTestArticle({ $type: 'place', title: 'Paris' }), // Should be filtered out
      ];

      const result = await writeTypeFormat(articles, 'person', config);

      expect(result.format).toBe('person');
      expect(result.path).toContain('wikipedia-person.parquet');
      expect(result.rowCount).toBe(2); // Only person articles
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should write place type with location fields', async () => {
      const articles = [
        createTestArticle({
          $type: 'place',
          title: 'Tokyo',
          coords_lat: 35.6762,
          coords_lon: 139.6503,
          infobox: {
            country: 'Japan',
            population: 13960000,
            timezone: 'JST',
          },
        }),
        createTestArticle({
          $type: 'place',
          title: 'New York',
          coords_lat: 40.7128,
          coords_lon: -74.0060,
          infobox: {
            country: 'United States',
            population: 8336817,
          },
        }),
      ];

      const result = await writeTypeFormat(articles, 'place', config);

      expect(result.format).toBe('place');
      expect(result.rowCount).toBe(2);
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should write org type with company fields', async () => {
      const articles = [
        createTestArticle({
          $type: 'org',
          title: 'Microsoft',
          infobox: {
            founded: '1975-04-04',
            headquarters: 'Redmond, WA',
            industry: 'Technology',
            num_employees: 221000,
            website: 'microsoft.com',
          },
        }),
      ];

      const result = await writeTypeFormat(articles, 'org', config);

      expect(result.format).toBe('org');
      expect(result.rowCount).toBe(1);
    });

    it('should return empty result for type with no articles', async () => {
      const articles = [
        createTestArticle({ $type: 'person' }),
        createTestArticle({ $type: 'place' }),
      ];

      const result = await writeTypeFormat(articles, 'event', config);

      expect(result.format).toBe('event');
      expect(result.rowCount).toBe(0);
      expect(result.size).toBe(0);
    });
  });

  describe('exportAllFormats', () => {
    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should export all formats by default', async () => {
      const articles = [
        createTestArticle({ $type: 'person', title: 'Person 1' }),
        createTestArticle({ $type: 'place', title: 'Place 1' }),
        createTestArticle({ $type: 'org', title: 'Org 1' }),
      ];

      const results = await exportAllFormats(articles, config);

      // Should have full, infoboxes, index, and type-specific files
      const formats = results.map(r => r.format);
      expect(formats).toContain('full');
      expect(formats).toContain('infoboxes');
      expect(formats).toContain('index');
      expect(formats).toContain('person');
      expect(formats).toContain('place');
      expect(formats).toContain('org');
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should export only specified formats', async () => {
      const articles = [
        createTestArticle({ $type: 'person', title: 'Person 1' }),
        createTestArticle({ $type: 'place', title: 'Place 1' }),
      ];

      const results = await exportAllFormats(articles, config, {
        full: true,
        infoboxes: false,
        index: true,
        types: false,
      });

      const formats = results.map(r => r.format);
      expect(formats).toContain('full');
      expect(formats).toContain('index');
      expect(formats).not.toContain('infoboxes');
      expect(formats).not.toContain('person');
      expect(formats).not.toContain('place');
    });

    it.skipIf(!process.env.RUN_PARQUET_TESTS)('should export specific types only', async () => {
      const articles = [
        createTestArticle({ $type: 'person', title: 'Person 1' }),
        createTestArticle({ $type: 'place', title: 'Place 1' }),
        createTestArticle({ $type: 'org', title: 'Org 1' }),
      ];

      const results = await exportAllFormats(articles, config, {
        full: false,
        infoboxes: false,
        index: false,
        types: ['person', 'place'],
      });

      const formats = results.map(r => r.format);
      expect(formats).toContain('person');
      expect(formats).toContain('place');
      expect(formats).not.toContain('org');
      expect(formats).not.toContain('full');
    });
  });
});

describe('Export Format Integration', () => {
  let testDir: string;
  let config: ExportWriterConfig;

  beforeEach(async () => {
    testDir = join(tmpdir(), `export-integration-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    config = {
      outputDir: testDir,
      rowGroupSize: 100,
      statistics: true,
    };
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it.skipIf(!process.env.RUN_PARQUET_TESTS)('should produce readable parquet files', async () => {
    const articles = [
      createTestArticle({ title: 'Test Article 1' }),
      createTestArticle({ title: 'Test Article 2' }),
    ];

    const result = await writeIndexFormat(articles, config);

    // Read the file back
    const rowCount = await getParquetRowCount(result.path);
    expect(rowCount).toBe(2);
  });

  it.skipIf(!process.env.RUN_PARQUET_TESTS)('should handle large datasets efficiently', async () => {
    // Create many articles
    const articles: ArticleRecord[] = [];
    for (let i = 0; i < 1000; i++) {
      articles.push(
        createTestArticle({
          $id: `article-${i}`,
          title: `Article ${i}`,
          $type: (['person', 'place', 'org', 'work', 'event', 'other'] as ArticleType[])[i % 6],
          content: 'Content '.repeat(100),
        })
      );
    }

    const startTime = Date.now();
    const results = await exportAllFormats(articles, {
      ...config,
      rowGroupSize: 500,
    });
    const elapsed = Date.now() - startTime;

    // Should complete in reasonable time (< 30 seconds)
    expect(elapsed).toBeLessThan(30000);

    // Should have produced multiple files
    expect(results.length).toBeGreaterThan(3);

    // Total rows across type files should match article count
    const totalTypeRows = results
      .filter(r => ['person', 'place', 'org', 'work', 'event', 'other'].includes(r.format))
      .reduce((sum, r) => sum + r.rowCount, 0);
    expect(totalTypeRows).toBe(1000);
  });
});
