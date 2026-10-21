import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * local-context.ts — the projection defaults and fallbacks the existing
 * local-context*.test.ts files leave open: missing fields on every cached
 * slice, the v5 sync-store fallbacks for profile and checklist, filter-row
 * fallbacks, and the cached-user readers.
 *
 * Boundary: the three IDB readers in `../offline-store` (same as
 * local-context.test.ts). Storage is real jsdom localStorage.
 */
vi.mock('../offline-store', () => ({
  getCachedData: vi.fn(),
  getCachedEntity: vi.fn(),
  getCachedFilters: vi.fn(),
}));

import { loadLocalContextFromCache, readCachedUserIdentity } from '../local-context';
import { getCachedData, getCachedEntity, getCachedFilters } from '../offline-store';

const data = vi.mocked(getCachedData);
const entity = vi.mocked(getCachedEntity);
const filters = vi.mocked(getCachedFilters);

function cache(state: Record<string, unknown> | null, filterRows: any[] = [], entities: Record<string, any> = {}) {
  data.mockImplementation(async (key: string) => (key === 'filter-state-f-1' ? state : null) as any);
  filters.mockResolvedValue(filterRows as any);
  entity.mockImplementation(async (store: string, id: string) => (entities[`${store}:${id}`] ?? null) as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => { localStorage.clear(); });

describe('profile projection', () => {
  it('inline graph with only stages/connections → every profile field takes its default; node fields default too', async () => {
    cache({
      pipelineGraph: {
        stages: [{ id: 'n1', nodeType: 'START' }],
        connections: [{ fromStageId: 'n1', toStageId: 'n2', extra: 'ignored' }],
      },
    });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.profile).toEqual({
      id: '', lineageId: '', name: '', flowMode: 'SEQUENTIAL', version: 0, status: 'ACTIVE', cleaningReasons: {},
      nodes: [{ id: 'n1', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 }],
      edges: [{ fromStageId: 'n1', toStageId: 'n2' }],
    });
    expect(entity).not.toHaveBeenCalled();
  });

  it('a graph missing `connections` is NOT used; the cycle profileId falls back to the v5 sync store', async () => {
    cache(
      { pipelineGraph: { stages: [{ id: 'x' }] }, currentCycle: { id: 'c-1', profileId: 'cp-9' } },
      [],
      { 'syncFilterCleaningProfiles:cp-9': { id: 'cp-9' } },
    );
    const ctx = await loadLocalContextFromCache('f-1');
    expect(entity).toHaveBeenCalledWith('syncFilterCleaningProfiles', 'cp-9');
    expect(ctx.profile).toEqual({
      id: 'cp-9', lineageId: '', name: '', flowMode: 'SEQUENTIAL', version: 0, status: 'ACTIVE', cleaningReasons: {}, nodes: [], edges: [],
    });
  });

  it('sync-store row with full fields is projected as-is', async () => {
    cache(
      { currentCycle: { id: 'c-1', profileId: 'cp-9' } },
      [],
      {
        'syncFilterCleaningProfiles:cp-9': {
          id: 'cp-9', lineageId: 'lin', name: 'Dry storage', flowMode: 'PARALLEL', version: 4, status: 'ARCHIVED',
          cleaningReasons: { PM: 'PM' },
          stages: [{ id: 's', stateKey: 'DRY_IN', nodeType: 'STAGE', configuration: { a: 1 }, sortOrder: 2 }],
          connections: [{ fromStageId: 's', toStageId: 'e' }],
        },
      },
    );
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.profile).toMatchObject({ id: 'cp-9', lineageId: 'lin', name: 'Dry storage', flowMode: 'PARALLEL', version: 4, status: 'ARCHIVED', cleaningReasons: { PM: 'PM' } });
    expect(ctx.profile.nodes).toEqual([{ id: 's', stateKey: 'DRY_IN', nodeType: 'STAGE', configuration: { a: 1 }, sortOrder: 2 }]);
    // Cycle pins default to the resolved profile when the cached cycle has none.
    expect(ctx.cycle.profileId).toBe('cp-9');
    expect(ctx.cycle.profileVersion).toBe(4);
  });

  it('profileId known but not in the sync store → INACTIVE sentinel (guards reject cleanly)', async () => {
    cache({ currentCycle: { id: 'c-1', profileId: 'gone' } });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.profile).toMatchObject({ id: '', status: 'INACTIVE', nodes: [], edges: [] });
    expect(ctx.stageLookup).toEqual({});
  });
});

