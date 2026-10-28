/**
 * P-1 (2026-10-22) — /batch-states must answer exactly what /current-state answers,
 * and its query count must not grow with the number of filters IN A CYCLE.
 *
 * On the one-year copy (2,928 of 3,038 filters mid-cycle) the batch made 17,934
 * queries per call: six per in-cycle filter (the cycle's checklist/entry events,
 * an event count, and four equipment-group reads) that the 2026-10-17 preload
 * never seeded. This suite drives the REAL getBatchStates against owned rows and
 * locks two things:
 *
 *  1. Parity — for every fixture filter, the batch's object is byte-identical
 *     (JSON) to the un-cached single-filter getCurrentState. The fixtures reach
 *     every branch the batch path memoises or preloads: idle (home block, PM due
 *     and not due), START position, a checklist pending / answered / answered
 *     before a re-entry (superseded), QA interlock PENDING / APPROVED / none, Dry In
 *     before and after half-time, and the equipment-group branches (pinned with a
 *     snapshot row, pinned lazy-first-version, pinned with neither =
 *     snapshotMissing, legacy null pin, no group bound → every block group, live
 *     version ahead of the pin = sync warning), plus a cycle on a profile the
 *     filter is no longer assigned (profileSyncWarning) and a retired filter
 *     (excluded from the batch).
 *  2. Volume — the number of statements that touch this file's rows does not
 *     grow when more in-cycle filters are added.
 *
 * Isolation (digilog_test_db is shared): rows are owned (fo-fixtures). The batch
 * reads every active filter in the database, so parity is per fixture id and
 * statements are attributed by the uuids in their parameters. The interlock
 * switch is mocked (no system_config write), and ctx.isOfflineReplay keeps the
 * call read-only: it skips only the interlock self-heal, which would otherwise
 * create approvals on OTHER suites' filters parked at a gated stage. Our own
 * gated filters carry their approval rows, so the self-heal never applies to them.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const cfg = vi.hoisted(() => ({
  enabled: true, washOutApproverRole: 'SHIFTOFFICER', dryOutApproverRole: 'SHIFTOFFICER', requireDifferentApprover: true,
}));
vi.mock('../stage-interlock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stage-interlock.js')>();
  return { ...actual, getInterlockConfig: async () => ({ ...cfg }) };
});

import { prisma } from '../../../lib/prisma.js';
import { FilterOperationsService } from '../filter-operations.service.js';
import { FoFixture } from './support/fo-fixtures.js';

const fx = new FoFixture('BSP');
const service = new FilterOperationsService();
const MIN = 60_000;
const HOUR = 60 * MIN;

let ctx: any;
let opId: string;
let blockId: string;
let ahuId: string;
let profile: { cleaningProfileId: string; filterProfileId: string };
let profile2: { cleaningProfileId: string; filterProfileId: string };
let checklistId: string;
let groups: Record<'lazy' | 'snap' | 'missing', { id: string }>;
/** Every uuid this file owns — statements are attributed to the suite by these. */
const owned = new Set<string>();
const ids: Record<string, string> = {};

// ── Query capture ──────────────────────────────────────────────────────────────
let capturing = false;
let captured: Array<{ query: string; params: string }> = [];
prisma.$on('query' as never, (e: any) => { if (capturing) captured.push({ query: e.query, params: e.params }); });
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const touchesOwned = (q: { params: string }) => (q.params.match(UUID) ?? []).some((u) => owned.has(u));

async function batchCounted() {
  captured = [];
  capturing = true;
  try {
    const res = await service.getBatchStates(ctx);
    const owned = captured.filter(touchesOwned);
    return { res, ownedQueries: owned.length, ownedTexts: owned.map((q) => q.query), total: captured.length };
  } finally {
    capturing = false;
  }
}

// ── Fixture builders ───────────────────────────────────────────────────────────
type Ev = { type: string; to?: string | null; at: number; attrs?: Record<string, unknown> };

