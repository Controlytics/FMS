/**
 * Global RFID keystroke guard. Key timing is driven with a faked Date (only Date —
 * the guard reads Date.now() and uses no timers). Each keydown is dispatched on a
 * real focused input; `defaultPrevented` is what stops the character landing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import { useRfidGuard } from '../use-rfid-guard';

let now = 0;
let hook: ReturnType<typeof renderHook>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  now = Date.parse('2026-10-21T08:00:00.000Z');
  vi.setSystemTime(now);
  hook = renderHook(() => useRfidGuard());
});
afterEach(() => { hook.unmount(); vi.useRealTimers(); });

function key(target: Element, k: string | undefined, gapMs: number) {
  now += gapMs;
  vi.setSystemTime(now);
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev.defaultPrevented;
}

function fields() {
  const view = render(<div><input aria-label="Remarks" /><input aria-label="Tag" data-rfid="true" /></div>);
  return { remarks: view.getByLabelText('Remarks'), tag: view.getByLabelText('Tag') };
}

describe('useRfidGuard', () => {
  it('lets human-speed typing through untouched', () => {
    const { remarks } = fields();
    const blocked = [...'wash ok'].map((c) => key(remarks, c, 150));
    expect(blocked.every((b) => b === false)).toBe(true);
    // WSH-RFID-2: a person's Enter 150 ms after their own typing must reach the form
    // (it used to be swallowed: the Enter check was only "< 200 ms since the last key").
    expect(key(remarks, 'Enter', 150)).toBe(false);
    expect(key(remarks, 'Enter', 400)).toBe(false);
  });

  it('human typing right after a blocked burst is the operator again: their quick Enter passes', () => {
    const { remarks } = fields();
    for (const c of 'E2801160') key(remarks, c, 10);
    expect(key(remarks, 'Enter', 20)).toBe(true);       // the reader's own Enter
    for (const c of 'ok') key(remarks, c, 300);          // the operator types…
    expect(key(remarks, 'Enter', 120)).toBe(false);      // …and presses Enter promptly
  });

  it('an Enter more than 200 ms after the last BLOCKED key passes even if fast keys came before', () => {
    const { remarks } = fields();
    for (const c of 'E280') key(remarks, c, 10);         // keys 3-4 blocked
    expect(key(remarks, 'Enter', 250)).toBe(false);
  });

  it('blocks a reader burst in an ordinary field from the third fast key on, and the Enter that ends it', () => {
    const { remarks } = fields();
    const blocked = [...'E2801160'].map((c) => key(remarks, c, 10));
    // Keys 1-2 are not asserted: detection needs three keys of history, so today they
    // land in the field (WSH-RFID-1, a timing-based limitation). Pinning that would
    // fail a future fix (e.g. buffering) for no reason.
    expect(blocked.slice(2)).toEqual([true, true, true, true, true, true]);
    expect(key(remarks, 'Enter', 20)).toBe(true);
  });

  it('an RFID field (data-rfid="true") receives the whole burst and its Enter', () => {
    const { tag } = fields();
    expect([...'E2801160'].map((c) => key(tag, c, 10)).some(Boolean)).toBe(false);
    expect(key(tag, 'Enter', 10)).toBe(false);
  });

  it('an Enter long after the burst is the operator’s own and passes', () => {
    const { remarks } = fields();
    for (const c of 'E2801160') key(remarks, c, 10);
    expect(key(remarks, 'Enter', 500)).toBe(false);
  });

  it('after the RFID Enter the history is cleared, so the next Enter is not blocked', () => {
    const { remarks } = fields();
    for (const c of 'E2801160') key(remarks, c, 10);
    expect(key(remarks, 'Enter', 20)).toBe(true);
    expect(key(remarks, 'Enter', 20)).toBe(false);
  });

  it('a pause inside the last three keys means a human, not a reader', () => {
    const { remarks } = fields();
    expect(key(remarks, 'a', 10)).toBe(false);
    expect(key(remarks, 'b', 10)).toBe(false);
    expect(key(remarks, 'c', 200)).toBe(false);
    expect(key(remarks, 'd', 10)).toBe(false); // gaps 200, 10: still contains the slow one
  });

  it('a lone Enter with almost no history is never blocked', () => {
    const { remarks } = fields();
    key(remarks, 'a', 10);
    expect(key(remarks, 'Enter', 10)).toBe(false);
  });

  it('non-printable keys and the key-less keydown Chrome sends on autofill are ignored (no throw)', () => {
    const { remarks } = fields();
    expect(() => key(remarks, undefined, 1)).not.toThrow();
    expect(key(remarks, 'Shift', 1)).toBe(false);
    expect(key(remarks, 'ArrowLeft', 1)).toBe(false);
    expect(key(remarks, 'Tab', 1)).toBe(false);
  });

  it('keeps only recent history: a long human session still detects the next burst', () => {
    const { remarks } = fields();
    for (const c of 'abcdefghijklmnop') key(remarks, c, 150);
    const blocked = [...'3000E28'].map((c) => key(remarks, c, 5));
    expect(blocked.slice(2).every(Boolean)).toBe(true);
  });

  it('unmounting removes the guard', () => {
    const { remarks } = fields();
    hook.unmount();
    expect([...'E2801160'].map((c) => key(remarks, c, 10)).some(Boolean)).toBe(false);
    hook = renderHook(() => undefined);
  });
});
