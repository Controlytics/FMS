/**
 * usePageSize / useReportPageSize — a page's size is the operator's own pick,
 * else the configured value (Config → Pagination).
 *
 * The settings hold `options` (the sizes offered) and `limit`, the MAXIMUM page
 * size. A list page opens on the first option; a report page opens on `limit`
 * (apps/web/CLAUDE.md, report configuration).
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
import { usePageSize, useReportPageSize } from '../use-pagination-config';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    {children}
  </SWRConfig>
);
const CONFIG = { path: '/api/config/pagination/current', body: { limit: 100, count: 3, options: [25, 50, 100] } };

beforeEach(() => { sessionStorage.setItem('access_token', 'test-token'); });
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

describe('usePageSize (list pages)', () => {
  it('a cold load takes the first configured option once it arrives (not the pre-load fallback, not the maximum)', async () => {
    mockApi([CONFIG]);
    const { result } = renderHook(() => usePageSize(), { wrapper });
    await waitFor(() => expect(result.current[0]).toBe(25));
  });

  it('the operator\'s own pick wins over the default, and keeps winning', async () => {
    mockApi([CONFIG]);
    const { result } = renderHook(() => usePageSize(), { wrapper });
    await waitFor(() => expect(result.current[0]).toBe(25));
    act(() => { result.current[1](100); });
    expect(result.current[0]).toBe(100);
  });

  it('with no pagination config it falls back to the first built-in option, 10', () => {
    mockApi([{ path: '/api/config/pagination/current', status: 404, body: { error: 'NOT_FOUND', message: 'x' } }]);
    const { result } = renderHook(() => usePageSize(), { wrapper });
    expect(result.current[0]).toBe(10);
  });
});

describe('useReportPageSize (report pages)', () => {
  it('a cold load takes the configured limit once it arrives', async () => {
    mockApi([CONFIG]);
    const { result } = renderHook(() => useReportPageSize(), { wrapper });
    await waitFor(() => expect(result.current[0]).toBe(100));
  });

  it('the operator\'s own pick wins', async () => {
    mockApi([CONFIG]);
    const { result } = renderHook(() => useReportPageSize(), { wrapper });
    await waitFor(() => expect(result.current[0]).toBe(100));
    act(() => { result.current[1](25); });
    expect(result.current[0]).toBe(25);
  });

  it('with no pagination config it falls back to 20', () => {
    mockApi([{ path: '/api/config/pagination/current', status: 404, body: { error: 'NOT_FOUND', message: 'x' } }]);
    const { result } = renderHook(() => useReportPageSize(), { wrapper });
    expect(result.current[0]).toBe(20);
  });
});