async function inCycle(label: string, opts: {
  stage: string | null; events: Ev[]; group?: { id: string } | null; pin?: number | null;
  dryer?: { startedAgoMs: number; minutes: number }; cycleProfileId?: string; parent?: string;
}) {
  const fid = await fx.filter(label, opts.parent ?? ahuId, profile.filterProfileId);
  owned.add(fid);
  const now = Date.now();
  const cyc = await fx.rawCycle(fid, opts.cycleProfileId ?? profile.cleaningProfileId, {
    status: 'IN_PROGRESS', completedAt: null, cleaningAreaId: blockId, startedAt: new Date(now - 6 * HOUR),
    checklistVersionPins: { [checklistId]: 1 },
    equipmentGroupId: opts.group?.id ?? null, equipmentGroupVersionPin: opts.pin ?? null,
  });
  owned.add(cyc.id);
  if (opts.dryer) {
    await prisma.cleaningCycle.update({
      where: { id: cyc.id },
      data: { dryerStartedAt: new Date(now - opts.dryer.startedAgoMs), dryerDurationMinutes: opts.dryer.minutes },
    });
  }
  for (const e of opts.events) {
    const ev = await fx.rawEvent({
      filterId: fid, cycleId: cyc.id, eventType: e.type, toState: e.to ?? null, performedBy: opId,
      performedAt: new Date(now - e.at), attributes: e.attrs ?? {},
    });
    owned.add(ev.id);
  }
  await prisma.filterDetails.update({ where: { assetInstanceId: fid }, data: { currentCycleId: cyc.id, currentLifecycleState: opts.stage } });
  return { filterId: fid, cycleId: cyc.id };
}

async function approval(filterId: string, cycleId: string, stageKey: string, status: 'PENDING' | 'APPROVED') {
  const a = await prisma.cleaningStageApproval.create({
    data: {
      cycleId, filterId, stageKey, status, approverRole: 'SHIFTOFFICER',
      rejectToStateKey: stageKey === 'DRY_OUT' ? 'DRY_IN' : 'WASH_IN', detailsSnapshot: {},
      requestedBy: opId, requestedByName: 'bsp',
    },
  });
  owned.add(a.id);
}

const started = (at: number): Ev => ({ type: 'CYCLE_STARTED', at });
const enter = (to: string, at: number): Ev => ({ type: 'STATE_TRANSITION', to, at });
const answered = (afterStage: string, at: number): Ev => ({
  type: 'CHECKLIST_COMPLETED', at, attrs: { afterStage, checklistProfileId: checklistId, answers: [] },
});

/** Six more filters mid-cycle at Wash In on the shared lazy group — added for the volume round. */
async function addMoreInCycle(n: number) {
  for (let i = 0; i < n; i++) {
    await inCycle(`more-${i}`, { stage: 'WASH_IN', events: [started(3 * HOUR), enter('WASH_IN', 2 * HOUR)], group: groups.lazy, pin: 1 });
  }
}

