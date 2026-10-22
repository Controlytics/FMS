/**
 * Every cleaning-profile shape must complete (operator decision 2026-10-22: "any
 * stage anywhere and checklist also"). The API matrix
 * (apps/api/.../pipeline-shape-matrix.e2e.test.ts) drives every shape through the
 * real routes; these pin the shared rules it found missing, one per root cause:
 *
 *   A  the readings step is offered whenever leaving Dry In needs it — with no
 *      Dry In instrument too (instrumentIds: []);
 *   B  an in-place dryer step is not an ENTRY into Dry In (isEntryIntoStage), so
 *      it no longer voids the checklist answered after Dry In;
 *   C/D a FINAL Dry In's work ends with the readings (callCompletesStageWork):
 *      the checklist after it rides on SUBMIT_READINGS, never on the entry, and
 *      is not offered on its own before the readings;
 *   E  START is a position: the checklists before the first stage are offered
 *      after start-cycle and gate the first entry.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceMustCarryChecklist,
  assertChecklistGatePassed,
  callCompletesStageWork,
  checklistAnsweredInCurrentEntry,
  computeNextActions,
  isEntryIntoStage,
} from '../index.js';
import type { ChecklistProfileSlice, FilterEventSlice, LocalContext, ProfileSlice } from '../index.js';
import { FIXTURE_NOW, dryInActiveContext } from './fixtures.js';

const CL = 'cl-profile-1';
const checklistProfilesById = new Map<string, ChecklistProfileSlice>([
  [CL, {
    id: CL, name: 'Inspection', isActive: true, version: 1,
    questions: [{ id: 'q1', question: 'Inspected?', questionType: 'YES_NO', required: true, section: null, description: null, options: [], validation: {}, sortOrder: 0 }],
  } as ChecklistProfileSlice],
]);

/** START → tokens → END, chained. 'CL' = a checklist node. */
function chain(tokens: string[]): ProfileSlice {
  const nodes = [
    { id: 'n-start', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
    ...tokens.map((t, i) => t === 'CL'
      ? { id: `n-${i}-cl`, stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: CL }, sortOrder: i + 1 }
      : { id: `n-${i}-${t}`, stateKey: t, nodeType: 'STAGE', configuration: {}, sortOrder: i + 1 }),
    { id: 'n-end', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: tokens.length + 1 },
  ];
  return {
    id: 'p-shape', lineageId: 'l-shape', name: 'shape', flowMode: 'SEQUENTIAL', version: 1, status: 'ACTIVE',
    cleaningReasons: { keys: ['ROUTINE'] }, nodes,
    edges: nodes.slice(0, -1).map((n, i) => ({ fromStageId: n.id, toStageId: nodes[i + 1]!.id })),
  };
}

const ev = (id: string, eventType: string, toState: string | null, at: string, attributes: Record<string, unknown> = {}): FilterEventSlice => ({
  id, cycleId: 'cycle-1', eventType, fromState: null, toState, performedAt: new Date(at), attributes,
});

/** A cycle on `tokens` sitting at `state`, dryer half-time elapsed when at Dry In. */
function at(tokens: string[], state: string | null, events: FilterEventSlice[], over: Partial<LocalContext> = {}): LocalContext {
  const base = dryInActiveContext();
  const profile = chain(tokens);
  return {
    ...base,
    profile,
    cycle: { ...base.cycle!, profileId: profile.id, profileVersion: 1, dryerStartedAt: new Date(FIXTURE_NOW - 30 * 60_000), dryerDurationMinutes: 60, dryerReadingsSubmitted: false },
    filter: { ...base.filter, currentLifecycleState: state },
    events,
    ...over,
  };
}

const types = (ctx: LocalContext) => computeNextActions(ctx, { checklistProfilesById }).actions.map(a => a.type);

