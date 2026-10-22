/**
 * Filter creation workflow ENABLED, with roles configured.
 *
 * Why one function is mocked: the switch is the shared system_config row
 * 'filter-approval'. Turning it on in digilog_test_db would put every filter
 * that other suites create concurrently into PENDING_REVIEW (and
 * filter-approval-sod.test.ts relies on its blank roles). So ONLY
 * `getFilterWorkflowConfig` is replaced, at the module boundary, with a value
 * this file controls. Everything else is real: routes, RBAC, re-auth, the
 * services, Prisma, the mirror triggers, the audit trail. (vitest isolates
 * module mocks per test file.)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const wf = vi.hoisted(() => ({ current: { workflowEnabled: false, uploadRole: [] as string[], reviewRole: '', approvalRole: '' } }));
vi.mock('../filter-workflow.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../filter-workflow.js')>();
  return { ...real, getFilterWorkflowConfig: async () => ({ ...wf.current, uploadRole: [...wf.current.uploadRole] }) };
});

import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { prisma } from '../../../lib/prisma.js';
import { buildSliceApp, SliceOwner, runTag, auditFor, type Caller } from './slice-support.js';

const own = new SliceOwner(runTag('CVWF'));
let app: FastifyInstance;
type U = { id: string; username: string; role: string; call: Caller };
let sa: U, up: U, rv: U, ap: U;
let ahuId: string;
let filterTpl: string;
let blockTpl: string;

const stateOf = (id: string) => prisma.assetInstance.findUnique({ where: { id } });

beforeAll(async () => {
  app = await buildSliceApp();
  sa = await own.user(app, 'sa', 'SUPER_ADMIN');
  // Every role holds every workflow permission, so only the CONFIGURED role
  // decides who may act — that is the rule under test.
  const perms = ['ASSET_READ', 'ASSET_CREATE', 'FILTER_CREATE', 'FILTER_REVIEW', 'FILTER_APPROVE'];
  up = await own.user(app, 'up', await own.role('UP', perms));
  rv = await own.user(app, 'rv', await own.role('RV', perms));
  ap = await own.user(app, 'ap', await own.role('AP', perms));
  filterTpl = await own.template('FILTER', { isActive: true });
  blockTpl = await own.template('BLOCK');
  const blockId = await own.instance('BLOCK', blockTpl);
  ahuId = await own.instance('AHU', await own.template('AHU'), blockId);
  wf.current = { workflowEnabled: true, uploadRole: [up.role], reviewRole: rv.role, approvalRole: ap.role };
}, 60_000);

afterAll(async () => {
  await own.cleanup();
  await app?.close();
}, 60_000);

let typed: string;
let generic: string;

describe('workflow on — creation lands in PENDING_REVIEW, attributed', () => {
  it('the typed create stamps PENDING_REVIEW + submitter on the mirrored row, inside the create transaction', async () => {
    const res = await up.call('POST', '/api/hierarchy/filters', { body: { name: own.n('TYPED'), ahuId } });
    expect(res.status).toBe(201);
    typed = res.body.data.id;
    const row = await stateOf(typed);
    expect(row).toMatchObject({ approvalStatus: 'PENDING_REVIEW', submittedBy: up.id, submittedByName: up.username });
    expect(row!.submittedAt).toBeTruthy();
  });

  it('the generic create does the same for a FILTER template, and leaves a Block APPROVED with no attribution', async () => {
    const res = await up.call('POST', '/api/assets/instances', { body: { name: own.n('GENERIC'), templateId: filterTpl, parentId: ahuId } });
    expect(res.status).toBe(201);
    generic = res.body.data.id;
    expect(res.body.data).toMatchObject({ approvalStatus: 'PENDING_REVIEW', submittedBy: up.id, submittedByName: up.username });
    const block = await up.call('POST', '/api/assets/instances', { body: { name: own.n('BLOCK-2'), templateId: blockTpl } });
    expect(block.body.data).toMatchObject({ approvalStatus: 'APPROVED', submittedBy: null, submittedByName: null });
  });

  it('only the configured upload role may create filters, on either path', async () => {
    for (const [url, body] of [
      ['/api/hierarchy/filters', { name: own.n('NOT-UP-1'), ahuId }],
      ['/api/assets/instances', { name: own.n('NOT-UP-2'), templateId: filterTpl, parentId: ahuId }],
    ] as const) {
      const res = await rv.call('POST', url, { body });
      expect(res.status, url).toBe(403);
      expect(res.body).toMatchObject({ error: 'FORBIDDEN_ROLE', message: `Only users with role "${up.role}" can create filters` });
    }
    expect(await prisma.filter.count({ where: { name: { in: [own.n('NOT-UP-1'), own.n('NOT-UP-2')] } } })).toBe(0);
  });

  it('a bulk upload stamps every row PENDING_REVIEW, and refuses each row for a role that may not create filters', async () => {
    const upload = async (who: U, names: string[]) => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Filters');
      ws.addRow(['name', 'filterSet']);
      for (const name of names) ws.addRow([name, 'A']);
      const file = Buffer.from(await wb.xlsx.writeBuffer());
      const boundary = `----wf${Date.now()}`;
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ahuId"\r\n\r\n${ahuId}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="u.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`),
        file, Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return who.call('POST', '/api/assets/instances/bulk-upload-filters', { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    };
    const ok = await upload(up, [own.n('BULK-1'), own.n('BULK-2')]);
    expect(ok.body).toMatchObject({ created: 2, failed: 0 });
    const rows = await prisma.assetInstance.findMany({ where: { name: { in: [own.n('BULK-1'), own.n('BULK-2')] } } });
    expect(rows.map((r) => [r.approvalStatus, r.submittedBy])).toEqual([['PENDING_REVIEW', up.id], ['PENDING_REVIEW', up.id]]);

    const refused = await upload(rv, [own.n('BULK-3')]);
    expect(refused.status).toBe(200);
    expect(refused.body).toMatchObject({ created: 0, failed: 1 });
    expect(refused.body.results).toEqual([{ row: 2, name: own.n('BULK-3'), status: 'error', error: `Only users with role "${up.role}" can create filters` }]);
    expect(await prisma.filter.count({ where: { name: own.n('BULK-3') } })).toBe(0);
  });

  it('a pending filter cannot be operated or tagged', async () => {
    const tagRes = await sa.call('POST', '/api/assets/identifiers', { body: { assetId: typed, identifierType: 'RFID', identifierValue: `${own.tag}T` } });
    expect(tagRes.status).toBe(409);
    expect(tagRes.body.error).toBe('FILTER_NOT_APPROVED');
    const move = await sa.call('PATCH', `/api/assets/instances/${typed}/lifecycle-state`, { body: { lifecycleState: 'INSTALLED', remarks: 'x' } });
    expect(move.status).toBe(409);
  });
});

describe('workflow on — each step is decided by its configured role', () => {
  it('review needs the review role; approval needs a reviewed filter and the approval role', async () => {
    const wrongReviewer = await ap.call('POST', '/api/assets/instances/review', { body: { filterIds: [typed] } });
    expect(wrongReviewer.status).toBe(403);
    expect(wrongReviewer.body.message).toBe(`Only users with role "${rv.role}" can review filters`);
    // With a review role configured, approval may not skip the review (A-F3).
    const skip = await ap.call('POST', '/api/assets/instances/approve', { body: { filterIds: [typed] } });
    expect(skip.status).toBe(409);
    expect(skip.body.message).toBe(`Cannot approve: "${own.n('TYPED')}" is PENDING_REVIEW. Expected PENDING_APPROVAL.`);

    const reviewed = await rv.call('POST', '/api/assets/instances/review', { body: { filterIds: [typed] } });
    expect(reviewed.status).toBe(200);
    const wrongApprover = await rv.call('POST', '/api/assets/instances/approve', { body: { filterIds: [typed] } });
    expect(wrongApprover.status).toBe(403);
    expect(wrongApprover.body.message).toBe(`Only users with role "${ap.role}" can approve filters`);
    const approved = await ap.call('POST', '/api/assets/instances/approve', { body: { filterIds: [typed] } });
    expect(approved.status).toBe(200);
    expect((await stateOf(typed))!.approvalStatus).toBe('APPROVED');
    expect(await auditFor(typed, 'FILTER_APPROVED')).toHaveLength(1);
  });

  it('a rejection is decided by the role of the step the filter is at; SUPER_ADMIN may reject at any step', async () => {
    const atReview = await up.call('POST', '/api/hierarchy/filters', { body: { name: own.n('RJ-1'), ahuId } });
    const id1 = atReview.body.data.id;
    const byApprover = await ap.call('POST', '/api/assets/instances/reject', { body: { filterIds: [id1], remarks: 'no' } });
    expect(byApprover.status).toBe(403);
    expect(byApprover.body).toMatchObject({
      error: 'FORBIDDEN_ROLE',
      message: `You cannot reject "${own.n('RJ-1')}" at its current step: review is decided by role "${rv.role}".`,
    });
    const byReviewer = await rv.call('POST', '/api/assets/instances/reject', { body: { filterIds: [id1], remarks: 'wrong AHU' } });
    expect(byReviewer.status).toBe(200);

    const atApproval = await up.call('POST', '/api/hierarchy/filters', { body: { name: own.n('RJ-2'), ahuId } });
    const id2 = atApproval.body.data.id;
    await rv.call('POST', '/api/assets/instances/review', { body: { filterIds: [id2] } });
    const reviewerAtApproval = await rv.call('POST', '/api/assets/instances/reject', { body: { filterIds: [id2], remarks: 'no' } });
    expect(reviewerAtApproval.status).toBe(403);
    expect(reviewerAtApproval.body.message).toBe(`You cannot reject "${own.n('RJ-2')}" at its current step: approval is decided by role "${ap.role}".`);
    const bySa = await sa.call('POST', '/api/assets/instances/reject', { body: { filterIds: [id2, generic], remarks: 'admin cleanup' } });
    expect(bySa.status).toBe(200);
    expect(bySa.body.rejected).toBe(2);

    // Only the upload role may re-submit.
    const notUp = await rv.call('POST', `/api/assets/instances/${id1}/resubmit`);
    expect(notUp.status).toBe(403);
    expect(notUp.body.message).toBe(`Only users with role "${up.role}" can re-submit filters`);
    const resubmit = await up.call('POST', `/api/assets/instances/${id1}/resubmit`);
    expect(resubmit.status).toBe(200);
    expect((await stateOf(id1))!.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('with no review role configured the approval role decides a rejection at the review step', async () => {
    wf.current = { ...wf.current, reviewRole: '' };
    const created = await up.call('POST', '/api/hierarchy/filters', { body: { name: own.n('RJ-3'), ahuId } });
    const id = created.body.data.id;
    const byReviewer = await rv.call('POST', '/api/assets/instances/reject', { body: { filterIds: [id], remarks: 'no' } });
    expect(byReviewer.status).toBe(403);
    expect(byReviewer.body.message).toContain(`review is decided by role "${ap.role}"`);
    const byApprover = await ap.call('POST', '/api/assets/instances/reject', { body: { filterIds: [id], remarks: 'not needed' } });
    expect(byApprover.status).toBe(200);
  });
});
