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

export function interlockBannerDetail(i: Pick<StageInterlockState, 'status' | 'approverRole'>): string {
  return i.status === 'REJECTED'
    ? 'Rejected — the filter has been sent back for re-cleaning.'
    : `${i.approverRole || 'An approver'} must verify and approve before this filter can continue.`;
}

/** One line for the batch failure list. */
export function interlockRefusalLine(filterName: string, i: Pick<StageInterlockState, 'stageKey' | 'status' | 'approverRole'>): string {
  const stage = prettyStage(i.stageKey ?? '');
  return i.status === 'REJECTED'
    ? `${filterName}: ${stage} was rejected — the filter has been sent back for re-cleaning.`
    : `${filterName}: ${stage} is awaiting approval from ${i.approverRole || 'an approver'} before this filter can continue.`;
}

/** Server refusal codes that mean "held by the stage interlock" (stage-interlock.ts). */
export const INTERLOCK_REFUSAL_CODES = new Set(['STAGE_APPROVAL_PENDING', 'STAGE_APPROVAL_REJECTED']);
