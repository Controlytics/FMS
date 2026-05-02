import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { ActionRenderer, ActionTapeRenderer } from '../ActionRenderer.js';
import type {
  Action,
  AdvanceToStageAction,
  BypassStageAction,
  CompleteCycleAction,
  SetDryerDurationAction,
  SubmitChecklistAction,
  SubmitDryerReadingsAction,
  TerminateCycleAction,
} from '../types.js';

/**
 * Phase 8.1 — dispatch tests for `ActionRenderer`.
 *
 * Goal: prove the dispatcher routes each `action.type` to the correct stub
 * component and that clicking the rendered button calls `onSubmit` with the
 * exact same action shape the server emitted (no translation).
 *
 * The stubs themselves are visually identical buttons today; in 8.2 they'll
 * diverge into dialogs/forms. To stay decoupled from styling we identify each
 * stub by its `data-action-type` attribute, set in `BaseActionButton`.
 */

afterEach(() => {
  cleanup();
});

// ── action fixtures (one per type) ───────────────────────────────────────

const advanceAction: AdvanceToStageAction = {
  type: 'ADVANCE_TO_STAGE',
  label: 'Advance to WASH_OUT',
  params: { targetState: 'WASH_OUT' },
};

const submitChecklistAction: SubmitChecklistAction = {
  type: 'SUBMIT_CHECKLIST',
  label: 'Submit Checklist',
  params: {
    checklistProfileId: 'cl-1',
    versionPin: 1,
    afterStage: 'WASH_IN',
    questions: [],
  },
  blocking: true,
};

const submitDryerReadingsAction: SubmitDryerReadingsAction = {
  type: 'SUBMIT_DRYER_READINGS',
  label: 'Submit Dryer Readings',
  params: { instrumentIds: ['inst-1', 'inst-2'] },
  validations: { halfDurationMs: 60_000, operatingRanges: {} },
};

const setDryerDurationAction: SetDryerDurationAction = {
  type: 'SET_DRYER_DURATION',
  label: 'Set Dryer Duration',
  params: { targetState: 'DRY_IN', minMinutes: 10, maxMinutes: 120 },
};

const bypassAction: BypassStageAction = {
  type: 'BYPASS_STAGE',
  label: 'Bypass to STORAGE_IN',
  params: { targetState: 'STORAGE_IN' },
  requiresJustification: { minLength: 10 },
};

const terminateAction: TerminateCycleAction = {
  type: 'TERMINATE_CYCLE',
  label: 'Terminate Cycle',
  requiresJustification: { minLength: 10 },
};

const completeAction: CompleteCycleAction = {
  type: 'COMPLETE_CYCLE',
  label: 'Complete Cycle',
};

// ── 1-7. Per-type render + click dispatches the same action shape ─────

describe('ActionRenderer — per-type dispatch', () => {
  const cases: Array<{ name: string; action: Action }> = [
    { name: 'ADVANCE_TO_STAGE', action: advanceAction },
    { name: 'SUBMIT_CHECKLIST', action: submitChecklistAction },
    { name: 'SUBMIT_DRYER_READINGS', action: submitDryerReadingsAction },
    { name: 'SET_DRYER_DURATION', action: setDryerDurationAction },
    { name: 'BYPASS_STAGE', action: bypassAction },
    { name: 'TERMINATE_CYCLE', action: terminateAction },
    { name: 'COMPLETE_CYCLE', action: completeAction },
  ];

  for (const { name, action } of cases) {
    it(`renders the ${name} stub and dispatches the action on click`, async () => {
      const onSubmit = vi.fn();
      render(<ActionRenderer action={action} onSubmit={onSubmit} />);
      const btn = screen.getByRole('button', { name: action.label });
      // The stub announces its kind via data-action-type so we can confirm
      // dispatch hit the right component, not an arbitrary one.
      expect(btn.getAttribute('data-action-type')).toBe(name);
      // act() wraps the click so React 19 can flush the post-await setLoading
      // updates without printing the `not wrapped in act(...)` warning.
      await act(async () => {
        fireEvent.click(btn);
      });
      // onSubmit is awaited inside the renderer; assert it was called with
      // the exact action shape (reference equality is fine — we don't clone).
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith(action);
    });
  }
});

// ── 8. disabled prop blocks the click ────────────────────────────────────

describe('ActionRenderer — disabled state', () => {
  it('honors caller-provided disabled — click does not fire onSubmit', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={advanceAction} onSubmit={onSubmit} disabled />);
    const btn = screen.getByRole('button', { name: advanceAction.label });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ── 9. loading state during in-flight submit ─────────────────────────────

describe('ActionRenderer — loading state', () => {
  it('flips loading on while onSubmit promise is pending, off when it resolves', async () => {
    let resolve!: () => void;
    const inflight = new Promise<void>(r => {
      resolve = r;
    });
    const onSubmit = vi.fn(() => inflight);
    render(<ActionRenderer action={completeAction} onSubmit={onSubmit} />);
    const btn = screen.getByRole('button', { name: completeAction.label });

    await act(async () => {
      fireEvent.click(btn);
    });

    // While the promise is pending the button is disabled + aria-busy
    await waitFor(() => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    await act(async () => {
      resolve();
      await inflight;
    });

    // After it resolves, loading clears and the button is enabled again
    await waitFor(() => {
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveAttribute('aria-busy');
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ── 10. ActionTapeRenderer locks all actions while one is in flight ──────

describe('ActionTapeRenderer — shared loading lock', () => {
  beforeEach(() => {
    cleanup();
  });

  it('disables siblings while one action is submitting', async () => {
    let resolve!: () => void;
    const inflight = new Promise<void>(r => {
      resolve = r;
    });
    const onSubmit = vi.fn(() => inflight);
    render(<ActionTapeRenderer actions={[advanceAction, terminateAction]} onSubmit={onSubmit} />);

    const advanceBtn = screen.getByRole('button', { name: advanceAction.label });
    const terminateBtn = screen.getByRole('button', { name: terminateAction.label });
    expect(advanceBtn).not.toBeDisabled();
    expect(terminateBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(advanceBtn);
    });

    await waitFor(() => {
      expect(advanceBtn).toBeDisabled();
      expect(terminateBtn).toBeDisabled();
    });

    await act(async () => {
      resolve();
      await inflight;
    });

    await waitFor(() => {
      expect(advanceBtn).not.toBeDisabled();
      expect(terminateBtn).not.toBeDisabled();
    });
  });

  it('renders the empty-state slot when actions[] is empty', () => {
    const onSubmit = vi.fn();
    render(
      <ActionTapeRenderer
        actions={[]}
        onSubmit={onSubmit}
        emptyState={<span>Nothing to do</span>}
      />,
    );
    expect(screen.getByText('Nothing to do')).toBeInTheDocument();
  });
});
