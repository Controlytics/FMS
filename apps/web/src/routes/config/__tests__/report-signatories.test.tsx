import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { ReportSignatoriesPage } from '../report-signatories';
import { REPORT_TYPES } from '@/lib/report-types';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PATH = '/api/config/report-signatories';
const W = { timeout: 5000 };
const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin' },
  { name: 'QA', displayName: 'Quality Assurance' },
  { name: 'MANAGER', displayName: '' },
];

function setup(opts: { matrix?: unknown; roles?: unknown; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.matrix ?? { QA: { 'audit-trail': 'Approved By' } } },
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<ReportSignatoriesPage />, { user: SUPER_ADMIN, api });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const headers = () => screen.getAllByRole('columnheader').map((h) => h.firstChild?.textContent);
const cell = (reportLabel: string, col: number) => {
  const row = screen.getByRole('cell', { name: reportLabel }).closest('tr') as HTMLElement;
  return within(row).getAllByRole('combobox')[col] as HTMLSelectElement;
};
const setAll = (col: number) => within(screen.getAllByRole('columnheader')[col + 1]).getByRole('combobox') as HTMLSelectElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
async function ready() {
  await waitFor(() => expect(cell('Audit Trail', 0).value).toBe('Approved By'), W);
}

describe('Report signatories panel', () => {
  it('lists every report against each role except SUPER_ADMIN; unset cells read "Printed By"', async () => {
    const api = setup();
    await ready();
    // Role name shown when displayName is blank.
    expect(headers()).toEqual(['Report', 'Quality Assurance', 'MANAGER']);
    expect(screen.getAllByRole('row')).toHaveLength(REPORT_TYPES.length + 1);
    expect(cell('Audit Trail', 1).value).toBe('Printed By');
    expect(cell('Deviations Report', 0).value).toBe('Printed By');
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('with no editable roles it says so', async () => {
    setup({ roles: [{ name: 'SUPER_ADMIN', displayName: 'Super Admin' }] });
    expect(await screen.findByText('No roles to configure.', undefined, W)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('changing a cell and changing it back is not a change', async () => {
    setup();
    await ready();
    fireEvent.change(cell('Filters', 1), { target: { value: 'Reviewed By' } });
    expect(cell('Filters', 1).value).toBe('Reviewed By');
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.change(cell('Filters', 1), { target: { value: 'Printed By' } });
    expect(saveBtn()).toBeDisabled();
  });

  it('"set all…" applies one label to every report for that role; the blank choice does nothing', async () => {
    setup();
    await ready();
    fireEvent.change(setAll(1), { target: { value: '' } });
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(setAll(1), { target: { value: 'Approved By' } });
    for (const rt of REPORT_TYPES) expect(cell(rt.label, 1).value).toBe('Approved By');
    // Column 0 is untouched.
    expect(cell('Filters', 0).value).toBe('Printed By');
    // The header picker resets to its prompt.
    expect(setAll(1).value).toBe('');
  });

  it('a stored label outside the three choices is not reported as a change', async () => {
    setup({ matrix: { QA: { 'audit-trail': 'Approved By', filters: 'Verified By' } } });
    await ready();
    expect(saveBtn()).toBeDisabled();
  });

  it('Save PUTs the matrix and confirms; the saved state becomes the baseline', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await ready();
    fireEvent.change(cell('Filters', 1), { target: { value: 'Reviewed By' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), W);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ QA: { 'audit-trail': 'Approved By' }, MANAGER: { filters: 'Reviewed By' } });
    expect(await ackMessage('Saved')).toContain('Report signatories updated for all roles.');
    await waitFor(() => expect(saveBtn()).toBeDisabled());
    expect(cell('Filters', 1).value).toBe('Reviewed By');
  });

  it('a refused save reports the server message and keeps the edit', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 403, body: { error: 'FORBIDDEN', message: 'CONFIG_UPDATE required' } }] });
    await ready();
    fireEvent.change(cell('Filters', 0), { target: { value: 'Reviewed By' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('CONFIG_UPDATE required');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await ready();
    fireEvent.change(cell('Filters', 0), { target: { value: 'Reviewed By' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('pw-sig');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), W);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-sig');
    expect(retry.json).toEqual({ QA: { 'audit-trail': 'Approved By', filters: 'Reviewed By' }, _currentPassword: 'pw-sig' });
    await ackMessage('Saved');
  });

  it('signature required up front names UPDATE_REPORT_SIGNATORIES; cancel is silent and frees Save', async () => {
    const api = setup({ reauth: ['UPDATE_REPORT_SIGNATORIES'] });
    await ready();
    await catalogLoaded(api);
    fireEvent.change(cell('Filters', 0), { target: { value: 'Reviewed By' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Report Signatories" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Save failed' })).toBeNull();
    expect(saveBtn()).toHaveTextContent('Save Changes');
    expect(saveBtn()).not.toBeDisabled();
  });
});
