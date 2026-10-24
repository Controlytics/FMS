/**
 * Filter Operations — submitChecklist() implementation.
 *
 * Extracted from filter-operations.service.ts. The in-tx lock goes through the
 * shared `lockAndVerifyFilterState` helper — the same (state, cycle) recheck
 * advance/bypass/terminate use — AND keeps an ALREADY_SUBMITTED FilterEvent
 * guard on top (duplicate same-stage submission). The recheck was added
 * 2026-07-04: without it a concurrent terminate/bypass that changed
 * (state, cycle) between the pre-tx read and the lock would be clobbered by the
 * completion branch (flipping a just-TERMINATED cycle back to COMPLETED).
 *
 * 2026-07-16 — split into `prepareChecklist` (validate + read, NO writes) and
 * `executeChecklistTx` (all mutations, caller-supplied tx) so the atomic
 * advance+checklist op (`advance-with-checklist.ts`) can compose this with
 * `advance.ts` inside ONE transaction. `submitChecklistImpl` is unchanged
 * behaviour: prepare + own tx.
 *
 * `stateOverride` — the composed path prepares the checklist BEFORE the advance
 * has executed, so `loadLocalContext` still reports the PRE-advance stage. The
 * override names the stage the checklist actually belongs to (the advance's
 * targetState). Every read of the stage funnels through the single `stageKey`
 * binding below rather than re-reading `localCtx.filter.currentLifecycleState`
 * — there were 10 such reads, and missing any one of them (notably the in-tx
 * lock verify and the audit `afterValue`) silently records the wrong stage in
 * a hash-chained 21 CFR §11 row.
 */
import type { Prisma } from '@prisma/client';
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingByClientOpId, findExistingByClientOpIdInLatestCycle } from '../../../lib/idempotency.js';
import { lockAndVerifyFilterState } from './locking.js';
import { validateOfflinePerformedAt, assertOfflineReplayPayload, latestEventAt } from '../../../lib/offline-time-window.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import {
  computeChecksum,
  prettyStageLabel,
  collectChecklistsAfterStage,
  resolveChecklistQuestions,
} from '../helpers.js';
import { completeCycleTx } from './complete-cycle.js';
import type { FilterOperationsService } from '../filter-operations.service.js';
import { assertAhuInterlockSatisfied } from '../ahu-completion-gate.js';
import { isSuperAdminOwnWork, superAdminExemptionFields, type SuperAdminExemptGate } from '../../../lib/super-admin-own-work.js';
import { getInterlockConfig, isInterlockStage, assertStageApprovedToLeave } from '../stage-interlock.js';

type TxClient = Prisma.TransactionClient;

/** "after Wash In" / "before the first stage" (START, stageKey null). */
function positionLabel(stageKey: string | null): string {
  return stageKey ? `after ${prettyStageLabel(stageKey)}` : 'before the first stage';
}

/** Everything `executeChecklistTx` needs. Built by `prepareChecklist` with no writes. */
export interface ChecklistPlan {
  filterId: string;
  ctx: RequestContext;
  cycleId: string;
  sequenceNumber: number;
  /** The stage this checklist is recorded against (targetState in the composed path). */
  stageKey: string | null;
  eventData: Record<string, any>;
  checksum: string;
  offlineTime: Date | null;
  shouldComplete: boolean;
  clientOpId: string | null;
  answerCount: number;
  profileCount: number;
  /** Gates skipped because this write is an offline replay (2026-09-25). */
  replayExemptGates: string[];
  /** Gates a Super Admin's own online work skipped (2026-10-24, lib/super-admin-own-work.ts). */
  superAdminExemptGates: SuperAdminExemptGate[];
}

export type ChecklistPrep =
  | { kind: 'dedup' }
  | { kind: 'plan'; plan: ChecklistPlan };

