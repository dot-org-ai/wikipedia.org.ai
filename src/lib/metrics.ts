/**
 * Metrics Collection Module
 *
 * A lightweight metrics collection utility for the Wikipedia API.
 *
 * Features:
 * - Request counters (total, by status code, by endpoint)
 * - Latency histograms with configurable buckets
 * - Error counts by type
 * - Cache hit/miss rates
 * - Optional Prometheus format export
 */

/** Metric types */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** Label set for metrics */
export type Labels = Record<string, string>;

/** Counter metric value */
export interface CounterValue {
  value: number;
  labels: Labels;
}

/** Gauge metric value */
export interface GaugeValue {
  value: number;
  labels: Labels;
}

/** Histogram bucket */
export interface HistogramBucket {
  le: number; // "less than or equal" bound
  count: number;
}

/** Histogram metric value */
export interface HistogramValue {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  labels: Labels;
}

/** Base metric interface */
export interface Metric {
  name: string;
  help: string;
  type: MetricType;
}

/** Counter metric */
export interface CounterMetric extends Metric {
  type: 'counter';
  values: CounterValue[];
}

/** Gauge metric */
export interface GaugeMetric extends Metric {
  type: 'gauge';
  values: GaugeValue[];
}

/** Histogram metric */
export interface HistogramMetric extends Metric {
  type: 'histogram';
  values: HistogramValue[];
}

/** Default latency buckets (in milliseconds) */
const DEFAULT_LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/** Default size buckets (in bytes) */
const DEFAULT_SIZE_BUCKETS = [100, 1000, 10000, 100000, 1000000, 10000000];

/**
 * Create a label key from a Labels object
 */
function labelsToKey(labels: Labels): string {
  const sortedKeys = Object.keys(labels).sort();
  return sortedKeys.map(k => `${k}=${labels[k]}`).join(',');
}

/**
 * Counter class for monotonically increasing values
 */
export class Counter {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, CounterValue>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  /**
   * Increment the counter
   */
  inc(labels: Labels = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { value, labels });
    }
  }

  /**
   * Get the current value for specific labels
   */
  get(labels: Labels = {}): number {
    const key = labelsToKey(labels);
    return this.values.get(key)?.value ?? 0;
  }

  /**
   * Get all values
   */
  getAll(): CounterValue[] {
    return Array.from(this.values.values());
  }

  /**
   * Reset the counter
   */
  reset(): void {
    this.values.clear();
  }

  /**
   * Export as CounterMetric
   */
  toMetric(): CounterMetric {
    return {
      name: this.name,
      help: this.help,
      type: 'counter',
      values: this.getAll(),
    };
  }
}

/**
 * Gauge class for values that can go up and down
 */
export class Gauge {
  readonly name: string;
  readonly help: string;
  private readonly values = new Map<string, GaugeValue>();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  /**
   * Set the gauge value
   */
  set(labels: Labels = {}, value: number): void {
    const key = labelsToKey(labels);
    this.values.set(key, { value, labels });
  }

  /**
   * Increment the gauge
   */
  inc(labels: Labels = {}, value: number = 1): void {
    const key = labelsToKey(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { value, labels });
    }
  }

  /**
   * Decrement the gauge
   */
  dec(labels: Labels = {}, value: number = 1): void {
    this.inc(labels, -value);
  }

  /**
   * Get the current value for specific labels
   */
  get(labels: Labels = {}): number {
    const key = labelsToKey(labels);
    return this.values.get(key)?.value ?? 0;
  }

  /**
   * Get all values
   */
  getAll(): GaugeValue[] {
    return Array.from(this.values.values());
  }

  /**
   * Reset the gauge
   */
  reset(): void {
    this.values.clear();
  }

  /**
   * Export as GaugeMetric
   */
  toMetric(): GaugeMetric {
    return {
      name: this.name,
      help: this.help,
      type: 'gauge',
      values: this.getAll(),
    };
  }
}

/**
 * Histogram class for measuring distributions
 */
