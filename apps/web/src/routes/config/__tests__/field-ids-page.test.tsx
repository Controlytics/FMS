import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { FieldIdsPage } from '../field-ids';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const LIST = '/api/config/field-ids';
const FIELDS = [
  { id: '1', fieldId: 'FLD_USER_001', defaultName: 'Username', displayName: 'Login ID', module: 'User Management', description: 'Sign-in name', updatedAt: '2026-10-01T10:00:00Z', updatedBy: 'superadmin' },
  { id: '2', fieldId: 'FLD_USER_002', defaultName: 'Full Name', displayName: 'Full Name', module: 'User Management', updatedAt: '2026-10-01T10:00:00Z' },
  { id: '3', fieldId: 'FLD_AUDIT_001', defaultName: 'Action', displayName: 'Action', module: 'Audit Trail', description: 'What was done', updatedAt: '2026-10-01T10:00:00Z' },
  { id: '4', fieldId: 'FLD_FILTER_001', defaultName: 'Filter Tag', displayName: 'Filter Tag', module: 'Filter Operations', updatedAt: '2026-10-01T10:00:00Z' },
];

function setup(opts: { extra?: MockRoute[]; data?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: LIST, body: opts.data ?? FIELDS },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<FieldIdsPage />, { user: SUPER_ADMIN, api, route: '/config/display-settings' });
  return api;
}

const rowOf = (fieldId: string) => screen.getByText(fieldId).closest('div.group') as HTMLElement;
const search = () => screen.getByPlaceholderText('Search by field ID, display name, or module...');

