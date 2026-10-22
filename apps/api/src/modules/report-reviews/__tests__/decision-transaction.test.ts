import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A review / approval decision and its signature audit row commit together
 * (2026-10-21). Before, `decideIfStill` committed the status change and the
 * audit row was written afterwards on its own, so an audit failure left an
 * applied §11 decision with no record of it while the caller saw an error.
 *
 * The e2e suite cannot inject that failure on these routes (their always-on
 * re-auth writes its own audit row first), so this checks the wiring: the
 * decision's update and its audit write run in ONE transaction client, and an
 * audit failure propagates with no notification sent.
 */

const { mockPrisma, tx } = vi.hoisted(() => {
  const tx = { reportReview: { updateMany: vi.fn(), findUnique: vi.fn() } };
  const mockPrisma: any = {
    reportReview: { findUnique: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(async (fn: (t: any) => unknown) => fn(tx)),
  };
  return { mockPrisma, tx };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }));

import { reportReviewService } from '../service.js';
import { auditLog } from '../../../lib/audit.js';
import { createNotification } from '../../notifications/notification.service.js';

const pendingApproval = {
  id: 'r1', title: 'T', status: 'PENDING_APPROVAL', reportType: 'x', generatedBy: 'gen', generatedByName: 'gen',
  reviewedBy: 'rev', assigneeUserId: 'app', assigneeRole: null,
};
const ctx: any = { userSub: 'app', userId: 'approver', userRole: 'QA' };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.reportReview.findUnique.mockResolvedValue(pendingApproval);
  tx.reportReview.updateMany.mockResolvedValue({ count: 1 });
  tx.reportReview.findUnique.mockResolvedValue({ ...pendingApproval, status: 'APPROVED' });
});

describe('decision + its audit row are one transaction', () => {
  it('the status update and the signature audit row use the same transaction client', async () => {
    (auditLog as any).mockResolvedValue('audit-id');
    await reportReviewService.approve(ctx, 'r1', 'approve', 'all good');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.reportReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1', status: 'PENDING_APPROVAL' } }));
    expect(mockPrisma.reportReview.updateMany).not.toHaveBeenCalled(); // never outside the transaction
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPORT_REVIEW_APPROVED', targetId: 'r1' }), tx);
  });

  it('an audit failure fails the decision and notifies nobody', async () => {
    (auditLog as any).mockRejectedValue(new Error('value too long for type character varying(255)'));
    await expect(reportReviewService.approve(ctx, 'r1', 'reject', 'not acceptable')).rejects.toThrow(/varying\(255\)/);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('review() is wired the same way', async () => {
    (auditLog as any).mockResolvedValue('audit-id');
    mockPrisma.reportReview.findUnique.mockResolvedValue({ ...pendingApproval, status: 'PENDING_REVIEW', reviewedBy: null, assigneeUserId: 'rev' });
    tx.reportReview.findUnique.mockResolvedValue({ ...pendingApproval, status: 'PENDING_APPROVAL', assigneeUserId: 'next' });
    await reportReviewService.review({ ...ctx, userSub: 'rev' }, 'r1', 'approve', 'fine', 'next');
    expect(tx.reportReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1', status: 'PENDING_REVIEW' } }));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'REPORT_REVIEW_REVIEWED' }), tx);
  });

  it('the signature text stays within audit_trail.signature_meaning (255) for a 500-char title', async () => {
    (auditLog as any).mockResolvedValue('audit-id');
    const long = { ...pendingApproval, title: 'X'.repeat(500) };
    mockPrisma.reportReview.findUnique.mockResolvedValue(long);
    tx.reportReview.findUnique.mockResolvedValue({ ...long, status: 'REJECTED' });
    await reportReviewService.approve(ctx, 'r1', 'reject', 'too long');
    const meaning = (auditLog as any).mock.calls[0][0].signatureMeaning as string;
    expect(meaning.length).toBeLessThanOrEqual(255);
    expect(meaning).toMatch(/^Report "X+…" rejected at approval$/);
  });
});
