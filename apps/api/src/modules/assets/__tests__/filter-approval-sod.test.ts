/**
 * OQ-18 / BR-061 (operator decision 2026-10-19: "require a different person"):
 * the user who created a filter may not review, approve or reject it, and the
 * reviewer may not also approve it — the same segregation PM and replacement
 * schedules enforce. Before the fix only role separation guarded this.
 *
 * Real database (digilog_test_db). Owns its template + filters; the
 * filter-approval config row is read as-is (blank roles on the test DB).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { reviewFilters, approveFilters, rejectFilters } from '../filter-approval.service.js';
import type { RequestContext } from '../../../types/context.js';

const SUFFIX = `sod-${Date.now()}`;
const mk = (name: string, role = 'QA') => ({
  userId: `${name}_${SUFFIX}`, userSub: randomUUID(), userRole: role,
  ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: undefined,
}) as unknown as RequestContext;
const creator = mk('creator', 'SUPERVISOR');
const reviewer = mk('reviewer', 'MANAGER');
const approver = mk('approver', 'QA');

let templateId = '';
const ids: string[] = [];
async function filter(status: 'PENDING_REVIEW' | 'PENDING_APPROVAL', reviewedBy: string | null = null) {
  const f = await prisma.assetInstance.create({
    data: { name: `SOD-${SUFFIX}-${ids.length}`, templateId, approvalStatus: status, submittedBy: creator.userSub, submittedByName: creator.userId, reviewedBy },
  });
  ids.push(f.id);
  return f.id;
}

describe('filter approval — segregation of duties (OQ-18)', () => {
  beforeAll(async () => {
    await prisma.templateKind.upsert({ where: { code: 'FILTER' }, update: {}, create: { code: 'FILTER', label: 'Filter', isSystem: true } });
    templateId = (await prisma.assetTemplate.create({ data: { name: `SOD Tpl ${SUFFIX}`, templateKind: 'FILTER' } })).id;
  });
  afterAll(async () => {
    try {
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
      await prisma.assetInstance.deleteMany({ where: { id: { in: ids } } });
      await prisma.assetTemplate.delete({ where: { id: templateId } }).catch(() => undefined);
    } catch { /* cleanup must never mask a failure */ }
  });

  it('the creator cannot review, approve or reject their own filter', async () => {
    const id = await filter('PENDING_REVIEW');
    for (const fn of [() => reviewFilters(creator, [id], 'checked'), () => approveFilters(creator, [id], 'released'), () => rejectFilters(creator, [id], 'not mine to reject')]) {
      await expect(fn()).rejects.toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
    }
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('the reviewer cannot also approve', async () => {
    const id = await filter('PENDING_APPROVAL', reviewer.userSub);
    await expect(approveFilters(reviewer, [id], 'released')).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('a different reviewer and a different approver succeed', async () => {
    const id = await filter('PENDING_REVIEW');
    await reviewFilters(reviewer, [id], 'checked');
    await approveFilters(approver, [id], 'released');
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.approvalStatus).toBe('APPROVED');
  });

  it('one own filter in a batch refuses the whole batch and names it', async () => {
    const other = await filter('PENDING_REVIEW');
    await prisma.assetInstance.update({ where: { id: other }, data: { submittedBy: randomUUID() } });
    const own = await filter('PENDING_REVIEW');
    await expect(reviewFilters(creator, [other, own], 'checked')).rejects.toThrow(/SOD-/);
    const rows = await prisma.assetInstance.findMany({ where: { id: { in: [other, own] } } });
    expect(rows.every((r) => r.approvalStatus === 'PENDING_REVIEW')).toBe(true);
  });
});

/**
 * A-06 / A-07 (operator decisions 2026-10-21): each step is rejected by ITS role,
 * like PM and replacement schedules — the reviewer no longer acts at the
 * approval step — and a caller with no id is refused (fail closed).
 */
describe('filter approval — reject by step (A-06) and fail-closed SoD (A-07)', () => {
  let cfgExisted = false;
  let cfgOriginal: unknown;
  beforeAll(async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-approval' } });
    cfgExisted = !!row; cfgOriginal = row?.configValue;
    // The first group's afterAll deleted its template; this group owns its own.
    templateId = (await prisma.assetTemplate.create({ data: { name: `SOD Tpl2 ${SUFFIX}`, templateKind: 'FILTER' } })).id;
    const value = { workflowEnabled: true, uploadRole: ['SUPERVISOR'], reviewRole: 'MANAGER', approvalRole: 'QA' };
    await prisma.systemConfig.upsert({
      where: { configKey: 'filter-approval' },
      update: { configValue: value }, create: { configKey: 'filter-approval', configValue: value, configType: 'workflow' },
    });
  });
  afterAll(async () => {
    try {
      await prisma.filterDetails.deleteMany({ where: { assetInstanceId: { in: ids } } });
      await prisma.assetInstance.deleteMany({ where: { id: { in: ids } } });
      await prisma.assetTemplate.delete({ where: { id: templateId } }).catch(() => undefined);
    } catch { /* cleanup must never mask a failure */ }
    if (cfgExisted) await prisma.systemConfig.update({ where: { configKey: 'filter-approval' }, data: { configValue: cfgOriginal as any } });
    else await prisma.systemConfig.deleteMany({ where: { configKey: 'filter-approval' } });
  });

  it('the reviewer may reject at the REVIEW step', async () => {
    const id = await filter('PENDING_REVIEW');
    await rejectFilters(reviewer, [id], 'wrong micron size');
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.approvalStatus).toBe('REJECTED');
  });

  it('the reviewer may NOT reject at the APPROVAL step (was allowed before A-06)', async () => {
    const id = await filter('PENDING_APPROVAL', randomUUID());
    await expect(rejectFilters(reviewer, [id], 'second thoughts')).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN_ROLE' });
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.approvalStatus).toBe('PENDING_APPROVAL');
  });

  it('the approver may NOT reject at the REVIEW step, and may at the APPROVAL step', async () => {
    const atReview = await filter('PENDING_REVIEW');
    await expect(rejectFilters(approver, [atReview], 'skip review')).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    const atApproval = await filter('PENDING_APPROVAL', reviewer.userSub);
    await rejectFilters(approver, [atApproval], 'label does not match the AHU');
    expect((await prisma.assetInstance.findUnique({ where: { id: atApproval } }))?.approvalStatus).toBe('REJECTED');
  });

  it('whoever reviewed a filter cannot reject it at the approval step either (SoD)', async () => {
    const both = mk('both', 'QA');
    const id = await filter('PENDING_APPROVAL', both.userSub);
    await expect(rejectFilters(both, [id], 'reviewed it myself')).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('a caller with no id is refused (fail closed)', async () => {
    const id = await filter('PENDING_APPROVAL', reviewer.userSub);
    const anonymous = { ...approver, userSub: undefined } as unknown as RequestContext;
    await expect(approveFilters(anonymous, [id], 'released')).rejects.toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
  });
});
