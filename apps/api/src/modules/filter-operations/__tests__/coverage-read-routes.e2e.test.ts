/**
 * Filter-operations READ surface + the manual lifecycle path (coverage suite,
 * 2026-10-21).
 *
 * Routes, through the real Fastify app (production error handler) and real
 * Prisma on digilog_test_db:
 *   GET  /api/filters/events | /cycles | /cleaning-record | /manual-status-changes
 *   GET  /api/filters/cycles/:id | /dashboard-stats | /reasons | /field-options
 *   GET  /api/filters/:id/stage-options
 *   GET  /api/filters/retirements | /replacements   (+ POST /:id/retire, /:id/replace)
 *   PATCH /api/assets/instances/:id/lifecycle-state  (stage-rules.ts + manual-cycle.ts)
 *
 * Isolation: every list assertion is scoped to this file's own filters (by
 * filterId or by an ancestor this file owns) — membership, never ambient
 * counts. No shared system_config row is written. Some cycles/events are
 * inserted directly (fo-fixtures rawCycle/rawEvent) because the row shape under
 * test — an event by a since-deleted user, a cycle pinned to a checklist
 * version, a retired filter with no audit row — is no longer produced by any
 * route but is present in live data and still has to render.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterOperationsRoutes from '../routes.js';
import filterEventsRoutes from '../events-routes.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('FOR');
let app: FastifyInstance;
let sa: { id: string; username: string };
let saH: Record<string, string>;
let viewer: { id: string; username: string };
let viewerH: Record<string, string>;
let opsH: Record<string, string>;
let ops: { id: string; username: string };

// Hierarchy: B1 → A1 → AHU1 (area path) and B1 → AHU2 (direct), AHU3 empty.
let B1 = ''; let A1 = ''; let AHU1 = ''; let AHU2 = ''; let AHU3 = '';
let FP = ''; let CP = '';
let F1 = ''; let F2 = ''; let F3 = '';
const extraFilterIds: string[] = [];
const ghostUser = randomUUID(); // a performer that is not (or no longer) a user

const inject = (method: 'GET' | 'POST' | 'PATCH', url: string, headers: Record<string, string>, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
const get = (url: string, h = saH) => inject('GET', url, h);

beforeAll(async () => {
  app = await buildApp([
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
    { plugin: filterEventsRoutes, prefix: '/api/filters' },
  ]);
  sa = await fx.user('sa', 'SUPER_ADMIN');
  const viewRole = await fx.role('VIEW', ['ASSET_READ', 'EVENT_READ', 'CYCLE_READ']);
  viewer = await fx.user('view', viewRole);
  const opsRole = await fx.role('OPS', ['ASSET_READ', 'FILTER_REPLACE', 'FILTER_RETIRE']);
  ops = await fx.user('ops', opsRole);

  B1 = await fx.node('BLOCK', 'B1');
  A1 = await fx.node('AREA', 'A1', B1);
  AHU1 = await fx.node('AHU', 'AHU1', A1);
  AHU2 = await fx.node('AHU', 'AHU2', B1);
  AHU3 = await fx.node('AHU', 'AHU3', B1);
  ({ cleaningProfileId: CP, filterProfileId: FP } = await fx.pipeline({ name: 'RD', stages: ['WASH_IN', 'WASH_OUT', 'STORAGE_IN'] }, sa.id));
  F1 = await fx.filter('F1', AHU1, FP, { filterSet: 'SET_A' });
  F2 = await fx.filter('F2', AHU1, FP);
  F3 = await fx.filter('F3', AHU2, FP, { filterSet: 'SET_B' });

  saH = await fx.login(app, sa.username);
  viewerH = await fx.login(app, viewer.username);
  opsH = await fx.login(app, ops.username);
}, 60_000);

afterAll(async () => {
  try { await fx.cleanup({ filterIds: extraFilterIds }); } finally { await app?.close(); }
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('GET /api/filters/events', () => {
  let cycleId = '';
  const t0 = new Date(Date.now() - 3 * 3600_000);
  beforeAll(async () => {
    const c = await fx.rawCycle(F1, CP, { status: 'COMPLETED', startedAt: t0 });
    cycleId = c.id;
    await fx.rawEvent({ filterId: F1, cycleId, eventType: 'CYCLE_STARTED', performedBy: sa.id, performedAt: t0 });
    await fx.rawEvent({ filterId: F1, cycleId, eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedBy: sa.id, performedAt: new Date(t0.getTime() + 60_000) });
    await fx.rawEvent({ filterId: F3, eventType: 'REMARK_ADDED', performedBy: sa.id, performedAt: t0 });
  }, 60_000);

  it('lists only the requested filter, paged, newest first', async () => {
    const res = await get(`/api/filters/events?filterId=${F1}&limit=1&page=2`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].eventType).toBe('CYCLE_STARTED'); // page 2 of desc order = the older one
    expect(body.data[0].filterId).toBe(F1);
  });

  it('resolves an AHU to the events of the filters under it (and only those)', async () => {
    const res = await get(`/api/filters/events?ahuId=${AHU1}&limit=50`);
    expect(res.statusCode).toBe(200);
    const ids = new Set(res.json().data.map((e: any) => e.filterId));
    expect(ids.has(F1)).toBe(true);
    expect(ids.has(F3)).toBe(false);
  });

  it('an AHU with no filters returns nothing, not every event', async () => {
    const res = await get(`/api/filters/events?ahuId=${AHU3}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], total: 0 });
  });

  it('filters by cycle, type and time window together', async () => {
    const from = new Date(t0.getTime() + 30_000).toISOString();
    const to = new Date(t0.getTime() + 120_000).toISOString();
    const res = await get(`/api/filters/events?filterId=${F1}&cycleId=${cycleId}&eventType=STATE_TRANSITION&from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((e: any) => e.toState)).toEqual(['WASH_IN']);
  });

  it('a to-only window keeps the earlier events', async () => {
    const res = await get(`/api/filters/events?filterId=${F1}&to=${new Date(t0.getTime() + 1000).toISOString()}`);
    expect(res.json().data.map((e: any) => e.eventType)).toEqual(['CYCLE_STARTED']);
  });

  it('an unknown filterId is 404, not an empty page', async () => {
    const res = await get(`/api/filters/events?filterId=${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('an unknown eventType is a 400 client error, not a 500', async () => {
    const res = await get(`/api/filters/events?filterId=${F1}&eventType=NOT_AN_EVENT`);
    expect(res.statusCode).toBe(400);
    expect(internalErrors).toEqual([]);
  });

  it('needs EVENT_READ', async () => {
    const role = await fx.role('NOEV', ['ASSET_READ']);
    const u = await fx.user('noev', role);
    const h = await fx.login(app, u.username);
    expect((await get(`/api/filters/events?filterId=${F1}`, h)).statusCode).toBe(403);
  });
});

describe('GET /api/filters/cycles?ahuId — the cycles of the filters under one AHU (2026-10-22)', () => {
  it('lists and counts only the filters of that AHU; an AHU with no filters lists nothing', async () => {
    const mine = [await fx.rawCycle(F1, CP, { status: 'COMPLETED' }), await fx.rawCycle(F2, CP, { status: 'COMPLETED' })];
    const other = await fx.rawCycle(F3, CP, { status: 'COMPLETED' });
    const res = await get(`/api/filters/cycles?ahuId=${AHU1}&limit=1000`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.data.map((c: any) => c.id);
    for (const c of mine) expect(ids).toContain(c.id);
    expect(ids).not.toContain(other.id);
    expect(body.data.every((c: any) => c.filterId === F1 || c.filterId === F2)).toBe(true);
    expect(body.total).toBe(body.data.length);
    expect((await get(`/api/filters/cycles?ahuId=${AHU3}`)).json()).toMatchObject({ data: [], total: 0 });
  });
});

describe('GET /api/filters/cycles — effective-status mapping and enrichment', () => {
  let FC = '';
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    FC = await fx.filter('FC', AHU2, FP, { filterSet: 'SET_B' });
    const base = Date.now() - 10 * 3600_000;
    ids.completed = (await fx.rawCycle(FC, CP, { status: 'COMPLETED', startedAt: new Date(base), cleaningAreaId: B1 })).id;
    ids.retired = (await fx.rawCycle(FC, CP, { status: 'TERMINATED', terminationReason: 'RETIRED', startedAt: new Date(base + 1000) })).id;
    ids.replaced = (await fx.rawCycle(FC, CP, { status: 'TERMINATED', terminationReason: 'REPLACED', startedAt: new Date(base + 2000) })).id;
    ids.plainNull = (await fx.rawCycle(FC, CP, { status: 'TERMINATED', terminationReason: null, startedAt: new Date(base + 3000) })).id;
    ids.plainText = (await fx.rawCycle(FC, CP, { status: 'TERMINATED', terminationReason: 'operator abort', startedAt: new Date(base + 4000) })).id;
    ids.breakdown = (await fx.rawCycle(FC, CP, { status: 'IN_PROGRESS', completedAt: null, reasonKey: 'BREAKDOWN', reasonLabel: 'Breakdown', startedAt: new Date(base + 5000) })).id;
    // Completed cycle: last stage by the SA, closed by a user that no longer exists.
    await fx.rawEvent({ filterId: FC, cycleId: ids.completed, eventType: 'STATE_TRANSITION', toState: 'STORAGE_IN', performedBy: sa.id, performedAt: new Date(base + 100) });
    await fx.rawEvent({ filterId: FC, cycleId: ids.completed, eventType: 'CYCLE_COMPLETED', performedBy: ghostUser, performedAt: new Date(base + 200) });
  }, 60_000);

  const statuses = async (q: string) => {
    const res = await get(`/api/filters/cycles?filterId=${FC}&limit=50${q}`);
    expect(res.statusCode).toBe(200);
    return new Set(res.json().data.map((c: any) => c.id));
  };

  it('RETIRED and REPLACED select terminated cycles by their reason', async () => {
    expect(await statuses('&status=RETIRED')).toEqual(new Set([ids.retired]));
    expect(await statuses('&status=REPLACED')).toEqual(new Set([ids.replaced]));
  });

  it('TERMINATED excludes RETIRED/REPLACED but keeps null and free-text reasons', async () => {
    expect(await statuses('&status=TERMINATED')).toEqual(new Set([ids.plainNull, ids.plainText]));
  });

  it('a plain status and a reason key filter as given', async () => {
    expect(await statuses('&status=IN_PROGRESS')).toEqual(new Set([ids.breakdown]));
    expect(await statuses('&cleaningReasonKey=BREAKDOWN')).toEqual(new Set([ids.breakdown]));
  });

  it('a started-at window applies to both ends', async () => {
    const all = await get(`/api/filters/cycles?filterId=${FC}&limit=50`);
    const completed = all.json().data.find((c: any) => c.id === ids.completed);
    const from = new Date(new Date(completed.startedAt).getTime() - 1).toISOString();
    const to = new Date(new Date(completed.startedAt).getTime() + 1).toISOString();
    expect(await statuses(`&from=${from}&to=${to}`)).toEqual(new Set([ids.completed]));
  });

  it('names the filter, set, area, profile stages and both performers; falls back to the raw id for a deleted user', async () => {
    const res = await get(`/api/filters/cycles?filterId=${FC}&limit=50&includeEvents=true`);
    const row = res.json().data.find((c: any) => c.id === ids.completed);
    expect(row.filterName).toContain('-FC-');
    expect(row.filterSet).toBe('SET_B');
    expect(row.cleaningAreaName).toContain('-B1-');
    expect(row.profileStages).toEqual(['WASH_IN', 'WASH_OUT', 'STORAGE_IN']);
    expect(row.lastStageByUsername).toBe(sa.username);
    expect(row.lastStageBy).toBe(sa.id);
    expect(row.completedBy).toBe(ghostUser);
    expect(row.completedByName).toBeNull();
    expect(row.completedByUsername).toBeNull();
    const ev = row.events.find((e: any) => e.eventType === 'STATE_TRANSITION');
    expect(ev.performedByName).toBe(sa.username);
    expect(row.events.find((e: any) => e.eventType === 'CYCLE_COMPLETED').performedByName).toBeNull();
    // A cycle with no events and no area carries nulls, not undefined.
    const open = res.json().data.find((c: any) => c.id === ids.breakdown);
    expect(open).toMatchObject({ cleaningAreaName: null, completedBy: null, lastStageBy: null, completedByName: null });
  });

  it('a page with no cycles answers an empty list without enrichment queries failing', async () => {
    const empty = await fx.filter('FEMPTY', AHU3, FP);
    const res = await get(`/api/filters/cycles?filterId=${empty}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], total: 0, totalPages: 0 });
  });
});

describe('PATCH /api/assets/instances/:id/lifecycle-state — manual moves obey the profile (stage-rules + manual-cycle)', () => {
  let FM = '';
  const patch = (id: string, body: Record<string, unknown>) =>
    inject('PATCH', `/api/assets/instances/${id}/lifecycle-state`, saH, { remarks: 'manual coverage move', _currentPassword: fx.password, ...body });

  beforeAll(async () => { FM = await fx.filter('FM', AHU1, FP); }, 60_000);

  it('a cleaning-stage move with no cycle needs a reason (REASON_REQUIRED)', async () => {
    const res = await patch(FM, { lifecycleState: 'WASH_IN' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('REASON_REQUIRED');
  });

  it('an unknown reason is refused (INVALID_REASON)', async () => {
    const res = await patch(FM, { lifecycleState: 'WASH_IN', cleaningReasonKey: 'NOPE' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_REASON');
  });

  it('a reason that needs justification refuses a short one (JUSTIFICATION_REQUIRED)', async () => {
    const res = await patch(FM, { lifecycleState: 'WASH_IN', cleaningReasonKey: 'BREAKDOWN', cleaningJustification: 'short' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('JUSTIFICATION_REQUIRED');
    expect(await prisma.cleaningCycle.count({ where: { filterId: FM } })).toBe(0);
  });

  it('START: the first stage opens a manual (-M) cycle and records the move on it', async () => {
    const res = await patch(FM, { lifecycleState: 'WASH_IN', cleaningReasonKey: 'BREAKDOWN', cleaningJustification: 'pressure drop observed on gauge' });
    expect(res.statusCode).toBe(200);
    const cycles = await prisma.cleaningCycle.findMany({ where: { filterId: FM } });
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycleCode.endsWith('-M')).toBe(true);
    expect(cycles[0]).toMatchObject({ status: 'IN_PROGRESS', cleaningReasonKey: 'BREAKDOWN', cleaningJustification: 'pressure drop observed on gauge', profileId: CP });
    const fd = await prisma.filterDetails.findUnique({ where: { assetInstanceId: FM } });
    expect(fd).toMatchObject({ currentCycleId: cycles[0].id, currentLifecycleState: 'WASH_IN' });
    const started = await prisma.filterEvent.findFirst({ where: { cycleId: cycles[0].id, eventType: 'CYCLE_STARTED' } });
    expect((started!.attributes as any).manual).toBe(true);
    const moved = await prisma.filterEvent.findFirst({ where: { cycleId: cycles[0].id, eventType: 'STATE_TRANSITION' } });
    expect(moved).toMatchObject({ fromState: null, toState: 'WASH_IN' });
  });

  it('SKIP: jumping past the next stage is refused and names the allowed next stage', async () => {
    const res = await patch(FM, { lifecycleState: 'STORAGE_IN' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Invalid stage movement');
    expect(res.json().message).toContain('Wash Out');
  });

  it('FORWARD: the immediate next stage moves on the same cycle', async () => {
    const res = await patch(FM, { lifecycleState: 'WASH_OUT' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.cleaningCycle.count({ where: { filterId: FM } })).toBe(1);
    expect((await prisma.filterDetails.findUnique({ where: { assetInstanceId: FM } }))!.currentLifecycleState).toBe('WASH_OUT');
  });

  it('stage-options mid-cycle: back = restart, next = forward, later = skip, current = same', async () => {
    const res = await get(`/api/filters/${FM}/stage-options`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ hasProfile: true, hasActiveCycle: true, currentStage: 'WASH_OUT', immediateNext: ['STORAGE_IN'] });
    const by = Object.fromEntries(body.options.map((o: any) => [o.state, o]));
    expect(by.WASH_IN).toMatchObject({ classification: 'BACKWARD', allowed: true, startsCycle: true });
    expect(by.WASH_OUT).toMatchObject({ classification: 'SAME', isCurrent: true, startsCycle: false });
    expect(by.STORAGE_IN).toMatchObject({ classification: 'FORWARD', allowed: true, startsCycle: false });
    expect(by.CLEANING_CYCLE_COMPLETED).toMatchObject({ classification: 'COMPLETE', startsCycle: false });
    expect(body.cleaningReasons.map((r: any) => r.key)).toEqual(['ROUTINE', 'BREAKDOWN']);
  });

  it('BACKWARD with an active cycle breaks it (TERMINATED, broken) and starts cycle 2', async () => {
    const first = (await prisma.filterDetails.findUnique({ where: { assetInstanceId: FM } }))!.currentCycleId!;
    const res = await patch(FM, { lifecycleState: 'WASH_IN', cleaningReasonKey: 'ROUTINE' });
    expect(res.statusCode).toBe(200);
    const old = await prisma.cleaningCycle.findUnique({ where: { id: first } });
    expect(old!.status).toBe('TERMINATED');
    const term = await prisma.filterEvent.findFirst({ where: { cycleId: first, eventType: 'CYCLE_TERMINATED' } });
    expect(term!.attributes).toMatchObject({ manual: true, broken: true });
    const fd = await prisma.filterDetails.findUnique({ where: { assetInstanceId: FM } });
    expect(fd!.currentCycleId).not.toBe(first);
    const second = await prisma.cleaningCycle.findUnique({ where: { id: fd!.currentCycleId! } });
    expect(second).toMatchObject({ sequenceNumber: 2, status: 'IN_PROGRESS', cleaningReasonKey: 'ROUTINE', cleaningJustification: null });
  });

  it('COMPLETE force-completes the active cycle and frees the filter', async () => {
    const cycleId = (await prisma.filterDetails.findUnique({ where: { assetInstanceId: FM } }))!.currentCycleId!;
    const res = await patch(FM, { lifecycleState: 'CLEANING_CYCLE_COMPLETED' });
    expect(res.statusCode).toBe(200);
    expect((await prisma.cleaningCycle.findUnique({ where: { id: cycleId } }))!.status).toBe('COMPLETED');
    const done = await prisma.filterEvent.findFirst({ where: { cycleId, eventType: 'CYCLE_COMPLETED' } });
    expect((done!.attributes as any).manualForceComplete).toBe(true);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: FM } })).toMatchObject({ currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' });
  });

  it('stage-options with no cycle: the first stage starts one, later stages are skips', async () => {
    const fresh = await fx.filter('FSO', AHU1, FP);
    const body = (await get(`/api/filters/${fresh}/stage-options`)).json();
    expect(body).toMatchObject({ hasProfile: true, hasActiveCycle: false, currentStage: null, orderedStages: ['WASH_IN', 'WASH_OUT', 'STORAGE_IN'] });
    const by = Object.fromEntries(body.options.map((o: any) => [o.state, o]));
    expect(by.WASH_IN).toMatchObject({ classification: 'START', allowed: true, startsCycle: true });
    expect(by.WASH_OUT).toMatchObject({ classification: 'SKIP', allowed: false, startsCycle: false });
  });

  it('stage-options for an unknown filter answers "no profile" with only the completion option', async () => {
    const body = (await get(`/api/filters/${randomUUID()}/stage-options`)).json();
    expect(body).toMatchObject({ hasProfile: false, hasActiveCycle: false, orderedStages: [], cleaningReasons: [] });
    expect(body.options).toEqual([{ state: 'CLEANING_CYCLE_COMPLETED', classification: 'COMPLETE', allowed: true, isCurrent: false, startsCycle: false }]);
  });

  it('a manual lifecycle move on an AHU id is refused and opens no cycle', async () => {
    const ahu = await fx.node('AHU', 'PROBEAHU', B1);
    const res = await patch(ahu, { lifecycleState: 'WASH_IN', cleaningReasonKey: 'ROUTINE' });
    expect(res.statusCode).toBe(404);
    expect(await prisma.cleaningCycle.count({ where: { filterId: ahu } })).toBe(0);
    expect(await prisma.filterEvent.count({ where: { filterId: ahu } })).toBe(0);
    expect(await prisma.filterDetails.count({ where: { assetInstanceId: ahu } })).toBe(0);
  });
});

describe('GET /api/filters/manual-status-changes + /cleaning-record (merged cycles and manual rows)', () => {
  let FR = ''; let FS = '';
  let manualId = ''; let cycleId = '';
  const base = Date.now() - 6 * 3600_000;
  beforeAll(async () => {
    // FR has no cycles, so a manual NON-CLEANING move is a stand-alone manual row.
    FR = await fx.filter('FR', AHU1, FP);
    const res = await inject('PATCH', `/api/assets/instances/${FR}/lifecycle-state`, saH,
      { lifecycleState: 'INSTALLED', remarks: 'installed on site', _currentPassword: fx.password });
    expect(res.statusCode).toBe(200);
    manualId = (await prisma.filterEvent.findFirst({ where: { filterId: FR, eventType: 'STATE_TRANSITION' } }))!.id;
    cycleId = (await fx.rawCycle(FR, CP, { status: 'COMPLETED', startedAt: new Date(base), reasonKey: 'BREAKDOWN', reasonLabel: 'Breakdown' })).id;
    await fx.rawEvent({ filterId: FR, cycleId, eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedBy: sa.id, performedAt: new Date(base + 1000) });
    // A manual row by a user that no longer exists (live data: deleted in the 2026-08-19 wipe).
    FS = await fx.filter(`FSRCH${fx.tag}`, AHU2, FP);
    await fx.rawEvent({ filterId: FS, eventType: 'STATE_TRANSITION', toState: 'IN_USE', performedBy: ghostUser, performedAt: new Date(base - 1000), attributes: { manual: true } });
  }, 60_000);

  it('manual-status-changes names the filter, the performer username and the profile stage order', async () => {
    const res = await get(`/api/filters/manual-status-changes?filterId=${FR}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({ id: manualId, toState: 'INSTALLED', performedByName: sa.username, performedByUsername: sa.username, profileStages: ['WASH_IN', 'WASH_OUT', 'STORAGE_IN'] });
    expect(body.data[0].filterName).toContain('-FR-');
  });

  it('manual-status-changes: a deleted performer is null, and a time window filters', async () => {
    const res = await get(`/api/filters/manual-status-changes?filterId=${FS}&from=${new Date(base - 5000).toISOString()}&to=${new Date(base).toISOString()}`);
    expect(res.json().data).toHaveLength(1);
    expect(res.json().data[0].performedByName).toBeNull();
    const none = await get(`/api/filters/manual-status-changes?filterId=${FS}&from=${new Date(base).toISOString()}`);
    expect(none.json()).toMatchObject({ data: [], total: 0 });
  });

  it('cleaning-record merges cycles and manual rows by date, tagged by kind', async () => {
    const res = await get(`/api/filters/cleaning-record?filterId=${FR}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((r: any) => r._kind)).toEqual(['manual', 'cycle']); // manual is newer
    const cycleRow = body.data[1];
    expect(cycleRow.id).toBe(cycleId);
    expect(cycleRow.events.map((e: any) => e.toState)).toEqual(['WASH_IN']); // events included for stage cells
  });

  it('cleaning-record pages the merged list', async () => {
    const res = await get(`/api/filters/cleaning-record?filterId=${FR}&limit=1&page=2`);
    expect(res.json()).toMatchObject({ total: 2, totalPages: 2, page: 2, limit: 1 });
    expect(res.json().data.map((r: any) => r._kind)).toEqual(['cycle']);
  });

  it('cleaning-record time window applies to both cycles and manual rows', async () => {
    const res = await get(`/api/filters/cleaning-record?filterId=${FR}&from=${new Date(base - 1).toISOString()}&to=${new Date(base + 1).toISOString()}`);
    expect(res.json().data.map((r: any) => r.id)).toEqual([cycleId]);
  });

  it('a status filter returns cycles only, with their events', async () => {
    const res = await get(`/api/filters/cleaning-record?filterId=${FR}&status=COMPLETED`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((r: any) => [r._kind, r.id])).toEqual([['cycle', cycleId]]);
    expect(res.json().data[0].events).toHaveLength(1);
    const byReason = await get(`/api/filters/cleaning-record?areaId=${A1}&cleaningReasonKey=BREAKDOWN`);
    expect(byReason.json().data.map((r: any) => r.id)).toContain(cycleId);
  });

  it('block scope reaches filters under an area AND directly under the block; area/ahu narrow it', async () => {
    const ids = async (q: string) => new Set(((await get(`/api/filters/cleaning-record?${q}&limit=200`)).json().data as any[]).map((r) => r.filterId));
    const block = await ids(`blockId=${B1}`);
    expect(block.has(FR)).toBe(true);
    expect(block.has(FS)).toBe(true);
    const area = await ids(`areaId=${A1}`);
    expect(area.has(FR)).toBe(true);
    expect(area.has(FS)).toBe(false);
    const ahu = await ids(`ahuId=${AHU2}`);
    expect(ahu.has(FS)).toBe(true);
    expect(ahu.has(FR)).toBe(false);
  });

  it('name search alone, and intersected with a scope', async () => {
    const res = await get(`/api/filters/cleaning-record?search=FSRCH${fx.tag}`);
    expect(res.json().data.map((r: any) => r.filterId)).toEqual([FS]);
    const crossed = await get(`/api/filters/cleaning-record?areaId=${A1}&search=FSRCH${fx.tag}`);
    expect(crossed.json()).toMatchObject({ data: [], total: 0, totalPages: 0 });
  });

  it('a scope with no filters short-circuits to an empty page', async () => {
    const res = await get(`/api/filters/cleaning-record?ahuId=${AHU3}&search=${randomUUID()}`);
    expect(res.json()).toMatchObject({ data: [], total: 0, totalPages: 0 });
  });

  it('a status + scope filter pages cycles over the scoped filter set', async () => {
    const res = await get(`/api/filters/cleaning-record?blockId=${B1}&status=COMPLETED&limit=200`);
    expect(res.statusCode).toBe(200);
    for (const r of res.json().data) expect(r).toMatchObject({ _kind: 'cycle', status: 'COMPLETED' });
    expect(res.json().data.map((r: any) => r.id)).toContain(cycleId);
  });
});

describe('GET /api/filters/cycles/:id — detail with checklist answers resolved three ways', () => {
  let cycleId = ''; let q1 = ''; let q2 = ''; let q3 = ''; const unknownQ = randomUUID();
  beforeAll(async () => {
    const snapCl = await fx.checklist('SNAP', [{ question: 'live text that must NOT win over the snapshot' }]);
    const verCl = await fx.checklist('VER', [{ question: 'live text that must NOT win over the version' }]);
    const liveCl = await fx.checklist('LIVE', [{ question: 'Live question three' }]);
    q1 = snapCl.questionIds[0]; q2 = verCl.questionIds[0]; q3 = liveCl.questionIds[0];
    await prisma.checklistProfileVersion.create({
      data: { profileId: verCl.id, versionNumber: 1, snapshot: { name: 'VER', questions: [{ id: q2, question: 'Versioned question two' }] } },
    });
    const c = await fx.rawCycle(F2, CP, { status: 'TERMINATED', cleaningAreaId: B1, checklistVersionPins: { [verCl.id]: 1 } });
    cycleId = c.id;
    const t = Date.now() - 3600_000;
    await fx.rawEvent({ filterId: F2, cycleId, eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedBy: sa.id, performedAt: new Date(t) });
    await fx.rawEvent({
      filterId: F2, cycleId, eventType: 'CHECKLIST_COMPLETED', performedBy: sa.id, performedAt: new Date(t + 1000),
      attributes: {
        afterStage: 'WASH_IN',
        answers: { [q1]: 'YES', [q2]: 'NO', [q3]: 'YES', [unknownQ]: 'N/A' },
        checklists: [{ questionsSnapshot: [{ id: q1, question: 'Snapshot question one' }] }],
      },
    });
    await fx.rawEvent({ filterId: F2, cycleId, eventType: 'CYCLE_TERMINATED', performedBy: ghostUser, performedAt: new Date(t + 2000) });
  }, 60_000);

  it('resolves snapshot → pinned version → live question, and leaves an unknown id as-is', async () => {
    const res = await get(`/api/filters/cycles/${cycleId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const cl = body.events.find((e: any) => e.eventType === 'CHECKLIST_COMPLETED');
    const text = Object.fromEntries(cl.enrichedAnswers.map((a: any) => [a.questionId, a.question]));
    expect(text[q1]).toBe('Snapshot question one');
    expect(text[q2]).toBe('Versioned question two');
    expect(text[q3]).toBe('Live question three');
    expect(text[unknownQ]).toBe(unknownQ);
  });

  it('names filter, AHU, area, stage set, and the terminator by raw id when that user is gone', async () => {
    const body = (await get(`/api/filters/cycles/${cycleId}`)).json();
    expect(body.filterName).toContain('-F2-');
    expect(body.ahuName).toContain('-AHU1-');
    expect(body.cleaningAreaName).toContain('-B1-');
    expect(body.profileStages).toEqual(['WASH_IN', 'WASH_OUT', 'STORAGE_IN']);
    expect(body).toMatchObject({ lastStageBy: sa.id, lastStageByUsername: sa.username, completedBy: ghostUser, completedByName: null, completedByUsername: null });
    expect(body.events.find((e: any) => e.eventType === 'CYCLE_TERMINATED').performedByName).toBeNull();
  });

  it('a cycle of an unparented filter with no area and no events has null names', async () => {
    const lone = await fx.filter('LONE', null, FP);
    const c = await fx.rawCycle(lone, CP, { status: 'IN_PROGRESS', completedAt: null });
    const body = (await get(`/api/filters/cycles/${c.id}`)).json();
    expect(body).toMatchObject({ ahuName: null, cleaningAreaName: null, filterSet: null, completedBy: null, lastStageBy: null, events: [] });
  });

  it('an unknown cycle id is 404', async () => {
    const res = await get(`/api/filters/cycles/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });
});

describe('dashboard / reasons / field-options', () => {
  it('dashboard-stats answers every breakdown and counts this file\'s own state', async () => {
    const FD = await fx.filter('FDASH', AHU2, FP, { stage: 'STORAGE_IN' });
    void FD;
    const res = await get('/api/filters/dashboard-stats');
    expect(res.statusCode).toBe(200);
    const b = res.json();
    for (const k of ['stageCounts', 'statusCounts', 'filterSetCounts', 'filterStatusCounts']) expect(typeof b[k]).toBe('object');
    for (const k of ['dailyCycles', 'monthlyCycles', 'cleaningReasons', 'filterTypeCounts', 'micronCounts']) expect(Array.isArray(b[k])).toBe(true);
    for (const k of ['totalFilters', 'activeCycles', 'completedToday', 'deviations30', 'completed30', 'avgCycleHours']) expect(typeof b[k]).toBe('number');
    expect(b.stageCounts.STORAGE_IN).toBeGreaterThanOrEqual(1);
    expect(b.filterSetCounts.SET_A).toBeGreaterThanOrEqual(1);
    expect(b.totalFilters).toBeGreaterThanOrEqual(fx.filterIds.length);
  });

  it('reasons: a profile\'s own list, else the configured catalogue', async () => {
    const own = await get(`/api/filters/reasons?profileId=${FP}`);
    expect(own.statusCode).toBe(200);
    expect(own.json().reasons.map((r: any) => r.key)).toEqual(['ROUTINE', 'BREAKDOWN']);
    const viaCleaningProfile = await get(`/api/filters/reasons?profileId=${CP}`);
    expect(viaCleaningProfile.json().reasons.map((r: any) => r.key)).toEqual(['ROUTINE', 'BREAKDOWN']);
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
    const raw = cfg?.configValue as any;
    const expected = Array.isArray(raw) ? raw : (raw?.value ?? []);
    expect((await get('/api/filters/reasons', viewerH)).json().reasons).toEqual(expected);
  });

  it('field-options returns the four value lists', async () => {
    const res = await get('/api/filters/field-options', viewerH);
    expect(res.statusCode).toBe(200);
    const v = res.json().value;
    for (const k of ['ahuType', 'filterType', 'micronSize', 'filterSize']) expect(Array.isArray(v[k])).toBe(true);
    expect(v.ahuType.length).toBeGreaterThan(0);
  });
});

describe('retirements and replacements lists (with Block / AHU scope)', () => {
  let FRET = ''; let FREP = ''; let FREP2 = ''; let newId = ''; let newId2 = '';
  beforeAll(async () => {
    FRET = await fx.filter('FRET', AHU1, FP);
    FREP = await fx.filter('FREP', AHU2, FP, { filterSet: 'SET_A' });
    FREP2 = await fx.filter('FREPOPS', AHU2, FP);
  }, 60_000);

  it('retire records the remarks and the pre-retire AHU; the list resolves AHU and Block through the Area', async () => {
    const r = await inject('POST', `/api/filters/${FRET}/retire`, saH, { remarks: 'end of life', _currentPassword: fx.password });
    expect(r.statusCode).toBe(200);
    const list = await get('/api/filters/retirements');
    expect(list.statusCode).toBe(200);
    const row = list.json().find((x: any) => x.id === FRET);
    expect(row).toMatchObject({
      preRetireParentId: AHU1, ahuId: AHU1, blockId: B1, remarks: 'end of life', retiredBy: sa.username, parentId: null,
    });
    expect(row.ahuName).toContain('-AHU1-');
    expect(row.blockName).toContain('-B1-');
    expect(row.preRetireParentName).toContain('-AHU1-');
  });

  it('a retired row with no audit record and a non-AHU parent still lists, unscoped', async () => {
    const orphan = await fx.filter('FORPH', null, FP);
    await prisma.assetInstance.update({ where: { id: orphan }, data: { status: 'Retired', isActive: false, customAttributes: { _preRetireParentId: B1 } } });
    const row = (await get('/api/filters/retirements', viewerH)).json().find((x: any) => x.id === orphan);
    expect(row).toMatchObject({ remarks: null, retiredBy: null, ahuId: null, blockId: null, blockName: null });
    expect(row.preRetireParentName).toContain('-B1-');
    expect(row.retiredAt).toBe(row.updatedAt);
  });

  it('replace of a name with no numeric suffix appends "-01", and the list scopes the row by its AHU', async () => {
    const plain = `${fx.tag}-REPLACEME-X`;
    await prisma.assetInstance.update({ where: { id: FREP }, data: { name: plain } });
    const r = await inject('POST', `/api/filters/${FREP}/replace`, saH, { remarks: 'damaged media', _currentPassword: fx.password });
    expect(r.statusCode).toBe(200);
    newId = r.json().newFilterId;
    extraFilterIds.push(newId);
    expect(r.json().newFilterName).toBe(`${plain}-01`);
    const row = (await get('/api/filters/replacements')).json().find((x: any) => x.newFilterId === newId);
    expect(row).toMatchObject({ oldFilterId: FREP, ahuId: AHU2, blockId: B1, remarks: 'damaged media', performedBy: sa.username });
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: newId } })).toMatchObject({ filterSet: 'SET_A', filterProfileId: FP });
  });

  it('a lower role does not see SUPER_ADMIN replacements, but sees its own role\'s', async () => {
    const oldName = (await prisma.assetInstance.findUnique({ where: { id: FREP2 } }))!.name;
    const r = await inject('POST', `/api/filters/${FREP2}/replace`, opsH, { remarks: 'operator swap' });
    expect(r.statusCode).toBe(200);
    newId2 = r.json().newFilterId;
    extraFilterIds.push(newId2);
    // A trailing number is incremented, zero-padded to two digits.
    const n = Number(oldName.match(/-(\d+)$/)![1]) + 1;
    expect(r.json().newFilterName).toBe(oldName.replace(/-\d+$/, '-' + String(n).padStart(2, '0')));
    const seen = (await get('/api/filters/replacements', viewerH)).json();
    expect(seen.some((x: any) => x.newFilterId === newId)).toBe(false);
    expect(seen.some((x: any) => x.newFilterId === newId2)).toBe(true);
    // The SUPER_ADMIN viewer sees both.
    const all = (await get('/api/filters/replacements')).json();
    expect(all.some((x: any) => x.newFilterId === newId) && all.some((x: any) => x.newFilterId === newId2)).toBe(true);
  });

  it('retiring or replacing an already-retired filter is refused (ALREADY_RETIRED)', async () => {
    const r = await inject('POST', `/api/filters/${FRET}/retire`, saH, { remarks: 'again', _currentPassword: fx.password });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('ALREADY_RETIRED');
    const rep = await inject('POST', `/api/filters/${FRET}/replace`, saH, { remarks: 'again', _currentPassword: fx.password });
    expect(rep.statusCode).toBe(400);
    expect(rep.json().error).toBe('ALREADY_RETIRED');
  });

  it('replace of an unknown filter is 404', async () => {
    const r = await inject('POST', `/api/filters/${randomUUID()}/replace`, saH, { remarks: 'x', _currentPassword: fx.password });
    expect(r.statusCode).toBe(404);
  });
});

/**
 * Run `fn` while capturing what the app logger prints (lib/logger.ts writes each
 * record to process.stdout synchronously). An id that reaches Prisma unvalidated
 * prints an `ERROR  [prisma]` "Unmapped Prisma error" line; a schema refusal
 * prints nothing. Same helper as e2e/uuid-route-params.test.ts.
 */
