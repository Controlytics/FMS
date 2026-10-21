/**
 * stage-reauth — the per-station re-auth rows for a stage move, and
 * "sign once" for a loop of per-filter calls (coverage campaign 2026-10-21).
 *
 * `reauth` is a hand-built stand-in for `useReauth()`'s `executeWithResult`
 * (the dialog itself is covered in use-reauth / reauth-dialog tests); only
 * global `fetch` is stubbed for the POST /api/auth/verify call.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { useReauth } from '@/hooks/use-reauth';
import { mockApi, type MockRequest } from '@/test-utils/page-harness';
import { withStageAction, batchTargetState, preauthorize, signOnce } from '../stage-reauth';

/** executeWithResult that behaves like a confirmed dialog with `password` (or not gated when undefined). */
type ExecWithResult = Pick<ReturnType<typeof useReauth>, 'executeWithResult'>;
/** A stand-in for a confirmed dialog with `password` (undefined = not gated); the mock records each call. */
const confirmedWith = (password?: string): ExecWithResult => ({
  executeWithResult: vi.fn(<T,>(_a: string | string[], cb: (pw?: string) => Promise<T>) => cb(password)) as unknown as ExecWithResult['executeWithResult'],
});
const cancelled = () => ({
  executeWithResult: vi.fn(async () => { throw { error: 'REAUTH_CANCELLED' }; }),
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); });

describe('withStageAction', () => {
  it.each([
    ['WASH_IN', 'STAGE_WASH_IN'], ['WASH_OUT', 'STAGE_WASH_OUT'], ['DRY_IN', 'STAGE_DRY_IN'],
    ['DRY_OUT', 'STAGE_DRY_OUT'], ['STORAGE_IN', 'STAGE_STORAGE_IN'], ['STORAGE_OUT', 'STAGE_STORAGE_OUT'],
  ])('appends the %s station row', (state, row) => {
    expect(withStageAction(['ADVANCE_FILTER_STAGE'], state)).toEqual(['ADVANCE_FILTER_STAGE', row]);
  });

  it('returns the base list unchanged (same contents) for a non-station / missing target', () => {
    for (const t of ['IN_USE', '', null, undefined]) {
      expect(withStageAction(['ADVANCE_FILTER_STAGE'], t)).toEqual(['ADVANCE_FILTER_STAGE']);
    }
  });

  it('does not mutate the base array', () => {
    const base = ['A'];
    withStageAction(base, 'WASH_IN');
    expect(base).toEqual(['A']);
  });
});

describe('batchTargetState', () => {
  it('prefers the first item\'s advancePayload.targetState, then payload.targetState', () => {
    expect(batchTargetState([{ advancePayload: { targetState: 'DRY_IN' }, payload: { targetState: 'WASH_IN' } }])).toBe('DRY_IN');
    expect(batchTargetState([{ payload: { targetState: 'WASH_OUT' } }, { payload: { targetState: 'X' } }])).toBe('WASH_OUT');
  });
  it('is undefined for an empty batch or an item with no target', () => {
    expect(batchTargetState([])).toBeUndefined();
    expect(batchTargetState([{}])).toBeUndefined();
  });
});

describe('preauthorize', () => {
  it('returns undefined and verifies nothing when no action is gated', async () => {
    const m = mockApi([]);
    const reauth = confirmedWith(undefined);
    await expect(preauthorize(reauth, ['A', 'B'])).resolves.toBeUndefined();
    expect(reauth.executeWithResult).toHaveBeenCalledWith(['A', 'B'], expect.any(Function));
    expect(m.requests).toHaveLength(0);
  });

  it('verifies the password once against /api/auth/verify and returns it', async () => {
    const m = mockApi([{ method: 'POST', path: '/api/auth/verify', body: (req: MockRequest) => ({ ok: req.json.password === 'pw' }) }]);
    await expect(preauthorize(confirmedWith('pw'), 'START_CLEANING_CYCLE')).resolves.toBe('pw');
    expect(m.calls('POST', '/api/auth/verify').map((r) => r.json)).toEqual([{ password: 'pw' }]);
  });

  it.each([
    ['a 401', { status: 401, body: { error: 'UNAUTHORIZED', message: 'Bad password' } }, 'Bad password'],
    ['INVALID_CREDENTIALS', { status: 400, body: { error: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } }, 'Invalid credentials'],
    ['INVALID_PASSWORD', { status: 400, body: { error: 'INVALID_PASSWORD' } }, 'INVALID_PASSWORD'],
  ])('normalises %s from verify into REAUTH_FAILED (keeps the dialog open)', async (_l, route, message) => {
    // The 401 path of api-client also redirects; keep jsdom on a stub location.
    vi.stubGlobal('location', { pathname: '/filter-operations', href: '/filter-operations', search: '' });
    mockApi([{ method: 'POST', path: '/api/auth/verify', ...route }]);
    await expect(preauthorize(confirmedWith('bad'), 'X')).rejects.toEqual({ error: 'REAUTH_FAILED', message });
  });

  it('the 401 path still reads the error code from the wrapped Error (INVALID_CREDENTIALS) not just the status', async () => {
    vi.stubGlobal('location', { pathname: '/x', href: '/x', search: '' });
    mockApi([{ method: 'POST', path: '/api/auth/verify', status: 401, body: {} }]);
    await expect(preauthorize(confirmedWith('bad'), 'X')).rejects.toEqual({ error: 'REAUTH_FAILED', message: 'Invalid credentials' });
  });

  it('a wrong password on verify (401 INVALID_PASSWORD) is refused in the dialog WITHOUT ending the session', async () => {
    // The server answers a mistyped password with 401 INVALID_PASSWORD; that must
    // not reach api-client's "session expired" branch (clear token + /login).
    const loc = { pathname: '/filter-operations', href: '/filter-operations', search: '' };
    vi.stubGlobal('location', loc);
    sessionStorage.setItem('access_token', 'live-session');
    localStorage.setItem('digilog_cached_user', '{"id":"u1"}');
    mockApi([{ method: 'POST', path: '/api/auth/verify', status: 401, body: { error: 'INVALID_PASSWORD', message: 'Password is incorrect' } }]);
    await expect(preauthorize(confirmedWith('typo'), 'X')).rejects.toEqual({ error: 'REAUTH_FAILED', message: 'Password is incorrect' });
    expect(sessionStorage.getItem('access_token')).toBe('live-session');
    expect(localStorage.getItem('digilog_cached_user')).toBe('{"id":"u1"}');
    expect(loc.href).toBe('/filter-operations');
    localStorage.clear();
  });

  it('rethrows any other verify failure untouched (e.g. account locked, server down)', async () => {
    mockApi([{ method: 'POST', path: '/api/auth/verify', status: 423, body: { error: 'ACCOUNT_LOCKED', message: 'Locked' } }]);
    await expect(preauthorize(confirmedWith('pw'), 'X')).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED', status: 423, message: 'Locked' });
  });
});

describe('signOnce', () => {
  it('wraps a verified password as { ok: true, password }', async () => {
    mockApi([{ method: 'POST', path: '/api/auth/verify', body: {} }]);
    await expect(signOnce(confirmedWith('pw'), 'X')).resolves.toEqual({ ok: true, password: 'pw' });
  });

  it('turns a dismissed dialog into { ok: false } instead of throwing', async () => {
    await expect(signOnce(cancelled(), 'X')).resolves.toEqual({ ok: false });
  });

  it('rethrows non-cancel errors', async () => {
    const reauth = { executeWithResult: vi.fn(async () => { throw new Error('boom'); }) };
    await expect(signOnce(reauth, 'X')).rejects.toThrow('boom');
  });
});
