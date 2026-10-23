/**
 * Edge shapes the executor meets in the field but the scenario fixtures never
 * build: a cycle with no profile, a lifecycle state the profile no longer has,
 * a profile with no START node, an edge to a deleted node, checklist branches
 * that meet again, timestamps that arrive as ISO strings (the tablet's offline
 * cache is JSON), an offline instant that does not parse, instruments without a
 * sort order, and bypass targets whose sort orders tie.
 *
 * Every case asserts what the operator or the server would see, through the
 * public executor surface only.
 */
import { describe, expect, it } from 'vitest';
import {
  assertCanTransition,
  assertChecklistGatePassed,
  assertDryerDurationSetBeforeEnteringDryIn,
  assertDryerHalfTimeBeforeLeavingDryIn,
  assertDryerHalfTimeElapsed,
  assertDryerReadingsSubmittedBeforeLeavingDryIn,
  assertDryerStarted,
  assertInstrumentReadingInRange,
  assertInstrumentReadingRequired,
  assertInstrumentReadingValid,
  assertParametersInRange,
  assertParametersRequired,
  assertTapeVersionFresh,
  assertTargetStateReachable,
  buildStageLookup,
  checklistAnsweredInCurrentEntry,
  collectChecklistsAfterStage,
  computeNextActions,
  extractParameterDefs,
  getReachableStages,
  isEntryIntoStage,
  latestEntryIntoStage,
  leadsToEnd,
} from '../index.js';
import type {
  ChecklistProfileSlice,
  CycleSlice,
  EquipmentGroupSlice,
  FilterEventSlice,
  LocalContext,
  ProfileSlice,
} from '../index.js';
import {
  FIXTURE_NOW,
  bypassEnabledContext,
  dryInActiveContext,
  midWashContext,
  pendingChecklistContext,
} from './fixtures.js';

const MIN = 60_000;

function types(ctx: LocalContext, opts?: Parameters<typeof computeNextActions>[1]): string[] {
  return computeNextActions(ctx, opts).actions.map(a => a.type);
}

function targets(ctx: LocalContext, type: string): string[] {
  return computeNextActions(ctx).actions
    .filter(a => a.type === type)
    .map(a => (a as { params: { targetState: string } }).params.targetState);
}

function withState(ctx: LocalContext, state: string | null): LocalContext {
  return { ...ctx, filter: { ...ctx.filter, currentLifecycleState: state } };
}

function event(
  id: string,
  eventType: string,
  toState: string | null,
  performedAt: Date | string,
  attributes: Record<string, unknown> = {},
): FilterEventSlice {
  return { id, cycleId: 'cycle-1', eventType, fromState: null, toState, performedAt, attributes };
}

/**
 * WASH_IN is followed by two checklist branches that meet again at a third
 * checklist, and the first branch also runs straight on to WASH_OUT:
 *
 *   WASH_IN ─> CL-A ─> CL-C ─> WASH_OUT ─> END
 *          └─> CL-B ──┘   CL-A ─> WASH_OUT
 */