async function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; text: string }> {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { chunks.push(String(c)); return true; }) as never);
  try {
    const result = await fn();
    await new Promise((r) => setTimeout(r, 25)); // let a late Prisma log event land
    return { result, text: chunks.join('') };
  } finally {
    spy.mockRestore();
  }
}

describe('AHU completion endpoints validate ids at the schema edge (format: uuid, 2026-10-22)', () => {
  it('a non-uuid AHU id on /ahu/:ahuId/completion-status is a 400 VALIDATION_ERROR naming the param, with no ERROR line', async () => {
    const { result: res, text } = await captureStdout(() => get('/api/filters/ahu/not-a-uuid/completion-status'));
    expect(text).not.toMatch(/ERROR/);
    expect([res.statusCode, res.json().error]).toEqual([400, 'VALIDATION_ERROR']);
    expect(res.json().details).toEqual(expect.arrayContaining([
      expect.objectContaining({ keyword: 'format', instancePath: '/ahuId', params: { format: 'uuid' } }),
    ]));
    expect(internalErrors).toEqual([]);
  });

  it('a well-formed unknown AHU id still reaches the handler (an empty roster)', async () => {
    const res = await get(`/api/filters/ahu/${randomUUID()}/completion-status`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ filters: [], pending: [] });
  });

  for (const url of ['/api/filters/ahu-completion-status/batch', '/api/filters/ahu-set-availability']) {
    it(`${url}: a malformed item in filterIds is a 400 VALIDATION_ERROR naming the item, with no ERROR line`, async () => {
      const { result: res, text } = await captureStdout(() => inject('POST', url, saH, { filterIds: [F1, 'not-a-uuid'] }));
      expect(text).not.toMatch(/ERROR/);
      expect([res.statusCode, res.json().error]).toEqual([400, 'VALIDATION_ERROR']);
      expect(res.json().details).toEqual(expect.arrayContaining([
        expect.objectContaining({ keyword: 'format', instancePath: '/filterIds/1', params: { format: 'uuid' } }),
      ]));
      expect(internalErrors).toEqual([]);
    });
  }

  it('well-formed filter ids (known and unknown) still reach both handlers', async () => {
    const batch = await inject('POST', '/api/filters/ahu-completion-status/batch', saH, { filterIds: [F1, randomUUID()] });
    expect(batch.statusCode).toBe(200);
    expect(batch.json().ahus.map((a: any) => a.ahuId)).toEqual([AHU1]);
    const avail = await inject('POST', '/api/filters/ahu-set-availability', saH, { filterIds: [randomUUID()] });
    expect([avail.statusCode, avail.json()]).toEqual([200, { hasBothSets: false }]);
  });
});

