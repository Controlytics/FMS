import { describe, it, expect, vi, afterEach } from 'vitest';
import { validateOfflineGate, firstStagesFromGraph, leavingDryInRefusal, type GateInput } from '../validate-offline-gate';

const base: GateInput = {
  activeStageKey: 'WASH_IN', activeStageLabel: 'Wash In', online: true,
  currentLifecycle: null, actions: [], hasGraph: false, hasLinearPipeline: false,
  pipelineGraph: null, cycleInProgress: false, hasPendingChecklist: false,
};

describe('validateOfflineGate — replacementBlocked', () => {
  it('refuses a cycle START when the filter is replacement-blocked', () => {
    const r = validateOfflineGate({ ...base, replacementBlocked: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/replacement overdue/i);
  });

  it('does NOT refuse an in-progress cycle even if flagged (running cycles finish)', () => {
    const r = validateOfflineGate({
      ...base, replacementBlocked: true, cycleInProgress: true,
      actions: [{ type: 'ADVANCE_TO_STAGE', params: { targetState: 'WASH_OUT' } } as any],
      currentLifecycle: 'WASH_IN', activeStageKey: 'WASH_OUT', activeStageLabel: 'Wash Out',
    });
    expect(r.ok).toBe(true);
  });

  it('does not affect a normal start when not flagged', () => {
    const r = validateOfflineGate({ ...base });
    expect(r.ok).toBe(true);
  });
});

// ── The remaining gates (coverage campaign 2026-10-21) ───────────────────────
// Pipeline: START -> WASH_IN -> CHECKLIST -> WASH_OUT -> END, plus a second entry
// START -> PRE_RINSE so "start at" lists more than one legal first stage.
const graph = {
  stages: [
    { id: 's', nodeType: 'START', stateKey: null },
    { id: 'wi', nodeType: 'STAGE', stateKey: 'WASH_IN' },
    { id: 'pr', nodeType: 'STAGE', stateKey: 'PRE_RINSE' },
    { id: 'cl', nodeType: 'CHECKLIST', stateKey: null },
    { id: 'wo', nodeType: 'STAGE', stateKey: 'WASH_OUT' },
    { id: 'e', nodeType: 'END', stateKey: null },
  ],
  connections: [
    { fromStageId: 's', toStageId: 'wi' }, { fromStageId: 's', toStageId: 'pr' },
    { fromStageId: 'wi', toStageId: 'cl' }, { fromStageId: 'cl', toStageId: 'wo' }, { fromStageId: 'wo', toStageId: 'e' },
  ],
};
const advance = (targetState: string) => ({ type: 'ADVANCE_TO_STAGE', params: { targetState } }) as any;
const reasonOf = (r: ReturnType<typeof validateOfflineGate>) => (r.ok ? null : r.reason);

describe('firstStagesFromGraph', () => {
  it('walks from START to every legal first stage', () => {
    expect(firstStagesFromGraph(graph)).toEqual(['WASH_IN', 'PRE_RINSE']);
  });

  it('walks through a CHECKLIST that sits directly after START', () => {
    const g = {
      stages: [{ id: 's', nodeType: 'START' }, { id: 'c', nodeType: 'CHECKLIST' }, { id: 'w', nodeType: 'STAGE', stateKey: 'WASH_IN' }],
      connections: [{ fromStageId: 's', toStageId: 'c' }, { fromStageId: 'c', toStageId: 'w' }],
    };
    expect(firstStagesFromGraph(g)).toEqual(['WASH_IN']);
  });

  it.each([
    ['no graph', null],
    ['undefined graph', undefined],
    ['no stages', { connections: [] }],
    ['no connections', { stages: graph.stages }],
    ['no START node', { stages: graph.stages.filter((s) => s.nodeType !== 'START'), connections: graph.connections }],
  ])('returns [] for %s', (_l, g) => {
    expect(firstStagesFromGraph(g as any)).toEqual([]);
  });
});

describe('validateOfflineGate — stale cache', () => {
  it('offline with no graph, no linear pipeline and an empty tape refuses: sync first', () => {
    expect(reasonOf(validateOfflineGate({ ...base, online: false }))).toBe('offline data not cached — sync first');
  });

  it.each([
    ['a cached graph', { hasGraph: true, pipelineGraph: graph }],
    ['a linear pipeline', { hasLinearPipeline: true }],
    ['an advance action on the tape', { actions: [advance('WASH_IN')] }],
  ])('offline with %s passes the stale-cache check', (_l, extra) => {
    expect(validateOfflineGate({ ...base, online: false, ...extra }).ok).toBe(true);
  });

  it('online never refuses for missing cache data', () => {
    expect(validateOfflineGate({ ...base }).ok).toBe(true);
  });
});

describe('validateOfflineGate — cycle start at an illegal first stage', () => {
  it('refuses and lists every legal first stage with underscores spelled out', () => {
    const r = validateOfflineGate({ ...base, hasGraph: true, pipelineGraph: graph, activeStageKey: 'WASH_OUT', activeStageLabel: 'Wash Out' });
    expect(reasonOf(r)).toBe('cannot start cycle at Wash Out — start at WASH IN, PRE RINSE');
  });

  it('accepts any legal first stage', () => {
    expect(validateOfflineGate({ ...base, hasGraph: true, pipelineGraph: graph, activeStageKey: 'PRE_RINSE' }).ok).toBe(true);
  });

  it('does not refuse when the graph has no reachable first stage (nothing to check against)', () => {
    const r = validateOfflineGate({ ...base, hasGraph: true, pipelineGraph: { stages: [], connections: [] }, activeStageKey: 'DRY_IN' });
    expect(r.ok).toBe(true);
  });
});

describe('validateOfflineGate — in-cycle stage order', () => {
  const inCycle = { ...base, cycleInProgress: true, currentLifecycle: 'WASH_IN' };

  it('refuses a stage that is not an advance target and names the next allowed ones', () => {
    const r = validateOfflineGate({ ...inCycle, actions: [advance('WASH_OUT'), advance('DRY_IN')], activeStageKey: 'STORAGE_IN' });
    expect(reasonOf(r)).toBe('is at WASH IN — next allowed WASH OUT, DRY IN');
  });

  it('a cycle with no lifecycle recorded reads as "is at START"', () => {
    const r = validateOfflineGate({ ...inCycle, currentLifecycle: null, actions: [advance('WASH_IN')], activeStageKey: 'DRY_IN' });
    expect(reasonOf(r)).toBe('is at START — next allowed WASH IN');
  });

  it('a SET_DRYER_DURATION target counts as an allowed stage (Dry In entry)', () => {
    const r = validateOfflineGate({
      ...inCycle, currentLifecycle: 'WASH_OUT', activeStageKey: 'DRY_IN',
      actions: [{ type: 'SET_DRYER_DURATION', params: { targetState: 'DRY_IN' } } as any],
      dryerReadingsSubmitted: false,
    });
    expect(r.ok).toBe(true);
  });

  it('a BYPASS_STAGE alone for the scanned stage is not an advance and is refused', () => {
    const r = validateOfflineGate({
      ...inCycle, activeStageKey: 'DRY_IN',
      actions: [advance('WASH_OUT'), { type: 'BYPASS_STAGE', params: { targetState: 'DRY_IN' } } as any],
    });
    expect(reasonOf(r)).toBe('is at WASH IN — next allowed WASH OUT');
  });
});

describe('validateOfflineGate — offline in-cycle with nothing cached', () => {
  const offlineInCycle = { ...base, online: false, hasGraph: true, pipelineGraph: graph, cycleInProgress: true, currentLifecycle: 'WASH_IN' };

  it('refuses when no next stage is cached and no checklist is pending', () => {
    expect(reasonOf(validateOfflineGate({ ...offlineInCycle, activeStageKey: 'WASH_OUT' }))).toBe('in-cycle but no next stage cached — re-sync');
  });

  it('a pending checklist explains the empty tape, so it is not refused as stale', () => {
    expect(validateOfflineGate({ ...offlineInCycle, activeStageKey: 'WASH_OUT', hasPendingChecklist: true }).ok).toBe(true);
  });

  it('online the same state is left to the server', () => {
    expect(validateOfflineGate({ ...offlineInCycle, online: true, activeStageKey: 'WASH_OUT' }).ok).toBe(true);
  });
});

describe('validateOfflineGate — Dry In guards', () => {
  afterEach(() => { vi.useRealTimers(); });
  const atDryIn = {
    ...base, cycleInProgress: true, currentLifecycle: 'DRY_IN', activeStageKey: 'DRY_OUT', activeStageLabel: 'Dry Out',
    actions: [advance('DRY_OUT')],
  };

  it('scanning Dry In again after the readings are in is refused', () => {
    const r = validateOfflineGate({ ...base, activeStageKey: 'DRY_IN', dryerReadingsSubmitted: true });
    expect(reasonOf(r)).toBe('dry-in already recorded — scan on Dry Out');
  });

  it.each([
    ['no start time', { dryerStartedAt: null, dryerDurationMinutes: 60 }],
    ['no duration', { dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: null }],
    ['a zero duration', { dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 0 }],
  ])('leaving Dry In with %s is refused: set the duration first', (_l, dryer) => {
    expect(reasonOf(validateOfflineGate({ ...atDryIn, ...dryer }))).toBe('set the dryer duration before leaving Dry In');
  });

  it('leaving before half-time is refused with the minutes still to wait (rounded up)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:10:30.000Z'));
    const r = validateOfflineGate({ ...atDryIn, dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60 });
    // half = 30 min; elapsed 10.5 min -> 19.5 min left -> "20"
    expect(reasonOf(r)).toBe('dryer still running — wait 20 more minute(s) before leaving Dry In');
  });

  it('seconds before half-time still reads "1 more minute"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:29:55.000Z'));
    const r = validateOfflineGate({ ...atDryIn, dryerStartedAt: new Date('2026-10-21T08:00:00.000Z'), dryerDurationMinutes: 60 });
    expect(reasonOf(r)).toBe('dryer still running — wait 1 more minute(s) before leaving Dry In');
  });

  it('past half-time without readings: submit the temperature first', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:30:00.000Z'));
    const r = validateOfflineGate({ ...atDryIn, dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60 });
    expect(reasonOf(r)).toBe('submit dryer temperature before leaving Dry In');
  });

  it('with readings submitted the cycle may leave Dry In', () => {
    const r = validateOfflineGate({ ...atDryIn, dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60, dryerReadingsSubmitted: true });
    expect(r).toEqual({ ok: true });
  });
});

