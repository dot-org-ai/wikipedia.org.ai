/**
 * Tests for the serve CLI command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serveCommand } from '../../src/cli/serve.js';

describe('Serve Command', () => {
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
      expect(serveCommand.name()).toBe('serve');
      expect(serveCommand.description()).toContain('Start local API server');
    });

    it('should have port option', () => {
      const option = serveCommand.options.find((o) => o.short === '-p');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--port');
    });

    it('should have data-dir option', () => {
      const option = serveCommand.options.find((o) => o.short === '-d');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--data-dir');
    });

    it('should have cors option', () => {
      const option = serveCommand.options.find((o) => o.long === '--cors');
      expect(option).toBeDefined();
    });

    it('should have host option', () => {
      const option = serveCommand.options.find((o) => o.short === '-H');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--host');
    });

    it('should have verbose option', () => {
      const option = serveCommand.options.find((o) => o.short === '-v');
      expect(option).toBeDefined();
      expect(option?.long).toBe('--verbose');
    });
  });

  describe('option defaults', () => {
    it('should have default port', () => {
      const option = serveCommand.options.find((o) => o.long === '--port');
      expect(option?.defaultValue).toBe('8080');
    });

    it('should have default data directory', () => {
      const option = serveCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.defaultValue).toBe('./data');
    });

    it('should have cors enabled by default', () => {
      const option = serveCommand.options.find((o) => o.long === '--cors');
      expect(option?.defaultValue).toBe(true);
    });

    it('should have default host', () => {
      const option = serveCommand.options.find((o) => o.long === '--host');
      expect(option?.defaultValue).toBe('0.0.0.0');
    });

    it('should have verbose default to false', () => {
      const option = serveCommand.options.find((o) => o.long === '--verbose');
      expect(option?.defaultValue).toBe(false);
    });
  });

  describe('option descriptions', () => {
    it('should have description for port option', () => {
      const option = serveCommand.options.find((o) => o.long === '--port');
      expect(option?.description).toBeDefined();
    });

    it('should have description for data-dir option', () => {
      const option = serveCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.description).toBeDefined();
    });

    it('should have description for cors option', () => {
      const option = serveCommand.options.find((o) => o.long === '--cors');
      expect(option?.description).toBeDefined();
    });

    it('should have description for host option', () => {
      const option = serveCommand.options.find((o) => o.long === '--host');
      expect(option?.description).toBeDefined();
    });

    it('should have description for verbose option', () => {
      const option = serveCommand.options.find((o) => o.long === '--verbose');
      expect(option?.description).toBeDefined();
    });
  });

  describe('option flags', () => {
    it('should have short flag for port (-p)', () => {
      const option = serveCommand.options.find((o) => o.long === '--port');
      expect(option?.short).toBe('-p');
    });

    it('should have short flag for data-dir (-d)', () => {
      const option = serveCommand.options.find((o) => o.long === '--data-dir');
      expect(option?.short).toBe('-d');
    });

    it('should have short flag for host (-H)', () => {
      const option = serveCommand.options.find((o) => o.long === '--host');
      expect(option?.short).toBe('-H');
    });

    it('should have short flag for verbose (-v)', () => {
      const option = serveCommand.options.find((o) => o.long === '--verbose');
      expect(option?.short).toBe('-v');
    });
  });

  describe('command structure', () => {
    it('should have no required arguments', () => {
      const args = serveCommand.registeredArguments;
      expect(args.length).toBe(0);
    });
  });

  describe('CORS configuration', () => {
    it('should enable CORS by default', () => {
      const option = serveCommand.options.find((o) => o.long === '--cors');
      expect(option?.defaultValue).toBe(true);
    });

    it('should have CORS description', () => {
      const option = serveCommand.options.find((o) => o.long === '--cors');
      expect(option?.description).toContain('CORS');
    });
  });

  describe('host configuration', () => {
    it('should bind to 0.0.0.0 by default for network access', () => {
      const option = serveCommand.options.find((o) => o.long === '--host');
      expect(option?.defaultValue).toBe('0.0.0.0');
    });
  });

  describe('server port', () => {
    it('should use 8080 as default port', () => {
      const option = serveCommand.options.find((o) => o.long === '--port');
      expect(option?.defaultValue).toBe('8080');
    });
  });
});
