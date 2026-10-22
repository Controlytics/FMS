/**
 * The approval fields a newly SUBMITTED PM visit carries — ONE rule for every
 * door a visit can be created through (D-OPS-10, 2026-10-22):
 *
 *   - the CSV/XLSX upload            (pm-import.ts)
 *   - "Add a visit"                  (pm-visits.ts, POST /visits)
 *   - create a schedule with entries (pm-schedule-crud.ts, POST /)
 *
 * Workflow ON: the visit lands in PENDING_REVIEW — review + approval required,
 * no bypass, not even for SUPER_ADMIN. Workflow OFF (legacy single step): a
 * SUPER_ADMIN's visit is approved directly; anyone else's waits in PENDING for
 * a PM_APPROVE holder.
 *
 * create() used to write its entries at the column default (PENDING, no
 * submitter) whatever the workflow said, so with the workflow ON they skipped
 * Review entirely. Copying this block per call site is how that happened; keep
 * it here.
 *
 * Pure on purpose: no database, no workflow read — callers pass the config they
 * already loaded.
 */
import type { RequestContext } from '../../types/context.js';
import type { PmWorkflowConfig } from './pm-workflow.js';

export function submissionApprovalFields(
  ctx: Pick<RequestContext, 'userSub' | 'userId' | 'userRole'>,
  wf: Pick<PmWorkflowConfig, 'workflowEnabled'>,
  now: Date = new Date(),
) {
  if (wf.workflowEnabled) {
    return {
      approvalStatus: 'PENDING_REVIEW' as const,
      submittedBy: ctx.userSub,
      submittedByName: ctx.userId,
    };
  }
  const isSuperAdmin = ctx.userRole === 'SUPER_ADMIN';
  return {
    approvalStatus: isSuperAdmin ? 'APPROVED' as const : 'PENDING' as const,
    submittedBy: ctx.userSub,
    submittedByName: ctx.userId,
    ...(isSuperAdmin ? { approvedBy: ctx.userSub, approvedByName: ctx.userId, approvedAt: now } : {}),
  };
}
