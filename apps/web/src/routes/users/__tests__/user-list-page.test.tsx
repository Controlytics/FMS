import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from './support/page-findings';
import { UserListPage } from '../list';

/**
 * User Management list. Real SWR -> apiClient -> fetch path, real useAuth /
 * useCan / useReauth; only fetch (and the clipboard) are stubbed.
 */

const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin', color: 'bg-purple-600' },
  { name: 'ADMIN', displayName: 'Administrator', color: 'bg-indigo-600' },
  { name: 'OPERATOR', displayName: 'Operator', color: 'bg-blue-600' },
  { name: 'QA', displayName: 'Quality Assurance', color: 'bg-emerald-600' },
  { name: 'MANAGER', displayName: 'Manager', color: 'bg-amber-600' },
];

const U = {
  sa: { id: 'u-sa', username: 'root', fullName: 'Root Admin', email: 'root@x.io', role: 'SUPER_ADMIN', status: 'ENABLED', lastLogin: null },
  jane: { id: 'u-1', username: 'jdoe', fullName: 'Jane Doe', email: 'jane@x.io', role: 'OPERATOR', status: 'ENABLED', lastLogin: '2026-10-15T10:30:00.000Z' },
  ravi: { id: 'u-2', username: 'rkumar', fullName: 'Ravi Kumar', email: 'ravi@x.io', role: 'QA', status: 'DISABLED', lastLogin: null },
  lock: { id: 'u-3', username: 'locked1', fullName: 'Lena Locke', email: 'lena@x.io', role: 'MANAGER', status: 'LOCKED', lastLogin: null },
  self: { id: 'u-test', username: 'tester', fullName: 'Test User', email: 't@x.io', role: 'ADMIN', status: 'ENABLED', lastLogin: null },
  odd: { id: 'u-9', username: 'odd', fullName: 'Odd Role', email: 'odd@x.io', role: 'SHIFT_OFFICER', status: 'PENDING', lastLogin: null },
};
const ALL = [U.sa, U.jane, U.ravi, U.lock, U.self, U.odd];

const SA: TestUser = { id: 'u-test', role: 'SUPER_ADMIN', permissions: [] };

function routes(opts: { users?: unknown[]; total?: number; reauth?: string[]; pending?: number; extra?: MockRoute[] } = {}): MockRoute[] {
  const users = opts.users ?? ALL;
  return [
    ...(opts.extra ?? []),
    ...commonConfigRoutes(),
    reauthActions(opts.reauth ?? []),
    { path: '/api/users/reset-requests/pending', body: { count: opts.pending ?? 0 } },
    { path: '/api/users/stats', body: { total: 42, enabled: 30, disabled: 5, locked: 4, expired: 3 } },
    { path: '/api/config/password-policy/current', body: { minLength: 12 } },
    { path: '/api/roles/active', body: ROLES },
    { path: '/api/config/field-ids/current', body: [{ fieldId: 'FLD_USER_002', displayName: 'Employee Name' }] },
    { path: '/api/users', body: { data: users, total: opts.total ?? users.length } },
  ];
}

const lastUsersQuery = (api: ReturnType<typeof mockApi>) => {
  const c = api.calls('GET', '/api/users');
  return c[c.length - 1].query;
};

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

