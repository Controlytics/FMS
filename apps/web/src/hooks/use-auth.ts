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
  const { data: user, error, isLoading, mutate } = useSWR<User>(
    sessionStorage.getItem('access_token') ? '/api/auth/me' : null,
  );

  const login = async (username: string, password: string, force?: boolean) => {
    const res = await apiClient.post<LoginResponse>('/api/auth/login', {
      username,
      password,
      ...(force && { force }),
    });
    sessionStorage.setItem('access_token', res.token);

    if (res.user.forcePasswordChange) {
      navigate('/change-password', { replace: true });
    } else {
      await mutate();
      const params = new URLSearchParams(window.location.search);
      const returnUrl = params.get('returnUrl') || '/';
      navigate(returnUrl, { replace: true });
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

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    login,
    logout,
    mutate,
  };
}
