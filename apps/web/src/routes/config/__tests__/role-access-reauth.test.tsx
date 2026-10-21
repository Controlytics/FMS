import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { REAUTH_ACTIONS } from '@digilog/shared';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { RoleAccessPage } from '../role-access';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

afterEach(resetEnv);
// The matrix renders ~130 rows x N roles; give async queries headroom under load.
configure({ asyncUtilTimeout: 5000 });

const PATH = '/api/config/action-reauth';
const MY = '/api/config/action-reauth/my-actions';
const TOTAL = Object.keys(REAUTH_ACTIONS).length;
const role = (name: string, displayName: string, hierarchyLevel: number, color = 'bg-blue-500') => ({
  id: `r-${name}`, name, displayName, hierarchyLevel, permissions: [], color, isSystem: true, isActive: true,
});
const ACTIVE = [role('SUPER_ADMIN', 'Super Admin', 6), role('OPERATOR', 'Operator', 1, ''), role('ADMIN', 'Administrator', 5), role('QA', 'Quality', 3)];
const CONFIG = { CREATE_HELP_ARTICLE: ['ADMIN'], DELETE_ROLE: ['ADMIN', 'QA'] };

function setup(opts: { extra?: MockRoute[]; active?: unknown[]; config?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.config ?? CONFIG },
    { path: '/api/roles', body: ACTIVE },
    { path: '/api/roles/active', body: opts.active ?? ACTIVE },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<RoleAccessPage />, { route: '/config/roles', user: SUPER_ADMIN, api });
  return api;
}

async function openTab() {
  await screen.findByText('Quality', { selector: 'span' }); // roles loaded
  fireEvent.click(screen.getByRole('button', { name: 'Re-auth' }));
  expect(screen.getByText('Loading re-authentication configuration...')).toBeInTheDocument();
  await screen.findByText('How it works');
}
const row = (label: string) => screen.getByText(label, { selector: 'span' }).closest('tr') as HTMLElement;
const boxes = (label: string) => within(row(label)).getAllByRole('checkbox') as HTMLInputElement[];
const categoryRow = (description: string) => screen.getByText(description).closest('tr') as HTMLElement;
const statValue = (label: string) => screen.getByText(label, { selector: 'div.text-xs' }).parentElement!.textContent!;
const headerSave = () => screen.queryByRole('button', { name: /Save Changes|Saving\.\.\./ });

