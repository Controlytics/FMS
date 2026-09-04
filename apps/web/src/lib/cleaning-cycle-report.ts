// Shared, pure helpers for rendering cleaning-cycle records cycle-wise.
//
// CC_COL_KEYS drives ONE surface: the Filter Cleaning Record
// (routes/cleaning-cycles/history.tsx) — its screen table, its PDF and its
// Excel export all read this list, so those three can never drift apart. The
// Filter Lifecycle Report imports only `effectiveCycleStatus` from here and has
// its own columns. (This header previously claimed both pages shared the
// columns; corrected 2026-09-03.)
import type { FilterEvent } from '../types/filter';
import { formatByLeastCount } from './format-by-least-count';

/**
 * Column order/keys for the cleaning-cycle record tables (2026-06-08):
 *  - `duration` = the dryer duration the operator selected at DRY_IN
 *    (cycle.dryerDurationMinutes), NOT the full cycle duration.
 *  - `dryIn` time = when the operator submitted the dryer-duration record
 *    (cycle.dryerStartedAt), not the temperature-submission time.
 * The old cycle-duration column was dropped per operator request.
 *
 * 'dryBy' was dropped once and RE-ADDED 2026-09-03 on operator request: the
 * record has to show who completed DRY_OUT, the way 'washBy' shows the wash.
 * Note the two are NOT symmetric, deliberately — 'washBy' reads WASH_IN first
 * and falls back to WASH_OUT, while 'dryBy' reads DRY_OUT first (the stage the
 * operator actually asked about) and falls back to DRY_IN. In practice one
 * person does both halves, which is why 'washBy' reads as "who washed".
 */
export const CC_COL_KEYS = [
  'sNo', 'filter', 'size', 'airPressure', 'roWater',
  'washIn', 'washOut', 'washBy', 'duration', 'dryIn', 'dryerTemp', 'dryOut', 'dryBy', 'status',
] as const;

/**
 * Resolve the canonical STATE_TRANSITION event for a stage.
 * DRY_IN is special: two transitions land on DRY_IN (SET_DURATION with no
 * readings, then SUBMIT_READINGS with the temperature). For DRY_IN we want the
 * readings-bearing event (for the temperature); a manual Edit-Filter-Status
 * change carries no readings, so fall back to it; otherwise the column is blank
 * (cycle mid-dryer, no temperature yet). Every other stage emits a single
 * readings-bearing transition, so the fallback to stageEvents[0] is correct.
 */
/**
 * Who performed a filter event, for display.
 *
 * `performedByName` / `performedByUsername` are resolved server-side from the
 * users table and come back NULL when that user no longer exists — which is the
 * common case, not the edge one: 92% of live `filter_events` name a user deleted
 * in the 2026-08-19 wipe. Every surface that printed just the name showed an
 * empty cell for them, including the lifecycle report's "By" column on manual
 * updates.
 *
 * The raw `performedBy` uuid survives on the row, so fall back to its first 8
 * characters — a stable identifier beats a blank. `getStageInfo` below has done
 * this since it was written; this makes the rule reusable rather than copied.
 */
export function performerLabel(row: any, fallback = '-'): string {
  return row?.performedByName
    ?? row?.performedByUsername
    ?? (typeof row?.performedBy === 'string' && row.performedBy
          ? row.performedBy.substring(0, 8)
          : null)
    ?? fallback;
}

export function getStageInfo(events: FilterEvent[], stage: string) {
  const stageEvents = (events ?? []).filter((e) => e.eventType === 'STATE_TRANSITION' && e.toState === stage);
  const requireReadings = stage === 'DRY_IN';
  const evWithReadings = stageEvents.find((e) => (e.attributes as any)?.instrumentReadings?.length > 0);
  const manualStageEvent = stageEvents.find((e) => (e.attributes as any)?.manual);
  const ev = evWithReadings ?? manualStageEvent ?? (requireReadings ? null : stageEvents[0]);
  if (!ev) return null;
  return {
    time: ev.performedAt,
    performedBy: ev.performedByName ?? ev.performedBy?.substring(0, 8) ?? '-',
    readings: (ev.attributes as any)?.instrumentReadings ?? [],
    manual: !!(ev.attributes as any)?.manual, // stage was set by a manual update
  };
}

