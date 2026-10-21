import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { AccessMatrixPage } from '../access-matrix';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

// Multi-request flows: the 5s / 1s defaults are too tight when the suite runs
// under coverage alongside other workers.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });

afterEach(resetEnv);

const PATH = '/api/config/access-matrix';
const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin' },
  { name: 'ADMIN', displayName: 'Administrator' },
  { name: 'QA', displayName: 'Quality' },
];
const MANIFEST = [
  { moduleKey: 'user-id', moduleName: 'User ID Format', description: 'ID rules', category: 'Security' },
  { moduleKey: 'backup', moduleName: 'Backup', description: 'DB backup', category: 'Security' },
  { moduleKey: 'pagination', moduleName: 'Pagination', description: 'Page sizes', category: '' },
  // Never shown: the matrix itself, a Role-Assignments-only key, and datetime.
  { moduleKey: 'access-matrix', moduleName: 'Access Matrix', description: '', category: 'Security' },
  { moduleKey: 'pm-schedule-approval', moduleName: 'PM Approval', description: '', category: 'Workflow' },
  { moduleKey: 'datetime', moduleName: 'Date/Time', description: '', category: 'Display' },
];
// `datetime` still holds a legacy grant: hidden, but a save must keep it.
const MATRIX = { 'user-id': ['ADMIN'], datetime: ['ADMIN'] };

function setup(opts: { extra?: MockRoute[]; reauth?: string[]; roles?: unknown; matrix?: unknown } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.matrix ?? MATRIX },
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    { path: '/api/config/registry/manifest', body: MANIFEST },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<AccessMatrixPage />, { user: SUPER_ADMIN, api });
  return api;
}

/** The checkbox for (module row, role column index among non-SA roles). */
function cell(moduleName: string, roleIdx: number) {
  const row = screen.getByText(moduleName).closest('tr') as HTMLElement;
  return within(row).getAllByRole('checkbox')[roleIdx] as HTMLInputElement;
}
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
const resetBtn = () => screen.getByRole('button', { name: 'Reset' });

describe('Configuration Access matrix', () => {
  it('renders grantable modules by category; SUPER_ADMIN column and hidden modules are left out', async () => {
    const api = setup();
    await screen.findByText('User ID Format');
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.queryByText('Super Admin')).toBeNull();
    expect(screen.queryByText('Access Matrix')).toBeNull();
    expect(screen.queryByText('PM Approval')).toBeNull();
    expect(screen.queryByText('Date/Time')).toBeNull();
    // Category headers; a blank category falls back to "other".
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
    // Sorted by name inside a category: Backup before User ID Format.
    const names = screen.getAllByText(/^(Backup|User ID Format)$/).map((n) => n.textContent);
    expect(names).toEqual(['Backup', 'User ID Format']);
    await waitFor(() => expect(cell('User ID Format', 0).checked).toBe(true));
    expect(cell('User ID Format', 1).checked).toBe(false);
    expect(saveBtn()).toBeDisabled();
    expect(resetBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('single toggles, Reset, row "all" and column "toggle all" all edit the draft', async () => {
    setup();
    await waitFor(() => expect(cell('User ID Format', 0).checked).toBe(true));
    fireEvent.click(cell('Backup', 1));
    expect(cell('Backup', 1).checked).toBe(true);
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(resetBtn());
    expect(cell('Backup', 1).checked).toBe(false);
    expect(saveBtn()).toBeDisabled();

    // Row "all": grants every role, then a second click clears the row.
    const backupRow = screen.getByText('Backup').closest('tr') as HTMLElement;
    fireEvent.click(within(backupRow).getByRole('button', { name: 'all' }));
    expect(cell('Backup', 0).checked).toBe(true);
    expect(cell('Backup', 1).checked).toBe(true);
    fireEvent.click(within(backupRow).getByRole('button', { name: 'all' }));
    expect(cell('Backup', 0).checked).toBe(false);
    expect(cell('Backup', 1).checked).toBe(false);

    // Untoggling the one granted cell (current includes role -> removed).
    fireEvent.click(cell('User ID Format', 0));
    expect(cell('User ID Format', 0).checked).toBe(false);

    // Column "toggle all" for Quality (2nd role column): on everywhere, then off.
    const toggles = screen.getAllByRole('button', { name: 'toggle all' });
    fireEvent.click(toggles[1]);
    expect(['Backup', 'User ID Format', 'Pagination'].every((m) => cell(m, 1).checked)).toBe(true);
    fireEvent.click(toggles[1]);
    expect(['Backup', 'User ID Format', 'Pagination'].some((m) => cell(m, 1).checked)).toBe(false);
  });

  it('Save PUTs the whole draft - including the hidden legacy datetime grant - and confirms', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await waitFor(() => expect(cell('User ID Format', 0).checked).toBe(true));
    fireEvent.click(cell('Pagination', 1));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ 'user-id': ['ADMIN'], datetime: ['ADMIN'], pagination: ['QA'] });
    expect(await ackMessage('Saved')).toContain('Configuration access matrix updated.');
    // The cache now holds the saved draft -> nothing dirty.
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await waitFor(() => expect(cell('User ID Format', 0).checked).toBe(true));
    fireEvent.click(cell('Backup', 0));
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('m-pw');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2));
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('m-pw');
    expect(retry.json).toMatchObject({ backup: ['ADMIN'], _currentPassword: 'm-pw' });
    await ackMessage('Saved');
  });

  it('cancelling the signature sends nothing and frees Save', async () => {
    const api = setup({ reauth: ['UPDATE_ROLE_CONFIG'] });
    await waitFor(() => expect(cell('User ID Format', 0).checked).toBe(true));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(cell('Backup', 0));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Save Configuration Access|Update Role Config/i, { selector: 'p' })).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'));
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  });

  it('a refused save shows the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'Insufficient permissions' } }] });
    await waitFor(() => expect(cell('User ID Format', 0).checked).toBe(true));
    fireEvent.click(cell('Backup', 0));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('Insufficient permissions');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('with no assignable roles it says so instead of rendering an empty grid', async () => {
    setup({ roles: [{ name: 'SUPER_ADMIN', displayName: 'Super Admin' }] });
    expect(await screen.findByText(/No assignable roles found/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
