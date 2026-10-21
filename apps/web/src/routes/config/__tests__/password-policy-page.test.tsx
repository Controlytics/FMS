import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { PasswordPolicyPage } from '../password-policy';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

afterEach(resetEnv);

const PATH = '/api/config/password-policy';
const SAVED = {
  minLength: 8, maxLength: 128,
  requireUppercase: true, requireLowercase: true, requireNumbers: true, requireSpecialChars: true,
  minUppercase: 1, minLowercase: 1, minNumbers: 1, minSpecialChars: 1,
  preventReuseCount: 12, cannotBeUserId: true, cannotContainUserId: true,
  maxFailedAttempts: 5, passwordExpiryDays: 90, expiryNotificationDays: 0,
  autoLogoutEnabled: true, idleTimeoutMinutes: 15, warningMinutes: 2,
};

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function setup(opts: { user?: any; extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data ?? SAVED },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<><PasswordPolicyPage /><Where /></>, { user: opts.user ?? SUPER_ADMIN, api, route: '/config/password-policy' });
  return api;
}

/** The number input that sits in the same field block as `label`. */
function field(label: string): HTMLInputElement {
  const el = screen.getByText(label);
  const block = el.closest('div.space-y-2') ?? el.closest('div.p-4');
  return block!.querySelector('input') as HTMLInputElement;
}
const charField = (heading: string) => (screen.getByText(heading).closest('div.p-4') as HTMLElement).querySelector('input') as HTMLInputElement;
const checkbox = (label: string) => (screen.getByText(label).closest('label') as HTMLElement).querySelector('input') as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
// Wait for the inputs AND the watched auto-logout toggle (a separate render) to settle.
const loaded = () => waitFor(() => {
  expect(field('Minimum Length').value).toBe('8');
  expect(screen.getByText('Idle Timeout')).toBeInTheDocument();
});

describe('General & Password Settings page', () => {
  it('loads every stored setting into the form', async () => {
    const api = setup();
    await loaded();
    expect(field('Max Failed Login Attempts').value).toBe('5');
    expect(field('Maximum Length').value).toBe('128');
    expect(field('Idle Timeout').value).toBe('15');
    expect(field('Warning Before Logout').value).toBe('2');
    expect(field('Prevent Password Reuse').value).toBe('12');
    expect(field('Password Expiry Period').value).toBe('90');
    expect(field('Expiry Notification').value).toBe('0');
    expect(charField('Uppercase').value).toBe('1');
    expect(charField('Special').value).toBe('1');
    expect(checkbox('Password cannot be same as User ID').checked).toBe(true);
    expect(checkbox('Enable Auto-Logout on Idle').checked).toBe(true);
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('turning auto-logout off hides the idle/warning fields', async () => {
    setup();
    await loaded();
    fireEvent.click(checkbox('Enable Auto-Logout on Idle'));
    await waitFor(() => expect(screen.queryByText('Idle Timeout')).toBeNull());
    expect(screen.queryByText('Warning Before Logout')).toBeNull();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('saves edited numbers as numbers with PUT and reports success', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(field('Minimum Length'), { target: { value: '12' } });
    fireEvent.change(field('Max Failed Login Attempts'), { target: { value: '3' } });
    fireEvent.change(charField('Numbers'), { target: { value: '2' } });
    fireEvent.click(checkbox('Password cannot contain User ID'));
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      ...SAVED, minLength: 12, maxFailedAttempts: 3, minNumbers: 2, cannotContainUserId: false,
    });
    expect(await screen.findByText('Settings updated successfully')).toBeInTheDocument();
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('out-of-range numbers are blocked by the inputs\' own min/max before anything is sent', async () => {
    const api = setup();
    await loaded();
    fireEvent.change(field('Minimum Length'), { target: { value: '4' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(field('Minimum Length').validity.rangeUnderflow).toBe(true);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('emptied fields are refused by the schema, every problem listed, nothing sent', async () => {
    const api = setup();
    await loaded();
    fireEvent.change(field('Minimum Length'), { target: { value: '' } });
    fireEvent.change(field('Idle Timeout'), { target: { value: '' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Please fix the following validation errors:')).toBeInTheDocument();
    expect(screen.getAllByText('Expected number, received nan')).toHaveLength(2);
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('when UPDATE_PASSWORD_POLICY is signed, the password rides in the body', async () => {
    const api = setup({ reauth: ['UPDATE_PASSWORD_POLICY'], extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(field('Prevent Password Reuse'), { target: { value: '6' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update Password Policy" requires identity verification/)).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    await signReauth('pw-pp');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ ...SAVED, preventReuseCount: 6, _currentPassword: 'pw-pp' });
    expect(await screen.findByText('Settings updated successfully')).toBeInTheDocument();
  });

  it('a wrong password keeps the prompt open with "Incorrect password"', async () => {
    const api = setup({
      reauth: ['UPDATE_PASSWORD_POLICY'],
      extra: [{ method: 'PUT', path: PATH, status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'bad' } }, { method: 'PUT', path: PATH, body: { ok: true } }],
    });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(field('Password Expiry Period'), { target: { value: '30' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    await signReauth('right');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2));
    expect(api.calls('PUT', PATH)[1].json._currentPassword).toBe('right');
    expect(await screen.findByText('Settings updated successfully')).toBeInTheDocument();
  });

  it('cancelling a retroactive REAUTH_REQUIRED shows the cancel notice and sends nothing more', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH)] });
    await loaded();
    fireEvent.change(field('Expiry Notification'), { target: { value: '7' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    expect(await screen.findByText(/Cancelled — password confirmation was not completed/)).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(1);
  });

  it('a server refusal is shown inline', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION_ERROR', message: 'expiryNotificationDays requires passwordExpiryDays' } }] });
    await loaded();
    fireEvent.change(field('Password Expiry Period'), { target: { value: '0' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('expiryNotificationDays requires passwordExpiryDays')).toBeInTheDocument();
  });

  it('a refusal with an empty message falls back to "Failed to update"', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'X', message: '' } }] });
    await loaded();
    fireEvent.change(field('Minimum Length'), { target: { value: '9' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Failed to update')).toBeInTheDocument();
  });

  it('a role without CONFIG_UPDATE gets a disabled Save with the reason', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await loaded();
    fireEvent.change(field('Minimum Length'), { target: { value: '10' } });
    await waitFor(() => expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required'));
    expect(saveBtn()).toBeDisabled();
  });

  it('a non-super-admin with CONFIG_UPDATE may save', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    await loaded();
    fireEvent.change(field('Minimum Length'), { target: { value: '10' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
  });

  it('Cancel returns to /config', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('where').textContent).toBe('/config');
  });
});
