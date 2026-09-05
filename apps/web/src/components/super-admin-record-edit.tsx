/**
 * SUPER_ADMIN "Edit record" on the user-facing pages (2026-09-05, operator
 * request): RFID Track Record, Filters, Admin Requests, Notifications,
 * Retirement List, Replacement List.
 *
 * ONE dialog for all six so the rules cannot drift between pages:
 *   - visible to SUPER_ADMIN only (`useIsSuperAdmin`) - the backend routes
 *     are `requireRole('SUPER_ADMIN')` regardless, this only hides the button;
 *   - every save carries a change reason of at least MIN_REASON_LEN
 *     characters (`_changeReason`, the console's contract);
 *   - the SUPER_ADMIN_DATA_EDIT re-auth prompt is owned here, so a page needs
 *     no reauth wiring of its own;
 *   - only CHANGED fields are sent, so the partial-update endpoints never
 *     receive a value the operator did not touch;
 *   - `chainWarning` prints the audit-hash-chain warning for records that ARE
 *     audit rows (RFID events, retirements, replacements).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import useSWR from 'swr';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { isoToDatetimeInput, toIsoIfNaiveDatetime } from '@/lib/datetime-input';

export const MIN_REASON_LEN = 5;

/**
 * Same user resolution as `useAuth` (SWR `/api/auth/me` with the cached
 * offline fallback) minus `useNavigate`, so a page can call this outside a
 * Router - page unit tests render without one.
 */
export function useIsSuperAdmin(): boolean {
  const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('access_token') : null;
  const cached = (): { role?: string } | undefined => {
    try { const raw = localStorage.getItem('digilog_cached_user'); return raw ? JSON.parse(raw) : undefined; } catch { return undefined; }
  };
  const { data } = useSWR<{ role?: string }>(token ? '/api/auth/me' : null, { fallbackData: cached() });
  const user = data ?? (token ? cached() : undefined);
  return user?.role === 'SUPER_ADMIN';
}

export type EditFieldOption = { value: string; label: string };

export type EditFieldSpec = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'datetime' | 'select' | 'checkbox';
  /** For `select`. A function receives the current values (cascading lists). */
  options?: EditFieldOption[] | ((values: Record<string, any>) => EditFieldOption[]);
  /** Label of the blank option for `select` (omit to force a choice). */
  emptyOption?: string;
  required?: boolean;
  placeholder?: string;
  /** Short note under the field. */
  help?: ReactNode;
  disabled?: boolean;
  /** Free-text suggestions (`text` only). */
  suggestions?: string[];
  /** Hide the field until another field has a value (cascades). */
  showWhen?: (values: Record<string, any>) => boolean;
};

export interface SuperAdminRecordEditDialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  fields: EditFieldSpec[];
  /** Current values, keyed by field key. ISO strings for `datetime`. */
  initial: Record<string, any>;
  /** The record is an audit row: editing breaks the hash chain from it onward. */
  chainWarning?: boolean;
  /**
   * Called with ONLY the changed fields (datetime already converted to an
   * explicit-UTC ISO string), the reason, and the re-auth password when the
   * action is gated. Must PUT to the endpoint; throw to show the error.
   */
  onSave: (changed: Record<string, any>, reason: string, password?: string) => Promise<unknown>;
  onSaved?: (result: unknown) => void;
  onClose: () => void;
  saveLabel?: string;
  /** Lets a page react to field edits (e.g. clear a dependent field). */
  onChange?: (key: string, value: any, next: Record<string, any>) => Record<string, any> | void;
  /** Re-auth action the save is gated on. Default SUPER_ADMIN_DATA_EDIT; the audit row edit uses UPDATE_AUDIT_RECORD. */
  reauthAction?: string;
}

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-800 bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:bg-slate-50 disabled:text-slate-400';

