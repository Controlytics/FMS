import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// IMPORTANT: This is a fresh config — NOT derived from `vite.config.ts`. The
// dev/build config does `fs.readFileSync` on mkcert HTTPS certs at module load
// and registers VitePWA + Tailwind plugins, none of which belong in a unit-
// test runner. Keep this minimal: react-jsx transform + the `@` path alias to
// match `tsconfig.json#compilerOptions.paths`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Match vite.config.ts: resolve @digilog/shared to its TS source so tests
      // run against the same code the dev server does, not a stale dist build.
      '@digilog/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      // vite-plugin-pwa generates this module at build time (the plugin is not
      // registered here), so it cannot resolve under vitest and `vi.mock` runs too
      // late to help. A controllable stub stands in; tsc still checks against the
      // plugin's real declarations.
      'virtual:pwa-register/react': path.resolve(__dirname, './src/test-utils/pwa-register-react.ts'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      // src/test-utils/** = test infrastructure (page-harness), not application code.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**', 'src/**/*.d.ts', 'src/e2e/test-helper.ts', 'src/test-utils/**'],
    },
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
