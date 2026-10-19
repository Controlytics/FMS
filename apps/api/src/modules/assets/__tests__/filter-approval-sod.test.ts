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
    for (const fn of [() => reviewFilters(creator, [id]), () => approveFilters(creator, [id]), () => rejectFilters(creator, [id], 'not mine to reject')]) {
      await expect(fn()).rejects.toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
    }
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.approvalStatus).toBe('PENDING_REVIEW');
  });

  it('the reviewer cannot also approve', async () => {
    const id = await filter('PENDING_APPROVAL', reviewer.userSub);
    await expect(approveFilters(reviewer, [id])).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('a different reviewer and a different approver succeed', async () => {
    const id = await filter('PENDING_REVIEW');
    await reviewFilters(reviewer, [id]);
    await approveFilters(approver, [id]);
    expect((await prisma.assetInstance.findUnique({ where: { id } }))?.approvalStatus).toBe('APPROVED');
  });

  it('one own filter in a batch refuses the whole batch and names it', async () => {
    const other = await filter('PENDING_REVIEW');
    await prisma.assetInstance.update({ where: { id: other }, data: { submittedBy: randomUUID() } });
    const own = await filter('PENDING_REVIEW');
    await expect(reviewFilters(creator, [other, own])).rejects.toThrow(/SOD-/);
    const rows = await prisma.assetInstance.findMany({ where: { id: { in: [other, own] } } });
    expect(rows.every((r) => r.approvalStatus === 'PENDING_REVIEW')).toBe(true);
  });
});
