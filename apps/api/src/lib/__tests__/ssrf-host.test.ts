/**
 * lib/ssrf.ts — checkOutboundHost, the destination check for non-HTTP sockets
 * (LDAP today; SMTP is the other admin-typed socket). SEC-08, 2026-10-22.
 *
 * Same policy as checkOutboundUrl, which now delegates to it: resolve the name,
 * refuse if ANY address is loopback / link-local / unspecified, allow the
 * private LAN. Name resolution is the one boundary replaced here, so a resolver
 * failure, an empty answer and a mixed answer can be shown without DNS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));

import { checkOutboundHost, checkOutboundUrl } from '../ssrf.js';

const answers: Record<string, Array<{ address: string; family: number }> | Error> = {
  'dc01.cvl.lan': [{ address: '192.168.10.20', family: 4 }],
  'localhost': [{ address: '::1', family: 6 }, { address: '127.0.0.1', family: 4 }],
  'rebind.cvl.lan': [{ address: '10.0.0.4', family: 4 }, { address: '169.254.169.254', family: 4 }],
  'empty.cvl.lan': [],
  'nx.cvl.lan': new Error('ENOTFOUND'),
};

beforeEach(() => {
  dns.lookup.mockReset().mockImplementation(async (host: string) => {
    const a = answers[host];
    if (a instanceof Error) throw a;
    if (a) return a;
    // An IP literal resolves to itself, as the real resolver does.
    return [{ address: host, family: host.includes(':') ? 6 : 4 }];
  });
});

describe('checkOutboundHost', () => {
  it('allows a private-LAN directory server and returns the addresses it resolved to', async () => {
    expect(await checkOutboundHost('dc01.cvl.lan')).toEqual({ ok: true, addresses: [{ address: '192.168.10.20', family: 4 }] });
    expect((await checkOutboundHost('10.20.30.40')).ok).toBe(true);
  });

  it.each([
    ['localhost'], ['127.0.0.1'], ['0.0.0.0'], ['169.254.169.254'], ['::1'], ['fe80::1'],
    ['rebind.cvl.lan'], ['empty.cvl.lan'],
  ])('refuses %s (loopback / link-local / unspecified, or ANY such address in the answer)', async (host) => {
    expect(await checkOutboundHost(host)).toEqual({ ok: false, error: 'Destination address not allowed' });
  });

  it('strips the brackets of an IPv6 literal taken from a URL before resolving it', async () => {
    expect(await checkOutboundHost('[::1]')).toEqual({ ok: false, error: 'Destination address not allowed' });
    expect(dns.lookup).toHaveBeenCalledWith('::1', { all: true });
    expect((await checkOutboundHost('[fd00::25]')).ok).toBe(true);
  });

  it('reports a name that does not resolve, and refuses a blank host without resolving', async () => {
    expect(await checkOutboundHost('nx.cvl.lan')).toEqual({ ok: false, error: 'DNS resolution failed' });
    dns.lookup.mockClear();
    expect(await checkOutboundHost('   ')).toEqual({ ok: false, error: 'No host' });
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('checkOutboundUrl applies the same answer to an http URL', async () => {
    expect(await checkOutboundUrl('http://[::1]:8080/x')).toEqual({ ok: false, error: 'Destination address not allowed' });
    expect((await checkOutboundUrl('https://dc01.cvl.lan/sms')).ok).toBe(true);
  });
});
