/**
 * PM schedules — the entry approval workflow, the entry list / counts / Excel
 * export, and the QNN report, through the real routes.
 *
 *   workflow ON : PENDING_REVIEW →(review)→ PENDING_APPROVAL →(approve)→ APPROVED
 *                 reject at either step → REJECTED →(resubmit)→ PENDING_REVIEW
 *   workflow OFF: PENDING →(approve)→ APPROVED / REJECTED
 *
 * Covers the role gates (route permission AND the configured workflow role),
 * segregation of duties by USER, mandatory remarks, the separation check on
 * every single-entry write — including the re-check when a staged edit goes
 * live at approval — batch QNN tags, and audit rows for every transition.
 *
 * Own SUPER_ADMINs, roles, users and AHUs; PM config (and the date format the
 * export uses) served in-process (pm-fixtures.ts). Entries are in YEAR.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import pmScheduleRoutes from '../modules/pm-schedules/routes.js';
import {
  PmFixture, installConfigOverrides, defaultPmConfig, iso, DAY, type ConfigOverrides,
} from '../modules/pm-schedules/__tests__/pm-fixtures.js';

const fx = new PmFixture('PMW');
const YEAR = 2092;
const STARTED = new Date();

let app: FastifyInstance;
let cfg: ConfigOverrides;
let notifyRole: string, REV: string, APR: string;
const u: Record<string, { id: string; username: string }> = {};
const tok: Record<string, string> = {};
let W1: string, W2: string, w1Id: string, w2Id: string;
let s1: string, s2: string; // schedule ids
let ghostScheduleId = '';

const wfOn = () => cfg.set('pm-schedule-approval', { workflowEnabled: true, uploadRole: '', reviewRole: REV, approvalRole: APR });
const wfOff = () => cfg.set('pm-schedule-approval', { workflowEnabled: false, uploadRole: '', reviewRole: REV, approvalRole: APR });

const call = (method: string, url: string, k: string, payload?: unknown, pw?: string) =>
  app.inject({
    method: method as any, url: `/api/pm-schedules${url}`,
    headers: { authorization: `Bearer ${tok[k]}`, ...(pw ? { 'x-reauth-password': pw } : {}) },
    ...(payload !== undefined ? { payload: payload as any } : {}),
  });

let dayCursor = 0;
/** A fresh entry on `scheduleId`, each one a week after the last so none overlap. */
async function entry(scheduleId: string, status: string, extra: Record<string, unknown> = {}, tol = 1) {
  const planned = new Date(Date.UTC(YEAR, 0, 5) + (dayCursor++) * 7 * DAY);
  const row = await prisma.pmScheduleEntry.create({
    data: {
      scheduleId, month: planned.getUTCMonth() + 1, plannedDate: planned, toleranceDays: tol,
      windowStart: new Date(planned.getTime() - tol * DAY), windowEnd: new Date(planned.getTime() + tol * DAY),
      approvalStatus: status as any, ...extra,
    },
  });
  return row;
}
const get = (id: string) => prisma.pmScheduleEntry.findUniqueOrThrow({ where: { id } });
const audits = (action: string, targetId: string) =>
  prisma.auditTrail.findMany({ where: { action, targetId }, orderBy: { chainPosition: 'asc' } });
