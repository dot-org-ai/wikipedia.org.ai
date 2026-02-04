/**
 * Tests for the embed CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { embedCommand } from '../../src/cli/embed.js';

describe('Embed Command', () => {
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
      expect(embedCommand.name()).toBe('embed');
      expect(embedCommand.description()).toContain('Generate embeddings');
    });

    it('should have data-dir option', () => {
      const option = embedCommand.options.find((o) => o.short === '-d');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--data-dir');
    });

    it('should have model option', () => {
      const option = embedCommand.options.find((o) => o.short === '-m');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--model');
    });

    it('should have batch-size option', () => {
      const option = embedCommand.options.find((o) => o.short === '-b');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--batch-size');
    });

    it('should have resume option', () => {
      const option = embedCommand.options.find((o) => o.short === '-r');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--resume');
    });

    it('should have ai-gateway option', () => {
      const option = embedCommand.options.find((o) => o.long === '--ai-gateway');
      expect(option).toBeDefined();
    });

    it('should have account-id option', () => {
      const option = embedCommand.options.find((o) => o.long === '--account-id');
      expect(option).toBeDefined();
    });

    it('should have output option', () => {
      const option = embedCommand.options.find((o) => o.short === '-o');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--output');
    });

    it('should have dry-run option', () => {
      const option = embedCommand.options.find((o) => o.long === '--dry-run');
      expect(option).toBeDefined();
    });

    it('should have verbose option', () => {
      const option = embedCommand.options.find((o) => o.short === '-v');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--verbose');
    });

    it('should have max-articles option', () => {
      const option = embedCommand.options.find((o) => o.long === '--max-articles');
      expect(option).toBeDefined();
    });
  });

  describe('option defaults', () => {
    it('should have default data directory', () => {
      const option = embedCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.defaultValue).toBe('./data');
    });

    it('should have default model', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.defaultValue).toBe('bge-m3');
    });

    it('should have default batch size', () => {
      const option = embedCommand.options.find((o) => o.long === '--batch-size');
      expect(option?.defaultValue).toBe('50');
    });

    it('should have resume default to false', () => {
      const option = embedCommand.options.find((o) => o.long === '--resume');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have dry-run default to false', () => {
      const option = embedCommand.options.find((o) => o.long === '--dry-run');
      expect(option?.defaultValue).toBe(false);
    });

    it('should have verbose default to false', () => {
      const option = embedCommand.options.find((o) => o.long === '--verbose');
      expect(option?.defaultValue).toBe(false);
    });
  });

  describe('valid models', () => {
    it('should support bge-m3 in description', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toContain('bge-m3');
    });

    it('should support bge-base in description', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toContain('bge-base');
    });

    it('should support bge-large in description', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toContain('bge-large');
    });

    it('should support gemma in description', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toContain('gemma');
    });

    it('should support gemma300 in description', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toContain('gemma300');
    });
  });

  describe('multi-model support', () => {
    it('should have --models option for multiple model selection', () => {
      const option = embedCommand.options.find((o) => o.long === '--models');
      expect(option).toBeDefined();
      expect(option?.description).toBeDefined();
    });
  });

  describe('option descriptions', () => {
    it('should have description for data-dir option', () => {
      const option = embedCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.description).toBeDefined();
      expect(option?.description).toContain('Data directory');
    });

    it('should have description for model option', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.description).toBeDefined();
    });

    it('should have description for batch-size option', () => {
      const option = embedCommand.options.find((o) => o.long === '--batch-size');
      expect(option?.description).toBeDefined();
    });

    it('should have description for resume option', () => {
      const option = embedCommand.options.find((o) => o.long === '--resume');
      expect(option?.description).toBeDefined();
    });

    it('should have description for ai-gateway option', () => {
      const option = embedCommand.options.find((o) => o.long === '--ai-gateway');
      expect(option?.description).toBeDefined();
    });

    it('should have description for output option', () => {
      const option = embedCommand.options.find((o) => o.long === '--output');
      expect(option?.description).toBeDefined();
    });

    it('should have description for max-articles option', () => {
      const option = embedCommand.options.find((o) => o.long === '--max-articles');
      expect(option?.description).toBeDefined();
    });
  });

  describe('option flags', () => {
    it('should have short flag for data-dir (-d)', () => {
      const option = embedCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.short).toBe('-d');
    });

    it('should have short flag for model (-m)', () => {
      const option = embedCommand.options.find((o) => o.long === '--model');
      expect(option?.short).toBe('-m');
    });

    it('should have short flag for batch-size (-b)', () => {
      const option = embedCommand.options.find((o) => o.long === '--batch-size');
      expect(option?.short).toBe('-b');
    });

    it('should have short flag for resume (-r)', () => {
      const option = embedCommand.options.find((o) => o.long === '--resume');
      expect(option?.short).toBe('-r');
    });

    it('should have short flag for output (-o)', () => {
      const option = embedCommand.options.find((o) => o.long === '--output');
      expect(option?.short).toBe('-o');
    });

    it('should have short flag for verbose (-v)', () => {
      const option = embedCommand.options.find((o) => o.long === '--verbose');
      expect(option?.short).toBe('-v');
    });
  });

  describe('command structure', () => {
    it('should have no required arguments', () => {
      const args = embedCommand.registeredArguments;
      expect(args.length).toBe(0);
    });
  });
});
