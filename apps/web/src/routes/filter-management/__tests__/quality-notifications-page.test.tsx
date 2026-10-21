import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, type BaseRouteOpts } from './fm-test-kit';

const pdf = { addTable: vi.fn(), save: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { QualityNotificationsPage } from '../quality-notifications';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const ROWS = [
  { id: 'q1', qnn: 'QN-2026-000131', action: 'APPROVE', ahuName: 'AHU-1', message: 'PM schedule approved', performedBy: 'u1', performedByName: 'qa1', createdAt: '2026-10-01T09:00:00Z' },
  { id: 'q2', qnn: 'QN-2026-000132', action: 'LEGACY_X', ahuName: null, message: null, performedBy: null, performedByName: null, createdAt: '2026-10-02T09:00:00Z' },
];
const resp = (data: any[], total = data.length) => ({ data, total, page: 1, limit: 25, totalPages: Math.max(1, Math.ceil(total / 25)) });

function setup(extra: MockRoute[] = [], base: BaseRouteOpts = {}, rows: any = resp(ROWS), visible = true) {
  return mockApi([
    ...extra,
    { path: '/api/pm-schedules/qnn/visible', body: { visible } },
    { path: '/api/pm-schedules/qnn', body: rows },
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'qa1', fullName: 'QA One' }, { id: 'u2', username: 'qa2', fullName: 'QA Two' }] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: {} },
    ...baseRoutes(base),
  ]);
}
const lastList = (api: ReturnType<typeof setup>) => api.calls('GET', '/api/pm-schedules/qnn').at(-1)!;

describe('Quality Notifications page', () => {
  it('a role the server hides QNN from sees Access Denied', async () => {
    const api = setup([], {}, resp(ROWS), false);
    renderPage(<QualityNotificationsPage />, { user: role('OPERATOR'), api });
    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to view Quality Notifications.")).toBeInTheDocument();
  });

  it('lists notifications with dashes for empty AHU / message / performer; no edit column for non-SA', async () => {
    const api = setup();
    renderPage(<QualityNotificationsPage />, { user: role('QA', ['PM_READ']), api });
    expect(await screen.findByText('QN-2026-000131')).toBeInTheDocument();
    const r1 = screen.getByText('QN-2026-000131').closest('tr')!;
    expect(r1).toHaveTextContent('APPROVE');
    expect(r1).toHaveTextContent('PM schedule approved');
    expect(r1).toHaveTextContent('qa1');
    const r2 = screen.getByText('QN-2026-000132').closest('tr')!;
    expect(within(r2).getAllByText('—')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
    expect(api.unmatched).toEqual([]);
  });

  it('empty: says so and offers no export or pager', async () => {
    const api = setup([], {}, resp([], 0));
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    expect(await screen.findByText('No Quality Notifications found for these filters.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('date range is sent as from / end-of-day to; changing it resets to page 1', async () => {
    const api = setup([], {}, resp(ROWS, 60));
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000131');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    fireEvent.change(screen.getByLabelText('Quality notifications from date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Quality notifications to date'), { target: { value: '2026-10-03' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-03T23:59:59'));
    expect(lastList(api).query.get('from')).toBe('2026-10-01');
    expect(lastList(api).query.get('page')).toBe('1');
  });

  it('rows-per-page change re-queries with the new limit', async () => {
    const api = setup([], {}, resp(ROWS, 60));
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000131');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } });
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('50'));
  });

  it('Excel: reads up to 500 rows, logs first, then builds the sheet', async () => {
    const api = setup();
    vi.mocked(exportToExcel).mockImplementation(async () => {
      expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1);
    });
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000131');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(api.calls('GET', '/api/pm-schedules/qnn').some((r) => r.query.get('limit') === '500')).toBe(true);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Quality Notifications', format: 'Excel', recordCount: 2 });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.sheetName).toBe('QNN');
    expect(arg.head).toEqual(['S.No', 'QNN', 'Action', 'AHU', 'Message', 'By', 'Date & Time']);
    expect(arg.rows[0].slice(0, 6)).toEqual(['1', 'QN-2026-000131', 'APPROVE', 'AHU-1', 'PM schedule approved', 'qa1']);
    expect(arg.rows[1].slice(0, 6)).toEqual(['2', 'QN-2026-000132', 'LEGACY_X', '-', '-', '-']);
  });

  it('PDF: portrait report whose subtitle names the period; dates narrow it', async () => {
    const api = setup();
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000131');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({ reportKey: 'quality-notifications', orientation: 'portrait', subtitle: 'Period: All Time  |  Total: 2 notification(s)' });
    expect(pdf.addTable.mock.calls[0][0]).toMatchObject({ fontSize: 9 });
    fireEvent.change(screen.getByLabelText('Quality notifications from date'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(lastList(api).query.get('from')).toBe('2026-10-01'));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createReport).mock.calls[1][0].subtitle).toMatch(/ to Now {2}\| {2}Total: 2/);
    fireEvent.change(screen.getByLabelText('Quality notifications from date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Quality notifications to date'), { target: { value: '2026-10-04' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-04T23:59:59'));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(3));
    expect(vi.mocked(createReport).mock.calls[2][0].subtitle).toMatch(/^Period: Start to /);
  });

  it('oversize exports are refused in both formats; a PDF build failure is reported', async () => {
    const api = setup([], { exportLimit: { maxRecords: 1, message: 'Max {max}' } });
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000131');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('Max 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('Max 1')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
  });

  it('a PDF build failure is reported, and a gated export is signed', async () => {
    const api = setup([], { reauthActions: ['EXPORT_QUALITY_NOTIFICATIONS'] });
    vi.mocked(createReport).mockRejectedValueOnce(new Error('jsPDF failed'));
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000131');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('jsPDF failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await passReauth();
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('SUPER_ADMIN edit: an unknown legacy action stays selectable; PUT sends only the change + reason and refetches', async () => {
    const api = setup([{ method: 'PUT', path: '/api/super-admin/data/quality-notifications/q2', body: { ok: true } }]);
    renderPage(<QualityNotificationsPage />, { user: SA, api });
    await screen.findByText('QN-2026-000132');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[1]);
    const dlg = await screen.findByRole('dialog', { name: 'Edit QN-2026-000132' });
    const action = within(dlg).getByLabelText(/^Action/) as HTMLSelectElement;
    expect(within(action).getAllByRole('option').map((o) => o.textContent)).toEqual(['LEGACY_X', 'UPLOAD', 'REVIEW', 'APPROVE', 'REJECT', 'RESUBMIT']);
    fireEvent.change(action, { target: { value: 'REVIEW' } });
    // with a known action the legacy value drops out of the list
    expect(within(action).getAllByRole('option').map((o) => o.textContent)).toEqual(['UPLOAD', 'REVIEW', 'APPROVE', 'REJECT', 'RESUBMIT']);
    await waitFor(() => expect(within(dlg).getByRole('option', { name: 'QA Two (qa2)' })).toBeInTheDocument());
    fireEvent.change(within(dlg).getByLabelText(/^By/), { target: { value: 'u2' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Wrong action recorded' } });
    const listReads = api.calls('GET', '/api/pm-schedules/qnn').length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Quality notification updated')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/data/quality-notifications/q2')[0].json).toEqual({ action: 'REVIEW', performedBy: 'u2', _changeReason: 'Wrong action recorded' });
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/qnn').length).toBeGreaterThan(listReads));
  });
});
