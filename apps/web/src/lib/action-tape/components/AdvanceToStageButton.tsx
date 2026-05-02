import type { AdvanceToStageAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `ADVANCE_TO_STAGE`.
 *
 * Phase 8.2 will replace the bare button with an instrument-readings dialog
 * when `params.requiresInstrumentReadings` is set. For now we just dispatch
 * the action shape; the dispatcher (`ActionRenderer`) is responsible for
 * routing the click back to the parent's `onSubmit`.
 */
export interface AdvanceToStageButtonProps {
  action: AdvanceToStageAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function AdvanceToStageButton({ action, disabled, loading, onClick }: AdvanceToStageButtonProps) {
  return (
    <BaseActionButton
      actionType="ADVANCE_TO_STAGE"
      variant="primary"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
