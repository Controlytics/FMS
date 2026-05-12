import { useState } from 'react';
import type { AdvanceToStageAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';
import { ActionDialog } from './action-dialog.js';

/**
 * `ADVANCE_TO_STAGE` — generic forward transition.
 *
 * Two modes:
 *   1. `params.requiresInstrumentReadings` empty/undefined → single-click
 *      submit with an empty `readings` payload (matches the existing
 *      `POST /advance` body when no equipment instruments are wired).
 *   2. `params.requiresInstrumentReadings` non-empty → click opens a
 *      readings dialog. One numeric input per instrument id, each required.
 *      Operating-range hints (from `validations.operatingRanges`) are
 *      rendered next to each input as a soft warning — out-of-range values
 *      are allowed (mirrors the existing service.ts behaviour: ranges are
 *      advisory; only required-and-numeric is enforced client-side).
 */
export interface AdvanceToStageButtonProps {
  action: AdvanceToStageAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

export function AdvanceToStageButton({ action, disabled, loading, onSubmit }: AdvanceToStageButtonProps) {
  const requires = action.params.requiresInstrumentReadings ?? [];
  const requiresReadings = requires.length > 0;
  const [open, setOpen] = useState(false);
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const handleClick = () => {
    if (!requiresReadings) {
      // Immediate-submit path. Errors are surfaced by the caller's UI (toast,
      // page-level banner) — there's no dialog to attach the error to.
      void onSubmit({ type: 'ADVANCE_TO_STAGE', targetState: action.params.targetState });
      return;
    }
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
    for (const id of requires) {
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
      await onSubmit({ type: 'ADVANCE_TO_STAGE', targetState: action.params.targetState, readings: numeric });
      setOpen(false);
      setReadings({});
    } catch (e: any) {
      setError(e?.message ?? 'Submit failed');
    }
  };

  const ranges = action.validations?.operatingRanges ?? {};

  return (
    <>
      <BaseActionButton
        actionType="ADVANCE_TO_STAGE"
        variant="primary"
        label={action.label}
        disabled={disabled}
        loading={loading && !open}
        onClick={handleClick}
      />
      <ActionDialog
        open={open}
        title={action.label}
        subtitle="Enter instrument readings"
        loading={loading}
        error={error}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      >
        <div className="space-y-3">
          {requires.map(id => {
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
