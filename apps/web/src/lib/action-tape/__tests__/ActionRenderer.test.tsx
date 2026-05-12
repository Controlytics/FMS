import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
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
 * Phase 8.2 — dispatch + dialog-flow tests for `ActionRenderer`.
 *
 * Phase 8.1 contract was `onSubmit(action)`; Phase 8.2 changed it to
 * `onSubmit(action, payload)` where each renderer builds a typed payload
 * (justification, readings, answers, etc.). Tests assert both shapes.
 *
 * Stub identification still uses `data-action-type` for fast routing checks.
 * Dialog identification uses `role="dialog"` so tests are styling-agnostic.
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

const advanceWithReadingsAction: AdvanceToStageAction = {
  type: 'ADVANCE_TO_STAGE',
  label: 'Advance to WASH_IN',
  params: { targetState: 'WASH_IN', requiresInstrumentReadings: ['ins-A', 'ins-B'] },
  validations: { operatingRanges: { 'ins-A': { min: 5, max: 15 }, 'ins-B': { min: 60, max: 80 } } },
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

const submitChecklistWithQuestions: SubmitChecklistAction = {
  type: 'SUBMIT_CHECKLIST',
  label: 'Submit Wash QA',
  params: {
    checklistProfileId: 'cl-1',
    versionPin: 7,
    afterStage: 'WASH_IN',
    questions: [
      { id: 'q1', question: 'Tank empty?', questionType: 'YES_NO', required: true, section: null, description: null, options: [], validation: {}, sortOrder: 0 },
      { id: 'q2', question: 'Optional check', questionType: 'YES_NO', required: false, section: null, description: null, options: [], validation: {}, sortOrder: 1 },
    ],
  },
  blocking: true,
};

const submitDryerReadingsAction: SubmitDryerReadingsAction = {
  type: 'SUBMIT_DRYER_READINGS',
  label: 'Submit Dryer Readings',
  params: { instrumentIds: ['inst-1', 'inst-2'] },
  validations: { halfDurationMs: 60_000, operatingRanges: { 'inst-1': { min: 60, max: 80 }, 'inst-2': { min: 0, max: 100 } } },
};

const setDryerDurationAction: SetDryerDurationAction = {
  type: 'SET_DRYER_DURATION',
  label: 'Set Dryer Duration',
  params: { targetState: 'DRY_IN', minMinutes: 1, maxMinutes: 1440 },
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

// ── Per-type render: each renderer announces its kind via data-action-type ─

describe('ActionRenderer — per-type render dispatch', () => {
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
    it(`renders the ${name} stub with the right data-action-type`, () => {
      const onSubmit = vi.fn();
      render(<ActionRenderer action={action} onSubmit={onSubmit} />);
      const btn = screen.getByRole('button', { name: action.label });
      expect(btn.getAttribute('data-action-type')).toBe(name);
    });
  }
});

// ── Immediate-submit renderers (no dialog) ─────────────────────────────────

describe('ActionRenderer — immediate-submit (no dialog)', () => {
  it('COMPLETE_CYCLE clicks submit immediately with payload {type: "COMPLETE_CYCLE"}', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={completeAction} onSubmit={onSubmit} />);
    const btn = screen.getByRole('button', { name: completeAction.label });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(completeAction, { type: 'COMPLETE_CYCLE' });
  });

  it('ADVANCE_TO_STAGE without requiresInstrumentReadings clicks submit immediately', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={advanceAction} onSubmit={onSubmit} />);
    const btn = screen.getByRole('button', { name: advanceAction.label });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(advanceAction, {
      type: 'ADVANCE_TO_STAGE',
      targetState: 'WASH_OUT',
    });
    // No dialog opens — no role="dialog" element should exist.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ── caller-disabled prop ─────────────────────────────────────────────────

describe('ActionRenderer — disabled state', () => {
  it('honors caller-provided disabled — click does not fire onSubmit (no dialog opens)', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={advanceAction} onSubmit={onSubmit} disabled />);
    const btn = screen.getByRole('button', { name: advanceAction.label });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disabled BYPASS does not open the justification dialog', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} disabled />);
    const btn = screen.getByRole('button', { name: bypassAction.label });
    fireEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ── loading state on a no-dialog action ──────────────────────────────────

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

    await waitFor(() => {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    await act(async () => {
      resolve();
      await inflight;
    });

    await waitFor(() => {
      expect(btn).not.toBeDisabled();
      expect(btn).not.toHaveAttribute('aria-busy');
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ── BYPASS_STAGE dialog flow ──────────────────────────────────────────────

describe('BypassStageButton — justification dialog', () => {
  it('clicking the trigger opens a dialog and does NOT immediately submit', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: bypassAction.label }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects empty justification with an error and does not submit', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: bypassAction.label }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Bypass/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/at least 10 characters/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects justification shorter than minLength', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: bypassAction.label }));
    const dialog = screen.getByRole('dialog');
    const textarea = dialog.querySelector('[data-bypass-justification]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'too short' } }); // 9 chars
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Bypass/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/at least 10 characters/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits with the typed justification when length >= minLength', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: bypassAction.label }));
    const dialog = screen.getByRole('dialog');
    const textarea = dialog.querySelector('[data-bypass-justification]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Skipping due to maintenance window' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Bypass/i));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(bypassAction, {
      type: 'BYPASS_STAGE',
      targetState: 'STORAGE_IN',
      justification: 'Skipping due to maintenance window',
    });
  });

  it('cancel closes the dialog without firing onSubmit', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: bypassAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Cancel'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ── TERMINATE_CYCLE dialog flow ──────────────────────────────────────────

describe('TerminateCycleButton — justification dialog', () => {
  it('rejects justification shorter than minLength and submits when valid', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={terminateAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: terminateAction.label }));
    const dialog = screen.getByRole('dialog');

    // First: too short.
    const textarea = dialog.querySelector('[data-terminate-justification]') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'broken' } }); // 6 chars
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Terminate/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/at least 10 characters/i);
    expect(onSubmit).not.toHaveBeenCalled();

    // Then: long enough.
    fireEvent.change(textarea, { target: { value: 'Operator-aborted run, equipment fault.' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Terminate/i));
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(terminateAction, {
      type: 'TERMINATE_CYCLE',
      justification: 'Operator-aborted run, equipment fault.',
    });
  });
});