export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: number[];
  private readonly values = new Map<string, HistogramValue>();

  constructor(name: string, help: string, buckets: number[] = DEFAULT_LATENCY_BUCKETS) {
    this.name = name;
    this.help = help;
    // Sort buckets and ensure +Inf is always last
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  /**
   * Observe a value
   */
  observe(labels: Labels = {}, value: number): void {
    const key = labelsToKey(labels);
    let histValue = this.values.get(key);

    if (!histValue) {
      histValue = {
        buckets: this.buckets.map(le => ({ le, count: 0 })),
        sum: 0,
        count: 0,
        labels,
      };
      this.values.set(key, histValue);
    }

    histValue.sum += value;
    histValue.count++;

    // Increment bucket counts
    for (const bucket of histValue.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  /**
   * Get histogram for specific labels
   */
  get(labels: Labels = {}): HistogramValue | undefined {
    const key = labelsToKey(labels);
    return this.values.get(key);
  }

  /**
   * Get all values
   */
  getAll(): HistogramValue[] {
    return Array.from(this.values.values());
  }

  /**
   * Reset the histogram
   */
  reset(): void {
    this.values.clear();
  }

  /**
   * Export as HistogramMetric
   */
  toMetric(): HistogramMetric {
    return {
      name: this.name,
      help: this.help,
      type: 'histogram',
      values: this.getAll(),
    };
  }

  /**
   * Create a timer that observes duration when stopped
   */
  startTimer(labels: Labels = {}): () => number {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.observe(labels, duration);
      return duration;
    };
  }
}

/**
 * Pre-defined metrics for the Wikipedia API
 */
export interface WikipediaMetrics {
  // Request metrics
  requestsTotal: Counter;
  requestDuration: Histogram;
  requestSize: Histogram;
  responseSize: Histogram;

  // Error metrics
  errorsTotal: Counter;

  // Cache metrics
  cacheHits: Counter;
  cacheMisses: Counter;

  // Active requests gauge
  activeRequests: Gauge;

  // Vector search metrics
  vectorSearchDuration: Histogram;
  vectorSearchResults: Histogram;

  // Embedding metrics
  embeddingRequests: Counter;
  embeddingDuration: Histogram;
}

/**
 * Create the default Wikipedia metrics
 */
export function createWikipediaMetrics(): WikipediaMetrics {
  return {
    // Request metrics
    requestsTotal: new Counter(
      'wikipedia_http_requests_total',
      'Total number of HTTP requests'
    ),
    requestDuration: new Histogram(
      'wikipedia_http_request_duration_ms',
      'HTTP request duration in milliseconds',
      DEFAULT_LATENCY_BUCKETS
    ),
    requestSize: new Histogram(
      'wikipedia_http_request_size_bytes',
      'HTTP request size in bytes',
      DEFAULT_SIZE_BUCKETS
    ),
    responseSize: new Histogram(
      'wikipedia_http_response_size_bytes',
      'HTTP response size in bytes',
      DEFAULT_SIZE_BUCKETS
    ),

    // Error metrics
    errorsTotal: new Counter(
      'wikipedia_errors_total',
      'Total number of errors'
    ),

    // Cache metrics
    cacheHits: new Counter(
      'wikipedia_cache_hits_total',
      'Total number of cache hits'
    ),
    cacheMisses: new Counter(
      'wikipedia_cache_misses_total',
      'Total number of cache misses'
    ),

    // Active requests gauge
    activeRequests: new Gauge(
      'wikipedia_active_requests',
      'Number of currently active requests'
    ),

    // Vector search metrics
    vectorSearchDuration: new Histogram(
      'wikipedia_vector_search_duration_ms',
      'Vector search duration in milliseconds',
      DEFAULT_LATENCY_BUCKETS
    ),
    vectorSearchResults: new Histogram(
      'wikipedia_vector_search_results',
      'Number of results returned from vector search',
      [0, 1, 5, 10, 20, 50, 100]
    ),

    // Embedding metrics
    embeddingRequests: new Counter(
      'wikipedia_embedding_requests_total',
      'Total number of embedding requests'
    ),
    embeddingDuration: new Histogram(
      'wikipedia_embedding_duration_ms',
      'Embedding generation duration in milliseconds',
      DEFAULT_LATENCY_BUCKETS
    ),
  };
}

/**
 * Global metrics instance
 */
let globalMetrics: WikipediaMetrics | null = null;

/**
 * Get or create the global metrics instance
 */
export function getMetrics(): WikipediaMetrics {
  if (!globalMetrics) {
    globalMetrics = createWikipediaMetrics();
  }
  return globalMetrics;
}

/**
 * Reset all global metrics (useful for testing)
 */
export function resetMetrics(): void {
  globalMetrics = null;
}

/**
 * Set custom metrics instance (useful for testing)
 */
export function setMetrics(metrics: WikipediaMetrics): void {
  globalMetrics = metrics;
}

/**
 * Format a single counter in Prometheus format
 */
function formatCounter(counter: CounterMetric): string {
  const lines: string[] = [];
  lines.push(`# HELP ${counter.name} ${counter.help}`);
  lines.push(`# TYPE ${counter.name} counter`);

  for (const value of counter.values) {
    const labelStr = formatLabels(value.labels);
    lines.push(`${counter.name}${labelStr} ${value.value}`);
  }

  // If no values, output a default 0
  if (counter.values.length === 0) {
    lines.push(`${counter.name} 0`);
  }

  return lines.join('\n');
}

/**
 * Format a single gauge in Prometheus format
 */
function formatGauge(gauge: GaugeMetric): string {
  const lines: string[] = [];
  lines.push(`# HELP ${gauge.name} ${gauge.help}`);
  lines.push(`# TYPE ${gauge.name} gauge`);

  for (const value of gauge.values) {
    const labelStr = formatLabels(value.labels);
    lines.push(`${gauge.name}${labelStr} ${value.value}`);
  }

  // If no values, output a default 0
  if (gauge.values.length === 0) {
    lines.push(`${gauge.name} 0`);
  }

  return lines.join('\n');
}

/**
 * Format a single histogram in Prometheus format
 */
function formatHistogram(histogram: HistogramMetric): string {
  const lines: string[] = [];
  lines.push(`# HELP ${histogram.name} ${histogram.help}`);
  lines.push(`# TYPE ${histogram.name} histogram`);

  for (const value of histogram.values) {
    const baseLabels = formatLabels(value.labels);

    // Bucket values
    for (const bucket of value.buckets) {
      const bucketLabels = value.labels
        ? { ...value.labels, le: bucket.le.toString() }
        : { le: bucket.le.toString() };
      const labelStr = formatLabels(bucketLabels);
      lines.push(`${histogram.name}_bucket${labelStr} ${bucket.count}`);
    }

    // +Inf bucket
    const infLabels = value.labels
      ? { ...value.labels, le: '+Inf' }
      : { le: '+Inf' };
    const infLabelStr = formatLabels(infLabels);
    lines.push(`${histogram.name}_bucket${infLabelStr} ${value.count}`);

    // Sum and count
    lines.push(`${histogram.name}_sum${baseLabels} ${value.sum}`);
    lines.push(`${histogram.name}_count${baseLabels} ${value.count}`);
  }

  return lines.join('\n');
}

/**
 * Format labels for Prometheus output
 */
function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';

  const pairs = keys.map(k => `${k}="${escapeLabel(labels[k] ?? '')}"`);
  return `{${pairs.join(',')}}`;
}

