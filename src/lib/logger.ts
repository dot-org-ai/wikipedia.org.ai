/**
 * Structured Logger Utility
 *
 * A lightweight, structured logging utility for the Wikipedia pipeline.
 *
 * Features:
 * - Log levels: debug, info, warn, error
 * - Structured output with timestamp, level, context
 * - Environment-based level control (LOG_LEVEL env var)
 * - JSON output format option for production (LOG_FORMAT=json)
 * - Context-based child loggers for module-specific logging
 * - Request ID tracking for distributed tracing
 * - Structured context fields for log aggregation
 */

import { AsyncLocalStorage } from 'async_hooks';

/** Log levels in order of severity */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Request context stored in AsyncLocalStorage */
export interface RequestContext {
  /** Unique request ID for tracing */
  requestId: string;
  /** Additional context fields to include in all logs */
  fields?: Record<string, unknown>;
}

/** AsyncLocalStorage for request context propagation */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Generate a unique request ID
 * Uses crypto.randomUUID if available, falls back to timestamp-based ID
 */
export function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Run a function with request context
 * All logs within the callback will include the request ID
 */
export function withRequestContext<T>(
  context: RequestContext,
  fn: () => T
): T {
  return requestContextStorage.run(context, fn);
}

/**
 * Run an async function with request context
 * All logs within the callback will include the request ID
 */
export async function withRequestContextAsync<T>(
  context: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

/**
 * Get the current request context
 * Returns undefined if not within a request context
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

/**
 * Get the current request ID
 * Returns undefined if not within a request context
 */
export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/** Numeric values for log level comparison */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Log entry structure */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Logger context (module name) */
  context: string;
  /** Log message */
  message: string;
  /** Optional structured data */
  data?: Record<string, unknown>;
  /** Error stack trace (for error level) */
  stack?: string;
  /** Optional operation name */
  operation?: string;
  /** Request ID for tracing (from AsyncLocalStorage) */
  requestId?: string;
  /** Service name for log aggregation */
  service?: string;
  /** Environment (development, staging, production) */
  environment?: string;
  /** Hostname/worker ID */
  host?: string;
}

/** Logger configuration */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Output format: 'text' for human-readable, 'json' for structured */
  format: 'text' | 'json';
  /** Logger context (module name) */
  context: string;
  /** Whether to include timestamps */
  timestamps: boolean;
  /** Service name for log aggregation (defaults to 'wikipedia') */
  service?: string;
  /** Default fields to include in all log entries */
  defaultFields?: Record<string, unknown>;
}

/** Default configuration */
const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  format: 'text',
  context: 'app',
  timestamps: true,
  service: 'wikipedia',
};

/**
 * Get service name from environment variable
 */
function getServiceFromEnv(): string {
  return process.env['SERVICE_NAME'] ?? 'wikipedia';
}

/**
 * Get environment name from environment variable
 */
function getEnvironmentFromEnv(): string {
  return process.env['NODE_ENV'] ?? 'development';
}

/**
 * Get hostname from environment variable
 */
function getHostFromEnv(): string | undefined {
  return process.env['HOSTNAME'] ?? process.env['CF_WORKER_ID'] ?? undefined;
}

/**
 * Get log level from environment variable
 */
function getLogLevelFromEnv(): LogLevel {
  const envLevel = process.env['LOG_LEVEL']?.toLowerCase();
  if (envLevel && envLevel in LOG_LEVEL_VALUES) {
    return envLevel as LogLevel;
  }
  // Default to debug in development, info in production
  const nodeEnv = process.env['NODE_ENV'];
  return nodeEnv === 'development' ? 'debug' : 'info';
}

/**
 * Get log format from environment variable
 */
function getLogFormatFromEnv(): 'text' | 'json' {
  const envFormat = process.env['LOG_FORMAT']?.toLowerCase();
  if (envFormat === 'json') {
    return 'json';
  }
  // Default to JSON in production for log aggregation
  const nodeEnv = process.env['NODE_ENV'];
  return nodeEnv === 'production' ? 'json' : 'text';
}

/**
 * ANSI color codes for terminal output
 */
const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

/**
 * Level-specific colors
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.blue,
  warn: COLORS.yellow,
  error: COLORS.red,
};

/**
 * Level-specific labels
 */
const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

/**
 * Format a log entry as human-readable text
 */
