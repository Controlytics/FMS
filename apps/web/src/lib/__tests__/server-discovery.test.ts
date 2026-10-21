import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getApiBase, setApiBase, clearApiBase } from '../api-base';

// Native boundaries for the "no injected probe" paths at the bottom of this
// file: the ServerScan plugin (registered through @capacitor/core) and the
// Capacitor Network plugin. Every test above passes its own scan/health/
// connected stubs, so these mocks are only reached by the native-path tests.
const cap = vi.hoisted(() => ({
  scan: vi.fn(async (_o: { port: number; prefixes: string[]; timeoutMs: number; threads: number }): Promise<any> => ({ open: [] as string[] })),
  registerPlugin: vi.fn(),
  netStatus: vi.fn(async (): Promise<{ connected: boolean }> => ({ connected: true })),
}));
vi.mock('@capacitor/core', () => ({ registerPlugin: cap.registerPlugin }));
vi.mock('@capacitor/network', () => ({ Network: { getStatus: cap.netStatus } }));
import {
  findServer, maybeDiscoverServer, parseBase, rememberServerId, getRememberedServerId,
  resetDiscoveryBackoff, onServerMoved, DISCOVERY_BACKOFF_MS, PROBE_FAILURES_BEFORE_DISCOVERY,
} from '../server-discovery';

const ID = '18c12c9785dc050e2d2d13920a4ac573d8b055cb';
const OTHER = 'aa'.repeat(20);

/** health() stub: map of base → serverId (null = DigiLog without id; absent = not ours / TLS refused). */
const healthOf = (m: Record<string, string | null>) => vi.fn(async (b: string) => (b in m ? m[b] : undefined));

beforeEach(() => {
  localStorage.clear();
  clearApiBase();
  resetDiscoveryBackoff();
});

describe('parseBase', () => {
  it('reads scheme, host, port and the /24 of an IP address', () => {
    expect(parseBase('https://192.168.1.58:3000')).toEqual({ scheme: 'https', host: '192.168.1.58', port: 3000, prefix: '192.168.1' });
  });
  it('has no prefix for a host name, and rejects junk', () => {
    expect(parseBase('https://digilog.lan:3000')?.prefix).toBeNull();
    expect(parseBase('not a url')).toBeNull();
  });
});

describe('rememberServerId', () => {
  it('keeps a hex id and ignores anything else', () => {
    rememberServerId(ID);
    expect(getRememberedServerId()).toBe(ID);
    rememberServerId('<script>');
    rememberServerId(undefined);
    expect(getRememberedServerId()).toBe(ID);
  });
});

describe('findServer', () => {
  it('scans the saved /24 on the saved port and picks the host whose serverId matches', async () => {
    setApiBase('https://192.168.1.58:3000');
    rememberServerId(ID);
    const scan = vi.fn(async () => ['192.168.1.7', '192.168.1.61']);
    const health = healthOf({ 'https://192.168.1.7:3000': OTHER, 'https://192.168.1.61:3000': ID });
    const r = await findServer({ scan, health });
    expect(scan).toHaveBeenCalledWith(3000, ['192.168.1']);
    expect(r.found).toBe('https://192.168.1.61:3000');
  });

  it('never adopts another DigiLog install (different serverId)', async () => {
    setApiBase('https://192.168.1.58:3000');
    rememberServerId(ID);
    const r = await findServer({ scan: async () => ['192.168.1.9'], health: healthOf({ 'https://192.168.1.9:3000': OTHER }) });
    expect(r).toMatchObject({ found: null, reason: 'no-match' });
  });

  it('skips hosts whose TLS/health fails (impostor or other service on the port)', async () => {
    setApiBase('https://192.168.1.58:3000');
    rememberServerId(ID);
    const r = await findServer({ scan: async () => ['192.168.1.5'], health: healthOf({}) });
    expect(r).toMatchObject({ found: null, reason: 'no-match', checked: 1 });
  });

  it('reports nothing-open when no host has the port open', async () => {
    setApiBase('https://192.168.1.58:3000');
    const r = await findServer({ scan: async () => [], health: healthOf({}) });
    expect(r.reason).toBe('nothing-open');
  });

  it('without a remembered id: automatic search adopts nothing; manual adopts a lone server only', async () => {
    setApiBase('https://192.168.1.58:3000');
    const one = { scan: async () => ['192.168.1.70'], health: healthOf({ 'https://192.168.1.70:3000': ID }) };
    expect((await findServer(one)).found).toBeNull();
    expect((await findServer({ ...one, manual: true })).found).toBe('https://192.168.1.70:3000');

    const two = {
      scan: async () => ['192.168.1.70', '192.168.1.71'],
      health: healthOf({ 'https://192.168.1.70:3000': ID, 'https://192.168.1.71:3000': OTHER }),
      manual: true,
    };
    expect(await findServer(two)).toMatchObject({ found: null, reason: 'ambiguous' });
  });

  it('manual search with no saved address still runs (native adds the tablet /24)', async () => {
    const scan = vi.fn(async () => ['192.168.0.20']);
    const r = await findServer({ manual: true, scan, health: healthOf({ 'https://192.168.0.20:3000': ID }) });
    expect(scan).toHaveBeenCalledWith(3000, []);
    expect(r.found).toBe('https://192.168.0.20:3000');
  });

  it('is a no-op off the tablet (no scanner)', async () => {
    expect((await findServer({ manual: true })).reason).toBe('not-native');
  });
});

