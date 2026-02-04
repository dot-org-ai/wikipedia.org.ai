// @ts-nocheck - Complex Parquet writing with hyparquet-writer library and array operations requiring extensive null checking
/**
 * Relationship Parquet Writer
 *
 * Extracts and stores relationships from Wikipedia articles:
 * - Forward index: from_id -> to_id relationships
 * - Reverse index: to_id -> from_id for backlink queries
 * - Supports multiple predicate types (links_to, born_in, etc.)
 */

import { parquetWriteBuffer } from '@dotdo/hyparquet-writer';
import type {
  ArticleRecord,
  ForwardRelationship,
  ReverseRelationship,
  RelationshipWriterConfig,
  WriteResult,
  ManifestFile,
} from './types.js';
import {
  FORWARD_REL_SCHEMA,
  REVERSE_REL_SCHEMA,
  PREDICATES,
  REVERSE_PREDICATES,
} from './types.js';

/** Default configuration values */
const DEFAULT_ROW_GROUP_SIZE = 100000;
const DEFAULT_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Extracted link from wiki content
 */
export interface ExtractedLink {
  /** Target page title */
  targetTitle: string;
  /** Target article ID (if resolved) */
  targetId?: string;
  /** Relationship predicate */
  predicate: string;
  /** Context around the link */
  context?: string;
}

/**
 * RelationshipWriter - Writes relationship data to Parquet files
 *
 * Features:
 * - Separate forward and reverse indexes for efficient queries
 * - Automatic file rollover at size limits
 * - Sorted by source/target for better compression
 */
export class RelationshipWriter {
  private readonly config: Required<RelationshipWriterConfig>;
  private forwardBuffer: ForwardRelationship[] = [];
  private reverseBuffer: ReverseRelationship[] = [];
  private forwardFiles: WriteResult[] = [];
  private reverseFiles: WriteResult[] = [];
  private forwardShardIndex = 0;
  private reverseShardIndex = 0;
  private closed = false;

  constructor(config: RelationshipWriterConfig) {
    this.config = {
      outputDir: config.outputDir,
      rowGroupSize: config.rowGroupSize ?? DEFAULT_ROW_GROUP_SIZE,
      maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    };
  }

  /**
   * Add relationships from an article
   * Extracts links and creates both forward and reverse entries
   */
  async addArticle(
    article: ArticleRecord,
    links: ExtractedLink[],
    titleToId: Map<string, string>
  ): Promise<void> {
    if (this.closed) {
      throw new Error('Writer is closed');
    }

    for (const link of links) {
      const targetId = link.targetId ?? titleToId.get(link.targetTitle);
      if (!targetId) {
        // Skip unresolved links
        continue;
      }

      // Add forward relationship
      this.forwardBuffer.push({
        from_id: article.$id,
        predicate: link.predicate,
        to_id: targetId,
        to_title: link.targetTitle,
      });

      // Add reverse relationship
      const reversePredicate =
        REVERSE_PREDICATES[link.predicate] ?? `reverse_${link.predicate}`;
      this.reverseBuffer.push({
        to_id: targetId,
        reverse_predicate: reversePredicate,
        from_id: article.$id,
        from_title: article.title,
      });
    }

    // Flush if buffers are full
    if (this.forwardBuffer.length >= this.config.rowGroupSize) {
      await this.flushForward();
    }
    if (this.reverseBuffer.length >= this.config.rowGroupSize) {
      await this.flushReverse();
    }
  }

  /**
   * Add raw forward relationships
   */
  async addForward(relationships: ForwardRelationship[]): Promise<void> {
    if (this.closed) {
      throw new Error('Writer is closed');
    }

    this.forwardBuffer.push(...relationships);

    while (this.forwardBuffer.length >= this.config.rowGroupSize) {
      await this.flushForward();
    }
  }

  /**
   * Add raw reverse relationships
   */
  async addReverse(relationships: ReverseRelationship[]): Promise<void> {
    if (this.closed) {
      throw new Error('Writer is closed');
    }

    this.reverseBuffer.push(...relationships);

    while (this.reverseBuffer.length >= this.config.rowGroupSize) {
      await this.flushReverse();
    }
  }

  /**
   * Flush all buffers
   */
  async flush(): Promise<void> {
    if (this.forwardBuffer.length > 0) {
      await this.flushForward();
    }
    if (this.reverseBuffer.length > 0) {
      await this.flushReverse();
    }
  }

