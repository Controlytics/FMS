import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  markServerContactFromResponse,
  clearServerContact,
  getLastServerContact,
  subscribeToServerContact,
} from '../server-contact';

/**
 * server-contact.ts — the W4 hard-cutoff clock. Real jsdom localStorage; the
 * only stubs are `Storage.prototype` methods made to throw, which is how a
 * private-mode / quota-exhausted WebView behaves.
 */

const KEY = 'digilog_last_server_contact';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('markServerContactFromResponse — the < 500 rule', () => {
  it.each([200, 204, 302, 401, 403, 404, 422, 429, 499])('status %i counts as contact', (status) => {
    markServerContactFromResponse({ status });
    expect(localStorage.getItem(KEY)).toBe(String(Date.parse('2026-10-21T08:00:00Z')));
    expect(getLastServerContact()).toBe(Date.parse('2026-10-21T08:00:00Z'));
  });

  it.each([500, 502, 503, 504])('status %i does NOT count (proxy "upstream unreachable" looks like this)', (status) => {
    markServerContactFromResponse({ status });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getLastServerContact()).toBe(0);
  });

  it('a later contact overwrites the earlier timestamp', () => {
    markServerContactFromResponse({ status: 200 });
    vi.setSystemTime(new Date('2026-10-21T09:30:00Z'));
    markServerContactFromResponse({ status: 200 });
    expect(getLastServerContact()).toBe(Date.parse('2026-10-21T09:30:00Z'));
  });
});

describe('subscribeToServerContact', () => {
  it('fires on every contact and on clear (0), and stops after unsubscribe', () => {
    const seen: number[] = [];
    const off = subscribeToServerContact((t) => seen.push(t));
    markServerContactFromResponse({ status: 200 });
    markServerContactFromResponse({ status: 503 }); // no contact → no event
    clearServerContact();
    off();
    markServerContactFromResponse({ status: 200 });
    expect(seen).toEqual([Date.parse('2026-10-21T08:00:00Z'), 0]);
  });

  it('is not invoked immediately on subscribe', () => {
    markServerContactFromResponse({ status: 200 });
    const cb = vi.fn();
    const off = subscribeToServerContact(cb);
    expect(cb).not.toHaveBeenCalled();
    off();
  });
});

describe('clearServerContact', () => {
  it('removes the stored timestamp', () => {
    markServerContactFromResponse({ status: 200 });
    clearServerContact();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getLastServerContact()).toBe(0);
  });
});

describe('getLastServerContact — malformed storage', () => {
  it.each([
    ['missing', null],
    ['empty', ''],
    ['not a number', 'yesterday'],
    ['zero', '0'],
    ['negative', '-5'],
    ['Infinity', 'Infinity'],
  ])('%s → 0', (_label, raw) => {
    if (raw !== null) localStorage.setItem(KEY, raw);
    expect(getLastServerContact()).toBe(0);
  });

  it('a valid positive number is returned as-is', () => {
    localStorage.setItem(KEY, '1700000000000');
    expect(getLastServerContact()).toBe(1700000000000);
  });
});

describe('storage unavailable (private mode / quota) — listeners still fire', () => {
  it('setItem throwing: subscribers are still told about the contact', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const cb = vi.fn();
    const off = subscribeToServerContact(cb);
    expect(() => markServerContactFromResponse({ status: 200 })).not.toThrow();
    expect(cb).toHaveBeenCalledWith(Date.parse('2026-10-21T08:00:00Z'));
    off();
  });

  it('removeItem throwing: clear still notifies 0', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const cb = vi.fn();
    const off = subscribeToServerContact(cb);
    expect(() => clearServerContact()).not.toThrow();
    expect(cb).toHaveBeenCalledWith(0);
    off();
  });

  it('getItem throwing → 0, never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(getLastServerContact()).toBe(0);
  });
});
