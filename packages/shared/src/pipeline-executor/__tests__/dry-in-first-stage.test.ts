/**
 * Dry In as the FIRST stage / dryer never started (2026-10-06).
 *
 * The live "DRY STORAGE" profile begins with DRY_IN. The start-and-advance
 * payloads carried no dryer fields, the server accepted the entry, and a cycle
 * then sat at DRY_IN with `dryerStartedAt = null`:
 *
 *   - the tape offered a plain "Advance to Dry Out" (the SET_DRYER_DURATION rule
 *     only fired when the filter was at a stage BEFORE DRY_IN), and
 *   - every leaving-DRY_IN guard was a no-op without a dryer start,
 *
 * so the cycle completed with no dryer time and no temperature reading.
 *
 * These tests pin the three rules that close it:
 *   1. computeNextActions — at DRY_IN with no dryer the ONLY onward action is
 *      SET_DRYER_DURATION targeting DRY_IN itself (dryer-in-place); no
 *      ADVANCE_TO_STAGE. Bypass + terminate stay available.
 *   2. assertDryerDurationSetBeforeEnteringDryIn — entering DRY_IN without
 *      SET_DURATION is refused unless the dryer already runs.
 *   3. assertDryerReadingsSubmittedBeforeLeavingDryIn — leaving DRY_IN with the
 *      dryer never started is refused (DRYER_DURATION_REQUIRED), not waved on.
 */
import { describe, expect, it } from 'vitest';
import {
  assertDryerDurationSetBeforeEnteringDryIn,
  assertDryerReadingsSubmittedBeforeLeavingDryIn,
  computeNextActions,
} from '../index.js';
import type { CycleSlice, LocalContext, ProfileSlice } from '../index.js';
import { bypassEnabledContext, dryInActiveContext, midWashContext } from './fixtures.js';

/** dryInActiveContext, but the dryer was never started on this cycle. */
function atDryInNoDryer(overrides: Partial<LocalContext> = {}): LocalContext {
  const base = dryInActiveContext();
  return {
    ...base,
    cycle: { ...base.cycle!, dryerStartedAt: null, dryerDurationMinutes: null, dryerReadingsSubmitted: false },
    ...overrides,
  };
}

