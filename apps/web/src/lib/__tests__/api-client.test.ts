/**
 * api-client — request building, response/error shaping, the 401 logout path,
 * the W4 hard-cutoff gate and the shared JWT refresh (coverage campaign
 * 2026-10-21).
 *
 * Only the network edge is stubbed: global `fetch` (via the page harness's
 * `mockApi`, or a raw Response stub where the body must not be JSON) and, for
 * the redirect branches, `window.location` (jsdom cannot navigate, so a plain
 * object stands in and the test reads the `href` the client assigned).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockApi, type MockRequest } from '@/test-utils/page-harness';
import { apiClient, api } from '../api-client';

const CONTACT_KEY = 'digilog_last_server_contact';

interface FakeLocation { pathname: string; href: string; search: string }
function stubLocation(pathname: string): FakeLocation {
  const loc: FakeLocation = { pathname, href: pathname, search: '' };
  vi.stubGlobal('location', loc);
  return loc;
}

/** A fetch stub for bodies the page harness cannot express (non-JSON, empty 200). */
function stubRawFetch(status: number, text: string) {
  const fn = vi.fn(async () => new Response(text, { status, headers: { 'Content-Type': 'text/html' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  delete (window as any).__API_BASE__;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('request building', () => {
  it('GET sends Bearer token from sessionStorage, no Content-Type, and prefixes the stored server URL', async () => {
    localStorage.setItem('digilog.serverUrl', 'https://10.0.0.9:3000');
    sessionStorage.setItem('access_token', 'tok-1');
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(apiClient.get('/api/things?x=1')).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://10.0.0.9:3000/api/things?x=1');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-1' });
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('sends no Authorization header when signed out', async () => {
    const m = mockApi([{ path: '/api/public', body: { v: 1 } }]);
    await apiClient.get('/api/public');
    expect(m.requests[0].headers).toEqual({});
  });

  it('POST serialises the body as JSON and sets Content-Type; extra headers merge over defaults', async () => {
    sessionStorage.setItem('access_token', 't');
    const m = mockApi([{ method: 'POST', path: '/api/x', body: (req: MockRequest) => ({ echo: req.json }) }]);
    const out = await apiClient.post('/api/x', { a: 1 }, { 'x-client-op-id': 'op-1' });
    expect(out).toEqual({ echo: { a: 1 } });
    expect(m.requests[0].headers).toEqual({
      authorization: 'Bearer t',
      'content-type': 'application/json',
      'x-client-op-id': 'op-1',
    });
  });

  it('PUT and PATCH send their method and JSON body; PUT accepts extra headers', async () => {
    const m = mockApi([
      { method: 'PUT', path: '/api/p', body: {} },
      { method: 'PATCH', path: '/api/p', body: {} },
    ]);
    await apiClient.put('/api/p', { b: 2 });
    await apiClient.put('/api/p', { b: 3 }, { 'x-h': '1' });
    await api.patch('/api/p', { c: 4 });
    expect(m.requests.map((r) => [r.method, r.json])).toEqual([['PUT', { b: 2 }], ['PUT', { b: 3 }], ['PATCH', { c: 4 }]]);
    expect(m.requests[1].headers['x-h']).toBe('1');
  });

  it('DELETE always carries Content-Type and a JSON body ({} by default) — Android CapacitorHttp 415 quirk', async () => {
    const m = mockApi([{ method: 'DELETE', path: /\/api\/d\//, body: {} }]);
    await apiClient.delete('/api/d/1');
    await apiClient.delete('/api/d/2', { reason: 'dup' });
    expect(m.requests[0].headers['content-type']).toBe('application/json');
    expect(m.requests[0].json).toEqual({});
    expect(m.requests[1].json).toEqual({ reason: 'dup' });
  });
});

describe('re-auth variants send the password in header AND body', () => {
  it('postWithReauth merges _currentPassword into the body and sets x-reauth-password', async () => {
    const m = mockApi([{ method: 'POST', path: '/api/r', body: { ok: true } }]);
    await apiClient.postWithReauth('/api/r', { a: 1 }, 'pw');
    expect(m.requests[0].headers['x-reauth-password']).toBe('pw');
    expect(m.requests[0].headers['content-type']).toBe('application/json');
    expect(m.requests[0].json).toEqual({ a: 1, _currentPassword: 'pw' });
  });

  it('put/patch/delete WithReauth use their method; delete with no body still sends only the password', async () => {
    const m = mockApi([
      { method: 'PUT', path: '/api/r', body: {} },
      { method: 'PATCH', path: '/api/r', body: {} },
      { method: 'DELETE', path: '/api/r', body: {} },
    ]);
    await apiClient.putWithReauth('/api/r', { p: 1 }, 'pw1');
    await apiClient.patchWithReauth('/api/r', { q: 2 }, 'pw2');
    await apiClient.deleteWithReauth('/api/r', 'pw3');
    await apiClient.deleteWithReauth('/api/r', 'pw4', { reason: 'r' });
    expect(m.requests.map((r) => [r.method, r.json])).toEqual([
      ['PUT', { p: 1, _currentPassword: 'pw1' }],
      ['PATCH', { q: 2, _currentPassword: 'pw2' }],
      ['DELETE', { _currentPassword: 'pw3' }],
      ['DELETE', { reason: 'r', _currentPassword: 'pw4' }],
    ]);
  });

  it('getWithReauth (and HEAD) send the header but no body and no Content-Type', async () => {
    const m = mockApi([
      { path: '/api/g', body: { v: 1 } },
      { method: 'HEAD', path: '/api/g', status: 204 },
    ]);
    await expect(apiClient.getWithReauth('/api/g', 'pw')).resolves.toEqual({ v: 1 });
    await apiClient.withReauth('HEAD', '/api/g', 'pw');
    for (const r of m.requests) {
      expect(r.headers['x-reauth-password']).toBe('pw');
      expect(r.headers['content-type']).toBeUndefined();
      expect(r.json).toBeUndefined();
    }
  });
});

describe('successful responses', () => {
  it('204 resolves undefined', async () => {
    mockApi([{ method: 'DELETE', path: '/api/n', status: 204 }]);
    await expect(apiClient.delete('/api/n')).resolves.toBeUndefined();
  });

  it('an empty 200 body resolves undefined instead of a JSON parse crash', async () => {
    stubRawFetch(200, '');
    await expect(apiClient.get('/api/empty')).resolves.toBeUndefined();
  });

  it('a non-JSON 200 body (SPA index.html fallback) throws "Failed to parse server response"', async () => {
    stubRawFetch(200, '<!doctype html><html></html>');
    await expect(apiClient.get('/api/x')).rejects.toThrow('Failed to parse server response');
  });

  it('records server contact for any < 500 response, not for a 5xx', async () => {
    mockApi([{ path: '/api/ok', body: {} }, { path: '/api/boom', status: 502, body: { error: 'BAD_GATEWAY' } }]);
    await apiClient.get('/api/ok');
    const first = Number(localStorage.getItem(CONTACT_KEY));
    expect(first).toBeGreaterThan(0);
    localStorage.removeItem(CONTACT_KEY);
    await expect(apiClient.get('/api/boom')).rejects.toMatchObject({ status: 502 });
    expect(localStorage.getItem(CONTACT_KEY)).toBeNull();
  });
});

describe('error shaping', () => {
  it('a non-JSON error body becomes PARSE_ERROR with the HTTP status', async () => {
    stubRawFetch(500, '<html>proxy error</html>');
    await expect(apiClient.get('/api/x')).rejects.toMatchObject({
      message: 'Failed to parse server response', status: 500, code: 'PARSE_ERROR',
    });
  });

  it('wraps a JSON error: message, status, code, connectionInfo (details), activeSession, attemptsRemaining', async () => {
    mockApi([{ method: 'POST', path: '/api/auth/login', status: 409, body: {
      error: 'SESSION_CONFLICT', message: 'Already signed in elsewhere',
      details: { ip: '10.0.0.2' }, activeSession: { id: 's1' }, attemptsRemaining: 2,
    } }]);
    const err: any = await apiClient.post('/api/auth/login', {}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Already signed in elsewhere');
    expect(err.status).toBe(409);
    expect(err.code).toBe('SESSION_CONFLICT');
    expect(err.connectionInfo).toEqual({ ip: '10.0.0.2' });
    expect(err.activeSession).toEqual({ id: 's1' });
    expect(err.attemptsRemaining).toBe(2);
    expect('currentTapeVersion' in err).toBe(false);
  });

  it('falls back to connectionInfo, then to the error code, then to "Request failed: <status>"', async () => {
    mockApi([
      { path: '/api/a', status: 400, body: { error: 'BAD_INPUT', connectionInfo: { via: 'ci' } } },
      { path: '/api/b', status: 418, body: {} },
    ]);
    const a: any = await apiClient.get('/api/a').catch((e) => e);
    expect(a.message).toBe('BAD_INPUT');
    expect(a.connectionInfo).toEqual({ via: 'ci' });
    expect('attemptsRemaining' in a).toBe(false);
    const b: any = await apiClient.get('/api/b').catch((e) => e);
    expect(b.message).toBe('Request failed: 418');
    expect(b.code).toBeUndefined();
  });

  it('lifts details.currentTapeVersion to a top-level field on 409 STALE_TAPE', async () => {
    mockApi([{ method: 'POST', path: '/api/filters/f1/advance', status: 409, body: {
      error: 'STALE_TAPE', message: 'stale', details: { currentTapeVersion: 7 },
    } }]);
    const err: any = await apiClient.post('/api/filters/f1/advance', {}).catch((e) => e);
    expect(err.code).toBe('STALE_TAPE');
    expect(err.currentTapeVersion).toBe(7);
  });
});

// Contract: the code rides on `.error` (what useReauth / stage-reauth read) with the
// server's message, and the session survives. The exact object is NOT pinned: today
// it is the raw body, and moving it onto apiErrorFromResponse (5859053's "one error
// shape") must not fail this test.
describe('REAUTH errors carry their code and never log out', () => {
  it('a 401 REAUTH_FAILED keeps the session token and does not redirect', async () => {
    const loc = stubLocation('/users');
    sessionStorage.setItem('access_token', 'keep-me');
    mockApi([{ method: 'POST', path: '/api/x', status: 401, body: { error: 'REAUTH_FAILED', message: 'Incorrect password' } }]);
    const err: any = await apiClient.post('/api/x', {}).catch((e) => e);
    expect(err).toMatchObject({ error: 'REAUTH_FAILED', message: 'Incorrect password' });
    expect(sessionStorage.getItem('access_token')).toBe('keep-me');
    expect(loc.href).toBe('/users');
  });
});

describe('FORCE_PASSWORD_CHANGE / PASSWORD_EXPIRED', () => {
  it('redirects to /change-password and throws an error carrying the code', async () => {
    const loc = stubLocation('/dashboard');
    mockApi([{ path: '/api/me', status: 403, body: { error: 'PASSWORD_EXPIRED', message: 'expired' } }]);
    await expect(apiClient.get('/api/me')).rejects.toMatchObject({ error: 'PASSWORD_EXPIRED', message: 'expired' });
    expect(loc.href).toBe('/change-password');
  });

  it('a LOGIN refused for an expired password is thrown to the login screen, never redirected (no session exists)', async () => {
    for (const path of ['/login', '/m/login']) {
      const loc = stubLocation(path);
      mockApi([{ method: 'POST', path: '/api/auth/login', status: 403, body: { error: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } }]);
      const err: any = await apiClient.post('/api/auth/login', { username: 'u', password: 'p' }).catch((e) => e);
      expect(err).toMatchObject({ error: 'PASSWORD_EXPIRED', message: 'Your password has expired.' });
      expect(loc.href).toBe(path);
    }
  });

  it('does not hard-reload when already on /change-password (operator mid-typing)', async () => {
    const loc = stubLocation('/change-password');
    loc.href = 'unchanged';
    mockApi([{ method: 'POST', path: '/api/auth/refresh', status: 403, body: { error: 'FORCE_PASSWORD_CHANGE' } }]);
    await expect(apiClient.post('/api/auth/refresh', {})).rejects.toMatchObject({ error: 'FORCE_PASSWORD_CHANGE' });
    expect(loc.href).toBe('unchanged');
  });
});

describe('generic 401 = session expired', () => {
  const seedSession = () => {
    sessionStorage.setItem('access_token', 'old');
    for (const k of ['access_token_backup', 'digilog_cached_user', 'digilog_active_tab_id', 'digilog_tab_heartbeat', 'digilog_active_user_id', 'unrelated']) {
      localStorage.setItem(k, 'v');
    }
  };

  it('clears the session + single-tab keys, keeps unrelated keys, redirects a desktop page to /login', async () => {
    const loc = stubLocation('/filters');
    seedSession();
    mockApi([{ path: '/api/filters', status: 401, body: { error: 'UNAUTHORIZED', message: 'Token expired' } }]);
    const err: any = await apiClient.get('/api/filters').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Token expired');
    expect(err.status).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(sessionStorage.getItem('access_token')).toBeNull();
    for (const k of ['access_token_backup', 'digilog_cached_user', 'digilog_active_tab_id', 'digilog_tab_heartbeat', 'digilog_active_user_id']) {
      expect(localStorage.getItem(k)).toBeNull();
    }
    expect(localStorage.getItem('unrelated')).toBe('v');
    expect(loc.href).toBe('/login'); // no returnUrl
  });

  it('redirects a tablet page (/m...) to /m/login', async () => {
    const loc = stubLocation('/m');
    seedSession();
    mockApi([{ path: '/api/x', status: 401, body: {} }]);
    const err: any = await apiClient.get('/api/x').catch((e) => e);
    expect(err.message).toBe('Invalid credentials');
    expect(loc.href).toBe('/m/login');
  });

  it('does not redirect when already on the login page', async () => {
    const loc = stubLocation('/m/login');
    loc.href = 'unchanged';
    mockApi([{ path: '/api/x', status: 401, body: {} }]);
    await apiClient.get('/api/x').catch(() => undefined);
    expect(loc.href).toBe('unchanged');
  });

  it('a 401 from /api/auth/login itself (wrong password) keeps storage and does not redirect', async () => {
    const loc = stubLocation('/login');
    loc.href = 'unchanged';
    seedSession();
    mockApi([{ method: 'POST', path: '/api/auth/login', status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'Wrong password' } }]);
    const err: any = await apiClient.post('/api/auth/login', { username: 'u', password: 'p' }).catch((e) => e);
    expect(err).toMatchObject({ message: 'Wrong password', status: 401, code: 'INVALID_CREDENTIALS' });
    expect(sessionStorage.getItem('access_token')).toBe('old');
    expect(localStorage.getItem('digilog_cached_user')).toBe('v');
    expect(loc.href).toBe('unchanged');
  });
});

describe('W4 hard-cutoff gate', () => {
  const stale = () => localStorage.setItem(CONTACT_KEY, String(Date.now() - 48 * 60 * 60 * 1000));

  it('refuses mutating methods before the network with HARD_CUTOFF / 503', async () => {
    stale();
    const m = mockApi([]);
    for (const call of [
      () => apiClient.post('/api/x', {}),
      () => apiClient.put('/api/x', {}),
      () => apiClient.patch('/api/x', {}),
      () => apiClient.delete('/api/x'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'HARD_CUTOFF', status: 503, message: expect.stringMatching(/Read-only mode/) });
    }
    expect(m.requests).toHaveLength(0);
  });

  it('still lets GET, login and token refresh through so the operator can recover', async () => {
    stale();
    const m = mockApi([
      { path: '/api/x', body: { v: 1 } },
      { method: 'POST', path: '/api/auth/login', body: { token: 't' } },
      { method: 'POST', path: '/api/auth/refresh', body: {} },
    ]);
    await apiClient.get('/api/x');
    await apiClient.post('/api/auth/login', {});
    stale();
    await apiClient.post('/api/auth/refresh', {});
    expect(m.requests.map((r) => r.path)).toEqual(['/api/x', '/api/auth/login', '/api/auth/refresh']);
  });

  it('does not block writes when contact is recent or was never recorded', async () => {
    const m = mockApi([{ method: 'POST', path: '/api/x', body: {} }]);
    await apiClient.post('/api/x', {});           // never recorded → not exceeded
    localStorage.setItem(CONTACT_KEY, String(Date.now() - 1000));
    await apiClient.post('/api/x', {});           // recent → not exceeded
    expect(m.calls('POST', '/api/x')).toHaveLength(2);
  });
});

describe('refreshToken — one shared in-flight request', () => {
  // Each test takes a FRESH ApiClient: the singleton's in-flight guard is module
  // state, and a no-token call leaves it set for good (defect D1 in the
  // coverage report), which would leak between tests.
  const freshClient = async () => {
    vi.resetModules();
    return (await import('../api-client')).apiClient;
  };

  it('returns false without a request when there is no token', async () => {
    const client = await freshClient();
    const m = mockApi([]);
    await expect(client.refreshToken()).resolves.toBe(false);
    expect(m.requests).toHaveLength(0);
  });

  it('stores the new token and coalesces concurrent callers into one request', async () => {
    const client = await freshClient();
    sessionStorage.setItem('access_token', 'old');
    const m = mockApi([{ method: 'POST', path: '/api/auth/refresh', body: { token: 'new' } }]);
    const [a, b] = await Promise.all([client.refreshToken(), client.refreshToken()]);
    expect([a, b]).toEqual([true, true]);
    expect(m.calls('POST', '/api/auth/refresh')).toHaveLength(1);
    expect(m.requests[0].headers.authorization).toBe('Bearer old');
    expect(m.requests[0].json).toEqual({});
    expect(sessionStorage.getItem('access_token')).toBe('new');

    // After the microtask the guard clears: a NEW caller fires a fresh request.
    await Promise.resolve();
    await client.refreshToken();
    expect(m.calls('POST', '/api/auth/refresh')).toHaveLength(2);
  });

  it('returns false (and keeps the token) when the server answers without a token or fails', async () => {
    const client = await freshClient();
    sessionStorage.setItem('access_token', 'old');
    const m = mockApi([
      { method: 'POST', path: '/api/auth/refresh', body: {}, times: 1 },
      { method: 'POST', path: '/api/auth/refresh', status: 500, body: { error: 'X' } },
    ]);
    await expect(client.refreshToken()).resolves.toBe(false);
    await Promise.resolve();
    await expect(client.refreshToken()).resolves.toBe(false);
    expect(m.calls('POST', '/api/auth/refresh')).toHaveLength(2);
    expect(sessionStorage.getItem('access_token')).toBe('old');
  });
});
