/**
 * Stage / cycle / profile transition guards (Phase 8.5).
 *
 * Pure portions of the four write methods in
 * `apps/api/src/modules/filter-operations/filter-operations.service.ts`,
 * extracted per the Phase 8.5 inventory.
 *
 * Every guard returns `GuardResult`; the caller (server: AppError throw, FE:
 * blocking dialog) interprets `{ ok: false, code, message, details? }` —
 * codes + messages MUST match the originals for cross-runtime parity.
 */
import type {
  FilterSlice,
  GuardResult,
  LocalContext,
  ProfileEdge,
  ProfileNode,
  ProfileSlice,
  StageInfo,
} from './types.js';

/** Guards #1, #9, #36, #43: cycle exists + filter has currentCycleId. */
export function assertCycleActive(ctx: LocalContext): GuardResult {
  if (!ctx.filter.currentCycleId) {
    return {
      ok: false,
      code: 'NO_CYCLE',
      message: 'No active cleaning cycle',
    };
  }
  return { ok: true };
}

/** Guard #47: startCycle — reject when an IN_PROGRESS cycle already exists. */
export function assertNoCycleActive(ctx: LocalContext, filter: FilterSlice): GuardResult {
  if (filter.currentCycleId && ctx.cycle && ctx.cycle.status === 'IN_PROGRESS') {
    return {
      ok: false,
      code: 'CYCLE_ACTIVE',
      message: 'Filter already has an active cleaning cycle',
    };
  }
  return { ok: true };
}

/** Guards #12, #46: a resolved cleaning profile id must exist for this filter. */
export function assertProfileAssigned(
  _ctx: LocalContext,
  resolvedProfileId: string | null | undefined,
): GuardResult {
  if (!resolvedProfileId) {
    return {
      ok: false,
      code: 'NO_PROFILE',
      message: 'Filter has no assigned profile',
    };
  }
  return { ok: true };
}

/**
 * Guard #13 (advance): the resolved cleaning profile must be present AND
 * status='ACTIVE'. Phase 8.6 fix — the original guard only null-checked,
 * which forced filter-operations.service.ts to add a redundant manual
 * `cp.status !== 'ACTIVE'` check immediately after every call. The status
 * check now lives here so the guard fully validates "active and ready".
 */
export function assertProfileActive(
  _ctx: LocalContext,
  cp: ProfileSlice | null | undefined,
): GuardResult {
  if (!cp) {
    return {
      ok: false,
      code: 'PROFILE_DISABLED',
      message: 'Cleaning profile is disabled or not found. Contact admin to activate it.',
    };
  }
  if (cp.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'PROFILE_DISABLED',
      message: 'Cleaning profile is disabled or not found. Contact admin to activate it.',
    };
  }
  return { ok: true };
}

/** Guard #48 (startCycle): the cleaning profile is present + ACTIVE. */
export function assertProfileEnabled(
  _ctx: LocalContext,
  cp: { name: string; status: string } | null | undefined,
): GuardResult {
  if (cp && cp.status !== 'ACTIVE') {
    return {
      ok: false,
      code: 'PROFILE_DISABLED',
      message: `Cleaning profile "${cp.name}" is disabled. Contact admin to activate it.`,
    };
  }
  return { ok: true };
}

