/**
 * Tests for GeoIndex
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  GeoIndex,
  createGeoIndex,
  encodeGeohash,
  decodeGeohash,
  geohashBounds,
  geohashesInRadius,
  haversineDistance,
  boundingBox,
  isWithinBoundingBox,
  type GeoEntry,
  type BoundingBox,
} from '../../src/indexes/geo-index.js';

describe('Geohash Functions', () => {
  describe('encodeGeohash', () => {
    it('should encode coordinates to geohash', () => {
      // San Francisco
      const hash = encodeGeohash(37.7749, -122.4194, 6);
      expect(hash).toBe('9q8yyk');
    });

    it('should encode with different precisions', () => {
      const hash3 = encodeGeohash(37.7749, -122.4194, 3);
      const hash6 = encodeGeohash(37.7749, -122.4194, 6);
      const hash9 = encodeGeohash(37.7749, -122.4194, 9);

      expect(hash3.length).toBe(3);
      expect(hash6.length).toBe(6);
      expect(hash9.length).toBe(9);

      // Shorter hashes should be prefix of longer ones
      expect(hash6.startsWith(hash3)).toBe(true);
      expect(hash9.startsWith(hash6)).toBe(true);
    });

    it('should handle edge coordinates', () => {
      // North pole
      const northPole = encodeGeohash(90, 0, 6);
      expect(northPole.length).toBe(6);

      // South pole
      const southPole = encodeGeohash(-90, 0, 6);
      expect(southPole.length).toBe(6);

      // International date line
      const dateLineE = encodeGeohash(0, 180, 6);
      const dateLineW = encodeGeohash(0, -180, 6);
      expect(dateLineE.length).toBe(6);
      expect(dateLineW.length).toBe(6);
    });

    it('should use default precision of 6', () => {
      const hash = encodeGeohash(0, 0);
      expect(hash.length).toBe(6);
    });
  });

  describe('decodeGeohash', () => {
    it('should decode geohash to coordinates', () => {
      const result = decodeGeohash('9q8yyk');

      // Should be close to San Francisco
      expect(result.lat).toBeCloseTo(37.7749, 1);
      expect(result.lng).toBeCloseTo(-122.4194, 1);
    });

    it('should return error bounds', () => {
      const result = decodeGeohash('9q8yyk');

      expect(result.latError).toBeGreaterThan(0);
      expect(result.lngError).toBeGreaterThan(0);
    });

    it('should have smaller error for longer hashes', () => {
      const result3 = decodeGeohash('9q8');
      const result6 = decodeGeohash('9q8yyk');
      const result9 = decodeGeohash('9q8yykhtp');

      expect(result6.latError).toBeLessThan(result3.latError);
      expect(result9.latError).toBeLessThan(result6.latError);
    });

    it('should throw on invalid character', () => {
      expect(() => decodeGeohash('invalid!')).toThrow();
    });

    it('should be inverse of encode (approximately)', () => {
      const lat = 40.7128;
      const lng = -74.006;
      const hash = encodeGeohash(lat, lng, 9);
      const decoded = decodeGeohash(hash);

      expect(decoded.lat).toBeCloseTo(lat, 3);
      expect(decoded.lng).toBeCloseTo(lng, 3);
    });
  });

  describe('geohashBounds', () => {
    it('should return bounding box [minLat, minLng, maxLat, maxLng]', () => {
      const bounds = geohashBounds('9q8yyk');

      expect(bounds.length).toBe(4);
      expect(bounds[0]).toBeLessThan(bounds[2]); // minLat < maxLat
      expect(bounds[1]).toBeLessThan(bounds[3]); // minLng < maxLng
    });

    it('should contain the geohash center point', () => {
      const hash = '9q8yyk';
      const decoded = decodeGeohash(hash);
      const bounds = geohashBounds(hash);

      expect(decoded.lat).toBeGreaterThanOrEqual(bounds[0]);
      expect(decoded.lat).toBeLessThanOrEqual(bounds[2]);
      expect(decoded.lng).toBeGreaterThanOrEqual(bounds[1]);
      expect(decoded.lng).toBeLessThanOrEqual(bounds[3]);
    });
  });

  describe('geohashesInRadius', () => {
    it('should return set of geohashes', () => {
      const hashes = geohashesInRadius(37.7749, -122.4194, 1000, 6);
      expect(hashes).toBeInstanceOf(Set);
      expect(hashes.size).toBeGreaterThan(0);
    });

    it('should include center cell', () => {
      const centerHash = encodeGeohash(37.7749, -122.4194, 6);
      const hashes = geohashesInRadius(37.7749, -122.4194, 1000, 6);
      expect(hashes.has(centerHash)).toBe(true);
    });

    it('should return more cells for larger radius', () => {
      const small = geohashesInRadius(37.7749, -122.4194, 100, 6);
      const large = geohashesInRadius(37.7749, -122.4194, 10000, 6);
      expect(large.size).toBeGreaterThan(small.size);
    });

    it('should return fewer cells for higher precision', () => {
      // Higher precision = smaller cells = more cells needed for same area
      const p4 = geohashesInRadius(37.7749, -122.4194, 5000, 4);
      const p6 = geohashesInRadius(37.7749, -122.4194, 5000, 6);
      expect(p6.size).toBeGreaterThan(p4.size);
    });
  });
});

describe('Distance Functions', () => {
  describe('haversineDistance', () => {
    it('should return 0 for same point', () => {
      const dist = haversineDistance(37.7749, -122.4194, 37.7749, -122.4194);
      expect(dist).toBe(0);
    });

    it('should calculate distance in meters', () => {
      // SF to LA is about 559 km
      const dist = haversineDistance(37.7749, -122.4194, 34.0522, -118.2437);
      expect(dist).toBeGreaterThan(550000);
      expect(dist).toBeLessThan(570000);
    });

    it('should be symmetric', () => {
      const dist1 = haversineDistance(37.7749, -122.4194, 34.0522, -118.2437);
      const dist2 = haversineDistance(34.0522, -118.2437, 37.7749, -122.4194);
      expect(dist1).toBeCloseTo(dist2, 0);
    });

    it('should handle antipodal points', () => {
      // Roughly half earth circumference
      const dist = haversineDistance(0, 0, 0, 180);
      expect(dist).toBeGreaterThan(20000000); // > 20,000 km
    });

    it('should handle poles', () => {
      const dist = haversineDistance(90, 0, -90, 0);
      // Should be roughly half earth circumference (pole to pole)
      expect(dist).toBeGreaterThan(20000000);
    });
  });

  describe('boundingBox', () => {
    it('should return valid bounding box', () => {
      const bbox = boundingBox(37.7749, -122.4194, 1000);

      expect(bbox.minLat).toBeLessThan(bbox.maxLat);
      expect(bbox.minLng).toBeLessThan(bbox.maxLng);
    });

    it('should contain center point', () => {
      const lat = 37.7749;
      const lng = -122.4194;
      const bbox = boundingBox(lat, lng, 1000);

      expect(lat).toBeGreaterThan(bbox.minLat);
      expect(lat).toBeLessThan(bbox.maxLat);
      expect(lng).toBeGreaterThan(bbox.minLng);
      expect(lng).toBeLessThan(bbox.maxLng);
    });

    it('should expand with larger radius', () => {
      const small = boundingBox(37.7749, -122.4194, 100);
      const large = boundingBox(37.7749, -122.4194, 10000);

      const smallArea = (small.maxLat - small.minLat) * (small.maxLng - small.minLng);
      const largeArea = (large.maxLat - large.minLat) * (large.maxLng - large.minLng);

      expect(largeArea).toBeGreaterThan(smallArea);
    });

    it('should clamp to valid lat/lng ranges', () => {
      const bbox = boundingBox(89, 0, 1000000); // Near pole with large radius

      expect(bbox.minLat).toBeGreaterThanOrEqual(-90);
      expect(bbox.maxLat).toBeLessThanOrEqual(90);
    });
  });

  describe('isWithinBoundingBox', () => {
    const bbox: BoundingBox = {
      minLat: 37.0,
      maxLat: 38.0,
      minLng: -123.0,
      maxLng: -122.0,
    };

    it('should return true for point inside', () => {
      expect(isWithinBoundingBox(37.5, -122.5, bbox)).toBe(true);
    });

    it('should return false for point outside (north)', () => {
      expect(isWithinBoundingBox(39, -122.5, bbox)).toBe(false);
    });

    it('should return false for point outside (south)', () => {
      expect(isWithinBoundingBox(36, -122.5, bbox)).toBe(false);
    });

    it('should return false for point outside (east)', () => {
      expect(isWithinBoundingBox(37.5, -121, bbox)).toBe(false);
    });

    it('should return false for point outside (west)', () => {
      expect(isWithinBoundingBox(37.5, -124, bbox)).toBe(false);
    });

    it('should handle date line crossing', () => {
      // Box that crosses date line (minLng > maxLng)
      const dateLineBox: BoundingBox = {
        minLat: -10,
        maxLat: 10,
        minLng: 170,
        maxLng: -170,
      };

      expect(isWithinBoundingBox(0, 175, dateLineBox)).toBe(true);
      expect(isWithinBoundingBox(0, -175, dateLineBox)).toBe(true);
      expect(isWithinBoundingBox(0, 0, dateLineBox)).toBe(false);
    });
  });
});

describe('GeoIndex', () => {
  let index: GeoIndex;

  const testEntries = [
    {
      articleId: 'sf',
      lat: 37.7749,
      lng: -122.4194,
      title: 'San Francisco',
      type: 'place' as const,
      file: 'places/0.parquet',
      rowGroup: 0,
      row: 0,
    },
    {
      articleId: 'la',
      lat: 34.0522,
      lng: -118.2437,
      title: 'Los Angeles',
      type: 'place' as const,
      file: 'places/0.parquet',
      rowGroup: 0,
      row: 1,
    },
    {
      articleId: 'oak',
      lat: 37.8044,
      lng: -122.2712,
      title: 'Oakland',
      type: 'place' as const,
      file: 'places/0.parquet',
      rowGroup: 0,
      row: 2,
    },
    {
      articleId: 'sj',
      lat: 37.3382,
      lng: -121.8863,
      title: 'San Jose',
      type: 'place' as const,
      file: 'places/0.parquet',
      rowGroup: 0,
      row: 3,
    },
  ];

  beforeEach(() => {
    index = createGeoIndex();
    for (const entry of testEntries) {
      index.insert(entry);
    }
  });

  describe('insert', () => {
    it('should add entries to index', () => {
      expect(index.size).toBe(4);
    });

    it('should assign geohash to entry', () => {
      const entry = index.getEntry('sf');
      expect(entry?.geohash).toBeDefined();
      expect(entry?.geohash.length).toBe(6);
    });

    it('should replace existing entry with same ID', () => {
      index.insert({
        articleId: 'sf',
        lat: 38.0,
        lng: -123.0,
        title: 'SF Updated',
        type: 'place' as const,
        file: 'places/0.parquet',
        rowGroup: 0,
        row: 0,
      });

      expect(index.size).toBe(4);
      expect(index.getEntry('sf')?.title).toBe('SF Updated');
    });
  });

  describe('remove', () => {
    it('should remove entry by ID', () => {
      const result = index.remove('sf');
      expect(result).toBe(true);
      expect(index.size).toBe(3);
      expect(index.getEntry('sf')).toBeUndefined();
    });

    it('should return false for non-existent ID', () => {
      const result = index.remove('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('search', () => {
    it('should find nearby articles', () => {
      // Search near San Francisco
      const results = index.search(37.78, -122.42, { maxDistance: 10000 });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.entry.articleId === 'sf')).toBe(true);
    });

    it('should order by distance', () => {
      const results = index.search(37.78, -122.42, { maxDistance: 100000 });

      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
      }
    });

    it('should respect maxDistance', () => {
      // Search with small radius should not find LA
      const results = index.search(37.78, -122.42, { maxDistance: 50000 });

      expect(results.every(r => r.distance <= 50000)).toBe(true);
      expect(results.some(r => r.entry.articleId === 'la')).toBe(false);
    });

    it('should respect minDistance', () => {
      const results = index.search(37.78, -122.42, {
        maxDistance: 100000,
        minDistance: 5000,
      });

      expect(results.every(r => r.distance >= 5000)).toBe(true);
    });

    it('should respect limit', () => {
      const results = index.search(37.78, -122.42, {
        maxDistance: 100000,
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should filter by types', () => {
      // Add a non-place entry
      index.insert({
        articleId: 'person1',
        lat: 37.77,
        lng: -122.41,
        title: 'Some Person',
        type: 'person' as const,
        file: 'people/0.parquet',
        rowGroup: 0,
        row: 0,
      });

      const results = index.search(37.78, -122.42, {
        maxDistance: 100000,
        types: ['place'],
      });

      expect(results.every(r => r.entry.type === 'place')).toBe(true);
    });

    it('should return empty array when no matches', () => {
      // Search far from all entries
      const results = index.search(0, 0, { maxDistance: 1000 });
      expect(results).toEqual([]);
    });
  });

  describe('getAllArticleIds', () => {
    it('should return set of all IDs', () => {
      const ids = index.getAllArticleIds();

      expect(ids).toBeInstanceOf(Set);
      expect(ids.size).toBe(4);
      expect(ids.has('sf')).toBe(true);
      expect(ids.has('la')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return entry and bucket counts', () => {
      const stats = index.getStats();

      expect(stats.entryCount).toBe(4);
      expect(stats.bucketCount).toBeGreaterThan(0);
    });
  });

  describe('buildFromArticles', () => {
    it('should build index from article array', () => {
      const newIndex = createGeoIndex();
      newIndex.buildFromArticles([
        {
          id: 'art1',
          title: 'Place 1',
          type: 'place' as const,
          coords: { lat: 37.0, lon: -122.0 },
          file: 'test.parquet',
          rowGroup: 0,
          row: 0,
        },
        {
          id: 'art2',
          title: 'Place 2',
          type: 'place' as const,
          coords: { lat: 38.0, lon: -123.0 },
          file: 'test.parquet',
          rowGroup: 0,
          row: 1,
        },
        {
          id: 'art3',
          title: 'No Coords',
          type: 'other' as const,
          coords: null,
          file: 'test.parquet',
          rowGroup: 0,
          row: 2,
        },
      ]);

      expect(newIndex.size).toBe(2);
      expect(newIndex.ready).toBe(true);
    });

    it('should skip articles without coords', () => {
      const newIndex = createGeoIndex();
      newIndex.buildFromArticles([
        {
          id: 'art1',
          title: 'No Coords',
          type: 'other' as const,
          coords: null,
          file: 'test.parquet',
          rowGroup: 0,
          row: 0,
        },
      ]);

      expect(newIndex.size).toBe(0);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON-compatible format', () => {
      const serialized = index.serialize();

      expect(serialized.version).toBe(1);
      expect(serialized.entries).toBeInstanceOf(Array);
      expect(serialized.buckets).toBeDefined();
      expect(typeof serialized.buckets).toBe('object');
    });

    it('should deserialize correctly', () => {
      const serialized = index.serialize();
      const newIndex = createGeoIndex();
      newIndex.deserialize(serialized);

      expect(newIndex.size).toBe(index.size);
      expect(newIndex.ready).toBe(true);

      // Check entries match
      for (const id of index.getAllArticleIds()) {
        const original = index.getEntry(id);
        const restored = newIndex.getEntry(id);
        expect(restored?.title).toBe(original?.title);
        expect(restored?.lat).toBe(original?.lat);
        expect(restored?.lng).toBe(original?.lng);
      }
    });

    it('should throw on unsupported version', () => {
      const bad = { version: 99, entries: [], buckets: {} };
      const newIndex = createGeoIndex();
      expect(() => newIndex.deserialize(bad)).toThrow('Unsupported geo index version');
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      index.clear();
      expect(index.size).toBe(0);
      expect(index.ready).toBe(false);
    });
  });

  describe('ready property', () => {
    it('should be false initially', () => {
      const newIndex = createGeoIndex();
      expect(newIndex.ready).toBe(false);
    });

    it('should be true after buildFromArticles', () => {
      const newIndex = createGeoIndex();
      newIndex.buildFromArticles([
        {
          id: 'art1',
          title: 'Test',
          type: 'place' as const,
          coords: { lat: 0, lon: 0 },
          file: 'test.parquet',
          rowGroup: 0,
          row: 0,
        },
      ]);
      expect(newIndex.ready).toBe(true);
    });

    it('should be true after deserialize', () => {
      const serialized = index.serialize();
      const newIndex = createGeoIndex();
      newIndex.deserialize(serialized);
      expect(newIndex.ready).toBe(true);
    });
  });
});
