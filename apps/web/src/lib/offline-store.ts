/**
 * Offline Store — IndexedDB wrapper for offline-first operations.
 * Stores: filter cache, operation queue, sync status, tombstones.
 */

const DB_NAME = 'digilog-offline';
// Phase 8.3: bumped 2 -> 3 to add `tapeVersion` to OfflineOperation rows.
// Phase 8.4 (M-3, 2026-05-02): bumped 3 -> 4. The server schema now
// REQUIRES `tapeVersion` on cycle-bound writes, so leaving rows with
// `tapeVersion === undefined` would produce 400 SCHEMA_ERROR on replay.
// The v3 -> v4 upgrade walks the operations store and normalizes any
// row with undefined tapeVersion to null in place. Null still skips the
// staleness check on the server (the schema has nullable handling), so
// pre-8.3 leftover ops still drain — they're just not fresher than the
// queue assumed at write time.
const DB_VERSION = 4;

// Single source of truth for offline-critical TTLs. Long shifts (>= 12h)
// require everything that participates in cleaning to outlive a full day,
// otherwise mid-shift cache evictions break dialogs offline.
export const OFFLINE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const SHORT_TTL_MS = 30 * 60 * 1000;        // 30 min — for non-critical UI caches
export const SYNCED_OP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CACHE_LRU_CAP = 1000; // max entries in `cache` store before LRU eviction

interface OfflineOperation {
  id: string;
  /** Stable client-generated UUID — sent as x-client-op-id so backend can dedup retries */
  clientOpId: string;
  type: 'advance' | 'start-cycle' | 'submit-checklist' | 'bypass' | 'terminate' | 'start-and-advance';
  filterId: string;
  filterName: string;
  payload: Record<string, any>;
  createdAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  retryCount: number;
  syncedAt?: string;
  /**
   * Tape version observed at queue time. Sent on the replay so the server
   * can reject (409 STALE_TAPE) if another writer changed the cycle while
   * this op sat queued.
   *
   * Phase 8.4 (M-3, 2026-05-02): tightened from `?: number | null` (3
   * states: undefined / null / number) to `: number | null` (2 states).
   * The v3 -> v4 IDB upgrade backfills any pre-existing row with
   * undefined to null in place, so every live op in the store has a
   * deterministic shape. `null` still means "no staleness check" — used
   * for pre-8.3 leftover ops and for non-cycle-bound writes (start-cycle,
   * the start-step of start-and-advance).
   */
  tapeVersion: number | null;
}

