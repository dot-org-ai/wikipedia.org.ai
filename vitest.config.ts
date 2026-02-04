import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/types.ts'],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 60,
        lines: 60,
      },
    },
    testTimeout: 30000,  // Some tests may download data
    // Pool settings for better isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    // Retry failed tests once
    retry: 1,
  }
})
