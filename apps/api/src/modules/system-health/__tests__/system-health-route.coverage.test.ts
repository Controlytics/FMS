/**
 * GET /api/system-health — the degraded paths (coverage, 2026-10-21).
 *
 * e2e/system-health.test.ts covers the healthy answer against the real DB and
 * OS. What it cannot reach is what the page shows when a measurement FAILS, so
 * the three OS/DB boundaries are mocked here, each at its module boundary and
 * real by default: `node:fs/promises` statfs, `node:os` cpus, and the Prisma
 * module's $queryRawUnsafe (no model delegate is involved; the route reads only
 * raw catalogue queries). Real Fastify + the real rbac plugin answer over HTTP.
 *
 * Also: the in-memory request counter (trackRequest) that app.ts feeds from its
 * onRequest hook — the harness never calls it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const { statfsImpl, cpusImpl, rawImpl } = vi.hoisted(() => ({
  statfsImpl: vi.fn<(...a: any[]) => unknown>(() => undefined),
  cpusImpl: vi.fn<() => unknown>(() => undefined),
  rawImpl: vi.fn<(sql: string) => unknown>(() => undefined),
}));

vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>();
  const statfs = (...a: any[]) => statfsImpl(...a) ?? (real.statfs as any)(...a);
  return { ...real, statfs, default: { ...(real as any).default, statfs } };
});
vi.mock('node:os', async (orig) => {
  const real = await orig<any>();
  const base = real.default ?? real;
  const cpus = () => cpusImpl() ?? base.cpus();
  return { ...real, cpus, default: { ...base, cpus } };
});
vi.mock('../../../lib/prisma.js', () => ({
  prisma: { $queryRawUnsafe: (sql: string) => rawImpl(sql) },
}));

import rbacPlugin from '../../../plugins/rbac.js';
import systemHealthRoutes, { trackRequest, getDiskUsage } from '../routes.js';

let app: FastifyInstance;

const fakeAuth = fp(async (a: FastifyInstance) => {
  a.addHook('onRequest', async (req) => {
    const role = req.headers['x-test-role'];
    (req as any).user = typeof role === 'string' ? { sub: 'u', username: 'u', role, sessionId: 's' } : undefined;
  });
}, { name: 'auth' });

const health = (role = 'ADMIN') => app.inject({ method: 'GET', url: '/api/system-health', headers: { 'x-test-role': role } });

/** The healthy DB answers, in the order the route issues its three queries. */
function healthyDb() {
  rawImpl.mockImplementation((sql: string) => {
    if (sql.includes('pg_database_size')) return Promise.resolve([{ size: '42 MB' }]);
    if (sql.includes('pg_stat_activity')) return Promise.resolve([{ count: 7n }]);
    return Promise.resolve([{ count: 61n }]);
  });
}

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(fakeAuth);
  await app.register(rbacPlugin);
  await app.register(systemHealthRoutes, { prefix: '/api/system-health' });
  await app.ready();
}, 60_000);
afterAll(async () => { await app?.close(); }, 60_000);

beforeEach(() => {
  statfsImpl.mockReset().mockReturnValue(undefined);
  cpusImpl.mockReset().mockReturnValue(undefined);
  rawImpl.mockReset();
  healthyDb();
});

describe('access', () => {
  it('is refused to a role other than SUPER_ADMIN / ADMIN', async () => {
    const res = await health('OPERATOR');
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });

  it('answers ADMIN with the database figures the catalogue queries returned', async () => {
    const res = await health('ADMIN');
    expect(res.statusCode).toBe(200);
    expect(res.json().database).toEqual({ connected: true, databaseSize: '42 MB', activeConnections: 7, totalTables: 61 });
  });
});

describe('measurement failures are reported, never disguised as numbers', () => {
  it('a database that cannot be queried reads as disconnected with zero counts', async () => {
    rawImpl.mockImplementation(() => Promise.reject(new Error('connection refused')));
    const res = await health();
    expect(res.statusCode).toBe(200);
    expect(res.json().database).toEqual({ connected: false, databaseSize: 'unknown', activeConnections: 0, totalTables: 0 });
  });

  it('empty catalogue answers fall back to "unknown" / 0 while still connected', async () => {
    rawImpl.mockImplementation(() => Promise.resolve([]));
    const res = await health();
    expect(res.json().database).toEqual({ connected: true, databaseSize: 'unknown', activeConnections: 0, totalTables: 0 });
  });

  it('a volume that reports no size is UNAVAILABLE (null figures), not 0 %', async () => {
    statfsImpl.mockReturnValue(Promise.resolve({ blocks: 0, bsize: 4096, bavail: 0 }));
    const disk = await getDiskUsage('C:\\');
    expect(disk).toMatchObject({ available: false, total: null, used: null, free: null, usagePercent: null });
    const res = await health();
    expect(res.json().disk).toMatchObject({ available: false, totalBytes: null, usagePercent: null });
  });

  it('no CPU information reads as 0 % on model "unknown" instead of throwing', async () => {
    cpusImpl.mockReturnValue([]);
    const res = await health();
    expect(res.statusCode).toBe(200);
    expect(res.json().cpu).toEqual({ cores: 0, model: 'unknown', usagePercent: 0 });
  });
});

describe('request counter', () => {
  it('counts every tracked request, and requests-per-minute only the last minute (older than 5 min pruned)', async () => {
    const before = (await health()).json().api;
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(now - 6 * 60_000); trackRequest(); // pruned by a later call
      clock.mockReturnValue(now - 2 * 60_000); trackRequest(); // kept, but not in the last minute
      clock.mockReturnValue(now); trackRequest(); trackRequest();
    } finally {
      clock.mockRestore();
    }
    const after = (await health()).json().api;
    expect(after.totalRequests).toBe(before.totalRequests + 4);
    expect(after.requestsPerMinute).toBe(before.requestsPerMinute + 2);
  });
});
