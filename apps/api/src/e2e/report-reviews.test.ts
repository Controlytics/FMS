/**
 * e2e — /api/report-reviews: the 3-stage review / approval workflow for ad-hoc
 * report exports (routes.ts + service.ts) — a 21 CFR §11 e-signature surface.
 *
 * Covered end to end against digilog_test_db: submit (permission, config-driven
 * re-auth, input + assignee validation, snapshot truncation, audit, assignee
 * notification), the actionable queue, the list, snapshot VISIBILITY
 * (canViewReportReview — party-only), review and approve with their always-on
 * re-auth, assignee enforcement, separation of duties (which SUPER_ADMIN does
 * NOT bypass), remarks on rejection, status guards, notifications to the
 * submitter, and a real concurrent-decision race.
 *
 * Owns five roles + their users, a SUPER_ADMIN, and every review row and
 * notification it causes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import reportReviewRoutes from '../modules/report-reviews/routes.js';
import { runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, addReauth, removeReauth, cleanupAll, type ReauthGrant } from './support/owned-fixtures.js';

const SUF = runSuffix();
const PREFIX = `ZZRR-${SUF}`;
const PW = 'CovReview@2026x';
const U = {
  SA: `cv_rr_sa_${SUF}`, GEN: `cv_rr_gen_${SUF}`, OTHER: `cv_rr_oth_${SUF}`, NOBODY: `cv_rr_no_${SUF}`,
  REV1: `cv_rr_rev1_${SUF}`, REV2: `cv_rr_rev2_${SUF}`, APP1: `cv_rr_app1_${SUF}`, APP2: `cv_rr_app2_${SUF}`,
} as const;
for (const k of Object.keys(U) as Array<keyof typeof U>) (U as any)[k] = U[k].toLowerCase();
const R = { SUB: `CVRR_S_${SUF}`, REV: `CVRR_R_${SUF}`, APP: `CVRR_A_${SUF}`, OTH: `CVRR_O_${SUF}`, NO: `CVRR_N_${SUF}` };

let app: FastifyInstance;
const tok: Record<string, string> = {};
const uid: Record<string, string> = {};
let reauthAdded: ReauthGrant = [];
const base = '/api/report-reviews';

const call = (method: 'GET' | 'POST', url: string, who: string, payload?: unknown, pw: string | null = PW) =>
  app.inject({
    method, url,
    headers: { authorization: `Bearer ${tok[who]}`, ...(pw ? { 'x-reauth-password': pw } : {}) },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
const submit = async (who: string, assignee: { assigneeUserId?: string; assigneeRole?: string }, title = `${PREFIX} report`) => {
  const res = await call('POST', base, who, { reportType: 'cleaning-record', title, subtitle: 'Block A', dataSnapshot: { rows: [1, 2, 3] }, ...assignee });
  expect(res.statusCode).toBe(200);
  return res.json().id as string;
};
const row = (id: string) => prisma.reportReview.findUnique({ where: { id } });
const audits = (id: string) => prisma.auditTrail.findMany({ where: { targetId: id }, orderBy: { chainPosition: 'asc' } });
const noteFor = (id: string, type: string) => prisma.notification.findFirst({ where: { type: type as any, metadata: { path: ['reportReviewId'], equals: id } } });

beforeAll(async () => {
  app = await buildApp([{ prefix: base, plugin: reportReviewRoutes }]);
  await createRole(R.SUB, ['REPORT_REVIEW_SUBMIT']);
  await createRole(R.REV, ['REPORT_REVIEW']);
  await createRole(R.APP, ['REPORT_APPROVE']);
  await createRole(R.OTH, ['REPORT_REVIEW_SUBMIT']);
  await createRole(R.NO, ['AUDIT_READ']);
  const roleOf: Record<string, string> = {
    [U.SA]: 'SUPER_ADMIN', [U.GEN]: R.SUB, [U.OTHER]: R.OTH, [U.NOBODY]: R.NO, [U.REV1]: R.REV, [U.REV2]: R.REV, [U.APP1]: R.APP, [U.APP2]: R.APP,
  };
  for (const [u, r] of Object.entries(roleOf)) {
    uid[u] = await createUser(u, r, PW, `RR ${u}`);
    tok[u] = await login(app, u, PW);
  }
  reauthAdded = await addReauth([['SUBMIT_REPORT_REVIEW', R.SUB]]);
}, 120_000);

afterAll(async () => {
  try {
    const users = Object.values(U);
    let ids: string[] = [];
    await cleanupAll([
      ['re-auth keys', () => removeReauth(reauthAdded)],
      ['find reviews', async () => { ids = (await prisma.reportReview.findMany({ where: { generatedBy: { in: Object.values(uid) } }, select: { id: true } })).map((r) => r.id); }],
      ['notifications', () => prisma.notification.deleteMany({
        where: { OR: [{ forUserId: { in: users } }, { forRole: { in: Object.values(R) } }, ...ids.map((id) => ({ metadata: { path: ['reportReviewId'], equals: id } }))] },
      })],
      ['reviews', () => prisma.reportReview.deleteMany({ where: { id: { in: ids } } })],
      ['users', () => deleteUsers(Object.values(uid))],
      ['roles', () => deleteRoles(Object.values(R))],
    ]);
  } finally {
    await app?.close();
  }
}, 120_000);

describe('POST / (send for review)', () => {
  it('needs REPORT_REVIEW_SUBMIT and honours the re-auth policy', async () => {
    expect((await call('POST', base, U.NOBODY, { reportType: 't', title: 't', dataSnapshot: {}, assigneeRole: R.REV })).statusCode).toBe(403);
    const noPw = await call('POST', base, U.GEN, { reportType: 't', title: 't', dataSnapshot: {}, assigneeRole: R.REV }, null);
    expect(noPw.statusCode).toBe(401);
    expect(noPw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'SUBMIT_REPORT_REVIEW' });
  });

  it('refuses missing input and a missing assignee before writing anything', async () => {
    const before = await prisma.reportReview.count({ where: { generatedBy: uid[U.GEN] } });
    expect((await call('POST', base, U.GEN, { reportType: 't', title: 't' })).statusCode).toBe(400); // schema: dataSnapshot required
    const nullSnap = await call('POST', base, U.GEN, { reportType: 't', title: 't', dataSnapshot: null, assigneeRole: R.REV });
    expect(nullSnap.json()).toMatchObject({ error: 'INVALID_INPUT' });
    expect((await call('POST', base, U.GEN, { reportType: 't', title: '', dataSnapshot: {}, assigneeRole: R.REV })).json().error).toBe('INVALID_INPUT');
    const noAssignee = await call('POST', base, U.GEN, { reportType: 't', title: 't', dataSnapshot: {}, assigneeUserId: '  ', assigneeRole: ' ' });
    expect(noAssignee.json()).toMatchObject({ error: 'ASSIGNEE_REQUIRED', message: 'Choose a user or a role to send this to.' });
    expect(await prisma.reportReview.count({ where: { generatedBy: uid[U.GEN] } })).toBe(before);
  });

  it('snapshots the report for a user assignee (user wins over role), audits it and notifies that user', async () => {
    // A 600-char title is accepted and stored truncated to the column's 500; the
    // signature text that embeds it must still fit audit_trail.signature_meaning
    // (varchar 255) - before 2026-10-21 it overflowed AFTER the row was written.
    const res = await call('POST', base, U.GEN, {
      reportType: 'cleaning-record', title: `${PREFIX} ${'T'.repeat(600)}`, subtitle: 'S'.repeat(1200), dataSnapshot: { rows: [{ a: 1 }] },
      assigneeUserId: uid[U.REV1], assigneeRole: R.REV,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { id, status } = res.json();
    expect(status).toBe('PENDING_REVIEW');
    const r = await row(id);
    expect(r).toMatchObject({ generatedBy: uid[U.GEN], generatedByName: U.GEN, assigneeUserId: uid[U.REV1], assigneeRole: null, dataSnapshot: { rows: [{ a: 1 }] } });
    expect(r!.title).toHaveLength(500);
    expect(r!.subtitle).toHaveLength(1000);
    const [a] = await audits(id);
    expect(a).toMatchObject({ action: 'REPORT_REVIEW_SUBMITTED', userId: U.GEN, userRole: R.SUB, targetType: 'report_review' });
    expect(a.afterValue).toMatchObject({ reportType: 'cleaning-record', assignee: { assigneeUserId: uid[U.REV1], assigneeRole: null } });
    expect(a.signatureMeaning).toMatch(/submitted for review$/);
    expect(a.signatureMeaning!.length).toBeLessThanOrEqual(255);
    expect(a.signatureMeaning).toContain(`Report "${PREFIX} TTT`);
    expect(a.afterValue).toMatchObject({ title: r!.title }); // the full stored title is still in the record
    const n = await noteFor(id, 'REPORT_REVIEW_REQUESTED');
    expect(n).toMatchObject({ forUserId: U.REV1, forRole: null, title: 'Report awaiting your review', createdBy: U.GEN });
  });

  it('a role assignee is notified by role; an unknown user assignee gets no notification but the report is still created', async () => {
    const byRole = await submit(U.GEN, { assigneeRole: R.REV });
    expect(await noteFor(byRole, 'REPORT_REVIEW_REQUESTED')).toMatchObject({ forRole: R.REV, forUserId: null });
    const ghost = await submit(U.GEN, { assigneeUserId: randomUUID() });
    expect((await row(ghost))?.status).toBe('PENDING_REVIEW');
    expect(await noteFor(ghost, 'REPORT_REVIEW_REQUESTED')).toBeNull();
    const noSubtitle = await call('POST', base, U.GEN, { reportType: 't', title: `${PREFIX} plain`, dataSnapshot: [], assigneeRole: R.REV });
    expect((await row(noSubtitle.json().id))?.subtitle).toBeNull();
  });
});

describe('a failed audit write leaves no report behind (one transaction)', () => {
  it('submit: when the signature row cannot be written, the review row is rolled back too', async () => {
    // Real fault, no mocks: audit_trail.ip_address is varchar(45). OTHER's role
    // has no re-auth policy, so the only audit write in this request is the
    // submit's own row - which the over-long client address makes fail.
    const title = `${PREFIX} rollback-probe`;
    const res = await app.inject({
      method: 'POST', url: base, remoteAddress: 'f'.repeat(60),
      headers: { authorization: `Bearer ${tok[U.OTHER]}` },
      payload: { reportType: 'cleaning-record', title, dataSnapshot: { x: 1 }, assigneeRole: R.REV },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.reportReview.count({ where: { title } })).toBe(0);
    expect(await prisma.notification.count({ where: { message: { contains: title } } })).toBe(0);
  });
});

describe('queue, list, and who may see a snapshot', () => {
  let userAssigned = '', roleAssigned = '';
  beforeAll(async () => {
    userAssigned = await submit(U.GEN, { assigneeUserId: uid[U.REV1] }, `${PREFIX} Q-user`);
    roleAssigned = await submit(U.GEN, { assigneeRole: R.REV }, `${PREFIX} Q-role`);
  });

  it('the queue holds what the caller can act on now, tagged with its stage', async () => {
    const q1 = (await call('GET', `${base}/queue`, U.REV1)).json().data;
    expect(q1.find((r: any) => r.id === userAssigned)).toMatchObject({ stage: 'REVIEW', status: 'PENDING_REVIEW' });
    expect(q1.find((r: any) => r.id === roleAssigned)).toMatchObject({ stage: 'REVIEW' }); // by role
    const q2 = (await call('GET', `${base}/queue`, U.REV2)).json().data;
    expect(q2.some((r: any) => r.id === userAssigned)).toBe(false);
    expect(q2.some((r: any) => r.id === roleAssigned)).toBe(true);
    expect((await call('GET', `${base}/queue`, U.GEN)).json().data.some((r: any) => r.id === roleAssigned)).toBe(false);
    expect(q1[0]).not.toHaveProperty('dataSnapshot');
    expect((await call('GET', `${base}/queue`, U.NOBODY)).statusCode).toBe(403);
  });

  it('the list filters by status and by "mine", never carrying the snapshot', async () => {
    const mine = (await call('GET', `${base}?mine=true`, U.GEN)).json().data;
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((r: any) => r.generatedByName === U.GEN)).toBe(true);
    expect(mine[0]).not.toHaveProperty('dataSnapshot');
    const pending = (await call('GET', `${base}?status=PENDING_REVIEW`, U.REV1)).json().data;
    expect(pending.every((r: any) => r.status === 'PENDING_REVIEW')).toBe(true);
    expect(pending.some((r: any) => r.id === roleAssigned)).toBe(true);
    expect((await call('GET', `${base}?mine=false&status=APPROVED`, U.GEN)).json().data.every((r: any) => r.status === 'APPROVED')).toBe(true);
    expect((await call('GET', base, U.NOBODY)).statusCode).toBe(403);
  });

  it('the snapshot is readable by the generator, the assignee (user or role) and SUPER_ADMIN only', async () => {
    for (const who of [U.GEN, U.REV1, U.SA]) {
      const r = await call('GET', `${base}/${userAssigned}`, who);
      expect({ who, status: r.statusCode }).toEqual({ who, status: 200 });
      expect(r.json().dataSnapshot).toEqual({ rows: [1, 2, 3] });
    }
    expect((await call('GET', `${base}/${roleAssigned}`, U.REV2)).statusCode).toBe(200);
    for (const who of [U.OTHER, U.REV2, U.APP1]) {
      const r = await call('GET', `${base}/${userAssigned}`, who);
      expect({ who, status: r.statusCode, error: r.json().error }).toEqual({ who, status: 403, error: 'FORBIDDEN' });
    }
    expect((await call('GET', `${base}/${randomUUID()}`, U.SA)).json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});

describe('review stage', () => {
  it('always demands a signature: no password 401, wrong password 401', async () => {
    const id = await submit(U.GEN, { assigneeUserId: uid[U.REV1] });
    const noPw = await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve', assigneeRole: R.APP }, null);
    expect(noPw.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'REVIEW_REPORT' });
    const bad = await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve', assigneeRole: R.APP }, 'Wrong@Pass1');
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('REAUTH_FAILED');
    expect((await row(id))?.status).toBe('PENDING_REVIEW');
    // Clear the failure streak for the rest of the file.
    await prisma.user.update({ where: { id: uid[U.REV1] }, data: { failedLoginAttempts: 0 } });
  });

  it('only the assignee may review; the generator may not even as SUPER_ADMIN (separation of duties)', async () => {
    const id = await submit(U.GEN, { assigneeUserId: uid[U.REV1] });
    const notMine = await call('POST', `${base}/${id}/review`, U.REV2, { action: 'approve', assigneeRole: R.APP });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json()).toMatchObject({ error: 'NOT_ASSIGNEE', message: 'This report is not assigned to you or your role.' });
    expect((await call('POST', `${base}/${id}/review`, U.APP1, { action: 'approve' })).statusCode).toBe(403); // no REPORT_REVIEW

    const saOwn = await submit(U.SA, { assigneeRole: R.REV });
    const self = await call('POST', `${base}/${saOwn}/review`, U.SA, { action: 'approve', assigneeRole: R.APP });
    expect(self.statusCode).toBe(403);
    expect(self.json().error).toBe('SELF_REVIEW');
    expect((await row(saOwn))?.status).toBe('PENDING_REVIEW');
  });

  it('rejection needs remarks; approval needs the next assignee; neither writes on refusal', async () => {
    const id = await submit(U.GEN, { assigneeUserId: uid[U.REV1] });
    for (const remarks of [undefined, ' ok ']) {
      const r = await call('POST', `${base}/${id}/review`, U.REV1, { action: 'reject', ...(remarks !== undefined ? { remarks } : {}) });
      expect(r.json()).toMatchObject({ error: 'REMARKS_REQUIRED' });
    }
    expect((await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve' })).json().error).toBe('ASSIGNEE_REQUIRED');
    expect((await call('POST', `${base}/${id}/review`, U.REV1, { action: 'maybe' })).statusCode).toBe(400);
    expect((await row(id))?.status).toBe('PENDING_REVIEW');
    expect((await audits(id)).map((a) => a.action)).toEqual(['REPORT_REVIEW_SUBMITTED']);
  });

  it('reviewer approves -> PENDING_APPROVAL with the approver assigned, signed, approver notified; a second review is refused', async () => {
    const id = await submit(U.GEN, { assigneeUserId: uid[U.REV1] });
    const res = await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve', remarks: '  fine  ', assigneeUserId: uid[U.APP1] });
    expect(res.json()).toEqual({ id, status: 'PENDING_APPROVAL' });
    expect(await row(id)).toMatchObject({ reviewedBy: uid[U.REV1], reviewedByName: U.REV1, reviewRemarks: 'fine', assigneeUserId: uid[U.APP1], assigneeRole: null });
    const reviewed = (await audits(id)).find((a) => a.action === 'REPORT_REVIEW_REVIEWED');
    expect(reviewed).toMatchObject({ userId: U.REV1, userRole: R.REV });
    expect(reviewed?.afterValue).toMatchObject({ status: 'PENDING_APPROVAL', reviewRemarks: 'fine', approvalRemarks: null });
    expect(reviewed?.signatureMeaning).toBe(`Report "${PREFIX} report" reviewed (sent for approval)`);
    expect(reviewed?.signatureAuditId).toBeTruthy(); // linked to the REAUTH_SUCCESS row of this request
    const n = (await prisma.notification.findMany({ where: { type: 'REPORT_REVIEW_REQUESTED', forUserId: U.APP1, metadata: { path: ['reportReviewId'], equals: id } } }));
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('Report awaiting your approval');
    // The reviewer, now a past actor, can still read the snapshot.
    expect((await call('GET', `${base}/${id}`, U.REV1)).statusCode).toBe(200);

    const again = await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve', assigneeRole: R.APP });
    expect(again.json()).toMatchObject({ error: 'INVALID_STATUS', message: 'This report is not awaiting review.' });
    expect((await call('POST', `${base}/${randomUUID()}/review`, U.REV1, { action: 'approve' })).statusCode).toBe(404);
  });

  it('reviewer rejects (by role): REJECTED at REVIEW, assignees cleared, submitter told', async () => {
    const id = await submit(U.GEN, { assigneeRole: R.REV });
    const res = await call('POST', `${base}/${id}/review`, U.REV2, { action: 'reject', remarks: '  wrong block  ' });
    expect(res.json()).toEqual({ id, status: 'REJECTED' });
    expect(await row(id)).toMatchObject({ rejectionStage: 'REVIEW', rejectedBy: uid[U.REV2], rejectedByName: U.REV2, reviewRemarks: 'wrong block', assigneeUserId: null, assigneeRole: null });
    expect((await audits(id)).find((a) => a.action === 'REPORT_REVIEW_REJECTED')?.afterValue).toMatchObject({ status: 'REJECTED', reviewRemarks: 'wrong block' });
    expect(await noteFor(id, 'REPORT_REVIEW_REJECTED')).toMatchObject({ forUserId: U.GEN, title: 'Report rejected at review' });
    expect((await call('GET', `${base}/${id}`, U.REV2)).statusCode).toBe(200); // the rejecter keeps access
  });
});

describe('approval stage', () => {
  const toApproval = async (approver: { assigneeUserId?: string; assigneeRole?: string }) => {
    const id = await submit(U.GEN, { assigneeUserId: uid[U.REV1] });
    expect((await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve', ...approver })).statusCode).toBe(200);
    return id;
  };

  it('guards: wrong stage, wrong approver, no signature, short rejection remarks', async () => {
    const pendingReview = await submit(U.GEN, { assigneeRole: R.APP });
    expect((await call('POST', `${base}/${pendingReview}/approve`, U.APP1, { action: 'approve' })).json()).toMatchObject({ error: 'INVALID_STATUS', message: 'This report is not awaiting approval.' });
    const id = await toApproval({ assigneeUserId: uid[U.APP1] });
    // It now sits in the approver's queue at the APPROVE stage, and left the reviewer's.
    expect((await call('GET', `${base}/queue`, U.APP1)).json().data.find((r: any) => r.id === id)).toMatchObject({ stage: 'APPROVE', status: 'PENDING_APPROVAL' });
    expect((await call('GET', `${base}/queue`, U.REV1)).json().data.some((r: any) => r.id === id)).toBe(false);
    expect((await call('POST', `${base}/${id}/approve`, U.APP2, { action: 'approve' })).json().error).toBe('NOT_ASSIGNEE');
    expect((await call('POST', `${base}/${id}/approve`, U.APP1, { action: 'approve' }, null)).json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'APPROVE_REPORT' });
    expect((await call('POST', `${base}/${id}/approve`, U.APP1, { action: 'reject', remarks: 'no' })).json().error).toBe('REMARKS_REQUIRED');
    expect((await call('POST', `${base}/${id}/approve`, U.REV1, { action: 'approve' })).statusCode).toBe(403); // no REPORT_APPROVE
    expect((await call('POST', `${base}/${randomUUID()}/approve`, U.APP1, { action: 'approve' })).statusCode).toBe(404);
    expect((await row(id))?.status).toBe('PENDING_APPROVAL');
  });

  it('the reviewer cannot also approve — SUPER_ADMIN included', async () => {
    const id = await submit(U.GEN, { assigneeRole: R.REV });
    expect((await call('POST', `${base}/${id}/review`, U.SA, { action: 'approve', assigneeRole: R.APP })).statusCode).toBe(200);
    const res = await call('POST', `${base}/${id}/approve`, U.SA, { action: 'approve' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SELF_APPROVE');
    const own = await submit(U.SA, { assigneeRole: R.REV });
    expect((await call('POST', `${base}/${own}/review`, U.REV1, { action: 'approve', assigneeRole: R.APP })).statusCode).toBe(200);
    expect((await call('POST', `${base}/${own}/approve`, U.SA, { action: 'approve' })).json().error).toBe('SELF_APPROVE');
  });

  it('approver approves -> APPROVED, signed, assignees cleared, submitter told; approver keeps read access', async () => {
    const id = await toApproval({ assigneeRole: R.APP });
    const res = await call('POST', `${base}/${id}/approve`, U.APP2, { action: 'approve', remarks: '   ' });
    expect(res.json()).toEqual({ id, status: 'APPROVED' });
    expect(await row(id)).toMatchObject({ approvedBy: uid[U.APP2], approvedByName: U.APP2, approvalRemarks: null, assigneeUserId: null, assigneeRole: null });
    expect((await audits(id)).map((a) => a.action)).toEqual(['REPORT_REVIEW_SUBMITTED', 'REPORT_REVIEW_REVIEWED', 'REPORT_REVIEW_APPROVED']);
    expect(await noteFor(id, 'REPORT_REVIEW_APPROVED')).toMatchObject({ forUserId: U.GEN, title: 'Report approved' });
    expect((await call('GET', `${base}/${id}`, U.APP2)).statusCode).toBe(200);
    expect((await call('GET', `${base}?status=APPROVED`, U.GEN)).json().data.some((r: any) => r.id === id)).toBe(true);
  });

  it('approver rejects -> REJECTED at APPROVAL with remarks recorded and signed', async () => {
    const id = await toApproval({ assigneeUserId: uid[U.APP1] });
    const res = await call('POST', `${base}/${id}/approve`, U.APP1, { action: 'reject', remarks: ' readings missing ' });
    expect(res.json()).toEqual({ id, status: 'REJECTED' });
    expect(await row(id)).toMatchObject({ rejectionStage: 'APPROVAL', rejectedBy: uid[U.APP1], approvalRemarks: 'readings missing', approvedBy: null });
    expect((await audits(id)).at(-1)).toMatchObject({ action: 'REPORT_REVIEW_REJECTED', signatureMeaning: `Report "${PREFIX} report" rejected at approval` });
    expect(await noteFor(id, 'REPORT_REVIEW_REJECTED')).toMatchObject({ title: 'Report rejected at approval' });
  });

  it('a maximum-length title never stops a decision from being signed and recorded', async () => {
    const id = await submit(U.GEN, { assigneeUserId: uid[U.REV1] }, `${PREFIX} ${'L'.repeat(495)}`);
    expect((await row(id))!.title).toHaveLength(500);
    expect((await call('POST', `${base}/${id}/review`, U.REV1, { action: 'approve', assigneeUserId: uid[U.APP1] })).statusCode).toBe(200);
    // "rejected at approval" is the longest signature suffix.
    const res = await call('POST', `${base}/${id}/approve`, U.APP1, { action: 'reject', remarks: 'title too long to read' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ id, status: 'REJECTED' });
    const decisions = (await audits(id)).filter((a) => a.action !== 'REPORT_REVIEW_SUBMITTED');
    expect(decisions.map((a) => a.action)).toEqual(['REPORT_REVIEW_REVIEWED', 'REPORT_REVIEW_REJECTED']);
    for (const a of decisions) {
      expect(a.signatureMeaning!.length).toBeLessThanOrEqual(255);
      expect(a.signatureMeaning).toMatch(/^Report "ZZRR-/);
    }
    expect(decisions[1].signatureMeaning).toMatch(/rejected at approval$/);
  });

  it('concurrent approvers: exactly one decision lands; never "approved and rejected at once"', async () => {
    const id = await toApproval({ assigneeRole: R.APP });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      call('POST', `${base}/${id}/approve`, i % 2 ? U.APP1 : U.APP2, i % 3 ? { action: 'approve' } : { action: 'reject', remarks: `race ${i}` })));
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x) => x.statusCode !== 200)) {
      expect([409, 400]).toContain(r.statusCode);
      expect(['CONCURRENT_DECISION', 'INVALID_STATUS']).toContain(r.json().error);
    }
    const final = await row(id);
    expect(final?.status).toBe(ok[0].json().status);
    expect(!!final?.approvedBy && !!final?.rejectedBy).toBe(false);
    const decisions = (await audits(id)).filter((a) => a.action === 'REPORT_REVIEW_APPROVED' || a.action === 'REPORT_REVIEW_REJECTED');
    expect(decisions).toHaveLength(1);
  });
});
