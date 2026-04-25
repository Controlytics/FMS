/**
 * Offline Store — SQLite-backed storage for offline-first operations.
 * Tables: operations (sync queue), filters (cached filter list),
 *         filter_state (per-filter+block state), reference_cache (generic cache).
 *
 * All persistence goes through ./sqllite-db (Capacitor SQLite plugin).
 * Previously used IndexedDB; migrated in feature/sqlite-offline branch.
 */

import { dbRun, dbQuery, dbQueryOne } from "./sqllite-db";

interface OfflineOperation {
  id: string;
  type: 'advance' | 'start-cycle' | 'submit-checklist' | 'bypass' | 'terminate' | 'start-and-advance';
  filterId: string;
  filterName: string;
  payload: Record<string, any>;
  createdAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  retryCount: number;
}

interface CachedFilter {
  id: string;
  name: string;
  templateId: string;
  filterSet: string | null;
  currentLifecycleState: string | null;
  currentCycleId: string | null;
  attributes: Record<string, any>;
  parentId: string | null;
  isActive: boolean;
  status: string;
}

// === Cache Operations ===

// Clear all filter-state-* and dryer-temp-* cache entries (after sync replay)
export async function clearFilterStateCaches(): Promise<void> {
  await dbRun(`DELETE FROM reference_cache WHERE key LIKE 'filter-state-%' OR key LIKE 'dryer-temp-%'`);
}

export async function cacheData(
  key: string,
  data: any,
  ttlMs: number = 5 * 60 * 1000
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  await dbRun(
    `INSERT OR REPLACE INTO reference_cache (key, data, updated_at, expires_at)
     VALUES (?, ?, ?, ?)`,
    [key, JSON.stringify(data), now.toISOString(), expiresAt.toISOString()]
  );
}


export async function getCachedData<T>(key: string, ignoreExpiry = false): Promise<T | null> {
  const row = await dbQueryOne<{ data: string; expires_at: string | null }>(
    `SELECT data, expires_at FROM reference_cache WHERE key = ?`,
    [key]
  );
  if (!row) return null;

  // When offline, ALWAYS return cached data regardless of expiry —
  // pharma operators need the data even if it's stale.
  // When online, honour expiry so we refetch fresh data from the server.
  // ignoreExpiry=true lets callers (e.g. offline submit) explicitly bypass.
  if (!ignoreExpiry && navigator.onLine && row.expires_at && new Date(row.expires_at) < new Date()) {
    return null;
  }

  try {
    return JSON.parse(row.data) as T;
  } catch (e) {
    console.warn(`Failed to parse cached data for key ${key}`, e);
    return null;
  }
}

// === Filter Cache ===

