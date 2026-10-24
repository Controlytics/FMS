/**
 * OD-01 (operator decision 2026-10-22): record-destroying, record-rewriting and
 * rule-changing actions ALWAYS take the password, for every role, SUPER_ADMIN
 * included. The server enforces it (`enforceReauthAlways`); such an action is
 * never in `/my-actions`, so the page sends the call, the server answers 401
 * REAUTH_REQUIRED, and `useReauth` opens the prompt. (Only an action that uploads
 * a file — RESTORE_BACKUP — is asked up front; see backup-restore-uploads-once.)
 *
 * For each page: the prompt appears for SUPER_ADMIN and for another role, and
 * cancelling it sends nothing more (the one refused, password-less request is
 * all that ever reached the server) and shows no failure.
 */
import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockApi, type TestUser } from '@/test-utils/page-harness';
import { RoleAccessPage } from '@/routes/config/role-access';
import { AuditTrailPage } from '@/routes/audit';
import { UserListPage } from '@/routes/users/list';
import { commonRoutes, reauthRequired, resetEnv } from '@/routes/config/__tests__/config-test-helpers';
import { auditRoutes, DELETER, SA as AUDIT_SA } from '@/routes/audit/__tests__/audit-page-fixtures';
import { commonConfigRoutes, reauthActions } from '@/routes/users/__tests__/support/page-findings';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5000 });

let prompt: MockInstance<typeof window.prompt>;
beforeEach(() => { prompt = vi.spyOn(window, 'prompt').mockReturnValue(null); });
afterEach(() => { prompt.mockRestore(); resetEnv(); });

const SA: TestUser = { id: 'u-test', role: 'SUPER_ADMIN', permissions: [] };

/** The prompt is open; cancel it and let any (wrong) follow-up request land. */
async function cancelThePrompt() {
  await screen.findByText('Confirm Your Identity');
  const cancels = screen.getAllByRole('button', { name: 'Cancel' });
  await act(async () => { fireEvent.click(cancels[cancels.length - 1]); });
  await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
  await new Promise((r) => setTimeout(r, 30));
}
/** Only the refused call reached the server, and it carried no password. */
function onlyTheRefusedCall(api: MockApi, method: string, path: string) {
  const calls = api.calls(method, path);
  expect(calls).toHaveLength(1);
  expect(calls[0].headers['x-reauth-password']).toBeUndefined();
}

describe('Role & Access — delete role', () => {
  const ROLES = [
    { id: 'r-SA', name: 'SUPER_ADMIN', displayName: 'Super Admin', description: '', hierarchyLevel: 6, permissions: [], color: 'bg-blue-500', isSystem: true, isActive: true },
    { id: 'r-QL', name: 'QA_LEAD', displayName: 'QA Lead', description: '', hierarchyLevel: 3, permissions: [], color: 'bg-blue-500', isSystem: false, isActive: true },
  ];
  for (const user of [SA, { id: 'u-adm', role: 'ADMIN', permissions: ['ROLE_MANAGE'] }] as TestUser[]) {
    it(`${user.role}: the server's demand opens the prompt; cancel sends nothing more`, async () => {
      const api = mockApi([
        reauthRequired('DELETE', '/api/roles/QA_LEAD'),
        { path: '/api/roles', body: ROLES },
        { path: '/api/roles/active', body: ROLES },
        ...commonRoutes({ reauth: [] }), // DELETE_ROLE is never in /my-actions
      ]);
      renderPage(<RoleAccessPage />, { route: '/config/roles', user, api });
      const row = (await screen.findByText('QA Lead', { selector: 'span' })).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getAllByRole('button')[1]);
      const dlg = screen.getByRole('heading', { name: 'Delete Role' }).closest('div.relative') as HTMLElement;
      await act(async () => { fireEvent.click(within(dlg).getByRole('button', { name: 'Delete Role' })); });
      expect(await screen.findByText(/Performing "Delete Role" requires identity verification/)).toBeInTheDocument();
      await cancelThePrompt();
      onlyTheRefusedCall(api, 'DELETE', '/api/roles/QA_LEAD');
      expect(screen.queryByText(/Failed to delete role|REAUTH_REQUIRED|Re-authentication required/)).toBeNull();
    });
  }
});

