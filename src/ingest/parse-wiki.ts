/**
 * Wikitext parser using wtf_wikipedia
 *
 * Converts raw wikitext markup to structured Article objects
 */

import type { WikiPage, Article, Infobox, WikiLink } from './types.js';
import wtf from 'wtf_wikipedia';
import { createLogger } from '../lib/logger.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('ingest:parse-wiki');

/** Patterns for identifying special page types */
const REDIRECT_PATTERN = /^#REDIRECT\s*\[\[/i;
const DISAMBIG_TEMPLATES = [
  'disambiguation',
  'disambig',
  'disamb',
  'dab',
  'surname',
  'given name',
  'hndis',
  'geodis',
  'airport disambiguation',
  'call sign disambiguation',
  'hospital disambiguation',
  'letter disambiguation',
  'mathematical disambiguation',
  'molecular formula disambiguation',
  'number disambiguation',
  'place name disambiguation',
  'road disambiguation',
  'school disambiguation',
  'species disambiguation',
  'station disambiguation',
  'taxonomic disambiguation',
];

/**
 * Parse wikitext content into a structured Article.
 *
 * @param page - Raw WikiPage from XML parsing
 * @returns Structured Article with extracted data
 *
 * @example
 * ```typescript
 * const article = parseWikitext(page);
 * console.log(article.plaintext);
 * console.log(article.infoboxes);
 * ```
 */
