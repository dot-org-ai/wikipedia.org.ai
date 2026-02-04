/**
 * Wikipedia Tail Worker - CPU and Event Monitoring
 *
 * A Cloudflare Tail Worker that receives execution traces from the main
 * Wikipedia API worker and processes them for monitoring and observability.
 *
 * Features:
 * - Filters for exceededCpu and exceededMemory outcomes
 * - Stores logs to R2 bucket
 * - Writes to Analytics Engine for metrics
 * - Tracks CPU time from events
 *
 * @see https://developers.cloudflare.com/workers/observability/logs/tail-workers/
 */

import type {
  TailWorkerEnv,
  TailWorkerConfig,
  TailEventFilter,
  BatchConfig,
  BatchState,
  TraceItem,
  ProcessedEvent,
  LogLevel,
} from './types.js'

// Re-export types
export type {
  TailWorkerEnv,
  TailWorkerConfig,
  TailEventFilter,
  BatchConfig,
  BatchState,
  TraceItem,
  ProcessedEvent,
  TraceOutcome,
  LogLevel,
} from './types.js'

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default filter configuration - focuses on CPU and memory issues
 */
export const DEFAULT_FILTER: TailEventFilter = {
  outcomes: ['exceededCpu', 'exceededMemory', 'exception'],
  logLevels: ['warn', 'error'],
}

/**
 * Default batch configuration
 */
export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  maxEvents: 100,
  maxWaitMs: 10000,
  minEvents: 1,
}

/**
 * Default tail worker configuration
 */
export const DEFAULT_TAIL_CONFIG: TailWorkerConfig = {
  filter: DEFAULT_FILTER,
  batch: DEFAULT_BATCH_CONFIG,
  enableR2Storage: true,
  enableAnalytics: true,
  enableAlerts: true,
}

// =============================================================================
// Event Filtering
// =============================================================================

/**
 * Type guard to check if an item is a valid TraceItem
 */
function isValidTraceItem(item: unknown): item is TraceItem {
  if (typeof item !== 'object' || item === null) {
    return false
  }

  const trace = item as Record<string, unknown>

  // Check required fields
  if (typeof trace['outcome'] !== 'string') {
    return false
  }

  // logs and exceptions should be arrays
  if (!Array.isArray(trace['logs']) || !Array.isArray(trace['exceptions'])) {
    return false
  }

  return true
}

/**
 * Validate and filter trace items from unknown input
 */
function validateTraceItems(events: unknown): TraceItem[] {
  if (!Array.isArray(events)) {
    return []
  }

  return events.filter(isValidTraceItem)
}

/**
 * Check if a URL matches a glob pattern
 */
function matchUrlPattern(url: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
    .replace(/\*/g, '.*') // Convert * to .*
    .replace(/\?/g, '.') // Convert ? to .

  try {
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(url)
  } catch {
    return false
  }
}

/**
 * Apply filters to a trace item
 *
 * @param item - The trace item to filter
 * @param filter - Filter configuration
 * @returns true if the item should be included
 */
export function filterTraceItem(item: TraceItem, filter: TailEventFilter): boolean {
  // Filter by script name
  if (filter.scriptNames && filter.scriptNames.length > 0) {
    if (!item.scriptName || !filter.scriptNames.includes(item.scriptName)) {
      return false
    }
  }

  // Filter by outcome
  if (filter.outcomes && filter.outcomes.length > 0) {
    if (!filter.outcomes.includes(item.outcome)) {
      return false
    }
  }

  // Filter by exceptions only
  if (filter.exceptionsOnly && item.exceptions.length === 0) {
    return false
  }

  // Filter by minimum logs
  if (filter.minLogs !== undefined && item.logs.length < filter.minLogs) {
    return false
  }

  // Filter by log levels
  if (filter.logLevels && filter.logLevels.length > 0) {
    const logLevels = filter.logLevels
    const hasMatchingLog = item.logs.some((log) =>
      logLevels.includes(log.level as LogLevel)
    )
    if (item.logs.length > 0 && !hasMatchingLog) {
      return false
    }
  }

  // Filter by URL patterns
  if (filter.urlPatterns && filter.urlPatterns.length > 0 && item.event?.request?.url) {
    const url = item.event.request.url
    const matchesPattern = filter.urlPatterns.some((pattern) =>
      matchUrlPattern(url, pattern)
    )
    if (!matchesPattern) {
      return false
    }
  }

  return true
}

/**
 * Filter an array of trace items
 *
 * @param items - Array of trace items
 * @param filter - Filter configuration
 * @returns Filtered array
 */
export function filterTraceItems(items: TraceItem[], filter: TailEventFilter): TraceItem[] {
  return items.filter((item) => filterTraceItem(item, filter))
}

