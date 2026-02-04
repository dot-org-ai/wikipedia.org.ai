/**
 * GeoIndex for Wikipedia Articles
 *
 * Spatial index using geohash bucketing for efficient proximity queries.
 * Based on ParqueDB's geo index implementation.
 *
 * Features:
 * - Geohash-based bucketing for O(1) candidate lookup
 * - Haversine distance for accurate distance calculations
 * - Bounding box pre-filtering for performance
 * - Support for proximity queries with maxDistance
 */

import type { Article, ArticleType } from '../workers/api/types.js';
import { MAX_RESULTS_LIMIT } from '../lib/constants.js';

// =============================================================================
// Constants
// =============================================================================

/** Earth radius in meters */
const EARTH_RADIUS_METERS = 6371008.8;

/** Base32 character set for geohash */
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
const BASE32_MAP = new Map<string, number>();
for (let i = 0; i < BASE32.length; i++) {
  BASE32_MAP.set(BASE32[i]!, i);
}

/** Geohash neighbor directions */
const NEIGHBORS: Record<string, Record<string, string>> = {
  n: { even: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy', odd: 'bc01fg45238967deuvhjyznpkmstqrwx' },
  s: { even: '14365h7k9dcfesgujnmqp0r2twvyx8zb', odd: '238967debc01fg45uvhjyznpkmstqrwx' },
  e: { even: 'bc01fg45238967deuvhjyznpkmstqrwx', odd: 'p0r21436x8zb9dcf5h7kjnmqesgutwvy' },
  w: { even: '238967debc01fg45kmstqrwxuvhjyznp', odd: '14365h7k9dcfesgujnmqp0r2twvyx8zb' },
};

const BORDERS: Record<string, Record<string, string>> = {
  n: { even: 'prxz', odd: 'bcfguvyz' },
  s: { even: '028b', odd: '0145hjnp' },
  e: { even: 'bcfguvyz', odd: 'prxz' },
  w: { even: '0145hjnp', odd: '028b' },
};

// =============================================================================
// Geohash Functions
// =============================================================================

/**
 * Encode latitude/longitude to geohash
 *
 * @param lat - Latitude (-90 to 90)
 * @param lng - Longitude (-180 to 180)
 * @param precision - Number of characters (1-12, default 6 = ~1.2km)
 * @returns Geohash string
 */
export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;

  let hash = '';
  let bit = 0;
  let ch = 0;
  let isLng = true;

  while (hash.length < precision) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= 1 << (4 - bit);
        minLng = mid;
      } else {
        maxLng = mid;
      }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= 1 << (4 - bit);
        minLat = mid;
      } else {
        maxLat = mid;
      }
    }

    isLng = !isLng;
    bit++;

    if (bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return hash;
}

/**
 * Decoded geohash result with error bounds
 */
export interface GeohashDecodeResult {
  lat: number;
  lng: number;
  latError: number;
  lngError: number;
}

/**
 * Decode geohash to latitude/longitude with error bounds
 */
export function decodeGeohash(hash: string): GeohashDecodeResult {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;

  let isLng = true;

  for (let i = 0; i < hash.length; i++) {
    const char = hash[i]!.toLowerCase();
    const bits = BASE32_MAP.get(char);

    if (bits === undefined) {
      throw new Error(`Invalid geohash character: ${char}`);
    }

    for (let bit = 4; bit >= 0; bit--) {
      const bitValue = (bits >> bit) & 1;
      if (isLng) {
        const mid = (minLng + maxLng) / 2;
        if (bitValue === 1) {
          minLng = mid;
        } else {
          maxLng = mid;
        }
      } else {
        const mid = (minLat + maxLat) / 2;
        if (bitValue === 1) {
          minLat = mid;
        } else {
          maxLat = mid;
        }
      }
      isLng = !isLng;
    }
  }

  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    latError: (maxLat - minLat) / 2,
    lngError: (maxLng - minLng) / 2,
  };
}

/**
 * Get bounding box for a geohash
 */