export function parseWikitext(page: WikiPage): Article {
  // Check for redirect first (before full parsing)
  const isRedirect = REDIRECT_PATTERN.test(page.text);
  let redirectTarget: string | undefined;

  if (isRedirect) {
    // Extract redirect target from the wikitext
    const match = page.text.match(/\[\[([^\]|]+)/);
    if (match && match[1]) {
      redirectTarget = match[1].trim();
    }
    // Also use the redirect field from XML if available
    if (!redirectTarget && page.redirect) {
      redirectTarget = page.redirect;
    }
  }

  // Parse with wtf_wikipedia
  const doc = wtf(page.text);

  // Extract plain text
  const plaintext = doc.text() || '';

  // Extract infoboxes
  const infoboxes = extractInfoboxes(doc);

  // Extract links
  const links = extractLinks(doc);

  // Extract categories
  const categories = extractCategories(doc);

  // Check for disambiguation page
  const isDisambiguation = checkDisambiguation(doc);

  const article: Article = {
    title: page.title,
    id: page.id,
    plaintext,
    infoboxes,
    links,
    categories,
    isRedirect,
    isDisambiguation,
    timestamp: page.timestamp,
  };

  // Only add redirectTarget if defined (exactOptionalPropertyTypes)
  if (redirectTarget !== undefined) {
    article.redirectTarget = redirectTarget;
  }

  return article;
}

/**
 * Extract infoboxes from parsed document
 */
function extractInfoboxes(doc: ReturnType<typeof wtf>): Infobox[] {
  const infoboxes: Infobox[] = [];

  try {
    const rawInfoboxes = doc.infoboxes();

    if (Array.isArray(rawInfoboxes)) {
      for (const box of rawInfoboxes) {
        const type = box.type() || 'unknown';
        const data: Record<string, string> = {};

        // Get all key-value pairs
        const json = box.json();
        if (json && typeof json === 'object') {
          for (const [key, value] of Object.entries(json)) {
            if (key === 'template' || key === 'type') continue;

            if (value && typeof value === 'object' && 'text' in value) {
              data[key] = String(value.text || '');
            } else if (typeof value === 'string') {
              data[key] = value;
            }
          }
        }

        infoboxes.push({ type: normalizeInfoboxType(type), data });
      }
    }
  } catch (error) {
    getLog().debug('Failed to extract infoboxes', { error }, 'extractInfoboxes');
  }

  return infoboxes;
}

/**
 * Normalize infobox type names
 */
function normalizeInfoboxType(type: string): string {
  return type
    .toLowerCase()
    .replace(/^infobox\s+/i, '')
    .replace(/_/g, ' ')
    .trim();
}

/**
 * Extract internal wiki links from parsed document
 */
function extractLinks(doc: ReturnType<typeof wtf>): WikiLink[] {
  const links: WikiLink[] = [];

  try {
    const rawLinks = doc.links() as Array<{ page?: () => string; text?: () => string }>;

    if (Array.isArray(rawLinks)) {
      for (const link of rawLinks) {
        const page = (link.page?.() || link.text?.() || '') as string;
        const text = (link.text?.() || page) as string;

        // Skip external links and empty links
        if (!page || page.startsWith('http')) continue;

        // Skip category/file/template links
        if (/^(Category|File|Template|Wikipedia|WP|Help|Portal|Draft):/i.test(page)) {
          continue;
        }

        links.push({ page, text });
      }
    }
  } catch (error) {
    getLog().debug('Failed to extract links', { error }, 'extractLinks');
  }

  return links;
}

/**
 * Extract categories from parsed document
 */
function extractCategories(doc: ReturnType<typeof wtf>): string[] {
  const categories: string[] = [];

  try {
    const rawCategories = doc.categories() as Array<string | { toString(): string }>;

    if (Array.isArray(rawCategories)) {
      for (const cat of rawCategories) {
        const name = typeof cat === 'string' ? cat : (cat as { toString(): string }).toString();
        if (name) {
          categories.push(name);
        }
      }
    }
  } catch (error) {
    getLog().debug('Failed to extract categories', { error }, 'extractCategories');
  }

  return categories;
}

/**
 * Check if the document is a disambiguation page
 */
function checkDisambiguation(doc: ReturnType<typeof wtf>): boolean {
  try {
    // Check if wtf_wikipedia detects it as disambiguation
    if (doc.isDisambig && doc.isDisambig()) {
      return true;
    }

    // Check templates
    const templates = doc.templates() as Array<{ template?: () => string }>;
    if (Array.isArray(templates)) {
      for (const template of templates) {
        const name = (template.template?.() || '').toLowerCase();
        if (DISAMBIG_TEMPLATES.includes(name)) {
          return true;
        }
      }
    }

    // Check categories for disambiguation indicators
    const categories = doc.categories() as Array<string | { toString(): string }>;
    if (Array.isArray(categories)) {
      for (const cat of categories) {
        const catName = (typeof cat === 'string' ? cat : (cat as { toString(): string }).toString()).toLowerCase();
        if (catName.includes('disambiguation')) {
          return true;
        }
      }
    }
  } catch (error) {
    getLog().debug('Failed to check disambiguation', { error }, 'checkDisambiguation');
  }

  return false;
}

/**
 * Create a TransformStream that parses WikiPages to Articles
 *
 * @returns TransformStream for the pipeline
 */
export function createWikitextParser(): TransformStream<WikiPage, Article> {
  return new TransformStream<WikiPage, Article>(
    {
      transform(page, controller) {
        try {
          const article = parseWikitext(page);
          controller.enqueue(article);
        } catch (error) {
          getLog().warn('Failed to parse page', {
            title: page.title,
            id: page.id,
            error: error instanceof Error ? error.message : String(error),
          }, 'transform');
        }
      },
    },
    { highWaterMark: 100 }, // Buffer up to 100 input pages
    { highWaterMark: 100 }  // Buffer up to 100 output articles
  );
}

/**
 * Get a summary of the article (first paragraph or section)
 */
export function getArticleSummary(article: Article, maxLength = 500): string {
  const text = article.plaintext;

  // Find the first paragraph break
  const firstPara = text.split('\n\n')[0] ?? '';

  if (firstPara.length <= maxLength) {
    return firstPara.trim();
  }

  // Truncate at word boundary
  const truncated = firstPara.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace).trim() + '...';
  }

  return truncated.trim() + '...';
}

/**
 * Extract structured data from a specific infobox type
 */
export function extractInfoboxData(
  article: Article,
  infoboxType: string
): Record<string, string> | null {
  const normalizedType = normalizeInfoboxType(infoboxType);

  for (const infobox of article.infoboxes) {
    if (infobox.type === normalizedType || infobox.type.includes(normalizedType)) {
      return infobox.data;
    }
  }

  return null;
}
