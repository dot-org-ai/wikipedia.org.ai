/**
 * Query Command
 *
 * Search Wikipedia articles by title or vector similarity.
 */

import { Command } from 'commander';
import { readFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  color,
  createSpinner,
  formatTable,
  loadConfig,
  fatal,
  resolvePath,
  truncate,
  parseList,
} from './utils.js';
import type { ArticleType } from '../storage/types.js';

/** Query command options */
interface QueryOptions {
  dataDir: string;
  type?: string;
  limit: string;
  format: string;
  vector: boolean;
  model?: string;
  threshold?: string;
  verbose: boolean;
}

/** Search result */
interface SearchResult {
  id: string;
  title: string;
  type: string;
  score: number;
  description?: string;
  file?: string;
}

export const queryCommand = new Command('query')
  .description('Search Wikipedia articles')
  .argument('<term>', 'Search term (title or text for vector search)')
  .option('-d, --data-dir <path>', 'Data directory', './data')
  .option('-t, --type <types>', 'Filter by article types (comma-separated)')
  .option('-l, --limit <count>', 'Maximum results to return', '10')
  .option('-f, --format <format>', 'Output format (table, json, csv)', 'table')
  .option('--vector', 'Use vector similarity search', false)
  .option('-m, --model <model>', 'Embedding model for vector search', 'bge-m3')
  .option('--threshold <score>', 'Minimum similarity score for vector search', '0.7')
  .option('-v, --verbose', 'Show verbose output', false)
  .action(async (term: string, options: QueryOptions) => {
    const config = await loadConfig();
    const dataDir = resolvePath(options.dataDir || config.dataDir || './data');
    const limit = parseInt(options.limit, 10);
    const types = options.type ? parseList(options.type) as ArticleType[] : undefined;
    const format = options.format.toLowerCase();

    // Validate format
    const validFormats = ['table', 'json', 'csv'];
    if (!validFormats.includes(format)) {
      fatal(`Invalid format: ${format}. Valid formats: ${validFormats.join(', ')}`);
    }

    // Validate types
    const validTypes: ArticleType[] = ['person', 'place', 'org', 'work', 'event', 'other'];
    if (types) {
      for (const t of types) {
        if (!validTypes.includes(t)) {
          fatal(`Invalid type: ${t}. Valid types: ${validTypes.join(', ')}`);
        }
      }
    }

    // Check data directory exists
    try {
      await stat(dataDir);
    } catch {
      fatal(`Data directory not found: ${dataDir}\nRun 'wikipedia ingest' first.`);
    }

    let results: SearchResult[];

    if (options.vector) {
      results = await vectorSearch(dataDir, term, {
        limit,
        ...(types ? { types } : {}),
        model: options.model || 'bge-m3',
        threshold: options.threshold ? parseFloat(options.threshold) : 0.7,
        verbose: options.verbose,
      });
    } else {
      results = await titleSearch(dataDir, term, {
        limit,
        ...(types ? { types } : {}),
        verbose: options.verbose,
      });
    }

    // Output results
    if (results.length === 0) {
      console.log(color.yellow('\n  No results found.\n'));
      return;
    }

    switch (format) {
      case 'json':
        console.log(JSON.stringify(results, null, 2));
        break;

      case 'csv':
        console.log('id,title,type,score,description');
        for (const r of results) {
          const desc = (r.description || '').replace(/"/g, '""');
          console.log(`"${r.id}","${r.title}","${r.type}",${r.score.toFixed(4)},"${desc}"`);
        }
        break;

      case 'table':
      default:
        console.log(`\n  Search Results for "${color.cyan(term)}"\n`);
        console.log(`  Found ${color.green(String(results.length))} results\n`);

        const tableRows = results.map((r, i) => ({
          '#': String(i + 1),
          Title: truncate(r.title, 40),
          Type: r.type,
          Score: r.score.toFixed(3),
          Description: truncate(r.description || '', 50),
        }));

        console.log(formatTable(tableRows, ['#', 'Title', 'Type', 'Score', 'Description']));
        console.log('');

        // Show detailed info for top result
        if (results.length > 0 && options.verbose) {
          const top = results[0];
          if (top) {
            console.log(`  Top Result Details:\n`);
            console.log(`    ID:          ${top.id}`);
            console.log(`    Title:       ${top.title}`);
            console.log(`    Type:        ${top.type}`);
            console.log(`    Score:       ${top.score.toFixed(4)}`);
            if (top.file) {
              console.log(`    File:        ${top.file}`);
            }
            if (top.description) {
              console.log(`    Description: ${top.description}`);
            }
            console.log('');
          }
        }
        break;
    }
  });

/**
 * Search by title using index
 */
async function titleSearch(
  dataDir: string,
  term: string,
  options: {
    limit: number;
    types?: ArticleType[];
    verbose: boolean;
  }
): Promise<SearchResult[]> {
  const spinner = options.verbose ? createSpinner('Searching title index...') : null;

  try {
    // Try to load title index
    const indexPath = join(dataDir, 'indexes', 'titles.json');
    let titleIndex: Record<string, { file: string; rowGroup: number; row: number }> = {};

    try {
      const data = await readFile(indexPath, 'utf-8');
      titleIndex = JSON.parse(data) as Record<string, { file: string; rowGroup: number; row: number }>;
    } catch {
      // No index, fall back to scanning
    }

    // Normalize search term
    const normalizedTerm = normalizeTitleForSearch(term);
    const results: SearchResult[] = [];

    // If we have an index, search it
    if (Object.keys(titleIndex).length > 0) {
      for (const [title, location] of Object.entries(titleIndex)) {
        const normalizedTitle = normalizeTitleForSearch(title);
        const score = calculateTitleScore(normalizedTerm, normalizedTitle);

        if (score > 0) {
          results.push({
            id: '', // Would need to load from file
            title,
            type: 'other', // Would need to load from file
            score,
            file: location.file,
          });
        }
      }
    } else {
      // Scan Parquet files directly
      const articlesDir = join(dataDir, 'articles');

      try {
        const parquetFiles = await findParquetFilesRecursive(articlesDir);

        for (const file of parquetFiles.slice(0, 10)) {
          // Limit files scanned for performance
          const articles = await scanParquetForTitles(join(articlesDir, file), normalizedTerm);

          for (const article of articles) {
            // Apply type filter
            if (options.types && !options.types.includes(article.type as ArticleType)) {
              continue;
            }

            results.push({
              ...article,
              file,
            });
          }
        }
      } catch (error) {
        if (options.verbose) {
          console.error(`Error scanning articles: ${error}`);
        }
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);

    spinner?.success(`Found ${results.length} matches`);

    return results.slice(0, options.limit);
  } catch (error) {
    spinner?.fail(`Search failed: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Vector similarity search
 */
async function vectorSearch(
  dataDir: string,
  _term: string,
  options: {
    limit: number;
    types?: ArticleType[];
    model: string;
    threshold: number;
    verbose: boolean;
  }
): Promise<SearchResult[]> {
  const spinner = options.verbose ? createSpinner('Generating query embedding...') : null;

  // Suppress unused variable warnings
  void options.limit;
  void options.types;
  void options.model;
  void options.threshold;

  try {
    const embeddingsDir = join(dataDir, 'embeddings');

    // Check if embeddings exist
    try {
      await stat(embeddingsDir);
    } catch {
      spinner?.fail('No embeddings found. Run "wikipedia embed" first.');
      return [];
    }

    // For now, return empty results with a message
    // Full implementation would:
    // 1. Generate embedding for the query term
    // 2. Load Lance index
    // 3. Perform ANN search
    // 4. Return results

    spinner?.success('Vector search not yet implemented locally');

    console.log(
      color.yellow(
        '\n  Vector search requires embeddings and is not yet fully implemented for local use.\n' +
        '  For vector search, use the API server: wikipedia serve --port 8080\n'
      )
    );

    return [];
  } catch (error) {
    spinner?.fail(`Vector search failed: ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Normalize title for search
 */
function normalizeTitleForSearch(title: string): string {
  return title
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Calculate title match score
 */
function calculateTitleScore(query: string, title: string): number {
  // Exact match
  if (title === query) return 1.0;

  // Starts with
  if (title.startsWith(query)) return 0.9;

  // Contains
  if (title.includes(query)) return 0.7;

  // Word match
  const queryWords = query.split(/\s+/);
  const titleWords = title.split(/\s+/);
  const matchedWords = queryWords.filter((w) => titleWords.includes(w));

  if (matchedWords.length > 0) {
    return 0.5 * (matchedWords.length / queryWords.length);
  }

  // Fuzzy match (simple Levenshtein-based)
  const distance = levenshteinDistance(query, title);
  const maxLen = Math.max(query.length, title.length);

  if (distance < maxLen * 0.3) {
    return 0.3 * (1 - distance / maxLen);
  }

  return 0;
}

/**
 * Levenshtein distance
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  const matrixRow0 = matrix[0];
  if (matrixRow0) {
    for (let j = 0; j <= a.length; j++) {
      matrixRow0[j] = j;
    }
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const currentRow = matrix[i];
      const prevRow = matrix[i - 1];
      if (!currentRow || !prevRow) continue;

      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        currentRow[j] = prevRow[j - 1] ?? 0;
      } else {
        currentRow[j] = Math.min(
          (prevRow[j - 1] ?? 0) + 1,
          (currentRow[j - 1] ?? 0) + 1,
          (prevRow[j] ?? 0) + 1
        );
      }
    }
  }

  const lastRow = matrix[b.length];
  return lastRow?.[a.length] ?? a.length;
}

/**
 * Find Parquet files recursively
 */
async function findParquetFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string, prefix: string): Promise<void> {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await scan(join(currentDir, entry.name), relativePath);
        } else if (entry.name.endsWith('.parquet')) {
          files.push(relativePath);
        }
      }
    } catch {
      // Directory might not exist
    }
  }

  await scan(dir, '');
  return files;
}

/**
 * Scan Parquet file for matching titles
 */
async function scanParquetForTitles(
  filePath: string,
  normalizedTerm: string
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    const { parquetRead } = await import('@dotdo/hyparquet');
    const buffer = await readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

    await parquetRead({
      file: arrayBuffer,
      columns: ['$id', 'title', '$type', 'description'],
      onComplete: (rawData: unknown) => {
        const data = rawData as Record<string, unknown[]>;
        const ids = (data['$id'] || data['id'] || []) as string[];
        const titles = (data['title'] || []) as string[];
        const types = (data['$type'] || data['type'] || []) as string[];
        const descriptions = (data['description'] || []) as string[];

        for (let i = 0; i < titles.length; i++) {
          const title = String(titles[i] || '');
          const normalizedTitle = normalizeTitleForSearch(title);
          const score = calculateTitleScore(normalizedTerm, normalizedTitle);

          if (score > 0) {
            results.push({
              id: String(ids[i] || ''),
              title,
              type: String(types[i] || 'other'),
              score,
              description: String(descriptions[i] || ''),
            });
          }
        }
      },
    });
  } catch (error) {
    // Silently skip files that can't be read
  }

  return results;
}