// ── SUBMIT_CHECKLIST dialog flow ─────────────────────────────────────────

describe('SubmitChecklistButton — questions dialog', () => {
  it('opens the dialog and renders one block per question', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={submitChecklistWithQuestions} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: submitChecklistWithQuestions.label }));
    const dialog = screen.getByRole('dialog');
    const blocks = dialog.querySelectorAll('[data-question-id]');
    expect(blocks).toHaveLength(2);
  });

  it('blocks submit when a required question is not answered', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={submitChecklistWithQuestions} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: submitChecklistWithQuestions.label }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Submit Answers/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits with object-keyed answers (required q answered, optional q omitted)', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={submitChecklistWithQuestions} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: submitChecklistWithQuestions.label }));
    const dialog = screen.getByRole('dialog');
    // Pick YES for q1.
    const q1Block = dialog.querySelector('[data-question-id="q1"]')!;
    const yesRadio = q1Block.querySelector('[data-answer-radio="YES"]') as HTMLInputElement;
    fireEvent.click(yesRadio);

    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Submit Answers/i));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [, payload] = onSubmit.mock.calls[0];
    // Server contract: object-keyed by questionId. Unanswered optional q2 is
    // OMITTED (server rejects unexpected keys), not defaulted to 'N/A'.
    expect(payload).toMatchObject({
      type: 'SUBMIT_CHECKLIST',
      checklistProfileId: 'cl-1',
      versionPin: 7,
      afterStage: 'WASH_IN',
      answers: { q1: 'YES' },
    });
    expect(payload.answers.q2).toBeUndefined();
  });
});

// ── Close-on-success / error-on-failure semantics (advisor follow-up) ────

