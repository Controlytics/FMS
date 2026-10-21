import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { SIDEBAR_ITEMS } from '@digilog/shared';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { RoleAccessPage } from '../role-access';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

afterEach(resetEnv);
configure({ asyncUtilTimeout: 4000 });

const TOTAL = SIDEBAR_ITEMS.length;
const role = (name: string, displayName: string, hierarchyLevel: number) => ({
  id: `r-${name}`, name, displayName, hierarchyLevel, permissions: [], color: 'bg-blue-500', isSystem: true, isActive: true,
});
const ACTIVE = [role('SUPER_ADMIN', 'Super Admin', 6), role('ADMIN', 'Administrator', 5), role('QA_LEAD', 'QA Lead', 3)];
const USERS = {
  data: [
    { id: 'u1', username: 'jdoe', fullName: 'Jane Doe', role: 'ADMIN', status: 'ENABLED' },
    { id: 'u2', username: 'bsmith', fullName: 'bob Smith', role: 'GUEST_ROLE', status: 'ENABLED' },
  ],
};
const ADMIN_ITEMS = ['users', 'dashboard', 'cleaning-cycles', 'rfid-track-record', 'approvals'];
const ROLE_PUT = '/api/config/roles/ADMIN';

function setup(opts: { extra?: MockRoute[]; adminConfig?: unknown; active?: unknown[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/roles', body: ACTIVE },
    { path: '/api/roles/active', body: opts.active ?? ACTIVE },
    { path: '/api/users', body: USERS },
    { path: ROLE_PUT, body: opts.adminConfig ?? { sidebarItems: ADMIN_ITEMS } },
    { path: '/api/config/roles/QA_LEAD', body: {} }, // no sidebarItems -> every item
    { path: '/api/config/users/u1', body: { sidebarItems: [] } },
    { path: '/api/config/users/u2', body: {} },
    ...commonRoutes(),
  ]);
  renderPage(<RoleAccessPage />, { route: '/config/roles', user: SUPER_ADMIN, api });
  return api;
}

async function openTab() {
  await screen.findByText('QA Lead', { selector: 'span' }); // active roles loaded (Roles tab table)
  fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
  expect(screen.getByText('Loading configuration...')).toBeInTheDocument();
  await screen.findByRole('heading', { name: 'Display Order' });
}
const countLine = () => screen.getByText(/items enabled for/).parentElement!.textContent!;
const card = (label: string) => screen.getByRole('heading', { level: 4, name: label }).closest('div.relative') as HTMLElement;
const isOn = (el: HTMLElement) => el.className.includes('bg-brand-50');
const groupBox = (g: string) => screen.getAllByRole('heading', { level: 3 }).find((h) => h.textContent?.includes(g) && h.textContent.includes(`/`))!.closest('div.rounded-xl') as HTMLElement;
const orderPanel = () => screen.getByRole('heading', { name: 'Display Order' }).parentElement!.parentElement as HTMLElement;
const orderLabels = () => [...orderPanel().querySelectorAll('span.flex-1')].map((s) => s.textContent);
const orderRow = (label: string) => [...orderPanel().querySelectorAll('span.flex-1')]
  .find((s) => s.textContent === label || s.textContent!.startsWith(`${label}(`))!.parentElement as HTMLElement;
const arrows = (label: string) => within(orderRow(label)).getAllByRole('button');
const headerSave = () => screen.queryByRole('button', { name: /Save Changes|Saving\.\.\./ });
const reasonBox = () => screen.queryByPlaceholderText("Why is this role's menu changing?");

