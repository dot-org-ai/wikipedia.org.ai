/**
 * Tests for IndexManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IndexManager,
  createIndexManager,
  createBrowserIndexManager,
  WikipediaFTSIndex,
  VectorIndex,
  GeoIndex,
  type IndexManagerOptions,
} from '../../src/indexes/index.js';
import type { ArticleRecord } from '../../src/storage/types.js';

describe('IndexManager', () => {
  let manager: IndexManager;

  beforeEach(() => {
    manager = createIndexManager({
      enableFTS: true,
      enableVector: true,
      enableGeo: true,
    });
  });

  describe('initialization', () => {
    it('should create with default options', () => {
      const mgr = createIndexManager();
      expect(mgr).toBeInstanceOf(IndexManager);
      expect(mgr.isReady()).toBe(false);
    });

    it('should initialize and become ready', async () => {
      await manager.initialize();
      expect(manager.isReady()).toBe(true);
    });

    it('should only initialize once', async () => {
      await manager.initialize();
      await manager.initialize(); // Should not throw
      expect(manager.isReady()).toBe(true);
    });

    it('should create browser manager with correct defaults', () => {
      const browserMgr = createBrowserIndexManager('https://api.example.com/indexes');
      expect(browserMgr).toBeInstanceOf(IndexManager);
    });
  });

  describe('FTS search', () => {
    beforeEach(async () => {
      await manager.initialize();

      // Set up FTS index with test data
      const ftsIndex = new WikipediaFTSIndex();
      const testArticles: ArticleRecord[] = [
        {
          $id: 'article-1',
          $type: 'topic',
          $partition: 'topics',
          $created: new Date().toISOString(),
          $updated: new Date().toISOString(),
          title: 'Machine Learning',
          description: 'A field of artificial intelligence',
          content: 'Machine learning is a branch of AI that uses algorithms to learn from data.',
          url: '/wiki/Machine_Learning',
          wikidata_id: 'Q2539',
          pageviews_30d: 100000,
        },
        {
          $id: 'article-2',
          $type: 'topic',
          $partition: 'topics',
          $created: new Date().toISOString(),
          $updated: new Date().toISOString(),
          title: 'Deep Learning',
          description: 'A subset of machine learning',
          content: 'Deep learning uses neural networks with many layers.',
          url: '/wiki/Deep_Learning',
          wikidata_id: 'Q197536',
          pageviews_30d: 80000,
        },
        {
          $id: 'article-3',
          $type: 'person',
          $partition: 'people',
          $created: new Date().toISOString(),
          $updated: new Date().toISOString(),
          title: 'Alan Turing',
          description: 'British mathematician and computer scientist',
          content: 'Alan Turing was a pioneer in computing and artificial intelligence.',
          url: '/wiki/Alan_Turing',
          wikidata_id: 'Q7251',
          pageviews_30d: 50000,
        },
      ];

      for (const article of testArticles) {
        ftsIndex.addDocument(article);
      }
      manager.setFTSIndex(ftsIndex);
    });

    it('should search FTS index', async () => {
      const results = await manager.searchFTS('machine learning');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('Machine Learning');
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].matchedTokens.length).toBeGreaterThan(0);
    });

    it('should respect limit option', async () => {
      const results = await manager.searchFTS('learning', { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should filter by types', async () => {
      const results = await manager.searchFTS('artificial intelligence', {
        types: ['person'],
      });

      expect(results.every(r => r.type === 'person')).toBe(true);
    });

    it('should return empty for no matches', async () => {
      const results = await manager.searchFTS('nonexistent xyz query');
      expect(results.length).toBe(0);
    });

    it('should throw if FTS not enabled', async () => {
      const noFtsMgr = createIndexManager({ enableFTS: false });
      await noFtsMgr.initialize();

      await expect(noFtsMgr.searchFTS('test')).rejects.toThrow('FTS index is not enabled');
    });
  });

  describe('Vector search', () => {
    beforeEach(async () => {
      await manager.initialize();

      // Set up Vector index with test data
      const vectorIndex = new VectorIndex({ dimensions: 1024 });

      // Insert test vectors (simplified 1024-dim vectors)
      const vector1 = new Array(1024).fill(0).map(() => Math.random());
      const vector2 = new Array(1024).fill(0).map(() => Math.random());

      vectorIndex.insert(vector1, {
        id: 'vec-1',
        title: 'Vector Article 1',
        type: 'topic',
      });
      vectorIndex.insert(vector2, {
        id: 'vec-2',
        title: 'Vector Article 2',
        type: 'topic',
      });

      manager.setVectorIndex(vectorIndex);
    });

    it('should search by embedding', async () => {
      const queryVector = new Array(1024).fill(0).map(() => Math.random());
      const results = await manager.searchVectorByEmbedding(queryVector, 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThanOrEqual(0);
    });

    it('should respect limit in vector search', async () => {
      const queryVector = new Array(1024).fill(0).map(() => Math.random());
      const results = await manager.searchVectorByEmbedding(queryVector, 1);

      expect(results.length).toBeLessThanOrEqual(1);
    });

    it('should filter by types in vector search', async () => {
      const queryVector = new Array(1024).fill(0).map(() => Math.random());
      const results = await manager.searchVectorByEmbedding(queryVector, 5, {
        types: ['person'], // Should filter out topic results
      });

      expect(results.every(r => r.type === 'person')).toBe(true);
    });

    it('should throw if Vector not enabled', async () => {
      const noVecMgr = createIndexManager({ enableVector: false });
      await noVecMgr.initialize();

      const queryVector = new Array(1024).fill(0);
      await expect(noVecMgr.searchVectorByEmbedding(queryVector, 5)).rejects.toThrow('Vector index is not enabled');
    });

    it('should throw on searchVectorByText without AI gateway', async () => {
      await expect(manager.searchVectorByText('test query', 5)).rejects.toThrow('AI Gateway not configured');
    });
  });

  describe('Geo search', () => {
    beforeEach(async () => {
      await manager.initialize();

      // Set up Geo index with test data
      const geoIndex = new GeoIndex();
      geoIndex.insert({
        articleId: 'sf',
        lat: 37.7749,
        lng: -122.4194,
        title: 'San Francisco',
        type: 'place',
        file: 'places/0.parquet',
        rowGroup: 0,
        row: 0,
      });
      geoIndex.insert({
        articleId: 'la',
        lat: 34.0522,
        lng: -118.2437,
        title: 'Los Angeles',
        type: 'place',
        file: 'places/0.parquet',
        rowGroup: 0,
        row: 1,
      });
      geoIndex.insert({
        articleId: 'oak',
        lat: 37.8044,
        lng: -122.2712,
        title: 'Oakland',
        type: 'place',
        file: 'places/0.parquet',
        rowGroup: 0,
        row: 2,
      });

      manager.setGeoIndex(geoIndex);
    });

    it('should search nearby locations', async () => {
      // Search near San Francisco
      const results = await manager.searchGeoNear(37.78, -122.42, {
        maxDistance: 50000, // 50km
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toBe('San Francisco');
      expect(results[0].distance).toBeLessThan(50000);
    });

    it('should order results by distance', async () => {
      const results = await manager.searchGeoNear(37.78, -122.42, {
        maxDistance: 100000,
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
      }
    });

    it('should respect maxDistance', async () => {
      const results = await manager.searchGeoNear(37.78, -122.42, {
        maxDistance: 10000, // 10km - should not include Oakland
      });

      expect(results.every(r => r.distance <= 10000)).toBe(true);
    });

    it('should search by bounding box', async () => {
      const results = await manager.searchGeoBoundingBox({
        north: 38.0,
        south: 37.5,
        east: -122.0,
        west: -123.0,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.title === 'San Francisco')).toBe(true);
    });

    it('should throw if Geo not enabled', async () => {
      const noGeoMgr = createIndexManager({ enableGeo: false });
      await noGeoMgr.initialize();

      await expect(noGeoMgr.searchGeoNear(0, 0)).rejects.toThrow('Geo index is not enabled');
    });
  });

  describe('Hybrid search', () => {
    beforeEach(async () => {
      await manager.initialize();

      // Set up FTS index
      const ftsIndex = new WikipediaFTSIndex();
      const articles: ArticleRecord[] = [
        {
          $id: 'article-1',
          $type: 'topic',
          $partition: 'topics',
          $created: new Date().toISOString(),
          $updated: new Date().toISOString(),
          title: 'Machine Learning',
          description: 'AI field',
          content: 'Machine learning algorithms learn from data.',
          url: '/wiki/ML',
          wikidata_id: 'Q1',
          pageviews_30d: 100,
        },
      ];
      for (const article of articles) {
        ftsIndex.addDocument(article);
      }
      manager.setFTSIndex(ftsIndex);

      // Disable vector search for hybrid tests (requires AI gateway)
      // The hybrid search will still work with just FTS
    });

    it('should perform hybrid search with FTS only', async () => {
      // Create manager with vector disabled
      const ftsOnlyMgr = createIndexManager({ enableFTS: true, enableVector: false });
      await ftsOnlyMgr.initialize();

      const ftsIndex = new WikipediaFTSIndex();
      ftsIndex.addDocument({
        $id: 'test-1',
        $type: 'topic',
        $partition: 'topics',
        $created: new Date().toISOString(),
        $updated: new Date().toISOString(),
        title: 'Test Article',
        description: 'A test',
        content: 'Test content here',
        url: '/wiki/Test',
        wikidata_id: 'Q999',
        pageviews_30d: 50,
      });
      ftsOnlyMgr.setFTSIndex(ftsIndex);

      const results = await ftsOnlyMgr.searchHybrid('test', 5, {
        ftsWeight: 1.0,
        vectorWeight: 0,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].source).toBe('fts');
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await manager.initialize();

      // Set up indexes with data
      const ftsIndex = new WikipediaFTSIndex();
      ftsIndex.addDocument({
        $id: 'test-1',
        $type: 'topic',
        $partition: 'topics',
        $created: new Date().toISOString(),
        $updated: new Date().toISOString(),
        title: 'Test',
        description: 'Test',
        content: 'Test',
        url: '/wiki/Test',
        wikidata_id: 'Q1',
        pageviews_30d: 100,
      });
      manager.setFTSIndex(ftsIndex);
    });

    it('should return stats for all indexes', () => {
      const stats = manager.getStats();

      expect(stats).toBeInstanceOf(Map);
      expect(stats.has('fts')).toBe(true);
      expect(stats.has('vector')).toBe(true);
      expect(stats.has('geo')).toBe(true);
    });

    it('should return stats for specific index', () => {
      const ftsStats = manager.getIndexStats('fts');

      expect(ftsStats).toBeDefined();
      expect(ftsStats?.type).toBe('fts');
      expect(ftsStats?.documentCount).toBe(1);
      expect(ftsStats?.ready).toBe(true);
    });
  });

  describe('Index access', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should provide access to underlying FTS index', () => {
      const ftsIndex = manager.getFTSIndex();
      expect(ftsIndex).toBeInstanceOf(WikipediaFTSIndex);
    });

    it('should provide access to underlying Vector index', () => {
      const vectorIndex = manager.getVectorIndex();
      expect(vectorIndex).toBeInstanceOf(VectorIndex);
    });

    it('should provide access to underlying Geo index', () => {
      const geoIndex = manager.getGeoIndex();
      expect(geoIndex).toBeInstanceOf(GeoIndex);
    });

    it('should allow setting external indexes', () => {
      const newFtsIndex = new WikipediaFTSIndex();
      newFtsIndex.addDocument({
        $id: 'external-1',
        $type: 'topic',
        $partition: 'topics',
        $created: new Date().toISOString(),
        $updated: new Date().toISOString(),
        title: 'External',
        description: 'External doc',
        content: 'External content',
        url: '/wiki/External',
        wikidata_id: 'Q999',
        pageviews_30d: 50,
      });

      manager.setFTSIndex(newFtsIndex);

      const retrieved = manager.getFTSIndex();
      expect(retrieved).toBe(newFtsIndex);
      expect(retrieved?.documentCount).toBe(1);
    });
  });

  describe('Event handling', () => {
    it('should emit events for search operations', async () => {
      await manager.initialize();

      const events: Array<{ type: string }> = [];
      manager.addEventListener((event) => {
        events.push({ type: event.type });
      });

      // Set up FTS index
      const ftsIndex = new WikipediaFTSIndex();
      ftsIndex.addDocument({
        $id: 'test-1',
        $type: 'topic',
        $partition: 'topics',
        $created: new Date().toISOString(),
        $updated: new Date().toISOString(),
        title: 'Test',
        description: 'Test',
        content: 'Test',
        url: '/wiki/Test',
        wikidata_id: 'Q1',
        pageviews_30d: 100,
      });
      manager.setFTSIndex(ftsIndex);

      await manager.searchFTS('test');

      expect(events.some(e => e.type === 'search_started')).toBe(true);
      expect(events.some(e => e.type === 'search_completed')).toBe(true);
    });

    it('should allow removing event listeners', async () => {
      await manager.initialize();

      let callCount = 0;
      const listener = () => { callCount++; };

      manager.addEventListener(listener);
      manager.removeEventListener(listener);

      const ftsIndex = new WikipediaFTSIndex();
      manager.setFTSIndex(ftsIndex);
      await manager.searchFTS('test');

      expect(callCount).toBe(0);
    });
  });

  describe('Cache and cleanup', () => {
    it('should clear cache', async () => {
      await manager.initialize();
      manager.clearCache();
      // Should not throw
    });

    it('should close and release resources', async () => {
      await manager.initialize();
      expect(manager.isReady()).toBe(true);

      await manager.close();

      expect(manager.isReady()).toBe(false);
      expect(manager.getFTSIndex()).toBeNull();
      expect(manager.getVectorIndex()).toBeNull();
      expect(manager.getGeoIndex()).toBeNull();
    });
  });
});