describe('maybeDiscoverServer (automatic trigger)', () => {
  const base = 'https://192.168.1.58:3000';
  const moved = 'https://192.168.1.61:3000';
  const opts = (extra: object = {}) => ({
    native: true,
    connected: async () => true,
    scan: vi.fn(async () => ['192.168.1.61']),
    health: healthOf({ [moved]: ID }),
    ...extra,
  });

  beforeEach(() => { setApiBase(base); rememberServerId(ID); });

  it('waits for enough consecutive failures', async () => {
    const o = opts();
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY - 1, o)).toBeNull();
    expect(o.scan).not.toHaveBeenCalled();
  });

  it('adopts the moved server, saves it, and tells listeners', async () => {
    const seen: string[] = [];
    const off = onServerMoved((n, old) => seen.push(`${old}->${n}`));
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY, opts())).toBe(moved);
    expect(getApiBase()).toBe(moved);
    expect(localStorage.getItem('digilog.serverUrl')).toBe(moved);
    expect(seen).toEqual([`${base}->${moved}`]);
    off();
  });

  it('does nothing off-tablet, without a remembered id, for a host-name address, or with no network', async () => {
    expect(await maybeDiscoverServer(9, opts({ native: false }))).toBeNull();
    expect(await maybeDiscoverServer(9, opts({ connected: async () => false }))).toBeNull();
    localStorage.removeItem('digilog.serverId');
    expect(await maybeDiscoverServer(9, opts())).toBeNull();
    rememberServerId(ID);
    setApiBase('https://digilog.lan:3000');
    const o = opts();
    expect(await maybeDiscoverServer(9, o)).toBeNull();
    expect(o.scan).not.toHaveBeenCalled();
  });

  it('backs off 2, 5, then 15 minutes after empty scans; a success resets it', async () => {
    const t0 = 1_000_000;
    const empty = () => opts({ scan: vi.fn(async () => []) });
    let o = empty();
    await maybeDiscoverServer(5, { ...o, now: t0 });
    expect(o.scan).toHaveBeenCalledTimes(1);

    o = empty();
    await maybeDiscoverServer(5, { ...o, now: t0 + DISCOVERY_BACKOFF_MS[0] - 1 });
    expect(o.scan).not.toHaveBeenCalled();                       // still inside 2 min
    await maybeDiscoverServer(5, { ...o, now: t0 + DISCOVERY_BACKOFF_MS[0] });
    expect(o.scan).toHaveBeenCalledTimes(1);                     // 2 min passed

    const t1 = t0 + DISCOVERY_BACKOFF_MS[0];
    o = empty();
    await maybeDiscoverServer(5, { ...o, now: t1 + DISCOVERY_BACKOFF_MS[1] - 1 });
    expect(o.scan).not.toHaveBeenCalled();                       // next wait is 5 min
    await maybeDiscoverServer(5, { ...o, now: t1 + DISCOVERY_BACKOFF_MS[1] });
    expect(o.scan).toHaveBeenCalledTimes(1);

    const t2 = t1 + DISCOVERY_BACKOFF_MS[1];
    for (const k of [0, 1]) {                                    // then 15 min, repeatedly
      o = empty();
      const at = t2 + (k + 1) * DISCOVERY_BACKOFF_MS[2];
      await maybeDiscoverServer(5, { ...o, now: at - 1 });
      expect(o.scan).not.toHaveBeenCalled();
      await maybeDiscoverServer(5, { ...o, now: at });
      expect(o.scan).toHaveBeenCalledTimes(1);
    }

    resetDiscoveryBackoff();                                     // server answered again
    o = empty();
    await maybeDiscoverServer(5, { ...o, now: t0 + 1 });
    expect(o.scan).toHaveBeenCalledTimes(1);
  });

  it('runs one scan at a time', async () => {
    let release: (v: string[]) => void = () => {};
    const slow = vi.fn(() => new Promise<string[]>((r) => { release = r; }));
    const first = maybeDiscoverServer(5, opts({ scan: slow }));
    await Promise.resolve();
    const second = opts();
    expect(await maybeDiscoverServer(5, second)).toBeNull();
    expect(second.scan).not.toHaveBeenCalled();
    release(['192.168.1.61']);
    expect(await first).toBe(moved);
  });
});

