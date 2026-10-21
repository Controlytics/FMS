import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * connectivity.ts — the "are we online?" engine.
 *
 * Boundaries stubbed (narrowest possible):
 *   - `@capacitor/network` (vi.mock): the OS-level network plugin. Each test
 *     sets what getStatus() returns or makes it reject (= plain web build).
 *   - `../server-discovery` (vi.mock): the DHCP-move scanner, so the test
 *     can assert WHEN the engine asks for a scan and what it does with the
 *     answer, without a native TCP sweep.
 *   - global `fetch`: the /api/health probe.
 * server-contact.ts is REAL — the probe's < 500 contact rule is asserted on
 * localStorage.
 *
 * The module keeps `started` / `cachedOnline` at module level, so each test
 * re-imports it after vi.resetModules().
 */

const h = vi.hoisted(() => ({
  status: { connected: true } as { connected: boolean } | Error,
  netHandler: null as null | ((s: { connected: boolean }) => void),
  remove: vi.fn(),
  maybeDiscoverServer: vi.fn(async (_n: number): Promise<string | null> => null),
  rememberServerId: vi.fn(),
  resetDiscoveryBackoff: vi.fn(),
}));

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => {
      if (h.status instanceof Error) throw h.status;
      return h.status;
    }),
    addListener: vi.fn(async (_evt: string, cb: (s: { connected: boolean }) => void) => {
      h.netHandler = cb;
      return { remove: h.remove };
    }),
  },
}));
vi.mock('../server-discovery', () => ({
  maybeDiscoverServer: h.maybeDiscoverServer,
  rememberServerId: h.rememberServerId,
  resetDiscoveryBackoff: h.resetDiscoveryBackoff,
}));

type FetchPlan = (url: string, init: RequestInit) => Promise<Response>;
let fetchPlan: FetchPlan;
const fetchMock = vi.fn((url: string, init: RequestInit) => fetchPlan(url, init));

const ok = (body: unknown = { status: 'ok', serverId: 'abcdef0123' }) =>
  async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const status = (code: number) => async () => new Response('{}', { status: code });
const down = async () => { throw new TypeError('Failed to fetch'); };

const addedWindowListeners: Array<[string, EventListener]> = [];
const addedDocListeners: Array<[string, EventListener]> = [];

async function load() {
  vi.resetModules();
  return import('../connectivity');
}