describe('User list — rendering', () => {
  it('shows users, stats, role display names, labels and the pending-reset badge (SUPER_ADMIN)', async () => {
    const api = mockApi(routes({ pending: 3 }));
    renderPage(<UserListPage />, { user: SA, api });

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('@jdoe')).toBeInTheDocument();
    // initials avatar
    expect(within(rowOf('Jane Doe')).getByText('JD')).toBeInTheDocument();
    // role displayName from /api/roles/active; unknown role falls back to its code with _ -> space
    expect(await within(rowOf('Ravi Kumar')).findByText('Quality Assurance')).toBeInTheDocument();
    expect(within(rowOf('Odd Role')).getByText('SHIFT OFFICER')).toBeInTheDocument();
    // last login: never vs a formatted date
    expect(within(rowOf('Ravi Kumar')).getByText('Never')).toBeInTheDocument();
    expect(within(rowOf('Jane Doe')).queryByText('Never')).toBeNull();
    // stats bar
    expect(await screen.findByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    // configured field label reaches the column header
    expect(await screen.findByText('Employee Name')).toBeInTheDocument();
    // pending reset requests badge
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Password Reset Requests/ })).toHaveAttribute('href', '/users/reset-requests');
    expect(screen.getByRole('link', { name: /Create User/ })).toHaveAttribute('href', '/users/create');
    // SUPER_ADMIN sees the SUPER_ADMIN role option in the filter
    expect(within(screen.getByDisplayValue('All Roles') as HTMLElement).getByRole('option', { name: 'Super Admin' })).toBeInTheDocument();

    // (the first page's size is covered by the D6 case below)
    expect(lastUsersQuery(api).get('page')).toBe('1');
    expect(api.unmatched).toEqual([]);
  });

  it('D6: a cold load settles on the configured default page size, not the pre-load fallback', async () => {
    const api = mockApi(routes({ total: 60, extra: [{ path: '/api/config/pagination/current', body: { limit: 25, count: 3, options: [25, 50, 100] } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    await waitFor(() => expect(lastUsersQuery(api).get('limit')).toBe('25'));
    expect(within(screen.getByLabelText(/Rows/)).getAllByRole('option').map((o) => o.textContent)).toEqual(['25', '50', '100']);
  });

  it('shows "No users found" for an empty page and no pagination', async () => {
    const api = mockApi(routes({ users: [], total: 0 }));
    renderPage(<UserListPage />, { user: SA, api });
    expect(await screen.findByText('No users found')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });
});

describe('User list — permission gating (useCan)', () => {
  it('SUPER_ADMIN: row actions per status, Delete everywhere except own row, checkboxes except self + SUPER_ADMIN', async () => {
    const api = mockApi(routes());
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');

    expect(within(rowOf('Jane Doe')).getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
    expect(within(rowOf('Jane Doe')).getByRole('link', { name: 'Edit' })).toHaveAttribute('href', '/users/u-1');
    expect(within(rowOf('Jane Doe')).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(rowOf('Test User')).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(rowOf('Jane Doe')).getByRole('checkbox')).toBeInTheDocument();
    expect(within(rowOf('Test User')).queryByRole('checkbox')).toBeNull();
    expect(within(rowOf('Root Admin')).queryByRole('checkbox')).toBeNull();
  });

  it('a role holding only USER_UPDATE gets Edit and nothing else; no Create, no reset link, no SUPER_ADMIN filter', async () => {
    const api = mockApi(routes());
    renderPage(<UserListPage />, { user: { role: 'ADMIN', permissions: ['USER_READ', 'USER_UPDATE'] }, api });
    await screen.findByText('Jane Doe');
    await waitFor(() => expect(within(rowOf('Jane Doe')).getByRole('link', { name: 'Edit' })).toBeInTheDocument());

    expect(within(rowOf('Jane Doe')).queryByRole('button', { name: 'Disable' })).toBeNull();
    expect(within(rowOf('Ravi Kumar')).queryByRole('button', { name: 'Enable' })).toBeNull();
    expect(within(rowOf('Lena Locke')).queryByRole('button', { name: 'Unlock' })).toBeNull();
    // users.delete has an empty gate -> SUPER_ADMIN only
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: /Create User/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Password Reset Requests/ })).toBeNull();
    await waitFor(() => expect(within(screen.getByDisplayValue('All Roles') as HTMLElement).getByRole('option', { name: 'Operator' })).toBeInTheDocument());
    expect(within(screen.getByDisplayValue('All Roles') as HTMLElement).queryByRole('option', { name: 'Super Admin' })).toBeNull();
  });

  it('USER_ENABLE_DISABLE + USER_UNLOCK + USER_CREATE + USER_RESET_PASSWORD light up exactly their controls', async () => {
    const api = mockApi(routes({ pending: 0 }));
    renderPage(<UserListPage />, {
      user: { role: 'MANAGER', permissions: ['USER_READ', 'USER_ENABLE_DISABLE', 'USER_UNLOCK', 'USER_CREATE', 'USER_RESET_PASSWORD'] }, api,
    });
    await screen.findByText('Jane Doe');
    expect(await within(rowOf('Jane Doe')).findByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
    expect(screen.queryAllByRole('link', { name: 'Edit' })).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Create User/ })).toBeInTheDocument();
    const reset = screen.getByRole('link', { name: /Password Reset Requests/ });
    // pending count 0 -> no badge inside the button
    expect(within(reset).queryByText('0')).toBeNull();
  });
});

