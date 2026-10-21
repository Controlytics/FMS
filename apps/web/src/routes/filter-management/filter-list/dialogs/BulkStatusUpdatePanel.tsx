import { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { LIFECYCLE_STATE_OPTIONS } from '../constants';
import { Select } from '@/components/ui/select';

type CleaningReason = { key: string; name: string; requiresJustification?: boolean };
type StageOption = { state: string; allowed: boolean; classification: string; isCurrent: boolean };
type StageOptionsResp = { hasProfile: boolean; currentStage?: string | null; options?: StageOption[]; cleaningReasons?: CleaningReason[] };
type FilterTargets = { hasProfile: boolean; valid: Set<string> };

/**
 * The stages one filter may move to — the SAME rule as the single-filter
 * StatusUpdatePanel. With a cleaning profile the server's profile-aware
 * `options` decide; WITHOUT one the server applies no sequence rule and starts
 * no cycle (instance.service `updateLifecycleState`), so every manual stage but
 * the one the filter already holds is valid. Using `options` for a no-profile
 * filter (it then lists only Cleaning Cycle Completed) marked every real stage
 * "out of sequence" (2026-10-21, D5). A filter whose options could not be read
 * stays conservative: nothing is valid for it.
 */
function targetsFor(resp: StageOptionsResp | null): FilterTargets {
  if (!resp) return { hasProfile: false, valid: new Set() };
  if (!resp.hasProfile) {
    return { hasProfile: false, valid: new Set(LIFECYCLE_STATE_OPTIONS.map(o => o.value).filter(s => s !== resp.currentStage)) };
  }
  const valid = new Set<string>();
  for (const o of resp.options ?? []) if (o.allowed && !o.isCurrent) valid.add(o.state);
  return { hasProfile: true, valid };
}

// Moving INTO one of these stages can start a cleaning cycle (server-side P3),
// which requires a cleaning reason. CLEANING_CYCLE_COMPLETED never starts one.
const CLEANING_STAGES = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];

type Props = {
  selectedCount: number;
  selectedFilters: { id: string; name: string }[];
  state: string;
  remarks: string;
  submitting: boolean;
  onStateChange: (v: string) => void;
  onRemarksChange: (v: string) => void;
  onClose: () => void;
  onSubmit: (extra?: { cleaningReasonKey?: string; cleaningJustification?: string }) => void;
};

