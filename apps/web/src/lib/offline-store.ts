/**
 * Offline Store — IndexedDB wrapper for offline-first operations.
 * Stores: filter cache, operation queue, sync status.
 */

const DB_NAME = 'digilog-offline';
const DB_VERSION = 1;

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

interface CachedData {
  key: string;
  data: any;
  cachedAt: string;
  expiresAt: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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

export async function cacheData(key: string, data: any, ttlMs: number = 5 * 60 * 1000): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('cache', 'readwrite');
  const now = new Date();
  tx.objectStore('cache').put({
    key,
    data,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  });
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}

export async function getCachedData<T>(key: string): Promise<T | null> {
  const db = await openDB();
  const tx = db.transaction('cache', 'readonly');
  const req = tx.objectStore('cache').get(key);
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      const result = req.result as CachedData | undefined;
      if (!result) { resolve(null); return; }
      // When offline, always return cached data regardless of expiry
      if (navigator.onLine && new Date(result.expiresAt) < new Date()) { resolve(null); return; }
      resolve(result.data as T);
    };
    req.onerror = () => reject(req.error);
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

// Clear the currentCycleId for a filter (when cycle completes offline)
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
        store.put(filter);
      }
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === Operation Queue ===

export async function queueOperation(op: Omit<OfflineOperation, 'id' | 'createdAt' | 'status' | 'retryCount'>): Promise<string> {
  const db = await openDB();
  const id = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tx = db.transaction('operations', 'readwrite');
  tx.objectStore('operations').put({
    ...op,
    id,
    createdAt: new Date().toISOString(),
    status: 'pending',
    retryCount: 0,
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
