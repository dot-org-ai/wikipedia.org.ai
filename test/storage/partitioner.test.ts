/**
 * Tests for the PartitionedWriter file limit validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PartitionedWriter,
  StreamingPartitionedWriter,
  FileLimitExceededError,
} from '../../src/storage/partitioner.js';
import type { ArticleRecord, ArticleType, FileLimitWarningCallback } from '../../src/storage/types.js';

// Helper to create test article records
function createTestArticle(overrides: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    $id: 'test-' + Math.random().toString(36).substring(7),
    $type: 'person' as ArticleType,
    title: 'Test Article',
    description: 'This is a test article description.',
    wikidata_id: 'Q12345',
    coords_lat: 0.0,
    coords_lon: 0.0,
    infobox: {
      birth_date: '1900-01-01',
      country: 'United States',
    },
    content: 'Full article content goes here.',
    updated_at: new Date(),
    ...overrides,
  };
}

describe('PartitionedWriter File Limit Validation', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `partitioner-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Default thresholds', () => {
    it('should have correct default file limits', () => {
      const writer = new PartitionedWriter({ outputDir: testDir });
      const limits = writer.getFileLimits();

      expect(limits.warnAt).toBe(50_000);
      expect(limits.warnHighAt).toBe(75_000);
      expect(limits.criticalAt).toBe(90_000);
      expect(limits.maxFiles).toBe(100_000);
    });

    it('should start with zero file count', () => {
      const writer = new PartitionedWriter({ outputDir: testDir });
      expect(writer.getTotalFileCount()).toBe(0);
    });
  });

  describe('Custom thresholds', () => {
    it('should accept custom file limit thresholds', () => {
      const writer = new PartitionedWriter({
        outputDir: testDir,
        fileLimits: {
          warnAt: 10,
          warnHighAt: 15,
          criticalAt: 18,
          maxFiles: 20,
        },
      });

      const limits = writer.getFileLimits();

      expect(limits.warnAt).toBe(10);
      expect(limits.warnHighAt).toBe(15);
      expect(limits.criticalAt).toBe(18);
      expect(limits.maxFiles).toBe(20);
    });

    it('should merge partial custom thresholds with defaults', () => {
      const writer = new PartitionedWriter({
        outputDir: testDir,
        fileLimits: {
          maxFiles: 50_000,
        },
      });

      const limits = writer.getFileLimits();

      expect(limits.warnAt).toBe(50_000); // default
      expect(limits.warnHighAt).toBe(75_000); // default
      expect(limits.criticalAt).toBe(90_000); // default
      expect(limits.maxFiles).toBe(50_000); // custom
    });
  });

  describe('Warning callbacks', () => {
    it('should call warning callback at warn threshold', async () => {
      const warnings: Array<{ count: number; threshold: number; level: string; suggestion?: string }> = [];
      const warningCallback: FileLimitWarningCallback = (count, threshold, level, suggestion) => {
        warnings.push({ count, threshold, level, suggestion });
      };

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1, // Force flush on each article
        fileLimits: {
          warnAt: 2,
          warnHighAt: 3,
          criticalAt: 4,
          maxFiles: 100,
        },
        onFileLimitWarning: warningCallback,
      });

      // Write enough articles to trigger warn threshold (2 files)
      for (let i = 0; i < 3; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].level).toBe('warn');
      expect(warnings[0].threshold).toBe(2);
    });

    it('should call warning callback at warn-high threshold', async () => {
      const warnings: Array<{ count: number; threshold: number; level: string }> = [];
      const warningCallback: FileLimitWarningCallback = (count, threshold, level) => {
        warnings.push({ count, threshold, level });
      };

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 1,
          warnHighAt: 2,
          criticalAt: 3,
          maxFiles: 100,
        },
        onFileLimitWarning: warningCallback,
      });

      // Write enough to trigger warn-high threshold
      for (let i = 0; i < 3; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      const warnHighWarnings = warnings.filter(w => w.level === 'warn-high');
      expect(warnHighWarnings.length).toBe(1);
      expect(warnHighWarnings[0].threshold).toBe(2);
    });

    it('should call warning callback at critical threshold', async () => {
      const warnings: Array<{ count: number; threshold: number; level: string }> = [];
      const warningCallback: FileLimitWarningCallback = (count, threshold, level) => {
        warnings.push({ count, threshold, level });
      };

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 1,
          warnHighAt: 2,
          criticalAt: 3,
          maxFiles: 100,
        },
        onFileLimitWarning: warningCallback,
      });

      // Write enough to trigger critical threshold
      for (let i = 0; i < 4; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      const criticalWarnings = warnings.filter(w => w.level === 'critical');
      expect(criticalWarnings.length).toBe(1);
      expect(criticalWarnings[0].threshold).toBe(3);
    });

    it('should only call each warning level once', async () => {
      const warnings: Array<{ level: string }> = [];
      const warningCallback: FileLimitWarningCallback = (count, threshold, level) => {
        warnings.push({ level });
      };

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 1,
          warnHighAt: 2,
          criticalAt: 3,
          maxFiles: 100,
        },
        onFileLimitWarning: warningCallback,
      });

      // Write many articles
      for (let i = 0; i < 10; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      // Each warning level should only appear once
      const warnCount = warnings.filter(w => w.level === 'warn').length;
      const warnHighCount = warnings.filter(w => w.level === 'warn-high').length;
      const criticalCount = warnings.filter(w => w.level === 'critical').length;

      expect(warnCount).toBe(1);
      expect(warnHighCount).toBe(1);
      expect(criticalCount).toBe(1);
    });
  });

  describe('Error on max file limit', () => {
    it('should throw FileLimitExceededError when max files exceeded', async () => {
      const warningCallback: FileLimitWarningCallback = () => {};

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 1,
          warnHighAt: 2,
          criticalAt: 3,
          maxFiles: 5,
        },
        onFileLimitWarning: warningCallback,
      });

      // Write until we exceed the limit
      await expect(async () => {
        for (let i = 0; i < 10; i++) {
          await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
        }
      }).rejects.toThrow(FileLimitExceededError);
    });

    it('should have correct properties on FileLimitExceededError', async () => {
      const warningCallback: FileLimitWarningCallback = () => {};

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 1,
          warnHighAt: 2,
          criticalAt: 3,
          maxFiles: 3,
        },
        onFileLimitWarning: warningCallback,
      });

      try {
        for (let i = 0; i < 10; i++) {
          await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
        }
        expect.fail('Should have thrown FileLimitExceededError');
      } catch (error) {
        expect(error).toBeInstanceOf(FileLimitExceededError);
        if (error instanceof FileLimitExceededError) {
          expect(error.maxFiles).toBe(3);
          expect(error.currentCount).toBeGreaterThanOrEqual(3);
          expect(error.message).toContain('100k');
          expect(error.message).toContain('Cloudflare Workers');
        }
      }
    });
  });

  describe('Stats include file limit info', () => {
    it('should include file limit info in getStats()', async () => {
      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 100,
          warnHighAt: 150,
          criticalAt: 180,
          maxFiles: 200,
        },
      });

      // Write a few articles to create files
      for (let i = 0; i < 3; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      const stats = writer.getStats();

      expect(stats.fileLimits).toBeDefined();
      expect(stats.fileLimits.current).toBeGreaterThan(0);
      expect(stats.fileLimits.maxFiles).toBe(200);
      expect(stats.fileLimits.percentUsed).toBeGreaterThan(0);
      expect(stats.fileLimits.thresholds.warnAt).toBe(100);
      expect(stats.fileLimits.thresholds.warnHighAt).toBe(150);
      expect(stats.fileLimits.thresholds.criticalAt).toBe(180);
      expect(stats.fileLimits.thresholds.maxFiles).toBe(200);
    });

    it('should calculate percentUsed correctly', async () => {
      const warningCallback: FileLimitWarningCallback = () => {};

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 50,
          warnHighAt: 75,
          criticalAt: 90,
          maxFiles: 100,
        },
        onFileLimitWarning: warningCallback,
      });

      // Write 5 articles to create approximately 5 files
      for (let i = 0; i < 5; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      const stats = writer.getStats();
      const expectedPercent = (stats.fileLimits.current / 100) * 100;
      expect(stats.fileLimits.percentUsed).toBeCloseTo(expectedPercent, 0);
    });
  });

  describe('Consolidation suggestions', () => {
    it('should include consolidation suggestion in warnings', async () => {
      const suggestions: Array<string | undefined> = [];
      const warningCallback: FileLimitWarningCallback = (count, threshold, level, suggestion) => {
        suggestions.push(suggestion);
      };

      const writer = new PartitionedWriter({
        outputDir: testDir,
        rowGroupSize: 1,
        fileLimits: {
          warnAt: 1,
          warnHighAt: 2,
          criticalAt: 3,
          maxFiles: 100,
        },
        onFileLimitWarning: warningCallback,
      });

      for (let i = 0; i < 4; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }

      expect(suggestions.length).toBeGreaterThanOrEqual(3);
      expect(suggestions[0]).toContain('consolidat');
      expect(suggestions[1]).toContain('Approaching');
      expect(suggestions[2]).toContain('CRITICAL');
    });
  });
});

describe('StreamingPartitionedWriter File Limit Validation', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `streaming-partitioner-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should expose getTotalFileCount()', async () => {
    const writer = new StreamingPartitionedWriter({
      outputDir: testDir,
      rowGroupSize: 1,
    });

    expect(writer.getTotalFileCount()).toBe(0);

    await writer.write([createTestArticle()]);

    expect(writer.getTotalFileCount()).toBeGreaterThan(0);

    await writer.close();
  });

  it('should expose getFileLimits()', () => {
    const writer = new StreamingPartitionedWriter({
      outputDir: testDir,
      fileLimits: {
        maxFiles: 50_000,
      },
    });

    const limits = writer.getFileLimits();
    expect(limits.maxFiles).toBe(50_000);
  });

  it('should include fileLimits in getStats()', async () => {
    const writer = new StreamingPartitionedWriter({
      outputDir: testDir,
      rowGroupSize: 1,
    });

    await writer.write([createTestArticle()]);

    const stats = writer.getStats();
    expect(stats.fileLimits).toBeDefined();
    expect(stats.fileLimits.maxFiles).toBe(100_000);

    await writer.close();
  });

  it('should propagate FileLimitExceededError', async () => {
    const warningCallback: FileLimitWarningCallback = () => {};

    const writer = new StreamingPartitionedWriter({
      outputDir: testDir,
      rowGroupSize: 1,
      fileLimits: {
        warnAt: 1,
        warnHighAt: 2,
        criticalAt: 3,
        maxFiles: 3,
      },
      onFileLimitWarning: warningCallback,
    });

    await expect(async () => {
      for (let i = 0; i < 10; i++) {
        await writer.write([createTestArticle({ $type: 'person', title: `Article ${i}` })]);
      }
    }).rejects.toThrow(FileLimitExceededError);
  });
});

describe('FileLimitExceededError', () => {
  it('should have correct name', () => {
    const error = new FileLimitExceededError(100, 100);
    expect(error.name).toBe('FileLimitExceededError');
  });

  it('should include file counts in message', () => {
    const error = new FileLimitExceededError(100500, 100000);
    expect(error.message).toContain('100500');
    expect(error.message).toContain('100000');
  });

  it('should be an instance of Error', () => {
    const error = new FileLimitExceededError(100, 100);
    expect(error).toBeInstanceOf(Error);
  });
});