/** START -> DRY_IN -> DRY_OUT -> END — the live "DRY STORAGE" shape. */
function dryFirstProfile(): ProfileSlice {
  return {
    id: 'profile-dry-first',
    lineageId: 'lineage-dry-first',
    name: 'DRY STORAGE',
    flowMode: 'SEQUENTIAL',
    version: 1,
    status: 'ACTIVE',
    cleaningReasons: { keys: ['ROUTINE'] },
    nodes: [
      { id: 'd-start', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
      { id: 'd-dry-in', stateKey: 'DRY_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 1 },
      { id: 'd-dry-out', stateKey: 'DRY_OUT', nodeType: 'STAGE', configuration: {}, sortOrder: 2 },
      { id: 'd-end', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 3 },
    ],
    edges: [
      { fromStageId: 'd-start', toStageId: 'd-dry-in' },
      { fromStageId: 'd-dry-in', toStageId: 'd-dry-out' },
      { fromStageId: 'd-dry-out', toStageId: 'd-end' },
    ],
  };
}

describe('computeNextActions — filter AT DRY_IN with the dryer never started', () => {
  it('offers SET_DRYER_DURATION in place (target DRY_IN) and NO advance', () => {
    const tape = computeNextActions(atDryInNoDryer());
    const types = tape.actions.map(a => a.type);
    expect(types).toContain('SET_DRYER_DURATION');
    expect(types).not.toContain('ADVANCE_TO_STAGE');
    expect(types).not.toContain('COMPLETE_CYCLE');
    expect(types).not.toContain('SUBMIT_DRYER_READINGS');
    const setDur = tape.actions.find(a => a.type === 'SET_DRYER_DURATION');
    expect(setDur && setDur.type === 'SET_DRYER_DURATION' ? setDur.params.targetState : null).toBe('DRY_IN');
    // Terminate stays last, as everywhere else.
    expect(tape.actions[tape.actions.length - 1]!.type).toBe('TERMINATE_CYCLE');
  });

  it('keeps BYPASS available as the justified escape when the profile allows it', () => {
    const base = bypassEnabledContext();
    const ctx: LocalContext = {
      ...base,
      cycle: { ...base.cycle!, dryerStartedAt: null, dryerDurationMinutes: null, dryerReadingsSubmitted: false },
      filter: { ...base.filter, currentLifecycleState: 'DRY_IN' },
    };
    const tape = computeNextActions(ctx);
    const types = tape.actions.map(a => a.type);
    expect(types).toContain('SET_DRYER_DURATION');
    expect(types).toContain('BYPASS_STAGE');
    expect(types).not.toContain('ADVANCE_TO_STAGE');
  });

  it('is unchanged once the dryer HAS started: countdown gate, then advance', () => {
    // dryInActiveContext: started 30 min ago of 60 → half elapsed, readings pending.
    const tape = computeNextActions(dryInActiveContext());
    const types = tape.actions.map(a => a.type);
    expect(types).not.toContain('SET_DRYER_DURATION');
    expect(types).toContain('ADVANCE_TO_STAGE');
  });

  it('a profile whose FIRST stage is DRY_IN asks for the duration on the way in (pre-existing rule)', () => {
    const base = midWashContext();
    const profile = dryFirstProfile();
    const ctx: LocalContext = {
      ...base,
      profile,
      cycle: { ...base.cycle!, profileId: profile.id, dryerStartedAt: null, dryerDurationMinutes: null },
      filter: { ...base.filter, currentLifecycleState: null },
      events: [],
    };
    const tape = computeNextActions(ctx);
    const setDur = tape.actions.find(a => a.type === 'SET_DRYER_DURATION');
    expect(setDur).toBeDefined();
    expect(tape.actions.some(a => a.type === 'ADVANCE_TO_STAGE')).toBe(false);
  });
});

const noDryer: CycleSlice = {
  ...dryInActiveContext().cycle!,
  dryerStartedAt: null,
  dryerDurationMinutes: null,
  dryerReadingsSubmitted: false,
};
const dryerRunning: CycleSlice = dryInActiveContext().cycle!;

describe('assertDryerDurationSetBeforeEnteringDryIn (guard #28)', () => {
  it('refuses entering DRY_IN with no dryer action and no running dryer', () => {
    expect(assertDryerDurationSetBeforeEnteringDryIn(noDryer, 'DRY_IN', null)).toMatchObject({
      ok: false,
      code: 'DRYER_DURATION_REQUIRED',
    });
    expect(assertDryerDurationSetBeforeEnteringDryIn(noDryer, 'DRY_IN', undefined)).toMatchObject({ ok: false });
  });
  it('passes with SET_DURATION', () => {
    expect(assertDryerDurationSetBeforeEnteringDryIn(noDryer, 'DRY_IN', 'SET_DURATION')).toEqual({ ok: true });
  });
  it('passes when the dryer already runs (in-place SUBMIT_READINGS)', () => {
    expect(assertDryerDurationSetBeforeEnteringDryIn(dryerRunning, 'DRY_IN', 'SUBMIT_READINGS')).toEqual({ ok: true });
    expect(assertDryerDurationSetBeforeEnteringDryIn(dryerRunning, 'DRY_IN', null)).toEqual({ ok: true });
  });
  it('ignores every other target', () => {
    expect(assertDryerDurationSetBeforeEnteringDryIn(noDryer, 'WASH_IN', null)).toEqual({ ok: true });
    expect(assertDryerDurationSetBeforeEnteringDryIn(noDryer, 'DRY_OUT', null)).toEqual({ ok: true });
    expect(assertDryerDurationSetBeforeEnteringDryIn(noDryer, null, null)).toEqual({ ok: true });
  });
});

describe('assertDryerReadingsSubmittedBeforeLeavingDryIn — dryer never started', () => {
  it('refuses leaving DRY_IN when the dryer never started (was a silent pass)', () => {
    expect(assertDryerReadingsSubmittedBeforeLeavingDryIn(noDryer, 'DRY_IN', 'DRY_OUT')).toMatchObject({
      ok: false,
      code: 'DRYER_DURATION_REQUIRED',
    });
  });
  it('still refuses leaving with the dryer running but no readings', () => {
    expect(assertDryerReadingsSubmittedBeforeLeavingDryIn(dryerRunning, 'DRY_IN', 'DRY_OUT')).toMatchObject({
      ok: false,
      code: 'DRYER_READINGS_REQUIRED',
    });
  });
  it('passes once the readings are in, and for in-place / non-DRY_IN moves', () => {
    expect(assertDryerReadingsSubmittedBeforeLeavingDryIn({ ...dryerRunning, dryerReadingsSubmitted: true }, 'DRY_IN', 'DRY_OUT')).toEqual({ ok: true });
    expect(assertDryerReadingsSubmittedBeforeLeavingDryIn(noDryer, 'DRY_IN', 'DRY_IN')).toEqual({ ok: true });
    expect(assertDryerReadingsSubmittedBeforeLeavingDryIn(noDryer, 'WASH_OUT', 'DRY_IN')).toEqual({ ok: true });
  });
});
