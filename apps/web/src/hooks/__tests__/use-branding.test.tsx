/**
 * useBranding — server branding merged over defaults, cached per device for
 * offline / pre-server-address use, and the colour theme applied to :root.
 * Only global `fetch` is stubbed (useBranding uses its own raw-fetch fetcher).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { useBranding, defaultBranding } from '../use-branding';
import { getThemeById, applyTheme } from '@/lib/themes';

function Probe() {
  const { branding, isLoading } = useBranding();
  return (
    <div>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="branding">{JSON.stringify(branding)}</p>
    </div>
  );
}
/** Render with `fetch` rejecting like a disconnected tablet (stub AFTER mockApi, which also stubs fetch). */
function renderOffline() {
  const api = mockApi();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  return renderPage(<Probe />, { api });
}
const shown = () => JSON.parse(screen.getByTestId('branding').textContent!);
const themeVar = () => document.documentElement.style.getPropertyValue('--theme-primary');

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  document.documentElement.removeAttribute('style');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('useBranding', () => {
  it('merges the server branding over the defaults, caches it, and applies its theme', async () => {
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'Cleanroom FMS', companyName: 'Acme Pharma', colorTheme: 'emerald' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(shown().appName).toBe('Cleanroom FMS'));
    expect(shown()).toMatchObject({ companyName: 'Acme Pharma', logoUrl: '/logo.jpg', browserTitle: defaultBranding.browserTitle });
    expect(JSON.parse(localStorage.getItem('digilog.branding')!)).toEqual({ appName: 'Cleanroom FMS', companyName: 'Acme Pharma', colorTheme: 'emerald' });
    await waitFor(() => expect(themeVar()).toBe(getThemeById('emerald').colors.primary));
    expect(api.calls('GET', '/api/config/branding')[0].headers.authorization).toBeUndefined(); // public endpoint
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('an empty logoUrl from the database falls back to the bundled logo', async () => {
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'X', logoUrl: '' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(shown().appName).toBe('X'));
    expect(shown().logoUrl).toBe('/logo.jpg');
  });

  it('goes to the configured server (APK): the request uses the stored Server Address', async () => {
    localStorage.setItem('digilog.serverUrl', 'https://192.168.1.53:3000');
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'Remote' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(shown().appName).toBe('Remote'));
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toBe('https://192.168.1.53:3000/api/config/branding');
  });

  it('offline (fetch throws): shows the last cached branding instead of the defaults', async () => {
    localStorage.setItem('digilog.branding', JSON.stringify({ appName: 'Cached Site', colorTheme: 'ruby', logoUrl: '' }));
    renderOffline();
    expect(shown().appName).toBe('Cached Site');
    expect(shown().logoUrl).toBe('/logo.jpg');
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(shown().appName).toBe('Cached Site');
    expect(themeVar()).toBe(getThemeById('ruby').colors.primary);
    expect(error).not.toHaveBeenCalled(); // a network failure is not a "Load Error"
  });

  it('offline with no cache: the built-in defaults and the Ocean theme', async () => {
    renderOffline();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(shown()).toEqual(defaultBranding);
    expect(themeVar()).toBe(getThemeById('ocean').colors.primary);
  });

  it('a corrupt cache is ignored', async () => {
    localStorage.setItem('digilog.branding', '{oops');
    renderOffline();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(shown()).toEqual(defaultBranding);
  });

  it('an HTTP error from the server is an error, and the cache is not overwritten', async () => {
    localStorage.setItem('digilog.branding', JSON.stringify({ appName: 'Cached Site' }));
    const api = mockApi([{ path: '/api/config/branding', status: 500, body: { error: 'INTERNAL' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(shown().appName).toBe('Cached Site');
    expect(JSON.parse(localStorage.getItem('digilog.branding')!)).toEqual({ appName: 'Cached Site' });
    expect(error).toHaveBeenCalledWith('[SWR Error]', 'HTTP 500');
  });

  it('an empty object from the server is not cached and does not replace the cache', async () => {
    localStorage.setItem('digilog.branding', JSON.stringify({ appName: 'Cached Site' }));
    const api = mockApi([{ path: '/api/config/branding', body: {} }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(api.calls('GET', '/api/config/branding')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(shown().appName).toBe('Cached Site');
    expect(JSON.parse(localStorage.getItem('digilog.branding')!)).toEqual({ appName: 'Cached Site' });
  });

  it('still shows the server branding when the device cache cannot be written', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'No Space' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(shown().appName).toBe('No Space'));
  });

  it('a blank theme id falls back to the default theme', async () => {
    applyTheme(getThemeById('coral').colors);
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'B', colorTheme: '' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(shown().appName).toBe('B'));
    await waitFor(() => expect(themeVar()).toBe(getThemeById('ocean').colors.primary));
  });

  it('an unknown theme id falls back to the default theme', async () => {
    const api = mockApi([{ path: '/api/config/branding', body: { appName: 'T', colorTheme: 'neon' } }]);
    renderPage(<Probe />, { api });
    await waitFor(() => expect(shown().appName).toBe('T'));
    expect(themeVar()).toBe(getThemeById('ocean').colors.primary);
  });
});
