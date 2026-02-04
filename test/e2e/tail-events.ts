/**
 * Tail Events Client for E2E Tests
 *
 * Queries the tail worker for actual CPU time from trace events.
 * This gives us real CPU time (not response time which includes network latency).
 *
 * Required environment variables:
 * - E2E_TAIL_URL: URL of the tail worker (default: https://tail.wikipedia.org.ai)
 */

export interface TraceEvent {
  scriptName: string | null;
  outcome: 'ok' | 'exceededCpu' | 'exceededMemory' | 'exception' | 'unknown';
  eventTimestamp: number | null;
  /** CPU time in milliseconds (at top level of trace event) */
  cpuTime?: number;
  /** Wall clock time in milliseconds */
  wallTime?: number;
  event: {
    request?: {
      url: string;
      method: string;
    };
  } | null;
  logs: Array<{
    level: string;
    message: unknown;
    timestamp: number;
  }>;
  exceptions: Array<{
    name: string;
    message: string;
    timestamp: number;
  }>;
  diagnosticsChannelEvents?: Array<{
    cpuTime?: number;
    wallTime?: number;
  }>;
}

export interface TailEventsResult {
  success: boolean;
  events: TraceEvent[];
  error?: string;
}

/**
 * Get the tail events URL from environment or default
 * Uses the main worker's /_tail/events endpoint
 */
function getTailUrl(): string {
  return process.env.E2E_TAIL_URL || 'https://wikipedia.org.ai/_tail';
}

/**
 * Query recent tail events
 *
 * @param limit - Maximum number of events to return
 * @param urlFilter - Optional URL pattern to filter by
 */
export async function queryTailEvents(
  limit: number = 10,
  urlFilter?: string
): Promise<TailEventsResult> {
  const tailUrl = getTailUrl();
  const params = new URLSearchParams({ limit: String(limit) });

  if (urlFilter) {
    params.set('url', urlFilter);
  }

  try {
    const response = await fetch(`${tailUrl}/events?${params}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        success: false,
        events: [],
        error: `Tail worker returned ${response.status}`,
      };
    }

    const events = (await response.json()) as TraceEvent[];

    return {
      success: true,
      events,
    };
  } catch (error) {
    return {
      success: false,
      events: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Extract CPU time from a trace event
 * CPU time is at the top level of the event object
 */
export function extractCpuTime(event: TraceEvent): number | null {
  // cpuTime is at the top level of the trace event
  if (typeof event.cpuTime === 'number') {
    return event.cpuTime;
  }

  // Fallback: check diagnosticsChannelEvents
  if (event.diagnosticsChannelEvents && Array.isArray(event.diagnosticsChannelEvents)) {
    for (const diag of event.diagnosticsChannelEvents) {
      if (typeof diag === 'object' && diag !== null && typeof diag.cpuTime === 'number') {
        return diag.cpuTime;
      }
    }
  }

  return null;
}

/**
 * Query tail events for a specific URL and extract CPU time
 *
 * @param url - The URL to filter by
 * @param waitMs - Time to wait for events to propagate (default: 2000ms)
 */
export async function getCpuTimeForUrl(
  url: string,
  waitMs: number = 2000
): Promise<{ cpuTimeMs: number | null; outcome: string | null; error?: string }> {
  // Wait for tail events to propagate
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const result = await queryTailEvents(20, url);

  if (!result.success) {
    return { cpuTimeMs: null, outcome: null, error: result.error };
  }

  // Find matching event
  const matchingEvent = result.events.find((e) => {
    const reqUrl = e.event?.request?.url;
    return reqUrl && reqUrl.includes(url);
  });

  if (!matchingEvent) {
    return { cpuTimeMs: null, outcome: null, error: `No tail event found for URL: ${url}` };
  }

  const cpuTimeMs = extractCpuTime(matchingEvent);

  return {
    cpuTimeMs,
    outcome: matchingEvent.outcome,
  };
}

/**
 * Assert CPU time is within limit for a URL
 *
 * @param url - The URL that was requested
 * @param maxCpuTimeMs - Maximum allowed CPU time in milliseconds
 */
export async function assertCpuTimeWithinLimit(
  url: string,
  maxCpuTimeMs: number = 50
): Promise<{ passed: boolean; cpuTimeMs: number | null; message: string }> {
  const result = await getCpuTimeForUrl(url);

  if (result.error) {
    return {
      passed: false,
      cpuTimeMs: null,
      message: result.error,
    };
  }

  // If outcome was exceededCpu, we know it failed
  if (result.outcome === 'exceededCpu') {
    return {
      passed: false,
      cpuTimeMs: result.cpuTimeMs,
      message: `Request exceeded CPU limit (outcome: exceededCpu)`,
    };
  }

  // If we have CPU time, check it
  if (result.cpuTimeMs !== null) {
    if (result.cpuTimeMs > maxCpuTimeMs) {
      return {
        passed: false,
        cpuTimeMs: result.cpuTimeMs,
        message: `CPU time ${result.cpuTimeMs}ms exceeds limit ${maxCpuTimeMs}ms`,
      };
    }

    return {
      passed: true,
      cpuTimeMs: result.cpuTimeMs,
      message: `CPU time ${result.cpuTimeMs}ms within limit ${maxCpuTimeMs}ms`,
    };
  }

  // If outcome is 'ok' but no CPU time available, it passed
  if (result.outcome === 'ok') {
    return {
      passed: true,
      cpuTimeMs: null,
      message: `Request succeeded (outcome: ok) but CPU time not available in trace`,
    };
  }

  return {
    passed: false,
    cpuTimeMs: null,
    message: `Unknown outcome: ${result.outcome}`,
  };
}
