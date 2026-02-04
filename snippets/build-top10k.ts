#!/usr/bin/env bun
/**
 * Build script for generating top-10K embeddings
 *
 * This script:
 * 1. Loads article titles sorted by pageviews
 * 2. Takes top 10K most popular titles
 * 3. Generates embeddings using AI Gateway (or local model)
 * 4. Computes PCA matrix for dimensionality reduction
 * 5. Applies PCA to reduce 1024-dim embeddings to 256-dim
 * 6. Quantizes to uint8 for storage
 * 7. Outputs both JS module (inline top-1K) and binary file (full 10K)
 *
 * Usage:
 *   bun run snippets/build-top10k.ts --input pageviews.csv --output snippets/
 *
 * Input format (pageviews.csv):
 *   title,pageviews
 *   United States,1234567
 *   World War II,987654
 *   ...
 */

import { parseArgs } from 'util';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Configuration
const CONFIG = {
  // Number of terms to include inline in JS
  inlineCount: 1000,
  // Total terms to process
  totalCount: 10000,
  // Original embedding dimension
  originalDim: 1024,
  // Reduced embedding dimension
  reducedDim: 256,
  // AI Gateway settings
  aiGatewayUrl: process.env.AI_GATEWAY_URL || 'https://gateway.ai.cloudflare.com/v1',
  accountId: process.env.CF_ACCOUNT_ID || '',
  gatewayId: process.env.AI_GATEWAY_ID || '',
  // Batch size for embedding requests
  batchSize: 100,
  // Rate limit delay (ms)
  rateLimit: 100,
};

// Types
interface PageviewEntry {
  title: string;
  pageviews: number;
}

interface EmbeddingResult {
  title: string;
  embedding: number[];
}

/**
 * Main build function
 */
