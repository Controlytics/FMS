import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Tests for useFilterOperationsCore — the headless hook that owns dialog
 * state + executeOrQueue orchestration for the cleaning-cycle workflow.
 *
 * Day 1 baseline asserts (commit `98b6b6c`):
 *   1. advance() that produces no checklist gate leaves dialogState idle.
 *   2. advance() that produces a checklist gate dispatches open_checklist.
 *   3. submitChecklist() with empty remainingBatch closes the dialog.
 *   4. submitChecklist() with remainingBatch pops the next pending filter
 *      (D1 batch fix: pre-fix the loop dropped subsequent filters silently).
 *   5. REAUTH errors PROPAGATE — the hook does not swallow (D6 contract).
 *   6. OFFLINE_CACHE_RECOMPUTE_FAILED PROPAGATES (D3b contract).
 *
 * Day 3 additions (this commit):
 *   7. advance() forwards the full payload — cleaningAreaId, equipmentGroupId,
 *      instrumentReadings, dryerAction, dryerDurationMinutes.
 *   8. advance() offline calls recomputeAndCacheFilterState with
 *      cycleStarted=false so the cache row reflects the new stage.
 *   9. advance() forwards the reauth password to executeOrQueue.
 *  10. startAndAdvance() posts via 'start-and-advance' op type.
 *  11. startAndAdvance() offline calls recomputeAndCacheFilterState with
 *      cycleStarted=true so the cache row gets the cycle stub.
 *  12. startAndAdvance() dispatches open_checklist when the post-advance
 *      tape carries a SUBMIT_CHECKLIST action.
 *  13. submitChecklist() offline clears pendingChecklist + re-derives tape on
 *      the cache row (21 CFR — without this the next gate sees the stale
 *      pending payload and refuses to advance).
 *  14. submitChecklist() offline cache-clear failure is swallowed and does
 *      NOT cause the hook to throw OFFLINE_CACHE_RECOMPUTE_FAILED (matches
 *      legacy try/catch behaviour at mobile-operations.tsx:1397-1415).
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────
const {
  mockExecuteOrQueue,
  mockResolvePending,
  mockFindNext,
  mockGetCurrentActions,
  mockRecomputeCache,
  mockAppendCompletion,
  mockGetCachedData,
  mockCacheData,
} = vi.hoisted(() => ({
  mockExecuteOrQueue: vi.fn(),
  mockResolvePending: vi.fn(),
  mockFindNext: vi.fn(),
  mockGetCurrentActions: vi.fn(),
  mockRecomputeCache: vi.fn(),
  mockAppendCompletion: vi.fn(),
  mockGetCachedData: vi.fn(),
  mockCacheData: vi.fn(),
}));

vi.mock('../../../hooks/use-offline', () => ({
  useOffline: () => ({ executeOrQueue: mockExecuteOrQueue }),
}));

vi.mock('../resolve-pending-checklist', () => ({
  resolvePendingChecklistDialog: mockResolvePending,
}));

vi.mock('../next-pending-checklist', () => ({
  findNextPendingChecklist: mockFindNext,
}));

vi.mock('@/lib/action-tape', () => ({
  getCurrentActions: mockGetCurrentActions,
}));

vi.mock('@/lib/offline-cache', () => ({
  recomputeAndCacheFilterState: mockRecomputeCache,
  appendChecklistCompletion: mockAppendCompletion,
}));

vi.mock('@/lib/offline-store', () => ({
  getCachedData: mockGetCachedData,
  cacheData: mockCacheData,
  OFFLINE_TTL_MS: 86_400_000,
}));

import { useFilterOperationsCore } from '../use-core';

