/**
 * Streaming XML parser for Wikipedia dump files
 *
 * Uses SAX parsing to process large XML files without loading them into memory.
 * Outputs WikiPage objects as they are parsed.
 */

import type { WikiPage } from './types.js';
// @ts-expect-error - saxophone types are incomplete
import Saxophone from 'saxophone';
import { createLogger, type Logger } from '../lib/logger.js';

/** Module-level logger (uses provider for DI support) */
const getLog = () => createLogger('ingest:parse-xml');

/** XML element names we care about */
const ELEMENTS = {
  PAGE: 'page',
  TITLE: 'title',
  ID: 'id',
  NS: 'ns',
  REVISION: 'revision',
  TEXT: 'text',
  TIMESTAMP: 'timestamp',
  REDIRECT: 'redirect',
} as const;

/** Parser state machine states */
type ParserState =
  | 'idle'
  | 'inPage'
  | 'inTitle'
  | 'inId'
  | 'inNs'
  | 'inRevision'
  | 'inText'
  | 'inTimestamp'
  | 'inRevisionId';

/** Options for the Wikipedia parser */
export interface WikipediaParserOptions {
  /** Optional logger for dependency injection (testing) */
  logger?: Logger;
}

/**
 * Create a streaming Wikipedia XML parser.
 *
 * @param options - Parser options including optional logger for DI
 * @returns TransformStream that converts XML chunks to WikiPage objects
 *
 * @example
 * ```typescript
 * const parser = createWikipediaParser();
 * const pageStream = xmlStream.pipeThrough(parser);
 *
 * for await (const page of pageStream) {
 *   console.log(page.title);
 * }
 * ```
 */
export function createWikipediaParser(options: WikipediaParserOptions = {}): TransformStream<Uint8Array, WikiPage> {
  const log = options.logger ?? getLog();
  // SAX parser instance
  const sax = new Saxophone();

  // Current parser state
  let state: ParserState = 'idle';

  // Current page being built
  let currentPage: Partial<WikiPage> | null = null;

  // Text accumulator for current element
  let textBuffer = '';

  // Track if we're in revision (to distinguish page id from revision id)
  let inRevision = false;

  // Queue of completed pages ready to emit
  const pageQueue: WikiPage[] = [];

  // Resolver for when pages are available
  let resolvePages: (() => void) | null = null;

  // Set up SAX event handlers (note: saxophone uses lowercase event names)
  sax.on('tagopen', (tag: { name: string; attrs: string; isSelfClosing: boolean }) => {
    const tagName = tag.name.toLowerCase();

    switch (tagName) {
      case ELEMENTS.PAGE:
        state = 'inPage';
        currentPage = {};
        break;

      case ELEMENTS.TITLE:
        if (state === 'inPage' && currentPage) {
          state = 'inTitle';
          textBuffer = '';
        }
        break;

      case ELEMENTS.ID:
        if (currentPage && !inRevision) {
          state = 'inId';
          textBuffer = '';
        } else if (inRevision) {
          state = 'inRevisionId';
          textBuffer = '';
        }
        break;

      case ELEMENTS.NS:
        if (state === 'inPage' && currentPage) {
          state = 'inNs';
          textBuffer = '';
        }
        break;

      case ELEMENTS.REVISION:
        if (currentPage) {
          inRevision = true;
          state = 'inRevision';
        }
        break;

      case ELEMENTS.TEXT:
        if (inRevision && currentPage) {
          state = 'inText';
          textBuffer = '';
        }
        break;

      case ELEMENTS.TIMESTAMP:
        if (inRevision && currentPage) {
          state = 'inTimestamp';
          textBuffer = '';
        }
        break;

      case ELEMENTS.REDIRECT:
        if (currentPage) {
          // Extract redirect target from title attribute
          const attrs = parseAttributes(tag.attrs);
          if (attrs['title']) {
            currentPage.redirect = attrs['title'];
          }
        }
        break;
    }
  });

  sax.on('tagclose', (tag: { name: string }) => {
    const tagName = tag.name.toLowerCase();

    switch (tagName) {
      case ELEMENTS.PAGE:
        // Emit completed page
        if (currentPage && isCompletePage(currentPage)) {
          pageQueue.push(currentPage as WikiPage);
          if (resolvePages) {
            resolvePages();
            resolvePages = null;
          }
        }
        currentPage = null;
        state = 'idle';
        inRevision = false;
        break;

      case ELEMENTS.TITLE:
        if (state === 'inTitle' && currentPage) {
          currentPage.title = textBuffer;
          state = 'inPage';
        }
        break;

      case ELEMENTS.ID:
        if (state === 'inId' && currentPage) {
          currentPage.id = parseInt(textBuffer, 10);
          state = 'inPage';
        } else if (state === 'inRevisionId') {
          // Ignore revision ID, we use page ID
          state = 'inRevision';
        }
        break;

      case ELEMENTS.NS:
        if (state === 'inNs' && currentPage) {
          currentPage.ns = parseInt(textBuffer, 10);
          state = 'inPage';
        }
        break;

      case ELEMENTS.REVISION:
        if (inRevision) {
          inRevision = false;
          state = 'inPage';
        }
        break;

      case ELEMENTS.TEXT:
        if (state === 'inText' && currentPage) {
          currentPage.text = textBuffer;
          state = 'inRevision';
        }
        break;

      case ELEMENTS.TIMESTAMP:
        if (state === 'inTimestamp' && currentPage) {
          currentPage.timestamp = textBuffer;
          state = 'inRevision';
        }
        break;
    }
  });

  sax.on('text', (text: { contents: string }) => {
    // Accumulate text content
    switch (state) {
      case 'inTitle':
      case 'inId':
      case 'inNs':
      case 'inText':
      case 'inTimestamp':
      case 'inRevisionId':
        textBuffer += decodeXmlEntities(text.contents);
        break;
    }
  });

  sax.on('cdata', (cdata: { contents: string }) => {
    // CDATA content (usually in text elements)
    if (state === 'inText') {
      textBuffer += cdata.contents;
    }
  });

  // Handle parsing errors gracefully
  sax.on('error', (error: Error) => {
    log.warn('XML parse error', { error: error.message }, 'saxParser');
    // Continue parsing - don't throw
  });

  // Create the TransformStream
  return new TransformStream<Uint8Array, WikiPage>(
    {
      transform(chunk, controller) {
        // Feed chunk directly to SAX parser (saxophone accepts Buffer/Uint8Array)
        sax.write(Buffer.from(chunk));

        // Emit any completed pages
        while (pageQueue.length > 0) {
          const page = pageQueue.shift()!;
          controller.enqueue(page);
        }
      },

      flush(controller) {
        // Signal end of stream to SAX parser
        sax.end();

        // Emit any remaining pages
        while (pageQueue.length > 0) {
          const page = pageQueue.shift()!;
          controller.enqueue(page);
        }
      },
    },
    // Queuing strategies for backpressure
    { highWaterMark: 64 * 1024 }, // 64KB input buffer
    { highWaterMark: 100 }        // 100 pages output buffer
  );
}

