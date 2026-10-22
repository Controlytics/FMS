/**
 * PATCH /api/assets/instances/:id/lifecycle-state — the manual "Edit Filter
 * Status" path, through the real harness app and real Prisma.
 *
 * Every filter here carries an explicit filterProfileId pointing at this
 * suite's own cleaning profile (with its own cleaning reasons): without it the
 * resolver falls back to the oldest ACTIVE cleaning profile on the shared
 * database, which belongs to someone else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { internalErrors } from '../../../e2e/test-helper.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from './slice-support.js';

const own = new SliceOwner(runTag('CVLC'));
let app: FastifyInstance;
let sa: { id: string; call: Caller };
let lc: { id: string; call: Caller };
let editOnly: { call: Caller };
let cpId: string;
let fpId: string;
let fA: string;
let fPending: string;
let fRejected: string;
let fNoCycle: string;
let fBare: string;

const move = (who: { call: Caller }, id: string, body: Record<string, unknown>, pw?: string) =>
  who.call('PATCH', `/api/assets/instances/${id}/lifecycle-state`, { body, pw });
const detailsOf = (id: string) => prisma.filterDetails.findUnique({ where: { assetInstanceId: id } });
const eventsOf = (id: string) => prisma.filterEvent.findMany({ where: { filterId: id }, orderBy: [{ performedAt: 'asc' }, { createdAt: 'asc' }] });

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const lcRole = await own.role('LC', ['ASSET_VIEW', 'FILTER_STATUS_UPDATE']);
  lc = await own.user(app, 'lc', lcRole);
  editOnly = await own.user(app, 'eo', await own.role('EO', ['ASSET_VIEW', 'ASSET_UPDATE']));
  await own.reauth(['UPDATE_FILTER_LIFECYCLE'], lcRole);

  await own.template('FILTER', { isActive: true });
  const blockId = await own.instance('BLOCK', await own.template('BLOCK'));
  const ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  // ARCHIVED on purpose: the manual path does not need an ACTIVE profile, and an
  // ACTIVE one would become every other suite's fallback default.
  cpId = (await own.cleaningProfile('CP', ['WASH_IN', 'WASH_OUT', 'DRY_IN'], sa.id, { status: 'ARCHIVED' })).id;
  fpId = await own.filterProfile('FP', cpId);
  fA = await own.filter('FA', ahuId, { filterProfileId: fpId });
  fPending = await own.filter('FP-PEND', ahuId, { filterProfileId: fpId });
  fRejected = await own.filter('FP-REJ', ahuId, { filterProfileId: fpId });
  fNoCycle = await own.filter('FN', ahuId, { filterProfileId: fpId });
  fBare = randomUUID();
  await prisma.filter.create({ data: { id: fBare, ahuId, name: own.n('FBARE'), status: 'Active', attributes: {} } });
  await prisma.assetInstance.update({ where: { id: fPending }, data: { approvalStatus: 'PENDING_REVIEW' } });
  await prisma.assetInstance.update({ where: { id: fRejected }, data: { approvalStatus: 'REJECTED' } });
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('lifecycle-state — gates', () => {
  it('needs FILTER_STATUS_UPDATE (ASSET_UPDATE is not enough), schema-valid input and, when configured, the password', async () => {
    const forbidden = await move(editOnly, fA, { lifecycleState: 'WASH_IN', remarks: 'x' });
    expect(forbidden.status).toBe(403);
    internalErrors.length = 0;
    expect((await move(sa, fA, { lifecycleState: 'BOGUS', remarks: 'x' }, PASSWORD)).status).toBe(400);
    expect((await move(sa, fA, { lifecycleState: 'WASH_IN' }, PASSWORD)).status).toBe(400);
    expect((await move(sa, fA, { lifecycleState: 'WASH_IN', remarks: '' }, PASSWORD)).status).toBe(400);
    const noPw = await move(lc, fA, { lifecycleState: 'WASH_IN', remarks: 'x', cleaningReasonKey: 'PM' });
    expect(noPw.status).toBe(401);
    expect(noPw.body).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPDATE_FILTER_LIFECYCLE' });
    expect(await prisma.filterEvent.count({ where: { filterId: fA } })).toBe(0);
    expect(internalErrors).toEqual([]);
  });

  it('refuses a filter that has not passed the creation workflow, naming why', async () => {
    const pending = await move(sa, fPending, { lifecycleState: 'INSTALLED', remarks: 'x' }, PASSWORD);
    expect(pending.status).toBe(409);
    expect(pending.body).toMatchObject({
      error: 'FILTER_NOT_APPROVED',
      message: `Filter "${own.n('FP-PEND')}" is still awaiting review/approval, so it cannot be operated yet.`,
      details: { approvalStatus: 'PENDING_REVIEW' },
    });
    const rejected = await move(sa, fRejected, { lifecycleState: 'INSTALLED', remarks: 'x' }, PASSWORD);
    expect(rejected.body.message).toBe(`Filter "${own.n('FP-REJ')}" was rejected and must be corrected and re-submitted, so it cannot be operated yet.`);
    const missing = await move(sa, randomUUID(), { lifecycleState: 'INSTALLED', remarks: 'x' }, PASSWORD);
    expect(missing.status).toBe(404);
  });

  it('refuses a forward skip and lists the moves that ARE allowed', async () => {
    const res = await move(sa, fA, { lifecycleState: 'WASH_OUT', remarks: 'skip' }, PASSWORD);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Invalid stage movement. Please follow the configured cleaning profile sequence. Allowed next for this filter: Wash In, Cleaning Cycle Completed.');
  });

  it('a move that starts a cycle needs a valid cleaning reason (and a justification when the reason demands one)', async () => {
    const none = await move(sa, fA, { lifecycleState: 'WASH_IN', remarks: 'go' }, PASSWORD);
    expect(none.body).toMatchObject({ error: 'REASON_REQUIRED' });
    const bad = await move(sa, fA, { lifecycleState: 'WASH_IN', remarks: 'go', cleaningReasonKey: 'NOPE' }, PASSWORD);
    expect(bad.body).toMatchObject({ error: 'INVALID_REASON', message: 'Invalid cleaning reason: NOPE' });
    const short = await move(sa, fA, { lifecycleState: 'WASH_IN', remarks: 'go', cleaningReasonKey: 'BD', cleaningJustification: 'too short' }, PASSWORD);
    expect(short.body).toMatchObject({ error: 'JUSTIFICATION_REQUIRED' });
    expect(await prisma.cleaningCycle.count({ where: { filterId: fA } })).toBe(0);
  });
});

let cycle1: string;
let cycle2: string;

describe('lifecycle-state — the cycle it drives', () => {
  it('START: opens a manual cycle, records the stage event on it, and audits (signed) inside the same transaction', async () => {
    const res = await move(lc, fA, { lifecycleState: 'WASH_IN', remarks: ' manual start ', cleaningReasonKey: 'PM' }, PASSWORD);
    expect(res.status).toBe(200);
    const d = await detailsOf(fA);
    cycle1 = d!.currentCycleId!;
    expect(res.body.data).toMatchObject({ id: fA, currentLifecycleState: 'WASH_IN', currentCycleId: cycle1 });
    const cycle = await prisma.cleaningCycle.findUnique({ where: { id: cycle1 } });
    expect(cycle).toMatchObject({ status: 'IN_PROGRESS', profileId: cpId, cleaningReasonKey: 'PM', cleaningReasonLabel: 'Preventive maintenance', sequenceNumber: 1 });
    expect(cycle!.cycleCode).toMatch(new RegExp(`^CC-${own.n('FA')}-001-\\d{8}-M$`));
    // Both rows share one timestamp (same transaction), so compare by type.
    const events = (await eventsOf(fA)).sort((a, b) => a.eventType.localeCompare(b.eventType));
    expect(events.map((e) => [e.eventType, e.fromState, e.toState, e.cycleId])).toEqual([
      ['CYCLE_STARTED', null, null, cycle1],
      ['STATE_TRANSITION', null, 'WASH_IN', cycle1],
    ]);
    expect(events[1]).toMatchObject({ performedBy: lc.id, remarks: 'manual start', attributes: { manual: true, source: 'MANUAL', remarks: 'manual start' } });
    expect(events[1].checksum).toMatch(/^[0-9a-f]{64}$/);
    const [audit] = await auditFor(fA, 'FILTER_LIFECYCLE_STATE_CHANGED');
    expect(audit.beforeValue).toEqual({ currentLifecycleState: null });
    expect(audit.afterValue).toEqual({ currentLifecycleState: 'WASH_IN', newCycleReason: 'PM' });
    expect(audit.reason).toBe('Lifecycle state: "None" → "WASH_IN" (new cleaning cycle started) —  manual start ');
    expect(audit.signatureAuditId).toBeTruthy();
  });

  it('FORWARD: attaches to the running cycle, no new cycle', async () => {
    const res = await move(sa, fA, { lifecycleState: 'WASH_OUT', remarks: 'next' }, PASSWORD);
    expect(res.status).toBe(200);
    expect(await prisma.cleaningCycle.count({ where: { filterId: fA } })).toBe(1);
    const last = (await eventsOf(fA)).at(-1)!;
    expect(last).toMatchObject({ eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', cycleId: cycle1 });
    const [audit] = await auditFor(fA, 'FILTER_LIFECYCLE_STATE_CHANGED');
    expect(audit.afterValue).toEqual({ currentLifecycleState: 'WASH_OUT' });
  });

  it('BACKWARD with a running cycle: breaks it (TERMINATED, broken event) and starts a fresh one from the target stage', async () => {
    const res = await move(sa, fA, { lifecycleState: 'WASH_IN', remarks: 'redo', cleaningReasonKey: 'BD', cleaningJustification: '  pressure dropped mid wash  ' }, PASSWORD);
    expect(res.status).toBe(200);
    const old = await prisma.cleaningCycle.findUnique({ where: { id: cycle1 } });
    expect(old).toMatchObject({ status: 'TERMINATED' });
    expect(old!.terminatedAt).toBeTruthy();
    cycle2 = (await detailsOf(fA))!.currentCycleId!;
    expect(cycle2).not.toBe(cycle1);
    const fresh = await prisma.cleaningCycle.findUnique({ where: { id: cycle2 } });
    expect(fresh).toMatchObject({ status: 'IN_PROGRESS', cleaningReasonKey: 'BD', cleaningJustification: 'pressure dropped mid wash', sequenceNumber: 2 });
    const broken = await prisma.filterEvent.findFirst({ where: { cycleId: cycle1, eventType: 'CYCLE_TERMINATED' } });
    expect(broken!.attributes).toMatchObject({ manual: true, broken: true, reason: 'Interrupted by backward manual move to WASH_IN' });
    const [audit] = await auditFor(fA, 'FILTER_LIFECYCLE_STATE_CHANGED');
    expect(audit.afterValue).toEqual({ currentLifecycleState: 'WASH_IN', cycleBrokenAndRestarted: true, newCycleReason: 'BD' });
    expect(audit.reason).toContain('(active cleaning cycle interrupted/broken; new cycle started)');
  });

  it('COMPLETED with a running cycle: force-completes it and clears the cycle pointer', async () => {
    const res = await move(sa, fA, { lifecycleState: 'CLEANING_CYCLE_COMPLETED', remarks: 'done by hand' }, PASSWORD);
    expect(res.status).toBe(200);
    expect(await prisma.cleaningCycle.findUnique({ where: { id: cycle2 } })).toMatchObject({ status: 'COMPLETED' });
    expect(await detailsOf(fA)).toMatchObject({ currentLifecycleState: 'CLEANING_CYCLE_COMPLETED', currentCycleId: null });
    const done = await prisma.filterEvent.findFirst({ where: { cycleId: cycle2, eventType: 'CYCLE_COMPLETED' } });
    expect(done!.attributes).toMatchObject({ manualForceComplete: true, remarks: 'done by hand', sequenceNumber: 2 });
    const [audit] = await auditFor(fA, 'FILTER_LIFECYCLE_STATE_CHANGED');
    expect(audit.afterValue).toEqual({ currentLifecycleState: 'CLEANING_CYCLE_COMPLETED', cycleForceCompleted: true });
    expect(audit.signatureMeaning).toContain('and its active cleaning cycle was force-completed');
    const read = await sa.call('GET', `/api/hierarchy/filters/${fA}`);
    expect(read.body.lastCleanedAt).not.toBeNull();
  });

  it('an operational state with no running cycle attaches the event to the most recent cycle; with no cycle at all, to none', async () => {
    const res = await move(sa, fA, { lifecycleState: 'INSTALLED', remarks: 'back in the AHU' }, PASSWORD);
    expect(res.status).toBe(200);
    const last = (await eventsOf(fA)).at(-1)!;
    expect(last).toMatchObject({ toState: 'INSTALLED', cycleId: cycle2, fromState: 'CLEANING_CYCLE_COMPLETED' });
    expect(await prisma.cleaningCycle.count({ where: { filterId: fA } })).toBe(2);

    const lone = await move(sa, fNoCycle, { lifecycleState: 'INSTALLED', remarks: 'fitted' }, PASSWORD);
    expect(lone.status).toBe(200);
    const ev = await eventsOf(fNoCycle);
    expect(ev.map((e) => [e.toState, e.cycleId])).toEqual([['INSTALLED', null]]);
    // Completion with nothing running only moves the state.
    const complete = await move(sa, fNoCycle, { lifecycleState: 'CLEANING_CYCLE_COMPLETED', remarks: 'paperwork' }, PASSWORD);
    expect(complete.status).toBe(200);
    expect(await prisma.cleaningCycle.count({ where: { filterId: fNoCycle } })).toBe(0);
    expect(await detailsOf(fNoCycle)).toMatchObject({ currentLifecycleState: 'CLEANING_CYCLE_COMPLETED', currentCycleId: null });
  });

  it('a legacy filter with no FilterDetails row gets one on its first manual move', async () => {
    expect(await detailsOf(fBare)).toBeNull();
    const res = await move(sa, fBare, { lifecycleState: 'IN_USE', remarks: 'legacy' }, PASSWORD);
    expect(res.status).toBe(200);
    expect(await detailsOf(fBare)).toMatchObject({ currentLifecycleState: 'IN_USE' });
  });
});
