import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      // Coverage gate (2026-10-23): `vitest run --coverage` fails below 90 % on any metric.
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
