import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { EmailSettingsPage } from '../notification-settings/email-settings';
import { SmsSettingsPage } from '../notification-settings/sms-settings';
import { SUPER_ADMIN, commonRoutes, resetEnv, cancelReauth } from './config-test-helpers';

/**
 * Item 9 (2026-10-21): dismissing the password prompt is not a failure. Both
 * channel saves passed no `onCancel`, so the hook fell back to `onError` and the
 * page showed "Cancelled — password confirmation was not completed." in its red
 * error banner.
 */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const EMAIL = '/api/notification-settings/email';
const SMS = '/api/notification-settings/sms';

function setup(page: 'email' | 'sms', reauth: string[]) {
  const api = mockApi([
    { path: EMAIL, body: { host: 'smtp.acme.test', port: 25, fromEmail: 'noreply@acme.test', fromName: 'Acme', enabled: true, smtpProvider: 'custom', authType: 'basic' } },
    { path: SMS, body: { provider: 'http-gateway', enabled: true, defaultCountryCode: '+91', senderId: 'ACMEFM', httpGatewayUrl: 'https://sms.acme.test/send', httpGatewayMethod: 'POST', httpGatewayHeaders: {}, httpGatewayBodyTemplate: '{}', httpGatewaySuccessRegex: '' } },
    { path: `${EMAIL}/oauth2/redirect-uri`, body: { redirectUri: 'https://x/cb' } },
    { path: `${EMAIL}/oauth2/status`, body: { configured: false, hasRefreshToken: false, tokenExpiresAt: null } },
    ...commonRoutes({ reauth }),
  ]);
  renderPage(page === 'email' ? <EmailSettingsPage /> : <SmsSettingsPage />, { user: SUPER_ADMIN, api });
  return api;
}

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });

describe('item 9 — cancelling the channel-save signature is silent', () => {
  it('Email: cancel sends nothing, shows no failure, and Save stays usable', async () => {
    const api = setup('email', ['UPDATE_EMAIL_CONFIG']);
    await waitFor(() => expect(field('host').value).toBe('smtp.acme.test'));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(field('host'), { target: { value: 'smtp2.acme.test' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update Email Config" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText(/Cancelled|password confirmation was not completed/)).toBeNull();
    expect(screen.queryByText('Email settings saved successfully')).toBeNull();
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', EMAIL)).toHaveLength(0);
  });

  it('SMS: cancel sends nothing, shows no failure, and Save stays usable', async () => {
    const api = setup('sms', ['UPDATE_SMS_CONFIG']);
    await waitFor(() => expect(field('httpGatewayUrl')?.value).toBe('https://sms.acme.test/send'));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(field('senderId'), { target: { value: 'ACME2' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update SMS Config" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText(/Cancelled|password confirmation was not completed/)).toBeNull();
    expect(screen.queryByText('SMS settings saved successfully')).toBeNull();
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', SMS)).toHaveLength(0);
  });
});
