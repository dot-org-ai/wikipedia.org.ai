/**
 * Configuration Schema Validation
 *
 * Zod schemas for validating CLI configuration and worker environment bindings.
 * Provides runtime type safety and helpful error messages for misconfiguration.
 */

import { z } from 'zod';

/**
 * CLI Configuration Schema
 *
 * Validates configuration from .wikipediarc files and environment variables.
 */
export const CliConfigSchema = z.object({
  /** Data directory for storing Parquet files and indexes */
  dataDir: z.string().optional(),

  /** AI Gateway URL for Cloudflare Workers AI */
  aiGatewayUrl: z.string().url().optional(),

  /** Cloudflare account ID */
  accountId: z.string().optional(),

  /** Cloudflare API token for Workers AI */
  apiToken: z.string().optional(),

  /** Default embedding model name */
  defaultModel: z.string().optional(),

  /** Batch size for embedding generation */
  batchSize: z.number().int().positive().optional(),

  /** API server port */
  port: z.number().int().min(1).max(65535).optional(),
});

/** Type inferred from CliConfigSchema */
export type CliConfig = z.infer<typeof CliConfigSchema>;

/**
 * Worker Environment Schema
 *
 * Validates the Cloudflare Worker environment bindings.
 * Note: R2 and AI bindings are validated at runtime by Cloudflare,
 * so we only validate the string configuration values here.
 */
export const WorkerEnvSchema = z.object({
  /** AI Gateway URL */
  AI_GATEWAY_URL: z.string().url(),

  /** Environment name */
  ENVIRONMENT: z.enum(['staging', 'production']),

  /** Comma-separated list of valid API keys (optional) */
  API_KEYS: z.string().optional(),
});

/** Type for validated worker environment config (string values only) */
export type WorkerEnvConfig = z.infer<typeof WorkerEnvSchema>;

/**
 * Validate CLI configuration
 *
 * @param config - Raw configuration object to validate
 * @returns Validated configuration
 * @throws {z.ZodError} If validation fails
 */
export function validateCliConfig(config: unknown): CliConfig {
  return CliConfigSchema.parse(config);
}

/**
 * Safely validate CLI configuration without throwing
 *
 * @param config - Raw configuration object to validate
 * @returns Validation result with success flag and either data or error
 */
export function safeValidateCliConfig(config: unknown): z.SafeParseReturnType<unknown, CliConfig> {
  return CliConfigSchema.safeParse(config);
}

/**
 * Validate worker environment configuration
 *
 * @param env - Raw environment object to validate
 * @returns Validated environment configuration
 * @throws {z.ZodError} If validation fails
 */
export function validateWorkerEnv(env: unknown): WorkerEnvConfig {
  return WorkerEnvSchema.parse(env);
}

/**
 * Safely validate worker environment configuration without throwing
 *
 * @param env - Raw environment object to validate
 * @returns Validation result with success flag and either data or error
 */
export function safeValidateWorkerEnv(env: unknown): z.SafeParseReturnType<unknown, WorkerEnvConfig> {
  return WorkerEnvSchema.safeParse(env);
}

/**
 * Format Zod validation errors for user display
 *
 * @param error - Zod error object
 * @returns Formatted error message string
 */
export function formatValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('\n');
}
