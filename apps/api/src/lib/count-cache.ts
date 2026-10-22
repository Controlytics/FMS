/**
 * Reuse a list's COUNT while its filters stay the same (P-3, 2026-10-22).
 *
 * A paged list asks for its total on every page, and an unfiltered total over a
 * big table is the expensive part of the request: COUNT(*) over 6.2 M
 * filter_events took 0.5–2.7 s warm and 18 s cold at one year, for a page whose
 * rows come back in milliseconds. Turning pages (or re-polling) keeps the same
 * filters, so the count runs only when the filters change, or after `ttlMs`.
 * The total may lag by up to `ttlMs`; the rows returned never do (only the count
 * is cached). Same rule as the audit list's count (audit/routes.ts).
 */
export function createCountCache(ttlMs: number, maxEntries = 200) {
  const cache = new Map<string, { total: number; at: number }>();
  return async function cachedCount(key: unknown, count: () => Promise<number>): Promise<number> {
    const k = JSON.stringify(key);
    const hit = cache.get(k);
    if (hit && Date.now() - hit.at < ttlMs) return hit.total;
    const total = await count();
    if (cache.size >= maxEntries) cache.clear();
    cache.set(k, { total, at: Date.now() });
    return total;
  };
}
