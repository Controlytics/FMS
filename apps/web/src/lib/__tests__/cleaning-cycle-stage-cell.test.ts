import { describe, it, expect } from 'vitest';
import { maxReachedStageIndex, resolveStageCell, stageCellText } from '../cleaning-cycle-report';

// Build a STATE_TRANSITION event list from a sequence of destination stages.
const tx = (...toStates: string[]) => toStates.map((toState) => ({ eventType: 'STATE_TRANSITION', toState }));

const ALL = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];

/** Resolve a stage to its plain-text form — what the PDF and Excel exports print. */
const text = (
  stage: string,
  events: any[],
  effStatus: string,
  profileStages: string[] = ALL,
  value: string | null = null,
) =>
  stageCellText(
    resolveStageCell({
      stage,
      value,
      profileStages,
      effStatus,
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
  const base = { profileStages: ALL, effStatus: 'IN_PROGRESS', maxReachedIdx: 3 };

  it('a recorded value wins over every other branch', () => {
    // WASH_IN sits below maxReachedIdx, so without this precedence it would be
    // reported skipped despite having a time.
    expect(resolveStageCell({ ...base, stage: 'WASH_IN', value: '01/06/2026 10:00' }))
      .toEqual({ kind: 'value', value: '01/06/2026 10:00', manual: false });
  });

  it('a recorded value still wins on a COMPLETED cycle', () => {
    expect(resolveStageCell({ ...base, effStatus: 'COMPLETED', stage: 'STORAGE_OUT', value: '10:00' }).kind)
      .toBe('value');
  });

  it('carries the manual flag so only the screen colours it', () => {
    expect(resolveStageCell({ ...base, stage: 'WASH_IN', value: '10:00', manual: true }))
      .toEqual({ kind: 'value', value: '10:00', manual: true });
  });

  it('a stage outside the profile is NA, even on a completed cycle', () => {
    // NA outranks the completed->skipped rule: a stage the profile never had
    // was not "skipped", it was never applicable.
    expect(resolveStageCell({ ...base, effStatus: 'COMPLETED', profileStages: ['WASH_IN', 'WASH_OUT'], stage: 'DRY_IN', value: null }))
      .toEqual({ kind: 'na' });
  });

  it('an unknown profile (empty list) never reports NA', () => {
    // profileStages is [] when the cycle has no resolvable profile; treating
    // that as "not in profile" would blank every column.
    expect(resolveStageCell({ ...base, profileStages: [], stage: 'DRY_IN', value: null }).kind).toBe('pending');
  });

  it('retire and replace outrank skipped and pending', () => {
    expect(resolveStageCell({ ...base, effStatus: 'RETIRED', stage: 'WASH_OUT', value: null }))
      .toEqual({ kind: 'terminal', label: 'Retired' });
    expect(resolveStageCell({ ...base, effStatus: 'REPLACED', stage: 'WASH_OUT', value: null }))
      .toEqual({ kind: 'terminal', label: 'Replaced' });
  });
});

describe('resolveStageCell — skipped vs pending', () => {
  it('a gap in the MIDDLE is skipped whatever the status', () => {
    // WASH_OUT never happened but DRY_OUT did, so the cycle jumped over it.
    // True even mid-cycle: a later stage is already evidence it was passed by.
    expect(text('WASH_OUT', tx('WASH_IN', 'DRY_IN', 'DRY_OUT'), 'IN_PROGRESS')).toBe('Skipped');
    expect(text('WASH_OUT', tx('WASH_IN', 'DRY_IN', 'DRY_OUT'), 'COMPLETED')).toBe('Skipped');
  });

  it('a trailing un-performed stage is SKIPPED once the cycle is COMPLETED', () => {
    // Operator decision 2026-09-02. A closed cycle has no outstanding work, so
    // "Pending" asserted on a finished §11 record that the stage was still to
    // come. It reads "Skipped" now, on the page and in the PDF/Excel alike.
    expect(text('STORAGE_OUT', tx('WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN'), 'COMPLETED'))
      .toBe('Skipped');
  });

  it('the same stage is PENDING while the cycle is still IN_PROGRESS', () => {
    // The operator has simply not got there yet — the work really is pending.
    expect(text('STORAGE_OUT', tx('WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN'), 'IN_PROGRESS'))
      .toBe('Pending');
  });

  it('a TERMINATED cycle reads Terminated — not Pending, and not Skipped', () => {
    // Operator decision 2026-09-03 (the call left open on 09-02). A finished
    // cycle cannot have pending work, but an ABANDONED cycle makes a different
    // claim from a skipped stage, so it gets its own word rather than reusing
    // "Skipped". 24 live cycles are in this state.
    expect(text('STORAGE_OUT', tx('WASH_IN', 'WASH_OUT'), 'TERMINATED')).toBe('Terminated');
  });

  it('a MID-CHAIN gap in a terminated cycle is still Skipped, not Terminated', () => {
    // The operator moved PAST this stage before abandoning the cycle, so it was
    // genuinely skipped. Termination only explains the stages never reached.
    expect(text('WASH_OUT', tx('WASH_IN', 'DRY_IN'), 'TERMINATED')).toBe('Skipped');
  });

  it('Pending now means IN_PROGRESS and nothing else', () => {
    const trailing = (st: string) => text('STORAGE_OUT', tx('WASH_IN'), st);
    expect(trailing('IN_PROGRESS')).toBe('Pending');
    for (const finished of ['COMPLETED', 'TERMINATED', 'RETIRED', 'REPLACED']) {
      expect(trailing(finished), `${finished} must not read Pending`).not.toBe('Pending');
    }
  });

  it('retire/replace still win over the plain TERMINATED wording', () => {
    // Both are TERMINATED cycles underneath; effectiveCycleStatus maps them
    // first, and those labels say more than "Terminated" does.
    expect(text('STORAGE_OUT', tx('WASH_IN'), 'RETIRED')).toBe('Retired');
    expect(text('STORAGE_OUT', tx('WASH_IN'), 'REPLACED')).toBe('Replaced');
  });

  it('every stage is skipped on a COMPLETED cycle with no transitions at all', () => {
    // Live data holds exactly one such row (a cycle marked COMPLETED with zero
    // events). Nothing was recorded, and the cycle is closed, so nothing is
    // pending — the honest reading is that none of it was performed.
    expect(ALL.map((s) => text(s, [], 'COMPLETED'))).toEqual(ALL.map(() => 'Skipped'));
  });

  it('every stage is pending on an IN_PROGRESS cycle with no transitions', () => {
    expect(ALL.map((s) => text(s, [], 'IN_PROGRESS'))).toEqual(ALL.map(() => 'Pending'));
  });
});

describe('the export prints what the screen shows', () => {
  /**
   * Why this file exists. Before 2026-09-02 the PDF/Excel row builder carried
   * its own copy of the rule with no skipped branch, so a stage the page
   * labelled "Skipped" printed as "Pending" in the export of the same cycle —
   * two renderings of one 21 CFR §11 record disagreeing. Both surfaces call
   * resolveStageCell now, so the guard is that every state it can return has a
   * text form and the interesting cases reach it.
   */
  it('maps every state kind to a label', () => {
    expect(stageCellText({ kind: 'value', value: '10:00', manual: false })).toBe('10:00');
    expect(stageCellText({ kind: 'na' })).toBe('NA');
    expect(stageCellText({ kind: 'terminal', label: 'Replaced' })).toBe('Replaced');
    expect(stageCellText({ kind: 'skipped' })).toBe('Skipped');
    expect(stageCellText({ kind: 'pending' })).toBe('Pending');
  });

  it('prints the manual value plainly — the orange styling is screen-only', () => {
    expect(stageCellText(resolveStageCell({
      stage: 'WASH_IN', value: '10:00', manual: true,
      profileStages: ALL, effStatus: 'COMPLETED', maxReachedIdx: 3,
    }))).toBe('10:00');
  });
});

describe('regression: real cycles from digilog_db', () => {
  /**
   * Cycle 44582f21 on filter L2/AHU-011/SA/01, profile "L22 v1", 2026-06-03,
   * status COMPLETED. Its pipeline is a straight line
   *   WASH_IN -> WASH_OUT -> [checklist] -> DRY_IN -> [checklist] -> DRY_OUT
   *           -> STORAGE_IN -> [checklist] -> STORAGE_OUT -> END
   * but only WASH_IN, WASH_OUT, STORAGE_IN and STORAGE_OUT ever transitioned:
   * one of its later events even carries fromState DRY_OUT with no DRY_OUT
   * transition of its own.
   */
  const L22 = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'];
  const gap = tx('WASH_IN', 'WASH_OUT', 'STORAGE_IN', 'STORAGE_OUT');

  it('reports the two jumped-over stages as Skipped', () => {
    expect(text('DRY_IN', gap, 'COMPLETED', L22)).toBe('Skipped');
    expect(text('DRY_OUT', gap, 'COMPLETED', L22)).toBe('Skipped');
  });

  it('leaves the performed stages to their recorded values', () => {
    expect(text('WASH_IN', gap, 'COMPLETED', L22, '03/06/2026 15:36')).toBe('03/06/2026 15:36');
    expect(text('STORAGE_OUT', gap, 'COMPLETED', L22, '03/06/2026 15:45')).toBe('03/06/2026 15:45');
  });

  /**
   * Cycle ee760720, same filter and profile, also COMPLETED, but it stopped
   * after WASH_OUT — DRY_IN, DRY_OUT, STORAGE_IN and STORAGE_OUT are all
   * TRAILING. Every one of them printed "Pending" on a completed record before
   * this change; this is the case the operator asked about.
   */
  it('reports trailing un-performed stages of a completed cycle as Skipped', () => {
    const trailing = tx('WASH_IN', 'WASH_OUT');
    expect(['DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT'].map((s) => text(s, trailing, 'COMPLETED', L22)))
      .toEqual(['Skipped', 'Skipped', 'Skipped', 'Skipped']);
  });

  /**
   * Profile "CWH v3" holds no DRY_OUT node at all, and 113 completed cycles run
   * on such profiles. Those stages must stay NA — the completed->skipped rule
   * must not turn "never applicable" into "not performed".
   */
  it('keeps out-of-profile stages as NA on completed cycles', () => {
    const CWH = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'STORAGE_IN', 'STORAGE_OUT'];
    expect(text('DRY_OUT', tx('WASH_IN', 'WASH_OUT', 'DRY_IN', 'STORAGE_IN', 'STORAGE_OUT'), 'COMPLETED', CWH))
      .toBe('NA');
  });
});
