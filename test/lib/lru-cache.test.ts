/**
 * Tests for LRU Cache utility
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LRUCache, createLRUCache } from '../../src/lib/lru-cache.js';

describe('LRUCache', () => {
  describe('constructor', () => {
    it('should create a cache with numeric maxSize', () => {
      const cache = new LRUCache(10);
      expect(cache.capacity).toBe(10);
      expect(cache.size).toBe(0);
    });

    it('should create a cache with options object', () => {
      const cache = new LRUCache({ maxSize: 5 });
      expect(cache.capacity).toBe(5);
    });

    it('should throw error for maxSize less than 1', () => {
      expect(() => new LRUCache(0)).toThrow('LRUCache maxSize must be at least 1');
      expect(() => new LRUCache(-1)).toThrow('LRUCache maxSize must be at least 1');
      expect(() => new LRUCache({ maxSize: 0 })).toThrow('LRUCache maxSize must be at least 1');
    });

    it('should accept onEvict callback', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache({ maxSize: 2, onEvict });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3); // Should evict 'a'

      expect(onEvict).toHaveBeenCalledWith('a', 1);
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent key', () => {
      const cache = new LRUCache<string, number>(10);
      expect(cache.get('missing')).toBeUndefined();
    });

    it('should return value for existing key', () => {
      const cache = new LRUCache<string, number>(10);
      cache.set('key', 42);
      expect(cache.get('key')).toBe(42);
    });

    it('should mark item as recently used', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);

      // Access 'a' to make it most recently used
      cache.get('a');

      // Add 'c', which should evict 'b' (least recently used)
      cache.set('c', 3);

      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });
  });

  describe('set', () => {
    it('should store value', () => {
      const cache = new LRUCache<string, string>(10);
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
    });

    it('should update existing key', () => {
      const cache = new LRUCache<string, number>(10);
      cache.set('key', 1);
      cache.set('key', 2);
      expect(cache.get('key')).toBe(2);
      expect(cache.size).toBe(1);
    });

    it('should evict oldest entry when full', () => {
      const cache = new LRUCache<string, number>(3);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Evicts 'a'

      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
      expect(cache.get('d')).toBe(4);
    });

    it('should return this for chaining', () => {
      const cache = new LRUCache<string, number>(10);
      expect(cache.set('a', 1).set('b', 2)).toBe(cache);
    });

    it('should call onEvict when evicting', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache<string, number>({ maxSize: 2, onEvict });

      cache.set('a', 1);
      cache.set('b', 2);
      expect(onEvict).not.toHaveBeenCalled();

      cache.set('c', 3);
      expect(onEvict).toHaveBeenCalledWith('a', 1);
    });
  });

  describe('has', () => {
    it('should return false for non-existent key', () => {
      const cache = new LRUCache<string, number>(10);
      expect(cache.has('missing')).toBe(false);
    });

    it('should return true for existing key', () => {
      const cache = new LRUCache<string, number>(10);
      cache.set('key', 42);
      expect(cache.has('key')).toBe(true);
    });

    it('should NOT mark item as recently used', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);

      // has() should not update access order
      cache.has('a');

      // Add 'c', which should evict 'a' (still least recently used)
      cache.set('c', 3);

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
    });
  });

  describe('delete', () => {
    it('should return false for non-existent key', () => {
      const cache = new LRUCache<string, number>(10);
      expect(cache.delete('missing')).toBe(false);
    });

    it('should return true and remove existing key', () => {
      const cache = new LRUCache<string, number>(10);
      cache.set('key', 42);
      expect(cache.delete('key')).toBe(true);
      expect(cache.get('key')).toBeUndefined();
      expect(cache.size).toBe(0);
    });

    it('should call onEvict when deleting', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache<string, number>({ maxSize: 10, onEvict });

      cache.set('key', 42);
      cache.delete('key');

      expect(onEvict).toHaveBeenCalledWith('key', 42);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const cache = new LRUCache<string, number>(10);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBeUndefined();
    });

    it('should call onEvict for each entry', () => {
      const onEvict = vi.fn();
      const cache = new LRUCache<string, number>({ maxSize: 10, onEvict });

      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();

      expect(onEvict).toHaveBeenCalledTimes(2);
      expect(onEvict).toHaveBeenCalledWith('a', 1);
      expect(onEvict).toHaveBeenCalledWith('b', 2);
    });
  });

  describe('peek', () => {
    it('should return value without marking as recently used', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);

      // Peek at 'a' (should not update order)
      expect(cache.peek('a')).toBe(1);

      // Add 'c', which should evict 'a' (still least recently used)
      cache.set('c', 3);

      expect(cache.peek('a')).toBeUndefined();
      expect(cache.peek('b')).toBe(2);
    });

    it('should return undefined for non-existent key', () => {
      const cache = new LRUCache<string, number>(10);
      expect(cache.peek('missing')).toBeUndefined();
    });
  });

  describe('iteration', () => {
    let cache: LRUCache<string, number>;

    beforeEach(() => {
      cache = new LRUCache<string, number>(10);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
    });

    it('should iterate over keys in LRU order', () => {
      const keys = Array.from(cache.keys());
      expect(keys).toEqual(['a', 'b', 'c']);
    });

    it('should iterate over values in LRU order', () => {
      const values = Array.from(cache.values());
      expect(values).toEqual([1, 2, 3]);
    });

    it('should iterate over entries in LRU order', () => {
      const entries = Array.from(cache.entries());
      expect(entries).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    });

    it('should be iterable with for...of', () => {
      const entries: [string, number][] = [];
      for (const entry of cache) {
        entries.push(entry);
      }
      expect(entries).toEqual([['a', 1], ['b', 2], ['c', 3]]);
    });

    it('should support forEach', () => {
      const results: Array<{ key: string; value: number }> = [];
      cache.forEach((value, key) => {
        results.push({ key, value });
      });
      expect(results).toEqual([
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
        { key: 'c', value: 3 },
      ]);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const cache = new LRUCache<string, number>(10);
      cache.set('a', 1);
      cache.set('b', 2);

      const stats = cache.getStats();

      expect(stats).toEqual({
        size: 2,
        capacity: 10,
        utilization: 0.2,
        bytes: 0,
        maxBytes: Infinity,
        bytesUtilization: 0,
      });
    });

    it('should calculate utilization correctly', () => {
      const cache = new LRUCache<string, number>(4);
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4);

      expect(cache.getStats().utilization).toBe(1.0);
    });
  });

  describe('edge cases', () => {
    it('should handle updating existing key in full cache', () => {
      const cache = new LRUCache<string, number>(2);
      cache.set('a', 1);
      cache.set('b', 2);

      // Update 'a', should not evict anything
      cache.set('a', 10);

      expect(cache.size).toBe(2);
      expect(cache.get('a')).toBe(10);
      expect(cache.get('b')).toBe(2);
    });

    it('should handle different key types', () => {
      const cache = new LRUCache<number, string>(10);
      cache.set(1, 'one');
      cache.set(2, 'two');

      expect(cache.get(1)).toBe('one');
      expect(cache.get(2)).toBe('two');
    });

    it('should handle complex value types', () => {
      const cache = new LRUCache<string, { name: string; count: number }>(10);
      const obj = { name: 'test', count: 42 };
      cache.set('key', obj);

      const retrieved = cache.get('key');
      expect(retrieved).toBe(obj); // Same reference
      expect(retrieved?.name).toBe('test');
    });

    it('should handle cache of size 1', () => {
      const cache = new LRUCache<string, number>(1);
      cache.set('a', 1);
      cache.set('b', 2);

      expect(cache.size).toBe(1);
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBe(2);
    });
  });
});

describe('createLRUCache', () => {
  it('should create a cache with maxSize', () => {
    const cache = createLRUCache<string, number>(5);
    expect(cache.capacity).toBe(5);
  });

  it('should create a cache with onEvict callback', () => {
    const onEvict = vi.fn();
    const cache = createLRUCache<string, number>(2, onEvict);

    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(onEvict).toHaveBeenCalledWith('a', 1);
  });
});

describe('LRUCache with byte limits', () => {
  it('should track bytes with sizeCalculator', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello'); // 5 bytes
    cache.set('b', 'world'); // 5 bytes

    expect(cache.bytes).toBe(10);
    expect(cache.size).toBe(2);
  });

  it('should evict based on maxBytes', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      maxBytes: 10,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello'); // 5 bytes
    cache.set('b', 'world'); // 5 bytes -> total 10 bytes (at limit)
    cache.set('c', 'foo');   // 3 bytes -> would exceed, evicts 'a'

    expect(cache.bytes).toBe(8); // 'world' (5) + 'foo' (3)
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('world');
    expect(cache.get('c')).toBe('foo');
  });

  it('should call onEvict when evicting due to bytes', () => {
    const onEvict = vi.fn();
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      maxBytes: 10,
      onEvict,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello'); // 5 bytes
    cache.set('b', 'world'); // 5 bytes -> total 10 bytes
    cache.set('c', 'test');  // 4 bytes -> evicts 'a'

    expect(onEvict).toHaveBeenCalledWith('a', 'hello');
  });

  it('should update bytes when replacing a value', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello'); // 5 bytes
    expect(cache.bytes).toBe(5);

    cache.set('a', 'hi'); // 2 bytes (replacing)
    expect(cache.bytes).toBe(2);
    expect(cache.size).toBe(1);
  });

  it('should clear bytes on delete', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello'); // 5 bytes
    cache.set('b', 'world'); // 5 bytes
    expect(cache.bytes).toBe(10);

    cache.delete('a');
    expect(cache.bytes).toBe(5);
  });

  it('should clear bytes on clear()', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello');
    cache.set('b', 'world');
    expect(cache.bytes).toBe(10);

    cache.clear();
    expect(cache.bytes).toBe(0);
    expect(cache.size).toBe(0);
  });

  it('should include byte info in getStats', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      maxBytes: 50,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'hello'); // 5 bytes

    const stats = cache.getStats();
    expect(stats.bytes).toBe(5);
    expect(stats.maxBytes).toBe(50);
    expect(stats.bytesUtilization).toBe(0.1);
  });

  it('should expose maxBytesCapacity', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      maxBytes: 1000,
      sizeCalculator: (value) => value.length,
    });

    expect(cache.maxBytesCapacity).toBe(1000);
  });

  it('should handle evicting multiple entries to fit new entry', () => {
    const cache = new LRUCache<string, string>({
      maxSize: 100,
      maxBytes: 15,
      sizeCalculator: (value) => value.length,
    });

    cache.set('a', 'aa');    // 2 bytes
    cache.set('b', 'bbb');   // 3 bytes -> total 5
    cache.set('c', 'cccc');  // 4 bytes -> total 9
    cache.set('d', 'ddddddddd'); // 9 bytes -> need to evict a, b to fit (total 13)

    // Should have evicted 'a' and 'b' to make room
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('cccc');
    expect(cache.get('d')).toBe('ddddddddd');
    expect(cache.bytes).toBe(13); // 4 + 9
  });
});
