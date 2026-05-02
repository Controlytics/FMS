/**
 * Sync-Since Engine — Phase 8.4b (Option D, 2026-05-02).
 *
 * FE consumer of GET /api/sync/since. Reads the current versionState from
 * IDB, calls the endpoint, writes incoming rows into the v5 sync stores,
 * advances the cursor, and returns a summary. Caller (app-start, visibility
 * change, 60s poll) decides whether to retry on `hasMore`.
 *
 * Concurrency contract: one in-flight request at a time. A second call
 * while one is running short-circuits to the in-flight Promise. Debounce
 * is enforced at the wrapper layer (`triggerSync()` further below) so
 * rapid foreground/background events don't multiply work.
 */
import { apiClient } from './api-client';
import {
  cacheEntities,
  getVersionState,
  setVersionState,
  type VersionState,
  type SyncEntityStore,
} from './offline-store';

// Mirrors the server SyncSinceResponse but shaped for the client. Each
// entity is `any` because we pass through the additionalProperties payload
// verbatim — type narrowing happens at consumer sites.
export interface SyncSinceResponse {
  filterCleaningProfiles: any[];
  filterProfiles: any[];
  equipmentGroups: any[];
  checklistProfiles: any[];
  assetTemplates: any[];
  filters: any[];
  serverTimestamp: string;
  hasMore: boolean;
}

export interface SyncResult {
  rowsAdded: {
    filterCleaningProfiles: number;
    filterProfiles: number;
    equipmentGroups: number;
    checklistProfiles: number;
    assetTemplates: number;
    filters: number;
  };
  hasMore: boolean;
  /** Updated cursor after this run — what the FE will send next time. */
  versionState: VersionState;
  /** Server's idea of "now" at response time — useful for clock-skew debug. */
  serverTimestamp: string;
}

/**
 * Compute the maximum `version` across an array of rows. Returns `current`
 * (the existing cursor) if the array is empty, so the cursor never goes
 * backward when a sync returns no rows.
 */
function maxVersion(rows: any[], current: number): number {
  let max = current;
  for (const r of rows) {
    const v = typeof r?.version === 'number' ? r.version : 0;
    if (v > max) max = v;
  }
  return max;
}

/**
 * Compute the maximum updatedAt across the filter rows. The server returns
 * BOTH `updatedAt` (AssetInstance) AND `filterDetailsUpdatedAt` (sidecar);
 * either can be the most recent, so we max across both. ISO-8601 string
 * comparison is lexicographic-safe for UTC-Z timestamps.
 */
function maxUpdatedAt(filters: any[], current: string | null): string | null {
  let max = current;
  for (const f of filters) {
    const candidates = [f?.updatedAt, f?.filterDetailsUpdatedAt].filter(Boolean);
    for (const c of candidates) {
      const iso = c instanceof Date ? c.toISOString() : String(c);
      if (max === null || iso > max) max = iso;
    }
  }
  return max;
}

function buildQuery(s: VersionState): string {
  const params = new URLSearchParams();
  params.set('profileVersion', String(s.profileVersion));
  params.set('filterProfileVersion', String(s.filterProfileVersion));
  params.set('equipmentGroupVersion', String(s.equipmentGroupVersion));
  params.set('checklistVersion', String(s.checklistVersion));
  params.set('assetTemplateVersion', String(s.assetTemplateVersion));
  if (s.filterUpdatedSince) params.set('filterUpdatedSince', s.filterUpdatedSince);
  return params.toString();
}

let inFlight: Promise<SyncResult> | null = null;

/**
 * Run one sync round. Reads current versionState from IDB, calls the
 * endpoint, writes results, advances the cursor.
 *
 * If a sync is already in flight, returns the same Promise — guarantees no
 * concurrent IDB writes from racing visibility/poll triggers.
 */