describe('useFilterOperationsCore — Day 1 baseline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteOrQueue.mockResolvedValue({ executed: true, result: { actions: [] } });
    mockResolvePending.mockResolvedValue(null);
    mockFindNext.mockResolvedValue(null);
    mockRecomputeCache.mockResolvedValue(undefined);
    mockAppendCompletion.mockResolvedValue(undefined);
    mockGetCachedData.mockResolvedValue({});
    mockCacheData.mockResolvedValue(undefined);
    mockGetCurrentActions.mockResolvedValue([]);
  });

  it('starts with dialogState.kind === "none"', () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    expect(result.current.dialogState.kind).toBe('none');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('advance() with no pending checklist leaves dialogState idle', async () => {
    mockResolvePending.mockResolvedValue(null);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_IN',
      });
    });

    expect(result.current.dialogState.kind).toBe('none');
    expect(mockExecuteOrQueue).toHaveBeenCalledWith(
      'advance',
      'f1',
      'F-1',
      expect.objectContaining({ targetState: 'WASH_IN' }),
      'WASH_IN',
      undefined,
    );
  });

  it('advance() with a pending checklist dispatches open_checklist', async () => {
    mockResolvePending.mockResolvedValue([
      { id: 'cl1', questions: [{ id: 'q1', text: 'OK?', type: 'YES_NO' }] },
    ]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    expect(result.current.dialogState.kind).toBe('awaiting_checklist');
    if (result.current.dialogState.kind === 'awaiting_checklist') {
      expect(result.current.dialogState.filterId).toBe('f1');
      expect(result.current.dialogState.filterName).toBe('F-1');
      expect(result.current.dialogState.checklists).toHaveLength(1);
    }
  });

  it('submitChecklist() with empty remainingBatch closes the dialog', async () => {
    mockResolvePending.mockResolvedValueOnce([{ id: 'cl1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });
    expect(result.current.dialogState.kind).toBe('awaiting_checklist');

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: { q1: 'YES' },
      });
    });
    expect(result.current.dialogState.kind).toBe('none');
  });

  it('submitChecklist() walks remainingBatch and opens dialog for next pending filter (D1 batch fix)', async () => {
    mockResolvePending.mockResolvedValueOnce([{ id: 'cl-f1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
        batchRemainder: [
          { filterId: 'f2', filterName: 'F-2' },
          { filterId: 'f3', filterName: 'F-3' },
        ],
      });
    });
    expect(result.current.dialogState.kind).toBe('awaiting_checklist');

    mockFindNext.mockResolvedValueOnce({
      item: { filterId: 'f2', filterName: 'F-2' },
      checklists: [{ id: 'cl-f2', questions: [] }],
      remaining: [{ filterId: 'f3', filterName: 'F-3' }],
    });

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: { q1: 'YES' },
      });
    });

    expect(result.current.dialogState.kind).toBe('awaiting_checklist');
    if (result.current.dialogState.kind === 'awaiting_checklist') {
      expect(result.current.dialogState.filterId).toBe('f2');
      expect(result.current.dialogState.remainingBatch).toEqual([
        { filterId: 'f3', filterName: 'F-3' },
      ]);
    }
  });

  it('submitChecklist() closes when findNextPendingChecklist returns null even with non-empty remainder', async () => {
    mockResolvePending.mockResolvedValueOnce([{ id: 'cl-f1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
        batchRemainder: [{ filterId: 'f2', filterName: 'F-2' }],
      });
    });
    expect(result.current.dialogState.kind).toBe('awaiting_checklist');

    mockFindNext.mockResolvedValueOnce(null);

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: {},
      });
    });
    expect(result.current.dialogState.kind).toBe('none');
  });

  it('advance() propagates REAUTH_REQUIRED (does NOT swallow into error state — D6 contract)', async () => {
    mockExecuteOrQueue.mockRejectedValueOnce({ error: 'REAUTH_REQUIRED', message: 'reauth' });

    const { result } = renderHook(() => useFilterOperationsCore());
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.advance({
          filterId: 'f1',
          filterName: 'F-1',
          targetState: 'WASH_IN',
        });
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toMatchObject({ error: 'REAUTH_REQUIRED' });
    expect(result.current.error).toBeNull();
  });

  it('advance() propagates REAUTH_FAILED', async () => {
    mockExecuteOrQueue.mockRejectedValueOnce({ error: 'REAUTH_FAILED', message: 'bad password' });

    const { result } = renderHook(() => useFilterOperationsCore());
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.advance({
          filterId: 'f1',
          filterName: 'F-1',
          targetState: 'WASH_IN',
        });
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toMatchObject({ error: 'REAUTH_FAILED' });
  });

  it('advance() propagates OFFLINE_CACHE_RECOMPUTE_FAILED (D3b contract)', async () => {
    const err = new Error('IDB write failed') as Error & { code?: string };
    err.code = 'OFFLINE_CACHE_RECOMPUTE_FAILED';
    mockExecuteOrQueue.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useFilterOperationsCore());
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.advance({
          filterId: 'f1',
          filterName: 'F-1',
          targetState: 'WASH_IN',
        });
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toMatchObject({ code: 'OFFLINE_CACHE_RECOMPUTE_FAILED' });
  });

  it('advance() sets error state for generic non-special errors', async () => {
    mockExecuteOrQueue.mockRejectedValueOnce(new Error('Network timeout'));

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      try {
        await result.current.advance({
          filterId: 'f1',
          filterName: 'F-1',
          targetState: 'WASH_IN',
        });
      } catch {
        /* generic errors don't throw — they go to error state */
      }
    });
    expect(result.current.error).toBe('Network timeout');
  });

  it('clearError() resets the error state', async () => {
    mockExecuteOrQueue.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      try {
        await result.current.advance({
          filterId: 'f1',
          filterName: 'F-1',
          targetState: 'WASH_IN',
        });
      } catch { /* */ }
    });
    expect(result.current.error).toBe('boom');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

