// ESLint (flat config) for the Fastify backend — opt-in, warn-not-error.
// Mirrors apps/web/eslint.config.js: the point is to surface NEW issues in a
// diff (unexpected `any`, unused vars) without failing on the large body of
// pre-existing `(err as any)` / `as any` casts the codebase already carries.
// Run:  npm run -w @digilog/api lint:js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist', 'node_modules', '**/*.d.ts', 'prisma/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      // Downgraded to warn (opt-in surfacer, not a gate): each of these is a
      // small pre-existing issue in the existing codebase. `lint:js` reports
      // them without failing the run; fix them incrementally in the files a PR
      // already touches. 12 such warnings at setup (2026-08-18).
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'prefer-const': 'warn',
      'no-irregular-whitespace': 'warn',
    },
  },
];
