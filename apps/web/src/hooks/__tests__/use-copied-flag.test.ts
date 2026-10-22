import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCopiedFlag } from '../use-copied-flag';
import { CLIPBOARD_COPY_RESET_MS } from '@/lib/timing-constants';

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('useCopiedFlag', () => {
  it('starts idle; show() sets the value and reverts it CLIPBOARD_COPY_RESET_MS later', () => {
    const { result } = renderHook(() => useCopiedFlag<string>(''));
    expect(result.current[0]).toBe('');
    act(() => result.current[1]('password'));
    expect(result.current[0]).toBe('password');
    act(() => { vi.advanceTimersByTime(CLIPBOARD_COPY_RESET_MS - 1); });
    expect(result.current[0]).toBe('password');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current[0]).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second show() restarts the delay: the first one\'s timer is cancelled, not left to fire', () => {
    const { result } = renderHook(() => useCopiedFlag<string>(''));
    act(() => result.current[1]('password'));
    act(() => { vi.advanceTimersByTime(1_500); });
    act(() => result.current[1]('username'));
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(600); }); // past the first show's 2 s
    expect(result.current[0]).toBe('username');
    act(() => { vi.advanceTimersByTime(CLIPBOARD_COPY_RESET_MS - 600); });
    expect(result.current[0]).toBe('');
  });

  it('reset() reverts at once and cancels the pending timer', () => {
    const { result } = renderHook(() => useCopiedFlag(false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    act(() => result.current[2]());
    expect(result.current[0]).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('unmounting cancels the pending timer, and a show() after unmount schedules none', () => {
    const { result, unmount } = renderHook(() => useCopiedFlag(false));
    act(() => result.current[1](true));
    expect(vi.getTimerCount()).toBe(1);
    const show = result.current[1];
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    // a clipboard write that resolves after the page closed
    show(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('show / reset keep their identity across renders (safe in effect and callback deps)', () => {
    const { result, rerender } = renderHook(() => useCopiedFlag(false));
    const [, show, reset] = result.current;
    act(() => show(true));
    rerender();
    expect(result.current[1]).toBe(show);
    expect(result.current[2]).toBe(reset);
  });
});
