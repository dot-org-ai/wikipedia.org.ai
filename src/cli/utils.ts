/**
 * CLI Utilities
 *
 * Shared utilities for the Wikipedia CLI commands.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createLogger } from '../lib/logger.js';
import {
  type CliConfig,
  safeValidateCliConfig,
  formatValidationError,
} from '../lib/config-schema.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('cli');

/** ANSI color codes */
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
} as const;

/** Color output helpers */
export const color = {
  reset: (s: string) => `${colors.reset}${s}${colors.reset}`,
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  magenta: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  white: (s: string) => `${colors.white}${s}${colors.reset}`,
  gray: (s: string) => `${colors.gray}${s}${colors.reset}`,
  success: (s: string) => `${colors.green}${colors.bold}${s}${colors.reset}`,
  error: (s: string) => `${colors.red}${colors.bold}${s}${colors.reset}`,
  warning: (s: string) => `${colors.yellow}${colors.bold}${s}${colors.reset}`,
  info: (s: string) => `${colors.cyan}${s}${colors.reset}`,
};

/** Check if color output is supported */
export function supportsColor(): boolean {
  if (process.env['NO_COLOR'] || process.env['FORCE_COLOR'] === '0') {
    return false;
  }
  if (process.env['FORCE_COLOR']) {
    return true;
  }
  return process.stdout.isTTY ?? false;
}

/** Strip ANSI codes from string */
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Progress bar configuration */
export interface ProgressBarConfig {
  /** Total items to process */
  total: number;
  /** Bar width in characters */
  width?: number;
  /** Format string: :bar :current/:total :percent :eta */
  format?: string;
  /** Stream to write to */
  stream?: NodeJS.WriteStream;
  /** Clear on complete */
  clearOnComplete?: boolean;
  /** Show ETA */
  showEta?: boolean;
}

/** Progress bar state */
export interface ProgressBarState {
  current: number;
  total: number;
  startTime: number;
  rate: number;
}

/**
 * Create a progress bar
 */
export function createProgressBar(config: ProgressBarConfig): {
  update: (current: number, tokens?: Record<string, string | number>) => void;
  complete: () => void;
  interrupt: (message: string) => void;
} {
  const {
    total,
    width = 40,
    format = '  :bar :percent | :current/:total | :rate/s | ETA :eta',
    stream = process.stderr,
    clearOnComplete = true,
    showEta = true,
  } = config;

  let startTime = 0;
  let lastCurrent = 0;
  let lastTime = 0;
  let smoothRate = 0;

  function render(current: number, tokens: Record<string, string | number> = {}): void {
    if (startTime === 0) {
      startTime = Date.now();
      lastTime = startTime;
    }

    const now = Date.now();
    const elapsed = (now - startTime) / 1000;

    // Calculate smoothed rate
    if (now - lastTime > 100) {
      const instantRate = (current - lastCurrent) / ((now - lastTime) / 1000);
      smoothRate = smoothRate === 0 ? instantRate : smoothRate * 0.8 + instantRate * 0.2;
      lastCurrent = current;
      lastTime = now;
    }

    const rate = smoothRate || (elapsed > 0 ? current / elapsed : 0);
    const percent = total > 0 ? current / total : 0;
    const remaining = total > 0 ? total - current : 0;
    const eta = rate > 0 ? remaining / rate : 0;

    // Build progress bar
    const filled = Math.round(width * percent);
    const empty = width - filled;
    const bar = color.green('█'.repeat(filled)) + color.gray('░'.repeat(empty));

    // Replace tokens in format
    let output = format
      .replace(':bar', bar)
      .replace(':current', formatNumber(current))
      .replace(':total', formatNumber(total))
      .replace(':percent', `${(percent * 100).toFixed(1)}%`.padStart(6))
      .replace(':rate', formatNumber(Math.round(rate)))
      .replace(':eta', showEta ? formatDuration(eta) : '')
      .replace(':elapsed', formatDuration(elapsed));

    // Apply custom tokens
    for (const [key, value] of Object.entries(tokens)) {
      output = output.replace(`:${key}`, String(value));
    }

    // Clear line and write
    stream.write(`\r${output}\x1b[K`);
  }

  function complete(): void {
    render(total);
    if (clearOnComplete) {
      stream.write('\r\x1b[K');
    } else {
      stream.write('\n');
    }
  }

  function interrupt(message: string): void {
    stream.write(`\r\x1b[K${message}\n`);
    if (lastCurrent > 0) {
      render(lastCurrent);
    }
  }

  return {
    update: render,
    complete,
    interrupt,
  };
}

/**
 * Spinner for indeterminate progress
 */
export function createSpinner(message: string, stream: NodeJS.WriteStream = process.stderr): {
  update: (msg: string) => void;
  success: (msg: string) => void;
  fail: (msg: string) => void;
  stop: () => void;
} {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let currentMessage = message;
  let interval: ReturnType<typeof setInterval> | null = null;

  function render(): void {
    const frame = color.cyan(frames[frameIndex] ?? '⠋');
    stream.write(`\r${frame} ${currentMessage}\x1b[K`);
    frameIndex = (frameIndex + 1) % frames.length;
  }

  // Start spinner
  interval = setInterval(render, 80);
  render();

  return {
    update(msg: string) {
      currentMessage = msg;
    },
    success(msg: string) {
      if (interval) clearInterval(interval);
      stream.write(`\r${color.green('✓')} ${msg}\x1b[K\n`);
    },
    fail(msg: string) {
      if (interval) clearInterval(interval);
      stream.write(`\r${color.red('✗')} ${msg}\x1b[K\n`);
    },
    stop() {
      if (interval) clearInterval(interval);
      stream.write('\r\x1b[K');
    },
  };
}

