import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { RoleAccessPage } from '../role-access';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth } from './config-test-helpers';

afterEach(resetEnv);
configure({ asyncUtilTimeout: 4000 });

const role = (o: Partial<Record<string, unknown>> & { name: string; displayName: string }) => ({
  id: `r-${o.name}`, description: '', hierarchyLevel: 1, permissions: [], color: 'bg-blue-500', isSystem: false, isActive: true, ...o,
});
const ROLES = [
  role({ name: 'SUPER_ADMIN', displayName: 'Super Admin', hierarchyLevel: 6, permissions: ['A', 'B', 'C'], isSystem: true }),
  role({ name: 'ADMIN', displayName: 'Administrator', hierarchyLevel: 5, permissions: ['A', 'B'], isSystem: true, description: 'Runs the site' }),
  role({ name: 'QA_LEAD', displayName: 'QA Lead', hierarchyLevel: 3, permissions: ['A'], description: 'Leads QA', color: 'bg-gradient-to-r from-red-500 to-pink-500' }),
  role({ name: 'TEMP', displayName: 'Temp Staff', hierarchyLevel: 1, isActive: false }),
];

function LocationProbe() {
  const loc = useLocation();
  return <p data-testid="loc">{loc.pathname}</p>;
}

function setup(opts: { user?: TestUser; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/roles', body: ROLES },
    { path: '/api/roles/active', body: ROLES.filter((r) => r.isActive) },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<><RoleAccessPage /><LocationProbe /></>, { route: '/config/roles', user: opts.user ?? SUPER_ADMIN, api });
  return api;
}

const rowOf = (displayName: string) => screen.getByText(displayName, { selector: 'span' }).closest('tr') as HTMLElement;
const dialogOf = (title: string | RegExp) => screen.getByRole('heading', { name: title }).closest('div.relative') as HTMLElement;
const inputs = (dlg: HTMLElement) => within(dlg).getAllByRole('textbox') as HTMLInputElement[];