describe('read paths over legacy / partial rows', () => {
  // Shapes no current route writes but live data carries: a user with no full
  // name, events by deleted users, an area id that is no longer an asset, a
  // filter with no FilterDetails, checklist events without per-profile
  // snapshots, a version snapshot without questions.
  let noName: { id: string; username: string };
  beforeAll(async () => {
    noName = await fx.user('noname', 'SUPER_ADMIN');
    await prisma.user.update({ where: { id: noName.id }, data: { fullName: '' } });
  }, 60_000);

  it('names fall back to the username when the full name is empty; a gone area or performer reads null', async () => {
    const f = await fx.filter('LEG', AHU2, FP);
    const t = Date.now() - 7200_000;
    const c = await fx.rawCycle(f, CP, { status: 'COMPLETED', cleaningAreaId: randomUUID(), startedAt: new Date(t) });
    await fx.rawEvent({ filterId: f, cycleId: c.id, eventType: 'STATE_TRANSITION', toState: 'STORAGE_IN', performedBy: ghostUser, performedAt: new Date(t + 1000) });
    await fx.rawEvent({ filterId: f, cycleId: c.id, eventType: 'CYCLE_COMPLETED', performedBy: noName.id, performedAt: new Date(t + 2000) });
    const row = (await get(`/api/filters/cycles?filterId=${f}`)).json().data[0];
    expect(row).toMatchObject({ cleaningAreaName: null, lastStageBy: ghostUser, lastStageByUsername: null, completedByName: noName.username, completedByUsername: noName.username });
    const detail = (await get(`/api/filters/cycles/${c.id}`)).json();
    expect(detail).toMatchObject({ completedByName: noName.username, completedBy: noName.id, cleaningAreaName: null, lastStageByUsername: null });
    await fx.rawEvent({ filterId: f, eventType: 'STATE_TRANSITION', toState: 'IN_USE', performedBy: noName.id, attributes: { manual: true } });
    const manual = (await get(`/api/filters/manual-status-changes?filterId=${f}`)).json().data[0];
    expect(manual.performedByName).toBe(noName.username);
  });

  it('a filter with no FilterDetails row still details its cycle (filterSet null)', async () => {
    const bare = await prisma.assetInstance.create({ data: { name: fx.name('BARE'), templateId: await fx.template('FILTER'), parentId: AHU2 } });
    fx.filterIds.push(bare.id);
    const c = await fx.rawCycle(bare.id, CP, { status: 'COMPLETED' });
    const body = (await get(`/api/filters/cycles/${c.id}`)).json();
    expect(body).toMatchObject({ filterSet: null, filterName: bare.name });
    expect(body.ahuName).toContain('-AHU2-');
  });

  it('checklist answers resolve even when events or version snapshots are partial', async () => {
    const vcl = await fx.checklist('PARTV', [{ question: 'live text' }]);
    const lcl = await fx.checklist('PARTL', [{ question: 'Only the live text exists' }]);
    await prisma.checklistProfileVersion.create({ data: { profileId: vcl.id, versionNumber: 1, snapshot: { name: 'no questions here' } } });
    const f = await fx.filter('PART', AHU2, FP);
    const c = await fx.rawCycle(f, CP, { status: 'COMPLETED', checklistVersionPins: { [vcl.id]: 1 } });
    await fx.rawEvent({
      filterId: f, cycleId: c.id, eventType: 'CHECKLIST_COMPLETED', performedBy: sa.id,
      attributes: { answers: { [lcl.questionIds[0]]: 'YES' }, checklists: [{}, { questionsSnapshot: [{ id: lcl.questionIds[0] }] }] },
    });
    await fx.rawEvent({ filterId: f, cycleId: c.id, eventType: 'CHECKLIST_COMPLETED', performedBy: sa.id, attributes: { answers: { [vcl.questionIds[0]]: 'NO' } } });
    const evs = (await get(`/api/filters/cycles/${c.id}`)).json().events;
    const text = Object.fromEntries(evs.flatMap((e: any) => e.enrichedAnswers ?? []).map((a: any) => [a.questionId, a.question]));
    expect(text[lcl.questionIds[0]]).toBe('Only the live text exists');
    expect(text[vcl.questionIds[0]]).toBe('live text');
  });

  it('cleaning-record with no scope pages the whole record', async () => {
    const res = await get('/api/filters/cleaning-record?limit=1');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeLessThanOrEqual(1);
    expect(res.json().total).toBeGreaterThanOrEqual(1);
  });

  it('stage-options lists a STAGE that is not reachable from START after the reachable ones', async () => {
    const { cleaningProfileId, filterProfileId } = await fx.pipeline({ name: 'ISLAND', stages: ['WASH_IN', 'WASH_OUT'] }, sa.id);
    await prisma.filterPipelineStage.create({ data: { profileId: cleaningProfileId, nodeType: 'STAGE', stateKey: 'STORAGE_OUT', sortOrder: 99 } });
    const f = await fx.filter('ISL', AHU2, filterProfileId);
    const body = (await get(`/api/filters/${f}/stage-options`)).json();
    expect(body.orderedStages).toEqual(['WASH_IN', 'WASH_OUT', 'STORAGE_OUT']);
  });
});

