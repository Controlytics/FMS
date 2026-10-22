/**
 * lib/ssrf.ts — the outbound-URL guard and hardenedFetch.
 *
 * ssrf.test.ts drives real DNS for the common cases. Here name resolution and
 * the network call are the two boundaries replaced, so the guard can be shown
 * a resolver failure, an empty answer, a mixed answer and IPv6 link-local
 * addresses, and hardenedFetch can be watched passing redirect:'error' and
 * aborting at its timeout — without any packet leaving the machine.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

import { checkOutboundUrl, hardenedFetch, isBlockedAddress } from '../ssrf.js';

const answers: Record<string, Array<{ address: string; family: number }> | Error> = {
  'gw.cvl.lan': [{ address: '192.168.10.5', family: 4 }],
  'mixed.cvl.lan': [{ address: '192.168.10.5', family: 4 }, { address: '127.0.0.1', family: 4 }],
  'empty.cvl.lan': [],
  'v6ll.cvl.lan': [{ address: 'fe9a::1', family: 6 }],
  'v6ok.cvl.lan': [{ address: '2001:db8::10', family: 6 }],
  'nx.cvl.lan': new Error('ENOTFOUND'),
};

beforeEach(() => {
  dns.lookup.mockReset().mockImplementation(async (host: string) => {
    const a = answers[host];
    if (a instanceof Error) throw a;
    return a ?? [{ address: '10.0.0.1', family: 4 }];
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('checkOutboundUrl', () => {
  it('refuses a malformed URL before resolving anything', async () => {
    expect(await checkOutboundUrl('http://')).toEqual({ ok: false, error: 'Invalid URL' });
    expect(await checkOutboundUrl('::not a url::')).toEqual({ ok: false, error: 'Invalid URL' });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('refuses when the name does not resolve, or resolves to nothing', async () => {
    expect(await checkOutboundUrl('https://nx.cvl.lan/x')).toEqual({ ok: false, error: 'DNS resolution failed' });
    expect(await checkOutboundUrl('https://empty.cvl.lan/x')).toEqual({ ok: false, error: 'Destination address not allowed' });
  });

  it('refuses if ANY resolved address is blocked (DNS-rebinding style mixed answer)', async () => {
    expect(await checkOutboundUrl('https://mixed.cvl.lan/')).toEqual({ ok: false, error: 'Destination address not allowed' });
  });

  it('refuses IPv6 link-local, allows a routable IPv6 and the private LAN', async () => {
    expect((await checkOutboundUrl('http://v6ll.cvl.lan')).ok).toBe(false);
    expect((await checkOutboundUrl('http://v6ok.cvl.lan')).ok).toBe(true);
    const ok = await checkOutboundUrl('  https://gw.cvl.lan:8443/sms?x=1  ');
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.url.href).toBe('https://gw.cvl.lan:8443/sms?x=1');
    expect(dns.lookup).toHaveBeenCalledWith('gw.cvl.lan', { all: true });
  });

  it.each([
    ['::', 6, true], ['::1', 6, true], ['fe80::1', 6, true], ['FEB0::2', 6, true], ['fec0::1', 6, false],
    ['::ffff:127.0.0.1', 6, true], ['::ffff:192.168.1.1', 6, false], ['10.0.0', 4, true], ['0.1.2.3', 4, true], ['169.254.169.254', 4, true],
  ])('isBlockedAddress(%s) = %s', (ip, family, blocked) => {
    expect(isBlockedAddress(ip as string, family as number)).toBe(blocked);
  });
});

describe('hardenedFetch', () => {
  it('calls out only after the check, never following redirects', async () => {
    const fetchMock = vi.fn(async () => new Response('pong', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await hardenedFetch('https://gw.cvl.lan/ping', { method: 'POST', headers: { 'x-a': '1' } });
    expect(await res.text()).toBe('pong');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw.cvl.lan/ping');
    expect(init).toMatchObject({ method: 'POST', headers: { 'x-a': '1' }, redirect: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false);
  });

  it('throws before any network call for a blocked destination', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(hardenedFetch('https://mixed.cvl.lan/')).rejects.toThrow('Blocked outbound request: Destination address not allowed');
    await expect(hardenedFetch('ftp://gw.cvl.lan/')).rejects.toThrow('Blocked outbound request: URL must use http or https');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a call that outlives its timeout', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const started = Date.now();
    await expect(hardenedFetch('https://gw.cvl.lan/slow', {}, 30)).rejects.toMatchObject({ name: 'AbortError' });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