/** Let the microtask queue + dynamic imports inside the engine settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(0);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  h.status = { connected: true };
  h.netHandler = null;
  h.remove.mockReset();
  h.maybeDiscoverServer.mockReset().mockResolvedValue(null);
  h.rememberServerId.mockReset();
  h.resetDiscoveryBackoff.mockReset();
  fetchPlan = ok();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  // Track listeners the engine adds so they can be removed between tests
  // (the engine has no stop() — it is designed to run for the app's life).
  const wAdd = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((t: string, l: EventListener, o?: any) => {
    addedWindowListeners.push([t, l]); wAdd(t, l, o);
  }) as any);
  const dAdd = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(((t: string, l: EventListener, o?: any) => {
    addedDocListeners.push([t, l]); dAdd(t, l, o);
  }) as any);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [t, l] of addedWindowListeners.splice(0)) window.removeEventListener(t, l);
  for (const [t, l] of addedDocListeners.splice(0)) document.removeEventListener(t, l);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('isOnline / onConnectivityChange before the engine starts', () => {
  it('starts from navigator.onLine and does not call back on subscribe', async () => {
    const c = await load();
    expect(c.isOnline()).toBe(navigator.onLine);
    const cb = vi.fn();
    const off = c.onConnectivityChange(cb);
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});

describe('startConnectivityEngine', () => {
  it('probes GET <base>/api/health with an abort signal, marks contact and remembers the serverId', async () => {
    localStorage.setItem('digilog.serverUrl', 'https://192.168.1.53:3000');
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    expect(fetchMock).toHaveBeenCalledWith('https://192.168.1.53:3000/api/health', expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(Number(localStorage.getItem('digilog_last_server_contact'))).toBeGreaterThan(0);
    expect(h.rememberServerId).toHaveBeenCalledWith('abcdef0123');
    expect(h.resetDiscoveryBackoff).toHaveBeenCalled();
    expect(c.isOnline()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a 200 with a non-JSON body is still "online" and remembers nothing', async () => {
    fetchPlan = async () => new Response('<html>', { status: 200 });
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    expect(c.isOnline()).toBe(true);
    expect(h.rememberServerId).not.toHaveBeenCalled();
  });

  it('a 5xx answer is NOT contact (W4 rule) and counts as a failed probe', async () => {
    fetchPlan = status(502);
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    expect(localStorage.getItem('digilog_last_server_contact')).toBeNull();
    expect(h.maybeDiscoverServer).toHaveBeenCalledWith(1);
    expect(h.rememberServerId).not.toHaveBeenCalled();
  });

  it('is idempotent — a second start does nothing (no second probe, no second plugin subscription)', async () => {
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    const calls = fetchMock.mock.calls.length;
    await c.startConnectivityEngine();
    await settle();
    expect(fetchMock.mock.calls.length).toBe(calls);
    const { Network } = await import('@capacitor/network');
    expect(Network.addListener).toHaveBeenCalledTimes(1);
  });

  it('Capacitor Network plugin: OS status and change events drive isOnline, and notify dedupes', async () => {
    h.status = { connected: false };
    fetchPlan = down; // one failed probe must NOT override the plugin's verdict
    const c = await load();
    const seen: boolean[] = [];
    c.onConnectivityChange((o) => seen.push(o));
    await c.startConnectivityEngine();
    await settle();
    expect(c.isOnline()).toBe(false);
    expect(seen).toEqual([false]);

    h.netHandler!({ connected: true });
    h.netHandler!({ connected: true }); // same value — not re-emitted
    expect(c.isOnline()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('no plugin (plain web build): falls back to browser online/offline events', async () => {
    h.status = new Error('Network plugin not implemented on web');
    const c = await load();
    const seen: boolean[] = [];
    c.onConnectivityChange((o) => seen.push(o));
    await c.startConnectivityEngine();
    await settle();
    window.dispatchEvent(new Event('offline'));
    expect(c.isOnline()).toBe(false);
    window.dispatchEvent(new Event('online'));
    expect(c.isOnline()).toBe(true);
    expect(seen).toEqual([false, true]);
  });

  it('debounces the OFFLINE flip: one failed probe keeps online, the second flips offline, a success restores at once', async () => {
    const c = await load();
    await c.startConnectivityEngine();       // first probe ok → online
    await settle();
    expect(c.isOnline()).toBe(true);

    fetchPlan = down;
    await vi.advanceTimersByTimeAsync(15_000); // failure #1
    expect(c.isOnline()).toBe(true);
    expect(h.maybeDiscoverServer).toHaveBeenLastCalledWith(1);

    await vi.advanceTimersByTimeAsync(15_000); // failure #2
    expect(c.isOnline()).toBe(false);
    expect(h.maybeDiscoverServer).toHaveBeenLastCalledWith(2);

    fetchPlan = ok();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.isOnline()).toBe(true);

    fetchPlan = down;                          // counter was reset by the success
    await vi.advanceTimersByTimeAsync(15_000);
    expect(c.isOnline()).toBe(true);
    expect(h.maybeDiscoverServer).toHaveBeenLastCalledWith(1);
  });

  it('a probe that hangs is aborted after the probe timeout and counts as a failure', async () => {
    fetchPlan = (_u, init) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    });
    const c = await load();
    const p = c.startConnectivityEngine();
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    await settle();
    expect(h.maybeDiscoverServer).toHaveBeenCalledWith(1);
  });

  it('when discovery finds the moved server, the engine re-probes immediately (no wait for the next poll)', async () => {
    fetchPlan = down;
    h.maybeDiscoverServer.mockResolvedValueOnce('https://192.168.1.61:3000');
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial probe + immediate re-probe
  });

  it('a discovery failure is logged as a warning, never thrown', async () => {
    fetchPlan = down;
    h.maybeDiscoverServer.mockRejectedValueOnce(new Error('scan plugin crashed'));
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    expect(warn).toHaveBeenCalledWith('[server-discovery] scan failed:', 'scan plugin crashed');
  });

  it('a discovery rejection without a message logs the raw value', async () => {
    fetchPlan = down;
    h.maybeDiscoverServer.mockRejectedValueOnce('boom');
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    expect(warn).toHaveBeenCalledWith('[server-discovery] scan failed:', 'boom');
  });

  it('re-probes when the app becomes visible again, not when it is hidden', async () => {
    const c = await load();
    await c.startConnectivityEngine();
    await settle();
    const before = fetchMock.mock.calls.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock.mock.calls.length).toBe(before);

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it('unsubscribed listeners are not called', async () => {
    const c = await load();
    const cb = vi.fn();
    const off = c.onConnectivityChange(cb);
    off();
    h.status = { connected: false };
    await c.startConnectivityEngine();
    await settle();
    expect(cb).not.toHaveBeenCalled();
  });
});
