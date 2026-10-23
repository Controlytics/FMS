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
