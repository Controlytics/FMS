import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/**/*.d.ts', 'src/e2e/test-helper.ts'],
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