describe('cycle projection', () => {
  it('a cached cycle with no fields gets IN_PROGRESS and safe defaults', async () => {
    cache({ currentCycle: {} });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.cycle).toEqual({
      id: '', cycleCode: '', filterId: '', profileId: '', profileVersion: 0, status: 'IN_PROGRESS',
      cleaningAreaId: null, equipmentGroupId: null, equipmentGroupVersionPin: null, checklistVersionPins: null,
      dryerStartedAt: null, dryerDurationMinutes: null, dryerReadingsSubmitted: false,
      cleaningReasonKey: '', cleaningReasonLabel: '', startedAt: new Date(0), completedAt: null, terminatedAt: null,
    });
  });

  it('a fully populated cached cycle is carried through', async () => {
    const startedAt = '2026-10-21T06:00:00.000Z';
    cache({
      currentCycle: {
        id: 'c-1', cycleCode: 'CC-1', filterId: 'f-1', profileId: 'p', profileVersion: 2, status: 'COMPLETED',
        cleaningAreaId: 'a', equipmentGroupId: 'eg', equipmentGroupVersionPin: 3, checklistVersionPins: { cl: 1 },
        cleaningReasonKey: 'PM', cleaningReasonLabel: 'Preventive', startedAt, completedAt: 'x', terminatedAt: 'y',
      },
    });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.cycle).toMatchObject({
      id: 'c-1', cycleCode: 'CC-1', status: 'COMPLETED', cleaningAreaId: 'a', equipmentGroupId: 'eg',
      equipmentGroupVersionPin: 3, checklistVersionPins: { cl: 1 }, cleaningReasonKey: 'PM',
      cleaningReasonLabel: 'Preventive', startedAt, completedAt: 'x', terminatedAt: 'y',
    });
  });
});

describe('filter projection', () => {
  it('falls back to the cached filter row for lifecycle state + cycle id when there is no live cycle', async () => {
    cache(null, [{ id: 'f-1', name: 'F-1', parentId: 'ahu-1', filterProfileId: 'fp', filterSet: 'A', currentLifecycleState: 'STORAGE_IN', currentCycleId: 'offline-cycle-1' }]);
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.filter).toEqual({
      id: 'f-1', name: 'F-1', parentId: 'ahu-1', filterProfileId: 'fp', currentLifecycleState: 'STORAGE_IN',
      currentCycleId: 'offline-cycle-1', filterSet: 'A', block: null, area: null, ahu: null,
    });
  });

  it('cached state wins over the filter row; an IN_PROGRESS cycle id wins; homeBlock becomes a BLOCK slice', async () => {
    cache(
      { currentState: 'WASH_IN', currentCycle: { id: 'c-live', status: 'IN_PROGRESS' }, homeBlock: { id: 'b-1', name: 'Block 1' } },
      [{ id: 'f-1', currentLifecycleState: 'STORAGE_IN', currentCycleId: 'old' }],
    );
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.filter.currentLifecycleState).toBe('WASH_IN');
    expect(ctx.filter.currentCycleId).toBe('c-live');
    expect(ctx.filter.block).toEqual({ id: 'b-1', name: 'Block 1', templateKind: 'BLOCK' });
  });

  it('no filter row and no state → empty identity, null everything', async () => {
    cache(null, []);
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.filter).toMatchObject({ id: 'f-1', name: '', parentId: null, filterProfileId: null, currentLifecycleState: null, currentCycleId: null, filterSet: null });
  });

  it('a null filters list is tolerated', async () => {
    cache(null);
    filters.mockResolvedValue(null as any);
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.filter.name).toBe('');
  });
});

describe('equipment group projection', () => {
  it('defaults every field; isActive only false when explicitly false; instrument numbers default when not numbers', async () => {
    cache({
      equipmentGroup: {
        isActive: false,
        instruments: [
          { id: 'i-1', operatingMin: '5', operatingMax: null, leastCount: 'x' },
          { id: 'i-2', instrumentId: 'PG-7', description: 'RO pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 4, leastCount: 0.1, sortOrder: 2 },
        ],
      },
    });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.equipmentGroup).toEqual({
      id: '', name: '', blockId: '', isActive: false, version: 0,
      instruments: [
        { id: 'i-1', instrumentId: 'i-1', description: '', stageKey: null, uom: null, operatingMin: 0, operatingMax: 0, leastCount: 1, sortOrder: 0 },
        { id: 'i-2', instrumentId: 'PG-7', description: 'RO pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 4, leastCount: 0.1, sortOrder: 2 },
      ],
    });
  });

  it('missing instruments list → [] and isActive defaults to true', async () => {
    cache({ equipmentGroup: { id: 'eg', name: 'EG', blockId: 'b', version: 3 } });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.equipmentGroup).toEqual({ id: 'eg', name: 'EG', blockId: 'b', isActive: true, version: 3, instruments: [] });
  });
});