const qnnsFor = (entryId: string) =>
  prisma.qualityNotification.findMany({ where: { pmScheduleEntryId: entryId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  app = await buildApp([{ plugin: pmScheduleRoutes, prefix: '/api/pm-schedules' }]);
  notifyRole = await fx.role('NOTE', ['DASHBOARD_VIEW']);
  cfg = installConfigOverrides({
    ...defaultPmConfig(notifyRole),
    datetime: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' },
  });
  REV = await fx.role('REV', ['PM_READ', 'PM_REVIEW']);
  APR = await fx.role('APR', ['PM_READ', 'PM_APPROVE']);
  const MIX = await fx.role('MIX', ['PM_READ', 'PM_REVIEW', 'PM_APPROVE']);
  const EDT = await fx.role('EDT', ['PM_READ', 'PM_EDIT_ENTRY', 'PM_RESUBMIT']);
  const RO = await fx.role('RO', ['PM_READ']);
  for (const [k, role] of [['sa', 'SUPER_ADMIN'], ['sa2', 'SUPER_ADMIN'], ['rev', REV], ['apr', APR], ['mix', MIX], ['edt', EDT], ['ro', RO]] as const) {
    u[k] = await fx.user(k, role);
    tok[k] = await fx.login(app, u[k].username);
  }
  const block = await fx.instance('BLOCK', 'BLOCK');
  w1Id = await fx.instance('AHU', 'W1', { parentId: block });
  // A name an attacker could make a spreadsheet formula of — the export must neutralise it.
  w2Id = await fx.instance('AHU', 'W2', { parentId: block });
  await prisma.assetInstance.update({ where: { id: w2Id }, data: { name: `=${fx.tag}-W2` } });
  W1 = `${fx.tag}-W1`;
  W2 = `=${fx.tag}-W2`;
  s1 = (await fx.schedule(w1Id, YEAR, u.sa.id, [])).scheduleId;
  s2 = (await fx.schedule(w2Id, YEAR, u.sa.id, [])).scheduleId;
}, 120_000);

afterAll(async () => {
  // The orphaned-AHU schedule is not under one of the fixture's AHUs; entries cascade.
  if (ghostScheduleId) await prisma.pmSchedule.deleteMany({ where: { id: ghostScheduleId } });
  await fx.cleanup(app);
}, 120_000);

beforeEach(() => {
  for (const [k, v] of Object.entries(defaultPmConfig(notifyRole))) cfg.set(k, v);
  wfOn();
});

describe('re-auth gates on every workflow write', () => {
  it.each([
    ['POST', '/entries/review', { entryIds: ['00000000-0000-4000-8000-000000000001'], action: 'approve', remarks: 'dates checked' }, 'REVIEW_PM_SCHEDULE'],
    ['POST', '/entries/approve', { entryIds: ['00000000-0000-4000-8000-000000000001'], comment: 'approved' }, 'APPROVE_PM_SCHEDULE'],
    ['POST', '/entries/reject', { entryIds: ['00000000-0000-4000-8000-000000000001'], remarks: 'no good' }, 'REJECT_PM_SCHEDULE'],
    // D03-09 / F-42: resubmit / edit refuse an unknown or ineligible entry BEFORE
    // the gate, so these probes use a REAL entry in the right state.
    ['POST', '/entries/:REJECTED/resubmit', { plannedDate: `${YEAR}-01-01` }, 'RESUBMIT_PM_ENTRY'],
    ['PUT', '/entries/:APPROVED/edit', { plannedDate: `${YEAR}-01-01` }, 'EDIT_PM_SCHEDULE'],
    ['PUT', '/entries/00000000-0000-4000-8000-000000000001/review-edit', { plannedDate: `${YEAR}-01-01` }, 'REVIEW_PM_SCHEDULE'],
  ])('%s %s asks for the password (%s)', async (method, url, body, action) => {
    cfg.set('action-reauth', { [action]: ['SUPER_ADMIN'] });
    let path = url;
    for (const status of ['REJECTED', 'APPROVED']) {
      if (path.includes(`:${status}`)) path = path.replace(`:${status}`, (await entry(s1, status)).id);
    }
    const res = await call(method, path, 'sa', body);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action });
  });

  it('with the password, the request reaches the service (here: 404 for an unknown entry)', async () => {
    cfg.set('action-reauth', { RESUBMIT_PM_ENTRY: ['SUPER_ADMIN'] });
    const res = await call('POST', '/entries/00000000-0000-4000-8000-000000000001/resubmit', 'sa', { plannedDate: `${YEAR}-01-01` }, fx.password);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});

describe('review → approve (workflow ON)', () => {
  it('route permission gates first: PM_REVIEW for review, PM_APPROVE for approve/reject', async () => {
    const r1 = await call('POST', '/entries/review', 'apr', { entryIds: ['00000000-0000-4000-8000-000000000001'], action: 'approve', remarks: 'dates checked' });
    expect(r1.statusCode).toBe(403);
    expect(r1.json().requiredPermission).toBe('PM_REVIEW');
    const r2 = await call('POST', '/entries/approve', 'rev', { entryIds: ['00000000-0000-4000-8000-000000000001'], comment: 'approved' });
    expect(r2.json().requiredPermission).toBe('PM_APPROVE');
    const r3 = await call('POST', '/entries/reject', 'rev', { entryIds: ['00000000-0000-4000-8000-000000000001'], remarks: 'nope' });
    expect(r3.json().requiredPermission).toBe('PM_APPROVE');
  });

  it('then the configured workflow role: holding the permission under another role is 403 FORBIDDEN_ROLE', async () => {
    const e = await entry(s1, 'PENDING_REVIEW', { submittedBy: u.edt.id });
    const review = await call('POST', '/entries/review', 'mix', { entryIds: [e.id], action: 'approve', remarks: 'dates checked' });
    expect(review.statusCode).toBe(403);
    expect(review.json()).toMatchObject({ error: 'FORBIDDEN_ROLE' });
    expect(review.json().message).toBe(`Only users with role "${REV}" can review PM schedules`);
    const approve = await call('POST', '/entries/approve', 'mix', { entryIds: [e.id], comment: 'approved' });
    expect(approve.json()).toMatchObject({ error: 'FORBIDDEN_ROLE' });
    const reject = await call('POST', '/entries/reject', 'mix', { entryIds: [e.id], remarks: 'not mine' });
    expect(reject.json()).toMatchObject({ error: 'FORBIDDEN_ROLE' });
    const modify = await call('PUT', `/entries/${e.id}/review-edit`, 'mix', { plannedDate: iso(e.plannedDate) });
    expect(modify.json()).toMatchObject({ error: 'FORBIDDEN_ROLE' });
    expect((await get(e.id)).approvalStatus).toBe('PENDING_REVIEW');
  });

  it('404 when none of the ids exist', async () => {
    for (const [url, body] of [
      ['/entries/review', { entryIds: ['00000000-0000-4000-8000-000000000002'], action: 'approve', remarks: 'dates checked' }],
      ['/entries/approve', { entryIds: ['00000000-0000-4000-8000-000000000002'], comment: 'approved' }],
      ['/entries/reject', { entryIds: ['00000000-0000-4000-8000-000000000002'], remarks: 'missing' }],
    ] as const) {
      const res = await call('POST', url, url.includes('review') ? 'rev' : 'apr', body);
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error).toBe('NOT_FOUND');
    }
  });

  it('a two-AHU batch is reviewed, then approved; each step mints one batch-tagged QNN per entry and an audit row', async () => {
    const a = await entry(s1, 'PENDING_REVIEW', { submittedBy: u.edt.id, submittedByName: u.edt.username });
    const b = await entry(s2, 'PENDING_REVIEW', { submittedBy: u.edt.id, submittedByName: u.edt.username });
    // A legacy PENDING entry (uploaded before the workflow was switched on) enters review too.
    const legacy = await entry(s1, 'PENDING', { submittedBy: u.edt.id });

    const rev = await call('POST', '/entries/review', 'rev', { entryIds: [a.id, b.id, legacy.id], action: 'approve', remarks: 'dates checked' });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().processed).toBe(3);
    for (const id of [a.id, b.id, legacy.id]) {
      expect(await get(id)).toMatchObject({ approvalStatus: 'PENDING_APPROVAL', reviewedBy: u.rev.id, reviewedByName: u.rev.username, reviewRemarks: 'dates checked' });
      const [audit] = await audits('PM_SCHEDULE_REVIEWED', id);
      expect(audit).toMatchObject({ userId: u.rev.username, userRole: REV, targetType: 'pm_schedule_entry' });
    }
    const [qa] = await qnnsFor(a.id);
    expect(qa).toMatchObject({ action: 'REVIEW', ahuName: W1 });
    expect(qa.message).toMatch(new RegExp(`^Reviewed \\(sent for approval\\) — ${W1} \\(month 1\\) \\[batch B-[0-9A-F]{6}, 1 of 3 across ${W1}, ${W2.replace(/[-=]/g, (c) => `\\${c}`)}\\]$`));
    // A REVIEW QNN routes to the approver.
    const note = await prisma.notification.findFirst({ where: { type: 'PM_SCHEDULE_QNN', createdBy: u.rev.username } });
    expect(note?.forRole).toBe(APR);

    const appr = await call('POST', '/entries/approve', 'apr', { entryIds: [a.id, b.id], comment: 'ok to run' });
    expect(appr.statusCode).toBe(200);
    expect(appr.json().results).toHaveLength(2);
    expect(appr.json().results).toEqual(expect.arrayContaining([`${a.id}: approved`, `${b.id}: approved`]));
    for (const id of [a.id, b.id]) {
      expect(await get(id)).toMatchObject({ approvalStatus: 'APPROVED', approvedBy: u.apr.id, approvedByName: u.apr.username, approvalRemarks: 'ok to run' });
      const [audit] = await audits('PM_SCHEDULE_APPROVED', id);
      expect(audit.afterValue).toMatchObject({ comment: 'ok to run', hasPendingEdit: false });
    }
    expect((await get(legacy.id)).approvalStatus).toBe('PENDING_APPROVAL');
    const approveQnn = (await qnnsFor(b.id)).find((q) => q.action === 'APPROVE');
    expect(approveQnn?.message).toMatch(/\[batch B-[0-9A-F]{6}, [12] of 2 across /);
  });

  it('approve reports entries that are not awaiting approval instead of touching them', async () => {
    const approved = await entry(s2, 'APPROVED');
    const reviewOnly = await entry(s2, 'PENDING_REVIEW', { submittedBy: u.edt.id });
    const res = await call('POST', '/entries/approve', 'apr', { entryIds: [approved.id, reviewOnly.id], comment: 'approved' });
    expect(res.statusCode).toBe(200);
    expect(res.json().results).toEqual(expect.arrayContaining([
      `${approved.id}: not awaiting approval (APPROVED)`,
      `${reviewOnly.id}: not awaiting approval (PENDING_REVIEW)`, // workflow ON: review must come first
    ]));
    expect(res.json().qnns).toEqual([]);
    expect((await get(reviewOnly.id)).approvalStatus).toBe('PENDING_REVIEW');
  });
});

