/**
 * W4 hard-cutoff: read-only lockout after too long without server contact.
 * Uses the real server-contact module (localStorage-backed); time is faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setHardCutoffMs, getHardCutoffMs, isHardCutoffExceeded, subscribeToHardCutoff } from '../hard-cutoff';
import { markServerContactFromResponse, clearServerContact } from '../server-contact';

const H = 3600_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T08:00:00Z'));
  localStorage.clear();
  setHardCutoffMs(24 * H);
});
afterEach(() => { vi.useRealTimers(); });

describe('setHardCutoffMs / getHardCutoffMs', () => {
  it('accepts a positive finite window', () => {
    setHardCutoffMs(2 * H);
    expect(getHardCutoffMs()).toBe(2 * H);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('ignores %s (keeps the previous window)', (bad) => {
    setHardCutoffMs(3 * H);
    setHardCutoffMs(bad);
    expect(getHardCutoffMs()).toBe(3 * H);
  });
});

describe('isHardCutoffExceeded', () => {
  it('is false before any contact was ever recorded (fresh session)', () => {
    vi.setSystemTime(Date.now() + 100 * H);
    expect(isHardCutoffExceeded()).toBe(false);
  });

  it('is false inside the window and true once it has fully elapsed', () => {
    setHardCutoffMs(2 * H);
    markServerContactFromResponse({ status: 200 });
    vi.setSystemTime(Date.now() + 2 * H);
    expect(isHardCutoffExceeded()).toBe(false); // exactly at the edge: not yet
    vi.setSystemTime(Date.now() + 1);
    expect(isHardCutoffExceeded()).toBe(true);
  });

  it('a 5xx does not count as contact, a 4xx does', () => {
    setHardCutoffMs(1 * H);
    markServerContactFromResponse({ status: 200 });
    vi.setSystemTime(Date.now() + 2 * H);
    markServerContactFromResponse({ status: 502 });
    expect(isHardCutoffExceeded()).toBe(true);
    markServerContactFromResponse({ status: 401 });
    expect(isHardCutoffExceeded()).toBe(false);
  });
});

describe('subscribeToHardCutoff', () => {
  it('pushes the lockout state on every contact change, and stops after unsubscribe', () => {
    setHardCutoffMs(1 * H);
    const seen: boolean[] = [];
    const unsub = subscribeToHardCutoff((v) => seen.push(v));

    markServerContactFromResponse({ status: 200 });   // contact now -> not exceeded
    vi.setSystemTime(Date.now() + 2 * H);
    markServerContactFromResponse({ status: 503 });   // 5xx: no emit at all
    clearServerContact();                             // logout -> 0 -> not exceeded
    expect(seen).toEqual([false, false]);

    unsub();
    markServerContactFromResponse({ status: 200 });
    expect(seen).toEqual([false, false]);
  });

  it('fans out to several listeners and keeps the bridge until the LAST one leaves', () => {
    const a = vi.fn();
    const b = vi.fn();
    const ua = subscribeToHardCutoff(a);
    const ub = subscribeToHardCutoff(b);
    markServerContactFromResponse({ status: 204 });
    expect(a).toHaveBeenCalledWith(false);
    expect(b).toHaveBeenCalledWith(false);
    ua();
    markServerContactFromResponse({ status: 204 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    ub();
    // re-subscribing after the bridge was torn down builds a new one
    const c = vi.fn();
    const uc = subscribeToHardCutoff(c);
    markServerContactFromResponse({ status: 200 });
    expect(c).toHaveBeenCalledTimes(1);
    uc();
  });
});
