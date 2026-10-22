/**
 * The checklist BEFORE the first stage (START is a position, 2026-10-22).
 *
 * A cycle that is started but has not entered its first stage sits at START
 * (currentState null). The shared executor offers the START checklist there,
 * and answers it from the CHECKLIST_COMPLETED events the loader synthesizes.
 * synthesizeEvents returned [] whenever the state was null, so a START
 * checklist answered offline was offered again forever.
 *
 * Rules:
 *   - Tier 1 (the explicit completion log) covers the START position — but only
 *     the CURRENT cycle's entries: one cycle's START answer must never count for
 *     the next cycle.
 *   - Tier 2 (the legacy "pendingChecklist is empty" signal) stays stage-only:
 *     an empty mirror never stands in for a START answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../offline-store', () => ({
  getCachedData: vi.fn(),
  getCachedEntity: vi.fn(),
  getCachedFilters: vi.fn(),
  cacheData: vi.fn().mockResolvedValue(undefined),
  updateFilterStateLocally: vi.fn().mockResolvedValue(undefined),
  clearOfflineCycleId: vi.fn().mockResolvedValue(undefined),
  OFFLINE_TTL_MS: 24 * 60 * 60 * 1000,
}));

import { computeNextActions } from '@digilog/shared';
import { loadLocalContextFromCache } from '../local-context';
import { getCachedData, getCachedEntity, getCachedFilters } from '../offline-store';

const mockGetCachedData = vi.mocked(getCachedData);
const mockGetCachedEntity = vi.mocked(getCachedEntity);
const mockGetCachedFilters = vi.mocked(getCachedFilters);

// START → CHECKLIST(cl-start) → WASH_IN → WASH_OUT → END
const stages = [
  { id: 'n-start', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
  { id: 'n-cl', stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl-start' }, sortOrder: 1 },
  { id: 'n-wi', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 2 },
  { id: 'n-wo', stateKey: 'WASH_OUT', nodeType: 'STAGE', configuration: {}, sortOrder: 3 },
  { id: 'n-end', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 4 },
];
const connections = [
  { fromStageId: 'n-start', toStageId: 'n-cl' }, { fromStageId: 'n-cl', toStageId: 'n-wi' },
  { fromStageId: 'n-wi', toStageId: 'n-wo' }, { fromStageId: 'n-wo', toStageId: 'n-end' },
];
const profile = {
  id: 'cp-1', lineageId: 'lin-1', name: 'Start-checked', flowMode: 'STRICT', version: 2, status: 'ACTIVE',
  cleaningReasons: { keys: ['ROUTINE'] }, stages, connections,
};
const startChecklist = { id: 'cl-start', name: 'Before cleaning', version: 1, isActive: true, questions: [{ id: 'q1', question: 'PPE on?', questionType: 'YES_NO', required: true }] };
const filterRow = {
  id: 'filter-1', name: 'F-1', status: 'Active', parentId: null, template: { templateKind: 'FILTER' },
  filterDetails: { filterProfileId: 'fp-1', currentLifecycleState: null, currentCycleId: 'cycle-2', filterSet: null },
};

/** The pending START checklist as the cache holds it from the server's tape. */
const START_ROW = { pipelineNodeId: 'null-cl-start', checklistProfileId: 'cl-start', checklistProfileName: 'Before cleaning', profileVersion: 1, questions: startChecklist.questions };

function atStart(over: Record<string, unknown> = {}) {
  const cachedState = {
    currentState: null,
    currentCycle: { id: 'cycle-2', status: 'IN_PROGRESS', profileId: 'cp-1', profileVersion: 2 },
    pipelineGraph: { stages, connections },
    pendingChecklist: [START_ROW],
    ...over,
  };
  // the offline sync's checklist store — what the loader reads once a submit
  // has cleared the row's pendingChecklist mirror
  mockGetCachedEntity.mockImplementation((store: string, id: string) =>
    Promise.resolve(store === 'syncChecklistProfiles' && id === 'cl-start' ? startChecklist : null) as any);
  mockGetCachedFilters.mockResolvedValue([filterRow as any]);
  mockGetCachedData.mockImplementation((key: string) => {
    if (key === 'filter-state-filter-1') return Promise.resolve(cachedState);
    if (key === 'active-profile-fp-1') return Promise.resolve({ id: 'fp-1', name: 'FP-1', isActive: true, cleaningProfile: profile, applicableTemplates: [] });
    if (key === 'checklist-profiles') return Promise.resolve([startChecklist]);
    return Promise.resolve(null);
  });
}

const tapeTypes = async () => {
  const ctx = await loadLocalContextFromCache('filter-1');
  return { ctx, types: computeNextActions(ctx!).actions.map((a) => a.type) };
};

describe('a START checklist offline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unanswered: the tape offers it (and no entry into the first stage)', async () => {
    atStart();
    const { types } = await tapeTypes();
    expect(types).toContain('SUBMIT_CHECKLIST');
    expect(types).not.toContain('ADVANCE_TO_STAGE');
  });

  it('answered on this tablet for THIS cycle: not offered again, even while the row still lists it; the first stage is', async () => {
    atStart({ checklistCompletions: [{ checklistProfileId: 'cl-start', afterStage: null, completedAt: '2026-10-22T08:00:00.000Z', cycleId: 'cycle-2' }] });
    const { ctx, types } = await tapeTypes();
    expect(ctx!.events).toEqual([expect.objectContaining({
      eventType: 'CHECKLIST_COMPLETED', cycleId: 'cycle-2',
      attributes: expect.objectContaining({ afterStage: null, checklistProfileId: 'cl-start', source: 'completion-log' }),
    })]);
    expect(types).not.toContain('SUBMIT_CHECKLIST');
    expect(types).toContain('ADVANCE_TO_STAGE');
  });

  it("a PREVIOUS cycle's START answer does not count for this one", async () => {
    atStart({ checklistCompletions: [{ checklistProfileId: 'cl-start', afterStage: null, completedAt: '2026-10-21T08:00:00.000Z', cycleId: 'cycle-1' }] });
    const { ctx, types } = await tapeTypes();
    expect(ctx!.events).toEqual([]);
    expect(types).toContain('SUBMIT_CHECKLIST');
  });

  it("a stage's completion never answers START", async () => {
    atStart({ checklistCompletions: [{ checklistProfileId: 'cl-start', afterStage: 'WASH_IN', completedAt: 't', cycleId: 'cycle-2' }] });
    const { ctx, types } = await tapeTypes();
    expect(ctx!.events).toEqual([]);
    expect(types).toContain('SUBMIT_CHECKLIST');
  });

  it('an empty pendingChecklist mirror never stands in for a START answer (the legacy signal is stage-only)', async () => {
    atStart({ pendingChecklist: [] });
    const { ctx } = await tapeTypes();
    expect(ctx!.events).toEqual([]);
  });
});
