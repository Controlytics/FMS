/**
 * Decision-tape generator — Phase 8.0.
 *
 * PURE FUNCTION. No I/O. No prisma. No side effects. Same input → same output.
 *
 * The generator mirrors the action-emission logic that `getCurrentState()` +
 * `advance()` enforce together (filter-operations.service.ts:331-696, 1031-...).
 * It does NOT re-derive that logic — it converts the SAME pre-resolved data
 * into a flat list of permitted actions. The parallel-validation harness in
 * `__tests__/tape-parity.test.ts` proves the action list aligns with
 * `getCurrentState()`'s `nextAllowedStages` + `pendingChecklist` invariants.
 *
 * v1 emits 7 action types covering the in-cycle stage-advance surface:
 *   ADVANCE_TO_STAGE, SUBMIT_CHECKLIST, SUBMIT_DRYER_READINGS,
 *   SET_DRYER_DURATION, BYPASS_STAGE, TERMINATE_CYCLE, COMPLETE_CYCLE.
 *
 * Out-of-scope for v1: retire / replace / RFID-scan / batch-flow — those stay
 * on the existing routes.
 */
import type {
  Action,
  ActionTape,
  AdvanceToStageAction,
  CompleteCycleAction,
  OperatingRangeMap,
  SetDryerDurationAction,
  SubmitChecklistAction,
  SubmitDryerReadingsAction,
  BypassStageAction,
  TerminateCycleAction,
  TapeConnection,
  TapeInput,
  TapeStage,
} from './types.js';

// ── pipeline-graph helpers (mirror filter-operations.service.ts) ──────────

/**
 * Walk forward from a STAGE/START node; collect any CHECKLIST nodes that sit
 * between it and the next STAGE/END. Mirrors `collectChecklistsAfterStage` in
 * filter-operations.service.ts:31-55.
 */
function collectChecklistsAfter(
  stage: TapeStage,
  allStages: TapeStage[],
  connections: TapeConnection[],
): TapeStage[] {
  const checklists: TapeStage[] = [];
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const c of connections.filter(cn => cn.fromStageId === nodeId)) {
      const next = allStages.find(s => s.id === c.toStageId);
      if (!next) continue;
      if (next.nodeType === 'CHECKLIST') {
        checklists.push(next);
        walk(next.id);
      }
    }
  };
  walk(stage.id);
  return checklists;
}

/**
 * Walk forward from a node; collect reachable STAGE stateKeys (skipping
 * CHECKLIST nodes); also flag whether END is reachable. Mirrors the
 * `findReachableStages` walker in advance() (filter-operations.service.ts:1086-1109).
 */
function findReachable(
  fromNodeId: string,
  allStages: TapeStage[],
  connections: TapeConnection[],
): { reachableStages: { stateKey: string; stage: TapeStage }[]; leadsToEnd: boolean } {
  const reachable: { stateKey: string; stage: TapeStage }[] = [];
  let leadsToEnd = false;
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const c of connections.filter(cn => cn.fromStageId === nodeId)) {
      const next = allStages.find(s => s.id === c.toStageId);
      if (!next) continue;
      if (next.nodeType === 'STAGE' && next.stateKey) {
        reachable.push({ stateKey: next.stateKey, stage: next });
      } else if (next.nodeType === 'END') {
        leadsToEnd = true;
      } else if (next.nodeType === 'CHECKLIST') {
        walk(next.id);
      }
    }
  };
  walk(fromNodeId);
  return { reachableStages: reachable, leadsToEnd };
}

// ── label helper ──────────────────────────────────────────────────────────

function prettyStageLabel(stateKey: string): string {
  return stateKey.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(' ');
}

// ── instrument-resolution helpers ─────────────────────────────────────────

