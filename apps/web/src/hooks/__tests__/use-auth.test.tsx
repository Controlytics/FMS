/**
 * useAuth — login / logout / offline-replay grant / isAuthenticated.
 *
 * Runs through the real page harness: SWR with the shared fetcher ->
 * apiClient -> fetch. Only global `fetch` is stubbed, so the request bodies,
 * headers and storage writes asserted here are the ones the browser makes.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRequest } from '@/test-utils/page-harness';
import { useAuth } from '../use-auth';
import { apiClient } from '@/lib/api-client';

let latest: ReturnType<typeof useAuth>;

// For tests that stub `fetch` themselves (to make it THROW, which mockApi cannot):
// renderPage still needs an api object to push its /me route into.
const noApi = () => ({ routes: [], requests: [], unmatched: [], calls: () => [], add: () => {}, restore: () => {} });

function Probe() {
  const auth = useAuth();
  latest = auth;
  const loc = useLocation();
  return (
    <div>
      <p data-testid="path">{loc.pathname}</p>
      <p data-testid="user">{auth.user?.username ?? '-'}</p>
      <p data-testid="authed">{String(auth.isAuthenticated)}</p>
    </div>
  );
}

const meUser = {
  id: 'u-1', username: 'alice', fullName: 'Alice Doe', email: 'a@x.io', role: 'OPERATOR', status: 'ENABLED',
  forcePasswordChange: false, isTemporaryPassword: false, lastLogin: null, permissions: ['ASSET_VIEW'],
};

function loginRoute(user: Partial<typeof meUser> = {}) {
  return {
    method: 'POST', path: '/api/auth/login',
    body: (req: MockRequest) => ({ success: true, token: `tok-${req.json.username}`, user: { ...meUser, ...user } }),
  };
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('useAuth.login', () => {
  it('stores the token, mints the offline-replay grant with the typed password, and lands on the dashboard', async () => {
    const api = mockApi([
      loginRoute(),
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'grant-1', expiresAt: '2026-10-22T00:00:00.000Z' } },
      { path: '/api/auth/me', body: meUser },
    ]);
    sessionStorage.setItem('offline_grant_failed', '1'); // a stale banner from a previous failed login
    renderPage(<Probe />, { route: '/somewhere', api });

    let res: any;
    await act(async () => { res = await latest.login('alice', 'Secret#1'); });

    expect(res.token).toBe('tok-alice');
    expect(api.calls('POST', '/api/auth/login')[0].json).toEqual({ username: 'alice', password: 'Secret#1' });
    expect(sessionStorage.getItem('access_token')).toBe('tok-alice');

    const grant = api.calls('POST', '/api/auth/offline-grant');
    expect(grant).toHaveLength(1);
    expect(grant[0].json).toEqual({ _currentPassword: 'Secret#1' });
    expect(grant[0].headers.authorization).toBe('Bearer tok-alice');
    expect(sessionStorage.getItem('offline_replay_token')).toBe('grant-1');
    expect(sessionStorage.getItem('offline_replay_expires')).toBe('2026-10-22T00:00:00.000Z');
    expect(localStorage.getItem('offline_replay_token_backup')).toBe('grant-1');
    expect(localStorage.getItem('offline_replay_expires_backup')).toBe('2026-10-22T00:00:00.000Z');
    expect(sessionStorage.getItem('offline_grant_failed')).toBeNull();

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('true'));
    expect(screen.getByTestId('user')).toHaveTextContent('alice');
    // The /me response is cached for offline use.
    expect(JSON.parse(localStorage.getItem('digilog_cached_user')!).username).toBe('alice');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('sends force:true only when asked to take over an existing session', async () => {
    const api = mockApi([
      loginRoute(),
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'g', expiresAt: 'e' } },
      { path: '/api/auth/me', body: meUser },
    ]);
    renderPage(<Probe />, { api });
    await act(async () => { await latest.login('alice', 'pw', true); });
    expect(api.calls('POST', '/api/auth/login')[0].json).toEqual({ username: 'alice', password: 'pw', force: true });
  });

  it('a forced password change skips the grant and goes to /change-password', async () => {
    const api = mockApi([loginRoute({ forcePasswordChange: true })]);
    renderPage(<Probe />, { route: '/login', api });
    await act(async () => { await latest.login('alice', 'Temp#123'); });
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(0);
    expect(sessionStorage.getItem('access_token')).toBe('tok-alice');
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/change-password'));
  });

  it('retries the grant once after a transient failure and then succeeds', async () => {
    const api = mockApi([
      loginRoute(),
      { method: 'POST', path: '/api/auth/offline-grant', status: 503, times: 1, body: { error: 'UNAVAILABLE', message: 'busy' } },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'grant-2', expiresAt: 'x' } },
      { path: '/api/auth/me', body: meUser },
    ]);
    renderPage(<Probe />, { api });
    await act(async () => { await latest.login('alice', 'pw'); });
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(2);
    expect(sessionStorage.getItem('offline_replay_token')).toBe('grant-2');
    expect(sessionStorage.getItem('offline_grant_failed')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('first attempt failed'), expect.anything());
  });

  it('flags offline mode as broken when the grant fails twice, but the login itself still succeeds', async () => {
    const api = mockApi([
      loginRoute(),
      { method: 'POST', path: '/api/auth/offline-grant', status: 500, body: { error: 'INTERNAL', message: 'nope' } },
      { path: '/api/auth/me', body: meUser },
    ]);
    renderPage(<Probe />, { api });
    await act(async () => { await latest.login('alice', 'pw'); });
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(2);
    expect(sessionStorage.getItem('offline_grant_failed')).toBe('1');
    expect(sessionStorage.getItem('offline_replay_token')).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBe('tok-alice');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('after retry'), expect.anything());
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent(/^\/$/));
  });

  it('a rejected login throws and writes nothing', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/auth/login', status: 400, body: { error: 'INVALID_PASSWORD', message: 'Wrong password', attemptsRemaining: 2 } }]);
    renderPage(<Probe />, { route: '/login', api });
    let caught: any;
    await act(async () => { await latest.login('alice', 'bad').catch((e) => { caught = e; }); });
    expect(caught.message).toBe('Wrong password');
    expect(caught.attemptsRemaining).toBe(2);
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(0);
    expect(screen.getByTestId('path')).toHaveTextContent('/login');
  });
});

describe('useAuth.logout', () => {
  function seedSession(tabOwner: 'me' | 'other') {
    sessionStorage.setItem('digilog_tab_id', 'TAB-ME');
    localStorage.setItem('access_token_backup', 'old');
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    sessionStorage.setItem('offline_replay_token', 'g');
    sessionStorage.setItem('offline_replay_expires', 'e');
    localStorage.setItem('offline_replay_token_backup', 'g');
    localStorage.setItem('offline_replay_expires_backup', 'e');
    localStorage.setItem('digilog_last_server_contact', String(Date.now()));
    localStorage.setItem('digilog_active_tab_id', tabOwner === 'me' ? 'TAB-ME' : 'TAB-OTHER');
    localStorage.setItem('digilog_tab_heartbeat', String(Date.now()));
    localStorage.setItem('digilog_active_user_id', JSON.stringify({ userId: 'u-1' }));
  }

  it('posts the reason, clears every credential and the single-tab claim, and goes to /login', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/auth/logout', body: { success: true } }]);
    renderPage(<Probe />, { route: '/audit', user: meUser, api });
    seedSession('me');
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('true'));

    await act(async () => { await latest.logout('idle_timeout'); });

    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason: 'idle_timeout' });
    for (const k of ['access_token', 'offline_replay_token', 'offline_replay_expires']) expect(sessionStorage.getItem(k)).toBeNull();
    for (const k of ['access_token_backup', 'digilog_cached_user', 'offline_replay_token_backup', 'offline_replay_expires_backup',
      'digilog_last_server_contact', 'digilog_active_tab_id', 'digilog_tab_heartbeat', 'digilog_active_user_id']) {
      expect(localStorage.getItem(k), k).toBeNull();
    }
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/login'));
    expect(screen.getByTestId('authed')).toHaveTextContent('false');
  });

  it('defaults the reason to manual and leaves another tab\'s claim alone', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/auth/logout', body: {} }]);
    renderPage(<Probe />, { user: meUser, api });
    seedSession('other');
    await act(async () => { await latest.logout(); });
    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason: 'manual' });
    expect(localStorage.getItem('digilog_active_tab_id')).toBe('TAB-OTHER');
    expect(localStorage.getItem('digilog_tab_heartbeat')).not.toBeNull();
    expect(localStorage.getItem('digilog_active_user_id')).not.toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });

  it('still signs out locally when the server logout call fails', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/auth/logout', status: 500, body: { error: 'INTERNAL', message: 'down' } }]);
    renderPage(<Probe />, { user: meUser, api });
    await act(async () => { await latest.logout(); });
    expect(sessionStorage.getItem('access_token')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/login'));
  });
});

describe('useAuth.user identity', () => {
  // Consumers key effects on `user` (the tablet's open-time sync, the JWT refresh
  // timer). A fresh object per render re-ran them on every render while /me was
  // pending — the tablet downloaded its master data 5 times per open (2026-10-22).
  it('is the SAME object on every render while /me is pending, and stays stable once it answers', async () => {
    const api = mockApi();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/api/auth/me')) await gate;
      return (real as any)(input, init);
    }));
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    const seen: unknown[] = [];
    function Rerendering() {
      const auth = useAuth();
      const [n, setN] = React.useState(0);
      seen.push(auth.user);
      return <button onClick={() => setN(n + 1)}>again</button>;
    }
    renderPage(<Rerendering />, { user: { ...meUser, fullName: 'Alice (server)' }, api });
    for (let i = 0; i < 3; i++) await act(async () => { screen.getByRole('button', { name: 'again' }).click(); });
    expect(seen.length).toBeGreaterThanOrEqual(4);
    expect(new Set(seen).size).toBe(1); // one cached object, however many renders
    expect((seen[0] as any).fullName).toBe('Alice Doe');
    await act(async () => { release(); });
    await waitFor(() => expect((seen.at(-1) as any).fullName).toBe('Alice (server)'));
    const fetched = seen.at(-1);
    for (let i = 0; i < 2; i++) await act(async () => { screen.getByRole('button', { name: 'again' }).click(); });
    expect(seen.at(-1)).toBe(fetched);
  });
});

describe('useAuth.isAuthenticated', () => {
  it('is false with no token, and no /me request is made', async () => {
    const api = mockApi();
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser)); // stale cache must not authenticate
    renderPage(<Probe />, { api });
    expect(screen.getByTestId('authed')).toHaveTextContent('false');
    expect(api.calls('GET', '/api/auth/me')).toHaveLength(0);
    // D-L1: with no token there is no user — the previous operator's cached row must not
    // leak to useCan / RequireRole / useSuperAdminLock.
    expect(screen.getByTestId('user')).toHaveTextContent('-');
  });

  it('ignores an unparseable cached user', async () => {
    const api = mockApi([{ path: '/api/auth/me', status: 500, body: { error: 'INTERNAL', message: 'boom' } }]);
    localStorage.setItem('digilog_cached_user', '{not json');
    renderPage(<Probe />, { user: meUser, api }); // sets the token; the 500 route above wins over the harness /me
    await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    expect(screen.getByTestId('user')).toHaveTextContent('-');
    expect(screen.getByTestId('authed')).toHaveTextContent('false');
  });

  it('a server error with a cached user is NOT authenticated (only network failures keep the session)', async () => {
    const api = mockApi([{ path: '/api/auth/me', status: 500, body: { error: 'INTERNAL', message: 'boom' } }]);
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    renderPage(<Probe />, { user: meUser, api });
    expect(screen.getByTestId('user')).toHaveTextContent('alice'); // fallback data renders immediately
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('false'));
  });

  it('a 401 from /me ends the session (token and cached user cleared)', async () => {
    window.history.replaceState({}, '', '/login'); // already on /login: apiClient does not hard-navigate
    const api = mockApi([{ path: '/api/auth/me', status: 401, body: { error: 'UNAUTHORIZED', message: 'Session expired' } }]);
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    renderPage(<Probe />, { user: meUser, api });
    await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('false'));
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('digilog_cached_user')).toBeNull();
  });

  // Network failures (offline tablet) must keep the cached user signed in, AND the shared
  // SWR onError must treat every one of them as "offline" too (no console error / toast).
  // D-L2: both now read ONE list (lib/network-error.ts) — ECONNREFUSED used to be offline
  // here but a visible "Load Error" in swr-config.
  it.each([
    ['TypeError: Failed to fetch', () => new TypeError('Failed to fetch')],
    ['NetworkError', () => new Error('NetworkError when attempting to fetch resource.')],
    ['network request failed', () => new Error('Network request failed')],
    ['Safari load failed', () => new Error('Load failed')],
    ['ECONNREFUSED', () => new Error('connect ECONNREFUSED 10.0.0.1:3000')],
    ['Capacitor failed to connect', () => new Error('Failed to connect to /10.0.0.1:3000')],
    ['DNS', () => new Error('Unable to resolve host "api"')],
  ])('stays authenticated on a network failure, silently: %s', async (_label, makeErr) => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw makeErr(); }));
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    renderPage(<Probe />, { user: meUser, api: noApi() });
    await waitFor(() => expect((fetch as any).mock.calls.length).toBeGreaterThan(0));
    // give SWR a tick to record the error
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByTestId('authed')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('alice');
    expect(error).not.toHaveBeenCalled();
  });

  // The server ANSWERED (HTTP 500), so this is a server error even though its message
  // relays a connection failure of the backend's own — it must not keep the session.
  it('a server 500 whose message mentions ECONNREFUSED is not a network failure', async () => {
    const api = mockApi([{ path: '/api/auth/me', status: 500, body: { error: 'INTERNAL', message: 'connect ECONNREFUSED 127.0.0.1:5432' } }]);
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    renderPage(<Probe />, { user: meUser, api });
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('false'));
  });

  it('a plain Error that is not a network failure ends authentication', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Something unrelated'); }));
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    renderPage(<Probe />, { user: meUser, api: noApi() });
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('false'));
  });

  // swr-config treats ANY TypeError as offline for the toast decision; the keep-session
  // decision deliberately does not — a programming TypeError must not keep a session alive.
  it('a TypeError that is not a fetch failure ends authentication', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); }));
    localStorage.setItem('digilog_cached_user', JSON.stringify(meUser));
    renderPage(<Probe />, { user: meUser, api: noApi() });
    await waitFor(() => expect(screen.getByTestId('authed')).toHaveTextContent('false'));
  });
});

describe('useAuth background effects', () => {
  it('beforeunload releases this tab\'s single-tab claim, but not another tab\'s', async () => {
    const api = mockApi();
    renderPage(<Probe />, { user: meUser, api });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('alice'));
    sessionStorage.setItem('digilog_tab_id', 'TAB-ME');

    localStorage.setItem('digilog_active_tab_id', 'TAB-OTHER');
    localStorage.setItem('digilog_tab_heartbeat', '1');
    window.dispatchEvent(new Event('beforeunload'));
    expect(localStorage.getItem('digilog_active_tab_id')).toBe('TAB-OTHER');

    localStorage.setItem('digilog_active_tab_id', 'TAB-ME');
    localStorage.setItem('digilog_active_user_id', '{}');
    window.dispatchEvent(new Event('beforeunload'));
    expect(localStorage.getItem('digilog_active_tab_id')).toBeNull();
    expect(localStorage.getItem('digilog_tab_heartbeat')).toBeNull();
    expect(localStorage.getItem('digilog_active_user_id')).toBeNull();
  });

  it('refreshes the JWT 5 s after mount and every 30 min, through apiClient', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'], shouldAdvanceTime: true });
    const refresh = vi.spyOn(apiClient, 'refreshToken').mockResolvedValue(true);
    const api = mockApi();
    renderPage(<Probe />, { user: meUser, api });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('alice'));
    refresh.mockClear();
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(30 * 60 * 1000); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not refresh the JWT while a password change is forced', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'], shouldAdvanceTime: true });
    const refresh = vi.spyOn(apiClient, 'refreshToken').mockResolvedValue(true);
    const api = mockApi();
    renderPage(<Probe />, { user: { ...meUser, forcePasswordChange: true }, api });
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('alice'));
    refresh.mockClear();
    await act(async () => { vi.advanceTimersByTime(31 * 60 * 1000); });
    expect(refresh).not.toHaveBeenCalled();
  });
});
