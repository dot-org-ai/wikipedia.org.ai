/**
 * Tests for the query CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { queryCommand } from '../../src/cli/query.js';

describe('Query Command', () => {
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
      expect(queryCommand.name()).toBe('query');
      expect(queryCommand.description()).toContain('Search Wikipedia articles');
    });

    it('should have term argument', () => {
      const args = queryCommand.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('term');
      expect(args[0].required).toBe(true);
    });

    it('should have data-dir option', () => {
      const option = queryCommand.options.find((o) => o.short === '-d');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--data-dir');
    });

    it('should have type option', () => {
      const option = queryCommand.options.find((o) => o.short === '-t');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--type');
    });

    it('should have limit option', () => {
      const option = queryCommand.options.find((o) => o.short === '-l');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--limit');
    });

    it('should have format option', () => {
      const option = queryCommand.options.find((o) => o.short === '-f');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--format');
    });

    it('should have vector option', () => {
      const option = queryCommand.options.find((o) => o.long === '--vector');
      expect(option).toBeDefined();
    });

    it('should have model option', () => {
      const option = queryCommand.options.find((o) => o.short === '-m');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--model');
    });

    it('should have threshold option', () => {
      const option = queryCommand.options.find((o) => o.long === '--threshold');
      expect(option).toBeDefined();
    });

    it('should have verbose option', () => {
      const option = queryCommand.options.find((o) => o.short === '-v');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--verbose');
    });
  });

  describe('option defaults', () => {
    it('should have default data directory', () => {
      const option = queryCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.defaultValue).toBe('./data');
    });

    it('should have default limit', () => {
      const option = queryCommand.options.find((o) => o.long === '--limit');
      expect(option?.defaultValue).toBe('10');
    });

    it('should have default format', () => {
      const option = queryCommand.options.find((o) => o.long === '--format');
      expect(option?.defaultValue).toBe('table');
    });

    it('should have vector default to false', () => {
      const option = queryCommand.options.find((o) => o.long === '--vector');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have default model', () => {
      const option = queryCommand.options.find((o) => o.long === '--model');
      expect(option?.defaultValue).toBe('bge-m3');
    });

    it('should have default threshold', () => {
      const option = queryCommand.options.find((o) => o.long === '--threshold');
      expect(option?.defaultValue).toBe('0.7');
    });

    it('should have verbose default to false', () => {
      const option = queryCommand.options.find((o) => o.long === '--verbose');
      expect(option?.defaultValue).toBe(false);
    });
  });

  describe('output formats', () => {
    it('should support table format in description', () => {
      const option = queryCommand.options.find((o) => o.long === '--format');
      expect(option?.description).toContain('table');
    });

    it('should support json format in description', () => {
      const option = queryCommand.options.find((o) => o.long === '--format');
      expect(option?.description).toContain('json');
    });

    it('should support csv format in description', () => {
      const option = queryCommand.options.find((o) => o.long === '--format');
      expect(option?.description).toContain('csv');
    });
  });

  describe('option descriptions', () => {
    it('should have description for data-dir option', () => {
      const option = queryCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.description).toBeDefined();
    });

    it('should have description for type option', () => {
      const option = queryCommand.options.find((o) => o.long === '--type');
      expect(option?.description).toBeDefined();
    });

    it('should have description for limit option', () => {
      const option = queryCommand.options.find((o) => o.long === '--limit');
      expect(option?.description).toBeDefined();
    });

    it('should have description for format option', () => {
      const option = queryCommand.options.find((o) => o.long === '--format');
      expect(option?.description).toBeDefined();
    });

    it('should have description for vector option', () => {
      const option = queryCommand.options.find((o) => o.long === '--vector');
      expect(option?.description).toBeDefined();
    });

    it('should have description for model option', () => {
      const option = queryCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toBeDefined();
    });

    it('should have description for threshold option', () => {
      const option = queryCommand.options.find((o) => o.long === '--threshold');
      expect(option?.description).toBeDefined();
    });
  });

  describe('option flags', () => {
    it('should have short flag for data-dir (-d)', () => {
      const option = queryCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.short).toBe('-d');
    });

    it('should have short flag for type (-t)', () => {
      const option = queryCommand.options.find((o) => o.long === '--type');
      expect(option?.short).toBe('-t');
    });

    it('should have short flag for limit (-l)', () => {
      const option = queryCommand.options.find((o) => o.long === '--limit');
      expect(option?.short).toBe('-l');
    });

    it('should have short flag for format (-f)', () => {
      const option = queryCommand.options.find((o) => o.long === '--format');
      expect(option?.short).toBe('-f');
    });

    it('should have short flag for model (-m)', () => {
      const option = queryCommand.options.find((o) => o.long === '--model');
      expect(option?.short).toBe('-m');
    });

    it('should have short flag for verbose (-v)', () => {
      const option = queryCommand.options.find((o) => o.long === '--verbose');
      expect(option?.short).toBe('-v');
    });
  });

  describe('command structure', () => {
    it('should require term argument', () => {
      const args = queryCommand.registeredArguments;
      expect(args[0].required).toBe(true);
    });

    it('should describe term argument purpose', () => {
      const args = queryCommand.registeredArguments;
      expect(args[0].description).toContain('Search term');
    });
  });

  describe('vector search options', () => {
    it('should have vector option for similarity search', () => {
      const option = queryCommand.options.find((o) => o.long === '--vector');
      expect(option?.description).toContain('vector');
    });

    it('should have threshold for vector search', () => {
      const option = queryCommand.options.find((o) => o.long === '--threshold');
      expect(option?.description).toContain('similarity');
    });
  });
});