/**
 * Format bytes as human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i] ?? 'B'}`;
}

/**
 * Format duration as human-readable string
 */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

/**
 * Format number with commas
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Format table data
 */
export function formatTable(
  rows: Record<string, unknown>[],
  columns?: string[],
  options: { padding?: number; header?: boolean } = {}
): string {
  if (rows.length === 0) return '';

  const { padding = 2, header = true } = options;
  const firstRow = rows[0];
  const cols = columns || (firstRow ? Object.keys(firstRow) : []);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = col.length;
    for (const row of rows) {
      const value = String(row[col] ?? '');
      const stripped = stripAnsi(value);
      const currentWidth = widths[col] ?? 0;
      widths[col] = Math.max(currentWidth, stripped.length);
    }
  }

  const lines: string[] = [];
  const pad = ' '.repeat(padding);

  // Header
  if (header) {
    const headerLine = cols.map((col) => color.bold(col.padEnd(widths[col] ?? 0))).join(pad);
    lines.push(`    ${headerLine}`);
    const separator = cols.map((col) => color.dim('─'.repeat(widths[col] ?? 0))).join(pad);
    lines.push(`    ${separator}`);
  }

  // Rows
  for (const row of rows) {
    const rowLine = cols
      .map((col) => {
        const value = String(row[col] ?? '');
        const stripped = stripAnsi(value);
        const padLength = (widths[col] ?? 0) - stripped.length;
        return value + ' '.repeat(Math.max(0, padLength));
      })
      .join(pad);
    lines.push(`    ${rowLine}`);
  }

  return lines.join('\n');
}

// Re-export CliConfig type from schema for backwards compatibility
export type { CliConfig } from '../lib/config-schema.js';

/**
 * Load configuration from .wikipediarc or environment
 *
 * Configuration is loaded from (in order of precedence):
 * 1. Environment variables (highest priority)
 * 2. .wikipediarc in current directory
 * 3. .wikipediarc in home directory (lowest priority)
 *
 * @returns Validated CLI configuration
 * @throws {Error} If configuration validation fails
 */
export async function loadConfig(): Promise<CliConfig> {
  const config: Record<string, unknown> = {};

  // Check for config file in order: current dir, home dir
  const configPaths = [join(process.cwd(), '.wikipediarc'), join(homedir(), '.wikipediarc')];

  for (const configPath of configPaths) {
    try {
      const data = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, unknown>;
      Object.assign(config, parsed);
      break;
    } catch {
      // File doesn't exist or isn't valid JSON
    }
  }

  // Override with environment variables
  const envDataDir = process.env['WIKIPEDIA_DATA_DIR'];
  if (envDataDir) {
    config['dataDir'] = envDataDir;
  }
  const envAiGatewayUrl = process.env['WIKIPEDIA_AI_GATEWAY_URL'];
  if (envAiGatewayUrl) {
    config['aiGatewayUrl'] = envAiGatewayUrl;
  }
  const envAccountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  if (envAccountId) {
    config['accountId'] = envAccountId;
  }
  const envApiToken = process.env['CLOUDFLARE_API_TOKEN'] ?? process.env['CF_API_TOKEN'];
  if (envApiToken) {
    config['apiToken'] = envApiToken;
  }
  const envModel = process.env['WIKIPEDIA_MODEL'];
  if (envModel) {
    config['defaultModel'] = envModel;
  }
  const envBatchSize = process.env['WIKIPEDIA_BATCH_SIZE'];
  if (envBatchSize) {
    config['batchSize'] = parseInt(envBatchSize, 10);
  }
  const envPort = process.env['WIKIPEDIA_PORT'];
  if (envPort) {
    config['port'] = parseInt(envPort, 10);
  }

  // Validate configuration with Zod
  const result = safeValidateCliConfig(config);
  if (!result.success) {
    const errorMessage = formatValidationError(result.error);
    throw new Error(`Invalid configuration:\n${errorMessage}`);
  }

  return result.data;
}

/**
 * Print error message and exit
 */
export function fatal(message: string): never {
  getLog().error(message, undefined, 'fatal');
  console.error(`\n${color.error('Error:')} ${message}\n`);
  process.exit(1);
}

/**
 * Print warning message
 */
export function warn(message: string): void {
  getLog().warn(message);
  console.error(`${color.warning('Warning:')} ${message}`);
}

/**
 * Print info message
 */
export function info(message: string): void {
  getLog().info(message);
  console.log(`${color.info('Info:')} ${message}`);
}

/**
 * Confirm action with user
 */
export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const prompt = `${message} ${defaultValue ? '[Y/n]' : '[y/N]'}: `;
  process.stdout.write(prompt);

  return new Promise((resolve) => {
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdout.write('\n');

      const char = data.toString().toLowerCase().trim();
      if (char === '') {
        resolve(defaultValue);
      } else {
        resolve(char === 'y');
      }
    });
  });
}

/**
 * Truncate string to length with ellipsis
 */
export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength - 3) + '...';
}

/**
 * Parse comma-separated list
 */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve path relative to cwd or absolute
 */
export function resolvePath(p: string): string {
  if (p.startsWith('/') || p.startsWith('~')) {
    return p.replace('~', homedir());
  }
  return join(process.cwd(), p);
}
