import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { Routes, Route } from 'react-router-dom';
import { brandingRoute, holdRequests, LocationProbe, findDialog } from './support';
import { LoginPage } from '../login';

/**
 * Sign-in screen. Real useAuth().login -> apiClient -> fetch (stubbed), real
 * react-hook-form + zod (loginSchema). The probe shows where the page navigated.
 */

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

const ME = { id: 'u1', username: 'jdoe01', fullName: 'Jane Doe', role: 'OPERATOR', status: 'ENABLED', permissions: [], forcePasswordChange: false, isTemporaryPassword: false, lastLogin: null };

// LoginPage is mounted on /login only, as in main.tsx, so navigating away
// unmounts it; the probe shows where it went.
function page(routes: Parameters<typeof mockApi>[0] = [], user?: Record<string, unknown>) {
  const api = mockApi([...commonConfigRoutes(), brandingRoute(), ...routes]);
  renderPage(
    <><Routes><Route path="/login" element={<LoginPage />} /><Route path="*" element={null} /></Routes><LocationProbe /></>,
    { route: '/login', api, ...(user ? { user: user as { role: string } } : {}) },
  );
  return api;
}

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

describe('Login — form', () => {
  it('renders the labelled sign-in form with its links; an empty submit shows both schema messages and sends nothing', async () => {
    const api = page();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('link', { name: 'Guest filter cleaning request' })).toHaveAttribute('href', '/guest-request');
    expect(screen.getByRole('link', { name: 'Contact admin' })).toHaveAttribute('href', '/contact-admin');

    submit();
    expect(await screen.findByText('User ID is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/auth/login')).toHaveLength(0);
  });

  it('Show / Hide reveals and re-masks the password', async () => {
    page();
    const pw = await screen.findByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(pw).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(pw).toHaveAttribute('type', 'password');
  });
});

describe('Login — success paths', () => {
  it('signs in, mints the offline-replay grant with the same password, and lands on the dashboard', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', body: { success: true, token: 'tok-1', user: { ...ME } } },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'grant-1', expiresAt: '2026-10-22T00:00:00.000Z' } },
      { path: '/api/auth/me', body: ME },
    ]);
    fill('jdoe01', 'Secret@123');
    submit();

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(api.calls('POST', '/api/auth/login')[0].json).toEqual({ username: 'jdoe01', password: 'Secret@123' });
    expect(api.calls('POST', '/api/auth/offline-grant')[0].json).toEqual({ _currentPassword: 'Secret@123' });
    expect(sessionStorage.getItem('access_token')).toBe('tok-1');
    expect(sessionStorage.getItem('offline_replay_token')).toBe('grant-1');
    // authenticated -> the page renders <Navigate>, not the form
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull());
    expect(api.unmatched).toEqual([]);
  });

  it('a forced password change skips the offline grant and goes to /change-password', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', body: { success: true, token: 'tok-2', user: { ...ME, forcePasswordChange: true } } },
      { path: '/api/auth/me', body: { ...ME, forcePasswordChange: true } },
    ]);
    // /me answers after the navigation commits, as a real round trip does. The
    // mock otherwise resolves within microtasks, before React Router's
    // transition-wrapped navigate() commits, and the still-mounted login page
    // would redirect to "/" (test-timing artefact).
    const me = holdRequests(/\/api\/auth\/me/);
    fill('jdoe01', 'Temp@123');
    submit();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/change-password'));
    me.release();
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(0);
    expect(sessionStorage.getItem('access_token')).toBe('tok-2');
  });

  it('shows "Signing in…" and disables the button while the request is in flight', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', status: 401, body: { error: 'INVALID_PASSWORD', message: 'Invalid credentials' } },
    ]);
    const hold = holdRequests(/\/api\/auth\/login/);
    fill('jdoe01', 'x');
    submit();
    const busy = await screen.findByRole('button', { name: /Signing in/ });
    expect(busy).toBeDisabled();
    hold.release();
    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(api.calls('POST', '/api/auth/login')).toHaveLength(1);
  });

  it('an already-signed-in visitor is redirected to the dashboard without seeing the form', async () => {
    page([], ME);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });
});

