/**
 * Sync Engine — Replays queued offline operations when back online.
 *
 * Order on each tick:
 *   1. Refresh JWT (so an 8h-expired token doesn't 401 the whole batch)
 *   2. Drain tombstones (deletes/terminations first — keeps audit consistent)
 *   3. Drain queued mutations (FIFO)
 *   4. Compact synced operations older than retention window
 *
 * Every replayed call carries:
 *   - x-offline-replay-token: <jwt>     (HMAC-signed grant — replaces the
 *                                       2026-05-04 audit C1 boolean header
 *                                       bypass; obtained via
 *                                       POST /api/auth/offline-grant after a
 *                                       password challenge at login)
 *   - x-client-op-id: <uuid>            (idempotency key — backend dedups)
 *   - body.offlinePerformedAt           (preserves real action time in audit;
 *                                       server validates per audit C2 — see
 *                                       apps/api/src/lib/offline-time-window.ts)
 */
import { apiClient } from './api-client';
import {
  getPendingOperations,
  updateOperationStatus,
  clearSyncedOperations,
  getPendingTombstones,
  updateTombstoneStatus,
  clearSyncedTombstones,
  compactSyncedOperations,
  evictLruCache,
} from './offline-store';
import { onConnectivityChange } from './connectivity';
import {
  SYNC_AUTO_INTERVAL_MS,
  SYNC_AFTER_ONLINE_DELAY_MS,
  SYNC_AFTER_VISIBILITY_DELAY_MS,
  SYNC_INITIAL_DELAY_MS,
} from './timing-constants';

/**
 * Audit 2026-05-04 fix C1: read the offline-replay grant token from session
 * (or backup in localStorage if the tab was reloaded) and shape it as a
 * header object spread by every replay call. Returns {} if no token (or
 * the token is expired), in which case the backend rejects with
 * REAUTH_REQUIRED — operator must re-login to mint a fresh grant.
 *
 * Deep-review fix (2026-05-13): the grant's `expiresAt` was being persisted
 * by use-auth.ts:92,94 but never read here. Sending an expired token
 * produced a noisy `OFFLINE_REPLAY_TOKEN_EXPIRED` server-side 401 with no
 * client-side cleanup — every subsequent request would keep re-sending the
 * dead token and getting rejected. Now we validate the expiry before
 * sending: if missing/in-the-past (with a 60s safety buffer for in-flight
 * races), we clear the stale storage entries AND return {} so the server
 * routes through the REAUTH_REQUIRED path. Same loud failure mode as
 * "never had a grant," but now WITHOUT spamming dead tokens on every retry.
 */
const REPLAY_GRANT_EXPIRY_BUFFER_MS = 60_000;

function getOfflineReplayHeader(): Record<string, string> {
  const token = sessionStorage.getItem('offline_replay_token')
    || localStorage.getItem('offline_replay_token_backup');
  if (!token) return {};

  const expiresAt = sessionStorage.getItem('offline_replay_expires')
    || localStorage.getItem('offline_replay_expires_backup');
  if (expiresAt) {
    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs - REPLAY_GRANT_EXPIRY_BUFFER_MS <= Date.now()) {
      // eslint-disable-next-line no-console -- intentional structured log
      console.warn(
        '[sync-engine] offline-replay grant expired at',
        expiresAt,
        '— clearing storage; operator must re-login to mint a fresh grant',
      );
      sessionStorage.removeItem('offline_replay_token');
      sessionStorage.removeItem('offline_replay_expires');
      localStorage.removeItem('offline_replay_token_backup');
      localStorage.removeItem('offline_replay_expires_backup');
      return {};
    }
  }

  return { 'x-offline-replay-token': token };
}