function formatText(entry: LogEntry, config: LoggerConfig): string {
  const parts: string[] = [];

  // Timestamp
  if (config.timestamps) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    parts.push(`${COLORS.dim}${time}${COLORS.reset}`);
  }

  // Level with color
  const levelColor = LEVEL_COLORS[entry.level];
  const levelLabel = LEVEL_LABELS[entry.level];
  parts.push(`${levelColor}${levelLabel}${COLORS.reset}`);

  // Request ID if present (shortened for readability)
  if (entry.requestId) {
    const shortId = entry.requestId.split('-')[0] ?? entry.requestId.substring(0, 8);
    parts.push(`${COLORS.dim}[${shortId}]${COLORS.reset}`);
  }

  // Context
  parts.push(`${COLORS.cyan}[${entry.context}]${COLORS.reset}`);

  // Operation if present
  if (entry.operation) {
    parts.push(`${COLORS.dim}(${entry.operation})${COLORS.reset}`);
  }

  // Message
  parts.push(entry.message);

  // Data if present
  if (entry.data && Object.keys(entry.data).length > 0) {
    const dataStr = Object.entries(entry.data)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ');
    parts.push(`${COLORS.dim}${dataStr}${COLORS.reset}`);
  }

  let output = parts.join(' ');

  // Stack trace for errors
  if (entry.stack) {
    output += `\n${COLORS.dim}${entry.stack}${COLORS.reset}`;
  }

  return output;
}

/**
 * Format a log entry as JSON
 */
function formatJson(entry: LogEntry): string {
  return JSON.stringify(entry);
}

/**
 * Logger class for structured logging
 */
export class Logger {
  private readonly config: LoggerConfig;
  private readonly minLevel: number;
  private readonly service: string;
  private readonly environment: string;
  private readonly host: string | undefined;

