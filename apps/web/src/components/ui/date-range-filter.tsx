import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The one From/To date-range control for the whole app (2026-08-27).
 *
 * Before this existed there were 11 hand-rolled ranges across 10 files — nine
 * desktop screens and two on the tablet — each with its own markup, spacing and
 * focus colour, and **not one of them stopped you picking a To earlier than the
 * From**. An inverted range is not rejected by the API either: it just returns
 * an empty list, so the operator saw "no records" and had no way to tell that
 * from "no matching records".
 *
 * ## The contract: one callback per user action
 *
 * This component NEVER calls the sibling's `onChange`. When a From change would
 * put the start after the end, the change is **rejected** and a hint is shown —
 * we do not "helpfully" drag the To along with it.
 *
 * That matters because the call sites do more than set state:
 *
 *   pm-schedules:  setDateFrom(v); setSelected(new Set()); setPage(1)
 *   history:       setFromDate(v); setPage(1)
 *   deviations:    setFromDate(v); setDownloadMsg('')
 *
 * A component that fired both callbacks would run one site's reset logic and
 * not the other's, and would change two SWR keys in a single tick — a double
 * fetch on every edit. Rejecting keeps each site's existing handler exactly as
 * it was, with no per-site auditing needed.
 *
 * ## Two layers of enforcement, because `min`/`max` alone is not enough
 *
 * `max` on From and `min` on To grey out the invalid days in the native picker.
 * But a browser still lets you TYPE an out-of-range value — the input goes
 * `:invalid` while `value` updates anyway. So every change is re-checked in JS
 * and dropped if it inverts the range. The native attributes are the good UX;
 * the JS check is the actual guarantee.
 *
 * ## Same-day ranges stay legal
 *
 * The comparison is `>` / `<`, never `>=`. For `type="date"`, from === to is a
 * perfectly ordinary single-day filter and must keep working. (For
 * `datetime-local` an identical instant is a zero-width window that returns
 * nothing, but that is the operator's business, not an error.)
 *
 * String comparison is safe for both formats: `yyyy-mm-dd` and
 * `yyyy-mm-ddTHH:mm` are both lexicographically ordered.
 */

/**
 * The ordering rule itself, exported so a screen with its own bespoke markup
 * can enforce exactly the same thing without adopting this component's look.
 * The Audit Trail filter uses it — its gradient From/To cards are a nicer
 * design than a generic control, so it keeps the markup and borrows the rule.
 *
 * Returns `null` when the change is fine, or the hint to show when it is not.
 * Clearing an end is always allowed: an open-ended range is valid.
 */
export function checkRangeEdge(
  edge: 'from' | 'to',
  value: string,
  other: string,
  type: 'date' | 'datetime-local' = 'date',
): string | null {
  if (!value || !other) return null;
  const unit = type === 'date' ? 'date' : 'date and time';
  // `>` / `<`, never `>=` — from === to is a legitimate single-day filter.
  if (edge === 'from' && value > other) {
    return `Start ${unit} can't be after the end — change the "To" value first.`;
  }
  if (edge === 'to' && value < other) {
    return `End ${unit} can't be before the start — change the "From" value first.`;
  }
  return null;
}

export type DateRangeFilterProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** `date` (default) or `datetime-local`. Must match what the screen sends to the API. */
  type?: 'date' | 'datetime-local';
  /** sm = compact toolbars · md = default · lg = matches the `Input` primitive's h-11. */
  size?: 'sm' | 'md' | 'lg';
  /** Forwarded to both inputs — the tablet uses it for its offline guard. */
  disabled?: boolean;
  /** Show the ✕ that clears both ends. */
  clearable?: boolean;
  /** Caption above the control. Omit when the screen already labels the row. */
  label?: string;
  className?: string;
  /** Accessible names; override when a screen has two ranges. */
  fromAriaLabel?: string;
  toAriaLabel?: string;
};

const SIZES = {
  sm: { field: 'h-8 text-[12px] px-2', gap: 'gap-1.5', icon: 'w-3.5 h-3.5', pad: 'px-2 py-1' },
  md: { field: 'h-9 text-[13px] px-2.5', gap: 'gap-2', icon: 'w-4 h-4', pad: 'px-2.5 py-1.5' },
  lg: { field: 'h-11 text-sm px-3', gap: 'gap-2', icon: 'w-4 h-4', pad: 'px-3 py-2' },
} as const;

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  type = 'date',
  size = 'md',
  disabled = false,
  clearable = true,
  label,
  className,
  fromAriaLabel = 'From date',
  toAriaLabel = 'To date',
}: DateRangeFilterProps) {
  const [hint, setHint] = useState('');
  const hintId = useId();
  const s = SIZES[size];

  // Clear the hint a few seconds after it appears so it doesn't sit there
  // forever once the operator has corrected the range.
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(''), 4000);
    return () => clearTimeout(t);
  }, [hint]);

  const handleFrom = (value: string) => {
    const problem = checkRangeEdge('from', value, to, type);
    if (problem) { setHint(problem); return; }
    setHint('');
    onFromChange(value);
  };

  const handleTo = (value: string) => {
    const problem = checkRangeEdge('to', value, from, type);
    if (problem) { setHint(problem); return; }
    setHint('');
    onToChange(value);
  };

  const fieldCls = cn(
    'rounded-lg border border-slate-200 bg-slate-50 text-slate-700',
    'focus:bg-white focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15 focus:outline-none',
    'hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200',
    'transition-all [color-scheme:light]',
    s.field,
  );

  const showClear = clearable && !disabled && (!!from || !!to);

  return (
    <div className={cn('inline-flex flex-col', className)}>
      {label && (
        <label className="mb-1 block text-xs font-semibold text-slate-500">
          {label}
        </label>
      )}
      <div className={cn('inline-flex flex-wrap items-center', s.gap)}>
        <svg
          className={cn(s.icon, 'shrink-0 text-slate-400')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>

        <input
          type={type}
          value={from}
          disabled={disabled}
          aria-label={fromAriaLabel}
          aria-describedby={hint ? hintId : undefined}
          // Greys out the invalid days in the native picker. The JS check in
          // handleFrom is what actually enforces it — this is UX, not the guard.
          max={to || undefined}
          onChange={(e) => handleFrom(e.target.value)}
          className={fieldCls}
        />

        <span className="shrink-0 select-none text-[11px] font-medium text-slate-400">to</span>

        <input
          type={type}
          value={to}
          disabled={disabled}
          aria-label={toAriaLabel}
          aria-describedby={hint ? hintId : undefined}
          min={from || undefined}
          onChange={(e) => handleTo(e.target.value)}
          className={fieldCls}
        />

        {showClear && (
          <button
            type="button"
            // Two callbacks here is correct and not a contract violation: this
            // is one user action that clears BOTH ends, not a side effect of
            // editing one of them.
            onClick={() => {
              setHint('');
              onFromChange('');
              onToChange('');
            }}
            aria-label="Clear date range"
            title="Clear date range"
            className={cn(
              'shrink-0 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600',
              'focus:outline-none focus:ring-3 focus:ring-brand-600/15 transition-colors',
              s.pad,
            )}
          >
            <svg className={s.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {hint && (
        <p id={hintId} role="alert" className="mt-1 text-[11px] font-medium text-amber-600">
          {hint}
        </p>
      )}
    </div>
  );
}
