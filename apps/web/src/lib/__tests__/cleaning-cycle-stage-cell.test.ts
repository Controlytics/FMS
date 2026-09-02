import { describe, it, expect } from 'vitest';
import { maxReachedStageIndex, resolveStageCell, stageCellText } from '../cleaning-cycle-report';

// Build a STATE_TRANSITION event list from a sequence of destination stages.
const tx = (...toStates: string[]) => toStates.map((toState) => ({ eventType: 'STATE_TRANSITION', toState }));

const ALL = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];

/** Resolve a stage to its plain-text form — what the PDF and Excel exports print. */
const text = (
  stage: string,
  events: any[],
  profileStages: string[] = ALL,
  value: string | null = null,
  terminalLabel: string | null = null,
) =>
  stageCellText(
    resolveStageCell({
      stage,
      value,
      profileStages,
      terminalLabel,
      maxReachedIdx: maxReachedStageIndex(events, profileStages),
    }),
  );

describe('maxReachedStageIndex', () => {
  it('dedupes the double DRY_IN transition (SET_DURATION + SUBMIT_READINGS)', () => {
    // Two transitions land on DRY_IN by design, so the event COUNT is not a
    // stage index — reducing over a Set is what keeps this at DRY_IN's index.
    expect(maxReachedStageIndex(tx('WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_IN'), ALL)).toBe(2);
  });

  it('ignores non-transition events and transitions with no toState', () => {
    const events = [
      ...tx('WASH_IN'),
      { eventType: 'CHECKLIST_COMPLETED', toState: 'STORAGE_OUT' },
      { eventType: 'STATE_TRANSITION', toState: null },
    ];
    expect(maxReachedStageIndex(events, ALL)).toBe(0);
  });

  it('is -1 for a cycle with no transitions at all', () => {
    // Live data holds a COMPLETED cycle row with zero events; every stage must
    // fall through to the pending branch rather than throw or read as skipped.
    expect(maxReachedStageIndex([], ALL)).toBe(-1);
  });

  it('indexes against the cycle profile, not the fixed six-stage axis', () => {
    // A profile need not hold every stage. DRY_IN is index 2 of ALL but index 1
    // of this profile; using the wrong basis mislabels the gap test.
    expect(maxReachedStageIndex(tx('WASH_IN', 'DRY_IN'), ['WASH_IN', 'DRY_IN', 'STORAGE_IN'])).toBe(1);
  });

  it('counts a stage reached out of order', () => {
    expect(maxReachedStageIndex(tx('WASH_IN', 'STORAGE_IN', 'WASH_OUT'), ALL)).toBe(4);
  });
});

describe('resolveStageCell — precedence', () => {
  const base = { profileStages: ALL, terminalLabel: null, maxReachedIdx: 3 };

  it('a recorded value wins over every other branch', () => {
    // WASH_IN sits below maxReachedIdx, so without this precedence it would be
    // reported skipped despite having a time.
    expect(resolveStageCell({ ...base, stage: 'WASH_IN', value: '01/06/2026 10:00' }))
      .toEqual({ kind: 'value', value: '01/06/2026 10:00', manual: false });
  });

  it('carries the manual flag so only the screen colours it', () => {
    expect(resolveStageCell({ ...base, stage: 'WASH_IN', value: '10:00', manual: true }))
      .toEqual({ kind: 'value', value: '10:00', manual: true });
  });

  it('a stage outside the profile is NA, even below the furthest reached', () => {
    expect(resolveStageCell({ ...base, profileStages: ['WASH_IN', 'WASH_OUT'], stage: 'DRY_IN', value: null }))
      .toEqual({ kind: 'na' });
  });

  it('an unknown profile (empty list) never reports NA', () => {
    // profileStages is [] when the cycle has no resolvable profile; treating
    // that as "not in profile" would blank every column.
    expect(resolveStageCell({ ...base, profileStages: [], stage: 'DRY_IN', value: null }).kind).toBe('pending');
  });

  it('retire/replace outranks skipped and pending', () => {
    expect(resolveStageCell({ ...base, stage: 'WASH_OUT', value: null, terminalLabel: 'Retired' }))
      .toEqual({ kind: 'terminal', label: 'Retired' });
  });
});