  constructor(config: Partial<LoggerConfig> = {}) {
    const baseConfig = {
      ...DEFAULT_CONFIG,
      level: config.level ?? getLogLevelFromEnv(),
      format: config.format ?? getLogFormatFromEnv(),
      context: config.context ?? DEFAULT_CONFIG.context,
      timestamps: config.timestamps ?? DEFAULT_CONFIG.timestamps,
      service: config.service ?? getServiceFromEnv(),
    };
    // Only add defaultFields if defined
    if (config.defaultFields !== undefined) {
      (baseConfig as LoggerConfig).defaultFields = config.defaultFields;
    }
    this.config = baseConfig as LoggerConfig;
    this.minLevel = LOG_LEVEL_VALUES[this.config.level];
    this.service = this.config.service ?? 'wikipedia';
    this.environment = getEnvironmentFromEnv();
    this.host = getHostFromEnv();
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] >= this.minLevel;
  }

  /**
   * Write a log entry
   */
  private write(entry: LogEntry): void {
    const output =
      this.config.format === 'json'
        ? formatJson(entry)
        : formatText(entry, this.config);

    // Use stderr for warn and error, stdout for others
    if (entry.level === 'error' || entry.level === 'warn') {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  /**
   * Create a log entry and write it
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    operation?: string
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    // Get request context from AsyncLocalStorage
    const reqContext = getRequestContext();

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.config.context,
      message,
      service: this.service,
      environment: this.environment,
    };

    // Add request ID if available
    if (reqContext?.requestId) {
      entry.requestId = reqContext.requestId;
    }

    // Add host if available
    if (this.host) {
      entry.host = this.host;
    }

    // Merge default fields from config
    if (this.config.defaultFields) {
      entry.data = { ...this.config.defaultFields };
    }

    // Merge request context fields
    if (reqContext?.fields) {
      entry.data = { ...entry.data, ...reqContext.fields };
    }

    if (data) {
      // Extract error information if present
      if (data['error'] instanceof Error) {
        const error = data['error'];
        if (error.stack) {
          entry.stack = error.stack;
        }
        data = { ...data, error: error.message };
      }
      // Merge with existing data (default fields + context fields)
      entry.data = { ...entry.data, ...data };
    }

    if (operation) {
      entry.operation = operation;
    }

    this.write(entry);
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>, operation?: string): void {
    this.log('debug', message, data, operation);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>, operation?: string): void {
    this.log('info', message, data, operation);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>, operation?: string): void {
    this.log('warn', message, data, operation);
  }

  /**
   * Log an error message
   */
  error(message: string, data?: Record<string, unknown>, operation?: string): void {
    this.log('error', message, data, operation);
  }

  /**
   * Log an error with full stack trace
   */
  errorWithStack(
    message: string,
    error: Error,
    data?: Record<string, unknown>,
    operation?: string
  ): void {
    // Pass the Error object so the log() method can extract the stack trace
    // Also include errorName for additional context
    this.log(
      'error',
      message,
      { ...data, error, errorName: error.name },
      operation
    );
  }

  /**
   * Create a child logger with additional context
   */
  child(context: string): Logger {
    return new Logger({
      ...this.config,
      context: `${this.config.context}:${context}`,
    });
  }

  /**
   * Create a child logger for a specific operation
   */
  withOperation(operation: string): OperationLogger {
    return new OperationLogger(this, operation);
  }

  /**
   * Create a child logger with additional default fields
   * These fields will be included in all log entries
   */
  withFields(fields: Record<string, unknown>): Logger {
    return new Logger({
      ...this.config,
      defaultFields: { ...this.config.defaultFields, ...fields },
    });
  }

  /**
   * Get the current configuration
   */
  getConfig(): Readonly<LoggerConfig> {
    return { ...this.config };
  }
}

/**
 * Operation-scoped logger that automatically includes operation name
 */
export class OperationLogger {
  constructor(
    private readonly logger: Logger,
    private readonly operation: string
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.debug(message, data, this.operation);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.info(message, data, this.operation);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.logger.warn(message, data, this.operation);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.logger.error(message, data, this.operation);
  }
}

/**
 * Logger provider interface for dependency injection
 * Allows replacing the logger factory for testing or custom implementations
 */
export interface LoggerProvider {
  /** Create a logger for a specific context */
  createLogger(context: string): Logger;
  /** Get the default application logger */
  getDefaultLogger(): Logger;
}

/**
 * Default logger provider implementation
 */
class DefaultLoggerProvider implements LoggerProvider {
  private readonly defaultLogger: Logger;
  private readonly loggerCache = new Map<string, Logger>();

  constructor() {
    this.defaultLogger = new Logger({ context: 'wikipedia' });
  }

  createLogger(context: string): Logger {
    // Cache loggers by context to avoid creating duplicate instances
    let logger = this.loggerCache.get(context);
    if (!logger) {
      logger = new Logger({ context });
      this.loggerCache.set(context, logger);
    }
    return logger;
  }

  getDefaultLogger(): Logger {
    return this.defaultLogger;
  }
}

/**
 * Global logger provider instance - can be replaced for testing
 */
let loggerProvider: LoggerProvider = new DefaultLoggerProvider();

/**
 * Get the current logger provider
 */
export function getLoggerProvider(): LoggerProvider {
  return loggerProvider;
}

/**
 * Set a custom logger provider (useful for testing)
 * @param provider - Custom logger provider implementation
 * @returns The previous logger provider for restoration
 */
export function setLoggerProvider(provider: LoggerProvider): LoggerProvider {
  const previous = loggerProvider;
  loggerProvider = provider;
  return previous;
}

/**
 * Reset to the default logger provider
 */
export function resetLoggerProvider(): void {
  loggerProvider = new DefaultLoggerProvider();
}

/**
 * Create a logger for a specific module
 * Uses the current logger provider (supports dependency injection)
 */
export function createLogger(context: string): Logger {
  return loggerProvider.createLogger(context);
}

/**
 * Default application logger (accessed via provider for DI support)
 */
export const logger: Logger = {
  get debug() {
    return loggerProvider.getDefaultLogger().debug.bind(loggerProvider.getDefaultLogger());
  },
  get info() {
    return loggerProvider.getDefaultLogger().info.bind(loggerProvider.getDefaultLogger());
  },
  get warn() {
    return loggerProvider.getDefaultLogger().warn.bind(loggerProvider.getDefaultLogger());
  },
  get error() {
    return loggerProvider.getDefaultLogger().error.bind(loggerProvider.getDefaultLogger());
  },
  get errorWithStack() {
    return loggerProvider.getDefaultLogger().errorWithStack.bind(loggerProvider.getDefaultLogger());
  },
  get child() {
    return loggerProvider.getDefaultLogger().child.bind(loggerProvider.getDefaultLogger());
  },
  get withOperation() {
    return loggerProvider.getDefaultLogger().withOperation.bind(loggerProvider.getDefaultLogger());
  },
  get withFields() {
    return loggerProvider.getDefaultLogger().withFields.bind(loggerProvider.getDefaultLogger());
  },
  get getConfig() {
    return loggerProvider.getDefaultLogger().getConfig.bind(loggerProvider.getDefaultLogger());
  },
} as Logger;

/**
 * Pre-configured module loggers (accessed via provider for DI support)
 */
export const loggers = {
  get ingest() { return createLogger('ingest'); },
  get embeddings() { return createLogger('embeddings'); },
  get storage() { return createLogger('storage'); },
  get query() { return createLogger('query'); },
  get api() { return createLogger('api'); },
  get cli() { return createLogger('cli'); },
} as const;
