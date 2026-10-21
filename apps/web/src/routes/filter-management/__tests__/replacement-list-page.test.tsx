import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, type BaseRouteOpts } from './fm-test-kit';

const pdf = { addTable: vi.fn(), save: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { ReplacementListPage } from '../replacement-list';
import type { TestUser } from '@/test-utils/page-harness';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const now = new Date().toISOString();
const ROWS = [
  { id: 'rp1', oldFilterId: 'f1', oldFilterName: 'FLT-001', newFilterId: 'f9', newFilterName: 'FLT-009', replacedAt: now, performedBy: 'ravi kumar', remarks: 'Media torn', ahuName: 'AHU-1', ahuId: 'a1', blockName: 'Block A', blockId: 'b1' },
  { id: 'rp2', oldFilterId: 'f2', oldFilterName: 'FLT-002', newFilterId: 'f8', newFilterName: 'FLT-008', replacedAt: '2020-01-01T00:00:00Z', performedBy: null, remarks: null, ahuName: 'AHU-2', ahuId: 'a2', blockId: 'b2' },
  { id: 'rp3', oldFilterName: null, newFilterName: null, replacedAt: null, performedBy: '   ', remarks: null, ahuName: null },
];
const HIER: MockRoute[] = [
  { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b1', name: 'Block A' }, { id: 'b2', name: 'Block B' }] } },
  { path: '/api/hierarchy/ahus', body: { data: [{ id: 'a1', name: 'AHU-1', parentId: 'b1' }, { id: 'a2', name: 'AHU-2', parentId: 'b2' }] } },
  { path: '/api/hierarchy/areas', body: { data: [] } },
];
const SCHEDULE: MockRoute[] = [
  { path: '/api/replacement-schedules', body: { data: [] } },
  { path: '/api/assets/identifiers', body: { data: [] } },
];

/**
 * The page picks its initial tab (List vs Schedule) from the user's permissions
 * on FIRST render. In the app the signed-in user is already cached in
 * localStorage by then (useAuth writes it on every /api/auth/me success, and
 * login always lands on the dashboard first), so seed the same cache here.
 */
function seedCachedUser(user: TestUser) {
  localStorage.setItem('digilog_cached_user', JSON.stringify({ id: 'u-test', username: 'tester', fullName: 'Test User', status: 'ENABLED', permissions: [], ...user }));
}
const open = (user: TestUser, api: MockApiT) => { seedCachedUser(user); return renderPage(<ReplacementListPage />, { user, api }); };
type MockApiT = ReturnType<typeof mockApi>;

function setup(extra: MockRoute[] = [], base: BaseRouteOpts = {}, rows: any = ROWS) {
  return mockApi([
    ...extra,
    { path: '/api/filters/replacements', body: rows },
    { path: '/api/hierarchy/filters', body: { data: [{ id: 'f9', name: 'FLT-009' }, { id: 'f7', name: 'FLT-007' }] } },
    { path: '/api/filters/retirements', body: [{ id: 'f1', name: 'FLT-001' }, { id: 'f2', name: 'FLT-002' }] },
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'ravi', fullName: 'Ravi Kumar' }] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: {} },
    ...HIER, ...SCHEDULE, ...baseRoutes(base),
  ]);
}

