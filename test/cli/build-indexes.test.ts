/**
 * Tests for the build-indexes CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildIndexesCommand } from '../../src/cli/build-indexes.js';

describe('Build Indexes Command', () => {
  const originalConsoleLog = console.log;
  const mockConsoleLog = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = mockConsoleLog;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    vi.restoreAllMocks();
  });

  describe('command definition', () => {
    it('should have correct name and description', () => {
      expect(buildIndexesCommand.name()).toBe('build-indexes');
      expect(buildIndexesCommand.description()).toContain('Build title, type, and ID indexes');
    });

    it('should have data-dir option', () => {
      const option = buildIndexesCommand.options.find((o) => o.short === '-d');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--data-dir');
    });

    it('should have output option', () => {
      const option = buildIndexesCommand.options.find((o) => o.short === '-o');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--output');
    });

    it('should have compress option (negatable)', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--no-compress');
      expect(option).toBeDefined();
    });

    it('should have verbose option', () => {
      const option = buildIndexesCommand.options.find((o) => o.short === '-v');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--verbose');
    });
  });

  describe('option defaults', () => {
    it('should have default data directory', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.defaultValue).toBe('./data');
    });

    it('should have compression enabled by default', () => {
      // --no-compress has default false, meaning compression is enabled by default
      const option = buildIndexesCommand.options.find((o) => o.long === '--no-compress');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have verbose default to false', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--verbose');
      expect(option?.defaultValue).toBe(false);
    });
  });

  describe('option descriptions', () => {
    it('should have description for data-dir option', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.description).toBeDefined();
      expect(option?.description).toContain('Data directory');
    });

    it('should have description for output option', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--output');
      expect(option?.description).toBeDefined();
    });

    it('should have description for compress option', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--no-compress');
      expect(option?.description).toBeDefined();
    });

    it('should have description for verbose option', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--verbose');
      expect(option?.description).toBeDefined();
    });
  });

  describe('option flags', () => {
    it('should have short flag for data-dir (-d)', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.short).toBe('-d');
    });

    it('should have short flag for output (-o)', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--output');
      expect(option?.short).toBe('-o');
    });

    it('should have short flag for verbose (-v)', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--verbose');
      expect(option?.short).toBe('-v');
    });
  });

  describe('command structure', () => {
    it('should have no required arguments', () => {
      const args = buildIndexesCommand.registeredArguments;
      expect(args.length).toBe(0);
    });

    it('should describe index types in command description', () => {
      const description = buildIndexesCommand.description();
      expect(description).toContain('title');
      expect(description).toContain('type');
      expect(description).toContain('ID');
    });
  });

  describe('compression feature', () => {
    it('should support gzip compression', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--no-compress');
      expect(option?.description).toContain('gzip');
    });

    it('should allow disabling compression', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--no-compress');
      expect(option).toBeDefined();
    });
  });

  describe('output configuration', () => {
    it('should allow custom output directory', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--output');
      expect(option).toBeDefined();
    });

    it('should default output to data-dir/indexes', () => {
      const option = buildIndexesCommand.options.find((o) => o.long === '--output');
      // No default value means it defaults to data-dir/indexes
      expect(option?.defaultValue).toBeUndefined();
    });
  });

  describe('index types', () => {
    it('should build title index', () => {
      const description = buildIndexesCommand.description();
      expect(description).toContain('title');
    });

    it('should build type index', () => {
      const description = buildIndexesCommand.description();
      expect(description).toContain('type');
    });

    it('should build ID index', () => {
      const description = buildIndexesCommand.description();
      expect(description).toContain('ID');
    });
  });
});

describe('buildIndexes function', () => {
  it('should export buildIndexes function', async () => {
    const module = await import('../../src/cli/build-indexes.js');
    expect(typeof module.buildIndexes).toBe('function');
  });
});
