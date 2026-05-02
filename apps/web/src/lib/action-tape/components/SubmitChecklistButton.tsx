import type { SubmitChecklistAction } from '../types.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * Phase 8.1 stub for `SUBMIT_CHECKLIST`.
 *
 * Phase 8.2 will swap this for the existing checklist-question modal — it
 * already exists, just needs to be parameterized by `action.params.questions`.
 * Stub: a primary button that dispatches the action.
 */
export interface SubmitChecklistButtonProps {
  action: SubmitChecklistAction;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}

export function SubmitChecklistButton({ action, disabled, loading, onClick }: SubmitChecklistButtonProps) {
  return (
    <BaseActionButton
      actionType="SUBMIT_CHECKLIST"
      variant="primary"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
    />
  );
}