describe('Role & Access — Sidebar tab, by role', { timeout: 30000 }, () => {
  it('loads ADMIN by default and shows enabled items, group counts and the display order', async () => {
    const api = setup();
    await openTab();
    expect(countLine()).toBe(`${ADMIN_ITEMS.length} / ${TOTAL} items enabled for Administrator`);
    // All active roles (SUPER_ADMIN included) are pickable here.
    expect(screen.getByRole('button', { name: 'Super Admin' })).toBeInTheDocument();
    expect(isOn(card('Users'))).toBe(true);
    expect(isOn(card('Checklists'))).toBe(false);
    expect(groupBox('Reports')).toHaveTextContent('(2/5)');
    expect(orderLabels()).toEqual(['Users', 'Dashboard', 'Reports(2 reports)', 'Filter Cleaning Record', 'RFID Track Record', 'Approvals']);
    expect(arrows('Users')[0]).toBeDisabled();
    expect(arrows('Approvals')[1]).toBeDisabled();
    expect(arrows('Filter Cleaning Record')[0]).toBeDisabled();
    expect(arrows('RFID Track Record')[1]).toBeDisabled();
    expect(headerSave()).toBeNull();
    expect(reasonBox()).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(1);
    expect(api.unmatched).toEqual([]);
  });

  it('a role change needs a reason (it grants page permissions); the PUT carries items in order + reason', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: ROLE_PUT, body: { ok: true } }] });
    await openTab();
    fireEvent.click(card('Users'));        // off
    fireEvent.click(card('Checklists'));   // on (appended)
    expect(isOn(card('Users'))).toBe(false);
    expect(isOn(card('Checklists'))).toBe(true);
    expect(countLine()).toContain(`${ADMIN_ITEMS.length} / ${TOTAL}`);
    expect(reasonBox()).not.toBeNull();

    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await screen.findByText('Reason required')).toBeInTheDocument();
    expect(api.calls('PUT', ROLE_PUT)).toHaveLength(0);

    fireEvent.change(reasonBox()!, { target: { value: '  Menu tidy-up per SOP ' } });
    fireEvent.click(headerSave()!);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await waitFor(() => expect(api.calls('PUT', ROLE_PUT)).toHaveLength(1));
    expect(api.calls('PUT', ROLE_PUT)[0].json).toEqual({
      sidebarItems: ['dashboard', 'cleaning-cycles', 'rfid-track-record', 'approvals', 'checklists'],
      reason: 'Menu tidy-up per SOP',
    });
    await waitFor(() => expect(headerSave()).toBeNull());
    expect(reasonBox()).toBeNull();
  });

  it('Enable All / Disable All for the whole menu; no enabled items hides the order panel', async () => {
    setup();
    await openTab();
    fireEvent.click(screen.getAllByRole('button', { name: 'Enable All' })[0]);
    expect(countLine()).toContain(`${TOTAL} / ${TOTAL}`);
    expect(within(groupBox('Reports')).getByRole('button', { name: 'Enable All' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Disable All' })[0]);
    expect(countLine()).toContain(`0 / ${TOTAL}`);
    expect(screen.queryByRole('heading', { name: 'Display Order' })).toBeNull();
    expect(within(groupBox('Reports')).getByRole('button', { name: 'Disable All' })).toBeDisabled();
  });

  it('group Enable All / Disable All touch only that group', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: ROLE_PUT, body: { ok: true } }] });
    await openTab();
    fireEvent.click(within(groupBox('Reports')).getByRole('button', { name: 'Enable All' }));
    expect(groupBox('Reports')).toHaveTextContent('(5/5)');
    expect(orderRow('Reports')).toHaveTextContent('(5 reports)');
    fireEvent.click(within(groupBox('Reports')).getByRole('button', { name: 'Disable All' }));
    expect(groupBox('Reports')).toHaveTextContent('(0/5)');
    fireEvent.change(reasonBox()!, { target: { value: 'Reports moved to QA' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', ROLE_PUT)).toHaveLength(1));
    expect(api.calls('PUT', ROLE_PUT)[0].json.sidebarItems).toEqual(['users', 'dashboard', 'approvals']);
  });

  it('Display Order arrows move items and whole groups; group children reorder inside the group', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: ROLE_PUT, body: { ok: true } }] });
    await openTab();
    fireEvent.click(arrows('Approvals')[0]);            // Approvals above Reports
    expect(orderLabels()).toEqual(['Users', 'Dashboard', 'Approvals', 'Reports(2 reports)', 'Filter Cleaning Record', 'RFID Track Record']);
    fireEvent.click(arrows('Users')[1]);                // Users below Dashboard
    fireEvent.click(arrows('RFID Track Record')[0]);    // child up inside Reports
    fireEvent.click(arrows('Reports')[0]);              // whole group up
    expect(orderLabels()).toEqual(['Dashboard', 'Users', 'Reports(2 reports)', 'RFID Track Record', 'Filter Cleaning Record', 'Approvals']);
    fireEvent.click(arrows('RFID Track Record')[1]);    // child back down
    fireEvent.change(reasonBox()!, { target: { value: 'Reorder the menu' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', ROLE_PUT)).toHaveLength(1));
    // The saved array IS the order; the group stays contiguous.
    expect(api.calls('PUT', ROLE_PUT)[0].json.sidebarItems).toEqual(['dashboard', 'users', 'cleaning-cycles', 'rfid-track-record', 'approvals']);
  });

  it('a role with no saved sidebar gets every item; stale ids are kept but never listed in the order', async () => {
    const api = setup({ adminConfig: { sidebarItems: ['legacy-page', 'dashboard'] } });
    await openTab();
    expect(countLine()).toContain(`2 / ${TOTAL}`);
    expect(orderLabels()).toEqual(['Dashboard']);
    fireEvent.click(screen.getByRole('button', { name: 'QA Lead' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/QA_LEAD')).toHaveLength(1));
    await waitFor(() => expect(countLine()).toBe(`${TOTAL} / ${TOTAL} items enabled for QA Lead`));
    // Re-clicking the selected role is a no-op.
    const before = api.calls('GET', '/api/config/roles/QA_LEAD').length;
    fireEvent.click(screen.getByRole('button', { name: 'QA Lead' }));
    expect(api.calls('GET', '/api/config/roles/QA_LEAD')).toHaveLength(before);
  });

  it('falls back to the first active role when ADMIN is not active', async () => {
    const api = setup({ active: [role('QA_LEAD', 'QA Lead', 3)] });
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/QA_LEAD').length).toBeGreaterThan(0));
    await screen.findByRole('heading', { name: 'Display Order' });
    expect(countLine()).toContain('items enabled for QA Lead');
  });

  it('a refused save shows the error dialog; a server-demanded signature retries with the password', async () => {
    const api = setup({
      extra: [
        { method: 'PUT', path: ROLE_PUT, status: 400, times: 1, body: { error: 'REASON_REQUIRED', message: 'A reason is required' } },
        reauthRequired('PUT', ROLE_PUT),
        { method: 'PUT', path: ROLE_PUT, body: { ok: true } },
      ],
    });
    await openTab();
    fireEvent.click(card('Checklists'));
    fireEvent.change(reasonBox()!, { target: { value: 'Grant checklists' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await ackMessage('Save Failed')).toContain('A reason is required');

    await act(async () => { fireEvent.click(headerSave()!); });
    await signReauth('pw-side');
    await waitFor(() => expect(api.calls('PUT', ROLE_PUT)).toHaveLength(3));
    expect(api.calls('PUT', ROLE_PUT)[2].headers['x-reauth-password']).toBe('pw-side');
    expect(api.calls('PUT', ROLE_PUT)[2].json).toMatchObject({ reason: 'Grant checklists', _currentPassword: 'pw-side' });
    await waitFor(() => expect(headerSave()).toBeNull());
  });

  it('a refusal without a message falls back to a generic one', async () => {
    setup({ extra: [{ method: 'PUT', path: ROLE_PUT, status: 400, body: { error: 'INTERNAL', message: '' } }] });
    await openTab();
    fireEvent.click(card('Checklists'));
    fireEvent.change(reasonBox()!, { target: { value: 'Grant checklists' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await ackMessage('Save Failed')).toContain('Failed to save sidebar configuration');
  });

  it('cancelling the signature leaves the change unsaved without an error', async () => {
    const api = setup({ extra: [reauthRequired('PUT', ROLE_PUT)] });
    await openTab();
    fireEvent.click(card('Checklists'));
    fireEvent.change(reasonBox()!, { target: { value: 'Grant checklists' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Save Failed' })).toBeNull();
    expect(headerSave()).not.toBeNull();
    expect(api.calls('PUT', ROLE_PUT)).toHaveLength(1);
  });
});

describe('Role & Access — Sidebar tab, by user', { timeout: 30000 }, () => {
  async function openUsers() {
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: /Configure by User/ }));
    await screen.findByText('Jane Doe');
  }
  const userRow = (name: string) => screen.getByText(name, { selector: 'p.truncate' }).closest('div.p-3') as HTMLElement;
  const userCard = (label: string) => screen.getAllByText(label, { selector: 'span' })
    .map((s) => s.closest('div.flex.items-center.gap-3.p-3') as HTMLElement).find(Boolean)!;
  const USER_PUT = '/api/config/users/u1';

  it('shows the users list immediately while it loads, then the list with search', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: /Configure by User/ }));
    expect(screen.getByText('Loading users...')).toBeInTheDocument();
    await screen.findByText('Jane Doe');
    expect(screen.getByText('Select a user to configure')).toBeInTheDocument();
    expect(within(userRow('Jane Doe')).getByText('Administrator')).toBeInTheDocument();
    expect(within(userRow('bob Smith')).getByText('GUEST_ROLE')).toBeInTheDocument(); // unknown role -> raw key
    const search = screen.getByPlaceholderText('Search users...');
    fireEvent.change(search, { target: { value: 'BSMI' } }); // username, case-insensitive
    expect(screen.queryByText('Jane Doe')).toBeNull();
    expect(screen.getByText('bob Smith')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'jane' } }); // full name
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(screen.getByText('No users found')).toBeInTheDocument();
  });

  it('selecting a user loads their override; an empty override means role defaults', async () => {
    const api = setup();
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await waitFor(() => expect(api.calls('GET', USER_PUT)).toHaveLength(1));
    expect(await screen.findByText('(Using role defaults)')).toBeInTheDocument();
    expect(screen.getByText(/Currently using role defaults\./)).toBeInTheDocument();
    expect(screen.getByText('jdoe • Administrator')).toBeInTheDocument();
    expect(headerSave()).toBeNull();
    // Re-selecting the same user is a no-op.
    fireEvent.click(userRow('Jane Doe'));
    expect(api.calls('GET', USER_PUT)).toHaveLength(1);
    // A user whose override has no list at all, and whose role is unknown.
    fireEvent.click(userRow('bob Smith'));
    await waitFor(() => expect(api.calls('GET', '/api/config/users/u2')).toHaveLength(1));
    expect(await screen.findByText('bsmith • GUEST_ROLE')).toBeInTheDocument();
    expect(await screen.findByText('(Using role defaults)')).toBeInTheDocument();
  });

  it('a user override saves without a reason and Reset sends an empty list', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: USER_PUT, body: { ok: true } }] });
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await screen.findByText('(Using role defaults)');
    fireEvent.click(userCard('Dashboard'));
    fireEvent.click(within(groupBox('Reports')).getByRole('button', { name: 'Enable All' }));
    expect(screen.queryByText('(Using role defaults)')).toBeNull();
    expect(screen.getByText('Display Order')).toBeInTheDocument();
    expect(reasonBox()).toBeNull(); // user overrides grant nothing -> no reason
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', USER_PUT)).toHaveLength(1));
    expect(api.calls('PUT', USER_PUT)[0].json).toEqual({
      sidebarItems: ['dashboard', 'rfid-track-record', 'cleaning-cycles', 'filter-lifecycle-report', 'deviations', 'quality-notifications'],
    });
    await waitFor(() => expect(headerSave()).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Role Default' }));
    await waitFor(() => expect(api.calls('PUT', USER_PUT)).toHaveLength(2));
    expect(api.calls('PUT', USER_PUT)[1].json).toEqual({ sidebarItems: [] });
    expect(await screen.findByText('(Using role defaults)')).toBeInTheDocument();
  });

  it('user Enable All / Disable All and card toggles', async () => {
    setup();
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await screen.findByText('(Using role defaults)');
    const panel = screen.getByText('jdoe • Administrator').closest('div.p-4') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: 'Enable All' }));
    expect(screen.getByText(new RegExp(`/ ${TOTAL} items enabled$`)).parentElement).toHaveTextContent(`${TOTAL} / ${TOTAL} items enabled`);
    fireEvent.click(userCard('Users'));
    expect(screen.getByText(new RegExp(`/ ${TOTAL} items enabled$`)).parentElement).toHaveTextContent(`${TOTAL - 1} / ${TOTAL}`);
    fireEvent.click(within(panel).getByRole('button', { name: 'Disable All' }));
    expect(screen.getByText('(Using role defaults)')).toBeInTheDocument();
  });

  it('save and reset failures are reported; a signature is asked when the server demands it', async () => {
    const api = setup({
      extra: [
        { method: 'PUT', path: USER_PUT, status: 500, times: 1, body: { error: 'X', message: 'User config write failed' } },
        { method: 'PUT', path: USER_PUT, status: 409, times: 1, body: { error: 'X', message: 'Reset refused' } },
        reauthRequired('PUT', USER_PUT),
        { method: 'PUT', path: USER_PUT, body: { ok: true } },
      ],
    });
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await screen.findByText('(Using role defaults)');
    fireEvent.click(userCard('Dashboard'));
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await ackMessage('Save Failed')).toContain('User config write failed');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset to Role Default' })); });
    expect(await ackMessage('Reset Failed')).toContain('Reset refused');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset to Role Default' })); });
    expect(await screen.findByText(/Performing "Update User Config" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-user');
    await waitFor(() => expect(api.calls('PUT', USER_PUT)).toHaveLength(4));
    expect(api.calls('PUT', USER_PUT)[3].json).toEqual({ sidebarItems: [], _currentPassword: 'pw-user' });
  });

  it('a signed user-override save carries the password; messageless refusals get generic text', async () => {
    const blank = { error: 'INTERNAL', message: '' };
    const api = setup({
      extra: [
        reauthRequired('PUT', USER_PUT),
        { method: 'PUT', path: USER_PUT, times: 1, body: { ok: true } },
        { method: 'PUT', path: USER_PUT, status: 400, times: 2, body: blank },
      ],
    });
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await screen.findByText('(Using role defaults)');
    fireEvent.click(userCard('Dashboard'));
    await act(async () => { fireEvent.click(headerSave()!); });
    await signReauth('pw-u2');
    await waitFor(() => expect(api.calls('PUT', USER_PUT)).toHaveLength(2));
    expect(api.calls('PUT', USER_PUT)[1].json).toEqual({ sidebarItems: ['dashboard'], _currentPassword: 'pw-u2' });
    await waitFor(() => expect(headerSave()).toBeNull());

    fireEvent.click(userCard('Users'));
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await ackMessage('Save Failed')).toContain('Failed to save user sidebar configuration');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset to Role Default' })); });
    expect(await ackMessage('Reset Failed')).toContain('Failed to reset user to role defaults');
  });

  it('cancelling a user-config signature (save or reset) is silent', async () => {
    const api = setup({ extra: [reauthRequired('PUT', USER_PUT), reauthRequired('PUT', USER_PUT)] });
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await screen.findByText('(Using role defaults)');
    fireEvent.click(userCard('Dashboard'));
    await act(async () => { fireEvent.click(headerSave()!); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset to Role Default' })); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByRole('heading', { name: /Failed/ })).toBeNull();
    expect(api.calls('PUT', USER_PUT)).toHaveLength(2);
  });

  it('going back to "by role" drops the selected user and reloads the role config', async () => {
    const api = setup();
    await openUsers();
    fireEvent.click(userRow('Jane Doe'));
    await screen.findByText('(Using role defaults)');
    const roleGets = api.calls('GET', ROLE_PUT).length;
    fireEvent.click(screen.getByRole('button', { name: /Configure by Role/ }));
    await screen.findByRole('heading', { name: 'Display Order' });
    expect(api.calls('GET', ROLE_PUT).length).toBeGreaterThan(roleGets);
    expect(countLine()).toContain(`${ADMIN_ITEMS.length} / ${TOTAL}`);
    // Clicking the active sub-tab again does nothing.
    fireEvent.click(screen.getByRole('button', { name: /Configure by Role/ }));
    expect(screen.getByRole('heading', { name: 'Display Order' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Configure by User/ }));
    expect(await screen.findByText('Select a user to configure')).toBeInTheDocument();
  });
});