describe('retirement / replacement lists over edge rows', () => {
  it('an AHU in an Area with no Block scopes to the AHU with no Block', async () => {
    const lonelyArea = await fx.node('AREA', 'NOBLKAREA');
    const ahu = await fx.node('AHU', 'NOBLKAHU', lonelyArea);
    const f = await fx.filter('NOBLK', ahu, FP);
    expect((await inject('POST', `/api/filters/${f}/retire`, saH, { remarks: 'no block above', _currentPassword: fx.password })).statusCode).toBe(200);
    const row = (await get('/api/filters/retirements')).json().find((x: any) => x.id === f);
    expect(row).toMatchObject({ ahuId: ahu, blockId: null, blockName: null });
  });

  it('a filter retired twice lists its LATEST retirement remarks', async () => {
    const f = await fx.filter('TWICE', AHU2, FP);
    expect((await inject('POST', `/api/filters/${f}/retire`, saH, { remarks: 'first retirement', _currentPassword: fx.password })).statusCode).toBe(200);
    // Restored by hand (as Filter Data Management's unretire would), then retired again.
    await prisma.assetInstance.update({ where: { id: f }, data: { isActive: true, status: 'Active', parentId: AHU2 } });
    await prisma.filterDetails.update({ where: { assetInstanceId: f }, data: { currentLifecycleState: null } });
    expect((await inject('POST', `/api/filters/${f}/retire`, saH, { remarks: 'second retirement', _currentPassword: fx.password })).statusCode).toBe(200);
    const row = (await get('/api/filters/retirements')).json().find((x: any) => x.id === f);
    expect(row.remarks).toBe('second retirement');
  });

  it('a retired row with no pre-retire parent recorded has no parent name', async () => {
    const f = await fx.filter('NOPRE', null, FP);
    await prisma.assetInstance.update({ where: { id: f }, data: { status: 'Retired', isActive: false } });
    const row = (await get('/api/filters/retirements')).json().find((x: any) => x.id === f);
    expect(row).toMatchObject({ preRetireParentId: null, preRetireParentName: null, ahuId: null });
  });

  it('replacing a filter with no FilterDetails gives the new filter an empty sidecar', async () => {
    const bare = await prisma.assetInstance.create({ data: { name: fx.name('BAREREP'), templateId: await fx.template('FILTER'), parentId: AHU2 } });
    fx.filterIds.push(bare.id);
    const r = await inject('POST', `/api/filters/${bare.id}/replace`, saH, { remarks: 'bare swap', _currentPassword: fx.password });
    expect(r.statusCode).toBe(200);
    extraFilterIds.push(r.json().newFilterId);
    expect(await prisma.filterDetails.findUnique({ where: { assetInstanceId: r.json().newFilterId } })).toMatchObject({ filterSet: null, filterProfileId: null });
  });

  it('a replacement whose new filter was later deleted is still scoped through the old filter', async () => {
    const f = await fx.filter('GONE', AHU2, FP);
    const r = await inject('POST', `/api/filters/${f}/replace`, saH, { remarks: 'swap then delete', _currentPassword: fx.password });
    expect(r.statusCode).toBe(200);
    const newId = r.json().newFilterId;
    await prisma.assetRelationship.deleteMany({ where: { OR: [{ sourceAssetId: newId }, { targetAssetId: newId }] } });
    await prisma.filterDetails.deleteMany({ where: { assetInstanceId: newId } });
    await prisma.assetInstance.delete({ where: { id: newId } });
    const row = (await get('/api/filters/replacements')).json().find((x: any) => x.newFilterId === newId);
    expect(row).toMatchObject({ oldFilterId: f, ahuId: AHU2, blockId: B1 });
  });
});
