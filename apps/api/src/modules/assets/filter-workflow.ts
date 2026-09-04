/**
 * Filter create/upload → review → approve workflow (2026-09-04).
 *
 * Config lives in system_config['filter-approval'] (Config → Role Assignments →
 * "Filter Creation Workflow"):
 *   { workflowEnabled, uploadRole, reviewRole, approvalRole }
 *
 * When `workflowEnabled`, a newly created or bulk-uploaded FILTER lands in
 * PENDING_REVIEW and must pass review (→ PENDING_APPROVAL) then approval (→
 * APPROVED) before it can be OPERATED. It is visible and readable throughout.
 *
 * Deliberately does NOT inherit from the PM config the way
 * `getReplacementWorkflowConfig` does — see filter-approval.def.ts for why.
 *
 * The role gate itself is `assertPmRole` from the PM module: one implementation
 * of "SUPER_ADMIN always passes; a blank configured role means anyone with the
 * route permission; otherwise the role must match exactly". Duplicating it here
 * would be a second place for that rule to drift.
 */
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { assertPmRole, normalizeRoles, type PmWorkflowConfig } from '../pm-schedules/pm-workflow.js';

export { assertPmRole };

/** Statuses a filter can hold. Reuses PmEntryApprovalStatus — see schema.prisma. */
export type FilterApprovalStatus = 'PENDING_REVIEW' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PENDING';

export async function getFilterWorkflowConfig(): Promise<PmWorkflowConfig> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-approval' } });
  const v = (cfg?.configValue as any) ?? {};
  return {
    workflowEnabled: v.workflowEnabled === true, // default OFF: absent row = today's behaviour
    uploadRole: normalizeRoles(v.uploadRole),
    reviewRole: (v.reviewRole ?? '').toString().trim(),
    approvalRole: (v.approvalRole ?? '').toString().trim(),
  };
}

/**
 * The status a newly created filter should carry.
 *
 * APPROVED when the workflow is off, so creation behaves exactly as it did
 * before this feature existed. Non-filter assets (Block / Area / AHU) never
 * call this — they keep the column's APPROVED default.
 */
export function initialApprovalStatus(cfg: PmWorkflowConfig): FilterApprovalStatus {
  return cfg.workflowEnabled ? 'PENDING_REVIEW' : 'APPROVED';
}

/**
 * 🔴 The operability gate. A filter that has not been APPROVED cannot be
 * operated — no cycle start, advance, bypass or checklist submit.
 *
 * Called from `loadLocalContext()` (which every cycle-write path goes through)
 * and from `start-cycle.ts` (which loads via getFilter instead). It is
 * deliberately NOT in `getFilter()`: 6 of that function's 9 callers are reads
 * that must keep working, including reading a pending filter's own record.
 *
 * `status` is typed loosely because callers select it straight off Prisma rows.
 */
export function assertFilterOperable(status: string | null | undefined, filterName?: string | null): void {
  // An absent value means a row selected without the column, not an unapproved
  // filter — never block on a query's own omission.
  if (status == null || status === 'APPROVED') return;
  const label = filterName ? `Filter "${filterName}"` : 'This filter';
  const why = status === 'REJECTED'
    ? 'was rejected and must be corrected and re-submitted'
    : 'is still awaiting review/approval';
  throw new AppError(
    409,
    'FILTER_NOT_APPROVED',
    `${label} ${why}, so it cannot be operated yet.`,
    { approvalStatus: status },
  );
}

/** Prisma `where` fragment for lists that must show only operable filters. */
export const OPERABLE_FILTER_WHERE = { approvalStatus: 'APPROVED' as const };