beforeAll(async () => {
  const role = await fx.role('OP', ['ASSET_READ', 'FILTER_OPERATE']);
  opId = (await fx.user('op', role)).id;
  ctx = { userId: 'bsp_op', userSub: opId, userRole: role, ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: 'bsp', isOfflineReplay: true };

  blockId = await fx.node('BLOCK', 'Block');
  const area = await fx.node('AREA', 'Area', blockId);
  ahuId = await fx.node('AHU', 'AHU-1', area);
  const ahuPm = await fx.node('AHU', 'AHU-PM', area);
  [blockId, area, ahuId, ahuPm].forEach((id) => owned.add(id));

  checklistId = (await fx.checklist('After wash in', [{ question: 'Clean?' }])).id;
  owned.add(checklistId);
  profile = await fx.pipeline({
    name: 'Six', stages: ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN'], checklistAfter: { 0: checklistId },
  }, opId);
  profile2 = await fx.pipeline({ name: 'Other', stages: ['WASH_IN', 'WASH_OUT'] }, opId);
  [profile.cleaningProfileId, profile.filterProfileId, profile2.cleaningProfileId, profile2.filterProfileId].forEach((id) => owned.add(id));

  const inst = [{ stageKey: 'WASH_IN' }, { stageKey: 'DRY_IN', min: 60, max: 80 }];
  const lazy = await fx.equipmentGroup(blockId, 'Lazy v1', inst, { version: 1 });
  const snap = await fx.equipmentGroup(blockId, 'Snap v2', inst, { version: 2 });
  const missing = await fx.equipmentGroup(blockId, 'Missing v3', inst, { version: 3 });
  await prisma.equipmentGroupVersion.create({
    data: {
      groupId: snap.id, versionNumber: 1,
      snapshot: { name: 'Snap as v1', blockId, isActive: true, instruments: [...snap.instruments].reverse().map((i, n) => ({ ...i, operatingMin: 1 + n, sortOrder: 5 - n })) } as any,
    },
  });
  groups = { lazy, snap, missing };
  [lazy.id, snap.id, missing.id].forEach((id) => owned.add(id));

  // A visit in force today on AHU-PM, none on AHU-1.
  const d = new Date();
  const utc = (o: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + o));
  const pm = await prisma.pmSchedule.create({
    data: {
      entityId: ahuPm, year: d.getUTCFullYear(), status: 'ACTIVE', createdBy: opId,
      entries: { create: [{ month: d.getUTCMonth() + 1, plannedDate: utc(0), toleranceDays: 3, windowStart: utc(-3), windowEnd: utc(3), approvalStatus: 'APPROVED' }] },
    },
  });
  fx.pmScheduleIds.push(pm.id);

  ids.idle = await fx.filter('idle', ahuId, profile.filterProfileId);
  ids.idlePm = await fx.filter('idle-pm', ahuPm, profile.filterProfileId);
  ids.retired = await fx.filter('retired', ahuId, profile.filterProfileId);
  await prisma.assetInstance.update({ where: { id: ids.retired }, data: { status: 'Retired' } });
  [ids.idle, ids.idlePm, ids.retired].forEach((id) => owned.add(id));

  const c = {
    start: await inCycle('start', { stage: null, events: [started(HOUR)], group: groups.lazy, pin: 1 }),
    clPending: await inCycle('cl-pending', { stage: 'WASH_IN', events: [started(3 * HOUR), enter('WASH_IN', 2 * HOUR)], group: groups.lazy, pin: 1 }),
    clDone: await inCycle('cl-done', {
      stage: 'WASH_IN', events: [started(3 * HOUR), enter('WASH_IN', 2 * HOUR), answered('WASH_IN', HOUR)], group: groups.lazy, pin: 1,
    }),
    // Answered, then sent back into Wash In: the answer predates the latest entry.
    clSuperseded: await inCycle('cl-superseded', {
      stage: 'WASH_IN', events: [started(5 * HOUR), enter('WASH_IN', 4 * HOUR), answered('WASH_IN', 3 * HOUR), enter('WASH_IN', HOUR)],
      group: groups.snap, pin: 1,
    }),
    washOutPending: await inCycle('washout-pending', {
      stage: 'WASH_OUT', events: [started(4 * HOUR), enter('WASH_IN', 3 * HOUR), answered('WASH_IN', 2 * HOUR), enter('WASH_OUT', HOUR)],
      group: groups.missing, pin: 2,
    }),
    // Parked at a gated stage with NO approval: the batch must read this one fresh
    // (current-state self-heals on null), never answer it from the preload.
    washOutNoApproval: await inCycle('washout-none', {
      stage: 'WASH_OUT', events: [started(4 * HOUR), enter('WASH_IN', 3 * HOUR), answered('WASH_IN', 2 * HOUR), enter('WASH_OUT', HOUR)],
      group: groups.lazy, pin: 1,
    }),
    dryOutApproved: await inCycle('dryout-approved', {
      stage: 'DRY_OUT', events: [started(6 * HOUR), enter('WASH_IN', 5 * HOUR), answered('WASH_IN', 4 * HOUR), enter('WASH_OUT', 3 * HOUR), enter('DRY_IN', 2 * HOUR), enter('DRY_OUT', HOUR)],
      group: groups.lazy, pin: null,
    }),
    dryHalfDone: await inCycle('dry-half-done', {
      stage: 'DRY_IN', events: [started(6 * HOUR), enter('WASH_IN', 5 * HOUR), answered('WASH_IN', 4 * HOUR), enter('WASH_OUT', 3 * HOUR), enter('DRY_IN', 2 * HOUR)],
      group: null, dryer: { startedAgoMs: 2 * HOUR, minutes: 60 },
    }),
    dryJustStarted: await inCycle('dry-just-started', {
      stage: 'DRY_IN', events: [started(6 * HOUR), enter('WASH_IN', 5 * HOUR), answered('WASH_IN', 4 * HOUR), enter('WASH_OUT', 3 * HOUR), enter('DRY_IN', MIN)],
      group: groups.lazy, pin: 1, dryer: { startedAgoMs: MIN, minutes: 240 },
    }),
    otherProfile: await inCycle('other-profile', {
      stage: 'WASH_IN', events: [started(2 * HOUR), enter('WASH_IN', HOUR)], cycleProfileId: profile2.cleaningProfileId, group: groups.lazy, pin: 1,
    }),
  };
  await approval(c.washOutPending.filterId, c.washOutPending.cycleId, 'WASH_OUT', 'PENDING');
  await approval(c.dryOutApproved.filterId, c.dryOutApproved.cycleId, 'DRY_OUT', 'APPROVED');
  for (const [k, v] of Object.entries(c)) ids[k] = v.filterId;
}, 120_000);

