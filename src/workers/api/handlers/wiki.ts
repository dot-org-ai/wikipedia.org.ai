/**
 * Wiki parser handlers for wiki.org.ai
 *
 * Provides Wikipedia article parsing with multiple output formats:
 * - Markdown (default)
 * - JSON (full structured data)
 * - Summary (first 3 sentences)
 * - Infobox (structured data from infobox)
 * - Links (extracted links)
 * - Categories
 * - Plain text
 *
 * Routes:
 *   /Albert_Einstein         -> Markdown (default)
 *   /Albert_Einstein.json    -> Full JSON
 *   /Albert_Einstein/summary -> Concise summary
 *   /Albert_Einstein/infobox -> Infobox data
 *   /Albert_Einstein/links   -> Links only
 *   /Albert_Einstein/text    -> Plain text
 *   /fr/Paris               -> French Wikipedia article
 *   POST / with { wikitext } -> Parse raw wikitext
 */

import type { RequestContext } from '../types.js';
import { jsonResponse, errorResponse } from '../middleware.js';
import wtf, { loadData, Document } from '../../../lib/wtf-lite/index.js';

const DATA_CDN_URL = 'https://wikipedia-embeddings.r2.dev/wtf-data.json';

// Flag to track if data has been loaded
let dataLoaded = false;

/** POST request body for parsing raw wikitext */
interface ParseRequest {
  wikitext?: string;
  title?: string;
  format?: 'json' | 'md' | 'markdown';
}

/** Wikipedia API query response structure */
interface WikipediaApiResponse {
  query?: {
    pages?: Array<{
      pageid?: number;
      ns?: number;
      title: string;
      missing?: boolean;
      revisions?: Array<{
        slots?: {
          main?: {
            content: string;
            contentmodel?: string;
            contentformat?: string;
          };
        };
      }>;
    }>;
  };
  batchcomplete?: boolean;
}

/** Section data in full JSON response */
interface SectionJson {
  title: string | null;
  depth: number;
  text: string;
}

/** Infobox data in full JSON response */
interface InfoboxJson {
  type: string | null;
  data: object;
}

/** Link data from document */
interface LinkJson {
  text?: string;
  page?: string;
  type?: string;
  site?: string;
}

/** Full JSON response from toFullJson */
interface FullJsonResponse {
  title: string | null;
  isRedirect: boolean;
  redirectTo: string | null;
  categories: string[];
  sections: SectionJson[];
  infoboxes: InfoboxJson[];
  links: LinkJson[];
  coordinates: unknown[];
  templates: unknown[];
}

/**
 * Ensure wtf-lite data is loaded
 */
async function ensureDataLoaded(ctx: ExecutionContext): Promise<void> {
  if (!dataLoaded) {
    // Load in background, don't block request
    ctx.waitUntil(
      loadData(DATA_CDN_URL)
        .then(() => {
          dataLoaded = true;
        })
        .catch(() => {
          // Ignore errors, will use inline defaults
        })
    );
  }
}

/**
 * Parse path to extract title, language, format, and section
 */
function parsePath(path: string): {
  title: string;
  lang: string;
  format: string;
  section: string | null;
} {
  // Remove leading slash and decode URL
  let p = decodeURIComponent(path.replace(/^\/+/, ''));

  let lang = 'en';
  let format = 'md';
  let section: string | null = null;

  // Check for language prefix (2 letter code)
  const langMatch = p.match(/^([a-z]{2})\/(.+)$/);
  if (langMatch && langMatch[1] && langMatch[2]) {
    lang = langMatch[1];
    p = langMatch[2];
  }

  // Check for format extensions
  if (p.endsWith('.json')) {
    format = 'json';
    p = p.slice(0, -5);
  } else if (p.endsWith('.md')) {
    format = 'md';
    p = p.slice(0, -3);
  } else if (p.endsWith('.markdown')) {
    format = 'md';
    p = p.slice(0, -9);
  } else if (p.endsWith('.txt')) {
    format = 'txt';
    p = p.slice(0, -4);
  }

  // Check for section suffix
  const sections = ['summary', 'infobox', 'links', 'categories', 'text'];
  for (const s of sections) {
    if (p.endsWith('/' + s)) {
      section = s;
      p = p.slice(0, -(s.length + 1));
      break;
    }
  }

  return { title: p, lang, format, section };
}

/**
 * Fetch article wikitext from Wikipedia API
 */
async function fetchWikipediaArticle(
  title: string,
  lang: string
): Promise<{ title: string; wikitext: string } | null> {
  const apiUrl = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    format: 'json',
    formatversion: '2',
  });

  const response = await fetch(`${apiUrl}?${params}`, {
    headers: { 'User-Agent': 'wiki.org.ai/1.0' },
  });

  if (!response.ok) throw new Error(`Wikipedia API error: ${response.status}`);

  const data = (await response.json()) as WikipediaApiResponse;
  const page = data.query?.pages?.[0];

  if (!page || page.missing) return null;

  return {
    title: page.title,
    wikitext: page.revisions?.[0]?.slots?.main?.content || '',
  };
}

/**
 * Convert Document to full JSON response
 */
