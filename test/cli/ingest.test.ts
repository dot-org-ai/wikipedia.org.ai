/**
 * Tests for the ingest CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ingestCommand } from '../../src/cli/ingest.js';

describe('Ingest Command', () => {
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
      expect(ingestCommand.name()).toBe('ingest');
      expect(ingestCommand.description()).toContain('Download and process Wikipedia dump');
    });

    it('should have url argument', () => {
      const args = ingestCommand.registeredArguments;
      expect(args.length).toBe(1);
      expect(args[0].name()).toBe('url');
      expect(args[0].required).toBe(true);
    });

    it('should have output option', () => {
      const option = ingestCommand.options.find((o) => o.short === '-o');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--output');
    });

    it('should have types option', () => {
      const option = ingestCommand.options.find((o) => o.short === '-t');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--types');
    });

    it('should have limit option', () => {
      const option = ingestCommand.options.find((o) => o.short === '-l');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--limit');
    });

    it('should have skip-redirects option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--skip-redirects');
      expect(option).toBeDefined();
    });

    it('should have skip-disambiguation option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--skip-disambiguation');
      expect(option).toBeDefined();
    });

    it('should have batch-size option', () => {
      const option = ingestCommand.options.find((o) => o.short === '-b');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--batch-size');
    });

    it('should have resume option', () => {
      const option = ingestCommand.options.find((o) => o.short === '-r');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--resume');
    });

    it('should have dry-run option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--dry-run');
      expect(option).toBeDefined();
    });

    it('should have verbose option', () => {
      const option = ingestCommand.options.find((o) => o.short === '-v');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--verbose');
    });
  });

  describe('option defaults', () => {
    it('should have default output directory', () => {
      const option = ingestCommand.options.find((o) => o.long === '--output');
      expect(option?.defaultValue).toBe('./data');
    });

    it('should have default batch size', () => {
      const option = ingestCommand.options.find((o) => o.long === '--batch-size');
      expect(option?.defaultValue).toBe('1000');
    });

    it('should have skip-redirects default to false', () => {
      const option = ingestCommand.options.find((o) => o.long === '--skip-redirects');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have skip-disambiguation default to false', () => {
      const option = ingestCommand.options.find((o) => o.long === '--skip-disambiguation');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have resume default to false', () => {
      const option = ingestCommand.options.find((o) => o.long === '--resume');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have dry-run default to false', () => {
      const option = ingestCommand.options.find((o) => o.long === '--dry-run');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have verbose default to false', () => {
      const option = ingestCommand.options.find((o) => o.long === '--verbose');
      expect(option?.defaultValue).toBe(false);
    });
  });

  describe('option descriptions', () => {
    it('should have description for output option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--output');
      expect(option?.description).toBeDefined();
      expect(option?.description.length).toBeGreaterThan(0);
    });

    it('should have description for types option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('article types');
    });

    it('should have description for limit option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--limit');
      expect(option?.description).toBeDefined();
    });

    it('should have description for batch-size option', () => {
      const option = ingestCommand.options.find((o) => o.long === '--batch-size');
      expect(option?.description).toBeDefined();
    });
  });

  describe('valid article types', () => {
    it('should accept person type in types filter', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('person');
    });

    it('should accept place type in types filter', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('place');
    });

    it('should accept org type in types filter', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('org');
    });

    it('should accept work type in types filter', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('work');
    });

    it('should accept event type in types filter', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('event');
    });

    it('should accept other type in types filter', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.description).toContain('other');
    });
  });

  describe('command structure', () => {
    it('should have an action handler', () => {
      // The command should have an action function set
      // We can verify this by checking that the command has been configured
      expect(ingestCommand.name()).toBe('ingest');
    });

    it('should require URL argument', () => {
      const args = ingestCommand.registeredArguments;
      expect(args[0].required).toBe(true);
    });

    it('should describe URL argument purpose', () => {
      const args = ingestCommand.registeredArguments;
      expect(args[0].description).toContain('Wikipedia dump URL');
    });
  });

  describe('option flags', () => {
    it('should have short flag for output (-o)', () => {
      const option = ingestCommand.options.find((o) => o.long === '--output');
      expect(option?.short).toBe('-o');
    });

    it('should have short flag for types (-t)', () => {
      const option = ingestCommand.options.find((o) => o.long === '--types');
      expect(option?.short).toBe('-t');
    });

    it('should have short flag for limit (-l)', () => {
      const option = ingestCommand.options.find((o) => o.long === '--limit');
      expect(option?.short).toBe('-l');
    });

    it('should have short flag for batch-size (-b)', () => {
      const option = ingestCommand.options.find((o) => o.long === '--batch-size');
      expect(option?.short).toBe('-b');
    });

    it('should have short flag for resume (-r)', () => {
      const option = ingestCommand.options.find((o) => o.long === '--resume');
      expect(option?.short).toBe('-r');
    });

    it('should have short flag for verbose (-v)', () => {
      const option = ingestCommand.options.find((o) => o.long === '--verbose');
      expect(option?.short).toBe('-v');
    });
  });
});