afterAll(async () => {
  await fx.cleanup();
});

describe('P-1 — batch-states parity with current-state', () => {
  it('every fixture filter: the batch object is byte-identical to the single-filter answer', async () => {
    const { res } = await batchCounted();
    expect(res.states[ids.retired]).toBeUndefined();

    for (const [label, id] of Object.entries(ids)) {
      if (label === 'retired') continue;
      const single = await service.getCurrentState(ctx, id);
      expect(res.states[id], label).toBeDefined();
      expect(JSON.parse(JSON.stringify(res.states[id])), label).toEqual(JSON.parse(JSON.stringify(single)));
      expect(JSON.stringify(res.states[id]), label).toBe(JSON.stringify(single));
    }
  });

  it('the fixtures reach the branches the batch path short-cuts', async () => {
    const { res } = await batchCounted();
    const s = (k: string) => res.states[ids[k]];
    const types = (k: string) => s(k).actions.map((a: any) => a.type);

    expect(s('idle').homeBlock?.id).toBe(blockId);
    expect(s('idle').isPmDue).toBe(false);
    expect(s('idlePm').isPmDue).toBe(true);
    expect(s('start').currentState).toBeNull();
    expect(s('start').currentCycle?.id).toBeTruthy();

    expect(types('clPending')).toContain('SUBMIT_CHECKLIST');
    expect(types('clDone')).not.toContain('SUBMIT_CHECKLIST');
    expect(types('clSuperseded')).toContain('SUBMIT_CHECKLIST');

    expect(s('washOutPending').interlock).toMatchObject({ status: 'PENDING', blocksLeaving: true });
    expect(s('dryOutApproved').interlock).toMatchObject({ status: 'APPROVED', blocksLeaving: false });
    expect(s('washOutNoApproval').interlock).toMatchObject({ status: null, approvalId: null, blocksLeaving: true });

    expect(types('dryHalfDone')).toContain('SUBMIT_DRYER_READINGS');
    expect(types('dryJustStarted')).not.toContain('SUBMIT_DRYER_READINGS');

    // Equipment-group branches.
    expect(s('clPending').equipmentGroup).toMatchObject({ id: groups.lazy.id, version: 1 });           // pinned, lazy first version
    expect(s('clSuperseded').equipmentGroup).toMatchObject({ id: groups.snap.id, name: 'Snap as v1', version: 1 }); // pinned snapshot
    expect(s('clSuperseded').equipmentGroupSyncWarning).toMatchObject({ pinnedVersion: 1, liveVersion: 2 });
    expect(s('washOutPending').equipmentGroup).toMatchObject({ snapshotMissing: true, pinnedVersion: 2, liveVersion: 3 });
    expect(s('dryOutApproved').equipmentGroup?.id).toBe(groups.lazy.id);                                // legacy null pin
    expect(s('dryHalfDone').blockEquipmentGroups.map((g: any) => g.id).sort())
      .toEqual([groups.lazy.id, groups.snap.id, groups.missing.id].sort());                             // no group bound

    expect(s('otherProfile').profileSyncWarning).toMatchObject({
      cycleProfileId: profile2.cleaningProfileId, expectedProfileId: profile.cleaningProfileId,
    });
    expect(s('clPending').profileSyncWarning).toBeNull();
  });

  it('statements touching this suite do not grow with the number of in-cycle filters', async () => {
    await batchCounted();                       // warm: first-touch effects out of the way
    const before = await batchCounted();
    await addMoreInCycle(6);
    const after = await batchCounted();
    // eslint-disable-next-line no-console
    console.log(`[P-1] owned statements: ${before.ownedQueries} -> ${after.ownedQueries} after +6 in-cycle filters (all statements ${before.total} -> ${after.total})`);
    // On a mismatch, name the statements that only one of the two calls ran.
    const onlyIn = (a: string[], b: string[]) => {
      const rest = [...b];
      return a.filter((q) => { const i = rest.indexOf(q); if (i < 0) return true; rest.splice(i, 1); return false; });
    };
    const diff = JSON.stringify({ onlyBefore: onlyIn(before.ownedTexts, after.ownedTexts), onlyAfter: onlyIn(after.ownedTexts, before.ownedTexts) }, null, 1);
    expect(after.ownedQueries - before.ownedQueries, diff).toBe(0);
  }, 60_000);
});