describe('isEntryIntoStage (B)', () => {
  it('a transition into the stage is an entry; an in-place dryer step is not', () => {
    expect(isEntryIntoStage(ev('e', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:00:00Z'), 'DRY_IN')).toBe(true);
    expect(isEntryIntoStage(ev('e', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:00:00Z', { action: 'DRYER_STARTED' }), 'DRY_IN')).toBe(true);
    expect(isEntryIntoStage(ev('e', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:00:00Z', { action: 'DRYER_READINGS_SUBMITTED' }), 'DRY_IN')).toBe(false);
    expect(isEntryIntoStage(ev('e', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:00:00Z', { action: 'DRYER_STARTED', inPlace: true }), 'DRY_IN')).toBe(false);
    expect(isEntryIntoStage(ev('e', 'STATE_TRANSITION', 'WASH_IN', '2026-05-02T11:00:00Z'), 'DRY_IN')).toBe(false);
  });
});

describe('checklistAnsweredInCurrentEntry', () => {
  const entry = ev('in', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:00:00Z', { action: 'DRYER_STARTED' });
  const answer = ev('cl', 'CHECKLIST_COMPLETED', null, '2026-05-02T11:05:00Z', { afterStage: 'DRY_IN' });

  it('B: the readings row after the answer does not void it', () => {
    const readings = ev('rd', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:40:00Z', { action: 'DRYER_READINGS_SUBMITTED' });
    expect(checklistAnsweredInCurrentEntry([entry, answer, readings], 'DRY_IN')).toBe(true);
  });

  it('a real re-entry (QA rollback) does void it — the stage is done again', () => {
    const reentry = ev('re', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:50:00Z');
    expect(checklistAnsweredInCurrentEntry([entry, answer, reentry], 'DRY_IN')).toBe(false);
  });

  it('E: START (null) counts any answer recorded with afterStage null, and only those', () => {
    const startAnswer = ev('s', 'CHECKLIST_COMPLETED', null, '2026-05-02T10:01:00Z', { afterStage: null });
    expect(checklistAnsweredInCurrentEntry([startAnswer], null)).toBe(true);
    expect(checklistAnsweredInCurrentEntry([answer], null)).toBe(false);
    expect(checklistAnsweredInCurrentEntry([], null)).toBe(false);
  });
});

describe('callCompletesStageWork + advanceMustCarryChecklist (C/D)', () => {
  it('every stage is done on entry except Dry In, done by its readings', () => {
    expect(callCompletesStageWork('WASH_OUT', null)).toBe(true);
    expect(callCompletesStageWork('STORAGE_IN')).toBe(true);
    expect(callCompletesStageWork('DRY_IN', 'SET_DURATION')).toBe(false);
    expect(callCompletesStageWork('DRY_IN', null)).toBe(false);
    expect(callCompletesStageWork('DRY_IN', 'SUBMIT_READINGS')).toBe(true);
  });

  it('the checklist after a final Dry In rides on SUBMIT_READINGS, not on the entry', () => {
    const finalDryIn = { leadsToEnd: true, nextStages: [], pendingChecklistProfileIds: [CL] };
    expect(advanceMustCarryChecklist(finalDryIn, [], { targetState: 'DRY_IN', dryerAction: 'SET_DURATION' })).toBe(false);
    expect(advanceMustCarryChecklist(finalDryIn, [], { targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' })).toBe(true);
    // Any other final stage: unchanged, with or without the call.
    expect(advanceMustCarryChecklist(finalDryIn, [], { targetState: 'STORAGE_IN' })).toBe(true);
    expect(advanceMustCarryChecklist(finalDryIn)).toBe(true);
  });
});

describe('computeNextActions over the shapes that used to stick', () => {
  it('A: at Dry In with no Dry In instrument, the readings step is offered with no instruments', () => {
    const ctx = at(['WASH_IN', 'DRY_IN', 'STORAGE_IN'], 'DRY_IN', [ev('in', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:30:00Z')], { equipmentGroup: null });
    const tape = computeNextActions(ctx, { checklistProfilesById });
    const readings = tape.actions.find(a => a.type === 'SUBMIT_DRYER_READINGS');
    expect(readings && readings.type === 'SUBMIT_DRYER_READINGS' ? readings.params.instrumentIds : null).toEqual([]);
  });

  it('B: the checklist after a mid Dry In is not re-offered once the readings are in', () => {
    const events = [
      ev('in', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:30:00Z', { action: 'DRYER_STARTED' }),
      ev('cl', 'CHECKLIST_COMPLETED', null, '2026-05-02T11:31:00Z', { afterStage: 'DRY_IN' }),
      ev('rd', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:59:00Z', { action: 'DRYER_READINGS_SUBMITTED' }),
    ];
    const ctx = at(['DRY_IN', 'CL', 'DRY_OUT'], 'DRY_IN', events);
    ctx.cycle = { ...ctx.cycle!, dryerReadingsSubmitted: true };
    expect(types(ctx)).not.toContain('SUBMIT_CHECKLIST');
    expect(types(ctx)).toContain('ADVANCE_TO_STAGE');
  });

  it('C/D: a final Dry In offers the readings, not its checklist on its own, until the readings are in', () => {
    const events = [ev('in', 'STATE_TRANSITION', 'DRY_IN', '2026-05-02T11:30:00Z', { action: 'DRYER_STARTED' })];
    const before = at(['WASH_IN', 'DRY_IN', 'CL'], 'DRY_IN', events);
    expect(types(before)).toContain('SUBMIT_DRYER_READINGS');
    expect(types(before)).not.toContain('SUBMIT_CHECKLIST');
    // An old client that sent the readings bare: the checklist then completes the cycle.
    const after = at(['WASH_IN', 'DRY_IN', 'CL'], 'DRY_IN', events);
    after.cycle = { ...after.cycle!, dryerReadingsSubmitted: true };
    expect(types(after)).toContain('SUBMIT_CHECKLIST');
  });

  it('E: after start-cycle the checklist before the first stage is offered (afterStage null), then the first stage', () => {
    const asked = computeNextActions(at(['CL', 'WASH_IN', 'WASH_OUT'], null, []), { checklistProfilesById });
    const submit = asked.actions.find(a => a.type === 'SUBMIT_CHECKLIST');
    expect(submit && submit.type === 'SUBMIT_CHECKLIST' ? submit.params.afterStage : 'missing').toBeNull();
    expect(asked.actions.map(a => a.type)).not.toContain('ADVANCE_TO_STAGE');

    const answered = at(['CL', 'WASH_IN', 'WASH_OUT'], null, [ev('s', 'CHECKLIST_COMPLETED', null, '2026-05-02T10:01:00Z', { afterStage: null })]);
    expect(types(answered)).toContain('ADVANCE_TO_STAGE');
    expect(types(answered)).not.toContain('SUBMIT_CHECKLIST');
  });
});

describe('assertChecklistGatePassed at START (E)', () => {
  it('refuses entering the first stage until the checklist before it is answered', () => {
    const ctx = at(['CL', 'WASH_IN'], null, []);
    const refused = assertChecklistGatePassed(ctx, ctx.profile!, null);
    expect(refused).toMatchObject({ ok: false, code: 'CHECKLIST_PENDING' });
    expect(refused.ok ? '' : refused.message).toMatch(/before the first stage/);

    const answered = at(['CL', 'WASH_IN'], null, [ev('s', 'CHECKLIST_COMPLETED', null, '2026-05-02T10:01:00Z', { afterStage: null })]);
    expect(assertChecklistGatePassed(answered, answered.profile!, null)).toEqual({ ok: true });
  });

  it('a profile with no checklist before the first stage is not gated', () => {
    const ctx = at(['WASH_IN', 'CL'], null, []);
    expect(assertChecklistGatePassed(ctx, ctx.profile!, null)).toEqual({ ok: true });
  });
});
