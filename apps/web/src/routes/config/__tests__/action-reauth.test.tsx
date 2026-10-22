import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { REAUTH_ACTIONS, ALWAYS_REAUTH_ACTIONS } from '@digilog/shared';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { ActionReauthPage } from '../action-reauth';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth } from './config-test-helpers';

afterEach(resetEnv);
// The matrix renders ~130 rows x N roles; give async queries headroom under load.
configure({ asyncUtilTimeout: 5000 });

const PATH = '/api/config/action-reauth';
const TOTAL = Object.keys(REAUTH_ACTIONS).length;
// Rows the policy controls; the OD-01 "Always required" rows are shown but never counted.
const SWITCHABLE = TOTAL - ALWAYS_REAUTH_ACTIONS.size;

const role = (name: string, displayName: string, hierarchyLevel: number, color = 'bg-blue-500') => ({
  id: `r-${name}`, name, displayName, hierarchyLevel, permissions: [], color, isSystem: true, isActive: true,
});
const ROLES = [
  role('OPERATOR', 'Operator', 1, ''), // blank colour -> falls back to bg-slate-500
  role('SUPER_ADMIN', 'Super Admin', 6),
  role('ADMIN', 'Administrator', 5),
  role('QA', 'Quality', 3),
];
const CONFIG = { CREATE_HELP_ARTICLE: ['ADMIN'], EDIT_FILTER: ['ADMIN', 'QA'] };

function setup(opts: { extra?: MockRoute[]; reauth?: string[]; roles?: unknown[]; config?: unknown } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.config ?? CONFIG },
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<ActionReauthPage />, { user: SUPER_ADMIN, api });
  return api;
}

const loaded = () => screen.findByText('Action Re-authentication');
const row = (label: string) => screen.getByText(label, { selector: 'span' }).closest('tr') as HTMLElement;
const boxes = (label: string) => within(row(label)).getAllByRole('checkbox') as HTMLInputElement[];
const categoryRow = (description: string) => screen.getByText(description).closest('tr') as HTMLElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Configuration|Saving/ });
const statValue = (label: string) => screen.getByText(label).parentElement!.textContent!;

