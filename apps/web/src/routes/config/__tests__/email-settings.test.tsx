import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { EmailSettingsPage } from '../notification-settings/email-settings';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

// Multi-request flows; generous under coverage + a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const EMAIL = '/api/notification-settings/email';
const SAVED = {
  host: 'smtp.acme.test', port: 25, secure: false, username: 'mailer', password: '********', fromEmail: 'noreply@acme.test',
  fromName: 'Acme FMS', enabled: true, smtpProvider: 'custom', authType: 'basic', oauth2Provider: 'microsoft',
  clientId: '', clientSecret: '', providerTenantId: '', refreshToken: '', tokenUrl: '', scope: '',
  connectionTimeout: 10000, socketTimeout: 15000,
};

function setup(extra: MockRoute[] = [], opts: { config?: unknown; status?: unknown; redirect?: unknown } = {}) {
  const api = mockApi([
    ...extra,
    { path: EMAIL, body: opts.config ?? SAVED },
    opts.redirect === null
      ? { path: `${EMAIL}/oauth2/redirect-uri`, status: 204 }
      : { path: `${EMAIL}/oauth2/redirect-uri`, body: opts.redirect ?? { redirectUri: 'https://fms.acme.test/api/oauth2/callback' } },
    { path: `${EMAIL}/oauth2/status`, body: opts.status ?? { configured: false, hasRefreshToken: false, tokenExpiresAt: null } },
    { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' } },
    ...commonRoutes(),
  ]);
  renderPage(<EmailSettingsPage />, { user: SUPER_ADMIN, api });
  return api;
}

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });
const loaded = async () => { await waitFor(() => expect(field('host').value).toBe('smtp.acme.test')); };