export function geohashBounds(hash: string): [number, number, number, number] {
  const decoded = decodeGeohash(hash);
  return [
    decoded.lat - decoded.latError,
    decoded.lng - decoded.lngError,
    decoded.lat + decoded.latError,
    decoded.lng + decoded.lngError,
  ];
}

/**
 * Get adjacent geohash in a direction
 */
function getNeighbor(hash: string, direction: 'n' | 's' | 'e' | 'w'): string {
  if (hash.length === 0) {
    return '';
  }

  hash = hash.toLowerCase();
  const lastChar = hash[hash.length - 1]!;
  const type = hash.length % 2 === 0 ? 'even' : 'odd';
  let parent = hash.slice(0, -1);

  if (BORDERS[direction]![type]!.includes(lastChar)) {
    parent = getNeighbor(parent, direction);
    if (parent === '') {
      return '';
    }
  }

  const neighborChars = NEIGHBORS[direction]![type]!;
  const idx = neighborChars.indexOf(lastChar);
  if (idx === -1) {
    throw new Error(`Invalid geohash character: ${lastChar}`);
  }

  return parent + BASE32[idx];
}

/**
 * Get all 8 neighbors of a geohash cell
 */
function getNeighbors(hash: string): {
  n: string;
  ne: string;
  e: string;
  se: string;
  s: string;
  sw: string;
  w: string;
  nw: string;
} {
  const n = getNeighbor(hash, 'n');
  const s = getNeighbor(hash, 's');
  const e = getNeighbor(hash, 'e');
  const w = getNeighbor(hash, 'w');

  return {
    n,
    ne: n ? getNeighbor(n, 'e') : '',
    e,
    se: s ? getNeighbor(s, 'e') : '',
    s,
    sw: s ? getNeighbor(s, 'w') : '',
    w,
    nw: n ? getNeighbor(n, 'w') : '',
  };
}

/**
 * Check if a bounding box intersects with a circle
 */
function boundsIntersectsCircle(
  bounds: [number, number, number, number],
  centerLat: number,
  centerLng: number,
  radiusMeters: number
): boolean {
  const [minLat, minLng, maxLat, maxLng] = bounds;

  const closestLat = Math.max(minLat, Math.min(centerLat, maxLat));
  const closestLng = Math.max(minLng, Math.min(centerLng, maxLng));

  const latDiff = (closestLat - centerLat) * 111320;
  const lngDiff = (closestLng - centerLng) * 111320 * Math.cos((centerLat * Math.PI) / 180);
  const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

  return distance <= radiusMeters;
}

/**
 * Get all geohash prefixes that overlap with a circle
 */
