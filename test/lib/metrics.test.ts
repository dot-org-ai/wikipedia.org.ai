/**
 * Tests for Metrics utility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Counter,
  Gauge,
  Histogram,
  createWikipediaMetrics,
  getMetrics,
  resetMetrics,
  setMetrics,
  toPrometheusFormat,
  toJSON,
  recordRequest,
  getCacheHitRate,
  getHistogramSummary,
  type WikipediaMetrics,
} from '../../src/lib/metrics.js';

describe('Counter', () => {
  it('should start at 0', () => {
    const counter = new Counter('test_counter', 'Test counter');
    expect(counter.get()).toBe(0);
  });

  it('should increment by 1 by default', () => {
    const counter = new Counter('test_counter', 'Test counter');
    counter.inc();
    expect(counter.get()).toBe(1);
  });

  it('should increment by specified value', () => {
    const counter = new Counter('test_counter', 'Test counter');
    counter.inc({}, 5);
    expect(counter.get()).toBe(5);
  });

  it('should track separate values for different labels', () => {
    const counter = new Counter('test_counter', 'Test counter');
    counter.inc({ method: 'GET' });
    counter.inc({ method: 'POST' });
    counter.inc({ method: 'GET' });

    expect(counter.get({ method: 'GET' })).toBe(2);
    expect(counter.get({ method: 'POST' })).toBe(1);
  });

  it('should reset all values', () => {
    const counter = new Counter('test_counter', 'Test counter');
    counter.inc({ method: 'GET' });
    counter.inc({ method: 'POST' });
    counter.reset();

    expect(counter.get({ method: 'GET' })).toBe(0);
    expect(counter.get({ method: 'POST' })).toBe(0);
  });

  it('should export as metric', () => {
    const counter = new Counter('test_counter', 'Test counter');
    counter.inc({ method: 'GET' }, 5);

    const metric = counter.toMetric();
    expect(metric.name).toBe('test_counter');
    expect(metric.help).toBe('Test counter');
    expect(metric.type).toBe('counter');
    expect(metric.values).toHaveLength(1);
    expect(metric.values[0]?.value).toBe(5);
    expect(metric.values[0]?.labels).toEqual({ method: 'GET' });
  });
});

describe('Gauge', () => {
  it('should start at 0', () => {
    const gauge = new Gauge('test_gauge', 'Test gauge');
    expect(gauge.get()).toBe(0);
  });

  it('should set value', () => {
    const gauge = new Gauge('test_gauge', 'Test gauge');
    gauge.set({}, 42);
    expect(gauge.get()).toBe(42);
  });

  it('should increment', () => {
    const gauge = new Gauge('test_gauge', 'Test gauge');
    gauge.set({}, 10);
    gauge.inc({}, 5);
    expect(gauge.get()).toBe(15);
  });

  it('should decrement', () => {
    const gauge = new Gauge('test_gauge', 'Test gauge');
    gauge.set({}, 10);
    gauge.dec({}, 3);
    expect(gauge.get()).toBe(7);
  });

  it('should track separate values for different labels', () => {
    const gauge = new Gauge('test_gauge', 'Test gauge');
    gauge.set({ path: '/api/articles' }, 10);
    gauge.set({ path: '/api/search' }, 5);

    expect(gauge.get({ path: '/api/articles' })).toBe(10);
    expect(gauge.get({ path: '/api/search' })).toBe(5);
  });
});

describe('Histogram', () => {
  it('should observe values', () => {
    const histogram = new Histogram('test_histogram', 'Test histogram', [10, 50, 100]);
    histogram.observe({}, 25);
    histogram.observe({}, 75);
    histogram.observe({}, 5);

    const value = histogram.get();
    expect(value).toBeDefined();
    expect(value?.count).toBe(3);
    expect(value?.sum).toBe(105);
  });

  it('should track bucket counts correctly', () => {
    const histogram = new Histogram('test_histogram', 'Test histogram', [10, 50, 100]);
    histogram.observe({}, 5);   // <= 10, 50, 100
    histogram.observe({}, 15);  // <= 50, 100
    histogram.observe({}, 75);  // <= 100
    histogram.observe({}, 150); // > 100 (no bucket)

    const value = histogram.get();
    expect(value).toBeDefined();
    expect(value?.buckets).toEqual([
      { le: 10, count: 1 },
      { le: 50, count: 2 },
      { le: 100, count: 3 },
    ]);
    expect(value?.count).toBe(4);
  });

  it('should track separate histograms for different labels', () => {
    const histogram = new Histogram('test_histogram', 'Test histogram', [100]);
    histogram.observe({ path: '/api/articles' }, 50);
    histogram.observe({ path: '/api/search' }, 150);

    const articlesValue = histogram.get({ path: '/api/articles' });
    const searchValue = histogram.get({ path: '/api/search' });

    expect(articlesValue?.count).toBe(1);
    expect(articlesValue?.sum).toBe(50);
    expect(searchValue?.count).toBe(1);
    expect(searchValue?.sum).toBe(150);
  });

  it('should provide timer functionality', async () => {
    const histogram = new Histogram('test_histogram', 'Test histogram');
    const stopTimer = histogram.startTimer();

    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 10));

    const duration = stopTimer();
    expect(duration).toBeGreaterThanOrEqual(10);

    const value = histogram.get();
    expect(value?.count).toBe(1);
    expect(value?.sum).toBeGreaterThanOrEqual(10);
  });
});

describe('WikipediaMetrics', () => {
  let metrics: WikipediaMetrics;

  beforeEach(() => {
    metrics = createWikipediaMetrics();
  });

  it('should create all expected metrics', () => {
    expect(metrics.requestsTotal).toBeInstanceOf(Counter);
    expect(metrics.requestDuration).toBeInstanceOf(Histogram);
    expect(metrics.requestSize).toBeInstanceOf(Histogram);
    expect(metrics.responseSize).toBeInstanceOf(Histogram);
    expect(metrics.errorsTotal).toBeInstanceOf(Counter);
    expect(metrics.cacheHits).toBeInstanceOf(Counter);
    expect(metrics.cacheMisses).toBeInstanceOf(Counter);
    expect(metrics.activeRequests).toBeInstanceOf(Gauge);
    expect(metrics.vectorSearchDuration).toBeInstanceOf(Histogram);
    expect(metrics.vectorSearchResults).toBeInstanceOf(Histogram);
    expect(metrics.embeddingRequests).toBeInstanceOf(Counter);
    expect(metrics.embeddingDuration).toBeInstanceOf(Histogram);
  });
});

describe('Global metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should create metrics on first access', () => {
    const metrics1 = getMetrics();
    const metrics2 = getMetrics();
    expect(metrics1).toBe(metrics2);
  });

  it('should allow setting custom metrics', () => {
    const customMetrics = createWikipediaMetrics();
    customMetrics.requestsTotal.inc({ method: 'TEST' });

    setMetrics(customMetrics);

    expect(getMetrics().requestsTotal.get({ method: 'TEST' })).toBe(1);
  });

  it('should reset metrics', () => {
    const metrics = getMetrics();
    metrics.requestsTotal.inc();

    resetMetrics();

    const newMetrics = getMetrics();
    expect(newMetrics.requestsTotal.get()).toBe(0);
  });
});

describe('recordRequest', () => {
  let metrics: WikipediaMetrics;

  beforeEach(() => {
    metrics = createWikipediaMetrics();
  });

  it('should record request count', () => {
    recordRequest(metrics, {
      method: 'GET',
      path: '/api/articles',
      status: 200,
      durationMs: 50,
    });

    expect(metrics.requestsTotal.get({ method: 'GET', path: '/api/articles', status: '200' })).toBe(1);
  });

  it('should record request duration', () => {
    recordRequest(metrics, {
      method: 'GET',
      path: '/api/articles',
      status: 200,
      durationMs: 50,
    });

    const value = metrics.requestDuration.get({ method: 'GET', path: '/api/articles', status: '200' });
    expect(value?.count).toBe(1);
    expect(value?.sum).toBe(50);
  });

  it('should record errors for 4xx status', () => {
    recordRequest(metrics, {
      method: 'GET',
      path: '/api/articles/invalid',
      status: 404,
      durationMs: 10,
    });

    expect(metrics.errorsTotal.get({
      method: 'GET',
      path: '/api/articles/invalid',
      status: '404',
      error_type: 'client_error',
    })).toBe(1);
  });

  it('should record errors for 5xx status', () => {
    recordRequest(metrics, {
      method: 'GET',
      path: '/api/articles',
      status: 500,
      durationMs: 10,
    });

    expect(metrics.errorsTotal.get({
      method: 'GET',
      path: '/api/articles',
      status: '500',
      error_type: 'server_error',
    })).toBe(1);
  });

  it('should record cache hits', () => {
    recordRequest(metrics, {
      method: 'GET',
      path: '/api/articles',
      status: 200,
      durationMs: 5,
      cacheStatus: 'hit',
    });

    expect(metrics.cacheHits.get({ path: '/api/articles' })).toBe(1);
  });

  it('should record cache misses', () => {
    recordRequest(metrics, {
      method: 'GET',
      path: '/api/articles',
      status: 200,
      durationMs: 50,
      cacheStatus: 'miss',
    });

    expect(metrics.cacheMisses.get({ path: '/api/articles' })).toBe(1);
  });
});

describe('getCacheHitRate', () => {
  let metrics: WikipediaMetrics;

  beforeEach(() => {
    metrics = createWikipediaMetrics();
  });

  it('should return 0 when no cache data', () => {
    expect(getCacheHitRate(metrics)).toBe(0);
  });

  it('should calculate hit rate correctly', () => {
    metrics.cacheHits.inc({}, 3);
    metrics.cacheMisses.inc({}, 7);

    expect(getCacheHitRate(metrics)).toBe(0.3);
  });

  it('should calculate hit rate for specific path', () => {
    metrics.cacheHits.inc({ path: '/api/articles' }, 8);
    metrics.cacheMisses.inc({ path: '/api/articles' }, 2);
    metrics.cacheHits.inc({ path: '/api/search' }, 2);
    metrics.cacheMisses.inc({ path: '/api/search' }, 8);

    expect(getCacheHitRate(metrics, '/api/articles')).toBe(0.8);
    expect(getCacheHitRate(metrics, '/api/search')).toBe(0.2);
  });
});

describe('getHistogramSummary', () => {
  it('should return null for empty histogram', () => {
    const histogram = new Histogram('test', 'Test');
    expect(getHistogramSummary(histogram)).toBeNull();
  });

  it('should return summary statistics', () => {
    const histogram = new Histogram('test', 'Test', [10, 50, 100, 500, 1000]);

    // Add some values
    histogram.observe({}, 5);
    histogram.observe({}, 15);
    histogram.observe({}, 45);
    histogram.observe({}, 85);
    histogram.observe({}, 200);

    const summary = getHistogramSummary(histogram);
    expect(summary).not.toBeNull();
    expect(summary?.count).toBe(5);
    expect(summary?.sum).toBe(350);
    expect(summary?.avg).toBe(70);
    // p50 should be around 45 (middle value)
    expect(summary?.p50).toBeGreaterThan(0);
    // p90 should be high
    expect(summary?.p90).toBeGreaterThan(summary?.p50 ?? 0);
  });
});

describe('toPrometheusFormat', () => {
  let metrics: WikipediaMetrics;

  beforeEach(() => {
    metrics = createWikipediaMetrics();
  });

  it('should output valid Prometheus format', () => {
    metrics.requestsTotal.inc({ method: 'GET', path: '/api/articles', status: '200' });
    metrics.requestDuration.observe({ method: 'GET', path: '/api/articles', status: '200' }, 50);

    const output = toPrometheusFormat(metrics);

    // Check for HELP and TYPE lines
    expect(output).toContain('# HELP wikipedia_http_requests_total');
    expect(output).toContain('# TYPE wikipedia_http_requests_total counter');

    // Check for metric value
    expect(output).toContain('wikipedia_http_requests_total{');
    expect(output).toContain('method="GET"');
    expect(output).toContain('path="/api/articles"');

    // Check for histogram buckets
    expect(output).toContain('wikipedia_http_request_duration_ms_bucket');
    expect(output).toContain('wikipedia_http_request_duration_ms_sum');
    expect(output).toContain('wikipedia_http_request_duration_ms_count');
  });

  it('should escape special characters in labels', () => {
    metrics.requestsTotal.inc({ path: '/api/articles/test"quote' });

    const output = toPrometheusFormat(metrics);

    // Quotes should be escaped
    expect(output).toContain('\\"quote');
  });
});

describe('toJSON', () => {
  let metrics: WikipediaMetrics;

  beforeEach(() => {
    metrics = createWikipediaMetrics();
  });

  it('should output all metrics as JSON', () => {
    metrics.requestsTotal.inc({ method: 'GET' });
    metrics.cacheHits.inc();

    const json = toJSON(metrics);

    expect(json.requests).toBeDefined();
    expect(json.errors).toBeDefined();
    expect(json.cache).toBeDefined();
    expect(json.activeRequests).toBeDefined();
    expect(json.vectorSearch).toBeDefined();
    expect(json.embeddings).toBeDefined();
  });
});