export interface PrepareChecklistOpts {
  /**
   * Stage the checklist belongs to. Composed path passes the advance's
   * targetState (the filter has not moved yet at prepare time).
   */
  stateOverride?: string | null;
  /**
   * Composed path dedups once, on the advance half, using the shared clientOpId
   * — re-checking here would just re-find the same event.
   */
  skipDedup?: boolean;
  /**
   * The composed call carries the Dry In readings (dryerAction SUBMIT_READINGS,
   * 2026-10-22): a checklist that completes the cycle out of a final Dry In may
   * do so only with the readings in, recorded earlier or by this same call.
   */
  dryerReadingsInThisCall?: boolean;
}

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function prepareChecklist(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
  opts: PrepareChecklistOpts = {},
): Promise<ChecklistPrep> {
  const { answers } = data;
  const clientOpId: string | null = data.clientOpId ?? null;
  // Optional version pin from the offline cache — server compares to live profile
  // versions to detect schema drift between cache and current state.
  const expectedProfileVersions: Record<string, number> | null = data.expectedProfileVersions ?? null;

  // A request presenting the replay grant must look like a replay (2026-09-25).
  assertOfflineReplayPayload(ctx.isOfflineReplay === true, data);
  const replayExemptGates: string[] = [];
  // Gates a Super Admin's own online work skipped (2026-10-24) — recorded the same way.
  const superAdminExemptGates: SuperAdminExemptGate[] = [];
  if (ctx.isOfflineReplay) replayExemptGates.push('REAUTH');

  // Phase 8.5 Commit 3: drop pure guards through the shared executor.
  const { ctx: localCtx, cp, rawCycle: cycle, filterCurrentCycleId } = await loadLocalContext(filterId, ctx);

  // Cycle-scoped clientOpId dedup: a replay with the same opId for the same cycle
  // is a no-op success (returns current state); the same opId across different
  // cycles cannot collide. F15 (2026-09-25): runs BEFORE the no-cycle guard —
  // a retry of the checklist that COMPLETED the cycle has no current cycle any
  // more, and used to fall through to NO_CYCLE ("work no longer applies") when
  // it had in fact been recorded. With no current cycle the latest one is checked.
  if (!opts.skipDedup && clientOpId) {
    const seen = filterCurrentCycleId
      ? await findExistingByClientOpId(filterId, clientOpId, filterCurrentCycleId)
      : await findExistingByClientOpIdInLatestCycle(filterId, clientOpId);
    if (seen) return { kind: 'dedup' };
  }

  // Server-only: cycle exists guard (covers `NO_CYCLE`).
  throwIfFailed(executor.assertCycleActive(localCtx));

  // Server-only: cycle must be IN_PROGRESS (live state — separate from
  // `assertCycleActive`'s "filter has currentCycleId" check).
  if (!cycle || cycle.status !== 'IN_PROGRESS') {
    throw new AppError(400, 'NO_ACTIVE_CYCLE', 'No active cleaning cycle found');
  }

  // Honor offlinePerformedAt as the regulatory timestamp (operator's actual
  // answer time). Without this, every offline-replayed checklist records the
  // server-receive time, breaking 21 CFR Part 11 audit fidelity. Validation
  // (replay-only / future-skew / max-staleness / cycle-start floor) is in
  // apps/api/src/lib/offline-time-window.ts (audit 2026-05-04 fix C2).
  const offlineTime = validateOfflinePerformedAt(data.offlinePerformedAt, {
    isReplay: ctx.isOfflineReplay === true,
    cycleStartedAt: cycle.startedAt,
    // C-F10 (2026-09-25): not earlier than the cycle's latest recorded event.
    previousEventAt: latestEventAt(localCtx.events),
  });

  // Phase 8.3/8.5 staleness guard. In the composed path the advance half asserts
  // the same tapeVersion against the same pre-write tape — re-asserting here is
  // redundant but free, and keeps this prepare correct standalone.
  throwIfFailed(executor.assertTapeVersionFresh(localCtx, data.tapeVersion));

  // ── The ONE stage binding. Every downstream read uses this. ────────────────
  // Composed path: the advance has not executed yet, so localCtx still reports
  // the pre-advance stage — the override names the post-advance stage.
  const stageKey = opts.stateOverride !== undefined
    ? opts.stateOverride
    : localCtx.filter.currentLifecycleState;
  // The pipeline node the checklist follows: the stage, or START when no stage
  // has been entered yet (2026-10-22: the checklists between START and the first
  // stage are answered after start-cycle — they were never asked before).
  const positionNode = cp
    ? (stageKey
        ? cp.stages.find(s => s.stateKey === stageKey)
        : cp.stages.find(s => s.nodeType === 'START'))
    : undefined;

  // Resolve checklist nodes for the stage. Required for: validation,
  // schema-drift detection, and the per-profile snapshot we persist on the event.
  // Phase A.1: resolve through the cycle's pinned versions, so the questions
  // the operator answered against are byte-identical to the questions we
  // validate here, regardless of any admin edits during the cycle.
  const cyclePins = (cycle.checklistVersionPins ?? null) as Record<string, number> | null;
  let resolvedChecklists: any[] = [];
  let checklistNodeCount = 0;
  if (cp && positionNode) {
    const checklistNodes = collectChecklistsAfterStage(positionNode, cp.stages, cp.connections);
    checklistNodeCount = checklistNodes.length;
    // 2026-10-12: a DISABLED checklist is skipped — it is not asked, so it
    // cannot be answered online. On an offline replay the operator may have
    // answered it before it was switched off: that answer is a real record,
    // so it is kept (and the bypass is named in replayExemptGates).
    const disabled = new Set(localCtx.disabledChecklistProfileIds ?? []);
    const answeredIds = new Set(answers && typeof answers === 'object' ? Object.keys(answers) : []);
    const all = await resolveChecklistQuestions(checklistNodes, cyclePins);
    resolvedChecklists = all.filter((cl: any) => {
      if (!disabled.has(cl.checklistProfileId)) return true;
      return ctx.isOfflineReplay === true && cl.questions.some((q: any) => answeredIds.has(q.id));
    });
    if (resolvedChecklists.some((cl: any) => disabled.has(cl.checklistProfileId))) {
      replayExemptGates.push('CHECKLIST_DISABLED');
    }
    if (checklistNodeCount > 0 && all.length > 0 && resolvedChecklists.length === 0) {
      throw new AppError(
        400,
        'CHECKLIST_DISABLED',
        `The checklist ${positionLabel(stageKey)} is disabled, so it is skipped — there is nothing to submit.`,
      );
    }
  }

  // Audit 2026-09-24 (C-F3): nothing to attest → no CHECKLIST_COMPLETED event.
  // Writing one anyway fabricates a §11 record ("checklist completed after
  // WASH_IN") with an empty snapshot. THE rule for both the bare submit and the
  // composed advance-with-checklist (which prepares through here): no checklist
  // RESOLVED after this stage — whether no CHECKLIST node follows it, or every
  // node names a checklist that no longer exists. Until 2026-10-22 this only
  // refused `checklistNodeCount === 0`, so a dangling node let the bare submit
  // record checklists: [] while advance-with-checklist (its own copy of the
  // check) refused it. A node whose checklist is merely DISABLED was answered
  // above with CHECKLIST_DISABLED.
  if (resolvedChecklists.length === 0) {
    throw new AppError(
      400,
      'NO_CHECKLIST_AT_TARGET',
      checklistNodeCount === 0
        ? `There is no checklist to submit ${stageKey ? `at ${prettyStageLabel(stageKey)}` : 'before the first stage'}.`
        : `The checklist ${positionLabel(stageKey)} no longer exists, so there is nothing to submit. Ask an administrator to fix the cleaning profile.`,
    );
  }

  // Schema drift / required / extras — all pure, dropped through shared executor.
  throwIfFailed(
    executor.assertChecklistSchemaFresh(localCtx, expectedProfileVersions, resolvedChecklists),
  );
  throwIfFailed(
    executor.assertRequiredChecklistAnswered(localCtx, answers, resolvedChecklists),
  );
  throwIfFailed(
    executor.assertChecklistAnswerKeysValid(localCtx, answers, resolvedChecklists),
  );

  // Build per-profile snapshot so audit replay is deterministic without re-walking
  // the pipeline graph or hitting the (possibly-edited-since) ChecklistProfile rows.
  const checklistsSnapshot = resolvedChecklists.map((cl: any) => {
    const profileQuestionIds = new Set(cl.questions.map((q: any) => q.id));
    const perProfileAnswers: Record<string, any> = {};
    if (answers && typeof answers === 'object') {
      for (const [qId, val] of Object.entries(answers)) {
        if (profileQuestionIds.has(qId)) perProfileAnswers[qId] = val;
      }
    }
    return {
      pipelineNodeId: cl.pipelineNodeId,
      checklistProfileId: cl.checklistProfileId,
      checklistProfileName: cl.checklistProfileName,
      profileVersion: cl.profileVersion ?? 1,
      questionsSnapshot: cl.questions.map((q: any) => ({
        id: q.id,
        question: q.question,
        questionType: q.questionType,
        required: q.required,
        options: q.options,
      })),
      answers: perProfileAnswers,
    };
  });

  // The CHECKLIST_COMPLETED event + checksum are built AFTER the gates below
  // (2026-09-25): on a replay they contribute `replayExemptGates` to the
  // attributes, and the checksum must cover the attributes as written.

  // Auto-complete the cycle when this checklist is the last node before END.
  // advance() defers completion in that case (pipelines like
  // WASH_IN→CHECKLIST→END) so the operator can answer the post-stage
  // checklist; we complete the cycle here in the same transaction.
  let shouldComplete = false;
  if (positionNode) {
    // Cross-cutting cleanup: replaced inline recursive walker with the
    // canonical `executor.findReachable` (packages/shared/src/
    // pipeline-executor/transitions.ts:279). Same semantics — `leadsToEnd`
    // is `hasEndNext`; `!hasMoreStages` is `reachableStages.length === 0`.
    // Uses `localCtx.profile` (the projected shared-typed view) rather
    // than `cp.stages` (Prisma row shape) because the helper takes
    // TapeStage[]; `positionNode.id` is consistent between the two.
    const reach = executor.findReachable(positionNode.id, localCtx.profile.nodes, localCtx.profile.edges);
    shouldComplete = reach.hasEndNext && reach.reachableStages.length === 0;
  }

  // A checklist that completes the cycle out of a FINAL Dry In leaves Dry In, so
  // the Dry In leave rule applies (2026-10-22, the same guard advance() uses):
  // the readings must be in — recorded earlier, or carried by this composed call
  // (advance-with-checklist, dryerAction SUBMIT_READINGS). Before, entering a
  // final Dry In completed the cycle at dryer START and no reading was ever taken.
  //
  // Offline replay of a STANDALONE checklist that came before the readings: a
  // tablet built before 2026-10-22 asks the checklist the moment the dryer starts
  // and queues it ahead of the readings. Refusing it lost the answer (the sync
  // engine's retry then fails STALE_TAPE once the readings have landed). It is
  // recorded instead, WITHOUT completing the cycle — the stage's work is not done
  // — and the readings complete it (stage-entry.ts counts a checklist answered in
  // the current entry). The out-of-order answer is recorded on the event.
  if (shouldComplete && stageKey === 'DRY_IN') {
    const leave = executor.assertDryerReadingsSubmittedBeforeLeavingDryIn(
      { ...localCtx.cycle, dryerReadingsSubmitted: localCtx.cycle.dryerReadingsSubmitted || opts.dryerReadingsInThisCall === true },
      'DRY_IN',
      'END',
    );
    if (!leave.ok && ctx.isOfflineReplay && opts.stateOverride === undefined) {
      shouldComplete = false;
      replayExemptGates.push('CHECKLIST_BEFORE_READINGS');
    } else {
      throwIfFailed(leave);
    }
  }

  // Audit 2026-09-24 (F12): a checklist that COMPLETES the cycle is a leave of
  // the current stage. When that stage is a QA interlock point (WASH_OUT /
  // DRY_OUT → CHECKLIST → END), the bare two-request path used to finish the
  // cycle with the approval still PENDING (later closed SUPERSEDED). Same rule
  // as advance(): online only — offline work is never gated.
  if (shouldComplete && stageKey) {
    const interlockConfig = await getInterlockConfig();
    if (interlockConfig.enabled && isInterlockStage(stageKey)) {
      if (!ctx.isOfflineReplay) {
        await assertStageApprovedToLeave({ cycleId: cycle.id, fromState: stageKey, targetState: 'END', config: interlockConfig });
      } else {
        replayExemptGates.push('INTERLOCK_LEAVE');
      }
    }
  }

  // AHU interlock gate: block final-stage completion when sibling filters are
  // still mid-cleaning.  Short-circuits on offline replay, mode ≠ INTERLOCK,
  // or no AHU parent — cost-free for all non-interlock installations.
  // Placed BEFORE the transaction so a thrown 422 aborts with no partial write.
  if (shouldComplete) {
    // Operator's runtime filter-set choice (SET_A / SET_B / ALL) rides in the
    // submit body so the server gate scopes to the SAME roster the operator saw
    // in the pre-popup chooser — no UI-says-green / server-422 mismatch.
    const set: 'ALL' | 'SET_A' | 'SET_B' | undefined =
      data.filterSet === 'SET_A' || data.filterSet === 'SET_B' || data.filterSet === 'ALL'
        ? data.filterSet
        : undefined;
    const saOwnWork = isSuperAdminOwnWork(ctx);
    const ahuGate = await assertAhuInterlockSatisfied({ filterId, isOfflineReplay: ctx.isOfflineReplay === true, superAdminOwnWork: saOwnWork, set });
    if (ahuGate?.exempt) (saOwnWork ? superAdminExemptGates : replayExemptGates).push('AHU_COMPLETION');
  }

  // Record CHECKLIST_COMPLETED event. Attributes shape:
  //   { afterStage, answers (flat merged — backward compat for cycle-history reader),
  //     checklists[] (per-profile snapshot — A6), clientOpId (A2), offlinePerformedAt (A1),
  //     replayExemptGates (2026-09-25, replay only) }
  const eventData = {
    filterId,
    cycleId: cycle.id,
    eventType: 'CHECKLIST_COMPLETED' as const,
    performedBy: ctx.userSub,
    attributes: {
      afterStage: stageKey,
      answers,
      checklists: checklistsSnapshot,
      ...(clientOpId ? { clientOpId } : {}),
      ...(offlineTime ? { offlinePerformedAt: offlineTime.toISOString() } : {}),
      ...(replayExemptGates.length ? { replayExemptGates } : {}),
      ...superAdminExemptionFields(superAdminExemptGates),
    },
    remarks: stageKey ? `Checklist completed after ${stageKey}` : 'Checklist completed before the first stage',
  };
  const checksum = computeChecksum(eventData);

  return {
    kind: 'plan',
    plan: {
      filterId,
      ctx,
      cycleId: cycle.id,
      sequenceNumber: cycle.sequenceNumber,
      stageKey,
      eventData,
      checksum,
      offlineTime: offlineTime ?? null,
      shouldComplete,
      clientOpId,
      answerCount: Object.keys(answers ?? {}).length,
      profileCount: checklistsSnapshot.length,
      replayExemptGates,
      superAdminExemptGates,
    },
  };
}