describe('Login — refusals', () => {
  it('a wrong password shows the server message and stays on /login', async () => {
    page([{ method: 'POST', path: '/api/auth/login', status: 401, body: { error: 'INVALID_PASSWORD', message: 'Invalid credentials. 2 attempts remaining.', attemptsRemaining: 2 } }]);
    fill('jdoe01', 'bad');
    submit();
    expect(await screen.findByText('Invalid credentials. 2 attempts remaining.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });

  it('a locked account shows the lock message', async () => {
    page([{ method: 'POST', path: '/api/auth/login', status: 423, body: { error: 'ACCOUNT_LOCKED', message: 'Account is locked. Contact your administrator.' } }]);
    fill('jdoe01', 'bad');
    submit();
    expect(await screen.findByText('Account is locked. Contact your administrator.')).toBeInTheDocument();
  });

  it('a refusal with an empty message falls back to "Login failed"', async () => {
    page([{ method: 'POST', path: '/api/auth/login', status: 500, body: { error: 'X', message: '' } }]);
    fill('jdoe01', 'bad');
    submit();
    expect(await screen.findByText('Login failed')).toBeInTheDocument();
  });

  it('SESSION_CONFLICT without session details is just an error, not a dialog', async () => {
    page([{ method: 'POST', path: '/api/auth/login', status: 409, body: { error: 'SESSION_CONFLICT', message: 'Already signed in elsewhere' } }]);
    fill('jdoe01', 'pw');
    submit();
    expect(await screen.findByText('Already signed in elsewhere')).toBeInTheDocument();
    expect(screen.queryByText('Active Session Detected')).toBeNull();
  });
});

describe('Login — session conflicts', () => {
  const active = { loginTime: '2026-10-21T08:30:00.000Z', lastActiveAt: '2026-10-21T09:00:00.000Z' };

  it('same user elsewhere: shows the old session time, and Continue re-sends the login with force:true', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', times: 1, status: 409, body: { error: 'SESSION_CONFLICT', message: 'Active session', activeSession: active } },
      { method: 'POST', path: '/api/auth/login', body: { success: true, token: 'tok-3', user: { ...ME } } },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'g', expiresAt: '2026-10-22T00:00:00.000Z' } },
      { path: '/api/auth/me', body: ME },
    ]);
    fill('jdoe01', 'Secret@123');
    submit();
    const dlg = await findDialog('Active Session Detected');
    expect(within(dlg).getByText(/Your account is currently logged in from another location/)).toBeInTheDocument();
    // UTC config: 08:30 -> rendered in the configured format
    expect(within(dlg).getByText('Logged in:').parentElement).toHaveTextContent('21/10/2026 08:30');
    expect(within(dlg).queryByText('User:')).toBeNull();

    const hold = holdRequests(/\/api\/auth\/login/);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Continue & Logout Old Session' }));
    expect(await within(dlg).findByRole('button', { name: /Continuing/ })).toBeDisabled();
    expect(within(dlg).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    hold.release();

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    const logins = api.calls('POST', '/api/auth/login');
    expect(logins).toHaveLength(2);
    expect(logins[1].json).toEqual({ username: 'jdoe01', password: 'Secret@123', force: true });
  });

  it('different user on this system: names them, and Cancel closes without logging anyone out', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', status: 409, body: { error: 'DIFFERENT_USER_SESSION_CONFLICT', message: 'x', activeSession: { ...active, username: 'asha01', fullName: 'Asha Rao' } } },
    ]);
    fill('jdoe01', 'pw');
    submit();
    const dlg = await findDialog('Another User is Logged In');
    expect(within(dlg).getByText('User:').parentElement).toHaveTextContent('Asha Rao (asha01)');
    expect(within(dlg).getByText(/logout the other user's session/)).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Continue & Logout asha01' })).toBeInTheDocument();

    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2 })).toBeNull());
    expect(api.calls('POST', '/api/auth/login')).toHaveLength(1);
    expect(screen.queryByText('x')).toBeNull();
  });

  it('different user with no full name on record is shown by user id twice; Escape cancels like the button', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', status: 409, body: { error: 'DIFFERENT_USER_SESSION_CONFLICT', message: 'x', activeSession: { ...active, username: 'asha01' } } },
    ]);
    fill('jdoe01', 'pw');
    submit();
    const dlg = await findDialog('Another User is Logged In');
    expect(within(dlg).getByText('User:').parentElement).toHaveTextContent('asha01 (asha01)');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2 })).toBeNull());
    expect(api.calls('POST', '/api/auth/login')).toHaveLength(1);
  });

  it('different user without a username: generic button label; a failed force login closes the dialog and shows the error', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', times: 1, status: 409, body: { error: 'DIFFERENT_USER_SESSION_CONFLICT', message: 'x', activeSession: { loginTime: active.loginTime } } },
      { method: 'POST', path: '/api/auth/login', status: 403, body: { error: 'TABLET_ACCESS_DENIED', message: 'Your role cannot sign in here' } },
    ]);
    fill('jdoe01', 'pw');
    submit();
    const dlg = await findDialog('Another User is Logged In');
    expect(within(dlg).queryByText('User:')).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Continue & Logout User' }));
    expect(await screen.findByText('Your role cannot sign in here')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2 })).toBeNull());
    expect(api.calls('POST', '/api/auth/login')[1].json.force).toBe(true);
  });

  it('a force login refused with an empty message falls back to "Login failed"', async () => {
    page([
      { method: 'POST', path: '/api/auth/login', times: 1, status: 409, body: { error: 'SESSION_CONFLICT', message: 'x', activeSession: active } },
      { method: 'POST', path: '/api/auth/login', status: 500, body: { error: 'Y', message: '' } },
    ]);
    fill('jdoe01', 'pw');
    submit();
    fireEvent.click(await screen.findByRole('button', { name: 'Continue & Logout Old Session' }));
    expect(await screen.findByText('Login failed')).toBeInTheDocument();
  });
});

