import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/api-client';

interface User {
  id: string;
  username: string;
  fullName: string;
  email: string;
  department?: string;
  role: string;
  status: string;
  forcePasswordChange: boolean;
  isTemporaryPassword: boolean;
  lastLogin: string | null;
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
    localStorage.getItem('access_token') ? '/api/auth/me' : null,
  );

  const login = async (username: string, password: string) => {
    const res = await apiClient.post<LoginResponse>('/api/auth/login', { username, password });
    localStorage.setItem('access_token', res.token);

    if (res.user.forcePasswordChange) {
      navigate('/change-password');
    } else {
      await mutate();
      navigate('/');
    }

    return res;
  };

  const logout = async () => {
    try {
      await apiClient.post('/api/auth/logout', {});
    } catch {
      // ignore
    }
    localStorage.removeItem('access_token');
    await mutate(undefined, false);
    navigate('/login');
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user && !error,
    login,
    logout,
    mutate,
  };
}
