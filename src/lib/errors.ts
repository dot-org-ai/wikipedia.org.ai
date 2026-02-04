/**
 * Typed error hierarchy for the Wikipedia API
 *
 * Provides structured error classes with a `kind` discriminator for
 * type-safe error handling in the middleware and handlers.
 *
 * Usage:
 * ```ts
 * import { NotFoundError, ValidationError } from './lib/errors.js';
 *
 * // Throw typed errors
 * throw new NotFoundError('Article not found: xyz');
 *
 * // Check error type
 * if (error instanceof NotFoundError) { ... }
 * if ('kind' in error && error.kind === 'NOT_FOUND') { ... }
 * ```
 */

/** Error kinds for type discrimination */
export type ErrorKind =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'RATE_LIMIT'
  | 'UNAUTHORIZED'
  | 'INTERNAL';

/** Base interface for typed errors */
export interface TypedError extends Error {
  readonly kind: ErrorKind;
}

/**
 * Error thrown when a requested resource is not found
 *
 * HTTP status: 404
 */
export class NotFoundError extends Error implements TypedError {
  readonly kind = 'NOT_FOUND' as const;

  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when input validation fails
 *
 * HTTP status: 400
 */
export class ValidationError extends Error implements TypedError {
  readonly kind = 'VALIDATION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown when rate limit is exceeded
 *
 * HTTP status: 429
 */
export class RateLimitError extends Error implements TypedError {
  readonly kind = 'RATE_LIMIT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * Error thrown when authentication/authorization fails
 *
 * HTTP status: 401
 */
export class UnauthorizedError extends Error implements TypedError {
  readonly kind = 'UNAUTHORIZED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/**
 * Error thrown for internal server errors
 *
 * HTTP status: 500
 */
export class InternalError extends Error implements TypedError {
  readonly kind = 'INTERNAL' as const;

  constructor(message: string) {
    super(message);
    this.name = 'InternalError';
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * Type guard to check if an error is a typed API error
 */
export function isTypedError(error: unknown): error is TypedError {
  return (
    error instanceof Error &&
    'kind' in error &&
    typeof (error as TypedError).kind === 'string'
  );
}

/**
 * Map error kind to HTTP status code
 */
export function getStatusForKind(kind: ErrorKind): number {
  switch (kind) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
      return 400;
    case 'RATE_LIMIT':
      return 429;
    case 'UNAUTHORIZED':
      return 401;
    case 'INTERNAL':
      return 500;
    default:
      return 500;
  }
}

/**
 * Map error kind to API error code string
 */
export function getErrorCodeForKind(kind: ErrorKind): string {
  switch (kind) {
    case 'NOT_FOUND':
      return 'NOT_FOUND';
    case 'VALIDATION':
      return 'BAD_REQUEST';
    case 'RATE_LIMIT':
      return 'RATE_LIMITED';
    case 'UNAUTHORIZED':
      return 'UNAUTHORIZED';
    case 'INTERNAL':
      return 'INTERNAL_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}