function convergingChecklistProfile(): ProfileSlice {
  return {
    id: 'profile-conv',
    lineageId: 'lineage-conv',
    name: 'Converging checklists',
    flowMode: 'SEQUENTIAL',
    version: 2,
    status: 'ACTIVE',
    cleaningReasons: { keys: ['ROUTINE'] },
    nodes: [
      { id: 'n-start', stateKey: null, nodeType: 'START', configuration: {}, sortOrder: 0 },
      { id: 'n-wash-in', stateKey: 'WASH_IN', nodeType: 'STAGE', configuration: {}, sortOrder: 1 },
      { id: 'n-cl-a', stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl-a' }, sortOrder: 2 },
      { id: 'n-cl-b', stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl-b' }, sortOrder: 3 },
      { id: 'n-cl-c', stateKey: null, nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl-c' }, sortOrder: 4 },
      { id: 'n-wash-out', stateKey: 'WASH_OUT', nodeType: 'STAGE', configuration: {}, sortOrder: 5 },
      { id: 'n-end', stateKey: null, nodeType: 'END', configuration: {}, sortOrder: 6 },
    ],
    edges: [
      { fromStageId: 'n-start', toStageId: 'n-wash-in' },
      { fromStageId: 'n-wash-in', toStageId: 'n-cl-a' },
      { fromStageId: 'n-wash-in', toStageId: 'n-cl-b' },
      { fromStageId: 'n-cl-a', toStageId: 'n-cl-c' },
      { fromStageId: 'n-cl-b', toStageId: 'n-cl-c' },
      { fromStageId: 'n-cl-c', toStageId: 'n-wash-out' },
      { fromStageId: 'n-cl-a', toStageId: 'n-wash-out' },
      { fromStageId: 'n-wash-out', toStageId: 'n-end' },
    ],
  };
}

function checklistProfile(id: string, questionCount: number): ChecklistProfileSlice {
  return {
    id,
    name: `Checklist ${id}`,
    isActive: true,
    version: 1,
    questions: Array.from({ length: questionCount }, (_, i) => ({
      id: `${id}-q${i}`,
      question: `Question ${i}`,
      questionType: 'YES_NO',
      required: true,
      section: null,
      description: null,
      options: [],
      validation: {},
      sortOrder: i,
    })),
  } as ChecklistProfileSlice;
}

// ── Cycle / profile / position edge cases ────────────────────────────────

describe('tape without a live cycle or without a profile', () => {
  it('no cycle at all: nothing is offered and the tape version is just the event count', () => {
    const ctx = midWashContext({ cycle: null as unknown as CycleSlice });
    const tape = computeNextActions(ctx);
    expect(tape.actions).toEqual([]);
    expect(tape.tapeVersion).toBe(ctx.events.length);
    expect(getReachableStages(ctx)).toEqual([]);
  });

  it('a cycle whose profile could not be loaded can still be terminated, and only terminated', () => {
    const ctx = midWashContext({ profile: null as unknown as ProfileSlice });
    const tape = computeNextActions(ctx);
    expect(tape.actions.map(a => a.type)).toEqual(['TERMINATE_CYCLE']);
    expect(tape.tapeVersion).toBe(ctx.cycle.profileVersion * 1_000_000 + ctx.events.length);
  });

  it('the tape-version check of a context without a cycle counts events only', () => {
    const ctx = midWashContext({ cycle: null as unknown as CycleSlice });
    expect(assertTapeVersionFresh(ctx, ctx.events.length)).toEqual({ ok: true });
    expect(assertTapeVersionFresh(ctx, ctx.events.length + 1)).toMatchObject({
      ok: false,
      code: 'STALE_TAPE',
      details: { currentTapeVersion: ctx.events.length },
    });
  });
});

describe('a lifecycle state the profile does not have', () => {
  // A legacy spelling (`WASHIN`) or a stage removed from the profile: every
  // walker falls back to START, so the operator is offered the first stage.
  const ctx = withState(midWashContext(), 'WASHIN');

  it('the tape, reachability and END test all walk from START', () => {
    expect(targets(ctx, 'ADVANCE_TO_STAGE')).toEqual(['WASH_IN']);
    expect(getReachableStages(ctx)).toEqual(['WASH_IN']);
    expect(leadsToEnd(ctx)).toBe(false);
  });

  it('the checklist gate has no stage to gate on and passes', () => {
    expect(assertChecklistGatePassed(ctx, pendingChecklistContext().profile, 'WASHIN')).toEqual({ ok: true });
  });
});

describe('a profile without a START node', () => {
  function startless(state: string | null): LocalContext {
    const base = midWashContext();
    const profile: ProfileSlice = {
      ...base.profile,
      nodes: base.profile.nodes.filter(n => n.nodeType !== 'START'),
      edges: base.profile.edges.filter(e => e.fromStageId !== 'n-start'),
    };
    return withState({ ...base, profile }, state);
  }

  it('before the first stage there is nowhere to walk from: terminate only', () => {
    const ctx = startless(null);
    expect(types(ctx)).toEqual(['TERMINATE_CYCLE']);
    expect(getReachableStages(ctx)).toEqual([]);
    expect(leadsToEnd(ctx)).toBe(false);
  });

  it('an unknown state cannot fall back to START either', () => {
    const ctx = startless('NOT_A_STAGE');
    expect(types(ctx)).toEqual(['TERMINATE_CYCLE']);
    expect(getReachableStages(ctx)).toEqual([]);
    expect(leadsToEnd(ctx)).toBe(false);
  });

  it('a known stage still walks forward normally', () => {
    const ctx = startless('DRY_OUT');
    expect(types(ctx)).toEqual(['COMPLETE_CYCLE', 'TERMINATE_CYCLE']);
    expect(leadsToEnd(ctx)).toBe(true);
  });
});

describe('out-of-sequence messages before the first stage name START', () => {
  it('assertTargetStateReachable', () => {
    const r = assertTargetStateReachable(midWashContext(), 'WASH_OUT', ['WASH_IN'], 'SEQUENTIAL', false, null);
    expect(r).toEqual({
      ok: false,
      code: 'OUT_OF_SEQUENCE',
      message: 'Cannot move to WASH_OUT from START. Next allowed: WASH_IN',
    });
  });

  it('assertCanTransition', () => {
    const ctx = withState(midWashContext(), null);
    expect(assertCanTransition(ctx, 'WASH_IN')).toEqual({ ok: true });
    expect(assertCanTransition(ctx, 'WASH_OUT')).toEqual({
      ok: false,
      code: 'OUT_OF_SEQUENCE',
      message: 'Cannot move to WASH_OUT from START. Next allowed: WASH_IN',
    });
  });
});

// ── Graph shapes ─────────────────────────────────────────────────────────

describe('an edge to a node that no longer exists', () => {
  function withDanglingEdge(): LocalContext {
    const base = midWashContext();
    return {
      ...base,
      profile: {
        ...base.profile,
        edges: [{ fromStageId: 'n-wash-in', toStageId: 'n-deleted' }, ...base.profile.edges],
      },
    };
  }

  it('is ignored by the tape, the reachability walk and the stage lookup', () => {
    const ctx = withDanglingEdge();
    expect(targets(ctx, 'ADVANCE_TO_STAGE')).toEqual(['WASH_OUT']);
    expect(getReachableStages(ctx)).toEqual(['WASH_OUT']);
    expect(buildStageLookup(ctx.profile).WASH_IN).toEqual({
      nextStages: ['WASH_OUT'],
      pendingChecklistProfileIds: [],
      leadsToEnd: false,
    });
    const washIn = ctx.profile.nodes.find(n => n.stateKey === 'WASH_IN')!;
    expect(collectChecklistsAfterStage(washIn, ctx.profile.nodes, ctx.profile.edges)).toEqual([]);
  });
});

describe('checklist branches that meet again', () => {
  const profile = convergingChecklistProfile();
  const washIn = profile.nodes.find(n => n.stateKey === 'WASH_IN')!;
  const atWashIn = (events: FilterEventSlice[], over: Partial<LocalContext> = {}): LocalContext =>
    midWashContext({ profile, events, ...over });
  const entered = event('e-in', 'STATE_TRANSITION', 'WASH_IN', new Date('2026-05-02T10:05:00Z'));

  it('collects each checklist once, in walk order', () => {
    expect(collectChecklistsAfterStage(washIn, profile.nodes, profile.edges).map(n => n.id))
      .toEqual(['n-cl-a', 'n-cl-c', 'n-cl-b']);
  });

  it('the stage lookup lists WASH_OUT once although two branches reach it', () => {
    expect(buildStageLookup(profile).WASH_IN).toEqual({
      nextStages: ['WASH_OUT'],
      pendingChecklistProfileIds: ['cl-a', 'cl-c', 'cl-b'],
      leadsToEnd: false,
    });
  });

  it('once answered, the tape offers ONE advance to WASH_OUT', () => {
    const answered = event('e-cl', 'CHECKLIST_COMPLETED', null, new Date('2026-05-02T10:10:00Z'), {
      afterStage: 'WASH_IN',
    });
    const ctx = atWashIn([entered, answered]);
    expect(targets(ctx, 'ADVANCE_TO_STAGE')).toEqual(['WASH_OUT']);
    expect(new Set(getReachableStages(ctx))).toEqual(new Set(['WASH_OUT']));
  });

  it('asks only the checklists it can resolve to questions; the advance waits', () => {
    // cl-a comes from the context's own checklist profile (no options map);
    // cl-b / cl-c are not in the offline cache.
    const ctx = atWashIn([entered], { checklistProfile: checklistProfile('cl-a', 2) });
    const tape = computeNextActions(ctx);
    expect(tape.actions.map(a => a.type)).toEqual(['SUBMIT_CHECKLIST', 'TERMINATE_CYCLE']);
    expect((tape.actions[0] as { params: { checklistProfileId: string } }).params.checklistProfileId).toBe('cl-a');
  });

  it('a checklist profile with no questions is not asked', () => {
    const ctx = atWashIn([entered]);
    const byId = new Map([
      ['cl-a', checklistProfile('cl-a', 0)],
      ['cl-b', checklistProfile('cl-b', 1)],
      ['cl-c', checklistProfile('cl-c', 0)],
    ]);
    const submits = computeNextActions(ctx, { checklistProfilesById: byId }).actions
      .filter(a => a.type === 'SUBMIT_CHECKLIST')
      .map(a => (a as { params: { checklistProfileId: string } }).params.checklistProfileId);
    expect(submits).toEqual(['cl-b']);
  });
});

// ── Timestamps as strings / unparseable ──────────────────────────────────

describe('event timestamps from the offline cache (ISO strings)', () => {
  const entry = event('e-in', 'STATE_TRANSITION', 'WASH_IN', '2026-05-02T10:05:00.000Z');

  it('an entry with no attributes is a real entry', () => {
    const bare = { eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedAt: '2026-05-02T10:05:00Z' };
    expect(isEntryIntoStage(bare, 'WASH_IN')).toBe(true);
    expect(latestEntryIntoStage([bare], 'WASH_IN')).toBe(Date.parse('2026-05-02T10:05:00Z'));
  });

  it('a checklist answered after the entry counts; one answered before it does not', () => {
    const after = event('e-a', 'CHECKLIST_COMPLETED', null, '2026-05-02T10:10:00.000Z', { afterStage: 'WASH_IN' });
    const before = event('e-b', 'CHECKLIST_COMPLETED', null, '2026-05-02T10:00:00.000Z', { afterStage: 'WASH_IN' });
    expect(checklistAnsweredInCurrentEntry([entry, after], 'WASH_IN')).toBe(true);
    expect(checklistAnsweredInCurrentEntry([entry, before], 'WASH_IN')).toBe(false);
  });

  it('an unparseable timestamp is never later than an entry, so it never counts as answered', () => {
    const garbled = event('e-g', 'CHECKLIST_COMPLETED', null, 'not-a-date', { afterStage: 'WASH_IN' });
    expect(checklistAnsweredInCurrentEntry([entry, garbled], 'WASH_IN')).toBe(false);
    // ...and an unparseable ENTRY sorts as the earliest possible entry.
    const garbledEntry = event('e-ge', 'STATE_TRANSITION', 'WASH_IN', 'not-a-date');
    expect(latestEntryIntoStage([garbledEntry], 'WASH_IN')).toBe(0);
    expect(latestEntryIntoStage([garbledEntry, entry], 'WASH_IN')).toBe(Date.parse('2026-05-02T10:05:00Z'));
  });
});

describe('dryer timing with string timestamps and offline instants', () => {
  function dryIn(startedMinutesAgo: number, asString: boolean): LocalContext {
    const started = new Date(FIXTURE_NOW - startedMinutesAgo * MIN);
    const base = dryInActiveContext();
    return { ...base, cycle: { ...base.cycle, dryerStartedAt: asString ? started.toISOString() : started } };
  }

  it('a cached ISO dryer start past half-time offers the readings and the onward stage', () => {
    const ctx = dryIn(30, true);
    expect(types(ctx)).toEqual(['SUBMIT_DRYER_READINGS', 'ADVANCE_TO_STAGE', 'TERMINATE_CYCLE']);
    expect(assertDryerHalfTimeElapsed(ctx, ctx.cycle, 'SUBMIT_READINGS')).toEqual({ ok: true });
    expect(assertDryerHalfTimeBeforeLeavingDryIn(ctx, ctx.cycle, 'DRY_IN', 'DRY_OUT')).toEqual({ ok: true });
  });

  it('before half-time nothing moves: no readings, no advance, no bypass — only terminate', () => {
    const ctx = dryIn(10, true);
    expect(types(ctx)).toEqual(['TERMINATE_CYCLE']);
    const bypassProfile = bypassEnabledContext().profile;
    expect(types({ ...ctx, profile: bypassProfile })).toEqual(['TERMINATE_CYCLE']);
    const r = assertDryerHalfTimeElapsed(ctx, ctx.cycle, 'SUBMIT_READINGS');
    expect(r).toMatchObject({ ok: false, code: 'DRYER_NOT_READY', details: { remainingMin: 20 } });
    expect(assertDryerHalfTimeBeforeLeavingDryIn(ctx, ctx.cycle, 'DRY_IN', 'DRY_OUT')).toMatchObject({
      ok: false,
      code: 'DRYER_NOT_READY',
      message: 'Dryer still running. Wait 20 more minute(s) before leaving DRY_IN.',
    });
  });

  it('offline replay measures half-time at the queued op instant, given as an ISO string', () => {
    // Server "now" is only 10 min after the start, but the operator acted 40 min in.
    const ctx = dryIn(10, false);
    const actedAt = new Date(FIXTURE_NOW + 30 * MIN).toISOString();
    expect(assertDryerHalfTimeElapsed(ctx, ctx.cycle, 'SUBMIT_READINGS', actedAt)).toEqual({ ok: true });
    expect(assertDryerHalfTimeBeforeLeavingDryIn(ctx, ctx.cycle, 'DRY_IN', 'DRY_OUT', actedAt)).toEqual({ ok: true });
  });

  it('an unparseable offline instant falls back to server time, so half-time is still enforced', () => {
    const ctx = dryIn(10, false);
    expect(assertDryerHalfTimeElapsed(ctx, ctx.cycle, 'SUBMIT_READINGS', 'garbage')).toMatchObject({
      ok: false,
      code: 'DRYER_NOT_READY',
    });
  });

  it('a dryer that never started is not a half-time question — the start/duration guards refuse it', () => {
    const base = dryInActiveContext();
    const cycle: CycleSlice = { ...base.cycle, dryerStartedAt: null, dryerDurationMinutes: null };
    expect(assertDryerHalfTimeElapsed(base, cycle, 'SUBMIT_READINGS')).toEqual({ ok: true });
    expect(assertDryerStarted(base, cycle, 'SUBMIT_READINGS')).toMatchObject({ ok: false, code: 'DRYER_NOT_STARTED' });

    expect(assertDryerHalfTimeBeforeLeavingDryIn(base, cycle, 'DRY_IN', 'DRY_OUT')).toEqual({ ok: true });
    expect(assertDryerReadingsSubmittedBeforeLeavingDryIn(cycle, 'DRY_IN', 'DRY_OUT')).toMatchObject({
      ok: false,
      code: 'DRYER_DURATION_REQUIRED',
    });
    expect(assertDryerDurationSetBeforeEnteringDryIn(cycle, 'DRY_IN', null)).toMatchObject({
      ok: false,
      code: 'DRYER_DURATION_REQUIRED',
    });
  });
});

// ── Instruments / bypass ordering ────────────────────────────────────────

describe('instrument order and messages', () => {
  it('an instrument without a sort order is read first (treated as 0)', () => {
    const eg: EquipmentGroupSlice = {
      id: 'eg-x',
      name: 'Wash probes',
      blockId: 'block-1',
      isActive: true,
      version: 1,
      instruments: [
        { id: 'instr-ro', instrumentId: 'RO-01', stageKey: 'WASH_OUT', operatingMin: 1, operatingMax: 5, sortOrder: 1 },
        { id: 'instr-air', instrumentId: 'AIR-01', stageKey: 'WASH_OUT', operatingMin: 2, operatingMax: 6 },
      ],
    };
    const adv = computeNextActions(midWashContext({ equipmentGroup: eg })).actions
      .find(a => a.type === 'ADVANCE_TO_STAGE') as {
      params: { requiresInstrumentReadings?: string[] };
      validations?: { operatingRanges: Record<string, { min: number; max: number }> };
    };
    expect(adv.params.requiresInstrumentReadings).toEqual(['instr-air', 'instr-ro']);
    expect(adv.validations?.operatingRanges).toEqual({
      'instr-air': { min: 2, max: 6 },
      'instr-ro': { min: 1, max: 5 },
    });
  });

  it('messages still read when an instrument has no description or id', () => {
    const ctx = midWashContext();
    expect(assertInstrumentReadingRequired(ctx, null, {})).toMatchObject({
      code: 'READING_REQUIRED',
      message: 'Reading required for (unknown) (?)',
    });
    expect(assertInstrumentReadingValid(ctx, 'abc', {})).toMatchObject({
      code: 'INVALID_READING',
      message: 'Invalid reading value for (unknown)',
    });
    expect(assertInstrumentReadingInRange(ctx, 9, { operatingMin: 1, operatingMax: 5 })).toMatchObject({
      code: 'READING_OUT_OF_RANGE',
      message: '(unknown) reading 9 is outside operating range (1–5)',
    });
  });
});

describe('bypass targets whose sort orders tie', () => {
  it('are offered in stage-key order', () => {
    const base = bypassEnabledContext();
    const profile: ProfileSlice = {
      ...base.profile,
      nodes: base.profile.nodes.map(({ sortOrder: _drop, ...n }) => n),
    };
    expect(targets({ ...base, profile }, 'BYPASS_STAGE')).toEqual(['DRY_IN', 'DRY_OUT', 'WASH_OUT']);
  });
});

// ── Parameters ───────────────────────────────────────────────────────────

describe('PARAM_CAPTURE parameters', () => {
  const nodes = [
    {
      nodeType: 'PARAM_CAPTURE',
      configuration: {
        parameters: [
          { key: 'temp', label: 'Temperature', required: true, min: 20, max: 60 },
          { key: 'note_ph', label: 'pH', min: 6, max: 8 },
        ],
      },
    },
    { nodeType: 'PARAM_CAPTURE', configuration: {} },
    { nodeType: 'PARAM_CAPTURE', configuration: null },
    { nodeType: 'STAGE', configuration: { parameters: [{ key: 'ignored', label: 'Ignored' }] } },
  ];

  it('only PARAM_CAPTURE blocks that define parameters contribute definitions', () => {
    expect(extractParameterDefs(nodes).map(d => d.key)).toEqual(['temp', 'note_ph']);
  });

  it('an optional parameter left out is not range-checked; a present one is', () => {
    const defs = extractParameterDefs(nodes);
    const ctx = midWashContext();
    expect(assertParametersRequired(ctx, { temp: { value: 40 } }, defs)).toEqual({ ok: true });
    expect(assertParametersInRange(ctx, { temp: { value: 40 } }, defs)).toEqual({ ok: true });
    expect(assertParametersInRange(ctx, { temp: { value: 40 }, note_ph: { value: 9 } }, defs)).toEqual({
      ok: false,
      code: 'PARAM_OUT_OF_RANGE',
      message: 'pH above maximum (8)',
    });
  });
});
