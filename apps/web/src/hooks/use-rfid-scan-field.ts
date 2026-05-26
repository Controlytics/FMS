/**
 * useRfidScanField — controlled-input helpers for RFID scan fields.
 *
 * 2026-05-26 — built in response to a tablet bug on the RFID Assign page:
 * scanning a second RFID tag without clearing the field first concatenated
 * the new tag onto the existing value (TAG001 + TAG002 → "TAG001TAG002").
 * Root cause: a plain controlled `<input value={state} onChange=…>` has no
 * notion of "a new scan is starting" — every keystroke just appends.
 *
 * Behavior:
 *
 *  1) Auto-clear at the start of a new scan burst.
 *     If the user/scanner emits a printable key after >300ms of input idle
 *     AND the field already holds a value, we set value to '' BEFORE the
 *     onChange fires. The first character of the new burst then becomes the
 *     new value's first character (not appended).
 *
 *  2) Trim CR/LF/tabs/leading-trailing whitespace on every change.
 *     RFID readers in UKB mode sometimes emit \r, \n, or both at the end of
 *     a scan. The trim ensures consumers see a clean tag value.
 *
 *  3) Duplicate-submit guard via isDuplicate(value).
 *     Some readers double-fire on a single physical scan (especially when
 *     the operator's hand is unsteady). isDuplicate returns true if the
 *     exact same value was submitted within the last 1000ms. Callers should
 *     skip their submit when it returns true. Successful submits update
 *     the dedupe ref so the next distinct scan goes through.
 *
 * Usage:
 *
 *   const rfid = useRfidScanField();
 *   ...
 *   <input
 *     data-rfid="true"
 *     value={rfid.value}
 *     onKeyDown={rfid.onKeyDown}
 *     onChange={rfid.onChange}
 *     autoFocus
 *   />
 *   <button onClick={() => {
 *     const tag = rfid.value;
 *     if (rfid.isDuplicate(tag)) return;
 *     submit(tag);
 *     rfid.setValue('');
 *   }}>Assign</button>
 */
import { useCallback, useRef, useState } from 'react';

interface UseRfidScanField {
  value: string;
  setValue: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /**
   * Returns true if `value` was submitted within the dedupe window
   * (defaults to 1000ms). Caller should NOT proceed with the submit
   * when this returns true. On first-time / distinct submits, returns
   * false and arms the dedupe ref for the next call.
   */
  isDuplicate: (value: string) => boolean;
}

// Gap between keystrokes that signals "this is a NEW scan burst, not a
// continuation of the old one". Tuned for KC-series UHF readers in UKB
// mode which emit characters at 3-50ms intervals during a scan and
// require at least ~1s between scans physically. 300ms catches the new
// scan while never tripping mid-scan.
const NEW_SCAN_IDLE_MS = 300;

// Window within which an identical value is treated as a duplicate submit.
// Bigger than NEW_SCAN_IDLE_MS so that a duplicate physical scan (~600ms
// apart) is also caught, but smaller than typical operator scan cadence.
const DUPLICATE_SUBMIT_MS = 1000;

export function useRfidScanField(): UseRfidScanField {
  const [value, setValueState] = useState('');
  const lastKeyTimeRef = useRef(0);
  const lastSubmitRef = useRef<{ value: string; time: number }>({ value: '', time: 0 });

  // Wrap setState so callers (and `Assign` button handlers that clear the
  // field after a successful submit) reset the dedupe ref window too —
  // otherwise the next scan of the same physical tag would be treated as
  // a duplicate just because the timestamp is still warm.
  const setValue = useCallback((v: string) => {
    setValueState(v);
    if (v === '') {
      lastKeyTimeRef.current = 0;
    }
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only printable keys signal "a character is being added". Enter,
    // arrow keys, modifier keys etc don't count — let them pass through.
    if (e.key.length !== 1) {
      // Reset timer on Enter so the scan AFTER an Enter-terminated burst
      // still trips the new-scan-burst clear (otherwise the scanner's
      // post-Enter pause would NOT count as idle).
      if (e.key === 'Enter') lastKeyTimeRef.current = 0;
      return;
    }

    const now = Date.now();
    const gap = now - lastKeyTimeRef.current;
    // Reset the field BEFORE the onChange fires so the new burst's first
    // char becomes the only char, not an append to the old value.
    if (gap > NEW_SCAN_IDLE_MS && e.currentTarget.value.length > 0) {
      setValueState('');
    }
    lastKeyTimeRef.current = now;
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Strip CR/LF/tab and leading/trailing whitespace as the value flows
    // in. RFID readers in UKB mode often append \r or \n at end-of-scan;
    // some prepend a leading space. Consumers always see a clean tag.
    const cleaned = e.target.value.replace(/[\r\n\t]/g, '').replace(/^\s+|\s+$/g, '');
    setValueState(cleaned);
  }, []);

  const isDuplicate = useCallback((submitted: string) => {
    if (!submitted) return false;
    const now = Date.now();
    const isDup =
      submitted === lastSubmitRef.current.value &&
      now - lastSubmitRef.current.time < DUPLICATE_SUBMIT_MS;
    if (!isDup) {
      lastSubmitRef.current = { value: submitted, time: now };
    }
    return isDup;
  }, []);

  return { value, setValue, onKeyDown, onChange, isDuplicate };
}
