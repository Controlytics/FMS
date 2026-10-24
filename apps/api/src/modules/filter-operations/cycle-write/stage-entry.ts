/**
 * What ENTERING a stage means for the cycle — the one decision shared by
 * advance() and bypass() (2026-10-22: "a bypass into a final stage completes
 * under the SAME rules as an advance into it"). Before this the rules lived
 * inline in advance.ts, and bypass.ts had none: a bypass into the last stage
 * never completed the cycle and left it stranded there (the tape offered
 * nothing that finished it; an advance answered CYCLE_COMPLETE).
 *
 * Reads and gates only — no writes. Decides, for the target stage:
 *  - whether the call must carry the checklist that follows a FINAL stage (A-01;
 *    shared advanceMustCarryChecklist) — refused online, recorded on replay;
 *  - whether THIS call completes the cycle: a final stage with nothing enabled
 *    after it, whose work this call finishes (shared callCompletesStageWork — a
 *    final Dry In finishes on its readings), and which is not waiting for QA;
 *  - the QA stage interlock: a final gated stage is completed by its approval
 *    (stage-approvals approve()), so the bare entry raises PENDING; a composed
 *    entry that would complete out of a gated stage is refused 422; offline work
 *    is never gated (recorded);
 *  - the AHU-completion gate, when this call completes the cycle;
 *  - the PENDING approval to raise on entry, with the AHU-completion filter set
 *    the operator chose (`completionFilterSet`), which the approval honours.
 *
 * Every replay exemption is pushed onto the caller's `replayExemptGates`, which
 * the caller writes onto the event and audit row. A Super Admin's own online
 * entry (2026-10-24, lib/super-admin-own-work.ts) skips the QA interlock and the
 * AHU gate the same way, recorded on `superAdminExemptGates`. The call SHAPE is
 * unchanged (a final gated stage is still entered bare, its checklist after), so
 * no client has to know who is signed in.
 */
import type { LocalContext } from '@digilog/shared';
import * as executor from '@digilog/shared';
import type { RequestContext } from '../../../types/context.js';
import { AppError } from '../../../lib/errors.js';
import { activeChecklistIdsAfterStage, prettyStageLabel } from '../helpers.js';
import {
  isInterlockStage,
  getApproverRoleForStage,
  collectFilterApprovalDetails,
  type FilterApprovalDetails,
  type StageInterlockConfig,
} from '../stage-interlock.js';
import { assertAhuInterlockSatisfied, type FilterSetChoice } from '../ahu-completion-gate.js';
import { isSuperAdminOwnWork, type SuperAdminExemptGate } from '../../../lib/super-admin-own-work.js';

export interface StageEntryDecision {
  leadsToEnd: boolean;
  hasMoreStages: boolean;
  /** This call finishes the target stage's work (callCompletesStageWork). */
  workDoneByThisCall: boolean;
  /** This call's own write completes the cycle (the checklist half does when one follows). */
  completesCycle: boolean;
  /** Raise a PENDING approval with the entry (online, gated stage, cycle not completing). */
  enteringInterlock: boolean;
  interlockSnapshot: FilterApprovalDetails | null;
  interlockApproverRole: string | null;
}

/** The operator's AHU-completion filter-set choice from the request body, when valid. */
export function readFilterSetChoice(value: unknown): FilterSetChoice | undefined {
  return value === 'SET_A' || value === 'SET_B' || value === 'ALL' ? value : undefined;
}

