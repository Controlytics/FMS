/**
 * Stage details for a cleaning-stage approval (2026-09-05, operator request).
 *
 * An approver deciding a WASH_OUT gate wants to see what the wash actually
 * recorded: when Wash In was done and by whom, the RO water / compressed air
 * pressures, the cleaning reason, and when Wash Out was done and by whom. For a
 * DRY_OUT gate: when the dryer was started, for how long, the temperature that
 * was submitted, when the dry-in ended, who did it, and the Dry Out done time
 * + user.
 *
 * None of that lives on `cleaning_stage_approvals`. The readings, times and
 * performers are on `filter_events` (see the cycle-columns note in CLAUDE.md)
 * and the reason / dryer duration on `cleaning_cycles`. It is DERIVED HERE AT
 * READ TIME rather than frozen into `detailsSnapshot`:
 *   - every historic approval gets the details, not only new ones;
 *   - a SUPER_ADMIN correction of an event (the audited console PUT) is
 *     reflected the next time the approver looks — a frozen copy would keep
 *     showing the value that was corrected;
 *   - `detailsSnapshot` keeps its one job: the filter's IDENTITY, frozen so the
 *     approver verifies the filter that was cleaned even if the hierarchy moves.
 *
 * `deriveStageDetails` is pure so the event-picking rules are unit-testable;
 * `collectStageDetails` is the thin DB layer that feeds it for a page of rows.
 */
import { prisma } from '../../lib/prisma.js';

export interface StageReading {
  description: string | null;
  value: number | null;
  uom: string | null;
  leastCount: number | null;
  outOfRange?: boolean;
}

export interface StageStep {
  /** performedAt of the event, ISO. */
  at: string | null;
  /** Username of the performer (the login id), or the 8-char uuid prefix when the user is gone. */
  by: string | null;
  readings: StageReading[];
}

export interface StageDetails {
  cleaningReason: string | null;
  /** Filled for a WASH_OUT approval. */
  washIn?: StageStep;
  washOut?: StageStep;
  /** Filled for a DRY_OUT approval. */
  dryIn?: {
    startedAt: string | null;
    startedBy: string | null;
    durationMinutes: number | null;
    endedAt: string | null;
    endedBy: string | null;
    /** The temperature (and any other DRY_IN instrument) submitted at half time. */
    readings: StageReading[];
  };
  dryOut?: StageStep;
}

/** The subset of a filter_events row the derivation reads. */
export interface StageEventLike {
  eventType: string;
  fromState: string | null;
  toState: string | null;
  performedBy: string | null;
  performedAt: Date | string;
  attributes: unknown;
}

export interface StageCycleLike {
  cleaningReasonLabel: string | null;
  dryerDurationMinutes: number | null;
  dryerStartedAt: Date | string | null;
}

/**
 * The event and the approval are written in ONE transaction; the event's
 * performedAt is stamped by the code a few ms before the row's DB `now()`, so
 * "at or before the request" needs a little slack. One minute also absorbs a
 * clock nudge from a SUPER_ADMIN time correction.
 */
const REQUEST_SLACK_MS = 60_000;

const toMs = (d: Date | string | null | undefined): number | null => {
  if (d == null) return null;
  const n = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return Number.isNaN(n) ? null : n;
};
const toIso = (d: Date | string | null | undefined): string | null => {
  const ms = toMs(d);
  return ms == null ? null : new Date(ms).toISOString();
};

function attrsOf(ev: StageEventLike): Record<string, any> {
  const a = ev.attributes;
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, any>) : {};
}

/** A reject writes `WASH_OUT -> WASH_IN` / `DRY_OUT -> DRY_IN` — that is not a wash or a dry. */
function isInterlockDecision(ev: StageEventLike): boolean {
  const kind = attrsOf(ev).kind;
  return typeof kind === 'string' && kind.startsWith('STAGE_INTERLOCK_');
}

function isTransition(ev: StageEventLike): boolean {
  return ev.eventType === 'STATE_TRANSITION' && !isInterlockDecision(ev);
}

/**
 * Dryer-phase discriminator — the same three traps the web's
 * `transitionEndpoints()` handles (see reference_dry_in_emits_two_transitions):
 * the started row is keyed on `action` OR the legacy `dryerDurationMinutes`
 * attribute; the ended row on `action` OR readings on a row whose from-state is
 * null / DRY_IN (a plain WASH_OUT -> DRY_IN entry with readings is a stage
 * move, not the temperature submission).
 */