async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      input: { type: 'string', short: 'i' },
      output: { type: 'string', short: 'o', default: 'snippets/' },
      'skip-embeddings': { type: 'boolean', default: false },
      'embeddings-file': { type: 'string' },
    },
  });

  if (!values.input) {
    console.error('Usage: bun run build-top10k.ts --input pageviews.csv --output snippets/');
    console.error('');
    console.error('Options:');
    console.error('  --input, -i         Path to pageviews CSV file');
    console.error('  --output, -o        Output directory (default: snippets/)');
    console.error('  --skip-embeddings   Skip embedding generation, use existing file');
    console.error('  --embeddings-file   Path to existing embeddings JSON file');
    process.exit(1);
  }

  const inputPath = values.input;
  const outputDir = values.output!;

  console.log('Building top-10K embeddings...');
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputDir}`);

  // Step 1: Load and sort pageviews
  console.log('\n1. Loading pageviews...');
  const pageviews = loadPageviews(inputPath);
  console.log(`   Loaded ${pageviews.length} entries`);

  // Take top N
  const topTitles = pageviews.slice(0, CONFIG.totalCount).map((p) => p.title);
  console.log(`   Selected top ${topTitles.length} titles`);

  // Step 2: Generate or load embeddings
  let embeddings: EmbeddingResult[];

  if (values['skip-embeddings'] && values['embeddings-file']) {
    console.log('\n2. Loading existing embeddings...');
    embeddings = JSON.parse(readFileSync(values['embeddings-file'], 'utf-8'));
    console.log(`   Loaded ${embeddings.length} embeddings`);
  } else {
    console.log('\n2. Generating embeddings...');
    embeddings = await generateEmbeddings(topTitles);
    console.log(`   Generated ${embeddings.length} embeddings`);

    // Save raw embeddings for later use
    const embeddingsPath = join(outputDir, 'raw-embeddings.json');
    writeFileSync(embeddingsPath, JSON.stringify(embeddings));
    console.log(`   Saved raw embeddings to ${embeddingsPath}`);
  }

  // Step 3: Compute PCA matrix
  console.log('\n3. Computing PCA matrix...');
  const embeddingMatrix = embeddings.map((e) => e.embedding);
  const pcaMatrix = computePCA(embeddingMatrix, CONFIG.reducedDim);
  console.log(`   PCA matrix: ${pcaMatrix.length} x ${pcaMatrix[0].length}`);

  // Step 4: Apply PCA and quantize
  console.log('\n4. Applying PCA and quantizing...');
  const reducedEmbeddings = embeddings.map((e) => ({
    title: e.title,
    embedding: quantize(applyPCA(e.embedding, pcaMatrix)),
  }));

  // Step 5: Generate JS module (inline top-1K)
  console.log('\n5. Generating JS module (inline top-1K)...');
  const inlineEmbeddings = reducedEmbeddings.slice(0, CONFIG.inlineCount);
  const jsModule = generateJSModule(inlineEmbeddings, pcaMatrix);
  const jsPath = join(outputDir, 'embeddings-top10k.js');
  writeFileSync(jsPath, jsModule);
  console.log(`   Saved JS module to ${jsPath}`);
  console.log(`   Size: ${(jsModule.length / 1024).toFixed(2)} KB`);

  // Step 6: Generate binary file (full 10K)
  console.log('\n6. Generating binary file (full 10K)...');
  const binaryData = generateBinaryFile(reducedEmbeddings);
  const binPath = join(outputDir, 'top10k-embeddings.bin');
  writeFileSync(binPath, binaryData);
  console.log(`   Saved binary file to ${binPath}`);
  console.log(`   Size: ${(binaryData.length / 1024).toFixed(2)} KB`);

  // Step 7: Generate bloom filter for titles
  console.log('\n7. Generating bloom filter...');
  const allTitles = pageviews.map((p) => p.title);
  const bloomFilter = generateBloomFilter(allTitles);
  const bloomPath = join(outputDir, 'bloom-filter.bin');
  writeFileSync(bloomPath, bloomFilter);
  console.log(`   Saved bloom filter to ${bloomPath}`);
  console.log(`   Size: ${(bloomFilter.length / 1024).toFixed(2)} KB`);

  console.log('\nDone!');
}

/**
 * Load pageviews from CSV
 */
function loadPageviews(path: string): PageviewEntry[] {
  const content = readFileSync(path, 'utf-8');
  const lines = content.trim().split('\n');

  // Skip header
  const entries: PageviewEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [title, pageviews] = lines[i].split(',');
    if (title && pageviews) {
      entries.push({
        title: title.trim(),
        pageviews: parseInt(pageviews, 10),
      });
    }
  }

  // Sort by pageviews descending
  entries.sort((a, b) => b.pageviews - a.pageviews);

  return entries;
}

/**
 * Generate embeddings using AI Gateway
 */
async function generateEmbeddings(titles: string[]): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < titles.length; i += CONFIG.batchSize) {
    const batch = titles.slice(i, i + CONFIG.batchSize);
    const progress = ((i / titles.length) * 100).toFixed(1);
    console.log(`   Processing batch ${i / CONFIG.batchSize + 1}... (${progress}%)`);

    try {
      const embeddings = await fetchEmbeddings(batch);
      for (let j = 0; j < batch.length; j++) {
        results.push({
          title: batch[j],
          embedding: embeddings[j],
        });
      }
    } catch (error) {
      console.error(`   Error processing batch: ${error}`);
      // Add empty embeddings for failed titles
      for (const title of batch) {
        results.push({
          title,
          embedding: new Array(CONFIG.originalDim).fill(0),
        });
      }
    }

    // Rate limiting
    if (i + CONFIG.batchSize < titles.length) {
      await new Promise((resolve) => setTimeout(resolve, CONFIG.rateLimit));
    }
  }

  return results;
}

/**
 * Fetch embeddings from AI Gateway
 */
async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const url = `${CONFIG.aiGatewayUrl}/${CONFIG.accountId}/${CONFIG.gatewayId}/workers-ai/@cf/baai/bge-m3`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    result?: { data?: number[][] };
    data?: number[][];
  };

  return data.result?.data || data.data || [];
}

/**
 * Compute PCA matrix using power iteration method
 */
function computePCA(embeddings: number[][], targetDims: number): number[][] {
  const n = embeddings.length;
  const d = embeddings[0].length;

  // Compute mean
  const mean = new Array(d).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < d; i++) {
      mean[i] += emb[i] / n;
    }
  }

  // Center the data
  const centered = embeddings.map((emb) => emb.map((v, i) => v - mean[i]));

  // Compute covariance matrix (simplified for large datasets)
  // Using randomized SVD approximation
  const pcaVectors: number[][] = [];

  for (let k = 0; k < targetDims; k++) {
    // Initialize random vector
    let v = new Array(d).fill(0).map(() => Math.random() - 0.5);
    v = normalize(v);

    // Power iteration
    for (let iter = 0; iter < 100; iter++) {
      // Multiply by covariance matrix (X^T * X * v)
      const Xv = centered.map((row) => dotProduct(row, v));
      const XtXv = new Array(d).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < d; j++) {
          XtXv[j] += centered[i][j] * Xv[i];
        }
      }

      // Orthogonalize against previous vectors
      for (const prev of pcaVectors) {
        const proj = dotProduct(XtXv, prev);
        for (let j = 0; j < d; j++) {
          XtXv[j] -= proj * prev[j];
        }
      }

      // Normalize
      const newV = normalize(XtXv);

      // Check convergence
      const diff = Math.sqrt(
        v.reduce((sum, val, i) => sum + (val - newV[i]) ** 2, 0)
      );
      v = newV;

      if (diff < 1e-6) break;
    }

    pcaVectors.push(v);

    if ((k + 1) % 50 === 0) {
      console.log(`   Computed ${k + 1}/${targetDims} PCA components`);
    }
  }

  return pcaVectors;
}

/**
 * Apply PCA projection to an embedding
 */
function applyPCA(embedding: number[], pcaMatrix: number[][]): number[] {
  return pcaMatrix.map((row) => dotProduct(embedding, row));
}

/**
 * Quantize float array to uint8
 */
function quantize(values: number[]): Uint8Array {
  // Find min/max for normalization
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min || 1;
  const result = new Uint8Array(values.length);

  for (let i = 0; i < values.length; i++) {
    result[i] = Math.round(((values[i] - min) / range) * 255);
  }

  return result;
}

/**
 * Generate JS module with inline embeddings
 */
function generateJSModule(
  embeddings: { title: string; embedding: Uint8Array }[],
  pcaMatrix: number[][]
): string {
  const lines: string[] = [
    '/**',
    ' * Top 10K most common search terms with pre-computed embeddings',
    ' * Generated by build-top10k.ts',
    ' *',
    ` * Terms: ${embeddings.length}`,
    ` * Dimensions: ${CONFIG.reducedDim} (PCA reduced from ${CONFIG.originalDim})`,
    ` * Generated: ${new Date().toISOString()}`,
    ' */',
    '',
  ];

  // Top terms map
  lines.push('// Top search terms with quantized embeddings (256-dim uint8)');
  lines.push('export const TOP_TERMS = new Map([');

  for (const { title, embedding } of embeddings) {
    const bytes = Array.from(embedding).join(',');
    const escapedTitle = title.replace(/'/g, "\\'");
    lines.push(`  ['${escapedTitle.toLowerCase()}', new Uint8Array([${bytes}])],`);
  }

  lines.push(']);');
  lines.push('');

  // Term aliases
  lines.push('// Term normalization map (search term -> canonical title)');
  lines.push('export const TERM_TO_TITLE = new Map([');
  lines.push("  ['usa', 'United States'],");
  lines.push("  ['us', 'United States'],");
  lines.push("  ['america', 'United States'],");
  lines.push("  ['uk', 'United Kingdom'],");
  lines.push("  ['ww2', 'World War II'],");
  lines.push("  ['wwii', 'World War II'],");
  lines.push("  ['ww1', 'World War I'],");
  lines.push("  ['wwi', 'World War I'],");
  lines.push(']);');
  lines.push('');

  // PCA matrix (only if needed for query projection)
  lines.push('// PCA matrix for dimensionality reduction');
  lines.push(`// Shape: ${pcaMatrix.length} x ${pcaMatrix[0]?.length || 0}`);
  lines.push('// Set to null to skip client-side projection');
  lines.push('export const PCA_MATRIX = null;');
  lines.push('');

  // Constants
  lines.push(`export const REDUCED_DIM = ${CONFIG.reducedDim};`);
  lines.push(`export const ORIGINAL_DIM = ${CONFIG.originalDim};`);

  return lines.join('\n');
}

