/**
 * Shared kit for the tablet-app page tests (coverage campaign, 2026-10-21).
 * NOT a test file — imported by the suites in routes/mobile/__tests__.
 *
 *  - `mobileRoutes()`  answers every read the tablet shell makes through shared
 *    hooks and polls, so an unmocked 404 never turns into an SWR error toast.
 *    Page-specific routes go FIRST (mockApi matches the first route).
 *  - `useMobileLifecycle()` installs jsdom shims, a fresh in-memory IndexedDB
 *    and a console.error guard per test (an unexpected console.error — a React
 *    key/act warning, an unhandled SWR error — fails the test; the project
 *    rule is to watch the console during UI tests).
 *  - `seedCache` / `seedFilters` / `seedOps` write rows in the exact shape
 *    lib/offline-store.ts writes them.
 *  - `<LocationProbe/>` renders the router path so navigation is assertable.
 */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, screen, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import type { MockRoute, TestUser } from '@/test-utils/page-harness';
import { installFakeIndexedDB, openAppDb, cacheRow, type FakeIdb } from './fake-indexeddb';
import { resetFakes } from './fakes';

export const OPERATOR: TestUser = { id: 'u-op', username: 'op1', fullName: 'Ravi Kumar', role: 'OPERATOR', permissions: ['FILTER_OPERATE', 'ASSET_READ'] };
export const SA: TestUser = { id: 'u-sa', username: 'superadmin', fullName: 'Super Admin', role: 'SUPER_ADMIN', permissions: [] };

export interface MobileRouteOpts {
  reauthActions?: string[];
  tabletAccess?: { configured?: boolean; allowed?: string[]; role?: string } | null;
  notifications?: { data: any[]; unreadCount: number };
  instances?: any[];
  templates?: any[];
  identifiers?: any[];
  due?: any;
  replTasks?: any[];
  assignment?: any;
  ahuMode?: string;
  blockChangeMode?: string;
}

export const FILTER_TEMPLATE = { id: 'tpl-filter', name: 'Filter', templateKind: 'FILTER' };
export const BLOCK_TEMPLATE = { id: 'tpl-block', name: 'Block', templateKind: 'BLOCK' };
export const AREA_TEMPLATE = { id: 'tpl-area', name: 'Area', templateKind: 'AREA' };
export const AHU_TEMPLATE = { id: 'tpl-ahu', name: 'AHU', templateKind: 'AHU' };
export const TEMPLATES = [FILTER_TEMPLATE, BLOCK_TEMPLATE, AREA_TEMPLATE, AHU_TEMPLATE];

/** Reads every shared hook / poll on the tablet makes. Pass AFTER page routes. */
export function mobileRoutes(o: MobileRouteOpts = {}): MockRoute[] {
  return [
    { path: '/api/config/action-reauth/my-actions', body: { actions: o.reauthActions ?? [] } },
    { path: '/api/config/datetime/current', body: { dateFormat: 'DD/MM/YYYY', timeFormat: 'HH:mm', timezone: 'UTC' } },
    { path: '/api/config/branding', body: { appName: 'FMS Tablet', logoText: 'FT', logoUrl: '', companyName: 'Acme', version: '9.9' } },
    { path: '/api/config/offline-cache/current', body: {} },
    { path: '/api/config/tablet-access/my-features', body: o.tabletAccess === undefined ? { configured: false, allowed: [] } : (o.tabletAccess ?? {}) },
    { path: '/api/notifications', body: o.notifications ?? { data: [], unreadCount: 0 } },
    { path: '/api/assets/instances', body: { data: o.instances ?? [] } },
    { path: '/api/assets/templates', body: { data: o.templates ?? TEMPLATES } },
    { path: '/api/assets/identifiers', body: o.identifiers ?? [] },
    { path: '/api/pm-schedules/due', body: o.due ?? { tasks: [], overdue: [] } },
    { path: '/api/replacement-schedules/tasks', body: { data: o.replTasks ?? [] } },
    { path: '/api/config/cleaning-profile-assignment/current', body: o.assignment ?? { mode: 'BY_AHU', rules: [] } },
    { path: '/api/config/ahu-completion-process/current', body: { mode: o.ahuMode ?? 'NONE' } },
    { path: '/api/config/block-change-approval/current', body: { mode: o.blockChangeMode ?? 'CONFIRM' } },
    { path: '/api/config/field-ids/current', body: [] },
    // Any signed-in user reads it (config/routes.ts); the tablet's paged lists use it.
    { path: '/api/config/pagination/current', body: { limit: 50, count: 3, options: [10, 25, 50] } },
    { path: '/api/hierarchy/ahus', body: { data: [] } },
    { path: '/api/hierarchy/areas', body: { data: [] } },
    { path: '/api/filters/reasons', body: { reasons: [] } },
    { path: '/api/equipment-groups', body: [] },
    { path: '/api/filter-cleaning-profiles', body: { data: [] } },
    { path: '/api/checklist-profiles', body: { data: [] } },
    { path: '/api/replacement-schedules/blocked-filters', body: { filterIds: [] } },
    { path: '/api/filters/batch-states', body: { states: {}, cachedAt: '2026-10-21T00:00:00.000Z' } },
    { path: '/api/pm-schedules/pending-tasks-map', body: {} },
    { path: '/api/filters/cycles', body: { data: [] } },
    { path: '/api/health', body: { status: 'ok' } },
    { method: 'POST', path: '/api/auth/refresh', body: {} },
    { method: 'POST', path: '/api/auth/logout', body: {} },
  ];
}