export async function decideStageEntry(p: {
  ctx: RequestContext;
  filterId: string;
  localCtx: LocalContext;
  cp: { stages: any[]; connections: any[] };
  targetState: string;
  targetStage: any;
  dryerAction: string | null | undefined;
  interlockConfig: StageInterlockConfig;
  /** The call carries the target's checklist answers (advance-with-checklist, bypass with answers). */
  composedWithChecklist: boolean;
  /** The request body's filterSet — the operator's AHU-completion scope. */
  filterSet: unknown;
  replayExemptGates: string[];
  /** Gates a Super Admin's own online work skipped (lib/super-admin-own-work.ts); the caller writes it on the event + audit row. */
  superAdminExemptGates: SuperAdminExemptGate[];
}): Promise<StageEntryDecision> {
  const { ctx, filterId, localCtx, cp, targetState, targetStage, dryerAction, interlockConfig, replayExemptGates, superAdminExemptGates } = p;
  const composed = p.composedWithChecklist === true;
  const saOwnWork = isSuperAdminOwnWork(ctx);
  const set = readFilterSetChoice(p.filterSet);

  // Does the target stage lead to END (walking through CHECKLIST nodes)?
  const reachFromTarget = executor.findReachable(targetStage.id, localCtx.profile.nodes, localCtx.profile.edges);
  const leadsToEnd = reachFromTarget.hasEndNext;
  const hasMoreStages = reachFromTarget.reachableStages.length > 0;

  // Defer completion when an ACTIVE checklist sits between the final stage and
  // END: the checklist half completes the cycle (submit-checklist) — unless it
  // was already answered in the CURRENT entry. That happens only at a final Dry
  // In, in place: an older tablet's offline queue answers the checklist before
  // the readings (submit-checklist records it without completing), so the
  // readings are what finish the stage and the cycle. The same "answered" rule
  // as the gate and the tape (shared checklistAnsweredInCurrentEntry).
  const inPlace = !!dryerAction && localCtx.filter.currentLifecycleState === targetState;
  const answeredInThisEntry = inPlace && executor.checklistAnsweredInCurrentEntry(localCtx.events, targetState);
  let activePostChecklistIds: string[] = [];
  if (leadsToEnd && !hasMoreStages && !answeredInThisEntry) {
    activePostChecklistIds = await activeChecklistIdsAfterStage(targetStage, cp.stages, cp.connections);
  }
  const hasPendingChecklistAfterTarget = activePostChecklistIds.length > 0;

  // A-01 (operator decision 2026-10-21): a BARE entry into the final stage whose
  // mandatory checklist follows it used to commit the checksummed event + audit
  // row before the checklist was answered — a §11 record of an attestation that
  // may never come. Refused online; an offline replay is let through so an older
  // client's queue is not lost, and the skip is RECORDED.
  //
  // NOT for a QA-interlock final stage: the entry raises the approval, the
  // checklist is refused until QA approves, and the approved checklist completes
  // the cycle (two-step design, session 2026-10-08). Nor for the entry into a
  // final Dry In: its checklist rides on the readings (callCompletesStageWork).
  const finalStageAwaitsQa = interlockConfig.enabled && isInterlockStage(targetState);
  const mustCarryChecklist = executor.advanceMustCarryChecklist({
    leadsToEnd,
    nextStages: reachFromTarget.reachableStages,
    pendingChecklistProfileIds: activePostChecklistIds,
    interlockGated: finalStageAwaitsQa,
  }, undefined, { targetState, dryerAction });
  if (mustCarryChecklist && !composed) {
    if (!ctx.isOfflineReplay) {
      throw new AppError(
        409,
        'CHECKLIST_REQUIRED',
        `${prettyStageLabel(targetState)} is the last stage and its checklist must be answered in the same step. Open the checklist and submit it to complete this stage.`,
      );
    }
    replayExemptGates.push('TERMINAL_CHECKLIST');
  }

  // What finishes a FINAL stage's work (2026-10-22, every pipeline shape must
  // complete):
  //  - Dry In: the readings at half time, not the entry — entering a final Dry
  //    In used to complete the cycle the moment the dryer STARTED;
  //  - a QA-gated stage (online, bare entry): its approval, when no enabled
  //    checklist follows (approve()); with one, the checklist after approval.
  //    The bare entry used to answer 422 INTERLOCK_TERMINAL_STAGE, so a pipeline
  //    ending at a gated stage could never complete. A composed entry keeps the
  //    422 below; an offline replay is never gated (completes, recorded).
  const workDoneByThisCall = executor.callCompletesStageWork(targetState, dryerAction);
  // A Super Admin's own entry raises no approval, so nothing but the entry (or the
  // checklist after it) can finish the stage.
  const approvalCompletesStage = finalStageAwaitsQa && !ctx.isOfflineReplay && !composed && !saOwnWork;

  const completesCycle = leadsToEnd && !hasMoreStages && !hasPendingChecklistAfterTarget
    && workDoneByThisCall && !approvalCompletesStage;
  // Whether the CYCLE completes in this call — in the composed path that includes
  // the checklist landing in the same transaction.
  const cycleWillComplete = leadsToEnd && !hasMoreStages && workDoneByThisCall && !approvalCompletesStage
    && (!hasPendingChecklistAfterTarget || composed);

  // #5 fix (audit 2026-07-04): a cycle must not complete out of a gated stage
  // without its QA approval. Only a composed entry reaches this since
  // 2026-10-22 (the bare entry raises the approval, which completes the cycle).
  // Offline replay is exempt (offline work is never gated), and recorded.
  if (finalStageAwaitsQa && cycleWillComplete) {
    if (saOwnWork) {
      superAdminExemptGates.push('INTERLOCK_TERMINAL');
    } else if (!ctx.isOfflineReplay) {
      throw new AppError(
        422,
        'INTERLOCK_TERMINAL_STAGE',
        `This cleaning cycle would complete directly out of ${prettyStageLabel(targetState)}, but the QA stage interlock is enabled for that stage — a filter cannot complete a cycle without the required QA approval. An administrator must add a stage after ${prettyStageLabel(targetState)} or disable the stage interlock.`,
      );
    } else {
      replayExemptGates.push('INTERLOCK_TERMINAL');
    }
  }

  // AHU completion interlock (2026-08-10): when THIS call completes the cycle.
  // (When a checklist follows, submit-checklist runs the same gate.) Before any
  // write, so a 422 aborts cleanly; offline replay is exempt inside the assert.
  // The operator's runtime filter-set choice scopes the roster.
  if (completesCycle) {
    const ahuGate = await assertAhuInterlockSatisfied({ filterId, isOfflineReplay: ctx.isOfflineReplay === true, superAdminOwnWork: saOwnWork, set });
    if (ahuGate?.exempt) (saOwnWork ? superAdminExemptGates : replayExemptGates).push('AHU_COMPLETION');
  }

  // Raise the gate on entry (atomic with the state change, in the caller's tx).
  // Offline: never — a PENDING approval for offline work would be a stuck
  // request no operator can clear; recorded instead.
  // A Super Admin's own entry: never either (2026-10-24) — recorded, and the leave
  // gate reads that record on this entry (entryExemptedBySuperAdmin).
  const enteringInterlock = finalStageAwaitsQa && !cycleWillComplete && !ctx.isOfflineReplay && !saOwnWork;
  if (ctx.isOfflineReplay && finalStageAwaitsQa && !cycleWillComplete) {
    replayExemptGates.push('INTERLOCK_ENTRY');
  }
  if (saOwnWork && finalStageAwaitsQa && !cycleWillComplete) {
    superAdminExemptGates.push('INTERLOCK_ENTRY');
  }
  let interlockSnapshot: FilterApprovalDetails | null = null;
  const interlockApproverRole = enteringInterlock ? getApproverRoleForStage(targetState, interlockConfig) : null;
  if (enteringInterlock) {
    // The filter's identity, plus the AHU-completion scope the operator chose on
    // this entry: when the approval completes the cycle (a final gated stage),
    // its AHU gate honours the operator's choice, not the filter's own set.
    interlockSnapshot = {
      ...(await collectFilterApprovalDetails(filterId)),
      ...(set ? { completionFilterSet: set } : {}),
    };
  }

  return {
    leadsToEnd,
    hasMoreStages,
    workDoneByThisCall,
    completesCycle,
    enteringInterlock,
    interlockSnapshot,
    interlockApproverRole,
  };
}