describe('checklist profile resolution', () => {
  it('pending entry with no checklistProfileId → null', async () => {
    cache({ pendingChecklist: [{ questions: [{ id: 'q' }] }] });
    expect((await loadLocalContextFromCache('f-1')).checklistProfile).toBeNull();
  });

  it('inline questions: defaults for name/version and per-question fields; sortOrder falls back to index', async () => {
    cache({
      pendingChecklist: [{
        checklistProfileId: 'cl-1',
        questions: [
          { id: 'q1', question: 'Visual OK?', questionType: 'YES_NO' },
          { id: 'q2', question: 'Pressure', questionType: 'NUMBER', required: 1, section: 'S', description: 'd', options: ['a'], validation: { min: 1 }, sortOrder: 9 },
        ],
      }],
    });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.checklistProfile).toEqual({
      id: 'cl-1', name: '', isActive: true, version: 0,
      questions: [
        { id: 'q1', question: 'Visual OK?', questionType: 'YES_NO', required: false, section: null, description: null, options: [], validation: {}, sortOrder: 0 },
        { id: 'q2', question: 'Pressure', questionType: 'NUMBER', required: true, section: 'S', description: 'd', options: ['a'], validation: { min: 1 }, sortOrder: 9 },
      ],
    });
  });

  it('inline name/version are used when present', async () => {
    cache({ pendingChecklist: [{ checklistProfileId: 'cl-1', checklistProfileName: 'Wash', profileVersion: 5, questions: [{ id: 'q' }] }] });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.checklistProfile).toMatchObject({ name: 'Wash', version: 5 });
  });

  it('no inline questions → v5 sync store row, with defaults', async () => {
    cache(
      { pendingChecklist: [{ checklistProfileId: 'cl-2', questions: [] }] },
      [],
      { 'syncChecklistProfiles:cl-2': { id: 'cl-2', isActive: false, questions: [{ id: 'q', question: 'Q', questionType: 'TEXT' }] } },
    );
    const ctx = await loadLocalContextFromCache('f-1');
    expect(entity).toHaveBeenCalledWith('syncChecklistProfiles', 'cl-2');
    expect(ctx.checklistProfile).toEqual({
      id: 'cl-2', name: '', isActive: false, version: 0,
      questions: [{ id: 'q', question: 'Q', questionType: 'TEXT', required: false, section: null, description: null, options: [], validation: {}, sortOrder: 0 }],
    });
  });

  it('sync-store row without a questions array → empty questions; named/versioned row keeps its values', async () => {
    cache(
      { pendingChecklist: [{ checklistProfileId: 'cl-3' }] },
      [],
      { 'syncChecklistProfiles:cl-3': { id: 'cl-3', name: 'Dry', version: 2 } },
    );
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.checklistProfile).toEqual({ id: 'cl-3', name: 'Dry', isActive: true, version: 2, questions: [] });
  });

  it('not inline and not in the sync store → null', async () => {
    cache({ pendingChecklist: [{ checklistProfileId: 'cl-missing' }] });
    expect((await loadLocalContextFromCache('f-1')).checklistProfile).toBeNull();
  });
});