export async function syncSince(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function doSync(): Promise<SyncResult> {
  const state = await getVersionState();
  const qs = buildQuery(state);
  const resp = await apiClient.get<SyncSinceResponse>(`/api/sync/since?${qs}`);

  // Defensive: server should always return all 6 arrays + flags, but treat
  // anything missing as empty so a malformed response doesn't crash.
  const fcp = resp.filterCleaningProfiles ?? [];
  const fp = resp.filterProfiles ?? [];
  const eg = resp.equipmentGroups ?? [];
  const cp = resp.checklistProfiles ?? [];
  const at = resp.assetTemplates ?? [];
  const filters = resp.filters ?? [];

  // Write each entity into its sync store. Order doesn't matter — different
  // stores, different transactions. cacheEntities is a no-op on empty arrays.
  await Promise.all([
    cacheEntities('syncFilterCleaningProfiles' as SyncEntityStore, fcp),
    cacheEntities('syncFilterProfiles' as SyncEntityStore, fp),
    cacheEntities('syncEquipmentGroups' as SyncEntityStore, eg),
    cacheEntities('syncChecklistProfiles' as SyncEntityStore, cp),
    cacheEntities('syncAssetTemplates' as SyncEntityStore, at),
    cacheEntities('syncFilters' as SyncEntityStore, filters),
  ]);

  // Advance cursors to the max version seen per entity. Filters use the
  // updatedAt watermark instead.
  const newState: VersionState = {
    key: 'current',
    profileVersion: maxVersion(fcp, state.profileVersion),
    filterProfileVersion: maxVersion(fp, state.filterProfileVersion),
    equipmentGroupVersion: maxVersion(eg, state.equipmentGroupVersion),
    checklistVersion: maxVersion(cp, state.checklistVersion),
    assetTemplateVersion: maxVersion(at, state.assetTemplateVersion),
    filterUpdatedSince: maxUpdatedAt(filters, state.filterUpdatedSince),
    lastSyncedAt: new Date().toISOString(),
  };
  await setVersionState(newState);

  return {
    rowsAdded: {
      filterCleaningProfiles: fcp.length,
      filterProfiles: fp.length,
      equipmentGroups: eg.length,
      checklistProfiles: cp.length,
      assetTemplates: at.length,
      filters: filters.length,
    },
    hasMore: !!resp.hasMore,
    versionState: newState,
    serverTimestamp: resp.serverTimestamp,
  };
}

// === Trigger wiring ===
//
// Debounced + throttled sync trigger. Multiple sites call triggerSync()
// (app start, visibility change, online event, 60s poll); we dedupe so:
//   - rapid bursts within DEBOUNCE_MS coalesce into one network call
//   - if a sync is already in flight, the burst is a no-op
// The 60s poll is a separate timer set up by `startSyncPolling()` which
// also routes through triggerSync().

const DEBOUNCE_MS = 1000;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncStarted = 0;

/**
 * Schedule a sync run. Coalesces calls within DEBOUNCE_MS. Safe to call
 * many times per second. Returns immediately; the actual sync is fire-
 * and-forget. Errors are swallowed (logged) — the next trigger will retry.
 */
export function triggerSync(reason: string = 'unspecified'): void {
  if (debounceTimer) return; // burst already pending
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    lastSyncStarted = Date.now();
    void syncSince().catch((err) => {
      // Don't surface to user — the next trigger (visibility, poll) will
      // retry. Surface only in the console for diagnostic purposes.
      // eslint-disable-next-line no-console
      console.warn(`[syncSince] failed (reason=${reason})`, err);
    });
  }, DEBOUNCE_MS);
}

let pollInterval: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;

/**
 * Wire up the recurring sync triggers:
 *   - 60-second polling timer (only fires when navigator.onLine)
 *   - visibilitychange handler (foreground -> trigger sync)
 *   - online event handler (network came back -> trigger sync)
 *
 * Idempotent — calling twice is safe; a second call short-circuits.
 * Returns a teardown function that removes all listeners (used by the
 * AppLayout effect's cleanup so logout/unmount cleans up correctly).
 */
export function startSyncPolling(): () => void {
  if (pollInterval || visibilityHandler || onlineHandler) {
    return () => stopSyncPolling();
  }
  // 60s online poll. Skip when offline — no point hitting a dead network.
  pollInterval = setInterval(() => {
    if (navigator.onLine) triggerSync('60s-poll');
  }, 60_000);
  // Foreground sync. visibilitychange fires when the tab/app comes back into
  // view — covers tablet wake-up, browser tab switch, OS app switch.
  visibilityHandler = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      triggerSync('visibility');
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);
  // Network-recovery sync. The `online` event fires when navigator.onLine
  // transitions false -> true; gives us a cursor advance the moment the
  // tablet reconnects after being offline.
  onlineHandler = () => triggerSync('online');
  window.addEventListener('online', onlineHandler);
  return () => stopSyncPolling();
}

export function stopSyncPolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (onlineHandler) {
    window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
  }
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
}

/** Internal — exposed for tests. Resets debounce + in-flight tracking. */
export function __resetSyncSinceForTest(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  inFlight = null;
  lastSyncStarted = 0;
}

/** Internal — exposed for tests. Reports if a sync is in-flight or pending. */
export function __isSyncBusyForTest(): boolean {
  return inFlight !== null || debounceTimer !== null;
}

/** Internal — exposed for diagnostic UIs (e.g. "Last synced X minutes ago"). */
export function lastSyncStartedAt(): number {
  return lastSyncStarted;
}
