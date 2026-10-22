/**
 * Filter creation workflow routes (review / approve / reject / resubmit, the
 * pending list and the badge counts) through the real harness app, with the
 * filter-approval config row read AS IT IS on digilog_test_db: workflow off and
 * no roles configured. That row is shared by every concurrent suite, so it is
 * never written here; the configured-roles behaviour lives in
 * filter-workflow-enabled.e2e.test.ts.
 *
 * Filters are put into a workflow state directly (as a bulk upload with the
 * workflow on would leave them), attributed to a creator user of this suite.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../../lib/prisma.js';
import { buildSliceApp, SliceOwner, runTag, PASSWORD, auditFor, type Caller } from './slice-support.js';
import { reviewFilters, approveFilters, rejectFilters } from '../filter-approval.service.js';

const own = new SliceOwner(runTag('CVFA'));
let app: FastifyInstance;
type U = { id: string; username: string; call: Caller };
let sa: U, rv: U, ap: U, up: U, rd: U;
let ahuId: string;

async function pending(name: string, status: 'PENDING_REVIEW' | 'PENDING_APPROVAL' | 'REJECTED' | 'APPROVED', extra: Record<string, unknown> = {}) {
  const id = await own.filter(name, ahuId);
  await prisma.assetInstance.update({
    where: { id },
    data: { approvalStatus: status, submittedBy: up.id, submittedByName: up.username, submittedAt: new Date(), ...extra },
  });
  return id;
}
const stateOf = (id: string) => prisma.assetInstance.findUnique({ where: { id } });

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  const rvRole = await own.role('RV', ['FILTER_REVIEW', 'ASSET_READ']);
  rv = await own.user(app, 'rv', rvRole);
  const apRole = await own.role('AP', ['FILTER_APPROVE', 'ASSET_READ']);
  ap = await own.user(app, 'ap', apRole);
  const upRole = await own.role('UP', ['FILTER_CREATE']);
  up = await own.user(app, 'up', upRole);
  rd = await own.user(app, 'rd', await own.role('RD', ['ASSET_READ']));
  await own.reauth(['REVIEW_FILTER', 'REJECT_FILTER'], rvRole);
  await own.reauth(['APPROVE_FILTER'], apRole);
  await own.reauth(['RESUBMIT_FILTER'], upRole);
  await own.template('FILTER', { isActive: true });
  const blockId = await own.instance('BLOCK', await own.template('BLOCK'));
  ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

describe('filter approval — reading the workflow', () => {
  it('lists the filters in the workflow (default: everything not yet approved) and filters by status', async () => {
    const r1 = await pending('R1', 'PENDING_REVIEW');
    const p1 = await pending('P1', 'PENDING_APPROVAL');
    const x1 = await pending('X1', 'REJECTED', { rejectionRemarks: 'wrong size' });
    const ok = await pending('OK', 'APPROVED');
    const all = await rd.call('GET', '/api/assets/instances/pending-approval');
    expect(all.status).toBe(200);
    const mine = all.body.data.filter((r: any) => r.name.startsWith(own.tag));
    expect(mine.map((r: any) => r.id).sort()).toEqual([r1, p1, x1].sort());
    expect(all.body.total).toBe(all.body.data.length);
    expect(mine.find((r: any) => r.id === x1)).toMatchObject({ approvalStatus: 'REJECTED', rejectionRemarks: 'wrong size', submittedByName: up.username, parentId: ahuId });
    const approved = await rd.call('GET', '/api/assets/instances/pending-approval?status=APPROVED');
    expect(approved.body.data.some((r: any) => r.id === ok)).toBe(true);
    expect(approved.body.data.every((r: any) => r.approvalStatus === 'APPROVED')).toBe(true);
    const bad = await rd.call('GET', '/api/assets/instances/pending-approval?status=MAYBE');
    expect(bad.status).toBe(400);
  });

  it('counts every status (zero-filled) for the Filters page badges', async () => {
    const res = await rd.call('GET', '/api/assets/instances/approval-counts');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['APPROVED', 'PENDING_APPROVAL', 'PENDING_REVIEW', 'REJECTED']);
    // This suite's own rows are part of the site-wide counts.
    expect(res.body.PENDING_REVIEW).toBeGreaterThanOrEqual(1);
    expect(res.body.PENDING_APPROVAL).toBeGreaterThanOrEqual(1);
    expect(res.body.REJECTED).toBeGreaterThanOrEqual(1);
    expect(res.body.APPROVED).toBeGreaterThanOrEqual(1);
    const denied = await up.call('GET', '/api/assets/instances/approval-counts');
    expect(denied.status).toBe(403);
  });
});

describe('filter approval — service guard for non-HTTP callers', () => {
  it('an empty id list is refused by the service itself (the route schema refuses it first)', async () => {
    const ctx = { userId: sa.username, userSub: sa.id, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1' } as any;
    for (const fn of [reviewFilters, approveFilters]) {
      await expect(fn(ctx, [])).rejects.toMatchObject({ statusCode: 400, code: 'NO_FILTERS', message: 'Select at least one filter' });
    }
    await expect(rejectFilters(ctx, [], 'reason')).rejects.toMatchObject({ code: 'NO_FILTERS' });
  });
});

describe('filter approval — review', () => {
  it('moves a batch to PENDING_APPROVAL with attribution and one audit row per filter', async () => {
    const a = await pending('RV-A', 'PENDING_REVIEW');
    const b = await pending('RV-B', 'PENDING_REVIEW');
    const noPw = await rv.call('POST', '/api/assets/instances/review', { body: { filterIds: [a, b] } });
    expect(noPw.status).toBe(401);
    const res = await rv.call('POST', '/api/assets/instances/review', { pw: PASSWORD, body: { filterIds: [a, b], remarks: 'sizes checked' } });
    expect(res.status).toBe(200);
    expect(res.body.reviewed).toBe(2);
    expect(res.body.filters.sort()).toEqual([own.n('RV-A'), own.n('RV-B')]);
    for (const id of [a, b]) {
      expect(await stateOf(id)).toMatchObject({ approvalStatus: 'PENDING_APPROVAL', reviewedBy: rv.id, reviewedByName: rv.username, reviewRemarks: 'sizes checked' });
      const [audit] = await auditFor(id, 'FILTER_REVIEWED');
      expect(audit).toMatchObject({ reason: 'sizes checked', afterValue: { reviewRemarks: 'sizes checked' } });
    }
    // No remarks: stored as null, no reason on the audit row.
    const c = await pending('RV-C', 'PENDING_REVIEW');
    await rv.call('POST', '/api/assets/instances/review', { pw: PASSWORD, body: { filterIds: [c] } });
    expect((await stateOf(c))!.reviewRemarks).toBeNull();
    expect((await auditFor(c, 'FILTER_REVIEWED'))[0].reason).toBeNull();
  });

  it('is all-or-nothing: an unknown id (404), a filter in the wrong state (409) or the creator\'s own filter (403) refuses the batch', async () => {
    const a = await pending('RV-D', 'PENDING_REVIEW');
    const wrong = await pending('RV-E', 'APPROVED');
    const unknown = await sa.call('POST', '/api/assets/instances/review', { body: { filterIds: [a, randomUUID()] } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.message).toBe('One or more filters no longer exist');
    const state = await sa.call('POST', '/api/assets/instances/review', { body: { filterIds: [a, wrong] } });
    expect(state.status).toBe(409);
    expect(state.body).toMatchObject({
      error: 'INVALID_STATUS',
      message: `Cannot review: "${own.n('RV-E')}" is APPROVED. Expected PENDING_REVIEW.`,
      details: { filters: [{ id: wrong, name: own.n('RV-E'), approvalStatus: 'APPROVED' }] },
    });
    const self = await pending('RV-SELF', 'PENDING_REVIEW', { submittedBy: rv.id });
    const own403 = await rv.call('POST', '/api/assets/instances/review', { pw: PASSWORD, body: { filterIds: [a, self] } });
    expect(own403.status).toBe(403);
    expect(own403.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    expect((await stateOf(a))!.approvalStatus).toBe('PENDING_REVIEW');
    const empty = await sa.call('POST', '/api/assets/instances/review', { body: { filterIds: [] } });
    expect(empty.status).toBe(400);
    const wrongPerm = await ap.call('POST', '/api/assets/instances/review', { body: { filterIds: [a] } });
    expect(wrongPerm.status).toBe(403);
  });
});

describe('filter approval — approve', () => {
  it('approves from PENDING_APPROVAL — and, with no review role configured, straight from PENDING_REVIEW', async () => {
    const reviewed = await pending('AP-A', 'PENDING_APPROVAL', { reviewedBy: rv.id });
    const unreviewed = await pending('AP-B', 'PENDING_REVIEW');
    const noPw = await ap.call('POST', '/api/assets/instances/approve', { body: { filterIds: [reviewed] } });
    expect(noPw.status).toBe(401);
    const res = await ap.call('POST', '/api/assets/instances/approve', { pw: PASSWORD, body: { filterIds: [reviewed, unreviewed], remarks: 'released' } });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(2);
    for (const id of [reviewed, unreviewed]) {
      expect(await stateOf(id)).toMatchObject({ approvalStatus: 'APPROVED', approvedBy: ap.id, approvedByName: ap.username, approvalRemarks: 'released' });
      expect((await auditFor(id, 'FILTER_APPROVED'))[0].afterValue).toMatchObject({ approvalRemarks: 'released' });
    }
  });

  it('the reviewer of a filter may not also approve it', async () => {
    const id = await pending('AP-C', 'PENDING_APPROVAL', { reviewedBy: sa.id });
    const res = await sa.call('POST', '/api/assets/instances/approve', { body: { filterIds: [id] } });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(`You cannot approve a filter you created or reviewed yourself ("${own.n('AP-C')}"). A different user must sign off.`);
    const rejected = await pending('AP-D', 'REJECTED');
    const bad = await ap.call('POST', '/api/assets/instances/approve', { pw: PASSWORD, body: { filterIds: [rejected] } });
    expect(bad.status).toBe(409);
    expect(bad.body.message).toBe(`Cannot approve: "${own.n('AP-D')}" is REJECTED. Expected PENDING_APPROVAL or PENDING_REVIEW.`);
  });
});

describe('filter approval — reject and resubmit', () => {
  it('rejects at either step with a trimmed, mandatory reason; the row survives as REJECTED', async () => {
    const atReview = await pending('RJ-A', 'PENDING_REVIEW');
    const atApproval = await pending('RJ-B', 'PENDING_APPROVAL', { reviewedBy: ap.id });
    const missing = await rv.call('POST', '/api/assets/instances/reject', { pw: PASSWORD, body: { filterIds: [atReview] } });
    expect(missing.status).toBe(400);
    const blank = await rv.call('POST', '/api/assets/instances/reject', { pw: PASSWORD, body: { filterIds: [atReview], remarks: '   ' } });
    expect(blank.status).toBe(400);
    expect(blank.body).toMatchObject({ error: 'REASON_REQUIRED', message: 'A rejection reason is required' });
    const noPw = await rv.call('POST', '/api/assets/instances/reject', { body: { filterIds: [atReview], remarks: 'x' } });
    expect(noPw.status).toBe(401);
    const res = await rv.call('POST', '/api/assets/instances/reject', { pw: PASSWORD, body: { filterIds: [atReview, atApproval], remarks: '  wrong micron size  ' } });
    expect(res.status).toBe(200);
    expect(res.body.rejected).toBe(2);
    for (const id of [atReview, atApproval]) {
      expect(await stateOf(id)).toMatchObject({ approvalStatus: 'REJECTED', rejectedBy: rv.id, rejectionRemarks: 'wrong micron size', isActive: true });
      expect((await auditFor(id, 'FILTER_REJECTED'))[0].reason).toBe('wrong micron size');
    }
  });

  it('the reviewer may not reject at the approval step a filter they reviewed; an approved filter cannot be rejected', async () => {
    const id = await pending('RJ-C', 'PENDING_APPROVAL', { reviewedBy: rv.id });
    const res = await rv.call('POST', '/api/assets/instances/reject', { pw: PASSWORD, body: { filterIds: [id], remarks: 'no' } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('SELF_APPROVAL_FORBIDDEN');
    const done = await pending('RJ-D', 'APPROVED');
    const late = await ap.call('POST', '/api/assets/instances/reject', { body: { filterIds: [done], remarks: 'too late' } });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe('INVALID_STATUS');
  });

  it('resubmit puts a rejected filter back to PENDING_REVIEW, clears every decision field and re-attributes it', async () => {
    const id = await pending('RS-A', 'REJECTED', { reviewedBy: rv.id, reviewedByName: rv.username, reviewRemarks: 'r', rejectedBy: rv.id, rejectedByName: rv.username, rejectionRemarks: 'bad', rejectedAt: new Date() });
    const noPw = await up.call('POST', `/api/assets/instances/${id}/resubmit`);
    expect(noPw.status).toBe(401);
    const res = await up.call('POST', `/api/assets/instances/${id}/resubmit`, { pw: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ resubmitted: own.n('RS-A') });
    expect(await stateOf(id)).toMatchObject({
      approvalStatus: 'PENDING_REVIEW', submittedBy: up.id, submittedByName: up.username,
      reviewedBy: null, reviewRemarks: null, rejectedBy: null, rejectionRemarks: null, rejectedAt: null, approvedBy: null,
    });
    const [audit] = await auditFor(id, 'FILTER_RESUBMITTED');
    expect(audit.afterValue).toEqual({ filterName: own.n('RS-A') });
    const again = await up.call('POST', `/api/assets/instances/${id}/resubmit`, { pw: PASSWORD });
    expect(again.status).toBe(409);
    expect(again.body.message).toBe(`Cannot re-submit: "${own.n('RS-A')}" is PENDING_REVIEW. Expected REJECTED.`);
    const ghost = await sa.call('POST', `/api/assets/instances/${randomUUID()}/resubmit`);
    expect(ghost.status).toBe(404);
    const denied = await rd.call('POST', `/api/assets/instances/${id}/resubmit`);
    expect(denied.status).toBe(403);
  });
});
