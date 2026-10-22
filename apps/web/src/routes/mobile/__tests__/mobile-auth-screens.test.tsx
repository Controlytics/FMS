/**
 * Tablet signed-out screens — /m/login and /m/forgot-password, driven through
 * the REAL apiClient (the page harness stubs only `fetch`). Complements
 * mobile-login-session-conflict.test.tsx (which mocks apiClient) by covering
 * the paths a real server answer takes: the allowlist check after login, the
 * offline-replay grant, lockout, expiry, attempts remaining, the
 * different-user conflict and a refused force login.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest, type MockRoute } from '@/test-utils/page-harness';
import { MobileLoginPage } from '../mobile-login';
import { MobileForgotPasswordPage } from '../mobile-forgot-password';
import { useMobileLifecycle, mobileRoutes, LocationProbe, currentPath, allowConsoleError, flush } from './support/mobile-kit';

useMobileLifecycle();

const LOGIN_OK = { token: 'tok-1', user: { id: 'u1', username: 'op1', forcePasswordChange: false } };

function renderLogin(routes: MockRoute[]) {
  const api = mockApi([...routes, ...mobileRoutes()]);
  renderPage(<><MobileLoginPage /><LocationProbe /></>, { route: '/m/login', api });
  return api;
}
function fill(user = '  op1 ', pass = 'Secret@123') {
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: user } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: pass } });
}
const signIn = () => fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

describe('tablet login — success paths', () => {
  it('signs in, checks the tablet allowlist with the NEW token, mints the offline grant and lands on /m', async () => {
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', body: LOGIN_OK },
      { path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['login', 'my_tasks'] } },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'grant-1', expiresAt: '2026-10-22T00:00:00Z' } },
    ]);
    sessionStorage.setItem('offline_grant_failed', '1');
    fill();
    signIn();
    await waitFor(() => expect(currentPath()).toBe('/m'));
    expect(api.calls('POST', '/api/auth/login')[0].json).toEqual({ username: 'op1', password: 'Secret@123', client: 'tablet' });
    const access = api.calls('GET', '/api/config/tablet-access/my-features');
    expect(access.at(-1)!.headers.authorization).toBe('Bearer tok-1');
    expect(api.calls('POST', '/api/auth/offline-grant')[0].json).toEqual({ _currentPassword: 'Secret@123' });
    expect(sessionStorage.getItem('access_token')).toBe('tok-1');
    expect(sessionStorage.getItem('offline_replay_token')).toBe('grant-1');
    expect(localStorage.getItem('offline_replay_token_backup')).toBe('grant-1');
    expect(localStorage.getItem('offline_replay_expires_backup')).toBe('2026-10-22T00:00:00Z');
    expect(sessionStorage.getItem('offline_grant_failed')).toBeNull();
  });

  it('a role the admin never configured is allowed (backwards compatible)', async () => {
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', body: LOGIN_OK },
      { path: '/api/config/tablet-access/my-features', body: { configured: false, allowed: [] } },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'g', expiresAt: 'x' } },
    ]);
    fill();
    signIn();
    await waitFor(() => expect(currentPath()).toBe('/m'));
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(0);
  });

  it('a forced password change skips the grant and goes to /change-password with the /m return hint', async () => {
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', body: { token: 'tok-2', user: { forcePasswordChange: true } } },
      { path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['login'] } },
    ]);
    fill();
    signIn();
    await waitFor(() => expect(currentPath()).toBe('/change-password'));
    expect(sessionStorage.getItem('post_change_password_redirect')).toBe('/m');
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(0);
  });

  it('retries a failed grant once; a second failure flags offline_grant_failed but still signs in', async () => {
    allowConsoleError(/Failed to mint offline-replay grant/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', body: LOGIN_OK },
      { path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['login'] } },
      { method: 'POST', path: '/api/auth/offline-grant', status: 500, body: { error: 'INTERNAL', message: 'down' } },
    ]);
    fill();
    signIn();
    await waitFor(() => expect(currentPath()).toBe('/m'), { timeout: 3000 });
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(2);
    expect(sessionStorage.getItem('offline_grant_failed')).toBe('1');
    expect(sessionStorage.getItem('offline_replay_token')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('first attempt failed'), expect.anything());
  });

  it('a grant that fails once and then succeeds is stored', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', body: LOGIN_OK },
      { path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['login'] } },
      { method: 'POST', path: '/api/auth/offline-grant', status: 503, times: 1, body: { error: 'BUSY', message: 'busy' } },
      { method: 'POST', path: '/api/auth/offline-grant', body: { token: 'grant-2', expiresAt: 'e' } },
    ]);
    fill();
    signIn();
    await waitFor(() => expect(currentPath()).toBe('/m'), { timeout: 3000 });
    expect(api.calls('POST', '/api/auth/offline-grant')).toHaveLength(2);
    expect(sessionStorage.getItem('offline_replay_token')).toBe('grant-2');
    expect(sessionStorage.getItem('offline_grant_failed')).toBeNull();
  });
});

describe('tablet login — the allowlist check fails CLOSED', () => {
  const refused = async (accessRoute: any) => {
    const api = renderLogin([{ method: 'POST', path: '/api/auth/login', body: LOGIN_OK }, accessRoute]);
    localStorage.setItem('access_token_backup', 'stale');
    fill();
    signIn();
    expect(await screen.findByText("You don't have access to log in on the tablet.")).toBeInTheDocument();
    // the freshly issued token is revoked on the server and never stored
    const logout = api.calls('POST', '/api/auth/logout');
    expect(logout).toHaveLength(1);
    expect(logout[0].headers.authorization).toBe('Bearer tok-1');
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('access_token_backup')).toBeNull();
    expect(currentPath()).toBe('/m/login');
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeEnabled();
    return api;
  };
  it('configured without "login"', async () => {
    await refused({ path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: ['my_tasks'] } });
  });
  it('configured with an EMPTY list', async () => {
    await refused({ path: '/api/config/tablet-access/my-features', body: { configured: true, allowed: [] } });
  });
  it('the allowlist endpoint errors', async () => {
    await refused({ path: '/api/config/tablet-access/my-features', status: 500, body: { error: 'X' } });
  });
  it('the allowlist answer is not JSON (the SPA shell) — refused, not waved through', async () => {
    renderLogin([{ method: 'POST', path: '/api/auth/login', body: LOGIN_OK }]);
    const real = globalThis.fetch as any;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes('/my-features')) return new Response('<!doctype html>', { status: 200 });
      if (url.includes('/api/auth/logout')) throw new TypeError('Failed to fetch');
      return real(input, init);
    }));
    fill();
    signIn();
    expect(await screen.findByText("You don't have access to log in on the tablet.")).toBeInTheDocument();
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });
});

describe('tablet login — refusals', () => {
  it('locked account: the reason, no attempts line, and a way to request a reset', async () => {
    renderLogin([{ method: 'POST', path: '/api/auth/login', status: 423, body: { error: 'ACCOUNT_LOCKED', message: 'Account locked after 5 failed attempts.' } }]);
    fill();
    signIn();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Account locked');
    expect(alert).toHaveTextContent('Account locked after 5 failed attempts.');
    fireEvent.click(screen.getByRole('button', { name: 'Request password reset' }));
    expect(currentPath()).toBe('/m/forgot-password');
  });

  it('wrong password shows how many attempts remain (plural, singular, none)', async () => {
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', status: 401, times: 1, body: { error: 'INVALID_CREDENTIALS', message: 'Invalid user ID or password', attemptsRemaining: 2 } },
      { method: 'POST', path: '/api/auth/login', status: 401, times: 1, body: { error: 'INVALID_CREDENTIALS', message: 'Invalid user ID or password', attemptsRemaining: 1 } },
      { method: 'POST', path: '/api/auth/login', status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'Invalid user ID or password', attemptsRemaining: 0 } },
    ]);
    fill();
    signIn();
    expect(await screen.findByText('2 attempts remaining before the account locks.')).toBeInTheDocument();
    expect(screen.getByText('Invalid user ID or password')).toBeInTheDocument();
    // typing clears the error and the counter
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'again' } });
    expect(screen.queryByText(/attempts? remaining/)).toBeNull();
    signIn();
    expect(await screen.findByText('1 attempt remaining before the account locks.')).toBeInTheDocument();
    signIn();
    await waitFor(() => expect(api.calls('POST', '/api/auth/login')).toHaveLength(3));
    await waitFor(() => expect(screen.queryByText(/attempts? remaining/)).toBeNull());
    expect(screen.getByText('Invalid user ID or password')).toBeInTheDocument();
  });

  it('a network failure with no message reads "Login failed"', async () => {
    renderLogin([]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue({}));
    fill();
    signIn();
    expect(await screen.findByText('Login failed')).toBeInTheDocument();
  });

  it('PASSWORD_EXPIRED shows the tablet\'s expiry message', async () => {
    // lib/api-client.ts also answers a 403 PASSWORD_EXPIRED by assigning
    // window.location.href = '/change-password' (jsdom logs it as an
    // unimplemented navigation, allowed below). In the WebView that is a full
    // page load onto a page whose POST /api/auth/change-password needs the
    // session this failed login never created — recorded as a defect.
    allowConsoleError(/Not implemented: navigation/);
    renderLogin([{ method: 'POST', path: '/api/auth/login', status: 403, body: { error: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } }]);
    fill();
    signIn();
    expect(await screen.findByText('Your password has expired. Contact administrator or use Forgot Password.')).toBeInTheDocument();
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });

  it('a server-side TABLET_ACCESS_DENIED is shown, with no conflict card', async () => {
    renderLogin([{ method: 'POST', path: '/api/auth/login', status: 403, body: { error: 'TABLET_ACCESS_DENIED', message: 'no' } }]);
    fill();
    signIn();
    expect(await screen.findByText("You don't have access to log in on the tablet.")).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('tablet login — another user on this tablet', () => {
  const conflict = { error: 'DIFFERENT_USER_SESSION_CONFLICT', message: 'Another user is logged in', activeSession: { loginTime: '2026-10-21T06:00:00.000Z', username: 'qa7', fullName: 'Quinn A' } };

  it('names the other user and forces only on confirm; a refused force shows the reason and drops the card', async () => {
    const api = renderLogin([
      { method: 'POST', path: '/api/auth/login', status: 409, times: 1, body: conflict },
      { method: 'POST', path: '/api/auth/login', status: 409, body: { error: 'DIFFERENT_USER_SESSION_CONFLICT', message: 'Still in use' } },
    ]);
    fill();
    signIn();
    const card = await screen.findByRole('alertdialog', { name: 'Another User is Logged In' });
    expect(card).toHaveTextContent('Quinn A (qa7)');
    expect(card).toHaveTextContent("Do you want to continue and logout the other user's session?");
    fireEvent.click(screen.getByRole('button', { name: 'Continue & Logout qa7' }));
    expect(await screen.findByText('Still in use')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls('POST', '/api/auth/login')[1].json).toMatchObject({ force: true, client: 'tablet' });
  });

  it('a force login refused for another reason also clears the card', async () => {
    renderLogin([
      { method: 'POST', path: '/api/auth/login', status: 409, times: 1, body: { error: 'SESSION_CONFLICT', message: 'busy', activeSession: {} } },
      { method: 'POST', path: '/api/auth/login', status: 500, body: { error: 'INTERNAL', message: 'Server exploded' } },
    ]);
    fill();
    signIn();
    const card = await screen.findByRole('alertdialog', { name: 'Active Session Detected' });
    expect(card).not.toHaveTextContent('Logged in:');
    fireEvent.click(screen.getByRole('button', { name: 'Continue & Logout Old Session' }));
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('editing the user ID dismisses the conflict card', async () => {
    renderLogin([{ method: 'POST', path: '/api/auth/login', status: 409, body: { error: 'SESSION_CONFLICT', message: 'busy', activeSession: {} } }]);
    fill();
    signIn();
    await screen.findByRole('alertdialog');
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'op2' } });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('tablet login — form controls', () => {
  it('Sign in is disabled until both fields are filled; Enter in the password submits', async () => {
    const api = renderLogin([{ method: 'POST', path: '/api/auth/login', status: 401, body: { error: 'INVALID_CREDENTIALS', message: 'nope' } }]);
    const btn = screen.getByRole('button', { name: /^sign in$/i });
    expect(btn).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' });
    expect(api.calls('POST', '/api/auth/login')).toHaveLength(0);
    fill('op1', '   ');
    expect(btn).toBeDisabled();
    fill();
    expect(btn).toBeEnabled();
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'a' });
    expect(api.calls('POST', '/api/auth/login')).toHaveLength(0);
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' });
    expect(await screen.findByText('nope')).toBeInTheDocument();
  });

  it('the eye button shows and hides the password, and is labelled for screen readers', async () => {
    renderLogin([]);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(pw.type).toBe('password');
    await flush();
  });

  it('links: forgot password, guest request; the server-address link only in the tablet app', async () => {
    renderLogin([]);
    expect(screen.queryByText('Change server address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(currentPath()).toBe('/m/forgot-password');
    fireEvent.click(screen.getByRole('button', { name: 'Guest filter cleaning request' }));
    expect(currentPath()).toBe('/guest-request');
    await flush();
  });

  it('inside the tablet app the "Change server address" link is offered', async () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    renderLogin([]);
    expect(screen.getByRole('link', { name: 'Change server address' })).toHaveAttribute('href', '/m/server-config');
    await flush();
  });
});

describe('tablet forgot password', () => {
  function renderForgot(routes: MockRoute[] = []) {
    const api = mockApi([...routes, ...mobileRoutes()]);
    renderPage(<><MobileForgotPasswordPage /><LocationProbe /></>, { route: '/m/forgot-password', api });
    return api;
  }

  it('sends the trimmed user ID and confirms without saying whether it exists', async () => {
    const api = renderForgot([{ method: 'POST', path: '/api/auth/forgot-password', body: (r: MockRequest) => ({ ok: true, echo: r.json }) }]);
    const send = screen.getByRole('button', { name: 'Send request' });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: '  op1  ' } });
    fireEvent.click(send);
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
    expect(screen.getByText(/If that user ID exists, your administrator has been notified/)).toBeInTheDocument();
    expect(api.calls('POST', '/api/auth/forgot-password')[0].json).toEqual({ username: 'op1' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(currentPath()).toBe('/m/login');
  });

  it('Enter with an empty ID asks for one; Enter with an ID submits', async () => {
    const api = renderForgot([{ method: 'POST', path: '/api/auth/forgot-password', body: {} }]);
    const input = screen.getByLabelText('User ID');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Please enter your User ID')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'op9' } });
    expect(screen.queryByText('Please enter your User ID')).toBeNull();
    fireEvent.keyDown(input, { key: 'x' });
    expect(api.calls('POST', '/api/auth/forgot-password')).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
  });

  it('shows the server error and keeps the form; a bare failure reads "Failed to submit request"', async () => {
    renderForgot([{ method: 'POST', path: '/api/auth/forgot-password', status: 500, body: { error: 'X', message: 'Mail server down' } }]);
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'op1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Mail server down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue({}));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Failed to submit request')).toBeInTheDocument();
  });

  it('shows "Sending…" while the request is in flight', async () => {
    let release!: () => void;
    renderForgot();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { release = () => res(new Response('{}', { status: 200 })); })));
    fireEvent.change(screen.getByLabelText('User ID'), { target: { value: 'op1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled();
    release();
    expect(await screen.findByText('Request sent')).toBeInTheDocument();
  });

  it('has a back-to-sign-in link to the tablet login', async () => {
    renderForgot();
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/m/login')).toBe(true);
    await flush();
  });
});
