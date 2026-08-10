import { describe, it, expect } from 'vitest';
import { computeFinalStageKey, computeReadyStageKeys, isReadyForFinalStage } from '../ahu-completion-gate.js';

// Minimal graph: S1 -> S2 -> END
const nodes = [
  { id: 'n1', nodeType: 'STAGE', stateKey: 'S1' },
  { id: 'n2', nodeType: 'STAGE', stateKey: 'S2' },
  { id: 'nEnd', nodeType: 'END', stateKey: null },
];
const edges = [
  { fromStageId: 'n1', toStageId: 'n2' },
  { fromStageId: 'n2', toStageId: 'nEnd' },
];

describe('computeFinalStageKey', () => {
  it('returns the last STAGE that leads to END', () => {
    expect(computeFinalStageKey({ nodes, edges })).toBe('S2');
  });
});

/**
 * 2026-08-10 RULE CHANGE — read before "fixing" a failure here.
 *
 * Readiness used to mean "parked AT the final stage". That became unsatisfiable
 * once the AHU gate moved to run BEFORE the advance commits (dialog-first,
 * commit `73c532c`): at gate time every scanned filter is still at the
 * predecessor, so reaching Storage Out required already being at Storage Out.
 * INTERLOCK could never be satisfied for a whole AHU and POPUP always warned.
 *
 * The operator-specified rule is: "all filters reached Storage In, then only
 * should filters be submitted at Storage Out". So readiness = the final stage
 * OR a direct predecessor of it. The `S1 → not ready` assertion this file
 * carried before was deliberately INVERTED, not adjusted to go green — under
 * `S1 → S2 → END`, S1 is S2's predecessor and is now the ready state.
 *
 * Still blocking (unchanged): a filter mid-cycle at an earlier stage, and a
 * filter that never started one.
 */
describe('computeReadyStageKeys', () => {
  it('includes the final stage AND its direct predecessor', () => {
    expect([...computeReadyStageKeys({ nodes, edges })].sort()).toEqual(['S1', 'S2']);
  });

  it('treats a stage separated from END by a CHECKLIST as a predecessor', () => {
    // `S1 → S2 → CHECKLIST → END` — the checklist is part of LEAVING S2, not a
    // state a filter can park at, so S1 must still count as S2's predecessor.
    const n = [
      { id: 'n1', nodeType: 'STAGE', stateKey: 'S1' },
      { id: 'n2', nodeType: 'STAGE', stateKey: 'S2' },
      { id: 'nc', nodeType: 'CHECKLIST', stateKey: null, configuration: { checklistProfileId: 'cp' } },
      { id: 'nEnd', nodeType: 'END', stateKey: null },
    ];
    const e = [
      { fromStageId: 'n1', toStageId: 'n2' },
      { fromStageId: 'n2', toStageId: 'nc' },
      { fromStageId: 'nc', toStageId: 'nEnd' },
    ];
    expect(computeFinalStageKey({ nodes: n, edges: e })).toBe('S2');
    expect([...computeReadyStageKeys({ nodes: n, edges: e })].sort()).toEqual(['S1', 'S2']);
  });

  it('does NOT include a stage two steps back — that one still blocks', () => {
    const n = [
      { id: 'n0', nodeType: 'STAGE', stateKey: 'S0' },
      ...nodes,
    ];
    const e = [{ fromStageId: 'n0', toStageId: 'n1' }, ...edges];
    const ready = computeReadyStageKeys({ nodes: n, edges: e });
    expect(ready.has('S0')).toBe(false);
    expect([...ready].sort()).toEqual(['S1', 'S2']);
  });

  it('returns an empty set for a graph with no final stage', () => {
    expect(computeReadyStageKeys({ nodes: [], edges: [] }).size).toBe(0);
  });
});

describe('isReadyForFinalStage', () => {
  const readyMap = new Map<string, Set<string>>([['f-active', new Set(['S1', 'S2'])]]);

  it('active cycle parked at the final stage → ready', () => {
    expect(isReadyForFinalStage({ id: 'f-active', name: 'F', currentCycleId: 'c1', currentLifecycleState: 'S2' }, readyMap)).toBe(true);
  });

  it('active cycle parked at the PREDECESSOR (the "all at Storage In" rule) → ready', () => {
    // This assertion is the rule change: it returned false before 2026-08-10.
    expect(isReadyForFinalStage({ id: 'f-active', name: 'F', currentCycleId: 'c1', currentLifecycleState: 'S1' }, readyMap)).toBe(true);
  });

  it('active cycle at an earlier stage → still blocks', () => {
    expect(isReadyForFinalStage({ id: 'f-active', name: 'F', currentCycleId: 'c1', currentLifecycleState: 'S0' }, readyMap)).toBe(false);
  });

  it('no cycle + CLEANING_CYCLE_COMPLETED → ready', () => {
    expect(isReadyForFinalStage({ id: 'f-done', name: 'F', currentCycleId: null, currentLifecycleState: 'CLEANING_CYCLE_COMPLETED' }, readyMap)).toBe(true);
  });

  it('never started (null state) → still blocks', () => {
    expect(isReadyForFinalStage({ id: 'f-idle', name: 'F', currentCycleId: null, currentLifecycleState: null }, readyMap)).toBe(false);
  });

  it('active cycle with no resolved ready-set → blocks (conservative)', () => {
    expect(isReadyForFinalStage({ id: 'f-unknown', name: 'F', currentCycleId: 'c9', currentLifecycleState: 'S2' }, readyMap)).toBe(false);
  });

  it('uses each filter OWN ready-set — an AHU may mix cleaning profiles', () => {
    const mixed = new Map<string, Set<string>>([
      ['f-a', new Set(['STORAGE_IN', 'STORAGE_OUT'])],
      ['f-b', new Set(['DRY_IN', 'STORAGE_IN'])], // shorter pipeline ending at STORAGE_IN
    ]);
    expect(isReadyForFinalStage({ id: 'f-a', name: 'A', currentCycleId: 'c', currentLifecycleState: 'STORAGE_IN' }, mixed)).toBe(true);
    // Same stage key, different profile → still ready here, but DRY_IN would not
    // be ready for f-a. A single global threshold would get one of these wrong.
    expect(isReadyForFinalStage({ id: 'f-b', name: 'B', currentCycleId: 'c', currentLifecycleState: 'DRY_IN' }, mixed)).toBe(true);
    expect(isReadyForFinalStage({ id: 'f-a', name: 'A', currentCycleId: 'c', currentLifecycleState: 'DRY_IN' }, mixed)).toBe(false);
  });
});