export function SuperAdminRecordEditDialog({
  open, title, subtitle, fields, initial, chainWarning, onSave, onSaved, onClose, saveLabel = 'Save changes', onChange, reauthAction = 'SUPER_ADMIN_DATA_EDIT',
}: SuperAdminRecordEditDialogProps) {
  const { config } = useDatetimeFormat();
  const tz = config.timezone;
  const reauth = useReauth();

  // Datetime inputs work in wall-clock text in the configured zone; the
  // stored ISO instant is converted on the way in and back on the way out.
  const seed = useMemo(() => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      const v = initial[f.key];
      if (f.type === 'datetime') out[f.key] = isoToDatetimeInput(v ?? null, tz);
      else if (f.type === 'checkbox') out[f.key] = !!v;
      else out[f.key] = v === null || v === undefined ? '' : String(v);
    }
    return out;
  }, [fields, initial, tz]);

  const [values, setValues] = useState<Record<string, any>>(seed);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setValues(seed); setReason(''); setError(''); setSaving(false); } }, [open, seed]);

  if (!open) return null;

  const set = (key: string, value: any) => {
    setValues(prev => {
      const next = { ...prev, [key]: value };
      const adjusted = onChange?.(key, value, next);
      return adjusted ?? next;
    });
  };

  const changed = (): Record<string, any> => {
    const out: Record<string, any> = {};
    for (const f of fields) {
      if (f.showWhen && !f.showWhen(values)) continue;
      const cur = values[f.key];
      const was = seed[f.key];
      if (cur === was) continue;
      if (f.type === 'datetime') out[f.key] = cur ? toIsoIfNaiveDatetime(cur, tz) : '';
      else if (f.type === 'number') out[f.key] = cur === '' ? '' : Number(cur);
      else out[f.key] = cur;
    }
    return out;
  };

  const missingRequired = fields.filter(f => f.required && (!f.showWhen || f.showWhen(values)) && (values[f.key] === '' || values[f.key] === undefined)).map(f => f.label);
  const diff = changed();
  const canSave = !saving && reason.trim().length >= MIN_REASON_LEN && Object.keys(diff).length > 0 && missingRequired.length === 0;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true); setError('');
    try {
      const result = await reauth.executeWithResult(reauthAction, (pw) => onSave(diff, reason.trim(), pw));
      onSaved?.(result);
      onClose();
    } catch (e: any) {
      if (e?.error === 'REAUTH_CANCELLED' || e?.error === 'REAUTH_SUPERSEDED') { setSaving(false); return; }
      setError(e?.message ?? 'Save failed');
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4" role="dialog" aria-modal="true" aria-label={title}>
        <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg overflow-hidden flex flex-col shadow-2xl">
          <div className="px-6 py-4 shrink-0 flex items-center justify-between bg-gradient-to-r from-amber-500 to-orange-500">
            <div>
              <h2 className="text-lg font-bold text-white">{title}</h2>
              <p className="text-white/75 text-xs">{subtitle ?? 'Super Admin edit - written to the database and recorded in the audit trail'}</p>
            </div>
            <button type="button" onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="px-6 py-5 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 170px)' }}>
            {chainWarning && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-[12px] text-red-700">
                This record is stored as an audit-trail row. Saving rewrites that row and <strong>permanently breaks the audit hash chain</strong> from this record onward. The original values are preserved in a new audit record.
              </div>
            )}
            {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

            {fields.filter(f => !f.showWhen || f.showWhen(values)).map(f => (
              <div key={f.key}>
                {f.type !== 'checkbox' && (
                  <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor={`sa-edit-${f.key}`}>
                    {f.label}{f.required && <span className="text-red-500"> *</span>}
                  </label>
                )}
                {f.type === 'select' ? (() => {
                  const opts = typeof f.options === 'function' ? f.options(values) : (f.options ?? []);
                  return (
                    <select id={`sa-edit-${f.key}`} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} disabled={f.disabled || saving} className={inputCls}>
                      {(f.emptyOption !== undefined || !opts.some(o => o.value === values[f.key])) && <option value="">{f.emptyOption ?? '-- select --'}</option>}
                      {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  );
                })() : f.type === 'textarea' ? (
                  <textarea id={`sa-edit-${f.key}`} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} disabled={f.disabled || saving} rows={3} placeholder={f.placeholder} className={inputCls} />
                ) : f.type === 'checkbox' ? (
                  <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                    <input id={`sa-edit-${f.key}`} type="checkbox" checked={!!values[f.key]} onChange={e => set(f.key, e.target.checked)} disabled={f.disabled || saving} className="w-4 h-4 accent-amber-600" />
                    {f.label}
                  </label>
                ) : f.type === 'datetime' ? (
                  <input id={`sa-edit-${f.key}`} type="datetime-local" step={60} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} disabled={f.disabled || saving} className={inputCls} />
                ) : (
                  <>
                    <input id={`sa-edit-${f.key}`} type={f.type === 'number' ? 'number' : 'text'} value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}
                      disabled={f.disabled || saving} placeholder={f.placeholder} list={f.suggestions ? `sa-edit-list-${f.key}` : undefined} className={inputCls} />
                    {f.suggestions && (
                      <datalist id={`sa-edit-list-${f.key}`}>{f.suggestions.map(s => <option key={s} value={s} />)}</datalist>
                    )}
                  </>
                )}
                {f.help && <p className="mt-1 text-[11px] text-slate-500">{f.help}</p>}
              </div>
            ))}

            <div className="pt-3 border-t border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="sa-edit-reason">
                Reason for this change <span className="text-red-500">*</span>
              </label>
              <textarea id="sa-edit-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} disabled={saving}
                placeholder={`At least ${MIN_REASON_LEN} characters - recorded on the audit row`} className={inputCls} />
            </div>
          </div>

          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
            <button type="button" onClick={onClose} disabled={saving} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors">Cancel</button>
            <button type="button" onClick={submit} disabled={!canSave}
              title={Object.keys(diff).length === 0 ? 'Nothing changed yet' : missingRequired.length ? `Required: ${missingRequired.join(', ')}` : reason.trim().length < MIN_REASON_LEN ? 'Enter a reason' : undefined}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving...' : saveLabel}
            </button>
          </div>
        </div>
      </div>
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={() => { reauth.cancel(); setSaving(false); }}
        actionLabel={title}
      />
    </>
  );
}

/** The pencil glyph on its own, for call sites that already render a <button>. */
export function PencilIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

/** The pencil button every page places on its rows; SA-only by construction. */
export function SuperAdminEditButton({ onClick, title = 'Edit record (Super Admin)', className = '' }: { onClick: (e: React.MouseEvent) => void; title?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className={`p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors ${className}`}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    </button>
  );
}

/** Users list -> select options (label "Full name (username)", value = the chosen key). */
export function userOptions(users: any[], valueKey: 'id' | 'username' = 'id'): EditFieldOption[] {
  return (users ?? []).map((u: any) => ({ value: String(u[valueKey]), label: `${u.fullName ?? u.username} (${u.username})` }));
}