/**
 * Check if a partial page has all required fields
 */
function isCompletePage(page: Partial<WikiPage>): page is WikiPage {
  return (
    typeof page.title === 'string' &&
    typeof page.id === 'number' &&
    typeof page.ns === 'number' &&
    typeof page.text === 'string' &&
    typeof page.timestamp === 'string'
  );
}

/**
 * Parse XML attributes from a string
 */
function parseAttributes(attrs: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match;

  while ((match = regex.exec(attrs)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) {
      result[key] = decodeXmlEntities(value);
    }
  }

  return result;
}

/**
 * Decode common XML entities
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Create a filter stream that only passes through article namespace pages.
 *
 * @param namespaces - Array of namespace numbers to include (default: [0] for main articles)
 * @returns TransformStream that filters pages by namespace
 */
export function createNamespaceFilter(
  namespaces: number[] = [0]
): TransformStream<WikiPage, WikiPage> {
  const nsSet = new Set(namespaces);

  return new TransformStream<WikiPage, WikiPage>({
    transform(page, controller) {
      if (nsSet.has(page.ns)) {
        controller.enqueue(page);
      }
    },
  });
}

/**
 * Create a stream that counts pages and reports statistics
 */
export function createPageCounter(
  onCount?: (total: number, articles: number, skipped: number) => void
): TransformStream<WikiPage, WikiPage> {
  let total = 0;
  let articles = 0;
  let skipped = 0;
  let lastReport = Date.now();

  return new TransformStream<WikiPage, WikiPage>({
    transform(page, controller) {
      total++;

      if (page.ns === 0) {
        articles++;
      } else {
        skipped++;
      }

      // Report every second
      const now = Date.now();
      if (onCount && now - lastReport >= 1000) {
        lastReport = now;
        onCount(total, articles, skipped);
      }

      controller.enqueue(page);
    },

    flush() {
      if (onCount) {
        onCount(total, articles, skipped);
      }
    },
  });
}