// =============================================================================
// Event Processing
// =============================================================================

/**
 * Generate a unique event ID
 */
function generateEventId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 10)
  return `${timestamp}-${random}`
}

/**
 * Extract CPU time from diagnostics channel events if available
 */
function extractCpuTime(item: TraceItem): number | undefined {
  if (!item.diagnosticsChannelEvents || !Array.isArray(item.diagnosticsChannelEvents)) {
    return undefined
  }

  for (const event of item.diagnosticsChannelEvents) {
    if (
      typeof event === 'object' &&
      event !== null &&
      'cpuTime' in event &&
      typeof (event as Record<string, unknown>)['cpuTime'] === 'number'
    ) {
      return (event as Record<string, number>)['cpuTime']
    }
  }

  return undefined
}

/**
 * Transform a trace item into a processed event
 *
 * @param item - Raw trace item
 * @returns Processed event
 */
export function processTraceItem(item: TraceItem): ProcessedEvent {
  const event: ProcessedEvent = {
    id: generateEventId(),
    timestamp: item.eventTimestamp
      ? new Date(item.eventTimestamp).toISOString()
      : new Date().toISOString(),
    scriptName: item.scriptName ?? 'unknown',
    outcome: item.outcome,
    logCount: item.logs.length,
    exceptionCount: item.exceptions.length,
  }

  // Add request info
  if (item.event?.request) {
    event.method = item.event.request.method
    event.url = item.event.request.url
    event.colo = item.event.request.cf?.colo
    event.country = item.event.request.cf?.country
  }

  // Add errors
  if (item.exceptions.length > 0) {
    event.errors = item.exceptions.map((e) => `${e.name}: ${e.message}`)
  }

  // Add filtered logs (warn and error only for storage efficiency)
  const significantLogs = item.logs.filter(
    (log) => log.level === 'warn' || log.level === 'error'
  )
  if (significantLogs.length > 0) {
    event.logs = significantLogs.map((log) => ({
      level: log.level as LogLevel,
      message: typeof log.message === 'string' ? log.message : JSON.stringify(log.message),
      timestamp: log.timestamp,
    }))
  }

  // Extract CPU time if available
  const cpuTime = extractCpuTime(item)
  if (cpuTime !== undefined) {
    event.cpuTimeMs = cpuTime
  }

  return event
}

/**
 * Process multiple trace items
 *
 * @param items - Array of trace items
 * @returns Array of processed events
 */
export function processTraceItems(items: TraceItem[]): ProcessedEvent[] {
  return items.map(processTraceItem)
}

// =============================================================================
// Batching
// =============================================================================

/**
 * Create a new batch state
 */
export function createBatchState(): BatchState {
  const now = Date.now()
  return {
    events: [],
    startTime: now,
    lastFlush: now,
  }
}

/**
 * Check if a batch should be flushed
 *
 * @param state - Current batch state
 * @param config - Batch configuration
 * @returns true if batch should be flushed
 */
export function shouldFlushBatch(state: BatchState, config: BatchConfig): boolean {
  if (state.events.length === 0) {
    return false
  }

  // Max events reached
  if (state.events.length >= config.maxEvents) {
    return true
  }

  // Max wait time reached
  const elapsed = Date.now() - state.startTime
  if (elapsed >= config.maxWaitMs && state.events.length >= config.minEvents) {
    return true
  }

  return false
}

/**
 * Add events to batch and return events to flush (if any)
 *
 * @param state - Current batch state
 * @param events - New events to add
 * @param config - Batch configuration
 * @returns Events to flush (empty if not ready)
 */
export function addToBatch(
  state: BatchState,
  events: ProcessedEvent[],
  config: BatchConfig
): ProcessedEvent[] {
  state.events.push(...events)

  if (shouldFlushBatch(state, config)) {
    const toFlush = state.events
    state.events = []
    state.startTime = Date.now()
    state.lastFlush = Date.now()
    return toFlush
  }

  return []
}

// =============================================================================
// Storage
// =============================================================================

/**
 * Store processed events in R2
 *
 * @param bucket - R2 bucket
 * @param events - Events to store
 * @returns Storage key
 */
export async function storeEventsInR2(
  bucket: R2Bucket,
  events: ProcessedEvent[]
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const key = `logs/${timestamp}.json`

  await bucket.put(key, JSON.stringify(events, null, 2), {
    httpMetadata: {
      contentType: 'application/json',
    },
    customMetadata: {
      eventCount: String(events.length),
      createdAt: new Date().toISOString(),
    },
  })

  return key
}

/**
 * Write metrics to Analytics Engine
 *
 * @param analytics - Analytics Engine binding
 * @param events - Events to record
 */