function toFullJson(doc: Document): FullJsonResponse {
  return {
    title: doc.title(),
    isRedirect: doc.isRedirect(),
    redirectTo: doc.redirectTo()?.page?.() || null,
    categories: doc.categories(),
    sections: doc.sections().map((s) => ({
      title: s.title(),
      depth: s.depth(),
      text: s.text().slice(0, 2000),
    })),
    infoboxes: doc.infoboxes().map((i) => ({ type: i.type(), data: i.json() })),
    links: doc.links().slice(0, 100).map((l) => l.json()),
    coordinates: doc.coordinates(),
    templates: doc.templates().slice(0, 50),
  };
}

/**
 * Convert Document to Markdown
 */
function toMarkdown(doc: Document): string {
  const lines: string[] = [];

  lines.push(`# ${doc.title()?.replace(/_/g, ' ') || 'Untitled'}`);
  lines.push('');

  // Summary
  const firstSentences = doc.sentences().slice(0, 3);
  if (firstSentences.length) {
    lines.push(firstSentences.map((s) => s.text()).join(' '));
    lines.push('');
  }

  // Infobox as table
  const infoboxes = doc.infoboxes();
  const firstInfobox = infoboxes[0];
  if (infoboxes.length > 0 && firstInfobox) {
    lines.push(`## ${firstInfobox.type()}`);
    lines.push('');
    lines.push('| Field | Value |');
    lines.push('|-------|-------|');
    const data = firstInfobox.json();
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length < 100) {
        lines.push(`| ${key.replace(/_/g, ' ')} | ${value} |`);
      }
    }
    lines.push('');
  }

  // Sections
  for (const section of doc.sections()) {
    const title = section.title();
    if (title && title !== 'Introduction') {
      const heading = '#'.repeat(Math.min(section.depth() + 2, 6));
      lines.push(`${heading} ${title}`);
      lines.push('');
      const text = section.text().trim();
      if (text) {
        lines.push(text.slice(0, 2000));
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// =============================================================================
// HTTP Handlers
// =============================================================================

/**
 * GET / - Wiki API root/usage info
 */
export async function handleWikiRoot(_ctx: RequestContext): Promise<Response> {
  return jsonResponse({
    name: 'wikipedia.org.ai',
    description: 'Wikipedia article parser API',
    usage: {
      '/Albert_Einstein': 'Get article as Markdown (default)',
      '/Albert_Einstein.json': 'Get full article as JSON',
      '/Albert_Einstein/summary': 'Get concise summary',
      '/Albert_Einstein/infobox': 'Get infobox data only',
      '/Albert_Einstein/links': 'Get links only',
      '/Albert_Einstein/text': 'Get plain text',
      '/fr/Paris': 'French Wikipedia article',
      'POST / { wikitext, title }': 'Parse raw wikitext',
    },
  });
}

/**
 * POST / - Parse raw wikitext
 */
export async function handleWikiParsePost(ctx: RequestContext): Promise<Response> {
  await ensureDataLoaded(ctx.ctx);

  try {
    const body = (await ctx.request.json()) as ParseRequest;
    const doc = wtf(body.wikitext || '', { title: body.title || 'Untitled' });
    const format = body.format || 'json';

    if (format === 'md' || format === 'markdown') {
      return new Response(toMarkdown(doc), {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }
    return jsonResponse(toFullJson(doc));
  } catch (error) {
    return errorResponse('BAD_REQUEST', (error as Error).message, 400);
  }
}

/**
 * GET /:lang/:title* - Get article with optional language, section, and format
 * Handles all variations:
 *   /:title
 *   /:title.json
 *   /:title/summary
 *   /:lang/:title
 *   /:lang/:title.json
 *   /:lang/:title/summary
 *   etc.
 */
export async function handleWikiArticle(ctx: RequestContext): Promise<Response> {
  await ensureDataLoaded(ctx.ctx);

  const url = new URL(ctx.request.url);
  const path = url.pathname;

  try {
    // Parse path: /[lang/]Title[.json][/section]
    const { title, lang, format, section } = parsePath(path);

    if (!title) {
      return errorResponse('BAD_REQUEST', 'Invalid path', 400);
    }

    // Fetch article
    const article = await fetchWikipediaArticle(title, lang);
    if (!article) {
      return errorResponse('NOT_FOUND', `Article not found: ${title}`, 404);
    }

    // Parse
    const doc = wtf(article.wikitext, { title: article.title });

    // Handle sections
    if (section === 'summary') {
      const summary = doc
        .sentences()
        .slice(0, 3)
        .map((s) => s.text())
        .join(' ');
      if (format === 'json') {
        return jsonResponse({ title: doc.title(), summary });
      }
      return new Response(`# ${doc.title()}\n\n${summary}`, {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      });
    }

    if (section === 'infobox') {
      const infoboxes = doc.infoboxes().map((i) => ({ type: i.type(), data: i.json() }));
      return jsonResponse({ title: doc.title(), infoboxes });
    }

    if (section === 'links') {
      const links = doc.links().map((l) => l.json());
      return jsonResponse({ title: doc.title(), links });
    }

    if (section === 'categories') {
      return jsonResponse({ title: doc.title(), categories: doc.categories() });
    }

    if (section === 'text') {
      return new Response(doc.text(), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Full response based on format
    if (format === 'json') {
      return jsonResponse(toFullJson(doc));
    }

    if (format === 'txt') {
      return new Response(doc.text(), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // Default: Markdown
    return new Response(toMarkdown(doc), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
  } catch (error) {
    return errorResponse('INTERNAL_ERROR', (error as Error).message, 500);
  }
}
