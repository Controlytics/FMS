/**
 * useDryerAutoFetch — instrument auto-fetch for the DRY_IN temperature reading.
 *
 * WHY THIS EXISTS (2026-08-10)
 * ---------------------------
 * Auto-fetch (Phase 4a) was wired into the *equipment dialog*, which collects
 * WASH_IN air/water pressure. The DRY_IN dryer temperature is NOT collected
 * there — it is collected in the "Currently Drying" countdown panel, a separate
 * component on each surface (`drying-filters-panel.tsx` on desktop, an inline
 * `DryingFilterCard` in `mobile-operations.tsx` on the tablet). Neither panel
 * ever called `/api/equipment-groups/fetch-readings`, so with auto-fetch enabled
 * on the equipment group the operator still got only the manual stepped
 * dropdown — "auto fetch works in Wash In but not in Dry In".
 *
 * The logic is a hook rather than copy-pasted into both panels because the last
 * pass through this feature learned the hard way that the tablet keeps its own
 * inline copy of every dialog — two hand-mirrored poll loops is how one surface
 * silently drifts from the other.
 *
 * 2026-09-04 (operator request, Dry In multi-select):
 *  - NO "Get Values" button any more. The fetch starts ON ITS OWN the moment the
 *    dryer reaches half time (`halfReached` flips true) — that is the earliest
 *    the server accepts a reading anyway. Pass `halfReached` from the countdown
 *    projection; the hook fires once per half-time crossing.
 *  - A fetched value is NO LONGER locked. The operator may change it; doing so
 *    flips the provenance from AUTO to AUTO_OVERRIDDEN, which the panels send to
 *    the server as `readingSources[instrumentId]` so the record shows both that
 *    the value was fetched and that it was changed. This deliberately reverses
 *    the 2026-08-10 read-only decision — the operator asked for it, with that
 *    consequence spelled out and accepted.
 *  - `getValues` is kept for an explicit re-read (a panel may offer "fetch
 *    again"); it is no longer required to get a value.
 *
 * Unchanged:
 *  - ONLINE ONLY. Offline the caller keeps the manual stepped dropdown (P5
 *    decision: offline = manual). `enabled` folds `online` in.
 *  - Polls for up to 1 MINUTE, 5s apart, until the value arrives. On timeout
 *    `timedOut` goes true and the panels fall back to the manual dropdown — a
 *    dead endpoint must never dead-end the operator.
 *  - Aborts cleanly on unmount so a closed panel can't keep polling.
 *  - An out-of-range fetched value is still submitted through the normal
 *    deviation confirmation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export type ReadingSource = 'MANUAL' | 'AUTO' | 'AUTO_OVERRIDDEN';

export interface DryerAutoFetchResult {
  /** Auto-fetch is configured for this instrument and the device is online. */
  isAuto: boolean;
  /**
   * Always false since 2026-09-04: a fetched value is editable. Kept on the
   * result so call sites that read it keep compiling; nothing should render
   * read-only off it any more.
   */
  locked: boolean;
  /** The 1-minute budget ran out with no value — panels fall back to manual. */
  timedOut: boolean;
  fetching: boolean;
  /** Human status line for the panel ("Fetching…", "Temperature fetched.", …). */
  status: string;
  /** Provenance of the CURRENT value for the temperature instrument. */
  source: ReadingSource;
  /** Every fetched DRY_IN instrument value, keyed by instrument id. */
  fetched: Record<string, number>;
  /** Explicit re-read of the instrument (optional affordance). */
  getValues: () => Promise<void>;
  /**
   * Call when the operator changes the value by hand. After a successful fetch
   * this flips the provenance to AUTO_OVERRIDDEN; before any fetch it is MANUAL.
   */
  markEdited: () => void;
  /** Clear fetch state (new cycle / new instrument). */
  reset: () => void;
}

