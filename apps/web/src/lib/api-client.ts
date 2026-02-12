const BASE_URL = import.meta.env.VITE_API_URL ?? '';

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const token = this.getToken();
    const res = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });

    if (res.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message ?? `Request failed: ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  }

  get<T>(url: string) { return this.request<T>(url); }
  post<T>(url: string, body: unknown) { return this.request<T>(url, { method: 'POST', body: JSON.stringify(body) }); }
  put<T>(url: string, body: unknown) { return this.request<T>(url, { method: 'PUT', body: JSON.stringify(body) }); }
  patch<T>(url: string, body: unknown) { return this.request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }); }
  delete<T>(url: string) { return this.request<T>(url, { method: 'DELETE' }); }
}

export const apiClient = new ApiClient();
