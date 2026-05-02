import type { SetDryerDurationAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `SET_DRYER_DURATION`.
 *
 * Phase 8.2 will replace this with the existing dryer-duration dialog
 * (already in `routes/filter-management/components/dryer-duration-dialog.tsx`)
 * driven by `params.minMinutes`/`maxMinutes`. Stub just emits the action.
 */
export interface SetDryerDurationButtonProps {
  action: SetDryerDurationAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function SetDryerDurationButton({ action, disabled, loading, onClick }: SetDryerDurationButtonProps) {
  return (
    <BaseActionButton
      actionType="SET_DRYER_DURATION"
      variant="primary"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
