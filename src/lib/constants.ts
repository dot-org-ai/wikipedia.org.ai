/**
 * Centralized constants for the Wikipedia API
 *
 * This file contains magic numbers and configuration defaults that are
 * shared across multiple modules. Import from here to ensure consistency.
 */

// ============================================================================
// Batch Processing
// ============================================================================

/** Default batch size for processing operations (e.g., embeddings) */
export const DEFAULT_BATCH_SIZE = 50;

// ============================================================================
// Retry Configuration
// ============================================================================

/** Default maximum number of retry attempts */
export const DEFAULT_MAX_RETRIES = 3;

/** Default delay between retries in milliseconds */
export const DEFAULT_RETRY_DELAY_MS = 1000;

// ============================================================================
// Timeout Configuration
// ============================================================================

/** Default request timeout in milliseconds (60 seconds) */
export const DEFAULT_TIMEOUT_MS = 60000;

// ============================================================================
// Cache Configuration
// ============================================================================

/** Default cache TTL in seconds (1 hour) */
export const DEFAULT_CACHE_TTL = 3600;

// ============================================================================
// Rate Limiting
// ============================================================================

/** Default maximum requests per rate limit window */
export const DEFAULT_RATE_LIMIT = 100;

/** Default rate limit window in seconds */
export const DEFAULT_RATE_WINDOW_SECONDS = 60;

// ============================================================================
// Pagination
// ============================================================================

/** Maximum number of results that can be returned in a single request */
export const MAX_RESULTS_LIMIT = 100;

/** Default number of results to return if not specified */
export const DEFAULT_RESULTS_LIMIT = 20;
