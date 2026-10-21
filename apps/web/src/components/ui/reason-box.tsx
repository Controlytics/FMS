/**
 * Mandatory justification input for any change that is written to the audit
 * trail (21 CFR §11: decisions carry a reason). Moved here from
 * filter-data-management.tsx on 2026-10-21 so the role-permission screens
 * (P4-10) use the same field instead of a copy. Declared at module scope so
 * React keeps the same element across re-renders and the textarea does not
 * lose focus on every keystroke.
 */

/** Minimum length of the mandatory change reason — mirrors the API's checks
 *  (`super-admin/manual-change.ts` MIN_REASON_LEN, `lib/change-reason.ts`). */
export const MIN_REASON_LEN = 5;
export const reasonOk = (r: string) => r.trim().length >= MIN_REASON_LEN;

export function ReasonBox({ value, onChange, danger, hint, placeholder }: { value: string; onChange: (v: string) => void; danger?: boolean; hint?: string; placeholder?: string }) {
  const short = MIN_REASON_LEN - value.trim().length;
  return (
    <div className="mt-4">
      <label className="block text-xs font-bold text-slate-500 mb-1.5">
        Reason for this change <span className="text-red-500">*</span>
      </label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        placeholder={placeholder ?? 'Why is this record being changed?'}
        className={`w-full px-3 py-2 border rounded-lg text-[13px] resize-none focus:ring-3 focus:outline-none ${
          danger ? 'border-red-200 focus:ring-red-500/30 focus:border-red-400' : 'border-slate-200 focus:ring-brand-600/15 focus:border-brand-600'
        }`}
      />
      <p className="text-[11px] text-slate-400 mt-1">
        {short > 0 ? `${short} more character${short === 1 ? '' : 's'} required` : (hint ?? 'Recorded on the audit trail alongside the before/after values.')}
      </p>
    </div>
  );
}