type EventKind = 'WASH_IN' | 'WASH_OUT' | 'DRY_IN_STARTED' | 'DRY_IN_ENDED' | 'DRY_OUT';

export function classifyEvent(ev: StageEventLike): EventKind | null {
  if (!isTransition(ev)) return null;
  const to = ev.toState;
  if (to === 'WASH_IN') return 'WASH_IN';
  if (to === 'WASH_OUT') return 'WASH_OUT';
  if (to === 'DRY_OUT') return 'DRY_OUT';
  if (to !== 'DRY_IN') return null;
  const a = attrsOf(ev);
  if (a.action === 'DRYER_STARTED' || a.dryerDurationMinutes != null) return 'DRY_IN_STARTED';
  const readings = a.instrumentReadings;
  const hasReadings = Array.isArray(readings) && readings.length > 0;
  const from = ev.fromState ?? null;
  if (a.action === 'DRYER_READINGS_SUBMITTED' || (hasReadings && (from === null || from === 'DRY_IN'))) return 'DRY_IN_ENDED';
  return null;
}

function readingsOf(ev: StageEventLike | null): StageReading[] {
  if (!ev) return [];
  const raw = attrsOf(ev).instrumentReadings;
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => ({
    description: typeof r?.description === 'string' ? r.description : (typeof r?.instrumentCode === 'string' ? r.instrumentCode : null),
    value: typeof r?.value === 'number' ? r.value : (r?.value != null && Number.isFinite(Number(r.value)) ? Number(r.value) : null),
    uom: typeof r?.uom === 'string' ? r.uom : null,
    leastCount: typeof r?.leastCount === 'number' ? r.leastCount : null,
    ...(r?.outOfRange === true ? { outOfRange: true } : {}),
  }));
}

export type UserNameLookup = (userId: string | null) => string | null;

/**
 * Pick, for each kind, the LATEST matching event performed at or before the
 * approval was requested (+ slack). A rejected-and-redone cycle has two washes;
 * attempt 2's approval must describe attempt 2's wash, and attempt 1's archive
 * row must keep describing attempt 1's. When nothing precedes the request (a
 * time was corrected forwards, say) fall back to the latest event overall
 * rather than showing nothing.
 */
function pickLatest(events: StageEventLike[], kind: EventKind, requestedAtMs: number | null): StageEventLike | null {
  const matching = events
    .filter((e) => classifyEvent(e) === kind)
    .sort((a, b) => (toMs(a.performedAt) ?? 0) - (toMs(b.performedAt) ?? 0));
  if (matching.length === 0) return null;
  if (requestedAtMs == null) return matching[matching.length - 1];
  const before = matching.filter((e) => (toMs(e.performedAt) ?? 0) <= requestedAtMs + REQUEST_SLACK_MS);
  return before.length > 0 ? before[before.length - 1] : matching[matching.length - 1];
}

function step(ev: StageEventLike | null, userName: UserNameLookup): StageStep {
  return {
    at: ev ? toIso(ev.performedAt) : null,
    by: ev ? userName(ev.performedBy) : null,
    readings: readingsOf(ev),
  };
}

