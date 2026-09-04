import { describe, it, expect } from 'vitest';
import { transitionEndpoints, phaseSuffix } from '../cleaning-cycle-report';

/**
 * DRY_IN is entered once but emits TWO STATE_TRANSITION rows — set the dryer
 * duration, then submit the temperature. `advance.ts` persists `fromState =
 * null` on the second ("no transition actually occurred") and delegated the
 * labelling to the `action` attribute. No renderer ever read `action`, so every
 * event timeline printed the readings row through its GENESIS fallback:
 *
 *     "To Be Cleaned -> Dry In"
 *
 * i.e. the filter was awaiting its first clean, in the middle of its own drying
 * step. Operator report 2026-09-04. Counts below are from the live DB.
 */
const ev = (o: any) => ({ eventType: 'STATE_TRANSITION', ...o });

describe('transitionEndpoints — the two DRY_IN steps', () => {
  it('duration submitted reads "Wash Out -> Dry In (Started)"  [284 live rows]', () => {
    const r = transitionEndpoints(ev({
      fromState: 'WASH_OUT', toState: 'DRY_IN',
      attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 30 },
    }));
    expect(r).toEqual({ from: 'WASH_OUT', to: 'DRY_IN', phase: 'started' });
    expect(phaseSuffix(r.phase)).toBe(' (Started)');
  });

  it('temperature submitted reads "Dry In -> Dry In (Ended)", never "To Be Cleaned"  [289 live rows]', () => {
    const r = transitionEndpoints(ev({
      fromState: null, toState: 'DRY_IN',
      attributes: { action: 'DRYER_READINGS_SUBMITTED', instrumentReadings: [{ value: 60 }] },
    }));
    expect(r).toEqual({ from: 'DRY_IN', to: 'DRY_IN', phase: 'ended' });
    expect(phaseSuffix(r.phase)).toBe(' (Ended)');
  });

  it('the 13 LEGACY rows that stored DRY_IN -> DRY_IN with no action read the same', () => {
    // They already had the right endpoints; without this they would be the only
    // dryer-end rows missing "(Ended)" — the inconsistency being fixed.
    const r = transitionEndpoints(ev({
      fromState: 'DRY_IN', toState: 'DRY_IN',
      attributes: { instrumentReadings: [{ value: 60 }] },
    }));
    expect(r).toEqual({ from: 'DRY_IN', to: 'DRY_IN', phase: 'ended' });
  });

  it('a readings row with neither action nor fromState is still the dryer end  [1 live row]', () => {
    const r = transitionEndpoints(ev({
      fromState: null, toState: 'DRY_IN', attributes: { instrumentReadings: [{ value: 60 }] },
    }));
    expect(r.phase).toBe('ended');
  });

  it('an action-only readings row (no readings recorded) is still the dryer end  [1 live row]', () => {
    const r = transitionEndpoints(ev({
      fromState: null, toState: 'DRY_IN', attributes: { action: 'DRYER_READINGS_SUBMITTED' },
    }));
    expect(r.phase).toBe('ended');
  });

  it('re-setting the duration while already in DRY_IN says Dry In, not To Be Cleaned', () => {
    // isDryerInPlace persists null for a SET_DURATION at DRY_IN too.
    const r = transitionEndpoints(ev({
      fromState: null, toState: 'DRY_IN', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 45 },
    }));
    expect(r).toEqual({ from: 'DRY_IN', to: 'DRY_IN', phase: 'started' });
  });
});

describe('transitionEndpoints — what it must NOT touch', () => {
  it('the 668 genesis rows keep reading "To Be Cleaned -> Wash In"', () => {
    // The regression that would go unnoticed until an operator spotted it.
    const r = transitionEndpoints(ev({ fromState: null, toState: 'WASH_IN', attributes: {} }));
    expect(r).toEqual({ from: null, to: 'WASH_IN', phase: null });
  });

  it('a manual update with no prior state keeps reading "To Be Cleaned"  [4 live rows]', () => {
    const r = transitionEndpoints(ev({ fromState: null, toState: 'WASH_OUT', attributes: { manual: true } }));
    expect(r.from).toBeNull();
    expect(r.phase).toBeNull();
  });

  it('plain DRY_IN ENTRY is a real stage move, not a dryer step  [19 live rows]', () => {
    const r = transitionEndpoints(ev({ fromState: 'WASH_OUT', toState: 'DRY_IN', attributes: {} }));
    expect(r).toEqual({ from: 'WASH_OUT', to: 'DRY_IN', phase: null });
  });

  it('DRY_IN entry that CARRIES readings is still a stage move — the fromState narrowing', () => {
    // A profile with instruments on DRY_IN entry would produce exactly this.
    // Without the `from === null || from === 'DRY_IN'` guard it would be
    // rewritten to "Dry In -> Dry In (Ended)" and the real move erased.
    const r = transitionEndpoints(ev({
      fromState: 'WASH_OUT', toState: 'DRY_IN', attributes: { instrumentReadings: [{ value: 60 }] },
    }));
    expect(r).toEqual({ from: 'WASH_OUT', to: 'DRY_IN', phase: null });
  });

  it('every other stage passes straight through', () => {
    for (const [f, t] of [['WASH_IN', 'WASH_OUT'], ['DRY_IN', 'DRY_OUT'], ['DRY_OUT', 'STORAGE_IN']]) {
      expect(transitionEndpoints(ev({ fromState: f, toState: t, attributes: {} })))
        .toEqual({ from: f, to: t, phase: null });
    }
  });

  it('a non-transition event is untouched', () => {
    const r = transitionEndpoints({ eventType: 'CHECKLIST_COMPLETED', fromState: null, toState: null, attributes: {} });
    expect(r).toEqual({ from: null, to: null, phase: null });
  });
});
