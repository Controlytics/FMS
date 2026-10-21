/**
 * useSession — idle auto-logout with a warning countdown.
 * Fake timers drive both Date.now() and the 1 s check interval.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from '../use-session';

const cfg = { autoLogoutEnabled: true, idleTimeoutMinutes: 5, warningMinutes: 1 }; // warning at 4:00 idle

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('useSession', () => {
  it('stays quiet before the warning threshold', () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() => useSession(cfg, onLogout));
    tick(3 * 60_000 + 58_000);
    expect(result.current.showWarning).toBe(false);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('shows the warning at (idle - warning) minutes, counts down, and logs out when it runs out', () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() => useSession(cfg, onLogout));
    tick(4 * 60_000);
    expect(result.current.showWarning).toBe(true);
    expect(result.current.countdown).toBe(60);
    tick(15_000);
    expect(result.current.countdown).toBe(45);
    tick(45_000);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(result.current.showWarning).toBe(false);
    // the interval is cleared after logout — no second call
    tick(10 * 60_000);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('user activity before the warning resets the idle clock', () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() => useSession(cfg, onLogout));
    tick(3 * 60_000);
    act(() => { window.dispatchEvent(new Event('keydown')); });
    tick(3 * 60_000);
    expect(result.current.showWarning).toBe(false); // only 3 min since the key press
    tick(60_000);
    expect(result.current.showWarning).toBe(true);
  });

  it.each(['mousedown', 'scroll', 'touchstart', 'click'])('%s counts as activity', (evt) => {
    const { result } = renderHook(() => useSession(cfg, vi.fn()));
    tick(3 * 60_000 + 30_000);
    act(() => { window.dispatchEvent(new Event(evt)); });
    tick(60_000);
    expect(result.current.showWarning).toBe(false);
  });

  it('activity during the warning does NOT cancel it — only Continue does', () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() => useSession(cfg, onLogout));
    tick(4 * 60_000);
    expect(result.current.showWarning).toBe(true);
    act(() => { window.dispatchEvent(new Event('mousedown')); });
    tick(30_000);
    expect(result.current.showWarning).toBe(true);
    expect(result.current.countdown).toBe(30);

    act(() => { result.current.continueSession(); });
    expect(result.current.showWarning).toBe(false);
    expect(result.current.countdown).toBe(0);
    tick(3 * 60_000);
    expect(result.current.showWarning).toBe(false);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('a tab returning to visible after a long sleep is checked immediately', () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() => useSession(cfg, onLogout));
    // Background tabs throttle setInterval; simulate wall-clock time passing without ticks.
    act(() => { vi.setSystemTime(Date.now() + 4 * 60_000 + 5_000); });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.showWarning).toBe(true);
  });

  it('a hidden visibilitychange does nothing', () => {
    const { result } = renderHook(() => useSession(cfg, vi.fn()));
    act(() => { vi.setSystemTime(Date.now() + 4 * 60_000 + 5_000); });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current.showWarning).toBe(false);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('does nothing when auto-logout is disabled or the config has not loaded', () => {
    const onLogout = vi.fn();
    const off = renderHook(() => useSession({ ...cfg, autoLogoutEnabled: false }, onLogout));
    const none = renderHook(() => useSession(null, onLogout));
    tick(60 * 60_000);
    expect(off.result.current.showWarning).toBe(false);
    expect(none.result.current.showWarning).toBe(false);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('turning auto-logout off while the warning shows hides it', () => {
    const onLogout = vi.fn();
    const { result, rerender } = renderHook(({ c }) => useSession(c, onLogout), { initialProps: { c: cfg as typeof cfg | null } });
    tick(4 * 60_000);
    expect(result.current.showWarning).toBe(true);
    rerender({ c: { ...cfg, autoLogoutEnabled: false } });
    expect(result.current.showWarning).toBe(false);
    tick(5 * 60_000);
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('calls the LATEST onLogout callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSession(cfg, cb), { initialProps: { cb: first } });
    rerender({ cb: second });
    tick(5 * 60_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('removes its listeners on unmount', () => {
    const removeWin = vi.spyOn(window, 'removeEventListener');
    const removeDoc = vi.spyOn(document, 'removeEventListener');
    const onLogout = vi.fn();
    const { unmount } = renderHook(() => useSession(cfg, onLogout));
    unmount();
    const winEvents = removeWin.mock.calls.map((c) => c[0]);
    expect(winEvents).toEqual(expect.arrayContaining(['mousedown', 'keydown', 'scroll', 'touchstart', 'click']));
    expect(removeDoc.mock.calls.map((c) => c[0])).toContain('visibilitychange');
    tick(10 * 60_000);
    expect(onLogout).not.toHaveBeenCalled();
  });
});
