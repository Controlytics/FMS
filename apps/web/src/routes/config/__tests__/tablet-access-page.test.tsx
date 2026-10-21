import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { TabletAccessConfigPage } from '../tablet-access';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

// Multi-request flows: the 5s / 1s defaults are too tight when the suite runs
// under coverage alongside other workers.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });

afterEach(resetEnv);

const PATH = '/api/config/tablet-access';
const ROLES = [
  { name: 'OPERATOR', displayName: 'Operator' },
  { name: 'QA', displayName: '' }, // blank displayName -> falls back to the name
];
// OPERATOR holds a retired key ('approvals') that a save must not write back.
const CONFIG = { OPERATOR: ['login', 'filter_cleaning', 'approvals'] };

function setup(opts: { extra?: MockRoute[]; user?: any; reauth?: string[]; roles?: unknown; config?: unknown } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.config ?? CONFIG },
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<TabletAccessConfigPage />, { user: opts.user ?? SUPER_ADMIN, api });
  return api;
}

const btn = (name: string) => screen.getByRole('button', { name });
const pressed = (name: string) => btn(name).getAttribute('aria-pressed');
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });

describe('Tablet App Access page', () => {
  it('shows a spinner while loading, then the role x feature matrix from the server', async () => {
    const api = setup();
    expect(screen.queryByRole('heading', { name: 'Tablet App Access Control' })).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Tablet App Access Control' })).toBeInTheDocument();
    await screen.findByText('Operator');
    // QA has no displayName -> the role name is the label.
    expect(screen.getAllByText('QA').length).toBeGreaterThan(0);
    expect(pressed('Login for Operator')).toBe('true');
    expect(pressed('Filter Cleaning for Operator')).toBe('true');
    expect(pressed('My Tasks for Operator')).toBe('false');
    // QA has no login -> every non-login feature is locked off.
    expect(btn('Filter Status for QA')).toBeDisabled();
    expect(btn('Login for QA')).not.toBeDisabled();
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByRole('note')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('turning Login off clears every feature; turning a feature on also turns Login on', async () => {
    setup();
    await screen.findByText('Operator');
    fireEvent.click(btn('Login for Operator'));
    expect(pressed('Login for Operator')).toBe('false');
    expect(pressed('Filter Cleaning for Operator')).toBe('false');
    expect(btn('Filter Cleaning for Operator')).toBeDisabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Login back on (plain add), then a feature off (plain remove).
    fireEvent.click(btn('Login for QA'));
    expect(pressed('Login for QA')).toBe('true');
    fireEvent.click(btn('My Tasks for QA'));
    expect(pressed('My Tasks for QA')).toBe('true');
    fireEvent.click(btn('My Tasks for QA'));
    expect(pressed('My Tasks for QA')).toBe('false');
    expect(pressed('Login for QA')).toBe('true');
  });

  it('a role with no stored entry gets Login switched on with the first feature through the All toggle', async () => {
    setup({ config: {} });
    await screen.findByText('Operator');
    expect(pressed('All features for Operator')).toBe('false');
    fireEvent.click(btn('All features for Operator'));
    expect(pressed('All features for Operator')).toBe('true');
    for (const f of ['Login', 'Filter Cleaning', 'Filter Status', 'My Tasks', 'Stage Approvals', 'RFID Assign', 'Logout']) {
      expect(pressed(`${f} for Operator`)).toBe('true');
    }
    fireEvent.click(btn('All features for Operator'));
    expect(pressed('All features for Operator')).toBe('false');
    expect(pressed('Login for Operator')).toBe('false');
  });

  it('enabling a feature on a role whose login is off is impossible (button disabled)', async () => {
    setup({ config: { OPERATOR: [] } });
    await screen.findByText('Operator');
    expect(btn('Logout for Operator')).toBeDisabled();
  });

  it('Save PUTs the cleaned config (retired keys dropped) and confirms', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await screen.findByText('Operator');
    fireEvent.click(btn('Login for QA'));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1));
    expect(api.calls('PUT', PATH)[0].json).toEqual({ OPERATOR: ['login', 'filter_cleaning'], QA: ['login'] });
    expect(await ackMessage('Saved')).toContain('Tablet access configuration updated');
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    // (The page re-reads via swr's GLOBAL `mutate`, which the harness's per-test
    // cache provider does not route to - so the refetch is not asserted here.)
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await screen.findByText('Operator');
    fireEvent.click(btn('Login for QA'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Tablet Access" requires identity verification/)).toBeInTheDocument();
    await signReauth('tab-pw');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2));
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('tab-pw');
    expect(retry.json).toMatchObject({ QA: ['login'], _currentPassword: 'tab-pw' });
    await ackMessage('Saved');
  });

  it('when the policy requires a signature up front, cancelling sends nothing and frees Save', async () => {
    const api = setup({ reauth: ['UPDATE_TABLET_ACCESS'] });
    await screen.findByText('Operator');
    // Let /my-actions resolve so the hook knows the action is gated.
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(btn('Login for QA'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'));
    expect(saveBtn()).not.toBeDisabled();
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    // A cancel is not an error.
    expect(screen.queryByRole('heading', { name: 'Error' })).toBeNull();
  });

  it('a refused save shows the server message and re-enables Save', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'CONFIG_UPDATE required' } }] });
    await screen.findByText('Operator');
    fireEvent.click(btn('Login for QA'));
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Error')).toContain('CONFIG_UPDATE required');
    expect(saveBtn()).not.toBeDisabled();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('a failed roles feed leaves the matrix without rows (no crash)', async () => {
    setup({ roles: { error: 'x' } });
    await screen.findByRole('heading', { name: 'Tablet App Access Control' });
    expect(screen.queryByRole('button', { name: /for Operator/ })).toBeNull();
  });

  it('a read-only role (CONFIG_READ) sees the matrix but every control is disabled', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['CONFIG_READ'] } });
    await screen.findByText('Operator');
    await waitFor(() => expect(screen.getByRole('note')).toHaveTextContent(/Read-only/));
    expect(btn('Login for Operator')).toBeDisabled();
    expect(btn('All features for Operator')).toBeDisabled();
    expect(saveBtn()).toHaveAttribute('title', expect.stringMatching(/CONFIG_UPDATE/));
  });
});
