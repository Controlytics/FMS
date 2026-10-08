import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { formatByLeastCount } from '@/lib/format-by-least-count';
import { useDryerAutoFetch, type ReadingSource } from '@/lib/filter-ops/use-dryer-autofetch';
import {
  buildTempOptionsSnapped,
  useNowTick,
  findDryerTempInstrument,
  projectDryerCountdown,
} from '@/lib/filter-ops';
import { recomputeAndCacheFilterState } from '@/lib/offline-cache';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { signOnce, withStageAction } from '@/lib/stage-reauth';

/**
 * "Currently Drying" panel — SHARED by the desktop DRY_IN stage card
 * (`filter-operations.tsx`) and the tablet DRY_IN stage screen
 * (`mobile-operations.tsx`). One component, two `variant`s, so the two
 * surfaces cannot drift (the pre-2026-09-04 tablet kept its own inline copy).
 *
 * 2026-09-04 (operator request) — multi-select temperature submission:
 *   - every filter at DRY_IN in the selected block is a row with a countdown;
 *   - a row becomes SELECTABLE once half its duration has passed (the earliest
 *     the server accepts a reading);
 *   - with auto-fetch on the equipment group, each row fetches the dryer
 *     temperature ON ITS OWN when it reaches half time — no Get Values button —
 *     and rows reaching half time together show the same value (one dryer);
 *   - a fetched value is editable ("Change value"); editing marks it
 *     AUTO_OVERRIDDEN, which is sent to the server as `readingSources` so the
 *     record shows both that it was fetched and that it was changed (operator
 *     accepted this on 2026-09-04, reversing the 2026-08-10 read-only rule);
 *   - one "Temperature for selected" box applies a value to every ticked row;
 *   - Submit records every ticked row (one advance per filter, online or
 *     queued offline); rows still counting down cannot be ticked.
 *   - a fetch that fails or times out leaves that row on the manual dropdown.
 *
 * Per-row data loading (SWR online / IndexedDB cache offline), the 1 Hz tick,
 * the countdown projection and the instrument lookup are unchanged from the
 * previous single-row implementation.
 */

export interface DryingFiltersPanelProps {
  /** Filters at DRY_IN in the selected block: `{ id, name }`. */
  filters: any[];
  online: boolean;
  /** `useOffline().executeOrQueue` — same signature on both surfaces. */
  executeOrQueue: (kind: 'advance', filterId: string, filterName: string, body: Record<string, any>, stageKey: string, password?: string) => Promise<{ executed: boolean; result?: any }>;
  /** Cache reader (`useOffline().getCache` on the tablet, offline-store on desktop). */
  getCache: <T>(key: string) => Promise<T | null>;
  cacheData: (key: string, value: any, ttlMs?: number) => any;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  /** Called after a submit so the parent refreshes its filter list. */
  onAfterSubmit?: () => void;
  variant: 'desktop' | 'mobile';
}

/** What each row reports up to the panel every render. */
interface RowState {
  filterId: string;
  filterName: string;
  ready: boolean;            // half time reached, readings not yet submitted
  submitted: boolean;        // readings already recorded (row hides itself)
  temp: number | '';
  source: ReadingSource;
  fetched: Record<string, number>;
  group: any | null;
  instrument: any | null;
  uom: string;
  options: number[];
  isAuto: boolean;
  fetching: boolean;
  timedOut: boolean;
}