describe('Action Re-authentication page', { timeout: 30000 }, () => {
  it('shows a loading state, then the matrix: SUPER_ADMIN excluded, roles by hierarchy, stats from the saved policy', async () => {
    const api = setup();
    expect(screen.getByText('Loading re-authentication configuration...')).toBeInTheDocument();
    await loaded();

    // Column order: highest hierarchy first; SUPER_ADMIN never a column.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers[1]).toContain('Administrator');
    expect(headers[2]).toContain('Quality');
    expect(headers[3]).toContain('Operator');
    expect(headers.join(' ')).not.toContain('Super Admin');
    // Per-role configured counts.
    expect(headers[1]).toContain(`2 / ${SWITCHABLE}`);
    expect(headers[2]).toContain(`1 / ${SWITCHABLE}`);
    expect(headers[3]).toContain(`0 / ${SWITCHABLE}`);
    // Operator has no colour -> neutral badge.
    expect(screen.getByText('Operator', { selector: 'div' }).className).toContain('bg-slate-500');

    expect(statValue('Total Actions')).toContain(String(TOTAL));
    expect(statValue('Actions Configured')).toContain('2');
    expect(statValue('Total Checks')).toContain('3');
    expect(statValue('Roles')).toContain('3');

    // Saved checks render ticked, others not. Columns: ADMIN, QA, OPERATOR.
    expect(boxes('Create Help Article').map((b) => b.checked)).toEqual([true, false, false]);
    expect(boxes('Edit Filter').map((b) => b.checked)).toEqual([true, true, false]);
    expect(categoryRow('Help article management').textContent).toContain('1/3');

    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByText('Unsaved Changes')).toBeNull();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/config');
    expect(api.unmatched).toEqual([]);
  });

  it('ticking a box marks the page dirty and Save PUTs the whole merged policy', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(boxes('Create Help Article')[1]); // QA on
    expect(boxes('Create Help Article')[1].checked).toBe(true);
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(statValue('Total Checks')).toContain('4');

    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ CREATE_HELP_ARTICLE: ['ADMIN', 'QA'], EDIT_FILTER: ['ADMIN', 'QA'] });
    expect(await screen.findByText('Action re-authentication settings saved successfully.')).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  it('unticking the last role of an action drops the action key from the saved policy', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    fireEvent.click(boxes('Create Help Article')[0]); // ADMIN off -> no roles left
    expect(statValue('Actions Configured')).toContain('1');
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ EDIT_FILTER: ['ADMIN', 'QA'] });
  });

  it('Discard throws local edits away', async () => {
    setup();
    await loaded();
    fireEvent.click(boxes('Edit Filter')[2]);
    expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(boxes('Edit Filter')[2].checked).toBe(false);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('when the policy itself needs a signature the dialog opens first and the PUT carries the password', async () => {
    const api = setup({ reauth: ['UPDATE_REAUTH_CONFIG'], extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(boxes('Edit Filter')[2]);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText(/Performing "Update Re-auth Config" requires identity verification/)).toBeInTheDocument();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    await signReauth('pw-9');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const put = api.calls('PUT', PATH)[0];
    expect(put.headers['x-reauth-password']).toBe('pw-9');
    expect(put.json).toEqual({ ...CONFIG, EDIT_FILTER: ['ADMIN', 'QA', 'OPERATOR'], _currentPassword: 'pw-9' });
    expect(await screen.findByText('Action re-authentication settings saved successfully.')).toBeInTheDocument();
  });

  it('server-demanded signature (401 REAUTH_REQUIRED) prompts and retries; a wrong password re-prompts', async () => {
    const api = setup({
      extra: [
        reauthRequired('PUT', PATH),
        { method: 'PUT', path: PATH, status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'Incorrect password' } },
        { method: 'PUT', path: PATH, body: { ok: true } },
      ],
    });
    await loaded();
    fireEvent.click(boxes('Edit Filter')[2]);
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    await signReauth('right');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(3));
    expect(api.calls('PUT', PATH)[2].headers['x-reauth-password']).toBe('right');
    expect(await screen.findByText('Action re-authentication settings saved successfully.')).toBeInTheDocument();
  });

  it('cancelling the signature frees the Save button, sends nothing more and does not claim success', async () => {
    const api = setup({ reauth: ['UPDATE_REAUTH_CONFIG'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(boxes('Edit Filter')[2]);
    await act(async () => { fireEvent.click(saveBtn()); });
    await screen.findByPlaceholderText('Enter your password');
    expect(saveBtn()).toBeDisabled();
    const dialog = screen.getByText('Confirm Your Identity').closest('div.relative') as HTMLElement;
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); });
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(screen.queryByText('Action re-authentication settings saved successfully.')).toBeNull();
    // Item 9: a deliberate cancel is not an error - no red banner, edits kept.
    expect(screen.queryByText(/Cancelled —/)).toBeNull();
    expect(screen.queryByText(/Failed to save/)).toBeNull();
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  });

  it('a refused save shows the server message and keeps the edits', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'Only a super admin may change this policy' } }] });
    await loaded();
    fireEvent.click(boxes('Edit Filter')[2]);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('Only a super admin may change this policy')).toBeInTheDocument();
    expect(boxes('Edit Filter')[2].checked).toBe(true);
    expect(saveBtn()).not.toBeDisabled();
    // Next edit clears the stale error banner.
    fireEvent.click(boxes('Edit Filter')[2]);
    expect(screen.queryByText('Only a super admin may change this policy')).toBeNull();
  });

  it('search filters by label, key and category, offers a clear button, and reports no match', async () => {
    setup();
    await loaded();
    const search = screen.getByPlaceholderText('Search actions...');
    fireEvent.change(search, { target: { value: 'help article' } });
    expect(screen.getByText('Create Help Article')).toBeInTheDocument();
    expect(screen.queryByText('Edit Filter')).toBeNull();
    expect(screen.queryByText('Filter cleaning operations and cycle management')).toBeNull();

    fireEvent.change(search, { target: { value: 'edit_filter' } }); // by key
    expect(screen.getByText('Edit Filter')).toBeInTheDocument();
    expect(screen.queryByText('Create Help Article')).toBeNull();

    fireEvent.change(search, { target: { value: 'backup' } }); // by category
    expect(screen.getByText('Database export and restore operations')).toBeInTheDocument();
    expect(screen.queryByText('Edit Filter')).toBeNull();

    fireEvent.change(search, { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No actions match "zzz-nothing"')).toBeInTheDocument();

    // The clear (x) button is the only button inside the search box wrapper.
    fireEvent.click(within(search.parentElement as HTMLElement).getByRole('button'));
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Edit Filter')).toBeInTheDocument();
    expect(screen.queryByText(/No actions match/)).toBeNull();
  });

  it('collapsing a category hides its rows; expanding shows them again', async () => {
    setup();
    await loaded();
    const toggle = within(categoryRow('Help article management')).getAllByRole('button')[0];
    fireEvent.click(toggle);
    expect(screen.queryByText('Create Help Article')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Create Help Article')).toBeInTheDocument();
  });

  it('category Select All / Clear act on every visible role', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    const help = categoryRow('Help article management');
    fireEvent.click(within(help).getByRole('button', { name: 'Select All' }));
    for (const label of ['Create Help Article', 'Update Help Article', 'Delete Help Article']) {
      expect(boxes(label).map((b) => b.checked)).toEqual([true, true, true]);
    }
    expect(categoryRow('Help article management').textContent).toContain('3/3');
    fireEvent.click(within(categoryRow('Help article management')).getByRole('button', { name: 'Clear' }));
    for (const label of ['Create Help Article', 'Update Help Article', 'Delete Help Article']) {
      expect(boxes(label).map((b) => b.checked)).toEqual([false, false, false]);
    }
    // Clearing a category that has nothing set is a no-op for other categories.
    fireEvent.click(within(categoryRow('Database export and restore operations')).getByRole('button', { name: 'Clear' }));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ EDIT_FILTER: ['ADMIN', 'QA'] });
  });

  it('the role filter narrows columns, and category actions then touch only that role', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'All Roles (3)', 'Administrator (2 configured)', 'Quality (1 configured)', 'Operator (0 configured)',
    ]);
    fireEvent.change(select, { target: { value: 'QA' } });
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(boxes('Edit Filter')).toHaveLength(1);

    fireEvent.click(within(categoryRow('Help article management')).getByRole('button', { name: 'Select All' }));
    fireEvent.click(within(categoryRow('Filter cleaning operations and cycle management')).getByRole('button', { name: 'Clear' }));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    // QA added to all three help actions (ADMIN kept on Create); QA removed from Delete Role only.
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      CREATE_HELP_ARTICLE: ['ADMIN', 'QA'],
      UPDATE_HELP_ARTICLE: ['QA'],
      DELETE_HELP_ARTICLE: ['QA'],
      EDIT_FILTER: ['ADMIN'],
    });
  });

  it('an always-on action (OD-01) is informational: no checkbox, never counted, selected or cleared', async () => {
    // A stored role on an always-on action changes nothing the server does, so
    // it is neither shown nor counted — and a save carries it back untouched.
    const api = setup({
      config: { CREATE_HELP_ARTICLE: ['ADMIN'], DELETE_ROLE: ['QA'] },
      extra: [{ method: 'PUT', path: PATH, body: { ok: true } }],
    });
    await loaded();
    expect(screen.getByText(/ask every role for the\s+password, Super Admin included/)).toBeInTheDocument();
    for (const label of ['Delete Role', 'Create Role', 'Delete Audit Record', 'Super-Admin Data Edit', 'Update Re-auth Config', 'Restore Backup', 'Delete Filter']) {
      expect(within(row(label)).queryAllByRole('checkbox'), label).toHaveLength(0);
      expect(row(label).textContent, label).toContain('Always required');
    }
    // Every action in Role Management is always-on: no Select All / Clear, no count.
    const roleCat = categoryRow('Role creation, editing, and deletion');
    expect(roleCat.textContent).toContain('Always required');
    expect(within(roleCat).queryByRole('button', { name: 'Select All' })).toBeNull();
    expect(within(roleCat).queryByRole('button', { name: 'Clear' })).toBeNull();
    // QA's stored DELETE_ROLE is not counted.
    expect(screen.getAllByRole('columnheader')[2].textContent).toContain(`0 / ${SWITCHABLE}`);
    expect(statValue('Actions Configured')).toContain('1');
    expect(statValue('Total Checks')).toContain('1');

    // Per-role All ticks only the switchable rows; None leaves the always rows alone.
    fireEvent.click(within(screen.getAllByRole('columnheader')[3]).getByRole('button', { name: 'All' }));
    fireEvent.click(within(screen.getAllByRole('columnheader')[2]).getByRole('button', { name: 'None' }));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const sent = api.calls('PUT', PATH)[0].json as Record<string, string[]>;
    expect(sent.DELETE_ROLE).toEqual(['QA']);
    expect([...ALWAYS_REAUTH_ACTIONS].filter((a) => a !== 'DELETE_ROLE' && a in sent)).toEqual([]);
    expect(sent.CREATE_HELP_ARTICLE).toEqual(['ADMIN', 'OPERATOR']);
  });

  it('per-role All / None set or clear that role on every action', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    const opHeader = screen.getAllByRole('columnheader')[3];
    fireEvent.click(within(opHeader).getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('columnheader')[3].textContent).toContain(`${SWITCHABLE} / ${SWITCHABLE}`);
    expect(statValue('Actions Configured')).toContain(String(SWITCHABLE));

    const adminHeader = screen.getAllByRole('columnheader')[1];
    fireEvent.click(within(adminHeader).getByRole('button', { name: 'None' }));
    expect(screen.getAllByRole('columnheader')[1].textContent).toContain(`0 / ${SWITCHABLE}`);

    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const sent = api.calls('PUT', PATH)[0].json as Record<string, string[]>;
    expect(Object.keys(sent)).toHaveLength(SWITCHABLE);
    expect(sent.EDIT_FILTER).toEqual(['QA', 'OPERATOR']);
    expect(sent.CREATE_HELP_ARTICLE).toEqual(['OPERATOR']);
    expect(Object.values(sent).every((r) => !r.includes('ADMIN'))).toBe(true);

    // None on a role holding nothing removes keys that end up empty.
    fireEvent.click(within(screen.getAllByRole('columnheader')[3]).getByRole('button', { name: 'None' }));
  });

  it('with more than three role columns the compact header layout is used', async () => {
    setup({ roles: [...ROLES, role('SUPERVISOR', 'Supervisor', 4)] });
    await loaded();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(5);
    expect(headers[0].getAttribute('style')).toContain('240px');
    expect(screen.getByText('Supervisor', { selector: 'div' }).className).toContain('px-2 py-1');
  });

  it('a null entry in the stored policy counts as unset; ticking an unset action adds it; None drops emptied keys', async () => {
    const api = setup({
      config: { CREATE_HELP_ARTICLE: ['ADMIN'], UPDATE_HELP_ARTICLE: null },
      extra: [{ method: 'PUT', path: PATH, body: { ok: true } }],
    });
    await loaded();
    expect(statValue('Actions Configured')).toContain('1');
    expect(statValue('Total Checks')).toContain('1');
    expect(boxes('Update Help Article').every((b) => !b.checked)).toBe(true);
    fireEvent.click(boxes('Delete Help Article')[1]); // action absent from the policy -> QA added
    fireEvent.click(within(screen.getAllByRole('columnheader')[1]).getByRole('button', { name: 'None' })); // ADMIN off everywhere
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ DELETE_HELP_ARTICLE: ['QA'] });
  });

  it('an empty saved policy renders with nothing configured', async () => {
    setup({ config: {} });
    await loaded();
    expect(statValue('Actions Configured')).toContain('0');
    expect(statValue('Total Checks')).toContain('0');
    expect(boxes('Edit Filter').every((b) => !b.checked)).toBe(true);
  });
});

