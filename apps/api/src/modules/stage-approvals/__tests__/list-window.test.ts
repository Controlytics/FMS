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

  it('`from`: PENDING rows of any age OR requested on/after from, AND the role scope', async () => {
    const from = '2026-09-17T00:00:00.000Z';
    await stageApprovalService.list(qa, { from });
    expect(whereOfLastCall()).toEqual({
      AND: [
        { OR: [{ approverRole: 'QA' }, { requestedBy: 'sub-qa1' }] },
        { OR: [{ status: 'PENDING' }, { requestedAt: { gte: new Date(from) } }] },
      ],
    });
  });

  it('SUPER_ADMIN with `from` and a status filter: window only, status kept', async () => {
    const from = '2026-09-17T00:00:00.000Z';
    await stageApprovalService.list(sa, { status: 'APPROVED', from });
    expect(whereOfLastCall()).toEqual({
      status: 'APPROVED',
      AND: [{ OR: [{ status: 'PENDING' }, { requestedAt: { gte: new Date(from) } }] }],
    });
  });

  it('an unparseable `from` is ignored rather than turned into an empty list', async () => {
    await stageApprovalService.list(sa, { from: 'not-a-date' });
    expect(whereOfLastCall()).toEqual({});
  });
});
