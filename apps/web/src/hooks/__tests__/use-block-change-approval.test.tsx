/**
 * useBlockChangeApproval — the ONE approve/reject path shared by the
 * Approvals page and the tablet (coverage campaign 2026-10-21). Real
 * useReauth + SWR; only global `fetch` is stubbed (page-harness mockApi).
 *
 * The hook revalidates its `mutateKeys` through swr's GLOBAL `mutate`, which
 * only reaches the default cache — so this wrapper deliberately uses SWR's
 * default cache (as main.tsx does) with keys unique to each test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useSWR, { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi, type MockRequest } from '@/test-utils/page-harness';
import { useBlockChangeApproval } from '../use-block-change-approval';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>{children}</SWRConfig>
);
// A private cache for tests that depend on the role's re-auth rows: useReauth
// dedupes my-actions for 5 s, so the default cache would serve an earlier test's rows.
const isolatedWrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>{children}</SWRConfig>
);

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

let seq = 0;
function setup(gated: string[], extraRoutes: Parameters<typeof mockApi>[0] = [], isolated = false) {
  seq += 1;
  const listKey = `/api/block-change-requests?t=${seq}`;
  const countKey = `/api/block-change-requests/pending-count?t=${seq}`;
  const api = mockApi([
    { path: '/api/config/action-reauth/my-actions', body: { actions: gated } },
    { path: '/api/block-change-requests', body: [] },
    { path: '/api/block-change-requests/pending-count', body: { count: 1 } },
    ...extraRoutes,
  ]);
  const view = renderHook(() => {
    const h = useBlockChangeApproval();
    useSWR(listKey);
    useSWR(countKey);
    return h;
  }, { wrapper: isolated ? isolatedWrapper : wrapper });
  return { ...view, api, listKey, countKey };
}

const listCalls = (api: ReturnType<typeof mockApi>, key: string) => api.requests.filter((r) => r.url === key).length;

describe('useBlockChangeApproval', () => {
  it('approves without re-auth, sends the comment, revalidates the given keys and calls onSuccess', async () => {
    const { result, api, listKey, countKey } = setup([], [
      { method: 'POST', path: '/api/block-change-requests/r1/approve', body: (req: MockRequest) => ({ ok: true, got: req.json }) },
    ]);
    await waitFor(() => expect(listCalls(api, listKey)).toBe(1));
    await waitFor(() => expect(listCalls(api, countKey)).toBe(1));
    const onSuccess = vi.fn();
    await act(async () => { result.current.process('r1', 'approve', 'Looks right', { mutateKeys: [listKey, countKey], onSuccess }); });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const post = api.calls('POST', '/api/block-change-requests/r1/approve');
    expect(post).toHaveLength(1);
    expect(post[0].json).toEqual({ comment: 'Looks right' });
    expect(post[0].headers['x-reauth-password']).toBeUndefined();
    await waitFor(() => expect(listCalls(api, listKey)).toBe(2));
    await waitFor(() => expect(listCalls(api, countKey)).toBe(2));
  });

  it('rejects with an empty comment sent as absent, and without mutateKeys revalidates nothing', async () => {
    const { result, api, listKey } = setup([], [
      { method: 'POST', path: '/api/block-change-requests/r2/reject', body: {} },
    ]);
    await waitFor(() => expect(listCalls(api, listKey)).toBe(1));
    const onSuccess = vi.fn();
    await act(async () => { result.current.process('r2', 'reject', '', { onSuccess }); });
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(api.calls('POST', '/api/block-change-requests/r2/reject')[0].json).toEqual({});
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(listCalls(api, listKey)).toBe(1);
  });

  it('with no options at all still posts (defaults are safe)', async () => {
    const { result, api } = setup([], [{ method: 'POST', path: '/api/block-change-requests/r5/approve', body: {} }]);
    await act(async () => { result.current.process('r5', 'approve', 'ok fine'); });
    await waitFor(() => expect(api.calls('POST', '/api/block-change-requests/r5/approve')).toHaveLength(1));
  });

  it('when the role has the row switched on, prompts first and signs the POST with the password', async () => {
    const { result, api } = setup(['REJECT_BLOCK_CHANGE'], [
      { method: 'POST', path: '/api/block-change-requests/r3/reject', body: {} },
    ], true);
    await waitFor(() => expect(result.current.reauth.needsReauth('REJECT_BLOCK_CHANGE')).toBe(true));
    const onSuccess = vi.fn();
    await act(async () => { result.current.process('r3', 'reject', 'Wrong block', { onSuccess }); });
    expect(result.current.reauth.isOpen).toBe(true);
    expect(result.current.reauth.pendingActionLabel).toBe('Reject Block Change');
    expect(api.calls('POST', '/api/block-change-requests/r3/reject')).toHaveLength(0);

    act(() => result.current.reauth.setPassword('pw'));
    await act(async () => { await result.current.reauth.confirm(); });
    const post = api.calls('POST', '/api/block-change-requests/r3/reject');
    expect(post).toHaveLength(1);
    expect(post[0].headers['x-reauth-password']).toBe('pw');
    expect(post[0].json).toEqual({ comment: 'Wrong block', _currentPassword: 'pw' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('a refused decision reaches onError with the server code and does not call onSuccess', async () => {
    const { result } = setup([], [
      { method: 'POST', path: '/api/block-change-requests/r4/approve', status: 409, body: { error: 'ALREADY_DECIDED', message: 'Already approved' } },
    ]);
    const onError = vi.fn();
    const onSuccess = vi.fn();
    await act(async () => { result.current.process('r4', 'approve', 'x', { onError, onSuccess }); });
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toMatchObject({ status: 409, code: 'ALREADY_DECIDED', message: 'Already approved' });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
