import type { ReactNode } from 'react';
import { cn } from '../../cn.js';

/**
 * Shared visual primitive for the 7 action-type stub components.
 *
 * Phase 8.1 stubs only render a button — Phase 8.2 will swap most of them for
 * dialogs / forms / countdowns, but the disabled+loading contract stays the
 * same so the dispatch layer doesn't change.
 */
export type BaseActionButtonVariant =
  | 'primary' // ADVANCE / SUBMIT_CHECKLIST / SUBMIT_DRYER_READINGS / SET_DRYER_DURATION
  | 'success' // COMPLETE_CYCLE
  | 'warning' // BYPASS_STAGE (deviation)
  | 'danger'; // TERMINATE_CYCLE

const variantClasses: Record<BaseActionButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500',
  warning: 'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-500',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
};

export interface BaseActionButtonProps {
  label: string;
  variant: BaseActionButtonVariant;
  /** Disabled (because another action is in flight, or caller said so). */
  disabled?: boolean;
  /** Show a spinner-ish hint when this specific button's submit is in flight. */
  loading?: boolean;
  onClick: () => void;
  /** `data-action-type` is used by tests to identify which stub rendered. */
  actionType: string;
  children?: ReactNode;
}

export function BaseActionButton({
  label,
  variant,
  disabled,
  loading,
  onClick,
  actionType,
  children,
}: BaseActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      data-action-type={actionType}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold',
        'shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClasses[variant],
      )}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : null}
      <span>{label}</span>
      {children}
    </button>
  );
}
