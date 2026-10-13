/**
 * server-discovery.ts — the tablet finds the DigiLog server again after the
 * server PC's DHCP address changes (tasks/AUTO-IP-RECOVERY-PLAN.md, Part 2).
 *
 * How a host is accepted as "our server":
 *   1. its port is open (native TCP sweep, ServerScanPlugin.java — never 254
 *      WebView fetches, see that file for why);
 *   2. it answers GET /api/health over HTTPS — the WebView only completes the
 *      request if the certificate chains to a CA the tablet trusts, so an
 *      impostor fails here;
 *   3. its `serverId` equals the one remembered from the last good contact —
 *      so a DIFFERENT DigiLog install on the same network is never adopted.
 *
 * Automatic discovery requires a remembered serverId. The operator-driven
 * "Find server" button may accept a server without one (first install, or an
 * APK that never saw a serverId), and only when exactly one candidate answers.
 *
 * Only the native tablet runs this; on a desktop browser the API is same-origin.
 */
import { getApiBase, setApiBase } from './api-base';

const SERVER_ID_KEY = 'digilog.serverId';
const HEALTH_TIMEOUT_MS = 4000;
/** Consecutive failed /api/health probes before the first automatic scan (~45 s at 15 s). */
export const PROBE_FAILURES_BEFORE_DISCOVERY = 3;
/** Wait after a scan that found nothing: 2, 5, then every 15 minutes. */
export const DISCOVERY_BACKOFF_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000];

// ── remembered identity ─────────────────────────────────────────────────────
export function getRememberedServerId(): string | null {
  try { return localStorage.getItem(SERVER_ID_KEY); } catch { return null; }
}
export function rememberServerId(id: unknown): void {
  if (typeof id !== 'string' || !/^[0-9a-f]{8,128}$/.test(id)) return;
  try { localStorage.setItem(SERVER_ID_KEY, id); } catch { /* storage unavailable: discovery just stays manual */ }
}

// ── address helpers ─────────────────────────────────────────────────────────
interface ParsedBase { scheme: string; host: string; port: number; prefix: string | null }
export function parseBase(base: string): ParsedBase | null {
  const m = /^(https?):\/\/([^/:]+)(?::(\d+))?\/?$/i.exec((base ?? '').trim());
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const host = m[2];
  const port = m[3] ? Number(m[3]) : scheme === 'https' ? 443 : 80;
  const ip = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(host);
  return { scheme, host, port, prefix: ip ? ip[1] : null };
}

// ── native + network probes (injectable for tests) ──────────────────────────
export type ScanFn = (port: number, prefixes: string[]) => Promise<string[]>;
export type HealthFn = (base: string) => Promise<string | null | undefined>;

function isNative(): boolean {
  const cap: any = typeof window !== 'undefined' ? (window as any).Capacitor : null;
  return !!cap?.isNativePlatform?.();
}

let scanPlugin: Promise<any | null> | null = null;
const nativeScan: ScanFn = async (port, prefixes) => {
  if (!scanPlugin) {
    scanPlugin = import('@capacitor/core').then((core) => core.registerPlugin('ServerScan'));
  }
  const plugin = await scanPlugin;
  const res = await plugin.scan({ port, prefixes, timeoutMs: 300, threads: 32 });
  return Array.isArray(res?.open) ? res.open : [];
};

/** serverId of a trusted DigiLog server at `base`, null if it answered without one,
 *  undefined if it is not a (reachable, trusted) DigiLog server. */
