import type { ReactNode } from 'react';
import { cn } from '../../cn.js';

/**
 * Shared modal primitive for the 4 dialog-bearing action renderers
 * (BYPASS_STAGE, TERMINATE_CYCLE, SUBMIT_CHECKLIST, SUBMIT_DRYER_READINGS,
 * SET_DRYER_DURATION, ADVANCE_TO_STAGE-with-readings).
 *
 * The dialog is a controlled component — open/close state is owned by the
 * caller (the per-action renderer), so each renderer can decide what triggers
 * the dialog (a click) and what dismisses it (cancel button, submit success,
 * the parent revoking permission, etc.). The body slot is opaque so each
 * renderer can build whatever form it needs (textarea, numeric grid, question
 * list, etc.).
 *
 * Theme: light (`bg-white`, `border-slate-200`, gradient header — same pattern
 * as the existing `dryer-duration-dialog.tsx`).
 */
export interface ActionDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Title rendered in the gradient header. Usually the action's `label`. */
  title: string;
  /** Optional sub-title (e.g. filter name). Appears under the title. */
  subtitle?: string;
  /** Form body — owned by the action renderer. */
  children: ReactNode;
  /** Submit-button label override. Defaults to "Submit". */
  submitLabel?: string;
  /** Cancel-button label override. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Inline error message rendered above the footer when non-empty. */
  error?: string;
  /** When true, both buttons are disabled and the submit button shows a spinner-ish hint. */
  loading?: boolean;
  /** Disable the submit button only (cancel still works). Useful for client-side form validation. */
  submitDisabled?: boolean;
  /** Variant for the submit button — defaults to `primary`. Bypass uses `warning`, terminate uses `danger`. */
  submitVariant?: 'primary' | 'success' | 'warning' | 'danger';
  /** Called when the user clicks Cancel or the backdrop. */
  onCancel: () => void;
  /** Called when the user clicks Submit. */
  onSubmit: () => void;
}

const submitVariantClasses: Record<NonNullable<ActionDialogProps['submitVariant']>, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500',
  warning: 'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
};

const headerVariantClasses: Record<NonNullable<ActionDialogProps['submitVariant']>, string> = {
  primary: 'bg-gradient-to-r from-blue-600 to-blue-500',
  success: 'bg-gradient-to-r from-emerald-600 to-emerald-500',
  warning: 'bg-gradient-to-r from-amber-600 to-amber-500',
  danger: 'bg-gradient-to-r from-red-600 to-red-500',
};

export function ActionDialog({
  open,
  title,
  subtitle,
  children,
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  error,
  loading,
  submitDisabled,
  submitVariant = 'primary',
  onCancel,
  onSubmit,
}: ActionDialogProps) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="action-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      // Click on the backdrop dismisses the dialog (matches existing pattern).
      onMouseDown={e => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl" onMouseDown={e => e.stopPropagation()}>
        <div className={cn('rounded-t-lg px-5 py-4 text-white', headerVariantClasses[submitVariant])}>
          <h2 id="action-dialog-title" className="text-lg font-semibold">{title}</h2>
          {subtitle ? <p className="text-sm opacity-90">{subtitle}</p> : null}
        </div>
        <div className="space-y-4 p-5">
          <div>{children}</div>
          {error ? (
            <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              data-action-dialog-cancel
              className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading || submitDisabled}
              aria-busy={loading || undefined}
              data-action-dialog-submit
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-semibold',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                'disabled:cursor-not-allowed disabled:opacity-50',
                submitVariantClasses[submitVariant],
              )}
            >
              {loading ? (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : null}
              <span>{loading ? 'Submitting…' : submitLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
