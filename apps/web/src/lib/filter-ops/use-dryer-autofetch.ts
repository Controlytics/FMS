/**
 * useDryerAutoFetch — instrument auto-fetch for the DRY_IN temperature reading.
 *
 * WHY THIS EXISTS (2026-08-10)
 * ---------------------------
 * Auto-fetch (Phase 4a) was wired into the *equipment dialog*, which collects
 * WASH_IN air/water pressure. The DRY_IN dryer temperature is NOT collected
 * there — it is collected in the "Currently Drying" countdown panel, a separate
 * component on each surface (`drying-filters-panel.tsx` on desktop, an inline
 * `DryingRow` in `mobile-operations.tsx` on the tablet). Neither panel ever
 * called `/api/equipment-groups/fetch-readings`, so with auto-fetch enabled on
 * the equipment group the operator still got only the manual stepped dropdown —
 * "auto fetch works in Wash In but not in Dry In".
 *
 * Nothing was wrong on the server: `fetchStageReadings` accepts `DRY_IN`
 * explicitly and `resolveStageContext` filters instruments by `stageKey`. This
 * is purely the missing client call.
 *
 * The logic is a hook rather than copy-pasted into both panels because the last
 * pass through this feature learned the hard way that the tablet keeps its own
 * inline copy of every dialog — two hand-mirrored poll loops is how one surface
 * silently drifts from the other.
 *
 * Behaviour mirrors `handleGetValuesMobile` in the equipment dialog exactly:
 *  - ONLINE ONLY. Offline the caller keeps the manual stepped dropdown (P5
 *    decision: offline = manual). `enabled` folds `online` in.
 *  - Polls for up to 2 minutes, 5s apart, until the value arrives.
 *  - Aborts cleanly on unmount so a closed panel can't keep polling.
 *  - Provenance: AUTO on a fetched value, AUTO_OVERRIDDEN once the operator
 *    edits it (matches the badges the equipment dialog shows).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export type ReadingSource = 'MANUAL' | 'AUTO' | 'AUTO_OVERRIDDEN';

export interface DryerAutoFetchResult {
  /** Show the "Get Values" button + free numeric input instead of the dropdown. */
  isAuto: boolean;
  fetching: boolean;
  status: string;
  source: ReadingSource;
  /** Values keyed by instrumentId for EVERY auto DRY_IN instrument fetched. */
  fetched: Record<string, number>;
  getValues: () => Promise<void>;
  /** Call when the operator types over a fetched value. */
  markEdited: () => void;
  reset: () => void;
}

export function useDryerAutoFetch(params: {
  filterId: string;
  /** The resolved equipment group (cycle pin → block fallback). */
  group: any | null;
  /** The DRY_IN temperature instrument resolved by findDryerTempInstrument. */
  dryerInstrument: any | null;
  online: boolean;
  /** Applies the fetched temperature to the panel's own `temp` state. */
  onValue: (value: number) => void;
}): DryerAutoFetchResult {
  const { filterId, group, dryerInstrument, online, onValue } = params;
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState<ReadingSource>('MANUAL');
  const [fetched, setFetched] = useState<Record<string, number>>({});
  const cancelRef = useRef(false);

  // A panel row unmounts as soon as the reading is submitted (the parent hides
  // it on dryerReadingsSubmitted). Without this the poll loop would keep firing
  // requests and calling setState on a dead component for up to two minutes.
  useEffect(() => {
    cancelRef.current = false;
    return () => { cancelRef.current = true; };
  }, []);

  // Old EquipmentGroupVersion snapshots (pre-2026-06-13) carry no
  // `autoFetchEnabled` key at all. `=== true` treats that missing field as OFF,
  // which is the correct fallback: such a cycle gets the manual dropdown rather
  // than a button that could never resolve a responseKey.
  const isAuto = dryerInstrument?.autoFetchEnabled === true && online;

  const reset = useCallback(() => {
    setSource('MANUAL');
    setFetched({});
    setStatus('');
  }, []);

  const markEdited = useCallback(() => {
    setSource((s) => (s === 'AUTO' ? 'AUTO_OVERRIDDEN' : s));
  }, []);

  const getValues = useCallback(async () => {
    if (!isAuto || !group || !dryerInstrument || fetching) return;
    cancelRef.current = false;
    setFetching(true);
    setStatus('Fetching dryer temperature…');
    const start = Date.now();
    let got = false;
    try {
      while (!got && (Date.now() - start) < 120_000) {
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
          onValue(temp);
          setSource('AUTO');
          got = true;
          break;
        }
        setStatus('No reading yet. Retrying…');
        await new Promise((r) => setTimeout(r, 5_000));
      }
    } finally {
      if (!cancelRef.current) {
        setFetching(false);
        setStatus(got ? 'Temperature fetched.' : "Couldn't fetch — enter manually.");
      }
    }
  }, [isAuto, group, dryerInstrument, fetching, filterId, onValue]);

  return { isAuto, fetching, status, source, fetched, getValues, markEdited, reset };
}
