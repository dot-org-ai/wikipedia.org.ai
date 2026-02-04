#!/usr/bin/env bun
/**
 * Export Wikipedia embeddings to HuggingFace dataset format
 *
 * This script reads embeddings from the local Lance storage and exports them
 * as Parquet files suitable for uploading to HuggingFace Hub.
 *
 * Usage:
 *   bun run scripts/export-hf.ts
 *   bun run scripts/export-hf.ts --output ./my-export --models bge-m3
 *   bun run scripts/export-hf.ts --include-content --chunk-size 50000
 *
 * Options:
 *   --name          Dataset name on HuggingFace (default: dotdo/wikipedia-embeddings-en)
 *   --output        Output directory (default: ./hf-export)
 *   --source        Source embeddings directory (default: /mnt/r2/embeddings)
 *   --models        Comma-separated list of models (default: bge-m3,gemma)
 *   --include-content  Include article content in export
 *   --chunk-size    Rows per Parquet file (default: 100000)
 *   --upload        Upload to HuggingFace after export (requires HF_TOKEN env var)
 *   --help          Show this help message
 */

import { parseArgs } from 'node:util';
import { HuggingFaceExporter } from '../src/export/huggingface.js';
import type { DatasetConfig, ExportProgress } from '../src/export/huggingface.js';
import type { ExportEmbeddingModel } from '../src/export/schema.js';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message: string): void {
  console.log(message);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}[OK]${colors.reset} ${message}`);
}

function logInfo(message: string): void {
  console.log(`${colors.blue}[INFO]${colors.reset} ${message}`);
}

function logWarning(message: string): void {
  console.log(`${colors.yellow}[WARN]${colors.reset} ${message}`);
}

function logError(message: string): void {
  console.error(`${colors.red}[ERROR]${colors.reset} ${message}`);
}

function showHelp(): void {
  log(`
${colors.bright}Wikipedia Embeddings HuggingFace Exporter${colors.reset}

Export Wikipedia embeddings to HuggingFace-compatible Parquet format.

${colors.cyan}Usage:${colors.reset}
  bun run scripts/export-hf.ts [options]

${colors.cyan}Options:${colors.reset}
  --name <string>       Dataset name on HuggingFace
                        Default: dotdo/wikipedia-embeddings-en

  --output <path>       Output directory for export files
                        Default: ./hf-export

  --source <path>       Source directory containing Lance embedding files
                        Default: /mnt/r2/embeddings

  --models <list>       Comma-separated list of models to include
                        Available: bge-m3, gemma
                        Default: bge-m3,gemma

  --include-content     Include full article content in export
                        Default: false (keeps size manageable)

  --chunk-size <n>      Number of rows per Parquet file
                        Default: 100000

  --version <string>    Dataset version string
                        Default: 1.0.0

  --upload              Upload to HuggingFace Hub after export
                        Requires HF_TOKEN environment variable

  --help                Show this help message

${colors.cyan}Examples:${colors.reset}
  # Basic export
  bun run scripts/export-hf.ts

  # Export with content included
  bun run scripts/export-hf.ts --include-content

  # Export only BGE-M3 embeddings
  bun run scripts/export-hf.ts --models bge-m3

  # Export and upload to HuggingFace
  HF_TOKEN=hf_xxx bun run scripts/export-hf.ts --upload

${colors.cyan}Output Structure:${colors.reset}
  ./hf-export/
    README.md              # Dataset card with documentation
    data/
      data-00000.parquet   # First chunk of data
      data-00001.parquet   # Second chunk
      ...

${colors.cyan}After Export:${colors.reset}
  Upload to HuggingFace Hub:
    huggingface-cli upload dotdo/wikipedia-embeddings-en ./hf-export

  Or use the --upload flag with HF_TOKEN set.
