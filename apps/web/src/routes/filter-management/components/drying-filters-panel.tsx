import { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useOffline } from '@/hooks/use-offline';
import { formatByLeastCount } from '@/lib/format-by-least-count';
// 2026-08-10: DRY_IN instrument auto-fetch. Shared with the tablet's inline
// DryingFilterCard so the two surfaces can't drift.
import { useDryerAutoFetch } from '@/lib/filter-ops/use-dryer-autofetch';
// Phase 8.7 Wave-5: countdown helpers + temperature-options + instrument
// lookup live in lib/filter-ops/use-dryer-countdown.ts, shared with the
// mobile DryingFilterCard. Layout stays per-page (desktop = compact row,
// mobile = card with progress bar + minute:second countdown).
import {
  buildTempOptionsSnapped,
  useNowTick,
  findDryerTempInstrument,
  projectDryerCountdown,
} from '@/lib/filter-ops';

/**
 * Desktop drying-filters panel. Rendered on the DRY_IN stage card of
 * `filter-operations.tsx` after the operator selects the stage. Extracted
 * from the parent file as the first phase of the offline-tier refactor —
 * these two components are self-contained (own SWR, own state) and don't
 * touch the parent's offline / cycle state, so the extraction is pure
 * relocation with no behavior change.
 *
 * Mobile-side counterpart: mobile-operations.tsx DryingFilterCard.
 */
export function DryingFiltersPanel({
  filters,
  refreshFilters,
  setToast,
  setPopupError,
}: {
  filters: any[];
  refreshFilters: () => void;
  setToast: (t: { type: 'success' | 'error'; message: string } | null) => void;
  setPopupError: (msg: string) => void;
}) {
  if (filters.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center text-sm text-slate-400">
        No filters drying in this block
      </div>
    );
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Currently Drying</h3>
      {filters.map((f: any) => (
        <DryingFilterRow
          key={f.id}
          filterId={f.id}
          filterName={f.name}
          refreshFilters={refreshFilters}
          setToast={setToast}
          setPopupError={setPopupError}
        />
      ))}
    </div>
  );
}

