import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installFakeIndexedDB, openAppDb, type FakeIdb } from '@/routes/filter-management/hooks/__tests__/fake-indexeddb';

/**
 * offline-cache.ts against a real store: offline-store on an in-memory
 * IndexedDB (jsdom has none; the fake replaces only the browser `indexedDB`
 * global), with the REAL local-context loader and shared executor behind
 * recomputeAndCacheFilterState. Everything is set up and read back through
 * offline-store's own API. Connectivity is mocked because offline-store
 * consults it for cache expiry.
 *
 * offline-cache.test.ts covers the failure / fail-closed rules with a mocked
 * store; this file covers the graph walks, the linear fallback, cycle
 * completion and the checklist resolution end to end.
 */
vi.mock('../connectivity', () => ({ isOnline: () => true, onConnectivityChange: () => () => {} }));

import {
  appendChecklistCompletion, resolvePendingChecklistForStage, recomputeAndCacheFilterState,
  cacheServerStateResponse, getCachedPendingChecklists,
} from '../offline-cache';
import { cacheData, getCachedData, cacheFilters, getCachedFilters } from '../offline-store';

const FID = 'f-1';
const KEY = `filter-state-${FID}`;

// START → WASH_IN → CHECKLIST(cl-1) → WASH_OUT → DRY_IN → END
const graph = {
  stages: [
    { id: 'n0', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
    { id: 'n1', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 1 },
    { id: 'c1', stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl-1' }, sortOrder: 2 },
    { id: 'n2', stateKey: 'WASH_OUT', nodeType: 'STAGE', configuration: {}, sortOrder: 3 },
    { id: 'n3', stateKey: 'DRY_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 4 },
    { id: 'n9', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 5 },
  ],
  connections: [
    { fromStageId: 'n0', toStageId: 'n1' }, { fromStageId: 'n1', toStageId: 'c1' }, { fromStageId: 'c1', toStageId: 'n2' },
    { fromStageId: 'n2', toStageId: 'n3' }, { fromStageId: 'n3', toStageId: 'n9' },
  ],
};
const clProfile = {
  id: 'cl-1', name: 'Wash checklist', version: 4, isActive: true,
  questions: [{ id: 'qb', question: 'B', sortOrder: 2 }, { id: 'qa', question: 'A', sortOrder: 1 }, { id: 'qz', question: 'Z' }],
};
const filterRow = (over: Record<string, unknown> = {}) => ({
  id: FID, name: 'F-1', templateId: 't', filterSet: null, currentLifecycleState: null, currentCycleId: null,
  attributes: {}, parentId: 'ahu-1', isActive: true, status: 'Active', ...over,
});

let fake: FakeIdb;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  fake = installFakeIndexedDB();
  await openAppDb();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('appendChecklistCompletion', () => {
  it('appends to a missing row, is idempotent on (profile, stage, cycle), and treats undefined/null cycle as the same', async () => {
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: 'WASH_IN', completedAt: 't1' });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: 'WASH_IN', completedAt: 't2', cycleId: null });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: 'WASH_IN', completedAt: 't3', cycleId: 'c-2' });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-2', afterStage: 'WASH_IN', completedAt: 't4' });
    const row = await getCachedData<any>(KEY);
    expect(row.checklistCompletions.map((c: any) => c.completedAt)).toEqual(['t1', 't3', 't4']);
  });

  // START is a position (2026-10-22): a START checklist's completion has
  // afterStage null, exactly as the server's CHECKLIST_COMPLETED row.
  it('logs a START completion (afterStage null) once per cycle, apart from a stage completion of the same checklist', async () => {
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: null, completedAt: 't1', cycleId: 'c-1' });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: null, completedAt: 't2', cycleId: 'c-1' });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: 'WASH_IN', completedAt: 't3', cycleId: 'c-1' });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: null, completedAt: 't4', cycleId: 'c-2' });
    const row = await getCachedData<any>(KEY);
    expect(row.checklistCompletions.map((c: any) => [c.completedAt, c.afterStage])).toEqual([['t1', null], ['t3', 'WASH_IN'], ['t4', null]]);
  });

  it('preserves the rest of the cached row', async () => {
    await cacheData(KEY, { currentState: 'WASH_IN', tapeVersion: 3 });
    await appendChecklistCompletion(FID, { checklistProfileId: 'cl-1', afterStage: 'WASH_IN', completedAt: 't' });
    expect(await getCachedData(KEY)).toMatchObject({ currentState: 'WASH_IN', tapeVersion: 3, checklistCompletions: [{ checklistProfileId: 'cl-1' }] });
  });
});

