/**
 * Filters page — edge cases and the less-travelled branches: alternative
 * response shapes the page tolerates, signed (re-auth) variants of every
 * write not covered elsewhere, and the bulk-result wording variants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce } from './fm-test-kit';
import {
  setupApi, renderFilters, openBlock, openFiltersTab, row, field, panel, card, cancelReauth, waitForReauthConfig, rawCalls, makeTree, F,
} from './filter-list-fixtures';

vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { exportToExcel } from '@/lib/excel-export';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(exportToExcel).mockReset(); });

const OPS = role('SUPERVISOR', ['ASSET_READ', 'FILTER_RETIRE', 'FILTER_REPLACE', 'FILTER_STATUS_UPDATE', 'FILTER_RFID_MANAGE',
  'FILTER_HIERARCHY_DELETE', 'FILTER_BULK_UPLOAD', 'FILTER_LIST_EXPORT']);
const bulkBar = () => screen.getByText(/filter\(s\) selected/).closest('.rounded-xl') as HTMLElement;
const opt = (state: string, classification: string, extra: Record<string, unknown> = {}) =>
  ({ state, classification, allowed: classification !== 'SKIP', isCurrent: classification === 'SAME', startsCycle: false, ...extra });

describe('Filters page — tolerated response shapes', () => {
  it('identifiers as a bare array; tree nodes without areas/ahus/filters keys; a filter with no status/attributes', async () => {
    const tree = [
      { id: 'b1', name: 'Block Alpha', ahus: [{ id: 'h2', name: 'AHU-02', filters: [{ id: 'f7', name: 'HF-007', approvalStatus: 'APPROVED' }] }, { id: 'h3', name: 'AHU-03' }] },
      { id: 'b3', name: 'Block Bare' },
    ];
    const api = setupApi({ tree, identifiers: [{ id: 'i7', assetId: 'f7', identifierType: 'RFID', identifierValue: 'E2007777' }] });
    renderFilters(SA, api);
    expect(await screen.findByText('Block Bare')).toBeInTheDocument();
    expect(screen.getByText('With RFID').parentElement).toHaveTextContent('1');
    await openFiltersTab('Block Alpha', 'HF-007');
    const r = row('HF-007');
    expect(r).toHaveTextContent('E2007777');
    expect(r).toHaveTextContent('To Be Cleaned');
  });

  it('an identifiers response that is neither {data} nor an array counts as no tags', async () => {
    renderFilters(SA, setupApi({ identifiers: { unexpected: true } }));
    expect(await screen.findByText('With RFID')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('With RFID').parentElement).toHaveTextContent('0'));
  });

  it('SA edit: a stored state outside the manual list but known to the labels is offered by its label; empty reasons list', async () => {
    const tree = makeTree({ ahu1Filters: [F.pf1, { ...F.pf2, currentLifecycleState: 'IN_USE' }] });
    const api = setupApi({ tree, extra: [{ path: '/api/filters/reasons', body: {} }] });
    renderFilters(SA, api);
    await openFiltersTab();
    expect(row('PF-002')).toHaveTextContent('In Use');
    fireEvent.click(await waitFor(() => within(row('PF-002')).getByTitle('Edit Filter (Super Admin)')));
    const dlg = card('Edit Filter (Super Admin)');
    const status = field('Status', dlg) as HTMLSelectElement;
    expect(status.value).toBe('IN_USE');
    expect(within(status).getAllByRole('option')[1]).toHaveTextContent('In Use');
    fireEvent.change(status, { target: { value: 'WASH_IN' } });
    expect(within(field(/Cleaning reason/, dlg)).getAllByRole('option')).toHaveLength(1);
  });

  it('a symbol-only block name falls back to "filters" in the export file name', async () => {
    const tree = [{ id: 'b1', name: '!!!', areas: [], ahus: [{ id: 'h2', name: 'AHU-02', filters: [F.hf7] }] }];
    const api = setupApi({ tree, extra: [{ method: 'POST', path: '/api/audit/report-export-log', status: 201, body: {} }] });
    renderFilters(OPS, api);
    await openFiltersTab('!!!', 'HF-007');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expect(vi.mocked(exportToExcel).mock.calls[0][0].filename).toBe('filters-filters');
  });
});

describe('Filters page — signed variants', () => {
  it('hierarchy delete, RFID assign and SA edit each send the password once the server asks', async () => {
    const api = setupApi({ extra: [
      reauthOnce('DELETE', '/api/assets/instances/ar1'),
      { method: 'DELETE', path: '/api/assets/instances/ar1', status: 204 },
      reauthOnce('POST', '/api/assets/identifiers'),
      { method: 'POST', path: '/api/assets/identifiers', status: 201, body: {} },
      reauthOnce('PUT', '/api/super-admin/filter-data/filters/f2'),
      { method: 'PUT', path: '/api/super-admin/filter-data/filters/f2', body: {} },
    ] });
    renderFilters(SA, api);
    await openBlock();
    fireEvent.click(screen.getByTitle('Delete Area'));
    fireEvent.click(within(card('Delete Area')).getByRole('button', { name: 'Delete Area' }));
    await passReauth();
    expect(await screen.findByText('Area "Area North" removed')).toBeInTheDocument();
    expectSigned(api.calls('DELETE', '/api/assets/instances/ar1')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await screen.findByText('PF-002');
    fireEvent.click(within(row('PF-002')).getByTitle('RFID Tag'));
    fireEvent.change(screen.getByPlaceholderText('Scan RFID tag or type tag ID...'), { target: { value: 'E2001234' } });
    fireEvent.click(within(panel('RFID Tag Management')).getByRole('button', { name: 'Assign Tag' }));
    await passReauth();
    expect(await screen.findByText('Tag "E2001234" assigned to PF-002')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/assets/identifiers')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(panel('RFID Tag Management').previousElementSibling as HTMLElement);

    fireEvent.click(within(row('PF-002')).getByTitle('Edit Filter (Super Admin)'));
    const dlg = card('Edit Filter (Super Admin)');
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Signed edit' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await passReauth();
    expect(await screen.findByText('Filter Updated')).toBeInTheDocument();
    expectSigned(api.calls('PUT', '/api/super-admin/filter-data/filters/f2')[1]);
  });
});

describe('Filters page — bulk result wording', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ ...F.pf2, id: `m${i}`, name: `MF-${i + 1}` }));

  it('bulk status: more than six skipped filters are summarised "+N more"; a justification is forwarded', async () => {
    const api = setupApi({ tree: makeTree({ ahu1Filters: eight, ahu2Filters: [] }), extra: [
      { path: /\/api\/filters\/m\d\/stage-options/, body: { hasProfile: true, options: [opt('WASH_IN', 'START', { startsCycle: true })], cleaningReasons: [{ key: 'BD', name: 'Breakdown', requiresJustification: true }] } },
      { method: 'PATCH', path: /\/api\/assets\/instances\/m\d\/lifecycle-state/, status: 409, body: { error: 'X', message: 'Not approved yet' } },
    ] });
    renderFilters(OPS, api);
    await openFiltersTab('Block Alpha', 'MF-1');
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    const p = panel('Bulk Status Update');
    await waitFor(() => expect(within(field('New Status', p)).getByRole('option', { name: 'Wash In' })).toBeEnabled());
    fireEvent.change(field('Cleaning Reason', p), { target: { value: 'BD' } });
    fireEvent.change(field('Justification', p), { target: { value: 'Short' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Batch' } });
    const submit = within(p).getByRole('button', { name: 'Update 8 Filter(s)' });
    expect(submit).toBeDisabled();
    fireEvent.change(field('Justification', p), { target: { value: 'Flood in AHU room overnight' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Bulk Status Update — none updated')).toBeInTheDocument();
    expect(screen.getByText(/• Not approved yet — MF-1, MF-2, MF-3, MF-4, MF-5, MF-6 \+2 more/)).toBeInTheDocument();
    expect(api.calls('PATCH', '/api/assets/instances/m0/lifecycle-state')[0].json).toEqual({
      lifecycleState: 'WASH_IN', remarks: 'Batch', cleaningReasonKey: 'BD', cleaningJustification: 'Flood in AHU room overnight',
    });
  });

  it('bulk status: a cancelled prompt is reported (fallback onError) and the panel unlocks', async () => {
    const api = setupApi({ base: { reauthActions: ['UPDATE_FILTER_LIFECYCLE'] }, extra: [
      { path: /\/api\/filters\/f\d\/stage-options/, body: { hasProfile: true, options: [opt('CLEANING_CYCLE_COMPLETED', 'COMPLETE')] } },
    ] });
    renderFilters(OPS, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    const p = panel('Bulk Status Update');
    await waitFor(() => expect(within(field('New Status', p)).getByRole('option', { name: 'Cleaning Cycle Completed' })).toBeEnabled());
    fireEvent.change(field('New Status', p), { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Close' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update 1 Filter(s)' }));
    await cancelReauth();
    expect(await screen.findByText('Update Failed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled — password confirmation was not completed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('Bulk Status Update')).getByRole('button', { name: 'Update 1 Filter(s)' })).toBeEnabled();
    expect(api.requests.filter((r) => r.method === 'PATCH')).toHaveLength(0);
  });

  it('single status to a profile stage outside the manual list is announced by its raw key', async () => {
    const api = setupApi({ extra: [
      { path: '/api/filters/f2/stage-options', body: { hasProfile: true, options: [opt('PRE_RINSE', 'FORWARD')], cleaningReasons: [] } },
      { method: 'PATCH', path: '/api/assets/instances/f2/lifecycle-state', body: {} },
    ] });
    renderFilters(OPS, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('Update Status'));
    const p = panel('Update Filter Status');
    await waitFor(() => expect(within(field('New Status', p)).getByRole('option', { name: 'PRE RINSE' })).toBeInTheDocument());
    fireEvent.change(field('New Status', p), { target: { value: 'PRE_RINSE' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Rinse' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update Status' }));
    expect(await screen.findByText('PF-002 updated to PRE_RINSE')).toBeInTheDocument();
  });

  it('bulk retire: every filter refused → "Bulk Retirement Failed"; bulk replace: all succeed → plain count', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: /\/api\/filters\/f\d\/retire/, status: 409, body: { error: 'X', message: 'Active cycle' } },
      { method: 'POST', path: /\/api\/filters\/f\d\/replace/, body: { newFilterName: 'n' } },
    ] });
    renderFilters(OPS, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Retire' }));
    fireEvent.change(within(panel('Bulk Retirement')).getByPlaceholderText('Enter reason for retirement...'), { target: { value: 'Old' } });
    fireEvent.click(within(panel('Bulk Retirement')).getByRole('button', { name: 'Retire 2 Filter(s)' }));
    expect(await screen.findByText('Bulk Retirement Failed')).toBeInTheDocument();
    expect(screen.getByText('2 filter(s) failed — Active cycle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Replace' }));
    fireEvent.change(within(panel('Bulk Replacement')).getByPlaceholderText('Enter reason for replacement...'), { target: { value: 'Swap' } });
    fireEvent.click(within(panel('Bulk Replacement')).getByRole('button', { name: 'Replace 1 Filter(s)' }));
    expect(await screen.findByText('1 filter(s) replaced')).toBeInTheDocument();
    expect(screen.getByText('Bulk Replacement')).toBeInTheDocument();
  });
});

describe('Filters page — bulk upload response fallbacks', () => {
  const pick = () => fireEvent.change(document.getElementById('bulk-upload-file-input') as HTMLInputElement, {
    target: { files: [new File(['x'], 'f.xlsx')] },
  });

  it('a validate response with rows only; an upload refused without a message; an upload with no counters', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { rows: [{ name: 'PF-040', ahu: 'AHU-01' }] } },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', status: 500, times: 1, body: {} },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', times: 1, body: {} },
      { method: 'POST', path: '/api/assets/instances/bulk-upload-filters', body: { created: 0, failed: 0, newAreas: ['Area Z'], results: [] } },
    ] });
    renderFilters(OPS, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d = card('Bulk Upload Filters');
    pick();
    fireEvent.click(await within(d).findByRole('button', { name: 'Upload 1 Filter' }));
    expect(await within(d).findByText('Upload failed')).toBeInTheDocument();
    // back to the picker for a second upload
    fireEvent.click(within(d).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d2 = card('Bulk Upload Filters');
    pick();
    fireEvent.click(await within(d2).findByRole('button', { name: 'Upload 1 Filter' }));
    await waitFor(() => expect(within(d2).getByRole('button', { name: 'Close' })).toBeInTheDocument());
    expect(within(d2).queryByText('Created', { selector: 'div' })).toBeNull();
    fireEvent.click(within(d2).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d3 = card('Bulk Upload Filters');
    pick();
    fireEvent.click(await within(d3).findByRole('button', { name: 'Upload 1 Filter' }));
    await waitFor(() => expect(d3).toHaveTextContent('Areas created (1): Area Z'));
    expect(rawCalls('/bulk-upload-filters').filter((c) => !c.url.includes('validate'))).toHaveLength(3);
  });

  it('message-less throws fall back to generic text (validate + upload); a non-JSON 400 template answer keeps the status', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: { rows: [{ name: 'A' }] } }] });
    renderFilters(OPS, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    const d = card('Bulk Upload Filters');
    const orig = globalThis.fetch;
    let mode: 'validate' | 'upload' | 'template' = 'validate';
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = String(input);
      if (mode === 'validate' && u.includes('/validate')) throw {};
      if (mode === 'upload' && u.endsWith('/bulk-upload-filters')) throw {};
      if (mode === 'template' && u.includes('filter-upload-template')) return new Response('<html>bad gateway</html>', { status: 400 });
      return orig(input, init);
    }) as any;
    pick();
    expect(await within(d).findByText('Failed to read the .xlsx file')).toBeInTheDocument();
    mode = 'upload';
    pick();
    // validation failed only for the first pick; the second reaches preview because mode moved on
    fireEvent.click(await within(d).findByRole('button', { name: 'Upload 1 Filter' }));
    expect(await within(d).findByText('Network error')).toBeInTheDocument();
    fireEvent.click(within(d).getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    mode = 'template';
    fireEvent.click(within(card('Bulk Upload Filters')).getByRole('button', { name: 'Download Excel Template' }));
    expect(await screen.findByText('HTTP 400')).toBeInTheDocument();
  });

  it('a JSON 400 template answer without a message keeps the status code', async () => {
    const api = setupApi({ extra: [{ path: '/api/assets/instances/filter-upload-template.xlsx', status: 400, body: {} }] });
    renderFilters(OPS, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    fireEvent.click(within(card('Bulk Upload Filters')).getByRole('button', { name: 'Download Excel Template' }));
    expect(await screen.findByText('HTTP 400')).toBeInTheDocument();
  });
});

describe('Filters page — remaining reachable paths', () => {
  it('area create with optional typed attributes: BOOLEAN / DATE / FLOAT are sent typed; blanks are dropped', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances', status: 201, body: {} }] });
    renderFilters(SA, api);
    await openBlock();
    fireEvent.click(screen.getByTitle('Add Area'));
    const dlg = card('Create Area');
    fireEvent.change(within(dlg).getByPlaceholderText('Enter area name...'), { target: { value: 'Area East' } });
    fireEvent.change(field(/is Critical/, dlg), { target: { value: 'true' } });
    fireEvent.change(field(/commissioned/, dlg), { target: { value: '2026-01-15' } });
    fireEvent.change(within(dlg).getByPlaceholderText('pressure'), { target: { value: '12.5' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Create' }));
    await screen.findByText('AREA "Area East" created');
    expect(api.calls('POST', '/api/assets/instances')[0].json.attributes).toEqual({ isCritical: 'true', commissioned: '2026-01-15', pressure: 12.5 });
  });

  it('a signed block delete', async () => {
    const api = setupApi({ extra: [reauthOnce('DELETE', '/api/assets/instances/b2'), { method: 'DELETE', path: '/api/assets/instances/b2', status: 204 }] });
    renderFilters(SA, api);
    await screen.findByText('Block Beta');
    fireEvent.click(screen.getAllByTitle('Delete block')[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await passReauth();
    expect(await screen.findByText('Block "Block Beta" deleted')).toBeInTheDocument();
    expectSigned(api.calls('DELETE', '/api/assets/instances/b2')[1]);
  });

  it('ticked PENDING_REVIEW rows → "Review selected" lists only the ticked ones', async () => {
    const tree = makeTree({ ahu1Filters: [F.pf1, F.pf3, { ...F.pf3, id: 'f8', name: 'PF-008' }], ahu2Filters: [] });
    const api = setupApi({ tree, extra: [{ method: 'POST', path: '/api/assets/instances/review', body: {} }] });
    renderFilters(role('MANAGER', ['ASSET_READ', 'FILTER_REVIEW']), api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-008')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Review selected (1)' }));
    const b = screen.getByTestId('filter-bulk-approval-dialog');
    expect(b).toHaveTextContent('1 filter(s) waiting for review');
    expect(within(b).queryByText('PF-003')).toBeNull();
    fireEvent.click(within(b).getByRole('button', { name: 'Complete Review (1)' }));
    expect(await screen.findByText('PF-008 reviewed')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/review')[0].json).toEqual({ filterIds: ['f8'] });
  });

  it('correcting a rejected filter that holds an RFID prefills the SA dialog tag; clearing the status sends no lifecycle move', async () => {
    const api = setupApi({
      identifiers: { data: [{ id: 'i5', assetId: 'f5', identifierType: 'RFID', identifierValue: 'e2005555' }] },
      extra: [{ method: 'PUT', path: '/api/super-admin/filter-data/filters/f1', body: {} }],
    });
    renderFilters(SA, api);
    await openFiltersTab();
    // SA holds create/edit/delete → the rejected row offers Correct
    fireEvent.click(await waitFor(() => within(row('PF-005')).getByTitle('Correct this rejected filter')));
    expect(within(card('Edit Filter (Super Admin)')).getByPlaceholderText('Blank = no tag')).toHaveValue('e2005555');
    fireEvent.click(within(card('Edit Filter (Super Admin)')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(row('PF-001')).getByTitle('Edit Filter (Super Admin)'));
    const dlg = card('Edit Filter (Super Admin)');
    fireEvent.change(field('Status', dlg), { target: { value: '' } });
    fireEvent.change(within(dlg).getByPlaceholderText(/At least 5 characters/), { target: { value: 'Keep state' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Filter Updated');
    expect(api.calls('PUT', '/api/super-admin/filter-data/filters/f1')[0].json).not.toHaveProperty('lifecycleState');
  });

  it('a validate answer with no rows at all reads "No data rows found in the file"; an area without an ahus key', async () => {
    const tree = makeTree();
    (tree[0].areas as any[]).push({ id: 'ar3', name: 'Area Empty' }); // no `ahus` key
    const api = setupApi({ tree, extra: [{ method: 'POST', path: '/api/assets/instances/bulk-upload-filters/validate', body: {} }] });
    renderFilters(OPS, api);
    await openBlock();
    expect(screen.getByRole('button', { name: /Area Empty/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await screen.findByText('PF-001');
    fireEvent.click(screen.getByRole('button', { name: 'Bulk Upload' }));
    fireEvent.change(document.getElementById('bulk-upload-file-input') as HTMLInputElement, { target: { files: [new File(['x'], 'f.xlsx')] } });
    expect(await within(card('Bulk Upload Filters')).findByText('No data rows found in the file')).toBeInTheDocument();
  });
});
