/**
 * DB-free, network-free behaviour tests for lib/ssrf.ts (SAST-01 / SEC-08),
 * written against the Stryker survivors of 2026-10-23: which addresses are
 * refused, which URLs are refused and why, and what hardenedFetch actually asks
 * fetch to do. DNS and fetch are mocked. Listed in vitest.stryker.config.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

import { isBlockedAddress, checkOutboundHost, checkOutboundUrl, hardenedFetch, DEFAULT_TIMEOUT_MS } from '../ssrf.js';

/** A resolver that answers from this table; anything else does not resolve. */
const ZONE: Record<string, { address: string; family: number }[]> = {
  'lan.example': [{ address: '192.168.1.20', family: 4 }],
  'loop.example': [{ address: '127.0.0.1', family: 4 }],
  'mixed.example': [{ address: '192.168.1.20', family: 4 }, { address: '169.254.169.254', family: 4 }],
  'none.example': [],
  'a[b]': [{ address: '192.168.1.21', family: 4 }],
};

beforeEach(() => {
  dns.lookup.mockReset().mockImplementation(async (host: string) => {
    if (host in ZONE) return ZONE[host];
    throw new Error('ENOTFOUND');
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('isBlockedAddress', () => {
  it('an IPv4-mapped IPv6 address is judged by its IPv4 part — both ways', async () => {
    expect(isBlockedAddress('::ffff:127.0.0.1', 6)).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.7', 6)).toBe(false);
    expect(isBlockedAddress('::ffff:192.168.1.20', 6)).toBe(false);
  });

  it('an unparseable IPv4 is refused: too few parts, or a part that is not a number', async () => {
    expect(isBlockedAddress('10.0.0', 4)).toBe(true);
    expect(isBlockedAddress('10.0.0.x', 4)).toBe(true);
    expect(isBlockedAddress('x.0.0.1', 4)).toBe(true);
  });

  it('link-local needs BOTH 169 and 254', async () => {
    expect(isBlockedAddress('169.254.1.1', 4)).toBe(true);
    expect(isBlockedAddress('169.1.1.1', 4)).toBe(false);
    expect(isBlockedAddress('10.254.1.1', 4)).toBe(false);
  });

  it('the whole fe80::/10 range is link-local (fe8x, fe9x, feax, febx), and nothing past it', async () => {
    for (const ip of ['fe80::1', 'fe91::1', 'FEA0::1', 'feb3::2']) expect(isBlockedAddress(ip, 6), ip).toBe(true);
    for (const ip of ['fec0::1', '2001:db8::fe9', 'fd00::fea']) expect(isBlockedAddress(ip, 6), ip).toBe(false);
  });
});

describe('checkOutboundHost', () => {
  it('a missing host is refused before any lookup', async () => {
    expect(await checkOutboundHost(null)).toEqual({ ok: false, error: 'No host' });
    expect(await checkOutboundHost(undefined)).toEqual({ ok: false, error: 'No host' });
    expect(await checkOutboundHost('   ')).toEqual({ ok: false, error: 'No host' });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('only a WHOLLY bracketed host is unbracketed', async () => {
    await checkOutboundHost('a[b]');
    expect(dns.lookup).toHaveBeenLastCalledWith('a[b]', { all: true });
  });

  it('refuses when any resolved address is blocked, or when nothing resolves', async () => {
    expect(await checkOutboundHost('mixed.example')).toEqual({ ok: false, error: 'Destination address not allowed' });
    expect(await checkOutboundHost('none.example')).toEqual({ ok: false, error: 'Destination address not allowed' });
    expect(await checkOutboundHost('nowhere.example')).toEqual({ ok: false, error: 'DNS resolution failed' });
  });
});

describe('checkOutboundUrl', () => {
  it('blank is "No URL configured"; an unparseable string is "Invalid URL"; a non-http scheme is refused', async () => {
    expect(await checkOutboundUrl('   ')).toEqual({ ok: false, error: 'No URL configured' });
    expect(await checkOutboundUrl('')).toEqual({ ok: false, error: 'No URL configured' });
    expect(await checkOutboundUrl('not a url')).toEqual({ ok: false, error: 'Invalid URL' });
    expect(await checkOutboundUrl('ftp://lan.example/x')).toEqual({ ok: false, error: 'URL must use http or https' });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('an allowed destination returns the parsed URL; a refused one returns the host refusal', async () => {
    const ok = await checkOutboundUrl('https://lan.example/api?x=1');
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.url.toString()).toBe('https://lan.example/api?x=1');
    expect(await checkOutboundUrl('http://loop.example/')).toEqual({ ok: false, error: 'Destination address not allowed' });
  });
});

describe('hardenedFetch', () => {
  it('calls fetch with the checked URL, the caller options, redirects refused and an abort signal', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await hardenedFetch('https://lan.example/hook', { method: 'POST', body: 'x' });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lan.example/hook');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('x');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });

  it('a refused destination throws and never calls fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(hardenedFetch('http://loop.example/')).rejects.toThrow('Blocked outbound request: Destination address not allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a call that outlives the timeout (default 5 s, or the one given)', async () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(5000);
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => {
      seen = init.signal!;
      init.signal!.addEventListener('abort', () => rej(new Error('aborted')));
    })));
    vi.useFakeTimers();
    const pending = hardenedFetch('https://lan.example/slow', {}, 1000);
    const settled = expect(pending).rejects.toThrow('aborted');
    // Let the DNS check settle (microtasks only — no fake time passes).
    for (let i = 0; i < 50 && !seen; i++) await Promise.resolve();
    expect(seen).toBeDefined();
    await vi.advanceTimersByTimeAsync(999);
    expect(seen!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen!.aborted).toBe(true);
    await settled;
  });

  it('a call that finishes in time clears its timer (the signal is never aborted later)', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => { seen = init.signal!; return new Response('ok'); }));
    vi.useFakeTimers();
    await hardenedFetch('https://lan.example/fast', {}, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen!.aborted).toBe(false);
  });
});
