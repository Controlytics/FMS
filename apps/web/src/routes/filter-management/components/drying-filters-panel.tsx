import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { formatByLeastCount, formatRecordedReading } from '@/lib/format-by-least-count';
import { useDryerAutoFetch, type ReadingSource } from '@/lib/filter-ops/use-dryer-autofetch';
import {
  buildTempOptionsSnapped,
  useNowTick,
  findDryerTempInstrument,
  projectDryerCountdown,
  equipmentGroupChoice,
  groupHasStageInstruments,
  planFinalStageBatch,
  resolveChecklistForTargetStage,
  type PendingChecklist,
} from '@/lib/filter-ops';
import { isCompletingAdvance, isTerminalTargetWithChecklist } from '@/lib/filter-ops/ahu-completion-check';
import { callCompletesStageWork } from '@digilog/shared';
import { cacheServerStateResponse, recomputeAndCacheFilterState } from '@/lib/offline-cache';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { signOnce, withStageAction } from '@/lib/stage-reauth';
import { ChecklistDialog } from './checklist-dialog';

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
 *
 * 2026-10-22 (every pipeline shape must complete):
 *   - the readings FINISH Dry In. At a FINAL Dry In they complete the cycle, so
 *     a checklist after it rides on them: the panel asks it first and sends one
 *     advance-with-checklist per filter (a bare SUBMIT_READINGS is refused 409
 *     CHECKLIST_REQUIRED there). Decided per filter by the server's rule.
 *   - a row with nothing to read (no group, or no Dry In instrument in it) is
 *     submitted with no readings; it used to be stuck on "Enter a temperature".
 */

export interface DryingFiltersPanelProps {
  /** Filters at DRY_IN in the selected block: `{ id, name }`. */
  filters: any[];
  online: boolean;
  /** `useOffline().executeOrQueue` — same signature on both surfaces. */
  executeOrQueue: (kind: 'advance' | 'advance-with-checklist', filterId: string, filterName: string, body: Record<string, any>, stageKey: string, password?: string) => Promise<{ executed: boolean; result?: any }>;
  /** Cache reader (`useOffline().getCache` on the tablet, offline-store on desktop). */
  getCache: <T>(key: string) => Promise<T | null>;
  cacheData: (key: string, value: any, ttlMs?: number) => any;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  /** Called after a submit so the parent refreshes its filter list. */
  onAfterSubmit?: () => void;
  /**
   * The page's AHU completion pre-flight (POPUP warns, INTERLOCK blocks), for
   * readings that COMPLETE their cycle — a final Dry In (2026-10-22). Called ONCE
   * per submit with every such filter, before anything is written; never for a
   * Dry In with stages after it. `proceed: false` sends nothing. `filterSet` (the
   * operator's A/B/All pick) rides on the completing calls, scoping the server's
   * INTERLOCK gate to the roster the dialog showed. Without it the panel has no
   * pre-flight (the server's INTERLOCK refusal stays the backstop).
   */
  ahuPreflight?: (filterIds: string[]) => Promise<{ proceed: boolean; filterSet?: string | null }>;
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
  /** The block has several groups and this unbound cycle's group is not picked yet. */
  needsGroup: boolean;
  /** No group on offer has a Dry In instrument: the step is sent with no readings. */
  noReading: boolean;
  /** The row's current-state (server, or the cached row offline). */
  state: any;
  instrument: any | null;
  uom: string;
  options: number[];
  isAuto: boolean;
  fetching: boolean;
  timedOut: boolean;
}

/**
 * Do this row's readings COMPLETE its cycle? They finish Dry In's work
 * (callCompletesStageWork), so they do at a FINAL Dry In — the last stage, with or
 * without a checklist after it (the shared AHU predicates over its stageLookup).
 */
function completesCycle(state: any): boolean {
  const lookup = state?.stageLookup;
  return callCompletesStageWork('DRY_IN', 'SUBMIT_READINGS')
    && (isCompletingAdvance('DRY_IN', lookup) || isTerminalTargetWithChecklist('DRY_IN', lookup));
}

