/**
 * <AppLayout> — the authenticated shell: auth gates, single-tab / single-user
 * screens, the Super Admin lockdown, the idle-timeout dialog, the versioned-cache
 * sync kick-off, and the sidebar/header/outlet frame.
 *
 * Real: useAuth, useSession, useSingleTab, useBranding, useSuperAdminLock,
 * useOfflineConfig, Sidebar, Header, HardCutoffBlocker, the lockdown screen.
 * Only `fetch` is stubbed (page harness), plus two IndexedDB-backed boundaries:
 *  - `@/lib/sync-since` (opens IndexedDB) — its two entry points are spied so
 *    the test can assert WHEN the layout starts/stops syncing;
 *  - `@/components/failed-ops-panel` (reads the IndexedDB op queue) — replaced
 *    by a marker so the test can assert the layout mounts it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';

const sync = vi.hoisted(() => ({ trigger: vi.fn(), start: vi.fn(), teardown: vi.fn() }));
vi.mock('@/lib/sync-since', () => ({
  triggerSync: (reason: string) => sync.trigger(reason),
  startSyncPolling: () => { sync.start(); return sync.teardown; },
}));
vi.mock('@/components/failed-ops-panel', () => ({ FailedOpsPanel: () => <div data-testid="failed-ops-panel" /> }));

import { AppLayout } from '../app-layout';
import { useToast } from '@/hooks/use-toast';

const shell = (
  <Routes>
    <Route path="/login" element={<p>login page</p>} />
    <Route path="/change-password" element={<p>change password page</p>} />
    <Route element={<AppLayout />}>
      <Route path="*" element={<p>child page</p>} />
    </Route>
  </Routes>
);

const baseRoutes = (extra: MockRoute[] = []): MockRoute[] => [
  ...extra,
  { path: '/api/config/password-policy/current', body: { autoLogoutEnabled: false } },
  { path: '/api/config/offline-cache/current', body: { cacheStalenessHours: 24, cacheHardCutoffHours: 24 } },
  { path: '/api/config/branding', body: { appName: 'Acme FMS', companyName: 'Acme' } },
  { path: '/api/config/datetime/current', body: { dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'UTC' } },
  { path: '/api/config/my-config', body: {} },
  { path: '/api/pm-schedules/qnn/visible', body: { visible: false } },
  { path: '/api/notifications/unread-count', body: { count: 0 } },
  { path: '/api/roles/active', body: [] },
  { path: '/api/super-admin/api-lock', body: { enabled: true } },
  { method: 'POST', path: '/api/auth/logout', body: { success: true } },
];

const operator: TestUser = { id: 'u-op', username: 'op1', fullName: 'Olive Operator', role: 'OPERATOR', permissions: ['ASSET_VIEW', 'FILTER_OPERATE'] };

function renderShell(user: TestUser | undefined, extra: MockRoute[] = [], route = '/dashboard') {
  const api = mockApi(baseRoutes(extra));
  const view = renderPage(shell, { route, user, api });
  return { ...view, api };
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sync.trigger.mockClear(); sync.start.mockClear(); sync.teardown.mockClear();
  sessionStorage.setItem('digilog_tab_id', 'TAB-ME');
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  cleanup(); // first, so a failed console check below cannot leak this render into the next test
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('AppLayout — gates', () => {
  it('signed out: goes to /login without asking for any config', async () => {
    const { api } = renderShell(undefined);
    expect(await screen.findByText('login page')).toBeInTheDocument();
    expect(api.calls('GET', '/api/config/offline-cache/current')).toHaveLength(0);
    expect(api.calls('GET', '/api/config/password-policy/current')).toHaveLength(0);
    expect(sync.trigger).not.toHaveBeenCalled();
  });

  it('shows a loading state while the user is being fetched', async () => {
    const api = mockApi(baseRoutes());
    const answer = globalThis.fetch;
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/auth/me')) await held;
      return answer(input, init);
    }));
    renderPage(shell, { route: '/dashboard', user: operator, api });
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    release();
    expect(await screen.findByText('child page')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('a forced password change sends the user to /change-password', async () => {
    renderShell({ ...operator, forcePasswordChange: true });
    expect(await screen.findByText('change password page')).toBeInTheDocument();
  });

  // D03-11 (2026-10-22): until the password is changed the server answers every
  // other authed call 403 FORCE_PASSWORD_CHANGE (plugins/auth.ts allow-list), and
  // the layout still asked for the offline-cache config ("[SWR Error] You must
  // change your password before continuing."), the Super Admin API lock and a sync.
  it.each([
    ['an operator who syncs', operator],
    ['a Super Admin', { ...operator, id: 'u-sa', role: 'SUPER_ADMIN' }],
  ])('a forced password change (%s) asks only for what the server allows before the change', async (_label, user) => {
    const { api } = renderShell({ ...user, forcePasswordChange: true });
    expect(await screen.findByText('change password page')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const allowed = new Set([
      'GET /api/auth/me', 'GET /api/config/password-policy/current', // the server's allow-list
      'GET /api/config/branding', 'GET /api/config/datetime/current', 'GET /api/roles/active', // public
    ]);
    expect(api.requests.map((r) => `${r.method} ${r.path}`).filter((c) => !allowed.has(c))).toEqual([]);
    expect(sync.trigger).not.toHaveBeenCalled();
  });
});

describe('AppLayout — signed in', () => {
  it('renders sidebar, header, the routed page and the failed-ops panel', async () => {
    const { api } = renderShell(operator);
    expect(await screen.findByText('child page')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Olive Operator/ })).toBeInTheDocument();
    expect(screen.getByTestId('failed-ops-panel')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull(); // no hard-cutoff, no idle warning
    await waitFor(() => expect(api.calls('GET', '/api/config/offline-cache/current')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', '/api/config/password-policy/current')).toHaveLength(1));
  });

  it('claims the browser tab for this user', async () => {
    renderShell(operator);
    await screen.findByText('child page');
    expect(localStorage.getItem('digilog_active_tab_id')).toBe('TAB-ME');
    expect(JSON.parse(localStorage.getItem('digilog_active_user_id')!)).toEqual({ userId: 'u-op', username: 'op1', tabId: 'TAB-ME' });
  });

  it('starts the versioned-cache sync for a role that can read filters, and stops it on unmount', async () => {
    const { unmount } = renderShell(operator);
    await screen.findByText('child page');
    await waitFor(() => expect(sync.trigger).toHaveBeenCalledWith('app-start'));
    expect(sync.start).toHaveBeenCalledTimes(1);
    unmount();
    expect(sync.teardown).toHaveBeenCalledTimes(1);
  });

  it('does not sync for a role without ASSET_VIEW / FILTER_OPERATE (audit B2)', async () => {
    renderShell({ ...operator, role: 'ADMIN', permissions: ['USER_READ'] });
    await screen.findByText('child page');
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sync.trigger).not.toHaveBeenCalled();
    expect(sync.start).not.toHaveBeenCalled();
  });

  it('a user record without a permissions array does not crash and does not sync', async () => {
    renderShell({ ...operator, role: 'QA', permissions: undefined });
    expect(await screen.findByText('child page')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(sync.trigger).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN syncs regardless of permissions', async () => {
    renderShell({ ...operator, role: 'SUPER_ADMIN', permissions: [] });
    await screen.findByText('child page');
    await waitFor(() => expect(sync.trigger).toHaveBeenCalledWith('app-start'));
  });

  it('the header menu button opens the sidebar drawer', async () => {
    const { container } = renderShell(operator);
    await screen.findByText('child page');
    const aside = container.querySelector('aside')!;
    expect(aside.className).toContain('-translate-x-full');
    const toggle = screen.getByRole('button', { name: 'Toggle menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(aside.className).toMatch(/(^|\s)translate-x-0/);
    expect(toggle).toHaveAttribute('aria-expanded', 'true'); // A-L2: the toggle reports the drawer state
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')[0]);
    expect(aside.className).toContain('-translate-x-full');
  });

  it('Escape closes the open drawer (A-L2)', async () => {
    const { container } = renderShell(operator);
    await screen.findByText('child page');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(container.querySelector('aside')!.className).toMatch(/(^|\s)translate-x-0/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('aside')!.className).toContain('-translate-x-full');
    expect(screen.getByRole('button', { name: 'Toggle menu' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('AppLayout — one tab, one user', () => {
  it('same user in another live tab: offers to use this tab instead', async () => {
    localStorage.setItem('digilog_active_tab_id', 'TAB-OTHER');
    localStorage.setItem('digilog_tab_heartbeat', String(Date.now()));
    localStorage.setItem('digilog_active_user_id', JSON.stringify({ userId: 'u-op', username: 'op1', tabId: 'TAB-OTHER' }));
    renderShell(operator);
    expect(await screen.findByRole('heading', { name: 'Session Active in Another Tab' })).toBeInTheDocument();
    expect(screen.queryByText('child page')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use This Tab Instead' }));
    expect(await screen.findByText('child page')).toBeInTheDocument();
    expect(localStorage.getItem('digilog_active_tab_id')).toBe('TAB-ME');
  });

  it('a DIFFERENT user signed in elsewhere: names them, offers only logout', async () => {
    localStorage.setItem('digilog_active_tab_id', 'TAB-OTHER');
    localStorage.setItem('digilog_tab_heartbeat', String(Date.now()));
    localStorage.setItem('digilog_active_user_id', JSON.stringify({ userId: 'u-qa', username: 'quinn.qa', tabId: 'TAB-OTHER' }));
    const { api } = renderShell(operator);
    expect(await screen.findByRole('heading', { name: 'Another User is Logged In' })).toBeInTheDocument();
    expect(screen.getByText('quinn.qa')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use This Tab Instead' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1));
    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason: 'manual' });
    expect(await screen.findByText('login page')).toBeInTheDocument();
    // the OTHER user's claim is untouched
    expect(localStorage.getItem('digilog_active_tab_id')).toBe('TAB-OTHER');
  });
});

describe('AppLayout — Super Admin API kill-switch', () => {
  it('a SUPER_ADMIN with the switch OFF sees only the lockdown screen', async () => {
    renderShell({ ...operator, role: 'SUPER_ADMIN' }, [{ path: '/api/super-admin/api-lock', body: { enabled: false } }]);
    expect(await screen.findByRole('heading', { name: 'Super Admin API Access Disabled' })).toBeInTheDocument();
    expect(screen.queryByText('child page')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('the switch does not affect other roles', async () => {
    const { api } = renderShell(operator, [{ path: '/api/super-admin/api-lock', body: { enabled: false } }]);
    expect(await screen.findByText('child page')).toBeInTheDocument();
    expect(api.calls('GET', '/api/super-admin/api-lock')).toHaveLength(0);
  });
});

describe('AppLayout — idle timeout', () => {
  // idle 1.2 s, warning 0.6 s: the warning opens ~0.6 s after the last activity.
  const fastPolicy = { path: '/api/config/password-policy/current', body: { autoLogoutEnabled: true, idleTimeoutMinutes: 0.02, warningMinutes: 0.01 } };

  it('warns before logging out; "Continue Session" keeps the user in', async () => {
    const { api } = renderShell(operator, [fastPolicy]);
    await screen.findByText('child page');
    const dlg = await screen.findByRole('heading', { name: /Session Timeout Warning/ }, { timeout: 3000 });
    expect(dlg).toBeInTheDocument();
    expect(screen.getByText('seconds')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue Session' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue Session' })).toBeNull());
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(0);
  });

  it('"Logout Now" logs out immediately as a manual logout', async () => {
    const { api } = renderShell(operator, [fastPolicy]);
    await screen.findByRole('heading', { name: /Session Timeout Warning/ }, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Logout Now' }));
    await waitFor(() => expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1));
    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason: 'manual' });
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  it('when the countdown runs out the user is logged out, tagged idle_timeout', async () => {
    const { api } = renderShell(operator, [fastPolicy]);
    await screen.findByText('child page');
    await waitFor(() => expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1), { timeout: 4000 });
    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason: 'idle_timeout' });
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });

  // D03-14 (2026-10-22, shared workstation): a result dialog from the previous
  // session ("User created ...") survived the idle auto-logout and covered the
  // login page for the next person. Every open message dialog and toast ends with
  // the session, whichever way it ends.
  function ResultPage() {
    const { toast } = useToast();
    const shown = useRef(false); // once: `toast` is a new object on every render
    useEffect(() => {
      if (shown.current) return;
      shown.current = true;
      toast.success('User created', 'User "jdoe" was created successfully.');
      toast.warning('Background note', 'A toast from the old session');
    }, [toast]);
    return <p>result page</p>;
  }
  const resultShell = (
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<AppLayout />}>
        <Route path="*" element={<ResultPage />} />
      </Route>
    </Routes>
  );

  it.each([
    ['the idle auto-logout', 'idle_timeout', () => {}],
    ['"Logout Now"', 'manual', () => fireEvent.click(screen.getByRole('button', { name: 'Logout Now' }))],
  ])('%s clears every message dialog and toast of the old session', async (_l, reason, act0) => {
    const api = mockApi(baseRoutes([fastPolicy]));
    renderPage(resultShell, { route: '/users/create', user: operator, api });
    expect(await screen.findByRole('dialog', { name: 'User created' })).toBeInTheDocument();
    expect(screen.getByText('A toast from the old session')).toBeInTheDocument();
    if (reason === 'manual') {
      await screen.findByRole('heading', { name: /Session Timeout Warning/ }, { timeout: 3000 });
      act0();
    }
    expect(await screen.findByText('login page', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason });
    expect(screen.queryByRole('dialog', { name: 'User created' })).toBeNull();
    expect(screen.queryByText('User "jdoe" was created successfully.')).toBeNull();
    expect(screen.queryByText('A toast from the old session')).toBeNull();
  });

  it('missing policy fields fall back to auto-logout ON, 15 min idle, 2 min warning', async () => {
    renderShell(operator, [{ path: '/api/config/password-policy/current', body: {} }]);
    await screen.findByText('child page');
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(screen.queryByRole('heading', { name: /Session Timeout Warning/ })).toBeNull();
  });
});
