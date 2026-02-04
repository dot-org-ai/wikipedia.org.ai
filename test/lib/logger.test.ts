/**
 * Tests for Logger utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Logger,
  OperationLogger,
  createLogger,
  logger,
  loggers,
  getLoggerProvider,
  setLoggerProvider,
  resetLoggerProvider,
  generateRequestId,
  withRequestContext,
  withRequestContextAsync,
  getRequestContext,
  getRequestId,
  type LogLevel,
  type LogEntry,
  type LoggerProvider,
  type RequestContext,
} from '../../src/lib/logger.js';

describe('Logger', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    originalEnv = { ...process.env };
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create logger with default config', () => {
      const log = new Logger();
      const config = log.getConfig();

      expect(config.context).toBe('app');
      expect(config.timestamps).toBe(true);
    });

    it('should create logger with custom context', () => {
      const log = new Logger({ context: 'my-module' });
      expect(log.getConfig().context).toBe('my-module');
    });

    it('should create logger with custom level', () => {
      const log = new Logger({ level: 'error' });
      expect(log.getConfig().level).toBe('error');
    });

    it('should create logger with custom format', () => {
      const log = new Logger({ format: 'json' });
      expect(log.getConfig().format).toBe('json');
    });

    it('should respect LOG_LEVEL environment variable', () => {
      process.env['LOG_LEVEL'] = 'debug';
      const log = new Logger();
      expect(log.getConfig().level).toBe('debug');
    });

    it('should respect LOG_FORMAT environment variable', () => {
      process.env['LOG_FORMAT'] = 'json';
      const log = new Logger();
      expect(log.getConfig().format).toBe('json');
    });

    it('should default to debug in development', () => {
      delete process.env['LOG_LEVEL'];
      process.env['NODE_ENV'] = 'development';
      const log = new Logger();
      expect(log.getConfig().level).toBe('debug');
    });

    it('should default to info in production', () => {
      delete process.env['LOG_LEVEL'];
      process.env['NODE_ENV'] = 'production';
      const log = new Logger();
      expect(log.getConfig().level).toBe('info');
    });

    it('should default to json format in production', () => {
      delete process.env['LOG_FORMAT'];
      process.env['NODE_ENV'] = 'production';
      const log = new Logger();
      expect(log.getConfig().format).toBe('json');
    });
  });

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      const log = new Logger({ level: 'debug', format: 'json' });
      log.debug('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.level).toBe('debug');
      expect(output.message).toBe('test message');
    });

    it('should log info messages when level is info', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      log.info('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.level).toBe('info');
    });

    it('should log warn messages to stderr', () => {
      const log = new Logger({ level: 'warn', format: 'json' });
      log.warn('warning message');

      expect(consoleSpy.error).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.level).toBe('warn');
    });

    it('should log error messages to stderr', () => {
      const log = new Logger({ level: 'error', format: 'json' });
      log.error('error message');

      expect(consoleSpy.error).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.level).toBe('error');
    });

    it('should not log debug when level is info', () => {
      const log = new Logger({ level: 'info' });
      log.debug('should not appear');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });

    it('should not log info when level is warn', () => {
      const log = new Logger({ level: 'warn' });
      log.info('should not appear');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });

    it('should not log warn when level is error', () => {
      const log = new Logger({ level: 'error' });
      log.warn('should not appear');

      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('log output', () => {
    it('should include timestamp in JSON format', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      const before = new Date().toISOString();
      log.info('test');
      const after = new Date().toISOString();

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.timestamp).toBeDefined();
      expect(output.timestamp >= before).toBe(true);
      expect(output.timestamp <= after).toBe(true);
    });

    it('should include context in output', () => {
      const log = new Logger({ level: 'info', format: 'json', context: 'test-context' });
      log.info('test');

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.context).toBe('test-context');
    });

    it('should include data in output', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      log.info('test', { key: 'value', count: 42 });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.data).toEqual({ key: 'value', count: 42 });
    });

    it('should include operation in output', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      log.info('test', undefined, 'myOperation');

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.operation).toBe('myOperation');
    });

    it('should handle Error objects in data', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      const error = new Error('test error');
      log.info('test', { error });

      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.data.error).toBe('test error');
      expect(output.stack).toBeDefined();
    });
  });

  describe('text format', () => {
    it('should output human-readable text format', () => {
      const log = new Logger({ level: 'info', format: 'text', timestamps: false });
      log.info('test message');

      expect(consoleSpy.log).toHaveBeenCalled();
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('INFO');
      expect(output).toContain('test message');
    });

    it('should include data in text format', () => {
      const log = new Logger({ level: 'info', format: 'text', timestamps: false });
      log.info('test', { key: 'value' });

      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('key=');
      expect(output).toContain('"value"');
    });
  });

  describe('child logger', () => {
    it('should create child logger with extended context', () => {
      const parent = new Logger({ context: 'parent' });
      const child = parent.child('child');

      expect(child.getConfig().context).toBe('parent:child');
    });

    it('should inherit parent configuration', () => {
      const parent = new Logger({ level: 'warn', format: 'json' });
      const child = parent.child('child');

      expect(child.getConfig().level).toBe('warn');
      expect(child.getConfig().format).toBe('json');
    });
  });

  describe('withOperation', () => {
    it('should create OperationLogger', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      const opLog = log.withOperation('myOp');

      expect(opLog).toBeInstanceOf(OperationLogger);
    });

    it('should include operation name in all log calls', () => {
      const log = new Logger({ level: 'info', format: 'json' });
      const opLog = log.withOperation('myOp');

      opLog.info('test');
      const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
      expect(output.operation).toBe('myOp');
    });
  });

  describe('errorWithStack', () => {
    it('should log error with additional context', () => {
      const log = new Logger({ level: 'error', format: 'json' });
      const error = new Error('test error');
      error.name = 'TestError';

      log.errorWithStack('Error occurred', error, { context: 'test' });

      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.level).toBe('error');
      expect(output.message).toBe('Error occurred');
      expect(output.data.error).toBe('test error');
      expect(output.data.errorName).toBe('TestError');
      expect(output.data.context).toBe('test');
    });

    it('should include stack trace in output', () => {
      const log = new Logger({ level: 'error', format: 'json' });
      const error = new Error('test error');

      log.errorWithStack('Error occurred', error);

      const output = JSON.parse(consoleSpy.error.mock.calls[0][0]);
      expect(output.stack).toBeDefined();
      expect(output.stack).toContain('Error: test error');
    });
  });
});

describe('OperationLogger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log with operation name', () => {
    const parent = new Logger({ level: 'debug', format: 'json' });
    const opLog = new OperationLogger(parent, 'testOp');

    opLog.debug('debug msg');
    opLog.info('info msg');
    opLog.warn('warn msg');
    opLog.error('error msg');

    expect(consoleSpy.log).toHaveBeenCalledTimes(2); // debug + info
    expect(consoleSpy.error).toHaveBeenCalledTimes(2); // warn + error

    const debugOutput = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(debugOutput.operation).toBe('testOp');

    const warnOutput = JSON.parse(consoleSpy.error.mock.calls[0][0]);
    expect(warnOutput.operation).toBe('testOp');
  });

  it('should pass data to parent logger', () => {
    const parent = new Logger({ level: 'info', format: 'json' });
    const opLog = new OperationLogger(parent, 'testOp');

    opLog.info('test', { key: 'value' });

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.data).toEqual({ key: 'value' });
  });
});

describe('createLogger', () => {
  it('should create a logger with given context', () => {
    const log = createLogger('my-context');
    expect(log.getConfig().context).toBe('my-context');
  });
});

describe('logger (default export)', () => {
  it('should be a Logger instance or have Logger methods', () => {
    // The default export may be a Logger instance or an object with same interface
    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('should have wikipedia context', () => {
    expect(logger.getConfig().context).toBe('wikipedia');
  });
});

describe('loggers (pre-configured)', () => {
  it('should have all expected module loggers', () => {
    expect(loggers.ingest.getConfig().context).toBe('ingest');
    expect(loggers.embeddings.getConfig().context).toBe('embeddings');
    expect(loggers.storage.getConfig().context).toBe('storage');
    expect(loggers.query.getConfig().context).toBe('query');
    expect(loggers.api.getConfig().context).toBe('api');
    expect(loggers.cli.getConfig().context).toBe('cli');
  });
});

describe('Dependency Injection', () => {
  afterEach(() => {
    // Reset to default provider after each test
    resetLoggerProvider();
  });

  describe('LoggerProvider interface', () => {
    it('should allow creating custom logger providers', () => {
      // Create a mock logger that captures all calls
      const logCalls: Array<{ context: string; method: string; args: unknown[] }> = [];

      class MockLogger extends Logger {
        constructor(context: string) {
          super({ context, level: 'debug', format: 'json' });
        }

        info(message: string, data?: Record<string, unknown>, operation?: string): void {
          logCalls.push({ context: this.getConfig().context, method: 'info', args: [message, data, operation] });
        }
      }

      const mockProvider: LoggerProvider = {
        createLogger(context: string): Logger {
          return new MockLogger(context) as Logger;
        },
        getDefaultLogger(): Logger {
          return new MockLogger('mock-default') as Logger;
        },
      };

      // Set the mock provider
      const previous = setLoggerProvider(mockProvider);
      expect(previous).toBeDefined();

      // Now createLogger should use the mock provider
      const testLogger = createLogger('test-context');
      testLogger.info('test message', { key: 'value' });

      expect(logCalls.length).toBe(1);
      expect(logCalls[0]?.context).toBe('test-context');
      expect(logCalls[0]?.method).toBe('info');
      expect(logCalls[0]?.args[0]).toBe('test message');
    });

    it('should restore previous provider when calling setLoggerProvider', () => {
      const originalProvider = getLoggerProvider();

      const customProvider: LoggerProvider = {
        createLogger: (ctx) => new Logger({ context: `custom:${ctx}` }),
        getDefaultLogger: () => new Logger({ context: 'custom-default' }),
      };

      const previous = setLoggerProvider(customProvider);
      expect(previous).toBe(originalProvider);

      // Verify custom provider is active
      const log = createLogger('test');
      expect(log.getConfig().context).toBe('custom:test');

      // Restore
      setLoggerProvider(previous);
      const restoredLog = createLogger('test');
      expect(restoredLog.getConfig().context).toBe('test');
    });
  });

  describe('resetLoggerProvider', () => {
    it('should reset to default provider', () => {
      const customProvider: LoggerProvider = {
        createLogger: (ctx) => new Logger({ context: `custom:${ctx}` }),
        getDefaultLogger: () => new Logger({ context: 'custom-default' }),
      };

      setLoggerProvider(customProvider);
      expect(createLogger('test').getConfig().context).toBe('custom:test');

      resetLoggerProvider();
      expect(createLogger('test').getConfig().context).toBe('test');
    });
  });

  describe('getLoggerProvider', () => {
    it('should return current provider', () => {
      const provider = getLoggerProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.createLogger).toBe('function');
      expect(typeof provider.getDefaultLogger).toBe('function');
    });
  });

  describe('default logger proxy', () => {
    it('should delegate to current provider default logger', () => {
      let callCount = 0;

      const mockProvider: LoggerProvider = {
        createLogger: (ctx) => new Logger({ context: ctx }),
        getDefaultLogger: () => {
          callCount++;
          return new Logger({ context: 'mock-default' });
        },
      };

      setLoggerProvider(mockProvider);

      // Accessing logger methods should call getDefaultLogger
      logger.getConfig();
      expect(callCount).toBeGreaterThan(0);
    });
  });

  describe('loggers proxy', () => {
    it('should use current provider for module loggers', () => {
      const customProvider: LoggerProvider = {
        createLogger: (ctx) => new Logger({ context: `injected:${ctx}` }),
        getDefaultLogger: () => new Logger({ context: 'injected-default' }),
      };

      setLoggerProvider(customProvider);

      // Module loggers should use the injected provider
      expect(loggers.ingest.getConfig().context).toBe('injected:ingest');
      expect(loggers.api.getConfig().context).toBe('injected:api');
    });
  });

  describe('testability improvements', () => {
    it('should allow silencing logs in tests', () => {
      // Create a null logger that discards all output
      class NullLogger extends Logger {
        debug(): void {}
        info(): void {}
        warn(): void {}
        error(): void {}
      }

      const silentProvider: LoggerProvider = {
        createLogger: () => new NullLogger() as Logger,
        getDefaultLogger: () => new NullLogger() as Logger,
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      setLoggerProvider(silentProvider);

      // These should not output anything
      const log = createLogger('test');
      log.info('this should be silent');
      log.error('this should also be silent');

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should allow capturing logs in tests', () => {
      const capturedLogs: Array<{ level: string; message: string; context: string }> = [];

      class CapturingLogger extends Logger {
        private ctx: string;

        constructor(context: string) {
          super({ context, level: 'debug' });
          this.ctx = context;
        }

        info(message: string): void {
          capturedLogs.push({ level: 'info', message, context: this.ctx });
        }

        error(message: string): void {
          capturedLogs.push({ level: 'error', message, context: this.ctx });
        }
      }

      const capturingProvider: LoggerProvider = {
        createLogger: (ctx) => new CapturingLogger(ctx) as Logger,
        getDefaultLogger: () => new CapturingLogger('default') as Logger,
      };

      setLoggerProvider(capturingProvider);

      const log1 = createLogger('module-a');
      const log2 = createLogger('module-b');

      log1.info('message from A');
      log2.error('error from B');

      expect(capturedLogs).toHaveLength(2);
      expect(capturedLogs[0]).toEqual({ level: 'info', message: 'message from A', context: 'module-a' });
      expect(capturedLogs[1]).toEqual({ level: 'error', message: 'error from B', context: 'module-b' });
    });
  });
});

describe('Request Context', () => {
  describe('generateRequestId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      const id3 = generateRequestId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id3).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
    });

    it('should generate string IDs', () => {
      const id = generateRequestId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe('withRequestContext', () => {
    it('should provide context within callback', () => {
      const requestId = 'test-request-123';
      let capturedContext: RequestContext | undefined;

      withRequestContext({ requestId }, () => {
        capturedContext = getRequestContext();
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.requestId).toBe(requestId);
    });

    it('should return callback result', () => {
      const result = withRequestContext({ requestId: 'test' }, () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should include additional fields', () => {
      const fields = { userId: 'user-123', tenant: 'acme' };
      let capturedContext: RequestContext | undefined;

      withRequestContext({ requestId: 'test', fields }, () => {
        capturedContext = getRequestContext();
      });

      expect(capturedContext?.fields).toEqual(fields);
    });

    it('should not leak context outside callback', () => {
      withRequestContext({ requestId: 'test' }, () => {
        // Context available here
        expect(getRequestContext()).toBeDefined();
      });

      // Context not available outside
      expect(getRequestContext()).toBeUndefined();
    });
  });

  describe('withRequestContextAsync', () => {
    it('should provide context within async callback', async () => {
      const requestId = 'test-async-123';
      let capturedContext: RequestContext | undefined;

      await withRequestContextAsync({ requestId }, async () => {
        await Promise.resolve();
        capturedContext = getRequestContext();
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.requestId).toBe(requestId);
    });

    it('should return async callback result', async () => {
      const result = await withRequestContextAsync({ requestId: 'test' }, async () => {
        await Promise.resolve();
        return 'async-result';
      });

      expect(result).toBe('async-result');
    });
  });

  describe('getRequestId', () => {
    it('should return undefined outside context', () => {
      expect(getRequestId()).toBeUndefined();
    });

    it('should return request ID within context', () => {
      withRequestContext({ requestId: 'my-request-id' }, () => {
        expect(getRequestId()).toBe('my-request-id');
      });
    });
  });
});

describe('Logger with Request Context', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include request ID in JSON output', () => {
    const log = new Logger({ level: 'info', format: 'json' });
    const requestId = 'trace-123-456';

    withRequestContext({ requestId }, () => {
      log.info('test message');
    });

    expect(consoleSpy.log).toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.requestId).toBe(requestId);
  });

  it('should include context fields in JSON output', () => {
    const log = new Logger({ level: 'info', format: 'json' });
    const fields = { userId: 'user-abc', action: 'search' };

    withRequestContext({ requestId: 'test', fields }, () => {
      log.info('test message');
    });

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.data?.userId).toBe('user-abc');
    expect(output.data?.action).toBe('search');
  });

  it('should merge context fields with log data', () => {
    const log = new Logger({ level: 'info', format: 'json' });
    const fields = { contextField: 'from-context' };

    withRequestContext({ requestId: 'test', fields }, () => {
      log.info('test message', { logField: 'from-log' });
    });

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.data?.contextField).toBe('from-context');
    expect(output.data?.logField).toBe('from-log');
  });

  it('should include service and environment in JSON output', () => {
    const log = new Logger({ level: 'info', format: 'json', service: 'my-service' });
    log.info('test message');

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.service).toBe('my-service');
    expect(output.environment).toBeDefined();
  });
});

describe('Logger.withFields', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create child logger with default fields', () => {
    const log = new Logger({ level: 'info', format: 'json' });
    const childLog = log.withFields({ component: 'database', version: '1.0' });

    childLog.info('query executed');

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.data?.component).toBe('database');
    expect(output.data?.version).toBe('1.0');
  });

  it('should merge with existing default fields', () => {
    const log = new Logger({ level: 'info', format: 'json', defaultFields: { app: 'wikipedia' } });
    const childLog = log.withFields({ component: 'search' });

    childLog.info('search performed');

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.data?.app).toBe('wikipedia');
    expect(output.data?.component).toBe('search');
  });

  it('should allow chaining withFields', () => {
    const log = new Logger({ level: 'info', format: 'json' });
    const childLog = log
      .withFields({ a: 1 })
      .withFields({ b: 2 })
      .withFields({ c: 3 });

    childLog.info('test');

    const output = JSON.parse(consoleSpy.log.mock.calls[0][0]);
    expect(output.data?.a).toBe(1);
    expect(output.data?.b).toBe(2);
    expect(output.data?.c).toBe(3);
  });
});
