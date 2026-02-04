#!/usr/bin/env bun
/**
 * Bundle script for Wikipedia Snippet
 *
 * Combines all snippet files into a single deployable JavaScript bundle
 * with inlined embeddings and optimizations for production.
 *
 * Usage:
 *   bun run snippets/bundle.ts
 *   bun run snippets/bundle.ts --output dist/lookup.bundle.js
 *   bun run snippets/bundle.ts --minify
 *
 * Output:
 *   - dist/lookup.bundle.js - Production-ready bundle
 *   - bundle-stats.json - Bundle size analysis
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

interface BundleOptions {
  output?: string;
  minify?: boolean;
  stats?: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): BundleOptions {
  const args = Bun.argv.slice(2);
  const options: BundleOptions = {
    output: 'dist/lookup.bundle.js',
    minify: false,
    stats: true,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      options.output = args[++i];
    }
    if (args[i] === '--minify') {
      options.minify = true;
    }
    if (args[i] === '--no-stats') {
      options.stats = false;
    }
  }

  return options;
}

/**
 * Load file with error handling
 */
function loadFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    console.error(`Error reading ${path}:`, (error as Error).message);
    process.exit(1);
  }
}

/**
 * Calculate bundle size and breakdown
 */
function analyzeBundle(bundle: string): {
  totalSize: number;
  components: Record<string, number>;
} {
  const components: Record<string, number> = {};
  const totalSize = Buffer.byteLength(bundle, 'utf-8');

  return { totalSize, components };
}

/**
 * Main bundle function
 */
async function bundle() {
  const options = parseArgs();
  const baseDir = dirname(import.meta.url).replace('file://', '');

  console.log('📦 Bundling Wikipedia Snippet...\n');

  // Load source files
  console.log('Loading source files...');
  const cosine = loadFile('snippets/cosine.js');
  const embeddings = loadFile('snippets/embeddings-top10k.js');
  const lookup = loadFile('snippets/lookup.js');

  const cosineSize = Buffer.byteLength(cosine, 'utf-8');
  const embeddingsSize = Buffer.byteLength(embeddings, 'utf-8');
  const lookupSize = Buffer.byteLength(lookup, 'utf-8');

  console.log(`  ✓ cosine.js (${formatSize(cosineSize)})`);
  console.log(`  ✓ embeddings-top10k.js (${formatSize(embeddingsSize)})`);
  console.log(`  ✓ lookup.js (${formatSize(lookupSize)})`);

  // Create bundle
  console.log('\nCreating bundle...');
  const header = `/**
 * Wikipedia Lookup Snippet - Production Bundle
 * Auto-generated - do not edit
 *
 * Built: ${new Date().toISOString()}
 */\n\n`;

  let bundle = header;

  // Add cosine similarity module first (no dependencies)
  bundle += '// === Cosine Similarity Module ===\n';
  bundle += cosine + '\n\n';

  // Add embeddings module (depends on nothing)
  bundle += '// === Embeddings Module ===\n';
  bundle += embeddings + '\n\n';

  // Add main lookup handler (depends on above)
  bundle += '// === Main Lookup Handler ===\n';
  bundle += lookup;

  // Optional minification
  if (options.minify) {
    console.log('Minifying...');
    // Basic minification: remove comments and extra whitespace
    bundle = bundle
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
      .replace(/\s+/g, ' ');
  }

  // Ensure output directory exists
  const outputDir = dirname(options.output!);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write bundle
  writeFileSync(options.output!, bundle);
  const bundleSize = Buffer.byteLength(bundle, 'utf-8');
  console.log(`  ✓ Bundle created: ${options.output}`);

  // Report statistics
  console.log('\n📊 Bundle Statistics:');
  console.log(`  Total size: ${formatSize(bundleSize)}`);
  console.log(`  Target: <500KB (Production) / <1MB (Max)`);

  const components = [
    { name: 'cosine.js', size: cosineSize },
    { name: 'embeddings-top10k.js', size: embeddingsSize },
    { name: 'lookup.js', size: lookupSize },
  ];

  console.log('\n  Breakdown:');
  for (const comp of components) {
    const percent = ((comp.size / bundleSize) * 100).toFixed(1);
    const bar = '█'.repeat(Math.ceil((comp.size / bundleSize) * 20));
    console.log(`    ${comp.name.padEnd(25)} ${formatSize(comp.size).padStart(8)} (${percent.padStart(5)}%) ${bar}`);
  }

  // Check size budget
  console.log('\n✓ Size budget check:');
  if (bundleSize < 500000) {
    console.log(`  ✅ ${formatSize(bundleSize)} < 500KB (excellent)`);
  } else if (bundleSize < 1000000) {
    console.log(`  ⚠️  ${formatSize(bundleSize)} < 1MB (acceptable but consider optimization)`);
  } else {
    console.log(`  ❌ ${formatSize(bundleSize)} exceeds 1MB limit!`);
    process.exit(1);
  }

  // Save stats
  if (options.stats) {
    const stats = {
      timestamp: new Date().toISOString(),
      bundleSize,
      targetSize: 500000,
      maxSize: 1000000,
      sizeRatio: (bundleSize / 500000).toFixed(2),
      components: Object.fromEntries(components.map((c) => [c.name, c.size])),
    };

    const statsFile = join(dirname(options.output!), 'bundle-stats.json');
    writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    console.log(`  ✓ Stats saved: ${statsFile}`);
  }

  console.log('\n✅ Bundle complete!\n');

  // Provide deployment instructions
  console.log('Next steps:');
  console.log('  1. Review the bundle: wc -c ' + options.output);
  console.log('  2. Test locally: bun run snippets/test.ts');
  console.log('  3. Deploy: wrangler deploy -c snippets/wrangler.toml');
  console.log('  4. Verify: curl https://your-domain/health\n');
}

/**
 * Format bytes as human-readable string
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)}${units[unitIndex]}`;
}

// Run bundle
bundle().catch((error) => {
  console.error('Bundle failed:', error);
  process.exit(1);
});
