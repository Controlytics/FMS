import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Phase 8.0 — parity harness.
 *
 * Runs getCurrentState() with TAPE_PARALLEL=true and asserts the action tape
 * (`actions[]`) is internally consistent with the existing `nextAllowedStages`
 * + `pendingChecklist` fields on the SAME response. This is the regression
 * gate for Phase 8.4 cutover: when parity holds across all fixtures, we can
 * flip the flag and let the FE consume only the tape.
 *
 * Mocking pattern follows B7.3's get-current-state.test.ts: prisma is mocked
 * directly via vi.hoisted; getProfilePipeline is replaced on the instance.
 */

const { mockPrisma, mockAuditLog } = vi.hoisted(() => ({
  mockPrisma: {
    assetInstance: { findFirst: vi.fn(), findUnique: vi.fn() },
    cleaningCycle: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    equipmentGroup: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    equipmentGroupVersion: { findUnique: vi.fn() },
    filterCleaningProfile: { findUnique: vi.fn() },
    filterProfile: { findUnique: vi.fn() },
    filterEvent: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    checklistProfile: { findMany: vi.fn() },
    checklistProfileVersion: { findMany: vi.fn() },
    pmScheduleEntry: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
  mockAuditLog: vi.fn(),
}));

vi.mock('../../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));

import { FilterOperationsService } from '../../filter-operations.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

const FILTER_ID = 'filter-1';
const CYCLE_ID = 'cycle-1';
const GROUP_ID = 'group-1';
const PROFILE_ID = 'profile-1';

// ── pipeline-graph fixture builders ───────────────────────────────────────

let nextId = 0;
const id = () => `node-${++nextId}`;

interface FxStage { id: string; stateKey: string | null; nodeType: string; sortOrder: number; configuration: any; profileId: string }
interface FxConn { fromStageId: string; toStageId: string; profileId: string }

function pipeline(name: 'simple' | 'with-checklist' | 'last-stage') {
  nextId = 0;
  if (name === 'simple') {
    // START → WASH_IN → DRY_IN → END
    const start: FxStage = { id: id(), stateKey: null, nodeType: 'START', sortOrder: 0, configuration: {}, profileId: PROFILE_ID };
    const wash: FxStage = { id: id(), stateKey: 'WASH_IN', nodeType: 'STAGE', sortOrder: 1, configuration: {}, profileId: PROFILE_ID };
    const dry: FxStage = { id: id(), stateKey: 'DRY_IN', nodeType: 'STAGE', sortOrder: 2, configuration: {}, profileId: PROFILE_ID };
    const end: FxStage = { id: id(), stateKey: null, nodeType: 'END', sortOrder: 3, configuration: {}, profileId: PROFILE_ID };
    const stages = [start, wash, dry, end];
    const connections: FxConn[] = [
      { fromStageId: start.id, toStageId: wash.id, profileId: PROFILE_ID },
      { fromStageId: wash.id, toStageId: dry.id, profileId: PROFILE_ID },
      { fromStageId: dry.id, toStageId: end.id, profileId: PROFILE_ID },
    ];
    return { stages, connections };
  }
  if (name === 'with-checklist') {
    // START → WASH_IN → CHECKLIST → WASH_OUT → END
    const start: FxStage = { id: id(), stateKey: null, nodeType: 'START', sortOrder: 0, configuration: {}, profileId: PROFILE_ID };
    const wash: FxStage = { id: id(), stateKey: 'WASH_IN', nodeType: 'STAGE', sortOrder: 1, configuration: {}, profileId: PROFILE_ID };
    const cl: FxStage = { id: id(), stateKey: null, nodeType: 'CHECKLIST', sortOrder: 2, configuration: { checklistProfileId: 'cl-1' }, profileId: PROFILE_ID };
    const out: FxStage = { id: id(), stateKey: 'WASH_OUT', nodeType: 'STAGE', sortOrder: 3, configuration: {}, profileId: PROFILE_ID };
    const end: FxStage = { id: id(), stateKey: null, nodeType: 'END', sortOrder: 4, configuration: {}, profileId: PROFILE_ID };
    const stages = [start, wash, cl, out, end];
    const connections: FxConn[] = [
      { fromStageId: start.id, toStageId: wash.id, profileId: PROFILE_ID },
      { fromStageId: wash.id, toStageId: cl.id, profileId: PROFILE_ID },
      { fromStageId: cl.id, toStageId: out.id, profileId: PROFILE_ID },
      { fromStageId: out.id, toStageId: end.id, profileId: PROFILE_ID },
    ];
    return { stages, connections };
  }
  // last-stage: START → ONLY → END (in ONLY → next is END)
  const start: FxStage = { id: id(), stateKey: null, nodeType: 'START', sortOrder: 0, configuration: {}, profileId: PROFILE_ID };
  const only: FxStage = { id: id(), stateKey: 'ONLY', nodeType: 'STAGE', sortOrder: 1, configuration: {}, profileId: PROFILE_ID };
  const end: FxStage = { id: id(), stateKey: null, nodeType: 'END', sortOrder: 2, configuration: {}, profileId: PROFILE_ID };
  return {
    stages: [start, only, end],
    connections: [
      { fromStageId: start.id, toStageId: only.id, profileId: PROFILE_ID },
      { fromStageId: only.id, toStageId: end.id, profileId: PROFILE_ID },
    ],
  };
}

function filter(currentState: string | null) {
  return {
    id: FILTER_ID, name: 'F-001', parentId: 'parent-1',
    template: { templateKind: 'FILTER' },
    filterDetails: {
      filterProfileId: PROFILE_ID, currentLifecycleState: currentState,
      currentCycleId: CYCLE_ID, filterSet: 'A',
    },
  };
}

function cycle(overrides: any = {}) {
  return {
    id: CYCLE_ID,
    filterId: FILTER_ID,
    profileId: PROFILE_ID,
    profileVersion: 3,
    status: 'IN_PROGRESS',
    cleaningAreaId: 'block-1',
    equipmentGroupId: GROUP_ID,
    equipmentGroupVersionPin: null,
    checklistVersionPins: null,
    dryerStartedAt: null,
    dryerDurationMinutes: null,
    dryerReadingsSubmitted: false,
    ...overrides,
  };
}

function setupReads(opts: { currentState: string | null; pipelineName: 'simple' | 'with-checklist' | 'last-stage'; cycleOverrides?: any; flowMode?: string; checklistAnswered?: boolean; equipmentInstruments?: any[]; resolvedChecklistProfile?: any }) {
  const { stages, connections } = pipeline(opts.pipelineName);
  mockPrisma.assetInstance.findFirst.mockResolvedValue(filter(opts.currentState));
  mockPrisma.assetInstance.findUnique.mockImplementation(async (args: any) => {
    if (args.where?.id === FILTER_ID) return { id: FILTER_ID, name: 'F-001', parentId: 'parent-1', template: { templateKind: 'FILTER' } };
    if (args.where?.id === 'parent-1') return { id: 'parent-1', name: 'AHU-1', parentId: null, template: { templateKind: 'AHU' } };
    return null;
  });
  mockPrisma.cleaningCycle.findUnique.mockResolvedValue(cycle(opts.cycleOverrides ?? {}));
  mockPrisma.cleaningCycle.count.mockResolvedValue(0);
  mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
  mockPrisma.pmScheduleEntry.findFirst.mockResolvedValue(null);
  mockPrisma.filterEvent.findFirst.mockResolvedValue(opts.checklistAnswered ? { id: 'evt-1' } : null);
  mockPrisma.filterEvent.findMany.mockResolvedValue(
    opts.checklistAnswered && opts.currentState
      ? [{ eventType: 'CHECKLIST_COMPLETED', attributes: { afterStage: opts.currentState } }]
      : [],
  );
  mockPrisma.filterEvent.count.mockResolvedValue(0);
  mockPrisma.filterProfile.findUnique.mockResolvedValue(null);
  mockPrisma.filterCleaningProfile.findUnique.mockResolvedValue({
    id: PROFILE_ID, name: 'Test Profile', flowMode: opts.flowMode ?? 'SEQUENTIAL', status: 'ACTIVE',
    stages, connections,
  });
  mockPrisma.equipmentGroup.findUnique.mockResolvedValue({
    id: GROUP_ID, name: 'eq', blockId: 'block-1', isActive: true, version: 1,
    instruments: opts.equipmentInstruments ?? [],
  });
  mockPrisma.equipmentGroup.findFirst.mockResolvedValue(null);
  mockPrisma.equipmentGroup.findMany.mockResolvedValue([]);
  mockPrisma.equipmentGroupVersion.findUnique.mockResolvedValue(null);
  mockPrisma.checklistProfile.findMany.mockResolvedValue(
    opts.resolvedChecklistProfile
      ? [opts.resolvedChecklistProfile]
      : [],
  );
  mockPrisma.checklistProfileVersion.findMany.mockResolvedValue([]);
}

// ── parity tests ──────────────────────────────────────────────────────────

describe('Phase 8.0 — tape vs getCurrentState() parity (TAPE_PARALLEL=true)', () => {
  let prevFlag: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    prevFlag = process.env.TAPE_PARALLEL;
    process.env.TAPE_PARALLEL = 'true';
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env.TAPE_PARALLEL;
    else process.env.TAPE_PARALLEL = prevFlag;
  });

  it("p1. fresh cycle, no current state → tape's ADVANCE_TO_STAGE.targetState === nextAllowedStages[0]", async () => {
    setupReads({ currentState: null, pipelineName: 'simple' });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);

    expect(state.nextAllowedStages).toEqual(['WASH_IN']);
    expect(state.actions).toBeDefined();
    expect(state.tapeVersion).toBeDefined();

    const advances = state.actions.filter((a: any) => a.type === 'ADVANCE_TO_STAGE');
    expect(advances.map((a: any) => a.params.targetState)).toEqual(state.nextAllowedStages);
  });

  it('p2. in WASH_IN with checklist pending → no ADVANCE in tape, SUBMIT_CHECKLIST emitted, getCurrentState pendingChecklist non-empty', async () => {
    setupReads({
      currentState: 'WASH_IN',
      pipelineName: 'with-checklist',
      resolvedChecklistProfile: {
        id: 'cl-1', name: 'Wash QA', version: 4,
        questions: [{ id: 'q1', question: 'Tank empty?', questionType: 'YES_NO', required: true, section: null, description: null, options: [], validation: {}, sortOrder: 0 }],
      },
    });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);

    // Old shape: pendingChecklist present, nextAllowedStages empty (gate active).
    expect(state.pendingChecklist.length).toBeGreaterThan(0);
    expect(state.nextAllowedStages).toEqual([]);

    // Tape: SUBMIT_CHECKLIST present, no ADVANCE_TO_STAGE.
    const submits = state.actions.filter((a: any) => a.type === 'SUBMIT_CHECKLIST');
    expect(submits).toHaveLength(state.pendingChecklist.length);
    expect(submits[0].params.checklistProfileId).toBe(state.pendingChecklist[0].checklistProfileId);
    expect(submits[0].params.afterStage).toBe('WASH_IN');
    expect(state.actions.some((a: any) => a.type === 'ADVANCE_TO_STAGE')).toBe(false);
  });

  it('p3. in WASH_IN, checklist already answered → tape ADVANCE_TO_STAGE matches nextAllowedStages', async () => {
    setupReads({
      currentState: 'WASH_IN',
      pipelineName: 'with-checklist',
      checklistAnswered: true,
    });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);

    expect(state.pendingChecklist).toEqual([]);
    expect(state.nextAllowedStages).toEqual(['WASH_OUT']);

    const adv = state.actions.find((a: any) => a.type === 'ADVANCE_TO_STAGE');
    expect(adv.params.targetState).toBe('WASH_OUT');
  });

  it('p4. ADVANCE_TO_STAGE flags requiresInstrumentReadings when target stage has equipment instruments', async () => {
    setupReads({
      currentState: null,
      pipelineName: 'simple',
      equipmentInstruments: [
        { id: 'ins-1', description: 'Pressure', stageKey: 'WASH_IN', operatingMin: 5, operatingMax: 15, sortOrder: 0 },
      ],
    });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);
    const adv = state.actions.find((a: any) => a.type === 'ADVANCE_TO_STAGE' && a.params.targetState === 'WASH_IN');
    expect(adv.params.requiresInstrumentReadings).toEqual(['ins-1']);
    expect(adv.validations.operatingRanges).toEqual({ 'ins-1': { min: 5, max: 15 } });
  });

  it("p5. last STAGE → END → tape emits COMPLETE_CYCLE, old nextAllowedStages is empty (advance() throws CYCLE_COMPLETE)", async () => {
    setupReads({ currentState: 'ONLY', pipelineName: 'last-stage' });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);

    // Old shape: no STAGE follows; nextAllowedStages = [].
    expect(state.nextAllowedStages).toEqual([]);

    // Tape: COMPLETE_CYCLE explicit.
    expect(state.actions.some((a: any) => a.type === 'COMPLETE_CYCLE')).toBe(true);
  });

  it('p6. flag OFF → response has NO actions / tapeVersion (default behavior preserved)', async () => {
    delete process.env.TAPE_PARALLEL;
    setupReads({ currentState: null, pipelineName: 'simple' });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);

    expect(state.actions).toBeUndefined();
    expect(state.tapeVersion).toBeUndefined();
    // Existing fields still present.
    expect(state.nextAllowedStages).toEqual(['WASH_IN']);
    expect(state.stageLookup).toBeDefined();
  });

  it('p7. TERMINATE_CYCLE always present while cycle in progress', async () => {
    setupReads({ currentState: 'WASH_IN', pipelineName: 'simple' });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);
    expect(state.actions.some((a: any) => a.type === 'TERMINATE_CYCLE')).toBe(true);
    const term = state.actions.find((a: any) => a.type === 'TERMINATE_CYCLE');
    expect(term.requiresJustification).toEqual({ minLength: 10 });
  });

  it('p8. tapeVersion derives from cycle.profileVersion (smoke check)', async () => {
    setupReads({ currentState: null, pipelineName: 'simple', cycleOverrides: { profileVersion: 7 } });
    const state = await new FilterOperationsService().getCurrentState(ctx, FILTER_ID);
    // 7 * 1000 + 0 events = 7000.
    expect(state.tapeVersion).toBe(7000);
  });
});
