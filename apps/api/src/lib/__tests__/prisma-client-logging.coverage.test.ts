/**
 * lib/prisma.ts — the database log channel (log type 4): the boot probe, the
 * slow-query threshold, Prisma's own warn/error events, and the shutdown line.
 *
 * Each case imports a FRESH copy of the module (its own PrismaClient) so the
 * env-driven constants are re-read; DATABASE_URL is never touched — the fresh
 * client talks to digilog_test_db exactly like the shared one. The failure
 * paths (database unreachable, disconnect error) replace only the
 * @prisma/client constructor, since producing a real outage would take the
 * database away from every other suite. What is asserted is what lands on the
 * log (stdout under vitest) and what the functions return.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, type MockInstance } from 'vitest';

const ENV_KEYS = ['SLOW_QUERY_MS', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];
const restore = () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

type PrismaModule = typeof import('../prisma.js');
async function fresh(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): Promise<PrismaModule> {
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.resetModules();
  try { return await import('../prisma.js'); } finally { restore(); }
}

let stdout: MockInstance<typeof process.stdout.write>;
const printed = () => stdout.mock.calls.map((c) => String(c[0])).join('');
const live: PrismaModule[] = [];

beforeAll(() => { stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true); });
afterEach(() => { stdout.mockClear(); vi.doUnmock('@prisma/client'); });
afterAll(async () => {
  for (const m of live) await m.prisma.$disconnect();
  stdout.mockRestore();
}, 60_000);

describe('real client', () => {
  it('logs the database it reached at boot, with the slow-query threshold', async () => {
    const m = await fresh({ SLOW_QUERY_MS: '250', NODE_ENV: 'development' });
    live.push(m);
    expect(await m.logDatabaseConnection()).toBe(true);
    const out = printed();
    expect(out).toContain('[prisma]  Database connected (digilog_test_db)');
    expect(out).toContain('database=digilog_test_db');
    expect(out).toContain('slowQueryThresholdMs=250');
    expect(out).toMatch(/server="PostgreSQL /);
  });

  it('logs a query slower than SLOW_QUERY_MS as a warning, and not a fast one', async () => {
    const m = await fresh({ SLOW_QUERY_MS: '40', NODE_ENV: 'development' });
    live.push(m);
    await m.prisma.$queryRaw`SELECT 1 AS fast`;
    expect(printed()).not.toContain('Slow query');
    await m.prisma.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.1)`;
    // The query event fires after the result; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    const out = printed();
    expect(out).toMatch(/WARN {3}\[prisma\] {2}Slow query \(\d+ms\)/);
    expect(out).toContain('pg_sleep');
  });

  it('ignores a non-numeric SLOW_QUERY_MS and falls back to 500 ms', async () => {
    const m = await fresh({ SLOW_QUERY_MS: 'fast-please', NODE_ENV: 'development' });
    live.push(m);
    await m.logDatabaseConnection();
    expect(printed()).toContain('slowQueryThresholdMs=500');
  });

  it('records a clean disconnect', async () => {
    const m = await fresh({ NODE_ENV: 'development' });
    await m.prisma.$queryRaw`SELECT 1`;
    await m.disconnectDatabase();
    expect(printed()).toContain('Database disconnected cleanly');
  });
});

describe('client stand-in (failure paths and the production log definition)', () => {
  function fakeClient(opts: { queryRaw?: () => Promise<unknown>; disconnect?: () => Promise<void> } = {}) {
    const handlers: Record<string, (e: any) => void> = {};
    const ctorArgs: any[] = [];
    class PrismaClient {
      constructor(args: unknown) { ctorArgs.push(args); }
      $on(event: string, fn: (e: any) => void) { handlers[event] = fn; }
      $queryRaw() { return (opts.queryRaw ?? (async () => [{ db: 'x', usr: 'y', version: 'PostgreSQL 18.0 on x86' }]))(); }
      $disconnect() { return (opts.disconnect ?? (async () => undefined))(); }
    }
    vi.doMock('@prisma/client', () => ({ PrismaClient }));
    return { handlers, ctorArgs };
  }

  it('returns false and says what to check when the database is unreachable', async () => {
    fakeClient({ queryRaw: async () => { throw new Error("Can't reach database server at localhost:5432"); } });
    const m = await fresh({ NODE_ENV: 'development' });
    expect(await m.logDatabaseConnection()).toBe(false);
    const out = printed();
    expect(out).toContain('DATABASE CONNECTION FAILED');
    expect(out).toContain('DigiLogDB service is running');
    expect(out).toContain("Can't reach database server");
  });

  it('logs, without throwing, a disconnect that fails', async () => {
    fakeClient({ disconnect: async () => { throw new Error('engine already stopped'); } });
    const m = await fresh({ NODE_ENV: 'development' });
    await expect(m.disconnectDatabase()).resolves.toBeUndefined();
    expect(printed()).toContain('Error while disconnecting from database');
  });

  it("routes Prisma's own warn / error events to the database channel", async () => {
    const { handlers } = fakeClient();
    await fresh({ NODE_ENV: 'development' });
    handlers.warn({ target: 'quaint::pool', message: 'pool nearly exhausted' });
    handlers.error({ target: 'quaint::connector', message: 'connection reset by peer' });
    const out = printed();
    expect(out).toMatch(/WARN {3}\[prisma\] {2}pool nearly exhausted/);
    expect(out).toContain('target=quaint::pool');
    expect(out).toMatch(/ERROR {2}\[prisma\] {2}connection reset by peer/);
  });

  it('in production subscribes to warn + error only (no per-query events)', async () => {
    const { handlers, ctorArgs } = fakeClient();
    await fresh({ NODE_ENV: 'production' });
    expect(ctorArgs[0]).toEqual({ log: [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }] });
    expect(Object.keys(handlers).sort()).toEqual(['error', 'warn']);
  });

  it('outside production also subscribes to query events', async () => {
    const { handlers, ctorArgs } = fakeClient();
    await fresh({ NODE_ENV: 'development' });
    expect(ctorArgs[0].log).toContainEqual({ level: 'query', emit: 'event' });
    expect(Object.keys(handlers).sort()).toEqual(['error', 'query', 'warn']);
  });
});
