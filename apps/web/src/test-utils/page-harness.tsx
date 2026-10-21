/**
 * Page-level test harness (coverage campaign, 2026-10-21).
 *
 * Renders a real page with the app's REAL data path - SWR with the shared
 * `swrConfig` fetcher -> `apiClient` -> `fetch` - and stubs only `fetch`, the
 * network edge. So a test exercises the same request building, error handling
 * (401 / REAUTH_REQUIRED / toasts) and permission gating (`useAuth` ->
 * `/api/auth/me` -> `useCan`) the browser does, instead of mocking `swr` or
 * `apiClient` away.
 *
 *   const api = mockApi([
 *     { path: '/api/users', body: { data: [...], total: 1 } },
 *     { method: 'POST', path: '/api/users', status: 201, body: (req: MockRequest) => ({ id: 'u1', ...req.json }) },
 *   ]);
 *   renderPage(<UsersPage />, { route: '/users', user: { role: 'ADMIN', permissions: ['USER_READ'] }, api });
 *   await screen.findByText('Jane');
 *   expect(api.calls('POST', '/api/users')[0].json).toMatchObject({ username: 'jdoe' });
 *
 * Unmatched requests answer 404 `NOT_MOCKED` and are listed in `api.unmatched`
 * so a test can assert the page asked for nothing unexpected.
 */
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { SWRConfig, mutate as globalMutate } from 'swr';
import { vi } from 'vitest';
import { swrConfig } from '@/lib/swr-config';
import { ToastProvider } from '@/components/toast-provider';

export interface MockRequest {
  method: string;
  url: string;        // path + query as the app sent it
  path: string;       // pathname only
  query: URLSearchParams;
  headers: Record<string, string>;
  json: any;          // parsed JSON body, or undefined
  form?: FormData;    // the body of a multipart request (uploads), when it was one
}

export interface MockRoute {
  method?: string;                      // default GET
  path: string | RegExp;                // exact pathname, or RegExp tested on path+query
  status?: number;                      // default 200
  // `unknown` absorbs the function member, so a handler gets no contextual type:
  // annotate it — `body: (req: MockRequest) => ...`.
  body?: unknown | ((req: MockRequest) => unknown);
  /** Answer only this many times, then fall through to the next matching route. */
  times?: number;
}

export interface MockApi {
  routes: MockRoute[];
  requests: MockRequest[];
  unmatched: MockRequest[];
  calls(method: string, path: string | RegExp): MockRequest[];
  add(...routes: MockRoute[]): void;
  restore(): void;
}

const used = new WeakMap<MockRoute, number>();

export function mockApi(routes: MockRoute[] = []): MockApi {
  const api: MockApi = {
    routes: [...routes],
    requests: [],
    unmatched: [],
    calls: (method, path) => api.requests.filter((r) => r.method === method.toUpperCase()
      && (typeof path === 'string' ? r.path === path : path.test(r.url))),
    add: (...more) => { api.routes.unshift(...more); },
    restore: () => { vi.unstubAllGlobals(); },
  };

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const u = new URL(raw, 'http://localhost');
    let json: any;
    if (typeof init.body === 'string') { try { json = JSON.parse(init.body); } catch { json = init.body; } }
    const form = typeof FormData !== 'undefined' && init.body instanceof FormData ? init.body : undefined;
    const req: MockRequest = {
      method: (init.method ?? 'GET').toUpperCase(),
      url: u.pathname + u.search,
      path: u.pathname,
      query: u.searchParams,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)])),
      json,
      ...(form ? { form } : {}),
    };
    api.requests.push(req);
    const route = api.routes.find((r) => {
      if ((r.method ?? 'GET').toUpperCase() !== req.method) return false;
      if (r.times !== undefined && (used.get(r) ?? 0) >= r.times) return false;
      return typeof r.path === 'string' ? r.path === req.path : r.path.test(req.url);
    });
    if (!route) {
      api.unmatched.push(req);
      return new Response(JSON.stringify({ error: 'NOT_MOCKED', message: `${req.method} ${req.url}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    used.set(route, (used.get(route) ?? 0) + 1);
    const body = typeof route.body === 'function' ? (route.body as (r: MockRequest) => unknown)(req) : route.body;
    const status = route.status ?? 200;
    // An omitted body answers `{}`; an explicit `null` answers a literal JSON
    // null - a real API answer (e.g. GET /api/pm-schedules/:entityId with no schedule).
    return new Response(status === 204 ? null : JSON.stringify(body === undefined ? {} : body), { status, headers: { 'Content-Type': 'application/json' } });
  }));
  return api;
}

export interface TestUser {
  id?: string;
  username?: string;
  fullName?: string;
  role: string;
  permissions?: string[];
  [k: string]: unknown;
}

export interface RenderPageOptions {
  route?: string;      // the URL to open (default '/')
  path?: string;       // the route pattern the page is mounted on (default '*')
  user?: TestUser;     // signed-in user; omit for a signed-out render
  api?: MockApi;       // from mockApi(); created empty if omitted. Pass the one you made:
                       // a second mockApi() replaces the fetch stub and drops its routes.
  /**
   * 'production' keeps the app's `dedupingInterval` (5000 ms) instead of 0. Use
   * it to reproduce bugs that only exist because SWR reuses a recent answer -
   * e.g. a form seeded from `onSuccess`, which never fires for a deduped key.
   */
  dedupe?: 'test' | 'production';
  /**
   * Mount on SWR's DEFAULT cache instead of a fresh per-render one, so a page
   * that refreshes through the global `mutate(key)` from 'swr' can be checked.
   * Share-state warning: call `await clearGlobalSwrCache()` before each test.
   */
  globalCache?: boolean;
}

/** Empty SWR's default cache (for `globalCache: true` renders). */
export async function clearGlobalSwrCache(): Promise<void> {
  await globalMutate(() => true, undefined, { revalidate: false });
}

/**
 * Forget the signed-in user `useAuth` caches in localStorage. Two renders as
 * DIFFERENT roles in one test must call this in between, or the second render
 * starts with the first role's permissions until /api/auth/me answers.
 */
export function forgetSignedInUser(): void {
  localStorage.removeItem('digilog_cached_user');
}

/** Renders `ui` under the real SWR config, ToastProvider and a MemoryRouter. */
export function renderPage(ui: React.ReactElement, opts: RenderPageOptions = {}): RenderResult & { api: MockApi } {
  const api = opts.api ?? mockApi();
  if (opts.user) {
    sessionStorage.setItem('access_token', 'test-token');
    const me = {
      id: 'u-test', username: 'tester', fullName: 'Test User', status: 'ENABLED', permissions: [],
      ...opts.user,
    };
    api.routes.push({ path: '/api/auth/me', body: me });
  } else {
    sessionStorage.removeItem('access_token');
  }
  const view = render(
    <SWRConfig value={{
      ...swrConfig,
      ...(opts.globalCache ? {} : { provider: () => new Map() }),
      dedupingInterval: opts.dedupe === 'production' ? swrConfig.dedupingInterval : 0,
      shouldRetryOnError: false,
      revalidateOnFocus: false,
    }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[opts.route ?? '/']}>
          <Routes>
            <Route path={opts.path ?? '*'} element={ui} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </SWRConfig>,
  );
  return Object.assign(view, { api });
}
