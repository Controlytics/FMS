import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { ExportOptionsPage } from '../export-options';
import { EXPORT_SURFACES } from '@/lib/export-surfaces';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

vi.setConfig({ testTimeout: 30000 });
afterEach(resetEnv);

const PATH = '/api/config/export-options';
const W = { timeout: 5000 };
const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin' },
  { name: 'OPERATOR', displayName: 'Operator' },
  { name: 'AUDITOR', displayName: '' },
];

function setup(opts: { matrix?: unknown; roles?: unknown; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: PATH, body: opts.matrix ?? { OPERATOR: { audit: 'PDF', filters: 'NONE' } } },
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<ExportOptionsPage />, { user: SUPER_ADMIN, api });
  return api;
}

async function catalogLoaded(api: MockApi) {
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const cell = (surfaceLabel: string, col: number) => {
  const row = screen.getByRole('cell', { name: surfaceLabel }).closest('tr') as HTMLElement;
  return within(row).getAllByRole('combobox')[col] as HTMLSelectElement;
};
const setAll = (col: number) => within(screen.getAllByRole('columnheader')[col + 1]).getByRole('combobox') as HTMLSelectElement;
const saveBtn = () => screen.getByRole('button', { name: /Save Changes|Saving/ });
async function ready() {
  await waitFor(() => expect(cell('Audit Trail', 0).value).toBe('PDF'), W);
}

describe('Export options panel', () => {
  it('shows each page against each role except SUPER_ADMIN; unset cells read "Both"', async () => {
    const api = setup();
    await ready();
    const headers = screen.getAllByRole('columnheader').map((h) => h.firstChild?.textContent);
    expect(headers).toEqual(['Page', 'Operator', 'AUDITOR']);
    expect(screen.getAllByRole('row')).toHaveLength(EXPORT_SURFACES.length + 1);
    expect(cell('Filters', 0).value).toBe('NONE');
    expect(cell('Filters', 1).value).toBe('BOTH');
    expect(saveBtn()).toBeDisabled();
    expect(api.unmatched).toEqual([]);
  });

  it('with no editable roles it says so', async () => {
    setup({ roles: [] });
    expect(await screen.findByText('No roles to configure.', undefined, W)).toBeInTheDocument();
  });

  it('a change and its undo leave Save disabled; "set all…" fills the role\'s column', async () => {
    setup();
    await ready();
    fireEvent.change(cell('Deviations', 1), { target: { value: 'EXCEL' } });
    expect(saveBtn()).not.toBeDisabled();
    fireEvent.change(cell('Deviations', 1), { target: { value: 'BOTH' } });
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(setAll(1), { target: { value: '' } });
    expect(saveBtn()).toBeDisabled();
    fireEvent.change(setAll(1), { target: { value: 'NONE' } });
    for (const s of EXPORT_SURFACES) expect(cell(s.label, 1).value).toBe('NONE');
    expect(cell('Audit Trail', 0).value).toBe('PDF');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('an unknown stored format does not count as a change', async () => {
    setup({ matrix: { OPERATOR: { audit: 'PDF', filters: 'CSV' } } });
    await ready();
    expect(saveBtn()).toBeDisabled();
  });

  it('Save PUTs the matrix, confirms, and the saved state becomes the baseline', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: PATH, body: { ok: true } }] });
    await ready();
    fireEvent.change(cell('Deviations', 1), { target: { value: 'PDF' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(1), W);
    expect(api.calls('PUT', PATH)[0].json).toEqual({ OPERATOR: { audit: 'PDF', filters: 'NONE' }, AUDITOR: { deviations: 'PDF' } });
    expect(await ackMessage('Saved')).toContain('Export options updated for all roles.');
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('a refused save reports the server message', async () => {
    setup({ extra: [{ method: 'PUT', path: PATH, status: 500, body: { error: 'INTERNAL', message: 'write failed' } }] });
    await ready();
    fireEvent.change(cell('Deviations', 1), { target: { value: 'PDF' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('write failed');
    expect(saveBtn()).not.toBeDisabled();
  });

  it('server demands a signature: prompts, then retries with the password', async () => {
    const api = setup({ extra: [reauthRequired('PUT', PATH), { method: 'PUT', path: PATH, body: { ok: true } }] });
    await ready();
    fireEvent.change(cell('Deviations', 1), { target: { value: 'PDF' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('pw-exp');
    await waitFor(() => expect(api.calls('PUT', PATH)).toHaveLength(2), W);
    const retry = api.calls('PUT', PATH)[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-exp');
    expect(retry.json._currentPassword).toBe('pw-exp');
    expect(retry.json.AUDITOR).toEqual({ deviations: 'PDF' });
    await ackMessage('Saved');
  });

  it('signature required up front: cancel sends nothing, shows no failure, frees Save', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await ready();
    await catalogLoaded(api);
    fireEvent.change(cell('Deviations', 1), { target: { value: 'PDF' } });
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(screen.getByText(/Performing "Update Configuration Page" requires identity verification/)).toBeInTheDocument();
    expect(saveBtn()).toHaveTextContent('Saving…');
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Changes'));
    expect(api.calls('PUT', PATH)).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Save failed' })).toBeNull();
    expect(saveBtn()).not.toBeDisabled();
  });
});