/**
 * Sync stage taxonomy (W5 — offline-safety series). The ribbon (W6) consumes
 * these to show what the engine is currently doing. Stages are emitted as
 * `{ type: 'stage', stage: <name>, message?, current?, total? }` events so a
 * subscriber listening for legacy types (start/progress/complete) ignores
 * them naturally.
 *
 *   token-refresh    JWT refresh before the drain. Brief.
 *   tombstone-drain  Sending queued deletions (block-change cancels, cycle
 *                    terminates) ahead of regular ops.
 *   sending-ops      Replaying queued cycle writes one by one. Includes
 *                    `current` (1-indexed) and `total`.
 *   fetching-snapshot Post-drain refresh of canonical server state via the
 *                    sync-since polling layer; emitted by sync-since.ts after
 *                    each successful versioned fetch.
 *   idle             Default state when no sync is in flight.
 */
export type SyncStage =
  | 'token-refresh'
  | 'tombstone-drain'
  | 'sending-ops'
  | 'fetching-snapshot'
  | 'idle';

export type SyncEvent =
  | { type: 'start'; total?: number; synced?: number; error?: string }
  | { type: 'progress'; synced?: number; total?: number; error?: string }
  | { type: 'complete'; synced?: number; total?: number; error?: string }
  | { type: 'error'; synced?: number; total?: number; error?: string }
  | { type: 'interrupted'; synced?: number; total?: number; error?: string }
  | { type: 'stage'; stage: SyncStage; message?: string; current?: number; total?: number };

type SyncListener = (event: SyncEvent) => void;

const MAX_RETRIES = 5;

let syncing = false;
const listeners: Set<SyncListener> = new Set();

