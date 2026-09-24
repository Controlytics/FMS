// Filter creation workflow — the block-level bulk step (2026-09-24).
//
// A bulk upload creates up to 200 filters at once; reviewing them one popup at
// a time is not usable. This decides which filters of the CURRENT block the
// viewer can act on in one go, per step, mirroring workflowRowActions for a
// single row: Review over PENDING_REVIEW for the reviewer, Approve over
// PENDING_APPROVAL for the approver. Sequence is kept — an approver's bulk
// list never contains a filter that has not been reviewed yet.

export type PendingSteps<T> = { review: T[]; approve: T[] };

export function pendingWorkflowSteps<T extends { approvalStatus?: string | null; currentState?: string | null }>(
  filters: T[],
  perms: { canReview: boolean; canApprove: boolean },
): PendingSteps<T> {
  const live = filters.filter(f => f.currentState !== 'RETIRED');
  return {
    review: perms.canReview ? live.filter(f => f.approvalStatus === 'PENDING_REVIEW') : [],
    approve: perms.canApprove ? live.filter(f => f.approvalStatus === 'PENDING_APPROVAL') : [],
  };
}
