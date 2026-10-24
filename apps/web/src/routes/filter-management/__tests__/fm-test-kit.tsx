/**
 * Shared kit for the filter-management + cleaning-cycles page tests
 * (coverage campaign, 2026-10-21). NOT a test file — imported by them.
 *
 * - `baseRoutes()` answers the config reads every page makes through shared
 *   hooks (datetime, pagination, export limit/options, action re-auth, field
 *   labels, report labels/titles, branding). Unanswered, each would 404 →
 *   SWR onError → a "Load Error" toast that pollutes the page under test.
 * - `usePageTestLifecycle()` installs jsdom shims and a console.error guard,
 *   and clears storage + global stubs between tests.
 * - `passReauth()` drives the real ReauthDialog.
 */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { MockRoute, TestUser } from '@/test-utils/page-harness';

export const SA: TestUser = { role: 'SUPER_ADMIN', permissions: [] };
export const role = (name: string, permissions: string[] = []): TestUser => ({ role: name, permissions });

export interface BaseRouteOpts {
  reauthActions?: string[];
  exportLimit?: { maxRecords?: number; message?: string };
  exportOptions?: Record<string, string>;
  pagination?: { limit: number; options: number[] };
}

/** Config reads made by shared hooks. Pass to mockApi() AFTER page routes. */
export function baseRoutes(o: BaseRouteOpts = {}): MockRoute[] {
  return [
    { path: '/api/config/action-reauth/my-actions', body: { actions: o.reauthActions ?? [] } },
    { path: '/api/config/export-limit/current', body: o.exportLimit ?? { maxRecords: 100000 } },
    { path: '/api/config/export-options/current', body: o.exportOptions ?? {} },
    { path: '/api/config/pagination/current', body: o.pagination ?? { limit: 25, count: 25, options: [10, 25, 50] } },
    { path: '/api/config/datetime/current', body: {} },
    { path: '/api/config/field-ids/current', body: [] },
    { path: '/api/config/report-labels/current', body: {} },
    { path: '/api/config/report-page-titles/current', body: {} },
    { path: '/api/config/branding', body: {} },
    { path: '/api/config/pm-schedule-filters/current', body: { enabled: true } },
    { path: '/api/config/replacement-schedule-filters/current', body: { enabled: true } },
    // Role display names (useRoleColors) for the interlock / approval wording; public on the server.
    { path: '/api/roles/active', body: [] },
  ];
}

let consoleErrors: unknown[][] = [];
let allowConsole: RegExp[] = [];

/** Let a test that deliberately fails a load log `[SWR Error] …` etc. */
export function allowConsoleError(...patterns: RegExp[]) { allowConsole.push(...patterns); }

/**
 * Installs per-test shims + teardown. Every console.error that is not
 * explicitly allowed fails the test (React key/act warnings, unexpected
 * SWR errors) — the project rule is to check the console during UI tests.
 */
export function usePageTestLifecycle() {
  beforeEach(() => {
    consoleErrors = [];
    allowConsole = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args); });
    if (!('createObjectURL' in URL)) (URL as any).createObjectURL = () => 'blob:x';
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
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
    const unexpected = consoleErrors.filter((args) => {
      const text = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
      return !allowConsole.some((re) => re.test(text));
    });
    vi.restoreAllMocks();
    expect(unexpected.map((a) => a.map(String).join(' ').slice(0, 400)), 'unexpected console.error').toEqual([]);
  });
}

/** Wait for the real ReauthDialog, type the password, confirm. */
export async function passReauth(password = 'Secret@123') {
  const input = await screen.findByPlaceholderText('Enter your password');
  fireEvent.change(input, { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
}

/** Assert the request carried the re-auth password both ways (header + body). */
export function expectSigned(req: { headers: Record<string, string>; json: any }, password = 'Secret@123') {
  expect(req.headers['x-reauth-password']).toBe(password);
  if (req.json !== undefined) expect(req.json._currentPassword).toBe(password);
}

/** A route that answers 401 REAUTH_REQUIRED once, so the real retry path runs. */
export const reauthOnce = (method: string, path: string | RegExp): MockRoute => ({
  method, path, status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' },
});

export async function settle() { await waitFor(() => {}); }