export async function writeToAnalytics(
  analytics: AnalyticsEngineDataset,
  events: ProcessedEvent[]
): Promise<void> {
  for (const event of events) {
    analytics.writeDataPoint({
      blobs: [
        event.scriptName,
        event.outcome,
        event.method ?? 'unknown',
        event.country ?? 'unknown',
      ],
      doubles: [
        1, // count
        event.logCount,
        event.exceptionCount,
        event.cpuTimeMs ?? 0,
      ],
      indexes: [event.colo ?? 'unknown'],
    })
  }
}

/**
 * Send alert for critical events (CPU/memory exceeded)
 *
 * @param webhookUrl - Webhook URL
 * @param events - Events that triggered alert
 */
export async function sendAlert(
  webhookUrl: string,
  events: ProcessedEvent[]
): Promise<void> {
  // Filter for critical events (CPU/memory exceeded or exceptions)
  const criticalEvents = events.filter(
    (e) =>
      e.outcome === 'exceededCpu' ||
      e.outcome === 'exceededMemory' ||
      e.exceptionCount > 0
  )

  if (criticalEvents.length === 0) {
    return
  }

  await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: `Wikipedia API Alert: ${criticalEvents.length} critical event(s)`,
      events: criticalEvents.slice(0, 10), // Limit to first 10
      summary: {
        exceededCpu: criticalEvents.filter((e) => e.outcome === 'exceededCpu').length,
        exceededMemory: criticalEvents.filter((e) => e.outcome === 'exceededMemory').length,
        exceptions: criticalEvents.filter((e) => e.exceptionCount > 0).length,
      },
    }),
  })
}

// =============================================================================
// Tail Worker Handler
// =============================================================================

/**
 * Create a tail handler with custom configuration
 *
 * @param config - Tail worker configuration
 * @returns Tail handler function
 */
export function createTailHandler(config: TailWorkerConfig = DEFAULT_TAIL_CONFIG) {
  const filter = config.filter ?? DEFAULT_FILTER
  const batchConfig = config.batch ?? DEFAULT_BATCH_CONFIG

  // Batch state is created once per handler instance
  const batchState = createBatchState()

  return async function tail(events: unknown, env: TailWorkerEnv): Promise<void> {
    // Validate input
    const validItems = validateTraceItems(events)

    if (validItems.length === 0) {
      return
    }

    // Filter events for CPU/memory issues
    const filteredEvents = filterTraceItems(validItems, filter)

    if (filteredEvents.length === 0) {
      return
    }

    // Process events
    const processedEvents = processTraceItems(filteredEvents)

    // Log critical events immediately
    for (const event of processedEvents) {
      if (event.outcome === 'exceededCpu' || event.outcome === 'exceededMemory') {
        console.warn(
          `[tail] ${event.outcome}: ${event.scriptName} - ${event.url ?? 'unknown URL'}`
        )
      }
    }

    // Add to batch and check if we should flush
    const toFlush = addToBatch(batchState, processedEvents, batchConfig)

    if (toFlush.length === 0) {
      return
    }

    // Store in R2
    if (config.enableR2Storage && env.LOGS_BUCKET) {
      try {
        const key = await storeEventsInR2(env.LOGS_BUCKET, toFlush)
        console.log(`[tail] Stored ${toFlush.length} events to R2: ${key}`)
      } catch (error) {
        console.error('[tail] Failed to store events in R2:', error)
      }
    }

    // Write to Analytics Engine
    if (config.enableAnalytics && env.ANALYTICS) {
      try {
        await writeToAnalytics(env.ANALYTICS, toFlush)
        console.log(`[tail] Wrote ${toFlush.length} events to Analytics Engine`)
      } catch (error) {
        console.error('[tail] Failed to write to Analytics Engine:', error)
      }
    }

    // Send alerts
    if (config.enableAlerts && env.ALERT_WEBHOOK_URL) {
      try {
        await sendAlert(env.ALERT_WEBHOOK_URL, toFlush)
      } catch (error) {
        console.error('[tail] Failed to send alert:', error)
      }
    }
  }
}

// =============================================================================
// Tail Worker Export
// =============================================================================

// Create handler once at module level to preserve batch state across invocations
const defaultHandler = createTailHandler(DEFAULT_TAIL_CONFIG)

export default {
  /**
   * Tail handler - processes events from the main Wikipedia API worker
   *
   * Monitors for:
   * - exceededCpu outcomes
   * - exceededMemory outcomes
   * - Exceptions and errors
   *
   * @param events - Array of trace items from producer Workers
   * @param env - Environment bindings
   */
  async tail(events: unknown, env: TailWorkerEnv): Promise<void> {
    await defaultHandler(events, env)
  },
}