`);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function createProgressBar(progress: number, width: number = 30): string {
  const filled = Math.round(progress * width);
  const empty = width - filled;
  return `[${'='.repeat(filled)}${' '.repeat(empty)}]`;
}

async function main(): Promise<void> {
  // Parse command-line arguments
  const { values } = parseArgs({
    options: {
      name: { type: 'string', default: 'dotdo/wikipedia-embeddings-en' },
      output: { type: 'string', default: './hf-export' },
      source: { type: 'string', default: '/mnt/r2/embeddings' },
      models: { type: 'string', default: 'bge-m3,gemma' },
      'include-content': { type: 'boolean', default: false },
      'chunk-size': { type: 'string', default: '100000' },
      version: { type: 'string', default: '1.0.0' },
      upload: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: true,
  });

  // Show help and exit
  if (values.help) {
    showHelp();
    process.exit(0);
  }

  // Parse models
  const modelList = (values.models ?? 'bge-m3,gemma').split(',').map((m) => m.trim());
  const validModels: ExportEmbeddingModel[] = ['bge-m3', 'gemma'];
  const models = modelList.filter((m): m is ExportEmbeddingModel =>
    validModels.includes(m as ExportEmbeddingModel)
  );

  if (models.length === 0) {
    logError(`No valid models specified. Available: ${validModels.join(', ')}`);
    process.exit(1);
  }

  // Build configuration
  const config: DatasetConfig = {
    name: values.name ?? 'dotdo/wikipedia-embeddings-en',
    outputDir: values.output ?? './hf-export',
    sourceDir: values.source ?? '/mnt/r2/embeddings',
    models,
    includeContent: values['include-content'] ?? false,
    chunkSize: parseInt(values['chunk-size'] ?? '100000', 10),
    version: values.version ?? '1.0.0',
    maintainer: 'DotDo',
    repositoryUrl: 'https://github.com/dotdo/wikipedia.org.ai',
  };

  // Print configuration
  log('');
  log(`${colors.bright}Wikipedia Embeddings HuggingFace Export${colors.reset}`);
  log('');
  logInfo(`Dataset: ${config.name}`);
  logInfo(`Output: ${config.outputDir}`);
  logInfo(`Source: ${config.sourceDir}`);
  logInfo(`Models: ${config.models.join(', ')}`);
  logInfo(`Include content: ${config.includeContent}`);
  logInfo(`Chunk size: ${formatNumber(config.chunkSize)} rows`);
  logInfo(`Version: ${config.version}`);
  log('');

  // Create exporter
  const exporter = new HuggingFaceExporter(config);

  // Track progress
  let lastPhase: ExportProgress['phase'] = 'reading';
  let lastUpdate = Date.now();

  exporter.onProgress((progress) => {
    const now = Date.now();

    // Rate-limit updates to every 500ms
    if (now - lastUpdate < 500 && progress.phase === lastPhase) {
      return;
    }
    lastUpdate = now;
    lastPhase = progress.phase;

    // Clear line and print progress
    process.stdout.write('\r\x1b[K');

    switch (progress.phase) {
      case 'reading':
        process.stdout.write(
          `${colors.cyan}[READING]${colors.reset} ` +
            `Processed ${formatNumber(progress.rowsProcessed)} rows ` +
            `(${progress.rowsPerSecond.toFixed(0)}/s)`
        );
        break;

      case 'writing':
        process.stdout.write(
          `${colors.cyan}[WRITING]${colors.reset} ` +
            `${formatNumber(progress.rowsProcessed)} rows, ` +
            `${progress.filesCompleted} files ` +
            `(${progress.rowsPerSecond.toFixed(0)}/s)`
        );
        break;

      case 'validating':
        process.stdout.write(
          `${colors.cyan}[VALIDATING]${colors.reset} ` +
            `Checking ${progress.filesCompleted} files...`
        );
        break;

      case 'uploading':
        process.stdout.write(
          `${colors.cyan}[UPLOADING]${colors.reset} ` +
            `Uploading to HuggingFace Hub...`
        );
        break;

      case 'complete':
        process.stdout.write('\n');
        break;
    }
  });

  // Run export
  log(`${colors.bright}Starting export...${colors.reset}`);
  log('');

  const result = await exporter.export();

  // Print results
  log('');

  if (result.success) {
    logSuccess('Export completed successfully!');
    log('');
    log(`${colors.bright}Statistics:${colors.reset}`);
    log(`  Total rows:    ${formatNumber(result.stats.rowCount)}`);
    log(`  Total files:   ${result.stats.fileCount}`);
    log(`  Total size:    ${formatBytes(result.stats.totalSizeBytes)}`);
    log(`  Duration:      ${formatDuration(result.durationMs)}`);
    log('');
    log(`${colors.bright}Files by type:${colors.reset}`);
    for (const [type, count] of Object.entries(result.stats.rowsByType)) {
      if (count > 0) {
        const pct = ((count / result.stats.rowCount) * 100).toFixed(1);
        log(`  ${type.padEnd(8)} ${formatNumber(count).padStart(12)} (${pct}%)`);
      }
    }
    log('');
    log(`${colors.bright}Output files:${colors.reset}`);
    log(`  ${result.datasetCardPath}`);
    for (const file of result.parquetFiles.slice(0, 5)) {
      log(`  ${result.outputDir}/data/${file}`);
    }
    if (result.parquetFiles.length > 5) {
      log(`  ... and ${result.parquetFiles.length - 5} more files`);
    }

    // Upload if requested
    if (values.upload) {
      const token = process.env.HF_TOKEN;
      if (!token) {
        logWarning('HF_TOKEN environment variable not set, skipping upload');
      } else {
        log('');
        logInfo('Uploading to HuggingFace Hub...');
        try {
          await exporter.upload(token);
          logSuccess(`Uploaded to https://huggingface.co/datasets/${config.name}`);
        } catch (error) {
          logError(`Upload failed: ${error}`);
        }
      }
    } else {
      log('');
      log(`${colors.bright}Next steps:${colors.reset}`);
      log(`  Upload to HuggingFace Hub:`);
      log(`    huggingface-cli upload ${config.name} ${config.outputDir}`);
      log('');
      log(`  Or set HF_TOKEN and re-run with --upload flag.`);
    }
  } else {
    logError('Export failed!');
    log('');
    for (const error of result.errors) {
      logError(error);
    }
    process.exit(1);
  }

  log('');
}

// Run main
main().catch((error) => {
  logError(`Unhandled error: ${error}`);
  process.exit(1);
});
