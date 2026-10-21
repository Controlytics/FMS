/**
 * retireOrReplaceFilter — the ONE retire/replace path shared by the web filter
 * list and the tablet Replace view. Runs against the REAL useReauth hook and the
 * REAL apiClient; only global `fetch` is stubbed (page-harness mockApi), so the
 * endpoint, body and password header that reach the server are asserted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi, type MockApi, type MockRequest } from '@/test-utils/page-harness';
import { useReauth } from '@/hooks/use-reauth';
import { retireOrReplaceFilter } from '../filter-lifecycle-actions';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    {children}
  </SWRConfig>
);

let api: MockApi;
beforeEach(() => { sessionStorage.setItem('access_token', 'tok'); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

async function setupReauth(gated: string[]) {
  const hook = renderHook(() => useReauth(), { wrapper });
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
  await waitFor(() => expect(hook.result.current.needsReauth(gated[0] ?? 'NONE')).toBe(gated.length > 0));
  return hook;
}

describe('retireOrReplaceFilter', () => {
  it('retire, no password required: POSTs the trimmed remarks to /retire and reports the result', async () => {
    api = mockApi([
      { path: '/api/config/action-reauth/my-actions', body: { actions: [] } },
      { method: 'POST', path: '/api/filters/f-1/retire', body: { success: true } },
    ]);
    const { result } = await setupReauth([]);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    await act(async () => { await retireOrReplaceFilter(result.current, 'retire', 'f-1', '  damaged frame  ', { onSuccess, onError }); });
    const [req] = api.calls('POST', '/api/filters/f-1/retire');
    expect(req.json).toEqual({ remarks: 'damaged frame' });
    expect(req.headers['x-reauth-password']).toBeUndefined();
    expect(onSuccess).toHaveBeenCalledWith({ success: true });
    expect(onError).not.toHaveBeenCalled();
  });

  it('replace: POSTs to /replace and hands the caller the new filter name and moved tags', async () => {
    const outcome = { success: true, oldFilterId: 'f-1', newFilterId: 'f-9', newFilterName: 'AHU-1-F09', identifiersMoved: 1 };
    api = mockApi([
      { path: '/api/config/action-reauth/my-actions', body: { actions: ['RETIRE_FILTER'] } },
      { method: 'POST', path: '/api/filters/f-1/replace', body: outcome },
    ]);
    const { result } = await setupReauth(['RETIRE_FILTER']); // only RETIRE is gated here
    const onSuccess = vi.fn();
    await act(async () => { await retireOrReplaceFilter(result.current, 'replace', 'f-1', 'end of life', { onSuccess, onError: vi.fn() }); });
    expect(api.calls('POST', '/api/filters/f-1/replace')[0].json).toEqual({ remarks: 'end of life' });
    expect(onSuccess).toHaveBeenCalledWith(outcome);
  });

  it('a REPLACE_FILTER signature: nothing is sent until the password is confirmed, then it rides on header and body', async () => {
    api = mockApi([
      { path: '/api/config/action-reauth/my-actions', body: { actions: ['REPLACE_FILTER'] } },
      { method: 'POST', path: '/api/filters/f-1/replace', body: (req: MockRequest) => ({ success: true, newFilterName: `got ${req.json.remarks}` }) },
    ]);
    const { result } = await setupReauth(['REPLACE_FILTER']);
    const onSuccess = vi.fn();
    await act(async () => { await retireOrReplaceFilter(result.current, 'replace', 'f-1', 'swap', { onSuccess, onError: vi.fn() }); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.pendingActionLabel).toBeTruthy();
    expect(api.calls('POST', '/api/filters/f-1/replace')).toEqual([]);
    act(() => { result.current.setPassword('S3cret!'); });
    await act(async () => { await result.current.confirm(); });
    const [req] = api.calls('POST', '/api/filters/f-1/replace');
    expect(req.headers['x-reauth-password']).toBe('S3cret!');
    expect(req.json).toEqual({ remarks: 'swap', _currentPassword: 'S3cret!' });
    expect(onSuccess).toHaveBeenCalledWith({ success: true, newFilterName: 'got swap' });
    expect(result.current.isOpen).toBe(false);
  });

  it('a server refusal reaches onError, never onSuccess', async () => {
    api = mockApi([
      { path: '/api/config/action-reauth/my-actions', body: { actions: [] } },
      { method: 'POST', path: '/api/filters/f-1/retire', status: 409, body: { error: 'CYCLE_IN_PROGRESS', message: 'Filter has an active cleaning cycle' } },
    ]);
    const { result } = await setupReauth([]);
    const onSuccess = vi.fn();
    const onError = vi.fn();
    await act(async () => { await retireOrReplaceFilter(result.current, 'retire', 'f-1', 'x', { onSuccess, onError }); });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Filter has an active cleaning cycle' }));
  });
});