export function DryingFiltersPanel({
  filters, online, executeOrQueue, getCache, cacheData, onSuccess, onError, onAfterSubmit, ahuPreflight, variant,
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
      if (p && p.ready === s.ready && p.submitted === s.submitted && p.temp === s.temp && p.source === s.source && p.isAuto === s.isAuto && p.fetching === s.fetching && p.timedOut === s.timedOut && p.instrument === s.instrument && p.group === s.group && p.needsGroup === s.needsGroup && p.noReading === s.noReading && p.state === s.state && p.fetched === s.fetched) return prev;
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

  // A FINAL Dry In's checklist, asked before its readings are sent.
  const [checklistFor, setChecklistFor] = useState<{
    rows: RowState[];
    dialog: { filterId: string; filterName: string; checklists: PendingChecklist[] };
    /** Per filter: what the AHU pre-flight adds to its call (the A/B/All pick). */
    extraFor: (r: RowState) => Record<string, any>;
  } | null>(null);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [checklistError, setChecklistError] = useState('');

  /** The readings call of one row: what it read, or nothing when there is nothing to read. */
  const readingsBody = (r: RowState): Record<string, any> => {
    if (r.noReading) {
      return { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', remarks: `Dry In complete (no reading to take) - ${r.filterName}` };
    }
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
    return {
      targetState: 'DRY_IN',
      dryerAction: 'SUBMIT_READINGS',
      equipmentGroupId: r.group.id,
      instrumentReadings: readings,
      readingSources,
      remarks: `Dryer temperature ${r.temp}${r.uom} - ${r.filterName}`,
    };
  };

  /** Send each row's readings (with `extra`, e.g. the checklist answers) and keep this device's view. */
  const sendRows = async (
    targets: RowState[],
    kind: 'advance' | 'advance-with-checklist',
    extra: (r: RowState) => Record<string, any>,
    password: string | undefined,
  ) => {
    let ok = 0; let queued = 0; const failed: string[] = []; const notRefreshed: string[] = [];
    for (const r of targets) {
      let executed: boolean;
      try {
        ({ executed } = await executeOrQueue(kind, r.filterId, r.filterName, { ...readingsBody(r), ...extra(r) }, 'DRY_IN', password));
      } catch (e: any) {
        failed.push(`${r.filterName}: ${e?.message ?? 'failed'}`);
        continue;
      }
      // From here the reading is RECORDED (sent) or durably QUEUED. What follows is
      // upkeep of this device's offline view, and it must never turn that reading
      // into a "failed" one: the operator was told "N queued" AND "failed" for the
      // same filter, and the row stayed selectable, so a second Submit queued a
      // duplicate reading (2026-10-21, D8).
      if (executed) ok++; else queued++;
      // Queued offline: rewrite the cached action tape / reachable-target
      // mirrors (the pre-2026-09-04 tablet card did this; without it a second
      // offline scan of the same filter still sees "readings pending"). It
      // re-throws by design (fail-loud); report it as what it is.
      if (!executed) {
        try {
          await recomputeAndCacheFilterState(r.filterId, 'DRY_IN', false, null);
        } catch (err: any) {
          notRefreshed.push(`${r.filterName}: ${err?.message ?? String(err)}`);
        }
      }
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
    }
    return { ok, queued, failed, notRefreshed };
  };

  /** The submit's outcome, as ONE success and ONE error message (both parents keep a single one). */
  const report = (res: { ok: number; queued: number; failed: string[]; notRefreshed: string[] }, suffix: string, extraProblems: string[] = []) => {
    const { ok, queued, failed, notRefreshed } = res;
    if (ok + queued > 0) onSuccess(`${ok + queued} filter(s) → Dry In complete${suffix}${queued ? ` (${queued} queued)` : ''}`);
    const problems: string[] = [...extraProblems];
    if (failed.length > 0) problems.push(`${failed.length} failed:\n${failed.join('\n')}`);
    if (notRefreshed.length > 0) {
      problems.push(`${notRefreshed.length} queued, but this device's offline view was not refreshed — do not submit it again; the reading will sync when online:\n${notRefreshed.join('\n')}`);
    }
    if (problems.length > 0) onError(problems.join('\n\n'));
  };

  const handleSubmit = async () => {
    if (submitting || selected.size === 0) return;
    const targets = readyRows.filter(r => selected.has(r.filterId));
    // A missing GROUP is its own message: "Enter a temperature" is wrong when the
    // operator has not chosen which equipment group the reading belongs to.
    const noGroup = targets.filter(r => r.needsGroup);
    if (noGroup.length > 0) { onError(`Choose the equipment group for: ${noGroup.map(m => m.filterName).join(', ')}`); return; }
    const missing = targets.filter(r => !r.noReading && (r.temp === '' || !r.group || !r.instrument));
    if (missing.length > 0) { onError(`Enter a temperature for: ${missing.map(m => m.filterName).join(', ')}`); return; }
    setSubmitting(true);
    try {
      // At a FINAL Dry In these readings complete the cycle, so the checklist
      // after it rides on them — decided per filter with the server's rule
      // (planFinalStageBatch, call SUBMIT_READINGS). The resolver reads the
      // cached row, so a live row is cached first.
      const plan = await planFinalStageBatch(
        targets, 'DRY_IN', (id) => rows[id]?.state ?? null,
        async (id) => {
          const st = rows[id]?.state;
          if (online && st) await cacheServerStateResponse(id, st);
          return resolveChecklistForTargetStage(id, 'DRY_IN', online);
        },
        { dryerAction: 'SUBMIT_READINGS' },
      );
      const leftNotes = plan.left.length > 0
        ? [`Not submitted — submit separately:\n${plan.left.map(l => `${l.item.filterName}: ${l.note}`).join('\n')}`]
        : [];
      // Readings that COMPLETE their cycle (a final Dry In, with or without a
      // checklist after it) pass the page's AHU pre-flight first — ONCE for all of
      // them, before anything is written (2026-10-22; the panel had none).
      const completing = new Set(
        [...plan.plain, ...plan.carry].filter(r => completesCycle(r.state)).map(r => r.filterId),
      );
      let filterSet: string | null = null;
      if (completing.size > 0 && ahuPreflight) {
        const gate = await ahuPreflight([...completing]);
        if (!gate.proceed) return;
        filterSet = gate.filterSet ?? null;
      }
      const extraFor = (r: RowState): Record<string, any> =>
        (filterSet && completing.has(r.filterId) ? { filterSet } : {});
      if (plan.plain.length > 0) {
        let sig: { ok: true; password?: string } | { ok: false };
        try {
          sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE'], 'DRY_IN'));
        } catch (e: any) {
          onError(e?.message ?? 'Re-authentication failed');
          return;
        }
        if (!sig.ok) return;
        report(await sendRows(plan.plain, 'advance', extraFor, sig.password), '', leftNotes);
        onAfterSubmit?.();
      } else if (leftNotes.length > 0) {
        onError(leftNotes.join('\n\n'));
      }
      setSharedTemp('');
      if (plan.carry.length > 0) {
        // Nothing of these is written until the checklist is answered; Close drops it.
        setSelected(new Set(plan.carry.map(r => r.filterId)));
        setChecklistError('');
        setChecklistFor({
          rows: plan.carry,
          dialog: { filterId: plan.carry[0].filterId, filterName: `${plan.carry.length} filter(s)`, checklists: plan.checklists },
          extraFor,
        });
      } else {
        setSelected(new Set());
      }
    } finally {
      setSubmitting(false);
    }
  };

  // The readings AND the answers in ONE call per filter, signed once for both.
  const submitChecklist = async (answers: Record<string, any>) => {
    if (!checklistFor || checklistBusy) return;
    setChecklistBusy(true); setChecklistError('');
    const expectedProfileVersions: Record<string, number> = {};
    for (const cl of checklistFor.dialog.checklists) {
      if (typeof cl.profileVersion === 'number') expectedProfileVersions[cl.checklistProfileId] = cl.profileVersion;
    }
    try {
      let sig: { ok: true; password?: string } | { ok: false };
      try {
        sig = await signOnce(reauth, withStageAction(['ADVANCE_FILTER_STAGE', 'SUBMIT_CHECKLIST_WITH_SIGNATURE'], 'DRY_IN'));
      } catch (e: any) {
        setChecklistError(e?.message ?? 'Re-authentication failed');
        return;
      }
      if (!sig.ok) return; // a dismissed prompt: the checklist stays for a retry
      const { extraFor } = checklistFor;
      const res = await sendRows(checklistFor.rows, 'advance-with-checklist', (r) => ({ ...extraFor(r), answers, expectedProfileVersions }), sig.password);
      setChecklistFor(null);
      setSelected(new Set());
      report(res, ', checklist submitted');
      onAfterSubmit?.();
    } finally {
      setChecklistBusy(false);
    }
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
      <ChecklistDialog
        dialog={checklistFor?.dialog ?? null}
        onClose={() => { setChecklistFor(null); setChecklistError(''); }}
        onSubmit={submitChecklist}
        loading={checklistBusy}
        error={checklistError}
        stageName="Dry In"
      />
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

  // Which group the reading belongs to (operator decision 2026-10-22): ONE rule,
  // lib/filter-ops equipmentGroupChoice. An unbound cycle on a block with several
  // groups makes the operator pick on this row — the state's `equipmentGroup` is
  // then only the block's oldest group, which used to be sent without asking.
  // The cached `equipment-groups` of the block stand in when the state lists none.
  const offlineBlockGroups = (() => {
    const areaId = cyc?.cleaningAreaId;
    if (areaId) return offlineEquipGroups.filter((g: any) => g.blockId === areaId);
    return offlineEquipGroups.length === 1 ? offlineEquipGroups : [];
  })();
  const groupChoice = equipmentGroupChoice(effectiveState, offlineBlockGroups);
  const [pickedGroupId, setPickedGroupId] = useState('');
  const group = groupChoice.needsChoice
    ? (groupChoice.groups.find((g: any) => g.id === pickedGroupId) ?? null)
    : groupChoice.group;
  // Nothing to read when no group on offer has a Dry In instrument (2026-10-22):
  // the readings step is still sent — with no readings — and nothing is picked.
  // Only when the groups are KNOWN: the server's state online, or offline a group
  // on the cached row or the cached groups of the cycle's block. Offline with
  // several cached groups and no block, an empty choice means "cannot tell", and
  // sending no readings then would skip a temperature that is due.
  const groupsKnown = !!state
    || !!effectiveState?.equipmentGroup
    || (effectiveState?.blockEquipmentGroups ?? []).length > 0
    || (!!cyc?.cleaningAreaId && offlineEquipGroups.length > 0);
  const noReading = groupsKnown && !groupChoice.groups.some((g: any) => groupHasStageInstruments(g, 'DRY_IN'));
  const needsGroup = groupChoice.needsChoice && !group && !noReading;
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
    report({ filterId, filterName, ready, submitted, temp, source: autoFetch.source, fetched: autoFetch.fetched, group, needsGroup, noReading, state: effectiveState, instrument, uom, options, isAuto: autoFetch.isAuto, fetching: autoFetch.fetching, timedOut: autoFetch.timedOut });
  }, [report, filterId, filterName, ready, submitted, temp, autoFetch.source, autoFetch.fetched, group, needsGroup, noReading, effectiveState, instrument, uom, autoFetch.isAuto, autoFetch.fetching, autoFetch.timedOut]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different pick: the value and any fetch belong to the previous group's
  // instrument, so they go; the new group's instrument is read afresh.
  const pickGroup = (id: string) => {
    setPickedGroupId(id);
    setTemp('');
    try { cacheData(`dryer-temp-${filterId}`, null, 0); } catch { /* cache is a convenience */ }
    autoFetch.reset();
  };

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
    ? <span className="px-1.5 py-0.5 text-[11px] font-semibold rounded-full bg-cyan-50 border border-cyan-200 text-cyan-700">Auto</span>
    : autoFetch.source === 'AUTO_OVERRIDDEN'
      ? <span className="px-1.5 py-0.5 text-[11px] font-semibold rounded-full bg-amber-50 border border-amber-200 text-amber-700" title="Fetched from the instrument, then changed by the operator">Auto · changed</span>
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
    <span className="font-mono text-sm text-slate-800">{temp === '' ? (autoFetch.fetching ? 'fetching…' : '—') : `${formatRecordedReading(Number(temp), instrument?.leastCount)} ${uom}`}</span>
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
        {ready && needsGroup && (
          <select aria-label={`Equipment group for ${filterName}`} value={pickedGroupId} onChange={(e) => pickGroup(e.target.value)} disabled={submitting}
            className={`rounded${isMobile ? '-xl' : ''} border border-amber-400 px-2 py-1 text-sm bg-white`}>
            <option value="">Choose equipment group…</option>
            {groupChoice.groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {ready && groupChoice.needsChoice && group && (
          <select aria-label={`Equipment group for ${filterName}`} value={pickedGroupId} onChange={(e) => pickGroup(e.target.value)} disabled={submitting}
            className={`rounded${isMobile ? '-xl' : ''} border border-slate-300 px-2 py-1 text-sm bg-white`}>
            {groupChoice.groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        {ready && noReading && <span className="text-xs text-slate-500">No reading to take — Submit finishes Dry In</span>}
        {ready && !needsGroup && !noReading && !instrument && <span className="text-xs text-red-600">No dryer temperature instrument configured</span>}
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
