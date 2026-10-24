import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RequireRole } from '@/components/require-role';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { FilterDataManagementPage } from '../filter-data-management';
import { resetEnv, signReauth, cancelReauth, ackMessage, reauthRequired } from './config-test-helpers';
import {
  renderFdm, baseRoutes, modal, field, setField, typeReason, reasonBox, click, row, waitForCalls, openTab,
} from './fdm-helpers';

afterEach(resetEnv);

const RET = '/api/super-admin/filter-data/retirements';
const REP = '/api/super-admin/filter-data/replacements';

describe('Filter Data Management — access', () => {
  it('a non-SUPER_ADMIN role sees "Access Restricted" and no data is requested', async () => {
    const api = mockApi(baseRoutes());
    // Rendered bare (no RequireRole) to exercise the page's own guard.
    renderPage(<FilterDataManagementPage />, { user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] }, api });
    expect(await screen.findByRole('heading', { name: 'Access Restricted' })).toBeInTheDocument();
    expect(screen.getByText('This page is available to Super Admin only.')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: 'Filter Data Management' })).toBeNull();
  });

  it('SUPER_ADMIN gets the console on the Retirements tab with the record count and no unexpected requests', async () => {
    const api = renderFdm([]);
    expect(await screen.findByRole('heading', { name: 'Filter Data Management' })).toBeInTheDocument();
    expect(await screen.findByText('FLT-001')).toBeInTheDocument();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
    // Header record count = filtered retirements.
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('2');
    // Original parent + set badge / placeholders, formatted retirement time in UTC.
    expect(within(row('FLT-001')).getByText('AHU-01')).toBeInTheDocument();
    expect(within(row('FLT-001')).getByText('Set A')).toBeInTheDocument();
    expect(within(row('FLT-001')).getByText('2026-07-15 09:30')).toBeInTheDocument();
    expect(within(row('FLT-002')).getAllByText('--')).toHaveLength(2);
    // Retirements tab has no status filter, only the date range.
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.getByLabelText('Records from date')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });
});

