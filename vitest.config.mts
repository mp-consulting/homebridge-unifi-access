import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/**/*.{test,spec}.ts',
      'test/**/*.{test,spec}.ts',
    ],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**'],
      reporter: ['text', 'text-summary', 'lcov'],

      // A ratchet against regressions: keep these just under the current coverage, and raise them as coverage improves.
      thresholds: {
        branches: 75,
        functions: 82,
        lines: 85,
        statements: 85,
      },
    },
  },
  oxc: {
    target: 'es2022',
  },
});
