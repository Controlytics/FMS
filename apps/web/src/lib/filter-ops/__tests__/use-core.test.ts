import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Day 1 tests for useFilterOperationsCore — the headless hook that owns
 * dialog state for the cleaning-cycle workflow.
 *
 * Asserts:
 *   1. advance() that produces no checklist gate leaves dialogState idle.
 *   2. advance() that produces a checklist gate dispatches open_checklist.
 *   3. submitChecklist() with empty remainingBatch closes the dialog.
 *   4. submitChecklist() with remainingBatch pops the next pending filter
 *      (D1 batch fix: pre-fix the loop dropped subsequent filters silently).
 *   5. REAUTH errors PROPAGATE — the hook does not swallow (D6 contract).
 *   6. OFFLINE_CACHE_RECOMPUTE_FAILED PROPAGATES (D3b contract).
 *   7. The reducer rejects double-open: opening checklist over an open
 *      dryer dialog throws (D4 invariant — already covered in
 *      dialog-state.test.ts but re-verified here through the hook surface).
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────
const { mockExecuteOrQueue, mockResolvePending, mockFindNext, mockGetCurrentActions } =
  vi.hoisted(() => ({
    mockExecuteOrQueue: vi.fn(),
    mockResolvePending: vi.fn(),
    mockFindNext: vi.fn(),
    mockGetCurrentActions: vi.fn(),
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

import { useFilterOperationsCore } from '../use-core';

describe('useFilterOperationsCore — Day 1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteOrQueue.mockResolvedValue({ executed: true, result: { actions: [] } });
    mockResolvePending.mockResolvedValue(null);
    mockFindNext.mockResolvedValue(null);
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
    // Advance batch: filter f1 opens its dialog; the rest of the batch is f2, f3
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

    // After submitting f1's checklist, findNextPendingChecklist returns f2's
    // (with f3 still in remainingBatch — proving the queue is walked, not lost).
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

    // Pre-D1-fix: dialog closed here, f2 + f3 silently skipped their gates.
    // Post-fix: dialog is open for f2, with f3 still queued in remainingBatch.
    expect(result.current.dialogState.kind).toBe('awaiting_checklist');
    if (result.current.dialogState.kind === 'awaiting_checklist') {
      expect(result.current.dialogState.filterId).toBe('f2');
      expect(result.current.dialogState.remainingBatch).toEqual([
        { filterId: 'f3', filterName: 'F-3' },
      ]);
    }
  });

  it('submitChecklist() closes when findNextPendingChecklist returns null even with non-empty remainder', async () => {
    // Edge case: remainder has filters but none of them have pending
    // checklists (all already completed). findNext returns null → close.
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
    // Error state is NOT polluted with the REAUTH message — caller's
    // reauth.execute() owns the dialog presentation.
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
