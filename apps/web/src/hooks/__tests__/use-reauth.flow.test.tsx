/**
 * useReauth end to end with the REAL SWR data path (coverage campaign
 * 2026-10-21): which actions prompt comes from GET
 * /api/config/action-reauth/my-actions through the shared swrConfig fetcher,
 * and only global `fetch` is stubbed (page-harness mockApi). The sibling
 * use-reauth.test.tsx mocks `swr` instead and pins the cancel/supersede
 * contracts; this file covers confirm outcomes, the inline paths and the
 * dialog label.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi } from '@/test-utils/page-harness';
import { useReauth, isReauthCancelled } from '../use-reauth';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    {children}
  </SWRConfig>
);

/** Mount the hook with `gated` as the caller's re-auth rows, and wait until SWR has them. */
async function mount(gated: string[]) {
  const api = mockApi([{ path: '/api/config/action-reauth/my-actions', body: { actions: gated } }]);
  const view = renderHook(() => useReauth(), { wrapper });
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
  if (gated.length) await waitFor(() => expect(view.result.current.needsReauth(gated[0])).toBe(true));
  return { ...view, api };
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.setItem('access_token', 't');
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('needsReauth', () => {
  it('prompts when ANY of several rows is switched on, and not for unlisted rows', async () => {
    const { result } = await mount(['STAGE_WASH_IN']);
    expect(result.current.needsReauth(['ADVANCE_FILTER_STAGE', 'STAGE_WASH_IN'])).toBe(true);
    expect(result.current.needsReauth('ADVANCE_FILTER_STAGE')).toBe(false);
    expect(result.current.needsReauth([])).toBe(false);
  });

  it('prompts for nothing until the role\'s rows have loaded, then follows them', async () => {
    mockApi([{ path: '/api/config/action-reauth/my-actions', body: { actions: ['ANY'] } }]);
    const { result } = renderHook(() => useReauth(), { wrapper });
    expect(result.current.needsReauth('ANY')).toBe(false); // first paint: no data yet
    await waitFor(() => expect(result.current.needsReauth('ANY')).toBe(true));
  });
});

describe('execute', () => {
  it('runs an ungated callback with no password and calls onSuccess', async () => {
    const { result } = await mount([]);
    const cb = vi.fn(async () => {});
    const onSuccess = vi.fn();
    await act(async () => { await result.current.execute('UNGATED', cb, { onSuccess }); });
    expect(cb).toHaveBeenCalledWith();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
  });

  it('passes an ungated non-REAUTH failure to onError and keeps the dialog shut', async () => {
    const { result } = await mount([]);
    const onError = vi.fn();
    const boom = new Error('409 conflict');
    await act(async () => { await result.current.execute('UNGATED', async () => { throw boom; }, { onError }); });
    expect(onError).toHaveBeenCalledWith(boom);
    expect(result.current.isOpen).toBe(false);
  });

  it('a gated action opens the dialog, labels it from the catalog, and runs with the password on confirm', async () => {
    const { result } = await mount(['APPROVE_BLOCK_CHANGE']);
    const cb = vi.fn(async (_pw?: string) => {});
    const onSuccess = vi.fn();
    await act(async () => { await result.current.execute('APPROVE_BLOCK_CHANGE', cb, { onSuccess }); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingActionLabel).toBe('Approve Block Change');
    expect(cb).not.toHaveBeenCalled();

    // confirm with an empty password is a no-op
    await act(async () => { await result.current.confirm(); });
    expect(cb).not.toHaveBeenCalled();
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.setPassword('pw'));
    expect(result.current.password).toBe('pw');
    await act(async () => { await result.current.confirm(); });
    expect(cb).toHaveBeenCalledWith('pw');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.password).toBe('');
    expect(result.current.pendingActionLabel).toBeUndefined();
  });

  it('with several rows, the FIRST key is the one the dialog names (execute and executeWithResult)', async () => {
    const { result } = await mount(['STAGE_WASH_IN']);
    await act(async () => { await result.current.execute(['APPROVE_BLOCK_CHANGE', 'STAGE_WASH_IN'], async () => {}); });
    expect(result.current.pendingActionLabel).toBe('Approve Block Change');
    act(() => result.current.cancel());
    let outcome!: Promise<unknown>;
    act(() => { outcome = result.current.executeWithResult(['EXPORT_FILTERS', 'STAGE_WASH_IN'], async () => 1).catch((e) => e); });
    await waitFor(() => expect(result.current.pendingActionLabel).toBe('Export Filters List'));
    act(() => result.current.cancel());
    expect(await outcome).toEqual({ error: 'REAUTH_CANCELLED' });
  });

  it('an unknown action key has no catalog label', async () => {
    const { result } = await mount(['CUSTOM_UNLISTED']);
    await act(async () => { await result.current.execute('CUSTOM_UNLISTED', async () => {}); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingActionLabel).toBeUndefined();
  });
});

describe('confirm outcomes', () => {
  async function openGated(cb: (pw?: string) => Promise<void>, opts: Parameters<ReturnType<typeof useReauth>['execute']>[2] = {}) {
    const view = await mount(['G']);
    await act(async () => { await view.result.current.execute('G', cb, opts); });
    act(() => view.result.current.setPassword('pw'));
    return view;
  }

  it('REAUTH_FAILED keeps the dialog open with "Incorrect password" and lets the operator retry', async () => {
    let attempt = 0;
    const onSuccess = vi.fn();
    const { result } = await openGated(async () => { attempt++; if (attempt === 1) throw { error: 'REAUTH_FAILED' }; }, { onSuccess });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.error).toBe('Incorrect password. Please try again.');
    expect(result.current.isVerifying).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => { await result.current.confirm(); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('REAUTH_REQUIRED during confirm says the password was not received', async () => {
    const { result } = await openGated(async () => { throw { error: 'REAUTH_REQUIRED' }; });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.error).toBe('Password is required. Please enter your password.');
  });

  it('any other failure closes the dialog and reaches onError', async () => {
    const onError = vi.fn();
    const failure = { error: 'NOT_FOUND', message: 'gone' };
    const { result } = await openGated(async () => { throw failure; }, { onError });
    await act(async () => { await result.current.confirm(); });
    expect(onError).toHaveBeenCalledWith(failure);
    expect(result.current.isOpen).toBe(false);
  });

  it('shows isVerifying while the signed call is in flight', async () => {
    let release!: () => void;
    const { result } = await openGated(() => new Promise<void>((r) => { release = r; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.confirm(); });
    await waitFor(() => expect(result.current.isVerifying).toBe(true));
    await act(async () => { release(); await pending; });
    expect(result.current.isVerifying).toBe(false);
    expect(result.current.isOpen).toBe(false);
  });
});

describe('executeWithResult', () => {
  it('runs inline and resolves the value when ungated; a synchronous throw still rejects', async () => {
    const { result } = await mount([]);
    await expect(result.current.executeWithResult('X', async () => 42)).resolves.toBe(42);
    await expect(result.current.executeWithResult('X', (() => { throw new Error('sync'); }) as unknown as () => Promise<number>)).rejects.toThrow('sync');
  });

  it('falls back to the dialog when the server still demands re-auth (stale my-actions), then resolves on confirm', async () => {
    const { result } = await mount([]);
    const cb = vi.fn(async (pw?: string) => { if (!pw) throw { error: 'REAUTH_REQUIRED' }; return `signed:${pw}`; });
    let p!: Promise<string>;
    act(() => { p = result.current.executeWithResult('EXPORT_FILTERS', cb); });
    await waitFor(() => expect(result.current.isOpen).toBe(true));
    expect(result.current.pendingActionLabel).toBe('Export Filters List');
    act(() => result.current.setPassword('pw'));
    await act(async () => { await result.current.confirm(); });
    await expect(p).resolves.toBe('signed:pw');
  });

  it('rejects with the callback error (and closes) when the signed call fails for another reason', async () => {
    const { result } = await mount(['G']);
    let outcome!: Promise<unknown>;
    // Capture the settlement at once so the rejection is never "unhandled".
    act(() => { outcome = result.current.executeWithResult('G', async () => { throw new Error('server 500'); }).catch((e) => e); });
    await waitFor(() => expect(result.current.isOpen).toBe(true));
    act(() => result.current.setPassword('pw'));
    await act(async () => { await result.current.confirm(); });
    expect(await outcome).toEqual(new Error('server 500'));
    expect(result.current.isOpen).toBe(false);
  });

  it('a later execute() on the same hook supersedes a pending executeWithResult promise', async () => {
    const { result } = await mount(['G']);
    let first!: Promise<unknown>;
    act(() => { first = result.current.executeWithResult('G', async () => 'never').catch((e) => e); });
    await waitFor(() => expect(result.current.isOpen).toBe(true));
    await act(async () => { await result.current.execute('G', async () => {}); });
    expect(await first).toEqual({ error: 'REAUTH_SUPERSEDED' });
    expect(result.current.isOpen).toBe(true);
  });

  it('cancelling with nothing pending just closes', async () => {
    const { result } = await mount([]);
    act(() => result.current.cancel());
    expect(result.current.isOpen).toBe(false);
  });
});

describe('isReauthCancelled', () => {
  it('matches only the cancel sentinel', () => {
    expect(isReauthCancelled({ error: 'REAUTH_CANCELLED' })).toBe(true);
    expect(isReauthCancelled({ error: 'REAUTH_FAILED' })).toBe(false);
    expect(isReauthCancelled(null)).toBe(false);
    expect(isReauthCancelled(undefined)).toBe(false);
  });
});