describe('native paths (no injected scan / health / connected)', () => {
  const base = 'https://192.168.1.58:3000';
  const moved = 'https://192.168.1.61:3000';
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (window as any).Capacitor = { isNativePlatform: () => true };
    cap.registerPlugin.mockReset().mockReturnValue({ scan: cap.scan });
    cap.scan.mockReset().mockResolvedValue({ open: [] });
    cap.netStatus.mockReset().mockResolvedValue({ connected: true });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    delete (window as any).Capacitor;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('on the tablet, findServer sweeps through the ServerScan plugin with fixed timeout/thread settings', async () => {
    setApiBase(base);
    rememberServerId(ID);
    cap.scan.mockResolvedValue({ open: ['192.168.1.61'] });
    fetchMock.mockResolvedValue(json(200, { status: 'ok', serverId: ID }));
    const r = await findServer();
    expect(cap.registerPlugin).toHaveBeenCalledWith('ServerScan');
    expect(cap.scan).toHaveBeenCalledWith({ port: 3000, prefixes: ['192.168.1'], timeoutMs: 300, threads: 32 });
    expect(fetchMock).toHaveBeenCalledWith(`${moved}/api/health`, expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(r).toEqual({ found: moved, checked: 1 });
  });

  it('a scan result without an `open` array is treated as nothing open', async () => {
    setApiBase(base);
    cap.scan.mockResolvedValue({ status: 'busy' });
    expect(await findServer()).toMatchObject({ found: null, reason: 'nothing-open', checked: 0 });
  });

  it.each([
    ['non-2xx answer', () => json(503, { status: 'ok', serverId: ID })],
    ['status other than ok', () => json(200, { status: 'starting', serverId: ID })],
    ['non-JSON body', () => new Response('<html>', { status: 200 })],
  ])('health check rejects a host on %s', async (_l, res) => {
    setApiBase(base);
    rememberServerId(ID);
    cap.scan.mockResolvedValue({ open: ['192.168.1.61'] });
    fetchMock.mockResolvedValue(res());
    expect(await findServer()).toMatchObject({ found: null, reason: 'no-match', checked: 1 });
  });

  it('health check: a TLS/connection failure means "not our server"', async () => {
    setApiBase(base);
    rememberServerId(ID);
    cap.scan.mockResolvedValue({ open: ['192.168.1.61'] });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await findServer()).toMatchObject({ found: null, reason: 'no-match', checked: 1 });
  });

  it('health check: a DigiLog server with no serverId answers null — manual search adopts it when it is the only one', async () => {
    setApiBase(base);
    cap.scan.mockResolvedValue({ open: ['192.168.1.61'] });
    fetchMock.mockResolvedValue(json(200, { status: 'ok' }));
    expect(await findServer({ manual: true })).toEqual({ found: moved, checked: 1 });
  });

  it('health check: a host that never answers is aborted after 4 s', async () => {
    vi.useFakeTimers();
    setApiBase(base);
    rememberServerId(ID);
    cap.scan.mockResolvedValue({ open: ['192.168.1.61'] });
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = findServer();
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toMatchObject({ found: null, reason: 'no-match', checked: 1 });
  });

  it('automatic discovery asks the Network plugin first and stays put when Android reports no network', async () => {
    setApiBase(base);
    rememberServerId(ID);
    cap.netStatus.mockResolvedValue({ connected: false });
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY)).toBeNull();
    expect(cap.scan).not.toHaveBeenCalled();
  });

  it('automatic discovery: a missing Network plugin counts as "no network"', async () => {
    setApiBase(base);
    rememberServerId(ID);
    cap.netStatus.mockRejectedValue(new Error('not implemented'));
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY)).toBeNull();
    expect(cap.scan).not.toHaveBeenCalled();
  });

  it('automatic discovery end to end on the tablet: Network says connected → native scan → health → adopt', async () => {
    setApiBase(base);
    rememberServerId(ID);
    cap.scan.mockResolvedValue({ open: ['192.168.1.61'] });
    fetchMock.mockResolvedValue(json(200, { status: 'ok', serverId: ID }));
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY)).toBe(moved);
    expect(getApiBase()).toBe(moved);
  });

  it('finding the server at the address already in use is not a move', async () => {
    setApiBase(base);
    rememberServerId(ID);
    cap.scan.mockResolvedValue({ open: ['192.168.1.58'] });
    fetchMock.mockResolvedValue(json(200, { status: 'ok', serverId: ID }));
    const seen = vi.fn();
    const off = onServerMoved(seen);
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY)).toBeNull();
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('automatic discovery off the tablet (no Capacitor) never scans', async () => {
    delete (window as any).Capacitor;
    setApiBase(base);
    rememberServerId(ID);
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY)).toBeNull();
    expect(cap.registerPlugin).not.toHaveBeenCalled();
  });

  it('automatic discovery with no saved address does nothing', async () => {
    rememberServerId(ID);
    expect(await maybeDiscoverServer(PROBE_FAILURES_BEFORE_DISCOVERY)).toBeNull();
    expect(cap.scan).not.toHaveBeenCalled();
  });
});

