import type { SubmitDryerReadingsAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `SUBMIT_DRYER_READINGS`.
 *
 * Phase 8.2 will gate the button behind a half-duration countdown and render
 * the readings form (one numeric input per `params.instrumentIds`, validated
 * against `validations.operatingRanges`). Stub just emits the action.
 */
export interface SubmitDryerReadingsButtonProps {
  action: SubmitDryerReadingsAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function SubmitDryerReadingsButton({ action, disabled, loading, onClick }: SubmitDryerReadingsButtonProps) {
  return (
    <BaseActionButton
      actionType="SUBMIT_DRYER_READINGS"
      variant="primary"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