const httpsHealth: HealthFn = async (base) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api/health`, { method: 'GET', signal: controller.signal });
    if (!r.ok) return undefined;
    const body = await r.json();
    if (body?.status !== 'ok') return undefined;
    return typeof body.serverId === 'string' ? body.serverId : null;
  } catch {
    // TLS refused (untrusted cert), connection reset, timeout: not our server.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

// ── the search ──────────────────────────────────────────────────────────────
export interface FindOptions {
  /** true = operator pressed "Find server": accepts a lone server with no remembered id. */
  manual?: boolean;
  /** Address to search from. Defaults to the saved Server Address. */
  base?: string;
  scan?: ScanFn;
  health?: HealthFn;
}
export interface FindResult {
  found: string | null;
  /** why nothing was adopted — shown on the Server Address screen */
  reason?: 'not-native' | 'no-address' | 'nothing-open' | 'no-match' | 'ambiguous';
  checked: number;
}

export async function findServer(opts: FindOptions = {}): Promise<FindResult> {
  const scan = opts.scan ?? (isNative() ? nativeScan : null);
  const health = opts.health ?? httpsHealth;
  if (!scan) return { found: null, reason: 'not-native', checked: 0 };

  const current = parseBase(opts.base ?? getApiBase());
  const scheme = current?.scheme ?? 'https';
  const port = current?.port ?? 3000;
  // The native side always adds the tablet's own /24; the saved address's /24 is
  // added here because the server may still be on it while the tablet is not.
  const prefixes = current?.prefix ? [current.prefix] : [];
  if (!current && !opts.manual) return { found: null, reason: 'no-address', checked: 0 };

  const open = await scan(port, prefixes);
  if (open.length === 0) return { found: null, reason: 'nothing-open', checked: 0 };

  const expected = getRememberedServerId();
  const servers: { base: string; id: string | null }[] = [];
  let checked = 0;
  for (const host of open) {
    const base = `${scheme}://${host}:${port}`;
    checked += 1;
    const id = await health(base);
    if (id === undefined) continue;
    if (expected && id === expected) {
      return { found: base, checked };
    }
    servers.push({ base, id });
  }

  if (!expected && opts.manual) {
    if (servers.length === 1) return { found: servers[0].base, checked };
    if (servers.length > 1) return { found: null, reason: 'ambiguous', checked };
  }
  return { found: null, reason: 'no-match', checked };
}

// ── adopting a found server ─────────────────────────────────────────────────
type MovedListener = (newBase: string, oldBase: string) => void;
const movedListeners = new Set<MovedListener>();
/** Subscribe to "the server was found at a new address". Returns unsubscribe. */
export function onServerMoved(cb: MovedListener): () => void {
  movedListeners.add(cb);
  return () => { movedListeners.delete(cb); };
}
export function adoptServer(newBase: string): void {
  const old = getApiBase();
  setApiBase(newBase);
  for (const cb of movedListeners) cb(newBase, old);
}

// ── automatic trigger with backoff (called by connectivity.ts) ──────────────
let running = false;
let attempts = 0;
let nextAllowedAt = 0;

/** Any successful contact with the server resets the backoff. */
export function resetDiscoveryBackoff(): void {
  attempts = 0;
  nextAllowedAt = 0;
}

async function networkConnected(): Promise<boolean> {
  try {
    const mod = await import('@capacitor/network');
    return !!(await mod.Network.getStatus()).connected;
  } catch {
    return false;
  }
}

export interface AutoOptions extends Pick<FindOptions, 'scan' | 'health'> {
  now?: number;
  native?: boolean;
  connected?: () => Promise<boolean>;
}

/**
 * Called after every failed /api/health probe. Starts a scan only when: native
 * tablet, enough consecutive failures, the backoff window has passed, the saved
 * address is an IP, a serverId is remembered, and Android reports a network.
 * Resolves to the adopted address, or null.
 */
export async function maybeDiscoverServer(consecutiveFailures: number, opts: AutoOptions = {}): Promise<string | null> {
  const now = opts.now ?? Date.now();
  if (!(opts.native ?? isNative())) return null;
  if (running || consecutiveFailures < PROBE_FAILURES_BEFORE_DISCOVERY || now < nextAllowedAt) return null;
  if (!parseBase(getApiBase())?.prefix || !getRememberedServerId()) return null;

  running = true;
  try {
    if (!(await (opts.connected ?? networkConnected)())) return null;
    const result = await findServer({ scan: opts.scan, health: opts.health });
    if (result.found && result.found !== getApiBase()) {
      adoptServer(result.found);
      resetDiscoveryBackoff();
      return result.found;
    }
    nextAllowedAt = now + DISCOVERY_BACKOFF_MS[Math.min(attempts, DISCOVERY_BACKOFF_MS.length - 1)];
    attempts += 1;
    return null;
  } finally {
    running = false;
  }
}
