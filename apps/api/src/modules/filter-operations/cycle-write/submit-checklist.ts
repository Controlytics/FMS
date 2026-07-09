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
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingByClientOpId, withClientOpId } from '../../../lib/idempotency.js';
import { lockAndVerifyFilterState } from './locking.js';
import { validateOfflinePerformedAt } from '../../../lib/offline-time-window.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import {
  computeChecksum,
  prettyStageLabel,
  collectChecklistsAfterStage,
  resolveChecklistQuestions,
  toLocalDateString,
} from '../helpers.js';
import type { FilterOperationsService } from '../filter-operations.service.js';
import { assertAhuInterlockSatisfied } from '../ahu-completion-gate.js';

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function submitChecklistImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const { answers } = data;
  const clientOpId: string | null = data.clientOpId ?? null;
  // Optional version pin from the offline cache — server compares to live profile
  // versions to detect schema drift between cache and current state.
  const expectedProfileVersions: Record<string, number> | null = data.expectedProfileVersions ?? null;

  // Phase 8.5 Commit 3: drop pure guards through the shared executor.
  const { ctx: localCtx, cp, rawCycle: cycle, filterCurrentCycleId } = await loadLocalContext(filterId, ctx);

  // Server-only: cycle exists guard (covers `NO_CYCLE`).
  throwIfFailed(executor.assertCycleActive(localCtx));

  // Cycle-scoped clientOpId dedup: a replay with the same opId for the same cycle
  // is a no-op success (returns current state); the same opId across different
  // cycles cannot collide. Run AFTER the no-cycle guard so we throw NO_CYCLE
  // rather than trying to dedup against a missing cycle.
  if (clientOpId && filterCurrentCycleId && await findExistingByClientOpId(filterId, clientOpId, filterCurrentCycleId)) {
    return service.getCurrentState(ctx, filterId);
  }

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
  });

  // Phase 8.3/8.5 staleness guard.
  throwIfFailed(executor.assertTapeVersionFresh(localCtx, data.tapeVersion));

  // Resolve checklist nodes for the current stage. Required for: validation,
  // schema-drift detection, and the per-profile snapshot we persist on the event.
  // Phase A.1: resolve through the cycle's pinned versions, so the questions
  // the operator answered against are byte-identical to the questions we
  // validate here, regardless of any admin edits during the cycle.
  const cyclePins = (cycle.checklistVersionPins ?? null) as Record<string, number> | null;
  let resolvedChecklists: any[] = [];
  if (cp && localCtx.filter.currentLifecycleState) {
    const currentStage = cp.stages.find(s => s.stateKey === localCtx.filter.currentLifecycleState);
    if (currentStage) {
      const checklistNodes = collectChecklistsAfterStage(currentStage, cp.stages, cp.connections);
      resolvedChecklists = await resolveChecklistQuestions(checklistNodes, cyclePins);
    }
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

  // Build set of valid question ids for the per-profile snapshot below.
  const validQuestionIds = new Set<string>();
  for (const cl of resolvedChecklists) {
    for (const q of cl.questions) {
      validQuestionIds.add(q.id);
    }
  }

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

  const currentState = localCtx.filter.currentLifecycleState;

  // Record CHECKLIST_COMPLETED event. Attributes shape:
  //   { afterStage, answers (flat merged — backward compat for cycle-history reader),
  //     checklists[] (per-profile snapshot — A6), clientOpId (A2), offlinePerformedAt (A1) }
  const eventData = {
    filterId,
    cycleId: cycle.id,
    eventType: 'CHECKLIST_COMPLETED' as const,
    performedBy: ctx.userSub,
    attributes: {
      afterStage: currentState,
      answers,
      checklists: checklistsSnapshot,
      ...(clientOpId ? { clientOpId } : {}),
      ...(offlineTime ? { offlinePerformedAt: offlineTime.toISOString() } : {}),
    },
    remarks: `Checklist completed after ${currentState}`,
  };
  const checksum = computeChecksum(eventData);

  // Auto-complete the cycle when this checklist is the last node before END.
  // advance() defers completion in that case (pipelines like
  // WASH_IN→CHECKLIST→END) so the operator can answer the post-stage
  // checklist; we complete the cycle here in the same transaction.
  let shouldComplete = false;
  if (cp && currentState) {
    const currentStage = cp.stages.find(s => s.stateKey === currentState);
    if (currentStage) {
      // Cross-cutting cleanup: replaced inline recursive walker with the
      // canonical `executor.findReachable` (packages/shared/src/
      // pipeline-executor/transitions.ts:279). Same semantics — `leadsToEnd`
      // is `hasEndNext`; `!hasMoreStages` is `reachableStages.length === 0`.
      // Uses `localCtx.profile` (the projected shared-typed view) rather
      // than `cp.stages` (Prisma row shape) because the helper takes
      // TapeStage[]; `currentStage.id` is consistent between the two.
      const reach = executor.findReachable(currentStage.id, localCtx.profile.nodes, localCtx.profile.edges);
      shouldComplete = reach.hasEndNext && reach.reachableStages.length === 0;
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
    await assertAhuInterlockSatisfied({ filterId, isOfflineReplay: ctx.isOfflineReplay === true, set });
  }

  await prisma.$transaction(async (tx) => {
    // Phase 5b.4 + 2026-07-04 race fix: lock filter_details AND re-verify the
    // (state, cycle) tuple still matches the snapshot we validated against —
    // the same recheck advance/bypass/terminate use. Without it, a concurrent
    // terminate/bypass that changed (state, cycle) between our pre-tx read and
    // this lock would be clobbered: the completion branch below would flip a
    // just-TERMINATED cycle back to COMPLETED, writing contradictory 21 CFR
    // events (CYCLE_TERMINATED + CYCLE_COMPLETED). Throws 409 STATE_CHANGED /
    // CYCLE_CHANGED on mismatch. The ALREADY_SUBMITTED guard below still runs
    // on top (it catches a duplicate same-stage submission, a different case).
    await lockAndVerifyFilterState(tx, filterId, currentState, cycle.id);

    // Check for duplicate submission (same stage, same cycle).
    //
    // Audit 2026-05-04 fix (api-core review C3): the previous query used
    //   { path: ['afterStage'], equals: currentState ?? undefined }
    // which collapses to `equals: undefined` when currentState is null
    // (the case for the very first checklist before any STAGE has run).
    // Prisma treats `equals: undefined` as "no JSON filter at all" — the
    // query then matches every CHECKLIST_COMPLETED event for the cycle,
    // including ones for other stages, producing a false-positive 409
    // ALREADY_SUBMITTED that locks the operator out of the cycle.
    // Use `equals: null` (Prisma's explicit JSON-null match) instead, so
    // a stage-null event row is matched correctly and stage-other rows
    // are not.
    const existing = await tx.filterEvent.findFirst({
      where: {
        filterId,
        cycleId: cycle.id,
        eventType: 'CHECKLIST_COMPLETED',
        attributes: { path: ['afterStage'], equals: currentState ?? (null as any) },
      },
    });
    if (existing) throw new AppError(409, 'ALREADY_SUBMITTED', `Checklist already submitted for ${prettyStageLabel(currentState)}`);

    await tx.filterEvent.create({
      data: {
        ...eventData,
        checksum,
        ipAddress: ctx.ipAddress,
        telemetrySnapshot: {},
        // Operator's true answer time when offline; otherwise default(now()).
        ...(offlineTime ? { performedAt: offlineTime } : {}),
      },
    });

    if (shouldComplete) {
      const completedAt = offlineTime ?? new Date();
      await tx.cleaningCycle.update({
        where: { id: cycle.id },
        data: { status: 'COMPLETED', completedAt },
      });
      // 2026-06-02: completion (checklist-as-final-stage path) mirrors advance.ts
      // — terminal CLEANING_CYCLE_COMPLETED state + lastCleaningDate stamp.
      // currentCycleId stays cleared so the filter is available for a new cycle.
      await tx.filterDetails.update({
        where: { assetInstanceId: filterId },
        data: { currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' },
      });
      // LOCAL calendar day (not UTC) so a completion near local midnight isn't
      // stamped a day early — see toLocalDateString.
      const cleanDate = toLocalDateString(completedAt);
      await tx.$executeRaw`UPDATE filters SET attributes = jsonb_set(COALESCE(attributes, '{}'::jsonb), '{lastCleaningDate}', to_jsonb(${cleanDate}::text), true) WHERE id = ${filterId}::uuid`;
      const completeEvent = {
        filterId, cycleId: cycle.id, eventType: 'CYCLE_COMPLETED' as const,
        performedBy: ctx.userSub, attributes: withClientOpId({ sequenceNumber: cycle.sequenceNumber }, clientOpId),
      };
      await tx.filterEvent.create({
        data: {
          ...completeEvent,
          checksum: computeChecksum(completeEvent),
          ipAddress: ctx.ipAddress,
          telemetrySnapshot: {},
          ...(offlineTime ? { performedAt: offlineTime } : {}),
        },
      });
    }

    // Audit §1.1 (2026-05-16): audit-write inside business tx.
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CHECKLIST_COMPLETED',
      targetType: 'filter', targetId: filterId,
      afterValue: { stage: currentState, answerCount: Object.keys(answers ?? {}).length, profileCount: checklistsSnapshot.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    }, tx);
  });

  return service.getCurrentState(ctx, filterId);
}