interface Tombstone {
  id: string;
  /** Stable client-generated UUID for idempotent replay */
  clientOpId: string;
  /** Logical entity being deleted/cancelled — used for sync ordering and dedup */
  entityType: 'cycle' | 'block-change-request';
  entityId: string;
  /** Optional context for replay */
  payload?: Record<string, any>;
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

interface CachedData {
  key: string;
  data: any;
  cachedAt: string;
  /** Last-access time, used for LRU eviction */
  lastAccessedAt: string;
  expiresAt: string;
}

/**
 * Phase 8.4 M-3 — pure helper used by the v3 -> v4 IDB upgrade.
 *
 * Mutates `row` in place if its `tapeVersion` is undefined (the pre-8.3 +
 * pre-8.4-tightening shape) and returns `true` so the caller knows to
 * `cursor.update(row)`. Otherwise returns `false` (no write needed).
 *
 * Exported for direct unit-testing — exercising the cursor inside a real
 * IDB upgrade transaction would require a heavyweight fake-indexeddb dev
 * dep we don't have, but the migration policy itself is tiny and worth
 * testing explicitly.
 */
export function normalizeOpForV4(row: { tapeVersion?: number | null }): boolean {
  if (row.tapeVersion === undefined) {
    (row as { tapeVersion: number | null }).tapeVersion = null;
    return true;
  }
  return false;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const upgradeTx = req.transaction; // versionchange transaction — must use this for cursor work below
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion ?? 0;

      // Schema bootstrap (idempotent): create stores/indexes that don't exist.
      if (!db.objectStoreNames.contains('operations')) {
        const opStore = db.createObjectStore('operations', { keyPath: 'id' });
        opStore.createIndex('status', 'status', { unique: false });
        opStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('filters')) {
        db.createObjectStore('filters', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('tombstones')) {
        const tsStore = db.createObjectStore('tombstones', { keyPath: 'id' });
        tsStore.createIndex('status', 'status', { unique: false });
        tsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // Phase 8.4 M-3 (2026-05-02): v3 -> v4 normalizes any pre-8.3
      // OfflineOperation row with undefined tapeVersion to explicit null.
      // The TypeScript type was tightened from `?: number | null` to
      // `: number | null`, so the on-disk shape must match. Cursor-iterate
      // the operations store inside the versionchange transaction.
      if (oldVersion < 4 && upgradeTx) {
        const opStore = upgradeTx.objectStore('operations');
        const cursorReq = opStore.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const row = cursor.value as OfflineOperation;
          if (normalizeOpForV4(row)) cursor.update(row);
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Generate a UUID v4 — used for clientOpId on every queued operation */
export function generateClientOpId(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  // Fallback for older WebViews — RFC 4122 v4 from Math.random
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// === Cache Operations ===

// Clear all filter-state-* and dryer-temp-* cache entries (after sync replay)
export async function clearFilterStateCaches(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('cache', 'readwrite');
  const store = tx.objectStore('cache');
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const items = req.result ?? [];
      for (const item of items) {
        if (item.key?.startsWith('filter-state-') || item.key?.startsWith('dryer-temp-')) {
          store.delete(item.key);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheData(key: string, data: any, ttlMs: number = SHORT_TTL_MS): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('cache', 'readwrite');
  const now = new Date();
  tx.objectStore('cache').put({
    key,
    data,
    cachedAt: now.toISOString(),
    lastAccessedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export async function getCachedData<T>(key: string): Promise<T | null> {
  const db = await openDB();
  const tx = db.transaction('cache', 'readwrite');
  const store = tx.objectStore('cache');
  const req = store.get(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const result = req.result as CachedData | undefined;
      if (!result) { resolve(null); return; }
      // When offline, always return cached data regardless of expiry — better
      // stale data than no data when the operator can't reach the server.
      if (navigator.onLine && new Date(result.expiresAt) < new Date()) { resolve(null); return; }
      // Touch lastAccessedAt for LRU
      result.lastAccessedAt = new Date().toISOString();
      store.put(result);
      resolve(result.data as T);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * LRU eviction — caps `cache` store at CACHE_LRU_CAP entries.
 * Filter-state-* and identifier-map are exempt because they're operationally critical.
 */
export async function evictLruCache(): Promise<{ evicted: number; total: number }> {
  const db = await openDB();
  const tx = db.transaction('cache', 'readwrite');
  const store = tx.objectStore('cache');
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const items = (req.result ?? []) as CachedData[];
      if (items.length <= CACHE_LRU_CAP) { resolve({ evicted: 0, total: items.length }); return; }
      const exempt = (key: string) => key.startsWith('filter-state-') || key === 'identifier-map' || key === 'cleaning-profile-assignment' || key.startsWith('active-profile-');
      const evictable = items
        .filter(i => !exempt(i.key))
        .sort((a, b) => new Date(a.lastAccessedAt ?? a.cachedAt).getTime() - new Date(b.lastAccessedAt ?? b.cachedAt).getTime());
      const target = items.length - CACHE_LRU_CAP;
      const toEvict = evictable.slice(0, target);
      for (const item of toEvict) store.delete(item.key);
      resolve({ evicted: toEvict.length, total: items.length });
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Periodic compaction — removes synced operations older than SYNCED_OP_RETENTION_MS.
 * Failed operations are kept for operator visibility.
 */
export async function compactSyncedOperations(): Promise<{ removed: number }> {
  const db = await openDB();
  const tx = db.transaction('operations', 'readwrite');
  const store = tx.objectStore('operations');
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const ops = (req.result ?? []) as OfflineOperation[];
      const cutoff = Date.now() - SYNCED_OP_RETENTION_MS;
      let removed = 0;
      for (const op of ops) {
        if (op.status === 'synced') {
          const ts = op.syncedAt ? new Date(op.syncedAt).getTime() : new Date(op.createdAt).getTime();
          if (ts < cutoff) { store.delete(op.id); removed++; }
        }
      }
      resolve({ removed });
    };
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

// === Filter Cache ===

export async function cacheFilters(filters: CachedFilter[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('filters', 'readwrite');
  const store = tx.objectStore('filters');
  store.clear();
  for (const f of filters) store.put(f);
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export async function getCachedFilters(): Promise<CachedFilter[]> {
  const db = await openDB();
  const tx = db.transaction('filters', 'readonly');
  const req = tx.objectStore('filters').getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

// Update a single filter's state locally (optimistic update for offline)
export async function updateFilterStateLocally(filterId: string, newState: string, markCycleActive?: boolean): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('filters', 'readwrite');
  const store = tx.objectStore('filters');
  const req = store.get(filterId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const filter = req.result;
      if (filter) {
        filter.currentLifecycleState = newState;
        // When a cycle is started offline, mark it so subsequent stages don't re-ask for reason
        if (markCycleActive && !filter.currentCycleId) {
          filter.currentCycleId = `offline-cycle-${Date.now()}`;
        }
        store.put(filter);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clear the currentCycleId and currentLifecycleState for a filter (when cycle completes offline)
export async function clearOfflineCycleId(filterId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('filters', 'readwrite');
  const store = tx.objectStore('filters');
  const req = store.get(filterId);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const filter = req.result;
      if (filter) {
        filter.currentCycleId = null;
        filter.currentLifecycleState = null;
        store.put(filter);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === Operation Queue ===

/**
 * Input shape for `queueOperation`: the on-store row type (`OfflineOperation`)
 * minus the engine-managed fields, with `tapeVersion` widened to allow
 * `undefined` from callers that haven't been threaded through yet. The
 * persistence layer always normalizes to `number | null` (M-3 / v4).
 */
type QueueInput = Omit<OfflineOperation, 'id' | 'clientOpId' | 'createdAt' | 'status' | 'retryCount' | 'tapeVersion'> & {
  tapeVersion?: number | null;
};

export async function queueOperation(op: QueueInput): Promise<string> {
  const db = await openDB();
  const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientOpId = generateClientOpId();
  const tx = db.transaction('operations', 'readwrite');
  // Phase 8.4 M-3: persist tapeVersion as `number | null` only — no undefined
  // on the wire. The IDB upgrade also normalizes any pre-existing v3 rows
  // with undefined tapeVersion. Callers that don't supply tapeVersion (pre-
  // cutover paths, non-cycle-bound writes) get null; the sync engine
  // omits the body field entirely when null.
  tx.objectStore('operations').put({
    ...op,
    id,
    clientOpId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
    tapeVersion: op.tapeVersion ?? null,
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingOperations(): Promise<OfflineOperation[]> {
  const db = await openDB();
  const tx = db.transaction('operations', 'readonly');
  const index = tx.objectStore('operations').index('status');
  const req = index.getAll('pending');
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllOperations(): Promise<OfflineOperation[]> {
  const db = await openDB();
  const tx = db.transaction('operations', 'readonly');
  const req = tx.objectStore('operations').getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const ops = (req.result ?? []) as OfflineOperation[];
      ops.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      resolve(ops);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function updateOperationStatus(id: string, status: OfflineOperation['status'], error?: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('operations', 'readwrite');
  const store = tx.objectStore('operations');
  const req = store.get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const op = req.result;
      if (op) {
        op.status = status;
        if (status === 'synced') op.syncedAt = new Date().toISOString();
        if (error) op.error = error;
        // Increment retry count on every failure (pending retry or final failure)
        if (status === 'failed' || (status === 'pending' && error)) {
          op.retryCount = (op.retryCount ?? 0) + 1;
        }
        store.put(op);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
  });
}

// === Tombstones (for offline deletes/terminations — sync engine processes these first) ===

export async function queueTombstone(t: Omit<Tombstone, 'id' | 'clientOpId' | 'createdAt' | 'status' | 'retryCount'>): Promise<string> {
  const db = await openDB();
  const id = `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const clientOpId = generateClientOpId();
  const tx = db.transaction('tombstones', 'readwrite');
  tx.objectStore('tombstones').put({
    ...t,
    id,
    clientOpId,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingTombstones(): Promise<Tombstone[]> {
  const db = await openDB();
  const tx = db.transaction('tombstones', 'readonly');
  if (!db.objectStoreNames.contains('tombstones')) return [];
  const idx = tx.objectStore('tombstones').index('status');
  const req = idx.getAll('pending');
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function updateTombstoneStatus(id: string, status: Tombstone['status'], error?: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('tombstones', 'readwrite');
  const store = tx.objectStore('tombstones');
  const req = store.get(id);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const t = req.result;
      if (t) {
        t.status = status;
        if (error) t.error = error;
        if (status === 'failed' || (status === 'pending' && error)) {
          t.retryCount = (t.retryCount ?? 0) + 1;
        }
        store.put(t);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
  });
}

export async function clearSyncedTombstones(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('tombstones', 'readwrite');
  const store = tx.objectStore('tombstones');
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const ts = req.result ?? [];
      for (const t of ts) if (t.status === 'synced') store.delete(t.id);
      resolve();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
  });
}

export async function clearSyncedOperations(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('operations', 'readwrite');
  const store = tx.objectStore('operations');
  const req = store.getAll();
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const ops = req.result ?? [];
      for (const op of ops) {
        if (op.status === 'synced') store.delete(op.id);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
  });
}

export async function clearAllOperations(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('operations', 'readwrite');
  tx.objectStore('operations').clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
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
