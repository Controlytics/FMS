/**
 * useSingleTab — one active tab / one user per browser.
 *
 * The hook coordinates tabs through SHARED localStorage keys plus the
 * `storage` event (it does not use BroadcastChannel). jsdom has one window, so
 * the "other tab" is simulated by `otherTab`, which does exactly what a second
 * browser tab does: writes the shared keys and the browser delivers a
 * StorageEvent to every OTHER tab. This tab's identity lives in sessionStorage
 * (`digilog_tab_id`), which is per-tab in a real browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSingleTab, checkExistingUserSession } from '../use-single-tab';

const K = { tab: 'digilog_active_tab_id', hb: 'digilog_tab_heartbeat', user: 'digilog_active_user_id', mine: 'digilog_tab_id' };

const otherTab = {
  claim(tabId: string, user?: { userId: string; username: string } | string, heartbeatAgoMs = 0) {
    localStorage.setItem(K.tab, tabId);
    localStorage.setItem(K.hb, String(Date.now() - heartbeatAgoMs));
    if (typeof user === 'string') localStorage.setItem(K.user, user);
    else if (user) localStorage.setItem(K.user, JSON.stringify({ ...user, tabId }));
  },
  /** What the browser delivers to THIS tab when another tab writes `key`. */
  notify(key: string, newValue: string | null) {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  },
};

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
  sessionStorage.setItem(K.mine, 'TAB-A');
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useSingleTab', () => {
  it('claims the browser when no other tab is active, then keeps a 1 s heartbeat', () => {
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(false);
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(JSON.parse(localStorage.getItem(K.user)!)).toEqual({ userId: 'u-1', username: 'alice', tabId: 'TAB-A' });
    const hb0 = Number(localStorage.getItem(K.hb));
    localStorage.removeItem(K.user); // heartbeat re-writes user data if it went missing
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(Number(localStorage.getItem(K.hb))).toBe(hb0 + 1_000);
    expect(localStorage.getItem(K.user)).not.toBeNull();
  });

  it('claims without writing user data when the user is not known yet', () => {
    renderHook(() => useSingleTab(true));
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(localStorage.getItem(K.user)).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(localStorage.getItem(K.user)).toBeNull();
  });

  it('is a duplicate when another tab of the SAME user is alive', () => {
    otherTab.claim('TAB-B', { userId: 'u-1', username: 'alice' }, 500);
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(true);
    expect(result.current.existingUserSession).toBeNull();
    expect(localStorage.getItem(K.tab)).toBe('TAB-B'); // did not steal the claim
    // and no heartbeat was started for a duplicate tab
    const hb = localStorage.getItem(K.hb);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(localStorage.getItem(K.hb)).toBe(hb);
  });

  it('reports the OTHER user when a different user is signed in elsewhere', () => {
    otherTab.claim('TAB-B', { userId: 'u-2', username: 'bob' }, 500);
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(true);
    expect(result.current.existingUserSession).toEqual({ userId: 'u-2', username: 'bob', tabId: 'TAB-B' });
  });

  it('still blocks on a live tab whose user record is corrupt', () => {
    otherTab.claim('TAB-B', '{corrupt', 500);
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(true);
    expect(result.current.existingUserSession).toBeNull();
  });

  it.each([
    ['a dead tab (heartbeat older than 3 s)', 3_500],
  ])('takes over from %s', (_l, ago) => {
    otherTab.claim('TAB-B', { userId: 'u-2', username: 'bob' }, ago);
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(false);
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(JSON.parse(localStorage.getItem(K.user)!).userId).toBe('u-1');
  });

  it('takes over from a tab that never wrote a heartbeat', () => {
    localStorage.setItem(K.tab, 'TAB-B');
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(false);
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
  });

  it('becomes the duplicate when another tab claims the browser later, and stops its heartbeat', () => {
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(false);
    act(() => {
      otherTab.claim('TAB-B', { userId: 'u-1', username: 'alice' });
      otherTab.notify(K.tab, 'TAB-B');
    });
    expect(result.current.isDuplicateTab).toBe(true);
    const hb = localStorage.getItem(K.hb);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(localStorage.getItem(K.hb)).toBe(hb); // our interval is gone
  });

  it('ignores storage events for other keys, for its own id, and for removals', () => {
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    act(() => {
      otherTab.notify(K.hb, '123');
      otherTab.notify(K.tab, 'TAB-A');
      otherTab.notify(K.tab, null);
    });
    expect(result.current.isDuplicateTab).toBe(false);
  });

  it('"Use this tab instead" takes the claim back', () => {
    otherTab.claim('TAB-B', { userId: 'u-1', username: 'alice' }, 100);
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    expect(result.current.isDuplicateTab).toBe(true);
    act(() => { result.current.claimActiveTab(); });
    expect(result.current.isDuplicateTab).toBe(false);
    expect(result.current.existingUserSession).toBeNull();
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(JSON.parse(localStorage.getItem(K.user)!).tabId).toBe('TAB-A');
  });

  it('claimActiveTab without a known user writes no user record', () => {
    otherTab.claim('TAB-B', undefined, 100);
    const { result } = renderHook(() => useSingleTab(true));
    act(() => { result.current.claimActiveTab(); });
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(localStorage.getItem(K.user)).toBeNull();
  });

  it('releaseTab clears the shared keys only when this tab owns them', () => {
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    otherTab.claim('TAB-B', { userId: 'u-2', username: 'bob' });
    act(() => { result.current.releaseTab(); });
    expect(localStorage.getItem(K.tab)).toBe('TAB-B');
    localStorage.setItem(K.tab, 'TAB-A');
    act(() => { result.current.releaseTab(); });
    expect(localStorage.getItem(K.tab)).toBeNull();
    expect(localStorage.getItem(K.hb)).toBeNull();
    expect(localStorage.getItem(K.user)).toBeNull();
  });

  it('signing out (isAuthenticated -> false) releases the claim and stops the heartbeat', () => {
    const { result, rerender } = renderHook(({ a }) => useSingleTab(a, 'u-1', 'alice'), { initialProps: { a: true } });
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    rerender({ a: false });
    expect(result.current.isDuplicateTab).toBe(false);
    expect(localStorage.getItem(K.tab)).toBeNull();
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(localStorage.getItem(K.hb)).toBeNull();
  });

  it('unmounting releases the claim', () => {
    const { unmount } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    unmount();
    expect(localStorage.getItem(K.tab)).toBeNull();
  });

  it('a tab coming back to the foreground refreshes its claim (not when it is the duplicate)', () => {
    const { result } = renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    localStorage.removeItem(K.tab);
    localStorage.removeItem(K.user);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(JSON.parse(localStorage.getItem(K.user)!).userId).toBe('u-1');

    act(() => { otherTab.claim('TAB-B'); otherTab.notify(K.tab, 'TAB-B'); });
    expect(result.current.isDuplicateTab).toBe(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.getItem(K.tab)).toBe('TAB-B');
  });

  it('a foreground refresh without a known user writes only the tab id + heartbeat', () => {
    renderHook(() => useSingleTab(true));
    localStorage.clear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.getItem(K.tab)).toBe('TAB-A');
    expect(localStorage.getItem(K.user)).toBeNull();
  });

  it('a hidden visibilitychange does not touch the claim', () => {
    renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    localStorage.clear();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(localStorage.getItem(K.tab)).toBeNull();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('creates and persists a tab id when this tab has none yet', () => {
    sessionStorage.clear();
    renderHook(() => useSingleTab(true, 'u-1', 'alice'));
    const id = sessionStorage.getItem(K.mine);
    expect(id).toMatch(/^[a-z0-9]+_\d+$/);
    expect(localStorage.getItem(K.tab)).toBe(id);
  });
});

