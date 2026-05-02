import type { BypassStageAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `BYPASS_STAGE`.
 *
 * Bypass is a deviation, so the visual variant is "warning" (amber). Phase 8.2
 * will gate the dispatch behind a justification dialog enforcing
 * `requiresJustification.minLength`. Stub just emits the action.
 */
export interface BypassStageButtonProps {
  action: BypassStageAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function BypassStageButton({ action, disabled, loading, onClick }: BypassStageButtonProps) {
  return (
    <BaseActionButton
      actionType="BYPASS_STAGE"
      variant="warning"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
