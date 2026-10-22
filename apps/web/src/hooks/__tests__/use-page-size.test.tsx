/**
 * usePageSize — a list page's page size is the operator's own pick, else the
 * configured default (Config → Pagination: "records per page options for all
 * list views").
 *
 * 2026-10-22: 14 list pages broke that promise. Three seeded their state from the
 * hook's PRE-LOAD fallback (the first render of a cold load) and never took the
 * configured value. Eleven hard-coded 20 / 25 / 50, often a size the page's own
 * selector did not even offer. Only global `fetch` is stubbed (mockApi); SWR and
 * apiClient are real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi } from '@/test-utils/page-harness';
import { usePageSize } from '../use-pagination-config';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    {children}
  </SWRConfig>
);

beforeEach(() => { sessionStorage.setItem('access_token', 'test-token'); });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('usePageSize', () => {
  it('a cold load takes the configured default once it arrives (not the pre-load fallback)', async () => {
    mockApi([{ path: '/api/config/pagination/current', body: { limit: 50, count: 50, options: [10, 50, 100] } }]);
    const { result } = renderHook(() => usePageSize(), { wrapper });
    await waitFor(() => expect(result.current[0]).toBe(50));
  });

  it('the operator\'s own pick wins over the default, and keeps winning', async () => {
    mockApi([{ path: '/api/config/pagination/current', body: { limit: 50, count: 50, options: [10, 50, 100] } }]);
    const { result } = renderHook(() => usePageSize(), { wrapper });
    await waitFor(() => expect(result.current[0]).toBe(50));
    act(() => { result.current[1](100); });
    expect(result.current[0]).toBe(100);
  });

  it('with no pagination config it falls back to 20', async () => {
    mockApi([{ path: '/api/config/pagination/current', status: 404, body: { error: 'NOT_FOUND', message: 'x' } }]);
    const { result } = renderHook(() => usePageSize(), { wrapper });
    expect(result.current[0]).toBe(20);
  });
});
