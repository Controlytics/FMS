import { useState } from 'react';
import { api } from '@/lib/api-client';

/**
 * Overdue-cleaning acknowledgement — the password confirmation an operator
 * gives before cleaning an AHU whose PM visit is overdue with an open
 * deviation. Extracted from routes/my-tasks/index.tsx (2026-10-19, OQ-06) so
 * the tablet task list asks exactly the same question the web page does; the
 * tablet's Perform used to skip it.
 *
 * The endpoint is `enforceReauthAlways('ACKNOWLEDGE_PM_OVERDUE')`, so the
 * password is always sent — this dialog never consults the configurable
 * re-auth list.
 */
export interface OverdueAckTask {
  ahuName: string;
  totalFilters: number;
  deviation: { deviationId: string; deviationNumber: string; overdueDays: number };
}

export function OverdueAckDialog({ task, canConfirm, onCancel, onAcknowledged }: {
  task: OverdueAckTask;
  /** my_tasks.acknowledge (gate PM_READ) — hidden button rather than a 403. */
  canConfirm: boolean;
  onCancel: () => void;
  /** Runs after the server accepted the acknowledgement; the caller continues to cleaning. */
  onAcknowledged: () => void | Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (!password.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await api.postWithReauth(`/api/pm-schedules/deviations/${task.deviation.deviationId}/acknowledge`, {}, password);
      await onAcknowledged();
    } catch (e: any) {
      const code = e?.error ?? e?.code;
      setError(code === 'REAUTH_FAILED' ? 'Incorrect password. Please try again.' : e?.message ?? 'Could not confirm — please try again.');
      setSubmitting(false);
    }
  };

  const days = task.deviation.overdueDays;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-label="Overdue cleaning confirmation" className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-rose-500 to-rose-600 flex items-center gap-3">
          <svg className="w-6 h-6 text-white shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="text-white font-bold text-base">Overdue Cleaning — Confirmation Required</h3>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-700">
            These <strong>{task.ahuName}</strong> filters are already overdue by{' '}
            <strong className="text-rose-600">{days} day{days === 1 ? '' : 's'}</strong>{' '}
            ({task.totalFilters} filter{task.totalFilters === 1 ? '' : 's'}). Please confirm with your password to continue.
          </p>
          <div className="text-[11px] text-slate-400">Deviation {task.deviation.deviationNumber}</div>
          <div>
            <label htmlFor="overdue-ack-password" className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
            <input
              id="overdue-ack-password"
              type="password" autoFocus value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) confirm(); }}
              placeholder="Enter your password"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm text-slate-700 focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15 outline-none"
            />
            {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
          </div>
        </div>
        <div className="px-6 py-4 bg-slate-50 flex justify-end gap-2">
          <button onClick={onCancel} disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-40">Cancel</button>
          {canConfirm && (
            <button onClick={confirm} disabled={submitting || !password.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 inline-flex items-center gap-2">
              {submitting && <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              Confirm &amp; Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
