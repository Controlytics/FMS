import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
// The router imports SmsSettingsPage from the sms-settings entry point (a re-export).
import { SmsSettingsPage } from '../notification-settings/sms-settings';
import { EmailSettingsPage } from '../notification-settings/email-settings';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth } from './config-test-helpers';

// Multi-request flows; generous under coverage + a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const SMS = '/api/notification-settings/sms';
const EMAIL = '/api/notification-settings/email';
const SAVED = {
  provider: 'http-gateway', enabled: true, defaultCountryCode: '+91', senderId: 'ACMEFM',
  twilioAccountSid: '', twilioAuthToken: '', twilioFromNumber: '', vonageApiKey: '', vonageApiSecret: '', vonageFromNumber: '',
  httpGatewayUrl: 'https://sms.acme.test/send', httpGatewayMethod: 'POST', httpGatewayHeaders: {}, httpGatewayBodyTemplate: '{"to":"{phone}"}',
  httpGatewaySuccessRegex: '',
};

function setup(page: 'sms' | 'email', extra: MockRoute[] = [], config: unknown = SAVED) {
  const api = mockApi([
    ...extra,
    { path: SMS, body: config },
    { path: EMAIL, body: {} },
    { path: `${EMAIL}/oauth2/redirect-uri`, body: { redirectUri: 'https://x/cb' } },
    { path: `${EMAIL}/oauth2/status`, body: { configured: false, hasRefreshToken: false, tokenExpiresAt: null } },
    ...commonRoutes(),
  ]);
  renderPage(page === 'sms' ? <SmsSettingsPage /> : <EmailSettingsPage />, { user: SUPER_ADMIN, api });
  return api;
}

const field = (name: string) => document.querySelector(`[name="${name}"]`) as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });
const loaded = async () => { await waitFor(() => expect(field('httpGatewayUrl')?.value).toBe('https://sms.acme.test/send')); };