export function onSyncEvent(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(event: SyncEvent) {
  listeners.forEach(l => l(event));
}

/**
 * Emit a stage event. Thin helper so call sites don't have to repeat the
 * `{ type: 'stage', stage }` boilerplate.
 */
function notifyStage(stage: SyncStage, extras?: { message?: string; current?: number; total?: number }) {
  notify({ type: 'stage', stage, ...extras });
}

/**
 * Exported wrapper of `notifyStage` so the versioned-cache sync layer
 * (sync-since.ts) can emit `fetching-snapshot` ribbon events without having
 * its own listener set. Single ribbon listens to one stream.
 */
export function emitSyncStage(stage: SyncStage, extras?: { message?: string; current?: number; total?: number }) {
  notifyStage(stage, extras);
}

/**
 * Execute a single queued operation.
 * Sends x-offline-replay header so the backend skips re-authentication.
 * For 'start-and-advance' compound ops: runs start-cycle first, then advance.
 */
/**
 * Phase 5b B2: pre-replay cycle status check.
 *
 * For operations that require an active IN_PROGRESS cycle (advance, bypass,
 * submit-checklist, terminate), verify the cycle is still alive before we
 * replay. Catches the case where another user terminated/bypassed the cycle
 * while this tablet was offline. Without this check, the replay would land
 * a confusing `400 NO_CYCLE` and the queue would either retry forever or
 * mark as failed without context.
 */
const CYCLE_BOUND_OPS = new Set(['advance', 'bypass', 'submit-checklist', 'terminate']);

async function ensureCycleAlive(filterId: string, opType: string): Promise<void> {
  if (!CYCLE_BOUND_OPS.has(opType)) return;
  let state: any;
  try {
    state = await apiClient.get<any>(`/api/filters/${filterId}/current-state`);
  } catch (e: any) {
    // If the current-state fetch itself fails (e.g. 404 filter retired), let the
    // replay proceed and surface the underlying error from there.
    return;
  }
  if (state?.currentCycle == null) {
    const err: any = new Error(`Cycle is no longer active for this filter — operation cannot be replayed`);
    err.code = 'CYCLE_ENDED';
    err.stranded = true;
    throw err;
  }
}

async function executeOperation(op: { type: string; filterId: string; payload: Record<string, any>; createdAt: string; clientOpId?: string; tapeVersion?: number | null }): Promise<void> {
  // Pre-replay guard: cycle-bound ops require the cycle to still be IN_PROGRESS.
  await ensureCycleAlive(op.filterId, op.type);

  // x-client-op-id makes replay idempotent — backend stores it on FilterEvent.attributes
  // and returns the cached response if the same id arrives twice. For start-and-advance
  // we suffix to differentiate the two underlying mutations.
  const headers: Record<string, string> = {
    ...getOfflineReplayHeader(),
    ...(op.clientOpId ? { 'x-client-op-id': op.clientOpId } : {}),
  };
  const offlineTime = op.createdAt;
  // Phase 8.7 (Wave 2 — server commit f8fae1d): cycle-bound POSTs now REQUIRE
  // tapeVersion in the body. New queued ops (post-Wave 2 cutover) carry the
  // tapeVersion captured at queue time via use-offline.ts:executeOrQueue.
  // Pre-8.3 IDB rows still on disk have tapeVersion=null and will fail with
  // 400 SCHEMA_ERROR on replay — that's an acceptable migration cost (the
  // op is marked failed and the operator must re-perform the action against
  // a fresh /current-state). start-cycle and start-and-advance's start step
  // are NOT cycle-bound writes, so we omit tapeVersion on those.
  const cycleBoundForVersion = CYCLE_BOUND_OPS.has(op.type);
  const tapeVersion = cycleBoundForVersion && op.tapeVersion !== null && op.tapeVersion !== undefined
    ? { tapeVersion: op.tapeVersion }
    : {};

  if (op.type === 'start-and-advance') {
    const { cyclePayload, advancePayload } = op.payload as { cyclePayload: Record<string, any>; advancePayload: Record<string, any> };
    try {
      await apiClient.post(
        `/api/filters/${op.filterId}/start-cycle`,
        { ...cyclePayload, offlinePerformedAt: offlineTime, clientOpId: op.clientOpId ? `${op.clientOpId}:start` : undefined },
        { ...headers, ...(op.clientOpId ? { 'x-client-op-id': `${op.clientOpId}:start` } : {}) },
      );
    } catch (e: any) {
      const code = e?.code || e?.error || '';
      // CYCLE_ACTIVE is a benign race — start succeeded earlier, just continue with advance
      if (code !== 'CYCLE_ACTIVE') throw e;
    }
    // Phase 8.7 cutover (Wave 2 — server commit f8fae1d): /advance now
    // requires `tapeVersion`. The op row's stored tapeVersion (if any) is
    // pre-start-cycle and meaningless. Fetch the freshly-derived tapeVersion
    // via /current-state and include it on the advance leg. Self-sufficient
    // — no need to thread the field through the queue row for compound ops.
    let saTapeVersion: number | undefined;
    try {
      const fresh = await apiClient.get<any>(`/api/filters/${op.filterId}/current-state`);
      if (typeof fresh?.tapeVersion === 'number') saTapeVersion = fresh.tapeVersion;
    } catch { /* fall through; advance will surface the 400 */ }
    const advanceBody = saTapeVersion !== undefined
      ? { ...advancePayload, tapeVersion: saTapeVersion, offlinePerformedAt: offlineTime, clientOpId: op.clientOpId ? `${op.clientOpId}:advance` : undefined }
      : { ...advancePayload, offlinePerformedAt: offlineTime, clientOpId: op.clientOpId ? `${op.clientOpId}:advance` : undefined };
    await apiClient.post(
      `/api/filters/${op.filterId}/advance`,
      advanceBody,
      { ...headers, ...(op.clientOpId ? { 'x-client-op-id': `${op.clientOpId}:advance` } : {}) },
    );
    return;
  }

  const url = op.type === 'terminate'
    ? `/api/filters/${op.filterId}/terminate-cycle`
    : `/api/filters/${op.filterId}/${op.type}`;

  await apiClient.post(url, { ...op.payload, ...tapeVersion, offlinePerformedAt: offlineTime, clientOpId: op.clientOpId }, headers);
}

/**
 * Drain tombstones (deletes/terminations queued offline) before mutations.
 * Doing this first keeps audit history consistent — e.g. terminate-then-restart
 * is replayed in the right order.
 */
async function syncTombstones(): Promise<void> {
  let pending: any[];
  try { pending = await getPendingTombstones(); } catch { return; }
  if (pending.length === 0) return;

  for (const t of pending) {
    try {
      await updateTombstoneStatus(t.id, 'syncing');
      const headers: Record<string, string> = {
        ...getOfflineReplayHeader(),
        'x-client-op-id': t.clientOpId,
      };
      if (t.entityType === 'cycle') {
        // Phase 8.7 follow-up (2026-05-03): two corrections to the cycle
        // tombstone replay body.
        //   1. Field name: server schema requires `justification` (minLength
        //      10), not `reason`. Pre-fix tombstones would 400 SCHEMA_ERROR
        //      on the missing required property regardless of tape state.
        //      We accept both `payload.justification` and the legacy
        //      `payload.reason` for any pre-existing on-disk rows queued
        //      before this fix; the default 'Offline terminate' is 16
        //      chars, satisfying the minLength constraint.
        //   2. tapeVersion: server route now REQUIRES this field (commit
        //      f8fae1d). Forward when the tombstone captured one at queue
        //      time; omit the body field entirely when null/undefined so
        //      the request still parses (the 8.3 backward-compat window
        //      treated missing tapeVersion as no-check; under 8.7 the
        //      server schema rejects with 400 SCHEMA_ERROR — that is an
        //      acceptable migration cost for tombstones queued without
        //      tape capture, identical to the operations-store policy).
        const justification = t.payload?.justification ?? t.payload?.reason ?? 'Offline terminate';
        const tapeVersionField = t.tapeVersion !== null && t.tapeVersion !== undefined
          ? { tapeVersion: t.tapeVersion }
          : {};
        await apiClient.post(
          `/api/filters/${t.payload?.filterId ?? ''}/terminate-cycle`,
          { justification, ...tapeVersionField, clientOpId: t.clientOpId },
          headers,
        );
      } else if (t.entityType === 'block-change-request') {
        await apiClient.delete(`/api/block-change-requests/${t.entityId}`);
      }
      await updateTombstoneStatus(t.id, 'synced');
    } catch (e: any) {
      const errMsg = e?.message ?? e?.error ?? 'Tombstone sync failed';
      await updateTombstoneStatus(t.id, t.retryCount >= MAX_RETRIES - 1 ? 'failed' : 'pending', errMsg);
    }
  }
  await clearSyncedTombstones().catch(() => {});
}

/**
 * Refresh JWT before draining the queue. Long offline sessions can outlast
 * the 8h token, which would 401 every queued op. If refresh itself 401s,
 * keep the queue intact and surface the error so the UI can prompt re-login.
 *
 * Audit 2026-05-04 fix #4 (web-plumbing review H — JWT refresh fragmentation):
 * delegates to apiClient.refreshToken() so all three former refresh sites
 * (use-auth interval, this pre-sync hook, any future on-401 retry) share a
 * single in-flight Promise — concurrent callers don't double-fire and the
 * call always reaches the API host (relative-URL fetch was a no-op on
 * Capacitor APK). Pass-through wrapper keeps the existing `{ok, error}`
 * shape that syncPendingOperations expects.
 */
async function refreshTokenBeforeSync(): Promise<{ ok: boolean; error?: string }> {
  const token = sessionStorage.getItem('access_token') || localStorage.getItem('access_token_backup');
  if (!token) return { ok: false, error: 'No token in storage' };
  const ok = await apiClient.refreshToken();
  return ok ? { ok: true } : { ok: false, error: 'Token refresh failed' };
}

export async function syncPendingOperations(): Promise<{ synced: number; failed: number }> {
  if (syncing) return { synced: 0, failed: 0 };

  let pending: any[];
  try {
    pending = await getPendingOperations();
  } catch {
    return { synced: 0, failed: 0 };
  }
  if (pending.length === 0) return { synced: 0, failed: 0 };

  // Quick connectivity test before draining the queue. On the APK, every
  // fetch() (here and inside apiClient) is routed through CapacitorHttp
  // automatically because `capacitor.config.ts` has `CapacitorHttp.enabled:
  // true` — that patches global fetch at WebView startup. So apiClient has
  // no special TLS handling; it inherits CapacitorHttp the same way a raw
  // fetch in connectivity.ts does.
  try {
    await apiClient.get('/api/health');
  } catch {
    // Server not reachable — skip sync
    return { synced: 0, failed: 0 };
  }

  // Refresh JWT before draining — long offline sessions can outlive the 8h token.
  // If refresh fails with anything other than network error, surface and bail.
  notifyStage('token-refresh');
  const refresh = await refreshTokenBeforeSync();
  if (!refresh.ok) {
    notifyStage('idle');
    notify({ type: 'error', error: `Token refresh failed: ${refresh.error}. Re-login required to sync.` });
    return { synced: 0, failed: 0 };
  }

  // Drain tombstones first so deletes apply before any mutation that follows
  notifyStage('tombstone-drain');
  await syncTombstones();

  syncing = true;
  notifyStage('sending-ops', { current: 0, total: pending.length });
  notify({ type: 'start', total: pending.length });

  let synced = 0;
  let failed = 0;

  // Phase 8.4 I-3: dedupe STALE_TAPE per filter per drain.
  //   - First STALE_TAPE for a filter: emit one toast, then short-circuit
  //     every other queued op for the same filterId by marking them failed
  //     immediately without hitting the network. They would all fail with
  //     the same currentTapeVersion mismatch, so spamming the network and
  //     the toast list is wasted work.
  //   - Subsequent STALE_TAPE errors for filters already in the set: still
  //     mark op failed but suppress the toast.
  const staleTapeFiltersThisDrain = new Set<string>();

  for (const op of pending) {
    // Short-circuit: if a previous op for this filter already STALE_TAPE'd,
    // every further cycle-bound op for the same filter is doomed to the
    // same fate. Mark failed without an HTTP round-trip and without a
    // duplicate toast.
    if (op.filterId && staleTapeFiltersThisDrain.has(op.filterId)) {
      await updateOperationStatus(
        op.id,
        'failed',
        `Stale tape: another operator changed this cycle. Refresh and retry. (skipped — earlier op for the same filter already STALE_TAPE'd)`,
      );
      failed++;
      continue;
    }
    try {
      await updateOperationStatus(op.id, 'syncing');
      notifyStage('sending-ops', { current: synced + 1, total: pending.length, message: op.filterName });
      await executeOperation(op);
      await updateOperationStatus(op.id, 'synced');
      synced++;
      notify({ type: 'progress', synced, total: pending.length });
    } catch (e: any) {
      // Extract error message — apiClient throws plain objects for API errors
      const errMsg = e?.message ?? e?.error ?? 'Sync failed';
      const msg = String(errMsg).toLowerCase();

      // Network error: server went away mid-sync, stop trying
      const isNetErr = msg.includes('fetch') || msg.includes('network')
        || msg.includes('econnrefused') || msg.includes('load failed')
        || msg.includes('abort');
      if (isNetErr) {
        await updateOperationStatus(op.id, 'pending', errMsg);
        failed++;
        notify({ type: 'interrupted', error: 'Sync interrupted — will retry in 30s' });
        break;
      }

      // Phase B2: stranded ops (cycle ended on server) — mark failed immediately,
      // don't retry. The user has to reconcile manually (cycle is gone).
      if (e?.stranded || e?.code === 'CYCLE_ENDED') {
        await updateOperationStatus(op.id, 'failed', `Cycle ended before this operation could sync: ${errMsg}`);
        failed++;
        notify({ type: 'error', error: `${op.filterName}: cycle ended before sync — operation discarded` });
        continue;
      }

      // Phase 8.3: stale tape — another operator changed the cycle while
      // this op sat queued. Retrying with the same stored tapeVersion will
      // just keep failing, so drop the op and surface a refresh-prompt
      // toast. The fresh state arrives on the next /current-state fetch.
      //
      // Phase 8.4 I-3: emit ONE toast per filter per drain. Mark every
      // subsequent op for the same filter as failed without spamming.
      if (e?.code === 'STALE_TAPE') {
        const isFirstStaleForFilter = !!op.filterId && !staleTapeFiltersThisDrain.has(op.filterId);
        if (op.filterId) staleTapeFiltersThisDrain.add(op.filterId);
        await updateOperationStatus(op.id, 'failed', `Stale tape: another operator changed this cycle. Refresh and retry. (${errMsg})`);
        failed++;
        if (isFirstStaleForFilter) {
          notify({ type: 'error', error: `${op.filterName}: another operator changed this cycle. Refreshing...` });
        }
        continue;
      }

      // API error: retry up to MAX_RETRIES, then mark as permanently failed
      await updateOperationStatus(op.id, op.retryCount >= MAX_RETRIES - 1 ? 'failed' : 'pending', errMsg);
      failed++;
      notify({ type: 'error', error: `${op.filterName}: ${errMsg}` });
    }
  }

  await clearSyncedOperations().catch(() => {});
  // Periodic compaction + LRU eviction — keeps IndexedDB from growing unbounded
  await compactSyncedOperations().catch(() => {});
  await evictLruCache().catch(() => {});
  // Note: don't wipe filter-state caches here. Next /current-state fetch from the
  // UI will overwrite the cache with fresh server data; blanket clearing breaks
  // users who go offline again before that fetch happens.

  syncing = false;
  notifyStage('idle');
  notify({ type: 'complete', synced, total: pending.length });

  return { synced, failed };
}

// Auto-sync: online event + periodic retry + visibilitychange
let cleanup: (() => void) | null = null;
let retryInterval: ReturnType<typeof setInterval> | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

const scheduleSync = (delayMs: number) => {
  const t = setTimeout(() => {
    pendingTimers.delete(t);
    syncPendingOperations();
  }, delayMs);
  pendingTimers.add(t);
};

export function startAutoSync(): void {
  if (cleanup) return;

  const onlineCleanup = onConnectivityChange((online) => {
    if (online) scheduleSync(SYNC_AFTER_ONLINE_DELAY_MS);
  });

  retryInterval = setInterval(async () => {
    try {
      const pending = await getPendingOperations();
      if (pending.length > 0) syncPendingOperations();
    } catch (err) {
      // The 30-second retry tick polls IndexedDB for queued ops. Silent
      // catch here hid stuck offline-mode failures (the queue stops
      // draining if IDB throws and nobody reports why). The retry itself
      // is fire-and-forget, but operators looking at the console need a
      // diagnostic — surface the cause; the next tick will try again.
      // eslint-disable-next-line no-console -- intentional structured log
      console.warn(
        '[sync-engine] retry tick: getPendingOperations failed —',
        err instanceof Error ? err.message : String(err),
      );
    }
  }, SYNC_AUTO_INTERVAL_MS);

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') scheduleSync(SYNC_AFTER_VISIBILITY_DELAY_MS);
  };
  document.addEventListener('visibilitychange', handleVisibility);

  cleanup = () => {
    onlineCleanup();
    if (retryInterval) { clearInterval(retryInterval); retryInterval = null; }
    document.removeEventListener('visibilitychange', handleVisibility);
    pendingTimers.forEach(clearTimeout);
    pendingTimers.clear();
  };

  scheduleSync(SYNC_INITIAL_DELAY_MS);
}

export function stopAutoSync(): void {
  if (cleanup) { cleanup(); cleanup = null; }
}
