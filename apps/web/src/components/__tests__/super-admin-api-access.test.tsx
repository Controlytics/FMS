/**
 * Super Admin API kill-switch UI (coverage campaign 2026-10-21): the
 * full-screen lockdown wall and the Settings card. Real useAuth +
 * useSuperAdminLock + SWR through the page harness; only global `fetch` is
 * stubbed. Every flip is a PUT /api/super-admin/api-lock signed with the
 * password (x-reauth-password header + _currentPassword body).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderPage, mockApi, type MockRequest } from '@/test-utils/page-harness';
import { SuperAdminLockdownScreen, SuperAdminApiAccessCard } from '../super-admin-api-access';
import { expectAllControlsNamed } from './support/a11y';

const SA = { role: 'SUPER_ADMIN', id: 'sa1', username: 'superadmin' };
const LOCK = '/api/super-admin/api-lock';

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

const pw = () => screen.getByPlaceholderText('Enter your password');

describe('SuperAdminLockdownScreen', () => {
  it('re-enables with the password: signed PUT, then the field clears', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: false } },
      { method: 'PUT', path: LOCK, body: (req: MockRequest) => ({ enabled: req.json.enabled }) },
    ]);
    renderPage(<SuperAdminLockdownScreen />, { api, user: SA });
    expect(screen.getByRole('heading', { name: 'Super Admin API Access Disabled' })).toBeInTheDocument();
    const enable = screen.getByRole('button', { name: 'Enable Super Admin APIs' });
    expect(enable).toBeDisabled();
    fireEvent.change(pw(), { target: { value: '   ' } });
    expect(enable).toBeDisabled(); // whitespace is not a password
    fireEvent.change(pw(), { target: { value: 'Admin@123' } });
    fireEvent.click(enable);
    expect(await screen.findByRole('button', { name: 'Enabling…' })).toBeDisabled();
    await waitFor(() => expect(pw()).toHaveValue(''));
    const put = api.calls('PUT', LOCK);
    expect(put).toHaveLength(1);
    expect(put[0].headers['x-reauth-password']).toBe('Admin@123');
    expect(put[0].json).toEqual({ enabled: true, _currentPassword: 'Admin@123' });
  });

  it('Enter submits; a wrong password shows the refusal and keeps what was typed', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: false } },
      { method: 'PUT', path: LOCK, status: 403, body: { error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' } },
    ]);
    renderPage(<SuperAdminLockdownScreen />, { api, user: SA });
    fireEvent.change(pw(), { target: { value: 'wrong' } });
    fireEvent.keyDown(pw(), { key: 'Enter' });
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(pw()).toHaveValue('wrong');
    expect(screen.getByRole('button', { name: 'Enable Super Admin APIs' })).toBeEnabled();
    // Other keys do nothing; Enter with an empty password does nothing either.
    fireEvent.keyDown(pw(), { key: 'a' });
    fireEvent.change(pw(), { target: { value: '' } });
    fireEvent.keyDown(pw(), { key: 'Enter' });
    expect(api.calls('PUT', LOCK)).toHaveLength(1);
  });

  // L1: api-client throws REAUTH bodies RAW (code on `.error`, no `.code`), so the
  // friendly messages keyed on `.code` never showed.
  it('L1: a REAUTH_REQUIRED refusal with no message reads "Password is required."', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: false } },
      { method: 'PUT', path: LOCK, status: 401, body: { error: 'REAUTH_REQUIRED' } },
    ]);
    renderPage(<SuperAdminLockdownScreen />, { api, user: SA });
    fireEvent.change(pw(), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Super Admin APIs' }));
    expect(await screen.findByText('Password is required.')).toBeInTheDocument();
  });

  it('L1: a REAUTH_FAILED refusal reads the friendly wrong-password text, whatever the server words', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: false } },
      { method: 'PUT', path: LOCK, status: 403, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } },
    ]);
    renderPage(<SuperAdminLockdownScreen />, { api, user: SA });
    fireEvent.change(pw(), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Super Admin APIs' }));
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
  });

  it('falls back to a generic message when the failure carries no code and no message', async () => {
    const api = mockApi([{ path: LOCK, body: { enabled: false } }]);
    renderPage(<SuperAdminLockdownScreen />, { api, user: SA });
    await waitFor(() => expect(api.calls('GET', LOCK)).toHaveLength(1));
    const harnessFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') throw {};
      return harnessFetch(input, init);
    }));
    fireEvent.change(pw(), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable Super Admin APIs' }));
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });

  it('Log out ends the session server-side and locally', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: false } },
      { method: 'POST', path: '/api/auth/logout', body: { ok: true } },
    ]);
    localStorage.setItem('digilog_cached_user', JSON.stringify(SA));
    renderPage(<SuperAdminLockdownScreen />, { api, user: SA });
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1));
    expect(api.calls('POST', '/api/auth/logout')[0].json).toEqual({ reason: 'manual' });
    await waitFor(() => expect(sessionStorage.getItem('access_token')).toBeNull());
    expect(localStorage.getItem('digilog_cached_user')).toBeNull();
  });

  it('A8: the password field is labelled, and every control has an accessible name', async () => {
    const api = mockApi([{ path: LOCK, body: { enabled: false } }]);
    const { container } = renderPage(<SuperAdminLockdownScreen />, { user: SA, api });
    expect(screen.getByLabelText('Password')).toBe(pw());
    expectAllControlsNamed(container);
    await waitFor(() => expect(api.calls('GET', LOCK)).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  });
});

describe('SuperAdminApiAccessCard', () => {
  async function settled(api: ReturnType<typeof mockApi>) {
    await waitFor(() => expect(api.calls('GET', LOCK)).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }

  it('renders nothing for anyone but SUPER_ADMIN and never asks for the switch state', async () => {
    const api = mockApi([]);
    const { container } = renderPage(<SuperAdminApiAccessCard />, { api, user: { role: 'ADMIN' } });
    await waitFor(() => expect(api.calls('GET', '/api/auth/me')).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(container).toBeEmptyDOMElement();
    expect(api.calls('GET', LOCK)).toHaveLength(0);
  });

  it('shows the live state, warns before disabling, and flips OFF with a signed PUT', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: true } },
      { method: 'PUT', path: LOCK, body: (req: MockRequest) => ({ enabled: req.json.enabled }) },
    ]);
    localStorage.setItem('digilog_cached_user', JSON.stringify(SA)); // SA known on first paint
    renderPage(<SuperAdminApiAccessCard />, { api, user: SA });
    expect(screen.getByText('…')).toBeInTheDocument(); // loading
    await settled(api);
    expect(screen.getByText('ENABLED')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(screen.getByText(/You are about to/)).toHaveTextContent('disable Super Admin API access');
    const submit = screen.getAllByRole('button', { name: 'Disable' }).at(-1)!;
    expect(submit).toBeDisabled();
    fireEvent.change(pw(), { target: { value: 'Admin@123' } });
    fireEvent.keyDown(pw(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByText('DISABLED')).toBeInTheDocument());
    // The optimistic SWR update renders DISABLED one commit before the dialog's
    // own close (setConfirming after `await setEnabled`): on a busy CPU React
    // yields between the two, so wait for the close rather than assert it at once.
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('PUT', LOCK)[0].json).toEqual({ enabled: false, _currentPassword: 'Admin@123' });
    // The optimistic update means no extra GET was needed.
    expect(api.calls('GET', LOCK)).toHaveLength(1);
  });

  it('flipping ON needs no warning; an error is shown and the dialog stays; Cancel resets it', async () => {
    const api = mockApi([
      { path: LOCK, body: { enabled: false } },
      { method: 'PUT', path: LOCK, status: 403, body: { error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' } },
    ]);
    renderPage(<SuperAdminApiAccessCard />, { api, user: SA });
    await settled(api);
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(screen.queryByText(/You are about to/)).toBeNull();
    fireEvent.change(pw(), { target: { value: 'nope' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable' }).at(-1)!);
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
    expect(screen.queryByText('Incorrect password. Please try again.')).toBeNull();
    // Re-opening starts clean.
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(pw()).toHaveValue('');
  });

  it('shows "Saving…" while the flip is in flight and ignores a second submit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const putFetch = vi.fn();
    const api = mockApi([{ path: LOCK, body: { enabled: true } }]);
    renderPage(<SuperAdminApiAccessCard />, { api, user: SA });
    await settled(api);
    // Hold the PUT open: wrap the harness fetch.
    const harnessFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') { putFetch(); await gate; return new Response(JSON.stringify({ enabled: false }), { status: 200 }); }
      return harnessFetch(input, init);
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    fireEvent.change(pw(), { target: { value: 'pw' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable' }).at(-1)!);
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.keyDown(pw(), { key: 'Enter' }); // busy → ignored
    expect(putFetch).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.getByText('DISABLED')).toBeInTheDocument();
  });
  it('A8: the confirm-password field is labelled, and every control has an accessible name', async () => {
    const api = mockApi([{ path: LOCK, body: { enabled: true } }]);
    const { container } = renderPage(<SuperAdminApiAccessCard />, { api, user: SA });
    await settled(api);
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(screen.getByLabelText('Confirm with your password')).toBe(pw());
    expectAllControlsNamed(container);
  });
});
