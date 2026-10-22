/**
 * The Filter Lifecycle report's reads of one filter's history
 * (cleaning-cycles/filter-lifecycle.tsx), kept out of the page so they are
 * tested as the code that runs (2026-10-22).
 *
 * Each read pages until an empty page or the server's total, with no page cap
 * (operator decision 2026-09-04: no record caps). They used to stop after 100
 * pages of 100, so a filter with more than 10,000 cycles or manual changes was
 * reported short with no word.
 */
import { api } from './api-client';

export const LIFECYCLE_PAGE_SIZE = 100;

export interface LifecyclePage {
  data?: any[];
  total?: number;
}

/** GET for one URL; the page passes nothing and gets the app's API client. */
export type LifecycleGet = (url: string) => Promise<LifecyclePage | null | undefined>;

const apiGet: LifecycleGet = (url) => api.get<LifecyclePage>(url);

/** Every row of a paged list. A server that omits `total` is taken at its word: what it sent is all there is. */
export async function readAllPages(fetchPage: (page: number) => Promise<LifecyclePage | null | undefined>): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; ; page++) {
    const res = await fetchPage(page);
    const batch = res?.data ?? [];
    all.push(...batch);
    const total = res?.total ?? all.length;
    if (batch.length === 0 || all.length >= total) break;
  }
  return all;
}

function filterPageUrl(path: string, filterId: string, fromIso: string, toIso: string, page: number): string {
  const u = new URLSearchParams({ filterId, page: String(page), limit: String(LIFECYCLE_PAGE_SIZE) });
  if (fromIso) u.set('from', fromIso);
  if (toIso) u.set('to', toIso);
  return `${path}?${u.toString()}`;
}

/** Every cycle summary of one filter, period-bounded when from/to are given. */
export function fetchAllCycleSummaries(filterId: string, fromIso: string, toIso: string, get: LifecycleGet = apiGet): Promise<any[]> {
  return readAllPages((page) => get(filterPageUrl('/api/filters/cycles', filterId, fromIso, toIso, page)));
}

/**
 * Every manual status change of one filter (cycleId=null STATE_TRANSITIONs).
 * These don't belong to a cleaning cycle, so the report shows them in their own
 * section — otherwise a manually-moved filter looks like it has no history.
 */
export function fetchManualChanges(filterId: string, fromIso: string, toIso: string, get: LifecycleGet = apiGet): Promise<any[]> {
  return readAllPages((page) => get(filterPageUrl('/api/filters/manual-status-changes', filterId, fromIso, toIso, page)));
}
