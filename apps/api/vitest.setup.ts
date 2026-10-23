// Per-worker setup. All logic (dotenv load, digilog_test_db redirect, JWT
// secrets) lives in the shared bootstrap so it stays identical to the
// global-setup context. Imported for its side effects only.
import './vitest.env.js';

// Close this test file's Prisma pool when the file ends (2026-10-23). The
// suite runs every file in ONE process (singleFork) and isolates modules per
// file, so each file builds its own PrismaClient from lib/prisma; never
// disconnected, the pools piled up until Postgres refused new connections
// ("remaining connection slots are reserved", max_connections 100) and
// unrelated files failed mid-run. A file that mocks lib/prisma gets its
// mock here, hence the optional call.
afterAll(async () => {
  const mod = await import('./src/lib/prisma.js');
  await (mod.prisma as { $disconnect?: () => Promise<void> })?.$disconnect?.();
});

// No test file may leave the process in another time zone (2026-10-23). The
// suite runs single-fork, so a zone a file sets and does not put back changes
// every later file's dates: helpers.test.ts set TZ at module top and never
// restored it, and pm-import-guards.test.ts "restored" with `delete
// process.env.TZ`, which does not reset Node's zone — date-range-guard.test.ts
// then ran in New York. Pin with src/lib/__tests__/pin-time-zone.ts. The zone
// in force when the run started is kept in the environment, which outlives the
// per-file module isolation.
process.env.VITEST_START_TIME_ZONE ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
afterAll(() => {
  const now = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (now !== process.env.VITEST_START_TIME_ZONE) {
    throw new Error(`This test file left the time zone at ${now} (the run started in ${process.env.VITEST_START_TIME_ZONE}). Use pinTimeZone() and its restore.`);
  }
});
