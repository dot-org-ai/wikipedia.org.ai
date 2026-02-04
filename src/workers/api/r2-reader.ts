/**
 * R2 Parquet Reader
 *
 * Reads Parquet files directly from R2 storage using Range requests.
 * Implements minimal Parquet parsing for Cloudflare Workers environment.
 *
 * This file re-exports all functionality from the r2/ module for backwards compatibility.
 *
 * @deprecated Import directly from './r2/index.js' instead
 */

// Re-export everything from the r2 module
export * from './r2/index.js';
