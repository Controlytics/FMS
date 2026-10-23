import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/**/*.d.ts', 'src/e2e/test-helper.ts'],
      // Coverage gate (operator, 2026-10-22): >= 90 % on every metric. Measured 2026-10-23
      // (full single-fork run): statements/lines 97.52, branches 94.95, functions 99.45.
      // Never lower these to pass.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    // Many integration/e2e suites share the digilog_db `admin` test user and
    // its session row. Running files in parallel makes them stomp on each
    // other's sessions. Until each suite owns its own login, run files
    // serially.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
