import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { FEATURE_PRIVILEGES } from '@digilog/shared';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { RoleAccessPage } from '../role-access';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

afterEach(resetEnv);
configure({ asyncUtilTimeout: 4000 });

const TOTAL = FEATURE_PRIVILEGES.length;
const role = (name: string, displayName: string, hierarchyLevel: number, color = '#2563eb') => ({
  id: `r-${name}`, name, displayName, hierarchyLevel, permissions: [], color, isSystem: true, isActive: true,
});
const ACTIVE = [
  role('SUPER_ADMIN', 'Super Admin', 6),
  role('OPERATOR', 'Operator', 1, ''),
  role('ADMIN', 'Administrator', 5),
  role('QA_LEAD', 'QA Lead', 3),
];

function setup(opts: { extra?: MockRoute[]; active?: unknown[]; adminPerms?: unknown } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/roles', body: ACTIVE },
    { path: '/api/roles/active', body: opts.active ?? ACTIVE },
    { path: '/api/config/roles/ADMIN', body: opts.adminPerms ?? { permissions: { 'debug.view': true, 'users.view': true } } },
    { path: '/api/config/roles/QA_LEAD', body: {} }, // no permissions key at all
    { path: '/api/config/roles/OPERATOR', body: { permissions: {} } },
    ...commonRoutes(),
  ]);
  renderPage(<RoleAccessPage />, { route: '/config/roles', user: SUPER_ADMIN, api });
  return api;
}

async function openTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
  expect(screen.getByText('Loading permissions...')).toBeInTheDocument();
  await screen.findByRole('heading', { name: 'Debug Traces' });
}
const groupOf = (label: string) => screen.getByRole('heading', { name: label }).closest('div.p-6') as HTMLElement;
const box = (label: string) => screen.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement;
const headerSave = () => screen.queryByRole('button', { name: /Save Changes|Saving\.\.\./ });
const statText = (label: string) => screen.getByText(label).parentElement!.textContent!;
const PUT = '/api/config/roles/ADMIN';