  /**
   * Finalize and return written files
   */
  async finalize(): Promise<{
    forwardFiles: ManifestFile[];
    reverseFiles: ManifestFile[];
  }> {
    if (this.closed) {
      throw new Error('Writer already closed');
    }

    this.closed = true;
    await this.flush();

    const toManifestFile = (result: WriteResult, index: number): ManifestFile => ({
      path: result.path.replace(this.config.outputDir + '/', ''),
      size: result.size,
      rowCount: result.rowCount,
      rowGroups: result.rowGroups,
      shard: index,
    });

    return {
      forwardFiles: this.forwardFiles.map(toManifestFile),
      reverseFiles: this.reverseFiles.map(toManifestFile),
    };
  }

  /**
   * Get statistics
   */
  getStats(): {
    forward: { rows: number; files: number; bytes: number };
    reverse: { rows: number; files: number; bytes: number };
  } {
    return {
      forward: {
        rows: this.forwardFiles.reduce((sum, f) => sum + f.rowCount, 0),
        files: this.forwardFiles.length,
        bytes: this.forwardFiles.reduce((sum, f) => sum + f.size, 0),
      },
      reverse: {
        rows: this.reverseFiles.reduce((sum, f) => sum + f.rowCount, 0),
        files: this.reverseFiles.length,
        bytes: this.reverseFiles.reduce((sum, f) => sum + f.size, 0),
      },
    };
  }

  /**
   * Flush forward buffer to file
   */
  private async flushForward(): Promise<void> {
    const count = Math.min(this.forwardBuffer.length, this.config.rowGroupSize);
    const relationships = this.forwardBuffer.splice(0, count);

    // Sort by from_id for better compression
    relationships.sort((a, b) => a.from_id.localeCompare(b.from_id));

    const buffer = this.writeForwardToBuffer(relationships);

    // Check for shard rollover
    const totalBytes = this.forwardFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes + buffer.byteLength > this.config.maxFileSize * (this.forwardShardIndex + 1)) {
      this.forwardShardIndex++;
    }

    const path = `${this.config.outputDir}/rels/forward/forward.${this.forwardShardIndex}.parquet`;
    await this.writeToFile(path, buffer);

    this.forwardFiles.push({
      path,
      size: buffer.byteLength,
      rowCount: relationships.length,
      rowGroups: 1,
    });
  }

  /**
   * Flush reverse buffer to file
   */
  private async flushReverse(): Promise<void> {
    const count = Math.min(this.reverseBuffer.length, this.config.rowGroupSize);
    const relationships = this.reverseBuffer.splice(0, count);

    // Sort by to_id for better compression
    relationships.sort((a, b) => a.to_id.localeCompare(b.to_id));

    const buffer = this.writeReverseToBuffer(relationships);

    // Check for shard rollover
    const totalBytes = this.reverseFiles.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes + buffer.byteLength > this.config.maxFileSize * (this.reverseShardIndex + 1)) {
      this.reverseShardIndex++;
    }

    const path = `${this.config.outputDir}/rels/reverse/reverse.${this.reverseShardIndex}.parquet`;
    await this.writeToFile(path, buffer);

    this.reverseFiles.push({
      path,
      size: buffer.byteLength,
      rowCount: relationships.length,
      rowGroups: 1,
    });
  }

  /**
   * Write forward relationships to buffer
   */
  private writeForwardToBuffer(relationships: ForwardRelationship[]): ArrayBuffer {
    return parquetWriteBuffer({
      columnData: [
        { name: 'from_id', data: relationships.map((r) => r.from_id) },
        { name: 'predicate', data: relationships.map((r) => r.predicate) },
        { name: 'to_id', data: relationships.map((r) => r.to_id) },
        { name: 'to_title', data: relationships.map((r) => r.to_title) },
      ],
      schema: FORWARD_REL_SCHEMA,
      statistics: true,
      rowGroupSize: this.config.rowGroupSize,
      kvMetadata: [
        { key: 'writer', value: 'wikipedia.org.ai' },
        { key: 'index_type', value: 'forward' },
      ],
    });
  }

  /**
   * Write reverse relationships to buffer
   */
  private writeReverseToBuffer(relationships: ReverseRelationship[]): ArrayBuffer {
    return parquetWriteBuffer({
      columnData: [
        { name: 'to_id', data: relationships.map((r) => r.to_id) },
        { name: 'reverse_predicate', data: relationships.map((r) => r.reverse_predicate) },
        { name: 'from_id', data: relationships.map((r) => r.from_id) },
        { name: 'from_title', data: relationships.map((r) => r.from_title) },
      ],
      schema: REVERSE_REL_SCHEMA,
      statistics: true,
      rowGroupSize: this.config.rowGroupSize,
      kvMetadata: [
        { key: 'writer', value: 'wikipedia.org.ai' },
        { key: 'index_type', value: 'reverse' },
      ],
    });
  }

  /**
   * Platform-specific file write
   */
  private async writeToFile(path: string, buffer: ArrayBuffer): Promise<void> {
    if (typeof Bun !== 'undefined') {
      await Bun.write(path, buffer);
    } else {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(buffer));
    }
  }
}

