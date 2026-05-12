import { useEffect } from 'react';
import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api-client';

interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  department?: string;
  photoUrl?: string;
  role: string;
  status: string;
  forcePasswordChange: boolean;
  isTemporaryPassword: boolean;
  lastLogin: string | null;
  createdAt?: string;
  permissions?: string[];
  scope?: string | null;
}

interface LoginResponse {
  success: boolean;
  token: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    role: string;
    forcePasswordChange: boolean;
    isTemporaryPassword: boolean;
  };
}

/** Check if an error is a network failure (not a real API error like 401) */
function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || '').toLowerCase();
  return (err instanceof TypeError && msg.includes('fetch'))
    || msg.includes('failed to fetch') || msg.includes('networkerror')
    || msg.includes('network request failed') || msg.includes('load failed')
    || msg.includes('econnrefused') || msg.includes('unable to resolve host');
}

export function useAuth() {
  const navigate = useNavigate();
  const getToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('access_token_backup');

  // Cache user data for offline use
  const getCachedUser = (): User | undefined => {
    try {
      const cached = localStorage.getItem('digilog_cached_user');
      return cached ? JSON.parse(cached) : undefined;
    } catch { return undefined; }
  };

  const { data: fetchedUser, error, isLoading, mutate } = useSWR<User>(
    getToken() ? '/api/auth/me' : null,
    {
      fallbackData: getCachedUser(),
      onSuccess: (data) => {
        if (data) localStorage.setItem('digilog_cached_user', JSON.stringify(data));
      },
    },
  );

  // Use fetched user when online, cached user as fallback when offline
  const user = fetchedUser ?? (getToken() ? getCachedUser() : undefined);

  const login = async (username: string, password: string, force?: boolean) => {
    const res = await apiClient.post<LoginResponse>('/api/auth/login', {
      username,
      password,
      ...(force && { force }),
    });
    sessionStorage.setItem('access_token', res.token);
    localStorage.setItem('access_token_backup', res.token);

    // Audit 2026-05-04 fix C1: fetch an offline-replay grant token using the
    // password the user just supplied (still in scope) so the sync engine can
    // replay queued offline ops after the bare `x-offline-replay: true`
    // header bypass was removed. Best-effort — if it fails, the user simply
    // can't replay until they reauth manually (clear failure mode, not silent
    // bypass).
    if (!res.user.forcePasswordChange) {
      try {
        const grant = await apiClient.post<{ token: string; expiresAt: string }>(
          '/api/auth/offline-grant',
          { _currentPassword: password },
        );
        sessionStorage.setItem('offline_replay_token', grant.token);
        sessionStorage.setItem('offline_replay_expires', grant.expiresAt);
        localStorage.setItem('offline_replay_token_backup', grant.token);
        localStorage.setItem('offline_replay_expires_backup', grant.expiresAt);
      } catch (e) {
        console.warn('[auth] Failed to fetch offline-replay grant on login:', e);
      }
    }

    if (res.user.forcePasswordChange) {
      navigate('/change-password', { replace: true });
    } else {
      await mutate();
      // Navigate to returnUrl if present (e.g., from QR code scan), otherwise home
      // Validate returnUrl is internal pathname only (prevent open redirect)
      const params = new URLSearchParams(window.location.search);
      const returnUrl = params.get("returnUrl");
      const isSafeReturnUrl = returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//') && !returnUrl.includes(':');
      navigate(isSafeReturnUrl ? returnUrl : "/", { replace: true });

    }

    return res;
  };

  const logout = async () => {
    try {
      await apiClient.post('/api/auth/logout', {});
    } catch {
      // ignore
    }
    sessionStorage.removeItem('access_token');
    localStorage.removeItem('access_token_backup');
    localStorage.removeItem('digilog_cached_user');
    // Audit 2026-05-04 fix C1: drop the offline-replay grant on logout so a
    // subsequent user (shared workstation) does not inherit the prior user's
    // offline-mode authorization.
    sessionStorage.removeItem('offline_replay_token');
    sessionStorage.removeItem('offline_replay_expires');
    localStorage.removeItem('offline_replay_token_backup');
    localStorage.removeItem('offline_replay_expires_backup');
    // Clean up single-tab localStorage keys
    const myTabId = sessionStorage.getItem('digilog_tab_id');
    if (myTabId && localStorage.getItem('digilog_active_tab_id') === myTabId) {
      localStorage.removeItem('digilog_active_tab_id');
      localStorage.removeItem('digilog_tab_heartbeat');
      localStorage.removeItem('digilog_active_user_id');
    }
    await mutate(undefined, false);
    navigate('/login', { replace: true });
  };

  // Clean up single-tab localStorage keys on tab close
  // Note: We do NOT use beacon logout on beforeunload because it fires on
  // both tab close AND page refresh, which causes the session to be terminated
  // on every refresh. Instead, we rely on the server-side idle session timeout
  // to clean up sessions when the user closes the tab.
  useEffect(() => {
    if (!user) return;

    const handleBeforeUnload = () => {
      // Clean up single-tab localStorage keys
      const myTabId = sessionStorage.getItem('digilog_tab_id');
      if (myTabId && localStorage.getItem('digilog_active_tab_id') === myTabId) {
        localStorage.removeItem('digilog_active_tab_id');
        localStorage.removeItem('digilog_tab_heartbeat');
        localStorage.removeItem('digilog_active_user_id');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user]);

  // Periodically refresh JWT token to prevent expiry (every 30 minutes).
  //
  // Audit 2026-05-04 fix #4 (web-plumbing review H — JWT refresh fragmentation):
  // routes through `apiClient.refreshToken()` instead of raw `fetch()` so the
  // request actually reaches the API on Capacitor APK builds (raw fetch with a
  // relative URL hits the WebView origin, which isn't the API host — the
  // refresh was silently no-op on tablet). The shared in-flight Promise guard
  // in apiClient.refreshToken() also coalesces with sync-engine's pre-replay
  // refresh and any future on-401 retry path so we don't double-fire.
  //
  // The 10-second cross-tab lock is dropped here — apiClient's per-process
  // in-flight Promise guards a single tab; cross-tab races only matter if
  // both tabs are actively talking to the API, in which case both refreshes
  // succeed and the second-applied wins (idempotent).
  useEffect(() => {
    const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
    const interval = setInterval(() => { void apiClient.refreshToken(); }, REFRESH_INTERVAL);
    // Also refresh once shortly after mount to extend token on page load.
    const initialRefresh = setTimeout(() => { void apiClient.refreshToken(); }, 5000);
    return () => { clearInterval(interval); clearTimeout(initialRefresh); };
  }, [user]);

  return {
    user,
    isLoading,
    // Network errors should NOT log the user out — only real 401s should.
    // When offline, SWR sets `error` to a TypeError("Failed to fetch"), but
    // we still have a cached user + token, so the user stays authenticated.
    // Token presence is required so a stale cached user (after a 401 cleared
    // the token) cannot keep the app authenticated and bounce between
    // /login → / → /login.
    isAuthenticated: !!user && !!getToken() && (!error || isNetworkError(error)),
    login,
    logout,
    mutate,
  };
}

