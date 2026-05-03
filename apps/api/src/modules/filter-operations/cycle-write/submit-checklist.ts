/**
 * Filter Operations — submitChecklist() implementation.
 *
 * Extracted byte-for-byte from filter-operations.service.ts. Note: the
 * SELECT FOR UPDATE here uses `SELECT 1` (just acquires the row lock) and
 * verifies its invariant via an ALREADY_SUBMITTED FilterEvent lookup, which
 * is structurally different from the (state, cycle) recheck used by
 * advance/bypass/terminate. So this lock stays inline rather than going
 * through the shared `lockAndVerifyFilterState` helper.
 */
import type { RequestContext } from '../../../types/context.js';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { AppError } from '../../../lib/errors.js';
import { findExistingByClientOpId } from '../../../lib/idempotency.js';
import { loadLocalContext, throwIfFailed } from '../local-context.js';
import * as executor from '@digilog/shared';
import {
  computeChecksum,
  prettyStageLabel,
  collectChecklistsAfterStage,
  resolveChecklistQuestions,
} from '../helpers.js';
import type { FilterOperationsService } from '../filter-operations.service.js';

/** @param data - Validated by Fastify JSON schema before reaching this method */
export async function submitChecklistImpl(
  service: FilterOperationsService,
  ctx: RequestContext,
  filterId: string,
  data: any,
) {
  const { answers } = data;
  const clientOpId: string | null = data.clientOpId ?? null;
  // Honor offlinePerformedAt as the regulatory timestamp (operator's actual answer time).
  // Without this, every offline-replayed checklist records the server-receive time,
  // breaking 21 CFR Part 11 audit fidelity for offline operations.
  const offlineTime: Date | undefined = data.offlinePerformedAt ? new Date(data.offlinePerformedAt) : undefined;
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

  await prisma.$transaction(async (tx) => {
    // Phase 5b.4: SELECT FOR UPDATE on FilterDetails to serialize submitChecklist
    // against concurrent advance/bypass on the same filter.
    await tx.$queryRaw`
      SELECT 1 FROM filter_details WHERE asset_instance_id = ${filterId}::uuid FOR UPDATE
    `;

    // Check for duplicate submission (same stage, same cycle).
    const existing = await tx.filterEvent.findFirst({
      where: {
        filterId,
        cycleId: cycle.id,
        eventType: 'CHECKLIST_COMPLETED',
        attributes: { path: ['afterStage'], equals: currentState ?? undefined },
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
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'CHECKLIST_COMPLETED',
    targetType: 'filter', targetId: filterId,
    afterValue: { stage: currentState, answerCount: Object.keys(answers ?? {}).length, profileCount: checklistsSnapshot.length },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return service.getCurrentState(ctx, filterId);
}
