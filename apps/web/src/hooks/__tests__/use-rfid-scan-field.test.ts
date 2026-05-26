/**
 * Unit tests for useRfidScanField.
 *
 * Pins the three contracts:
 *   1) onKeyDown after >300ms idle clears the field BEFORE the next char
 *      is appended — the "second scan appended to first" tablet bug.
 *   2) onChange strips CR/LF/tab and trims whitespace.
 *   3) isDuplicate returns true only for the same value within 1000ms.
 *
 * The hook is consumed by:
 *   - mobile-wrapper.tsx RFID Assign view (existing input)
 *   - mobile-wrapper.tsx Filter Status → Scan RFID modal (new 2026-05-26)
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRfidScanField } from '../use-rfid-scan-field';

function makeKeyEvent(key: string, currentValue: string): React.KeyboardEvent<HTMLInputElement> {
  return {
    key,
    currentTarget: { value: currentValue } as any,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as any;
}

function makeChangeEvent(value: string): React.ChangeEvent<HTMLInputElement> {
  return { target: { value } } as any;
}

describe('useRfidScanField', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useRfidScanField());
    expect(result.current.value).toBe('');
  });

  it('setValue updates the controlled value', () => {
    const { result } = renderHook(() => useRfidScanField());
    act(() => result.current.setValue('TAG001'));
    expect(result.current.value).toBe('TAG001');
  });

  it('onChange strips CR/LF/tab characters', () => {
    const { result } = renderHook(() => useRfidScanField());
    act(() => result.current.onChange(makeChangeEvent('TAG001\r\n')));
    expect(result.current.value).toBe('TAG001');
  });

  it('onChange trims leading/trailing whitespace', () => {
    const { result } = renderHook(() => useRfidScanField());
    act(() => result.current.onChange(makeChangeEvent('   TAG001   ')));
    expect(result.current.value).toBe('TAG001');
  });

  it('onKeyDown after >300ms idle with a non-empty field clears it before onChange', () => {
    const { result } = renderHook(() => useRfidScanField());

    // First scan: populate
    act(() => result.current.onChange(makeChangeEvent('TAG001')));
    expect(result.current.value).toBe('TAG001');

    // Simulate idle time (force the internal lastKeyTimeRef to be old by
    // dispatching a key with the timer at 0 — that's how the hook
    // initializes lastKeyTimeRef anyway, so the first key in a NEW burst
    // will always be detected as "after idle").
    act(() => {
      result.current.onKeyDown(makeKeyEvent('T', 'TAG001'));
    });
    // Hook should have synchronously cleared the value
    expect(result.current.value).toBe('');
  });

  it('onKeyDown within 300ms of last key does NOT clear (mid-scan continuation)', () => {
    const { result } = renderHook(() => useRfidScanField());

    // First key resets the timer
    act(() => result.current.onKeyDown(makeKeyEvent('T', '')));
    act(() => result.current.onChange(makeChangeEvent('T')));

    // Second key immediately after — within the 300ms window
    act(() => result.current.onKeyDown(makeKeyEvent('A', 'T')));
    expect(result.current.value).toBe('T'); // still 'T', not cleared
  });

  it('onKeyDown ignores non-printable keys (Tab, Shift, Arrow keys)', () => {
    const { result } = renderHook(() => useRfidScanField());
    act(() => result.current.setValue('TAG001'));

    act(() => result.current.onKeyDown(makeKeyEvent('Shift', 'TAG001')));
    expect(result.current.value).toBe('TAG001'); // not cleared

    act(() => result.current.onKeyDown(makeKeyEvent('ArrowLeft', 'TAG001')));
    expect(result.current.value).toBe('TAG001'); // not cleared
  });

  it('onKeyDown with Enter resets the idle timer so the NEXT scan is recognised as new', () => {
    const { result } = renderHook(() => useRfidScanField());

    // Burst 1: type T-A-G fast, then Enter
    act(() => result.current.onKeyDown(makeKeyEvent('T', '')));
    act(() => result.current.onChange(makeChangeEvent('T')));
    act(() => result.current.onKeyDown(makeKeyEvent('A', 'T')));
    act(() => result.current.onChange(makeChangeEvent('TA')));
    act(() => result.current.onKeyDown(makeKeyEvent('G', 'TA')));
    act(() => result.current.onChange(makeChangeEvent('TAG')));
    act(() => result.current.onKeyDown(makeKeyEvent('Enter', 'TAG')));

    // Now (still within ms of the burst) the next printable key should
    // STILL trigger a clear because Enter reset the timer to 0.
    act(() => result.current.onKeyDown(makeKeyEvent('X', 'TAG')));
    expect(result.current.value).toBe('');
  });

  it('isDuplicate returns true on the same value submitted within 1000ms', () => {
    const { result } = renderHook(() => useRfidScanField());

    expect(result.current.isDuplicate('TAG001')).toBe(false);
    // Immediately again
    expect(result.current.isDuplicate('TAG001')).toBe(true);
    // Different value resets the dedupe
    expect(result.current.isDuplicate('TAG002')).toBe(false);
  });

  it('isDuplicate returns false after the 1000ms window', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useRfidScanField());

    expect(result.current.isDuplicate('TAG001')).toBe(false);

    // Advance past the dedupe window
    vi.advanceTimersByTime(1100);

    expect(result.current.isDuplicate('TAG001')).toBe(false);
    vi.useRealTimers();
  });

  it('isDuplicate returns false on empty input', () => {
    const { result } = renderHook(() => useRfidScanField());
    expect(result.current.isDuplicate('')).toBe(false);
    expect(result.current.isDuplicate('   ')).toBe(false); // whitespace counts as falsy after trim by caller
  });
});
