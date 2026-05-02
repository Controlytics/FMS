import type { CompleteCycleAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `COMPLETE_CYCLE`.
 *
 * Cycle completion is a positive terminal action; visual variant is "success"
 * (green). The server auto-advances on accept — there's no extra payload.
 * Stub just emits the action.
 */
export interface CompleteCycleButtonProps {
  action: CompleteCycleAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function CompleteCycleButton({ action, disabled, loading, onClick }: CompleteCycleButtonProps) {
  return (
    <BaseActionButton
      actionType="COMPLETE_CYCLE"
      variant="success"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