// 2026-10-23: since 3404627 the tape offers NO way out of Dry In before the
// readings (guard #27). Offline, the "in-cycle but no next stage cached" check
// read that empty tape as a stale cache and told the operator to re-sync. The
// leaving-Dry-In rule now speaks first — ONE helper, shared with the desktop.
describe('validateOfflineGate — leaving Dry In is explained before any stale-cache verdict', () => {
  afterEach(() => { vi.useRealTimers(); });
  const readingsTape = [
    { type: 'SUBMIT_DRYER_READINGS', label: 'Submit dryer readings', params: { instrumentIds: ['t1'] } },
    { type: 'TERMINATE_CYCLE', label: 'Terminate' },
  ] as any[];
  const offlineAtDryIn = {
    ...base, online: false, hasGraph: true, cycleInProgress: true, currentLifecycle: 'DRY_IN',
    activeStageKey: 'DRY_OUT', activeStageLabel: 'Dry Out', actions: readingsTape,
  };

  it('readings due: "submit the dryer temperature", not "re-sync"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:45:00.000Z'));
    const r = validateOfflineGate({ ...offlineAtDryIn, dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60 });
    expect(reasonOf(r)).toBe('submit dryer temperature before leaving Dry In');
  });

  it('before half-time (the tape offers nothing yet): the countdown, not "re-sync"', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T08:10:30.000Z'));
    const r = validateOfflineGate({ ...offlineAtDryIn, actions: [{ type: 'TERMINATE_CYCLE', label: 'Terminate' }] as any, dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60 });
    expect(reasonOf(r)).toBe('dryer still running — wait 20 more minute(s) before leaving Dry In');
  });

  it('a genuinely stale cache (not at Dry In) still says re-sync', () => {
    const r = validateOfflineGate({ ...offlineAtDryIn, currentLifecycle: 'WASH_IN', activeStageKey: 'WASH_OUT', activeStageLabel: 'Wash Out', actions: [] });
    expect(reasonOf(r)).toBe('in-cycle but no next stage cached — re-sync');
  });

  it('the helper: null away from Dry In, scanning Dry In itself, or once the readings are in', () => {
    const dry = { dryerStartedAt: '2026-10-21T08:00:00.000Z', dryerDurationMinutes: 60 };
    expect(leavingDryInRefusal({ currentLifecycle: 'WASH_IN', activeStageKey: 'WASH_OUT', ...dry })).toBeNull();
    expect(leavingDryInRefusal({ currentLifecycle: 'DRY_IN', activeStageKey: 'DRY_IN', ...dry })).toBeNull();
    expect(leavingDryInRefusal({ currentLifecycle: 'DRY_IN', activeStageKey: 'DRY_OUT', ...dry, dryerReadingsSubmitted: true })).toBeNull();
    expect(leavingDryInRefusal({ currentLifecycle: 'DRY_IN', activeStageKey: 'DRY_OUT', dryerStartedAt: null, dryerDurationMinutes: null })).toBe('set the dryer duration before leaving Dry In');
  });
});
