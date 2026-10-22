/**
 * "10,000+" list totals (operator decision 2026-10-22).
 *
 * A paged list asks for its total on every page, and an exact COUNT over a big
 * table is the expensive part of the request: 68–73 s cold over the 7.4 M-row
 * audit trail at one year, 17 s over 6.2 M filter_events, for a page whose rows
 * come back in milliseconds. Counting stops at the cap instead
 * (`COUNT(*) FROM (… LIMIT cap+1)`, 171 ms / 80 ms on the same tables): past it
 * the list answers `total: cap, totalCapped: true` and the page shows
 * "10,000+ records". Below the cap the total is exact.
 *
 * An export must know the real size (to refuse one over the export limit), so
 * it asks for an exact count instead — see `exactTotal` on GET /api/audit.
 */
export const LIST_TOTAL_CAP = 10_000;

export interface CappedTotal {
  total: number;
  totalCapped: boolean;
}

/** `count(take)` must count at most `take` rows (Prisma: `model.count({ where, take })`). */
export async function cappedCount(count: (take: number) => Promise<number>, cap = LIST_TOTAL_CAP): Promise<CappedTotal> {
  const n = await count(cap + 1);
  return n > cap ? { total: cap, totalCapped: true } : { total: n, totalCapped: false };
}

/**
 * Pages the pager may offer. Exact totals: ceil(total / limit). Capped: the
 * real end is unknown, so one page beyond the current one while it is full —
 * the pager walks on until a short page.
 */
export function cappedTotalPages(t: CappedTotal, page: number, limit: number, rowsOnPage: number): number {
  const pages = Math.ceil(t.total / limit);
  return t.totalCapped ? Math.max(pages, page + (rowsOnPage >= limit ? 1 : 0)) : pages;
}
