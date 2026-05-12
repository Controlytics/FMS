import type { CompleteCycleAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';

/**
 * `COMPLETE_CYCLE` — terminal positive action. No payload, no validation,
 * no dialog. Single-click submit. Visual variant is `success` (emerald).
 */
export interface CompleteCycleButtonProps {
  action: CompleteCycleAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

export function CompleteCycleButton({ action, disabled, loading, onSubmit }: CompleteCycleButtonProps) {
  return (
    <BaseActionButton
      actionType="COMPLETE_CYCLE"
      variant="success"
      label={action.label}
      disabled={disabled}
      loading={loading}
      onClick={() => {
        void onSubmit({ type: 'COMPLETE_CYCLE' });
      }}
    />
  );
}