export function deriveStageDetails(params: {
  stageKey: string;
  requestedAt: Date | string | null;
  /** Who raised the approval — the fallback performer for the gated stage itself. */
  requestedByName: string | null;
  cycle: StageCycleLike | null;
  events: StageEventLike[];
  userName: UserNameLookup;
}): StageDetails {
  const { stageKey, cycle, events, userName } = params;
  const requestedAtMs = toMs(params.requestedAt);
  const out: StageDetails = { cleaningReason: cycle?.cleaningReasonLabel ?? null };

  if (stageKey === 'WASH_OUT') {
    out.washIn = step(pickLatest(events, 'WASH_IN', requestedAtMs), userName);
    const washOutEv = pickLatest(events, 'WASH_OUT', requestedAtMs);
    out.washOut = washOutEv
      ? step(washOutEv, userName)
      // The approval IS the record of the Wash Out being done — the row that
      // raised it was written in the same transaction as the event.
      : { at: toIso(params.requestedAt), by: params.requestedByName, readings: [] };
    return out;
  }

  if (stageKey === 'DRY_OUT') {
    const started = pickLatest(events, 'DRY_IN_STARTED', requestedAtMs);
    const ended = pickLatest(events, 'DRY_IN_ENDED', requestedAtMs);
    const startedAttrs = started ? attrsOf(started) : {};
    // Duration: the started event's own attribute first (the only source for an
    // earlier attempt or a legacy cycle), then the cycle row (the CURRENT run —
    // advance.ts persists both on SET_DURATION).
    const durationMinutes =
      typeof startedAttrs.dryerDurationMinutes === 'number' ? startedAttrs.dryerDurationMinutes
      : cycle?.dryerDurationMinutes ?? null;
    // Start time: the started event's performedAt, then the cycle row, and only
    // then the `dryerStartedAt` COPY inside the event's attributes. All three are
    // written equal, but only the first two are editable (SUPER_ADMIN event /
    // cycle PUTs) — the attribute copy is a third value nothing updates. Live
    // case: a back-dated cycle whose events were moved to 1 Sep kept a
    // 5 Sep attribute copy, so the card showed the dryer starting after Dry Out.
    const startedAt =
      (started ? toIso(started.performedAt) : null)
      ?? toIso(cycle?.dryerStartedAt ?? null)
      ?? (typeof startedAttrs.dryerStartedAt === 'string' ? toIso(startedAttrs.dryerStartedAt) : null);
    out.dryIn = {
      startedAt,
      startedBy: started ? userName(started.performedBy) : null,
      durationMinutes,
      endedAt: ended ? toIso(ended.performedAt) : null,
      endedBy: ended ? userName(ended.performedBy) : null,
      readings: readingsOf(ended),
    };
    const dryOutEv = pickLatest(events, 'DRY_OUT', requestedAtMs);
    out.dryOut = dryOutEv
      ? step(dryOutEv, userName)
      : { at: toIso(params.requestedAt), by: params.requestedByName, readings: [] };
    return out;
  }

  return out;
}

/**
 * DB layer: one query for the cycles, one for their transition events, one
 * for the performers — never per row. Returns a map approvalId -> details.
 * A row whose cycle is gone still gets `{ cleaningReason: null, ... }` so the
 * client never has to special-case a missing key.
 */
export async function collectStageDetails(
  rows: Array<{ id: string; cycleId: string | null; stageKey: string; requestedAt: Date; requestedByName: string | null }>,
): Promise<Map<string, StageDetails>> {
  const out = new Map<string, StageDetails>();
  if (rows.length === 0) return out;
  const cycleIds = [...new Set(rows.map((r) => r.cycleId).filter((x): x is string => !!x))];

  const [cycles, events] = await Promise.all([
    cycleIds.length
      ? prisma.cleaningCycle.findMany({
          where: { id: { in: cycleIds } },
          select: { id: true, cleaningReasonLabel: true, dryerDurationMinutes: true, dryerStartedAt: true },
        })
      : Promise.resolve([]),
    cycleIds.length
      ? prisma.filterEvent.findMany({
          where: { cycleId: { in: cycleIds }, eventType: 'STATE_TRANSITION' },
          orderBy: { performedAt: 'asc' },
          select: { cycleId: true, eventType: true, fromState: true, toState: true, performedBy: true, performedAt: true, attributes: true },
        })
      : Promise.resolve([]),
  ]);

  const performerIds = [...new Set(events.map((e) => e.performedBy).filter((x): x is string => !!x))];
  const users = performerIds.length
    ? await prisma.user.findMany({ where: { id: { in: performerIds } }, select: { id: true, username: true } })
    : [];
  const usernameById = new Map(users.map((u) => [u.id, u.username]));
  // Same fallback as the web's performerLabel(): most live events name a user
  // deleted in the 2026-08-19 wipe, and a stable 8-char id beats a blank.
  const userName: UserNameLookup = (id) => (id ? usernameById.get(id) ?? id.substring(0, 8) : null);

  const cycleById = new Map(cycles.map((c) => [c.id, c]));
  const eventsByCycle = new Map<string, StageEventLike[]>();
  for (const e of events) {
    if (!e.cycleId) continue;
    const list = eventsByCycle.get(e.cycleId) ?? [];
    list.push(e);
    eventsByCycle.set(e.cycleId, list);
  }

  for (const r of rows) {
    out.set(r.id, deriveStageDetails({
      stageKey: r.stageKey,
      requestedAt: r.requestedAt,
      requestedByName: r.requestedByName,
      cycle: r.cycleId ? cycleById.get(r.cycleId) ?? null : null,
      events: r.cycleId ? eventsByCycle.get(r.cycleId) ?? [] : [],
      userName,
    }));
  }
  return out;
}
