/**
 * useSuperAdminLock — the Super Admin API kill-switch, through the real
 * SWR -> apiClient -> fetch path (only fetch stubbed).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest } from '@/test-utils/page-harness';
import { useSuperAdminLock } from '../use-super-admin-lock';

let latest: ReturnType<typeof useSuperAdminLock>;
function Probe() {
  const lock = useSuperAdminLock();
  latest = lock;
  return <p data-testid="state">{`sa:${lock.isSuperAdmin} enabled:${lock.enabled}`}</p>;
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('useSuperAdminLock', () => {
  it('does not ask the server for non-SUPER_ADMIN users and reports enabled', async () => {
    const api = mockApi();
    renderPage(<Probe />, { user: { role: 'ADMIN' }, api });
    await waitFor(() => expect(api.calls('GET', '/api/auth/me')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('sa:false enabled:true'));
    expect(api.calls('GET', '/api/super-admin/api-lock')).toHaveLength(0);
  });

  it('reads the switch for a SUPER_ADMIN', async () => {
    const api = mockApi([{ path: '/api/super-admin/api-lock', body: { enabled: false } }]);
    renderPage(<Probe />, { user: { role: 'SUPER_ADMIN' }, api });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('sa:true enabled:false'));
  });

  it('defaults to enabled while the request is in flight (never flashes the lockdown)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = mockApi();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/super-admin/api-lock')) await gate;
      return (realFetch as typeof fetch)(input, init);
    }));
    api.add({ path: '/api/super-admin/api-lock', body: { enabled: false } });
    renderPage(<Probe />, { user: { role: 'SUPER_ADMIN' }, api });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('sa:true enabled:true'));
    release();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('enabled:false'));
  });

  it('setEnabled PUTs with the re-auth password and updates the cached value', async () => {
    const api = mockApi([
      { path: '/api/super-admin/api-lock', body: { enabled: true } },
      { method: 'PUT', path: '/api/super-admin/api-lock', body: (req: MockRequest) => ({ enabled: req.json.enabled }) },
    ]);
    renderPage(<Probe />, { user: { role: 'SUPER_ADMIN' }, api });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('enabled:true'));

    let out: boolean | undefined;
    await act(async () => { out = await latest.setEnabled(false, 'Pw#1'); });
    expect(out).toBe(false);
    const put = api.calls('PUT', '/api/super-admin/api-lock')[0];
    expect(put.json).toEqual({ enabled: false, _currentPassword: 'Pw#1' });
    expect(put.headers['x-reauth-password']).toBe('Pw#1');
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('enabled:false'));
  });

  it('setEnabled surfaces a re-auth failure to the caller', async () => {
    const api = mockApi([
      { path: '/api/super-admin/api-lock', body: { enabled: true } },
      { method: 'PUT', path: '/api/super-admin/api-lock', status: 401, body: { error: 'REAUTH_FAILED', message: 'Wrong password' } },
    ]);
    renderPage(<Probe />, { user: { role: 'SUPER_ADMIN' }, api });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('enabled:true'));
    let caught: any;
    await act(async () => { await latest.setEnabled(false, 'bad').catch((e) => { caught = e; }); });
    expect(caught.error).toBe('REAUTH_FAILED');
    expect(screen.getByTestId('state')).toHaveTextContent('enabled:true');
  });
});
