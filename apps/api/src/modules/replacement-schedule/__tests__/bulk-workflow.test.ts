/**
 * Replacement schedule — bulk review/approve and task execution guards (2026-10-08).
 *
 *  - Bulk review / approve process every actionable entry in one call, each
 *    with its own QNN tagged "[batch B-…, n of N …]" (parity with PM).
 *  - Segregation of duties by USER: the uploader may not review or approve
 *    their own entries, the reviewer may not approve. One own entry refuses the
 *    WHOLE batch before anything is written (SELF_APPROVAL_FORBIDDEN).
 *  - Executing a task needs an APPROVED entry (ENTRY_NOT_APPROVED) and a filter
 *    that belongs to the task's AHU (FILTER_NOT_IN_TASK_AHU) — both checked
 *    before the replace runs, so nothing is retired.
 *
 * Service-level against digilog_test_db; every row created here is removed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import type { RequestContext } from '../../../types/context.js';
import { reviewEntries, approveEntries } from '../workflow.js';
import { executeReplacement } from '../service.js';

const UPLOADER = randomUUID();
const REVIEWER = randomUUID();
const APPROVER = randomUUID();
const ctxOf = (sub: string, name: string): RequestContext =>
  ({ userId: name, userSub: sub, userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', sessionId: 'bulk-wf-test' });

let scheduleId = '';
const ahuId = randomUUID();
const createdFilterIds: string[] = [];
let templateId = '';

async function entry(over: Record<string, unknown> = {}) {
  const today = new Date();
  return (await prisma.replacementScheduleEntry.create({
    data: {
      scheduleId, slNo: 1, ahuId, ahuName: `BWF-AHU-${scheduleId.slice(0, 4)}`,
      filterMicron: '10', filterSize: '610x610x150', qty: 2,
      scheduleDate: today, toleranceDays: 7, windowStart: today, windowEnd: today,
      status: 'PENDING', approvalStatus: 'PENDING_REVIEW',
      submittedBy: UPLOADER, submittedByName: 'uploader',
      ...over,
    } as any,
  })).id;
}
const qnnMessages = (entryIds: string[]) =>
  prisma.qualityNotification.findMany({ where: { pmScheduleEntryId: { in: entryIds } }, select: { message: true } });

beforeAll(async () => {
  scheduleId = (await prisma.replacementSchedule.create({
    data: { fileName: 'bulk-wf.xlsx', status: 'ACTIVE', uploadedBy: UPLOADER, uploadedByName: 'uploader' },
  })).id;
  templateId = (await prisma.assetTemplate.findFirst({ where: { templateKind: 'FILTER' }, select: { id: true } }))?.id
    ?? (await prisma.assetTemplate.create({ data: { name: `BWF Filter ${Date.now()}`, templateKind: 'FILTER' } })).id;
});

afterAll(async () => {
  const ids = (await prisma.replacementScheduleEntry.findMany({ where: { scheduleId }, select: { id: true } })).map((e) => e.id);
  await prisma.qualityNotification.deleteMany({ where: { pmScheduleEntryId: { in: ids } } }).catch(() => undefined);
  await prisma.replacementScheduleEntry.deleteMany({ where: { scheduleId } }).catch(() => undefined);
  await prisma.replacementSchedule.delete({ where: { id: scheduleId } }).catch(() => undefined);
  for (const id of createdFilterIds) await prisma.assetInstance.delete({ where: { id } }).catch(() => undefined);
});

describe('bulk review / approve', () => {
  it('reviews and approves several entries in one call, each QNN tagged as one batch', async () => {
    const ids = [await entry(), await entry(), await entry()];
    const r = await reviewEntries(ctxOf(REVIEWER, 'reviewer'), ids, 'approve');
    expect(r.processed).toBe(3);
    const a = await approveEntries(ctxOf(APPROVER, 'approver'), ids);
    expect(a.processed).toBe(3);
    const rows = await prisma.replacementScheduleEntry.findMany({ where: { id: { in: ids } } });
    expect(rows.every((e) => e.approvalStatus === 'APPROVED')).toBe(true);
    const msgs = (await qnnMessages(ids)).map((m) => m.message ?? '');
    expect(msgs).toHaveLength(6);
    expect(msgs.filter((m) => /\[batch B-[0-9A-F]{6}, [123] of 3/.test(m))).toHaveLength(6);
  });

  it('skips entries that are not at the step (partial success)', async () => {
    const pending = await entry();
    const done = await entry({ approvalStatus: 'APPROVED' });
    const r = await reviewEntries(ctxOf(REVIEWER, 'reviewer'), [pending, done], 'approve');
    expect(r.processed).toBe(1);
  });
});

describe('segregation of duties', () => {
  it('the uploader cannot review their own entry — the whole batch is refused, nothing written', async () => {
    const other = await entry({ submittedBy: randomUUID(), submittedByName: 'someone' });
    const own = await entry();
    await expect(reviewEntries(ctxOf(UPLOADER, 'uploader'), [other, own], 'approve'))
      .rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
    const rows = await prisma.replacementScheduleEntry.findMany({ where: { id: { in: [other, own] } } });
    expect(rows.every((e) => e.approvalStatus === 'PENDING_REVIEW')).toBe(true);
  });

  it('the reviewer cannot also approve', async () => {
    const id = await entry({ approvalStatus: 'PENDING_APPROVAL', reviewedBy: REVIEWER, reviewedByName: 'reviewer' });
    await expect(approveEntries(ctxOf(REVIEWER, 'reviewer'), [id])).rejects.toMatchObject({ code: 'SELF_APPROVAL_FORBIDDEN' });
  });
});

describe('executing a replacement task', () => {
  const filterUnder = async (parentId: string | null) => {
    const f = await prisma.assetInstance.create({ data: { name: `BWF-F-${randomUUID().slice(0, 8)}`, templateId, parentId } });
    createdFilterIds.push(f.id);
    return f.id;
  };

  it('refuses an entry that is not approved — nothing is replaced', async () => {
    const id = await entry({ approvalStatus: 'PENDING_REVIEW' });
    const fid = await filterUnder(null);
    await expect(executeReplacement(id, fid, 'x', ctxOf(APPROVER, 'approver'))).rejects.toMatchObject({ code: 'ENTRY_NOT_APPROVED' });
    expect((await prisma.assetInstance.findUnique({ where: { id: fid } }))?.isActive).toBe(true);
  });

  it('refuses a filter from another AHU — nothing is replaced', async () => {
    const id = await entry({ approvalStatus: 'APPROVED' });
    const fid = await filterUnder(null); // not under the task's AHU
    await expect(executeReplacement(id, fid, 'x', ctxOf(APPROVER, 'approver'))).rejects.toMatchObject({ code: 'FILTER_NOT_IN_TASK_AHU' });
    expect((await prisma.assetInstance.findUnique({ where: { id: fid } }))?.isActive).toBe(true);
  });
});
