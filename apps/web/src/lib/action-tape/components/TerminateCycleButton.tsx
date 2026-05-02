import type { TerminateCycleAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `TERMINATE_CYCLE`.
 *
 * Termination is destructive; visual variant is "danger" (red). Phase 8.2
 * will gate the dispatch behind a justification dialog. Stub just emits the
 * action.
 */
export interface TerminateCycleButtonProps {
  action: TerminateCycleAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function TerminateCycleButton({ action, disabled, loading, onClick }: TerminateCycleButtonProps) {
  return (
    <BaseActionButton
      actionType="TERMINATE_CYCLE"
      variant="danger"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
