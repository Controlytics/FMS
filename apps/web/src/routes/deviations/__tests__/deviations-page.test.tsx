/**
 * Deviations page (/deviations) through the page harness. Coverage campaign
 * 2026-10-21.
 *
 * Rules exercised:
 *  - overdue / delay severity bands: <= 7 days yellow, 8-30 orange, > 30 red;
 *  - the Scheduled column shows the tolerance window the visit could be met in
 *    (tolerance derived from windowEnd - scheduledDate; windowStart mirrored
 *    when missing on older rows);
 *  - the export reads EVERY page of the current status tab, keeps only visits
 *    scheduled in the chosen period, is signed + logged before the file is made,
 *    and is refused over the configured export limit;
 *  - Super Admin edits go through the audited console endpoint with a reason.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, fakeReport } from '../../cleaning-cycles/__tests__/cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { DeviationsPage } from '../index';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); });

const iso = (d: string, t = '06:00') => `${d}T${t}:00.000Z`;
const dev = (id: string, over: Record<string, any> = {}) => ({
  id, deviationNumber: `DEV-${id}`, ahuName: 'AHU-01', filterCount: 4,
  scheduledDate: iso('2026-06-20'), windowStart: iso('2026-06-17'), windowEnd: iso('2026-06-23'),
  overdueDaysAtOpen: 2, liveOverdueDays: 3, status: 'OPEN',
  acknowledgedBy: null, acknowledgedByName: null, acknowledgedAt: null, passwordVerified: false,
  completedBy: null, completedByName: null, completedAt: null, delayDays: null, closedAt: null,
  closureKind: null, closureReason: null, createdAt: iso('2026-06-24'), ...over,
});
const ROWS = [
  dev('0001'),
  dev('0002', { status: 'ACKNOWLEDGED', liveOverdueDays: 12, acknowledgedBy: 'u1', acknowledgedByName: 'opr1', acknowledgedAt: iso('2026-07-01'), passwordVerified: true,
    scheduledDate: iso('2026-07-10'), windowStart: null, windowEnd: iso('2026-07-15'), ahuName: 'AHU-02' }),
  dev('0003', { status: 'CLOSED', delayDays: 40, completedByName: 'opr2', completedAt: iso('2026-08-30', '10:30'), scheduledDate: iso('2026-08-01'),
    windowStart: iso('2026-07-30'), windowEnd: iso('2026-08-03') }),
  dev('0004', { status: 'CLOSED', delayDays: null, overdueDaysAtOpen: 1, scheduledDate: iso('2026-09-10'), windowStart: null, windowEnd: iso('2026-09-05') }),
];

function deviationsRoute(rows: any[] = ROWS, perPage?: number, openCount = 1): MockRoute {
  return {
    path: '/api/pm-schedules/deviations',
    body: (req: MockRequest) => {
      const status = req.query.get('status');
      const list = status ? rows.filter((r) => r.status === status) : rows;
      const limit = perPage ?? Number(req.query.get('limit'));
      const page = Number(req.query.get('page'));
      const totalPages = Math.max(1, Math.ceil(list.length / limit));
      return { data: list.slice((page - 1) * limit, page * limit), total: list.length, openCount, page, limit, totalPages };
    },
  };
}

function open(user: any = role('QA', ['PM_READ']), extra: MockRoute[] = [], base: Parameters<typeof baseRoutes>[0] = {}, route: MockRoute = deviationsRoute()) {
  const api = mockApi([
    ...extra, route,
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'opr1', fullName: 'Operator One' }, { id: 'u2', username: 'opr2' }] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } },
    DT_UTC, ...baseRoutes(base),
  ]);
  renderPage(<DeviationsPage />, { user, api });
  return api;
}
const rowOf = (num: string) => screen.getByText(num).closest('tr') as HTMLElement;
const listReads = (api: ReturnType<typeof mockApi>) => api.calls('GET', '/api/pm-schedules/deviations').filter((r) => r.query.get('limit') !== '200');
const exportAs = async (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Deviations — the list', () => {
  it('each row shows scheduled date + tolerance window, a severity-banded overdue/delay, status and people', async () => {
    const api = open();
    expect(screen.getByText('Loading deviations...')).toBeInTheDocument();
    expect(await screen.findByText('DEV-0001')).toBeInTheDocument();
    expect(screen.getByText(/4 deviations · 1 open — overdue AHU filter cleaning audit trail/)).toBeInTheDocument();
    const open1 = rowOf('DEV-0001');
    expect(open1).toHaveTextContent('2026-06-20');
    expect(open1).toHaveTextContent('±3d (06-17-06-23)');
    expect(within(open1).getByText('3 days')).toHaveClass('bg-yellow-100');
    expect(open1).toHaveTextContent('Open');
    expect(within(open1).getAllByText('—').length).toBeGreaterThan(0);

    const ack = rowOf('DEV-0002');
    // windowStart missing on an older row: mirrored from windowEnd.
    expect(ack).toHaveTextContent('±5d (07-05-07-15)');
    expect(within(ack).getByText('12 days')).toHaveClass('bg-orange-100');
    expect(within(ack).getByTitle('Password verified')).toBeInTheDocument();
    expect(ack).toHaveTextContent('opr1');

    const closed = rowOf('DEV-0003');
    expect(within(closed).getByText('40 days delay')).toHaveClass('bg-red-100');
    expect(within(closed).getByText('40 days')).toHaveClass('bg-red-100');
    expect(closed).toHaveTextContent('2026-08-30 10:30');
    expect(closed).toHaveTextContent('opr2');

    const odd = rowOf('DEV-0004');
    // No delayDays yet: the delay falls back to the days overdue at opening.
    expect(within(odd).getByText('1 day delay')).toHaveClass('bg-yellow-100');
    // A window that ends before the scheduled date has no sensible tolerance: none shown.
    expect(odd).not.toHaveTextContent('±');
    // Not a Super Admin: no Edit column.
    expect(screen.queryByRole('columnheader', { name: 'Edit' })).toBeNull();
    // The FIRST configured page-size option (usePageSize; the kit offers 10, 25, 50). A cold
    // load may first ask with the pre-load default, so check the settled read.
    await waitFor(() => expect(listReads(api).at(-1)!.query.get('limit')).toBe('10'));
    expect(api.unmatched).toEqual([]);
  });

  it('the status tabs filter on the server and go back to page 1', async () => {
    const many = Array.from({ length: 60 }, (_, i) => dev(String(1000 + i), { status: i % 2 ? 'OPEN' : 'CLOSED', delayDays: 5 }));
    // First configured option 50, so 60 deviations make two pages.
    const api = open(undefined, [], { pagination: { limit: 100, options: [50, 25, 100] } }, deviationsRoute(many, undefined, 30));
    await screen.findByText('DEV-1000');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(listReads(api).at(-1)!.query.get('page')).toBe('2'));
    expect(await screen.findByText('DEV-1050')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    await waitFor(() => {
      const last = listReads(api).at(-1)!;
      expect(last.query.get('status')).toBe('CLOSED');
      expect(last.query.get('page')).toBe('1');
    });
    await waitFor(() => expect(screen.queryByText('DEV-1001')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(listReads(api).at(-1)!.query.get('status')).toBeNull());
    fireEvent.change(screen.getByRole('combobox', { name: /Rows/ }), { target: { value: '25' } });
    await waitFor(() => expect(listReads(api).at(-1)!.query.get('limit')).toBe('25'));
  });

  it('a missing day count reads as 0 days in the lowest band', async () => {
    open(undefined, [], {}, deviationsRoute([dev('77', { liveOverdueDays: null })]));
    expect(await screen.findByText('0 days')).toHaveClass('bg-yellow-100');
  });

  it('one deviation, none open: singular and no open count', async () => {
    open(undefined, [], {}, deviationsRoute([dev('9', { status: 'CLOSED', delayDays: 8 })], undefined, 0));
    expect(await screen.findByText(/^1 deviation — overdue/)).toBeInTheDocument();
    expect(screen.getByText('8 days delay')).toHaveClass('bg-orange-100');
  });

  it('no deviations says so and offers no pager', async () => {
    open(undefined, [], {}, deviationsRoute([], undefined, 0));
    expect(await screen.findByText('No deviations')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});

describe('Deviations — export', () => {
  it('PDF reads every page, logs the export, then saves a portrait 10-column table', async () => {
    const api = open(undefined, [], {}, deviationsRoute(ROWS, 2));
    await screen.findByText('DEV-0001');
    await exportAs('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    const exportReads = api.calls('GET', '/api/pm-schedules/deviations').filter((r) => r.query.get('limit') === '200');
    expect(exportReads.map((r) => r.query.get('page'))).toEqual(['1', '2']);
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({
      reportKey: 'deviations', title: 'Deviations Report', orientation: 'portrait',
      subtitle: 'Status: All  |  Period: All Time  |  Total: 4 deviation(s)',
    });
    const [table] = report.tables();
    expect(table.head).toEqual(['Deviation #', 'AHU', 'Filters', 'Scheduled', 'Overdue', 'Status', 'Acknowledged By', 'Completed By', 'Completed', 'Delay']);
    expect(table.fontSize).toBe(7.5);
    expect(table.body[0]).toEqual(['DEV-0001', 'AHU-01', '4', '2026-06-20\n±3d\n06-17-06-23', '3 days', 'Open', '-', '-', '-', '-']);
    expect(table.body[2]).toEqual(['DEV-0003', 'AHU-01', '4', '2026-08-01\n±2d\n07-30-08-03', '40 days delay', 'Closed', '-', 'opr2', '2026-08-30 10:30', '40 days']);
    expect(table.body[3][3]).toBe('2026-09-10\n\n');
    expect(table.body[3][4]).toBe('1 day delay');
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ reportType: 'Deviations', format: 'PDF', recordCount: 4 });
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json.filters).toEqual({});
    expect(report.save.mock.calls[0][0]).toMatch(/^deviations_.*\.pdf$/);
  });

  it('the period keeps only visits scheduled in it and is named in the subtitle; the status tab too', async () => {
    open();
    await screen.findByText('DEV-0001');
    fireEvent.click(screen.getByRole('button', { name: 'Closed' }));
    await screen.findByText('DEV-0003');
    fireEvent.change(screen.getByLabelText('Deviations from date'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('Deviations to date'), { target: { value: '2026-08-01' } });
    await exportAs('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toBe('Status: Closed  |  Period: 2026-08-01 to 2026-08-01  |  Total: 1 deviation(s)');
    expect(report.tables()[0].body.map((r: string[]) => r[0])).toEqual(['DEV-0003']);
  });

  it('a period open at either end reads "Start" / "Now"', async () => {
    const api = open();
    await screen.findByText('DEV-0001');
    fireEvent.change(screen.getByLabelText('Deviations from date'), { target: { value: '2026-07-01' } });
    await exportAs('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toContain('Period: 2026-07-01 to Now  |  Total: 3 deviation(s)');
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json.filters).toEqual({ From: '2026-07-01' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }));
    fireEvent.change(screen.getByLabelText('Deviations to date'), { target: { value: '2026-07-01' } });
    await exportAs('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createReport).mock.calls[1][0].subtitle).toContain('Period: Start to 2026-07-01  |  Total: 1 deviation(s)');
    // 2026-10-22: the second export's record names the period that narrowed it.
    expect(api.calls('POST', '/api/audit/report-export-log')[1].json.filters).toEqual({ To: '2026-07-01' });
  });

  it('Excel exports the same rows after logging', async () => {
    const api = open();
    await screen.findByText('DEV-0001');
    await exportAs('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const arg = vi.mocked(exportToExcel).mock.calls[0][0] as any;
    expect(arg.sheetName).toBe('Deviations');
    expect(arg.filename).toMatch(/^deviations-\d{4}-\d{2}-\d{2}$/);
    expect(arg.rows).toHaveLength(4);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ format: 'Excel', recordCount: 4 });
  });

  it('an empty period and an over-limit export each explain themselves; changing the period clears the note', async () => {
    open(undefined, [], { exportLimit: { maxRecords: 2, message: 'Limit is {max}, you asked for {count}' } });
    await screen.findByText('DEV-0001');
    await exportAs('PDF');
    expect(await screen.findByText('Limit is 2, you asked for 4')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Deviations from date'), { target: { value: '2027-01-01' } });
    expect(screen.queryByText('Limit is 2, you asked for 4')).toBeNull();
    await exportAs('Excel');
    expect(await screen.findByText('No deviations in the selected period.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Deviations to date'), { target: { value: '2027-02-01' } });
    expect(screen.queryByText('No deviations in the selected period.')).toBeNull();
    expect(report.save).not.toHaveBeenCalled();
    expect(exportToExcel).not.toHaveBeenCalled();
  });

  it('an export read that answers without rows or page count exports nothing', async () => {
    open(undefined, [{ path: '/api/pm-schedules/deviations', body: (req: MockRequest) => (req.query.get('limit') === '200' ? { data: undefined, totalPages: undefined } : { data: ROWS, total: 4, openCount: 1, totalPages: 1 }) }]);
    await screen.findByText('DEV-0001');
    // An export read that returns no rows: nothing in the period.
    await exportAs('Excel');
    expect(await screen.findByText('No deviations in the selected period.')).toBeInTheDocument();
    expect(exportToExcel).not.toHaveBeenCalled();
  });

  it('a PDF build failure, with and without a message', async () => {
    open();
    await screen.findByText('DEV-0001');
    vi.mocked(createReport).mockRejectedValueOnce(new Error('font missing'));
    await exportAs('PDF');
    expect(await screen.findByText('font missing')).toBeInTheDocument();
    vi.mocked(createReport).mockRejectedValueOnce({});
    await exportAs('PDF');
    expect(await screen.findByText('Failed to generate the report.')).toBeInTheDocument();
  });

  it('an Excel export whose log write is refused produces no file and says why', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(undefined, [{ method: 'POST', path: '/api/audit/report-export-log', status: 403, body: { error: 'ACCOUNT_LOCKED', message: 'Account locked' } }]);
    await screen.findByText('DEV-0001');
    await exportAs('Excel');
    expect(await screen.findByText('Account locked')).toBeInTheDocument();
    expect(exportToExcel).not.toHaveBeenCalled();
  });

  it('with EXPORT_DEVIATIONS on, the log is signed; cancelling exports nothing and shows nothing', async () => {
    const api = open(undefined, [], { reauthActions: ['EXPORT_DEVIATIONS'] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await screen.findByText('DEV-0001');
    await exportAs('PDF');
    expect(await screen.findByText(/Export Deviations Report/)).toBeInTheDocument();
    const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(report.save).not.toHaveBeenCalled();
    expect(screen.queryByText(/cancelled/i)).toBeNull();

    await exportAs('Excel');
    await passReauth();
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
    // And the Excel cancel path is silent too.
    await exportAs('Excel');
    fireEvent.click(within(await screen.findByText('Confirm Your Identity').then((t) => t.closest('.relative') as HTMLElement)).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(exportToExcel).toHaveBeenCalledTimes(1);
  });

  it('without PM_READ there is no export control', async () => {
    open(role('X', []));
    await screen.findByText('DEV-0001');
    expect(screen.queryByRole('button', { name: /^Export/ })).toBeNull();
  });
});

describe('Deviations — Super Admin edit', () => {
  it('the editor PUTs only changed fields with the reason, then the list re-reads', async () => {
    const api = open(SA, [{ method: 'PUT', path: '/api/super-admin/data/deviations/0002', body: (req: MockRequest) => ({ id: '0002', ...req.json }) }]);
    await screen.findByText('DEV-0002');
    expect(screen.getByRole('columnheader', { name: 'Edit' })).toBeInTheDocument();
    fireEvent.click(within(rowOf('DEV-0002')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit deviation - DEV-0002' });
    expect(within(dlg).getByLabelText(/Acknowledged by/)).toHaveDisplayValue('Operator One (opr1)');
    expect(within(dlg).getByLabelText(/^Status/)).toHaveDisplayValue('Acknowledged');
    fireEvent.change(within(dlg).getByLabelText(/^Status/), { target: { value: 'CLOSED' } });
    fireEvent.change(within(dlg).getByLabelText(/Closure kind/), { target: { value: 'SKIPPED' } });
    fireEvent.change(within(dlg).getByLabelText(/Closure reason/), { target: { value: 'Plant shutdown' } });
    fireEvent.change(within(dlg).getByLabelText(/Delay \(days\)/), { target: { value: '9' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Closed by QA review' } });
    const before = listReads(api).length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    const ok = await screen.findByRole('heading', { name: 'Deviation updated' });
    fireEvent.click(within(ok.closest('[role="dialog"]') as HTMLElement).getByRole('button', { name: 'OK' }));
    expect(api.calls('PUT', '/api/super-admin/data/deviations/0002')[0].json).toEqual({
      status: 'CLOSED', closureKind: 'SKIPPED', closureReason: 'Plant shutdown', delayDays: 9, _changeReason: 'Closed by QA review',
    });
    await waitFor(() => expect(listReads(api).length).toBeGreaterThan(before));
    expect(screen.queryByRole('dialog', { name: 'Edit deviation - DEV-0002' })).toBeNull();
  });

  it('with SUPER_ADMIN_DATA_EDIT on, the save is signed; Close abandons the editor', async () => {
    const api = open(SA, [{ method: 'PUT', path: '/api/super-admin/data/deviations/0001', body: { id: '0001' } }], { reauthActions: ['SUPER_ADMIN_DATA_EDIT'] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await screen.findByText('DEV-0001');
    fireEvent.click(within(rowOf('DEV-0001')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Edit deviation - DEV-0001' })).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Edit deviation - DEV-0001' })).toBeNull();
    fireEvent.click(within(rowOf('DEV-0001')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit deviation - DEV-0001' });
    expect(within(dlg).getByLabelText(/AHU/)).toHaveValue('AHU-01');
    fireEvent.change(within(dlg).getByLabelText(/^AHU/), { target: { value: 'AHU-01A' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Typo in AHU' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await passReauth();
    await screen.findByRole('heading', { name: 'Deviation updated' });
    const [put] = api.calls('PUT', '/api/super-admin/data/deviations/0001');
    expectSigned(put);
    expect(put.json.ahuName).toBe('AHU-01A');
  });

  it('a row missing optional fields still opens with blanks', async () => {
    open(SA, [], {}, deviationsRoute([dev('5', { ahuName: null })]));
    await screen.findByText('DEV-5');
    fireEvent.click(within(rowOf('DEV-5')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit deviation - DEV-5' });
    expect(within(dlg).getByLabelText(/^AHU/)).toHaveValue('');
    expect(within(dlg).getByLabelText(/Closure kind/)).toHaveDisplayValue('-- none --');
  });
});
