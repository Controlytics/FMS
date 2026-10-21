import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import LdapConfigPage from '../ldap';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

afterEach(resetEnv);

const PATH = '/api/ldap/config';
const TEST = '/api/ldap/test-connection';
const ROLES = [
  { name: 'OPERATOR', displayName: 'Operator' },
  { name: 'QA', displayName: 'Quality Assurance' },
  { name: 'ADMIN', displayName: 'Administrator' },
];
// What the server stores (a partial object is merged over the page defaults).
const SAVED = {
  enabled: true,
  serverUrl: 'ldaps://ad.plant.local:636',
  bindDN: 'CN=svc,DC=plant,DC=local',
  bindPassword: '••••••••',
  searchBase: 'OU=Users,DC=plant,DC=local',
  roleMappings: [{ ldapGroup: 'CN=QA,OU=Groups', role: 'QA' }],
  defaultRole: 'OPERATOR',
};
const DEFAULTS = {
  enabled: false, serverUrl: '', bindDN: '', bindPassword: '', searchBase: '',
  searchFilter: '(sAMAccountName={{username}})', usernameAttribute: 'sAMAccountName', emailAttribute: 'mail',
  fullNameAttribute: 'displayName', departmentAttribute: 'department', groupAttribute: 'memberOf',
  tlsRejectUnauthorized: false, connectionTimeout: 5000, roleMappings: [], defaultRole: 'OPERATOR', syncAttributes: true,
};

function setup(opts: { user?: any; extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.data === undefined ? SAVED : opts.data },
    { path: '/api/roles/active', body: ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<LdapConfigPage />, { user: opts.user ?? SUPER_ADMIN, api, route: '/config/ldap' });
  return api;
}

const byPlaceholder = (p: string) => screen.getByPlaceholderText(p) as HTMLInputElement;
const serverUrl = () => byPlaceholder('ldaps://ad.company.com:636');
const labelled = (label: string) => (screen.getByText(label).parentElement as HTMLElement).querySelector('input') as HTMLInputElement;
const checkbox = (label: string) => (screen.getByText(label).closest('label') as HTMLElement).querySelector('input') as HTMLInputElement;
const enableToggle = () => (screen.getByText('Enable LDAP Authentication').closest('div.flex') as HTMLElement).querySelector('button') as HTMLButtonElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });
const testBtn = () => screen.getByRole('button', { name: /Test Connection|Testing/ });
const defaultRoleSelect = () => (screen.getByText('Default Role (when no group matches)').parentElement as HTMLElement).querySelector('select') as HTMLSelectElement;
const loaded = () => waitFor(() => expect(serverUrl().value).toBe(SAVED.serverUrl));

