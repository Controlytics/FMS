import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce } from './fm-test-kit';
import {
  setupApi, renderFilters, openBlock, openFiltersTab, row, field, card, cancelReauth, waitForReauthConfig, ADMIN_ALL, makeTree, F,
} from './filter-list-fixtures';

usePageTestLifecycle();

const EDITOR = role('SUPERVISOR', ['ASSET_READ', 'FILTER_CREATE', 'FILTER_EDIT', 'FILTER_DELETE']);

describe('Filters page — Create Filter', () => {
  it('POSTs the typed body: name, AHU, set, chosen field options, last-cleaning date', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/hierarchy/filters', status: 201, body: { id: 'new' } }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    const dlg = card('Create Filter');
    const submit = within(dlg).getByRole('button', { name: 'Create Filter' });
    expect(submit).toBeDisabled();
    // two AHUs in the block → nothing preselected; the area picker narrows the list
    const ahuSel = field('AHU', dlg) as HTMLSelectElement;
    expect(ahuSel.value).toBe('');
    expect(within(ahuSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select AHU...', 'AHU-01', 'AHU-02']);
    fireEvent.change(field(/^Area/, dlg), { target: { value: 'ar1' } });
    expect(within(field('AHU', dlg)).getAllByRole('option').map((o) => o.textContent)).toEqual(['Select AHU...', 'AHU-01']);
    fireEvent.change(field('AHU', dlg), { target: { value: 'h1' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: '  PF-010 ' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Set B' }));
    fireEvent.change(field('AHU Type', dlg), { target: { value: 'Non Process' } });
    fireEvent.change(field('Filter Type', dlg), { target: { value: 'HEPA' } });
    fireEvent.change(field(/Micron Size/, dlg), { target: { value: '5' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g. 610×610×292mm'), { target: { value: '305x305' } });
    fireEvent.change(field('Last Cleaning Date', dlg), { target: { value: '2026-09-15' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Filter Created')).toBeInTheDocument();
    // the toast names what was created: the trimmed name, as sent
    expect(screen.getByText('"PF-010" added')).toBeInTheDocument();
    expect(api.calls('POST', '/api/hierarchy/filters')[0].json).toEqual({
      name: 'PF-010', ahuId: 'h1', filterSet: 'B', ahuType: 'Non Process', filterType: 'HEPA', micronSize: '5', filterSize: '305x305', lastCleaningDate: '2026-09-15',
    });
    expect(screen.queryByRole('heading', { name: 'Create Filter' })).toBeNull();
  });

  it('NA last-cleaning date is sent as "NA"; changing Area clears the chosen AHU', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/hierarchy/filters', status: 201, body: {} }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    const dlg = card('Create Filter');
    fireEvent.change(field('AHU', dlg), { target: { value: 'h2' } });
    fireEvent.change(field(/^Area/, dlg), { target: { value: 'ar1' } });
    expect((field('AHU', dlg) as HTMLSelectElement).value).toBe('');
    fireEvent.change(field(/^Area/, dlg), { target: { value: '' } });
    fireEvent.change(field('AHU', dlg), { target: { value: 'h2' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: 'HF-008' } });
    fireEvent.change(field('Last Cleaning Date', dlg), { target: { value: '2026-01-01' } });
    fireEvent.click(within(dlg).getByRole('checkbox'));
    expect(field('Last Cleaning Date', dlg)).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Filter' }));
    await screen.findByText('Filter Created');
    expect(api.calls('POST', '/api/hierarchy/filters')[0].json).toEqual({ name: 'HF-008', ahuId: 'h2', filterSet: 'A', lastCleaningDate: 'NA' });
  });

  it('scoped to one AHU from the diagram, that AHU is preselected', async () => {
    renderFilters(EDITOR, setupApi());
    await openBlock();
    fireEvent.click(screen.getByRole('button', { name: /AHU-02/ }));
    await screen.findByText('AHU: AHU-02');
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    expect((field('AHU', card('Create Filter')) as HTMLSelectElement).value).toBe('h2');
    // header ✕ closes
    fireEvent.click(within(card('Create Filter')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create Filter' })).toBeNull();
  });

  it('a 409 (duplicate name) stays in the dialog as an inline error', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/hierarchy/filters', status: 409, body: { error: 'DUPLICATE_NAME', message: 'Filter name PF-001 is already in use' } }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    const dlg = card('Create Filter');
    fireEvent.change(field('AHU', dlg), { target: { value: 'h1' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: 'PF-001' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Filter' }));
    expect(await within(dlg).findByText('Filter name PF-001 is already in use')).toBeInTheDocument();
    expect(within(dlg).getByRole('button', { name: 'Create Filter' })).toBeEnabled();
  });

  it('create under re-auth: 401 REAUTH_REQUIRED → prompt → signed retry', async () => {
    const api = setupApi({ extra: [reauthOnce('POST', '/api/hierarchy/filters'), { method: 'POST', path: '/api/hierarchy/filters', status: 201, body: {} }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Create Filter' }));
    const dlg = card('Create Filter');
    fireEvent.change(field('AHU', dlg), { target: { value: 'h1' } });
    fireEvent.change(within(dlg).getByPlaceholderText('e.g., Pre-Filter-01'), { target: { value: 'PF-011' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create Filter' }));
    await passReauth();
    expect(await screen.findByText('Filter Created')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/hierarchy/filters')[1]);
  });

  it('Create Filter is hidden without FILTER_CREATE', async () => {
    renderFilters(role('X', ['FILTER_EDIT']), setupApi());
    await openFiltersTab();
    expect(screen.queryByRole('button', { name: 'Create Filter' })).toBeNull();
  });
});

describe('Filters page — Edit Filter (FILTER_EDIT)', () => {
  it('prefills from the row and PUTs /api/hierarchy/filters/:id with cleared fields as ""', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/hierarchy/filters/f1', body: {} }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Edit Filter'));
    const dlg = card('Edit Filter');
    expect(within(dlg).getByDisplayValue('PF-001')).toBeInTheDocument();
    expect((field('AHU Type', dlg) as HTMLSelectElement).value).toBe('Process');
    expect((field('Filter Type', dlg) as HTMLSelectElement).value).toBe('Pre');
    expect((field('Last Cleaning Date', dlg) as HTMLInputElement).value).toBe('2026-09-01');
    expect(within(dlg).queryByText('Status')).toBeNull(); // no SA extension
    fireEvent.change(field('Filter Type', dlg), { target: { value: '' } });
    fireEvent.change(field('Last Cleaning Date', dlg), { target: { value: '' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Set B' }));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('"PF-001" saved')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/hierarchy/filters/f1')[0].json).toEqual({
      name: 'PF-001', filterSet: 'B', ahuType: 'Process', filterType: '', micronSize: '10', filterSize: '610x610', lastCleaningDate: '',
    });
  });

  it('a set-less filter is NOT assigned Set A on save; NA date round-trips; empty name is refused inline', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/hierarchy/filters/f7', body: {} }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('HF-007')).getByTitle('Edit Filter'));
    const dlg = card('Edit Filter');
    const name = within(dlg).getByDisplayValue('HF-007');
    fireEvent.change(name, { target: { value: '  ' } });
    expect(within(dlg).getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    fireEvent.change(name, { target: { value: 'HF-007' } });
    fireEvent.click(within(dlg).getByRole('checkbox')); // NA
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Filter Updated');
    const body = api.calls('PUT', '/api/hierarchy/filters/f7')[0].json;
    expect(body).not.toHaveProperty('filterSet');
    expect(body).toMatchObject({ name: 'HF-007', filterType: 'HEPA', ahuType: '', lastCleaningDate: 'NA' });
  });

  it('a server refusal is shown in the dialog; cancelling the password prompt is silent', async () => {
    const api = setupApi({
      base: { reauthActions: ['EDIT_FILTER'] },
      extra: [{ method: 'PUT', path: '/api/hierarchy/filters/f2', status: 400, body: { error: 'INVALID_OPTION', message: 'micronSize "7" is not a configured option' } }],
    });
    renderFilters(EDITOR, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('Edit Filter'));
    let dlg = card('Edit Filter');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await cancelReauth();
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Save Changes' })).toBeEnabled());
    expect(within(dlg).queryByText(/Cancelled|Failed/)).toBeNull();
    expect(api.calls('PUT', '/api/hierarchy/filters/f2')).toHaveLength(0);

    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await passReauth();
    dlg = card('Edit Filter');
    expect(await within(dlg).findByText('micronSize "7" is not a configured option')).toBeInTheDocument();
    expectSigned(api.calls('PUT', '/api/hierarchy/filters/f2')[0]);
  });
});

describe('Filters page — Edit Filter (SUPER_ADMIN)', () => {
  it('sends only side-effect fields that changed, normalises the RFID, requires a ≥5-char reason', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/super-admin/filter-data/filters/f1', body: {} }] });
    renderFilters(SA, api);
    await openFiltersTab();
    const btn = await waitFor(() => within(row('PF-001')).getByTitle('Edit Filter (Super Admin)'));
    fireEvent.click(btn);
    const dlg = card('Edit Filter (Super Admin)');
    const save = within(dlg).getByRole('button', { name: 'Save Changes' });
    expect(save).toBeDisabled(); // no reason yet
    expect(save).toHaveAttribute('title', 'Enter a reason of at least 5 characters');
    // area/AHU preselected from the row; AHU list = AHUs of the chosen area
    expect((field('Area', dlg) as HTMLSelectElement).value).toBe('ar1');
    expect((field('AHU', dlg) as HTMLSelectElement).value).toBe('h1');
    fireEvent.change(field('Area', dlg), { target: { value: '' } });
    expect((field('AHU', dlg) as HTMLSelectElement).value).toBe('');
    expect(within(field('AHU', dlg)).getAllByRole('option').map((o) => o.textContent)).toEqual(['-- select AHU --', 'AHU-01', 'AHU-02']);
    expect(save).toBeDisabled(); // no AHU
    fireEvent.change(field('AHU', dlg), { target: { value: 'h2' } });
    // status change reveals the cleaning-reason picker (inactive reasons are not offered)
    fireEvent.change(field('Status', dlg), { target: { value: 'DRY_IN' } });
    const reasonSel = field(/Cleaning reason/, dlg);
    expect(within(reasonSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['-- none --', 'Preventive']);
    fireEvent.change(reasonSel, { target: { value: 'PM' } });
    fireEvent.change(within(dlg).getByPlaceholderText('Blank = no tag'), { target: { value: 'e200bbe200bb' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Moved' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(await screen.findByText('"PF-001" saved and recorded in the audit trail')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/filters/f1')[0].json).toEqual({
      _changeReason: 'Moved', name: 'PF-001', ahuType: 'Process', filterType: 'Pre', micronSize: '10', filterSize: '610x610', lastCleaningDate: '2026-09-01',
      ahuId: 'h2', lifecycleState: 'DRY_IN', cleaningReasonKey: 'PM', rfidNumber: 'E200BB',
    });
  });

  it('an untouched edit sends no ahuId / lifecycleState / rfidNumber / filterSet; "None" clears the set', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: /\/api\/super-admin\/filter-data\/filters\//, body: {} }] });
    renderFilters(SA, api);
    await openFiltersTab();
    fireEvent.click(await waitFor(() => within(row('PF-001')).getByTitle('Edit Filter (Super Admin)')));
    let dlg = card('Edit Filter (Super Admin)');
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'No-op save' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Filter Updated');
    expect(api.calls('PUT', '/api/super-admin/filter-data/filters/f1')[0].json).toEqual({
      _changeReason: 'No-op save', name: 'PF-001', ahuType: 'Process', filterType: 'Pre', micronSize: '10', filterSize: '610x610', lastCleaningDate: '2026-09-01',
    });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    fireEvent.click(within(row('PF-002')).getByTitle('Edit Filter (Super Admin)'));
    dlg = card('Edit Filter (Super Admin)');
    fireEvent.click(within(dlg).getByRole('button', { name: 'None' }));
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Set unknown' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/filter-data/filters/f2')).toHaveLength(1));
    expect(api.calls('PUT', '/api/super-admin/filter-data/filters/f2')[0].json).toMatchObject({ filterSet: '', _changeReason: 'Set unknown' });
  });

  it('a lifecycle-retired row hides Area/AHU; a status unknown to the list is still offered; refusal shown inline', async () => {
    const tree = makeTree({ ahu1Filters: [F.pf1, { ...F.pf6, status: 'Retired' }] });
    // a status:'Retired' filter is not listed at all; use PF-006 (lifecycle RETIRED, status Active) for the dialog
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/super-admin/filter-data/filters/f7', status: 409, body: { error: 'STAGE_SEQUENCE', message: 'Invalid stage movement' } }] });
    void tree;
    renderFilters(SA, api);
    await openFiltersTab();
    fireEvent.click(await waitFor(() => within(row('HF-007')).getByTitle('Edit Filter (Super Admin)')));
    const dlg = card('Edit Filter (Super Admin)');
    const status = field('Status', dlg) as HTMLSelectElement;
    expect(status.value).toBe('CUSTOM_STATE');
    expect(within(status).getAllByRole('option')[1]).toHaveTextContent('CUSTOM_STATE');
    // direct-under-block AHU: no area chosen, AHU list = whole block
    expect((field('Area', dlg) as HTMLSelectElement).value).toBe('');
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Fix state' } });
    fireEvent.change(status, { target: { value: 'WASH_IN' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(await within(dlg).findByText('Invalid stage movement')).toBeInTheDocument();
  });

  it('SA edit on a status:Retired filter dialog hides the hierarchy pickers', async () => {
    // EditFilterRef.status drives showHierarchy; the lifecycle-RETIRED row carries status "Active",
    // so craft a row whose status is literally "Retired" but is still active in the tree.
    const tree = makeTree({ ahu1Filters: [F.pf1, { ...F.pf6, id: 'f66', name: 'PF-066', status: 'Retired', isActive: true }] });
    renderFilters(SA, setupApi({ tree }));
    await openFiltersTab();
    // status 'Retired' rows are excluded from the list entirely
    expect(screen.queryByText('PF-066')).toBeNull();
  });

  it('cancelling the SA re-auth unlocks Save without an error', async () => {
    const api = setupApi({ base: { reauthActions: ['SUPER_ADMIN_DATA_EDIT'] } });
    renderFilters(SA, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(await waitFor(() => within(row('PF-002')).getByTitle('Edit Filter (Super Admin)')));
    const dlg = card('Edit Filter (Super Admin)');
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Rename it' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await cancelReauth();
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Save Changes' })).toBeEnabled());
    expect(within(dlg).queryByText(/Cancelled/)).toBeNull();
  });
});

describe('Filters page — Delete Filter', () => {
  it('DELETE /api/hierarchy/filters/:id after confirmation; Cancel sends nothing', async () => {
    const api = setupApi({ extra: [{ method: 'DELETE', path: '/api/hierarchy/filters/f2', status: 204 }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('Delete Filter'));
    expect(within(card('Delete Filter')).getByText(/Permanently delete/)).toHaveTextContent('"PF-002"');
    fireEvent.click(within(card('Delete Filter')).getByRole('button', { name: 'Cancel' }));
    expect(api.calls('DELETE', '/api/hierarchy/filters/f2')).toHaveLength(0);
    fireEvent.click(within(row('PF-002')).getByTitle('Delete Filter'));
    fireEvent.click(within(card('Delete Filter')).getByRole('button', { name: 'Delete Filter' }));
    expect(await screen.findByText('"PF-002" removed')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/hierarchy/filters/f2')).toHaveLength(1);
  });

  it('a refused delete toasts the reason; a cancelled prompt is silent and re-enables the button', async () => {
    const api = setupApi({
      base: { reauthActions: ['DELETE_FILTER'] },
      extra: [{ method: 'DELETE', path: '/api/hierarchy/filters/f1', status: 409, body: { error: 'HAS_HISTORY', message: 'Filter has cleaning cycles' } }],
    });
    renderFilters(EDITOR, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Delete Filter'));
    fireEvent.click(within(card('Delete Filter')).getByRole('button', { name: 'Delete Filter' }));
    await cancelReauth();
    await waitFor(() => expect(within(card('Delete Filter')).getByRole('button', { name: 'Delete Filter' })).toBeEnabled());
    expect(screen.queryByText('Delete failed')).toBeNull();
    fireEvent.click(within(card('Delete Filter')).getByRole('button', { name: 'Delete Filter' }));
    await passReauth();
    expect(await screen.findByText('Filter has cleaning cycles')).toBeInTheDocument();
    expectSigned(api.calls('DELETE', '/api/hierarchy/filters/f1')[0]);
  });
});

describe('Filters page — a REJECTED filter', () => {
  it('offers Correct / Delete / Resubmit to its creator; Resubmit POSTs /resubmit', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/f5/resubmit', body: {} }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    const r5 = row('PF-005');
    expect(within(r5).getByTitle('Correct this rejected filter')).toBeInTheDocument();
    expect(within(r5).getByTitle('Delete Filter')).toBeInTheDocument();
    expect(within(r5).queryByTitle('Update Status')).toBeNull();
    fireEvent.click(within(r5).getByRole('button', { name: 'Resubmit' }));
    expect(await screen.findByText('PF-005 resubmitted')).toBeInTheDocument();
    expect(screen.getByText('It is back in Pending Review.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/f5/resubmit')[0].json).toEqual({});
  });

  // 2026-10-24: a Super Admin's own resubmission is approved at once; the API says so.
  it('when the API answers APPROVED the message says it is approved, not back in review', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/f5/resubmit', body: { resubmitted: 'PF-005', approvalStatus: 'APPROVED' } }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-005')).getByRole('button', { name: 'Resubmit' }));
    expect(await screen.findByText('PF-005 resubmitted')).toBeInTheDocument();
    expect(screen.getByText('It is approved: a resubmission by the Super Admin needs no review.')).toBeInTheDocument();
    expect(screen.queryByText('It is back in Pending Review.')).toBeNull();
  });

  it('Correct opens the edit dialog prefilled; NA last-cleaning decodes to the NA box', async () => {
    renderFilters(EDITOR, setupApi());
    await openFiltersTab();
    fireEvent.click(within(row('PF-005')).getByTitle('Correct this rejected filter'));
    const dlg = card('Edit Filter');
    expect(within(dlg).getByDisplayValue('PF-005')).toBeInTheDocument();
    expect(within(dlg).getByRole('checkbox')).toBeChecked();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(row('PF-005')).getByTitle('Delete Filter'));
    expect(card('Delete Filter')).toBeInTheDocument();
  });

  it('a refused resubmit toasts "Resubmit failed"; a signed resubmit under re-auth', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/assets/instances/f5/resubmit', status: 409, times: 1, body: { error: 'NOT_REJECTED', message: 'Filter is not rejected' } },
      reauthOnce('POST', '/api/assets/instances/f5/resubmit'),
      { method: 'POST', path: '/api/assets/instances/f5/resubmit', body: {} },
    ] });
    renderFilters(ADMIN_ALL, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-005')).getByRole('button', { name: 'Resubmit' }));
    expect(await screen.findByText('Resubmit failed')).toBeInTheDocument();
    expect(screen.getByText('Filter is not rejected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(within(row('PF-005')).getByRole('button', { name: 'Resubmit' }));
    await passReauth();
    expect(await screen.findByText('PF-005 resubmitted')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/assets/instances/f5/resubmit')[2]);
  });

  it('a cancelled resubmit prompt does nothing', async () => {
    const api = setupApi({ base: { reauthActions: ['RESUBMIT_FILTER'] } });
    renderFilters(ADMIN_ALL, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-005')).getByRole('button', { name: 'Resubmit' }));
    await cancelReauth();
    expect(screen.queryByText('Resubmit failed')).toBeNull();
    expect(api.calls('POST', '/api/assets/instances/f5/resubmit')).toHaveLength(0);
  });
});

describe('Filters page — success toasts name the saved (trimmed) filter', () => {
  it('Edit Filter: a padded name is saved trimmed and the toast says so', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/hierarchy/filters/f1', body: {} }] });
    renderFilters(EDITOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Edit Filter'));
    const dlg = card('Edit Filter');
    fireEvent.change(within(dlg).getByDisplayValue('PF-001'), { target: { value: '  PF-001X ' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('"PF-001X" saved')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/hierarchy/filters/f1')[0].json.name).toBe('PF-001X');
  });

  it('SUPER_ADMIN edit: a padded name is saved trimmed and the toast says so', async () => {
    const api = setupApi({ extra: [{ method: 'PUT', path: '/api/super-admin/filter-data/filters/f1', body: {} }] });
    renderFilters(SA, api);
    await openFiltersTab();
    fireEvent.click(await waitFor(() => within(row('PF-001')).getByTitle('Edit Filter (Super Admin)')));
    const dlg = card('Edit Filter (Super Admin)');
    fireEvent.change(within(dlg).getByDisplayValue('PF-001'), { target: { value: ' PF-001Y  ' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Renamed' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByText('"PF-001Y" saved and recorded in the audit trail')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/filters/f1')[0].json.name).toBe('PF-001Y');
  });
});