/**
 * Generate binary file with all embeddings
 * Format: [termLength(2), term(utf8), embedding(256)] repeated
 */
function generateBinaryFile(embeddings: { title: string; embedding: Uint8Array }[]): Buffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const { title, embedding } of embeddings) {
    const termBytes = encoder.encode(title);
    const chunk = new Uint8Array(2 + termBytes.length + embedding.length);

    // Term length (2 bytes, little endian)
    chunk[0] = termBytes.length & 0xff;
    chunk[1] = (termBytes.length >> 8) & 0xff;

    // Term
    chunk.set(termBytes, 2);

    // Embedding
    chunk.set(embedding, 2 + termBytes.length);

    chunks.push(chunk);
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return Buffer.from(result);
}

/**
 * Generate bloom filter for title existence check
 * Uses ~10 bits per entry for ~1% false positive rate
 */
function generateBloomFilter(titles: string[]): Buffer {
  const n = titles.length;
  const m = Math.ceil(n * 10); // bits
  const k = 7; // hash functions

  const bytes = Math.ceil(m / 8);
  const filter = new Uint8Array(bytes);

  for (const title of titles) {
    const hashes = computeBloomHashes(title.toLowerCase(), k, m);
    for (const hash of hashes) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      filter[byteIndex] |= 1 << bitIndex;
    }
  }

  return Buffer.from(filter);
}

/**
 * Compute bloom filter hashes
 */
function computeBloomHashes(str: string, k: number, m: number): number[] {
  const hashes: number[] = [];
  let h1 = fnv1a(str);
  let h2 = fnv1a(str + str);

  for (let i = 0; i < k; i++) {
    hashes.push(Math.abs((h1 + i * h2) % m));
  }

  return hashes;
}

/**
 * FNV-1a hash function
 */
function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Helper: dot product
 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Helper: normalize vector
 */
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
  if (norm === 0) return v;
  return v.map((val) => val / norm);
}

// Run main
main().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