describe('findServer address handling', () => {
  it('an unparseable saved address refuses an automatic search (no-address)', async () => {
    const scan = vi.fn(async () => ['192.168.1.5']);
    expect(await findServer({ base: 'not-an-address', scan, health: healthOf({}) })).toEqual({ found: null, reason: 'no-address', checked: 0 });
    expect(scan).not.toHaveBeenCalled();
  });

  it('plain http on the default port 80, and a host-name address scans with no saved /24', async () => {
    const scan = vi.fn(async () => ['10.0.0.9']);
    const r = await findServer({ base: 'http://digilog.lan', manual: true, scan, health: healthOf({ 'http://10.0.0.9:80': null }) });
    expect(scan).toHaveBeenCalledWith(80, []);
    expect(r.found).toBe('http://10.0.0.9:80');
  });

  it('parseBase defaults https to 443, tolerates a trailing slash and surrounding spaces, and rejects a path', () => {
    expect(parseBase('  https://192.168.1.5/ ')).toEqual({ scheme: 'https', host: '192.168.1.5', port: 443, prefix: '192.168.1' });
    expect(parseBase('HTTPS://Server:8443')).toEqual({ scheme: 'https', host: 'Server', port: 8443, prefix: null });
    expect(parseBase('https://192.168.1.5:3000/api')).toBeNull();
    expect(parseBase(undefined as unknown as string)).toBeNull();
  });
});

describe('remembered serverId — storage unavailable', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('getRememberedServerId returns null when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(getRememberedServerId()).toBeNull();
  });

  it('rememberServerId swallows a storage failure (discovery just stays manual)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => rememberServerId(ID)).not.toThrow();
  });

  it('rejects ids that are too short, too long, or upper-case hex', () => {
    rememberServerId('abc1234');          // 7 chars
    rememberServerId('a'.repeat(129));
    rememberServerId('ABCDEF0123');
    expect(getRememberedServerId()).toBeNull();
    rememberServerId('abcdef01');          // 8 chars — the minimum
    expect(getRememberedServerId()).toBe('abcdef01');
  });
});
