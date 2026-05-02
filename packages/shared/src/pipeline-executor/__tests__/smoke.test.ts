/**
 * Pipeline-executor smoke tests (Phase 8.4c).
 *
 * Scope: scaffold-level only. Verify
 *   1. LocalContext type compiles against a realistic fixture (catches
 *      shape regressions before Phase 8.5 starts filling in guards).
 *   2. Every guard / loader stub throws with the documented
 *      `NOT_IMPLEMENTED` prefix so Phase 8.5 can grep for them.
 *   3. The barrel re-exports each expected symbol — catches accidental
 *      drops in `index.ts`.
 *
 * Phase 8.5 will REPLACE these stub-throws assertions with real per-guard
 * unit tests; until then the contract here is just "the skeleton exists
 * and is wired together".
 */
import { describe, it, expect } from 'vitest';
import {
  assertCanTransition,
  getReachableStages,
  leadsToEnd,
  assertNoPendingChecklist,
  getPendingChecklistProfileIds,
  validateChecklistAnswers,
  assertValidDryerDuration,
  assertDryerHalfTimeElapsed,
  validateInstrumentReadings,
  assertBypassAllowed,
  assertCanBypassTo,
  assertBypassJustification,
  assertTerminateAllowed,
  assertTerminateJustification,
  computeNextActions,
  loadLocalContext,
  loadLocalContextFromCache,
} from '../index.js';
import type {
  LocalContext,
  GuardResult,
  ValidationResult,
  StageInfo,
  ProfileSlice,
  CycleSlice,
  FilterSlice,
} from '../index.js';

// ── Type-compile fixture ─────────────────────────────────────────────────
//
// Constructing a LocalContext literal is the cheapest way to assert the
// interface compiles end-to-end (every field present, every type
// resolvable). If a slice shape changes incompatibly, this stops compiling.