/**
 * Extract links from article content
 * Identifies wiki links and classifies their predicates
 */
export function extractLinks(
  _article: ArticleRecord,
  content: string,
  infobox: Record<string, unknown> | null
): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seenTargets = new Set<string>();

  // Extract wiki links from content using regex
  // Pattern: [[Target|Display]] or [[Target]]
  const linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    const targetTitle = normalizeTitle(match[1]);
    if (targetTitle && !seenTargets.has(targetTitle)) {
      seenTargets.add(targetTitle);
      links.push({
        targetTitle,
        predicate: PREDICATES.LINKS_TO,
      });
    }
  }

  // Extract semantic relationships from infobox
  if (infobox) {
    // Birth place
    if (infobox.birth_place && typeof infobox.birth_place === 'string') {
      const place = extractPlaceFromText(infobox.birth_place);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.BORN_IN,
        });
      }
    }

    // Death place
    if (infobox.death_place && typeof infobox.death_place === 'string') {
      const place = extractPlaceFromText(infobox.death_place);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.DIED_IN,
        });
      }
    }

    // Organization membership
    if (infobox.employer && typeof infobox.employer === 'string') {
      const org = extractPlaceFromText(infobox.employer);
      if (org && !seenTargets.has(org)) {
        seenTargets.add(org);
        links.push({
          targetTitle: org,
          predicate: PREDICATES.MEMBER_OF,
        });
      }
    }

    // Location
    if (infobox.location && typeof infobox.location === 'string') {
      const place = extractPlaceFromText(infobox.location);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.LOCATED_IN,
        });
      }
    }

    // Headquarters
    if (infobox.headquarters && typeof infobox.headquarters === 'string') {
      const place = extractPlaceFromText(infobox.headquarters);
      if (place && !seenTargets.has(place)) {
        seenTargets.add(place);
        links.push({
          targetTitle: place,
          predicate: PREDICATES.HEADQUARTERED_AT,
        });
      }
    }

    // Creator/Author
    const creatorFields = ['author', 'creator', 'director', 'composer', 'artist'];
    for (const field of creatorFields) {
      if (infobox[field] && typeof infobox[field] === 'string') {
        const creator = extractPlaceFromText(infobox[field] as string);
        if (creator && !seenTargets.has(creator)) {
          seenTargets.add(creator);
          links.push({
            targetTitle: creator,
            predicate: PREDICATES.CREATED_BY,
          });
        }
      }
    }
  }

  return links;
}

/**
 * Normalize a wiki title
 */
function normalizeTitle(title: string): string | null {
  // Remove leading/trailing whitespace
  let normalized = title.trim();

  // Skip empty titles
  if (!normalized) return null;

  // Skip special namespaces
  if (normalized.includes(':')) {
    const namespace = normalized.split(':')[0].toLowerCase();
    const skipNamespaces = [
      'file',
      'image',
      'category',
      'template',
      'wikipedia',
      'help',
      'portal',
      'special',
      'mediawiki',
    ];
    if (skipNamespaces.includes(namespace)) {
      return null;
    }
  }

  // Capitalize first letter (Wikipedia convention)
  normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);

  // Replace underscores with spaces
  normalized = normalized.replace(/_/g, ' ');

  return normalized;
}

/**
 * Extract place name from wiki text
 * Handles [[Place]] and plain text
 */
function extractPlaceFromText(text: string): string | null {
  // Check for wiki link
  const linkMatch = text.match(/\[\[([^\]|]+)/);
  if (linkMatch) {
    return normalizeTitle(linkMatch[1]);
  }

  // Use plain text (first part before comma)
  const plainMatch = text.split(',')[0].trim();
  return plainMatch || null;
}

/**
 * Create a relationship writer with default settings
 */
export function createRelationshipWriter(outputDir: string): RelationshipWriter {
  return new RelationshipWriter({ outputDir });
}

/**
 * Batch process articles for relationships
 */
export async function extractAndWriteRelationships(
  writer: RelationshipWriter,
  articles: ArticleRecord[],
  titleToId: Map<string, string>
): Promise<void> {
  for (const article of articles) {
    const links = extractLinks(
      article,
      article.content,
      article.infobox as Record<string, unknown> | null
    );
    await writer.addArticle(article, links, titleToId);
  }
}