export function BulkStatusUpdatePanel({
  selectedCount, selectedFilters, state, remarks, submitting,
  onStateChange, onRemarksChange, onClose, onSubmit,
}: Props) {
  const total = selectedFilters.length;
  // Stable dependency key — selectedFilters is a fresh array every render.
  const idsKey = selectedFilters.map(f => f.id).sort().join(',');

  // Per-filter set of valid (allowed, non-current) target stages + the cleaning
  // reasons, fetched up-front from each filter's profile-aware stage-options so
  // the dropdown can hint which stages are valid BEFORE the operator submits.
  const [validByFilter, setValidByFilter] = useState<Map<string, FilterTargets>>(new Map());
  const [reasons, setReasons] = useState<CleaningReason[]>([]);
  const [optsLoaded, setOptsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ids = idsKey ? idsKey.split(',') : [];
    if (ids.length === 0) { setValidByFilter(new Map()); setReasons([]); setOptsLoaded(true); return; }
    setOptsLoaded(false);
    Promise.all(ids.map(id =>
      api.get<StageOptionsResp>(`/api/filters/${id}/stage-options`)
        .then(r => [id, r] as const)
        .catch(() => [id, null] as const),
    )).then(results => {
      if (cancelled) return;
      const m = new Map<string, FilterTargets>();
      let firstReasons: CleaningReason[] = [];
      for (const [id, resp] of results) {
        m.set(id, targetsFor(resp));
        if (firstReasons.length === 0 && resp?.cleaningReasons?.length) firstReasons = resp.cleaningReasons;
      }
      setValidByFilter(m);
      setReasons(firstReasons);
      setOptsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [idsKey]);

  const validCount = (st: string) => { let c = 0; validByFilter.forEach(t => { if (t.valid.has(st)) c++; }); return c; };

  // Reason + justification are required only when moving into a cleaning stage;
  // the server ignores them for filters whose move doesn't start a cycle — and a
  // filter with no cleaning profile never starts one, so only a PROFILED filter
  // that can take the stage makes the reason required (D5).
  const [reasonKey, setReasonKey] = useState('');
  const [justification, setJustification] = useState('');
  useEffect(() => { setReasonKey(''); setJustification(''); }, [state]);

  const profiledCanTake = (st: string) => { let any = false; validByFilter.forEach(t => { if (t.hasProfile && t.valid.has(st)) any = true; }); return any; };
  // Until the options load, stay conservative and ask (as before).
  const needsReason = CLEANING_STAGES.includes(state) && (!optsLoaded || profiledCanTake(state));
  const chosenReason = reasons.find(r => r.key === reasonKey) ?? null;
  const needsJustification = !!chosenReason?.requiresJustification;
  const reasonIncomplete = needsReason && (!reasonKey || (needsJustification && justification.trim().length < 10));

  const chosenCount = state ? validCount(state) : 0;
  const noneValid = optsLoaded && !!state && chosenCount === 0;
  const partialValid = optsLoaded && !!state && chosenCount > 0 && chosenCount < total;
  const submitDisabled = !state || !remarks.trim() || submitting || reasonIncomplete || noneValid;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-lg font-semibold text-slate-800">Bulk Status Update</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="rounded-lg p-3 text-xs bg-blue-50 text-blue-700 border border-blue-200">
            Updating <strong>{selectedCount} filter(s)</strong> to the selected status.
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Selected Filters</label>
            <div className="max-h-32 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
              {selectedFilters.map(f => (
                <div key={f.id} className="text-xs text-slate-600 px-2 py-1 bg-slate-50 rounded">{f.name}</div>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">New Status <span className="text-red-500">*</span></label>
            <Select value={state} onChange={e => onStateChange(e.target.value)}>
              <option value="" disabled>Select status…</option>
              {LIFECYCLE_STATE_OPTIONS.map(opt => {
                const count = validCount(opt.value);
                const none = optsLoaded && count === 0;
                const label = !optsLoaded
                  ? opt.label
                  : count === total
                    ? opt.label
                    : count === 0
                      ? `${opt.label} — out of sequence`
                      : `${opt.label} — valid for ${count} of ${total}`;
                return <option key={opt.value} value={opt.value} disabled={none}>{label}</option>;
              })}
            </Select>
            {!optsLoaded && <p className="mt-1 text-xs text-slate-400">Checking which stages are valid for the selected filters…</p>}
          </div>

          {noneValid && (
            <div className="rounded-lg p-3 text-xs bg-red-50 text-red-700 border border-red-200">
              None of the selected filters can move to this stage (out of sequence for their cleaning profile). Pick a stage that isn't marked “out of sequence”.
            </div>
          )}
          {partialValid && (
            <div className="rounded-lg p-3 text-xs bg-amber-50 text-amber-700 border border-amber-200">
              Only <strong>{chosenCount} of {total}</strong> selected filters can move to this stage — the other {total - chosenCount} will be skipped.
            </div>
          )}

          {needsReason && (
            <>
              <div className="rounded-lg p-3 text-xs bg-amber-50 text-amber-700 border border-amber-200">
                Moving into a cleaning stage starts a new cleaning cycle for filters that don't have one — a cleaning reason is required.
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Cleaning Reason <span className="text-red-500">*</span></label>
                <Select value={reasonKey} onChange={e => setReasonKey(e.target.value)}>
                  <option value="" disabled>Select reason…</option>
                  {reasons.map(r => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </Select>
                {reasons.length === 0 && (
                  <p className="mt-1 text-xs text-slate-400">No cleaning reasons configured for this block's profile.</p>
                )}
              </div>
              {needsJustification && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Justification <span className="text-red-500">*</span></label>
                  <textarea value={justification} onChange={e => setJustification(e.target.value)}
                    placeholder="Min 10 characters…" rows={3}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-3 focus:ring-brand-600/15 focus:border-brand-600" />
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Remarks <span className="text-red-500">*</span></label>
            <textarea value={remarks} onChange={e => onRemarksChange(e.target.value)}
              placeholder="Enter reason for status change..." rows={4}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-3 focus:ring-brand-600/15 focus:border-brand-600" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
          <button
            onClick={() => onSubmit(needsReason ? { cleaningReasonKey: reasonKey, cleaningJustification: justification.trim() || undefined } : undefined)}
            disabled={submitDisabled}
            className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? 'Processing...' : `Update ${selectedCount} Filter(s)`}
          </button>
        </div>
      </div>
    </>
  );
}