let consoleErrors: unknown[][] = [];
let allowConsole: RegExp[] = [];
let idb: FakeIdb;

/** Let a test that deliberately produces a console.error (e.g. a failed load) pass. */
export function allowConsoleError(...patterns: RegExp[]) { allowConsole.push(...patterns); }

export function fakeIdb(): FakeIdb { return idb; }

export function useMobileLifecycle() {
  // These suites mount whole pages (SWR + IndexedDB + many reads). Under the
  // coverage run, with every suite in parallel, the default 1 s findBy / 5 s
  // test budgets are too tight — the waits below are upper bounds, not delays.
  // 10 s (was 4 s, 2026-10-22): with other suites running on the same machine
  // the IndexedDB-heavy offline flows (missed-PM question, queued starts) were
  // seen taking 4–15 s; alone they finish in about 1 s.
  configure({ asyncUtilTimeout: 10_000 });
  vi.setConfig({ testTimeout: 30_000 });
  beforeEach(() => {
    consoleErrors = [];
    allowConsole = [];
    resetFakes();
    idb = installFakeIndexedDB();
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args); });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    if (!window.matchMedia) {
      (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    }
    if (!(globalThis as any).ResizeObserver) {
      (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    }
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  });
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    const unexpected = consoleErrors.filter((args) => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      return !allowConsole.some((re) => re.test(text));
    });
    vi.restoreAllMocks();
    expect(unexpected.map((a) => a.map(String).join(' ').slice(0, 400)), 'unexpected console.error').toEqual([]);
  });
}

/** Open the app DB through offline-store's own upgrade, then write cache rows. */
export async function seedCache(entries: Record<string, unknown>) {
  await openAppDb();
  idb.seed('cache', Object.entries(entries).map(([k, v]) => cacheRow(k, v)));
}
/** Rows of the legacy `filters` store (what getOfflineFilters / cacheFilterData use). */
export async function seedFilters(rows: any[]) {
  await openAppDb();
  idb.seed('filters', rows);
}
/** Queued offline operations, owned by `userId`. */
export async function seedOps(rows: Array<Partial<{ id: string; type: string; filterId: string; filterName: string; status: string; userId: string | null; userName: string | null; error: string }>>) {
  await openAppDb();
  idb.seed('operations', rows.map((r, i) => ({
    id: r.id ?? `op-${i}`, type: r.type ?? 'advance', filterId: r.filterId ?? `f-${i}`, filterName: r.filterName ?? `F-${i}`,
    payload: {}, status: r.status ?? 'pending', retryCount: 0, createdAt: new Date().toISOString(),
    tapeVersion: null, clientOpId: `c-${i}`, userId: r.userId ?? null, userName: r.userName ?? null, error: r.error,
  })));
}
export function cachedValue(key: string): any {
  try { return idb.rows('cache').find((r) => r.key === key)?.data; } catch { return undefined; }
}
export function queuedOps(): any[] {
  try { return idb.rows('operations'); } catch { return []; }
}

/** Makes `useAuth` see a signed-in user immediately (offline it reads this cache). */
export function cacheUser(user: TestUser) {
  sessionStorage.setItem('access_token', 'test-token');
  localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-test', status: 'ENABLED', permissions: [], ...user }));
}

export function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}
export const currentPath = () => screen.getByTestId('location').textContent;

/** Drive the real ReauthDialog. */
export async function passReauth(password = 'Secret@123') {
  const input = await screen.findByPlaceholderText('Enter your password');
  fireEvent.change(input, { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
}
export async function cancelReauth() {
  await screen.findByPlaceholderText('Enter your password');
  // the re-auth dialog's own Cancel (another dialog may also be open behind it)
  const footer = screen.getByRole('button', { name: 'Verify & Continue' }).parentElement!;
  fireEvent.click(within(footer).getByRole('button', { name: /^cancel$/i }));
}

/** Let pending fetches / SWR updates land inside act() before the test ends. */
export async function flush(ms = 30) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}
