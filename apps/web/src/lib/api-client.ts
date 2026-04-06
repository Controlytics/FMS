// NOTE: Prefer importing as `apiClient` using @/ alias across all files
const BASE_URL = import.meta.env.VITE_API_URL ?? '';

class ApiClient {
  private getToken(): string | null {
    return sessionStorage.getItem('access_token') || localStorage.getItem('access_token_backup');
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      ...(token && { Authorization: `Bearer ${token}` }),
    };
    // Only set Content-Type for requests with a body
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'PARSE_ERROR', message: 'Failed to parse server response' }));
      // Re-auth errors: throw without logging out so the dialog can show the error
      if (err.error === 'REAUTH_REQUIRED' || err.error === 'REAUTH_FAILED') {
        throw err;
      }
      // Force password change or password expired — redirect to change password
      if (err.error === 'FORCE_PASSWORD_CHANGE' || err.error === 'PASSWORD_EXPIRED') {
        window.location.href = '/change-password';
        throw err;
      }
      // Generic 401 = session expired, log out (but not during login itself)
      if (res.status === 401) {
        if (!url.includes('/api/auth/login')) {
          sessionStorage.removeItem('access_token');
          localStorage.removeItem('access_token_backup');
          // Redirect to login — use mobile login for /m routes
          const isMobile = window.location.pathname.startsWith('/m');
          const loginPath = isMobile ? '/m/login' : '/login';
          if (!window.location.pathname.startsWith(loginPath)) {
            if (isMobile) {
              window.location.href = '/m/login';
            } else {
              const returnPath = window.location.pathname + window.location.search;
              window.location.href = returnPath !== '/' ? `/login?returnUrl=${encodeURIComponent(returnPath)}` : '/login';
            }
          }
        }
        throw new Error(err.message ?? 'Invalid credentials');
      }
      const error = new Error(err.message ?? err.error ?? `Request failed: ${res.status}`);
      (error as any).code = err.error;
      (error as any).connectionInfo = err.connectionInfo;
      (error as any).activeSession = err.activeSession;
      throw error;
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  get<T>(url: string) { return this.request<T>(url); }
  post<T>(url: string, body: unknown, headers?: Record<string, string>) { return this.request<T>(url, { method: 'POST', body: JSON.stringify(body), ...(headers && { headers }) }); }
  put<T>(url: string, body: unknown, headers?: Record<string, string>) { return this.request<T>(url, { method: 'PUT', body: JSON.stringify(body), ...(headers && { headers }) }); }
  patch<T>(url: string, body: unknown) { return this.request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }); }
  delete<T>(url: string) { return this.request<T>(url, { method: 'DELETE' }); }

  // Re-auth variants: include password for actions requiring re-authentication
  // Password is sent in BOTH body (_currentPassword) and header (x-reauth-password)
  // to ensure the backend can always extract it regardless of body parsing behavior.
  withReauth<T>(method: string, url: string, password: string, body?: unknown) {
    const headers: Record<string, string> = { 'x-reauth-password': password };
    const opts: RequestInit = { method, headers };
    if (body !== undefined) {
      opts.body = JSON.stringify({ ...(body as object), _currentPassword: password });
    }
    return this.request<T>(url, opts);
  }
  deleteWithReauth<T>(url: string, password: string) {
    return this.withReauth<T>('DELETE', url, password);
  }
  postWithReauth<T>(url: string, body: unknown, password: string) {
    return this.withReauth<T>('POST', url, password, body);
  }
  putWithReauth<T>(url: string, body: unknown, password: string) {
    return this.withReauth<T>('PUT', url, password, body);
  }
  patchWithReauth<T>(url: string, body: unknown, password: string) {
    return this.withReauth<T>('PATCH', url, password, body);
  }
  getWithReauth<T>(url: string, password: string) {
    return this.withReauth<T>('GET', url, password);
  }
}

export const apiClient = new ApiClient();
export const api = apiClient;