export async function cacheFilters(filters: CachedFilter[]): Promise<void> {
  // Wipe existing list and replace — mirrors the old IndexedDB behaviour.
  // Wrap in transaction so partial inserts can't leave the table half-populated.
  const statements = [
    { statement: `DELETE FROM filters`, values: [] as any[] },
  ];
  const now = new Date().toISOString();
  for (const f of filters) {
    statements.push({
      statement: `INSERT INTO filters (id, name, current_lifecycle_state, current_cycle_id, data, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
      values: [
        f.id,
        f.name,
        f.currentLifecycleState,
        f.currentCycleId,
        JSON.stringify(f),
        now,
      ],
    });
  }

  // Import dbTransaction lazily; most calls don't need it
  const { dbTransaction } = await import('./sqllite-db');
  await dbTransaction(statements);
}

export async function getCachedFilters(): Promise<CachedFilter[]> {
  const rows = await dbQuery<{ data: string }>(`SELECT data FROM filters`);
  return rows.map(r => {
    try { return JSON.parse(r.data) as CachedFilter; }
    catch { return null as any; }
  }).filter(Boolean);
}


// Update a single filter's state locally (optimistic update for offline)
export async function updateFilterStateLocally(
  filterId: string,
  newState: string,
  markCycleActive?: boolean
): Promise<void> {
  // Load existing filter row (need full data JSON to preserve other fields)
  const row = await dbQueryOne<{ data: string; current_cycle_id: string | null }>(
    `SELECT data, current_cycle_id FROM filters WHERE id = ?`,
    [filterId]
  );
  if (!row) return;  // filter not cached — nothing to update

  const filter = JSON.parse(row.data);
  filter.currentLifecycleState = newState;

  // When a cycle is started offline, mark it so subsequent stages don't re-ask for reason.
  let newCycleId = row.current_cycle_id;
  if (markCycleActive && !newCycleId) {
    newCycleId = `offline-cycle-${Date.now()}`;
    filter.currentCycleId = newCycleId;
  }

  await dbRun(
    `UPDATE filters 
     SET current_lifecycle_state = ?, current_cycle_id = ?, data = ?, updated_at = ?
     WHERE id = ?`,
    [newState, newCycleId, JSON.stringify(filter), new Date().toISOString(), filterId]
  );
}

// Clear the currentCycleId AND currentLifecycleState for a filter
// (when cycle completes offline). Both must be reset to match the backend's
// auto-complete behavior — otherwise the next cycle's first WASH_IN is
// treated as an advance from the old terminal stage (e.g. STORAGE_IN)
// and the UI offers the wrong next stage.
export async function clearOfflineCycleId(filterId: string): Promise<void> {
  const row = await dbQueryOne<{ data: string }>(
    `SELECT data FROM filters WHERE id = ?`,
    [filterId]
  );
  if (!row) return;

  const filter = JSON.parse(row.data);
  filter.currentCycleId = null;
  filter.currentLifecycleState = null;

  await dbRun(
    `UPDATE filters
     SET current_cycle_id = NULL, current_lifecycle_state = NULL, data = ?, updated_at = ?
     WHERE id = ?`,
    [JSON.stringify(filter), new Date().toISOString(), filterId]
  );
}

// === Operation Queue ===

export async function queueOperation(op: Omit<OfflineOperation, 'id' | 'createdAt' | 'status' | 'retryCount'>): Promise<string> {
 
  const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date().toISOString();

  await dbRun(
    `INSERT INTO operations (id, type, filter_id, filter_name, payload, status, created_at, retry_count) VALUES (?, ?, ?, ?, ?, 'pending', ?, 0)`,
    [id, op.type, op.filterId, op.filterName, JSON.stringify(op.payload), createdAt]
  );
  return id;
}

function rowToOperation(row: any): OfflineOperation {
  return {
    id : row.id,
    type: row.type,
    filterId: row.filter_id,
    filterName: row.filter_name,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    createdAt: row.created_at,
    status: row.status,
    retryCount: row.retry_count ?? 0,
    error: row.error ?? undefined,

  };
}

export async function getPendingOperations(): Promise<OfflineOperation[]> {
  const rows = await dbQuery<any>(`SELECT * FROM operations WHERE status = 'pending' ORDER BY created_at ASC`);
  return rows.map(rowToOperation);
}

export async function getAllOperations(): Promise<OfflineOperation[]> {
  const rows = await dbQuery<any>(`SELECT * FROM operations ORDER BY created_at ASC`);
  return rows.map(rowToOperation);
}

export async function updateOperationStatus(id: string, status: OfflineOperation['status'], error?: string): Promise<void> {
  const shouldIncrementRetry = status === 'failed' || (status === 'pending' && !!error);
  if (status === 'synced') {
    // 4 placeholders, 4 values — include synced_at timestamp for auto-cleanup later.
    await dbRun(
      `UPDATE operations SET status = ?, error = ?, synced_at = ? WHERE id = ?`,
      [status, null, new Date().toISOString(), id]
    );
  } else if (shouldIncrementRetry) {
    await dbRun(
      `UPDATE operations SET status = ?, error = ?, retry_count = retry_count + 1 WHERE id = ?`,
      [status, error ?? null, id]
    );
  } else {
    await dbRun(
      `UPDATE operations SET status = ?, error = ? WHERE id = ?`,
      [status, error ?? null, id]
    );
  }
}

export async function clearSyncedOperations(): Promise<void> {
  await dbRun(`DELETE FROM operations WHERE status = 'synced' AND synced_at < ?`, [new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()]);
}

export async function clearAllOperations(): Promise<void> {
  await dbRun(`DELETE FROM operations`);

}

// === Offline Pre-Queue Validation ===

/**
 * Validate a pending offline operation BEFORE it lands in the queue.
 * Reads cached `filter-state-<id>` + `filters` row and the pipelineGraph
 * to check the target stage is reachable from currentLifecycleState,
 * and that no CHECKLIST node is pending after the current stage.
 *
 * Returns { ok: true } when no graph is cached (fail-open — let online sync validate)
 * or when the move is valid per the cached graph.
 *
 * Called from use-offline.ts in the offline-queue fallback branch only.
 * Never runs on the successful online path.
 */
export async function validatePreQueue(
  filterId: string,
  targetStage: string,
  _opts: { blockId?: string | null } = {},
): Promise<
  | { ok: true }
  | { ok: false; code: string; message: string; nextAllowed?: string[] }
> {
  const cached = await getCachedData<any>(`filter-state-${filterId}`, true);
  const row = await dbQueryOne<{ data: string }>(
    `SELECT data FROM filters WHERE id = ?`,
    [filterId],
  );
  const filter = row ? JSON.parse(row.data) : null;
  const currentLifecycle: string | null =
    filter?.currentLifecycleState || cached?.currentState || null;
  const graph = cached?.pipelineGraph;
  if (!graph?.stages) return { ok: true };

  const { computeNextStagesFromGraph, hasChecklistAfter } = await import('./pipeline-graph');
  const reachable = computeNextStagesFromGraph(graph, currentLifecycle);
  if (reachable.length > 0 && !reachable.includes(targetStage)) {
    return {
      ok: false,
      code: 'OUT_OF_SEQUENCE',
      message: `This is not the correct stage. Next allowed: ${reachable.join(', ')}`,
      nextAllowed: reachable,
    };
  }
  const answered: string[] = Array.isArray(cached?.answeredChecklistStages)
    ? cached.answeredChecklistStages
    : [];
  if (
    currentLifecycle &&
    !answered.includes(currentLifecycle) &&
    hasChecklistAfter(graph, currentLifecycle)
  ) {
    return {
      ok: false,
      code: 'CHECKLIST_PENDING',
      message: `Complete the checklist before advancing from ${currentLifecycle.replace(/_/g, ' ')}`,
    };
  }
  return { ok: true };
}

// === Online/Offline Detection ===

export function isOnline(): boolean {
  return navigator.onLine;
}

export function onOnlineStatusChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
