/**
 * The years a per-year endpoint must be asked for to cover a From/To date
 * range, and the bounds the rows are then filtered to (PM Schedules list).
 *
 * - A range that SPANS years fetches each one: deriving a single year from
 *   `dateFrom` dropped every entry in the later year(s) of a Dec→Feb range (M77).
 * - Years come from a string slice, never `new Date(dateFrom).getFullYear()`,
 *   which parses as UTC midnight and reports the previous year in any zone west
 *   of UTC.
 * - An EMPTIED end is open to the edge of the other end's year (D-OPS-4,
 *   2026-10-21): `Number('')` is 0, so an empty end used to request year 0 (or
 *   years 0..10) and the `d <= ''` comparison then hid every row. With both ends
 *   empty the range is `fallbackYear` (the page passes the current year).
 * - An inverted range keeps the From year only; a typo'd year (e.g. 20226) is
 *   capped at MAX_YEAR_SPAN extra years rather than fanning out into thousands
 *   of requests.
 */
export const MAX_YEAR_SPAN = 10;

export interface YearSpan {
  /** Every year to fetch, ascending. Never empty. */
  years: number[];
  /** Inclusive yyyy-mm-dd bounds to filter rows to (an emptied end filled in). */
  from: string;
  to: string;
}

export function yearSpan(dateFrom: string, dateTo: string, fallbackYear: number): YearSpan {
  const fromYear = dateFrom ? Number(dateFrom.slice(0, 4)) : NaN;
  const toYear = dateTo ? Number(dateTo.slice(0, 4)) : NaN;
  const firstYear = Number.isFinite(fromYear) ? fromYear : Number.isFinite(toYear) ? toYear : fallbackYear;
  const lastYear = Number.isFinite(toYear) ? toYear : firstYear;
  const span = lastYear < firstYear ? 0 : Math.min(lastYear - firstYear, MAX_YEAR_SPAN);
  return {
    years: Array.from({ length: span + 1 }, (_, i) => firstYear + i),
    from: dateFrom || `${firstYear}-01-01`,
    to: dateTo || `${lastYear}-12-31`,
  };
}
