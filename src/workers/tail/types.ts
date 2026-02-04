/**
 * Type definitions for the Wikipedia Tail Worker
 *
 * A Cloudflare Tail Worker that monitors CPU time, memory usage,
 * and events from the main Wikipedia API worker.
 */

// =============================================================================
// Environment Bindings
// =============================================================================

/**
 * Tail Worker environment bindings
 */
export interface TailWorkerEnv {
  /** R2 bucket for storing processed logs */
  LOGS_BUCKET?: R2Bucket | undefined

  /** Analytics Engine binding for metrics */
  ANALYTICS?: AnalyticsEngineDataset | undefined

  /** Optional webhook URL for real-time alerts */
  ALERT_WEBHOOK_URL?: string | undefined

  /** Environment name for filtering */
  ENVIRONMENT?: string | undefined
}

// =============================================================================
// Trace Item Types
// =============================================================================

/**
 * Execution outcome from a producer Worker
 */
export type TraceOutcome =
  | 'ok'
  | 'exception'
  | 'exceededCpu'
  | 'exceededMemory'
  | 'unknown'

/**
 * Log level from console methods
 */
export type LogLevel = 'log' | 'debug' | 'info' | 'warn' | 'error'

/**
 * Log entry from console.log, console.error, etc.
 */
export interface TailLog {
  /** Unix timestamp in milliseconds */
  timestamp: number

  /** Log level: log, debug, info, warn, error */
  level: LogLevel

  /** Log message content */
  message: unknown
}

/**
 * Exception captured from the producer Worker
 */
export interface TailException {
  /** Exception name (e.g., "TypeError") */
  name: string

  /** Exception message */
  message: string

  /** Unix timestamp when exception was thrown */
  timestamp: number
}

/**
 * Cloudflare-specific request metadata
 */
export interface CfProperties {
  /** Cloudflare data center (colo) */
  colo?: string | undefined
  /** Country code */
  country?: string | undefined
  /** City name */
  city?: string | undefined
  /** ASN */
  asn?: number | undefined
  /** AS Organization */
  asOrganization?: string | undefined
}

/**
 * Request information from the triggering event
 */
export interface TailRequest {
  /** Full URL of the request */
  url: string

  /** HTTP method */
  method: string

  /** Request headers (sanitized) */
  headers: Record<string, string>

  /** Cloudflare-specific request metadata */
  cf?: CfProperties | undefined
}

/**
 * Event information from the trace
 */
export interface TailEventInfo {
  /** Request details (for fetch events) */
  request?: TailRequest | undefined

  /** Scheduled event time (for cron triggers) */
  scheduledTime?: number | undefined

  /** Queue name (for queue consumers) */
  queue?: string | undefined
}

/**
 * A single trace item from a producer Worker execution
 */
export interface TraceItem {
  /** Name of the producer Worker script */
  scriptName: string | null

  /** Execution outcome */
  outcome: TraceOutcome

  /** Unix timestamp when the event occurred */
  eventTimestamp: number | null

  /** Event information (request, scheduled, queue, etc.) */
  event: TailEventInfo | null

  /** Array of log entries */
  logs: TailLog[]

  /** Array of exceptions */
  exceptions: TailException[]

  /** Diagnostics channel events */
  diagnosticsChannelEvents: unknown[]
}

// =============================================================================
// Filter Configuration
// =============================================================================

/**
 * Filter configuration for tail events
 */
export interface TailEventFilter {
  /** Only include events from these script names */
  scriptNames?: string[] | undefined

  /** Only include events with these outcomes */
  outcomes?: TraceOutcome[] | undefined

  /** Only include events with logs at these levels */
  logLevels?: LogLevel[] | undefined

  /** Only include events with exceptions */
  exceptionsOnly?: boolean | undefined

  /** Minimum number of logs to include */
  minLogs?: number | undefined

  /** URL patterns to include (glob-style) */
  urlPatterns?: string[] | undefined
}

// =============================================================================
// Batching Configuration
// =============================================================================

/**
 * Batching configuration
 */
export interface BatchConfig {
  /** Maximum events per batch before flush */
  maxEvents: number

  /** Maximum time (ms) to hold events before flush */
  maxWaitMs: number

  /** Minimum events before considering a flush */
  minEvents: number
}

/**
 * Batch state for accumulating events
 */
export interface BatchState {
  events: ProcessedEvent[]
  startTime: number
  lastFlush: number
}

// =============================================================================
// Processed Event
// =============================================================================

/**
 * Processed event ready for storage/transmission
 */
export interface ProcessedEvent {
  /** Unique event ID */
  id: string

  /** Timestamp of the event */
  timestamp: string

  /** Producer script name */
  scriptName: string

  /** Execution outcome */
  outcome: TraceOutcome

  /** HTTP method (if applicable) */
  method?: string | undefined

  /** Request URL (if applicable) */
  url?: string | undefined

  /** Cloudflare colo */
  colo?: string | undefined

  /** Country code */
  country?: string | undefined

  /** Log count */
  logCount: number

  /** Exception count */
  exceptionCount: number

  /** Error messages (if any) */
  errors?: string[] | undefined

  /** Log messages (filtered) */
  logs?: Array<{
    level: LogLevel
    message: string
    timestamp: number
  }> | undefined

  /** CPU time in milliseconds (if available from diagnostics) */
  cpuTimeMs?: number | undefined
}

// =============================================================================
// Tail Worker Configuration
// =============================================================================

/**
 * Tail Worker configuration
 */
export interface TailWorkerConfig {
  /** Event filter */
  filter?: TailEventFilter | undefined

  /** Batch configuration */
  batch?: BatchConfig | undefined

  /** Enable R2 storage */
  enableR2Storage?: boolean | undefined

  /** Enable Analytics Engine */
  enableAnalytics?: boolean | undefined

  /** Enable alerting */
  enableAlerts?: boolean | undefined
}