describe('User list — filters and paging', () => {
  it('search is debounced and sent as ?search=, role/status are sent, chips and Clear All reset them', async () => {
    const api = mockApi(routes());
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');

    fireEvent.change(screen.getByPlaceholderText('Search by name, User ID, or email...'), { target: { value: 'jan' } });
    expect(await screen.findByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('"jan"')).toBeInTheDocument();
    await waitFor(() => expect(lastUsersQuery(api).get('search')).toBe('jan'));

    fireEvent.change(screen.getByDisplayValue('All Roles'), { target: { value: 'QA' } });
    await waitFor(() => expect(lastUsersQuery(api).get('role')).toBe('QA'));
    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'LOCKED' } });
    await waitFor(() => expect(lastUsersQuery(api).get('status')).toBe('LOCKED'));
    expect(screen.getByText('3 active')).toBeInTheDocument();
    // role chip shows the display name
    const chips = screen.getByText('Active filters:').parentElement as HTMLElement;
    expect(within(chips).getByText('Quality Assurance')).toBeInTheDocument();

    // remove each chip with its x button (search, role, status order)
    const chipButtons = () => within(chips).getAllByRole('button');
    fireEvent.click(chipButtons()[0]);
    await waitFor(() => expect(lastUsersQuery(api).get('search')).toBeNull());
    fireEvent.click(within(screen.getByText('Active filters:').parentElement as HTMLElement).getAllByRole('button')[0]);
    await waitFor(() => expect(lastUsersQuery(api).get('role')).toBeNull());
    fireEvent.click(within(screen.getByText('Active filters:').parentElement as HTMLElement).getAllByRole('button')[0]);
    await waitFor(() => expect(lastUsersQuery(api).get('status')).toBeNull());
    expect(screen.queryByText('Active filters:')).toBeNull();

    // Clear All wipes everything at once
    fireEvent.change(screen.getByDisplayValue('All Roles'), { target: { value: 'CUSTOM_X' } });
    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'ENABLED' } });
    // a role code not in the roles list shows as code with _ -> space
    expect(within(screen.getByText('Active filters:').parentElement as HTMLElement).queryByText('ENABLED')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear All/ }));
    await waitFor(() => {
      const q = lastUsersQuery(api);
      expect(q.get('role')).toBeNull();
      expect(q.get('status')).toBeNull();
    });
  });

  it('pages with Next and changes page size via the Rows selector', async () => {
    const api = mockApi(routes({ total: 35 }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastUsersQuery(api).get('page')).toBe('2'));
    fireEvent.change(screen.getByLabelText(/Rows/), { target: { value: '50' } });
    await waitFor(() => {
      expect(lastUsersQuery(api).get('limit')).toBe('50');
      expect(lastUsersQuery(api).get('page')).toBe('1');
    });
  });
});

