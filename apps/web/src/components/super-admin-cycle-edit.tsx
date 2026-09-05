/**
 * SUPER_ADMIN edit of one cleaning cycle AND its stage events, launched from
 * the Cleaning Record page, the cycle View page and the Filter Lifecycle
 * Report (2026-09-05, operator request).
 *
 * The columns an operator reads on those pages come from two tables: the
 * cycle row (status, times, reason, dryer duration) and the `filter_events`
 * rows (per-stage time, performer, remarks, instrument readings). One dialog
 * shows both, and saves through the two audited console endpoints -
 * `PUT /api/super-admin/data/cleaning-cycles/:id` and
 * `PUT /api/super-admin/data/filter-events/:id` - with ONE change reason and
 * one re-auth. Only changed fields are sent; readings keep their instrument
 * identity (id / description / uom / leastCount) and only the value moves.
 *
 * `cycle` may be null for a manual status update, which is a single event
 * with no cycle row: then only the event section renders.
 */
import { useEffect, useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { api } from '@/lib/api-client';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { isoToDatetimeInput, toIsoIfNaiveDatetime } from '@/lib/datetime-input';
import { ALL_ROWS } from '@/lib/page-size';
import { MIN_REASON_LEN } from '@/components/super-admin-record-edit';

const STATES = ['INSTALLED', 'WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT', 'IN_USE', 'CLEANING_CYCLE_COMPLETED'];
const CYCLE_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'TERMINATED'];
const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500';
const labelCls = 'block text-[12px] font-medium text-slate-600 mb-1';

/** SWR keys that render cycle / event data anywhere in the app. Over-invalidate on purpose. */
export function revalidateCycleData() {
  mutate((key) => typeof key === 'string' && (
    key.startsWith('/api/filters/cycles') || key.startsWith('/api/filters/cleaning-record') || key.startsWith('/api/filters/events')
    || key.startsWith('/api/filters/manual-status-changes') || key.startsWith('/api/hierarchy') || key.startsWith('/api/assets/instances')
    || key.startsWith('/api/dashboards')
  ));
}

type EventDraft = {
  fromState: string; toState: string; performedAt: string; performedBy: string; remarks: string;
  readings: string[]; // value per stored reading, same order
};

