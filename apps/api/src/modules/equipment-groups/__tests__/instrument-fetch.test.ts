import { describe, it, expect } from 'vitest';
import { fetchReadingObject, isBlockedAddress } from '../instrument-fetch.js';

// This module had NO test coverage while being one of the few places the server
// fetches an admin-typed URL. It was refactored 2026-08-18 to consume the shared
// guard in lib/ssrf.ts (SAST-01); these lock the externally-visible behaviour so
// a future edit cannot quietly drop the guard.

describe('instrument-fetch — SSRF behaviour', () => {
  it('re-exports isBlockedAddress at module scope (its original home)', () => {
    expect(typeof isBlockedAddress).toBe('function');
    expect(isBlockedAddress('169.254.169.254', 4)).toBe(true);
    expect(isBlockedAddress('192.168.1.53', 4)).toBe(false);
  });

  it('refuses an empty / missing URL without calling out', async () => {
    expect(await fetchReadingObject(undefined)).toEqual({ ok: false, error: 'No URL configured' });
    expect(await fetchReadingObject('  ')).toEqual({ ok: false, error: 'No URL configured' });
  });

  it('refuses a non-http(s) scheme', async () => {
    const r = await fetchReadingObject('file:///etc/passwd');
    expect(r).toEqual({ ok: false, error: 'URL must use http or https' });
  });

  it('refuses the cloud-metadata address', async () => {
    const r = await fetchReadingObject('http://169.254.169.254/latest/meta-data/');
    expect(r).toEqual({ ok: false, error: 'Destination address not allowed' });
  });

  it('refuses loopback (the server proxying into itself)', async () => {
    const r = await fetchReadingObject('http://127.0.0.1:3000/api/users');
    expect(r).toEqual({ ok: false, error: 'Destination address not allowed' });
  });

  it('never throws — callers rely on the result shape', async () => {
    for (const u of ['not a url', 'http://', 'https://nonexistent.invalid/x']) {
      const r = await fetchReadingObject(u);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(typeof r.error).toBe('string');
    }
  });
});
