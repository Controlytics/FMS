// Mutation testing only (Stryker). DB-FREE unit tests of the security-critical
// libraries: no globalSetup (it writes digilog_test_db), so Stryker's parallel
// mutant runs never touch a database. The normal suite uses vitest.config.ts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/lib/hash-chain.test.ts',
      'src/lib/__tests__/audit-verify-legacy-key-order.test.ts',
      'src/lib/ssrf.test.ts',
      'src/lib/__tests__/ssrf-host.test.ts',
      'src/lib/rate-limit-key.test.ts',
      'src/lib/reauth-check.test.ts',
      'src/plugins/__tests__/rbac.plugin.test.ts',
    ],
    testTimeout: 30000,
  },
});
