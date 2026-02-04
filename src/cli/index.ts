/**
 * CLI Module Exports
 *
 * Re-exports all CLI commands and utilities.
 */

// Commands
export { ingestCommand } from './ingest.js';
export { embedCommand } from './embed.js';
export { queryCommand } from './query.js';
export { serveCommand } from './serve.js';
export { buildIndexesCommand, buildIndexes } from './build-indexes.js';

// Utilities
export {
  color,
  supportsColor,
  stripAnsi,
  createProgressBar,
  createSpinner,
  formatBytes,
  formatDuration,
  formatNumber,
  formatTable,
  loadConfig,
  fatal,
  warn,
  info,
  confirm,
  truncate,
  parseList,
  resolvePath,
} from './utils.js';

export type {
  ProgressBarConfig,
  ProgressBarState,
  CliConfig,
} from './utils.js';