describe('Filter Data Management — retirements list', () => {
  it('shows the empty state, and "No results found" when a search matches nothing', async () => {
    renderFdm([], { retirements: [] });
    expect(await screen.findByText('No retired filters')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'zzz' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
    // A filter is active -> "Clear all filters" appears and resets it.
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(screen.getByText('No retired filters')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('Search...') as HTMLInputElement).value).toBe('');
  });

  it('search narrows by name; the date range filters client-side on retiredAt/updatedAt', async () => {
    renderFdm([]);
    await screen.findByText('FLT-001');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'flt-002' } });
    expect(screen.queryByText('FLT-001')).toBeNull();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    // FLT-002 retiredAt = 2026-08-02 -> a To of 2026-08-01 excludes it; FLT-001 (07-15) stays.
    fireEvent.change(screen.getByLabelText('Records to date'), { target: { value: '2026-08-01' } });
    expect(screen.getByText('FLT-001')).toBeInTheDocument();
    expect(screen.queryByText('FLT-002')).toBeNull();
    // A bare To covers the whole day: 2026-07-15 keeps the 09:30 retirement.
    fireEvent.change(screen.getByLabelText('Records to date'), { target: { value: '2026-07-15' } });
    expect(screen.getByText('FLT-001')).toBeInTheDocument();
    // From after both -> nothing.
    fireEvent.change(screen.getByLabelText('Records to date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-09-01' } });
    expect(screen.getByText('No retired filters')).toBeInTheDocument();
  });

  it('rows without a usable date are dropped once a range is set', async () => {
    renderFdm([], { retirements: [
      { id: 'x1', name: 'NO-DATE', updatedAt: null, filterSet: null, preRetireParentId: null, preRetireParentName: null },
      { id: 'x2', name: 'BAD-DATE', updatedAt: 'not-a-date', filterSet: null, preRetireParentId: null, preRetireParentName: null },
      { id: 'x3', name: 'GOOD', updatedAt: '2026-07-10T00:00:00.000Z', filterSet: null, preRetireParentId: null, preRetireParentName: null },
    ] });
    await screen.findByText('NO-DATE');
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-01-01' } });
    expect(screen.queryByText('NO-DATE')).toBeNull();
    expect(screen.queryByText('BAD-DATE')).toBeNull();
    expect(screen.getByText('GOOD')).toBeInTheDocument();
  });

  it('pages client-side with the configured page sizes', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`, name: `PAGED-${i}`, updatedAt: `2026-07-0${i + 1}T00:00:00.000Z`, filterSet: null, preRetireParentId: null, preRetireParentName: null,
    }));
    renderFdm([], { retirements: many });
    await screen.findByText('PAGED-0');
    // Default page size 20 -> all 5 on one page.
    expect(screen.getByText('PAGED-4')).toBeInTheDocument();
    // Rows: 2 -> page 1 shows two rows; next page shows the next two.
    await waitFor(() => expect(screen.getByRole('option', { name: '2' })).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '2' } });
    expect(screen.getByText('PAGED-1')).toBeInTheDocument();
    expect(screen.queryByText('PAGED-2')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('PAGED-2')).toBeInTheDocument();
    expect(screen.queryByText('PAGED-0')).toBeNull();
  });

  it('shows the loading state while the list is in flight', async () => {
    const api = mockApi([...baseRoutes()]);
    const stubbed = globalThis.fetch;
    // The retirements request never answers.
    vi.stubGlobal('fetch', (input: any, init?: any) => (String(typeof input === 'string' ? input : input.url).includes('/api/filters/retirements')
      ? new Promise(() => {}) : (stubbed as any)(input, init)));
    renderPage(<RequireRole roles={[]}><FilterDataManagementPage /></RequireRole>, { user: { role: 'SUPER_ADMIN' }, api });
    expect(await screen.findByText('Loading records...')).toBeInTheDocument();
    expect(screen.queryByText('No retired filters')).toBeNull();
  });
});

describe('Filter Data Management — edit a retirement record', () => {
  async function startEdit() {
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Edit/ }));
    const r = screen.getByDisplayValue('FLT-001').closest('tr') as HTMLElement;
    return r;
  }

  it('inline edit opens a reason prompt; Save is refused until the reason has 5 characters, then PUTs _changeReason', async () => {
    const api = renderFdm([{ method: 'PUT', path: `${RET}/r1`, body: { ok: true } }]);
    const r = await startEdit();
    fireEvent.change(within(r).getByDisplayValue('FLT-001'), { target: { value: 'FLT-001-B' } });
    fireEvent.change(within(r).getByDisplayValue('Set A'), { target: { value: 'SET_B' } });
    fireEvent.change(within(r).getByDisplayValue('2026-07-15T09:30'), { target: { value: '2026-07-16T10:00' } });
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    expect(within(dlg).getByText('FLT-001')).toBeInTheDocument();
    const confirm = within(dlg).getByRole('button', { name: 'Save changes' });
    expect(confirm).toBeDisabled();
    typeReason(dlg, 'typo');
    expect(within(dlg).getByText('1 more character required')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('title', 'Enter a reason for this change');
    typeReason(dlg, 'Corrected the name');
    expect(confirm).not.toBeDisabled();
    await click(confirm);
    const [put] = await waitForCalls(api, 'PUT', `${RET}/r1`, 1);
    expect(put.json).toEqual({ name: 'FLT-001-B', filterSet: 'SET_B', updatedAt: '2026-07-16T10:00:00.000Z', _changeReason: 'Corrected the name' });
    expect(put.json).not.toHaveProperty('reason');
    expect(await ackMessage('Updated')).toContain('Retirement record updated and audited');
    expect(screen.queryByRole('heading', { name: 'Edit retirement record' })).toBeNull();
    // Back to display mode, list refreshed (global mutate is a no-op on the harness cache; display mode proves the reset).
    expect(screen.queryByDisplayValue('FLT-001-B')).toBeNull();
  });

  it('Cancel leaves edit mode without a request', async () => {
    const api = renderFdm([]);
    const r = await startEdit();
    await click(within(r).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByDisplayValue('FLT-001')).toBeNull();
    expect(api.calls('PUT', /retirements/)).toHaveLength(0);
  });

  it('a whitespace-padded reason is trimmed before it is sent', async () => {
    const api = renderFdm([{ method: 'PUT', path: `${RET}/r1`, body: {} }]);
    const r = await startEdit();
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    typeReason(dlg, '   ab   ');
    expect(within(dlg).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    typeReason(dlg, '  audit fix  ');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${RET}/r1`, 1);
    expect(put.json._changeReason).toBe('audit fix');
  });

  it('server demands a signature: the password is sent on the retry and the prompt closes', async () => {
    const api = renderFdm([reauthRequired('PUT', `${RET}/r1`), { method: 'PUT', path: `${RET}/r1`, body: {} }]);
    const r = await startEdit();
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    typeReason(dlg, 'Fix the set');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await signReauth('pw-ret');
    const puts = await waitForCalls(api, 'PUT', `${RET}/r1`, 2);
    expect(puts[1].headers['x-reauth-password']).toBe('pw-ret');
    expect(puts[1].json).toMatchObject({ _changeReason: 'Fix the set', _currentPassword: 'pw-ret' });
    await ackMessage('Updated');
  });

  it('cancelling the signature keeps the reason prompt open and shows no error', async () => {
    const api = renderFdm([], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    const r = await startEdit();
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    typeReason(dlg, 'Fix the set');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await cancelReauth();
    // Prompt still open, buttons usable again, nothing sent.
    expect(screen.getByRole('heading', { name: 'Edit retirement record' })).toBeInTheDocument();
    expect(within(modal('Edit retirement record')).getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Failed' })).toBeNull();
    expect(api.calls('PUT', /retirements/)).toHaveLength(0);
    // The reason prompt's own Cancel closes it.
    await click(within(modal('Edit retirement record')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit retirement record' })).toBeNull();
  });

  it('a refused save reports "Failed" with the server message and keeps the prompt', async () => {
    renderFdm([{ method: 'PUT', path: `${RET}/r1`, status: 400, body: { error: 'VALIDATION', message: 'Name already in use' } }]);
    const r = await startEdit();
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    typeReason(dlg, 'Rename it');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await ackMessage('Failed')).toContain('Name already in use');
    expect(screen.getByRole('heading', { name: 'Edit retirement record' })).toBeInTheDocument();
  });
});

describe('Filter Data Management — delete a retirement record', () => {
  it('DELETE carries _changeReason in the body; success is confirmed', async () => {
    const api = renderFdm([{ method: 'DELETE', path: `${RET}/r2`, body: {} }]);
    await screen.findByText('FLT-002');
    await click(within(row('FLT-002')).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Delete retirement record');
    expect(dlg).toHaveTextContent('Its FILTER_RETIRED audit record is kept');
    typeReason(dlg, 'Duplicate import');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    const [del] = await waitForCalls(api, 'DELETE', `${RET}/r2`, 1);
    expect(del.json).toEqual({ _changeReason: 'Duplicate import' });
    expect(await ackMessage('Deleted')).toContain('Retirement record removed and audited');
  });

  it('409 HAS_HISTORY is surfaced verbatim so the operator learns what is attached', async () => {
    renderFdm([{ method: 'DELETE', path: `${RET}/r1`, status: 409, body: { error: 'HAS_HISTORY', message: 'Filter still has 3 cleaning cycles, 12 filter events and 1 identifier' } }]);
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Delete retirement record');
    typeReason(dlg, 'Remove dup');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    expect(await ackMessage('Failed')).toContain('Filter still has 3 cleaning cycles, 12 filter events and 1 identifier');
  });

  it('signed delete sends the password in header and body', async () => {
    const api = renderFdm([{ method: 'DELETE', path: `${RET}/r2`, body: {} }], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await screen.findByText('FLT-002');
    await click(within(row('FLT-002')).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Delete retirement record');
    typeReason(dlg, 'Duplicate import');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    // Gated up front by /my-actions: nothing sent before the password.
    expect(api.calls('DELETE', `${RET}/r2`)).toHaveLength(0);
    await signReauth('pw-del');
    const [del] = await waitForCalls(api, 'DELETE', `${RET}/r2`, 1);
    expect(del.headers['x-reauth-password']).toBe('pw-del');
    expect(del.json).toEqual({ _changeReason: 'Duplicate import', _currentPassword: 'pw-del' });
  });
});

describe('Filter Data Management — restore (unretire)', () => {
  it('shows the original parent, requires a reason and POSTs to /unretire', async () => {
    const api = renderFdm([{ method: 'POST', path: `${RET}/r1/unretire`, body: {} }]);
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Restore/ }));
    const dlg = modal('Restore Filter');
    expect(dlg).toHaveTextContent('Original parent: AHU-01 — will be auto-restored');
    const go = within(dlg).getByRole('button', { name: 'Restore Filter' });
    expect(go).toBeDisabled();
    expect(go).toHaveAttribute('title', 'Enter a reason for restoring this filter');
    typeReason(dlg, 'Retired by mistake');
    await click(go);
    const [post] = await waitForCalls(api, 'POST', `${RET}/r1/unretire`, 1);
    // No parent picked -> parentId omitted (server auto-restores the original parent).
    expect(post.json).toEqual({ _changeReason: 'Retired by mistake' });
    expect(await ackMessage('Unretired')).toContain('Filter restored to Active status');
    expect(screen.queryByRole('heading', { name: 'Restore Filter' })).toBeNull();
  });

  it('a filter with no recorded parent shows no parent line; Cancel closes without a request', async () => {
    const api = renderFdm([]);
    await screen.findByText('FLT-002');
    await click(within(row('FLT-002')).getByRole('button', { name: /Restore/ }));
    const dlg = modal('Restore Filter');
    expect(dlg).not.toHaveTextContent('Original parent');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Restore Filter' })).toBeNull();
    expect(api.calls('POST', /unretire/)).toHaveLength(0);
  });

  it('409 PARENT_INACTIVE is shown as an error; a signature cancel is silent', async () => {
    renderFdm([{ method: 'POST', path: `${RET}/r1/unretire`, status: 409, body: { error: 'PARENT_INACTIVE', message: 'Original parent AHU-01 is deactivated' } }]);
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Restore/ }));
    const dlg = modal('Restore Filter');
    typeReason(dlg, 'Bring it back');
    await click(within(dlg).getByRole('button', { name: 'Restore Filter' }));
    expect(await ackMessage('Error')).toContain('Original parent AHU-01 is deactivated');
    // Dialog stays for another attempt.
    expect(screen.getByRole('heading', { name: 'Restore Filter' })).toBeInTheDocument();
  });

  it('signature required up front: cancel leaves the dialog open and re-enables the button', async () => {
    const api = renderFdm([], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Restore/ }));
    const dlg = modal('Restore Filter');
    typeReason(dlg, 'Bring it back');
    await click(within(dlg).getByRole('button', { name: 'Restore Filter' }));
    await cancelReauth();
    await waitFor(() => expect(within(modal('Restore Filter')).getByRole('button', { name: 'Restore Filter' })).not.toBeDisabled());
    expect(screen.queryByRole('heading', { name: 'Error' })).toBeNull();
    expect(api.calls('POST', /unretire/)).toHaveLength(0);
  });

  it('signed restore sends the password', async () => {
    const api = renderFdm([{ method: 'POST', path: `${RET}/r1/unretire`, body: {} }], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Restore/ }));
    const dlg = modal('Restore Filter');
    typeReason(dlg, 'Bring it back');
    await click(within(dlg).getByRole('button', { name: 'Restore Filter' }));
    await signReauth('pw-un');
    const [post] = await waitForCalls(api, 'POST', `${RET}/r1/unretire`, 1);
    expect(post.headers['x-reauth-password']).toBe('pw-un');
  });
});

