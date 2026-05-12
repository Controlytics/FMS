import { useState } from 'react';
import type { TerminateCycleAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';
import { ActionDialog } from './action-dialog.js';

/**
 * `TERMINATE_CYCLE` — destructive end-of-cycle action. Click opens a
 * justification dialog (textarea, required, min length from
 * `action.requiresJustification.minLength`). Visual variant is `danger`
 * (red) on both trigger and dialog header.
 *
 * Mirrors the existing in-app terminate flow: justification is mandatory,
 * the server records it on the cycle and on the `CYCLE_TERMINATED`
 * `FilterEvent` for 21 CFR Part 11 audit replay.
 */
export interface TerminateCycleButtonProps {
  action: TerminateCycleAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

export function TerminateCycleButton({ action, disabled, loading, onSubmit }: TerminateCycleButtonProps) {
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
      await onSubmit({ type: 'TERMINATE_CYCLE', justification: j });
      setOpen(false);
      setJustification('');
    } catch (e: any) {
      setError(e?.message ?? 'Submit failed');
    }
  };

  return (
    <>
      <BaseActionButton
        actionType="TERMINATE_CYCLE"
        variant="danger"
        label={action.label}
        disabled={disabled}
        loading={loading && !open}
        onClick={handleClick}
      />
      <ActionDialog
        open={open}
        title={action.label}
        subtitle="Terminating the cycle is irreversible. Provide a justification."
        submitLabel="Confirm Terminate"
        submitVariant="danger"
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
          data-terminate-justification
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-red-500 focus:outline-none"
          placeholder="Explain why this cycle is being terminated…"
        />
        <p className="mt-1 text-xs text-slate-500">
          {justification.trim().length} / {minLength} characters minimum.
        </p>
      </ActionDialog>
    </>
  );
}