describe('useFilterOperationsCore — Day 3 extended handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteOrQueue.mockResolvedValue({ executed: true, result: { actions: [] } });
    mockResolvePending.mockResolvedValue(null);
    mockFindNext.mockResolvedValue(null);
    mockRecomputeCache.mockResolvedValue(undefined);
    mockAppendCompletion.mockResolvedValue(undefined);
    mockGetCachedData.mockResolvedValue({});
    mockCacheData.mockResolvedValue(undefined);
    mockGetCurrentActions.mockResolvedValue([]);
  });

  it('advance() forwards the full payload (cleaningAreaId, equipmentGroupId, instrumentReadings, dryerAction)', async () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'DRY_IN',
        cleaningAreaId: 'block-a',
        equipmentGroupId: 'eg-1',
        instrumentReadings: { 'inst-1': 25 },
        dryerAction: 'SUBMIT_READINGS',
        dryerDurationMinutes: 15,
        remarks: 'custom',
      });
    });

    expect(mockExecuteOrQueue).toHaveBeenCalledWith(
      'advance',
      'f1',
      'F-1',
      expect.objectContaining({
        targetState: 'DRY_IN',
        cleaningAreaId: 'block-a',
        equipmentGroupId: 'eg-1',
        instrumentReadings: { 'inst-1': 25 },
        dryerAction: 'SUBMIT_READINGS',
        dryerDurationMinutes: 15,
        remarks: 'custom',
      }),
      'DRY_IN',
      undefined,
    );
  });

  it('advance() strips undefined keys from payload', async () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_IN',
        // No cleaningAreaId / equipmentGroupId / etc.
      });
    });

    const sentPayload = mockExecuteOrQueue.mock.calls[0][3];
    expect(sentPayload).not.toHaveProperty('cleaningAreaId');
    expect(sentPayload).not.toHaveProperty('equipmentGroupId');
    expect(sentPayload).not.toHaveProperty('instrumentReadings');
    expect(sentPayload).not.toHaveProperty('dryerAction');
    expect(sentPayload).toHaveProperty('targetState', 'WASH_IN');
    expect(sentPayload).toHaveProperty('remarks');
  });

  it('advance() forwards reauth password', async () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_IN',
        password: 'p@ss',
      });
    });

    expect(mockExecuteOrQueue).toHaveBeenCalledWith(
      'advance',
      'f1',
      'F-1',
      expect.any(Object),
      'WASH_IN',
      'p@ss',
    );
  });

  it('advance() offline (executed=false) calls recomputeAndCacheFilterState with cycleStarted=false', async () => {
    mockExecuteOrQueue.mockResolvedValueOnce({ executed: false, result: undefined });

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_IN',
        cleaningAreaId: 'block-a',
      });
    });

    expect(mockRecomputeCache).toHaveBeenCalledWith('f1', 'WASH_IN', false, 'block-a');
  });

  it('advance() online (executed=true) does NOT call recomputeAndCacheFilterState', async () => {
    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true, result: { actions: [] } });

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_IN',
      });
    });

    expect(mockRecomputeCache).not.toHaveBeenCalled();
  });

  it('startAndAdvance() posts via "start-and-advance" op type with compound payload', async () => {
    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.startAndAdvance({
        filterId: 'f1',
        filterName: 'F-1',
        cyclePayload: { cleaningReasonKey: 'PERIODIC' },
        advancePayload: { targetState: 'WASH_IN' },
        targetState: 'WASH_IN',
        cleaningAreaId: 'block-a',
        password: 'p@ss',
      });
    });

    expect(mockExecuteOrQueue).toHaveBeenCalledWith(
      'start-and-advance',
      'f1',
      'F-1',
      {
        cyclePayload: { cleaningReasonKey: 'PERIODIC' },
        advancePayload: { targetState: 'WASH_IN' },
      },
      'WASH_IN',
      'p@ss',
    );
  });

  it('startAndAdvance() offline calls recomputeAndCacheFilterState with cycleStarted=true', async () => {
    mockExecuteOrQueue.mockResolvedValueOnce({ executed: false, result: undefined });

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.startAndAdvance({
        filterId: 'f1',
        filterName: 'F-1',
        cyclePayload: {},
        advancePayload: {},
        targetState: 'WASH_IN',
        cleaningAreaId: 'block-a',
      });
    });

    expect(mockRecomputeCache).toHaveBeenCalledWith('f1', 'WASH_IN', true, 'block-a');
  });

  it('startAndAdvance() dispatches open_checklist when post-advance tape carries SUBMIT_CHECKLIST', async () => {
    mockResolvePending.mockResolvedValueOnce([
      { id: 'cl-f1', questions: [{ id: 'q1', text: 'OK?' }] },
    ]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.startAndAdvance({
        filterId: 'f1',
        filterName: 'F-1',
        cyclePayload: {},
        advancePayload: {},
        targetState: 'WASH_IN',
      });
    });

    expect(result.current.dialogState.kind).toBe('awaiting_checklist');
  });

  it('startAndAdvance() propagates REAUTH_REQUIRED', async () => {
    mockExecuteOrQueue.mockRejectedValueOnce({ error: 'REAUTH_REQUIRED', message: 'reauth' });

    const { result } = renderHook(() => useFilterOperationsCore());
    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.startAndAdvance({
          filterId: 'f1',
          filterName: 'F-1',
          cyclePayload: {},
          advancePayload: {},
          targetState: 'WASH_IN',
        });
      } catch (e) { thrown = e; }
    });
    expect(thrown).toMatchObject({ error: 'REAUTH_REQUIRED' });
  });

  it('submitChecklist() offline clears pendingChecklist and re-derives nextAllowedStages + actions on cache row', async () => {
    mockResolvePending.mockResolvedValueOnce([{ id: 'cl-f1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    mockExecuteOrQueue.mockResolvedValueOnce({ executed: false });
    mockGetCachedData.mockResolvedValueOnce({ existing: 'data', pendingChecklist: [{ id: 'cl' }] });
    mockGetCurrentActions.mockResolvedValueOnce([
      { type: 'ADVANCE_TO_STAGE', params: { targetState: 'DRY_IN' } },
      { type: 'SET_DRYER_DURATION', params: { targetState: 'DRY_IN' } },
    ]);

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: { q1: 'YES' },
      });
    });

    // First cacheData call: cleared pendingChecklist
    expect(mockCacheData).toHaveBeenNthCalledWith(
      1,
      'filter-state-f1',
      expect.objectContaining({ pendingChecklist: [] }),
      expect.any(Number),
    );

    // Second cacheData call: nextAllowedStages + actions re-derived from tape
    expect(mockCacheData).toHaveBeenNthCalledWith(
      2,
      'filter-state-f1',
      expect.objectContaining({
        pendingChecklist: [],
        nextAllowedStages: ['DRY_IN', 'DRY_IN'],
        actions: expect.any(Array),
      }),
      expect.any(Number),
    );
  });

  it('submitChecklist() offline cache-clear failure is swallowed — does NOT throw OFFLINE_CACHE_RECOMPUTE_FAILED', async () => {
    mockResolvePending.mockResolvedValueOnce([{ id: 'cl-f1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    mockExecuteOrQueue.mockResolvedValueOnce({ executed: false });
    mockGetCachedData.mockRejectedValueOnce(new Error('IDB unavailable'));

    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.submitChecklist({
          filterId: 'f1',
          filterName: 'F-1',
          answers: {},
        });
      } catch (e) { thrown = e; }
    });

    expect(thrown).toBeNull();
    // Dialog still closes despite the cache-clear failure.
    expect(result.current.dialogState.kind).toBe('none');
  });

  it('submitChecklist() calls appendChecklistCompletion for each profile in the dialog (Tier 1 log — 21 CFR)', async () => {
    // Open a checklist dialog with 2 profiles
    mockResolvePending.mockResolvedValueOnce([
      { checklistProfileId: 'p1', questions: [] },
      { checklistProfileId: 'p2', questions: [] },
    ]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true });
    // Cache row says currentState=WASH_OUT, cycleId=cyc-1
    mockGetCachedData.mockResolvedValueOnce({
      currentState: 'WASH_OUT',
      currentCycle: { id: 'cyc-1' },
    });

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: { q1: 'YES' },
      });
    });

    expect(mockAppendCompletion).toHaveBeenCalledTimes(2);
    expect(mockAppendCompletion).toHaveBeenNthCalledWith(1, 'f1', expect.objectContaining({
      checklistProfileId: 'p1',
      afterStage: 'WASH_OUT',
      cycleId: 'cyc-1',
      completedAt: expect.any(String),
    }));
    expect(mockAppendCompletion).toHaveBeenNthCalledWith(2, 'f1', expect.objectContaining({
      checklistProfileId: 'p2',
      afterStage: 'WASH_OUT',
      cycleId: 'cyc-1',
    }));
  });

  it('submitChecklist() skips appendChecklistCompletion when cache row has no currentState (defensive)', async () => {
    mockResolvePending.mockResolvedValueOnce([{ checklistProfileId: 'p1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true });
    mockGetCachedData.mockResolvedValueOnce({}); // no currentState

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: {},
      });
    });

    expect(mockAppendCompletion).not.toHaveBeenCalled();
  });

  it('submitChecklist() swallows appendChecklistCompletion failures (best-effort log)', async () => {
    mockResolvePending.mockResolvedValueOnce([{ checklistProfileId: 'p1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true });
    mockGetCachedData.mockResolvedValueOnce({
      currentState: 'WASH_OUT',
      currentCycle: { id: 'cyc-1' },
    });
    mockAppendCompletion.mockRejectedValueOnce(new Error('IDB write failed'));

    let thrown: unknown = null;
    await act(async () => {
      try {
        await result.current.submitChecklist({
          filterId: 'f1',
          filterName: 'F-1',
          answers: {},
        });
      } catch (e) { thrown = e; }
    });

    expect(thrown).toBeNull();
    expect(result.current.dialogState.kind).toBe('none');
  });

  it('submitChecklist() online (executed=true) does NOT mutate the cache row (only reads for log)', async () => {
    mockResolvePending.mockResolvedValueOnce([{ checklistProfileId: 'p1', questions: [] }]);

    const { result } = renderHook(() => useFilterOperationsCore());
    await act(async () => {
      await result.current.advance({
        filterId: 'f1',
        filterName: 'F-1',
        targetState: 'WASH_OUT',
      });
    });

    mockExecuteOrQueue.mockResolvedValueOnce({ executed: true });
    mockGetCachedData.mockResolvedValueOnce({
      currentState: 'WASH_OUT',
      currentCycle: { id: 'cyc-1' },
    });

    await act(async () => {
      await result.current.submitChecklist({
        filterId: 'f1',
        filterName: 'F-1',
        answers: {},
      });
    });

    // getCachedData is called once for the appendChecklistCompletion lookup,
    // but no cache-row-clear / nextAllowedStages re-derive runs online.
    expect(mockCacheData).not.toHaveBeenCalled();
  });
});
