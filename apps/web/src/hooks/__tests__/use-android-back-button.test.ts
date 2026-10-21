/**
 * useAndroidBackButton — routes the Android back button to a JS handler.
 *
 * Boundary mocked: the `@capacitor/app` plugin module (vi.doMock), the narrowest
 * seam — the hook's own subscribe / latest-handler / teardown logic runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

type Listener = () => void;
let listeners: Listener[];
let removed: number;
let addListener: ReturnType<typeof vi.fn>;

async function loadHook(mod: () => Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@capacitor/app', mod);
  return (await import('../use-android-back-button')).useAndroidBackButton;
}

// Delegates to the CURRENT `addListener`, so a test may swap it before loading the hook.
const plugin = () => ({ App: { addListener: (evt: string, cb: Listener) => addListener(evt, cb) } });

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  listeners = [];
  removed = 0;
  addListener = vi.fn(async (_evt: string, cb: Listener) => {
    listeners.push(cb);
    return { remove: () => { removed++; } };
  });
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.doUnmock('@capacitor/app');
  vi.restoreAllMocks();
});

describe('useAndroidBackButton', () => {
  it('subscribes once to backButton and calls the LATEST handler on each press', async () => {
    const useAndroidBackButton = await loadHook(plugin);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ h }) => useAndroidBackButton(h), { initialProps: { h: first } });
    await waitFor(() => expect(addListener).toHaveBeenCalledTimes(1));
    expect(addListener.mock.calls[0][0]).toBe('backButton');

    listeners[0]();
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ h: second });
    listeners[0]();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledTimes(1); // not re-subscribed on re-render
  });

  it('removes the native listener on unmount', async () => {
    const useAndroidBackButton = await loadHook(plugin);
    const { unmount } = renderHook(() => useAndroidBackButton(vi.fn()));
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    await Promise.resolve();
    unmount();
    expect(removed).toBe(1);
  });

  it('tears the listener down at once when unmounted before the subscribe resolved', async () => {
    let resolveSub!: (h: unknown) => void;
    addListener = vi.fn((_evt: string, cb: Listener) => {
      listeners.push(cb);
      return new Promise((r) => { resolveSub = r; });
    });
    const useAndroidBackButton = await loadHook(plugin);
    const { unmount } = renderHook(() => useAndroidBackButton(vi.fn()));
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    unmount();
    expect(removed).toBe(0);
    resolveSub({ remove: () => { removed++; } });
    await waitFor(() => expect(removed).toBe(1));
  });

  it('swallows a throwing remove() on both teardown paths', async () => {
    addListener = vi.fn(async () => ({ remove: () => { throw new Error('bridge gone'); } }));
    const useAndroidBackButton = await loadHook(plugin);
    const { unmount } = renderHook(() => useAndroidBackButton(vi.fn()));
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    await Promise.resolve();
    expect(() => unmount()).not.toThrow();

    let resolveSub!: (h: unknown) => void;
    addListener = vi.fn(() => new Promise((r) => { resolveSub = r; }));
    const hook2 = await loadHook(plugin);
    const r2 = renderHook(() => hook2(vi.fn()));
    await waitFor(() => expect(addListener).toHaveBeenCalled());
    r2.unmount();
    resolveSub({ remove: () => { throw new Error('bridge gone'); } });
    await Promise.resolve();
    await Promise.resolve();
  });

  it('is a silent no-op on a plain web build where the plugin cannot load', async () => {
    const useAndroidBackButton = await loadHook(() => { throw new Error('plugin missing'); });
    const handler = vi.fn();
    const { unmount } = renderHook(() => useAndroidBackButton(handler));
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });
});
