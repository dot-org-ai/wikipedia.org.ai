/**
 * Cloudflare Analytics API Client for E2E Tests
 *
 * Queries worker invocation metrics including CPU time from
 * Cloudflare's GraphQL Analytics API.
 *
 * Required environment variables:
 * - CF_API_TOKEN: Cloudflare API token with Analytics:Read permission
 * - CF_ACCOUNT_ID: Cloudflare account ID
 */

export interface WorkerMetrics {
  scriptName: string;
  datetime: string;
  requests: number;
  cpuTimeP50: number;
  cpuTimeP99: number;
  duration: number;
  errors: number;
  subrequests: number;
}

export interface AnalyticsQueryResult {
  success: boolean;
  metrics: WorkerMetrics[];
  errors?: string[];
}

/**
 * Query worker CPU metrics from Cloudflare Analytics API
 *
 * @param scriptName - Worker script name to query
 * @param minutes - How far back to query (default: 5 minutes)
 */
export async function queryWorkerCpuMetrics(
  scriptName: string,
  minutes: number = 5
): Promise<AnalyticsQueryResult> {
  const apiToken = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;

  if (!apiToken || !accountId) {
    return {
      success: false,
      metrics: [],
      errors: ['CF_API_TOKEN and CF_ACCOUNT_ID environment variables required'],
    };
  }

  const now = new Date();
  const since = new Date(now.getTime() - minutes * 60 * 1000);

  const query = `
    query WorkerCpuMetrics($accountId: String!, $scriptName: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountId }) {
          workersInvocationsAdaptive(
            filter: {
              scriptName: $scriptName
              datetime_geq: $since
              datetime_leq: $until
            }
            limit: 100
            orderBy: [datetime_DESC]
          ) {
            dimensions {
              scriptName
              datetime
            }
            sum {
              requests
              errors
              subrequests
            }
            quantiles {
              cpuTimeP50
              cpuTimeP99
              durationP50
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          accountId,
          scriptName,
          since: since.toISOString(),
          until: now.toISOString(),
        },
      }),
    });

    if (!response.ok) {
      return {
        success: false,
        metrics: [],
        errors: [`API request failed: ${response.status}`],
      };
    }

    const data = await response.json() as {
      data?: {
        viewer?: {
          accounts?: Array<{
            workersInvocationsAdaptive?: Array<{
              dimensions: { scriptName: string; datetime: string };
              sum: { requests: number; errors: number; subrequests: number };
              quantiles: { cpuTimeP50: number; cpuTimeP99: number; durationP50: number };
            }>;
          }>;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors && data.errors.length > 0) {
      return {
        success: false,
        metrics: [],
        errors: data.errors.map((e) => e.message),
      };
    }

    const invocations = data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [];

    const metrics: WorkerMetrics[] = invocations.map((inv) => ({
      scriptName: inv.dimensions.scriptName,
      datetime: inv.dimensions.datetime,
      requests: inv.sum.requests,
      errors: inv.sum.errors,
      subrequests: inv.sum.subrequests,
      cpuTimeP50: inv.quantiles.cpuTimeP50,
      cpuTimeP99: inv.quantiles.cpuTimeP99,
      duration: inv.quantiles.durationP50,
    }));

    return {
      success: true,
      metrics,
    };
  } catch (error) {
    return {
      success: false,
      metrics: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

/**
 * Check if CPU time is within limits
 *
 * @param scriptName - Worker script name
 * @param maxCpuTimeMs - Maximum allowed CPU time in milliseconds
 * @param waitMs - Time to wait for metrics to propagate (default: 3000ms)
 */
export async function assertCpuTimeWithinLimit(
  scriptName: string,
  maxCpuTimeMs: number = 50,
  waitMs: number = 3000
): Promise<{ passed: boolean; cpuTimeP99: number | null; message: string }> {
  // Wait for metrics to propagate
  await new Promise((resolve) => setTimeout(resolve, waitMs));

  const result = await queryWorkerCpuMetrics(scriptName, 2);

  if (!result.success) {
    return {
      passed: false,
      cpuTimeP99: null,
      message: `Failed to query metrics: ${result.errors?.join(', ')}`,
    };
  }

  if (result.metrics.length === 0) {
    return {
      passed: false,
      cpuTimeP99: null,
      message: 'No metrics found for the specified time range',
    };
  }

  // Get the most recent metrics
  const latest = result.metrics[0];
  const cpuTimeP99 = latest?.cpuTimeP99 ?? 0;

  if (cpuTimeP99 > maxCpuTimeMs) {
    return {
      passed: false,
      cpuTimeP99,
      message: `CPU time P99 (${cpuTimeP99}ms) exceeds limit (${maxCpuTimeMs}ms)`,
    };
  }

  return {
    passed: true,
    cpuTimeP99,
    message: `CPU time P99 (${cpuTimeP99}ms) within limit (${maxCpuTimeMs}ms)`,
  };
}

/**
 * Get CPU metrics summary for a worker
 */
export async function getCpuMetricsSummary(
  scriptName: string,
  minutes: number = 10
): Promise<{
  p50: number | null;
  p99: number | null;
  requestCount: number;
  errorCount: number;
}> {
  const result = await queryWorkerCpuMetrics(scriptName, minutes);

  if (!result.success || result.metrics.length === 0) {
    return { p50: null, p99: null, requestCount: 0, errorCount: 0 };
  }

  // Aggregate across all time buckets
  let totalRequests = 0;
  let totalErrors = 0;
  let maxP50 = 0;
  let maxP99 = 0;

  for (const m of result.metrics) {
    totalRequests += m.requests;
    totalErrors += m.errors;
    maxP50 = Math.max(maxP50, m.cpuTimeP50);
    maxP99 = Math.max(maxP99, m.cpuTimeP99);
  }

  return {
    p50: maxP50,
    p99: maxP99,
    requestCount: totalRequests,
    errorCount: totalErrors,
  };
}
