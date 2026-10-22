/**
 * action-tape barrel. `getCurrentActions` local path runs the REAL
 * loadLocalContextFromCache + computeNextActions over an in-memory IndexedDB
 * (lib/__tests__/support/fake-idb.ts replaces only the `indexedDB` global) and a
 * stubbed connectivity flag (the real module probes /api/health).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFakeIdb, type FakeIdb } from '@/lib/__tests__/support/fake-idb';

vi.mock('@/lib/connectivity', () => ({ isOnline: () => true }));

import { actionsForStage, getCurrentActions, hasActionKind, type Action } from '../index';
import { cacheData } from '@/lib/offline-store';

const a = (type: string, params: Record<string, unknown> = {}) => ({ type, params }) as unknown as Action;

describe('actionsForStage', () => {
  const tape = [
    a('ADVANCE_TO_STAGE', { targetState: 'WASH_OUT' }),
    a('BYPASS_STAGE', { targetState: 'WASH_OUT' }),
    a('SET_DRYER_DURATION', { targetState: 'DRY_IN' }),
    a('SUBMIT_CHECKLIST', { afterStage: 'WASH_IN' }),
    a('SUBMIT_DRYER_READINGS'),
    a('TERMINATE_CYCLE'),
    a('COMPLETE_CYCLE'),
    a('SOMETHING_NEW', { targetState: 'WASH_OUT' }),
  ];

  it.each([
    ['WASH_OUT', ['ADVANCE_TO_STAGE', 'BYPASS_STAGE']],
    ['DRY_IN', ['SET_DRYER_DURATION', 'SUBMIT_DRYER_READINGS']],
    ['WASH_IN', ['SUBMIT_CHECKLIST']],
    ['STORAGE_IN', []],
  ])('stage %s keeps only the actions that target it', (stage, kinds) => {
    expect(actionsForStage(stage, tape).map((x) => x.type)).toEqual(kinds);
  });

  // START is a position (2026-10-22): the checklists before the first stage
  // carry afterStage: null, and only a null position matches them.
  it('the START position (null) matches the START checklist and nothing else', () => {
    const withStart = [...tape, a('SUBMIT_CHECKLIST', { afterStage: null })];
    expect(actionsForStage(null, withStart).map((x) => [x.type, (x as any).params.afterStage])).toEqual([['SUBMIT_CHECKLIST', null]]);
    expect(actionsForStage('WASH_IN', withStart).map((x) => x.type)).toEqual(['SUBMIT_CHECKLIST']);
  });

  it('never returns the cycle-level actions and does not mutate the tape', () => {
    const copy = [...tape];
    const all = ['WASH_IN', 'WASH_OUT', 'DRY_IN'].flatMap((s) => actionsForStage(s, tape));
    expect(all.some((x) => x.type === 'TERMINATE_CYCLE' || x.type === 'COMPLETE_CYCLE')).toBe(false);
    expect(tape).toEqual(copy);
  });
});

describe('hasActionKind', () => {
  it('reports whether a kind is on the tape', () => {
    expect(hasActionKind([a('TERMINATE_CYCLE')], 'TERMINATE_CYCLE')).toBe(true);
    expect(hasActionKind([a('TERMINATE_CYCLE')], 'COMPLETE_CYCLE')).toBe(false);
    expect(hasActionKind([], 'TERMINATE_CYCLE')).toBe(false);
  });
});

describe('getCurrentActions', () => {
  let idb: FakeIdb;
  beforeEach(() => { idb = installFakeIdb(); localStorage.removeItem('digilog_cached_user'); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('trusts a non-empty server tape as-is and never reads the offline cache', async () => {
    const server = [a('ADVANCE_TO_STAGE', { targetState: 'X' })];
    expect(await getCurrentActions('f-1', server)).toBe(server);
    expect(idb.opens).toBe(0);
  });

  it('computes the tape locally from the cached filter state when the server sent none', async () => {
    await cacheData('filter-state-f-1', {
      pipelineGraph: {
        id: 'cp-2', lineageId: 'lin-2', name: 'Plain', flowMode: 'SEQUENTIAL', version: 2, status: 'ACTIVE', cleaningReasons: {},
        stages: [
          { id: 'n-start', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
          { id: 'n-wash-in', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 1 },
          { id: 'n-wash-out', stateKey: 'WASH_OUT', nodeType: 'STAGE', configuration: {}, sortOrder: 2 },
          { id: 'n-end', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 3 },
        ],
        connections: [
          { fromStageId: 'n-start', toStageId: 'n-wash-in' },
          { fromStageId: 'n-wash-in', toStageId: 'n-wash-out' },
          { fromStageId: 'n-wash-out', toStageId: 'n-end' },
        ],
      },
      currentState: 'WASH_IN',
      currentCycle: { id: 'cyc-1', status: 'IN_PROGRESS', profileId: 'cp-2', profileVersion: 2 },
    });
    for (const server of [undefined, null, []]) {
      const tape = await getCurrentActions('f-1', server);
      expect(actionsForStage('WASH_OUT', tape).map((x) => x.type)).toContain('ADVANCE_TO_STAGE');
      expect(tape[tape.length - 1].type).toBe('TERMINATE_CYCLE');
    }
  });

  it('a filter with nothing cached gets no stage-advance actions', async () => {
    const tape = await getCurrentActions('never-seen');
    expect(tape.filter((x) => x.type === 'ADVANCE_TO_STAGE')).toEqual([]);
  });
});
