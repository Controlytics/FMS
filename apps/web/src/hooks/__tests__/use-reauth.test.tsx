import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Control needsReauth by mocking the SWR my-actions fetch.
const h = vi.hoisted(() => ({ actions: [] as string[] }));
vi.mock('swr', () => ({ default: () => ({ data: { actions: h.actions } }) }));

import { useReauth } from '../use-reauth';

describe('useReauth.executeWithResult', () => {
  beforeEach(() => { h.actions = []; });

  it('returns the callback result when the action is not reauth-gated', async () => {
    const { result } = renderHook(() => useReauth());
    let out: unknown;
    await act(async () => {
      out = await result.current.executeWithResult('NOT_GATED', async () => ({ results: [1, 2] }));
    });
    expect(out).toEqual({ results: [1, 2] });
  });

  it('re-throws a non-REAUTH error instead of swallowing it (unlike execute)', async () => {
    const { result } = renderHook(() => useReauth());
    await act(async () => {
      await expect(
        result.current.executeWithResult('NOT_GATED', async () => { throw new Error('network down'); }),
      ).rejects.toThrow('network down');
    });
  });

  it('opens the password dialog for a gated action and resolves with the result after confirm', async () => {
    h.actions = ['GATED'];
    const { result } = renderHook(() => useReauth());
    const cb = vi.fn(async (password?: string) => ({ ok: true, password }));

    let promise: Promise<unknown> | undefined;
    act(() => { promise = result.current.executeWithResult('GATED', cb); });

    // Dialog opens; callback has NOT run yet (deferred to confirm).
    await waitFor(() => expect(result.current.isOpen).toBe(true));
    expect(cb).not.toHaveBeenCalled();

    act(() => { result.current.setPassword('secret'); });
    await act(async () => { await result.current.confirm(); });

    await expect(promise!).resolves.toEqual({ ok: true, password: 'secret' });
    expect(cb).toHaveBeenCalledWith('secret');
    expect(result.current.isOpen).toBe(false);
  });

  it('rejects with REAUTH_CANCELLED when the operator cancels the dialog', async () => {
    h.actions = ['GATED'];
    const { result } = renderHook(() => useReauth());

    let promise: Promise<unknown> | undefined;
    act(() => { promise = result.current.executeWithResult('GATED', async () => 'never runs'); });
    await waitFor(() => expect(result.current.isOpen).toBe(true));

    act(() => { result.current.cancel(); });
    await expect(promise!).rejects.toEqual({ error: 'REAUTH_CANCELLED' });
  });
});
