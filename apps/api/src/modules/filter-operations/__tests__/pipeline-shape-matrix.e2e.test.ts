/**
 * Every cleaning-profile shape must run to completion (operator decision
 * 2026-10-22: "stage should be there, checklist should be there, all conditions
 * should work, any stage anywhere and checklist also").
 *
 * For each SHAPE × {QA stage interlock off, on} × {block with an equipment group
 * (Wash In + Dry In instruments), no group}, a REFERENCE CLIENT drives one cycle
 * from start to completion through the real routes. It does what the tablet does:
 * it reads the action tape the server sends (current-state `actions[]`, built by
 * the shared executor) and takes the first actionable step —
 *
 *   SUBMIT_CHECKLIST        → POST /submit-checklist (every pending checklist, one call;
 *                             at START too — the checklists before the first stage)
 *   SUBMIT_DRYER_READINGS   → POST /advance { DRY_IN, dryerAction: SUBMIT_READINGS, readings },
 *                             or /advance-with-checklist when the readings finish a FINAL
 *                             Dry In that a checklist follows (shared advanceMustCarryChecklist)
 *   SET_DRYER_DURATION      → POST /advance { DRY_IN, dryerAction: SET_DURATION } (never
 *                             carries a checklist: the dryer start finishes no stage)
 *   ADVANCE_TO_STAGE        → POST /advance-with-checklist when an enabled checklist
 *                             follows the target and the target is not QA-gated
 *                             (the dialog-first rule, use-core.ts), else POST /advance;
 *                             Wash In readings when the action asks for them.
 *   a PENDING QA approval   → a different user in the approver role approves it.
 *   Dry In half-time wait   → time passes (dryerStartedAt moved back).
 *
 * It asserts the cycle COMPLETES, every stage is entered in pipeline order, every
 * ENABLED checklist node is recorded exactly once (a disabled one never), and the
 * dryer timing (+ readings when a Dry In instrument exists) is on the cycle. A
 * step the tape cannot offer, or a call the server refuses, ends the drive as
 * STUCK with the reason.
 *
 * OFFLINE variants (one shape per root cause of the 2026-10-22 failures): the same
 * steps sent the way the tablet's sync engine replays them — the offline-replay
 * grant header, `offlinePerformedAt` and a `clientOpId` on every write. The
 * stage interlock never gates offline work, so no approval is raised there.
 *
 * Isolation: every row is owned (fo-fixtures). The interlock switch is the shared
 * `system_config['stage-interlock']` row, so `getInterlockConfig` (one export) is
 * mocked to a per-case value routed to this file's approver role.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const cfg = vi.hoisted(() => ({ enabled: false, washOutApproverRole: 'UNSET', dryOutApproverRole: 'UNSET' }));
vi.mock('../stage-interlock.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../stage-interlock.js')>();
  return { ...actual, getInterlockConfig: async () => ({ ...cfg }) };
});

import { buildApp, internalErrors, obtainOfflineGrant } from '../../../e2e/test-helper.js';
import { prisma } from '../../../lib/prisma.js';
import filterOperationsRoutes from '../routes.js';
import stageApprovalRoutes from '../../stage-approvals/routes.js';
import { FoFixture, DEFAULT_REASONS } from './support/fo-fixtures.js';
import { advanceMustCarryChecklist, isEntryIntoStage } from '@digilog/shared';

// ── Shapes: tokens in pipeline order between START and END ────────────────────
// A stage key, 'CL' (an enabled checklist) or 'CLX' (a disabled checklist).
const SHAPES: Array<[name: string, tokens: string[]]> = [
  ['standard six stages', ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT']],
  ['checklist after every stage', ['WASH_IN', 'CL', 'WASH_OUT', 'CL', 'DRY_IN', 'CL', 'DRY_OUT', 'CL', 'STORAGE_IN', 'CL', 'STORAGE_OUT', 'CL']],
  ['checklist before the first stage', ['CL', 'WASH_IN', 'WASH_OUT']],
  ['checklist after the last stage', ['WASH_IN', 'STORAGE_IN', 'CL']],
  ['two consecutive checklists, mid and last', ['WASH_IN', 'CL', 'CL', 'STORAGE_IN', 'CL', 'CL']],
  ['disabled checklists, mid and last', ['WASH_IN', 'CLX', 'STORAGE_IN', 'CLX']],
  ['single stage', ['STORAGE_IN']],
  ['single stage + checklist', ['STORAGE_IN', 'CL']],
  ['single Dry In', ['DRY_IN']],
  ['single Dry In + checklist', ['DRY_IN', 'CL']],
  ['Dry In first (DRY STORAGE)', ['DRY_IN', 'DRY_OUT', 'STORAGE_IN']],
  ['Dry In first + checklist after it', ['DRY_IN', 'CL', 'DRY_OUT', 'STORAGE_IN']],
  ['checklist before a first Dry In', ['CL', 'DRY_IN', 'DRY_OUT']],
  ['Dry In last', ['WASH_IN', 'WASH_OUT', 'DRY_IN']],
  ['Dry In last + checklist', ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'CL']],
  ['Dry In without Dry Out', ['WASH_IN', 'DRY_IN', 'STORAGE_IN']],
  ['Dry Out without Dry In', ['WASH_IN', 'DRY_OUT', 'STORAGE_IN']],
  ['reverse order', ['STORAGE_OUT', 'DRY_OUT', 'DRY_IN', 'WASH_OUT', 'WASH_IN']],
  ['Wash Out last', ['WASH_IN', 'WASH_OUT']],
  ['Wash Out last + checklist', ['WASH_IN', 'WASH_OUT', 'CL']],
  ['Dry Out last + checklist', ['DRY_IN', 'DRY_OUT', 'CL']],
  ['Dry Out last', ['WASH_IN', 'DRY_IN', 'DRY_OUT']],
];

/** group: true = Wash In ×2 + Dry In instruments; 'washOnly' = a group with NO Dry In instrument. */
type Variant = { interlock: boolean; group: boolean | 'washOnly' };
const VARIANTS: Variant[] = [
  { interlock: false, group: true }, { interlock: false, group: false },
  { interlock: true, group: true }, { interlock: true, group: false },
];
const vLabel = (v: Variant & { offline?: boolean }) =>
  `${v.offline ? 'OFFLINE replay, ' : ''}interlock ${v.interlock ? 'ON' : 'off'}, ${v.group === 'washOnly' ? 'group without a Dry In instrument' : v.group ? 'equipment group' : 'no group'}`;