describe('resolveStageCell — skipped vs pending', () => {
  it('a gap in the MIDDLE is skipped', () => {
    // WASH_OUT never happened but DRY_OUT did, so the cycle jumped over it.
    expect(text('WASH_OUT', tx('WASH_IN', 'DRY_IN', 'DRY_OUT'))).toBe('Skipped');
  });

  it('a stage never reached at the END of the profile is pending, not skipped', () => {
    // 🔴 The reported symptom. The rule is positional and deliberately does NOT
    // consult cycle status, so trailing un-performed stages stay "Pending" even
    // once the cycle is COMPLETED. Locking it so the behaviour is a decision,
    // not an accident — changing it is an operator call (21 CFR §11 wording).
    expect(text('STORAGE_OUT', tx('WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN'))).toBe('Pending');
  });

  it('the furthest stage reached is itself never skipped', () => {
    // idx < maxReachedIdx is strict; `idx === maxReachedIdx` means it WAS reached.
    expect(text('DRY_OUT', tx('WASH_IN', 'DRY_OUT'), ALL, null)).toBe('Pending');
  });

  it('every stage is pending on a cycle with no transitions', () => {
    expect(ALL.map((s) => text(s, []))).toEqual(ALL.map(() => 'Pending'));
  });
});

describe('the export prints what the screen shows', () => {
  /**
   * The regression this file exists for. Before 2026-09-02 the PDF/Excel row
   * builder carried its own copy of the rule with no skipped branch, so a stage
   * the page labelled "Skipped" printed as "Pending" in the export of the same
   * cycle — two renderings of one 21 CFR §11 record disagreeing.
   *
   * Both surfaces now call resolveStageCell, so the guard is that every state
   * it can return has a text form and the mid-gap case reaches it.
   */
  it('maps every state kind to a label', () => {
    expect(stageCellText({ kind: 'value', value: '10:00', manual: false })).toBe('10:00');
    expect(stageCellText({ kind: 'na' })).toBe('NA');
    expect(stageCellText({ kind: 'terminal', label: 'Replaced' })).toBe('Replaced');
    expect(stageCellText({ kind: 'skipped' })).toBe('Skipped');
    expect(stageCellText({ kind: 'pending' })).toBe('Pending');
  });

  it('prints Skipped for a mid-chain gap on a completed cycle', () => {
    // The exact shape that used to print "Pending" in the PDF.
    expect(text('WASH_OUT', tx('WASH_IN', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'))).toBe('Skipped');
  });

  it('prints the manual value plainly — the orange styling is screen-only', () => {
    expect(stageCellText(resolveStageCell({
      stage: 'WASH_IN', value: '10:00', manual: true,
      profileStages: ALL, terminalLabel: null, maxReachedIdx: 3,
    }))).toBe('10:00');
  });
});

describe('regression: a real cycle from digilog_db', () => {
  /**
   * Cycle 44582f21 on filter L2/AHU-011/SA/01, profile "L22 v1", 2026-06-03.
   * Its pipeline is a straight line
   *   WASH_IN -> WASH_OUT -> [checklist] -> DRY_IN -> [checklist] -> DRY_OUT
   *           -> STORAGE_IN -> [checklist] -> STORAGE_OUT -> END
   * but only WASH_IN, WASH_OUT, STORAGE_IN and STORAGE_OUT ever transitioned:
   * one of its later events even carries fromState DRY_OUT with no DRY_OUT
   * transition of its own. The cycle is COMPLETED.
   *
   * The screen showed DRY_IN / DRY_OUT as "Skipped"; the PDF and Excel export
   * of the same cycle printed "Pending". This asserts they now agree.
   */
  const L22 = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];
  const events = tx('WASH_IN', 'WASH_OUT', 'STORAGE_IN', 'STORAGE_OUT');

  it('reports the two jumped-over stages as Skipped', () => {
    expect(text('DRY_IN', events, L22)).toBe('Skipped');
    expect(text('DRY_OUT', events, L22)).toBe('Skipped');
  });

  it('leaves the performed stages to their recorded values', () => {
    expect(text('WASH_IN', events, L22, '03/06/2026 15:36')).toBe('03/06/2026 15:36');
    expect(text('STORAGE_OUT', events, L22, '03/06/2026 15:45')).toBe('03/06/2026 15:45');
  });
});
