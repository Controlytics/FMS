/**
 * A-03 / A-07 (operator decision 2026-10-21): stage-approval segregation of
 * duties is NOT configurable. The performer of a Wash Out / Dry Out stage can
 * never approve or reject it — even if a stored stage-interlock config still
 * carries the retired `requireDifferentApprover: false` — and a request with no
 * caller id is refused (fail closed), never treated as "a different person".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    cleaningStageApproval: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    filterDetails: { findMany: vi.fn(), findUnique: vi.fn() },
    cleaningCycle: { findMany: vi.fn().mockResolvedValue([]) },
    filterEvent: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
// The retired switch, still sitting in stored config, must change nothing.
vi.mock('../../filter-operations/stage-interlock.js', () => ({
  getInterlockConfig: vi.fn(async () => ({ enabled: true, requireDifferentApprover: false })),
  prettyStage: (s: string) => s,
}));

import { stageApprovalService } from '../service.js';
import { prisma } from '../../../lib/prisma.js';

const pending = {
  id: 'a1', cycleId: 'c1', filterId: 'f1', stageKey: 'WASH_OUT', status: 'PENDING',
  approverRole: 'QA', rejectToStateKey: 'WASH_IN', attemptSeq: 1, detailsSnapshot: {},
  requestedBy: 'sub-performer', requestedByName: 'performer', requestedAt: new Date(),
};
const ctxOf = (userSub: string | undefined) =>
  ({ userId: 'qa', userRole: 'QA', userSub, ipAddress: '127.0.0.1', userAgent: 't', sessionId: 's' }) as any;

describe('stage approvals — segregation of duties is always on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.cleaningStageApproval.findUnique).mockResolvedValue(pending as any);
  });

  it('the performer cannot approve their own stage', async () => {
    await expect(stageApprovalService.approve(ctxOf('sub-performer'), 'a1', 'looks fine'))
      .rejects.toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('the performer cannot reject their own stage', async () => {
    await expect(stageApprovalService.reject(ctxOf('sub-performer'), 'a1', 'needs a re-clean'))
      .rejects.toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('a caller with no id is refused (fail closed), not treated as a different person', async () => {
    await expect(stageApprovalService.approve(ctxOf(undefined), 'a1', 'looks fine'))
      .rejects.toMatchObject({ statusCode: 403, code: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('the queue marks the performer\'s own rows as not actionable', async () => {
    vi.mocked(prisma.cleaningStageApproval.findMany).mockResolvedValue([pending] as any);
    vi.mocked(prisma.filterDetails.findMany).mockResolvedValue([
      { assetInstanceId: 'f1', currentLifecycleState: 'WASH_OUT', currentCycleId: 'c1' },
    ] as any);
    const mine = await stageApprovalService.queue(ctxOf('sub-performer'));
    expect(mine[0]).toMatchObject({ id: 'a1', selfRequested: true });
    const theirs = await stageApprovalService.queue(ctxOf('sub-other'));
    expect(theirs[0]).toMatchObject({ id: 'a1', selfRequested: false });
  });
});