describe('Filter Data Management — manual retirement record', () => {
  const FILTERS = { data: [
    { id: 'f1', name: 'LIVE-1', status: 'Active' },
    { id: 'f2', name: 'GONE-2', status: 'Retired' },
  ] };

  it('offers only non-retired filters, refuses a missing filter, then POSTs the record', async () => {
    const api = renderFdm([
      { path: '/api/hierarchy/filters', body: FILTERS },
      { method: 'POST', path: RET, body: {} },
    ]);
    await screen.findByText('FLT-001');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create retirement record');
    expect(dlg).toHaveTextContent('Retires an existing filter and records when, by whom and why.');
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'LIVE-1' })).toBeInTheDocument());
    expect(within(dlg).queryByRole('option', { name: 'GONE-2' })).toBeNull();
    const create = within(dlg).getByRole('button', { name: 'Create Record' });
    expect(create).toBeDisabled();
    typeReason(dlg, 'Back-dated retirement');
    // No filter chosen -> client-side refusal, nothing sent.
    await click(create);
    expect(await ackMessage('Missing field')).toContain('Select the filter being retired');
    expect(api.calls('POST', RET)).toHaveLength(0);

    setField(dlg, 'Filter being retired', 'f1');
    setField(dlg, 'Retired On', '2026-06-01T08:15');
    setField(dlg, 'Performed By', 'Night shift');
    setField(dlg, 'Remarks', 'Torn media');
    await click(create);
    const [post] = await waitForCalls(api, 'POST', RET, 1);
    expect(post.json).toEqual({
      filterId: 'f1', remarks: 'Torn media', retiredAt: '2026-06-01T08:15:00.000Z', performedBy: 'Night shift', _changeReason: 'Back-dated retirement',
    });
    expect(await ackMessage('Created')).toContain('Retirement record added and audited');
    expect(screen.queryByRole('heading', { name: 'Create retirement record' })).toBeNull();
  });

  it('optional fields left blank are omitted; a server refusal reports "Create failed"', async () => {
    const api = renderFdm([
      { path: '/api/hierarchy/filters', body: FILTERS },
      { method: 'POST', path: RET, status: 409, body: { error: 'HAS_ACTIVE_CYCLE', message: 'Filter has an active cycle' } },
    ]);
    await screen.findByText('FLT-001');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create retirement record');
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'LIVE-1' })).toBeInTheDocument());
    setField(dlg, 'Filter being retired', 'f1');
    typeReason(dlg, 'Back-dated retirement');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', RET, 1);
    expect(post.json).toEqual({ filterId: 'f1', _changeReason: 'Back-dated retirement' });
    expect(await ackMessage('Create failed')).toContain('Filter has an active cycle');
    expect(screen.getByRole('heading', { name: 'Create retirement record' })).toBeInTheDocument();
  });

  it('Cancel closes the dialog; a signature cancel leaves it open without an error', async () => {
    const api = renderFdm([{ path: '/api/hierarchy/filters', body: FILTERS }], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await screen.findByText('FLT-001');
    await click(screen.getByRole('button', { name: 'Create' }));
    let dlg = modal('Create retirement record');
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'LIVE-1' })).toBeInTheDocument());
    setField(dlg, 'Filter being retired', 'f1');
    typeReason(dlg, 'Back-dated retirement');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    await cancelReauth();
    dlg = modal('Create retirement record');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Create Record' })).not.toBeDisabled());
    expect(screen.queryByRole('heading', { name: 'Create failed' })).toBeNull();
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create retirement record' })).toBeNull();
    expect(api.calls('POST', RET)).toHaveLength(0);
  });
});

