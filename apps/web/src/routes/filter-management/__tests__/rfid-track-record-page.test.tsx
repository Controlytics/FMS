import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, type BaseRouteOpts } from './fm-test-kit';

const pdf = { addTable: vi.fn(), save: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { RfidTrackRecordPage } from '../rfid-track-record';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const ROWS = [
  { id: 'ev1', timestamp: '2026-10-01T09:00:00Z', event: 'ASSIGN', rfidNumber: 'E2000017', filterId: 'f1', filterName: 'FLT-001', ahuId: 'a1', ahuName: 'AHU-1', userId: 'u1', user: 'opr1', reason: null },
  { id: 'ev2', timestamp: '2026-10-02T09:00:00Z', event: 'REMOVE', rfidNumber: 'E2000018', filterId: null, filterName: null, ahuId: null, ahuName: null, userId: null, user: null, reason: 'Tag damaged' },
];
const page = (data: any[], total = data.length, totalPages = 1) => ({ data, total, page: 1, limit: 50, totalPages });
const TREE = [
  { id: 'b1', name: 'Block A', areas: [{ id: 'ar1', name: 'Area 1', ahus: [{ id: 'a1', name: 'AHU-1', filters: [{ id: 'f1', name: 'FLT-001' }, { id: 'f2', name: 'FLT-002' }] }] }],
    ahus: [{ id: 'a2', name: 'AHU-2', filters: [{ id: 'f3', name: 'FLT-003' }] }] },
  { id: 'b2', name: 'Block B' },
];

function setup(extra: MockRoute[] = [], base: BaseRouteOpts = {}, rows: any = page(ROWS)) {
  return mockApi([
    ...extra,
    { path: '/api/assets/identifiers/track-record', body: rows },
    { path: '/api/hierarchy/tree', body: TREE },
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'opr1', fullName: 'Operator One' }, { id: 'u2', username: 'opr2' }] } },
    { path: '/api/assets/identifiers', body: [{ identifierType: 'RFID', identifierValue: 'E2000017' }, { identifierType: 'QR', identifierValue: 'Q1' }] },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: {} },
    // The page opens on the configured Pagination `limit` (2026-10-22; it was a fixed 50).
    ...baseRoutes({ pagination: { limit: 50, options: [10, 25, 50] }, ...base }),
  ]);
}
const lastList = (api: ReturnType<typeof setup>) => api.calls('GET', '/api/assets/identifiers/track-record').at(-1)!;