function makeFixture(): LocalContext {
  const profile: ProfileSlice = {
    id: 'profile-1',
    lineageId: 'lineage-1',
    name: 'Standard Cleaning',
    flowMode: 'BYPASS_ENABLED',
    version: 3,
    status: 'ACTIVE',
    cleaningReasons: { keys: ['ROUTINE', 'PM'] },
    nodes: [
      { id: 'n1', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
      { id: 'n2', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 1 },
      { id: 'n3', stateKey: 'DRY_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 2 },
      { id: 'n4', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 3 },
    ],
    edges: [
      { fromStageId: 'n1', toStageId: 'n2' },
      { fromStageId: 'n2', toStageId: 'n3' },
      { fromStageId: 'n3', toStageId: 'n4' },
    ],
  };
  const cycle: CycleSlice = {
    id: 'cycle-1',
    cycleCode: 'C-2026-001',
    filterId: 'filter-1',
    ahuId: null,
    profileId: profile.id,
    profileVersion: profile.version,
    status: 'IN_PROGRESS',
    cleaningAreaId: 'block-1',
    equipmentGroupId: 'eg-1',
    equipmentGroupVersionPin: 4,
    checklistVersionPins: { 'cl-1': 2 },
    dryerStartedAt: null,
    dryerDurationMinutes: null,
    dryerReadingsSubmitted: false,
    cleaningReasonKey: 'ROUTINE',
    cleaningReasonLabel: 'Routine cleaning',
    startedAt: new Date('2026-05-02T10:00:00Z'),
    completedAt: null,
    terminatedAt: null,
  };
  const filter: FilterSlice = {
    id: 'filter-1',
    name: 'F-Block-A-1',
    parentId: 'ahu-1',
    filterProfileId: 'fp-1',
    currentLifecycleState: 'WASH_IN',
    currentCycleId: cycle.id,
    filterSet: 'PRIMARY',
    block: { id: 'block-1', name: 'Block A', templateKind: 'BLOCK' },
    area: { id: 'area-1', name: 'Area 1', templateKind: 'AREA' },
    ahu: { id: 'ahu-1', name: 'AHU-1', templateKind: 'AHU' },
  };
  const stageLookup: Record<string, StageInfo> = {
    WASH_IN: { nextStages: ['DRY_IN'], pendingChecklistProfileIds: [], leadsToEnd: false },
    DRY_IN: { nextStages: [], pendingChecklistProfileIds: [], leadsToEnd: true },
  };
  return {
    profile,
    cycle,
    events: [],
    stageLookup,
    filter,
    equipmentGroup: null,
    checklistProfile: null,
    assetTemplate: null,
    user: { id: 'u-1', role: 'OPERATOR', permissions: ['FILTER_OPERATE'] },
    now: Date.UTC(2026, 4, 2, 11, 0, 0),
  };
}

describe('pipeline-executor scaffold (Phase 8.4c)', () => {
  it('LocalContext fixture compiles against the type', () => {
    const ctx = makeFixture();
    // Light runtime sanity — guards expect every field present.
    expect(ctx.profile.nodes).toHaveLength(4);
    expect(ctx.cycle.status).toBe('IN_PROGRESS');
    expect(ctx.filter.currentLifecycleState).toBe('WASH_IN');
    expect(ctx.stageLookup['DRY_IN']?.leadsToEnd).toBe(true);
    expect(typeof ctx.now).toBe('number');
  });

  it('GuardResult / ValidationResult discriminated unions narrow correctly', () => {
    // Compile-time test: type-narrowing produces the right type on each branch.
    const ok: GuardResult = { ok: true };
    if (ok.ok) {
      // No further fields on the success branch.
      expect(ok.ok).toBe(true);
    }
    const fail: GuardResult = { ok: false, code: 'X', message: 'y' };
    if (!fail.ok) {
      expect(fail.code).toBe('X');
      expect(fail.message).toBe('y');
    }
    const vfail: ValidationResult = {
      ok: false,
      failures: [{ field: 'foo', code: 'BAD', message: 'no' }],
    };
    if (!vfail.ok) {
      expect(vfail.failures).toHaveLength(1);
    }
  });
});

describe('pipeline-executor stub guards throw NOT_IMPLEMENTED', () => {
  const ctx = makeFixture();

  // Each entry: [name, callable that should throw]
  const cases: Array<[string, () => unknown]> = [
    ['transitions.assertCanTransition', () => assertCanTransition(ctx, 'DRY_IN')],
    ['transitions.getReachableStages', () => getReachableStages(ctx)],
    ['transitions.leadsToEnd', () => leadsToEnd(ctx)],
    ['checklist.assertNoPendingChecklist', () => assertNoPendingChecklist(ctx)],
    ['checklist.getPendingChecklistProfileIds', () => getPendingChecklistProfileIds(ctx)],
    ['checklist.validateChecklistAnswers', () => validateChecklistAnswers(ctx, {})],
    ['dryer.assertValidDryerDuration', () => assertValidDryerDuration(ctx, 60)],
    ['dryer.assertDryerHalfTimeElapsed', () => assertDryerHalfTimeElapsed(ctx)],
    ['dryer.validateInstrumentReadings', () => validateInstrumentReadings(ctx, {})],
    ['bypass.assertBypassAllowed', () => assertBypassAllowed(ctx)],
    ['bypass.assertCanBypassTo', () => assertCanBypassTo(ctx, 'DRY_IN')],
    ['bypass.assertBypassJustification', () => assertBypassJustification(ctx, 'short')],
    ['terminate.assertTerminateAllowed', () => assertTerminateAllowed(ctx)],
    ['terminate.assertTerminateJustification', () => assertTerminateJustification(ctx, 'short')],
    ['actions.computeNextActions', () => computeNextActions(ctx)],
  ];

  for (const [name, fn] of cases) {
    it(`${name} throws NOT_IMPLEMENTED`, () => {
      expect(fn).toThrowError(/^NOT_IMPLEMENTED/);
    });
  }

  it('context.loadLocalContext rejects with NOT_IMPLEMENTED', async () => {
    await expect(loadLocalContext('filter-1')).rejects.toThrow(/^NOT_IMPLEMENTED/);
  });

  it('context.loadLocalContextFromCache rejects with NOT_IMPLEMENTED', async () => {
    await expect(loadLocalContextFromCache('filter-1')).rejects.toThrow(/^NOT_IMPLEMENTED/);
  });
});

describe('pipeline-executor barrel exports the expected names', () => {
  // Pulled at module-load time — if any of these get accidentally dropped
  // from `index.ts`, this import block would fail to compile.
  it('all guard symbols are functions', () => {
    const fns = [
      assertCanTransition,
      getReachableStages,
      leadsToEnd,
      assertNoPendingChecklist,
      getPendingChecklistProfileIds,
      validateChecklistAnswers,
      assertValidDryerDuration,
      assertDryerHalfTimeElapsed,
      validateInstrumentReadings,
      assertBypassAllowed,
      assertCanBypassTo,
      assertBypassJustification,
      assertTerminateAllowed,
      assertTerminateJustification,
      computeNextActions,
      loadLocalContext,
      loadLocalContextFromCache,
    ];
    for (const fn of fns) {
      expect(typeof fn).toBe('function');
    }
    // Sanity: 17 stubs total.
    expect(fns).toHaveLength(17);
  });
});
