import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import DashboardCardsConfig from '../dashboard-cards';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

vi.setConfig({ testTimeout: 30000 });
afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const PUT = '/api/config/dashboard-cards';
const CURRENT = '/api/config/dashboard-cards/current';
const W = { timeout: 5000 };
const ALL = ['total_users', 'audit_trail', 'notifications', 'filter_analytics', 'total_filters', 'active_cycles',
  'completed_today', 'stage_distribution', 'cycle_status', 'daily_chart', 'monthly_chart', 'quick_actions'];
const ROLES = [
  { id: 'r1', name: 'ADMIN', displayName: 'Administrator' },
  { id: 'r2', name: 'QA_LEAD' },
];

function setup(opts: { roles?: unknown; config?: unknown; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    { path: CURRENT, body: opts.config ?? { roles: { ADMIN: ['total_users', 'audit_trail'] } } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<DashboardCardsConfig />, { user: SUPER_ADMIN, api });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const block = (displayName: string) => screen.getByText(displayName).closest('div.bg-white') as HTMLElement;
const box = (displayName: string, label: string) => within(block(displayName)).getByRole('checkbox', { name: new RegExp(`^${label}`) }) as HTMLInputElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });

describe('Dashboard cards panel', () => {
  it('shows a loading line, then one block per role: saved roles use their list, others default to all', async () => {
    const api = setup();
    expect(screen.getByText('Loading roles...')).toBeInTheDocument();
    expect(await screen.findByText('Administrator', undefined, W)).toBeInTheDocument();
    // displayName missing -> underscores become spaces
    expect(screen.getByText('QA LEAD')).toBeInTheDocument();
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    expect(within(block('QA LEAD')).getByText('(12/12 cards)')).toBeInTheDocument();
    expect(box('Administrator', 'Total Users').checked).toBe(true);
    expect(box('Administrator', 'Quick Actions').checked).toBe(false);
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('accepts a { roles: [...] } envelope for the role list and an empty config', async () => {
    setup({ roles: { roles: [{ id: 'r9', name: 'OPERATOR', displayName: 'Operator' }] }, config: {} });
    expect(await screen.findByText('Operator', undefined, W)).toBeInTheDocument();
    expect(within(block('Operator')).getByText('(12/12 cards)')).toBeInTheDocument();
  });

  it('unticking then re-ticking a card is not a change (order-insensitive)', async () => {
    setup();
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    fireEvent.click(box('Administrator', 'Total Users'));
    expect(within(block('Administrator')).getByText('(1/12 cards)')).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(box('Administrator', 'Total Users'));
    expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument();
    expect(saveBtn()).toBeDisabled();
  });

  it('Select All / Clear All act on one role only', async () => {
    setup();
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    fireEvent.click(within(block('Administrator')).getByRole('button', { name: 'Select All' }));
    expect(within(block('Administrator')).getByText('(12/12 cards)')).toBeInTheDocument();
    fireEvent.click(within(block('QA LEAD')).getByRole('button', { name: 'Clear All' }));
    expect(within(block('QA LEAD')).getByText('(0/12 cards)')).toBeInTheDocument();
    expect(within(block('Administrator')).getByText('(12/12 cards)')).toBeInTheDocument();
  });

  it('Save PUTs every role\'s card list and shows a transient "Saved" notice', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PUT, body: { ok: true } }] });
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    fireEvent.click(box('Administrator', 'Notifications'));
    fireEvent.click(box('QA LEAD', 'Quick Actions'));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(1), W);
    const body = api.calls('PUT', PUT)[0].json;
    expect(Object.keys(body.configValue.roles)).toEqual(['ADMIN', 'QA_LEAD']);
    expect(body.configValue.roles.ADMIN).toEqual(['total_users', 'audit_trail', 'notifications']);
    expect(body.configValue.roles.QA_LEAD).toEqual(ALL.filter((k) => k !== 'quick_actions'));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // The notice clears itself after ~2 s.
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull(), { timeout: 4000 });
  });

  it('a refused save shows the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PUT, status: 403, body: { error: 'FORBIDDEN', message: 'CONFIG_UPDATE required' } }] });
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    fireEvent.click(box('Administrator', 'Notifications'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await screen.findByText('CONFIG_UPDATE required', undefined, W)).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PUT), { method: 'PUT', path: PUT, body: { ok: true } }] });
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    fireEvent.click(box('Administrator', 'Notifications'));
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('pw-dc');
    await waitFor(() => expect(api.calls('PUT', PUT)).toHaveLength(2), W);
    const retry = api.calls('PUT', PUT)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-dc');
    expect(retry.json._currentPassword).toBe('pw-dc');
    expect(retry.json.configValue.roles.ADMIN).toEqual(['total_users', 'audit_trail', 'notifications']);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('signature required up front: the prompt names the action; cancel sends nothing, frees Save and shows no notice (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    await catalogLoaded(api);
    fireEvent.click(box('Administrator', 'Notifications'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    expect(saveBtn()).toHaveTextContent('Saving…');
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expectSilentCancel(consoleError);
    // The notice that normally says "Saved" must not carry the cancel either.
    expect(screen.queryByText('Saved')).toBeNull();
    expect(api.calls('PUT', PUT)).toHaveLength(0);
    expect(saveBtn()).toHaveTextContent('Save Changes');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('cancelling a server-demanded signature frees Save and shows no notice (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ extra: [reauthRequired('PUT', PUT)] });
    await waitFor(() => expect(within(block('Administrator')).getByText('(2/12 cards)')).toBeInTheDocument(), W);
    fireEvent.click(box('Administrator', 'Notifications'));
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expectSilentCancel(consoleError);
    expect(screen.queryByText('Saved')).toBeNull();
    expect(api.calls('PUT', PUT)).toHaveLength(1);
    expect(saveBtn()).toHaveTextContent('Save Changes');
    expect(saveBtn()).not.toBeDisabled();
  });
});