describe('RFID Track Record page', () => {
  it('lists assign/remove events with dashes for missing values and a record footer', async () => {
    const api = setup();
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    expect(await screen.findByText('E2000017')).toBeInTheDocument();
    const assigned = screen.getByText('E2000017').closest('tr')!;
    expect(within(assigned).getByText('Assigned')).toBeInTheDocument();
    expect(assigned).toHaveTextContent('FLT-001');
    expect(assigned).toHaveTextContent('opr1');
    const removed = screen.getByText('E2000018').closest('tr')!;
    expect(within(removed).getByText('Removed')).toBeInTheDocument();
    expect(within(removed).getAllByText('—')).toHaveLength(3);
    expect(removed).toHaveTextContent('Tag damaged');
    expect(screen.getByText('Page 1 / 1')).toBeInTheDocument();
    expect(lastList(api).query.get('page')).toBe('1');
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('50'));
    expect(api.unmatched).toEqual([]);
  });

  it('reads its page size from the configured Pagination limit, not a fixed size', async () => {
    const api = setup([], { pagination: { limit: 100, options: [25, 50, 100] } });
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    expect(await screen.findByText('E2000017')).toBeInTheDocument();
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('100'));
  });

  it('empty: says so, offers no export and no pager', async () => {
    const api = setup([], {}, page([], 0));
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    expect(await screen.findByText('No RFID activity found for these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('every text filter and the date range go to the server and reset to page 1', async () => {
    const api = setup([], {}, page(ROWS, 120, 3));
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    await screen.findByText('Page 2 / 3');
    expect(within(screen.getByText('E2000017').closest('tr')!).getAllByRole('cell')[0]).toHaveTextContent(/^51$/);
    fireEvent.change(screen.getByPlaceholderText('e.g. CA000…'), { target: { value: 'E200' } });
    await waitFor(() => expect(lastList(api).query.get('rfid')).toBe('E200'));
    expect(lastList(api).query.get('page')).toBe('1');
    fireEvent.change(screen.getByPlaceholderText('Filter name'), { target: { value: 'FLT' } });
    fireEvent.change(screen.getByPlaceholderText('AHU name'), { target: { value: 'AHU-1' } });
    fireEvent.change(screen.getByPlaceholderText('User'), { target: { value: 'opr' } });
    fireEvent.change(screen.getByLabelText('RFID track record from date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('RFID track record to date'), { target: { value: '2026-10-05' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-05T23:59:59'));
    const q = lastList(api).query;
    expect(Object.fromEntries(q)).toEqual({ from: '2026-10-01', to: '2026-10-05T23:59:59', rfid: 'E200', filterName: 'FLT', ahu: 'AHU-1', user: 'opr', page: '1', limit: '50' });
    // An inverted range is refused by the control and never sent.
    const before = api.calls('GET', '/api/assets/identifiers/track-record').length;
    fireEvent.change(screen.getByLabelText('RFID track record from date'), { target: { value: '2026-10-09' } });
    expect(screen.getByLabelText('RFID track record from date')).toHaveValue('2026-10-01');
    expect(api.calls('GET', '/api/assets/identifiers/track-record')).toHaveLength(before);
  });

  it('pager: Previous/Next stop at the ends and the count line follows the page', async () => {
    const api = setup([], {}, page(ROWS, 60, 2));
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 - 50 of 60');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2 / 2');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 51 - 60 of 60');
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 1 / 2');
  });

  it('Export is shown for FILTER_RFID_MANAGE or ASSET_VIEW holders and hidden otherwise', async () => {
    const api = setup();
    const { unmount } = renderPage(<RfidTrackRecordPage />, { user: role('SUPERVISOR', ['FILTER_RFID_MANAGE']), api });
    await screen.findByText('E2000017');
    expect(screen.getByRole('button', { name: /^Export$/ })).toBeInTheDocument();
    // a non-SA has no edit column and the SA reference lists are never fetched
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
    expect(api.calls('GET', '/api/hierarchy/tree')).toHaveLength(0);
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
    unmount();
    localStorage.clear(); // useAuth caches the previous user; start the second role cold
    const api2 = setup();
    renderPage(<RfidTrackRecordPage />, { user: role('QA', ['AUDIT_READ']), api: api2 });
    await screen.findByText('E2000017');
    await waitFor(() => expect(api2.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /^Export$/ })).toBeNull();
  });

  it('Excel: re-reads up to 500 rows with the current filters, logs, then builds the sheet', async () => {
    const api = setup();
    vi.mocked(exportToExcel).mockImplementation(async () => {
      expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1);
    });
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    fireEvent.change(screen.getByPlaceholderText('e.g. CA000…'), { target: { value: 'E2' } });
    await waitFor(() => expect(lastList(api).query.get('rfid')).toBe('E2'));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    const exportRead = api.calls('GET', '/api/assets/identifiers/track-record').find((r) => r.query.get('limit') === '500')!;
    expect(exportRead.query.get('rfid')).toBe('E2');
    expect(exportRead.query.get('page')).toBe('1');
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'RFID Track Record', format: 'Excel', recordCount: 2, filters: { RFID: 'E2' } });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.head).toEqual(['S.No', 'Date & Time', 'Event', 'RFID Number', 'Filter', 'AHU', 'User', 'Reason']);
    expect(arg.filename).toMatch(/^rfid-track-record-\d{4}-\d{2}-\d{2}$/);
    expect(arg.rows[0]).toEqual(['1', expect.any(String), 'Assigned', 'E2000017', 'FLT-001', 'AHU-1', 'opr1', '-']);
    expect(arg.rows[1]).toEqual(['2', expect.any(String), 'Removed', 'E2000018', '-', '-', '-', 'Tag damaged']);
  });

  it('PDF: portrait 9pt table; subtitle names the period ("All Time", or the chosen dates)', async () => {
    const api = setup();
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({ reportKey: 'rfid-track-record', orientation: 'portrait', subtitle: 'Period: All Time  |  Total: 2 event(s)' });
    expect(pdf.addTable.mock.calls[0][0]).toMatchObject({ fontSize: 9 });
    expect(pdf.addTable.mock.calls[0][0].body).toHaveLength(2);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ format: 'PDF', recordCount: 2 });

    fireEvent.change(screen.getByLabelText('RFID track record to date'), { target: { value: '2026-10-05' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-05T23:59:59'));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createReport).mock.calls[1][0].subtitle).toMatch(/^Period: Start to .+ \| {2}Total: 2 event\(s\)$/);

    fireEvent.change(screen.getByLabelText('RFID track record from date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('RFID track record to date'), { target: { value: '' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(3));
    expect(vi.mocked(createReport).mock.calls[2][0].subtitle).toMatch(/ to Now {2}\|/);
  });

  it('both formats refuse an export over the configured limit, logging nothing', async () => {
    const api = setup([], { exportLimit: { maxRecords: 1, message: 'Limit {max}, got {count}' } });
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('Limit 1, got 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('Limit 1, got 2')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(createReport).not.toHaveBeenCalled();
    expect(exportToExcel).not.toHaveBeenCalled();
  });

  it('a failed export read is reported; a gated export is signed', async () => {
    const api = setup([{ path: /track-record\?.*limit=500/, status: 500, times: 1, body: { error: 'X', message: 'Query timed out' } }], { reauthActions: ['EXPORT_RFID_TRACK_RECORD'] });
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('Query timed out')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await passReauth();
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('SUPER_ADMIN edit: AHU narrows the filter list and clears the filter; PUT drops the picker aid and blanks', async () => {
    const api = setup([{ method: 'PUT', path: '/api/super-admin/filter-data/rfid-events/ev1', body: { liveTagNote: 'Live tag E2000017 moved to FLT-003' } }]);
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000017');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[0]);
    const dlg = await screen.findByRole('dialog', { name: 'Edit RFID record' });
    expect(within(dlg).getByText(/permanently breaks the audit hash chain/)).toBeInTheDocument();
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'Block A / AHU-2' })).toBeInTheDocument());
    expect(within(dlg).getByRole('option', { name: 'Block A / Area 1 / AHU-1' })).toBeInTheDocument();
    const filterSel = within(dlg).getByLabelText('Filter') as HTMLSelectElement;
    expect(filterSel.value).toBe('f1');
    expect(within(filterSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['-- keep current --', 'FLT-001', 'FLT-002']);
    fireEvent.change(within(dlg).getByLabelText('AHU'), { target: { value: 'a2' } });
    expect(filterSel.value).toBe('');
    expect(within(filterSel).getAllByRole('option').map((o) => o.textContent)).toEqual(['-- keep current --', 'FLT-003']);
    fireEvent.change(filterSel, { target: { value: 'f3' } });
    fireEvent.change(within(dlg).getByLabelText('User'), { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText('Remarks'), { target: { value: 'Re-tagged on wrong filter' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Correct filter' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Live tag E2000017 moved to FLT-003')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/rfid-events/ev1')[0].json).toEqual({ filterId: 'f3', remarks: 'Re-tagged on wrong filter', _changeReason: 'Correct filter' });
  });

  it('SUPER_ADMIN edit without a live-tag note falls back to the audit-trail message', async () => {
    const api = setup([{ method: 'PUT', path: '/api/super-admin/filter-data/rfid-events/ev2', body: {} }]);
    renderPage(<RfidTrackRecordPage />, { user: SA, api });
    await screen.findByText('E2000018');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[1]);
    const dlg = await screen.findByRole('dialog', { name: 'Edit RFID record' });
    fireEvent.change(within(dlg).getByLabelText(/^Event/), { target: { value: 'ASSIGN' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Event recorded wrong' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('RFID record updated')).toBeInTheDocument();
    expect(screen.getByText('Recorded in the audit trail')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/filter-data/rfid-events/ev2')[0].json).toEqual({ event: 'ASSIGN', _changeReason: 'Event recorded wrong' });
  });
});
