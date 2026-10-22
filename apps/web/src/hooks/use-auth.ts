import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api-client';
import { clearServerContact } from '../lib/server-contact';
import { announceSessionEnded } from '../lib/session-events';
import { isNetworkFailure } from '../lib/network-error';

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

/**
 * Check if an error is a network failure (not a real API error like 401 or a 500).
 * The rule is shared with the SWR onError policy (lib/network-error.ts); a TypeError
 * counts only when it is a fetch failure, never any TypeError.
 */
function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = String(err?.message || '');
  return (err instanceof TypeError && msg.toLowerCase().includes('fetch')) || isNetworkFailure(err);
}

/**
 * The background JWT refresh: once ~5 s after the first consumer mounts (extends
 * the token on page load), then every 30 minutes. ONE schedule for the whole app
 * (2026-10-22): every component that calls useAuth() (useCan does, 46 source
 * files) used to start its own pair of timers, so each mount wave - a page, a
 * dialog - sent its own refresh. Consumers retain the schedule; the last one to
 * unmount stops it.
 */
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_REFRESH_MS = 5000;
let refreshConsumers = 0;
let refreshInterval: ReturnType<typeof setInterval> | undefined;
let initialRefresh: ReturnType<typeof setTimeout> | undefined;

function retainRefreshSchedule(): () => void {
  if (refreshConsumers++ === 0) {
    refreshInterval = setInterval(() => { void apiClient.refreshToken(); }, REFRESH_INTERVAL_MS);
    initialRefresh = setTimeout(() => { void apiClient.refreshToken(); }, INITIAL_REFRESH_MS);
  }
  return () => {
    if (--refreshConsumers > 0) return;
    clearInterval(refreshInterval);
    clearTimeout(initialRefresh);
    refreshInterval = undefined;
    initialRefresh = undefined;
  };
}