export function useDryerAutoFetch(params: {
  filterId: string;
  /** The resolved equipment group (cycle pin → block fallback). */
  group: any | null;
  /** The DRY_IN temperature instrument resolved by findDryerTempInstrument. */
  dryerInstrument: any | null;
  online: boolean;
  /**
   * True once the dryer has reached half of its duration. The hook fetches on
   * its own when this flips true (once per crossing). Omit or pass false to
   * keep the hook passive (explicit `getValues` only).
   */
  halfReached?: boolean;
  /** Applies the fetched temperature to the panel's own `temp` state. */
  onValue: (value: number) => void;
}): DryerAutoFetchResult {
  const { filterId, group, dryerInstrument, online, halfReached = false, onValue } = params;
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState<ReadingSource>('MANUAL');
  const [fetched, setFetched] = useState<Record<string, number>>({});
  const [timedOut, setTimedOut] = useState(false);
  const cancelRef = useRef(false);
  const fetchingRef = useRef(false);
  // Fired automatically for this half-time crossing already? Reset when the
  // countdown goes back below half (a re-set duration / a new cycle).
  const autoFiredRef = useRef(false);
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;

  // A panel row unmounts as soon as the reading is submitted (the parent hides
  // it on dryerReadingsSubmitted). Without this the poll loop would keep firing
  // requests and calling setState on a dead component for up to a minute.
  useEffect(() => {
    cancelRef.current = false;
    return () => { cancelRef.current = true; };
  }, []);

  // Old EquipmentGroupVersion snapshots (pre-2026-06-13) carry no
  // `autoFetchEnabled` key at all. `=== true` treats that missing field as OFF,
  // which is the correct fallback: such a cycle gets the manual dropdown rather
  // than a fetch that could never resolve a responseKey.
  const isAuto = dryerInstrument?.autoFetchEnabled === true && online;

  const reset = useCallback(() => {
    setSource('MANUAL');
    setFetched({});
    setStatus('');
    setTimedOut(false);
    autoFiredRef.current = false;
  }, []);

  const markEdited = useCallback(() => {
    setSource((prev) => (prev === 'AUTO' ? 'AUTO_OVERRIDDEN' : prev));
  }, []);

  const getValues = useCallback(async () => {
    if (!isAuto || !group || !dryerInstrument || fetchingRef.current) return;
    cancelRef.current = false;
    fetchingRef.current = true;
    setTimedOut(false);
    setFetching(true);
    setStatus('Fetching dryer temperature…');
    const start = Date.now();
    let got = false;
    try {
      while (!got && (Date.now() - start) < 60_000) {
        if (cancelRef.current) return;
        let res: any = null;
        try {
          res = await apiClient.post<any>('/api/equipment-groups/fetch-readings', {
            filterId, groupId: group.id, stageKey: 'DRY_IN',
          });
        } catch { res = null; }
        if (cancelRef.current) return;
        // Keep EVERY auto instrument's value, not just the temperature one:
        // submit writes a reading for each DRY_IN instrument, and without this
        // the siblings fall back to `operatingMin` — a fabricated number
        // recorded as if it were measured.
        const next: Record<string, number> = {};
        for (const r of (res?.results ?? [])) {
          if (r?.ok && typeof r.value === 'number') next[r.instrumentId] = r.value;
        }
        if (Object.keys(next).length > 0) setFetched((prev) => ({ ...prev, ...next }));
        const temp = next[dryerInstrument.id];
        if (typeof temp === 'number') {
          onValueRef.current(temp);
          setSource('AUTO');
          got = true;
          break;
        }
        setStatus('No reading yet. Retrying…');
        await new Promise((r) => setTimeout(r, 5_000));
      }
    } finally {
      fetchingRef.current = false;
      if (!cancelRef.current) {
        setFetching(false);
        if (!got) setTimedOut(true);
        setStatus(got ? 'Temperature fetched from the instrument.' : "Couldn't fetch in 1 minute — enter the value manually.");
      }
    }
  }, [isAuto, group, dryerInstrument, filterId]);

  // Automatic trigger: once per half-time crossing.
  useEffect(() => {
    if (!halfReached) { autoFiredRef.current = false; return; }
    if (!isAuto || autoFiredRef.current) return;
    autoFiredRef.current = true;
    void getValues();
  }, [halfReached, isAuto, getValues]);

  return { isAuto, locked: false, timedOut, fetching, status, source, fetched, getValues, markEdited, reset };
}