describe('Login — another user signed in on this browser', () => {
  it('warns on mount when another tab holds a live session for someone else, and Close dismisses it', async () => {
    sessionStorage.setItem('digilog_tab_id', 'my-tab');
    localStorage.setItem('digilog_active_tab_id', 'other-tab');
    localStorage.setItem('digilog_tab_heartbeat', String(Date.now()));
    localStorage.setItem('digilog_active_user_id', JSON.stringify({ userId: 'u9', username: 'asha01' }));
    page();
    const dlg = await findDialog('Another User is Logged In');
    expect(within(dlg).getByText('asha01')).toBeInTheDocument();
    expect(within(dlg).getByText('Active in another tab/window')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2 })).toBeNull());
  });

  it('Escape also dismisses the warning', async () => {
    sessionStorage.setItem('digilog_tab_id', 'my-tab');
    localStorage.setItem('digilog_active_tab_id', 'other-tab');
    localStorage.setItem('digilog_tab_heartbeat', String(Date.now()));
    localStorage.setItem('digilog_active_user_id', JSON.stringify({ userId: 'u9', username: 'asha01' }));
    page();
    await findDialog('Another User is Logged In');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2 })).toBeNull());
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a stale heartbeat (dead tab) raises no warning', async () => {
    sessionStorage.setItem('digilog_tab_id', 'my-tab');
    localStorage.setItem('digilog_active_tab_id', 'other-tab');
    localStorage.setItem('digilog_tab_heartbeat', String(Date.now() - 60_000));
    localStorage.setItem('digilog_active_user_id', JSON.stringify({ userId: 'u9', username: 'asha01' }));
    page();
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });
});

describe('Login — accessibility + console', () => {
  it('every control has an accessible name and a normal sign-in logs nothing', async () => {
    const api = page([
      { method: 'POST', path: '/api/auth/login', body: (req: MockRequest) => ({ success: true, token: 't', user: { ...ME, username: req.json.username } }) },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'g', expiresAt: '2026-10-22T00:00:00.000Z' } },
      { path: '/api/auth/me', body: ME },
    ]);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    fill('jdoe01', 'Secret@123');
    submit();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
