/**
 * Stage-interlock wording for the tablet (OQ-02, 2026-10-19).
 *
 * The interlock banner on the tablet was wired only into the single-scan
 * `handleSubmit`, which nothing calls any more — the live path is the queue
 * submit (`handleSubmitQueue`). An operator whose filter waited for an
 * approval therefore saw a generic "cannot advance" line and no banner.
 *
 * Wording comes from the server's `interlock.approverRole` (the role the
 * Stage Interlock config names for that stage), never a hard-coded "QA".
 * The role is shown by its display name from the roles table (`roleLabels`,
 * useRoleColors) — "Shift Officer", not the code `SHIFTOFFICER` (2026-10-24).
 * Without the table (offline, roles not loaded yet) the code is the fallback.
 */
import { prettyStage } from '@/lib/stage-approval';

export interface StageInterlockState {
  gatedStage: boolean;
  stageKey: string | null;
  status: string | null;
  approvalId: string | null;
  approverRole: string | null;
  blocksLeaving: boolean;
}

/** The `interlock` object of a /current-state response, if it blocks leaving the stage. */
export function blockingInterlock(state: any): StageInterlockState | null {
  const i = state?.interlock;
  return i && i.blocksLeaving ? (i as StageInterlockState) : null;
}

export function interlockBannerTitle(i: Pick<StageInterlockState, 'stageKey' | 'status'>): string {
  const stage = prettyStage(i.stageKey ?? '');
  return i.status === 'REJECTED' ? `${stage} approval rejected` : `${stage} awaiting approval`;
}

/** Role code → display name; the code itself when the roles table does not name it. */
export function approverRoleLabel(role: string | null | undefined, roleLabels?: Record<string, string>): string | null {
  if (!role) return null;
  return roleLabels?.[role] || role;
}

export function interlockBannerDetail(i: Pick<StageInterlockState, 'status' | 'approverRole'>, roleLabels?: Record<string, string>): string {
  return i.status === 'REJECTED'
    ? 'Rejected — the filter has been sent back for re-cleaning.'
    : `${approverRoleLabel(i.approverRole, roleLabels) || 'An approver'} must verify and approve before this filter can continue.`;
}

/** One line for the batch failure list. */
export function interlockRefusalLine(filterName: string, i: Pick<StageInterlockState, 'stageKey' | 'status' | 'approverRole'>, roleLabels?: Record<string, string>): string {
  const stage = prettyStage(i.stageKey ?? '');
  return i.status === 'REJECTED'
    ? `${filterName}: ${stage} was rejected — the filter has been sent back for re-cleaning.`
    : `${filterName}: ${stage} is awaiting approval from ${approverRoleLabel(i.approverRole, roleLabels) || 'an approver'} before this filter can continue.`;
}

/** Server refusal codes that mean "held by the stage interlock" (stage-interlock.ts). */
export const INTERLOCK_REFUSAL_CODES = new Set(['STAGE_APPROVAL_PENDING', 'STAGE_APPROVAL_REJECTED']);
