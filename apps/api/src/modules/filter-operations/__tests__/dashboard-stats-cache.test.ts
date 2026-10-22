/**
 * P-6 (2026-10-22): GET /api/filters/dashboard-stats runs 21 whole-table
 * aggregates (4.6–6.0 s at one year, competing for the 9-connection pool) and
 * every dashboard asks for it. The answer is the same for every user, so one
 * snapshot serves everyone for 60 s, and concurrent first requests share one
 * computation. Real queries on digilog_test_db, counted with Prisma query events.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { FilterOperationsService } from '../filter-operations.service.js';

const service = new FilterOperationsService();
const ctx = { userId: 'dash', userSub: 'dash', userRole: 'ADMIN', ipAddress: '127.0.0.1', sessionId: 'dash' };

let capturing = false;
let queries = 0;
prisma.$on('query' as never, () => { if (capturing) queries++; });
async function counted<T>(fn: () => Promise<T>): Promise<{ value: T; queries: number }> {
  queries = 0; capturing = true;
  try { return { value: await fn(), queries }; } finally { capturing = false; }
}

afterEach(() => { vi.restoreAllMocks(); });

describe('P-6 — dashboard-stats is computed at most once per 60 s', () => {
  it('a second request within 60 s reads no table and answers the same snapshot', async () => {
    const t0 = Date.now() + 10 * 60_000;          // clear of any snapshot an earlier test left
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    const first = await counted(() => service.getDashboardStats(ctx));
    expect(first.queries).toBeGreaterThan(10);
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 59_000);
    const second = await counted(() => service.getDashboardStats(ctx));
    expect(second.queries).toBe(0);
    expect(second.value).toEqual(first.value);
  });

  it('after 60 s the next request recomputes', async () => {
    const t0 = Date.now() + 20 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(t0);
    await service.getDashboardStats(ctx);
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 60_001);
    const again = await counted(() => service.getDashboardStats(ctx));
    expect(again.queries).toBeGreaterThan(10);
  });

  it('concurrent first requests share one computation', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30 * 60_000);
    const one = await counted(async () => {
      await service.getDashboardStats(ctx);
      return queries;
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 40 * 60_000);
    const three = await counted(() => Promise.all([service.getDashboardStats(ctx), service.getDashboardStats(ctx), service.getDashboardStats(ctx)]));
    expect(three.queries).toBe(one.queries);
  });
});
