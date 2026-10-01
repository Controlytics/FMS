/**
 * offlinePerformedAt validator — audit 2026-05-04 fix (api-supporting C2).
 *
 * The tablet's wall clock IS the source of truth for the timestamp on offline
 * actions — that's the entire point of offline operation: the audit trail must
 * record when the operator physically performed the action, not when the
 * server received the replay (which can be hours or days later).
 *
 * However, the prior implementation accepted ANY value the client sent. A
 * malicious or compromised client could:
 *   - back-date forged actions arbitrarily far in the past
 *   - forward-date actions to bypass time-bounded business rules
 *   - replay an action with an offlinePerformedAt that predates the cycle's
 *     own start time (logically impossible but accepted)
 *
 * Combined with the unauthenticated `x-offline-replay: true` header bypass
 * (api-core C1, api-supporting C1), this gave any authenticated party the
 * ability to forge audit records with arbitrary timestamps and have the
 * system accept them as authoritative.
 *
 * Constraints enforced here (all validations are CHEAP — pure date math):
 *   1. Future skew: max 5 minutes ahead of server clock (allows for tablet
 *      clock drift + replay latency, rejects deliberate forward-dating).
 *   2. Maximum staleness: 30 days. A tablet that has been offline for more
 *      than a month should not be silently accepted; operator should
 *      re-perform the action against current state.
 *   3. Cycle-start floor (where applicable): offlinePerformedAt cannot be
 *      earlier than the cycle's startedAt — checked by callers that have
 *      cycle context.
 *   4. Only accepted with the offline-replay header (the entire flow assumes
 *      this is a replay; without the header, the server records its own clock).
 *
 * `OfflineTimeError` carries a stable code so the FE can surface the right
 * remediation message.
 */

const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;            //  5 minutes
const MAX_STALENESS_MS = 30 * 24 * 60 * 60 * 1000;         // 30 days

export class OfflineTimeError extends Error {
  constructor(
    public readonly code:
      | 'OFFLINE_TIME_FUTURE'
      | 'OFFLINE_TIME_TOO_STALE'
      | 'OFFLINE_TIME_BEFORE_CYCLE'
      | 'OFFLINE_TIME_BEFORE_PREVIOUS_EVENT'
      | 'OFFLINE_TIME_INVALID'
      | 'OFFLINE_REPLAY_FIELDS_REQUIRED',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'OfflineTimeError';
  }
}

/**
 * Per-event floor tolerance (audit 2026-09-24 C-F10, closed 2026-09-25).
 *
 * A replayed op may not be stamped EARLIER than the latest event already on
 * its cycle — the queue replays in order, so a later op carrying an earlier
 * time is either a forged back-date or a tablet whose clock jumped. The
 * tolerance exists for the one honest case: the previous event was written
 * ONLINE with the SERVER clock and this one carries the TABLET clock. The two
 * clocks may disagree by the same drift the future-skew check already allows,
 * so the floor is `previousEventAt - FUTURE_SKEW_TOLERANCE_MS`, never the raw
 * previous time — a strict floor would strand a legitimately queued op behind
 * a five-minute clock difference.
 */
const PREVIOUS_EVENT_TOLERANCE_MS = FUTURE_SKEW_TOLERANCE_MS;

interface ValidateOptions {
  /** Must be true for offlinePerformedAt to be accepted. Online requests must
   * not pass a client-side timestamp. */
  isReplay: boolean;
  /** Lower bound from the cycle-write context (cycle.startedAt). When supplied,
   * offlinePerformedAt cannot be earlier than this. */
  cycleStartedAt?: Date | null;
  /** Lower bound from the cycle's latest event (performedAt of the last row on
   * the cycle). Applied with PREVIOUS_EVENT_TOLERANCE_MS of slack — see above. */
  previousEventAt?: Date | string | null;
  now?: Date; // injectable for tests
}

/**
 * Audit 2026-09-24 (design gap, closed 2026-09-25): the offline-replay grant
 * header proves the holder knew the password at issuance, NOT that the call
 * is a replay of work done offline. An online caller could attach it to an
 * ordinary `/api/filters/*` write and inherit every replay exemption (stage
 * interlock, AHU completion, block change, missed-PM, re-auth).
 *
 * Two things every genuine replay carries and an ordinary online call never
 * does: the tablet's `offlinePerformedAt` (the sync engine sets it on every
 * queued op and every tombstone) and the queue's `clientOpId`. A request that
 * presents the grant without BOTH is not a replay and is refused outright,
 * before any gate is evaluated. This does not make the header a proof of
 * offline-ness — a determined caller can fabricate both fields — but it
 * closes the "web page plus a header" path, and every gate a replay does skip
 * is now RECORDED on the event and its audit row (`replayExemptGates`) so the
 * bypass is visible to an inspector rather than silent.
 */