describe('Replacement List page', () => {
  it('lists replacements: old/new chips, performer initials, dashes; stat tiles by date', async () => {
    const api = setup();
    open(SA, api);
    expect(await screen.findByText('FLT-001')).toBeInTheDocument();
    const r1 = screen.getByText('FLT-001').closest('tr')!;
    expect(r1).toHaveTextContent('FLT-009');
    expect(r1).toHaveTextContent('RK');
    expect(r1).toHaveTextContent('ravi kumar');
    expect(r1).toHaveTextContent('Block A');
    const r3 = screen.getAllByRole('row')[3];
    // whitespace-only performer still renders, initials fall back to "?"
    expect(r3).toHaveTextContent('?');
    expect(within(r3).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('Total Replacements').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Today').parentElement).toHaveTextContent('1');
    // both tabs offered to SA
    expect(screen.getByRole('button', { name: 'Replacement List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replacement Schedule' })).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('search and Block scope narrow the list; no match reads "No matching replacements"', async () => {
    const api = setup();
    open(SA, api);
    await screen.findByText('FLT-001');
    fireEvent.change(screen.getByPlaceholderText(/Search by filter/), { target: { value: 'torn' } });
    expect(screen.queryByText('FLT-002')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Search by filter/), { target: { value: '' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Block B' })).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'b2' } });
    expect(screen.queryByText('FLT-001')).toBeNull();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Search by filter/), { target: { value: 'nothing-here' } });
    expect(screen.getByText('No matching replacements')).toBeInTheDocument();
  });

  it('empty: "No replacements yet", no Export', async () => {
    const api = setup([], {}, []);
    open(SA, api);
    expect(await screen.findByText('No replacements yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });

  it('a role with only the schedule permissions gets the Schedule tab alone and the list is never fetched', async () => {
    const api = setup();
    open(role('MANAGER', ['REPLACEMENT_SCHEDULE_VIEW']), api);
    expect(await screen.findByRole('heading', { name: 'Replacement Schedule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replacement List' })).toBeNull();
    expect(api.calls('GET', '/api/filters/replacements')).toHaveLength(0);
  });

  it('a role with the list permission only gets no tab toggle for the schedule and no Export/edit', async () => {
    const api = setup();
    open(role('OPERATOR', ['REPLACEMENT_LIST_VIEW']), api);
    await screen.findByText('FLT-001');
    expect(screen.queryByRole('button', { name: 'Replacement Schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Export$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
  });

  it('switches between the list and the schedule tab', async () => {
    const api = setup();
    open(SA, api);
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getByRole('button', { name: 'Replacement Schedule' }));
    expect(await screen.findByText('No replacement schedule yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replacement List' }));
    expect(await screen.findByText('FLT-001')).toBeInTheDocument();
  });

  it('Excel: logs, then exports rows with dashes for missing values', async () => {
    const api = setup();
    vi.mocked(exportToExcel).mockImplementation(async () => {
      expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1);
    });
    open(role('QA', ['REPLACEMENT_LIST_VIEW', 'REPLACEMENT_LIST_EXPORT']), api);
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Replacement List', format: 'Excel', recordCount: 3 });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.sheetName).toBe('Replacements');
    expect(arg.rows[0]).toEqual(['1', 'FLT-001', 'FLT-009', expect.any(String), 'ravi kumar', 'Media torn']);
    expect(arg.rows[2]).toEqual(['3', '-', '-', '-', '   ', '-']);
  });

  it('PDF: subtitle carries scope + search; failure and oversize are reported', async () => {
    const api = setup([], { exportLimit: { maxRecords: 2, message: 'Over {max}' } });
    open(SA, api);
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('Over 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('Over 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.change(screen.getByPlaceholderText(/Search by filter/), { target: { value: 'FLT-00' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Block A' })).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'b1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toBe('Total: 1 replacement — Block Block A (filtered by "FLT-00")');
    vi.mocked(createReport).mockRejectedValueOnce(new Error('no fonts'));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('no fonts')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1);
  });

  it('a gated export is signed; a cancelled prompt exports nothing silently', async () => {
    const api = setup([], { reauthActions: ['EXPORT_REPLACEMENT_LIST'] });
    open(SA, api);
    await screen.findByText('FLT-001');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    const pw = await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(screen.queryByText('Export failed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await passReauth();
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('SUPER_ADMIN edit: filter pickers list active + retired filters; names are sent beside changed ids', async () => {
    const api = setup([{ method: 'PUT', path: '/api/super-admin/filter-data/replacements/rp1', body: { chainBroken: true } }]);
    open(SA, api);
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Edit replacement - FLT-001 → FLT-009' });
    await waitFor(() => expect(within(dlg).getAllByRole('option', { name: 'FLT-002 (retired)' }).length).toBe(2));
    const newSel = within(dlg).getByLabelText('New filter') as HTMLSelectElement;
    expect(within(newSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['-- keep current --', 'FLT-001 (retired)', 'FLT-002 (retired)', 'FLT-007', 'FLT-009']);
    fireEvent.change(newSel, { target: { value: 'f7' } });
    fireEvent.change(within(dlg).getByLabelText('Old filter'), { target: { value: 'f2' } });
    fireEvent.change(within(dlg).getByLabelText('Performed by'), { target: { value: 'ravi' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Wrong filters recorded' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Replacement record updated')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/replacements/rp1')[0].json).toEqual({
      oldFilterId: 'f2', oldFilterName: 'FLT-002', newFilterId: 'f7', newFilterName: 'FLT-007', performedBy: 'ravi', _changeReason: 'Wrong filters recorded',
    });
  });

  it('SUPER_ADMIN edit of a row with no ids: blank pickers are not sent; a refusal stays in the dialog', async () => {
    const api = setup([{ method: 'PUT', path: '/api/super-admin/filter-data/replacements/rp3', status: 400, body: { error: 'VALIDATION', message: 'Reason too short' } }]);
    open(SA, api);
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[2]);
    const dlg = await screen.findByRole('dialog', { name: /^Edit replacement -\s+→$/ });
    fireEvent.change(within(dlg).getByLabelText('Remarks'), { target: { value: 'Backfilled' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Missing remarks' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await within(dlg).findByText('Reason too short')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/replacements/rp3')[0].json).toEqual({ remarks: 'Backfilled', _changeReason: 'Missing remarks' });
  });
});