/**
 * 2026-10-21 (§11): a failed policy load fell back to `{}` - the matrix rendered
 * every action as "no password", stayed editable, and one tick + Save PUT
 * `{"EDIT_FILTER":["ADMIN"]}` over the WHOLE stored policy, switching off every
 * other signature requirement. A policy that did not load must not be editable.
 */
describe('Action Re-authentication page — the stored policy did not load', { timeout: 30000 }, () => {
  const nothingEditable = (api: ReturnType<typeof setup>) => {
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Save Configuration/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^All$/ })).toBeNull();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
  };

  it('a 500 shows the server message, offers no matrix and no Save, and nothing is PUT', async () => {
    const api = setup({ extra: [{ path: PATH, status: 500, body: { error: 'INTERNAL', message: 'policy store unavailable' } }] });
    expect(await screen.findByRole('alert')).toHaveTextContent('policy store unavailable');
    nothingEditable(api);
  });

  it('a 403 shows the server message, offers no matrix and no Save, and nothing is PUT', async () => {
    const api = setup({ extra: [{ path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'Insufficient permissions' } }] });
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permissions');
    nothingEditable(api);
  });

  it('Retry reloads the policy, which is then shown and editable', async () => {
    const api = setup({ extra: [
      { path: PATH, status: 500, times: 1, body: { error: 'INTERNAL', message: 'policy store unavailable' } },
      { method: 'PUT', path: PATH, body: { ok: true } },
    ] });
    expect(await screen.findByRole('alert')).toHaveTextContent('policy store unavailable');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(boxes('Edit Filter').map((b) => b.checked)).toEqual([true, true, false]));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(boxes('Edit Filter')[2]);
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ CREATE_HELP_ARTICLE: ['ADMIN'], EDIT_FILTER: ['ADMIN', 'QA', 'OPERATOR'] });
  });

  it('while the policy is loading there is no matrix and no Save', async () => {
    setup();
    expect(screen.getByText('Loading re-authentication configuration...')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Save Configuration/ })).toBeNull();
    // Let the reads settle inside the test (no state update after it ends).
    await waitFor(() => expect(screen.queryByText('Loading re-authentication configuration...')).toBeNull());
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
  });

  it('a genuinely empty stored policy (200 with {}) stays editable and saveable', async () => {
    const api = setup({ config: {}, extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await loaded();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(boxes('Edit Filter')[0]);
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ EDIT_FILTER: ['ADMIN'] });
  });
});
