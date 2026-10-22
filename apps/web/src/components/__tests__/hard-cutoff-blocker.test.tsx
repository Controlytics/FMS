/**
 * HardCutoffBlocker — the W4 read-only overlay. Real hard-cutoff +
 * server-contact modules; only fetch is stubbed (page harness).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { HardCutoffBlocker } from '../hard-cutoff-blocker';
import { setHardCutoffMs } from '@/lib/hard-cutoff';
import { markServerContactFromResponse } from '@/lib/server-contact';
import { expectAllControlsNamed } from './support/a11y';

const H = 3600_000;
const lastContactAgo = (ms: number) => { const t = Date.now() - ms; localStorage.setItem('digilog_last_server_contact', String(t)); return t; };
// Default datetime config (DD/MM/YYYY, 12-hour, Asia/Kolkata) — see `blockerApi`.
const fmt = (t: number) => {
  const d = new Date(t);
  return `${d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}`;
};

/**
 * mockApi whose /api/config/datetime/current request never settles. ANY server
 * response counts as contact and (correctly) dismisses the overlay, so a
 * config answer would end every locked-state test before it could look.
 */
function blockerApi(routes: Parameters<typeof mockApi>[0] = []) {
  const api = mockApi(routes);
  const answer = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes('/api/config/datetime/current') ? new Promise<Response>(() => {}) : answer(input, init)));
  return api;
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  setHardCutoffMs(24 * H);
  warn = vi.spyOn(console, 'warn');
  error = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('HardCutoffBlocker', () => {
  it('renders nothing while the server has been reached recently', () => {
    lastContactAgo(1 * H);
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing for a session that has never had contact yet', () => {
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('locks the UI after the window, naming the window and the last contact time', async () => {
    const t = lastContactAgo(30 * H);
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    const dlg = screen.getByRole('dialog', { name: 'Read-only Mode' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(dlg).toHaveTextContent('No server contact for over 24h');
    expect(dlg).toHaveTextContent('reach the server in over 24 hours');
    expect(dlg).toHaveTextContent(`Last successful server contact:${fmt(t)}`);
  });

  it('shows a sub-hour window with two decimals', () => {
    setHardCutoffMs(36_000); // 0.01 h
    lastContactAgo(60_000);
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    expect(screen.getByRole('dialog')).toHaveTextContent('No server contact for over 0.01h');
  });

  it('dismisses itself the moment contact resumes', () => {
    lastContactAgo(30 * H);
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => { markServerContactFromResponse({ status: 200 }); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('re-checks every 30 s, so it appears when contact ages out while idle', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    setHardCutoffMs(1 * H);
    lastContactAgo(1 * H - 10_000); // 10 s left
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    expect(screen.queryByRole('dialog')).toBeNull();
    lastContactAgo(1 * H + 5_000); // the clock moved on with no contact event
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(screen.getByRole('dialog', { name: 'Read-only Mode' })).toBeInTheDocument();
  });

  it('"Try to reconnect" probes /api/health and unlocks when the server answers', async () => {
    lastContactAgo(30 * H);
    const api = blockerApi([{ path: '/api/health', body: { status: 'ok' } }]);
    renderPage(<HardCutoffBlocker />, { api });
    const btn = screen.getByRole('button', { name: 'Try to reconnect' });
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Trying…' })).toBeDisabled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.calls('GET', '/api/health').length).toBe(2); // raw probe + apiClient GET (which marks contact)
  });

  it('stays locked when the server answers 5xx to the reconnect probe, and says so', async () => {
    lastContactAgo(30 * H);
    const api = blockerApi([{ path: '/api/health', status: 503, body: { error: 'DOWN', message: 'down' } }]);
    renderPage(<HardCutoffBlocker />, { api });
    fireEvent.click(screen.getByRole('button', { name: 'Try to reconnect' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try to reconnect' })).toBeEnabled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Still can't reach the server");
  });

  // D-L3: the case the overlay exists for — the server is unreachable, so the probe's
  // fetch REJECTS. It used to escape handleRetry as an unhandled promise rejection.
  it('reconnecting while the server is unreachable stays locked and says so (no unhandled rejection)', async () => {
    lastContactAgo(30 * H);
    const api = mockApi(); // renderPage needs an api object; every request below is answered by the stub
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/api/config/datetime/current') ? new Promise<Response>(() => {}) : Promise.reject(new TypeError('Failed to fetch'))));
    renderPage(<HardCutoffBlocker />, { api });
    fireEvent.click(screen.getByRole('button', { name: 'Try to reconnect' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try to reconnect' })).toBeEnabled());
    expect(screen.getByRole('dialog', { name: 'Read-only Mode' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("Still can't reach the server");
  });

  it('a new attempt clears the previous "still can\'t reach" message while it runs', async () => {
    lastContactAgo(30 * H);
    const api = mockApi();
    let reject!: (e: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) =>
      String(input).includes('/api/config/datetime/current') ? new Promise<Response>(() => {}) : new Promise<Response>((_r, j) => { reject = j; })));
    renderPage(<HardCutoffBlocker />, { api });
    fireEvent.click(screen.getByRole('button', { name: 'Try to reconnect' }));
    act(() => reject(new TypeError('Failed to fetch')));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Try to reconnect' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { reject(new TypeError('Failed to fetch')); });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('every control in the locked overlay has an accessible name', () => {
    lastContactAgo(30 * H);
    renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    expectAllControlsNamed(document.body);
  });

  it('stops listening on unmount', () => {
    lastContactAgo(30 * H);
    const { unmount } = renderPage(<HardCutoffBlocker />, { api: blockerApi() });
    unmount();
    expect(() => markServerContactFromResponse({ status: 200 })).not.toThrow();
  });
});
