import { useCallback, useEffect, useRef, useState } from 'react';
import { CLIPBOARD_COPY_RESET_MS } from '@/lib/timing-constants';

/**
 * The "Copied" confirmation after a clipboard write: `show(value)` sets it and
 * it reverts to `idle` CLIPBOARD_COPY_RESET_MS later; `reset()` reverts it now.
 *
 * ONE timer per indicator, held in a ref. Each copy button used to start a bare
 * `setTimeout(() => setCopied(idle), …)` and never clear it, so a second copy
 * inside the window was reverted by the FIRST copy's timer — its confirmation
 * vanished early, and on Admin Requests (one value shared by the User ID and
 * password buttons) one field's timer wiped the other's. `show()` restarts the
 * delay; `reset()` and unmount cancel it (2026-10-22).
 */
export function useCopiedFlag<T>(idle: T) {
  const [value, setValue] = useState<T>(idle);
  const idleRef = useRef(idle);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A clipboard write can resolve after the page has closed; no timer then.
  const mounted = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, [cancel]);

  const show = useCallback((next: T) => {
    if (!mounted.current) return;
    cancel();
    setValue(next);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setValue(idleRef.current);
    }, CLIPBOARD_COPY_RESET_MS);
  }, [cancel]);

  const reset = useCallback(() => {
    cancel();
    setValue(idleRef.current);
  }, [cancel]);

  return [value, show, reset] as const;
}
