import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getApiBase, setApiBase, clearApiBase } from '../api-base';
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
