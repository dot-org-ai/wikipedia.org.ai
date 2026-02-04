/**
 * Global test setup for Vitest
 *
 * This file is automatically loaded before all tests.
 */

import { beforeAll, afterAll, vi } from 'vitest';

// Extend global types for test utilities
declare global {
  // Add any global test utilities here
}

// Set up global mocks
beforeAll(() => {
  // Mock console.error to reduce noise in tests (optional)
  // vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Export nothing - this is just for side effects
export {};