describe('Dialog renderers — close on successful submit, stay open on error', () => {
  it('BYPASS dialog closes when parent onSubmit resolves', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ActionRenderer action={bypassAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: bypassAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-bypass-justification]') as HTMLTextAreaElement, {
      target: { value: 'Maintenance window — bypass' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Bypass/i));
    });
    // Dialog should close after successful submit.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('TERMINATE dialog stays open and surfaces parent error when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Server: NO_CYCLE'));
    render(<ActionRenderer action={terminateAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: terminateAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-terminate-justification]') as HTMLTextAreaElement, {
      target: { value: 'Operator-aborted run, equipment fault.' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Confirm Terminate/i));
    });
    // Dialog stays open and shows the parent's error message.
    const stillOpen = screen.getByRole('dialog');
    expect(stillOpen).toBeInTheDocument();
    expect(within(stillOpen).getByRole('alert').textContent).toMatch(/Server: NO_CYCLE/);
  });

  it('SET_DRYER_DURATION dialog closes on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ActionRenderer action={setDryerDurationAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: setDryerDurationAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-dryer-min]') as HTMLInputElement, { target: { value: '20' } });
    fireEvent.change(dialog.querySelector('[data-dryer-max]') as HTMLInputElement, { target: { value: '40' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Set Duration/i));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// ── SET_DRYER_DURATION dialog flow ───────────────────────────────────────

describe('SetDryerDurationButton — duration dialog', () => {
  it('opens the dialog and submits with valid min/max', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={setDryerDurationAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: setDryerDurationAction.label }));
    const dialog = screen.getByRole('dialog');
    const minInput = dialog.querySelector('[data-dryer-min]') as HTMLInputElement;
    const maxInput = dialog.querySelector('[data-dryer-max]') as HTMLInputElement;
    fireEvent.change(minInput, { target: { value: '30' } });
    fireEvent.change(maxInput, { target: { value: '60' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Set Duration/i));
    });

    expect(onSubmit).toHaveBeenCalledWith(setDryerDurationAction, {
      type: 'SET_DRYER_DURATION',
      targetState: 'DRY_IN',
      minMinutes: 30,
      maxMinutes: 60,
    });
  });

  it('rejects min > max', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={setDryerDurationAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: setDryerDurationAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-dryer-min]') as HTMLInputElement, { target: { value: '90' } });
    fireEvent.change(dialog.querySelector('[data-dryer-max]') as HTMLInputElement, { target: { value: '30' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Set Duration/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Minimum cannot exceed maximum/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects values outside [1, 1440]', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={setDryerDurationAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: setDryerDurationAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-dryer-min]') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.change(dialog.querySelector('[data-dryer-max]') as HTMLInputElement, { target: { value: '60' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Set Duration/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/within 1.*1440/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

// ── SUBMIT_DRYER_READINGS dialog flow ───────────────────────────────────

describe('SubmitDryerReadingsButton — readings dialog', () => {
  it('opens the dialog and rejects empty readings', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={submitDryerReadingsAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: submitDryerReadingsAction.label }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Submit Readings/i));
    });
    expect(within(dialog).getByRole('alert').textContent).toMatch(/Reading required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits with numeric readings keyed by instrument id', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={submitDryerReadingsAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: submitDryerReadingsAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-instrument-id="inst-1"]') as HTMLInputElement, { target: { value: '72.5' } });
    fireEvent.change(dialog.querySelector('[data-instrument-id="inst-2"]') as HTMLInputElement, { target: { value: '50' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByText(/Submit Readings/i));
    });
    expect(onSubmit).toHaveBeenCalledWith(submitDryerReadingsAction, {
      type: 'SUBMIT_DRYER_READINGS',
      readings: { 'inst-1': 72.5, 'inst-2': 50 },
    });
  });
});

// ── ADVANCE_TO_STAGE with readings dialog flow ─────────────────────────

describe('AdvanceToStageButton — instrument-readings dialog', () => {
  it('opens the dialog when requiresInstrumentReadings is non-empty', () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={advanceWithReadingsAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: advanceWithReadingsAction.label }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits readings + targetState when all readings provided', async () => {
    const onSubmit = vi.fn();
    render(<ActionRenderer action={advanceWithReadingsAction} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: advanceWithReadingsAction.label }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('[data-instrument-id="ins-A"]') as HTMLInputElement, { target: { value: '10' } });
    fireEvent.change(dialog.querySelector('[data-instrument-id="ins-B"]') as HTMLInputElement, { target: { value: '70' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByText(/^Submit$/i));
    });
    expect(onSubmit).toHaveBeenCalledWith(advanceWithReadingsAction, {
      type: 'ADVANCE_TO_STAGE',
      targetState: 'WASH_IN',
      readings: { 'ins-A': 10, 'ins-B': 70 },
    });
  });
});

// ── ActionTapeRenderer — shared loading lock ─────────────────────────────

describe('ActionTapeRenderer — shared loading lock', () => {
  beforeEach(() => {
    cleanup();
  });

  it('disables siblings while one immediate-submit action is in flight', async () => {
    let resolve!: () => void;
    const inflight = new Promise<void>(r => {
      resolve = r;
    });
    const onSubmit = vi.fn(() => inflight);
    render(<ActionTapeRenderer actions={[completeAction, advanceAction]} onSubmit={onSubmit} />);

    const completeBtn = screen.getByRole('button', { name: completeAction.label });
    const advanceBtn = screen.getByRole('button', { name: advanceAction.label });
    expect(completeBtn).not.toBeDisabled();
    expect(advanceBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(completeBtn);
    });

    await waitFor(() => {
      expect(completeBtn).toBeDisabled();
      expect(advanceBtn).toBeDisabled();
    });

    await act(async () => {
      resolve();
      await inflight;
    });

    await waitFor(() => {
      expect(completeBtn).not.toBeDisabled();
      expect(advanceBtn).not.toBeDisabled();
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