describe('Notification Channels — Email (SMTP)', () => {
  it('loads the saved SMTP config into the form; Save stays disabled until something changes', async () => {
    const api = setup();
    await loaded();
    expect(screen.getByRole('heading', { name: 'Notification Channels' })).toBeInTheDocument();
    expect(field('port').value).toBe('25');
    expect(field('fromEmail').value).toBe('noreply@acme.test');
    expect(field('fromName').value).toBe('Acme FMS');
    expect(field('enabled').checked).toBe(true);
    expect(field('username').value).toBe('mailer');
    expect(screen.getByText('Provider Setup Guide')).toBeInTheDocument();
    expect(screen.queryByText('Client ID')).toBeNull();
    expect(saveBtn()).toBeDisabled();
    await waitFor(() => expect(api.calls('GET', `${EMAIL}/oauth2/status`)).toHaveLength(1));
    expect(api.unmatched).toEqual([]);
  });

  it('SMTP presets fill host/port and the matching OAuth2 provider; Save sends the whole form', async () => {
    const api = setup([{ method: 'PUT', path: EMAIL, body: { ok: true } }]);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Gmail' }));
    expect(field('host').value).toBe('smtp.gmail.com');
    expect(field('port').value).toBe('587');
    fireEvent.click(screen.getByRole('button', { name: 'AWS SES' }));
    expect(field('host').value).toBe('email-smtp.us-east-1.amazonaws.com');
    fireEvent.click(screen.getByRole('button', { name: 'Sendgrid' }));
    expect(field('host').value).toBe('smtp.sendgrid.net');
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    expect(field('host').value).toBe('smtp.sendgrid.net'); // custom keeps whatever was typed
    fireEvent.click(screen.getByRole('button', { name: 'Office 365' }));
    expect(field('host').value).toBe('smtp.office365.com');
    fireEvent.change(field('fromName'), { target: { value: 'FMS Alerts' } });
    fireEvent.click(field('secure'));
    expect(saveBtn()).not.toBeDisabled();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', EMAIL)).toHaveLength(1));
    expect(api.calls('PUT', EMAIL)[0].json).toEqual({
      ...SAVED, host: 'smtp.office365.com', port: 587, secure: true, smtpProvider: 'office365', oauth2Provider: 'microsoft', fromName: 'FMS Alerts',
    });
    expect(await screen.findByText('Email settings saved successfully')).toBeInTheDocument();
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('Gmail preset switches the OAuth2 provider to Google', async () => {
    const api = setup([{ method: 'PUT', path: EMAIL, body: { ok: true } }]);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Gmail' }));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', EMAIL)).toHaveLength(1));
    expect(api.calls('PUT', EMAIL)[0].json).toMatchObject({ smtpProvider: 'gmail', oauth2Provider: 'google', host: 'smtp.gmail.com' });
  });

  it('save the server wants signed (UPDATE_EMAIL_CONFIG): prompt, then the retry carries the password', async () => {
    const api = setup([reauthRequired('PUT', EMAIL), { method: 'PUT', path: EMAIL, body: { ok: true } }]);
    await loaded();
    fireEvent.change(field('host'), { target: { value: 'smtp2.acme.test' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update Email Config" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-mail');
    await waitFor(() => expect(api.calls('PUT', EMAIL)).toHaveLength(2));
    const retry = api.calls('PUT', EMAIL)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-mail');
    expect(retry.json).toMatchObject({ host: 'smtp2.acme.test', _currentPassword: 'pw-mail' });
    expect(await screen.findByText('Email settings saved successfully')).toBeInTheDocument();
  });

  it('cancelling the signature saves nothing and is not reported as a failure', async () => {
    const api = setup([reauthRequired('PUT', EMAIL)]);
    await loaded();
    fireEvent.change(field('host'), { target: { value: 'smtp3.acme.test' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    // 2026-10-21 (item 9): a dismissed prompt used to show the hook's
    // "Cancelled — password confirmation was not completed." as an error.
    expect(screen.queryByText(/password confirmation was not completed/)).toBeNull();
    expect(screen.queryByText('Email settings saved successfully')).toBeNull();
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', EMAIL)).toHaveLength(1);
  });

  it('a refused save shows the server message', async () => {
    setup([{ method: 'PUT', path: EMAIL, status: 400, body: { error: 'VALIDATION', message: 'Port must be 1-65535' } }]);
    await loaded();
    fireEvent.change(field('port'), { target: { value: '0' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Port must be 1-65535')).toBeInTheDocument();
    expect(screen.queryByText('Email settings saved successfully')).toBeNull();
  });

  it('defaults are used when nothing is saved yet; test needs email enabled', async () => {
    setup([], { config: {} });
    await waitFor(() => expect(field('fromName').value).toBe('DigiLog'));
    expect(field('port').value).toBe('587');
    expect(field('enabled').checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Test Connection' })).toBeDisabled();
  });

  it('test connection (no recipient) posts {} and shows success; with a recipient it is "Send Test Email"', async () => {
    const T = `${EMAIL}/test`;
    const api = setup([
      { method: 'POST', path: T, times: 1, body: { success: true, message: 'SMTP connection OK' } },
      { method: 'POST', path: T, times: 1, body: { success: false, error: 'Recipient rejected' } },
      { method: 'POST', path: T, status: 502, body: { error: 'BAD_GATEWAY', message: 'Connection timed out' } },
    ]);
    await loaded();
    // Ready state before acting: reset() writes the inputs' DOM values at once, but the
    // button's `disabled={!enabled}` follows a re-render; clicked before it, nothing is sent.
    const testButton = screen.getByRole('button', { name: 'Test Connection' });
    await waitFor(() => expect(testButton).toBeEnabled());
    await act(async () => { fireEvent.click(testButton); });
    expect(await screen.findByText('SMTP connection OK')).toBeInTheDocument();
    expect(api.calls('POST', T)[0].json).toEqual({});
    fireEvent.change(screen.getByPlaceholderText('test@example.com'), { target: { value: 'qa@acme.test' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' })); });
    expect(await screen.findByText('Recipient rejected')).toBeInTheDocument();
    expect(api.calls('POST', T)[1].json).toEqual({ recipient: 'qa@acme.test' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send Test Email' })); });
    expect(await screen.findByText('Connection timed out')).toBeInTheDocument();
  });

  it('OAuth2 / Microsoft: tenant field, redirect URI, not-configured status, Azure guide; custom provider hides the flow', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByText('OAuth2', { selector: 'div.font-medium' }).closest('button')!);
    expect(screen.getByText('Client ID')).toBeInTheDocument();
    expect(screen.getByText('Directory (Tenant) ID')).toBeInTheDocument();
    expect(screen.queryByText('Refresh Token')).toBeNull();
    expect(screen.queryByText('Provider Setup Guide')).toBeNull();
    expect(screen.getByText('Microsoft Azure AD OAuth2 Setup Guide')).toBeInTheDocument();
    expect(screen.getByText(/copy this to your Azure AD App Registration/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue('https://fms.acme.test/api/oauth2/callback')).toBeInTheDocument();
    expect(screen.getByText(/OAuth2 not configured yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Get OAuth2 Token' })).toBeInTheDocument();
    expect(screen.getByText(/Opens a popup to authorize with Microsoft/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Google' }));
    expect(screen.getByText('Refresh Token')).toBeInTheDocument();
    expect(screen.queryByText('Directory (Tenant) ID')).toBeNull();
    expect(screen.getByText('Google OAuth2 Setup Guide')).toBeInTheDocument();
    expect(screen.getByText(/copy this to your Google Cloud Console/)).toBeInTheDocument();
    expect(screen.getByText(/Opens a popup to authorize with Google/)).toBeInTheDocument();

    // Two "Custom" buttons: the SMTP preset and the OAuth2 provider (second).
    fireEvent.click(screen.getAllByRole('button', { name: 'Custom' })[1]);
    expect(screen.getByText('Token URL')).toBeInTheDocument();
    expect(screen.getByText('Scope')).toBeInTheDocument();
    expect(screen.queryByText('OAuth2 Authorization Code Flow')).toBeNull();
    expect(screen.queryByText(/Setup Guide/)).toBeNull();

    // Back to Basic
    fireEvent.click(screen.getByText('Basic', { selector: 'div.font-medium' }).closest('button')!);
    expect(screen.getByText('Provider Setup Guide')).toBeInTheDocument();
  });

  it('OAuth2 status configured with a refresh token and expiry; the button re-authorizes', async () => {
    setup([], {
      config: { ...SAVED, authType: 'oauth2', oauth2Provider: 'microsoft' },
      status: { configured: true, hasRefreshToken: true, tokenExpiresAt: '2026-12-31T23:00:00Z' },
    });
    expect(await screen.findByText(/OAuth2 tokens configured/)).toHaveTextContent('OAuth2 tokens configured (with refresh token) — expires 2026-12-31 23:00');
    expect(screen.getByRole('button', { name: 'Re-authorize OAuth2' })).toBeInTheDocument();
  });

  it('OAuth2 status configured without refresh token or expiry', async () => {
    setup([], {
      config: { ...SAVED, authType: 'oauth2', oauth2Provider: 'google' },
      status: { configured: true, hasRefreshToken: false, tokenExpiresAt: null },
    });
    const s = await screen.findByText(/OAuth2 tokens configured/);
    expect(s.textContent).toBe('OAuth2 tokens configured');
  });

  it('Get OAuth2 Token opens the provider popup, or explains what is missing', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const A = `${EMAIL}/oauth2/authorize`;
    setup([
      { path: A, times: 1, body: { authUrl: 'https://login.microsoftonline.com/x/authorize?client_id=c' } },
      { path: A, times: 1, body: {} },
      { path: A, status: 400, body: { error: 'NO_CLIENT', message: 'Client ID not configured' } },
    ], { config: { ...SAVED, authType: 'oauth2' } });
    const btn = await screen.findByRole('button', { name: 'Get OAuth2 Token' });
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://login.microsoftonline.com/x/authorize?client_id=c', 'oauth2-auth', 'width=600,height=700,scrollbars=yes'));
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText(/Could not generate authorization URL/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(btn); });
    expect(await screen.findByText('Client ID not configured')).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('an oauth2-success message from the popup refreshes status and confirms; other messages are ignored', async () => {
    const api = setup([], { config: { ...SAVED, authType: 'oauth2' } });
    await screen.findByRole('button', { name: 'Get OAuth2 Token' });
    await waitFor(() => expect(api.calls('GET', `${EMAIL}/oauth2/status`)).toHaveLength(1));
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'something-else' } })); });
    expect(screen.queryByText(/OAuth2 authorization successful/)).toBeNull();
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { type: 'oauth2-success' } })); });
    expect(await screen.findByText('OAuth2 authorization successful! Tokens have been saved.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', `${EMAIL}/oauth2/status`).length).toBeGreaterThan(1));
  });

  it('Copy uses the clipboard API in a secure context and resets after a moment', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const secure = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    try {
      setup([], { config: { ...SAVED, authType: 'oauth2' } });
      await screen.findByDisplayValue('https://fms.acme.test/api/oauth2/callback');
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(writeText).toHaveBeenCalledWith('https://fms.acme.test/api/oauth2/callback');
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument(), { timeout: 3500 });
    } finally {
      // @ts-expect-error restore jsdom default
      delete navigator.clipboard;
      if (secure) Object.defineProperty(window, 'isSecureContext', secure); else delete (window as any).isSecureContext;
    }
  });

  it('Copy falls back to execCommand when the clipboard API is unavailable', async () => {
    const exec = vi.fn(() => true);
    (document as any).execCommand = exec;
    try {
      setup([], { config: { ...SAVED, authType: 'oauth2' } });
      await screen.findByDisplayValue('https://fms.acme.test/api/oauth2/callback');
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      expect(exec).toHaveBeenCalledWith('copy');
      expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
      expect(document.querySelector('textarea[style*="-9999px"]')).toBeNull(); // temp node removed
    } finally {
      delete (document as any).execCommand;
    }
  });

  it('Copy does nothing while the redirect URI has not loaded', async () => {
    setup([], { config: { ...SAVED, authType: 'oauth2' }, redirect: null });
    expect(await screen.findByDisplayValue('Loading...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
  });
});