describe('event synthesis fallbacks', () => {
  const graph = {
    stages: [
      { id: 's1', stateKey: 'WASH_IN', nodeType: 'STAGE' },
      { id: 'c1', nodeType: 'CHECKLIST', configuration: {} }, // checklist node WITHOUT a profile id
      { id: 's2', stateKey: 'WASH_OUT', nodeType: 'STAGE' },
    ],
    connections: [{ fromStageId: 's1', toStageId: 'c1' }, { fromStageId: 'c1', toStageId: 's2' }],
  };

  it('a completion without a cycleId borrows the cached cycle id; without either it is null', async () => {
    cache({ currentState: 'WASH_IN', currentCycle: { id: 'c-9' }, checklistCompletions: [{ checklistProfileId: 'cl', afterStage: 'WASH_IN', completedAt: '2026-10-21T07:00:00.000Z' }] });
    let ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.events[0]).toMatchObject({ cycleId: 'c-9', eventType: 'CHECKLIST_COMPLETED', attributes: { source: 'completion-log' } });

    cache({ currentState: 'WASH_IN', checklistCompletions: [{ checklistProfileId: 'cl', afterStage: 'WASH_IN', completedAt: '2026-10-21T07:00:00.000Z' }] });
    ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.events[0].cycleId).toBeNull();
  });

  it('legacy signal: current stage not in the profile → no synthesized event', async () => {
    cache({ currentState: 'DRY_IN', pendingChecklist: [], pipelineGraph: graph });
    expect((await loadLocalContextFromCache('f-1')).events).toEqual([]);
  });

  it('legacy signal: a CHECKLIST node after the stage that names no profile does not count', async () => {
    cache({ currentState: 'WASH_IN', pendingChecklist: [], pipelineGraph: graph });
    expect((await loadLocalContextFromCache('f-1')).events).toEqual([]);
  });

  it('legacy signal with no cached cycle → synthesized event has a null cycleId', async () => {
    const withProfile = { ...graph, stages: graph.stages.map((s) => (s.id === 'c1' ? { ...s, configuration: { checklistProfileId: 'cl-1' } } : s)) };
    cache({ currentState: 'WASH_IN', pipelineGraph: withProfile });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(ctx.events).toEqual([expect.objectContaining({ id: 'synth-checklist-completed-WASH_IN', cycleId: null })]);
  });
});

describe('stageLookup resolution', () => {
  it('an EMPTY cached stageLookup is ignored in favour of building one from the profile', async () => {
    cache({
      stageLookup: {},
      pipelineGraph: {
        stages: [{ id: 's1', stateKey: 'WASH_IN', nodeType: 'STAGE' }, { id: 'e', nodeType: 'END' }],
        connections: [{ fromStageId: 's1', toStageId: 'e' }],
      },
    });
    const ctx = await loadLocalContextFromCache('f-1');
    expect(Object.keys(ctx.stageLookup)).toContain('WASH_IN');
  });

  it('disabledChecklistProfileIds that is not an array is treated as none', async () => {
    cache({ disabledChecklistProfileIds: 'cl-1' });
    expect((await loadLocalContextFromCache('f-1')).disabledChecklistProfileIds).toEqual([]);
  });
});

describe('cached user', () => {
  it('context user: role/permissions default; a non-array permissions value becomes []', async () => {
    localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-1', permissions: 'FILTER_OPERATE' }));
    cache(null);
    expect((await loadLocalContextFromCache('f-1')).user).toEqual({ id: 'u-1', role: '', permissions: [] });
  });

  it('context user: malformed JSON → empty user, never throws', async () => {
    localStorage.setItem('digilog_cached_user', '{not json');
    cache(null);
    expect((await loadLocalContextFromCache('f-1')).user).toEqual({ id: '', role: '', permissions: [] });
  });

  it('context user: a cached object missing id → empty id', async () => {
    localStorage.setItem('digilog_cached_user', JSON.stringify({ role: 'OPERATOR', permissions: ['A'] }));
    cache(null);
    expect((await loadLocalContextFromCache('f-1')).user).toEqual({ id: '', role: 'OPERATOR', permissions: ['A'] });
  });

  it.each([
    ['nothing cached', null, { userId: null, userName: null }],
    ['malformed JSON', '{oops', { userId: null, userName: null }],
    ['JSON null', 'null', { userId: null, userName: null }],
    ['empty id → null (an empty owner would match nobody and hold the op forever)', JSON.stringify({ id: '', fullName: 'X' }), { userId: null, userName: 'X' }],
    ['username fallback', JSON.stringify({ id: 'u-1', username: 'op1' }), { userId: 'u-1', userName: 'op1' }],
    ['fullName preferred', JSON.stringify({ id: 'u-1', username: 'op1', fullName: 'Op One' }), { userId: 'u-1', userName: 'Op One' }],
    ['no name at all', JSON.stringify({ id: 'u-1' }), { userId: 'u-1', userName: null }],
  ])('readCachedUserIdentity: %s', (_l, raw, expected) => {
    if (raw !== null) localStorage.setItem('digilog_cached_user', raw);
    expect(readCachedUserIdentity()).toEqual(expected);
  });
});