describe('Notification Channels — SMS', () => {
  it('opens on the SMS tab and loads the HTTP gateway config; Save waits for a change', async () => {
    const api = setup('sms');
    await loaded();
    expect(screen.getByText('HTTP Gateway Settings')).toBeInTheDocument();
    expect(field('senderId').value).toBe('ACMEFM');
    expect(field('httpGatewayMethod').value).toBe('POST');
    expect((document.querySelector('[name="provider"][value="http-gateway"]') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByText('Twilio Settings')).toBeNull();
    expect(saveBtn()).toBeDisabled();
    expect(api.calls('GET', EMAIL)).toHaveLength(0); // the email tab is not mounted
    expect(api.unmatched).toEqual([]);
  });

  it('switching provider shows that provider\'s fields; Save sends the form', async () => {
    const api = setup('sms', [{ method: 'PUT', path: SMS, body: { ok: true } }]);
    await loaded();
    fireEvent.click(document.querySelector('[name="provider"][value="twilio"]')!);
    expect(screen.getByText('Twilio Settings')).toBeInTheDocument();
    expect(screen.queryByText('HTTP Gateway Settings')).toBeNull();
    fireEvent.change(field('twilioAccountSid'), { target: { value: 'AC123' } });
    fireEvent.change(field('twilioAuthToken'), { target: { value: 'tok' } });
    fireEvent.change(field('twilioFromNumber'), { target: { value: '+15550100' } });
    fireEvent.click(document.querySelector('[name="provider"][value="vonage"]')!);
    expect(screen.getByText('Vonage (Nexmo) Settings')).toBeInTheDocument();
    fireEvent.change(field('vonageApiKey'), { target: { value: 'vk' } });
    fireEvent.click(document.querySelector('[name="provider"][value="twilio"]')!);
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', SMS)).toHaveLength(1));
    expect(api.calls('PUT', SMS)[0].json).toEqual({
      ...SAVED, provider: 'twilio', twilioAccountSid: 'AC123', twilioAuthToken: 'tok', twilioFromNumber: '+15550100', vonageApiKey: 'vk',
    });
    expect(await screen.findByText('SMS settings saved successfully')).toBeInTheDocument();
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('HTTP gateway fields: method, body template and success pattern are sent', async () => {
    const api = setup('sms', [{ method: 'PUT', path: SMS, body: { ok: true } }]);
    await loaded();
    fireEvent.change(field('httpGatewayMethod'), { target: { value: 'GET' } });
    fireEvent.change(field('httpGatewayBodyTemplate'), { target: { value: '' } });
    fireEvent.change(field('httpGatewaySuccessRegex'), { target: { value: '"ok":true' } });
    fireEvent.change(field('defaultCountryCode'), { target: { value: '+44' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', SMS)).toHaveLength(1));
    expect(api.calls('PUT', SMS)[0].json).toMatchObject({
      httpGatewayMethod: 'GET', httpGatewayBodyTemplate: '', httpGatewaySuccessRegex: '"ok":true', defaultCountryCode: '+44',
    });
  });

  it('save the server wants signed (UPDATE_SMS_CONFIG): prompt, then retry with the password', async () => {
    const api = setup('sms', [reauthRequired('PUT', SMS), { method: 'PUT', path: SMS, body: { ok: true } }]);
    await loaded();
    fireEvent.change(field('senderId'), { target: { value: 'NEWID' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update SMS Config" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-sms');
    await waitFor(() => expect(api.calls('PUT', SMS)).toHaveLength(2));
    expect(api.calls('PUT', SMS)[1].headers['x-reauth-password']).toBe('pw-sms');
    expect(api.calls('PUT', SMS)[1].json).toMatchObject({ senderId: 'NEWID', _currentPassword: 'pw-sms' });
    expect(await screen.findByText('SMS settings saved successfully')).toBeInTheDocument();
  });

  it('a refused save shows the server message', async () => {
    setup('sms', [{ method: 'PUT', path: SMS, status: 400, body: { error: 'SSRF_BLOCKED', message: 'Gateway URL resolves to a loopback address' } }]);
    await loaded();
    fireEvent.change(field('httpGatewayUrl'), { target: { value: 'http://127.0.0.1/send' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Gateway URL resolves to a loopback address')).toBeInTheDocument();
  });

  it('test SMS needs SMS enabled and a number; posts the recipient and shows the outcome', async () => {
    const T = `${SMS}/test`;
    const api = setup('sms', [
      { method: 'POST', path: T, times: 1, body: { success: true, message: 'Queued with gateway' } },
      { method: 'POST', path: T, times: 1, body: { success: false, error: 'Pattern did not match response' } },
      { method: 'POST', path: T, status: 500, body: { error: 'INTERNAL', message: 'Gateway unreachable' } },
    ]);
    await loaded();
    const send = () => screen.getByRole('button', { name: /Send Test SMS|Sending/ });
    expect(send()).toBeDisabled(); // no phone yet
    fireEvent.change(screen.getByPlaceholderText('+919876543210'), { target: { value: '+919800000001' } });
    expect(send()).not.toBeDisabled();
    await act(async () => { fireEvent.click(send()); });
    expect(await screen.findByText('Queued with gateway')).toBeInTheDocument();
    expect(api.calls('POST', T)[0].json).toEqual({ recipient: '+919800000001' });
    await act(async () => { fireEvent.click(send()); });
    expect(await screen.findByText('Pattern did not match response')).toBeInTheDocument();
    await act(async () => { fireEvent.click(send()); });
    expect(await screen.findByText('Gateway unreachable')).toBeInTheDocument();
    // Disabling SMS disables the test button even with a number typed.
    fireEvent.click(field('enabled'));
    expect(send()).toBeDisabled();
  });

  it('defaults when nothing is saved: HTTP gateway, +91, disabled', async () => {
    setup('sms', [], {});
    await waitFor(() => expect(field('senderId').value).toBe('DigiLog'));
    expect(field('defaultCountryCode').value).toBe('+91');
    expect(field('enabled').checked).toBe(false);
    expect(screen.getByText('HTTP Gateway Settings')).toBeInTheDocument();
  });

  it('tabs: the Email page can switch to SMS and back', async () => {
    const api = setup('email');
    await waitFor(() => expect(api.calls('GET', EMAIL)).toHaveLength(1));
    expect(screen.getByText('Mail From')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'SMS' }));
    await loaded();
    expect(screen.queryByText('Mail From')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email (SMTP)' }));
    expect(await screen.findByText('Mail From')).toBeInTheDocument();
    expect(screen.queryByText('HTTP Gateway Settings')).toBeNull();
  });
});