/**
 * Escape special characters in label values
 */
function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * Export all metrics in Prometheus format
 */
export function toPrometheusFormat(metrics: WikipediaMetrics = getMetrics()): string {
  const sections: string[] = [];

  // Request metrics
  sections.push(formatCounter(metrics.requestsTotal.toMetric()));
  sections.push(formatHistogram(metrics.requestDuration.toMetric()));
  sections.push(formatHistogram(metrics.requestSize.toMetric()));
  sections.push(formatHistogram(metrics.responseSize.toMetric()));

  // Error metrics
  sections.push(formatCounter(metrics.errorsTotal.toMetric()));

  // Cache metrics
  sections.push(formatCounter(metrics.cacheHits.toMetric()));
  sections.push(formatCounter(metrics.cacheMisses.toMetric()));

  // Active requests
  sections.push(formatGauge(metrics.activeRequests.toMetric()));

  // Vector search metrics
  sections.push(formatHistogram(metrics.vectorSearchDuration.toMetric()));
  sections.push(formatHistogram(metrics.vectorSearchResults.toMetric()));

  // Embedding metrics
  sections.push(formatCounter(metrics.embeddingRequests.toMetric()));
  sections.push(formatHistogram(metrics.embeddingDuration.toMetric()));

  return sections.join('\n\n') + '\n';
}

