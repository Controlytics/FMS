/**
 * connectivity.ts — single source of truth for "are we online?"
 *
 * Why not navigator.onLine alone? On Capacitor Android WebViews navigator.onLine
 * routinely lies — it stays "false" after WiFi reconnects until a user interaction,
 * or stays "true" when the device is on a captive portal that has no actual
 * server reachability. This module fans out three signals:
 *
 *   1. Capacitor Network plugin — true OS-level connectivity events on tablet
 *   2. navigator.onLine + window online/offline events — fallback on web
 *   3. /api/health probe every 15s + on visibilitychange — verifies our server
 *      is actually reachable, not just "the device says it has network"
 *
 * Callers subscribe via onConnectivityChange(cb) and read isOnline() for sync state.
 */

import {
  CONNECTIVITY_PROBE_TIMEOUT_MS,
  CONNECTIVITY_POLL_INTERVAL_MS,
} from './timing-constants';

let cachedOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
const listeners = new Set<(online: boolean) => void>();

function notify(next: boolean) {
  if (next === cachedOnline) return;
  cachedOnline = next;
  for (const cb of listeners) cb(next);
}

/** Current best-effort online status. Synchronous read; updated by background probes. */
export function isOnline(): boolean {
  return cachedOnline;
}

/**
 * Subscribe to connectivity changes. Returns an unsubscribe function.
 * The callback is NOT invoked immediately with the current state — call isOnline()
 * for the initial value if you need it on mount.
 */
export function onConnectivityChange(cb: (online: boolean) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * Internal: probe the server with a short timeout. Used by the periodic poll
 * and by the visibilitychange handler.
 */
async function probeServer(): Promise<boolean> {
  const baseUrl = (import.meta as any).env?.VITE_API_URL ?? '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECTIVITY_PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl}/api/health`, { method: 'GET', signal: controller.signal });
    // Apply the < 500 rule via the helper so a Vite dev-proxy 500 (or any
    // reverse-proxy "upstream unreachable" response) does NOT mark contact.
    // Without this, the hard-cutoff would never trip in dev because the
    // 15s probe would keep resetting the timer on every Vite proxy error.
    const { markServerContactFromResponse } = await import('./server-contact');
    markServerContactFromResponse(r);
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let visListener: (() => void) | null = null;
let onlineListener: (() => void) | null = null;
let offlineListener: (() => void) | null = null;
let capUnsub: (() => void) | null = null;

/**
 * Start the connectivity engine. Idempotent — call as many times as you want.
 * Should be invoked once at app boot (e.g. inside useOffline()'s mount effect).
 */
export async function startConnectivityEngine(): Promise<void> {
  if (started) return;
  started = true;

  // 1. Capacitor Network plugin (tablet) — try to load it dynamically so the
  // bundle still works on plain web builds where the plugin doesn't exist.
  try {
    const mod = await import('@capacitor/network');
    const status = await mod.Network.getStatus();
    notify(!!status.connected);
    const handler = await mod.Network.addListener('networkStatusChange', (s) => {
      notify(!!s.connected);
    });
    capUnsub = () => { try { (handler as any)?.remove?.(); } catch { /* ignore */ } };
  } catch {
    // Plugin not available (web build) — fall back to navigator.onLine
  }

  // 2. Browser online/offline events — works on web; benign on Capacitor too
  if (typeof window !== 'undefined') {
    onlineListener = () => notify(true);
    offlineListener = () => notify(false);
    window.addEventListener('online', onlineListener);
    window.addEventListener('offline', offlineListener);
  }

  // 3. Periodic /api/health probe — the truth-teller. notify() dedupes so this
  // is cheap even at 15s cadence.
  const tick = async () => {
    const reachable = await probeServer();
    notify(reachable);
  };
  await tick();
  pollTimer = setInterval(tick, CONNECTIVITY_POLL_INTERVAL_MS);

  // 4. Re-probe immediately when the tab/app becomes visible again — covers
  // the common "operator unlocks the tablet" case where Capacitor's network
  // event may have missed a transition.
  if (typeof document !== 'undefined') {
    visListener = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', visListener);
  }
}

export function stopConnectivityEngine(): void {
  if (!started) return;
  started = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (visListener && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visListener);
    visListener = null;
  }
  if (onlineListener && typeof window !== 'undefined') {
    window.removeEventListener('online', onlineListener);
    onlineListener = null;
  }
  if (offlineListener && typeof window !== 'undefined') {
    window.removeEventListener('offline', offlineListener);
    offlineListener = null;
  }
  if (capUnsub) { capUnsub(); capUnsub = null; }
}
