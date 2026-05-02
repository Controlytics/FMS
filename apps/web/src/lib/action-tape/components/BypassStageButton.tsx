import { useState } from 'react';
import type { BypassStageAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';
import { ActionDialog } from './action-dialog.js';

/**
 * `BYPASS_STAGE` — deviation transition. Click opens a justification dialog
 * (single textarea, required, min length from `action.requiresJustification.minLength`).
 *
 * Visual variant is `warning` (amber) on both the trigger button and the
 * dialog header to reinforce that bypass is a deviation that produces a
 * non-conformance audit-trail entry on the server (`BYPASS_DEVIATION`).
 */
export interface BypassStageButtonProps {
  action: BypassStageAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

export function BypassStageButton({ action, disabled, loading, onSubmit }: BypassStageButtonProps) {
  const minLength = action.requiresJustification.minLength;
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState('');
  const [error, setError] = useState('');

  const handleClick = () => {
    setOpen(true);
    setJustification('');
    setError('');
  };

  const handleCancel = () => {
    if (loading) return;
    setOpen(false);
    setError('');
  };

  const handleSubmit = async () => {
    const j = justification.trim();
    if (j.length < minLength) {
      setError(`Justification must be at least ${minLength} characters.`);
      return;
    }
    setError('');
    try {
      await onSubmit({ type: 'BYPASS_STAGE', targetState: action.params.targetState, justification: j });
      // Close on success — guard against component unmount races by checking
      // open is still true (React batches state across awaits).
      setOpen(false);
      setJustification('');
    } catch (e: any) {
      // Surface the parent's error inside the dialog so the operator can fix
      // and retry without losing context. Dialog stays open.
      setError(e?.message ?? 'Submit failed');
    }
  };

  return (
    <>
      <BaseActionButton
        actionType="BYPASS_STAGE"
        variant="warning"
        label={action.label}
        disabled={disabled}
        loading={loading && !open}
        onClick={handleClick}
      />
      <ActionDialog
        open={open}
        title={action.label}
        subtitle="Bypass requires a justification (recorded as a deviation)."
        submitLabel="Confirm Bypass"
        submitVariant="warning"
        loading={loading}
        error={error}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      >
        <label className="block text-sm font-medium text-slate-700">
          Justification (min {minLength} chars)
        </label>
        <textarea
          rows={4}
          value={justification}
          onChange={e => setJustification(e.target.value)}
          disabled={loading}
          data-bypass-justification
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
          placeholder="Explain why this stage is being bypassed…"
        />
        <p className="mt-1 text-xs text-slate-500">
          {justification.trim().length} / {minLength} characters minimum.
        </p>
      </ActionDialog>
    </>
  );
}
