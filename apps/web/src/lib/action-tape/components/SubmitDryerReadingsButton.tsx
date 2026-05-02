import { useState } from 'react';
import type { SubmitDryerReadingsAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';
import { ActionDialog } from './action-dialog.js';

/**
 * `SUBMIT_DRYER_READINGS` — fires once the dryer's half-time has elapsed
 * (server gate; tape generator only emits this action after the gate).
 *
 * Dialog: one numeric input per `params.instrumentIds`. Operating-range
 * hints from `validations.operatingRanges` rendered next to each input.
 * Out-of-range readings are flagged with an amber advisory but still
 * submitted — matches existing in-app behaviour where ranges are advisory
 * (only required+numeric is enforced client-side; server records ranges
 * for audit replay regardless).
 */
export interface SubmitDryerReadingsButtonProps {
  action: SubmitDryerReadingsAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

export function SubmitDryerReadingsButton({ action, disabled, loading, onSubmit }: SubmitDryerReadingsButtonProps) {
  const ids = action.params.instrumentIds;
  const ranges = action.validations.operatingRanges ?? {};
  const [open, setOpen] = useState(false);
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const handleClick = () => {
    setOpen(true);
    setReadings({});
    setError('');
  };

  const handleCancel = () => {
    if (loading) return;
    setOpen(false);
    setError('');
  };

  const handleSubmit = async () => {
    const numeric: Record<string, number> = {};
    for (const id of ids) {
      const raw = readings[id];
      if (raw === undefined || raw === '') {
        setError(`Reading required for ${id}`);
        return;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        setError(`Reading for ${id} must be a number`);
        return;
      }
      numeric[id] = n;
    }
    setError('');
    try {
      await onSubmit({ type: 'SUBMIT_DRYER_READINGS', readings: numeric });
      setOpen(false);
      setReadings({});
    } catch (e: any) {
      setError(e?.message ?? 'Submit failed');
    }
  };

  return (
    <>
      <BaseActionButton
        actionType="SUBMIT_DRYER_READINGS"
        variant="primary"
        label={action.label}
        disabled={disabled}
        loading={loading && !open}
        onClick={handleClick}
      />
      <ActionDialog
        open={open}
        title={action.label}
        subtitle="Enter one reading per instrument."
        submitLabel="Submit Readings"
        loading={loading}
        error={error}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      >
        <div className="space-y-3">
          {ids.map(id => {
            const range = ranges[id];
            return (
              <div key={id}>
                <label className="block text-sm font-medium text-slate-700">
                  {id}
                  {range ? (
                    <span className="ml-2 text-xs text-slate-500">
                      Range: {range.min} – {range.max}
                    </span>
                  ) : null}
                </label>
                <input
                  type="number"
                  data-instrument-id={id}
                  value={readings[id] ?? ''}
                  onChange={e => setReadings(prev => ({ ...prev, [id]: e.target.value }))}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-800 focus:border-blue-500 focus:outline-none"
                  disabled={loading}
                />
                {range && readings[id] !== undefined && readings[id] !== '' && (() => {
                  const n = Number(readings[id]);
                  if (Number.isFinite(n) && (n < range.min || n > range.max)) {
                    return (
                      <p className="mt-1 text-xs text-amber-600">
                        Outside operating range ({range.min} – {range.max}).
                      </p>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })}
        </div>
      </ActionDialog>
    </>
  );
}