describe('User list — single-user actions', () => {
  it('Disable: confirm dialog warns about sessions, then POSTs /disable and toasts', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-1/disable', body: { ok: true } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    fireEvent.click(within(rowOf('Jane Doe')).getByRole('button', { name: 'Disable' }));
    expect(await screen.findByText(/terminate all active sessions/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.calls('POST', '/api/users/u-1/disable')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/u-1/disable')[0].json).toEqual({});
    expect(await screen.findByText('User "jdoe" has been disabled successfully.')).toBeInTheDocument();
  });

  it('Enable: POSTs /enable; Cancel on the confirm dialog sends nothing', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-2/enable', body: { ok: true } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Ravi Kumar');

    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('Enable User')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Enable User')).toBeNull());
    expect(api.calls('POST', '/api/users/u-2/enable')).toHaveLength(0);

    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Enable' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('User "rkumar" has been enabled successfully.')).toBeInTheDocument();
  });

  it('Delete: DELETE /api/users/:id after the permanent-delete warning; a refusal surfaces its message', async () => {
    const api = mockApi(routes({
      extra: [
        { method: 'DELETE', path: '/api/users/u-1', status: 204 },
        { method: 'DELETE', path: '/api/users/u-2', status: 409, body: { error: 'USER_HAS_RECORDS', message: 'User owns signed records' } },
      ],
    }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');

    fireEvent.click(within(rowOf('Jane Doe')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Warning: This permanently deletes the account!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete User' }));
    await waitFor(() => expect(api.calls('DELETE', '/api/users/u-1')).toHaveLength(1));
    expect(await screen.findByText('User "jdoe" has been deleted successfully.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(screen.queryByText(/has been deleted/)).toBeNull());

    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete User' }));
    expect(await screen.findByText('User owns signed records')).toBeInTheDocument();
    expect(screen.getByText('Action failed')).toBeInTheDocument();
  });

  it('DELETE_USER under re-auth: password prompt, then DELETE carries the password in header and body', async () => {
    const api = mockApi(routes({ reauth: ['DELETE_USER'], extra: [{ method: 'DELETE', path: '/api/users/u-1', status: 204 }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));

    fireEvent.click(within(rowOf('Jane Doe')).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete User' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/users/u-1')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Pw@12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('DELETE', '/api/users/u-1')).toHaveLength(1));
    const del = api.calls('DELETE', '/api/users/u-1')[0];
    expect(del.headers['x-reauth-password']).toBe('Pw@12345');
    expect(del.json).toEqual({ _currentPassword: 'Pw@12345' });
    expect(await screen.findByText('User "jdoe" has been deleted successfully.')).toBeInTheDocument();
  });

  it('DISABLE_USER: a wrong password keeps the prompt open with an error; the right one POSTs with the password', async () => {
    let n = 0;
    const api = mockApi(routes({
      reauth: ['DISABLE_USER'],
      extra: [{
        method: 'POST', path: '/api/users/u-1/disable',
        status: 200,
        body: () => { n += 1; return { ok: true }; },
      }],
    }));
    // first attempt: REAUTH_FAILED
    api.add({ method: 'POST', path: '/api/users/u-1/disable', status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'bad' } });
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));

    fireEvent.click(within(rowOf('Jane Doe')).getByRole('button', { name: 'Disable' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'right' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(n).toBe(1));
    const calls = api.calls('POST', '/api/users/u-1/disable');
    expect(calls[calls.length - 1].json).toEqual({ _currentPassword: 'right' });
    expect(await screen.findByText('User "jdoe" has been disabled successfully.')).toBeInTheDocument();
  });

  it('a server REAUTH_REQUIRED (feed said no password) opens the prompt retroactively', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-2/enable', body: { ok: true } }] }));
    api.add({ method: 'POST', path: '/api/users/u-2/enable', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'sign' } });
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Ravi Kumar');
    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Enable' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/u-2/enable')).toHaveLength(2));
    expect(api.calls('POST', '/api/users/u-2/enable')[1].headers['x-reauth-password']).toBe('pw');
    expect(await screen.findByText('User "rkumar" has been enabled successfully.')).toBeInTheDocument();
  });

  it('cancelling the password prompt sends nothing', async () => {
    const api = mockApi(routes({ reauth: ['ENABLE_USER'] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Ravi Kumar');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('button', { name: 'Enable' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    const title = await screen.findByText('Confirm Your Identity');
    const dlg = title.closest('div[class*="fixed"]') ?? document.body;
    fireEvent.click(within(dlg as HTMLElement).getAllByRole('button', { name: 'Cancel' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('POST', '/api/users/u-2/enable')).toHaveLength(0);
  });
});

describe('User list — bulk delete', () => {
  it('select-all picks only selectable users, toolbar counts, Clear Selection empties it', async () => {
    const api = mockApi(routes());
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    const header = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    fireEvent.click(header);
    // Jane, Ravi, Lena, Odd = 4 (self + SUPER_ADMIN excluded)
    expect(await screen.findByText('4 users selected')).toBeInTheDocument();
    expect(header.checked).toBe(true);
    fireEvent.click(header);
    await waitFor(() => expect(screen.queryByText(/users? selected/)).toBeNull());

    fireEvent.click(within(rowOf('Jane Doe')).getByRole('checkbox'));
    expect(await screen.findByText('1 user selected')).toBeInTheDocument();
    // partially selected -> header indeterminate
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(within(rowOf('Jane Doe')).getByRole('checkbox'));
    await waitFor(() => expect(screen.queryByText('1 user selected')).toBeNull());

    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Selection' }));
    await waitFor(() => expect(screen.queryByText(/user selected/)).toBeNull());
  });

  it('Delete Selected lists the users, POSTs bulk-delete with their ids, and clears the selection', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/bulk-delete', body: { deleted: 2 } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    fireEvent.click(within(rowOf('Jane Doe')).getByRole('checkbox'));
    fireEvent.click(within(rowOf('Ravi Kumar')).getByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: /Delete Selected/ }));

    expect(await screen.findByRole('button', { name: 'Delete 2 Users' })).toBeInTheDocument();
    expect(screen.getAllByText('Delete 2 Users')).toHaveLength(2); // title + confirm button
    expect(screen.getByText('Warning: This permanently deletes these accounts!')).toBeInTheDocument();
    expect(screen.getAllByText('@rkumar').length).toBeGreaterThan(1);
    // Cancel closes without a request
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete 2 Users' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /Delete Selected/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 2 Users' }));

    await waitFor(() => expect(api.calls('POST', '/api/users/bulk-delete')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/bulk-delete')[0].json).toEqual({ userIds: ['u-1', 'u-2'] });
    expect(await screen.findByText('2 user(s) deleted successfully.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/users? selected/)).toBeNull());
  });

  it('bulk delete under re-auth sends the password; a server failure shows "Bulk delete failed"', async () => {
    const api = mockApi(routes({
      reauth: ['BULK_DELETE_USERS'],
      extra: [{ method: 'POST', path: '/api/users/bulk-delete', status: 500, body: { error: 'INTERNAL', message: 'DB down' } }],
    }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(rowOf('Lena Locke')).getByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: /Delete Selected/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 1 User' }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'pw1' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/bulk-delete')).toHaveLength(1));
    const sent = api.calls('POST', '/api/users/bulk-delete')[0];
    expect(sent.json).toEqual({ userIds: ['u-3'], _currentPassword: 'pw1' });
    expect(sent.headers['x-reauth-password']).toBe('pw1');
    expect(await screen.findByText('Bulk delete failed')).toBeInTheDocument();
    expect(screen.getByText('DB down')).toBeInTheDocument();
  });
});

describe('User list — unlock with a temporary password', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });

  it('generates a policy-length password, shows/hides it, copies it, regenerates, then POSTs /unlock with it', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-3/unlock', body: { ok: true } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Lena Locke');
    await waitFor(() => expect(api.calls('GET', '/api/config/password-policy/current').length).toBeGreaterThan(0));
    // let the policy response land so the generator uses minLength 12
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByText(/with a temporary password/)).toBeInTheDocument();
    expect(screen.getAllByText('@locked1')).toHaveLength(2); // table row + dialog
    const pwInput = document.querySelector('input[readonly]') as HTMLInputElement;
    expect(pwInput.type).toBe('password');
    const first = pwInput.value;
    expect(first.length).toBeGreaterThanOrEqual(12);

    // show / hide toggle is the svg button beside the input
    const eye = pwInput.parentElement!.querySelector('button') as HTMLButtonElement;
    fireEvent.click(eye);
    expect(pwInput.type).toBe('text');
    fireEvent.click(eye);
    expect(pwInput.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(first);

    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
    await waitFor(() => expect(pwInput.value).not.toBe(first));
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument();
    const second = pwInput.value;

    fireEvent.click(screen.getByRole('button', { name: 'Unlock Account' }));
    await waitFor(() => expect(api.calls('POST', '/api/users/u-3/unlock')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/u-3/unlock')[0].json).toEqual({ newPassword: second });
    expect(await screen.findByText('User "locked1" can now sign in with the temporary password.')).toBeInTheDocument();
  });

  it('falls back to execCommand("copy") when the clipboard API refuses, and the Copied state resets', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const api = mockApi(routes());
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Lena Locke');
    fireEvent.click(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' }));
    fireEvent.click(await screen.findByRole('button', { name: /Copy/ }));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
    expect(exec).toHaveBeenCalledWith('copy');
    // CLIPBOARD_COPY_RESET_MS = 2s
    await waitFor(() => expect(screen.getByRole('button', { name: /^Copy$/ })).toBeInTheDocument(), { timeout: 3000 });
    // Cancel closes the unlock dialog without a request
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Unlock Account', { selector: 'h2, h3, div' })).toBeNull());
    expect(api.calls('POST', '/api/users/u-3/unlock')).toHaveLength(0);
  });

  it('a failed unlock is reported, not shown as success', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/u-3/unlock', status: 403, body: { error: 'FORBIDDEN', message: 'Not allowed to unlock' } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Lena Locke');
    fireEvent.click(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock Account' }));
    expect(await screen.findByText('Unlock failed')).toBeInTheDocument();
    expect(screen.getByText('Not allowed to unlock')).toBeInTheDocument();
    expect(screen.queryByText(/can now sign in/)).toBeNull();
  });

  it('UNLOCK_USER under re-auth sends newPassword plus the signature', async () => {
    const api = mockApi(routes({ reauth: ['UNLOCK_USER'], extra: [{ method: 'POST', path: '/api/users/u-3/unlock', body: { ok: true } }] }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Lena Locke');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' }));
    await screen.findByText(/with a temporary password/);
    const pw = (document.querySelector('input[readonly]') as HTMLInputElement).value;
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Account' }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'adminpw' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/u-3/unlock')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/u-3/unlock')[0].json).toEqual({ newPassword: pw, _currentPassword: 'adminpw' });
  });
});