/**
 * Export metrics as JSON for debugging
 */
export function toJSON(metrics: WikipediaMetrics = getMetrics()): Record<string, unknown> {
  return {
    requests: {
      total: metrics.requestsTotal.toMetric(),
      duration: metrics.requestDuration.toMetric(),
      size: metrics.requestSize.toMetric(),
      responseSize: metrics.responseSize.toMetric(),
    },
    errors: metrics.errorsTotal.toMetric(),
    cache: {
      hits: metrics.cacheHits.toMetric(),
      misses: metrics.cacheMisses.toMetric(),
    },
    activeRequests: metrics.activeRequests.toMetric(),
    vectorSearch: {
      duration: metrics.vectorSearchDuration.toMetric(),
      results: metrics.vectorSearchResults.toMetric(),
    },
    embeddings: {
      requests: metrics.embeddingRequests.toMetric(),
      duration: metrics.embeddingDuration.toMetric(),
    },
  };
}

/**
 * Helper to record a complete request
 */
export function recordRequest(
  metrics: WikipediaMetrics,
  options: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    requestBytes?: number;
    responseBytes?: number;
    error?: string;
    cacheStatus?: 'hit' | 'miss';
  }
): void {
  const { method, path, status, durationMs, requestBytes, responseBytes, error, cacheStatus } = options;

  // Common labels
  const labels = { method, path, status: status.toString() };

  // Request count
  metrics.requestsTotal.inc(labels);

  // Request duration
  metrics.requestDuration.observe(labels, durationMs);

  // Request size
  if (requestBytes !== undefined) {
    metrics.requestSize.observe({ method, path }, requestBytes);
  }

  // Response size
  if (responseBytes !== undefined) {
    metrics.responseSize.observe(labels, responseBytes);
  }

  // Error tracking
  if (error || status >= 400) {
    metrics.errorsTotal.inc({
      method,
      path,
      status: status.toString(),
      error_type: error ?? (status >= 500 ? 'server_error' : 'client_error'),
    });
  }

  // Cache tracking
  if (cacheStatus === 'hit') {
    metrics.cacheHits.inc({ path });
  } else if (cacheStatus === 'miss') {
    metrics.cacheMisses.inc({ path });
  }
}

/**
 * Compute cache hit rate
 */
export function getCacheHitRate(metrics: WikipediaMetrics = getMetrics(), path?: string): number {
  const labels = path ? { path } : {};
  const hits = metrics.cacheHits.get(labels);
  const misses = metrics.cacheMisses.get(labels);
  const total = hits + misses;
  return total > 0 ? hits / total : 0;
}

/**
 * Get summary statistics from a histogram
 */
export function getHistogramSummary(
  histogram: Histogram,
  labels: Labels = {}
): { count: number; sum: number; avg: number; p50: number; p90: number; p99: number } | null {
  const value = histogram.get(labels);
  if (!value || value.count === 0) {
    return null;
  }

  const { count, sum, buckets } = value;
  const avg = sum / count;

  // Estimate percentiles from histogram buckets
  const p50 = estimatePercentile(buckets, count, 0.5);
  const p90 = estimatePercentile(buckets, count, 0.9);
  const p99 = estimatePercentile(buckets, count, 0.99);

  return { count, sum, avg, p50, p90, p99 };
}

/**
 * Estimate a percentile from histogram buckets
 * Uses linear interpolation between bucket bounds
 */
function estimatePercentile(buckets: HistogramBucket[], total: number, percentile: number): number {
  const target = total * percentile;
  let prevBound = 0;
  let prevCount = 0;

  for (const bucket of buckets) {
    if (bucket.count >= target) {
      // Linear interpolation
      const fraction = (target - prevCount) / (bucket.count - prevCount || 1);
      return prevBound + fraction * (bucket.le - prevBound);
    }
    prevBound = bucket.le;
    prevCount = bucket.count;
  }

  // If we get here, return the last bucket bound
  return buckets[buckets.length - 1]?.le ?? 0;
}