/**
 * Apply a prepared checklist inside the caller's transaction.
 *
 * Composed path: `advance`'s `executeAdvanceTx` has already moved
 * `filter_details.current_lifecycle_state` to `plan.stageKey` within this same
 * tx, so the lock verify below re-reads the advanced state and matches — it
 * doubles as an assertion that the advance half did what it claimed.
 */
export async function executeChecklistTx(tx: TxClient, plan: ChecklistPlan): Promise<void> {
  const { filterId, ctx, cycleId, stageKey, eventData, checksum, offlineTime, clientOpId } = plan;

  // Phase 5b.4 + 2026-07-04 race fix: lock filter_details AND re-verify the
  // (state, cycle) tuple still matches the snapshot we validated against —
  // the same recheck advance/bypass/terminate use. Without it, a concurrent
  // terminate/bypass that changed (state, cycle) between our pre-tx read and
  // this lock would be clobbered: the completion branch below would flip a
  // just-TERMINATED cycle back to COMPLETED, writing contradictory 21 CFR
  // events (CYCLE_TERMINATED + CYCLE_COMPLETED). Throws 409 STATE_CHANGED /
  // CYCLE_CHANGED on mismatch. The ALREADY_SUBMITTED guard below still runs
  // on top (it catches a duplicate same-stage submission, a different case).
  await lockAndVerifyFilterState(tx, filterId, stageKey, cycleId);

  // Check for duplicate submission (same stage, same cycle).
  //
  // Audit 2026-05-04 fix (api-core review C3): the previous query used
  //   { path: ['afterStage'], equals: currentState ?? undefined }
  // which collapses to `equals: undefined` when the stage is null
  // (the case for the very first checklist before any STAGE has run).
  // Prisma treats `equals: undefined` as "no JSON filter at all" — the
  // query then matches every CHECKLIST_COMPLETED event for the cycle,
  // including ones for other stages, producing a false-positive 409
  // ALREADY_SUBMITTED that locks the operator out of the cycle.
  // Use `equals: null` (Prisma's explicit JSON-null match) instead, so
  // a stage-null event row is matched correctly and stage-other rows
  // are not.
  // Audit 2026-09-24 (F4): "already submitted" is per ATTEMPT at the stage.
  // After a QA rejection rolled the filter back and the stage was re-done,
  // the attempt-1 row must not block the fresh attestation — mirror the
  // shared gate (latestEntryIntoStage): only rows at/after the latest event
  // that moved the filter INTO this stage count.
  // 2026-10-22: "entry" is the shared isEntryIntoStage — an in-place dryer step
  // (readings, in-place SET_DURATION) is not an entry, so it does not open a
  // fresh attempt in which the same checklist could be recorded twice. START
  // (stageKey null) has no entry: one answer per cycle.
  const stageRows = stageKey
    ? await tx.filterEvent.findMany({
        where: { filterId, cycleId, toState: stageKey },
        select: { eventType: true, toState: true, performedAt: true, attributes: true },
      })
    : [];
  const latestEntryMs = stageKey ? executor.latestEntryIntoStage(stageRows, stageKey) : null;
  const existing = await tx.filterEvent.findFirst({
    where: {
      filterId,
      cycleId,
      eventType: 'CHECKLIST_COMPLETED',
      attributes: { path: ['afterStage'], equals: stageKey ?? (null as any) },
      ...(latestEntryMs !== null ? { performedAt: { gte: new Date(latestEntryMs) } } : {}),
    },
  });
  if (existing) throw new AppError(409, 'ALREADY_SUBMITTED', `Checklist already submitted ${positionLabel(stageKey)}`);

  await tx.filterEvent.create({
    data: {
      ...(eventData as any),
      checksum,
      ipAddress: ctx.ipAddress,
      telemetrySnapshot: {},
      // Operator's true answer time when offline; otherwise default(now()).
      ...(offlineTime ? { performedAt: offlineTime } : {}),
    },
  });

  if (plan.shouldComplete) {
    // The one completion write set (complete-cycle.ts), shared with advance()
    // and the QA approval of a final gated stage.
    await completeCycleTx(tx, {
      filterId, cycleId, sequenceNumber: plan.sequenceNumber, ctx,
      finalStage: stageKey, offlineTime, clientOpId,
    });
  }

  // Audit §1.1 (2026-05-16): audit-write inside business tx.
  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'CHECKLIST_COMPLETED',
    targetType: 'filter', targetId: filterId,
    afterValue: {
      stage: stageKey, answerCount: plan.answerCount, profileCount: plan.profileCount,
      ...(plan.replayExemptGates?.length ? { offlineReplay: true, replayExemptGates: plan.replayExemptGates } : {}),
      ...superAdminExemptionFields(plan.superAdminExemptGates ?? []),
    },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  }, tx);
}

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function submitChecklistImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const prep = await prepareChecklist(service, ctx, filterId, data);
  if (prep.kind === 'dedup') return service.getCurrentState(ctx, filterId);

  await prisma.$transaction(async (tx) => {
    await executeChecklistTx(tx, prep.plan);
  });

  return service.getCurrentState(ctx, filterId);
}