describe('segregation of duties by user', () => {
  it('the uploader cannot review, the reviewer cannot approve, the uploader cannot approve — even as SUPER_ADMIN', async () => {
    const e = await entry(s1, 'PENDING_REVIEW', { submittedBy: u.sa.id, submittedByName: u.sa.username });
    const own = await call('POST', '/entries/review', 'sa', { entryIds: [e.id], action: 'approve', remarks: 'dates checked' });
    expect(own.statusCode).toBe(403);
    expect(own.json()).toMatchObject({ error: 'SELF_APPROVAL_FORBIDDEN' });
    expect(own.json().message).toMatch(/^You cannot review/);

    expect((await call('POST', '/entries/review', 'sa2', { entryIds: [e.id], action: 'approve', remarks: 'dates checked' })).statusCode).toBe(200);
    const reviewerApproves = await call('POST', '/entries/approve', 'sa2', { entryIds: [e.id], comment: 'approved' });
    expect(reviewerApproves.json()).toMatchObject({ error: 'SELF_APPROVAL_FORBIDDEN' });
    const uploaderApproves = await call('POST', '/entries/approve', 'sa', { entryIds: [e.id], comment: 'approved' });
    expect(uploaderApproves.json()).toMatchObject({ error: 'SELF_APPROVAL_FORBIDDEN' });
    const uploaderRejects = await call('POST', '/entries/reject', 'sa', { entryIds: [e.id], remarks: 'my own' });
    expect(uploaderRejects.json().message).toMatch(/^You cannot reject/);
    expect((await get(e.id)).approvalStatus).toBe('PENDING_APPROVAL');

    // One own entry refuses the whole batch before anything is written.
    const other = await entry(s1, 'PENDING_APPROVAL', { submittedBy: u.edt.id, reviewedBy: u.rev.id });
    const batch = await call('POST', '/entries/approve', 'sa2', { entryIds: [other.id, e.id], comment: 'approved' });
    expect(batch.statusCode).toBe(403);
    expect((await get(other.id)).approvalStatus).toBe('PENDING_APPROVAL');

    expect((await call('POST', '/entries/approve', 'apr', { entryIds: [e.id], comment: 'approved' })).statusCode).toBe(200);
    expect((await get(e.id)).approvalStatus).toBe('APPROVED');
  });
});

