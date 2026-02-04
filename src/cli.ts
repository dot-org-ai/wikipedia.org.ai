#!/usr/bin/env bun
/**
 * Wikipedia CLI
 *
 * Stream Wikipedia dumps to Parquet with AI embeddings.
 * Runs locally with Bun for development and processing.
 */

import { Command } from 'commander';
import { ingestCommand } from './cli/ingest.js';
import { embedCommand } from './cli/embed.js';
import { queryCommand } from './cli/query.js';
import { serveCommand } from './cli/serve.js';
import { buildIndexesCommand } from './cli/build-indexes.js';

const program = new Command()
  .name('wikipedia')
  .description('Stream Wikipedia dumps to Parquet with AI embeddings')
  .version('0.1.0');

// Register commands
program.addCommand(ingestCommand);
program.addCommand(embedCommand);
program.addCommand(queryCommand);
program.addCommand(serveCommand);
program.addCommand(buildIndexesCommand);

// Stats command (inline since it's simple)
program
  .command('stats')
  .description('Show processing statistics')
  .option('-d, --data-dir <path>', 'Data directory', './data')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const { loadConfig, formatTable, formatBytes, formatNumber } = await import('./cli/utils.js');
    const { readFile, readdir, stat } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const config = await loadConfig();
    const dataDir = options.dataDir || config.dataDir || './data';

    try {
      // Load manifest if exists
      const manifestPath = join(dataDir, 'manifest.json');
      let manifest: Record<string, unknown> | null = null;

      try {
        const data = await readFile(manifestPath, 'utf-8');
        manifest = JSON.parse(data) as Record<string, unknown>;
      } catch {
        // No manifest
      }

      // Load checkpoint if exists
      const checkpointPath = join(dataDir, 'checkpoint.json');
      let checkpoint: Record<string, unknown> | null = null;

      try {
        const data = await readFile(checkpointPath, 'utf-8');
        checkpoint = JSON.parse(data) as Record<string, unknown>;
      } catch {
        // No checkpoint
      }

      // Calculate directory sizes
      const sizes: Record<string, number> = {};
      const counts: Record<string, number> = {};

      async function scanDir(dir: string, prefix: string): Promise<void> {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isFile()) {
              const stats = await stat(fullPath);
              sizes[prefix] = (sizes[prefix] || 0) + stats.size;
              counts[prefix] = (counts[prefix] || 0) + 1;
            } else if (entry.isDirectory()) {
              await scanDir(fullPath, entry.name);
            }
          }
        } catch {
          // Directory doesn't exist
        }
      }

      await scanDir(dataDir, 'total');
      await scanDir(join(dataDir, 'articles'), 'articles');
      await scanDir(join(dataDir, 'embeddings'), 'embeddings');
      await scanDir(join(dataDir, 'indexes'), 'indexes');

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              manifest,
              checkpoint,
              sizes,
              counts,
            },
            null,
            2
          )
        );
        return;
      }

      // Display stats
      console.log('\n  Wikipedia Data Statistics\n');

      if (manifest) {
        const articlesByType = manifest['articlesByType'] as Record<string, number> | undefined;
        console.log('  Manifest:');
        console.log(`    Version:        ${manifest['version'] || 'unknown'}`);
        console.log(`    Created:        ${manifest['created_at'] || 'unknown'}`);
        console.log(`    Total Articles: ${formatNumber(manifest['totalArticles'] as number || 0)}`);
        console.log('');

        if (articlesByType) {
          console.log('  Articles by Type:');
          const typeRows = Object.entries(articlesByType).map(([type, count]) => ({
            Type: type,
            Count: formatNumber(count),
            Percentage: `${(((count as number) / ((manifest['totalArticles'] as number) || 1)) * 100).toFixed(1)}%`,
          }));
          console.log(formatTable(typeRows, ['Type', 'Count', 'Percentage']));
        }
      } else {
        console.log('  No manifest found. Run `wikipedia ingest` first.\n');
      }

      if (checkpoint) {
        console.log('  Embedding Progress:');
        console.log(`    Total Processed: ${formatNumber(checkpoint['totalProcessed'] as number || 0)}`);
        console.log(`    Last ID:         ${checkpoint['lastProcessedId'] || 'none'}`);
        console.log(`    Batch Number:    ${formatNumber(checkpoint['batchNumber'] as number || 0)}`);
        console.log(`    Errors:          ${(checkpoint['errors'] as unknown[])?.length || 0}`);
        console.log(`    Updated:         ${checkpoint['updatedAt'] || 'unknown'}`);
        console.log('');
      }

      console.log('  Storage:');
      const storageRows = [
        { Category: 'Articles', Files: counts['articles'] || 0, Size: formatBytes(sizes['articles'] || 0) },
        { Category: 'Embeddings', Files: counts['embeddings'] || 0, Size: formatBytes(sizes['embeddings'] || 0) },
        { Category: 'Indexes', Files: counts['indexes'] || 0, Size: formatBytes(sizes['indexes'] || 0) },
        { Category: 'Total', Files: counts['total'] || 0, Size: formatBytes(sizes['total'] || 0) },
      ];
      console.log(formatTable(storageRows, ['Category', 'Files', 'Size']));
      console.log('');
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
