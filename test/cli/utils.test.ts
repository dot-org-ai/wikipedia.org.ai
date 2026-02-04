/**
 * Tests for CLI utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  color,
  supportsColor,
  stripAnsi,
  formatBytes,
  formatDuration,
  formatNumber,
  formatTable,
  loadConfig,
  truncate,
  parseList,
  resolvePath,
  createProgressBar,
  createSpinner,
} from '../../src/cli/utils.js';

// Mock fs/promises for loadConfig tests
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

describe('CLI Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('color helpers', () => {
    it('should apply color codes', () => {
      const result = color.red('error');
      expect(result).toContain('\x1b[31m');
      expect(result).toContain('error');
      expect(result).toContain('\x1b[0m');
    });

    it('should apply green color', () => {
      const result = color.green('success');
      expect(result).toContain('\x1b[32m');
      expect(result).toContain('success');
    });

    it('should apply cyan color', () => {
      const result = color.cyan('info');
      expect(result).toContain('\x1b[36m');
      expect(result).toContain('info');
    });

    it('should apply yellow/warning color', () => {
      const result = color.yellow('warning');
      expect(result).toContain('\x1b[33m');
      expect(result).toContain('warning');
    });

    it('should apply bold formatting', () => {
      const result = color.bold('important');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('important');
    });

    it('should apply dim formatting', () => {
      const result = color.dim('subtle');
      expect(result).toContain('\x1b[2m');
      expect(result).toContain('subtle');
    });

    it('should apply success styling (green bold)', () => {
      const result = color.success('done');
      expect(result).toContain('\x1b[32m');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('done');
    });

    it('should apply error styling (red bold)', () => {
      const result = color.error('failed');
      expect(result).toContain('\x1b[31m');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('failed');
    });
  });

  describe('supportsColor', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Reset env for each test
      delete process.env['NO_COLOR'];
      delete process.env['FORCE_COLOR'];
    });

    afterEach(() => {
      // Restore original env
      process.env = { ...originalEnv };
    });

    it('should return false when NO_COLOR is set', () => {
      process.env['NO_COLOR'] = '1';
      expect(supportsColor()).toBe(false);
    });

    it('should return false when FORCE_COLOR is 0', () => {
      process.env['FORCE_COLOR'] = '0';
      expect(supportsColor()).toBe(false);
    });

    it('should return true when FORCE_COLOR is set (non-zero)', () => {
      process.env['FORCE_COLOR'] = '1';
      expect(supportsColor()).toBe(true);
    });
  });

  describe('stripAnsi', () => {
    it('should strip ANSI color codes', () => {
      const colored = '\x1b[31mred text\x1b[0m';
      expect(stripAnsi(colored)).toBe('red text');
    });

    it('should strip multiple ANSI codes', () => {
      const colored = '\x1b[1m\x1b[32mbold green\x1b[0m';
      expect(stripAnsi(colored)).toBe('bold green');
    });

    it('should handle strings without ANSI codes', () => {
      const plain = 'plain text';
      expect(stripAnsi(plain)).toBe('plain text');
    });

    it('should handle empty strings', () => {
      expect(stripAnsi('')).toBe('');
    });
  });

  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(125)).toBe('2m 5s');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(3660)).toBe('1h 1m');
      expect(formatDuration(7200)).toBe('2h 0m');
    });

    it('should handle negative values', () => {
      expect(formatDuration(-1)).toBe('--:--');
    });

    it('should handle infinity', () => {
      expect(formatDuration(Infinity)).toBe('--:--');
    });

    it('should handle NaN', () => {
      expect(formatDuration(NaN)).toBe('--:--');
    });
  });

  describe('formatNumber', () => {
    it('should format numbers with commas', () => {
      expect(formatNumber(1000)).toBe('1,000');
      expect(formatNumber(1000000)).toBe('1,000,000');
    });

    it('should handle small numbers', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(100)).toBe('100');
    });

    it('should handle decimal numbers', () => {
      // The function uses toLocaleString which may round
      const result = formatNumber(1234.5678);
      expect(result).toContain('1,234');
    });
  });

  describe('formatTable', () => {
    it('should format empty array', () => {
      expect(formatTable([])).toBe('');
    });

    it('should format table with data', () => {
      const rows = [
        { name: 'Alice', age: '30' },
        { name: 'Bob', age: '25' },
      ];
      const result = formatTable(rows);
      expect(result).toContain('name');
      expect(result).toContain('age');
      expect(result).toContain('Alice');
      expect(result).toContain('Bob');
    });

    it('should format table with specific columns', () => {
      const rows = [
        { name: 'Alice', age: '30', city: 'NYC' },
        { name: 'Bob', age: '25', city: 'LA' },
      ];
      const result = formatTable(rows, ['name', 'city']);
      expect(result).toContain('name');
      expect(result).toContain('city');
      expect(result).toContain('Alice');
      expect(result).toContain('NYC');
    });

    it('should handle custom padding', () => {
      const rows = [{ col1: 'a', col2: 'b' }];
      const result = formatTable(rows, undefined, { padding: 4 });
      expect(result).toBeDefined();
    });

    it('should optionally hide header', () => {
      const rows = [{ name: 'Alice' }];
      const result = formatTable(rows, ['name'], { header: false });
      expect(result).toContain('Alice');
    });
  });

  describe('loadConfig', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      mockReadFile.mockReset();
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      // Clear relevant env vars
      delete process.env['WIKIPEDIA_DATA_DIR'];
      delete process.env['WIKIPEDIA_AI_GATEWAY_URL'];
      delete process.env['CLOUDFLARE_ACCOUNT_ID'];
      delete process.env['CLOUDFLARE_API_TOKEN'];
      delete process.env['CF_API_TOKEN'];
      delete process.env['WIKIPEDIA_MODEL'];
      delete process.env['WIKIPEDIA_BATCH_SIZE'];
      delete process.env['WIKIPEDIA_PORT'];
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should return empty config when no files or env vars', async () => {
      const config = await loadConfig();
      expect(config).toEqual({});
    });

    it('should load config from file', async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ dataDir: '/custom/data', port: 9000 })
      );

      const config = await loadConfig();
      expect(config.dataDir).toBe('/custom/data');
      expect(config.port).toBe(9000);
    });

    it('should override with environment variables', async () => {
      process.env['WIKIPEDIA_DATA_DIR'] = '/env/data';
      process.env['CLOUDFLARE_ACCOUNT_ID'] = 'test-account';
      process.env['CLOUDFLARE_API_TOKEN'] = 'test-token';
      process.env['WIKIPEDIA_PORT'] = '8888';

      const config = await loadConfig();
      expect(config.dataDir).toBe('/env/data');
      expect(config.accountId).toBe('test-account');
      expect(config.apiToken).toBe('test-token');
      expect(config.port).toBe(8888);
    });

    it('should handle AI gateway URL env var', async () => {
      process.env['WIKIPEDIA_AI_GATEWAY_URL'] = 'https://custom.gateway.ai';
      const config = await loadConfig();
      expect(config.aiGatewayUrl).toBe('https://custom.gateway.ai');
    });

    it('should handle model env var', async () => {
      process.env['WIKIPEDIA_MODEL'] = 'bge-large';
      const config = await loadConfig();
      expect(config.defaultModel).toBe('bge-large');
    });

    it('should handle batch size env var', async () => {
      process.env['WIKIPEDIA_BATCH_SIZE'] = '100';
      const config = await loadConfig();
      expect(config.batchSize).toBe(100);
    });

    it('should use CF_API_TOKEN as fallback', async () => {
      process.env['CF_API_TOKEN'] = 'cf-token';
      const config = await loadConfig();
      expect(config.apiToken).toBe('cf-token');
    });
  });

  describe('truncate', () => {
    it('should not truncate short strings', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    it('should truncate long strings with ellipsis', () => {
      expect(truncate('hello world', 8)).toBe('hello...');
    });

    it('should handle exact length', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });

    it('should handle empty strings', () => {
      expect(truncate('', 10)).toBe('');
    });

    it('should handle very short max length', () => {
      expect(truncate('hello', 4)).toBe('h...');
    });
  });

  describe('parseList', () => {
    it('should parse comma-separated values', () => {
      expect(parseList('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('should trim whitespace', () => {
      expect(parseList('a, b , c')).toEqual(['a', 'b', 'c']);
    });

    it('should filter empty strings', () => {
      expect(parseList('a,,b,,,c')).toEqual(['a', 'b', 'c']);
    });

    it('should handle single value', () => {
      expect(parseList('single')).toEqual(['single']);
    });

    it('should handle empty string', () => {
      expect(parseList('')).toEqual([]);
    });
  });

  describe('resolvePath', () => {
    it('should resolve absolute paths', () => {
      expect(resolvePath('/absolute/path')).toBe('/absolute/path');
    });

    it('should expand tilde to home directory', () => {
      const result = resolvePath('~/documents');
      expect(result).toContain('/documents');
      expect(result.startsWith('/')).toBe(true);
    });

    it('should resolve relative paths to cwd', () => {
      const result = resolvePath('relative/path');
      expect(result).toContain('relative/path');
      expect(result.startsWith('/')).toBe(true);
    });
  });

  describe('createProgressBar', () => {
    let mockStream: { write: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockStream = { write: vi.fn() };
    });

    it('should create a progress bar', () => {
      const progress = createProgressBar({
        total: 100,
        stream: mockStream as unknown as NodeJS.WriteStream,
      });

      expect(progress).toHaveProperty('update');
      expect(progress).toHaveProperty('complete');
      expect(progress).toHaveProperty('interrupt');
    });

    it('should update progress', () => {
      const progress = createProgressBar({
        total: 100,
        stream: mockStream as unknown as NodeJS.WriteStream,
      });

      progress.update(50);
      expect(mockStream.write).toHaveBeenCalled();
    });

    it('should complete progress', () => {
      const progress = createProgressBar({
        total: 100,
        stream: mockStream as unknown as NodeJS.WriteStream,
      });

      progress.complete();
      expect(mockStream.write).toHaveBeenCalled();
    });

    it('should interrupt with message', () => {
      const progress = createProgressBar({
        total: 100,
        stream: mockStream as unknown as NodeJS.WriteStream,
      });

      progress.interrupt('Interrupted!');
      expect(mockStream.write).toHaveBeenCalled();
      // The message should be written
      const calls = mockStream.write.mock.calls.flat().join('');
      expect(calls).toContain('Interrupted!');
    });

    it('should support custom format', () => {
      const progress = createProgressBar({
        total: 100,
        format: ':bar :percent',
        stream: mockStream as unknown as NodeJS.WriteStream,
      });

      progress.update(50);
      const output = mockStream.write.mock.calls.flat().join('');
      // Should contain percentage
      expect(output).toContain('%');
    });

    it('should support custom tokens', () => {
      const progress = createProgressBar({
        total: 100,
        format: ':bar :customToken',
        stream: mockStream as unknown as NodeJS.WriteStream,
      });

      progress.update(50, { customToken: 'custom-value' });
      const output = mockStream.write.mock.calls.flat().join('');
      expect(output).toContain('custom-value');
    });
  });

  describe('createSpinner', () => {
    let mockStream: { write: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      vi.useFakeTimers();
      mockStream = { write: vi.fn() };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should create a spinner', () => {
      const spinner = createSpinner('Loading...', mockStream as unknown as NodeJS.WriteStream);

      expect(spinner).toHaveProperty('update');
      expect(spinner).toHaveProperty('success');
      expect(spinner).toHaveProperty('fail');
      expect(spinner).toHaveProperty('stop');

      spinner.stop();
    });

    it('should animate spinner frames', () => {
      const spinner = createSpinner('Loading...', mockStream as unknown as NodeJS.WriteStream);

      // Initial render
      expect(mockStream.write).toHaveBeenCalled();

      // Advance time to trigger animation
      vi.advanceTimersByTime(100);
      expect(mockStream.write.mock.calls.length).toBeGreaterThan(1);

      spinner.stop();
    });

    it('should update message', () => {
      const spinner = createSpinner('Initial', mockStream as unknown as NodeJS.WriteStream);

      spinner.update('Updated message');
      vi.advanceTimersByTime(100);

      const calls = mockStream.write.mock.calls.flat().join('');
      expect(calls).toContain('Updated message');

      spinner.stop();
    });

    it('should show success', () => {
      const spinner = createSpinner('Working...', mockStream as unknown as NodeJS.WriteStream);

      spinner.success('Done!');

      const calls = mockStream.write.mock.calls.flat().join('');
      expect(calls).toContain('Done!');
    });

    it('should show failure', () => {
      const spinner = createSpinner('Working...', mockStream as unknown as NodeJS.WriteStream);

      spinner.fail('Error occurred');

      const calls = mockStream.write.mock.calls.flat().join('');
      expect(calls).toContain('Error occurred');
    });

    it('should stop cleanly', () => {
      const spinner = createSpinner('Working...', mockStream as unknown as NodeJS.WriteStream);

      spinner.stop();

      // Advancing time should not cause more writes after stop
      const writeCountAfterStop = mockStream.write.mock.calls.length;
      vi.advanceTimersByTime(200);
      expect(mockStream.write.mock.calls.length).toBe(writeCountAfterStop);
    });
  });
});