describe('rejecting', () => {
  it('at review: remarks are mandatory (min 3 after trim), then REJECTED with stage REVIEW', async () => {
    const e = await entry(s1, 'PENDING_REVIEW', { submittedBy: u.edt.id });
    for (const remarks of [undefined, '   x  ']) {
      const res = await call('POST', '/entries/review', 'rev', { entryIds: [e.id], action: 'reject', ...(remarks !== undefined ? { remarks } : {}) });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('VALIDATION'); // refused before the signature (D03-13)
    }
    const res = await call('POST', '/entries/review', 'rev', { entryIds: [e.id], action: 'reject', remarks: '  wrong week  ' });
    expect(res.json()).toMatchObject({ processed: 1 });
    expect(await get(e.id)).toMatchObject({ approvalStatus: 'REJECTED', rejectionStage: 'REVIEW', rejectedBy: u.rev.id, approvalRemarks: 'wrong week' });
    const [audit] = await audits('PM_SCHEDULE_REJECTED', e.id);
    expect(audit.afterValue).toEqual({ stage: 'REVIEW', remarks: 'wrong week' });
    expect((await qnnsFor(e.id))[0]).toMatchObject({ action: 'REJECT' });
  });

  // A plain approval-stage reject. (Rejecting a STAGED EDIT of an approved visit
  // is deliberately not pinned here — the visit then ends REJECTED with its
  // approved original gone; reported as a defect.)
  it('at approval: "   x" passes the schema but is refused before the signature; a real reason rejects with stage APPROVAL', async () => {
    const e = await entry(s1, 'PENDING_APPROVAL', { submittedBy: u.edt.id, reviewedBy: u.rev.id });
    const weak = await call('POST', '/entries/reject', 'apr', { entryIds: [e.id], remarks: '   x' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error).toBe('VALIDATION'); // D03-13
    const short = await call('POST', '/entries/reject', 'apr', { entryIds: [e.id], remarks: 'no' });
    expect(short.statusCode).toBe(400); // schema minLength

    const approvedAlready = await entry(s1, 'APPROVED');
    const res = await call('POST', '/entries/reject', 'apr', { entryIds: [e.id, approvedAlready.id], remarks: 'tolerance too wide' });
    expect(res.statusCode).toBe(200);
    expect(res.json().qnns).toHaveLength(1); // only the PENDING_APPROVAL entry was rejectable
    expect(await get(e.id)).toMatchObject({
      approvalStatus: 'REJECTED', rejectionStage: 'APPROVAL', rejectedBy: u.apr.id, rejectedByName: u.apr.username, approvalRemarks: 'tolerance too wide',
    });
    expect((await get(approvedAlready.id)).approvalStatus).toBe('APPROVED');
    expect((await audits('PM_SCHEDULE_REJECTED', e.id))[0].afterValue).toEqual({ stage: 'APPROVAL', remarks: 'tolerance too wide' });
  });
});

describe('workflow OFF (legacy single step)', () => {
  it('PENDING is approved or rejected directly; the review step has nothing to do', async () => {
    wfOff();
    const p1 = await entry(s2, 'PENDING', { submittedBy: u.edt.id });
    const p2 = await entry(s2, 'PENDING', { submittedBy: u.edt.id });

    const review = await call('POST', '/entries/review', 'rev', { entryIds: [p1.id], action: 'approve', remarks: 'dates checked' });
    expect(review.json()).toEqual({ processed: 0, qnns: [] });
    expect((await get(p1.id)).approvalStatus).toBe('PENDING');

    const appr = await call('POST', '/entries/approve', 'apr', { entryIds: [p1.id], comment: 'approved' });
    expect(appr.json().results).toEqual([`${p1.id}: approved`]);
    // A single-entry action carries no batch tag.
    expect((await qnnsFor(p1.id)).find((q) => q.action === 'APPROVE')?.message).toBe(`Approved — ${W2} (month ${p1.month})`);

    const rej = await call('POST', '/entries/reject', 'apr', { entryIds: [p2.id], remarks: 'not this year' });
    expect(rej.statusCode).toBe(200);
    expect(await get(p2.id)).toMatchObject({ approvalStatus: 'REJECTED', rejectionStage: 'APPROVAL' });
  });
});

describe('re-submitting a rejected entry', () => {
  let rejected: Awaited<ReturnType<typeof entry>>;
  let neighbour: Awaited<ReturnType<typeof entry>>;

  beforeAll(async () => {
    neighbour = await entry(s1, 'APPROVED', {}, 2);
    rejected = await entry(s1, 'REJECTED', {
      submittedBy: u.sa.id, reviewedBy: u.rev.id, reviewedByName: u.rev.username, reviewRemarks: 'r',
      rejectedBy: u.apr.id, rejectedByName: u.apr.username, rejectedAt: new Date(), rejectionStage: 'APPROVAL', approvalRemarks: 'bad date',
    }, 2);
  });

  it('needs PM_RESUBMIT', async () => {
    const res = await call('POST', `/entries/${rejected.id}/resubmit`, 'rev', { plannedDate: iso(rejected.plannedDate) });
    expect(res.statusCode).toBe(403);
    expect(res.json().requiredPermission).toBe('PM_RESUBMIT');
  });

  it('refuses entries that are not REJECTED, bad dates and dates overlapping a sibling', async () => {
    const notRejected = await call('POST', `/entries/${neighbour.id}/resubmit`, 'edt', { plannedDate: iso(neighbour.plannedDate) });
    expect(notRejected.statusCode).toBe(400);
    expect(notRejected.json().error).toBe('INVALID_STATUS');
    const badDate = await call('POST', `/entries/${rejected.id}/resubmit`, 'edt', { plannedDate: 'someday' });
    expect(badDate.statusCode).toBe(400);
    expect(badDate.json().error).toBe('INVALID_DATE');
    const overlap = await call('POST', `/entries/${rejected.id}/resubmit`, 'edt', { plannedDate: iso(new Date(neighbour.plannedDate.getTime() + 2 * DAY)) });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json()).toMatchObject({ error: 'PM_VISIT_OVERLAP' });
    expect(overlap.json().message).toMatch(/^This visit cannot be scheduled here\. /);
    expect((await get(rejected.id)).approvalStatus).toBe('REJECTED');
  });

  it('goes back to PENDING_REVIEW with every prior sign-off cleared and the resubmitter as submitter', async () => {
    const newDate = new Date(rejected.plannedDate.getTime() + 1 * DAY);
    const res = await call('POST', `/entries/${rejected.id}/resubmit`, 'edt', { plannedDate: iso(newDate) });
    expect(res.statusCode).toBe(200);
    expect(res.json().qnn).toMatch(/^QN-\d{4}-\d{6}$/);
    const e = await get(rejected.id);
    expect(e).toMatchObject({
      approvalStatus: 'PENDING_REVIEW', toleranceDays: 2, submittedBy: u.edt.id, submittedByName: u.edt.username,
      reviewedBy: null, reviewedByName: null, reviewRemarks: null, approvedBy: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectionStage: null, approvalRemarks: null,
    });
    expect(iso(e.plannedDate)).toBe(iso(newDate));
    expect(iso(e.windowStart)).toBe(iso(new Date(newDate.getTime() - 2 * DAY)));
    const [audit] = await audits('PM_SCHEDULE_RESUBMITTED', rejected.id);
    expect(audit.afterValue).toEqual({ plannedDate: iso(newDate), toleranceDays: 2 });
    expect((await qnnsFor(rejected.id)).at(-1)?.action).toBe('RESUBMIT');
  });

  it('with the workflow OFF it returns to PENDING, honouring a new tolerance', async () => {
    wfOff();
    await prisma.pmScheduleEntry.update({ where: { id: rejected.id }, data: { approvalStatus: 'REJECTED' } });
    const res = await call('POST', `/entries/${rejected.id}/resubmit`, 'edt', { plannedDate: iso(rejected.plannedDate), toleranceDays: 0 });
    expect(res.statusCode).toBe(200);
    expect(await get(rejected.id)).toMatchObject({ approvalStatus: 'PENDING', toleranceDays: 0 });
  });
});