describe('Role & Access — Re-auth tab', { timeout: 30000 }, () => {
  it('shows the policy matrix for every role but SUPER_ADMIN, with stats and no pending changes', async () => {
    const api = setup();
    await openTab();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '');
    expect(headers).toHaveLength(4);
    expect(headers[1]).toContain('Administrator');
    expect(headers[1]).toContain(`2 / ${TOTAL}`);
    expect(headers[2]).toContain('Quality');
    expect(headers[3]).toContain('Operator');
    expect(screen.getByText('Operator', { selector: 'div' }).className).toContain('bg-slate-500');
    expect(statValue('Total Actions')).toContain(String(TOTAL));
    expect(statValue('Actions Configured')).toContain('2');
    expect(statValue('Total Checks')).toContain('3');
    expect(boxes('Delete Role').map((b) => b.checked)).toEqual([true, true, false]);
    expect(headerSave()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('a toggle shows Save/Discard in the header; Save PUTs the merged policy and refreshes the policy + my-actions', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await openTab();
    fireEvent.click(boxes('Create Help Article')[2]); // OPERATOR on
    fireEvent.click(boxes('Delete Role')[1]);         // QA off
    expect(headerSave()).not.toBeNull();
    const getsBefore = api.calls('GET', PATH).length;
    const myBefore = api.calls('GET', MY).length;
    fireEvent.click(headerSave()!);
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ CREATE_HELP_ARTICLE: ['ADMIN', 'OPERATOR'], DELETE_ROLE: ['ADMIN'] });
    expect(await screen.findByText('Action re-authentication settings saved successfully.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', PATH).length).toBeGreaterThan(getsBefore));
    await waitFor(() => expect(api.calls('GET', MY).length).toBeGreaterThan(myBefore));
    expect(headerSave()).toBeNull();
  });

  it('Discard restores the saved policy', async () => {
    setup();
    await openTab();
    fireEvent.click(boxes('Delete Role')[0]);
    expect(boxes('Delete Role')[0].checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(boxes('Delete Role')[0].checked).toBe(true);
    expect(headerSave()).toBeNull();
  });

  it('server-demanded signature prompts and retries; cancelling is silent; a refusal is shown', async () => {
    const api = setup({
      extra: [
        reauthRequired('PUT', PATH),
        reauthRequired('PUT', PATH),
        { method: 'PUT', path: PATH, status: 403, times: 1, body: { error: 'FORBIDDEN', message: 'Policy is locked' } },
        { method: 'PUT', path: PATH, body: { ok: true } },
      ],
    });
    await openTab();
    fireEvent.click(boxes('Delete Role')[2]);
    // 1st attempt: cancel the prompt -> no banner, change kept.
    await act(async () => { fireEvent.click(headerSave()!); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText(/saved successfully|Cancelled/)).toBeNull();
    expect(headerSave()).not.toBeNull();
    // 2nd attempt: sign -> the signed retry is refused -> error banner.
    await act(async () => { fireEvent.click(headerSave()!); });
    await signReauth('pw-x');
    expect(await screen.findByText('Policy is locked')).toBeInTheDocument();
    expect(api.calls('PUT', PATH)[2].headers['x-reauth-password']).toBe('pw-x');
    // A further edit clears the banner; 3rd attempt succeeds.
    fireEvent.click(boxes('Delete Role')[2]);
    expect(screen.queryByText('Policy is locked')).toBeNull();
    fireEvent.click(boxes('Delete Role')[2]);
    await act(async () => { fireEvent.click(headerSave()!); });
    expect(await screen.findByText('Action re-authentication settings saved successfully.')).toBeInTheDocument();
    expect(api.calls('PUT', PATH)[3].json).toEqual({ ...CONFIG, DELETE_ROLE: ['ADMIN', 'QA', 'OPERATOR'] });
  });

  it('search by label / key / category, clear button, no-match message', async () => {
    setup();
    await openTab();
    const search = screen.getByPlaceholderText('Search actions...');
    fireEvent.change(search, { target: { value: 'Help Article' } });
    expect(screen.getByText('Update Help Article')).toBeInTheDocument();
    expect(screen.queryByText('Delete Role')).toBeNull();
    fireEvent.change(search, { target: { value: 'delete_role' } });
    expect(screen.getByText('Delete Role')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'notifications' } });
    expect(screen.getByText('Notification deletion')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'qqqq' } });
    expect(screen.getByText('No actions match "qqqq"')).toBeInTheDocument();
    fireEvent.click(within(search.parentElement as HTMLElement).getByRole('button'));
    expect((search as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Delete Role')).toBeInTheDocument();
  });

  it('collapse a category, and Select All / Clear for it across visible roles', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await openTab();
    const toggle = within(categoryRow('Help article management')).getAllByRole('button')[0];
    fireEvent.click(toggle);
    expect(screen.queryByText('Create Help Article')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Create Help Article')).toBeInTheDocument();

    fireEvent.click(within(categoryRow('Help article management')).getByRole('button', { name: 'Select All' }));
    expect(boxes('Delete Help Article').map((b) => b.checked)).toEqual([true, true, true]);
    expect(categoryRow('Help article management').textContent).toContain('3/3');
    fireEvent.click(within(categoryRow('Role creation, editing, and deletion')).getByRole('button', { name: 'Clear' }));
    fireEvent.click(within(categoryRow('Database export and restore operations')).getByRole('button', { name: 'Clear' }));
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({
      CREATE_HELP_ARTICLE: ['ADMIN', 'QA', 'OPERATOR'],
      UPDATE_HELP_ARTICLE: ['ADMIN', 'QA', 'OPERATOR'],
      DELETE_HELP_ARTICLE: ['ADMIN', 'QA', 'OPERATOR'],
    });
  });

  it('role filter narrows the matrix and scopes category actions; per-role All / None', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await openTab();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'All Roles (3)', 'Administrator (2 configured)', 'Quality (1 configured)', 'Operator (0 configured)',
    ]);
    fireEvent.change(select, { target: { value: 'QA' } });
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    fireEvent.click(within(categoryRow('Help article management')).getByRole('button', { name: 'Select All' }));
    fireEvent.click(within(categoryRow('Role creation, editing, and deletion')).getByRole('button', { name: 'Clear' }));
    expect(boxes('Delete Role').map((b) => b.checked)).toEqual([false]);
    fireEvent.change(select, { target: { value: 'all' } });
    expect(boxes('Delete Role').map((b) => b.checked)).toEqual([true, false, false]);

    const opHeader = () => screen.getAllByRole('columnheader')[3];
    fireEvent.click(within(opHeader()).getByRole('button', { name: 'All' }));
    expect(opHeader().textContent).toContain(`${TOTAL} / ${TOTAL}`);
    fireEvent.click(within(screen.getAllByRole('columnheader')[1]).getByRole('button', { name: 'None' }));
    expect(screen.getAllByRole('columnheader')[1].textContent).toContain(`0 / ${TOTAL}`);
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    const sent = api.calls('PUT', PATH)[0].json as Record<string, string[]>;
    expect(Object.keys(sent)).toHaveLength(TOTAL);
    expect(sent.CREATE_HELP_ARTICLE).toEqual(['QA', 'OPERATOR']);
    expect(sent.DELETE_ROLE).toEqual(['OPERATOR']);
    expect(Object.values(sent).some((r) => r.includes('ADMIN'))).toBe(false);
  });

  it('a null entry in the stored policy counts as unset; None on a role drops keys it empties', async () => {
    const api = setup({
      config: { CREATE_HELP_ARTICLE: ['ADMIN'], UPDATE_HELP_ARTICLE: null },
      extra: [{ method: 'PUT', path: PATH, body: { ok: true } }],
    });
    await openTab();
    expect(statValue('Actions Configured')).toContain('1');
    expect(statValue('Total Checks')).toContain('1');
    fireEvent.click(boxes('Delete Help Article')[1]); // unset action -> QA added
    fireEvent.click(within(screen.getAllByRole('columnheader')[1]).getByRole('button', { name: 'None' }));
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ DELETE_HELP_ARTICLE: ['QA'] });
  });

  it('compact headers with more than three roles; an empty policy renders cleanly', async () => {
    setup({ active: [...ACTIVE, role('SUPERVISOR', 'Supervisor', 4)], config: {} });
    await openTab();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(5);
    expect(headers[0].getAttribute('style')).toContain('240px');
    expect(statValue('Actions Configured')).toContain('0');
    expect(statValue('Roles')).toContain('4');
  });
});