describe('Filter Data Management — replacements tab', () => {
  it('lists replacement records with struck-through old filter, short ids and "--" for no remarks', async () => {
    const api = renderFdm([]);
    await openTab('Replacements');
    expect(await screen.findByText('FLT-OLD')).toHaveClass('line-through');
    const r = row('FLT-OLD');
    expect(within(r).getByText('old-uuid...')).toHaveAttribute('title', 'old-uuid-1234567');
    expect(within(r).getByText('new-uuid...')).toBeInTheDocument();
    expect(within(r).getByText('jdoe')).toBeInTheDocument();
    expect(within(r).getByText('damaged')).toBeInTheDocument();
    expect(within(r).getByText('2026-07-20 08:00')).toBeInTheDocument();
    expect(within(row('FLT-A')).getByText('--')).toBeInTheDocument();
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('2');
    expect(api.unmatched).toEqual([]);
  });

  it('search covers old, new and performer names; empty-state text depends on search', async () => {
    renderFdm([], { replacements: [] });
    await openTab('Replacements');
    expect(await screen.findByText('No replacement records')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'x' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('search matches on the new filter name and the performer; date range filters on replacedAt', async () => {
    renderFdm([]);
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'flt-b' } });
    expect(screen.queryByText('FLT-OLD')).toBeNull();
    expect(screen.getByText('FLT-A')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'JDOE' } });
    expect(screen.getByText('FLT-OLD')).toBeInTheDocument();
    expect(screen.queryByText('FLT-A')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-08-01' } });
    expect(screen.queryByText('FLT-OLD')).toBeNull();
    expect(screen.getByText('FLT-A')).toBeInTheDocument();
  });

  it('switching tabs clears search and filters', async () => {
    renderFdm([]);
    await screen.findByText('FLT-001');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'zzz' } });
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-01-01' } });
    await openTab('Replacements');
    expect((screen.getByPlaceholderText('Search...') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Records from date') as HTMLInputElement).value).toBe('');
    expect(await screen.findByText('FLT-OLD')).toBeInTheDocument();
  });

  it('editing warns that the hash chain breaks, and PUTs only the edited fields with _changeReason', async () => {
    const api = renderFdm([{ method: 'PUT', path: `${REP}/p1`, body: { chainBroken: true } }]);
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    await click(within(row('FLT-OLD')).getByRole('button', { name: /Edit/ }));
    const r = screen.getByDisplayValue('FLT-OLD').closest('tr') as HTMLElement;
    fireEvent.change(within(r).getByDisplayValue('damaged'), { target: { value: 'seal failure' } });
    fireEvent.change(within(r).getByDisplayValue('2026-07-20T08:00'), { target: { value: '2026-07-21T09:45' } });
    fireEvent.change(within(r).getByDisplayValue('jdoe'), { target: { value: 'jdoe2' } });
    fireEvent.change(within(r).getByDisplayValue('FLT-NEW'), { target: { value: 'FLT-NEW2' } });
    fireEvent.change(within(r).getByDisplayValue('new-uuid-7654321'), { target: { value: 'new-uuid-x' } });
    fireEvent.change(within(r).getByDisplayValue('old-uuid-1234567'), { target: { value: 'old-uuid-x' } });
    fireEvent.change(within(r).getByDisplayValue('FLT-OLD'), { target: { value: 'FLT-OLD2' } });
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit replacement record');
    expect(dlg).toHaveTextContent('This change breaks the audit hash chain from this record onward');
    expect(dlg).toHaveTextContent('FLT-OLD to FLT-NEW');
    typeReason(dlg, 'Correct remarks');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${REP}/p1`, 1);
    expect(put.json).toEqual({
      remarks: 'seal failure', performedBy: 'jdoe2', replacedAt: '2026-07-21T09:45:00.000Z',
      oldFilterId: 'old-uuid-x', oldFilterName: 'FLT-OLD2', newFilterId: 'new-uuid-x', newFilterName: 'FLT-NEW2',
      _changeReason: 'Correct remarks',
    });
    expect(await ackMessage('Updated')).toContain('Replacement record updated and audited');
  });

  it('Cancel on the inline edit returns to display mode', async () => {
    renderFdm([]);
    await openTab('Replacements');
    await screen.findByText('FLT-A');
    await click(within(row('FLT-A')).getByRole('button', { name: /Edit/ }));
    const r = screen.getByDisplayValue('FLT-A').closest('tr') as HTMLElement;
    // remarks null -> empty input
    expect(within(r).getAllByRole('textbox').some((i) => (i as HTMLInputElement).value === '')).toBe(true);
    await click(within(r).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByDisplayValue('FLT-A')).toBeNull();
  });

  it('deleting warns about the chain and sends _changeReason; failure is reported', async () => {
    const api = renderFdm([{ method: 'DELETE', path: `${REP}/p2`, status: 500, body: { error: 'INTERNAL', message: 'trigger re-enable failed' } }]);
    await openTab('Replacements');
    await screen.findByText('FLT-A');
    await click(within(row('FLT-A')).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Delete replacement record');
    expect(dlg).toHaveTextContent('will disappear from the audit trail too');
    expect(dlg).toHaveTextContent('permanently');
    typeReason(dlg, 'Wrong record entirely');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    const [del] = await waitForCalls(api, 'DELETE', `${REP}/p2`, 1);
    expect(del.json).toEqual({ _changeReason: 'Wrong record entirely' });
    expect(await ackMessage('Failed')).toContain('trigger re-enable failed');
  });

  it('a successful delete is confirmed', async () => {
    renderFdm([{ method: 'DELETE', path: `${REP}/p1`, body: {} }]);
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    await click(within(row('FLT-OLD')).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Delete replacement record');
    typeReason(dlg, 'Wrong record entirely');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    expect(await ackMessage('Deleted')).toContain('Replacement record removed and audited');
  });

  it('signed replacement edit and delete send the password', async () => {
    const api = renderFdm([
      { method: 'PUT', path: `${REP}/p1`, body: {} },
      { method: 'DELETE', path: `${REP}/p1`, body: {} },
    ], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    await click(within(row('FLT-OLD')).getByRole('button', { name: /Edit/ }));
    const r = screen.getByDisplayValue('FLT-OLD').closest('tr') as HTMLElement;
    await click(within(r).getByRole('button', { name: /Save/ }));
    let dlg = modal('Edit replacement record');
    typeReason(dlg, 'Correct remarks');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await signReauth('pw-rep');
    const [put] = await waitForCalls(api, 'PUT', `${REP}/p1`, 1);
    expect(put.headers['x-reauth-password']).toBe('pw-rep');
    await ackMessage('Updated');

    await click(within(row('FLT-OLD')).getByRole('button', { name: /Delete/ }));
    dlg = modal('Delete replacement record');
    typeReason(dlg, 'Wrong record entirely');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    await signReauth('pw-rep2');
    const [del] = await waitForCalls(api, 'DELETE', `${REP}/p1`, 1);
    expect(del.headers['x-reauth-password']).toBe('pw-rep2');
    expect(del.json).toEqual({ _changeReason: 'Wrong record entirely', _currentPassword: 'pw-rep2' });
  });
});

describe('Filter Data Management — manual replacement record', () => {
  const FILTERS = { data: [{ id: 'a', name: 'A-1', status: 'Retired' }, { id: 'b', name: 'B-2', status: 'Active' }] };

  it('requires both filters, then POSTs the replacement with the reason', async () => {
    const api = renderFdm([
      { path: '/api/hierarchy/filters', body: FILTERS },
      { method: 'POST', path: REP, body: {} },
    ]);
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create replacement record');
    expect(dlg).toHaveTextContent('Records a filter swap that happened outside the app.');
    // Both lists include retired filters.
    await waitFor(() => expect(within(field(dlg, 'Filter that was replaced') as any).getByRole('option', { name: 'A-1' })).toBeInTheDocument());
    typeReason(dlg, 'Swap done on paper');
    setField(dlg, 'Filter that was replaced', 'a');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    expect(await ackMessage('Missing field')).toContain('Select both the replaced and the replacement filter');
    expect(api.calls('POST', REP)).toHaveLength(0);

    setField(dlg, 'Filter that replaced it', 'b');
    setField(dlg, 'Replaced On', '2026-05-05T05:05');
    setField(dlg, 'Performed By', 'Contractor');
    setField(dlg, 'Remarks', 'Planned swap');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', REP, 1);
    expect(post.json).toEqual({
      oldFilterId: 'a', newFilterId: 'b', remarks: 'Planned swap', replacedAt: '2026-05-05T05:05:00.000Z', performedBy: 'Contractor', _changeReason: 'Swap done on paper',
    });
    expect(await ackMessage('Created')).toContain('Replacement record added and audited');
  });

  it('omits blank optional fields and signs when required', async () => {
    const api = renderFdm([
      { path: '/api/hierarchy/filters', body: FILTERS },
      { method: 'POST', path: REP, body: {} },
    ], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create replacement record');
    await waitFor(() => expect(within(field(dlg, 'Filter that replaced it') as any).getByRole('option', { name: 'B-2' })).toBeInTheDocument());
    setField(dlg, 'Filter that was replaced', 'a');
    setField(dlg, 'Filter that replaced it', 'b');
    typeReason(dlg, 'Swap done on paper');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    await signReauth('pw-man');
    const [post] = await waitForCalls(api, 'POST', REP, 1);
    expect(post.json).toEqual({ oldFilterId: 'a', newFilterId: 'b', _changeReason: 'Swap done on paper', _currentPassword: 'pw-man' });
    expect(post.headers['x-reauth-password']).toBe('pw-man');
  });

  it('reopening the dialog starts with empty fields and an empty reason', async () => {
    renderFdm([{ path: '/api/hierarchy/filters', body: FILTERS }]);
    await openTab('Replacements');
    await screen.findByText('FLT-OLD');
    await click(screen.getByRole('button', { name: 'Create' }));
    let dlg = modal('Create replacement record');
    typeReason(dlg, 'something long');
    setField(dlg, 'Remarks', 'x');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await click(screen.getByRole('button', { name: 'Create' }));
    dlg = modal('Create replacement record');
    expect(reasonBox(dlg).value).toBe('');
    expect((field(dlg, 'Remarks') as any).value).toBe('');
  });
});
