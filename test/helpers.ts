/**
 * Test helpers and utilities
 */

import type { Article, ClassifiedArticle, WikiPage } from '../src/ingest/types.js';
import type { ArticleRecord, ArticleType } from '../src/storage/types.js';

/**
 * Create a mock WikiPage for testing
 */
export function createMockWikiPage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    title: 'Test Page',
    id: Math.floor(Math.random() * 1000000),
    ns: 0,
    text: '{{Infobox test}}\n\nThis is test content.',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock Article for testing
 */
export function createMockArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: 'Test Article',
    id: Math.floor(Math.random() * 1000000),
    plaintext: 'This is a test article about something interesting.',
    infoboxes: [],
    links: [],
    categories: [],
    isRedirect: false,
    isDisambiguation: false,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Create a mock ClassifiedArticle for testing
 */
export function createMockClassifiedArticle(
  overrides: Partial<ClassifiedArticle> = {}
): ClassifiedArticle {
  return {
    ...createMockArticle(),
    type: 'other',
    ...overrides,
  };
}

/**
 * Create a mock ArticleRecord for testing
 */
export function createMockArticleRecord(
  overrides: Partial<ArticleRecord> = {}
): ArticleRecord {
  return {
    $id: `test-${Math.random().toString(36).substring(7)}`,
    $type: 'other' as ArticleType,
    title: 'Test Article',
    description: 'A test article description.',
    wikidata_id: null,
    coords_lat: null,
    coords_lon: null,
    infobox: null,
    content: 'Full test article content.',
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Create a readable stream from an array of items
 */
export function createReadableStreamFromArray<T>(items: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const item of items) {
        controller.enqueue(item);
      }
      controller.close();
    },
  });
}

/**
 * Collect all items from a readable stream into an array
 */
export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const items: T[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    items.push(value);
  }

  return items;
}

/**
 * Collect all items from an async iterable into an array
 */
export async function collectAsyncIterable<T>(
  iterable: AsyncIterable<T>
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

/**
 * Create a mock fetch response
 */
export function createMockFetchResponse(
  body: BodyInit | null,
  options: {
    ok?: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
  } = {}
): Response {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    headers = {},
  } = options;

  return {
    ok,
    status,
    statusText,
    headers: new Headers(headers),
    body: body ? new ReadableStream({
      start(controller) {
        if (typeof body === 'string') {
          controller.enqueue(new TextEncoder().encode(body));
        } else if (body instanceof ArrayBuffer) {
          controller.enqueue(new Uint8Array(body));
        } else if (body instanceof Uint8Array) {
          controller.enqueue(body);
        }
        controller.close();
      },
    }) : null,
    json: async () => {
      if (typeof body === 'string') {
        return JSON.parse(body);
      }
      throw new Error('Cannot parse body as JSON');
    },
    text: async () => {
      if (typeof body === 'string') {
        return body;
      }
      throw new Error('Cannot get body as text');
    },
  } as Response;
}

/**
 * Wait for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random text of specified length
 */
export function generateRandomText(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz ';
  let text = '';
  for (let i = 0; i < length; i++) {
    text += chars[Math.floor(Math.random() * chars.length)];
  }
  return text;
}

/**
 * Create sample Wikipedia XML content
 */
export function createSampleWikipediaXml(pages: WikiPage[]): string {
  const pageXml = pages.map(page => `
    <page>
      <title>${escapeXml(page.title)}</title>
      <ns>${page.ns}</ns>
      <id>${page.id}</id>
      ${page.redirect ? `<redirect title="${escapeXml(page.redirect)}" />` : ''}
      <revision>
        <timestamp>${page.timestamp}</timestamp>
        <text>${escapeXml(page.text)}</text>
      </revision>
    </page>
  `).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<mediawiki>
  <siteinfo>
    <sitename>Wikipedia</sitename>
  </siteinfo>
  ${pageXml}
</mediawiki>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