describe('checkExistingUserSession (login page pre-check)', () => {
  it('is null when nothing is recorded', () => {
    expect(checkExistingUserSession()).toBeNull();
  });

  it('is null when only some keys exist', () => {
    localStorage.setItem(K.tab, 'TAB-B');
    localStorage.setItem(K.hb, String(Date.now()));
    expect(checkExistingUserSession()).toBeNull();
  });

  it('is null when the active tab is this one', () => {
    otherTab.claim('TAB-A', { userId: 'u-1', username: 'alice' });
    expect(checkExistingUserSession()).toBeNull();
  });

  it('returns the live other user', () => {
    otherTab.claim('TAB-B', { userId: 'u-2', username: 'bob' }, 1_000);
    expect(checkExistingUserSession()).toEqual({ userId: 'u-2', username: 'bob', tabId: 'TAB-B' });
  });

  it('cleans up a dead session and returns null', () => {
    otherTab.claim('TAB-B', { userId: 'u-2', username: 'bob' }, 3_000);
    expect(checkExistingUserSession()).toBeNull();
    expect(localStorage.getItem(K.tab)).toBeNull();
    expect(localStorage.getItem(K.hb)).toBeNull();
    expect(localStorage.getItem(K.user)).toBeNull();
  });

  it('returns null for a corrupt user record', () => {
    otherTab.claim('TAB-B', 'not-json', 0);
    expect(checkExistingUserSession()).toBeNull();
  });
});