export function assertOfflineReplayPayload(
  isReplay: boolean,
  data: { offlinePerformedAt?: unknown; clientOpId?: unknown },
): void {
  if (!isReplay) return;
  const hasTime = typeof data.offlinePerformedAt === 'string' && data.offlinePerformedAt.trim() !== '';
  const hasOpId = typeof data.clientOpId === 'string' && data.clientOpId.trim() !== '';
  if (hasTime && hasOpId) return;
  throw new OfflineTimeError(
    'OFFLINE_REPLAY_FIELDS_REQUIRED',
    'An offline-replay request must carry offlinePerformedAt and clientOpId. Send the request without the replay grant header if this is online work.',
    { missing: [...(hasTime ? [] : ['offlinePerformedAt']), ...(hasOpId ? [] : ['clientOpId'])] },
  );
}

/**
 * Validate the operator-supplied offlinePerformedAt and return the Date.
 * Returns `undefined` if no value supplied (legitimate online path); throws
 * `OfflineTimeError` for any constraint violation.
 *
 * Caller responsibilities:
 *   - Pass `isReplay: true` only when the request actually carries the
 *     offline-replay header (so an online client can't forge a past time
 *     just by sending the field).
 *   - Pass `cycleStartedAt` for cycle-bound writes (advance, bypass,
 *     submit-checklist, terminate). start-cycle has no prior cycle so it
 *     omits this argument.
 */
export function validateOfflinePerformedAt(
  raw: string | undefined | null,
  opts: ValidateOptions,
): Date | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;

  // The Fastify schema declares `format: 'date-time'`, but defense-in-depth:
  // re-parse here in case a route is wired without the schema validator.
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) {
    throw new OfflineTimeError('OFFLINE_TIME_INVALID', 'offlinePerformedAt is not a valid date-time', { raw });
  }

  // 4. Online path: ignore client timestamp entirely (audit defends against
  //    replay-via-header-omission). Returning undefined causes the caller to
  //    fall through to default(now()) on the FilterEvent column.
  if (!opts.isReplay) return undefined;

  const now = opts.now ?? new Date();

  // 1. Future skew.
  if (t.getTime() > now.getTime() + FUTURE_SKEW_TOLERANCE_MS) {
    throw new OfflineTimeError(
      'OFFLINE_TIME_FUTURE',
      'offlinePerformedAt is in the future beyond clock-drift tolerance',
      { raw, now: now.toISOString(), toleranceMs: FUTURE_SKEW_TOLERANCE_MS },
    );
  }

  // 2. Staleness ceiling.
  if (now.getTime() - t.getTime() > MAX_STALENESS_MS) {
    throw new OfflineTimeError(
      'OFFLINE_TIME_TOO_STALE',
      'offlinePerformedAt is older than the maximum offline-replay window',
      { raw, now: now.toISOString(), maxStalenessMs: MAX_STALENESS_MS },
    );
  }

  // 3. Cycle-start floor.
  if (opts.cycleStartedAt && t.getTime() < opts.cycleStartedAt.getTime()) {
    throw new OfflineTimeError(
      'OFFLINE_TIME_BEFORE_CYCLE',
      'offlinePerformedAt cannot be earlier than the cycle start time',
      { raw, cycleStartedAt: opts.cycleStartedAt.toISOString() },
    );
  }

  // 5. Per-event floor (C-F10): not earlier than the cycle's latest event,
  //    less the clock-drift tolerance (see PREVIOUS_EVENT_TOLERANCE_MS).
  if (opts.previousEventAt) {
    const prev = opts.previousEventAt instanceof Date ? opts.previousEventAt : new Date(opts.previousEventAt);
    if (!Number.isNaN(prev.getTime()) && t.getTime() < prev.getTime() - PREVIOUS_EVENT_TOLERANCE_MS) {
      throw new OfflineTimeError(
        'OFFLINE_TIME_BEFORE_PREVIOUS_EVENT',
        'offlinePerformedAt is earlier than the latest recorded event on this cleaning cycle',
        { raw, previousEventAt: prev.toISOString(), toleranceMs: PREVIOUS_EVENT_TOLERANCE_MS },
      );
    }
  }

  return t;
}

/** performedAt of the latest event in a cycle's event list (or null when empty). */
export function latestEventAt(events: ReadonlyArray<{ performedAt: Date | string }>): Date | null {
  let max: Date | null = null;
  for (const e of events) {
    const d = e.performedAt instanceof Date ? e.performedAt : new Date(e.performedAt);
    if (Number.isNaN(d.getTime())) continue;
    if (!max || d.getTime() > max.getTime()) max = d;
  }
  return max;
}

// `validateOfflinePerformedAtFromHeaders` was deleted 2026-05-13. It read
// `headers['x-offline-replay'] === 'true'` directly — exactly the bypass
// shape that audit fix C1 replaced with HMAC-signed grants verified at the
// auth-plugin layer (`req.offlineReplayVerified`). Zero callers at delete
// time. Leaving the function in the codebase as a footgun: the next
// contributor to reach for "validate-from-headers" would silently
// re-introduce the bypass that C1 closed. Callers should derive `isReplay`
// from `req.offlineReplayVerified` (set by the auth plugin only when the
// HMAC grant validates) and pass it into `validateOfflinePerformedAt`
// directly — the cycle-write impls already do this.