/** Find an instrument reading by description substring and format it with its UOM. */
export function getReading(readings: any[], desc: string) {
  const r = (readings ?? []).find((r: any) => r.description?.toLowerCase().includes(desc.toLowerCase()));
  if (!r) return '-';
  const formatted = r.leastCount !== undefined && r.leastCount !== null
    ? formatByLeastCount(r.value, r.leastCount)
    : String(r.value);
  return `${formatted} ${r.uom ?? ''}`.trim();
}

/** Format a minute count as a human duration ("45m", "1h 30m", "2h"). */
export function fmtMinutes(mins: number | null | undefined) {
  if (mins == null) return null;
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/**
 * Dryer duration the operator SELECTED at DRY_IN + the time they submitted it.
 * Authoritative source is the cycle row (advance.ts persists
 * dryerDurationMinutes / dryerStartedAt on SET_DURATION). Falls back to the
 * DRYER_STARTED DRY_IN event for legacy cycles written before those columns.
 */
export function getDryerStart(cycle: any, events: FilterEvent[]) {
  let minutes: number | null = cycle?.dryerDurationMinutes ?? null;
  let time: string | null = cycle?.dryerStartedAt ?? null;
  if (minutes == null || time == null) {
    const ev = (events ?? []).find((e) =>
      e.eventType === 'STATE_TRANSITION' && e.toState === 'DRY_IN' &&
      ((e.attributes as any)?.action === 'DRYER_STARTED' || (e.attributes as any)?.dryerDurationMinutes != null));
    minutes = minutes ?? ((ev?.attributes as any)?.dryerDurationMinutes ?? null);
    time = time ?? ((ev?.attributes as any)?.dryerStartedAt ?? ev?.performedAt ?? null);
  }
  return { minutes, time };
}

/**
 * Display status for a cycle. A cycle terminated because its filter was retired
 * or replaced mid-cleaning carries terminationReason RETIRED / REPLACED — surface
 * that instead of a generic TERMINATED so the reports show why the cycle ended.
 */
export function effectiveCycleStatus(cycle: any): string {
  if (cycle?.status === 'TERMINATED') {
    if (cycle.terminationReason === 'RETIRED') return 'RETIRED';
    if (cycle.terminationReason === 'REPLACED') return 'REPLACED';
  }
  return cycle?.status;
}

/** Cleaning stages in pipeline order — the stage-progress bar's fixed axis. */
export const STAGE_ORDER = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'] as const;

/**
 * Stage-progress state for the cycle detail view's progress bar.
 *
 * `reached` is a SET of the stages the cycle transitioned into — deliberately not
 * the raw event list. A stage can legitimately be entered by MORE than one
 * STATE_TRANSITION: DRY_IN emits two (SET_DURATION, then SUBMIT_READINGS — the
 * persisted-countdown flow), so the event list carries duplicates by design and
 * its LENGTH is not a stage index.
 *
 * `current` is derived structurally rather than by counting transitions: it is the
 * first in-profile stage that comes after the furthest stage reached and has not
 * itself been reached. Counting instead (`i === events.length`) overshoots by one
 * per duplicate and pulses a stage the operator hasn't got to yet.
 *
 * Only an IN_PROGRESS cycle has a current stage — a completed / terminated /
 * retired / replaced one has no next action, so `current` is null.
 */
export function stageProgress(
  events: any[],
  profileStages: string[],
  effStatus: string,
): { reached: Set<string>; current: string | null } {
  const reached = new Set<string>(
    (events ?? [])
      .filter((e: any) => e.eventType === 'STATE_TRANSITION' && e.toState)
      .map((e: any) => e.toState as string),
  );
  // Furthest point on the axis the cycle has actually got to (-1 = not started).
  const maxReachedIdx = STAGE_ORDER.reduce((acc, s, i) => (reached.has(s) ? i : acc), -1);
  // Before the first transition nothing pulses (unchanged behaviour): with no
  // transition there is no evidence of which stage the operator is on.
  if (effStatus !== 'IN_PROGRESS' || maxReachedIdx < 0) return { reached, current: null };
  const current = STAGE_ORDER.find(
    (s, i) =>
      i > maxReachedIdx &&
      !reached.has(s) &&
      // Stages outside this cycle's profile render "NA" and are never current.
      (profileStages.length === 0 || profileStages.includes(s)),
  );
  return { reached, current: current ?? null };
}

/**
 * How ONE stage column renders for a cycle.
 *
 * The DECISION is shared; the RENDERING is not — the page draws JSX with
 * colours, the PDF and Excel exports need a plain string. Splitting it this way
 * is the point: until 2026-09-02 each surface carried its own copy of the rule
 * and the export's copy simply had no `skipped` branch, so a stage the page
 * labelled "Skipped" printed as "Pending" in the export of the SAME cycle —
 * two renderings of one 21 CFR §11 record disagreeing.
 */
export type StageCellState =
  | { kind: 'value'; value: string; manual: boolean }
  | { kind: 'na' }
  | { kind: 'terminal'; label: string }
  | { kind: 'skipped' }
  | { kind: 'pending' };

/**
 * Index of the furthest IN-PROFILE stage this cycle actually transitioned into,
 * or -1 when it reached none.
 *
 * Indexed against `profileStages` — this cycle's own pipeline order — NOT the
 * fixed `STAGE_ORDER` axis that `stageProgress` uses. A profile need not hold
 * every stage, and the gap test compares positions WITHIN the profile.
 *
 * A stage can be entered by more than one STATE_TRANSITION (DRY_IN emits two:
 * SET_DURATION then SUBMIT_READINGS), so this reduces over a Set — the event
 * count is not a stage index.
 */
export function maxReachedStageIndex(events: any[], profileStages: string[]): number {
  const reached = new Set<string>(
    (events ?? [])
      .filter((e: any) => e.eventType === 'STATE_TRANSITION' && e.toState)
      .map((e: any) => e.toState as string),
  );
  return (profileStages ?? []).reduce((m, s, i) => (reached.has(s) ? i : m), -1);
}

/**
 * Resolve one stage column. Order matters and mirrors what the page has always
 * done: a recorded value wins over everything; then not-in-profile (NA); then a
 * cycle ended by retire/replace; then the skipped/pending split.
 *
 * Takes the cycle's EFFECTIVE status (`effectiveCycleStatus()`) rather than a
 * pre-derived Retired/Replaced label, so a caller cannot pass a status and a
 * label that disagree — the two are now read from one value.
 *
 * A stage is `skipped` when EITHER:
 *  - a LATER stage was reached, so this one was jumped over mid-chain; or
 *  - the cycle is COMPLETED (operator decision 2026-09-02). A closed cycle has
 *    no outstanding work, so an in-profile stage with no transition was not
 *    performed. It previously read "Pending", which asserted on a finished
 *    §11 record that the stage was still to come.
 *
 * ⚠️ "Pending" now means ONLY an IN_PROGRESS cycle (2026-09-03, operator
 * request). A finished cycle cannot have pending work, so every terminal status
 * gets its own word for why the stage has no value:
 *
 *   COMPLETED   -> "Skipped"     the cycle finished without performing it
 *   TERMINATED  -> "Terminated"  the cycle was abandoned before reaching it
 *   RETIRED     -> "Retired"     } closed by retire/replace; these are
 *   REPLACED    -> "Replaced"    } TERMINATED cycles too, matched first
 *   IN_PROGRESS -> "Pending"     the work really is still outstanding
 *
 * TERMINATED is deliberately NOT "Skipped": an abandoned cycle makes a different
 * claim about why the work is missing, and on a §11 record the two must not read
 * alike. It reuses the `terminal` kind that Retired/Replaced already use.
 */
export function resolveStageCell(args: {
  stage: string;
  value: string | null;
  manual?: boolean;
  profileStages: string[];
  effStatus: string;
  maxReachedIdx: number;
}): StageCellState {
  const { stage, value, manual, profileStages, effStatus, maxReachedIdx } = args;
  if (value != null) return { kind: 'value', value, manual: !!manual };
  if (profileStages.length > 0 && !profileStages.includes(stage)) return { kind: 'na' };
  if (effStatus === 'RETIRED') return { kind: 'terminal', label: 'Retired' };
  if (effStatus === 'REPLACED') return { kind: 'terminal', label: 'Replaced' };
  const idx = profileStages.indexOf(stage);
  // A gap BEHIND the furthest stage reached is a genuine skip whatever the cycle
  // status: the operator moved past it. Checked before the status branches so a
  // terminated cycle's mid-chain gap still reads "Skipped", not "Terminated".
  if (idx >= 0 && idx < maxReachedIdx) return { kind: 'skipped' };
  if (effStatus === 'COMPLETED') return { kind: 'skipped' };
  if (effStatus === 'TERMINATED') return { kind: 'terminal', label: 'Terminated' };
  return { kind: 'pending' };
}

/** Plain-text form of a stage cell, for the PDF and Excel exports. */
export function stageCellText(state: StageCellState): string {
  switch (state.kind) {
    case 'value': return state.value;
    case 'na': return 'NA';
    case 'terminal': return state.label;
    case 'skipped': return 'Skipped';
    case 'pending': return 'Pending';
  }
}

/**
 * Lives here, not in filter-lifecycle.tsx, because the per-cycle DETAIL
 * surfaces need it too (cycle-detail-view.tsx / cycle-detail-pdf.ts) and
 * filter-lifecycle.tsx imports both of those — importing back would be a
 * cycle. There must be exactly ONE definition: history.tsx records what a
 * second copy of an ended/not-ended branch cost last time.
 */

/**
 * Status-aware end-of-cycle labels for the report. A COMPLETED cycle shows
 * "Cycle Completed time" / "Completed by"; a TERMINATED / RETIRED / REPLACED
 * cycle shows "Cycle Terminated time" / "Terminated by" (using terminatedAt,
 * falling back to completedAt for legacy rows that only stamped completedAt).
 * The performer is the operator login id (username) per operator request — null
 * when the cycle was terminated outside the normal flow (DB-direct / legacy)
 * and no terminator was ever recorded.
 *
 * 2026-09-03 (operator request): for a COMPLETED cycle "By" names whoever
 * performed the cycle's LAST STAGE, not whoever closed it. Those are the same
 * operator on 578 of 593 live completed cycles — advancing into the final stage
 * completes the cycle in the same request — but they differ on the 14 MANUAL
 * FORCE-COMPLETES, where an admin closed the cycle from Edit Filter Status and
 * the column named that admin instead of the operator who did the work.
 *
 * TERMINATED / RETIRED / REPLACED keep the TERMINATOR: the label there reads
 * "Terminated by", and naming the last operator under it would be a false
 * statement about who ended the cycle.
 */
export function cycleEndInfo(
  summary: any,
  formatDateTime: (s: string) => string,
  fallback?: { replacedBy?: string | null; retiredBy?: string | null },
) {
  const eff = effectiveCycleStatus(summary);
  const ended = eff !== 'COMPLETED' && eff !== 'IN_PROGRESS';
  const endTime = ended ? (summary.terminatedAt ?? summary.completedAt) : summary.completedAt;
  // A cycle ended by retire/replace has no CYCLE_TERMINATED event — the operator
  // is recorded on the FILTER_REPLACED / FILTER_RETIRED audit instead. Fall back
  // to that (login id) so "Terminated by" isn't blank for those cycles.
  // Completed: the last stage's operator, falling back to whoever closed the
  // cycle when it has no stage transitions at all (one live cycle is COMPLETED
  // with zero events). Ended: the terminator, as the label says.
  //
  // Each falls back to the first 8 characters of the performer's uuid when the
  // username cannot be resolved — 92% of live filter_events name a user deleted
  // in the 2026-08-19 wipe, and this column was simply blank for all of them.
  // Same treatment as the Cleaning Record's Wash By / Dry By (getStageInfo).
  const who = (username: unknown, id: unknown): string | null =>
    (typeof username === 'string' && username) ||
    (typeof id === 'string' && id ? id.substring(0, 8) : null);
  let by = ended
    ? who(summary.completedByUsername, summary.completedBy)
    : (who(summary.lastStageByUsername, summary.lastStageBy) ?? who(summary.completedByUsername, summary.completedBy));
  if (!by && ended && fallback) {
    if (eff === 'REPLACED') by = fallback.replacedBy ?? null;
    else if (eff === 'RETIRED') by = fallback.retiredBy ?? null;
  }
  return {
    endLabel: ended ? 'Cycle Terminated time' : 'Cycle Completed time',
    byLabel: ended ? 'Terminated by' : 'Completed by',
    endTimeText: endTime ? formatDateTime(endTime) : '—',
    by,
  };
}

/**
 * The two DRY_IN steps, as From/To endpoints an operator can read.
 *
 * DRY_IN is entered ONCE but emits TWO `STATE_TRANSITION` rows: the operator
 * sets the dryer duration (`DRYER_STARTED`), waits, then submits the
 * temperature (`DRYER_READINGS_SUBMITTED`). The filter never leaves DRY_IN
 * between them, so `advance.ts` deliberately persists `fromState = null` on the
 * second row — "no transition actually occurred" — and left the labelling to
 * the `action` attribute.
 *
 * 🔴 **No renderer ever read `action`.** Every event timeline fell through to
 * its genesis fallback and printed the readings row as
 * **"To Be Cleaned -> Dry In"** — a claim that the filter was awaiting its first
 * clean, in the middle of its own drying step. Strictly worse than the
 * "DRY_IN -> DRY_IN" that null was chosen to avoid. Operator report 2026-09-04.
 *
 * The rule is applied at RENDER, not fixed at write: 289 live rows already
 * carry the null, `filter_events` is an immutable §11 record, and stage labels
 * in this codebase are display-only and inferred (see resolveStageCell).
 *
 * Returns STATE KEYS, not labels — each surface keeps its own label map — plus
 * the phase, which the caller appends to the "To" half:
 *
 *   duration submitted -> `Wash Out -> Dry In (Started)`
 *   temperature submitted -> `Dry In -> Dry In (Ended)`
 *
 * `(Started)` / `(Ended)` is what makes DRY_IN -> DRY_IN honest rather than
 * ambiguous: it says a dryer step was recorded, not that a stage move happened.
 *
 * Only ever fires on `toState === 'DRY_IN'`, so the 668 genuine genesis rows
 * (`null -> WASH_IN`) and the manual updates with no prior state keep reading
 * "To Be Cleaned".
 */
export type DryerPhase = 'started' | 'ended' | null;

export function transitionEndpoints(ev: any): { from: string | null; to: string | null; phase: DryerPhase } {
  const from: string | null = ev?.fromState ?? null;
  const to: string | null = ev?.toState ?? null;
  if (ev?.eventType !== 'STATE_TRANSITION' || to !== 'DRY_IN') return { from, to, phase: null };

  const attrs = ev?.attributes ?? {};
  // Checked FIRST: a start row never carries readings, so order is safe, and
  // `dryerDurationMinutes` catches rows written before `action` existed.
  // `from ?? 'DRY_IN'` covers re-setting the duration while already in DRY_IN —
  // isDryerInPlace persists null for that too.
  if (attrs.action === 'DRYER_STARTED' || attrs.dryerDurationMinutes != null) {
    return { from: from ?? 'DRY_IN', to, phase: 'started' };
  }

  // The `from === null || from === 'DRY_IN'` narrowing is load-bearing: plain
  // DRY_IN ENTRY exists (19 live rows arrive from WASH_OUT with no dryer
  // action), so a profile with instruments on DRY_IN entry would produce
  // readings on a REAL transition. That is a stage move, not a dryer step.
  // 13 legacy rows stored DRY_IN -> DRY_IN with readings and no action; they are
  // the same event and must read the same way.
  const readings = attrs.instrumentReadings;
  const hasReadings = Array.isArray(readings) && readings.length > 0;
  if (attrs.action === 'DRYER_READINGS_SUBMITTED' || (hasReadings && (from === null || from === 'DRY_IN'))) {
    return { from: 'DRY_IN', to: 'DRY_IN', phase: 'ended' };
  }

  return { from, to, phase: null };
}

/** " (Started)" / " (Ended)" — appended to the rendered "To" label. */
export function phaseSuffix(phase: DryerPhase): string {
  return phase === 'started' ? ' (Started)' : phase === 'ended' ? ' (Ended)' : '';
}
