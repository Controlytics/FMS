import { describe, it, expect } from 'vitest';
import type { Action } from '@digilog/shared';
import { dialogChecklistsFromActions, withDerivedPendingChecklist } from '../offline-cache';

/**
 * offline-cache.ts — the pure tape → checklist-dialog converters. No store
 * access, so nothing is mocked.
 */

const q = (over: Record<string, unknown> = {}) => ({
  id: 'q1', question: 'Pressure in range?', questionType: 'NUMBER', required: true,
  section: 'Wash', description: 'gauge PG-1', options: [], validation: { min: 1, max: 4, leastCount: 0.1, unit: 'bar' },
  sortOrder: 3, ...over,
});

const submit = (over: Partial<{ label: string; profileId: string; afterStage: string; versionPin: number; questions: any }> = {}): Action => ({
  type: 'SUBMIT_CHECKLIST',
  label: over.label ?? 'Submit Checklist: Wash checklist',
  blocking: true,
  params: {
    checklistProfileId: over.profileId ?? 'cl-1',
    versionPin: over.versionPin ?? 2,
    afterStage: over.afterStage ?? 'WASH_IN',
    questions: over.questions === undefined ? [q()] : over.questions,
  },
} as Action);

const advance: Action = { type: 'ADVANCE_TO_STAGE', label: 'Wash Out', params: { targetState: 'WASH_OUT' } } as Action;

describe('dialogChecklistsFromActions', () => {
  it('keeps only SUBMIT_CHECKLIST actions and maps them into the dialog shape', () => {
    const rows = dialogChecklistsFromActions([advance, submit()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pipelineNodeId: 'WASH_IN-cl-1',
      checklistProfileId: 'cl-1',
      checklistProfileName: 'Wash checklist',
      profileVersion: 2,
    });
    expect(rows[0].questions[0]).toMatchObject({
      id: 'q1', question: 'Pressure in range?', questionType: 'NUMBER', required: true,
      section: 'Wash', description: 'gauge PG-1', options: [], sortOrder: 3,
    });
  });

  // OFF-4 (2026-10-22): the tablet's numeric input reads min / max / leastCount /
  // unit from `validation`; a checklist built from the tape had lost it, so
  // offline the range hint and the input limits disappeared.
  it('carries each question\'s validation rules (range, least count, unit)', () => {
    const rows = dialogChecklistsFromActions([submit()]);
    expect(rows[0].questions[0].validation).toEqual({ min: 1, max: 4, leastCount: 0.1, unit: 'bar' });
  });

  it('a question with no validation gets an empty rule set, never undefined', () => {
    const rows = dialogChecklistsFromActions([submit({ questions: [q({ validation: undefined })] })]);
    expect(rows[0].questions[0].validation).toEqual({});
  });

  it('a label without the "Submit Checklist: " prefix is used as-is', () => {
    expect(dialogChecklistsFromActions([submit({ label: 'Dry checklist' })])[0].checklistProfileName).toBe('Dry checklist');
  });

  it('sortOrder falls back to the question index; missing questions → []', () => {
    const rows = dialogChecklistsFromActions([
      submit({ questions: [q({ id: 'a', sortOrder: undefined }), q({ id: 'b', sortOrder: undefined })] }),
      submit({ profileId: 'cl-2', questions: null }),
    ]);
    expect(rows[0].questions.map((x) => x.sortOrder)).toEqual([0, 1]);
    expect(rows[1].questions).toEqual([]);
  });

  it('an empty tape yields no dialogs', () => {
    expect(dialogChecklistsFromActions([])).toEqual([]);
  });

  // 2026-10-22: a START checklist (between START and the first stage) has
  // afterStage null. It is keyed START-<id>, the key resolveStartChecklists
  // gives the same checklist before the cycle starts — never "null-<id>".
  it('a START checklist (afterStage null) is keyed START-<profileId>', () => {
    const start = { ...submit(), params: { ...(submit() as any).params, afterStage: null } } as Action;
    expect(dialogChecklistsFromActions([start])[0].pipelineNodeId).toBe('START-cl-1');
  });
});

describe('withDerivedPendingChecklist', () => {
  it('leaves a state that already has a pending checklist untouched (same object)', () => {
    const s = { pendingChecklist: [{ checklistProfileId: 'x' }], actions: [submit()] };
    expect(withDerivedPendingChecklist(s)).toBe(s);
  });

  it('derives pendingChecklist from the tape, carrying the tape questions verbatim', () => {
    const s = { currentState: 'WASH_IN', pendingChecklist: [], actions: [advance, submit({ label: 'Plain name' })] };
    const out = withDerivedPendingChecklist(s);
    expect(out).not.toBe(s);
    expect(out.currentState).toBe('WASH_IN');
    expect(out.pendingChecklist).toEqual([{
      pipelineNodeId: 'WASH_IN-cl-1', checklistProfileId: 'cl-1', checklistProfileName: 'Plain name',
      profileVersion: 2, questions: [q()],
    }]);
  });

  it('a tape question list that is not an array becomes []', () => {
    const out = withDerivedPendingChecklist<{ actions: Action[]; pendingChecklist?: any[] }>({ actions: [submit({ questions: 'bad' })] });
    expect(out.pendingChecklist?.[0].questions).toEqual([]);
  });

  it.each([
    ['no actions', {}],
    ['null actions', { actions: null }],
    ['a tape with no checklist', { actions: [advance] }],
  ])('%s → returned unchanged', (_l, s) => {
    expect(withDerivedPendingChecklist(s as any)).toBe(s);
  });
});