describe('Role & Access — Permissions tab', { timeout: 30000 }, () => {
  it('loads the selected role and renders the Sidebar → Page → Action tree with live counts', async () => {
    const api = setup();
    await screen.findByText('Administrator', { selector: 'span' });
    await openTab();
    // Role cards: SUPER_ADMIN excluded, highest hierarchy first.
    const cards = screen.getAllByRole('button').filter((b) => ['Administrator', 'QA Lead', 'Operator', 'Super Admin'].includes(b.textContent ?? ''));
    expect(cards.map((c) => c.textContent)).toEqual(['Administrator', 'QA Lead', 'Operator']);
    expect(statText('Selected Role')).toContain('Administrator');
    expect(statText('Enabled')).toContain(`2 / ${TOTAL}`);
    expect(statText('Access Level')).toContain(`${Math.round((2 / TOTAL) * 100)}%`);

    const debug = groupOf('Debug Traces');
    expect(debug).toHaveTextContent('1 of 2 enabled');
    expect(box('View Debug Traces').checked).toBe(true);
    expect(box('Manage Debug Traces').checked).toBe(false);
    expect(within(debug).getByRole('button', { name: 'Enable All' })).not.toBeDisabled();
    expect(within(debug).getByRole('button', { name: 'Disable All' })).not.toBeDisabled();
    // A group with nothing enabled cannot be "disabled" further.
    expect(within(groupOf('Version History')).getByRole('button', { name: 'Disable All' })).toBeDisabled();
    // Multi-page groups show page sub-headers; single-page groups don't.
    expect(within(groupOf('Configuration')).getByText('Backup & Restore')).toBeInTheDocument();
    expect(within(debug).queryByText('Debug Traces', { selector: 'p' })).toBeNull();
    // Nodes with a cross-linked step-up action carry a badge.
    expect(screen.getByText('Export / Download Backups').parentElement).toHaveTextContent('re-auth');
    expect(screen.getByText('View Debug Traces').parentElement).not.toHaveTextContent('re-auth');

    expect(headerSave()).toBeNull();
    expect(screen.queryByText(/Reason for this change/)).toBeNull();
    expect(api.calls('GET', '/api/config/roles/ADMIN')).toHaveLength(1);
    expect(api.unmatched).toEqual([]);
  });

  it('a change needs a reason: Save without one warns and sends nothing; with one it PUTs permissions + reason', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PUT, body: { ok: true } }] });
    await openTab();
    fireEvent.click(box('Manage Debug Traces'));
    expect(box('Manage Debug Traces').checked).toBe(true);
    expect(groupOf('Debug Traces')).toHaveTextContent('2 of 2 enabled');
    expect(statText('Enabled')).toContain(`3 / ${TOTAL}`);
    const reason = screen.getByPlaceholderText("Why are this role's permissions changing?");
    expect(headerSave()).not.toBeNull();

    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await screen.findByText('Reason required')).toBeInTheDocument();
    expect(api.calls('PUT', PUT)).toHaveLength(0);

    fireEvent.change(reason, { target: { value: '  CAPA-77 grants trace mgmt  ' } });
    fireEvent.click(headerSave()!);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(1));
    expect(api.calls('PUT', PUT)[0].json).toEqual({
      permissions: { 'debug.view': true, 'users.view': true, 'debug.manage': true },
      reason: 'CAPA-77 grants trace mgmt',
    });
    await waitFor(() => expect(headerSave()).toBeNull());
    expect(screen.queryByPlaceholderText("Why are this role's permissions changing?")).toBeNull();
  });

  it('group Enable All / Disable All set every node in the group and the save sends explicit false', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PUT, body: { ok: true } }] });
    await openTab();
    const debug = () => groupOf('Debug Traces');
    fireEvent.click(within(debug()).getByRole('button', { name: 'Enable All' }));
    expect(debug()).toHaveTextContent('2 of 2 enabled');
    expect(within(debug()).getByRole('button', { name: 'Enable All' })).toBeDisabled();
    fireEvent.click(within(debug()).getByRole('button', { name: 'Disable All' }));
    expect(debug()).toHaveTextContent('0 of 2 enabled');
    expect(within(debug()).getByRole('button', { name: 'Disable All' })).toBeDisabled();
    // Untick a single enabled node too.
    fireEvent.click(box('View Users'));
    fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'Least privilege review' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(1));
    expect(api.calls('PUT', PUT)[0].json.permissions).toEqual({ 'debug.view': false, 'debug.manage': false, 'users.view': false });
  });

  it('switching role loads that role, resets the dirty state, and copes with a config that has no permissions', async () => {
    const api = setup();
    await openTab();
    fireEvent.click(box('Manage Debug Traces'));
    expect(headerSave()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'QA Lead' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/QA_LEAD')).toHaveLength(1));
    await waitFor(() => expect(statText('Selected Role')).toContain('QA Lead'));
    await waitFor(() => expect(statText('Enabled')).toContain(`0 / ${TOTAL}`));
    expect(headerSave()).toBeNull();
    expect(box('View Debug Traces').checked).toBe(false);
    // A role with no colour falls back to slate when selected.
    fireEvent.click(screen.getByRole('button', { name: 'Operator' }));
    expect(statText('Selected Role')).toContain('Operator');
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/OPERATOR')).toHaveLength(1));
    await screen.findByRole('heading', { name: 'Debug Traces' }); // tree back after the load
  });

  it('when ADMIN is not an active role the stat card names the raw key', async () => {
    setup({ active: [role('QA_LEAD', 'QA Lead', 3)] });
    await openTab();
    expect(statText('Selected Role')).toContain('ADMIN');
  });

  it('a refused save shows the server message in the error dialog and keeps the edit', async () => {
    setup({ extra: [{ method: 'PUT', path: PUT, status: 400, body: { error: 'REASON_REQUIRED', message: 'Reason must describe the change' } }] });
    await openTab();
    fireEvent.click(box('Manage Debug Traces'));
    fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'because reasons' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await ackMessage('Save Failed')).toContain('Reason must describe the change');
    expect(headerSave()).not.toBeNull();
    expect(box('Manage Debug Traces').checked).toBe(true);
  });

  it('a refusal without a message falls back to a generic one', async () => {
    setup({ extra: [{ method: 'PUT', path: PUT, status: 400, body: { error: 'INTERNAL', message: '' } }] });
    await openTab();
    fireEvent.click(box('Manage Debug Traces'));
    fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'because reasons' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await ackMessage('Save Failed')).toContain('Failed to save permissions');
  });

  it('server-demanded signature (UPDATE_ROLE_CONFIG) prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PUT), { method: 'PUT', path: PUT, body: { ok: true } }] });
    await openTab();
    fireEvent.click(box('Manage Debug Traces'));
    fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'Signed change' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await screen.findByText(/Performing "Update Role Config" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-perm');
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(2));
    const retry = api.calls('PUT', PUT)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-perm');
    expect(retry.json).toMatchObject({ reason: 'Signed change', _currentPassword: 'pw-perm' });
    await waitFor(() => expect(headerSave()).toBeNull());
  });

  it('cancelling the signature reports nothing and keeps the edit unsaved', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PUT)] });
    await openTab();
    fireEvent.click(box('Manage Debug Traces'));
    fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'Signed change' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Save Failed' })).toBeNull();
    expect(api.calls('PUT', PUT)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Save Changes/ })).not.toBeDisabled();
  });
});

describe('Role & Access — Permissions tab, privileges missing from the tree', { timeout: 30000 }, () => {
  it('render under "Other Permissions" and can be toggled and saved', async () => {
    const orphan = { id: 'zz.orphan', label: 'Orphan Privilege', icon: 'x', category: 'Other' } as unknown as (typeof FEATURE_PRIVILEGES)[number];
    FEATURE_PRIVILEGES.push(orphan);
    try {
      const api = setup({ extra: [{ method: 'PUT', path: PUT, body: { ok: true } }] });
      await openTab();
      const other = groupOf('Other Permissions');
      expect(other).toHaveTextContent('0 of 1 enabled');
      expect(within(other).getByRole('button', { name: 'Disable All' })).toBeDisabled();
      fireEvent.click(within(other).getByRole('button', { name: 'Enable All' }));
      expect(groupOf('Other Permissions')).toHaveTextContent('1 of 1 enabled');
      expect(box('Orphan Privilege').checked).toBe(true);
      expect(within(groupOf('Other Permissions')).getByRole('button', { name: 'Enable All' })).toBeDisabled();
      fireEvent.click(within(groupOf('Other Permissions')).getByRole('button', { name: 'Disable All' }));
      expect(box('Orphan Privilege').checked).toBe(false);
      fireEvent.click(box('Orphan Privilege'));
      expect(box('Orphan Privilege').checked).toBe(true);
      fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'Orphan grant' } });
      await act(async () => { fireEvent.click(headerSave()!); });
      await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(1));
      expect(api.calls('PUT', PUT)[0].json.permissions['zz.orphan']).toBe(true);
    } finally {
      FEATURE_PRIVILEGES.splice(FEATURE_PRIVILEGES.indexOf(orphan), 1);
    }
  });
});
