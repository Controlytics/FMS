/**
 * checklistMayBeAnsweredAt — which station may answer a checklist that is
 * pending at a cycle's CURRENT stage (2026-10-22).
 *
 * The case it closes: a filter whose cycle sat at Storage Out with its final
 * checklist pending, scanned at the Wash In station, got that checklist — and
 * submitting it completed the old cycle (CC-MUPS/RDU/0-005, 2026-05-25). The
 * tablet deliberately lets the NEXT station answer the previous stage's
 * checklist (answer, then advance), so the rule is "the current stage or one
 * of its next stages", never "any station".
 */
import { describe, it, expect } from 'vitest';
import { checklistMayBeAnsweredAt, pendingChecklistStage, stageLabel } from '../checklist-station';

const LOOKUP = {
  WASH_IN: { nextStages: ['WASH_OUT'], pendingChecklistProfileIds: ['cl1'], leadsToEnd: false },
  WASH_OUT: { nextStages: ['DRY_IN'], pendingChecklistProfileIds: [], leadsToEnd: false },
  STORAGE_OUT: { nextStages: [], pendingChecklistProfileIds: ['cl9'], leadsToEnd: true },
};

/** START → WASH_IN → [checklist] → WASH_OUT → STORAGE_OUT → [checklist] → END */
const GRAPH = {
  stages: [
    { id: 's', nodeType: 'START' },
    { id: 'wi', nodeType: 'STAGE', stateKey: 'WASH_IN' },
    { id: 'c1', nodeType: 'CHECKLIST' },
    { id: 'wo', nodeType: 'STAGE', stateKey: 'WASH_OUT' },
    { id: 'so', nodeType: 'STAGE', stateKey: 'STORAGE_OUT' },
    { id: 'c9', nodeType: 'CHECKLIST' },
    { id: 'e', nodeType: 'END' },
  ],
  connections: [
    { fromStageId: 's', toStageId: 'wi' }, { fromStageId: 'wi', toStageId: 'c1' }, { fromStageId: 'c1', toStageId: 'wo' },
    { fromStageId: 'wo', toStageId: 'so' }, { fromStageId: 'so', toStageId: 'c9' }, { fromStageId: 'c9', toStageId: 'e' },
  ],
};

describe('checklistMayBeAnsweredAt', () => {
  it('the station of the stage the checklist belongs to may answer it', () => {
    expect(checklistMayBeAnsweredAt('STORAGE_OUT', 'STORAGE_OUT', LOOKUP, 'F-001')).toEqual({ ok: true });
  });

  it('the NEXT station may answer it (answer, then advance there)', () => {
    expect(checklistMayBeAnsweredAt('WASH_OUT', 'WASH_IN', LOOKUP, 'F-001')).toEqual({ ok: true });
  });

  it('any other station is refused, naming the filter and the stage to go to', () => {
    expect(checklistMayBeAnsweredAt('WASH_IN', 'STORAGE_OUT', LOOKUP, 'F-001')).toEqual({
      ok: false,
      stage: 'STORAGE_OUT',
      reason: 'F-001 has a pending Storage Out checklist — scan it at Storage Out',
    });
    // a station two stages ahead is not "next"
    expect(checklistMayBeAnsweredAt('DRY_IN', 'WASH_IN', LOOKUP, 'F-001').ok).toBe(false);
  });

  it('with no stageLookup row for the stage, the next stages come from the pipeline graph', () => {
    expect(checklistMayBeAnsweredAt('WASH_OUT', 'WASH_IN', null, 'F-001', GRAPH)).toEqual({ ok: true });
    expect(checklistMayBeAnsweredAt('WASH_IN', 'STORAGE_OUT', {}, 'F-001', GRAPH).ok).toBe(false);
  });

  it('when the next stages cannot be told at all, only the current station may answer (fail closed)', () => {
    expect(checklistMayBeAnsweredAt('WASH_IN', 'WASH_IN', null, 'F-001')).toEqual({ ok: true });
    expect(checklistMayBeAnsweredAt('WASH_OUT', 'WASH_IN', null, 'F-001').ok).toBe(false);
  });

  // START is a position (2026-10-22): a started cycle that has not entered a
  // stage, its checklist before the first stage pending. It is answered where
  // the first stage is entered — answered anywhere else, the advance that
  // follows is refused (and the filter was never at that station).
  it('a checklist waiting at START is answered only at the first stage(s), from the graph', () => {
    expect(checklistMayBeAnsweredAt('WASH_IN', null, LOOKUP, 'F-001', GRAPH)).toEqual({ ok: true });
    expect(checklistMayBeAnsweredAt('STORAGE_OUT', null, LOOKUP, 'F-001', GRAPH)).toEqual({
      ok: false, stage: 'WASH_IN', reason: 'F-001 has a pending checklist before its first stage — scan it at Wash In',
    });
  });

  it('several first stages are all named', () => {
    const two = {
      stages: [...GRAPH.stages, { id: 'di', nodeType: 'STAGE', stateKey: 'DRY_IN' }],
      connections: [...GRAPH.connections, { fromStageId: 's', toStageId: 'di' }],
    };
    expect(checklistMayBeAnsweredAt('DRY_IN', null, LOOKUP, 'F-001', two)).toEqual({ ok: true });
    expect(checklistMayBeAnsweredAt('STORAGE_OUT', null, LOOKUP, 'F-001', two)).toMatchObject({ ok: false, reason: expect.stringMatching(/scan it at (Wash In or Dry In|Dry In or Wash In)$/) });
  });

  it('at START with no pipeline graph the first stage cannot be told: refused (fail closed)', () => {
    expect(checklistMayBeAnsweredAt('WASH_IN', null, LOOKUP, 'F-001')).toMatchObject({
      ok: false, reason: 'F-001 has a pending checklist before its first stage — scan it at its first stage',
    });
  });

  it('without a filter name the sentence still reads', () => {
    expect(checklistMayBeAnsweredAt('WASH_IN', 'DRY_OUT', LOOKUP)).toMatchObject({ reason: 'This filter has a pending Dry Out checklist — scan it at Dry Out' });
  });
});

describe('pendingChecklistStage', () => {
  it('reads the stage from the SUBMIT_CHECKLIST on the tape, not from anything else', () => {
    expect(pendingChecklistStage([{ type: 'TERMINATE_CYCLE' }, { type: 'SUBMIT_CHECKLIST', params: { afterStage: 'STORAGE_OUT' } }])).toBe('STORAGE_OUT');
    expect(pendingChecklistStage([{ type: 'ADVANCE_TO_STAGE', params: { targetState: 'WASH_OUT' } }])).toBeNull();
    expect(pendingChecklistStage(null)).toBeNull();
  });
});

describe('stageLabel', () => {
  it('turns a stage key into its station name', () => {
    expect(stageLabel('STORAGE_OUT')).toBe('Storage Out');
    expect(stageLabel('WASH_IN')).toBe('Wash In');
    expect(stageLabel('DRY_IN')).toBe('Dry In');
  });
});