function eventMs(e: { performedAt: Date | string }): number {
  const t = e.performedAt instanceof Date ? e.performedAt.getTime() : new Date(e.performedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

type EntryEvent = { eventType: string; toState?: string | null; performedAt: Date | string; attributes?: unknown };

/**
 * Is this event an ENTRY into `stage` — the filter moving INTO it? (2026-10-22)
 *
 * The in-place dryer steps are recorded with toState DRY_IN but move nothing:
 * the SUBMIT_READINGS row (`action: 'DRYER_READINGS_SUBMITTED'`) and, since
 * 2026-10-22, any row marked `inPlace: true` (the in-place SET_DURATION that
 * recovers a cycle sitting at Dry In without a dryer). Counting them as entries
 * voided a checklist answered after SET_DURATION the moment the readings landed
 * (400 CHECKLIST_PENDING on the way out of a mid-pipeline Dry In).
 */
export function isEntryIntoStage(e: EntryEvent, stage: string): boolean {
  if (e.toState !== stage) return false;
  const a = (e.attributes ?? {}) as { action?: unknown; inPlace?: unknown };
  return a.action !== 'DRYER_READINGS_SUBMITTED' && a.inPlace !== true;
}

/**
 * Is this transition a stage-approval DECISION rather than stage work? (D03-08,
 * 2026-10-22) A rejection records the filter's move back (WASH_OUT -> WASH_IN,
 * DRY_OUT -> DRY_IN) as a STATE_TRANSITION marked `kind: 'STAGE_INTERLOCK_*'`
 * (stage-approvals/service.ts). It IS an entry into the stage — the stage's work
 * and its checklist start again (isEntryIntoStage) — but nobody washed or dried:
 * a record of who performed a stage, and when, must never show it.
 */
export function isInterlockDecision(e: { attributes?: unknown }): boolean {
  const kind = (e.attributes as { kind?: unknown } | null | undefined)?.kind;
  return typeof kind === 'string' && kind.startsWith('STAGE_INTERLOCK_');
}

/**
 * The instant the filter last ENTERED `stage` in this cycle (latest entry event,
 * see isEntryIntoStage), or null when no such event is in the context.
 * Shared by the checklist gate, the tape and the server's duplicate-submission
 * guard so "one attestation per attempt" is decided the same way everywhere.
 */
export function latestEntryIntoStage(events: EntryEvent[], stage: string): number | null {
  let latest: number | null = null;
  for (const e of events) {
    if (!isEntryIntoStage(e, stage)) continue;
    const t = eventMs(e);
    if (latest === null || t > latest) latest = t;
  }
  return latest;
}

/**
 * Has the checklist after `position` been answered in the CURRENT attempt at it?
 * `position` is a stage key, or null for START (the checklists between START and
 * the first stage, 2026-10-22). Only CHECKLIST_COMPLETED rows recorded at/after
 * the latest entry into the stage count (a QA rejection sends the filter back
 * and the stage's checklist must be answered again). The ONE rule for the
 * server gate, the tape and current-state.
 */
export function checklistAnsweredInCurrentEntry(events: EntryEvent[], position: string | null): boolean {
  const entryAt = position === null ? null : latestEntryIntoStage(events, position);
  return events.some(
    e =>
      e.eventType === 'CHECKLIST_COMPLETED' &&
      ((e.attributes as { afterStage?: string | null } | undefined)?.afterStage ?? null) === position &&
      (entryAt === null || eventMs(e) >= entryAt),
  );
}

/**
 * Does THIS call finish the work of `targetState`? (2026-10-22, one rule.)
 *
 * Every stage's work is done the moment the filter enters it — except Dry In,
 * whose work is the dryer run: it starts on entry (SET_DURATION; "a cycle may
 * only ENTER Dry In with the dryer running") and ends with the half-time
 * readings (SUBMIT_READINGS). So a FINAL Dry In completes the cycle on
 * SUBMIT_READINGS, and the checklist after it rides on that call, never on the
 * entry. Used by advanceMustCarryChecklist, the server's completion decision and
 * the tape.
 */
export function callCompletesStageWork(targetState: string | null | undefined, dryerAction?: string | null): boolean {
  return targetState !== 'DRY_IN' || dryerAction === 'SUBMIT_READINGS';
}

/**
 * Guard #14: pending checklist gate before advance.
 *
 * If the cycle's current stage has CHECKLIST nodes downstream and no
 * `CHECKLIST_COMPLETED` event with `attributes.afterStage === currentState`
 * exists in the cycle's events, advance is blocked.
 *
 * Question versions are frozen at cycle start (A5). A checklist that is
 * DISABLED now (`ctx.disabledChecklistProfileIds`) does not gate — a disabled
 * checklist is skipped wherever it sits in the pipeline (2026-10-12).
 */
export function assertChecklistGatePassed(
  ctx: LocalContext,
  cp: ProfileSlice,
  currentState: string | null | undefined,
): GuardResult {
  // START is a position like a stage (2026-10-22): enabled checklists between
  // START and the first stage are answered after start-cycle, before the first
  // stage is entered. Until then they were never asked at all.
  const position = currentState ?? null;
  const currentStage = position === null
    ? cp.nodes.find(s => s.nodeType === 'START')
    : cp.nodes.find(s => s.stateKey === position);
  if (!currentStage) return { ok: true };

  const pendingCLNodes = enabledChecklistNodes(
    collectChecklistsAfterStageInternal(currentStage, cp.nodes, cp.edges),
    ctx.disabledChecklistProfileIds,
  );

  if (pendingCLNodes.length === 0) return { ok: true };

  // Audit 2026-09-24 (F4): scope the attestation to the CURRENT attempt at
  // this stage. A QA rejection sends the filter back (WASH_OUT → WASH_IN),
  // the operator re-performs the stage, and the post-stage checklist must be
  // answered AGAIN — the attempt-1 CHECKLIST_COMPLETED row no longer counts.
  // "Current attempt" starts at the latest ENTRY into this stage (the ordinary
  // STATE_TRANSITION, or the interlock-reject transition that rolled it back —
  // never an in-place dryer step, see isEntryIntoStage).
  if (checklistAnsweredInCurrentEntry(ctx.events, position)) return { ok: true };

  return {
    ok: false,
    code: 'CHECKLIST_PENDING',
    message: position === null
      ? 'Answer the checklist that comes before the first stage, then enter the first stage.'
      : `Please complete the checklist before advancing from ${prettyStageLabel(position)}`,
  };
}

/**
 * Guard #15: cycle complete — no reachable stages forward but END is reachable.
 * Mirrors advance() lines 1250-1252.
 */
export function assertNotCycleComplete(
  ctx: LocalContext,
  reachableStages: string[],
  hasEndNext: boolean,
): GuardResult {
  if (reachableStages.length === 0 && hasEndNext) {
    // The cycle is still IN PROGRESS here — it sits at its last stage, whose work
    // finishes it (readings at a final Dry In, its checklist, or its QA approval).
    // The message used to read "Cleaning cycle is complete", which a tablet
    // showed for a cycle still waiting at a final Dry In (2026-10-22).
    return {
      ok: false,
      code: 'CYCLE_COMPLETE',
      message: `${prettyStageLabel(ctx.filter?.currentLifecycleState)} is the last stage of this cleaning cycle — there is no stage after it. The cycle completes when that stage's work is finished.`,
    };
  }
  return { ok: true };
}

/**
 * Guard #16: target state reachable.
 *
 * `reachableStages.includes(targetState)` OR flowMode is BYPASS_ENABLED OR
 * dryer in-place action (DRY_IN -> DRY_IN). Mirrors advance() lines 1254-1257.
 */
export function assertTargetStateReachable(
  _ctx: LocalContext,
  targetState: string,
  reachableStages: string[],
  flowMode: string,
  isDryerInPlace: boolean,
  currentState: string | null | undefined,
): GuardResult {
  if (reachableStages.includes(targetState)) return { ok: true };
  if (flowMode === 'BYPASS_ENABLED') return { ok: true };
  if (isDryerInPlace) return { ok: true };

  return {
    ok: false,
    code: 'OUT_OF_SEQUENCE',
    message: `Cannot move to ${targetState} from ${currentState ?? 'START'}. Next allowed: ${reachableStages.join(', ')}`,
  };
}

/** Guard #17: target state exists in the pipeline as a STAGE node. */
export function assertTargetStateExists(
  _ctx: LocalContext,
  targetState: string,
  cp: ProfileSlice,
): GuardResult {
  const targetStage = cp.nodes.find(s => s.stateKey === targetState);
  if (!targetStage) {
    return {
      ok: false,
      code: 'INVALID_TARGET',
      message: `Invalid target state: ${targetState}`,
    };
  }
  return { ok: true };
}

/**
 * Guards #3, #11, #37, #44 (hybrid): tape-version freshness.
 *
 * Pure portion: compute `currentTapeVersion = profileVersion * 1_000_000 +
 * eventCount`, compare to client-submitted version. Server's `loadLocalContext`
 * is responsible for `ctx.events.length` reflecting truth from the DB.
 *
 * `submittedTapeVersion === undefined | null` is a non-check (backwards compat
 * for pre-8.4 callers — server route schema still tightens this independently).
 */
export function assertTapeVersionFresh(
  ctx: LocalContext,
  submittedTapeVersion: number | undefined | null,
): GuardResult {
  if (submittedTapeVersion === undefined || submittedTapeVersion === null) {
    return { ok: true };
  }
  const profileVersion = ctx.cycle?.profileVersion ?? 0;
  const eventCount = ctx.events.length;
  const currentTapeVersion = profileVersion * 1_000_000 + eventCount;
  if (submittedTapeVersion !== currentTapeVersion) {
    return {
      ok: false,
      code: 'STALE_TAPE',
      message: 'Tape version mismatch — another operator may have changed this cycle. Refresh and retry.',
      details: { currentTapeVersion },
    };
  }
  return { ok: true };
}

// ── Helpers (also exported for caller convenience) ──────────────────────────

/**
 * Walk forward from a STAGE/START node; collect any CHECKLIST nodes between
 * it and the next STAGE/END, each ONCE, in walk order. The one implementation:
 * the API's filter-operations/helpers.ts delegates here (2026-10-22), and the
 * web offline engine imports it directly.
 */
export function collectChecklistsAfterStage(
  stage: ProfileNode,
  allStages: ProfileNode[],
  connections: ProfileEdge[],
): ProfileNode[] {
  return collectChecklistsAfterStageInternal(stage, allStages, connections);
}

/** The checklistProfileId a CHECKLIST node points at, or null when unset. */
export function checklistNodeProfileId(node: ProfileNode): string | null {
  const id = (node.configuration as { checklistProfileId?: unknown })?.checklistProfileId;
  return typeof id === 'string' && id ? id : null;
}

/**
 * CHECKLIST nodes that actually gate: they name a checklist profile and that
 * profile is not disabled. The ONE definition of "is this checklist asked?"
 * shared by the server and the offline tablet (2026-10-12: a disabled
 * checklist is skipped everywhere — mid-pipeline and before END alike).
 */
export function enabledChecklistNodes(
  nodes: ProfileNode[],
  disabledChecklistProfileIds?: readonly string[] | null,
): ProfileNode[] {
  const disabled = new Set(disabledChecklistProfileIds ?? []);
  return nodes.filter(n => {
    const id = checklistNodeProfileId(n);
    return id !== null && !disabled.has(id);
  });
}

/**
 * A-01 (operator decision 2026-10-21): must an advance INTO a stage carry the
 * checklist that follows it in the SAME call (`advance-with-checklist`)?
 *
 * Yes when the stage is the LAST one (END follows, no further stage) and an
 * ENABLED checklist follows it — unless the stage is QA-interlock gated, where
 * the design is two-step: the bare advance enters the stage and raises the
 * PENDING approval, and the checklist is answered after approval.
 *
 * ONE rule: the server's advance() refuses a bare advance exactly when this is
 * true (409 CHECKLIST_REQUIRED), and the web batch path asks the checklist first
 * by it — so the two cannot disagree. Input is a `stageLookup` entry (the
 * server builds those with the same walkers and enabled-checklist filter);
 * `disabledChecklistProfileIds` re-applies the disabled filter to a cached entry.
 */
export function advanceMustCarryChecklist(
  entry: (Partial<StageInfo> & { interlockGated?: boolean }) | null | undefined,
  disabledChecklistProfileIds?: readonly string[] | null,
  call?: { targetState?: string | null; dryerAction?: string | null },
): boolean {
  if (!entry || entry.leadsToEnd !== true || (entry.nextStages?.length ?? 0) > 0) return false;
  if (entry.interlockGated === true) return false;
  // The checklist rides on the call that FINISHES the final stage's work: for a
  // final Dry In that is SUBMIT_READINGS, not the entry (2026-10-22). A caller
  // that does not pass `call` gets the entry-call answer (any non-Dry-In stage).
  if (call && !callCompletesStageWork(call.targetState, call.dryerAction)) return false;
  const disabled = new Set(disabledChecklistProfileIds ?? []);
  return (entry.pendingChecklistProfileIds ?? []).some((id) => !!id && !disabled.has(id));
}

function collectChecklistsAfterStageInternal(
  stage: ProfileNode,
  allStages: ProfileNode[],
  connections: ProfileEdge[],
): ProfileNode[] {
  const checklists: ProfileNode[] = [];
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const c of connections.filter(cn => cn.fromStageId === nodeId)) {
      const next = allStages.find(s => s.id === c.toStageId);
      if (!next) continue;
      // visited is checked BEFORE the push (2026-10-22): a CHECKLIST reached a
      // second time (a checklist-to-checklist loop, or two paths meeting) used
      // to be pushed again, so its questions were asked and snapshotted twice.
      if (next.nodeType === 'CHECKLIST' && !visited.has(next.id)) {
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
 * CHECKLIST nodes) and a `leadsToEnd` flag. Mirrors the per-call
 * `findReachableStages` walker inside advance() (lines 1226-1248) and the
 * tape generator's `findReachable`.
 */
export function findReachable(
  fromNodeId: string,
  allStages: ProfileNode[],
  connections: ProfileEdge[],
): { reachableStages: string[]; hasEndNext: boolean } {
  const reachableStages: string[] = [];
  let hasEndNext = false;
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const c of connections.filter(cn => cn.fromStageId === nodeId)) {
      const next = allStages.find(s => s.id === c.toStageId);
      if (!next) continue;
      if (next.nodeType === 'STAGE' && next.stateKey) {
        reachableStages.push(next.stateKey);
      } else if (next.nodeType === 'END') {
        hasEndNext = true;
      } else if (next.nodeType === 'CHECKLIST') {
        walk(next.id);
      }
    }
  };
  walk(fromNodeId);
  return { reachableStages, hasEndNext };
}

/** Returns the list of stateKeys reachable from the cycle's current state. */
export function getReachableStages(ctx: LocalContext): string[] {
  if (!ctx.cycle) return [];
  const state = ctx.filter.currentLifecycleState;
  const fromNode = state
    ? ctx.profile.nodes.find(s => s.stateKey === state) ?? ctx.profile.nodes.find(s => s.nodeType === 'START')
    : ctx.profile.nodes.find(s => s.nodeType === 'START');
  if (!fromNode) return [];
  return findReachable(fromNode.id, ctx.profile.nodes, ctx.profile.edges).reachableStages;
}

/** Returns true when the next non-CHECKLIST node forward from current state is END. */
export function leadsToEnd(ctx: LocalContext): boolean {
  const state = ctx.filter.currentLifecycleState;
  const fromNode = state
    ? ctx.profile.nodes.find(s => s.stateKey === state) ?? ctx.profile.nodes.find(s => s.nodeType === 'START')
    : ctx.profile.nodes.find(s => s.nodeType === 'START');
  if (!fromNode) return false;
  return findReachable(fromNode.id, ctx.profile.nodes, ctx.profile.edges).hasEndNext;
}

/** Pretty-print a stateKey for operator-facing messages — same impl as service. */
export function prettyStageLabel(stateKey: string | null | undefined): string {
  if (!stateKey) return 'this stage';
  return stateKey
    .split('_')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Build `stageLookup` from a profile graph. Mirrors the per-stage table built
 * in getCurrentState() (filter-operations.service.ts:632-658). Server may
 * pre-compute this once per request and stash on `ctx.stageLookup`; this
 * helper exists for the FE / tests that have only the profile slice.
 */
export function buildStageLookup(profile: ProfileSlice): Record<string, StageInfo> {
  const stageLookup: Record<string, StageInfo> = {};
  for (const s of profile.nodes) {
    if (s.nodeType !== 'STAGE' || !s.stateKey) continue;
    const checklistNodes = collectChecklistsAfterStageInternal(s, profile.nodes, profile.edges);
    const { reachableStages, hasEndNext } = findReachable(s.id, profile.nodes, profile.edges);
    const seen = new Set<string>();
    const dedupedStages: string[] = [];
    for (const k of reachableStages) {
      if (seen.has(k)) continue;
      seen.add(k);
      dedupedStages.push(k);
    }
    stageLookup[s.stateKey] = {
      nextStages: dedupedStages,
      pendingChecklistProfileIds: checklistNodes
        .map(n => (n.configuration as { checklistProfileId?: string })?.checklistProfileId)
        .filter((v): v is string => typeof v === 'string'),
      leadsToEnd: hasEndNext,
    };
  }
  return stageLookup;
}

/**
 * For tape callers: the legacy `assertCanTransition(ctx, target)` shape.
 * Computes reachability + delegates to `assertTargetStateReachable` with
 * defaults (no flowMode override, no dryer in-place) — useful for unit
 * tests / FE pre-render checks before the server transition fires.
 */
export function assertCanTransition(
  ctx: LocalContext,
  targetStateKey: string,
): GuardResult {
  const reachable = getReachableStages(ctx);
  if (reachable.includes(targetStateKey)) return { ok: true };
  return {
    ok: false,
    code: 'OUT_OF_SEQUENCE',
    message: `Cannot move to ${targetStateKey} from ${ctx.filter.currentLifecycleState ?? 'START'}. Next allowed: ${reachable.join(', ')}`,
  };
}
