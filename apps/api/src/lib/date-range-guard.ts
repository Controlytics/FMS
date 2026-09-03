import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Reject a date range whose end precedes its start (2026-08-27).
 *
 * The UI stopped allowing it the same day (`components/ui/date-range-filter.tsx`),
 * but the API happily accepted `from > to` and answered with an empty list — so
 * any direct client, saved URL or integration got "no records" that was
 * indistinguishable from "no matching records". That is exactly the class of
 * silent-wrong-answer this codebase treats as a bug.
 *
 * Implemented as ONE global hook rather than a check in each of the 13
 * range-accepting endpoints, so a route added tomorrow is covered without anyone
 * remembering to opt in.
 *
 * ## Why it only fires on values that parse as dates
 *
 * The hook cannot know that a given `from`/`to` pair is semantically a date
 * range — it matches on parameter NAME. Every current use is a date, but
 * rejecting anything that doesn't parse as one would turn this guard into a new
 * way for a future non-date `from`/`to` to break. So: if either side fails to
 * parse, the hook stays out of the way and leaves validation to the endpoint.
 *
 * ## The end-of-day rule, shared with the UI
 *
 * A bare `yyyy-mm-dd` end means "through the end of that day", matching
 * `listWhere` in super-admin/routes.ts and `inDateRange` in the console. Without
 * that, `from=2026-08-05&to=2026-08-05` — an ordinary single-day filter — would
 * be rejected as inverted, because the bare end parses to 00:00.
 */

/** Query parameter pairs that denote a range, in the spellings this API uses. */
export const DATE_RANGE_PARAM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['from', 'to'],
  ['startDate', 'endDate'],
  ['dateFrom', 'dateTo'],
];

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the END of a range, expanding a bare `yyyy-mm-dd` to the last
 * millisecond of that day.
 *
 * EXPORTED because the rule has to hold wherever an end date reaches a query,
 * not only inside this guard. An endpoint doing `lte: new Date(endDate)` on a
 * bare date silently drops the whole final day, so `to = today` returns nothing
 * from today — the exact silent-wrong-answer this guard exists to stop.
 * CLAUDE.md tracks the copies of this rule; call this instead of writing a new
 * one. (2026-09-03: notifications was the fourth copy.)
 *
 * Returns null when the value does not parse as a date — the caller decides
 * what that means.
 */
export function parseRangeEnd(value: string): Date | null {
  const d = new Date(BARE_DATE.test(value) ? `${value}T23:59:59.999` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Parse one end of a range. `isEnd` expands a bare date to the last millisecond
 * of that day.
 */
function parseEdge(value: string, isEnd: boolean): Date | null {
  if (isEnd) return parseRangeEnd(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface InvertedRange {
  startKey: string;
  endKey: string;
  start: string;
  end: string;
}

/**
 * Return the first inverted range found in `query`, or null when every range is
 * well-formed (or absent, or unparseable — see the note above).
 */
export function findInvertedRange(query: unknown): InvertedRange | null {
  if (!query || typeof query !== 'object') return null;
  const q = query as Record<string, unknown>;

  for (const [startKey, endKey] of DATE_RANGE_PARAM_PAIRS) {
    const rawStart = q[startKey];
    const rawEnd = q[endKey];
    if (typeof rawStart !== 'string' || typeof rawEnd !== 'string') continue;
    if (!rawStart || !rawEnd) continue; // an open-ended range is valid

    const start = parseEdge(rawStart, false);
    const end = parseEdge(rawEnd, true);
    if (!start || !end) continue; // not a date pair — not ours to judge

    if (start.getTime() > end.getTime()) {
      return { startKey, endKey, start: rawStart, end: rawEnd };
    }
  }
  return null;
}

/**
 * Fastify `preHandler`. Register once on the root instance, BEFORE the route
 * plugins, so every child route inherits it.
 */
export async function dateRangeGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const inverted = findInvertedRange(req.query);
  if (!inverted) return;
  reply.code(400).send({
    error: 'INVALID_DATE_RANGE',
    message: `"${inverted.endKey}" (${inverted.end}) is before "${inverted.startKey}" (${inverted.start}). An empty result would be indistinguishable from no matching records, so the request is rejected instead.`,
    details: inverted,
  });
}