export function SuperAdminCycleEditDialog({ cycle, events, title, onClose, onSaved }: {
  /** The cycle row (null for a manual status update). */
  cycle: any | null;
  /** The stage events to edit, in display order. */
  events: any[];
  title: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { config } = useDatetimeFormat();
  const tz = config.timezone;
  const reauth = useReauth();
  const { data: usersData } = useSWR<any>(`/api/users?page=1&limit=${ALL_ROWS}`);
  const users: any[] = (usersData as any)?.data ?? [];

  const cycleSeed = useMemo<Record<string, string> | null>(() => cycle ? {
    status: cycle.status ?? '',
    cleaningReasonLabel: cycle.cleaningReasonLabel ?? '',
    startedAt: isoToDatetimeInput(cycle.startedAt, tz),
    completedAt: isoToDatetimeInput(cycle.completedAt, tz),
    terminatedAt: isoToDatetimeInput(cycle.terminatedAt, tz),
    terminationReason: cycle.terminationReason ?? '',
    dryerDurationMinutes: cycle.dryerDurationMinutes == null ? '' : String(cycle.dryerDurationMinutes),
    dryerStartedAt: isoToDatetimeInput(cycle.dryerStartedAt, tz),
  } : null, [cycle, tz]);
  const eventSeed = useMemo<EventDraft[]>(() => events.map((e) => ({
    fromState: e.fromState ?? '', toState: e.toState ?? '',
    performedAt: isoToDatetimeInput(e.performedAt, tz),
    performedBy: e.performedBy ?? '',
    remarks: e.remarks ?? '',
    readings: ((e.attributes?.instrumentReadings ?? []) as any[]).map((r) => (r?.value == null ? '' : String(r.value))),
  })), [events, tz]);

  const [c, setC] = useState<Record<string, string> | null>(cycleSeed);
  const [ev, setEv] = useState<EventDraft[]>(eventSeed);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setC(cycleSeed); setEv(eventSeed); setReason(''); setError(''); }, [cycleSeed, eventSeed]);

  const setCycleField = (k: string, v: string) => setC((prev) => (prev ? { ...prev, [k]: v } : prev));
  const setEvField = (i: number, k: keyof EventDraft, v: string) => setEv((prev) => prev.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  const setReading = (i: number, r: number, v: string) => setEv((prev) => prev.map((d, j) => (j === i ? { ...d, readings: d.readings.map((x, k) => (k === r ? v : x)) } : d)));

  // ── diff
  const cycleBody = (): Record<string, any> => {
    if (!c || !cycleSeed) return {};
    const out: Record<string, any> = {};
    for (const k of Object.keys(cycleSeed)) {
      if (c[k] === cycleSeed[k]) continue;
      if (['startedAt', 'completedAt', 'terminatedAt', 'dryerStartedAt'].includes(k)) out[k] = c[k] ? toIsoIfNaiveDatetime(c[k], tz) : null;
      else if (k === 'dryerDurationMinutes') out[k] = c[k] === '' ? null : Number(c[k]);
      else out[k] = c[k];
    }
    return out;
  };
  const eventBodies = (): Array<{ id: string; body: Record<string, any> }> => {
    const out: Array<{ id: string; body: Record<string, any> }> = [];
    ev.forEach((d, i) => {
      const seed = eventSeed[i]; const e = events[i];
      const body: Record<string, any> = {};
      if (d.fromState !== seed.fromState) body.fromState = d.fromState || null;
      if (d.toState !== seed.toState) body.toState = d.toState || null;
      if (d.performedAt !== seed.performedAt && d.performedAt) body.performedAt = toIsoIfNaiveDatetime(d.performedAt, tz);
      if (d.performedBy !== seed.performedBy && d.performedBy) body.performedBy = d.performedBy;
      if (d.remarks !== seed.remarks) body.remarks = d.remarks;
      const stored: any[] = e.attributes?.instrumentReadings ?? [];
      let readingsChanged = false;
      const next = stored.map((r, k) => {
        const raw = d.readings[k];
        if (raw === seed.readings[k] || raw === '') return r;
        const n = Number(raw); if (!Number.isFinite(n)) return r;
        readingsChanged = true;
        // Only the value - the instrument identity is not the operator's to retype.
        return { ...r, value: n };
      });
      if (readingsChanged) body.attributes = { instrumentReadings: next };
      if (Object.keys(body).length > 0) out.push({ id: e.id, body });
    });
    return out;
  };
  const cb = cycleBody(); const ebs = eventBodies();
  const changes = Object.keys(cb).length + ebs.length;
  const canSave = !saving && changes > 0 && reason.trim().length >= MIN_REASON_LEN;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true); setError('');
    const put = (url: string, body: any, pw?: string) => (pw ? api.putWithReauth(url, body, pw) : api.put(url, body));
    try {
      await reauth.executeWithResult('SUPER_ADMIN_DATA_EDIT', async (pw) => {
        const r = reason.trim();
        if (cycle && Object.keys(cb).length > 0) await put(`/api/super-admin/data/cleaning-cycles/${cycle.id}`, { ...cb, _changeReason: r }, pw);
        for (const { id, body } of ebs) await put(`/api/super-admin/data/filter-events/${id}`, { ...body, _changeReason: r }, pw);
      });
      revalidateCycleData();
      onSaved?.();
      onClose();
    } catch (e: any) {
      if (e?.error === 'REAUTH_CANCELLED' || e?.error === 'REAUTH_SUPERSEDED') { setSaving(false); return; }
      setError(e?.message ?? 'Save failed');
      setSaving(false);
    }
  };

  const stateOptions = (cur: string) => (STATES.includes(cur) || !cur ? STATES : [cur, ...STATES]);
  const userLabel = (id: string) => { const u = users.find((x) => x.id === id); return u ? `${u.fullName ?? u.username} (${u.username})` : ''; };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4" role="dialog" aria-modal="true" aria-label={title}>
        <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl overflow-hidden flex flex-col shadow-2xl">
          <div className="px-6 py-4 shrink-0 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500">
            <div>
              <h2 className="text-lg font-bold text-white">{title}</h2>
              <p className="text-white/75 text-xs">Super Admin edit - cycle row and each stage event are written to the database and recorded in the audit trail</p>
            </div>
            <button type="button" onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-5 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 170px)' }}>
            {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

            {c && cycle && (
              <section className="space-y-3">
                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cycle {cycle.cycleCode ? `· ${cycle.cycleCode}` : ''}</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls}>Status</label>
                    <select value={c.status} onChange={(e) => setCycleField('status', e.target.value)} className={inputCls}>
                      {(CYCLE_STATUSES.includes(c.status) ? CYCLE_STATUSES : [c.status, ...CYCLE_STATUSES]).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                    </select></div>
                  <div><label className={labelCls}>Cleaning reason</label><input value={c.cleaningReasonLabel} onChange={(e) => setCycleField('cleaningReasonLabel', e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Started at</label><input type="datetime-local" step={60} value={c.startedAt} onChange={(e) => setCycleField('startedAt', e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Completed at</label><input type="datetime-local" step={60} value={c.completedAt} onChange={(e) => setCycleField('completedAt', e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Terminated at</label><input type="datetime-local" step={60} value={c.terminatedAt} onChange={(e) => setCycleField('terminatedAt', e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Termination reason</label><input value={c.terminationReason} onChange={(e) => setCycleField('terminationReason', e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Dryer duration (min)</label><input type="number" min={0} value={c.dryerDurationMinutes} onChange={(e) => setCycleField('dryerDurationMinutes', e.target.value)} className={inputCls} /></div>
                  <div><label className={labelCls}>Dryer started at</label><input type="datetime-local" step={60} value={c.dryerStartedAt} onChange={(e) => setCycleField('dryerStartedAt', e.target.value)} className={inputCls} /></div>
                </div>
                <p className="text-[11px] text-slate-500">Moving the status out of In Progress also clears the filter's current-cycle pointer, as Terminate does.</p>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stage events ({events.length})</h3>
              {events.length === 0 && <p className="text-sm text-slate-400">This record has no stage events.</p>}
              {events.map((e, i) => {
                const d = ev[i]; if (!d) return null;
                const readings: any[] = e.attributes?.instrumentReadings ?? [];
                const head = e.eventType === 'STATE_TRANSITION'
                  ? `${(e.fromState ?? 'start').replace(/_/g, ' ')} → ${(e.toState ?? '-').replace(/_/g, ' ')}`
                  : String(e.eventType ?? 'event').replace(/_/g, ' ');
                return (
                  <div key={e.id} className="border border-slate-200 rounded-xl p-3 space-y-3 bg-slate-50/50">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-slate-800">#{i + 1} {head}</span>
                      {e.attributes?.action && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">{String(e.attributes.action).replace(/_/g, ' ')}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {e.eventType === 'STATE_TRANSITION' && (
                        <>
                          <div><label className={labelCls}>From</label>
                            <select value={d.fromState} onChange={(x) => setEvField(i, 'fromState', x.target.value)} className={inputCls}>
                              <option value="">(start)</option>
                              {stateOptions(d.fromState).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                            </select></div>
                          <div><label className={labelCls}>To</label>
                            <select value={d.toState} onChange={(x) => setEvField(i, 'toState', x.target.value)} className={inputCls}>
                              <option value="">-</option>
                              {stateOptions(d.toState).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                            </select></div>
                        </>
                      )}
                      <div><label className={labelCls}>Performed at</label><input type="datetime-local" step={60} value={d.performedAt} onChange={(x) => setEvField(i, 'performedAt', x.target.value)} className={inputCls} /></div>
                      <div><label className={labelCls}>Performed by</label>
                        <select value={d.performedBy} onChange={(x) => setEvField(i, 'performedBy', x.target.value)} className={inputCls}>
                          {d.performedBy && !userLabel(d.performedBy) && <option value={d.performedBy}>{e.performedByName ?? e.performedByUsername ?? d.performedBy}</option>}
                          {!d.performedBy && <option value="">-- keep current --</option>}
                          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName ?? u.username} ({u.username})</option>)}
                        </select></div>
                      <div className="col-span-2"><label className={labelCls}>Remarks</label><input value={d.remarks} onChange={(x) => setEvField(i, 'remarks', x.target.value)} className={inputCls} /></div>
                      {readings.map((r, k) => (
                        <div key={k}><label className={labelCls}>{r?.description ?? r?.instrumentCode ?? 'Reading'}{r?.uom ? ` (${r.uom})` : ''}{r?.source ? ` · ${String(r.source).toLowerCase()}` : ''}</label>
                          <input type="number" step="any" value={d.readings[k] ?? ''} onChange={(x) => setReading(i, k, x.target.value)} className={inputCls} /></div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>

            <div className="pt-3 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="sa-cycle-reason">Reason for this change <span className="text-red-500">*</span></label>
              <textarea id="sa-cycle-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={saving}
                placeholder={`At least ${MIN_REASON_LEN} characters - recorded on every audit row this save writes`} className={inputCls} />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
            <span className="text-[12px] text-slate-500 flex-1">{changes === 0 ? 'Nothing changed yet' : `${changes} change(s) ready`}</span>
            <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
            <button type="button" onClick={submit} disabled={!canSave}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={() => { reauth.cancel(); setSaving(false); }} actionLabel={title} />
    </>
  );
}