describe('Field IDs panel', () => {
  it('shows a loading state, then fields grouped by module with counts', async () => {
    const api = setup();
    expect(screen.getByText('Loading field configurations...')).toBeInTheDocument();
    expect(await screen.findByText('FLD_USER_001')).toBeInTheDocument();
    expect(screen.getByText('Configure display names for system field identifiers across all modules (3 modules · 4 fields). Edit a field and Save it inline.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Modules (4)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'User Management (2)' })).toBeInTheDocument();
    // Module headings in alphabetical order, with a plural / singular count.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Audit Trail', 'Filter Operations', 'User Management']);
    expect(screen.getByText('2 fields')).toBeInTheDocument();
    expect(screen.getAllByText('1 field')).toHaveLength(2);
    // Renamed field shows its default + Reset; untouched one does not.
    expect(within(rowOf('FLD_USER_001')).getByText('(default: Username)')).toBeInTheDocument();
    expect(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })).toBeInTheDocument();
    expect(within(rowOf('FLD_USER_002')).queryByRole('button', { name: /Reset/ })).toBeNull();
    expect(within(rowOf('FLD_USER_001')).getByText('Sign-in name')).toBeInTheDocument();
    expect(within(rowOf('FLD_USER_001')).getByText(/Updated by/)).toHaveTextContent('Updated by superadmin on');
    expect(within(rowOf('FLD_USER_002')).queryByText(/Updated by/)).toBeNull();
    expect(screen.getByText('3 modules configured')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('an empty catalogue says nothing is configured', async () => {
    setup({ data: [] });
    expect(await screen.findByText('No fields found')).toBeInTheDocument();
    expect(screen.getByText('No field IDs have been configured yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Modules (0)' })).toBeInTheDocument();
  });

  it('search matches id, name, module and description; Clear resets it', async () => {
    setup();
    await screen.findByText('FLD_USER_001');
    fireEvent.change(search(), { target: { value: 'what was' } });
    expect(screen.getByText('FLD_AUDIT_001')).toBeInTheDocument();
    expect(screen.queryByText('FLD_USER_001')).toBeNull();
    expect(screen.getByText('matching fields', { exact: false })).toHaveTextContent('Found 1 matching fields');
    fireEvent.change(search(), { target: { value: 'login id' } });
    expect(screen.getByText('FLD_USER_001')).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: 'filter operations' } });
    expect(screen.getByText('FLD_FILTER_001')).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: 'fld_user' } });
    expect(screen.getByText('matching fields', { exact: false })).toHaveTextContent('Found 2 matching fields');
    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(screen.getByText('No fields found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your search query')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
    expect((search() as HTMLInputElement).value).toBe('');
    expect(screen.getByText('FLD_USER_001')).toBeInTheDocument();
  });

  it('module tabs filter, toggle off on a second click, and All resets', async () => {
    setup();
    await screen.findByText('FLD_USER_001');
    fireEvent.click(screen.getByRole('button', { name: 'Audit Trail (1)' }));
    expect(screen.queryByText('FLD_USER_001')).toBeNull();
    expect(screen.getByText('FLD_AUDIT_001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Audit Trail (1)' }));
    expect(screen.getByText('FLD_USER_001')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filter Operations (1)' }));
    expect(screen.queryByText('FLD_AUDIT_001')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All Modules (4)' }));
    expect(screen.getByText('FLD_AUDIT_001')).toBeInTheDocument();
  });

  it('Edit then Save PUTs the trimmed name and leaves edit mode', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: '/api/config/field-ids/FLD_USER_002', body: { ok: true } }] });
    await screen.findByText('FLD_USER_002');
    fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: /Edit/ }));
    const input = within(rowOf('FLD_USER_002')).getByDisplayValue('Full Name');
    fireEvent.change(input, { target: { value: '  Operator Name  ' } });
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: 'Save' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_002')).toHaveLength(1));
    expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_002')[0].json).toEqual({ displayName: 'Operator Name' });
    await waitFor(() => expect(within(rowOf('FLD_USER_002')).queryByRole('textbox')).toBeNull());
    expect(within(rowOf('FLD_USER_002')).getByRole('button', { name: /Edit/ })).toBeInTheDocument();
  });

  it('Enter saves, Escape and Cancel discard, a blank name cannot be saved', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: '/api/config/field-ids/FLD_AUDIT_001', body: { ok: true } }] });
    await screen.findByText('FLD_AUDIT_001');
    const row = () => rowOf('FLD_AUDIT_001');
    fireEvent.click(within(row()).getByRole('button', { name: /Edit/ }));
    const input = within(row()).getByDisplayValue('Action');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(within(row()).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(api.calls('PUT', '/api/config/field-ids/FLD_AUDIT_001')).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(row()).queryByRole('textbox')).toBeNull();

    fireEvent.click(within(row()).getByRole('button', { name: /Edit/ }));
    fireEvent.click(within(row()).getByRole('button', { name: 'Cancel' }));
    expect(within(row()).queryByRole('textbox')).toBeNull();

    fireEvent.click(within(row()).getByRole('button', { name: /Edit/ }));
    const again = within(row()).getByDisplayValue('Action');
    fireEvent.change(again, { target: { value: 'Event' } });
    fireEvent.keyDown(again, { key: 'a' }); // other keys do nothing
    await act(async () => { fireEvent.keyDown(again, { key: 'Enter' }); });
    await waitFor(() => expect(api.calls('PUT', '/api/config/field-ids/FLD_AUDIT_001')).toHaveLength(1));
    expect(api.calls('PUT', '/api/config/field-ids/FLD_AUDIT_001')[0].json).toEqual({ displayName: 'Event' });
  });

  it('Reset PUTs the default name', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: '/api/config/field-ids/FLD_USER_001', body: { ok: true } }] });
    await screen.findByText('FLD_USER_001');
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })); });
    await waitFor(() => expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_001')).toHaveLength(1));
    expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_001')[0].json).toEqual({ displayName: 'Username' });
  });

  it('UPDATE_FIELD_ID signature: prompt, then PUT with the password', async () => {
    const api = setup({ reauth: ['UPDATE_FIELD_ID'], extra: [{ method: 'PUT', path: '/api/config/field-ids/FLD_USER_001', body: { ok: true } }] });
    await screen.findByText('FLD_USER_001');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ }));
    expect(await screen.findByText(/Performing "Update Field Label" requires identity verification/)).toBeInTheDocument();
    expect(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })).toBeDisabled();
    await signReauth('pw-f');
    await waitFor(() => expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_001')).toHaveLength(1));
    const put = api.calls('PUT', '/api/config/field-ids/FLD_USER_001')[0];
    expect(put.headers['x-reauth-password']).toBe('pw-f');
    expect(put.json).toEqual({ displayName: 'Username', _currentPassword: 'pw-f' });
    await waitFor(() => expect(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })).not.toBeDisabled());
  });

  it('cancelling the signature shows no error and frees the buttons (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ extra: [reauthRequired('PUT', '/api/config/field-ids/FLD_USER_002')] });
    await screen.findByText('FLD_USER_002');
    fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: /Edit/ }));
    fireEvent.change(within(rowOf('FLD_USER_002')).getByDisplayValue('Full Name'), { target: { value: 'Name' } });
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: 'Save' })); });
    await cancelReauth();
    await waitFor(() => expect(within(rowOf('FLD_USER_002')).getByRole('button', { name: 'Save' })).not.toBeDisabled());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_002')).toHaveLength(1);
  });

  it('cancelling an up-front signature on Reset sends nothing and reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ reauth: ['UPDATE_FIELD_ID'] });
    await screen.findByText('FLD_USER_001');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })); });
    expect(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })).toBeDisabled();
    await cancelReauth();
    await waitFor(() => expect(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })).not.toBeDisabled());
    expectSilentCancel(consoleError);
    expect(api.calls('PUT', '/api/config/field-ids/FLD_USER_001')).toHaveLength(0);
  });

  it('empty server messages fall back to the save / reset wording', async () => {
    setup({ extra: [
      { method: 'PUT', path: '/api/config/field-ids/FLD_USER_002', status: 400, body: { error: 'X', message: '' } },
      { method: 'PUT', path: '/api/config/field-ids/FLD_USER_001', status: 400, body: { error: 'X', message: '' } },
    ] });
    await screen.findByText('FLD_USER_002');
    fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: /Edit/ }));
    fireEvent.change(within(rowOf('FLD_USER_002')).getByDisplayValue('Full Name'), { target: { value: 'N' } });
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: 'Save' })); });
    expect(await screen.findByText('Failed to save field name')).toBeInTheDocument();
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })); });
    expect(await screen.findByText('Failed to reset field name')).toBeInTheDocument();
  });

  it('a refused save / reset shows a dismissible error', async () => {
    setup({
      extra: [
        { method: 'PUT', path: '/api/config/field-ids/FLD_USER_002', status: 400, body: { error: 'VALIDATION_ERROR', message: 'displayName too long' } },
        { method: 'PUT', path: '/api/config/field-ids/FLD_USER_001', status: 404, body: { error: 'NOT_FOUND', message: 'Field not found' } },
      ],
    });
    await screen.findByText('FLD_USER_002');
    fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: /Edit/ }));
    fireEvent.change(within(rowOf('FLD_USER_002')).getByDisplayValue('Full Name'), { target: { value: 'x'.repeat(300) } });
    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_002')).getByRole('button', { name: 'Save' })); });
    const msg = await screen.findByText('displayName too long');
    // Still in edit mode after a failure.
    expect(within(rowOf('FLD_USER_002')).getByRole('textbox')).toBeInTheDocument();
    const banner = msg.closest('div.flex') as HTMLElement;
    fireEvent.click(within(banner).getByRole('button'));
    expect(screen.queryByText('displayName too long')).toBeNull();

    await act(async () => { fireEvent.click(within(rowOf('FLD_USER_001')).getByRole('button', { name: /Reset/ })); });
    expect(await screen.findByText('Field not found')).toBeInTheDocument();
  });
});
