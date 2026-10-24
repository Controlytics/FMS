/**
 * Replacement schedule — review / approve / reject / resubmit / review-edit,
 * the task reads (/due, /tasks, /blocked-filters, list status) and executing a
 * replacement, through the real routes (/api/replacement-schedules).
 *
 * Entries are inserted directly (the upload path is covered by
 * upload.coverage.test.ts) so each one sits exactly in the state under test.
 * Everything asserted is what the client or the database observes: status,
 * error code, the entry's columns, QNN + audit rows, filters retired/created.
 *
 * Owns its hierarchy, users, roles and the `replacement-schedule-approval`
 * row (snapshot + exact restore). Re-auth keys are merged for its own roles.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors, authGet, authPost, authPut } from '../../../e2e/test-helper.js';
import replacementScheduleRoutes from '../routes.js';
import { reviewEntries } from '../workflow.js';
import { isFilterBlockedForCleaning } from '../service.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix, addReauth, removeReauth,
  createHierarchy, deleteHierarchy, deleteFilters, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoRsWf@2026!x';
const ROLE_REV = `cvoWR${S}`;   // REVIEW + APPROVE permission, but not the configured workflow role
const ROLE_OP = `cvoWO${S}`;    // FILTER_OPERATE only (tablet task reads)
const ROLE_RPL = `cvoWP${S}`;   // FILTER_REPLACE (+ re-auth REPLACE_FILTER)
const ROLE_NONE = `cvoWN${S}`;
const U = {
  up: `cvowup${S}`.toLowerCase(), rev: `cvowrv${S}`.toLowerCase(), appr: `cvowap${S}`.toLowerCase(),
  badrev: `cvowbr${S}`.toLowerCase(), op: `cvowop${S}`.toLowerCase(), rpl: `cvowrp${S}`.toLowerCase(), none: `cvownn${S}`.toLowerCase(),
};
const ids: Record<string, string> = {};
const tok: Record<string, string> = {};
let app: FastifyInstance;
let snap: any = null;
let added: ReauthGrant = [];
let scheduleId = '';
let hier: Awaited<ReturnType<typeof createHierarchy>> | undefined;
const extraAhus: string[] = [];
const filterIds: string[] = [];

const day = (n: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function setApproval(v: Record<string, unknown>) {
  await prisma.systemConfig.upsert({
    where: { configKey: 'replacement-schedule-approval' },
    update: { configValue: v as any },
    create: { configKey: 'replacement-schedule-approval', configValue: v as any, configType: 'workflow' },
  });
}
const WF_ON = { workflowEnabled: true, uploadRole: [], reviewRole: 'SUPERVISOR', approvalRole: 'ADMIN' };

async function newAhu(tag: string) {
  const id = (await prisma.assetInstance.create({ data: { name: `cvoW${S}-${tag}`, templateId: hier!.ahuTemplateId, parentId: hier!.blockId } })).id;
  extraAhus.push(id);
  return id;
}
async function filterUnder(ahuId: string, tag: string) {
  const f = await prisma.assetInstance.create({ data: { name: `cvoW${S}-${tag}-00`, templateId: hier!.filterTemplateId, parentId: ahuId, status: 'Active' } });
  filterIds.push(f.id);
  return f.id;
}
async function entry(ahuId: string, over: Record<string, unknown> = {}) {
  return (await prisma.replacementScheduleEntry.create({
    data: {
      scheduleId, slNo: 1, ahuId, ahuName: `cvoW${S}-AHU`, filterMicron: '10', filterSize: '610x610x150', qty: 2,
      scheduleDate: day(0), toleranceDays: 3, windowStart: day(-3), windowEnd: day(3),
      status: 'PENDING', approvalStatus: 'PENDING_REVIEW', submittedBy: ids.up, submittedByName: U.up,
      ...over,
    } as any,
  })).id;
}
const get = (id: string) => prisma.replacementScheduleEntry.findUnique({ where: { id } });

beforeAll(async () => {
  snap = await prisma.systemConfig.findUnique({ where: { configKey: 'replacement-schedule-approval' } });
  await createRole(ROLE_REV, ['REPLACEMENT_SCHEDULE_REVIEW', 'REPLACEMENT_SCHEDULE_APPROVE', 'REPLACEMENT_SCHEDULE_UPLOAD']);
  await createRole(ROLE_OP, ['FILTER_OPERATE']);
  await createRole(ROLE_RPL, ['FILTER_REPLACE']);
  await createRole(ROLE_NONE, []);
  ids.up = await createUser(U.up, 'SUPER_ADMIN', PW);
  ids.rev = await createUser(U.rev, 'SUPER_ADMIN', PW);
  ids.appr = await createUser(U.appr, 'SUPER_ADMIN', PW);
  ids.badrev = await createUser(U.badrev, ROLE_REV, PW);
  ids.op = await createUser(U.op, ROLE_OP, PW);
  ids.rpl = await createUser(U.rpl, ROLE_RPL, PW);
  ids.none = await createUser(U.none, ROLE_NONE, PW);
  added = await addReauth([
    ['REPLACE_FILTER', ROLE_RPL], ['REVIEW_REPLACEMENT_SCHEDULE', ROLE_REV],
    ['APPROVE_REPLACEMENT_SCHEDULE', ROLE_REV], ['REJECT_REPLACEMENT_SCHEDULE', ROLE_REV],
  ]);
  await setApproval(WF_ON);
  hier = await createHierarchy(`cvoW${S}`);
  scheduleId = (await prisma.replacementSchedule.create({ data: { fileName: `cvo-${S}-wf.xlsx`, status: 'ACTIVE', uploadedBy: ids.up, uploadedByName: U.up } })).id;
  app = await buildApp([{ plugin: replacementScheduleRoutes, prefix: '/api/replacement-schedules' }]);
  for (const k of Object.keys(U) as Array<keyof typeof U>) tok[k] = await login(app, U[k], PW);
}, 60_000);

afterAll(async () => {
  const entryIds = (await prisma.replacementScheduleEntry.findMany({ where: { scheduleId }, select: { id: true } })).map((e) => e.id);
  // Replacement filters created by executeReplacement hang under our AHUs.
  const ahuIds = [hier?.ahuId, ...extraAhus].filter(Boolean) as string[];
  const created = (await prisma.assetInstance.findMany({ where: { parentId: { in: ahuIds } }, select: { id: true } })).map((f) => f.id);
  await cleanupAll([
    ['qnn', () => prisma.qualityNotification.deleteMany({ where: { OR: [{ scheduleId }, { pmScheduleEntryId: { in: entryIds } }] } })],
    ['qnn notifications', () => prisma.notification.deleteMany({ where: { type: 'PM_SCHEDULE_QNN', metadata: { path: ['scheduleId'], equals: scheduleId } } })],
    ['schedule', () => prisma.replacementSchedule.deleteMany({ where: { id: scheduleId } })],
    ['filters', () => deleteFilters([...new Set([...filterIds, ...created])])],
    ['ahus', () => prisma.assetInstance.deleteMany({ where: { id: { in: extraAhus } } })],
    ['hierarchy', () => deleteHierarchy(hier)],
    ['config', async () => {
      if (snap) await prisma.systemConfig.update({ where: { configKey: 'replacement-schedule-approval' }, data: { configValue: snap.configValue, configType: snap.configType } });
      else await prisma.systemConfig.deleteMany({ where: { configKey: 'replacement-schedule-approval' } });
    }],
    ['reauth', () => removeReauth(added)],
    ['users', () => deleteUsers(Object.values(ids))],
    ['roles', () => deleteRoles([ROLE_REV, ROLE_OP, ROLE_RPL, ROLE_NONE])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

const R = '/api/replacement-schedules';

describe('review step', () => {
  it('approve → PENDING_APPROVAL, reviewer stamped, QNN + audit carry the entry label', async () => {
    const id = await entry(hier!.ahuId);
    const res = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [id], action: 'approve', remarks: '  looks right  ' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(1);
    expect(res.json().qnns[0]).toMatch(/^QN-\d{4}-\d{6}$/);
    expect(await get(id)).toMatchObject({ approvalStatus: 'PENDING_APPROVAL', reviewedBy: ids.rev, reviewedByName: U.rev, reviewRemarks: 'looks right' });
    const q = await prisma.qualityNotification.findFirst({ where: { pmScheduleEntryId: id } });
    expect(q).toMatchObject({ action: 'REVIEW', scheduleId, ahuName: `cvoW${S}-AHU` });
    expect(q!.message).toBe(`Reviewed (sent for approval) — cvoW${S}-AHU · 610x610x150 · 10µ · qty 2`);
    const a = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_REVIEWED', targetId: id } });
    expect(a!.afterValue).toMatchObject({ name: `AHU: cvoW${S}-AHU · Size: 610x610x150 · Micron: 10µ · Qty: 2`, filterMicron: '10', qty: 2 });
  });

  it('a review needs remarks, refused before the signature (D03-13); labels omit absent size / micron', async () => {
    const id = await entry(hier!.ahuId, { filterSize: null, filterMicron: null });
    const bare = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [id], action: 'approve' }, PW);
    expect([bare.statusCode, bare.json().error]).toEqual([400, 'VALIDATION']);
    expect((await get(id))!.approvalStatus).toBe('PENDING_REVIEW');
    await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [id], action: 'approve', remarks: ' sizes checked ' }, PW);
    expect((await get(id))!.reviewRemarks).toBe('sizes checked');
    const a = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_REVIEWED', targetId: id } });
    expect((a!.afterValue as any).name).toBe(`AHU: cvoW${S}-AHU · Qty: 2`);
    const q = await prisma.qualityNotification.findFirst({ where: { pmScheduleEntryId: id } });
    expect(q!.message).toBe(`Reviewed (sent for approval) — cvoW${S}-AHU · qty 2`);
  });

  it('reject needs remarks (>= 3 chars after trim); with them → REJECTED at REVIEW', async () => {
    const id = await entry(hier!.ahuId);
    const bad = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [id], action: 'reject', remarks: ' x ' }, PW);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('VALIDATION'); // refused before the signature (D03-13)
    expect((await get(id))!.approvalStatus).toBe('PENDING_REVIEW');
    const res = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [id], action: 'reject', remarks: 'wrong micron' }, PW);
    expect(res.statusCode).toBe(200);
    expect(await get(id)).toMatchObject({ approvalStatus: 'REJECTED', rejectionStage: 'REVIEW', rejectedBy: ids.rev, approvalRemarks: 'wrong micron' });
    const a = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_REJECTED', targetId: id } });
    expect(a!.afterValue).toMatchObject({ stage: 'REVIEW', remarks: 'wrong micron' });
    expect(internalErrors).toEqual([]);
  });

  it('unknown ids → 404; entries not awaiting review are skipped (processed 0)', async () => {
    const res = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [randomUUID()], action: 'approve', remarks: 'checked' }, PW);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
    const done = await entry(hier!.ahuId, { approvalStatus: 'APPROVED' });
    const skip = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [done], action: 'approve', remarks: 'checked' }, PW);
    expect(skip.json()).toEqual({ processed: 0, qnns: [] });
  });

  it('a role that holds the permission but is not the configured review role is refused (FORBIDDEN_ROLE)', async () => {
    const id = await entry(hier!.ahuId);
    const res = await authPost(app, `${R}/entries/review`, tok.badrev, { entryIds: [id], action: 'approve', remarks: 'checked' }, PW);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN_ROLE');
    expect((await get(id))!.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('the review route takes its e-signature first: no password → REAUTH_REQUIRED', async () => {
    const id = await entry(hier!.ahuId);
    const res = await authPost(app, `${R}/entries/review`, tok.badrev, { entryIds: [id], action: 'approve', remarks: 'checked' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'REVIEW_REPLACEMENT_SCHEDULE' });
  });

  it('every workflow write takes its e-signature before it touches anything', async () => {
    const pa = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL' });
    const rj = await entry(hier!.ahuId, { approvalStatus: 'REJECTED' });
    const pr = await entry(hier!.ahuId);
    const calls: Array<[string, () => Promise<any>]> = [
      ['APPROVE_REPLACEMENT_SCHEDULE', () => authPost(app, `${R}/entries/approve`, tok.badrev, { entryIds: [pa], comment: 'released' })],
      ['REJECT_REPLACEMENT_SCHEDULE', () => authPost(app, `${R}/entries/reject`, tok.badrev, { entryIds: [pa], remarks: 'not now' })],
      ['REVIEW_REPLACEMENT_SCHEDULE', () => authPost(app, `${R}/entries/${rj}/resubmit`, tok.badrev, { scheduleDate: iso(day(5)) })],
      ['REVIEW_REPLACEMENT_SCHEDULE', () => authPut(app, `${R}/entries/${pr}/review-edit`, tok.badrev, { scheduleDate: iso(day(5)) })],
    ];
    for (const [action, call] of calls) {
      const res = await call();
      expect(res.statusCode, action).toBe(401);
      expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action });
    }
    expect((await get(pa))!.approvalStatus).toBe('PENDING_APPROVAL');
    expect((await get(rj))!.approvalStatus).toBe('REJECTED');
    expect(iso((await get(pr))!.scheduleDate)).toBe(iso(day(0)));
  });

  it('a caller that cannot be identified is refused — separation of duties fails closed', async () => {
    const id = await entry(hier!.ahuId);
    await expect(reviewEntries({ userId: 'x', userRole: 'SUPER_ADMIN' } as any, [id], 'approve', 'checked'))
      .rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN', message: expect.stringContaining('could not be identified') });
  });

  it('the body is validated (bad action → 400)', async () => {
    const res = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [randomUUID()], action: 'maybe' }, PW);
    expect(res.statusCode).toBe(400);
  });
});

describe('approval step', () => {
  it('approves PENDING_APPROVAL and legacy PENDING entries, clearing any rejection trail', async () => {
    const a = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL', reviewedBy: ids.rev });
    const b = await entry(hier!.ahuId, { approvalStatus: 'PENDING', rejectedBy: ids.rev, rejectionStage: 'REVIEW' });
    const res = await authPost(app, `${R}/entries/approve`, tok.appr, { entryIds: [a, b], comment: 'ok to run' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(2);
    expect(await get(a)).toMatchObject({ approvalStatus: 'APPROVED', approvedBy: ids.appr, approvalRemarks: 'ok to run' });
    expect(await get(b)).toMatchObject({ approvalStatus: 'APPROVED', rejectedBy: null, rejectionStage: null });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_APPROVED', targetId: a } });
    expect(audit!.afterValue).toMatchObject({ comment: 'ok to run' });
    const qnns = (await prisma.qualityNotification.findMany({ where: { pmScheduleEntryId: { in: [a, b] }, action: 'APPROVE' } })).map((q) => q.message);
    expect(qnns.every((m) => /\[batch B-[0-9A-F]{6}, [12] of 2/.test(m ?? ''))).toBe(true);
  });

  it('an approval needs remarks, refused before the signature (D03-13); they are stored trimmed', async () => {
    const a = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL', reviewedBy: ids.rev });
    const bare = await authPost(app, `${R}/entries/approve`, tok.appr, { entryIds: [a] }, PW);
    expect([bare.statusCode, bare.json().error]).toEqual([400, 'VALIDATION']);
    expect((await get(a))!.approvalStatus).toBe('PENDING_APPROVAL');
    await authPost(app, `${R}/entries/approve`, tok.appr, { entryIds: [a], comment: '  released  ' }, PW);
    expect((await get(a))!.approvalRemarks).toBe('released');
  });

  it('the reviewer of an entry may not approve it', async () => {
    const a = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL', reviewedBy: ids.rev });
    const res = await authPost(app, `${R}/entries/approve`, tok.rev, { entryIds: [a], comment: 'released' }, PW);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await get(a))!.approvalStatus).toBe('PENDING_APPROVAL');
  });

  it('unknown ids → 404; non-approval role → FORBIDDEN_ROLE', async () => {
    expect((await authPost(app, `${R}/entries/approve`, tok.appr, { entryIds: [randomUUID()], comment: 'released' }, PW)).statusCode).toBe(404);
    const a = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL' });
    const res = await authPost(app, `${R}/entries/approve`, tok.badrev, { entryIds: [a], comment: 'released' }, PW);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN_ROLE');
  });

  it('reject at approval: blank-after-trim remarks refused, then REJECTED at APPROVAL', async () => {
    const legacy = await entry(hier!.ahuId, { approvalStatus: 'PENDING' });
    const a = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL' });
    const bad = await authPost(app, `${R}/entries/reject`, tok.appr, { entryIds: [a], remarks: '   x  ' }, PW);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('VALIDATION'); // refused before the signature (D03-13)
    const res = await authPost(app, `${R}/entries/reject`, tok.appr, { entryIds: [a, legacy], remarks: ' dates clash ' }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().processed).toBe(2);
    expect((await get(legacy))!.approvalStatus).toBe('REJECTED');
    expect(await get(a)).toMatchObject({ approvalStatus: 'REJECTED', rejectionStage: 'APPROVAL', rejectedBy: ids.appr, approvalRemarks: 'dates clash' });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_REJECTED', targetId: a } });
    expect(audit!.afterValue).toMatchObject({ stage: 'APPROVAL', remarks: 'dates clash' });
    expect((await authPost(app, `${R}/entries/reject`, tok.appr, { entryIds: [randomUUID()], remarks: 'nope nope' }, PW)).statusCode).toBe(404);
    const short = await authPost(app, `${R}/entries/reject`, tok.appr, { entryIds: [a], remarks: 'no' }, PW);
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toBe('VALIDATION_ERROR');
  });
});

describe('resubmit + reviewer edit', () => {
  it('only a REJECTED entry can be resubmitted; unknown → 404; a bad date → INVALID_DATE', async () => {
    const pending = await entry(hier!.ahuId);
    const r1 = await authPost(app, `${R}/entries/${pending}/resubmit`, tok.up, { scheduleDate: iso(day(10)) }, PW);
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error).toBe('INVALID_STATUS');
    expect((await authPost(app, `${R}/entries/${randomUUID()}/resubmit`, tok.up, { scheduleDate: iso(day(10)) }, PW)).statusCode).toBe(404);
    const rej = await entry(hier!.ahuId, { approvalStatus: 'REJECTED' });
    const bad = await authPost(app, `${R}/entries/${rej}/resubmit`, tok.up, { scheduleDate: 'tomorrow' }, PW);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('INVALID_DATE');
  });

  it('workflow ON: resubmit → PENDING_REVIEW with recomputed window, cleared sign-offs, QNN + audit', async () => {
    const rej = await entry(hier!.ahuId, { approvalStatus: 'REJECTED', rejectedBy: ids.rev, rejectionStage: 'REVIEW', reviewedBy: ids.rev, approvalRemarks: 'x' });
    const date = iso(day(20));
    // An uploader role, not a Super Admin (2026-10-24: a Super Admin's own resubmit is approved at once — next test).
    const res = await authPost(app, `${R}/entries/${rej}/resubmit`, tok.badrev, { scheduleDate: date, toleranceDays: 2, qty: 5 }, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json().qnn).toMatch(/^QN-/);
    const e = await get(rej);
    expect(e).toMatchObject({ approvalStatus: 'PENDING_REVIEW', qty: 5, toleranceDays: 2, rejectedBy: null, reviewedBy: null, approvalRemarks: null, rejectionStage: null, submittedBy: ids.badrev });
    expect(iso(e!.windowStart)).toBe(iso(day(18)));
    expect(iso(e!.windowEnd)).toBe(iso(day(22)));
    const a = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_RESUBMITTED', targetId: rej } });
    expect(a!.afterValue).toMatchObject({ scheduleDate: date, toleranceDays: 2 });
    expect(a!.afterValue).not.toHaveProperty('superAdminExemptGates');
    expect((await prisma.qualityNotification.findFirst({ where: { pmScheduleEntryId: rej, action: 'RESUBMIT' } }))!.message).toMatch(/^Resubmitted — /);
  });

  // 2026-10-24 (operator: a Super Admin's own work is not held).
  it('workflow ON: a Super Admin\'s own resubmit is approved at once, recorded REPLACEMENT_REVIEW', async () => {
    const rej = await entry(hier!.ahuId, { approvalStatus: 'REJECTED', rejectedBy: ids.rev, rejectionStage: 'REVIEW', reviewedBy: ids.rev });
    const res = await authPost(app, `${R}/entries/${rej}/resubmit`, tok.up, { scheduleDate: iso(day(40)) }, PW);
    expect(res.statusCode).toBe(200);
    expect(await get(rej)).toMatchObject({ approvalStatus: 'APPROVED', submittedBy: ids.up, reviewedBy: null, approvedBy: null });
    const a = await prisma.auditTrail.findFirst({ where: { action: 'REPLACEMENT_SCHEDULE_RESUBMITTED', targetId: rej } });
    expect(a!.afterValue).toMatchObject({ superAdminExemptGates: ['REPLACEMENT_REVIEW'] });
  });

  it('workflow OFF: resubmit goes straight to APPROVED and keeps the entry tolerance/qty when omitted', async () => {
    await setApproval({ ...WF_ON, workflowEnabled: false });
    try {
      const rej = await entry(hier!.ahuId, { approvalStatus: 'REJECTED', toleranceDays: 4, qty: 3 });
      const res = await authPost(app, `${R}/entries/${rej}/resubmit`, tok.up, { scheduleDate: iso(day(30)) }, PW);
      expect(res.statusCode).toBe(200);
      const e = await get(rej);
      expect(e).toMatchObject({ approvalStatus: 'APPROVED', toleranceDays: 4, qty: 3 });
      expect(iso(e!.windowEnd)).toBe(iso(day(34)));
    } finally {
      await setApproval(WF_ON);
    }
  });

  it('reviewer edit: only PENDING_REVIEW, unknown → 404, bad date → 400, wrong role → 403', async () => {
    const appr = await entry(hier!.ahuId, { approvalStatus: 'APPROVED' });
    const r1 = await authPut(app, `${R}/entries/${appr}/review-edit`, tok.rev, { scheduleDate: iso(day(5)) }, PW);
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error).toBe('INVALID_STATUS');
    expect((await authPut(app, `${R}/entries/${randomUUID()}/review-edit`, tok.rev, { scheduleDate: iso(day(5)) }, PW)).statusCode).toBe(404);
    const pend = await entry(hier!.ahuId);
    const bad = await authPut(app, `${R}/entries/${pend}/review-edit`, tok.rev, { scheduleDate: '2026-13-45x' }, PW);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('INVALID_DATE');
    const forb = await authPut(app, `${R}/entries/${pend}/review-edit`, tok.badrev, { scheduleDate: iso(day(5)) }, PW);
    expect(forb.statusCode).toBe(403);
    expect(forb.json().error).toBe('FORBIDDEN_ROLE');
  });

  it('reviewer edit moves the date in place, stays in review, stamps the reviewer, QNN EDIT + audit', async () => {
    const pend = await entry(hier!.ahuId, { toleranceDays: 1, qty: 2 });
    const res = await authPut(app, `${R}/entries/${pend}/review-edit`, tok.rev, { scheduleDate: iso(day(9)) }, PW);
    expect(res.statusCode).toBe(200);
    const e = await get(pend);
    expect(e).toMatchObject({ approvalStatus: 'PENDING_REVIEW', reviewedBy: ids.rev, toleranceDays: 1, qty: 2 });
    expect(iso(e!.scheduleDate)).toBe(iso(day(9)));
    expect(iso(e!.windowStart)).toBe(iso(day(8)));
    const res2 = await authPut(app, `${R}/entries/${pend}/review-edit`, tok.rev, { scheduleDate: iso(day(9)), toleranceDays: 0, qty: 7 }, PW);
    expect(res2.json()).toMatchObject({ qty: 7, toleranceDays: 0 });
    expect(await prisma.auditTrail.count({ where: { action: 'REPLACEMENT_SCHEDULE_REVIEW_MODIFIED', targetId: pend } })).toBe(2);
    expect(await prisma.qualityNotification.count({ where: { pmScheduleEntryId: pend, action: 'EDIT' } })).toBe(2);
  });
});

describe('task reads', () => {
  let ahuT = ''; let fA = ''; let fB = '';
  const E: Record<string, string> = {};

  beforeAll(async () => {
    ahuT = await newAhu('TASK');
    fA = await filterUnder(ahuT, 'TA');
    fB = await filterUnder(ahuT, 'TB');
    E.due = await entry(ahuT, { approvalStatus: 'APPROVED', qty: 2, qtyReplaced: 0 });
    E.inprog = await entry(ahuT, { approvalStatus: 'APPROVED', qty: 2, qtyReplaced: 1 });
    E.done = await entry(ahuT, { approvalStatus: 'APPROVED', qty: 2, qtyReplaced: 2 });
    E.future = await entry(ahuT, { approvalStatus: 'APPROVED', windowStart: day(10), windowEnd: day(14), scheduleDate: day(12) });
    E.missed = await entry(ahuT, { approvalStatus: 'APPROVED', windowStart: day(-14), windowEnd: day(-10), scheduleDate: day(-12) });
    E.review = await entry(ahuT, { approvalStatus: 'PENDING_REVIEW' });
    // Progress under the all-AHU-filters model: fA replaced (newFilterId = fA) for E.inprog, both for E.done.
    await prisma.replacementExecution.createMany({ data: [
      { entryId: E.inprog, oldFilterId: randomUUID(), newFilterId: fA, performedBy: ids.rpl },
      { entryId: E.done, oldFilterId: randomUUID(), newFilterId: fA, performedBy: ids.rpl },
      { entryId: E.done, oldFilterId: randomUUID(), newFilterId: fB, performedBy: ids.rpl },
      { entryId: E.done, oldFilterId: randomUUID(), newFilterId: null, performedBy: ids.rpl },
    ] });
  }, 60_000);

  it('GET / derives COMPLETED / IN_PROGRESS / DUE / PENDING / MISSED from qty + window', async () => {
    const res = await authGet(app, R, tok.up);
    const mine = res.json().data.find((s: any) => s.id === scheduleId);
    const status = (id: string) => mine.entries.find((e: any) => e.id === id).computedStatus;
    expect([status(E.done), status(E.inprog), status(E.due), status(E.future), status(E.missed)])
      .toEqual(['COMPLETED', 'IN_PROGRESS', 'DUE', 'PENDING', 'MISSED']);
  });

  it('/due lists only APPROVED entries whose window spans today and that are DUE / IN_PROGRESS', async () => {
    const res = await authGet(app, `${R}/due`, tok.op);
    expect(res.statusCode).toBe(200);
    const mine = res.json().data.filter((e: any) => e.ahuId === ahuT);
    expect(mine.map((e: any) => e.id).sort()).toEqual([E.due, E.inprog].sort());
    expect(mine.find((e: any) => e.id === E.inprog)).toMatchObject({ computedStatus: 'IN_PROGRESS', qtyRemaining: 1 });
  });

  it('/tasks reports live AHU-filter progress for every APPROVED entry', async () => {
    const res = await authGet(app, `${R}/tasks`, tok.op);
    expect(res.statusCode).toBe(200);
    const mine = new Map(res.json().data.filter((e: any) => e.ahuId === ahuT).map((e: any) => [e.id, e]));
    expect(mine.has(E.review)).toBe(false);
    expect(mine.get(E.done)).toMatchObject({ total: 2, remaining: 0, replaced: 2, computedStatus: 'COMPLETED', qty: 2, qtyRemaining: 0 });
    expect(mine.get(E.inprog)).toMatchObject({ total: 2, remaining: 1, replaced: 1, computedStatus: 'IN_PROGRESS', replacedNewFilterIds: [fA] });
    expect(mine.get(E.due)).toMatchObject({ remaining: 2, computedStatus: 'DUE' });
    expect(mine.get(E.future)).toMatchObject({ computedStatus: 'PENDING' });
    expect(mine.get(E.missed)).toMatchObject({ computedStatus: 'MISSED' });
  });

  it('/blocked-filters blocks the unreplaced filters of an AHU with a MISSED entry; the single-filter check agrees', async () => {
    const res = await authGet(app, `${R}/blocked-filters`, tok.op);
    expect(res.statusCode).toBe(200);
    expect(res.json().filterIds).toEqual(expect.arrayContaining([fA, fB]));
    expect(await isFilterBlockedForCleaning(fA)).toBe(true);
    expect(await isFilterBlockedForCleaning(randomUUID())).toBe(false);
  });

  it('the single-filter cleaning check is false for a filter whose AHU has no approved entry, or that is no longer active', async () => {
    const quiet = await newAhu('QUIET');
    const fq = await filterUnder(quiet, 'Q1');
    expect(await isFilterBlockedForCleaning(fq)).toBe(false);
    const late = await newAhu('LATEINACT');
    const fl = await filterUnder(late, 'LI1');
    await entry(late, { approvalStatus: 'APPROVED', windowStart: day(-14), windowEnd: day(-10), scheduleDate: day(-12) });
    expect(await isFilterBlockedForCleaning(fl)).toBe(true);
    await prisma.assetInstance.update({ where: { id: fl }, data: { isActive: false } });
    expect(await isFilterBlockedForCleaning(fl)).toBe(false);
  });

  it('a soft-deleted AHU produces no task', async () => {
    const ahuGone = await newAhu('GONE');
    const e = await entry(ahuGone, { approvalStatus: 'APPROVED' });
    await prisma.assetInstance.update({ where: { id: ahuGone }, data: { isActive: false } });
    const due = (await authGet(app, `${R}/due`, tok.op)).json().data.map((x: any) => x.id);
    const tasks = (await authGet(app, `${R}/tasks`, tok.op)).json().data.map((x: any) => x.id);
    expect(due).not.toContain(e);
    expect(tasks).not.toContain(e);
  });

  it('the three task reads refuse a role with none of the task permissions', async () => {
    for (const p of ['/due', '/tasks', '/blocked-filters']) {
      expect((await authGet(app, `${R}${p}`, tok.none)).statusCode, p).toBe(403);
    }
  });
});

describe('POST /entries/:id/execute', () => {
  const exec = (entryId: string, body: Record<string, unknown>, t = tok.rpl, pw: string | null = PW) =>
    authPost(app, `${R}/entries/${entryId}/execute`, t, body, pw ?? undefined);

  it('requires FILTER_REPLACE, then the REPLACE_FILTER e-signature', async () => {
    const id = await entry(hier!.ahuId, { approvalStatus: 'APPROVED' });
    expect((await exec(id, { oldFilterId: randomUUID() }, tok.op)).statusCode).toBe(403);
    const nopw = await exec(id, { oldFilterId: randomUUID() }, tok.rpl, null);
    expect(nopw.statusCode).toBe(401);
    expect(nopw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'REPLACE_FILTER' });
  });

  it('unknown entry → 404; unapproved → 409; unknown filter → 404; filter of another AHU → 409', async () => {
    expect((await exec(randomUUID(), { oldFilterId: randomUUID() })).statusCode).toBe(404);
    const pend = await entry(hier!.ahuId, { approvalStatus: 'PENDING_APPROVAL' });
    const r2 = await exec(pend, { oldFilterId: randomUUID() });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error).toBe('ENTRY_NOT_APPROVED');
    const ok = await entry(hier!.ahuId, { approvalStatus: 'APPROVED' });
    const r3 = await exec(ok, { oldFilterId: randomUUID() });
    expect(r3.statusCode).toBe(404);
    expect(r3.json().message).toBe('Filter not found');
    const otherAhu = await newAhu('OTHER');
    const stray = await filterUnder(otherAhu, 'STRAY');
    const r4 = await exec(ok, { oldFilterId: stray });
    expect(r4.statusCode).toBe(409);
    expect(r4.json().error).toBe('FILTER_NOT_IN_TASK_AHU');
    expect((await prisma.assetInstance.findUnique({ where: { id: stray } }))!.isActive).toBe(true);
  });

  it('an AHU whose filters are all replaced for the task refuses another (ALREADY_COMPLETE)', async () => {
    const ahu = await newAhu('DONE');
    const f = await filterUnder(ahu, 'D1');
    const id = await entry(ahu, { approvalStatus: 'APPROVED' });
    await prisma.replacementExecution.create({ data: { entryId: id, oldFilterId: randomUUID(), newFilterId: f, performedBy: ids.rpl } });
    const res = await exec(id, { oldFilterId: f });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ALREADY_COMPLETE');
  });

  it('replaces filter by filter: IN_PROGRESS then COMPLETED, each execution recorded (in window, remarks sanitised)', async () => {
    const ahu = await newAhu('EXEC');
    const f1 = await filterUnder(ahu, 'E1');
    const f2 = await filterUnder(ahu, 'E2');
    const id = await entry(ahu, { approvalStatus: 'APPROVED', qty: 2 });

    const r1 = await exec(id, { oldFilterId: f1, remarks: '<b>swapped</b>', sneaky: 'dropped' });
    expect(r1.statusCode).toBe(200);
    const b1 = r1.json();
    expect(b1).toMatchObject({ success: true, total: 2, replaced: 1, qtyReplaced: 1, qtyRemaining: 1, status: 'IN_PROGRESS', newFilterName: `cvoW${S}-E1-01` });
    expect((await prisma.assetInstance.findUnique({ where: { id: f1 } }))!.isActive).toBe(false);
    const x1 = await prisma.replacementExecution.findFirst({ where: { entryId: id, oldFilterId: f1 } });
    expect(x1).toMatchObject({ newFilterId: b1.newFilterId, performedBy: ids.rpl, performedByName: U.rpl, isWithinWindow: true });
    expect(x1!.remarks).not.toContain('<b>');

    const r2 = await exec(id, { oldFilterId: f2 });
    expect(r2.json()).toMatchObject({ total: 2, replaced: 2, qtyRemaining: 0, status: 'COMPLETED' });
    expect((await prisma.replacementExecution.findFirst({ where: { entryId: id, oldFilterId: f2 } }))!.remarks).toBeNull();
    expect((await get(id))).toMatchObject({ qtyReplaced: 2, status: 'COMPLETED' });
  });

  it('the same filter cannot be replaced twice: once retired it has left the AHU, so the task refuses it', async () => {
    const ahu = await newAhu('TWICE');
    const f1 = await filterUnder(ahu, 'T1');
    await filterUnder(ahu, 'T2');
    const id = await entry(ahu, { approvalStatus: 'APPROVED' });
    expect((await exec(id, { oldFilterId: f1 })).statusCode).toBe(200);
    const before = await prisma.assetInstance.count({ where: { parentId: ahu } });
    const again = await exec(id, { oldFilterId: f1 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('FILTER_NOT_IN_TASK_AHU');
    expect(await prisma.assetInstance.count({ where: { parentId: ahu } })).toBe(before);
  });

  it('a replacement after the window closed is recorded as outside the window', async () => {
    const ahu = await newAhu('LATE');
    const f = await filterUnder(ahu, 'L1');
    const id = await entry(ahu, { approvalStatus: 'APPROVED', windowStart: day(-9), windowEnd: day(-5), scheduleDate: day(-7) });
    const res = await exec(id, { oldFilterId: f, remarks: 'late' });
    expect(res.statusCode).toBe(200);
    expect((await prisma.replacementExecution.findFirst({ where: { entryId: id } }))!.isWithinWindow).toBe(false);
  });
});

// 2026-10-24: a replacement QNN is tagged for the REPLACEMENT workflow's next role.
// generateQnn used to read PM's roles for every QNN, so a replacement workflow
// naming its own approver tagged its QNNs for PM's approver instead.
describe('QNN routing follows the replacement workflow, not PM', () => {
  it('a review QNN is tagged for the replacement approval role', async () => {
    const ownApprover = `RS_APR_${S}`.slice(0, 20);
    await setApproval({ ...WF_ON, approvalRole: ownApprover });
    try {
      const id = await entry(hier!.ahuId);
      const res = await authPost(app, `${R}/entries/review`, tok.rev, { entryIds: [id], action: 'approve', remarks: 'checked' }, PW);
      expect(res.statusCode).toBe(200);
      const [qnn] = res.json().qnns;
      const note = await prisma.notification.findFirst({ where: { type: 'PM_SCHEDULE_QNN', metadata: { path: ['qnn'], equals: qnn } } });
      expect(note).toMatchObject({ forRole: ownApprover });
    } finally {
      await setApproval(WF_ON);
    }
  });
});