describe('Role & Access — Roles tab', { timeout: 30000 }, () => {
  it('lists every role with hierarchy, permission count, type and status', async () => {
    const api = setup();
    expect(screen.getByText('Loading roles...')).toBeInTheDocument();
    await screen.findByText('QA Lead');
    const qa = rowOf('QA Lead');
    expect(qa).toHaveTextContent('QA_LEAD');
    expect(qa).toHaveTextContent('Leads QA');
    expect(qa).toHaveTextContent('Level 3');
    expect(qa).toHaveTextContent('Custom');
    expect(qa).toHaveTextContent('Active');
    expect(within(qa).getAllByRole('button')).toHaveLength(2); // edit + delete

    const admin = rowOf('Administrator');
    expect(admin).toHaveTextContent('System');
    expect(admin).toHaveTextContent('2'); // permission count
    // F-13: a system role offers Edit only — no Delete.
    expect(within(admin).getAllByRole('button')).toHaveLength(1);

    const temp = rowOf('Temp Staff');
    expect(temp).toHaveTextContent('Inactive');
    expect(temp).toHaveTextContent('-'); // blank description placeholder

    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create Role/ })).toBeInTheDocument();
    expect(screen.getByText('Role Hierarchy')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('a viewer without ROLE_MANAGE sees no Create button and no row actions', async () => {
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await screen.findByText('QA Lead');
    // Wait until the signed-in user has actually loaded before asserting absence.
    await waitFor(() => expect(localStorage.getItem('digilog_cached_user')).toContain('"role":"QA"'));
    await waitFor(() => expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull());
    expect(screen.queryByRole('button', { name: /Create Role/ })).toBeNull();
    expect(within(rowOf('QA Lead')).queryAllByRole('button')).toHaveLength(0);
  });

  it('ROLE_MANAGE alone (no SUPER_ADMIN) unlocks the management controls', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['ROLE_MANAGE'] } });
    await screen.findByText('QA Lead');
    expect(await screen.findByRole('button', { name: /Create Role/ })).toBeInTheDocument();
  });

  it('create: requires name + display name, normalises the name and POSTs the role', async () => {
    const api = setup({ extra: [{ method: 'POST', path: '/api/roles', status: 201, body: { ok: true } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(screen.getByRole('button', { name: /Create Role/ }));
    const dlg = dialogOf('Create New Role');
    // Submit empty -> local validation, nothing sent.
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Role' }));
    expect(within(dlg).getByText('Name and Display Name are required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/roles')).toHaveLength(0);

    fireEvent.change(within(dlg).getByPlaceholderText('e.g., QUALITY_ASSURANCE'), { target: { value: 'line lead' } });
    expect((within(dlg).getByPlaceholderText('e.g., QUALITY_ASSURANCE') as HTMLInputElement).value).toBe('LINE_LEAD');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Quality Assurance'), { target: { value: 'Line Lead' } });
    fireEvent.change(within(dlg).getByPlaceholderText("Brief description of this role's purpose"), { target: { value: 'Runs a line' } });
    fireEvent.change(within(dlg).getByRole('spinbutton'), { target: { value: '4' } });
    fireEvent.click(within(dlg).getByTitle('Emerald-Green'));
    expect(within(dlg).getByTitle('Emerald-Green').className).toContain('ring-2');
    expect(within(dlg).getByText('Higher level = more privileges (1-10)')).toBeInTheDocument();

    const getsBefore = api.calls('GET', '/api/roles').length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Role' }));
    // In flight: the submit button reports progress.
    expect(within(dlg).getByRole('button', { name: 'Creating...' })).toBeDisabled();
    await waitFor(() => expect(api.calls('POST', '/api/roles')).toHaveLength(1));
    expect(api.calls('POST', '/api/roles')[0].json).toEqual({
      name: 'LINE_LEAD', displayName: 'Line Lead', description: 'Runs a line', hierarchyLevel: 4,
      color: 'bg-gradient-to-r from-emerald-500 to-green-500', permissions: [],
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Create New Role' })).toBeNull());
    // The roles list is revalidated after a successful write.
    await waitFor(() => expect(api.calls('GET', '/api/roles').length).toBeGreaterThan(getsBefore));
  });

  it('create: a non-numeric hierarchy level falls back to 1', async () => {
    setup();
    await screen.findByText('QA Lead');
    fireEvent.click(screen.getByRole('button', { name: /Create Role/ }));
    const dlg = dialogOf('Create New Role');
    fireEvent.change(within(dlg).getByRole('spinbutton'), { target: { value: '' } });
    expect((within(dlg).getByRole('spinbutton') as HTMLInputElement).value).toBe('1');
  });

  it('create: a server refusal is shown inside the dialog and the dialog stays open', async () => {
    setup({ extra: [{ method: 'POST', path: '/api/roles', status: 409, body: { error: 'CONFLICT', message: 'Role LINE_LEAD already exists' } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(screen.getByRole('button', { name: /Create Role/ }));
    const dlg = dialogOf('Create New Role');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., QUALITY_ASSURANCE'), { target: { value: 'LINE_LEAD' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Quality Assurance'), { target: { value: 'Line Lead' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Role' })); });
    expect(await within(dlg).findByText('Role LINE_LEAD already exists')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create New Role' })).toBeInTheDocument();
    // Cancel closes; reopening starts from a clean form.
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create New Role' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Create Role/ }));
    const again = dialogOf('Create New Role');
    expect((within(again).getByPlaceholderText('e.g., QUALITY_ASSURANCE') as HTMLInputElement).value).toBe('');
    expect(within(again).queryByText('Role LINE_LEAD already exists')).toBeNull();
  });

  it('create with CREATE_ROLE signature on: password prompt first, POST carries it', async () => {
    const api = setup({ reauth: ['CREATE_ROLE'], extra: [{ method: 'POST', path: '/api/roles', status: 201, body: { ok: true } }] });
    await screen.findByText('QA Lead');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Create Role/ }));
    const dlg = dialogOf('Create New Role');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., QUALITY_ASSURANCE'), { target: { value: 'NEW' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Quality Assurance'), { target: { value: 'New' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Role' })); });
    expect(await screen.findByText(/Performing "Create Role" requires identity verification/)).toBeInTheDocument();
    expect(api.calls('POST', '/api/roles')).toHaveLength(0);
    await signReauth('s3cret');
    await waitFor(() => expect(api.calls('POST', '/api/roles')).toHaveLength(1));
    const post = api.calls('POST', '/api/roles')[0];
    expect(post.headers['x-reauth-password']).toBe('s3cret');
    expect(post.json).toMatchObject({ name: 'NEW', displayName: 'New', _currentPassword: 's3cret' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Create New Role' })).toBeNull());
  });

  it('edit: name locked, permissions and hierarchy NOT re-sent when unchanged', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: '/api/roles/QA_LEAD', body: { ok: true } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[0]);
    const dlg = dialogOf('Edit Role: QA Lead');
    const [name, display, desc] = inputs(dlg);
    expect(name.value).toBe('QA_LEAD');
    expect(name).toBeDisabled();
    expect(within(dlg).queryByText(/This is a system role/)).toBeNull();
    expect(within(dlg).queryByText('Higher level = more privileges (1-10)')).toBeNull();
    expect(within(dlg).getByTitle('Red-Pink').className).toContain('ring-2');
    fireEvent.change(display, { target: { value: 'QA Leader' } });
    fireEvent.change(desc, { target: { value: 'Leads quality' } });
    fireEvent.click(within(dlg).getByTitle('Slate'));
    // No hierarchy change -> no reason field, Save enabled.
    expect(within(dlg).queryByText(/Reason for this change/)).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(within(dlg).getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await waitFor(() => expect(api.calls('PUT', '/api/roles/QA_LEAD')).toHaveLength(1));
    expect(api.calls('PUT', '/api/roles/QA_LEAD')[0].json).toEqual({
      displayName: 'QA Leader', description: 'Leads quality', color: 'bg-gradient-to-r from-slate-400 to-slate-500',
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Edit Role/ })).toBeNull());
  });

  it('edit: changing the hierarchy level demands a reason, which is sent', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: '/api/roles/QA_LEAD', body: { ok: true } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[0]);
    const dlg = dialogOf('Edit Role: QA Lead');
    fireEvent.change(within(dlg).getByRole('spinbutton'), { target: { value: '4' } });
    const reason = within(dlg).getByPlaceholderText("Why is this role's hierarchy level changing?");
    const save = within(dlg).getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled();
    expect(within(dlg).getByText('5 more characters required')).toBeInTheDocument();
    fireEvent.change(reason, { target: { value: 'abc' } });
    expect(save).toBeDisabled();
    expect(within(dlg).getByText('2 more characters required')).toBeInTheDocument();
    fireEvent.change(reason, { target: { value: '  Promoted per SOP-12  ' } });
    expect(save).not.toBeDisabled();
    expect(within(dlg).getByText(/recorded on the audit trail/)).toBeInTheDocument();
    await act(async () => { fireEvent.click(save); });
    await waitFor(() => expect(api.calls('PUT', '/api/roles/QA_LEAD')).toHaveLength(1));
    expect(api.calls('PUT', '/api/roles/QA_LEAD')[0].json).toEqual({
      displayName: 'QA Lead', description: 'Leads QA', color: 'bg-gradient-to-r from-red-500 to-pink-500',
      hierarchyLevel: 4, reason: 'Promoted per SOP-12',
    });
  });

  it('edit: a system role warns and locks the hierarchy level; the role keeps the description fallback', async () => {
    setup();
    await screen.findByText('Administrator');
    fireEvent.click(within(rowOf('Administrator')).getAllByRole('button')[0]);
    const dlg = dialogOf('Edit Role: Administrator');
    expect(within(dlg).getByText(/This is a system role/)).toBeInTheDocument();
    expect(within(dlg).getByRole('spinbutton')).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: /Edit Role/ })).toBeNull();
    // A role with no description opens with an empty description box.
    fireEvent.click(within(rowOf('Temp Staff')).getAllByRole('button')[0]);
    expect(inputs(dialogOf('Edit Role: Temp Staff'))[2].value).toBe('');
  });

  it('edit: a refusal is shown in the dialog', async () => {
    setup({ extra: [{ method: 'PUT', path: '/api/roles/QA_LEAD', status: 400, body: { error: 'BAD', message: 'Display name taken' } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[0]);
    const dlg = dialogOf('Edit Role: QA Lead');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    expect(await within(dlg).findByText('Display name taken')).toBeInTheDocument();
  });

  it('edit: server-demanded signature retries the PUT with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', '/api/roles/QA_LEAD'), { method: 'PUT', path: '/api/roles/QA_LEAD', body: { ok: true } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[0]);
    const dlg = dialogOf('Edit Role: QA Lead');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    await signReauth('pw-edit');
    await waitFor(() => expect(api.calls('PUT', '/api/roles/QA_LEAD')).toHaveLength(2));
    expect(api.calls('PUT', '/api/roles/QA_LEAD')[1].headers['x-reauth-password']).toBe('pw-edit');
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Edit Role/ })).toBeNull());
  });

  it('delete: confirms, DELETEs the role and closes', async () => {
    const api = setup({ extra: [{ method: 'DELETE', path: '/api/roles/QA_LEAD', status: 204 }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[1]);
    const dlg = dialogOf('Delete Role');
    expect(dlg).toHaveTextContent('Are you sure you want to permanently delete the role QA Lead?');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Role' }));
    expect(within(dlg).getByRole('button', { name: 'Deleting...' })).toBeDisabled();
    await waitFor(() => expect(api.calls('DELETE', '/api/roles/QA_LEAD')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete Role' })).toBeNull());
  });

  it('delete: a refusal (role still assigned) is shown and the dialog can be cancelled', async () => {
    const api = setup({ extra: [{ method: 'DELETE', path: '/api/roles/QA_LEAD', status: 409, body: { error: 'ROLE_IN_USE', message: 'Role is assigned to 3 users' } }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[1]);
    const dlg = dialogOf('Delete Role');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Role' })); });
    expect(await within(dlg).findByText('Role is assigned to 3 users')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/roles/QA_LEAD')).toHaveLength(1);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Delete Role' })).toBeNull();
    // Reopening clears the previous error.
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[1]);
    expect(within(dialogOf('Delete Role')).queryByText('Role is assigned to 3 users')).toBeNull();
  });

  it('delete: server-demanded signature retries with the password in header and body', async () => {
    const api = setup({ extra: [reauthRequired('DELETE', '/api/roles/QA_LEAD'), { method: 'DELETE', path: '/api/roles/QA_LEAD', status: 204 }] });
    await screen.findByText('QA Lead');
    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[1]);
    await act(async () => { fireEvent.click(within(dialogOf('Delete Role')).getByRole('button', { name: 'Delete Role' })); });
    expect(await screen.findByText(/Performing "Delete Role" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-del');
    await waitFor(() => expect(api.calls('DELETE', '/api/roles/QA_LEAD')).toHaveLength(2));
    const retry = api.calls('DELETE', '/api/roles/QA_LEAD')[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-del');
    expect(retry.json).toEqual({ _currentPassword: 'pw-del' });
  });

  it('a refusal without a message still tells the operator what failed (create / edit / delete)', async () => {
    const blank = { error: 'INTERNAL', message: '' };
    setup({
      extra: [
        { method: 'POST', path: '/api/roles', status: 400, body: blank },
        { method: 'PUT', path: '/api/roles/QA_LEAD', status: 400, body: blank },
        { method: 'DELETE', path: '/api/roles/QA_LEAD', status: 400, body: blank },
      ],
    });
    await screen.findByText('QA Lead');
    fireEvent.click(screen.getByRole('button', { name: /Create Role/ }));
    let dlg = dialogOf('Create New Role');
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., QUALITY_ASSURANCE'), { target: { value: 'X' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Quality Assurance'), { target: { value: 'X' } });
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Create Role' })); });
    expect(await within(dlg).findByText('Failed to create role')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[0]);
    dlg = dialogOf('Edit Role: QA Lead');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' })); });
    expect(await within(dlg).findByText('Failed to update role')).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(within(rowOf('QA Lead')).getAllByRole('button')[1]);
    dlg = dialogOf('Delete Role');
    await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Role' })); });
    expect(await within(dlg).findByText('Failed to delete role')).toBeInTheDocument();
  });

  it('Back goes to /config for a SUPER_ADMIN', async () => {
    setup();
    await screen.findByText('QA Lead');
    expect(screen.getByTestId('loc')).toHaveTextContent('/config/roles');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/config$/);
  });

  it('Back goes to the dashboard for a ROLE_MANAGE holder without CONFIG_READ and no history', async () => {
    window.history.replaceState({ idx: 0 }, '');
    setup({ user: { role: 'ADMIN', permissions: ['ROLE_MANAGE'] } });
    await screen.findByText('QA Lead');
    await screen.findByRole('button', { name: /Create Role/ }); // user loaded
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('loc')).toHaveTextContent(/^\/$/);
  });
});