export function useAuth() {
  const navigate = useNavigate();
  const getToken = () => sessionStorage.getItem('access_token');

  // No token = signed out = no user. SWR returns `fallbackData` even for a null key,
  // so an ungated fallback handed the PREVIOUS operator's cached row to every
  // consumer (useCan, RequireRole, useSuperAdminLock) after a tab close (D-L1).
  const token = getToken();

  // Cache user data for offline use. Parsed once per stored string, so the
  // cached user is the SAME object on every render (2026-10-22): a fresh
  // JSON.parse per render made `user` a new object each time while /me was
  // pending (SWR hands `fallbackData` back as `data`), so every effect keyed on
  // `user` re-ran on every render — the tablet re-downloaded its master data
  // 5 times per open. Keyed on the stored string, so a login or /me rewriting
  // the cache still yields the new user.
  const cachedUserJson = token ? localStorage.getItem('digilog_cached_user') : null;
  const cachedUser = useMemo((): User | undefined => {
    if (!cachedUserJson) return undefined;
    try { return JSON.parse(cachedUserJson); } catch { return undefined; }
  }, [cachedUserJson]);

  const { data: fetchedUser, error, isLoading, mutate } = useSWR<User>(
    token ? '/api/auth/me' : null,
    {
      fallbackData: cachedUser,
      onSuccess: (data) => {
        if (data) localStorage.setItem('digilog_cached_user', JSON.stringify(data));
      },
    },
  );

  // Use fetched user when online, cached user as fallback when offline
  const user = token ? (fetchedUser ?? cachedUser) : undefined;

  const login = async (username: string, password: string, force?: boolean) => {
    const res = await apiClient.post<LoginResponse>('/api/auth/login', {
      username,
      password,
      ...(force && { force }),
    });
    sessionStorage.setItem('access_token', res.token);

    // Audit 2026-05-04 fix C1: fetch an offline-replay grant token using the
    // password the user just supplied (still in scope) so the sync engine can
    // replay queued offline ops after the bare `x-offline-replay: true`
    // header bypass was removed.
    //
    // 2026-05-20 fix: pre-fix the failure path was a bare console.warn that
    // left the user in a silent broken state — login succeeded, but the next
    // time they went offline, any queued ops would 401 REAUTH_REQUIRED on
    // replay and silently fail. Operator 101114 (Siva) hit exactly this on
    // 2026-05-20 11:04 (audit_trail shows LOGIN_SUCCESS but no GRANT_OFFLINE_REPLAY).
    //
    // Now: retry once on transient network failure, then surface a banner via
    // sessionStorage so the connectivity ribbon shows "Offline mode disabled"
    // and the operator knows to log back in. The sync engine's needs-reauth
    // pre-flight is the safety net if all three login attempts to mint a
    // grant silently fail.
    if (!res.user.forcePasswordChange) {
      const mintGrant = async (): Promise<void> => {
        const grant = await apiClient.post<{ token: string; expiresAt: string }>(
          '/api/auth/offline-grant',
          { _currentPassword: password },
        );
        sessionStorage.setItem('offline_replay_token', grant.token);
        sessionStorage.setItem('offline_replay_expires', grant.expiresAt);
        // offline_replay_token_backup intentionally kept in localStorage:
        // the grant outlives the session (Capacitor can clear sessionStorage
        // on backgrounding while the IndexedDB queue persists).
        localStorage.setItem('offline_replay_token_backup', grant.token);
        localStorage.setItem('offline_replay_expires_backup', grant.expiresAt);
        sessionStorage.removeItem('offline_grant_failed');
      };
      try {
        await mintGrant();
      } catch (e) {
        // One retry on transient network error before giving up.
        // eslint-disable-next-line no-console -- intentional structured log
        console.warn('[auth] Offline-replay grant first attempt failed; retrying once:', e);
        try {
          await new Promise((resolve) => setTimeout(resolve, 500));
          await mintGrant();
        } catch (e2) {
          // Surface persistently — the connectivity ribbon polls this on
          // mount; user sees a banner instead of a silent broken offline mode.
          // eslint-disable-next-line no-console -- intentional structured log
          console.error('[auth] Failed to fetch offline-replay grant after retry — offline mode will fail until next login:', e2);
          sessionStorage.setItem('offline_grant_failed', '1');
        }
      }
    }

    if (res.user.forcePasswordChange) {
      navigate('/change-password', { replace: true });
    } else {
      await mutate();
      // Every login lands on the dashboard. There is deliberately NO
      // returnUrl: logout and the 401 handler used to stamp the page the
      // previous user was on, so the NEXT user (often a different role) was
      // sent to that page and met "Access denied" (2026-10-03).
      navigate('/', { replace: true });
    }

    return res;
  };

  const logout = async (reason: 'manual' | 'idle_timeout' = 'manual') => {
    try {
      await apiClient.post('/api/auth/logout', { reason });
    } catch {
      // ignore
    }
    sessionStorage.removeItem('access_token');
    localStorage.removeItem('access_token_backup');
    localStorage.removeItem('digilog_cached_user');
    announceSessionEnded(); // close the old session's dialogs and toasts (D03-14)
    // Audit 2026-05-04 fix C1: drop the offline-replay grant on logout so a
    // subsequent user (shared workstation) does not inherit the prior user's
    // offline-mode authorization.
    sessionStorage.removeItem('offline_replay_token');
    sessionStorage.removeItem('offline_replay_expires');
    localStorage.removeItem('offline_replay_token_backup');
    localStorage.removeItem('offline_replay_expires_backup');
    // W3: clear the last-server-contact timestamp on logout. Otherwise a
    // shared workstation could inherit a stale timestamp from the previous
    // user, making the W4 hard-cutoff blocker disagree with reality on the
    // next login. The new session starts with no recorded contact and the
    // first apiClient call (e.g. POST /api/auth/login) reseeds it.
    clearServerContact();
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
    // 2026-05-21: skip background JWT refresh while the operator is on the
    // change-password screen with forcePasswordChange=true. The server
    // blocks /api/auth/refresh for fpc:true users (it's not in
    // PASSWORD_CHANGE_ALLOWED → 403 FORCE_PASSWORD_CHANGE). The api-client
    // 403 handler then hard-redirects to /change-password, which on Capacitor
    // tabletkicks in main.tsx's mount-time redirect and bounces the operator
    // to /m/login — mid-typing. Skipping the refresh is correct: the operator
    // is about to change their password anyway; extending the JWT here is
    // pointless.
    if (user?.forcePasswordChange) return;
    return retainRefreshSchedule();
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

