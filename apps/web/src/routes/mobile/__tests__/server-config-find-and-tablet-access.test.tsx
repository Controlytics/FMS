/**
 * Two small tablet modules, by behaviour:
 *
 *  - server-config.tsx "Find server" (2026-10-10) and the connect edge cases
 *    server-config.test.tsx does not reach. `findServer` is mocked at its module
 *    boundary — the real one drives the native ServerScanPlugin.
 *  - use-tablet-access.ts as a HOOK (tablet-rules.test.ts covers its pure
 *    rules): the live answer is cached per user in IndexedDB (real offline-store
 *    on the in-memory IDB), read back offline, and never applied to another user.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, renderHook, act, render as rtlRender } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi } from '@/test-utils/page-harness';
import { useMobileLifecycle, allowConsoleError, seedCache, cachedValue, flush } from './support/mobile-kit';

const findServer = vi.hoisted(() => vi.fn());
vi.mock('@/lib/server-discovery', async (orig) => ({ ...(await orig() as any), findServer }));

import ServerConfigPage from '../server-config';
import { useTabletAccess, tabletAccessCacheKey } from '../use-tablet-access';

useMobileLifecycle();

describe('server config — Find server (tablet app only)', () => {
  const native = () => vi.stubGlobal('Capacitor', { isNativePlatform: () => true });

  it('fills the address the scan found; Connect still has to be pressed', async () => {
    native();
    findServer.mockResolvedValueOnce({ found: 'https://192.168.1.77:3000' });
    render();
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//), { target: { value: ' https://10.0.0.5:3000 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find server' }));
    await waitFor(() => expect(screen.getByPlaceholderText(/https:\/\//)).toHaveValue('https://192.168.1.77:3000'));
    expect(findServer).toHaveBeenCalledWith({ manual: true, base: 'https://10.0.0.5:3000' });
    expect(localStorage.getItem('digilog.serverUrl')).toBeNull();
    expect(screen.getByRole('button', { name: 'Find server' })).toBeEnabled();
  });

  it.each([
    ['nothing-open', /No FMS server answered on this network/],
    ['no-match', /not the FMS server this tablet was using/],
    ['ambiguous', /More than one FMS server answered/],
    ['no-address', /^Type the address shown on the FMS server PC\.$/],
    ['not-native', /only works in the tablet app/],
    [undefined, /No FMS server answered on this network/],
  ])('explains why nothing was found (%s)', async (reason, text) => {
    native();
    findServer.mockResolvedValueOnce({ found: null, reason });
    render();
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find server' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(findServer).toHaveBeenCalledWith({ manual: true, base: undefined });
  });

  it('a scan that throws says so; the button reads "Searching…" while it runs', async () => {
    native();
    let fail!: (e: Error) => void;
    findServer.mockReturnValueOnce(new Promise((_, rej) => { fail = rej; }));
    render();
    fireEvent.click(screen.getByRole('button', { name: 'Find server' }));
    expect(await screen.findByRole('button', { name: 'Searching the network...' })).toBeDisabled();
    fail(new Error('plugin missing'));
    expect(await screen.findByText('Search failed: plugin missing')).toBeInTheDocument();
  });

  // 2026-10-31: one trusted FMS server answered with a NEW identity (certificate
  // renewed under another issuer). Offered, never adopted: "Use this server"
  // only fills the box; Connect still re-checks it and saves.
  it('a server with a new identity is offered: "Use this server" fills the box, saves nothing', async () => {
    native();
    findServer.mockResolvedValueOnce({ found: null, reason: 'identity-changed', candidate: 'https://192.168.1.80:3000' });
    render();
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//), { target: { value: 'https://192.168.1.58:3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find server' }));
    expect(await screen.findByText(/its security certificate is not the one this tablet knew/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use this server: https://192.168.1.80:3000' }));
    expect(screen.getByPlaceholderText(/https:\/\//)).toHaveValue('https://192.168.1.80:3000');
    expect(screen.queryByRole('button', { name: /Use this server/ })).toBeNull();
    expect(screen.queryByText(/its security certificate is not the one/)).toBeNull();
    expect(localStorage.getItem('digilog.serverUrl')).toBeNull();
  });

  it('Connect refuses a non-2xx health reply and saves nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    render();
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//), { target: { value: 'https://192.168.1.9:3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText(/Couldn't reach the server at https:\/\/192\.168\.1\.9:3000/)).toBeInTheDocument();
    expect(localStorage.getItem('digilog.serverUrl')).toBeNull();
  });

  it('an older server with no JSON body still connects (the server id is optional)', async () => {
    allowConsoleError(/Not implemented: navigation/); // jsdom: window.location.href = '/m/login'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('no body'); } }));
    render();
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//), { target: { value: 'https://192.168.1.9:3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(localStorage.getItem('digilog.serverUrl')).toBe('https://192.168.1.9:3000'));
    expect(localStorage.getItem('digilog.serverId')).toBeNull();
  });

  function render() {
    return rtlRender(<ServerConfigPage />);
  }
});

describe('useTabletAccess (hook)', () => {
  function wrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>;
  }
  const signedIn = () => sessionStorage.setItem('access_token', 't');

  it('online: uses the live list and remembers it for THIS user', async () => {
    signedIn();
    const api = mockApi([{ path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['login', 'my_tasks'], role: 'OPERATOR' } }]);
    const { result } = renderHook(() => useTabletAccess({ id: 'u1' }, true), { wrapper });
    await waitFor(() => expect(result.current.tabletConfigured).toBe(true));
    expect(result.current.allowedFeatures).toEqual(['login', 'my_tasks']);
    expect(result.current.hasFeature('my_tasks')).toBe(true);
    expect(result.current.hasFeature('rfid_assign')).toBe(false);
    expect(result.current.fromOfflineCache).toBe(false);
    await waitFor(() => expect(cachedValue(tabletAccessCacheKey('u1'))).toEqual({ configured: true, allowed: ['login', 'my_tasks'], role: 'OPERATOR' }));
    expect(api.calls('GET', '/api/config/tablet-access/my-features')).toHaveLength(1);
  });

  it('offline: applies the list this user last read online, and says it came from the cache', async () => {
    signedIn();
    await seedCache({ [tabletAccessCacheKey('u1')]: { configured: true, allowed: ['login'] } });
    const api = mockApi([]);
    const { result } = renderHook(() => useTabletAccess({ id: 'u1' }, false), { wrapper });
    await waitFor(() => expect(result.current.fromOfflineCache).toBe(true));
    expect(result.current.hasFeature('my_tasks')).toBe(false); // NOT fail-open
    expect(result.current.hasFeature('login')).toBe(true);
    expect(api.requests).toHaveLength(0); // offline: no fetch
  });

  it("another user's cached list is never applied", async () => {
    signedIn();
    await seedCache({ [tabletAccessCacheKey('u2')]: { configured: true, allowed: [] } });
    mockApi([]);
    const { result } = renderHook(() => useTabletAccess({ id: 'u1' }, false), { wrapper });
    await flush(60);
    expect(result.current.tabletAccess).toBeUndefined();
    expect(result.current.hasFeature('anything')).toBe(true); // no list → unchanged behaviour
    expect(result.current.fromOfflineCache).toBe(false);
  });

  it('switching user drops the previous user\'s cached list', async () => {
    signedIn();
    await seedCache({ [tabletAccessCacheKey('u1')]: { configured: true, allowed: ['login'] } });
    mockApi([]);
    const { result, rerender } = renderHook(({ id }) => useTabletAccess({ id }, false), { wrapper, initialProps: { id: 'u1' } });
    await waitFor(() => expect(result.current.allowedFeatures).toEqual(['login']));
    rerender({ id: 'u3' });
    expect(result.current.tabletAccess).toBeUndefined();
    await flush(60);
    expect(result.current.tabletAccess).toBeUndefined();
  });

  it('no user: nothing is fetched or read', async () => {
    const api = mockApi([]);
    const { result } = renderHook(() => useTabletAccess(null, true), { wrapper });
    await flush(30);
    expect(api.requests).toHaveLength(0);
    expect(result.current.tabletAccess).toBeUndefined();
  });

  it('an unreadable IndexedDB leaves behaviour unchanged (no crash, nothing applied)', async () => {
    signedIn();
    vi.stubGlobal('indexedDB', undefined);
    mockApi([]);
    const { result } = renderHook(() => useTabletAccess({ id: 'u1' }, false), { wrapper });
    await flush(30);
    expect(result.current.tabletAccess).toBeUndefined();
  });

  it('a live answer that cannot be cached still applies', async () => {
    signedIn();
    vi.stubGlobal('indexedDB', undefined);
    mockApi([{ path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['login'] } }]);
    const { result } = renderHook(() => useTabletAccess({ id: 'u1' }, true), { wrapper });
    await waitFor(() => expect(result.current.allowedFeatures).toEqual(['login']));
    await flush(30);
  });

  it('unmounting before the cached read resolves does not set state', async () => {
    signedIn();
    await seedCache({ [tabletAccessCacheKey('u1')]: { configured: true, allowed: ['login'] } });
    mockApi([]);
    const { unmount } = renderHook(() => useTabletAccess({ id: 'u1' }, false), { wrapper });
    unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // the console guard fails the test on a set-state-after-unmount warning
  });
});
