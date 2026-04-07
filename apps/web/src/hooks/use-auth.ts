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
  organizationId?: string | null;
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

export function useAuth() {
  const navigate = useNavigate();
  const getToken = () => sessionStorage.getItem('access_token') || localStorage.getItem('access_token_backup');
  const { data: user, error, isLoading, mutate } = useSWR<User>(
    getToken() ? '/api/auth/me' : null,
  );

  const login = async (username: string, password: string, force?: boolean) => {
    const res = await apiClient.post<LoginResponse>('/api/auth/login', {
      username,
      password,
      ...(force && { force }),
    });
    sessionStorage.setItem('access_token', res.token);
    localStorage.setItem('access_token_backup', res.token);

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

  // Periodically refresh JWT token to prevent expiry (every 30 minutes)
  useEffect(() => {
    const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
    const refreshToken = async () => {
      const token = sessionStorage.getItem('access_token');
      if (!token) return;

      // Prevent multiple tabs from refreshing simultaneously
      const lockKey = 'digilog_token_refresh_lock';
      const lockValue = localStorage.getItem(lockKey);
      if (lockValue && Date.now() - parseInt(lockValue) < 10000) return; // Another tab is refreshing
      localStorage.setItem(lockKey, String(Date.now()));

      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            sessionStorage.setItem('access_token', data.token);
            localStorage.setItem('access_token_backup', data.token);
          }
        }
      } catch {
        // Silent fail — next request will trigger 401 logout if token truly expired
      } finally {
        localStorage.removeItem(lockKey);
      }
    };

    const interval = setInterval(refreshToken, REFRESH_INTERVAL);
    // Also refresh once shortly after mount to extend token on page load
    const initialRefresh = setTimeout(refreshToken, 5000);
    return () => { clearInterval(interval); clearTimeout(initialRefresh); };
  }, [user]);

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    login,
    logout,
    mutate,
  };
}