describe('LDAP / Active Directory config page', () => {
  it('merges the stored config over the defaults and starts clean', async () => {
    const api = setup();
    await loaded();
    expect(byPlaceholder('CN=svc_digilog,OU=Service Accounts,DC=company,DC=com').value).toBe(SAVED.bindDN);
    expect(byPlaceholder('OU=Users,DC=company,DC=com').value).toBe(SAVED.searchBase);
    // Defaults fill what the server did not store.
    expect(byPlaceholder('(sAMAccountName={{username}})').value).toBe('(sAMAccountName={{username}})');
    expect(labelled('Username Attribute').value).toBe('sAMAccountName');
    expect(labelled('Email').value).toBe('mail');
    expect(labelled('Connection Timeout (ms)').value).toBe('5000');
    expect(checkbox('Sync attributes on every login').checked).toBe(true);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    // The stored mapping row with its role.
    expect(byPlaceholder('CN=Admins,OU=Groups,DC=company,DC=com').value).toBe('CN=QA,OU=Groups');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Quality Assurance' }).length).toBeGreaterThan(0));
    expect(defaultRoleSelect().value).toBe('OPERATOR');
    expect(saveBtn()).toBeDisabled();
    expect(testBtn()).not.toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('with nothing stored the page shows the defaults, Disabled, and no mappings', async () => {
    setup({ data: {} });
    await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument());
    expect(serverUrl().value).toBe('');
    expect(screen.getByText('No group mappings configured. Users will be assigned the default role.')).toBeInTheDocument();
    // Test Connection needs a server URL.
    expect(testBtn()).toBeDisabled();
    expect(saveBtn()).toBeDisabled();
  });

  it('every edit lands in the saved body', async () => {
    const api = setup({ data: {}, extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await waitFor(() => expect(screen.getByText('Disabled')).toBeInTheDocument());
    fireEvent.click(enableToggle());
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    fireEvent.change(serverUrl(), { target: { value: 'ldap://dc1:389' } });
    fireEvent.change(byPlaceholder('CN=svc_digilog,OU=Service Accounts,DC=company,DC=com'), { target: { value: 'CN=bind' } });
    fireEvent.change(byPlaceholder('Service account password'), { target: { value: 's3cret' } });
    fireEvent.change(labelled('Connection Timeout (ms)'), { target: { value: '8000' } });
    fireEvent.click(checkbox('Verify TLS Certificate'));
    fireEvent.change(byPlaceholder('OU=Users,DC=company,DC=com'), { target: { value: 'OU=People' } });
    fireEvent.change(byPlaceholder('(sAMAccountName={{username}})'), { target: { value: '(uid={{username}})' } });
    fireEvent.change(labelled('Username Attribute'), { target: { value: 'uid' } });
    fireEvent.change(labelled('Group Attribute'), { target: { value: 'groups' } });
    fireEvent.change(labelled('Full Name'), { target: { value: 'cn' } });
    fireEvent.change(labelled('Email'), { target: { value: 'email' } });
    fireEvent.change(labelled('Department'), { target: { value: 'ou' } });
    fireEvent.click(checkbox('Sync attributes on every login'));
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Administrator' }).length).toBeGreaterThan(0));
    fireEvent.change(defaultRoleSelect(), { target: { value: 'QA' } });
    // New mapping row defaults to the (now QA) default role, then edited.
    fireEvent.click(screen.getByRole('button', { name: /Add Mapping/ }));
    const groupInput = byPlaceholder('CN=Admins,OU=Groups,DC=company,DC=com');
    const row = groupInput.closest('div.flex.items-center') as HTMLElement;
    expect((within(row).getByRole('combobox') as HTMLSelectElement).value).toBe('QA');
    fireEvent.change(groupInput, { target: { value: 'CN=Admins' } });
    fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'ADMIN' } });

    expect(saveBtn()).not.toBeDisabled();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      ...DEFAULTS,
      enabled: true, serverUrl: 'ldap://dc1:389', bindDN: 'CN=bind', bindPassword: 's3cret', connectionTimeout: 8000,
      tlsRejectUnauthorized: true, searchBase: 'OU=People', searchFilter: '(uid={{username}})', usernameAttribute: 'uid',
      groupAttribute: 'groups', fullNameAttribute: 'cn', emailAttribute: 'email', departmentAttribute: 'ou',
      syncAttributes: false, defaultRole: 'QA', roleMappings: [{ ldapGroup: 'CN=Admins', role: 'ADMIN' }],
    });
    expect(await screen.findByText('LDAP configuration saved successfully')).toBeInTheDocument();
  });

  it('removing a mapping row drops it from the form', async () => {
    setup();
    await loaded();
    const row = byPlaceholder('CN=Admins,OU=Groups,DC=company,DC=com').closest('div.flex.items-center') as HTMLElement;
    const buttons = within(row).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(screen.queryByPlaceholderText('CN=Admins,OU=Groups,DC=company,DC=com')).toBeNull();
    expect(screen.getByText('No group mappings configured. Users will be assigned the default role.')).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('the success notice clears itself after five seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://dc2:636' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('LDAP configuration saved successfully')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(5100); });
    await waitFor(() => expect(screen.queryByText('LDAP configuration saved successfully')).toBeNull());
  });

  it('UPDATE_LDAP_CONFIG signature: prompt, then the password is sent in header and body', async () => {
    const api = setup({ reauth: ['UPDATE_LDAP_CONFIG'], extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://evil:636' } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Performing "Update LDAP Config" requires identity verification/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await signReauth('pw-ldap');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const put = api.calls('PUT', PATH)[0];
    expect(put.headers['x-reauth-password']).toBe('pw-ldap');
    expect(put.json).toMatchObject({ serverUrl: 'ldaps://evil:636', _currentPassword: 'pw-ldap' });
    expect(await screen.findByText('LDAP configuration saved successfully')).toBeInTheDocument();
  });

  it('cancelling the signature frees the Save button and reports the cancel', async () => {
    const api = setup({ reauth: ['UPDATE_LDAP_CONFIG'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://x:636' } });
    fireEvent.click(saveBtn());
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(screen.getByText(/Cancelled — password confirmation was not completed/)).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('a retroactive REAUTH_REQUIRED from the server opens the prompt and retries', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://y:636' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('later');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2));
    expect(api.calls('PUT', PATH)[1].headers['x-reauth-password']).toBe('later');
  });

  it('a refused save shows the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 400, body: { error: 'VALIDATION_ERROR', message: 'serverUrl must use ldap:// or ldaps://' } }] });
    await loaded();
    fireEvent.change(serverUrl(), { target: { value: 'http://nope' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('serverUrl must use ldap:// or ldaps://')).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('Test Connection posts the current form and shows a success result', async () => {
    const api = setup({ extra: [{ method: 'POST', path: TEST, body: { success: true, message: 'Bound as CN=svc in 42 ms' } }] });
    await loaded();
    fireEvent.change(byPlaceholder('Service account password'), { target: { value: 'typed' } });
    fireEvent.click(testBtn());
    expect(screen.getByRole('button', { name: /Testing/ })).toBeDisabled();
    const msg = await screen.findByText('Bound as CN=svc in 42 ms');
    expect(msg.className).toContain('text-emerald-600');
    expect(api.calls('POST', TEST)[0].json).toMatchObject({ serverUrl: SAVED.serverUrl, bindPassword: 'typed' });
  });

  it('Test Connection shows a failed bind in red', async () => {
    setup({ extra: [{ method: 'POST', path: TEST, body: { success: false, message: 'Invalid credentials (49)' } }] });
    await loaded();
    await act(async () => { fireEvent.click(testBtn()); });
    const msg = await screen.findByText('Invalid credentials (49)');
    expect(msg.className).toContain('text-red-600');
  });

  it('Test Connection reports a refused request as a failure', async () => {
    setup({ extra: [{ method: 'POST', path: TEST, status: 502, body: { error: 'LDAP_UNREACHABLE', message: 'connect ETIMEDOUT 10.0.0.5:636' } }] });
    await loaded();
    await act(async () => { fireEvent.click(testBtn()); });
    const msg = await screen.findByText('connect ETIMEDOUT 10.0.0.5:636');
    expect(msg.className).toContain('text-red-600');
    expect(testBtn()).not.toBeDisabled();
  });

  it('empty server messages fall back to "Failed to save" / "Test failed"', async () => {
    setup({ extra: [
      { method: 'PUT', path: PATH, status: 400, body: { error: 'X', message: '' } },
      { method: 'POST', path: TEST, status: 400, body: { error: 'X', message: '' } },
    ] });
    await loaded();
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://q:636' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Failed to save')).toBeInTheDocument();
    await act(async () => { fireEvent.click(testBtn()); });
    expect(await screen.findByText('Test failed')).toBeInTheDocument();
  });

  it('a role without CONFIG_UPDATE cannot save or test', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await loaded();
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://z:636' } });
    expect(saveBtn()).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
    expect(testBtn()).toBeDisabled();
    expect(testBtn()).toHaveAttribute('title', 'CONFIG_UPDATE permission required');
  });

  it('a non-super-admin with CONFIG_UPDATE can save and test', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] } });
    await loaded();
    fireEvent.change(serverUrl(), { target: { value: 'ldaps://z:636' } });
    await waitFor(() => expect(saveBtn()).not.toBeDisabled());
    expect(testBtn()).not.toBeDisabled();
  });
});