describe('resolvePendingChecklistForStage', () => {
  it('server stageLookup wins: resolves questions from the checklist-profiles cache, sorted by sortOrder', async () => {
    await cacheData(KEY, { stageLookup: { WASH_OUT: { pendingChecklistProfileIds: ['cl-1'] } } });
    await cacheData('checklist-profiles', [clProfile]);
    const r = await resolvePendingChecklistForStage(FID, 'WASH_OUT');
    expect(r.expectedIds).toEqual(['cl-1']);
    expect(r.checklists).toEqual([{
      pipelineNodeId: 'WASH_OUT-cl-1', checklistProfileId: 'cl-1', checklistProfileName: 'Wash checklist', profileVersion: 4,
      questions: [{ id: 'qz', question: 'Z' }, { id: 'qa', question: 'A', sortOrder: 1 }, { id: 'qb', question: 'B', sortOrder: 2 }],
    }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a disabled checklist is left out of the stageLookup answer', async () => {
    await cacheData(KEY, { stageLookup: { WASH_OUT: { pendingChecklistProfileIds: ['cl-1', 'cl-2'] } }, disabledChecklistProfileIds: ['cl-1'] });
    expect((await resolvePendingChecklistForStage(FID, 'WASH_OUT')).expectedIds).toEqual(['cl-2']);
  });

  it('no stageLookup → walks the cached graph (and honours disabled ids there too)', async () => {
    await cacheData(KEY, { pipelineGraph: graph });
    await cacheData('checklist-profiles', [clProfile]);
    let r = await resolvePendingChecklistForStage(FID, 'WASH_IN');
    expect(r.expectedIds).toEqual(['cl-1']);
    expect(r.checklists).toHaveLength(1);

    await cacheData(KEY, { pipelineGraph: graph, disabledChecklistProfileIds: ['cl-1'] });
    r = await resolvePendingChecklistForStage(FID, 'WASH_IN');
    expect(r).toEqual({ checklists: [], expectedIds: [] });
  });

  it.each([
    ['stage not in the graph', { pipelineGraph: graph }, 'STORAGE_IN'],
    ['stage with no checklist after it', { pipelineGraph: graph }, 'WASH_OUT'],
    ['no graph and no stageLookup', {}, 'WASH_IN'],
    ['graph without connections', { pipelineGraph: { stages: graph.stages } }, 'WASH_IN'],
  ])('%s → no checklist expected', async (_l, row, stage) => {
    await cacheData(KEY, row);
    expect(await resolvePendingChecklistForStage(FID, stage)).toEqual({ checklists: [], expectedIds: [] });
  });

  it('no cached row at all → no checklist expected', async () => {
    expect(await resolvePendingChecklistForStage('nope', 'WASH_IN')).toEqual({ checklists: [], expectedIds: [] });
  });

  it('an expected checklist that is inactive or not cached resolves to NO rows but still reports the expected id', async () => {
    await cacheData(KEY, { pipelineGraph: graph });
    await cacheData('checklist-profiles', [{ ...clProfile, isActive: false }]);
    expect(await resolvePendingChecklistForStage(FID, 'WASH_IN')).toEqual({ checklists: [], expectedIds: ['cl-1'] });
  });

  it('a cached profile with no questions is still returned (empty questions) and the stale cache is warned about', async () => {
    await cacheData(KEY, { pipelineGraph: graph });
    await cacheData('checklist-profiles', [{ id: 'cl-1', name: 'Wash', version: 1 }]);
    const r = await resolvePendingChecklistForStage(FID, 'WASH_IN');
    expect(r.checklists[0].questions).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[offline-cache] checklist profile cached without questions', 'cl-1');
  });
});

describe('recomputeAndCacheFilterState — graph data', () => {
  it('advance into a stage with a checklist after it: pending checklist set, no advance targets, tape recomputed', async () => {
    await cacheFilters([filterRow({ currentLifecycleState: null })] as any);
    await cacheData(KEY, { pipelineGraph: graph, currentCycle: { id: 'c-1', status: 'IN_PROGRESS' }, checklistCompletions: [{ checklistProfileId: 'x', afterStage: 'Y', completedAt: 't' }] });
    await cacheData('checklist-profiles', [clProfile]);
    await recomputeAndCacheFilterState(FID, 'WASH_IN', false);
    const row = await getCachedData<any>(KEY);
    expect(row.currentState).toBe('WASH_IN');
    expect(row.nextAllowedStages).toEqual([]);
    expect(row.pendingChecklist.map((c: any) => c.checklistProfileId)).toEqual(['cl-1']);
    expect(row.currentCycle).toEqual({ id: 'c-1', status: 'IN_PROGRESS' });
    expect(row.checklistCompletions).toHaveLength(1);       // preserved mid-cycle
    expect(Array.isArray(row.actions)).toBe(true);
    expect(row.actions.some((a: any) => a.type === 'SUBMIT_CHECKLIST')).toBe(true);
    expect(typeof row.tapeVersion).toBe('number');
    expect((await getCachedFilters())[0].currentLifecycleState).toBe('WASH_IN');
  });

  it('mid-pipeline with no checklist: next allowed = the reachable stages from the graph', async () => {
    await cacheFilters([filterRow()] as any);
    await cacheData(KEY, { pipelineGraph: graph, currentCycle: { id: 'c-1', status: 'IN_PROGRESS' } });
    await recomputeAndCacheFilterState(FID, 'WASH_OUT', false);
    const row = await getCachedData<any>(KEY);
    expect(row.currentState).toBe('WASH_OUT');
    expect(row.nextAllowedStages).toContain('DRY_IN');
    expect(row.pendingChecklist).toEqual([]);
  });

  it('final stage with nothing after it: the cycle completes — state, cycle and completion log cleared, filter row released', async () => {
    // START → WASH_IN → END: the work of a non-Dry-In stage is done on entry.
    const washOnly = { stages: [graph.stages[0], graph.stages[1], graph.stages[5]], connections: [{ fromStageId: 'n0', toStageId: 'n1' }, { fromStageId: 'n1', toStageId: 'n9' }] };
    await cacheFilters([filterRow({ currentLifecycleState: null, currentCycleId: 'c-1' })] as any);
    await cacheData(KEY, { pipelineGraph: washOnly, currentCycle: { id: 'c-1' }, checklistCompletions: [{ checklistProfileId: 'cl-1', afterStage: 'WASH_IN', completedAt: 't' }] });
    await recomputeAndCacheFilterState(FID, 'WASH_IN', false);
    const row = await getCachedData<any>(KEY);
    expect(row).toMatchObject({ currentState: null, nextAllowedStages: [], pendingChecklist: [], currentCycle: null, checklistCompletions: [] });
    expect(row.actions).toBeUndefined(); // no tape recompute on completion
    expect((await getCachedFilters())[0]).toMatchObject({ currentCycleId: null, currentLifecycleState: null });
  });

  // Rule C (2026-10-22, shared callCompletesStageWork): a FINAL Dry In's work is
  // the dryer run, so entering it (the dryer start) must not complete the cycle —
  // the readings do. Completing at the dryer start cleared the cycle on the
  // tablet, and a re-scan then queued a new start that the server refuses.
  it('a final Dry In entered (the dryer started) does NOT complete the cycle', async () => {
    await cacheFilters([filterRow({ currentLifecycleState: 'WASH_OUT', currentCycleId: 'c-1' })] as any);
    await cacheData(KEY, { pipelineGraph: graph, currentCycle: { id: 'c-1', dryerStartedAt: '2026-10-22T08:00:00.000Z', dryerDurationMinutes: 60 } });
    await recomputeAndCacheFilterState(FID, 'DRY_IN', false);
    const row = await getCachedData<any>(KEY);
    expect(row.currentState).toBe('DRY_IN');
    expect(row.currentCycle).toMatchObject({ id: 'c-1', dryerStartedAt: '2026-10-22T08:00:00.000Z' });
    expect((await getCachedFilters())[0]).toMatchObject({ currentCycleId: 'c-1', currentLifecycleState: 'DRY_IN' });
  });

  it('a final Dry In whose readings are recorded completes the cycle', async () => {
    await cacheFilters([filterRow({ currentLifecycleState: 'DRY_IN', currentCycleId: 'c-1' })] as any);
    await cacheData(KEY, { pipelineGraph: graph, currentCycle: { id: 'c-1', dryerStartedAt: '2026-10-22T08:00:00.000Z', dryerDurationMinutes: 60, dryerReadingsSubmitted: true } });
    await recomputeAndCacheFilterState(FID, 'DRY_IN', false);
    expect(await getCachedData<any>(KEY)).toMatchObject({ currentState: null, currentCycle: null });
    expect((await getCachedFilters())[0]).toMatchObject({ currentCycleId: null, currentLifecycleState: null });
  });

  it('a stage not in the graph (stale profile) has no targets but does not complete a cycle that was just started', async () => {
    await cacheFilters([filterRow()] as any);
    await cacheData(KEY, { pipelineGraph: graph });
    await recomputeAndCacheFilterState(FID, 'STORAGE_IN', true, 'block-7');
    const row = await getCachedData<any>(KEY);
    expect(row.currentState).toBe('STORAGE_IN');
    expect(row.currentCycle).toMatchObject({ status: 'IN_PROGRESS', cleaningAreaId: 'block-7' });
    expect(row.currentCycle.id).toMatch(/^offline-\d+$/);
    expect((await getCachedFilters())[0].currentCycleId).toMatch(/^offline-cycle-\d+$/);
  });

  it('checklist expected but its questions are not cached: parked at the stage (not completed) and warned', async () => {
    await cacheFilters([filterRow()] as any);
    await cacheData(KEY, { pipelineGraph: graph, currentCycle: { id: 'c-1' } });
    await recomputeAndCacheFilterState(FID, 'WASH_IN', false);
    const row = await getCachedData<any>(KEY);
    expect(row).toMatchObject({ currentState: 'WASH_IN', nextAllowedStages: [], pendingChecklist: [], currentCycle: { id: 'c-1' } });
    expect(warn).toHaveBeenCalledWith(
      '[offline-cache] checklist gate unresolved offline for', FID, 'at', 'WASH_IN',
      '— parked (needs online sync to load checklist questions). expected profiles:', ['cl-1'],
    );
  });
});

describe('recomputeAndCacheFilterState — linear pipeline fallback (no graph)', () => {
  const pipelineStages = [
    { stateKey: 'DRY_IN', sortOrder: 3 }, { stateKey: 'WASH_IN', sortOrder: 1 }, { stateKey: null, sortOrder: 0 }, { stateKey: 'WASH_OUT' },
  ];

  it('next allowed = the next stage by sortOrder (missing sortOrder counts as 0)', async () => {
    await cacheFilters([filterRow()] as any);
    await cacheData(KEY, { pipelineStages, currentCycle: { id: 'c-1' } });
    await recomputeAndCacheFilterState(FID, 'WASH_OUT', false);
    expect((await getCachedData<any>(KEY)).nextAllowedStages).toEqual(['WASH_IN']);
  });

  it('the last stage of a linear pipeline completes the cycle — a last Dry In only once its readings are in', async () => {
    await cacheFilters([filterRow({ currentCycleId: 'c-1' })] as any);
    await cacheData(KEY, { pipelineStages, currentCycle: { id: 'c-1' } });
    await recomputeAndCacheFilterState(FID, 'DRY_IN', false); // the dryer start
    expect(await getCachedData<any>(KEY)).toMatchObject({ currentState: 'DRY_IN', currentCycle: { id: 'c-1' } });
    await cacheData(KEY, { pipelineStages, currentCycle: { id: 'c-1', dryerReadingsSubmitted: true } });
    await recomputeAndCacheFilterState(FID, 'DRY_IN', false); // the readings
    expect(await getCachedData<any>(KEY)).toMatchObject({ currentState: null, currentCycle: null });
  });

  it('no pipeline data at all: never completes; with no cycle and not starting one, currentCycle stays null', async () => {
    await cacheFilters([filterRow()] as any);
    await recomputeAndCacheFilterState(FID, 'WASH_IN', false);
    expect(await getCachedData<any>(KEY)).toMatchObject({ currentState: 'WASH_IN', nextAllowedStages: [], currentCycle: null });
  });

  it('a cycle started with no block id stores a null cleaning area', async () => {
    await cacheFilters([filterRow()] as any);
    await recomputeAndCacheFilterState(FID, 'WASH_IN', true);
    expect((await getCachedData<any>(KEY)).currentCycle.cleaningAreaId).toBeNull();
  });
});

describe('recomputeAndCacheFilterState — failure is loud', () => {
  it('a store failure is logged and rethrown as OFFLINE_CACHE_RECOMPUTE_FAILED', async () => {
    fake.dbs.get('digilog-offline')!.stores.delete('filters');
    await expect(recomputeAndCacheFilterState(FID, 'WASH_IN', false)).rejects.toMatchObject({ code: 'OFFLINE_CACHE_RECOMPUTE_FAILED' });
    expect(error).toHaveBeenCalledWith('[offline-cache] recomputeAndCacheFilterState failed for', FID, expect.stringContaining('NotFoundError'));
  });
});

describe('cacheServerStateResponse', () => {
  it('writes every field with defaults for the ones the server left out', async () => {
    await cacheServerStateResponse(FID, {});
    expect(await getCachedData(KEY)).toEqual({
      currentState: null, equipmentGroup: null, blockEquipmentGroups: [], pendingChecklist: [], pipelineStages: [],
      pipelineGraph: null, stageLookup: null, disabledChecklistProfileIds: [], nextAllowedStages: [], isPmDue: false,
      pmReasonKey: null, currentCycle: null, homeBlock: null, blockChangeStatus: null, actions: null, tapeVersion: null,
      profileSyncWarning: null, equipmentGroupSyncWarning: null,
    });
  });

  // The tablet's non-blocking "profile / equipment group changed" notices read
  // these off the cached row (2ceed59) — dropped here, they never showed from
  // a row cached by the page itself.
  it('keeps the profile and equipment-group sync warnings', async () => {
    const ps = { cycleProfileId: 'cp-1', cycleProfileName: 'Old', expectedProfileId: 'cp-2', expectedProfileName: 'New', recommendation: 'TERMINATE_AND_RESTART' };
    const eg = { groupId: 'eg-1', pinnedVersion: 2, liveVersion: 3, recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART' };
    await cacheServerStateResponse(FID, { currentState: 'WASH_IN', profileSyncWarning: ps, equipmentGroupSyncWarning: eg });
    expect(await getCachedData(KEY)).toMatchObject({ profileSyncWarning: ps, equipmentGroupSyncWarning: eg });
  });

  it('derives a START checklist (afterStage null) from the tape with the START-<id> key', async () => {
    await cacheServerStateResponse(FID, {
      currentState: null,
      actions: [{ type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Before', blocking: true, params: { checklistProfileId: 'cl-s', versionPin: 1, afterStage: null, questions: [] } }] as any,
    });
    expect((await getCachedData<any>(KEY)).pendingChecklist).toEqual([
      { pipelineNodeId: 'START-cl-s', checklistProfileId: 'cl-s', checklistProfileName: 'Before', profileVersion: 1, questions: [] },
    ]);
  });

  it('keeps a server-sent pendingChecklist; otherwise derives it from the tape (label without the prefix is used as-is)', async () => {
    await cacheServerStateResponse(FID, { pendingChecklist: [{ checklistProfileId: 'srv' }], actions: [] });
    expect((await getCachedData<any>(KEY)).pendingChecklist).toEqual([{ checklistProfileId: 'srv' }]);

    await cacheServerStateResponse(FID, {
      currentState: 'WASH_IN', tapeVersion: 8,
      actions: [{ type: 'SUBMIT_CHECKLIST', label: 'Wash', blocking: true, params: { checklistProfileId: 'cl-1', versionPin: 2, afterStage: 'WASH_IN', questions: [] } }] as any,
    });
    const row = await getCachedData<any>(KEY);
    expect(row.pendingChecklist).toEqual([{ pipelineNodeId: 'WASH_IN-cl-1', checklistProfileId: 'cl-1', checklistProfileName: 'Wash', profileVersion: 2, questions: [] }]);
    expect(row.tapeVersion).toBe(8);
  });

  it('honours an explicit TTL (an already-expired row reads back as null while online)', async () => {
    await cacheServerStateResponse(FID, { currentState: 'X' }, -1);
    expect(await getCachedData(KEY)).toBeNull();
  });
});

describe('getCachedPendingChecklists', () => {
  it.each([
    ['no row', null],
    ['no pendingChecklist field', { currentState: 'X' }],
    ['a non-array pendingChecklist', { pendingChecklist: { a: 1 } }],
  ])('%s → []', async (_l, row) => {
    if (row) await cacheData(KEY, row);
    expect(await getCachedPendingChecklists(FID)).toEqual([]);
  });

  it('normalises every row to carry a questions array (old cache shapes crashed the dialog)', async () => {
    await cacheData(KEY, { pendingChecklist: [{ checklistProfileId: 'a' }, { checklistProfileId: 'b', questions: [{ id: 'q' }] }, null] });
    expect(await getCachedPendingChecklists(FID)).toEqual([
      { checklistProfileId: 'a', questions: [] },
      { checklistProfileId: 'b', questions: [{ id: 'q' }] },
      { questions: [] },
    ]);
  });
});