describe('User list — accessibility + console', () => {
  // Known unnamed controls, reported as findings (not asserted as correct):
  // header/row checkboxes (user-table.tsx:80,:103), Role/Status selects whose
  // <label>s have no htmlFor (user-filters.tsx:310,:331), svg-only filter-chip
  // remove buttons (user-filters.tsx:375,:388,:401), and in the unlock dialog
  // the svg-only show/hide button + the unassociated read-only password input
  // (user-unlock-dialog.tsx:240,:246). Anything else unnamed fails the test.
  const KNOWN = [
    (d: string) => d.startsWith('input[type=checkbox]'),
    // the two filter <Select>s (ui/select base classes); the Rows selector is label-wrapped and named
    (d: string) => d.startsWith('select class="flex w-full rounded-lg'),
    (d: string) => d.startsWith('button') && /hover:text-(blue|brand|emerald)-900/.test(d),
    (d: string) => d.startsWith('button') && d.includes('absolute right-3 top-1/2'),
    (d: string) => /^input\[type=(password|text)\]/.test(d) && d.includes('w-full px-4 py-3 bg-slate-50'),
  ];

  it('flags only the known unnamed controls and logs nothing in normal use', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const api = mockApi(routes({ total: 35 }));
    renderPage(<UserListPage />, { user: SA, api });
    await screen.findByText('Jane Doe');
    fireEvent.change(screen.getByPlaceholderText('Search by name, User ID, or email...'), { target: { value: 'x' } });
    fireEvent.change(screen.getByDisplayValue('All Roles'), { target: { value: 'QA' } });
    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'LOCKED' } });
    await screen.findByText('"x"');
    fireEvent.click(within(rowOf('Lena Locke')).getByRole('button', { name: 'Unlock' }));
    await screen.findByText(/with a temporary password/);

    const unl = unlabeledControls();
    expect(unl.none.filter((d) => !KNOWN.some((k) => k(d)))).toEqual([]);
    // the search box is named only by its placeholder (finding)
    expect(unl.placeholderOnly.every((d) => d.includes('Search by name, User ID, or email...'))).toBe(true);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
