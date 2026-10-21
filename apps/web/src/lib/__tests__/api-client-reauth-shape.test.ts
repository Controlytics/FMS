import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Deep-review fix D6 verification (2026-05-17).
 *
 * Mobile's handleSubmitQueue per-item catch reads `e?.error ?? e?.code` to
 * detect REAUTH errors and re-throw them so the reauth dialog stays open
 * instead of being swallowed into the batch's `failed[]` list.
 *
 * This test locks the api-client error shape that contract depends on:
 *   - REAUTH_REQUIRED / REAUTH_FAILED responses are thrown RAW (the parsed
 *     JSON body), so `.error === 'REAUTH_REQUIRED'` is the discriminator.
 *   - Other 4xx errors are wrapped in `new Error(...)` with `.code` set to
 *     the body's `error` field.
 *
 * If either path changes shape, mobile's D6 catch will silently start
 * swallowing REAUTH again. This test breaks first.
 */

const mockFetch = vi.fn();
const originalFetch = globalThis.fetch;

vi.mock('../themes', () => ({}));

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = mockFetch as any;
  // Stub sessionStorage / localStorage for the Node test env so the
  // 401-side-effects branch doesn't blow up.
  if (typeof globalThis.sessionStorage === 'undefined') {
    const storage = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as any;
  }
  if (typeof globalThis.localStorage === 'undefined') {
    const storage = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v); },
      removeItem: (k: string) => { storage.delete(k); },
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as any;
  }
  // window for the location-redirect branch
  if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = { location: { pathname: '/', search: '', href: '/' } };
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('D6 — api-client REAUTH error shape contract', () => {
  it('throws raw REAUTH_REQUIRED body so mobile catch sees e.error === "REAUTH_REQUIRED"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({
        error: 'REAUTH_REQUIRED',
        message: 'Re-authentication required',
        details: { action: 'START_CLEANING_CYCLE' },
      }),
    });

    const { apiClient } = await import('../api-client');
    let thrown: any = null;
    try {
      await apiClient.post('/api/filters/x/start-cycle', {});
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    // Mobile D6 catch reads `e?.error ?? e?.code` — must match the raw body shape.
    expect(thrown?.error).toBe('REAUTH_REQUIRED');
    expect(thrown?.message).toBe('Re-authentication required');
  });

  it('throws raw REAUTH_FAILED body so mobile catch sees e.error === "REAUTH_FAILED"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: { get: () => null },
      json: async () => ({
        error: 'REAUTH_FAILED',
        message: 'Incorrect password',
      }),
    });

    const { apiClient } = await import('../api-client');
    let thrown: any = null;
    try {
      await apiClient.post('/api/filters/x/advance', {});
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.error).toBe('REAUTH_FAILED');
  });

  it('throws an Error with .code for non-REAUTH 4xx so mobile fallback catch (e.code path) still works', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: { get: () => null },
      json: async () => ({
        error: 'BLOCK_CHANGE_REQUIRED',
        message: 'Filter belongs to a different block',
        details: { homeBlockId: 'b-1', requestedBlockId: 'b-2' },
      }),
    });

    const { apiClient } = await import('../api-client');
    let thrown: any = null;
    try {
      await apiClient.post('/api/filters/x/advance', {});
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.code).toBe('BLOCK_CHANGE_REQUIRED');
    expect(thrown.connectionInfo).toEqual({ homeBlockId: 'b-1', requestedBlockId: 'b-2' });
  });
});

// 2026-10-21 (web coverage F1/F2/F3): one error shape, and a wrong password is
// not an ended session.
describe('api-client — one error shape; a wrong password keeps the session', () => {
  const respond = (status: number, body: unknown) => mockFetch.mockResolvedValueOnce({
    ok: false, status, headers: { get: () => null }, json: async () => body,
  });
  const failure = async (url: string) => {
    const { apiClient } = await import('../api-client');
    try { await apiClient.post(url, {}); } catch (e) { return e as any; }
    throw new Error('expected the request to fail');
  };

  it('an Error carries the server code on BOTH .code and .error (a locked account is recognisable)', async () => {
    respond(403, { error: 'ACCOUNT_LOCKED', message: 'Account locked' });
    const e = await failure('/api/audit/report-export-log');
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({ status: 403, code: 'ACCOUNT_LOCKED', error: 'ACCOUNT_LOCKED', message: 'Account locked' });
  });

  it('401 INVALID_PASSWORD from /api/auth/verify keeps the session and says so', async () => {
    sessionStorage.setItem('access_token', 'live-token');
    respond(401, { error: 'INVALID_PASSWORD', message: 'Password is incorrect' });
    const e = await failure('/api/auth/verify');
    expect(e).toMatchObject({ status: 401, code: 'INVALID_PASSWORD', error: 'INVALID_PASSWORD' });
    expect(sessionStorage.getItem('access_token')).toBe('live-token');
  });

  it('control: 401 SESSION_EXPIRED still ends the session', async () => {
    sessionStorage.setItem('access_token', 'live-token');
    respond(401, { error: 'SESSION_EXPIRED', message: 'Session expired' });
    const e = await failure('/api/filters');
    expect(e).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });

  it('apiErrorFromResponse builds the same shape for pages that call fetch themselves', async () => {
    const { apiErrorFromResponse } = await import('../api-client');
    const e = apiErrorFromResponse(401, { error: 'REAUTH_FAILED', message: 'Invalid password' }, 'fallback');
    expect(e).toMatchObject({ status: 401, code: 'REAUTH_FAILED', error: 'REAUTH_FAILED', message: 'Invalid password' });
    expect(apiErrorFromResponse(500, null, 'Upload failed (HTTP 500)').message).toBe('Upload failed (HTTP 500)');
  });
});