describe('Role & Access — rule changes (role permissions, re-auth policy)', () => {
  const role = (name: string, displayName: string, hierarchyLevel: number) => ({
    id: `r-${name}`, name, displayName, hierarchyLevel, permissions: [], color: 'bg-blue-500', isSystem: true, isActive: true,
  });
  const ROLES = [role('SUPER_ADMIN', 'Super Admin', 6), role('ADMIN', 'Administrator', 5), role('QA', 'Quality', 3)];
  const MANAGER: TestUser = { id: 'u-mgr', role: 'MANAGER', permissions: ['ROLE_MANAGE', 'CONFIG_READ'] };
  const routes = (...extra: ReturnType<typeof reauthRequired>[]) => [
    ...extra,
    { path: '/api/roles', body: ROLES },
    { path: '/api/roles/active', body: ROLES },
    { path: '/api/config/roles/ADMIN', body: { permissions: { 'debug.view': true } } },
    { path: '/api/config/roles/QA', body: { permissions: {} } },
    { path: '/api/config/action-reauth', body: { CREATE_HELP_ARTICLE: ['ADMIN'] } },
    ...commonRoutes({ reauth: [] }), // UPDATE_ROLE_CONFIG / UPDATE_REAUTH_CONFIG are never in /my-actions
  ];
  const headerSave = () => screen.getByRole('button', { name: /Save Changes/ });

  for (const user of [SA, MANAGER]) {
    it(`${user.role}: saving a role's permissions — the prompt appears; cancel sends nothing more`, async () => {
      const api = mockApi(routes(reauthRequired('PUT', '/api/config/roles/ADMIN')));
      renderPage(<RoleAccessPage />, { route: '/config/roles', user, api });
      await screen.findByText('Quality', { selector: 'span' });
      fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
      await screen.findByRole('heading', { name: 'Debug Traces' });
      fireEvent.click(screen.getByText('Manage Debug Traces').closest('label')!.querySelector('input')!);
      fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'OD-01 prompt check' } });
      await act(async () => { fireEvent.click(headerSave()); });
      await cancelThePrompt();
      onlyTheRefusedCall(api, 'PUT', '/api/config/roles/ADMIN');
    });

    it(`${user.role}: saving the re-auth policy — the prompt appears; cancel sends nothing more`, async () => {
      const api = mockApi(routes(reauthRequired('PUT', '/api/config/action-reauth')));
      renderPage(<RoleAccessPage />, { route: '/config/roles', user, api });
      await screen.findByText('Quality', { selector: 'span' });
      fireEvent.click(screen.getByRole('button', { name: 'Re-auth' }));
      await screen.findByText('How it works');
      const row = screen.getByText('Create Help Article', { selector: 'span' }).closest('tr') as HTMLElement;
      fireEvent.click(within(row).getAllByRole('checkbox')[1]); // QA on
      await act(async () => { fireEvent.click(headerSave()); });
      await cancelThePrompt();
      onlyTheRefusedCall(api, 'PUT', '/api/config/action-reauth');
    });
  }
});

describe('Audit Trail — permanent delete', () => {
  for (const user of [AUDIT_SA, DELETER] as TestUser[]) {
    it(`${user.role}: the server's demand opens the prompt; cancel sends nothing more`, async () => {
      const api = mockApi(auditRoutes({ reauth: [], extra: [reauthRequired('DELETE', '/api/audit/a2')] }));
      renderPage(<AuditTrailPage />, { user, api });
      const row = (await screen.findByText('Failed login attempt for "intruder"')).closest('tr') as HTMLElement;
      // The reason is typed in the confirm dialog (it was window.prompt until 2026-10-24).
      fireEvent.click(within(row).getByTitle(/^Delete permanently/));
      fireEvent.change(screen.getByLabelText(/Reason for this change/), { target: { value: 'Test data from OQ run' } });
      fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
      await cancelThePrompt();
      onlyTheRefusedCall(api, 'DELETE', '/api/audit/a2');
      expect(screen.queryByText('Delete Failed')).toBeNull();
    });
  }
});

describe('Users — delete user', () => {
  it('SUPER_ADMIN: the server\'s demand opens the prompt; cancel sends nothing more', async () => {
    const jane = { id: 'u-1', username: 'jdoe', fullName: 'Jane Doe', email: 'jane@x.io', role: 'OPERATOR', status: 'ENABLED', lastLogin: null };
    const api = mockApi([
      reauthRequired('DELETE', '/api/users/u-1'),
      ...commonConfigRoutes(),
      reauthActions([]),
      { path: '/api/users/reset-requests/pending', body: { count: 0 } },
      { path: '/api/users/stats', body: { total: 1, enabled: 1, disabled: 0, locked: 0, expired: 0 } },
      { path: '/api/config/password-policy/current', body: { minLength: 12 } },
      { path: '/api/roles/active', body: [{ name: 'OPERATOR', displayName: 'Operator', color: 'bg-blue-600' }] },
      { path: '/api/config/field-ids/current', body: [] },
      { path: '/api/users', body: { data: [jane], total: 1 } },
    ]);
    renderPage(<UserListPage />, { user: SA, api });
    const row = (await screen.findByText('Jane Doe')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete User' }));
    await cancelThePrompt();
    onlyTheRefusedCall(api, 'DELETE', '/api/users/u-1');
    expect(screen.queryByText('Action failed')).toBeNull();
  });
});
