const BASE_URL = process.env.API_URL || 'http://43.205.32.23:3000/api';

// Admin credentials
const ADMIN_USERNAME = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASS || 'Welcome@1234';

let cachedAdminToken: string | null = null;

export interface ApiResponse<T = any> {
  status: number;
  data: T;
  ok: boolean;
}

/** Small delay helper */
function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
  retries = 3,
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const hasBody = body !== null && body !== undefined;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    });

    // Retry on rate limit
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10);
      await sleep((retryAfter + 1) * 1000);
      continue;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    return { status: res.status, data, ok: res.ok };
  }

  // Should not reach here, but just in case
  return { status: 429, data: { error: 'Rate limited after retries' }, ok: false };
}

export async function getAdminToken(): Promise<string> {
  if (cachedAdminToken) return cachedAdminToken;

  const res = await api('POST', '/auth/login', {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
    forceLogin: true,
  });

  if (!res.ok) {
    throw new Error(`Admin login failed: ${JSON.stringify(res.data)}`);
  }

  cachedAdminToken = res.data.token;
  return cachedAdminToken!;
}

export function clearAdminToken() {
  cachedAdminToken = null;
}

export function getAdminPassword() {
  return ADMIN_PASSWORD;
}

/** Generate a 6-char uppercase alphanumeric ID for usernames */
export function uid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  // Start with a letter to avoid all-numeric IDs
  result += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
  for (let i = 1; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/** Generate a short lowercase suffix for non-username fields */
export function suffix() {
  return Math.random().toString(36).substring(2, 8);
}

/** Create a test user and return { id, username, token } */
export async function createTestUser(
  adminToken: string,
  overrides: Record<string, unknown> = {},
) {
  const id = uid();
  const username = id; // Exactly 6 chars, uppercase, alphanumeric
  const password = 'TestPass@123';
  const sfx = suffix();
  const payload = {
    username,
    fullName: `Test User ${sfx}`,
    email: `${sfx}@test.com`,
    role: 'OPERATOR',
    password,
    confirmPassword: password,
    status: 'ENABLED',
    ...overrides,
  };

  const res = await api('POST', '/users', payload, adminToken);
  if (!res.ok) {
    throw new Error(`createTestUser failed: ${JSON.stringify(res.data)}`);
  }

  return { id: res.data.id, username, password, email: payload.email as string, data: res.data };
}

/** Login as a test user, handling forcePasswordChange and concurrent sessions */
export async function loginTestUser(username: string, password: string, newPassword?: string) {
  const res = await api('POST', '/auth/login', { username, password, forceLogin: true });
  if (!res.ok) return res;

  if (res.data.user?.forcePasswordChange && newPassword) {
    await api('POST', '/auth/change-password', {
      currentPassword: password,
      newPassword,
      confirmPassword: newPassword,
    }, res.data.token);

    const reLogin = await api('POST', '/auth/login', { username, password: newPassword, forceLogin: true });
    return reLogin;
  }

  return res;
}
