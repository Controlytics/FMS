import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

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
 * ## The local-day rule, shared with the UI
 *
 * A bare `yyyy-mm-dd` range covers whole days in the SERVER's zone: the start is
 * local 00:00:00.000 (parseRangeStart), the end local 23:59:59.999
 * (parseRangeEnd), matching `inDateRange` / `asInstant` in the console, which do
 * the same in the browser's zone. Without the end rule,
 * `from=2026-08-05&to=2026-08-05` — an ordinary single-day filter — would be
 * rejected as inverted, because the bare end parses to 00:00.
 */

/** Query parameter pairs that denote a range, in the spellings this API uses. */
export const DATE_RANGE_PARAM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['from', 'to'],
  ['startDate', 'endDate'],
  ['dateFrom', 'dateTo'],
];

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse the START of a range, reading a bare `yyyy-mm-dd` as LOCAL midnight of
 * that day — the same day parseRangeEnd closes, in the server's zone. The pair
 * is the one rule for a range on a timestamp column; a `@db.Date` column also
 * needs toDateColumnDay.
 *
 * 2026-10-23: every caller did `new Date(start)`, which for a bare date is UTC
 * midnight. On the customer server (India, UTC+5:30) "from 1 Feb" then began at
 * 05:30, so records made between 00:00 and 05:30 on the first day (night-shift
 * cleanings) dropped out of filtered lists, reports and exports; west of UTC the
 * two ends overlapped and the guard passed a range inverted by one day.
 *
 * Returns null when the value does not parse as a date — the caller decides
 * what that means.
 */
export function parseRangeStart(value: string): Date | null {
  const d = new Date(BARE_DATE.test(value) ? `${value}T00:00:00.000` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * For a `@db.Date` column (PM planned dates — a calendar day with no time):
 * the server-local day `instant` falls on, as the UTC midnight that stands for
 * that day. Prisma compares a DATE column with the UTC date of the value it is
 * given (measured 2026-10-23), so a local instant must be mapped to its local
 * day first: local midnight of 1 Feb is 31 Jan 18:30 UTC in India, and a filter
 * "from 1 Feb" on planned dates listed 31 Jan's visits; west of UTC a bare "to
 * 1 Feb" took in 2 Feb. Use it on both ends, after parseRangeStart/End.
 */
export function toDateColumnDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()));
}

/**
 * Parse the END of a range, expanding a bare `yyyy-mm-dd` to the last
 * millisecond of that (local) day.
 *
 * EXPORTED because the rule has to hold wherever an end date reaches a query,
 * not only inside this guard. An endpoint doing `lte: new Date(endDate)` on a
 * bare date silently drops the whole final day, so `to = today` returns nothing
 * from today — the exact silent-wrong-answer this guard exists to stop.
 * CLAUDE.md tracks the copies of this rule; call this (and parseRangeStart for
 * the other end) instead of writing a new one. (2026-09-03: notifications was
 * the fourth copy.)
 *
 * Returns null when the value does not parse as a date — the caller decides
 * what that means.
 */
export function parseRangeEnd(value: string): Date | null {
  const d = new Date(BARE_DATE.test(value) ? `${value}T23:59:59.999` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * parseRangeStart / parseRangeEnd for a query site where an unparseable value is
 * the caller's mistake: a 400 INVALID_DATE naming the parameter, never an
 * Invalid Date handed to Prisma (a validation error → 500 + SYSTEM_ERROR
 * notification) or a bound that silently matches nothing.
 */
export function rangeStartOrThrow(value: string, param: string): Date {
  const d = parseRangeStart(value);
  if (!d) throw new AppError(400, 'INVALID_DATE', `"${param}" is not a valid date.`);
  return d;
}

export function rangeEndOrThrow(value: string, param: string): Date {
  const d = parseRangeEnd(value);
  if (!d) throw new AppError(400, 'INVALID_DATE', `"${param}" is not a valid date.`);
  return d;
}

/** Parse one end of a range: a bare date is the start or the end of that local day. */
function parseEdge(value: string, isEnd: boolean): Date | null {
  return isEnd ? parseRangeEnd(value) : parseRangeStart(value);
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