// One shape per root cause (A–F of the 2026-10-22 matrix), replayed offline.
const OFFLINE_CASES: Array<[cause: string, shape: string, variant: Variant]> = [
  ['A no Dry In instrument', 'Dry In without Dry Out', { interlock: false, group: false }],
  ['B checklist after a mid Dry In', 'Dry In first + checklist after it', { interlock: false, group: true }],
  ['C final Dry In', 'Dry In last', { interlock: false, group: true }],
  ['D final Dry In + checklist', 'Dry In last + checklist', { interlock: false, group: true }],
  ['E checklist before the first stage', 'checklist before the first stage', { interlock: false, group: false }],
  ['F final QA-gated stage', 'Wash Out last', { interlock: true, group: false }],
];

const fx = new FoFixture('FPM');
let app: FastifyInstance;
let APR = '';
let opH: Record<string, string>;
let aprH: Record<string, string>;
let grant = '';
const questionsByProfile = new Map<string, string[]>();
let ENABLED_CL = '';   // reused by every enabled checklist node (one optional + one required question)
let DISABLED_CL = '';
const results: Array<{ shape: string; variant: string; outcome: string }> = [];

const call = (method: 'GET' | 'POST', url: string, h: Record<string, string>, payload?: Record<string, unknown>) =>
  app.inject({ method, url, headers: h, ...(payload ? { payload: { _currentPassword: fx.password, ...payload } } : {}) });

/** A cycle write: online, or as the sync engine replays it (grant + offlinePerformedAt + clientOpId). */
const write = (offline: boolean, url: string, payload: Record<string, unknown>) =>
  offline
    ? app.inject({
        method: 'POST', url, headers: { ...opH, 'x-offline-replay-token': grant },
        payload: { offlinePerformedAt: new Date().toISOString(), clientOpId: randomUUID(), ...payload },
      })
    : call('POST', url, opH, payload);

