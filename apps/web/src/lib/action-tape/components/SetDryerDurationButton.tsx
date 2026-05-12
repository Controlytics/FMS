import { useState } from 'react';
import type { SetDryerDurationAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';
import { ActionDialog } from './action-dialog.js';

/**
 * `SET_DRYER_DURATION` — fires when next stage is DRY_IN and the dryer is
 * not yet started. Click opens a dialog with two number inputs:
 * `minMinutes` and `maxMinutes`. Validation: `1 <= min <= max <= 1440`
 * (1 day cap matches the server-side `dryerDurationMinutes` ceiling).
 *
 * The bounds are seeded from `action.params.minMinutes` /
 * `action.params.maxMinutes` (the tape generator currently emits 1/1440 as
 * defaults; future profile-level bounds will tighten the slider).
 */
export interface SetDryerDurationButtonProps {
  action: SetDryerDurationAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

const ABS_MIN = 1;
const ABS_MAX = 1440;

export function SetDryerDurationButton({ action, disabled, loading, onSubmit }: SetDryerDurationButtonProps) {
  const seedMin = clamp(action.params.minMinutes ?? ABS_MIN, ABS_MIN, ABS_MAX);
  const seedMax = clamp(action.params.maxMinutes ?? ABS_MAX, seedMin, ABS_MAX);
  const [open, setOpen] = useState(false);
  const [minStr, setMinStr] = useState(String(seedMin));
  const [maxStr, setMaxStr] = useState(String(seedMax));
  const [error, setError] = useState('');

  const handleClick = () => {
    setOpen(true);
    setMinStr(String(seedMin));
    setMaxStr(String(seedMax));
    setError('');
  };

  const handleCancel = () => {
    if (loading) return;
    setOpen(false);
    setError('');
  };

  const handleSubmit = async () => {
    const min = Number(minStr);
    const max = Number(maxStr);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      setError('Both minimum and maximum must be numbers.');
      return;
    }
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      setError('Duration must be in whole minutes.');
      return;
    }
    if (min < ABS_MIN || max > ABS_MAX) {
      setError(`Values must be within ${ABS_MIN}–${ABS_MAX} minutes.`);
      return;
    }
    if (min > max) {
      setError('Minimum cannot exceed maximum.');
      return;
    }
    setError('');
    try {
      await onSubmit({ type: 'SET_DRYER_DURATION', targetState: 'DRY_IN', minMinutes: min, maxMinutes: max });
      setOpen(false);
    } catch (e: any) {
      setError(e?.message ?? 'Submit failed');
    }
  };

  return (
    <>
      <BaseActionButton
        actionType="SET_DRYER_DURATION"
        variant="primary"
        label={action.label}
        disabled={disabled}
        loading={loading && !open}
        onClick={handleClick}
      />
      <ActionDialog
        open={open}
        title={action.label}
        subtitle="Set min/max duration for the dryer cycle."
        submitLabel="Set Duration"
        loading={loading}
        error={error}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700">Min (min)</label>
            <input
              type="number"
              min={ABS_MIN}
              max={ABS_MAX}
              value={minStr}
              onChange={e => setMinStr(e.target.value)}
              disabled={loading}
              data-dryer-min
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-800 focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">Max (min)</label>
            <input
              type="number"
              min={ABS_MIN}
              max={ABS_MAX}
              value={maxStr}
              onChange={e => setMaxStr(e.target.value)}
              disabled={loading}
              data-dryer-max
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-slate-800 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Allowed range: {ABS_MIN}–{ABS_MAX} minutes. Min must be ≤ Max.
        </p>
      </ActionDialog>
    </>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}
