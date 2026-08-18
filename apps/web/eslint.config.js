// Minimal ESLint config — intentionally opt-in.
// Purpose: surface NEW `as any` casts in PRs so the 435 existing sites don't grow.
// Existing casts are left as-is (warn, not error). Run: `npx eslint "src/**/*.{ts,tsx}"`
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist', 'node_modules', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    // React Hooks linting. The app already carries inline
    // `eslint-disable-next-line react-hooks/exhaustive-deps` directives; the
    // plugin was declared-but-absent, so those referenced a missing rule and
    // errored. rules-of-hooks stays an ERROR (it catches genuine hook-ordering
    // bugs); exhaustive-deps is a WARN, consistent with this config's opt-in,
    // surface-don't-gate philosophy.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
];