/** Returns instruments wired to a given stageKey, sorted by sortOrder asc. */
function instrumentsForStage(eq: TapeInput['pinnedEquipmentGroup'], stageKey: string) {
  if (!eq) return [];
  return eq.instruments
    .filter(i => i.stageKey === stageKey)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function buildOperatingRanges(insts: { id: string; operatingMin: number; operatingMax: number }[]): OperatingRangeMap {
  const m: OperatingRangeMap = {};
  for (const i of insts) m[i.id] = { min: i.operatingMin, max: i.operatingMax };
  return m;
}

// ── main entry ────────────────────────────────────────────────────────────

/**
 * Pure-function tape generator. Always returns a well-formed ActionTape.
 *
 * Determinism contract: for fixed (cycle state, pinned versions, recent
 * events, now), the output actions[] order + content is stable.
 */
export function generateTape(input: TapeInput): ActionTape {
  const { cycle, filter, pinnedProfile, pinnedEquipmentGroup, pinnedChecklistProfiles, recentChecklistEvents, now } = input;
  const actions: Action[] = [];
  const state = filter.currentLifecycleState;

  // No cycle → no advance-surface actions. Cycle-start is via a separate route
  // (POST /:id/start-cycle); v1 doesn't model it as a tape action.
  if (!cycle || cycle.status !== 'IN_PROGRESS') {
    return { state, actions: [], tapeVersion: tapeVersionOf(cycle, input.filterEventCount) };
  }

  // TERMINATE is always available while cycle is in progress (mirrors the
  // POST /terminate route requirement of remarks).
  const terminate: TerminateCycleAction = {
    type: 'TERMINATE_CYCLE',
    label: 'Terminate Cycle',
    requiresJustification: { minLength: 10 },
  };

  // Without a profile pipeline we can still terminate.
  if (!pinnedProfile) {
    actions.push(terminate);
    return { state, actions, tapeVersion: tapeVersionOf(cycle, input.filterEventCount) };
  }

  const stages = pinnedProfile.stages;
  const connections = pinnedProfile.connections;

  // Locate the "from" node — current STAGE if state is set, otherwise START.
  const fromNode = state
    ? stages.find(s => s.stateKey === state) ?? stages.find(s => s.nodeType === 'START')
    : stages.find(s => s.nodeType === 'START');

  if (!fromNode) {
    // Pipeline has no START and current state can't be located — only TERMINATE.
    actions.push(terminate);
    return { state, actions, tapeVersion: tapeVersionOf(cycle, input.filterEventCount) };
  }

  // 1. Pending-checklist gate. Mirrors getCurrentState():431-449 +
  //    advance():1064-1075.
  const checklistNodes = state ? collectChecklistsAfter(fromNode, stages, connections) : [];
  const checklistAnswered = (afterStage: string | null): boolean => {
    if (!afterStage) return false;
    return recentChecklistEvents.some(e => e.eventType === 'CHECKLIST_COMPLETED' && (e.attributes?.afterStage ?? null) === afterStage);
  };

  let checklistsPending = false;
  if (state && checklistNodes.length > 0 && !checklistAnswered(state)) {
    // Build SUBMIT_CHECKLIST actions per checklist node with a resolvable
    // pinned profile. If ALL profiles are unresolved (e.g. all disabled), fall
    // through to advance-emission — mirrors getCurrentState():450-456.
    const submits: SubmitChecklistAction[] = [];
    for (const cl of checklistNodes) {
      const checklistProfileId = (cl.configuration as any)?.checklistProfileId as string | undefined;
      if (!checklistProfileId) continue;
      const resolved = pinnedChecklistProfiles.get(checklistProfileId);
      if (!resolved || resolved.questions.length === 0) continue;
      submits.push({
        type: 'SUBMIT_CHECKLIST',
        label: `Submit Checklist: ${resolved.name ?? prettyStageLabel(state)}`,
        params: {
          checklistProfileId,
          versionPin: resolved.versionPin,
          afterStage: state,
          questions: resolved.questions,
        },
        blocking: true,
      });
    }
    if (submits.length > 0) {
      checklistsPending = true;
      actions.push(...submits);
    }
  }

  if (checklistsPending) {
    // Blocking gate: no advance actions until checklist submitted. TERMINATE
    // remains available (operator can always abandon the cycle).
    actions.push(terminate);
    return { state, actions, tapeVersion: tapeVersionOf(cycle, input.filterEventCount) };
  }

  // 2. Resolve reachable stages from the current node, walking past CHECKLIST
  //    nodes. Mirrors advance():1086-1109 + getCurrentState():458-468.
  const { reachableStages, leadsToEnd } = findReachable(fromNode.id, stages, connections);

  // 3. DRY_IN specials.
  //    a) Currently in DRY_IN, dryer started, half-time elapsed, readings not yet submitted
  //       → SUBMIT_DRYER_READINGS. Mirrors advance():1162-1175.
  //    b) Currently in DRY_IN, half-time NOT elapsed → no advance/submit actions
  //       (mirrors advance():1178-1187 — leaving DRY_IN early is rejected).
  //    c) Next stage is DRY_IN and dryer not yet started → SET_DRYER_DURATION
  //       (mirrors advance():1156-1158).
  let blockedByDryerHalfTime = false;
  let dryerReadingsAction: SubmitDryerReadingsAction | null = null;
  if (state === 'DRY_IN' && cycle.dryerStartedAt && cycle.dryerDurationMinutes) {
    const halfMs = (cycle.dryerDurationMinutes * 60_000) / 2;
    const elapsedMs = now.getTime() - new Date(cycle.dryerStartedAt).getTime();
    const halfElapsed = elapsedMs >= halfMs;
    if (!halfElapsed) {
      blockedByDryerHalfTime = true;
    }
    if (halfElapsed && !cycle.dryerReadingsSubmitted) {
      const dryInInsts = instrumentsForStage(pinnedEquipmentGroup, 'DRY_IN');
      if (dryInInsts.length > 0) {
        dryerReadingsAction = {
          type: 'SUBMIT_DRYER_READINGS',
          label: 'Submit Dryer Readings',
          params: { instrumentIds: dryInInsts.map(i => i.id) },
          validations: { halfDurationMs: halfMs, operatingRanges: buildOperatingRanges(dryInInsts) },
        };
      }
    }
  }

  if (dryerReadingsAction) {
    actions.push(dryerReadingsAction);
  }

  // 4. Advance / SET_DRYER_DURATION / COMPLETE.
  if (!blockedByDryerHalfTime) {
    for (const r of reachableStages) {
      // SET_DRYER_DURATION takes the place of an ADVANCE_TO_STAGE(DRY_IN)
      // when entering DRY_IN with no duration set. The FE submits this as
      // POST advance with `dryerAction: 'SET_DURATION'`. Once duration is
      // set the cycle stays at DRY_IN; subsequent dryer actions are
      // SUBMIT_DRYER_READINGS (in-place) and then ADVANCE_TO_STAGE (out).
      if (r.stateKey === 'DRY_IN' && state !== 'DRY_IN' && !cycle.dryerStartedAt) {
        const setDur: SetDryerDurationAction = {
          type: 'SET_DRYER_DURATION',
          label: 'Set Dryer Duration',
          params: { targetState: 'DRY_IN', minMinutes: 1, maxMinutes: 1440 },
        };
        actions.push(setDur);
        continue;
      }

      // Generic ADVANCE_TO_STAGE. If the target stage has instruments wired in
      // the pinned equipment group, the operator MUST submit readings. The FE
      // renders an instrument-reading dialog when requiresInstrumentReadings is
      // present. Validation is mirrored from advance():1264-1285.
      const stageInsts = instrumentsForStage(pinnedEquipmentGroup, r.stateKey);
      const adv: AdvanceToStageAction = {
        type: 'ADVANCE_TO_STAGE',
        label: `Advance to ${prettyStageLabel(r.stateKey)}`,
        params: {
          targetState: r.stateKey,
          ...(stageInsts.length > 0 ? { requiresInstrumentReadings: stageInsts.map(i => i.id) } : {}),
        },
        ...(stageInsts.length > 0 ? { validations: { operatingRanges: buildOperatingRanges(stageInsts) } } : {}),
      };
      actions.push(adv);
    }

    // COMPLETE_CYCLE — when the next pipeline node leads to END and there
    // are no more reachable STAGE nodes. Server auto-advances on accept.
    // Mirrors advance():1111-1113 (which throws CYCLE_COMPLETE) — but here
    // we expose it as an explicit action the FE can render.
    if (leadsToEnd && reachableStages.length === 0) {
      const complete: CompleteCycleAction = {
        type: 'COMPLETE_CYCLE',
        label: 'Complete Cycle',
      };
      actions.push(complete);
    }
  }

  // 5. BYPASS_STAGE — only when the profile.flowMode permits bypass.
  //
  //    M1 (Phase 8.2 fix — 2026-05-02): expanded from "reachable stages only"
  //    to the FULL pipeline-stage set, excluding the current state. This
  //    matches the actual server-side bypass surface in the `bypass()` route
  //    (filter-operations.service.ts:1548-1556) which validates targetState
  //    against `cp.stages.filter(s => s.nodeType === 'STAGE' && s.stateKey)`
  //    — i.e. ANY pipeline STAGE is a legal bypass target as long as
  //    flowMode === 'BYPASS_ENABLED' and a justification ≥ minLength is
  //    provided. The previous emit-set (reachableStages only) under-reported
  //    the operator's real bypass surface — specifically the step-back case
  //    (jumping to an earlier stage in the pipeline) which the existing
  //    in-app UI exposes today.
  //
  //    Bypassing INTO the current state is a no-op, so we exclude it.
  if (!checklistsPending && !blockedByDryerHalfTime && pinnedProfile.flowMode === 'BYPASS_ENABLED') {
    const allBypassTargets = stages
      .filter(s => s.nodeType === 'STAGE' && s.stateKey && s.stateKey !== state)
      // Stable order: by sortOrder asc, then by stateKey asc as deterministic tie-break.
      .slice()
      .sort((a, b) => {
        const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        if (so !== 0) return so;
        return (a.stateKey ?? '').localeCompare(b.stateKey ?? '');
      });
    for (const s of allBypassTargets) {
      const byp: BypassStageAction = {
        type: 'BYPASS_STAGE',
        label: `Bypass to ${prettyStageLabel(s.stateKey!)}`,
        params: { targetState: s.stateKey! },
        requiresJustification: { minLength: 10 },
      };
      actions.push(byp);
    }
  }

  actions.push(terminate);
  return { state, actions, tapeVersion: tapeVersionOf(cycle, input.filterEventCount) };
}

/**
 * Phase 8.0 derivation: `profileVersion * 1000 + filterEventCount`.
 *
 * Includes the full FilterEvent count for the cycle (any event type) so the
 * tapeVersion actually changes between stage transitions. Using only
 * checklist events would leave two consecutive getCurrentState() calls
 * before/after a STATE_TRANSITION at the same tapeVersion despite the
 * action list having changed entirely. Phase 8.4 may revisit once the FE
 * consumes this.
 */
function tapeVersionOf(cycle: TapeCycleLike | null, filterEventCount: number): number {
  const base = (cycle?.profileVersion ?? 0) * 1000;
  return base + (filterEventCount ?? 0);
}

type TapeCycleLike = { profileVersion: number };