describe('editing an APPROVED entry (staged change → approval applies it)', () => {
  it('needs PM_EDIT_ENTRY; refuses non-APPROVED, unknown, unparsable and overlapping edits', async () => {
    const approved = await entry(s2, 'APPROVED', {}, 1);
    const sibling = await entry(s2, 'APPROVED', {}, 1);
    const pending = await entry(s2, 'PENDING_REVIEW');
    expect((await call('PUT', `/entries/${approved.id}/edit`, 'ro', { plannedDate: iso(approved.plannedDate) })).json().requiredPermission).toBe('PM_EDIT_ENTRY');
    const notApproved = await call('PUT', `/entries/${pending.id}/edit`, 'edt', { plannedDate: iso(pending.plannedDate) });
    expect(notApproved.json()).toMatchObject({ error: 'INVALID_STATUS' });
    const missing = await call('PUT', '/entries/00000000-0000-4000-8000-000000000003/edit', 'edt', { plannedDate: `${YEAR}-01-01` });
    expect(missing.statusCode).toBe(404);
    const bad = await call('PUT', `/entries/${approved.id}/edit`, 'edt', { plannedDate: '31/31/2092' });
    expect(bad.json()).toMatchObject({ error: 'INVALID_DATE' });
    const overlap = await call('PUT', `/entries/${approved.id}/edit`, 'edt', { plannedDate: iso(sibling.plannedDate), toleranceDays: 1 });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toBe('PM_VISIT_OVERLAP');
    expect(await get(approved.id)).toMatchObject({ approvalStatus: 'APPROVED', pendingPlannedDate: null });
  });

  it('stages the new date (live date untouched), goes through review, and the approval applies it', async () => {
    const e = await entry(s2, 'APPROVED', { approvedBy: u.apr.id, approvedByName: u.apr.username }, 1);
    const target = new Date(e.plannedDate.getTime() + 2 * DAY);
    const res = await call('PUT', `/entries/${e.id}/edit`, 'edt', { plannedDate: iso(target), toleranceDays: 2 });
    expect(res.statusCode).toBe(200);
    let row = await get(e.id);
    expect(row).toMatchObject({ approvalStatus: 'PENDING_REVIEW', pendingToleranceDays: 2, pendingEditBy: u.edt.id, approvedBy: u.apr.id, submittedBy: u.edt.id }); // D2: the approval of the date in force stands
    expect(iso(row.pendingPlannedDate!)).toBe(iso(target));
    expect(iso(row.plannedDate)).toBe(iso(e.plannedDate));
    const [editAudit] = await audits('PM_SCHEDULE_EDIT_REQUESTED', e.id);
    expect(editAudit.afterValue).toEqual({ pendingPlannedDate: iso(target), pendingToleranceDays: 2 });
    expect((await qnnsFor(e.id))[0]).toMatchObject({ action: 'EDIT' });

    await call('POST', '/entries/review', 'rev', { entryIds: [e.id], action: 'approve', remarks: 'dates checked' });
    await call('POST', '/entries/approve', 'apr', { entryIds: [e.id], comment: 'approved' });
    row = await get(e.id);
    expect(row).toMatchObject({ approvalStatus: 'APPROVED', toleranceDays: 2, pendingPlannedDate: null, pendingToleranceDays: null, pendingEditBy: null });
    expect(iso(row.plannedDate)).toBe(iso(target));
    expect(iso(row.windowStart)).toBe(iso(new Date(target.getTime() - 2 * DAY)));
    expect(iso(row.windowEnd)).toBe(iso(new Date(target.getTime() + 2 * DAY)));
    const approvedAudit = (await audits('PM_SCHEDULE_APPROVED', e.id)).at(-1);
    expect(approvedAudit?.afterValue).toMatchObject({ hasPendingEdit: true });
  });

  it('keeps the old tolerance when the edit names none (workflow OFF → PENDING)', async () => {
    wfOff();
    const e = await entry(s2, 'APPROVED', {}, 1);
    await call('PUT', `/entries/${e.id}/edit`, 'edt', { plannedDate: iso(new Date(e.plannedDate.getTime() + DAY)) });
    expect(await get(e.id)).toMatchObject({ approvalStatus: 'PENDING', pendingToleranceDays: 1 });
  });

  it('re-checks separation when the staged date goes live: two edits fine alone, colliding together → 409, second left staged', async () => {
    wfOff();
    const a = await entry(s1, 'APPROVED', {}, 2);
    dayCursor += 2; // leave a gap of three weeks
    const b = await entry(s1, 'APPROVED', {}, 2);
    // Each target is clear of the other's LIVE window, so both edits are accepted…
    const aTarget = new Date(b.plannedDate.getTime() - 9 * DAY); // window b-11 .. b-7
    const bTarget = new Date(b.plannedDate.getTime() - 5 * DAY); // window b-7 .. b-3  → touches aTarget's window
    expect((await call('PUT', `/entries/${a.id}/edit`, 'edt', { plannedDate: iso(aTarget) })).statusCode).toBe(200);
    expect((await call('PUT', `/entries/${b.id}/edit`, 'edt', { plannedDate: iso(bTarget) })).statusCode).toBe(200);
    // …approving A moves it; approving B would now overlap A's new live window.
    expect((await call('POST', '/entries/approve', 'apr', { entryIds: [a.id], comment: 'approved' })).statusCode).toBe(200);
    expect(iso((await get(a.id)).plannedDate)).toBe(iso(aTarget));
    const res = await call('POST', '/entries/approve', 'apr', { entryIds: [b.id], comment: 'approved' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_OVERLAP');
    expect(res.json().message).toMatch(/^This approved change cannot be scheduled here\./);
    const bRow = await get(b.id);
    expect(bRow.approvalStatus).toBe('PENDING');
    expect(iso(bRow.plannedDate)).toBe(iso(b.plannedDate));
    expect(iso(bRow.pendingPlannedDate!)).toBe(iso(bTarget));
  });
});

describe('reviewer modifies an entry awaiting review', () => {
  it('moves the date in place, stays in review, records the reviewer and audits before/after', async () => {
    const e = await entry(s1, 'PENDING_REVIEW', { submittedBy: u.edt.id }, 1);
    const target = new Date(e.plannedDate.getTime() + DAY);
    const res = await call('PUT', `/entries/${e.id}/review-edit`, 'rev', { plannedDate: iso(target), toleranceDays: 0 });
    expect(res.statusCode).toBe(200);
    expect(res.json().qnn).toMatch(/^QN-/);
    const row = await get(e.id);
    expect(row).toMatchObject({ approvalStatus: 'PENDING_REVIEW', toleranceDays: 0, reviewedBy: u.rev.id, reviewedByName: u.rev.username });
    expect(iso(row.plannedDate)).toBe(iso(target));
    expect(iso(row.windowEnd)).toBe(iso(target));
    const [audit] = await audits('PM_SCHEDULE_REVIEW_MODIFIED', e.id);
    expect(audit.beforeValue).toEqual({ plannedDate: e.plannedDate.toISOString(), toleranceDays: 1 });
    expect(audit.afterValue).toEqual({ plannedDate: iso(target), toleranceDays: 0 });
    // Modified-at-review QNN: an EDIT, routed back to the review role.
    expect((await qnnsFor(e.id))[0].message).toMatch(/^Modified at review — /);
  });

  it('refuses entries not awaiting review, unknown ids, bad dates and overlaps', async () => {
    const approved = await entry(s1, 'APPROVED', {}, 1);
    const e = await entry(s1, 'PENDING_REVIEW', {}, 1);
    expect((await call('PUT', `/entries/${approved.id}/review-edit`, 'rev', { plannedDate: iso(approved.plannedDate) })).json().error).toBe('INVALID_STATUS');
    expect((await call('PUT', '/entries/00000000-0000-4000-8000-000000000004/review-edit', 'rev', { plannedDate: `${YEAR}-02-02` })).statusCode).toBe(404);
    expect((await call('PUT', `/entries/${e.id}/review-edit`, 'rev', { plannedDate: 'never' })).json().error).toBe('INVALID_DATE');
    const overlap = await call('PUT', `/entries/${e.id}/review-edit`, 'rev', { plannedDate: iso(approved.plannedDate) });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error).toBe('PM_VISIT_OVERLAP');
  });
});

describe('an entry whose AHU no longer exists', () => {
  let ghostEntry: string;

  beforeAll(async () => {
    // pm_schedules.entity_id carries no FK: a schedule can outlive its AHU row.
    ghostScheduleId = (await fx.schedule(randomUUID(), YEAR, u.sa.id, [])).scheduleId;
    ghostEntry = (await entry(ghostScheduleId, 'PENDING_APPROVAL', { submittedBy: u.edt.id, reviewedBy: u.rev.id })).id;
  });

  it('is listed as AHU "?" instead of failing', async () => {
    const all = (await call('GET', `/entries?year=${YEAR}&limit=5000`, 'ro')).json();
    expect(all.data.find((d: any) => d.id === ghostEntry)).toMatchObject({ ahuName: '?', approvalStatus: 'PENDING_APPROVAL' });
  });

  it('can still be rejected in a two-entry batch; each QNN carries the batch tag and the "?" name', async () => {
    const other = await entry(s1, 'PENDING_APPROVAL', { submittedBy: u.edt.id, reviewedBy: u.rev.id });
    const res = await call('POST', '/entries/reject', 'apr', { entryIds: [ghostEntry, other.id], remarks: 'AHU decommissioned' });
    expect(res.statusCode).toBe(200);
    expect(res.json().qnns).toHaveLength(2);
    const [q] = await qnnsFor(ghostEntry);
    expect(q).toMatchObject({ action: 'REJECT', ahuName: '?' });
    expect(q.message).toMatch(/^Rejected at approval — \? \(month \d+\) \[batch B-[0-9A-F]{6}, [12] of 2 across .+\]$/);
    expect((await get(ghostEntry)).approvalStatus).toBe('REJECTED');
  });

  it('defaults: GET /entries without a year is the current year, page 1 of 50', async () => {
    const res = (await call('GET', '/entries', 'ro')).json();
    expect(res).toMatchObject({ page: 1, limit: 50 });
    expect(res.data.every((d: any) => d.scheduleId !== s1 && d.scheduleId !== ghostScheduleId)).toBe(true);
  });
});

describe('entry list, counts and export', () => {
  it('GET /entries filters by status and year, names the AHU and pages', async () => {
    const all = (await call('GET', `/entries?year=${YEAR}&limit=5000`, 'ro')).json();
    const mine = all.data.filter((d: any) => d.scheduleId === s1 || d.scheduleId === s2);
    expect(mine.length).toBeGreaterThan(10);
    expect(new Set(mine.filter((d: any) => d.scheduleId === s1).map((d: any) => d.ahuName))).toEqual(new Set([W1]));
    expect(mine.find((d: any) => d.scheduleId === s2)).toMatchObject({ ahuId: w2Id, ahuName: W2 });
    // ascending planned date
    const dates = all.data.map((d: any) => d.plannedDate);
    expect([...dates].sort()).toEqual(dates);

    for (const status of ['PENDING_REVIEW', 'APPROVED', 'REJECTED']) {
      const res = (await call('GET', `/entries?year=${YEAR}&approvalStatus=${status}&limit=5000`, 'ro')).json();
      expect(res.data.length, status).toBeGreaterThan(0);
      expect(res.data.every((d: any) => d.approvalStatus === status)).toBe(true);
    }
    const paged = (await call('GET', `/entries?year=${YEAR}&page=2&limit=3`, 'ro')).json();
    expect(paged).toMatchObject({ page: 2, limit: 3, total: all.total, totalPages: Math.ceil(all.total / 3) });
    // Compared on the sort key: rows sharing a planned date may come back in either order.
    expect(paged.data.map((d: any) => d.plannedDate)).toEqual(all.data.slice(3, 6).map((d: any) => d.plannedDate));
    expect((await call('GET', `/entries?year=${YEAR + 50}`, 'ro')).json()).toMatchObject({ data: [], total: 0, page: 1, limit: 50 });
    expect((await call('GET', '/entries?approvalStatus=DONE', 'ro')).statusCode).toBe(400);
  });

  it('GET /entries/pending-counts sums the three pending states', async () => {
    const res = (await call('GET', '/entries/pending-counts', 'ro')).json();
    // Only `pending` and `rejected` are declared in the route's response schema
    // (the per-stage counts the service also computes are serialised away).
    const count = (approvalStatus: any) =>
      prisma.pmScheduleEntry.count({ where: { schedule: { status: 'ACTIVE' }, approvalStatus } });
    const [legacy, review, approval, rejected] = await Promise.all(
      ['PENDING', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'REJECTED'].map(count),
    );
    expect(review).toBeGreaterThan(0);
    expect(res.pending).toBe(legacy + review + approval);
    expect(res.rejected).toBe(rejected);
  });

  it('GET /entries/export.xlsx is re-auth gated and exports the year with the workflow trail, formula-safe', async () => {
    cfg.set('action-reauth', { EXPORT_PM_SCHEDULE: [fx.roleName('RO')] });
    expect((await call('GET', `/entries/export.xlsx?year=${YEAR}`, 'ro')).statusCode).toBe(401);
    const res = await call('GET', `/entries/export.xlsx?year=${YEAR}`, 'ro', undefined, fx.password);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="pm-schedule-${YEAR}.xlsx"`);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as any);
    const ws = wb.getWorksheet(`PM Schedule ${YEAR}`)!;
    expect(ws).toBeTruthy();
    expect((ws.getRow(1).values as any[]).slice(1)).toEqual([
      'S.No', 'AHU', 'Month', 'Planned Date', 'Tolerance (days)', 'Window Start', 'Window End', 'Status',
      'Uploaded By', 'Reviewed By', 'Reviewed At', 'Approved By', 'Approved At', 'Rejected By', 'Rejected At', 'Reject Stage', 'Remarks',
    ]);
    const rows: any[][] = [];
    ws.eachRow((r, n) => { if (n > 1) rows.push((r.values as any[]).slice(1)); });
    const db = await prisma.pmScheduleEntry.findMany({ where: { schedule: { status: 'ACTIVE', year: YEAR } } });
    expect(rows).toHaveLength(db.length);
    expect(rows.map((r) => r[0])).toEqual(rows.map((_r, i) => i + 1));

    // The W2 AHU name starts with "=": exported as text, never as a formula.
    const w2Rows = rows.filter((r) => r[1] === `'${W2}`);
    expect(w2Rows.length).toBe(db.filter((e) => e.scheduleId === s2).length);
    // A fully signed-off row carries its trail in the configured date format (YYYY-MM-DD, UTC here).
    const signed = db.find((e) => e.scheduleId === s2 && e.approvalStatus === 'APPROVED' && e.approvedByName === u.apr.username && e.reviewedByName)!;
    const r = rows.find((x) => x[3] === iso(signed.plannedDate) && x[1] === `'${W2}`)!;
    expect(r[2]).toBe(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][signed.month - 1]);
    expect(r.slice(4, 8)).toEqual([signed.toleranceDays, iso(signed.windowStart), iso(signed.windowEnd), 'Approved']);
    expect(r[9]).toBe(u.rev.username);
    expect(r[10]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(r[11]).toBe(u.apr.username);
    // The entry whose AHU row is gone exports as "?".
    const ghost = db.find((e) => e.scheduleId === ghostScheduleId)!;
    expect(rows.find((x) => x[3] === iso(ghost.plannedDate) && x[1] === '?')?.[15]).toBe('APPROVAL');
    const rejectedRow = rows.find((x) => x[7] === 'Rejected' && x[15] === 'REVIEW');
    expect(rejectedRow?.[16]).toBe('wrong week');
    expect(rows.some((x) => x[7] === 'To Review')).toBe(true);
  });

  it('the export defaults to the current year', async () => {
    const res = await call('GET', '/entries/export.xlsx', 'ro');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="pm-schedule-${new Date().getFullYear()}.xlsx"`);
  });
});

describe('QNN report', () => {
  it('visibility follows qnn-notifications.visibleRoles (+ SUPER_ADMIN), defaulting to ADMIN', async () => {
    expect((await call('GET', '/qnn/visible', 'sa')).json()).toEqual({ visible: true });
    expect((await call('GET', '/qnn/visible', 'ro')).json()).toEqual({ visible: false });
    cfg.set('qnn-notifications', { visibleRoles: [fx.roleName('RO')] });
    expect((await call('GET', '/qnn/visible', 'ro')).json()).toEqual({ visible: true });
    cfg.missing('qnn-notifications');
    expect((await call('GET', '/qnn/visible', 'ro')).json()).toEqual({ visible: false });
    // A failing config read falls back to the ADMIN-only default instead of erroring.
    cfg.fail('qnn-notifications');
    const failed = await call('GET', '/qnn/visible', 'ro');
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toEqual({ visible: false });
  });

  it('GET /qnn is 403 for a role that may not see it', async () => {
    const res = await call('GET', '/qnn', 'ro');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });

  it('lists QNNs newest first with paging and a created-at window', async () => {
    cfg.set('qnn-notifications', { visibleRoles: [fx.roleName('RO')] });
    const from = encodeURIComponent(STARTED.toISOString());
    const res = (await call('GET', `/qnn?from=${from}&limit=5000`, 'ro')).json();
    const mine = res.data.filter((q: any) => q.performedByName && Object.values(u).some((x) => x.username === q.performedByName));
    expect(mine.length).toBeGreaterThan(10);
    expect(Object.keys(mine[0]).sort()).toEqual(['action', 'ahuName', 'createdAt', 'id', 'message', 'performedBy', 'performedByName', 'qnn']);
    const created = res.data.map((q: any) => q.createdAt);
    expect([...created].sort().reverse()).toEqual(created);

    const page = (await call('GET', `/qnn?from=${from}&page=2&limit=2`, 'ro')).json();
    expect(page).toMatchObject({ page: 2, limit: 2, total: res.total, totalPages: Math.ceil(res.total / 2) });
    expect(page.data.map((q: any) => q.createdAt)).toEqual(res.data.slice(2, 4).map((q: any) => q.createdAt));

    const before = (await call('GET', `/qnn?to=${encodeURIComponent(new Date(STARTED.getTime() - 60_000).toISOString())}&limit=5000`, 'ro')).json();
    expect(before.data.some((q: any) => mine.some((m: any) => m.id === q.id))).toBe(false);
    const both = (await call('GET', `/qnn?from=${from}&to=${encodeURIComponent(new Date().toISOString())}&limit=5000`, 'ro')).json();
    expect(both.total).toBeGreaterThanOrEqual(mine.length);
    // Defaults: page 1, 50 per page.
    const dflt = (await call('GET', '/qnn', 'ro')).json();
    expect(dflt).toMatchObject({ page: 1, limit: 50 });
    expect(dflt.data.length).toBe(Math.min(50, dflt.total));
  });
});
