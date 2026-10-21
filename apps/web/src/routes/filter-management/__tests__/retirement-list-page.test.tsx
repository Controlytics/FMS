import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { mockApi, renderPage, type MockApi } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, allowConsoleError } from './fm-test-kit';

const pdf = { addTable: vi.fn(), save: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { RetirementListPage } from '../retirement-list';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const now = new Date().toISOString();
const ROWS = [
  { id: 'r1', name: 'FLT-001', filterSet: 'SET_A', ahuName: 'AHU-1', ahuId: 'a1', blockName: 'Block A', blockId: 'b1', retiredAt: now, updatedAt: now, retiredBy: 'opr1', remarks: 'Torn media' },
  { id: 'r2', name: 'FLT-002', filterSet: 'SET_B', ahuName: 'AHU-2', ahuId: 'a2', blockId: 'b2', updatedAt: '2020-01-02T00:00:00Z', retiredBy: null, remarks: null },
  { id: 'r3', name: null, filterSet: 'OTHER', ahuName: null, updatedAt: null },
];
const HIER = [
  { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b1', name: 'Block A' }, { id: 'b2', name: 'Block B' }] } },
  { path: '/api/hierarchy/ahus', body: { data: [{ id: 'a1', name: 'AHU-1', parentId: 'b1' }, { id: 'a2', name: 'AHU-2', parentId: 'b2' }] } },
  { path: '/api/hierarchy/areas', body: { data: [] } },
];

function setup(rows: any[] = ROWS, extra: any[] = [], base = {}) {
  const api = mockApi([
    ...extra,
    { path: '/api/filters/retirements', body: rows },
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'opr1', fullName: 'Operator One' }] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } },
    ...HIER, ...baseRoutes(base),
  ]);
  return api;
}

