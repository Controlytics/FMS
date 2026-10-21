import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { ReplacementScheduleFiltersPage } from '../replacement-schedule-filters';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PM = '/api/config/pm-schedule-filters';
const REP = '/api/config/replacement-schedule-filters';
const W = { timeout: 5000 };
const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin' },
  { name: 'SUPERVISOR', displayName: 'Supervisor' },
  { name: 'OPERATOR', displayName: '' },
];

function setup(opts: { pm?: unknown; rep?: unknown; roles?: unknown; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PM, body: opts.pm ?? { SUPERVISOR: true } },
    { path: REP, body: opts.rep ?? { OPERATOR: true } },
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<ReplacementScheduleFiltersPage />, { user: SUPER_ADMIN, api });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

// Each toggle is a named switch (2026-10-21; it used to be an unnamed button found by its row).
const switches = (roleLabel: string) => ({
  pm: screen.getByRole('switch', { name: `PM Schedule filters for ${roleLabel}` }),
  rep: screen.getByRole('switch', { name: `Replacement Schedule filters for ${roleLabel}` }),
});
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
async function ready() {
  await waitFor(() => expect(switches('Supervisor').pm).toHaveAttribute('aria-checked', 'true'), W);
  await waitFor(() => expect(switches('OPERATOR').rep).toHaveAttribute('aria-checked', 'true'), W);
}

describe('Schedule AHU filters page', () => {
  it('shows a PM + Replacement switch per role (not SUPER_ADMIN) from the two stored maps', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { name: 'Schedule AHU Filters' })).toBeInTheDocument();
    await ready();
    expect(screen.queryByText('Super Admin')).toBeNull();
    expect(switches('Supervisor').rep).toHaveAttribute('aria-checked', 'false');
    expect(switches('OPERATOR').pm).toHaveAttribute('aria-checked', 'false');
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('with no editable roles it says so', async () => {
    setup({ roles: [{ name: 'SUPER_ADMIN', displayName: 'Super Admin' }] });
    expect(await screen.findByText('No roles to configure.', undefined, W)).toBeInTheDocument();
  });

  it('toggling a switch on and back off is not a change, in either matrix', async () => {
    setup();
    await ready();
    fireEvent.click(switches('OPERATOR').pm);
    expect(switches('OPERATOR').pm).toHaveAttribute('aria-checked', 'true');
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(switches('OPERATOR').pm);
    expect(saveBtn()).toBeDisabled();
    fireEvent.click(switches('Supervisor').rep);
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.click(switches('Supervisor').rep);
    expect(saveBtn()).toBeDisabled();
  });

  it('Save writes BOTH maps and confirms', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PM, body: { ok: true } }, { method: 'PUT', path: REP, body: { ok: true } }] });
    await ready();
    fireEvent.click(switches('Supervisor').rep);
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', REP)).toHaveLength(1), W);
    expect(api.calls('PUT', PM)).toHaveLength(1);
    expect(api.calls('PUT', PM)[0].json).toEqual({ SUPERVISOR: true });
    expect(api.calls('PUT', REP)[0].json).toEqual({ OPERATOR: true, SUPERVISOR: true });
    expect(await ackMessage('Saved')).toContain('AHU filter visibility updated for PM and Replacement schedules.');
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('a refused write reports the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PM, body: { ok: true } }, { method: 'PUT', path: REP, status: 400, body: { error: 'VALIDATION', message: 'unknown role' } }] });
    await ready();
    fireEvent.click(switches('OPERATOR').pm);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('unknown role');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('server demands a signature: one password signs both writes', async () => {
    const api = setup({ extra: [
      reauthRequired('PUT', PM), reauthRequired('PUT', REP),
      { method: 'PUT', path: PM, body: { ok: true } }, { method: 'PUT', path: REP, body: { ok: true } },
    ] });
    await ready();
    fireEvent.click(switches('OPERATOR').pm);
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('pw-sch');
    await waitFor(() => expect(api.calls('PUT', REP)).toHaveLength(2), W);
    await waitFor(() => expect(api.calls('PUT', PM)).toHaveLength(2), W);
    const pmRetry = api.calls('PUT', PM)[1];
    const repRetry = api.calls('PUT', REP)[1];
    expect(pmRetry.headers['x-reauth-password']).toBe('pw-sch');
    expect(repRetry.headers['x-reauth-password']).toBe('pw-sch');
    expect(pmRetry.json).toEqual({ SUPERVISOR: true, OPERATOR: true, _currentPassword: 'pw-sch' });
    expect(repRetry.json).toEqual({ OPERATOR: true, _currentPassword: 'pw-sch' });
    await ackMessage('Saved');
  });

  it('signature required up front: cancel sends nothing and shows no failure', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await ready();
    await catalogLoaded(api);
    fireEvent.click(switches('OPERATOR').pm);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'));
    expect(api.calls('PUT', PM)).toHaveLength(0);
    expect(api.calls('PUT', REP)).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Save failed' })).toBeNull();
    expect(screen.queryByText(/password confirmation was not completed/)).toBeNull();
  });
});

describe('Schedule AHU filters page - accessibility', () => {
  it('every toggle is a named switch that reports its state', async () => {
    setup();
    const sup = await screen.findByRole('switch', { name: 'PM Schedule filters for Supervisor' }, W);
    expect(sup).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Replacement Schedule filters for Supervisor' })).toHaveAttribute('aria-checked', 'false');
    // A role with no display name is named by its key.
    expect(screen.getByRole('switch', { name: 'PM Schedule filters for OPERATOR' })).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Replacement Schedule filters for OPERATOR' })).toHaveAttribute('aria-checked', 'true'), W);
    // SUPER_ADMIN is not configurable here.
    expect(screen.queryByRole('switch', { name: /Super Admin/ })).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
  });

  it('toggling a switch flips its state and keeps keyboard focus on it', async () => {
    setup();
    const sw = await screen.findByRole('switch', { name: 'PM Schedule filters for OPERATOR' }, W);
    sw.focus();
    fireEvent.click(sw);
    const after = screen.getByRole('switch', { name: 'PM Schedule filters for OPERATOR' });
    expect(after).toHaveAttribute('aria-checked', 'true');
    // The same element survives the re-render (it used to be re-created).
    expect(after).toBe(sw);
    expect(document.activeElement).toBe(sw);
  });
});
