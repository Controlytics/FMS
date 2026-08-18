import { describe, it, expect } from 'vitest';
import { isBlockedAddress, checkOutboundUrl, hardenedFetch } from './ssrf.js';

// SAST-01. The notification channels now share this guard with the instrument
// fetch; these lock the policy so a future edit to one caller cannot quietly
// loosen it for the others.

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 4, 'loopback'],
    ['127.53.1.9', 4, 'loopback /8'],
    ['0.0.0.0', 4, 'unspecified'],
    ['169.254.169.254', 4, 'CLOUD METADATA — the one that matters'],
    ['169.254.1.1', 4, 'link-local'],
    ['::1', 6, 'ipv6 loopback'],
    ['::', 6, 'ipv6 unspecified'],
    ['fe80::1', 6, 'ipv6 link-local'],
    ['::ffff:127.0.0.1', 6, 'ipv4-mapped loopback'],
    ['garbage', 4, 'unparseable fails closed'],
  ])('blocks %s (%s)', (ip, family) => {
    expect(isBlockedAddress(ip as string, family as number)).toBe(true);
  });

  it.each([
    ['10.0.0.5', 4],
    ['172.16.4.9', 4],
    ['192.168.1.53', 4],
    ['8.8.8.8', 4],
    ['2606:4700::1111', 6],
  ])('allows %s — instruments and on-prem gateways live on the LAN', (ip, family) => {
    expect(isBlockedAddress(ip as string, family as number)).toBe(false);
  });
});

describe('checkOutboundUrl', () => {
  it('rejects a blank/absent URL', async () => {
    expect((await checkOutboundUrl(undefined)).ok).toBe(false);
    expect((await checkOutboundUrl('   ')).ok).toBe(false);
  });

  it('rejects non-http(s) schemes', async () => {
    for (const u of ['file:///etc/passwd', 'gopher://x/', 'ftp://h/f']) {
      const r = await checkOutboundUrl(u);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/http or https/);
    }
  });

  it('rejects a URL resolving to loopback', async () => {
    const r = await checkOutboundUrl('http://localhost:3000/steal');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not allowed/);
  });

  it('rejects the cloud-metadata address by literal IP', async () => {
    const r = await checkOutboundUrl('http://169.254.169.254/latest/meta-data/');
    expect(r.ok).toBe(false);
  });

  it('allows a normal private-LAN gateway', async () => {
    const r = await checkOutboundUrl('https://192.168.1.53/sms/send');
    expect(r.ok).toBe(true);
  });
});

describe('hardenedFetch', () => {
  it('throws rather than calling out when the destination is blocked', async () => {
    await expect(hardenedFetch('http://169.254.169.254/latest/meta-data/'))
      .rejects.toThrow(/Blocked outbound request/);
  });
});