export function geohashesInRadius(
  lat: number,
  lng: number,
  radiusMeters: number,
  precision: number
): Set<string> {
  const centerHash = encodeGeohash(lat, lng, precision);
  const result = new Set<string>();

  result.add(centerHash);

  const visited = new Set<string>([centerHash]);
  const queue = [centerHash];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = getNeighbors(current);

    for (const neighbor of Object.values(neighbors)) {
      if (!neighbor || visited.has(neighbor)) {
        continue;
      }

      visited.add(neighbor);

      const bounds = geohashBounds(neighbor);
      if (boundsIntersectsCircle(bounds, lat, lng, radiusMeters)) {
        result.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return result;
}

// =============================================================================
// Distance Functions
// =============================================================================

/**
 * Haversine distance between two points on Earth
 *
 * @param lat1 - Latitude of first point in degrees
 * @param lng1 - Longitude of first point in degrees
 * @param lat2 - Latitude of second point in degrees
 * @param lng2 - Longitude of second point in degrees
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRadians = (deg: number) => deg * (Math.PI / 180);

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Bounding box result
 */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Calculate bounding box for a point with radius
 */
export function boundingBox(lat: number, lng: number, radiusMeters: number): BoundingBox {
  const angularDistance = radiusMeters / EARTH_RADIUS_METERS;

  const latRad = lat * (Math.PI / 180);
  const lngRad = lng * (Math.PI / 180);

  const minLatRad = latRad - angularDistance;
  const maxLatRad = latRad + angularDistance;

  let minLngRad: number;
  let maxLngRad: number;

  if (minLatRad > -Math.PI / 2 && maxLatRad < Math.PI / 2) {
    const deltaLng = Math.asin(Math.sin(angularDistance) / Math.cos(latRad));
    minLngRad = lngRad - deltaLng;
    maxLngRad = lngRad + deltaLng;

    if (minLngRad < -Math.PI) {
      minLngRad += 2 * Math.PI;
    }
    if (maxLngRad > Math.PI) {
      maxLngRad -= 2 * Math.PI;
    }
  } else {
    minLngRad = -Math.PI;
    maxLngRad = Math.PI;
  }

  return {
    minLat: Math.max(-90, minLatRad * (180 / Math.PI)),
    maxLat: Math.min(90, maxLatRad * (180 / Math.PI)),
    minLng: minLngRad * (180 / Math.PI),
    maxLng: maxLngRad * (180 / Math.PI),
  };
}

/**
 * Check if a point is within a bounding box
 */
export function isWithinBoundingBox(lat: number, lng: number, box: BoundingBox): boolean {
  if (lat < box.minLat || lat > box.maxLat) {
    return false;
  }

  if (box.minLng > box.maxLng) {
    return lng >= box.minLng || lng <= box.maxLng;
  }

  return lng >= box.minLng && lng <= box.maxLng;
}

// =============================================================================
// GeoIndex Types
// =============================================================================

/**
 * Entry in the geo index
 */
export interface GeoEntry {
  /** Article ID */
  articleId: string;
  /** Latitude */
  lat: number;
  /** Longitude */
  lng: number;
  /** Article title (for display) */
  title: string;
  /** Article type */
  type: ArticleType;
  /** Precomputed geohash for fast filtering */
  geohash: string;
  /** File path for the article */
  file: string;
  /** Row group index */
  rowGroup: number;
  /** Row index within row group */
  row: number;
}

/**
 * Search result from geo index
 */
export interface GeoSearchResult {
  /** Article data */
  article: Article;
  /** Distance in meters from search point */
  distance: number;
  /** Distance in kilometers (for convenience) */
  distanceKm: number;
}

/**
 * Geo search options
 */
export interface GeoSearchOptions {
  /** Maximum distance in meters */
  maxDistance?: number;
  /** Minimum distance in meters */
  minDistance?: number;
  /** Maximum results to return */
  limit?: number;
  /** Filter by article types */
  types?: ArticleType[];
}

/**
 * Serialized geo index format for storage
 */
export interface SerializedGeoIndex {
  version: number;
  entries: GeoEntry[];
  buckets: Record<string, string[]>;
}

// =============================================================================
// GeoIndex Class
// =============================================================================

/**
 * GeoIndex implementation using geohash bucketing
 *
 * Uses geohash prefixes to bucket entries for O(1) candidate lookup.
 * Similar to an inverted index where the "terms" are geohash cells.
 */
export class GeoIndex {
  /** Geohash bucket precision for indexing (~1.2km cells) */
  private static readonly BUCKET_PRECISION = 6;

  /** All entries by articleId */
  private entries: Map<string, GeoEntry> = new Map();

  /** Geohash buckets: prefix -> articleIds */
  private buckets: Map<string, Set<string>> = new Map();

  /** Whether index is loaded */
  private loaded: boolean = false;

  /**
   * Check if index is ready
   */
  get ready(): boolean {
    return this.loaded;
  }

  /**
   * Get the number of entries in the index
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Insert a point into the index
   */
  insert(entry: Omit<GeoEntry, 'geohash'>): void {
    if (this.entries.has(entry.articleId)) {
      this.remove(entry.articleId);
    }

    const geohash = encodeGeohash(entry.lat, entry.lng, GeoIndex.BUCKET_PRECISION);

    const fullEntry: GeoEntry = {
      ...entry,
      geohash,
    };

    this.entries.set(entry.articleId, fullEntry);

    if (!this.buckets.has(geohash)) {
      this.buckets.set(geohash, new Set());
    }
    this.buckets.get(geohash)!.add(entry.articleId);
  }

  /**
   * Remove an article from the index
   */
  remove(articleId: string): boolean {
    const entry = this.entries.get(articleId);
    if (!entry) {
      return false;
    }

    const bucket = this.buckets.get(entry.geohash);
    if (bucket) {
      bucket.delete(articleId);
      if (bucket.size === 0) {
        this.buckets.delete(entry.geohash);
      }
    }

    this.entries.delete(articleId);
    return true;
  }

  /**
   * Search for articles near a location
   *
   * @param centerLat - Center latitude
   * @param centerLng - Center longitude
   * @param options - Search options
   * @returns Array of GeoEntry with distances, sorted by distance
   */
  search(
    centerLat: number,
    centerLng: number,
    options: GeoSearchOptions = {}
  ): Array<{ entry: GeoEntry; distance: number }> {
    const { maxDistance = Infinity, minDistance = 0, limit = MAX_RESULTS_LIMIT, types } = options;

    const candidateCells = geohashesInRadius(
      centerLat,
      centerLng,
      maxDistance,
      GeoIndex.BUCKET_PRECISION
    );

    const candidates: GeoEntry[] = [];

    for (const cell of candidateCells) {
      const bucket = this.buckets.get(cell);
      if (bucket) {
        for (const articleId of bucket) {
          const entry = this.entries.get(articleId);
          if (entry) {
            if (types && types.length > 0 && !types.includes(entry.type)) {
              continue;
            }
            candidates.push(entry);
          }
        }
      }
    }

    if (candidates.length === 0) {
      return [];
    }

    const bbox = boundingBox(centerLat, centerLng, maxDistance);
    const inBbox = candidates.filter((entry) =>
      isWithinBoundingBox(entry.lat, entry.lng, bbox)
    );

    const withDistances: Array<{ entry: GeoEntry; distance: number }> = [];

    for (const entry of inBbox) {
      const distance = haversineDistance(centerLat, centerLng, entry.lat, entry.lng);

      if (distance >= minDistance && distance <= maxDistance) {
        withDistances.push({ entry, distance });
      }
    }

    withDistances.sort((a, b) => a.distance - b.distance);

    return withDistances.slice(0, limit);
  }

  /**
   * Get all article IDs in the index
   */
  getAllArticleIds(): Set<string> {
    return new Set(this.entries.keys());
  }

  /**
   * Get entry by article ID
   */
  getEntry(articleId: string): GeoEntry | undefined {
    return this.entries.get(articleId);
  }

  /**
   * Get index statistics
   */
  getStats(): { entryCount: number; bucketCount: number } {
    return {
      entryCount: this.entries.size,
      bucketCount: this.buckets.size,
    };
  }

  /**
   * Build index from articles
   */
  buildFromArticles(
    articles: Array<{
      id: string;
      title: string;
      type: ArticleType;
      coords: { lat: number; lon: number } | null;
      file: string;
      rowGroup: number;
      row: number;
    }>
  ): void {
    this.clear();

    for (const article of articles) {
      if (article.coords !== null) {
        this.insert({
          articleId: article.id,
          lat: article.coords.lat,
          lng: article.coords.lon,
          title: article.title,
          type: article.type,
          file: article.file,
          rowGroup: article.rowGroup,
          row: article.row,
        });
      }
    }

    this.loaded = true;
  }

  /**
   * Serialize the index for storage
   */
  serialize(): SerializedGeoIndex {
    return {
      version: 1,
      entries: Array.from(this.entries.values()),
      buckets: Object.fromEntries(
        Array.from(this.buckets.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
    };
  }

  /**
   * Load from serialized data
   */
  deserialize(data: SerializedGeoIndex): void {
    if (data.version !== 1) {
      throw new Error(`Unsupported geo index version: ${data.version}`);
    }

    this.clear();

    for (const entry of data.entries) {
      this.entries.set(entry.articleId, entry);
    }

    for (const [prefix, articleIds] of Object.entries(data.buckets)) {
      this.buckets.set(prefix, new Set(articleIds));
    }

    this.loaded = true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.buckets.clear();
    this.loaded = false;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new GeoIndex instance
 */
export function createGeoIndex(): GeoIndex {
  return new GeoIndex();
}