export function DryingFiltersPanel({
  filters, online, executeOrQueue, getCache, cacheData, onSuccess, onError, onAfterSubmit, variant,
}: DryingFiltersPanelProps) {
  // Audit 2026-09-24 (web F1): the panel completed Dry In with no re-auth
  // signature — with ADVANCE_FILTER_STAGE / STAGE_DRY_IN enabled for the role
  // every submit was a bare 401 and no dialog ever opened. Sign once, like the
  // Set Duration path on the operations page.
  const reauth = useReauth();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sharedTemp, setSharedTemp] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  // Per-row "apply this value" requests from the panel (shared box / change value).
  const [applyMap, setApplyMap] = useState<Record<string, { value: number | ''; seq: number }>>({});
  const seqRef = useRef(0);

  const reportRow = useCallback((s: RowState) => {
    setRows(prev => {
      const p = prev[s.filterId];
      if (p && p.ready === s.ready && p.submitted === s.submitted && p.temp === s.temp && p.source === s.source && p.isAuto === s.isAuto && p.fetching === s.fetching && p.timedOut === s.timedOut && p.instrument === s.instrument && p.group === s.group && p.fetched === s.fetched) return prev;
      return { ...prev, [s.filterId]: s };
    });
  }, []);

  // Drop state for filters that left the list; drop selection for rows that stopped being ready.
  useEffect(() => {
    const ids = new Set(filters.map((f: any) => f.id));
    setRows(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
    setSelected(prev => new Set([...prev].filter(id => ids.has(id))));
  }, [filters]);
  useEffect(() => {
    setSelected(prev => {
      const next = new Set([...prev].filter(id => rows[id]?.ready && !rows[id]?.submitted));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);

  const readyRows = useMemo(() => filters.map((f: any) => rows[f.id]).filter((r): r is RowState => !!r && r.ready && !r.submitted), [filters, rows]);
  const allReadySelected = readyRows.length > 0 && readyRows.every(r => selected.has(r.filterId));

  // One ready filter = nothing to choose between (2026-10-08, operator): tick it
  // so the temperature box and Submit work without a selection step. With two
  // or more ready, the operator still picks which ones to submit.
  const singleReadyId = readyRows.length === 1 ? readyRows[0].filterId : null;
  useEffect(() => {
    if (singleReadyId && !selected.has(singleReadyId)) setSelected(new Set([singleReadyId]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleReadyId]);

  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(allReadySelected ? new Set() : new Set(readyRows.map(r => r.filterId)));

  const applyToSelected = (value: number | '') => {
    seqRef.current += 1;
    setApplyMap(prev => { const n = { ...prev }; for (const id of selected) n[id] = { value, seq: seqRef.current }; return n; });
  };
  const applyToOne = (id: string, value: number | '') => {
    seqRef.current += 1;
    setApplyMap(prev => ({ ...prev, [id]: { value, seq: seqRef.current } }));
  };

  const handleSubmit = async () => {
    if (submitting || selected.size === 0) return;
    const targets = readyRows.filter(r => selected.has(r.filterId));
    const missing = targets.filter(r => r.temp === '' || !r.group || !r.instrument);
    if (missing.length > 0) { onError(`Enter a temperature for: ${missing.map(m => m.filterName).join(', ')}`); return; }
    setSubmitting(true);
    let sig: { ok: true; password?: string } | { ok: false };
    try {
      sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], 'DRY_IN'));
    } catch (e: any) {
      setSubmitting(false);
      onError(e?.message ?? 'Re-authentication failed');
      return;
    }
    if (!sig.ok) { setSubmitting(false); return; }
    const password = sig.password;
    let ok = 0; let queued = 0; const failed: string[] = [];
    for (const r of targets) {
      try {
        const dryIn = (r.group.instruments ?? []).filter((i: any) => i.stageKey === 'DRY_IN');
        const readings: Record<string, number> = {};
        const readingSources: Record<string, ReadingSource> = {};
        for (const inst of dryIn) {
          if (inst.id === r.instrument.id) { readings[inst.id] = Number(r.temp); readingSources[inst.id] = r.source; continue; }
          // Prefer a REAL fetched value for a sibling DRY_IN instrument; the
          // operatingMin fallback is the pre-existing manual-mode behaviour.
          const auto = r.fetched[inst.id];
          readings[inst.id] = typeof auto === 'number' ? auto : inst.operatingMin;
          readingSources[inst.id] = typeof auto === 'number' ? 'AUTO' : 'MANUAL';
        }
        const { executed } = await executeOrQueue('advance', r.filterId, r.filterName, {
          targetState: 'DRY_IN',
          dryerAction: 'SUBMIT_READINGS',
          equipmentGroupId: r.group.id,
          instrumentReadings: readings,
          readingSources,
          remarks: `Dryer temperature ${r.temp}${r.uom} - ${r.filterName}`,
        }, 'DRY_IN', password);
        if (executed) ok++; else queued++;
        // Queued offline: rewrite the cached action tape / reachable-target
        // mirrors first (the pre-2026-09-04 tablet card did this; without it a
        // second offline scan of the same filter still sees "readings pending").
        if (!executed) await recomputeAndCacheFilterState(r.filterId, 'DRY_IN', false, null);
        // Mirror the server's view of the cycle in the offline cache + clear the persisted temp.
        try {
          const cs = await getCache<any>(`filter-state-${r.filterId}`);
          if (cs) cacheData(`filter-state-${r.filterId}`, { ...cs, currentCycle: { ...(cs.currentCycle ?? {}), dryerReadingsSubmitted: true } });
          cacheData(`dryer-temp-${r.filterId}`, null, 0);
        } catch (err) {
          // eslint-disable-next-line no-console -- intentional structured log
          console.warn('[drying-panel] cache update failed —', err instanceof Error ? err.message : String(err));
        }
        setRows(prev => prev[r.filterId] ? { ...prev, [r.filterId]: { ...prev[r.filterId], submitted: true } } : prev);
      } catch (e: any) {
        failed.push(`${r.filterName}: ${e?.message ?? 'failed'}`);
      }
    }
    setSelected(new Set());
    setSharedTemp('');
    if (ok + queued > 0) onSuccess(`${ok + queued} filter(s) → Dry In complete${queued ? ` (${queued} queued)` : ''}`);
    if (failed.length > 0) onError(`${failed.length} failed:\n${failed.join('\n')}`);
    onAfterSubmit?.();
    setSubmitting(false);
  };

  const isMobile = variant === 'mobile';
  const anyRow = filters.some((f: any) => !rows[f.id]?.submitted);
  if (filters.length === 0 || !anyRow) {
    return isMobile ? null : (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 text-center text-sm text-slate-400">No filters drying in this block</div>
    );
  }
  const firstReady = readyRows[0];
  const uom = firstReady?.uom ?? '°C';
  const sharedOptions = firstReady?.options ?? [];
  const sharedIsAuto = readyRows.some(r => r.isAuto && !r.timedOut);
  const visible = filters.filter((f: any) => !rows[f.id]?.submitted);

  return (
    <div className={isMobile ? 'bg-white border border-amber-200 rounded-2xl overflow-hidden' : 'bg-white border border-slate-200 rounded-2xl p-5 space-y-3'}>
      <ReauthPrompt reauth={reauth} />
      <div className={isMobile ? 'bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 flex items-center justify-between' : 'flex items-center justify-between'}>
        <h3 className={isMobile ? 'text-sm font-bold text-white' : 'text-sm font-semibold text-slate-500'}>
          Currently Drying ({visible.length})
        </h3>
        {readyRows.length > 0 && (
          <label className={`flex items-center gap-1.5 text-xs ${isMobile ? 'text-white' : 'text-slate-500'}`}>
            <input type="checkbox" checked={allReadySelected} onChange={toggleAll} className="w-4 h-4 accent-cyan-600" />
            Select all ready ({readyRows.length})
          </label>
        )}
      </div>

      <div className={isMobile ? 'divide-y divide-slate-100' : ''}>
        {visible.map((f: any) => (
          <DryingRow
            key={f.id}
            filterId={f.id}
            filterName={f.name}
            online={online}
            getCache={getCache}
            cacheData={cacheData}
            variant={variant}
            selected={selected.has(f.id)}
            onToggle={() => toggle(f.id)}
            apply={applyMap[f.id]}
            onChangeValue={(v) => applyToOne(f.id, v)}
            report={reportRow}
            submitting={submitting}
          />
        ))}
      </div>

      {/* Batch bar — one temperature for every ticked row, then Submit. */}
      {readyRows.length > 0 && (
        <div className={isMobile ? 'px-4 py-3 bg-amber-50 border-t border-amber-200 space-y-2' : 'pt-3 border-t border-slate-200 space-y-2'}>
          <div className="text-xs font-semibold text-slate-600">
            {selected.size} of {readyRows.length} ready filter(s) selected
          </div>
          <div className="flex items-center gap-2">
            {sharedIsAuto || sharedOptions.length === 0 ? (
              <input
                type="number" step="any" inputMode="decimal"
                value={sharedTemp}
                onChange={(e) => { const v = e.target.value === '' ? '' : Number(e.target.value); setSharedTemp(v); applyToSelected(v); }}
                disabled={selected.size === 0 || submitting}
                placeholder={`Temperature for selected (${uom})`}
                className={`flex-1 rounded${isMobile ? '-xl' : ''} border border-slate-300 px-3 py-2 text-sm disabled:opacity-40`}
              />
            ) : (
              <select
                value={sharedTemp}
                onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ''; setSharedTemp(v); applyToSelected(v); }}
                disabled={selected.size === 0 || submitting}
                className={`flex-1 rounded${isMobile ? '-xl' : ''} border border-slate-300 px-3 py-2 text-sm bg-white disabled:opacity-40`}
              >
                <option value="">Temperature for selected ({uom})</option>
                {sharedOptions.map((v) => <option key={v} value={v}>{formatByLeastCount(v, firstReady?.instrument?.leastCount)} {uom}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selected.size === 0 || submitting}
              className={isMobile
                ? 'px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl text-sm font-bold disabled:opacity-40'
                : 'rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed'}
            >
              {submitting ? '…' : `Submit ${selected.size > 0 ? `(${selected.size})` : ''}`}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            {sharedIsAuto
              ? 'Fetched values fill in on their own at half time. Type here to change the value for every selected filter, or use Change on a single row.'
              : 'Pick a temperature to apply it to every selected filter, or set one row on its own.'}
          </p>
        </div>
      )}
    </div>
  );
}

function DryingRow({
  filterId, filterName, online, getCache, cacheData, variant, selected, onToggle, apply, onChangeValue, report, submitting,
}: {
  filterId: string; filterName: string; online: boolean;
  getCache: <T>(key: string) => Promise<T | null>;
  cacheData: (key: string, value: any, ttlMs?: number) => any;
  variant: 'desktop' | 'mobile';
  selected: boolean; onToggle: () => void;
  apply?: { value: number | ''; seq: number };
  onChangeValue: (v: number | '') => void;
  report: (s: RowState) => void;
  submitting: boolean;
}) {
  const isMobile = variant === 'mobile';
  const { data: state } = useSWR<any>(online ? `/api/filters/${filterId}/current-state` : null, { refreshInterval: 15000 });
  const [temp, setTemp] = useState<number | ''>('');
  const [editing, setEditing] = useState(false);
  const [offlineState, setOfflineState] = useState<any>(null);
  const [offlineEquipGroups, setOfflineEquipGroups] = useState<any[]>([]);
  const now = useNowTick();

  useEffect(() => {
    getCache<number>(`dryer-temp-${filterId}`).then(saved => { if (saved !== null && saved !== undefined) setTemp(saved); }).catch(() => {});
    getCache<any>(`filter-state-${filterId}`).then(cached => { if (cached) setOfflineState(cached); }).catch(() => {});
    getCache<any[]>('equipment-groups').then(groups => { if (groups) setOfflineEquipGroups(groups); }).catch(() => {});
  }, [filterId, getCache, online]);

  const effectiveState = state ?? offlineState;
  const cyc = effectiveState?.currentCycle;
  const projection = projectDryerCountdown(cyc, now);
  const { startedAt, durationMin, halfReached } = projection;

  const stateGroup = effectiveState?.equipmentGroup;
  const blockGroups: any[] = effectiveState?.blockEquipmentGroups ?? [];
  const offlineBlockGroups = (() => {
    if (stateGroup || blockGroups.length > 0) return [];
    const areaId = cyc?.cleaningAreaId;
    if (areaId) return offlineEquipGroups.filter((g: any) => g.blockId === areaId);
    return offlineEquipGroups.length === 1 ? offlineEquipGroups : [];
  })();
  const group = stateGroup ?? (blockGroups.length === 1 ? blockGroups[0] : null) ?? (offlineBlockGroups.length >= 1 ? offlineBlockGroups[0] : null);
  const instrument = findDryerTempInstrument(group);
  const options = instrument ? buildTempOptionsSnapped(instrument.operatingMin, instrument.operatingMax, instrument.leastCount) : [];
  const uom = instrument?.uom ?? '°C';

  const persist = useCallback((val: number | '') => {
    setTemp(val);
    if (val === '') return;
    try { cacheData(`dryer-temp-${filterId}`, val, 24 * 60 * 60 * 1000); } catch { /* cache is a convenience */ }
  }, [filterId, cacheData]);

  // Auto-fetch fires on its own when the countdown crosses half time.
  const autoFetch = useDryerAutoFetch({ filterId, group, dryerInstrument: instrument, online, halfReached: halfReached && !cyc?.dryerReadingsSubmitted, onValue: persist });

  // A value pushed from the panel (shared box / change value) — counts as an edit.
  const lastSeqRef = useRef(0);
  useEffect(() => {
    if (!apply || apply.seq === lastSeqRef.current) return;
    lastSeqRef.current = apply.seq;
    persist(apply.value);
    autoFetch.markEdited();
  }, [apply, persist, autoFetch]);

  const submitted = !!cyc?.dryerReadingsSubmitted;
  const ready = !!startedAt && !!durationMin && halfReached && !submitted;
  useEffect(() => {
    report({ filterId, filterName, ready, submitted, temp, source: autoFetch.source, fetched: autoFetch.fetched, group, instrument, uom, options, isAuto: autoFetch.isAuto, fetching: autoFetch.fetching, timedOut: autoFetch.timedOut });
  }, [report, filterId, filterName, ready, submitted, temp, autoFetch.source, autoFetch.fetched, group, instrument, uom, autoFetch.isAuto, autoFetch.fetching, autoFetch.timedOut]); // eslint-disable-line react-hooks/exhaustive-deps

  if (submitted) return null;

  const rowCls = isMobile ? 'px-4 py-3 space-y-2' : 'flex flex-col gap-1.5 py-2 border-b border-slate-100 last:border-0 text-sm';
  if (!startedAt || !durationMin) {
    return (
      <div className={rowCls}>
        <div className="flex items-center justify-between"><span className="font-medium text-slate-700">{filterName}</span><span className="text-xs text-slate-400">waiting for dryer start…</span></div>
      </div>
    );
  }

  const sourceBadge = autoFetch.source === 'AUTO'
    ? <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700">Auto</span>
    : autoFetch.source === 'AUTO_OVERRIDDEN'
      ? <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-amber-50 border border-amber-200 text-amber-700" title="Fetched from the instrument, then changed by the operator">Auto · changed</span>
      : null;

  const valueBox = editing || !autoFetch.isAuto || autoFetch.timedOut ? (
    options.length > 0 && !(autoFetch.isAuto && !autoFetch.timedOut) ? (
      <select value={temp} onChange={(e) => onChangeValue(e.target.value ? Number(e.target.value) : '')} disabled={submitting}
        className={`rounded${isMobile ? '-xl' : ''} border border-slate-300 px-2 py-1 text-sm bg-white`}>
        <option value="">{uom}</option>
        {options.map((v) => <option key={v} value={v}>{formatByLeastCount(v, instrument?.leastCount)} {uom}</option>)}
      </select>
    ) : (
      <input type="number" step="any" inputMode="decimal" value={temp} disabled={submitting}
        onChange={(e) => onChangeValue(e.target.value === '' ? '' : Number(e.target.value))}
        placeholder={uom}
        className={`w-24 rounded${isMobile ? '-xl' : ''} border border-slate-300 px-2 py-1 text-sm`} />
    )
  ) : (
    <span className="font-mono text-sm text-slate-800">{temp === '' ? (autoFetch.fetching ? 'fetching…' : '—') : `${formatByLeastCount(Number(temp), instrument?.leastCount)} ${uom}`}</span>
  );

  return (
    <div className={rowCls}>
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} disabled={!ready || submitting}
          className="w-4 h-4 accent-cyan-600 disabled:opacity-40" title={ready ? 'Select for submission' : 'Available once the dryer reaches half time'} />
        <div className="flex-1 min-w-0">
          <div className={`font-medium text-slate-800 truncate ${isMobile ? 'text-sm' : ''}`}>{filterName}</div>
          <div className="text-xs text-slate-500">
            {durationMin} min total{' '}
            {ready
              ? <span className="text-green-600">• ready for reading</span>
              : <span className="text-amber-600">• {isMobile ? `${projection.remainingMin}:${String(projection.remainingSecPart).padStart(2, '0')}` : `${projection.remainingToHalfMin} min`} until reading</span>}
          </div>
          {isMobile && (
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
              <div className={`h-full rounded-full transition-all ${halfReached ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${projection.progressPct}%` }} />
            </div>
          )}
        </div>
        {ready && !instrument && <span className="text-xs text-red-600">No dryer temperature instrument configured</span>}
        {ready && instrument && (
          <div className="flex items-center gap-2">
            {valueBox}
            {sourceBadge}
            {autoFetch.isAuto && !autoFetch.timedOut && !editing && (
              <button type="button" onClick={() => setEditing(true)} disabled={submitting}
                className="text-xs text-cyan-700 underline underline-offset-2 disabled:opacity-40">Change value</button>
            )}
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500 underline underline-offset-2">Done</button>
            )}
          </div>
        )}
      </div>
      {autoFetch.isAuto && autoFetch.status && ready && (
        <div className="text-[11px] text-slate-500">{autoFetch.status}</div>
      )}
    </div>
  );
}