function DryingFilterRow({
  filterId,
  filterName,
  refreshFilters,
  setToast,
  setPopupError,
}: {
  filterId: string;
  filterName: string;
  refreshFilters: () => void;
  setToast: (t: { type: 'success' | 'error'; message: string } | null) => void;
  setPopupError: (msg: string) => void;
}) {
  const { executeOrQueue, online } = useOffline();
  const { data: state, mutate: refreshState } = useSWR<any>(`/api/filters/${filterId}/current-state`, { refreshInterval: 15000 });
  const [temp, setTemp] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>('');
  // Phase 8.7 Wave-5: shared 1Hz tick — same hook the mobile DryingFilterCard uses.
  const now = useNowTick();
  const [offlineState, setOfflineState] = useState<any>(null);
  const [offlineEquipGroups, setOfflineEquipGroups] = useState<any[]>([]);
  // Restore previously selected temperature from cache (survives navigation)
  // Also load offline state fallback from IndexedDB
  useEffect(() => {
    import('@/lib/offline-store').then(({ getCachedData }) => {
      getCachedData<number>(`dryer-temp-${filterId}`).then(saved => {
        if (saved !== null && saved !== undefined) setTemp(saved);
      });
      getCachedData<any>(`filter-state-${filterId}`).then(cached => {
        if (cached) setOfflineState(cached);
      });
      // Load cached equipment groups as fallback for offline
      getCachedData<any[]>('equipment-groups').then(groups => {
        if (groups) setOfflineEquipGroups(groups);
      });
    }).catch(() => { /* IDB read failed — SWR data path stays primary, row renders without offline fallback */ });
  }, [filterId]);

  // Use SWR data when available, fall back to offline cache
  const effectiveState = state ?? offlineState;
  const cyc = effectiveState?.currentCycle;
  // Phase 8.7 Wave-5: shared countdown projection (same shape mobile uses).
  const projection = projectDryerCountdown(cyc, now);
  const { startedAt, durationMin } = projection;

  // Equipment group from cycle or block fallback
  const stateGroup = effectiveState?.equipmentGroup;
  const blockGroups: any[] = effectiveState?.blockEquipmentGroups ?? [];
  // Offline fallback: resolve from cached equipment groups by block
  const offlineBlockGroups = (() => {
    if (stateGroup || blockGroups.length > 0) return [];
    const areaId = cyc?.cleaningAreaId;
    if (areaId) return offlineEquipGroups.filter((g: any) => g.blockId === areaId);
    return offlineEquipGroups.length === 1 ? offlineEquipGroups : [];
  })();

  // Resolve which group to use: cycle's group > block groups > offline fallback > user-selected
  const resolvedGroup = stateGroup
    ?? (blockGroups.length === 1 ? blockGroups[0] : null)
    ?? (offlineBlockGroups.length >= 1 ? offlineBlockGroups[0] : null)
    ?? (selectedGroupId ? blockGroups.find((g: any) => g.id === selectedGroupId) : null);

  // Phase 8.7 Wave-5: shared instrument lookup (same logic mobile uses).
  const dryerInstrument = findDryerTempInstrument(resolvedGroup);
  // Desktop snaps the first option to a least-count multiple ≥ min — keep the
  // snapped flavour to preserve byte-equivalent runtime for this page.
  const tempOptions = dryerInstrument
    ? buildTempOptionsSnapped(dryerInstrument.operatingMin, dryerInstrument.operatingMax, dryerInstrument.leastCount)
    : [];
  const tempUom = dryerInstrument?.uom ?? '°C';

  // Persist the temperature the same way the manual dropdown does, so a fetched
  // value also survives a mid-cycle page refresh.
  const applyTemp = useCallback((val: number | '') => {
    setTemp(val);
    if (val === '') return;
    import('@/lib/offline-store').then(({ cacheData }) => {
      cacheData(`dryer-temp-${filterId}`, val, 24 * 60 * 60 * 1000);
    }).catch(err => {
      // eslint-disable-next-line no-console -- intentional structured log
      console.warn(
        '[filter-operations] dryer-temp persist failed —',
        err instanceof Error ? err.message : String(err),
      );
    });
  }, [filterId]);

  // 2026-08-10: DRY_IN auto-fetch. MUST be called before the early returns
  // below — React forbids a conditional hook. `isAuto` folds in the online-only
  // rule, so offline this collapses to the pre-existing manual dropdown.
  const autoFetch = useDryerAutoFetch({
    filterId,
    group: resolvedGroup,
    dryerInstrument,
    online,
    onValue: applyTemp,
  });

  // 2026-05-25: once dryer readings are submitted, hide the row entirely until
  // the next time this filter re-enters DRY_IN (i.e. until a fresh cycle for
  // this filter reaches DRY_IN, at which point dryerReadingsSubmitted is
  // false again). The cycle stays in DRY_IN state on the server until the
  // operator manually advances; the "Currently Drying" panel is purely an
  // operator nudge, so once they've given the reading there is nothing more
  // for them to do here.
  if (cyc?.dryerReadingsSubmitted) return null;

  if (!startedAt || !durationMin) {
    return (
      <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-sm">
        <span className="font-medium text-slate-700">{filterName}</span>
        <span className="text-xs text-slate-400">waiting for dryer start…</span>
      </div>
    );
  }

  // Phase 8.7 Wave-5: countdown numbers from the shared projection above.
  const halfElapsed = projection.halfReached;
  const remainingToHalfMin = projection.remainingToHalfMin;

  const handleSubmit = async () => {
    if (!temp || submitting || !resolvedGroup) return;
    setSubmitting(true);
    try {
      const dryInInstruments = (resolvedGroup.instruments ?? []).filter((i: any) => i.stageKey === 'DRY_IN');
      const readings: Record<string, number> = {};
      for (const inst of dryInInstruments) {
        if (dryerInstrument && inst.id === dryerInstrument.id) { readings[inst.id] = Number(temp); continue; }
        // 2026-08-10: prefer a REAL fetched value for a non-temperature DRY_IN
        // instrument. The `operatingMin` fallback below is a fabricated number
        // recorded as if it were measured — keep it only where nothing was
        // fetched (manual mode, or the key missed), which is the pre-existing
        // behaviour, but never overwrite a genuine reading with it.
        const auto = autoFetch.fetched[inst.id];
        readings[inst.id] = typeof auto === 'number' ? auto : inst.operatingMin;
      }
      const { executed } = await executeOrQueue('advance', filterId, filterName, {
        targetState: 'DRY_IN',
        dryerAction: 'SUBMIT_READINGS',
        equipmentGroupId: resolvedGroup.id,
        instrumentReadings: readings,
        remarks: `Dryer temperature ${temp}${tempUom} - ${filterName}`,
      }, 'DRY_IN');
      setToast({ type: 'success', message: `${filterName} → Dry In complete (${temp}${tempUom})${executed ? '' : ' (queued)'}` });
      // Mark readings submitted in cache + clear persisted temp.
      // The optimistic cache update mirrors the server's view of the cycle so
      // the next /current-state fetch matches. Surface IDB failures — silent
      // failure here causes the desktop UI to show "Complete" while the
      // cached state still says Dry-In-waiting (same divergence concern as
      // the mobile-operations.tsx dryer cache update).
      import('@/lib/offline-store').then(({ cacheData, getCachedData }) => {
        cacheData(`dryer-temp-${filterId}`, null, 0);
        getCachedData<any>(`filter-state-${filterId}`).then(cs => {
          if (cs) cacheData(`filter-state-${filterId}`, { ...cs, currentCycle: { ...(cs.currentCycle ?? {}), dryerReadingsSubmitted: true } });
        });
      }).catch(err => {
        // eslint-disable-next-line no-console -- intentional structured log
        console.warn(
          '[filter-operations] dryer-reading cache update failed —',
          err instanceof Error ? err.message : String(err),
        );
      });
      refreshFilters();
      if (executed) refreshState();
    } catch (e: any) {
      setPopupError(e.message ?? 'Failed to submit dryer reading');
    }
    setSubmitting(false);
  };

  // Need user to pick equipment group
  const needsGroupSelect = !stateGroup && blockGroups.length > 1 && !selectedGroupId;

  return (
    <div className="flex flex-col gap-2 py-2 border-b border-slate-100 last:border-0 text-sm">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-800 truncate">{filterName}</div>
          <div className="text-xs text-slate-500">
            {durationMin} min total{' '}
            {cyc?.dryerReadingsSubmitted ? (
              <span className="text-green-600">• temperature recorded</span>
            ) : halfElapsed ? (
              <span className="text-green-600">• ready for reading</span>
            ) : (
              <span className="text-amber-600">• {remainingToHalfMin} min until reading</span>
            )}
          </div>
        </div>
        {cyc?.dryerReadingsSubmitted ? (
          <span className="text-xs text-green-600 font-medium bg-green-50 border border-green-200 rounded px-2 py-1">Complete</span>
        ) : needsGroupSelect ? (
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 text-slate-800 text-sm"
          >
            <option value="">Select Equipment Group</option>
            {blockGroups.map((g: any) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        ) : !dryerInstrument || (!autoFetch.isAuto && tempOptions.length === 0) ? (
          <span className="text-xs text-red-600">No dryer temperature instrument configured</span>
        ) : (
          <>
            {/* 2026-08-10: auto-fetch replaces the stepped dropdown with a free
                numeric input + a Get Values button — same affordance the WASH_IN
                equipment dialog uses. Offline `isAuto` is false and this whole
                branch falls back to the original dropdown. */}
            {autoFetch.isAuto ? (
              <>
                <button
                  type="button"
                  onClick={autoFetch.getValues}
                  disabled={!halfElapsed || submitting || autoFetch.fetching}
                  title={halfElapsed ? 'Fetch the dryer temperature from the instrument' : 'Available once the dryer reaches its halfway point'}
                  className="inline-flex items-center gap-1.5 rounded border border-cyan-600 bg-cyan-600 px-2 py-1 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {autoFetch.fetching
                    ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                  {autoFetch.fetching ? 'Fetching…' : 'Get Values'}
                </button>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  value={temp}
                  onChange={(e) => {
                    autoFetch.markEdited();
                    applyTemp(e.target.value === '' ? '' : Number(e.target.value));
                  }}
                  disabled={!halfElapsed || submitting}
                  placeholder={autoFetch.fetching ? 'Fetching…' : tempUom}
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-slate-800 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`${formatByLeastCount(dryerInstrument.operatingMin, dryerInstrument.leastCount)}–${formatByLeastCount(dryerInstrument.operatingMax, dryerInstrument.leastCount)} ${tempUom}`}
                />
                {autoFetch.source === 'AUTO' && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700">Auto</span>}
                {autoFetch.source === 'AUTO_OVERRIDDEN' && <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 border border-amber-200 text-amber-700">Auto · edited</span>}
              </>
            ) : (
            <select
              value={temp}
              onChange={(e) => applyTemp(e.target.value ? Number(e.target.value) : '')}
              disabled={!halfElapsed || submitting}
              className="rounded border border-slate-300 px-2 py-1 text-slate-800 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              title={dryerInstrument ? `${formatByLeastCount(dryerInstrument.operatingMin, dryerInstrument.leastCount)}–${formatByLeastCount(dryerInstrument.operatingMax, dryerInstrument.leastCount)} ${tempUom} (step ${dryerInstrument.leastCount})` : ''}
            >
              <option value="">{tempUom}</option>
              {tempOptions.map((v) => (
                <option key={v} value={v}>{formatByLeastCount(v, dryerInstrument?.leastCount)}{tempUom}</option>
              ))}
            </select>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!halfElapsed || !temp || submitting}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? '…' : 'Submit'}
            </button>
          </>
        )}
      </div>
      {autoFetch.isAuto && autoFetch.status && (
        <div className="text-[11px] text-slate-500">{autoFetch.status}</div>
      )}
    </div>
  );
}
