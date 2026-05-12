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
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['dist/**', 'node_modules/**'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
