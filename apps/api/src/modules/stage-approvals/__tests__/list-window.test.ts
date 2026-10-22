import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 2026-10-17 load test (operator decision): `GET /api/stage-approvals` with no
 * window returned every approval ever made — 1.0 M rows after one year of
 * production volume, 39 s and then a hard failure (V8 string limit). The route
 * now accepts `from`: every PENDING row (whatever its age) plus everything
 * requested on/after `from`. These tests lock the WHERE the service builds; the
 * role scoping must survive as a sibling AND clause, not be overwritten.
 */
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    cleaningStageApproval: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn(), updateMany: vi.fn() },
    filterDetails: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
    cleaningCycle: { findMany: vi.fn().mockResolvedValue([]) },
    filterEvent: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../../filter-operations/stage-interlock.js', () => ({
  getInterlockConfig: vi.fn(async () => ({})),
  prettyStage: (s: string) => s,
}));

import { stageApprovalService } from '../service.js';
import { prisma } from '../../../lib/prisma.js';

const qa = { userId: 'qa1', userRole: 'QA', userSub: 'sub-qa1', ipAddress: '127.0.0.1', userAgent: 't', sessionId: 's' } as any;
const sa = { ...qa, userId: 'sa', userRole: 'SUPER_ADMIN', userSub: 'sub-sa' };
const whereOfLastCall = () => vi.mocked(prisma.cleaningStageApproval.findMany).mock.calls.at(-1)![0]!.where as any;

describe('stage-approvals list window (`from`)', () => {
  beforeEach(() => { vi.mocked(prisma.cleaningStageApproval.findMany).mockClear(); });

  it('no `from`: unchanged — role scope only', async () => {
    await stageApprovalService.list(qa, {});
    expect(whereOfLastCall()).toEqual({ AND: [{ OR: [{ approverRole: 'QA' }, { requestedBy: 'sub-qa1' }] }] });
  });

  // 2026-10-22: the window is read as two index-friendly queries (PENDING of
  // any age; requested on/after `from`), each keeping the role scope, merged in
  // the service — one OR made the planner walk the whole requested_at index.
  const whereOfCalls = () => vi.mocked(prisma.cleaningStageApproval.findMany).mock.calls.map((c) => c[0]!.where as any);

  it('`from`: PENDING rows of any age + rows requested on/after from, each AND the role scope', async () => {
    const from = '2026-09-17T00:00:00.000Z';
    await stageApprovalService.list(qa, { from });
    const scope = { OR: [{ approverRole: 'QA' }, { requestedBy: 'sub-qa1' }] };
    expect(whereOfCalls()).toEqual([
      { AND: [scope, { status: 'PENDING' }] },
      { AND: [scope, { requestedAt: { gte: new Date(from) } }] },
    ]);
  });

  it('SUPER_ADMIN with `from` and a status filter: window only, status kept on both halves', async () => {
    const from = '2026-09-17T00:00:00.000Z';
    await stageApprovalService.list(sa, { status: 'APPROVED', from });
    expect(whereOfCalls()).toEqual([
      { status: 'APPROVED', AND: [{ status: 'PENDING' }] },
      { status: 'APPROVED', AND: [{ requestedAt: { gte: new Date(from) } }] },
    ]);
  });

  it('the two halves are merged once per row, newest requestedAt first', async () => {
    const at = (d: string) => new Date(`2026-10-${d}T00:00:00.000Z`);
    const findMany = vi.mocked(prisma.cleaningStageApproval.findMany);
    findMany
      .mockResolvedValueOnce([{ id: 'old-pending', requestedAt: at('01') }, { id: 'both', requestedAt: at('20') }] as any)
      .mockResolvedValueOnce([{ id: 'new', requestedAt: at('21') }, { id: 'both', requestedAt: at('20') }] as any);
    const rows = await stageApprovalService.list(sa, { from: '2026-10-15T00:00:00.000Z' });
    expect(rows.map((r: any) => r.id)).toEqual(['new', 'both', 'old-pending']);
  });

  it('an unparseable `from` is ignored rather than turned into an empty list', async () => {
    await stageApprovalService.list(sa, { from: 'not-a-date' });
    expect(whereOfLastCall()).toEqual({});
  });
});
