/**
 * Narrow fakes for the tablet-app page tests (coverage campaign, 2026-10-21).
 * NOT a test file. Imports nothing from the app, so a `vi.mock` factory can
 * pull these in without a hoisting cycle:
 *
 *   vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
 *
 * Each fake replaces ONE boundary the page cannot have in jsdom, and nothing
 * more — the pages, their hooks, apiClient/SWR, the real offline-store (on an
 * in-memory IndexedDB), offline-cache, local-context and the filter-ops core
 * all run for real:
 *
 *  - connectivity   — Capacitor Network plugin + a 15 s /api/health poll. Faked as
 *                     a switch the test flips (`setOnline`), which is what the
 *                     page subscribes to.
 *  - sync-engine    — PROTECTED surface (tested on its own). Faked so no
 *                     background replay timer drains the queue mid-test; the
 *                     test fires its events (`emitSync`) and decides what a
 *                     manual sync returns.
 *  - sync-since     — background /api/sync/since poller into IndexedDB. No-op.
 *  - offline-sync-service.syncAllDataForOffline — the open-time master-data
 *                     download (dozens of requests). Faked to report progress;
 *                     `buildIdentifierMap` / `filterIdsWithUnsyncedWork` stay real.
 *  - rfid-bridge    — the native RfidPlugin. The test pushes tags through the
 *                     captured callback exactly as the plugin would.
 *  - @capacitor/app — the hardware back button. The test presses it.
 */
import { vi } from 'vitest';

// ── connectivity ─────────────────────────────────────────────────────────
const conn = { online: true, listeners: new Set<(o: boolean) => void>() };
export function setOnline(v: boolean) {
  conn.online = v;
  for (const l of [...conn.listeners]) l(v);
}
export const connectivityModule = {
  isOnline: () => conn.online,
  onConnectivityChange: (cb: (o: boolean) => void) => { conn.listeners.add(cb); return () => { conn.listeners.delete(cb); }; },
  startConnectivityEngine: async () => {},
};

// ── sync-engine ──────────────────────────────────────────────────────────
const syncListeners = new Set<(e: any) => void>();
export function emitSync(event: any) { for (const l of [...syncListeners]) l(event); }
export const syncPendingOperations = vi.fn(async () => ({ synced: 0, failed: 0 }));
export const syncEngineModule = {
  onSyncEvent: (l: (e: any) => void) => { syncListeners.add(l); return () => { syncListeners.delete(l); }; },
  startAutoSync: () => {},
  stopAutoSync: () => {},
  emitSyncStage: () => {},
  withReplayTimeout: <T,>(p: Promise<T>) => p,
  syncPendingOperations: (...a: any[]) => (syncPendingOperations as any)(...a),
};

// ── sync-since ───────────────────────────────────────────────────────────
export const triggerSync = vi.fn();
export const syncSinceModule = {
  triggerSync: (...a: any[]) => (triggerSync as any)(...a),
  startSyncPolling: () => () => {},
  stopSyncPolling: () => {},
  syncSince: async () => ({}),
};

// ── offline-sync-service.syncAllDataForOffline ───────────────────────────
/** What the next syncAllDataForOffline call reports. `null` = never finishes. */
export const syncAll = {
  calls: 0,
  first: { step: 'Syncing filters...', current: 0, total: 1, done: false } as any,
  progress: { step: 'Done', current: 1, total: 1, done: true } as any | null,
};
export async function fakeSyncAllDataForOffline(onProgress?: (p: any) => void): Promise<boolean> {
  syncAll.calls += 1;
  onProgress?.(syncAll.first);
  if (syncAll.progress) onProgress?.(syncAll.progress);
  return true;
}

// ── rfid-bridge ──────────────────────────────────────────────────────────
export const rfid = {
  onTag: null as null | ((t: { epc: string }) => void),
  onError: null as null | ((e: string) => void),
  unsubscribed: 0,
  reconnect: vi.fn(async () => ({ ok: true } as { ok: boolean; error?: string })),
};
export const rfidBridgeModule = {
  subscribeRfidTags: async (onTag: (t: { epc: string }) => void, onError?: (e: string) => void) => {
    rfid.onTag = onTag;
    rfid.onError = onError ?? null;
    return () => { rfid.unsubscribed += 1; };
  },
  reconnectRfid: (...a: any[]) => (rfid.reconnect as any)(...a),
};

// ── @capacitor/app back button ───────────────────────────────────────────
export const back = { handler: null as null | (() => void), removed: 0 };
export const capacitorAppModule = {
  App: {
    addListener: async (event: string, cb: () => void) => {
      if (event === 'backButton') back.handler = cb;
      return { remove: () => { back.removed += 1; } };
    },
  },
};

/** Reset every fake to its default between tests. */
export function resetFakes() {
  conn.online = true;
  conn.listeners.clear();
  syncListeners.clear();
  syncPendingOperations.mockReset();
  syncPendingOperations.mockResolvedValue({ synced: 0, failed: 0 });
  triggerSync.mockReset();
  syncAll.calls = 0;
  syncAll.first = { step: 'Syncing filters...', current: 0, total: 1, done: false };
  syncAll.progress = { step: 'Done', current: 1, total: 1, done: true };
  rfid.onTag = null;
  rfid.onError = null;
  rfid.unsubscribed = 0;
  rfid.reconnect.mockReset();
  rfid.reconnect.mockResolvedValue({ ok: true });
  back.handler = null;
  back.removed = 0;
}
