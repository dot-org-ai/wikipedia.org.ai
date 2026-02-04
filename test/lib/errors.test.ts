/**
 * Tests for typed error hierarchy
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NotFoundError,
  ValidationError,
  RateLimitError,
  UnauthorizedError,
  InternalError,
  isTypedError,
  getStatusForKind,
  getErrorCodeForKind,
  type ErrorKind,
  type TypedError,
} from '../../src/lib/errors.js';
import { errorHandler } from '../../src/workers/api/middleware.js';

describe('Error Classes', () => {
  describe('NotFoundError', () => {
    it('should be an instance of Error', () => {
      const error = new NotFoundError('Resource not found');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct message', () => {
      const error = new NotFoundError('Article not found');
      expect(error.message).toBe('Article not found');
    });

    it('should have kind = NOT_FOUND', () => {
      const error = new NotFoundError('test');
      expect(error.kind).toBe('NOT_FOUND');
    });

    it('should have name = NotFoundError', () => {
      const error = new NotFoundError('test');
      expect(error.name).toBe('NotFoundError');
    });

    it('should work with instanceof', () => {
      const error = new NotFoundError('test');
      expect(error instanceof NotFoundError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should have a stack trace', () => {
      const error = new NotFoundError('test');
      expect(error.stack).toBeDefined();
    });
  });

  describe('ValidationError', () => {
    it('should be an instance of Error', () => {
      const error = new ValidationError('Invalid input');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct message', () => {
      const error = new ValidationError('Invalid parameter: limit');
      expect(error.message).toBe('Invalid parameter: limit');
    });

    it('should have kind = VALIDATION', () => {
      const error = new ValidationError('test');
      expect(error.kind).toBe('VALIDATION');
    });

    it('should have name = ValidationError', () => {
      const error = new ValidationError('test');
      expect(error.name).toBe('ValidationError');
    });

    it('should work with instanceof', () => {
      const error = new ValidationError('test');
      expect(error instanceof ValidationError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('RateLimitError', () => {
    it('should be an instance of Error', () => {
      const error = new RateLimitError('Too many requests');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct message', () => {
      const error = new RateLimitError('Rate limit exceeded');
      expect(error.message).toBe('Rate limit exceeded');
    });

    it('should have kind = RATE_LIMIT', () => {
      const error = new RateLimitError('test');
      expect(error.kind).toBe('RATE_LIMIT');
    });

    it('should have name = RateLimitError', () => {
      const error = new RateLimitError('test');
      expect(error.name).toBe('RateLimitError');
    });

    it('should work with instanceof', () => {
      const error = new RateLimitError('test');
      expect(error instanceof RateLimitError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('UnauthorizedError', () => {
    it('should be an instance of Error', () => {
      const error = new UnauthorizedError('Access denied');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct message', () => {
      const error = new UnauthorizedError('Invalid API key');
      expect(error.message).toBe('Invalid API key');
    });

    it('should have kind = UNAUTHORIZED', () => {
      const error = new UnauthorizedError('test');
      expect(error.kind).toBe('UNAUTHORIZED');
    });

    it('should have name = UnauthorizedError', () => {
      const error = new UnauthorizedError('test');
      expect(error.name).toBe('UnauthorizedError');
    });

    it('should work with instanceof', () => {
      const error = new UnauthorizedError('test');
      expect(error instanceof UnauthorizedError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('InternalError', () => {
    it('should be an instance of Error', () => {
      const error = new InternalError('Server error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct message', () => {
      const error = new InternalError('Database connection failed');
      expect(error.message).toBe('Database connection failed');
    });

    it('should have kind = INTERNAL', () => {
      const error = new InternalError('test');
      expect(error.kind).toBe('INTERNAL');
    });

    it('should have name = InternalError', () => {
      const error = new InternalError('test');
      expect(error.name).toBe('InternalError');
    });

    it('should work with instanceof', () => {
      const error = new InternalError('test');
      expect(error instanceof InternalError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });
});

describe('Type Guard', () => {
  describe('isTypedError', () => {
    it('should return true for NotFoundError', () => {
      const error = new NotFoundError('test');
      expect(isTypedError(error)).toBe(true);
    });

    it('should return true for ValidationError', () => {
      const error = new ValidationError('test');
      expect(isTypedError(error)).toBe(true);
    });

    it('should return true for RateLimitError', () => {
      const error = new RateLimitError('test');
      expect(isTypedError(error)).toBe(true);
    });

    it('should return true for UnauthorizedError', () => {
      const error = new UnauthorizedError('test');
      expect(isTypedError(error)).toBe(true);
    });

    it('should return true for InternalError', () => {
      const error = new InternalError('test');
      expect(isTypedError(error)).toBe(true);
    });

    it('should return false for generic Error', () => {
      const error = new Error('test');
      expect(isTypedError(error)).toBe(false);
    });

    it('should return false for non-Error objects', () => {
      expect(isTypedError({ kind: 'NOT_FOUND', message: 'test' })).toBe(false);
      expect(isTypedError(null)).toBe(false);
      expect(isTypedError(undefined)).toBe(false);
      expect(isTypedError('error string')).toBe(false);
    });
  });
});

describe('Helper Functions', () => {
  describe('getStatusForKind', () => {
    it('should return 404 for NOT_FOUND', () => {
      expect(getStatusForKind('NOT_FOUND')).toBe(404);
    });

    it('should return 400 for VALIDATION', () => {
      expect(getStatusForKind('VALIDATION')).toBe(400);
    });

    it('should return 429 for RATE_LIMIT', () => {
      expect(getStatusForKind('RATE_LIMIT')).toBe(429);
    });

    it('should return 401 for UNAUTHORIZED', () => {
      expect(getStatusForKind('UNAUTHORIZED')).toBe(401);
    });

    it('should return 500 for INTERNAL', () => {
      expect(getStatusForKind('INTERNAL')).toBe(500);
    });

    it('should return 500 for unknown kinds', () => {
      expect(getStatusForKind('UNKNOWN' as ErrorKind)).toBe(500);
    });
  });

  describe('getErrorCodeForKind', () => {
    it('should return NOT_FOUND for NOT_FOUND', () => {
      expect(getErrorCodeForKind('NOT_FOUND')).toBe('NOT_FOUND');
    });

    it('should return BAD_REQUEST for VALIDATION', () => {
      expect(getErrorCodeForKind('VALIDATION')).toBe('BAD_REQUEST');
    });

    it('should return RATE_LIMITED for RATE_LIMIT', () => {
      expect(getErrorCodeForKind('RATE_LIMIT')).toBe('RATE_LIMITED');
    });

    it('should return UNAUTHORIZED for UNAUTHORIZED', () => {
      expect(getErrorCodeForKind('UNAUTHORIZED')).toBe('UNAUTHORIZED');
    });

    it('should return INTERNAL_ERROR for INTERNAL', () => {
      expect(getErrorCodeForKind('INTERNAL')).toBe('INTERNAL_ERROR');
    });

    it('should return INTERNAL_ERROR for unknown kinds', () => {
      expect(getErrorCodeForKind('UNKNOWN' as ErrorKind)).toBe('INTERNAL_ERROR');
    });
  });
});

describe('errorHandler Integration', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle NotFoundError with 404 status', async () => {
    const error = new NotFoundError('Article not found: xyz');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
    expect(body.message).toBe('Article not found: xyz');
  });

  it('should handle ValidationError with 400 status', async () => {
    const error = new ValidationError('Invalid parameter: limit must be positive');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('BAD_REQUEST');
    expect(body.message).toBe('Invalid parameter: limit must be positive');
  });

  it('should handle RateLimitError with 429 status', async () => {
    const error = new RateLimitError('Rate limit exceeded: 100 requests per minute');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.message).toBe('Rate limit exceeded: 100 requests per minute');
  });

  it('should handle UnauthorizedError with 401 status', async () => {
    const error = new UnauthorizedError('Invalid API key');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe('UNAUTHORIZED');
    expect(body.message).toBe('Invalid API key');
  });

  it('should handle InternalError with 500 status', async () => {
    const error = new InternalError('Database connection failed');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('Database connection failed');
  });

  it('should prioritize typed error over string matching', async () => {
    // This error message contains "not found" but is a ValidationError
    const error = new ValidationError('The "not found" parameter is invalid');
    const response = errorHandler(error);
    const body = await response.json();

    // Should be 400 (ValidationError) not 404 (string match for "not found")
    expect(response.status).toBe(400);
    expect(body.error).toBe('BAD_REQUEST');
  });

  it('should still handle generic errors with string matching (backwards compatibility)', async () => {
    const error = new Error('Article not found');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('NOT_FOUND');
  });

  it('should return 500 for generic errors without matches', async () => {
    const error = new Error('Something unexpected happened');
    const response = errorHandler(error);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('INTERNAL_ERROR');
  });
});

describe('Error Discrimination', () => {
  it('should discriminate errors by kind', () => {
    const errors: TypedError[] = [
      new NotFoundError('not found'),
      new ValidationError('invalid'),
      new RateLimitError('rate limited'),
      new UnauthorizedError('unauthorized'),
      new InternalError('internal'),
    ];

    const kinds = errors.map((e) => e.kind);
    expect(kinds).toEqual([
      'NOT_FOUND',
      'VALIDATION',
      'RATE_LIMIT',
      'UNAUTHORIZED',
      'INTERNAL',
    ]);
  });

  it('should allow type narrowing in switch statements', () => {
    function getStatusMessage(error: TypedError): string {
      switch (error.kind) {
        case 'NOT_FOUND':
          return 'Resource not found';
        case 'VALIDATION':
          return 'Invalid input';
        case 'RATE_LIMIT':
          return 'Too many requests';
        case 'UNAUTHORIZED':
          return 'Authentication required';
        case 'INTERNAL':
          return 'Server error';
        default:
          // TypeScript exhaustiveness check
          const _exhaustive: never = error.kind;
          return 'Unknown error';
      }
    }

    expect(getStatusMessage(new NotFoundError('test'))).toBe('Resource not found');
    expect(getStatusMessage(new ValidationError('test'))).toBe('Invalid input');
    expect(getStatusMessage(new RateLimitError('test'))).toBe('Too many requests');
    expect(getStatusMessage(new UnauthorizedError('test'))).toBe('Authentication required');
    expect(getStatusMessage(new InternalError('test'))).toBe('Server error');
  });
});
