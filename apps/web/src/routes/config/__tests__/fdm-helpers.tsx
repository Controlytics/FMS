/**
 * Helpers for the Filter Data Management tests only (not collected by vitest:
 * no `.test.` in the name). Owned by the filter-data-management*.test.tsx
 * files; deliberately separate from the frozen config-test-helpers.tsx.
 */
import { screen, fireEvent, act, within, waitFor, configure } from '@testing-library/react';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import useSWR, { SWRConfig, mutate as globalMutate } from 'swr';
import { expect } from 'vitest';
import { swrConfig } from '@/lib/swr-config';
import { ToastProvider } from '@/components/toast-provider';
import { mockApi, renderPage, type MockApi, type MockRoute } from '@/test-utils/page-harness';
import { RequireRole } from '@/components/require-role';
import { FilterDataManagementPage } from '../filter-data-management';
import { SUPER_ADMIN, commonRoutes } from './config-test-helpers';

// These flows chain several requests (save -> 401 -> password -> retry ->
// follow-up write); under a loaded machine 1 s per wait is not enough.
configure({ asyncUtilTimeout: 4000 });

/** UTC + ISO date format so every rendered / sent instant is predictable. */
export const DT = { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' };

export const RETIREMENTS = [
  { id: 'r1', name: 'FLT-001', updatedAt: '2026-07-15T09:30:00.000Z', filterSet: 'SET_A', attributes: {}, preRetireParentId: 'ahu-1', preRetireParentName: 'AHU-01' },
  { id: 'r2', name: 'FLT-002', updatedAt: '2026-08-01T00:00:00.000Z', retiredAt: '2026-08-02T10:00:00.000Z', filterSet: null, attributes: {}, preRetireParentId: null, preRetireParentName: null },
];

export const REPLACEMENTS = [
  { id: 'p1', oldFilterId: 'old-uuid-1234567', oldFilterName: 'FLT-OLD', newFilterId: 'new-uuid-7654321', newFilterName: 'FLT-NEW', remarks: 'damaged', replacedAt: '2026-07-20T08:00:00.000Z', performedBy: 'jdoe' },
  { id: 'p2', oldFilterId: 'old-2', oldFilterName: 'FLT-A', newFilterId: 'new-2', newFilterName: 'FLT-B', remarks: null, replacedAt: '2026-09-01T08:00:00.000Z', performedBy: 'asmith' },
];

export interface BaseOpts {
  retirements?: unknown;
  replacements?: unknown;
  reauth?: string[];
  pagination?: unknown;
}

/** GETs the page fires on every render, plus the shared hooks' reads. */
export function baseRoutes(o: BaseOpts = {}): MockRoute[] {
  return [
    { path: '/api/config/datetime/current', body: DT },
    { path: '/api/config/pagination/current', body: o.pagination ?? { limit: 20, count: 3, options: [2, 5, 20] } },
    { path: '/api/filters/retirements', body: o.retirements ?? RETIREMENTS },
    { path: '/api/filters/replacements', body: o.replacements ?? REPLACEMENTS },
    ...commonRoutes({ reauth: o.reauth }),
  ];
}

/** Mounted exactly as main.tsx mounts it: RequireRole roles={[]} (SUPER_ADMIN only). */
export function renderFdm(routes: MockRoute[], opts: BaseOpts & { user?: { role: string; permissions?: string[] } } = {}) {
  const api = mockApi([...routes, ...baseRoutes(opts)]);
  renderPage(<RequireRole roles={[]}><FilterDataManagementPage /></RequireRole>, { user: opts.user ?? SUPER_ADMIN, api });
  return api;
}

/**
 * The page refreshes other screens with the GLOBAL `mutate` from 'swr', which is
 * bound to SWR's default cache. The shared harness gives every render a private
 * cache (`provider: () => new Map()`), where a global mutate can never land — so
 * the refetch of e.g. /api/filters/cleaning-record is unobservable through it.
 * This variant mounts the page on the default cache (as production does) next to
 * probe readers holding the user-facing keys, so a revalidation shows up as a
 * second GET. Clear the default cache between tests with `clearGlobalCache()`.
 */
export function renderFdmGlobalCache(routes: MockRoute[], probeKeys: string[], opts: BaseOpts = {}) {
  const api = mockApi([...routes, ...baseRoutes(opts)]);
  sessionStorage.setItem('access_token', 'test-token');
  api.routes.push({ path: '/api/auth/me', body: { id: 'u-test', username: 'tester', fullName: 'Test User', status: 'ENABLED', ...SUPER_ADMIN } });
  for (const k of probeKeys) {
    const path = k.split('?')[0];
    if (!api.routes.some((r) => r.path === path)) api.routes.push({ path, body: { data: [] } });
  }
  function Probe({ k }: { k: string }) {
    useSWR(k);
    return null;
  }
  render(
    <SWRConfig value={{ ...swrConfig, dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="*" element={<>
              {probeKeys.map((k) => <Probe key={k} k={k} />)}
              <RequireRole roles={[]}><FilterDataManagementPage /></RequireRole>
            </>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </SWRConfig>,
  );
  return api;
}

export async function clearGlobalCache() {
  await globalMutate(() => true, undefined, { revalidate: false });
}

export async function openTab(name: string) {
  await screen.findByRole('heading', { name: 'Filter Data Management' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
}

/** A modal on this page: the fixed overlay that holds the given heading. */
export function modal(title: string | RegExp): HTMLElement {
  const h = screen.getByRole('heading', { name: title });
  return h.closest('div.fixed') as HTMLElement;
}

/** The input/select/textarea under a Field label (the labels are not `for`-bound). */
export function field(container: HTMLElement, label: string): HTMLInputElement {
  const labels = Array.from(container.querySelectorAll('label'))
    .filter((l) => (l.textContent ?? '').replace(/\*$/, '').trim() === label);
  if (labels.length !== 1) throw new Error(`expected one "${label}" field, found ${labels.length}`);
  const el = labels[0].parentElement!.querySelector('input,select,textarea');
  if (!el) throw new Error(`no control under "${label}"`);
  return el as HTMLInputElement;
}

export function setField(container: HTMLElement, label: string, value: string) {
  fireEvent.change(field(container, label), { target: { value } });
}

/** The mandatory change-reason textarea inside a container. */
export function reasonBox(container: HTMLElement): HTMLTextAreaElement {
  return within(container).getByPlaceholderText('Why is this record being changed?') as HTMLTextAreaElement;
}

export function typeReason(container: HTMLElement, reason: string) {
  fireEvent.change(reasonBox(container), { target: { value: reason } });
}

export async function click(el: HTMLElement) {
  await act(async () => { fireEvent.click(el); });
}

/** The `<tr>` holding the given cell text. */
export function row(text: string): HTMLElement {
  return screen.getByText(text).closest('tr') as HTMLElement;
}

export async function waitForCalls(api: MockApi, method: string, path: string | RegExp, n: number) {
  await waitFor(() => expect(api.calls(method, path)).toHaveLength(n));
  return api.calls(method, path);
}