describe('Retirement List page', () => {
  it('lists retirements with set labels, block/AHU and remarks; stat tiles count by date', async () => {
    const api = setup();
    renderPage(<RetirementListPage />, { user: SA, api });
    expect(await screen.findByText('FLT-001')).toBeInTheDocument();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
    expect(screen.getByText('Set A')).toBeInTheDocument();
    expect(screen.getByText('Set B')).toBeInTheDocument();
    expect(screen.getByText('OTHER')).toBeInTheDocument();
    expect(screen.getByRole('table')).toHaveTextContent('Block A');
    expect(screen.getByTitle('Torn media — by opr1')).toBeInTheDocument();
    // r1 is today; r2 is old; r3 has no date.
    const total = screen.getByText('Total Retired').closest('div')!.parentElement!;
    expect(total).toHaveTextContent('3');
    expect(screen.getByText('Today').closest('div')!.parentElement!).toHaveTextContent('1');
    expect(api.unmatched).toEqual([]);
  });

  it('empty list reads "No retired filters yet" and hides Export', async () => {
    const api = setup([]);
    renderPage(<RetirementListPage />, { user: SA, api });
    expect(await screen.findByText('No retired filters yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });

  it('search narrows the list and reads "No matching retirements" when nothing matches', async () => {
    const api = setup();
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    const search = screen.getByPlaceholderText(/Search filter, AHU/);
    fireEvent.change(search, { target: { value: 'torn' } });
    expect(screen.getByText('FLT-001')).toBeInTheDocument();
    expect(screen.queryByText('FLT-002')).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No matching retirements')).toBeInTheDocument();
  });

  it('Block scope filters rows by the server-resolved blockId', async () => {
    const api = setup();
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Block B' })).toBeInTheDocument());
    const [blockSel] = screen.getAllByRole('combobox');
    fireEvent.change(blockSel, { target: { value: 'b2' } });
    expect(screen.queryByText('FLT-001')).toBeNull();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
  });

  it('Export is hidden for a role without RETIREMENT_LIST_EXPORT, and there is no SA edit column', async () => {
    const api = setup();
    renderPage(<RetirementListPage />, { user: role('OPERATOR', ['RETIREMENT_LIST_VIEW']), api });
    await screen.findByText('FLT-001');
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
  });

  it('Excel export logs the download BEFORE building the file, with the right rows', async () => {
    const api = setup();
    vi.mocked(exportToExcel).mockImplementation(async () => {
      expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1);
    });
    renderPage(<RetirementListPage />, { user: role('QA', ['RETIREMENT_LIST_VIEW', 'RETIREMENT_LIST_EXPORT']), api });
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Retirement List', format: 'Excel', recordCount: 3 });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.filename).toBe('retirement-list');
    expect(arg.rows[0]).toEqual(['1', 'FLT-001', 'Set A', expect.any(String), 'opr1', 'Torn media']);
    expect(arg.rows[1].slice(0, 3)).toEqual(['2', 'FLT-002', 'Set B']);
    expect(arg.rows[1].slice(4)).toEqual(['-', '-']);
    expect(arg.rows[2]).toEqual(['3', '-', 'OTHER', '-', '-', '-']);
  });

  it('PDF export: table body + subtitle reflect the search, logged then saved', async () => {
    const api = setup();
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    fireEvent.change(screen.getByPlaceholderText(/Search filter, AHU/), { target: { value: 'FLT-00' } });
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({ reportKey: 'retirement-list', subtitle: 'Total: 2 retired filters (filtered by "FLT-00")' });
    expect(pdf.addTable.mock.calls[0][0].body).toHaveLength(2);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ format: 'PDF', recordCount: 2 });
  });

  it('export over the configured limit is refused with the configured message and logs nothing', async () => {
    const api = setup(ROWS, [], { exportLimit: { maxRecords: 2, message: 'Too many: {count} > {max}' } });
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('Too many: 3 > 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(screen.getAllByText('Export too large').length).toBeGreaterThanOrEqual(1));
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(exportToExcel).not.toHaveBeenCalled();
  });

  it('a gated export asks for the password and signs the export-log write', async () => {
    const api = setup(ROWS, [], { reauthActions: ['EXPORT_RETIREMENT_LIST'] });
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    // wait for the my-actions read so the gate is known up front
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await passReauth();
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('a cancelled password prompt exports nothing and shows no error', async () => {
    const api = setup(ROWS, [], { reauthActions: ['EXPORT_RETIREMENT_LIST'] });
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(pdf.save).not.toHaveBeenCalled();
    expect(screen.queryByText('Export failed')).toBeNull();
  });

  it('a PDF build failure is reported as "Export failed"', async () => {
    const api = setup();
    vi.mocked(createReport).mockRejectedValueOnce(new Error('font missing'));
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('font missing')).toBeInTheDocument();
    expect(screen.getByText('Export failed')).toBeInTheDocument();
  });

  it('SUPER_ADMIN edits a retirement: PUT carries only changed fields + reason; success toasts', async () => {
    const api = setup(ROWS, [{ method: 'PUT', path: '/api/super-admin/filter-data/retirements/r1', body: { ok: true } }]);
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Edit retirement - FLT-001' });
    expect(within(dialog).getByText(/permanently breaks the audit hash chain/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Operator One (opr1)' })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/Remarks/), { target: { value: 'Torn media, frame bent' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: 'Typo in remarks' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Retirement record updated')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/retirements/r1')[0].json).toEqual({ remarks: 'Torn media, frame bent', _changeReason: 'Typo in remarks' });
    expect(screen.queryByRole('dialog', { name: /Edit retirement/ })).toBeNull();
  });

  it('SUPER_ADMIN edit: a blank "Retired by" is not sent; a server refusal stays in the dialog', async () => {
    const api = setup(ROWS, [{ method: 'PUT', path: '/api/super-admin/filter-data/retirements/r1', status: 409, body: { error: 'CONFLICT', message: 'Filter name already in use' } }]);
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-001');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Edit retirement - FLT-001' });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Operator One (opr1)' })).toBeInTheDocument());
    fireEvent.change(within(dialog).getByLabelText(/Retired by/), { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText(/^Filter/), { target: { value: 'FLT-009' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: 'Rename filter' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Filter name already in use')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/retirements/r1')[0].json).toEqual({ name: 'FLT-009', _changeReason: 'Rename filter' });
  });

  it('SUPER_ADMIN edit under re-auth: retried PUT is signed', async () => {
    const api = setup(ROWS, [{ method: 'PUT', path: '/api/super-admin/filter-data/retirements/r2', body: { ok: true } }], { reauthActions: ['SUPER_ADMIN_DATA_EDIT'] });
    renderPage(<RetirementListPage />, { user: SA, api });
    await screen.findByText('FLT-002');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[1]);
    const dialog = await screen.findByRole('dialog', { name: 'Edit retirement - FLT-002' });
    fireEvent.change(within(dialog).getByLabelText(/^Set/), { target: { value: 'SET_A' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: 'Wrong set recorded' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await passReauth();
    expect(await screen.findByText('Retirement record updated')).toBeInTheDocument();
    expectSigned(api.calls('PUT', '/api/super-admin/filter-data/retirements/r2')[0]);
  });

  it('a failed list load is reported through the SWR error toast', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = setup(ROWS, [{ path: '/api/filters/retirements', status: 500, body: { error: 'INTERNAL', message: 'DB down' } }]);
    renderPage(<RetirementListPage />, { user: SA, api });
    expect(await screen.findByText('DB down')).toBeInTheDocument();
  });
});
