/**
 * Vitest project for end-to-end "windows-server-stack" integration tests.
 *
 * The whole suite is gated on `INTEGRATION_TEST=1` (each test uses
 * `describe.skipIf(...)`). When the gate is unset, vitest still discovers the
 * file, registers the suites as skipped, and exits clean — so a normal
 * `npx vitest run` from the repo root reports "0 failed | N skipped" instead
 * of crashing on missing infra.
 *
 * Phase 5 of the windows-friendly rewrite (docs/plans/2026-04-29-windows-friendly-rewrite.md
 * Task 5.1) — verifies the post-rewrite stack: Mosquitto-style MQTT (via the
 * pure-JS aedes broker, same wire protocol), graphile-worker on Postgres,
 * and puppeteer-core + Edge for PDF rendering.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['*.test.ts'],
    // Reuse the API's per-file setup (loads apps/api/.env and shared JWT
    // fallbacks) so this suite picks up the same DATABASE_URL / TSDB_* /
    // JWT_SECRET the e2e tests depend on.
    setupFiles: [path.resolve(here, '../../apps/api/vitest.setup.ts')],
    // The global setup is conditionalised on INTEGRATION_TEST=1; when the
    // gate is unset it's a no-op so this project is safe to include in the
    // workspace on machines that don't have Postgres/Mosquitto.
    globalSetup: [path.resolve(here, './vitest.global-setup.ts')],
    // The MQTT round-trip + the graphile-worker poll each consume seconds
    // wall-clock; PDF cold-launch can take longer on first run.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Run integration files serially — they share the live `digilog_db`,
    // `digilog_tsdb`, the broker port range, and the puppeteer browser
    // singleton. Parallelism would just race on those.
    fileParallelism: false,
  },
});
