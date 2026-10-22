/**
 * useFilterOperationsCore — a checklist BEFORE the first stage (a START
 * checklist), 2026-10-22.
 *
 * Rules (operator decision 2026-10-22, the server half in packages/shared +
 * filter-operations): the cycle is started, the START checklist answered at
 * START (afterStage null), and only then is the first stage entered. Never the
 * compound start-and-advance for such a profile — the offline replay exempts
 * START_CHECKLIST, so a compound op would skip a GMP checklist silently.
 *
 * `startWithStartChecklist` writes the first two (start → checklist) and keeps
 * the cached row truthful when they are queued; the page enters the first stage
 * afterwards with `advance`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { store, mockExecuteOrQueue, mockGetCurrentActions, onlineRef } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockExecuteOrQueue: vi.fn(),
  mockGetCurrentActions: vi.fn(),
  onlineRef: { current: true },
}));

vi.mock('../../../hooks/use-offline', () => ({
  useOffline: () => ({ executeOrQueue: mockExecuteOrQueue, online: onlineRef.current }),
}));
vi.mock('../resolve-pending-checklist', () => ({
  resolvePendingChecklistDialog: vi.fn().mockResolvedValue(null),
  resolveChecklistForTargetStage: vi.fn().mockResolvedValue([]),
}));
vi.mock('../next-pending-checklist', () => ({ findNextPendingChecklist: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/action-tape', () => ({ getCurrentActions: mockGetCurrentActions }));
vi.mock('@/lib/offline-store', () => ({
  getCachedData: vi.fn(async (key: string) => (store.has(key) ? structuredClone(store.get(key)) : null)),
  cacheData: vi.fn(async (key: string, value: any) => { store.set(key, structuredClone(value)); }),
  getCachedEntity: vi.fn().mockResolvedValue(null),
  getCachedFilters: vi.fn().mockResolvedValue([]),
  updateFilterStateLocally: vi.fn().mockResolvedValue(undefined),
  clearOfflineCycleId: vi.fn().mockResolvedValue(undefined),
  OFFLINE_TTL_MS: 86_400_000,
}));

import { useFilterOperationsCore } from '../use-core';

const KEY = 'filter-state-f1';
// START → CHECKLIST(cl-start) → WASH_IN → END
const GRAPH = {
  stages: [
    { id: 'n-start', nodeType: 'START', stateKey: null, configuration: {} },
    { id: 'n-cl', nodeType: 'CHECKLIST', stateKey: null, configuration: { checklistProfileId: 'cl-start' } },
    { id: 'n-wi', nodeType: 'STAGE', stateKey: 'WASH_IN', configuration: {} },
    { id: 'n-end', nodeType: 'END', stateKey: null, configuration: {} },
  ],
  connections: [
    { fromStageId: 'n-start', toStageId: 'n-cl' },
    { fromStageId: 'n-cl', toStageId: 'n-wi' },
    { fromStageId: 'n-wi', toStageId: 'n-end' },
  ],
};
const ANSWERS = { answers: { q1: 'Yes' }, expectedProfileVersions: { 'cl-start': 2 } };
const ADVANCE_WASH_IN = { type: 'ADVANCE_TO_STAGE', label: 'Wash In', params: { targetState: 'WASH_IN' } };

const args = (over: Record<string, any> = {}) => ({
  filterId: 'f1',
  filterName: 'F-1',
  cyclePayload: { cleaningReasonKey: 'PM', cleaningAreaId: 'b1' },
  checklistPayload: ANSWERS,
  checklistProfileIds: ['cl-start'],
  cleaningAreaId: 'b1',
  password: 'pw',
  ...over,
});

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  onlineRef.current = true;
  store.set(KEY, { currentState: null, currentCycle: null, pipelineGraph: GRAPH, pendingChecklist: [] });
  mockGetCurrentActions.mockResolvedValue([ADVANCE_WASH_IN]);
});

describe('startWithStartChecklist — online', () => {
  it('starts, then answers the checklist at START; logs the answer against the started cycle', async () => {
    mockExecuteOrQueue.mockImplementation(async (type: string) => {
      if (type === 'start-cycle') {
        // executeOrQueue caches the server state after an online start.
        store.set(KEY, { currentState: null, currentCycle: { id: 'cyc-1', status: 'IN_PROGRESS' }, pipelineGraph: GRAPH, actions: [] });
      }
      return { executed: true, result: {} };
    });
    const { result } = renderHook(() => useFilterOperationsCore());
    let out: any;
    await act(async () => { out = await result.current.startWithStartChecklist(args()); });

    expect(out).toEqual({ status: 'answered', startExecuted: true, checklistExecuted: true });
    expect(mockExecuteOrQueue.mock.calls.map((c) => c[0])).toEqual(['start-cycle', 'submit-checklist']);
    expect(mockExecuteOrQueue.mock.calls[0]).toEqual(['start-cycle', 'f1', 'F-1', { cleaningReasonKey: 'PM', cleaningAreaId: 'b1' }, undefined, 'pw']);
    expect(mockExecuteOrQueue.mock.calls[1]).toEqual(['submit-checklist', 'f1', 'F-1', ANSWERS, undefined, 'pw']);
    expect(store.get(KEY).checklistCompletions).toEqual([
      expect.objectContaining({ checklistProfileId: 'cl-start', afterStage: null, cycleId: 'cyc-1' }),
    ]);
  });

  it('the start is run through the page\'s wrapper (the missed-PM question); its extra fields ride on the start', async () => {
    mockExecuteOrQueue.mockResolvedValue({ executed: true, result: {} });
    const runStart = vi.fn(async (start: (extra: Record<string, any>) => Promise<{ executed: boolean }>) => start({ pmSkips: [{ entryId: 'pm1', reason: 'Plant shutdown' }] }));
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => { await result.current.startWithStartChecklist(args({ runStart })); });
    expect(runStart).toHaveBeenCalledTimes(1);
    expect(mockExecuteOrQueue.mock.calls[0][3]).toEqual({ cleaningReasonKey: 'PM', cleaningAreaId: 'b1', pmSkips: [{ entryId: 'pm1', reason: 'Plant shutdown' }] });
  });

  it('the wrapper dismissed (null): nothing is written and nothing is sent', async () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    let out: any;
    await act(async () => { out = await result.current.startWithStartChecklist(args({ runStart: async () => null })); });
    expect(out).toEqual({ status: 'cancelled' });
    expect(mockExecuteOrQueue).not.toHaveBeenCalled();
  });

  it('a refused start is thrown as-is and the checklist is never sent', async () => {
    const refusal = Object.assign(new Error('An earlier PM is pending'), { code: 'PM_PREVIOUS_TASK_PENDING', status: 409 });
    mockExecuteOrQueue.mockRejectedValueOnce(refusal);
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await expect(result.current.startWithStartChecklist(args())).rejects.toBe(refusal);
    });
    expect(mockExecuteOrQueue).toHaveBeenCalledTimes(1);
  });

  it('start OK, checklist refused: reported as such (the cycle waits at START), nothing logged', async () => {
    const refusal = Object.assign(new Error('The checklist changed'), { code: 'SCHEMA_DRIFT', status: 409 });
    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true, result: {} }).mockRejectedValueOnce(refusal);
    const { result } = renderHook(() => useFilterOperationsCore());
    let out: any;
    await act(async () => { out = await result.current.startWithStartChecklist(args()); });
    expect(out).toEqual({ status: 'checklist_refused', startExecuted: true, error: refusal });
    expect(store.get(KEY).checklistCompletions).toBeUndefined();
  });

  it('a re-auth refusal on the checklist is thrown, never folded into a result', async () => {
    const reauth = Object.assign(new Error('Password required'), { code: 'REAUTH_REQUIRED', status: 401 });
    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true, result: {} }).mockRejectedValueOnce(reauth);
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await expect(result.current.startWithStartChecklist(args())).rejects.toBe(reauth);
    });
  });
});

describe('startWithStartChecklist — offline (both writes queued)', () => {
  it('the row gets the cycle stub at START, the answer is logged against it, and the tape no longer asks it', async () => {
    onlineRef.current = false;
    mockExecuteOrQueue.mockResolvedValue({ executed: false });
    const { result } = renderHook(() => useFilterOperationsCore());
    let out: any;
    await act(async () => { out = await result.current.startWithStartChecklist(args()); });

    expect(out).toEqual({ status: 'answered', startExecuted: false, checklistExecuted: false });
    const row = store.get(KEY);
    expect(row.currentState).toBeNull();
    expect(row.currentCycle).toMatchObject({ id: expect.stringMatching(/^offline-/), status: 'IN_PROGRESS', cleaningAreaId: 'b1' });
    expect(row.checklistCompletions).toEqual([
      expect.objectContaining({ checklistProfileId: 'cl-start', afterStage: null, cycleId: row.currentCycle.id }),
    ]);
    // the queued answer clears the mirror and re-derives the tape locally
    expect(mockGetCurrentActions).toHaveBeenCalledWith('f1', null);
    expect(row.pendingChecklist).toEqual([]);
    expect(row.actions).toEqual([ADVANCE_WASH_IN]);
    expect(row.nextAllowedStages).toEqual(['WASH_IN']);
  });

  it('keeps an existing cycle on the row (a stub is only made when there is none)', async () => {
    onlineRef.current = false;
    store.set(KEY, { currentState: null, currentCycle: { id: 'cyc-7', status: 'IN_PROGRESS' }, pipelineGraph: GRAPH });
    mockExecuteOrQueue.mockResolvedValue({ executed: false });
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => { await result.current.startWithStartChecklist(args()); });
    expect(store.get(KEY).currentCycle.id).toBe('cyc-7');
    expect(store.get(KEY).checklistCompletions[0].cycleId).toBe('cyc-7');
  });
});

describe('startAndAdvance refuses a profile with a START checklist (never the compound op)', () => {
  it('nothing is sent or queued; the refusal names the rule', async () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    let thrown: any = null;
    await act(async () => {
      try {
        await result.current.startAndAdvance({
          filterId: 'f1', filterName: 'F-1', cyclePayload: { cleaningReasonKey: 'PM' },
          advancePayload: { targetState: 'WASH_IN' }, targetState: 'WASH_IN',
        });
      } catch (e) { thrown = e; }
    });
    expect(thrown).toMatchObject({ code: 'START_CHECKLIST_REQUIRED' });
    expect(thrown.message).toMatch(/F-1/);
    expect(mockExecuteOrQueue).not.toHaveBeenCalled();
  });

  it('a DISABLED START checklist does not block (it is skipped, as on the server)', async () => {
    store.set(KEY, { currentState: null, currentCycle: null, pipelineGraph: GRAPH, disabledChecklistProfileIds: ['cl-start'] });
    mockExecuteOrQueue.mockResolvedValue({ executed: true, result: { actions: [] } });
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.startAndAdvance({
        filterId: 'f1', filterName: 'F-1', cyclePayload: {}, advancePayload: { targetState: 'WASH_IN' }, targetState: 'WASH_IN',
      });
    });
    expect(mockExecuteOrQueue.mock.calls[0][0]).toBe('start-and-advance');
  });
});
