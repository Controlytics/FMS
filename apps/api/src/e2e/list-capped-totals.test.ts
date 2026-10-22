/**
 * "10,000+" list totals (operator decision 2026-10-22).
 *
 * An exact COUNT over the whole audit trail (7.4 M rows at one year) took 68–73 s
 * cold, and over filter_events (6.2 M) 17 s, for a page whose rows come back in
 * milliseconds. The audit list and the filter events list now count up to a cap:
 * past it they answer `total: <cap>, totalCapped: true`, and the pager keeps
 * offering the next page while the current one is full. Below the cap the total
 * is exact. An export asks for `exactTotal=true` on the audit list, which counts
 * exactly (it must know the real size to refuse an over-limit export).
 *
 * The cap is 10,000 in production; here it is 3 (the helper's own cap argument),
 * so a handful of owned rows reaches it. Audit rows stay behind by design
 * (audit_trail_no_delete); they are scoped by a fresh targetId.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

vi.mock('../lib/capped-count.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/capped-count.js')>();
  return { ...actual, cappedCount: (count: (take: number) => Promise<number>) => actual.cappedCount(count, 3) };
});

import { buildApp } from './test-helper.js';
import { auditLog } from '../lib/audit.js';
import filterEventsRoutes from '../modules/filter-operations/events-routes.js';
import { FoFixture } from '../modules/filter-operations/__tests__/support/fo-fixtures.js';

const fx = new FoFixture('CAP');
let app: FastifyInstance;
let headers: Record<string, string>;
let filterId: string;
const target = randomUUID();

beforeAll(async () => {
  app = await buildApp([{ plugin: filterEventsRoutes, prefix: '/api/filters' }]); // audit routes are built in
  const role = await fx.role('RD', ['AUDIT_READ', 'ASSET_READ', 'EVENT_READ']);
  const u = await fx.user('reader', role);
  headers = await fx.login(app, u.username);

  for (let i = 0; i < 5; i++) {
    await auditLog({
      userId: u.username, userRole: role, action: 'CONFIG_UPDATED', targetType: 'CAP_TEST', targetId: target,
      afterValue: { i },
    } as any);
  }
  const ahu = await fx.node('AHU', 'AHU');
  filterId = await fx.filter('F', ahu, null);
  for (let i = 0; i < 5; i++) {
    await fx.rawEvent({ filterId, eventType: 'REMARK_ADDED', performedBy: u.id, performedAt: new Date(Date.now() - i * 60_000) });
  }
}, 60_000);

afterAll(async () => {
  await fx.cleanup();
  await app?.close();
});

const get = (url: string) => app.inject({ method: 'GET', url, headers });

describe('audit list — capped total', () => {
  it('past the cap: total = cap, totalCapped, and the pager reaches the next page while pages are full', async () => {
    const r = await get(`/api/audit?targetId=${target}&limit=2&page=1`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: 3, totalCapped: true, page: 1, limit: 2, totalPages: 2 });

    // Page 3 lies past the cap (rows 5–6 of a capped "3"): it is still served,
    // and a short page ends the paging.
    const p3 = await get(`/api/audit?targetId=${target}&limit=2&page=3`);
    expect(p3.json().data).toHaveLength(1);
    expect(p3.json()).toMatchObject({ totalCapped: true, totalPages: 3 });

    const p2 = await get(`/api/audit?targetId=${target}&limit=2&page=2`);
    expect(p2.json()).toMatchObject({ totalCapped: true, totalPages: 3 }); // full page 2 → page 3 offered
  });

  it('exactTotal=true counts exactly (exports must know the real size)', async () => {
    const r = await get(`/api/audit?targetId=${target}&limit=2&exactTotal=true`);
    expect(r.json()).toMatchObject({ total: 5, totalCapped: false, totalPages: 3 });
  });

  it('below the cap the total is exact and not capped', async () => {
    const r = await get(`/api/audit?targetId=${randomUUID()}&limit=2`);
    expect(r.json()).toMatchObject({ total: 0, totalCapped: false, totalPages: 0 });
  });
});

describe('filter events list — capped total', () => {
  it('past the cap: total = cap and totalCapped; exact below it', async () => {
    const r = await get(`/api/filters/events?filterId=${filterId}&limit=2`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ total: 3, totalCapped: true });
    expect(r.json().data).toHaveLength(2);

    const one = await get(`/api/filters/events?filterId=${filterId}&eventType=CYCLE_STARTED&limit=2`);
    expect(one.json()).toMatchObject({ total: 0, totalCapped: false });
  });
});
