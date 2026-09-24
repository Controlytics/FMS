import { describe, it, expect } from 'vitest';
import { pendingWorkflowSteps } from '../pending-workflow-steps';

const rows = [
  { id: 'a', approvalStatus: 'PENDING_REVIEW' },
  { id: 'b', approvalStatus: 'PENDING_REVIEW' },
  { id: 'c', approvalStatus: 'PENDING_APPROVAL' },
  { id: 'd', approvalStatus: 'APPROVED' },
  { id: 'e', approvalStatus: 'REJECTED' },
  { id: 'f', approvalStatus: 'PENDING_REVIEW', currentState: 'RETIRED' },
];

describe('pendingWorkflowSteps', () => {
  it('reviewer gets only PENDING_REVIEW rows; approver gets only PENDING_APPROVAL rows', () => {
    const r = pendingWorkflowSteps(rows, { canReview: true, canApprove: false });
    expect(r.review.map(x => x.id)).toEqual(['a', 'b']);
    expect(r.approve).toEqual([]);
    const a = pendingWorkflowSteps(rows, { canReview: false, canApprove: true });
    expect(a.review).toEqual([]);
    expect(a.approve.map(x => x.id)).toEqual(['c']);
  });

  it('an approver never sees unreviewed rows in the bulk list (sequence kept)', () => {
    const a = pendingWorkflowSteps(rows, { canReview: false, canApprove: true });
    expect(a.approve.some(x => x.approvalStatus === 'PENDING_REVIEW')).toBe(false);
  });

  it('no permission → nothing, whatever is pending', () => {
    expect(pendingWorkflowSteps(rows, { canReview: false, canApprove: false })).toEqual({ review: [], approve: [] });
  });

  it('rejected, approved and retired rows are never bulk targets', () => {
    const s = pendingWorkflowSteps(rows, { canReview: true, canApprove: true });
    const ids = [...s.review, ...s.approve].map(x => x.id);
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('e');
    expect(ids).not.toContain('f');
  });
});
