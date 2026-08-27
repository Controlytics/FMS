import { apiClient } from './api-client';
import { cacheData, getCachedData, getCachedFilters } from './offline-store';
import type { PendingPmTask } from '@/components/pm-pending-tasks-dialog';

/**
 * Offline cache of "which AHUs still owe an earlier PM" (2026-08-27).
 *
 * The missed-PM dialog has to fire on the tablet whether or not there is a
 * network — the tablet is where an operator stands in front of the AHU, and
 * `start-cycle` is a queued offline op. Online, the server's 409 drives the
 * dialog. Offline, there is no 409 to react to, so the tablet answers the same
 * question from this cache and puts the operator's reasons into the queued
 * payload; the server accepts them on replay (start-cycle exempts offline
 * replay from re-asking).
 *
 * The cache is only ever a mirror of `GET /api/pm-schedules/pending-tasks-map`,
 * which is built by reusing the SAME `getPendingEarlierPmTasks` the gate uses —
 * so the offline answer and the online answer cannot disagree by construction.
 *
 * Staleness is acceptable and bounded in the safe direction:
 *   * a task resolved since the last refresh => the operator is asked about
 *     something already dealt with. The server ignores a skip for an entry that
 *     is no longer pending (`applyPmSkips` skips unknown ids), so nothing wrong
 *     is written.
 *   * a task that went overdue since the last refresh => no prompt offline, and
 *     the next ONLINE start catches it. The alternative — blocking cleaning
 *     because we cannot check — would stop real work over a bookkeeping gap.
 */

const CACHE_KEY = 'pm-pending-tasks-map';

export type PendingPmTasksMap = Record<string, PendingPmTask[]>;

/**
 * Pull the map and store it. Call while ONLINE, alongside the other offline
 * data warm-ups. Never throws — a failed refresh must not break a screen; it
 * just leaves the previous snapshot in place.
 */
export async function refreshPmPendingCache(): Promise<void> {
  try {
    const map = await apiClient.get<PendingPmTasksMap>('/api/pm-schedules/pending-tasks-map');
    await cacheData(CACHE_KEY, map ?? {});
  } catch {
    // Offline, or the user lacks PM_READ. Keep whatever we had.
  }
}

/** The cached map, or an empty one when nothing has been cached yet. */
export async function getCachedPmPendingMap(): Promise<PendingPmTasksMap> {
  return (await getCachedData<PendingPmTasksMap>(CACHE_KEY)) ?? {};
}

/**
 * Outstanding earlier PM visits for the AHU above `filterId`, from cache.
 *
 * Resolves the filter's AHU from the cached filter rows, so it works with no
 * network. Returns [] when the filter or its AHU is unknown — an unknown AHU
 * must not block cleaning.
 */
export async function getCachedPendingPmTasksForFilter(filterId: string): Promise<PendingPmTask[]> {
  const [map, filters] = await Promise.all([getCachedPmPendingMap(), getCachedFilters()]);
  if (Object.keys(map).length === 0) return [];
  const row = (filters as any[]).find((f) => f?.id === filterId);
  const ahuId = row?.ahuId ?? row?.parentId ?? null;
  if (!ahuId) return [];
  return map[ahuId] ?? [];
}

/**
 * Drop entries the operator has just written off, so a second scan in the same
 * offline session does not ask again. Mirrors the server clearing them.
 */
export async function forgetCachedPmTasks(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const map = await getCachedPmPendingMap();
  const gone = new Set(entryIds);
  const next: PendingPmTasksMap = {};
  for (const [ahuId, tasks] of Object.entries(map)) {
    const remaining = tasks.filter((t) => !gone.has(t.entryId));
    if (remaining.length > 0) next[ahuId] = remaining;
  }
  await cacheData(CACHE_KEY, next);
}
