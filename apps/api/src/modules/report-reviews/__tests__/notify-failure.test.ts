import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A failed submitter notification is best-effort: the §11 decision and its
 * audit row must stand. (The assignee-side failure is exercised by
 * concurrent-decision.test.ts; the real-database flow by e2e/report-reviews.)
 */

const { mockPrisma } = vi.hoisted(() => {
  const m: any = { reportReview: { findUnique: vi.fn(), updateMany: vi.fn() } };
  m.$transaction = vi.fn(async (fn: (tx: any) => unknown) => fn(m));
  return { mockPrisma: m };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue('audit-id') }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: vi.fn().mockRejectedValue(new Error('store down')) }));

import { reportReviewService } from '../service.js';
import { auditLog } from '../../../lib/audit.js';

beforeEach(() => vi.clearAllMocks());

describe('notifySubmitter failure', () => {
  it('an approval still returns the APPROVED row and is still audited', async () => {
    const row = { id: 'r1', title: 'T', status: 'PENDING_APPROVAL', generatedBy: 'gen', reviewedBy: 'rev', assigneeUserId: 'app', assigneeRole: null, reportType: 'x', generatedByName: 'gen' };
    mockPrisma.reportReview.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, status: 'APPROVED' });
    mockPrisma.reportReview.updateMany.mockResolvedValue({ count: 1 });
    const out = await reportReviewService.approve({ userSub: 'app', userId: 'approver', userRole: 'QA' } as any, 'r1', 'approve', 'all good');
    expect(out.status).toBe('APPROVED');
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPORT_REVIEW_APPROVED', targetId: 'r1' }), mockPrisma);
  });
});