/** START → tokens → END, chained; a FilterProfile on top. Returns ids + node ids per token. */
async function buildPipeline(name: string, tokens: string[]) {
  const nodes: any[] = [{ nodeType: 'START', stateKey: null, sortOrder: 0 }];
  tokens.forEach((t, i) => {
    if (t === 'CL' || t === 'CLX') {
      nodes.push({ nodeType: 'CHECKLIST', stateKey: null, sortOrder: i + 1, configuration: { checklistProfileId: t === 'CL' ? ENABLED_CL : DISABLED_CL } });
    } else {
      nodes.push({ nodeType: 'STAGE', stateKey: t, sortOrder: i + 1 });
    }
  });
  nodes.push({ nodeType: 'END', stateKey: null, sortOrder: tokens.length + 1 });
  const cp = await prisma.filterCleaningProfile.create({
    data: {
      name: fx.name(name.slice(0, 40)), lineageId: randomUUID(), status: 'ACTIVE', flowMode: 'STRICT',
      createdBy: randomUUID(), cleaningReasons: DEFAULT_REASONS as any, stages: { create: nodes },
    },
    include: { stages: true },
  });
  fx.cleaningProfileIds.push(cp.id);
  const ordered = [...cp.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  await prisma.filterPipelineConnection.createMany({
    data: ordered.slice(0, -1).map((from, i) => ({ profileId: cp.id, fromStageId: from.id, toStageId: ordered[i + 1].id })),
  });
  const fp = await prisma.filterProfile.create({ data: { name: fx.name(`FP ${name}`.slice(0, 40)), cleaningProfileId: cp.id } });
  fx.filterProfileIds.push(fp.id);
  const checklistNodes = ordered.filter((n) => n.nodeType === 'CHECKLIST')
    .map((n) => ({ id: n.id, enabled: (n.configuration as any).checklistProfileId === ENABLED_CL }));
  return { filterProfileId: fp.id, checklistNodes };
}

type Drive = { ok: true } | { ok: false; reason: string };

/** The reference client. Returns how the drive ended. */
async function drive(filterId: string, blockId: string, offline = false, checks: string[] = []): Promise<Drive> {
  const started = await write(offline, `/api/filters/${filterId}/start-cycle`, { cleaningReasonKey: 'ROUTINE', cleaningAreaId: blockId });
  if (started.statusCode !== 201) return { ok: false, reason: `start-cycle ${started.statusCode} ${started.json().error}` };
  const cycleId = started.json().id as string;

  for (let step = 0; step < 40; step++) {
    const res = await call('GET', `/api/filters/${filterId}/current-state`, opH);
    if (res.statusCode !== 200) return { ok: false, reason: `current-state ${res.statusCode} ${res.json().error}` };
    const s = res.json();
    if (!s.currentCycle) {
      const cyc = await prisma.cleaningCycle.findUnique({ where: { id: cycleId } });
      return cyc?.status === 'COMPLETED' ? { ok: true } : { ok: false, reason: `cycle ended ${cyc?.status}` };
    }
    const at = s.currentState ?? '(start)';

    // The two waiting states the 2026-10-22 rules create at the LAST stage. What
    // the tape offers there must be exactly what the server accepts — a button
    // the server refuses would strand the operator, and the steps below only
    // ever take the first actionable step, so check the whole offer here.
    const here = s.currentState ? s.stageLookup?.[s.currentState] : undefined;
    const atFinal = !!here && here.leadsToEnd && (here.nextStages ?? []).length === 0;
    const onward: string[] = (s.actions ?? []).map((a: any) => a.type).filter((t: string) => t !== 'TERMINATE_CYCLE' && t !== 'COMPLETE_CYCLE');
    if (atFinal && s.interlock?.status === 'PENDING') {
      // Waiting for QA: nothing to do but wait (the approval completes it).
      checks.push('final-pending');
      if (onward.length) return { ok: false, reason: `offers [${onward.join(', ')}] at ${at} while its approval is PENDING` };
    }
    const cyc = s.currentCycle;
    if (atFinal && s.currentState === 'DRY_IN' && cyc.dryerStartedAt && !cyc.dryerReadingsSubmitted
      && Date.now() - new Date(cyc.dryerStartedAt).getTime() >= (cyc.dryerDurationMinutes * 60_000) / 2) {
      // A final Dry In at half time: the readings — and only the readings — finish it.
      checks.push('final-dry-in');
      if (JSON.stringify(onward) !== '["SUBMIT_DRYER_READINGS"]') return { ok: false, reason: `final Dry In offers [${onward.join(', ')}], not just the readings` };
    }

    // QA stage interlock: the approver releases the operator.
    if (s.interlock?.blocksLeaving && s.interlock.status === 'PENDING' && s.interlock.approvalId) {
      const a = await call('POST', `/api/stage-approvals/${s.interlock.approvalId}/approve`, aprH, { remarks: 'released' });
      if (a.statusCode !== 200) return { ok: false, reason: `approve at ${at}: ${a.statusCode} ${a.json().error}` };
      continue;
    }

    const actions: any[] = s.actions ?? [];
    const checklists = actions.filter((a) => a.type === 'SUBMIT_CHECKLIST');
    const readings = actions.find((a) => a.type === 'SUBMIT_DRYER_READINGS');
    const setDur = actions.find((a) => a.type === 'SET_DRYER_DURATION');
    const adv = actions.find((a) => a.type === 'ADVANCE_TO_STAGE');
    const tapeVersion = s.tapeVersion;

    let r;
    let what = '';
    if (checklists.length > 0) {
      const answers: Record<string, string> = {};
      for (const c of checklists) for (const q of c.params.questions) answers[q.id] = 'YES';
      what = `submit-checklist at ${at}`;
      r = await write(offline, `/api/filters/${filterId}/submit-checklist`, { answers, tapeVersion });
    } else if (readings) {
      const instrumentReadings: Record<string, number> = {};
      for (const id of readings.params.instrumentIds) instrumentReadings[id] = readings.validations.operatingRanges[id].min;
      const body = {
        targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', tapeVersion,
        ...(Object.keys(instrumentReadings).length ? { instrumentReadings, equipmentGroupId: s.equipmentGroup?.id } : {}),
      };
      // The readings finish a FINAL Dry In: the checklist after it rides on them.
      const entry = s.stageLookup?.DRY_IN;
      if (advanceMustCarryChecklist(entry, s.disabledChecklistProfileIds, { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' })) {
        const answers: Record<string, string> = {};
        for (const p of entry.pendingChecklistProfileIds) for (const q of questionsByProfile.get(p) ?? []) answers[q] = 'YES';
        what = `SUBMIT_READINGS + checklist at ${at}`;
        r = await write(offline, `/api/filters/${filterId}/advance-with-checklist`, { ...body, answers });
      } else {
        what = `SUBMIT_READINGS at ${at}`;
        r = await write(offline, `/api/filters/${filterId}/advance`, body);
      }
    } else if (setDur) {
      what = `SET_DURATION ${at} → DRY_IN`;
      r = await write(offline, `/api/filters/${filterId}/advance`, {
        targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 2, tapeVersion,
      });
    } else if (adv) {
      const target: string = adv.params.targetState;
      const entry = s.stageLookup?.[target];
      const pending: string[] = (entry?.pendingChecklistProfileIds ?? []).filter((id: string) => !(s.disabledChecklistProfileIds ?? []).includes(id));
      const instrumentReadings: Record<string, number> = {};
      for (const id of adv.params.requiresInstrumentReadings ?? []) instrumentReadings[id] = adv.validations.operatingRanges[id].min;
      const base = {
        targetState: target, tapeVersion,
        ...(Object.keys(instrumentReadings).length ? { instrumentReadings, equipmentGroupId: s.equipmentGroup?.id } : {}),
      };
      if (pending.length > 0 && !entry?.interlockGated) {
        const answers: Record<string, string> = {};
        for (const p of pending) for (const q of questionsByProfile.get(p) ?? []) answers[q] = 'YES';
        what = `advance-with-checklist ${at} → ${target}`;
        r = await write(offline, `/api/filters/${filterId}/advance-with-checklist`, { ...base, answers });
      } else {
        what = `advance ${at} → ${target}`;
        r = await write(offline, `/api/filters/${filterId}/advance`, base);
      }
    } else if (s.currentState === 'DRY_IN' && s.currentCycle.dryerStartedAt && !s.currentCycle.dryerReadingsSubmitted
      && Date.now() - new Date(s.currentCycle.dryerStartedAt).getTime() < (s.currentCycle.dryerDurationMinutes * 60_000) / 2) {
      // The dryer is still inside its first half: time passes.
      await prisma.cleaningCycle.update({ where: { id: cycleId }, data: { dryerStartedAt: new Date(Date.now() - s.currentCycle.dryerDurationMinutes * 60_000) } });
      continue;
    } else {
      const offered = actions.map((a) => a.type).filter((t) => t !== 'TERMINATE_CYCLE');
      return { ok: false, reason: `STUCK at ${at}: tape offers [${offered.join(', ') || 'nothing'}]` };
    }
    if (r.statusCode !== 200) return { ok: false, reason: `${what}: ${r.statusCode} ${r.json().error}` };
  }
  return { ok: false, reason: 'STUCK: no completion after 40 steps' };
}

beforeAll(async () => {
  app = await buildApp([
    { plugin: filterOperationsRoutes, prefix: '/api/filters' },
    { plugin: stageApprovalRoutes, prefix: '/api/stage-approvals' },
  ]);
  const op = await fx.user('op', 'SUPER_ADMIN');
  APR = await fx.role('APR', ['STAGE_APPROVAL_VIEW', 'STAGE_APPROVAL_DECIDE']);
  const apr = await fx.user('apr', APR);
  cfg.washOutApproverRole = APR; cfg.dryOutApproverRole = APR;
  const on = await fx.checklist('ON', [{ question: 'Inspected?', required: true }, { question: 'Remarks?', required: false }]);
  ENABLED_CL = on.id; questionsByProfile.set(on.id, on.questionIds);
  const off = await fx.checklist('OFF', [{ question: 'Disabled question', required: true }], false);
  DISABLED_CL = off.id; questionsByProfile.set(off.id, off.questionIds);
  opH = await fx.login(app, op.username);
  aprH = await fx.login(app, apr.username);
  grant = await obtainOfflineGrant(app, opH.authorization.slice(7), fx.password);
}, 60_000);

afterAll(async () => {
  // eslint-disable-next-line no-console
  console.log(['MATRIX|shape|variant|outcome', ...results.map((r) => `MATRIX|${r.shape}|${r.variant}|${r.outcome}`)].join('\n'));
  try { await fx.cleanup(); } finally { await app?.close(); }
}, 120_000);

async function runCase(shape: string, tokens: string[], variant: Variant, offline: boolean) {
  cfg.enabled = variant.interlock;
  internalErrors.length = 0;
  const block = await fx.node('BLOCK', 'B');
  const ahu = await fx.node('AHU', 'A', block);
  if (variant.group === 'washOnly') {
    await fx.equipmentGroup(block, 'G', [{ stageKey: 'WASH_IN', min: 10, max: 20 }, { stageKey: 'WASH_IN', min: 1, max: 5 }]);
  } else if (variant.group) {
    await fx.equipmentGroup(block, 'G', [
      { stageKey: 'WASH_IN', min: 10, max: 20 }, { stageKey: 'WASH_IN', min: 1, max: 5 }, { stageKey: 'DRY_IN', min: 60, max: 80 },
    ]);
  }
  const { filterProfileId, checklistNodes } = await buildPipeline(shape, tokens);
  const f = await fx.filter('F', ahu, filterProfileId);

  const checks: string[] = [];
  const outcome = await drive(f, block, offline, checks);
  const problems: string[] = outcome.ok ? [] : [outcome.reason];

  if (outcome.ok) {
    const cycle = (await prisma.cleaningCycle.findFirst({ where: { filterId: f } }))!;
    const events = await prisma.filterEvent.findMany({ where: { cycleId: cycle.id }, orderBy: { performedAt: 'asc' } });
    // Every stage entered, in pipeline order (in-place dryer steps are not entries).
    const entered = events
      .filter((e) => e.eventType === 'STATE_TRANSITION' && !!e.toState && isEntryIntoStage(e, e.toState))
      .map((e) => e.toState);
    const stages = tokens.filter((t) => t !== 'CL' && t !== 'CLX');
    // The waiting-state checks in drive() really ran where they apply.
    const last = stages[stages.length - 1];
    if (last === 'DRY_IN' && !checks.includes('final-dry-in')) problems.push('final Dry In offer never checked');
    if (variant.interlock && !offline && (last === 'WASH_OUT' || last === 'DRY_OUT') && !checks.includes('final-pending')) {
      problems.push('final gated stage offer never checked');
    }
    if (JSON.stringify(entered) !== JSON.stringify(stages)) problems.push(`entered ${JSON.stringify(entered)} ≠ ${JSON.stringify(stages)}`);
    if (events.filter((e) => e.eventType === 'CYCLE_COMPLETED').length !== 1) problems.push('CYCLE_COMPLETED not exactly once');
    // Every enabled checklist node recorded once; disabled never.
    const recorded = new Map<string, number>();
    for (const e of events.filter((x) => x.eventType === 'CHECKLIST_COMPLETED')) {
      for (const c of ((e.attributes as any)?.checklists ?? [])) recorded.set(c.pipelineNodeId, (recorded.get(c.pipelineNodeId) ?? 0) + 1);
    }
    for (const n of checklistNodes) {
      const got = recorded.get(n.id) ?? 0;
      if (n.enabled && got !== 1) problems.push(`checklist node recorded ${got}×`);
      if (!n.enabled && got !== 0) problems.push(`disabled checklist recorded ${got}×`);
    }
    // Dryer timing (+ the temperature when a Dry In instrument exists).
    if (stages.includes('DRY_IN')) {
      if (!cycle.dryerStartedAt || !cycle.dryerDurationMinutes) problems.push('dryer never started');
      if (!cycle.dryerReadingsSubmitted) problems.push('dryer readings never submitted');
      if (variant.group === true && !events.some((e) => (e.attributes as any)?.action === 'DRYER_READINGS_SUBMITTED' && ((e.attributes as any)?.instrumentReadings ?? []).length > 0)) {
        problems.push('no Dry In temperature recorded');
      }
    }
    // Offline: every write really took the replay path (it records the skipped re-auth).
    if (offline) {
      const writes = events.filter((e) => e.eventType === 'STATE_TRANSITION' || e.eventType === 'CHECKLIST_COMPLETED');
      if (writes.some((e) => !((e.attributes as any)?.replayExemptGates ?? []).includes('REAUTH'))) problems.push('a write did not go through offline replay');
    }
  }
  if (internalErrors.length) problems.push(`500: ${internalErrors.map((e) => e.err.message).join('; ')}`);
  results.push({ shape, variant: vLabel({ ...variant, offline }), outcome: problems.length ? problems.join(' / ') : 'COMPLETES' });
  return problems;
}

describe.each(VARIANTS)('pipeline shapes — %o', (variant) => {
  it.each(SHAPES)('%s completes', async (shape, tokens) => {
    expect(await runCase(shape, tokens, variant, false)).toEqual([]);
  });
});

// A (no Dry In instrument) where the block HAS a group — readings for Wash In, none for Dry In.
const NO_DRY_IN_INSTRUMENT: Array<[shape: string, offline: boolean]> = [
  ['Dry In without Dry Out', false],
  ['Dry In last + checklist', false],
  ['Dry In first + checklist after it', true],
];

describe('pipeline shapes — a group with no Dry In instrument', () => {
  it.each(NO_DRY_IN_INSTRUMENT)('%s completes (offline replay: %s)', async (shape, offline) => {
    const tokens = SHAPES.find(([n]) => n === shape)![1];
    expect(await runCase(shape, tokens, { interlock: false, group: 'washOnly' }, offline)).toEqual([]);
  });
});

describe('pipeline shapes — offline replay (one per root cause)', () => {
  it.each(OFFLINE_CASES)('%s: %s completes', async (_cause, shape, variant) => {
    const tokens = SHAPES.find(([n]) => n === shape)![1];
    expect(await runCase(shape, tokens, variant, true)).toEqual([]);
  });
});

describe('E: the checklist before the first stage, through the combined start-and-advance (2026-10-22)', () => {
  const bulk = (items: unknown[]) => call('POST', '/api/filters/bulk-operate', opH, { items });

  it('start-and-advance starts the cycle, refuses the entry with a clear reason, and the cycle is not stranded', async () => {
    cfg.enabled = false;
    const block = await fx.node('BLOCK', 'EB');
    const ahu = await fx.node('AHU', 'EA', block);
    const { filterProfileId, checklistNodes } = await buildPipeline('E start-and-advance', ['CL', 'WASH_IN', 'WASH_OUT']);
    const f = await fx.filter('EF', ahu, filterProfileId);
    const op1 = randomUUID();
    const item = { clientOpId: op1, filterId: f, kind: 'start-and-advance', cyclePayload: { cleaningReasonKey: 'ROUTINE', cleaningAreaId: block }, advancePayload: { targetState: 'WASH_IN' } };

    const first = await bulk([item]);
    expect(first.statusCode).toBe(200);
    expect(first.json().results[0]).toMatchObject({
      status: 'failed',
      error: { code: 'CHECKLIST_PENDING', message: 'Answer the checklist that comes before the first stage, then enter the first stage.' },
    });
    // The start committed; the cycle waits at START with the checklist on its tape.
    const s = (await call('GET', `/api/filters/${f}/current-state`, opH)).json();
    expect(s.currentCycle?.status).toBe('IN_PROGRESS');
    expect(s.currentState).toBeNull();
    const submit = s.actions.find((a: any) => a.type === 'SUBMIT_CHECKLIST');
    expect(submit?.params.afterStage).toBeNull();
    expect(s.actions.map((a: any) => a.type)).not.toContain('ADVANCE_TO_STAGE');

    // Answer it (the batch's own submit-checklist kind), then the SAME combined item again.
    const answers = Object.fromEntries(submit.params.questions.map((q: any) => [q.id, 'YES']));
    const answered = await bulk([{ clientOpId: randomUUID(), filterId: f, kind: 'submit-checklist', payload: { answers, tapeVersion: s.tapeVersion } }]);
    expect(answered.json().results[0].status).toBe('ok');
    const retry = await bulk([item]);
    expect(retry.json().results[0]).toMatchObject({ status: 'ok', snapshot: { currentState: 'WASH_IN' } });

    const events = await prisma.filterEvent.findMany({ where: { filterId: f, eventType: 'CHECKLIST_COMPLETED' } });
    expect(events.map((e) => [(e.attributes as any).afterStage, (e.attributes as any).checklists.map((c: any) => c.pipelineNodeId)]))
      .toEqual([[null, [checklistNodes[0].id]]]);
    expect(await prisma.cleaningCycle.count({ where: { filterId: f } })).toBe(1);
  });

  it('an offline queue from a tablet that never asked it (built before 2026-10-22) is applied, the skip recorded', async () => {
    cfg.enabled = false;
    const block = await fx.node('BLOCK', 'EOB');
    const ahu = await fx.node('AHU', 'EOA', block);
    const { filterProfileId } = await buildPipeline('E old offline queue', ['CL', 'WASH_IN', 'WASH_OUT']);
    const f = await fx.filter('EOF', ahu, filterProfileId);
    expect((await write(true, `/api/filters/${f}/start-cycle`, { cleaningReasonKey: 'ROUTINE', cleaningAreaId: block })).statusCode).toBe(201);
    const s = (await call('GET', `/api/filters/${f}/current-state`, opH)).json();
    const res = await write(true, `/api/filters/${f}/advance`, { targetState: 'WASH_IN', tapeVersion: s.tapeVersion });
    expect(res.statusCode).toBe(200);
    const ev = await prisma.filterEvent.findFirst({ where: { filterId: f, toState: 'WASH_IN' } });
    expect((ev!.attributes as any).replayExemptGates).toEqual(['REAUTH', 'START_CHECKLIST']);
  });
});
