import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure, act } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, LocationProbe, completedCycle, fakeReport, ISO } from './cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { CleaningCycleHistoryPage } from '../history';

usePageTestLifecycle();
// These pages chain many SWR reads; give them headroom when the machine is busy.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); });

const STAGES4 = ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT'];
const tr = (from: string | null, to: string, at: string, by = 'opr1', attributes: any = {}) =>
  ({ id: `${to}-${at}`, eventType: 'STATE_TRANSITION', fromState: from, toState: to, performedAt: at, performedByName: by, attributes });

const C1 = completedCycle();
const C_RETIRED = { id: 'c2', filterId: 'f2', filterName: 'FLT-RET', status: 'TERMINATED', terminationReason: 'RETIRED', startedAt: ISO(7), profileStages: STAGES4, events: [tr(null, 'WASH_IN', ISO(7))] };
const C_PROGRESS = { id: 'c3', filterId: 'f3', filterName: 'FLT-PROG', filterSet: 'SET_B', manualEntry: true, status: 'IN_PROGRESS', startedAt: ISO(6), profileStages: STAGES4, events: [tr(null, 'WASH_IN', ISO(6))] };
const C_TERM = { id: 'c4', filterId: 'f4', filterName: 'FLT-TERM', status: 'TERMINATED', startedAt: ISO(5), profileStages: STAGES4, events: [tr('WASH_IN', 'WASH_OUT', ISO(5), 'opr9')] };
const C_REPL = { id: 'c5', filterId: 'f5', filterName: 'FLT-REPL', status: 'TERMINATED', terminationReason: 'REPLACED', startedAt: ISO(4), profileStages: STAGES4, events: [] };
const C_ODD = { id: 'c6', filterName: null, status: 'ON_HOLD', startedAt: ISO(3),
  // DRY_IN with readings only on DRY_OUT, temperature under "temperature"; dryer from the legacy event
  events: [tr('WASH_OUT', 'DRY_IN', ISO(3), 'opr5', { action: 'DRYER_STARTED', dryerDurationMinutes: 30 }),
    tr('DRY_IN', 'DRY_OUT', ISO(3, 45), 'opr6', { instrumentReadings: [{ description: 'Chamber temperature', value: 48, uom: 'C' }] })] };
const M1 = { _kind: 'manual', id: 'm1', filterId: 'f1', filterName: 'FLT-MAN', fromState: 'WASH_IN', toState: 'DRY_IN', performedAt: ISO(2), performedByName: 'admin1', profileStages: STAGES4, remarks: 'fix', ahuName: 'AHU-1', attributes: { cleaningReasonKey: 'PM' } };
const M2 = { _kind: 'manual', id: 'm2', filterId: 'f9', filterName: 'FLT-DONE', fromState: null, toState: 'CLEANING_CYCLE_COMPLETED', performedAt: ISO(1), performedBy: 'deadbeef-0000', profileStages: ['WASH_IN', 'DRY_IN'] };
const M3 = { _kind: 'manual', id: 'm3', filterName: null, fromState: 'X', toState: 'WEIRD_STATE', performedAt: ISO(0) };
const ROWS = [C1, C_RETIRED, C_PROGRESS, C_TERM, C_REPL, C_ODD, M1, M2, M3];

const FILTERS = { data: [
  { id: 'f1', name: 'FLT-001', status: 'Active', attributes: { filterSize: '610X610X292' } },
  { id: 'f3', name: 'FLT-PROG', status: 'Active' },
  { id: 'f2', name: 'FLT-RET', status: 'Retired' },
] };
const HIER: MockRoute[] = [
  { path: '/api/hierarchy/filters', body: FILTERS },
  { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b1', name: 'Block A' }] } },
  { path: '/api/hierarchy/areas', body: { data: [{ id: 'ar1', name: 'Area 1' }] } },
  { path: '/api/hierarchy/ahus', body: { data: [{ id: 'h1', name: 'AHU-1' }] } },
];
const LOG: MockRoute = { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } };

/** The list read answers `rows`; an export read (limit=100) pages through `exportRows`. */
function recordRoute(rows: any[] = ROWS, exportRows: any[] = rows, total = rows.length): MockRoute {
  return {
    path: '/api/filters/cleaning-record',
    body: (req: MockRequest) => {
      if (req.query.get('limit') === '100') {
        const p = Number(req.query.get('page'));
        return { data: exportRows.slice((p - 1) * 100, p * 100), total: exportRows.length };
      }
      return { data: rows, total, totalPages: Math.max(1, Math.ceil(total / 25)) };
    },
  };
}

/** Configured zone = this process's zone, so a naive datetime-local value reads back unshifted. */
const DT_LOCAL: MockRoute = { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } };

function open(user: any = SA, extra: MockRoute[] = [], base = {}, record: MockRoute = recordRoute()) {
  const api = mockApi([...extra, record, ...HIER, LOG, DT_UTC, ...baseRoutes(base)]);
  renderPage(<><CleaningCycleHistoryPage /><LocationProbe /></>, { user, api });
  return api;
}
const rowOf = (name: string) => screen.getByText(name, { selector: 'td div' }).closest('tr')!;
const cells = (name: string) => within(rowOf(name)).getAllByRole('cell').map((c) => c.textContent);
const listReads = (api: ReturnType<typeof open>) => api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') !== '100');
const lastList = (api: ReturnType<typeof open>) => listReads(api).at(-1)!;
const exportVia = async (fmt: 'PDF' | 'Excel') => {
  // the menu shows once the (re)loaded list reports a non-zero total
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Filter Cleaning Record — table', () => {
  it('a completed cycle fills every column from its EVENTS (readings, stage times, performers, dryer)', async () => {
    const api = open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Filter Cleaning Record');
    expect(screen.getByText(/9 records \(cycles \+ manual updates\)/)).toBeInTheDocument();
    expect(cells('FLT-001').slice(0, 14)).toEqual([
      '1', 'FLT-001Set A', '610X610X292', '6.123 bar', '2 bar', '2026-10-01 08:00', '2026-10-01 09:00', 'opr1',
      '1h 30m', '2026-10-01 10:00', '55 °C', '2026-10-01 12:00', 'opr3', 'Completed',
    ]);
    expect(api.unmatched).toEqual([]);
  });

  it('un-reached stages say why: Retired / Pending / Skipped+Terminated / Replaced; unknown status keeps its word', async () => {
    open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    const ret = cells('FLT-RET');
    expect(ret.slice(5, 7)).toEqual(['2026-10-01 07:00', 'Retired']);
    expect(ret[13]).toBe('Retired');
    expect(within(rowOf('FLT-RET')).getAllByText('Retired')[0]).toHaveClass('text-amber-600');
    const prog = cells('FLT-PROG');
    expect(prog[1]).toBe('FLT-PROGManual entrySet B');
    expect(prog.slice(6, 12)).toEqual(['Pending', 'opr1', 'Pending', 'Pending', 'Pending', 'Pending']);
    expect(prog[13]).toBe('In Progress');
    const term = cells('FLT-TERM');
    expect(term.slice(5, 8)).toEqual(['Skipped', '2026-10-01 05:00', 'opr9']);
    expect(term[8]).toBe('Terminated');
    expect(within(rowOf('FLT-TERM')).getAllByText('Terminated')[0]).toHaveClass('text-slate-500');
    expect(within(rowOf('FLT-REPL')).getAllByText('Replaced')[0]).toHaveClass('text-purple-600');
    // A cycle with no filter name: dryer from the legacy DRY_IN event, temperature from DRY_OUT
    const odd = screen.getByText('ON_HOLD').closest('tr')!;
    const oddCells = within(odd).getAllByRole('cell').map((c) => c.textContent);
    expect(oddCells.slice(1, 3)).toEqual(['-', '-']);
    expect(oddCells.slice(7, 13)).toEqual(['-', '30m', '2026-10-01 03:00', '48 C', '2026-10-01 03:45', 'opr6']);
  });

  it('manual status updates render in the same columns: set stage in orange, jumped stages Skipped, NA outside the profile', async () => {
    open();
    await screen.findByText('FLT-MAN', { selector: 'td div' });
    const m1 = cells('FLT-MAN');
    expect(m1.slice(5, 13)).toEqual(['—', 'Skipped', 'admin1', '-', '2026-10-01 02:00', '-', 'Pending', 'Dry In']);
    expect(within(rowOf('FLT-MAN')).getByTitle('Set by manual update')).toHaveClass('text-orange-600');
    const m2 = cells('FLT-DONE');
    // to CLEANING_CYCLE_COMPLETED: every in-profile stage was jumped; out-of-profile = NA
    expect(m2.slice(5, 13)).toEqual(['Skipped', 'NA', 'deadbeef', '-', 'Skipped', '-', 'NA', 'Cleaning Cycle Completed']);
    const m3 = screen.getByText('WEIRD STATE').closest('tr')!;
    expect(within(m3).getAllByRole('cell').map((c) => c.textContent).slice(5, 7)).toEqual(['Pending', 'Pending']);
  });

  it('empty result reads "No records found" and offers no export', async () => {
    open(SA, [], {}, recordRoute([], [], 0));
    expect(await screen.findByText('No records found')).toBeInTheDocument();
    expect(screen.getByText(/0 records/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });

  it('a load failure is an alert with Retry; a 403 explains and offers none', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(SA, [], {}, { path: '/api/filters/cleaning-record', status: 500, body: { error: 'INTERNAL', message: 'Pool exhausted' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Pool exhausted');
    const before = listReads(api).length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listReads(api).length).toBeGreaterThan(before));
  });

  it('a 403 load says the viewer lacks permission', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('OPERATOR'), [], {}, { path: '/api/filters/cleaning-record', status: 403, body: { error: 'FORBIDDEN', message: 'Forbidden' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view this.');
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('View on a cycle row opens its detail page', async () => {
    open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.click(within(rowOf('FLT-001')).getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/cleaning-cycles/cyc-1');
  });

  it('View on a manual row shows it through the cycle detail view, badged Manual Update; Back closes it', async () => {
    open();
    await screen.findByText('FLT-MAN', { selector: 'td div' });
    fireEvent.click(within(rowOf('FLT-MAN')).getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Manual Update')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'FLT-MAN' })).toBeInTheDocument();
    expect(screen.getByText('AHU: AHU-1')).toBeInTheDocument();
    expect(screen.getByText('Dry In', { selector: '.rounded-md.border' })).toBeInTheDocument();
    expect(screen.getByText('fix')).toHaveClass('italic');
    fireEvent.click(screen.getByRole('button', { name: /Back to History/ }));
    expect(screen.queryByText('Manual Update')).toBeNull();
  });

  it('View on a manual completion with no performer name', async () => {
    open();
    await screen.findByText('FLT-DONE', { selector: 'td div' });
    fireEvent.click(within(rowOf('FLT-DONE')).getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Manual Update')).toBeInTheDocument();
    expect(screen.getByText('by deadbeef')).toBeInTheDocument();
  });
});

describe('Filter Cleaning Record — query', () => {
  it('status pills, filter, cascading block/area/AHU each narrow the server query and reset to page 1', async () => {
    const api = open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    // retired filters are not offered
    expect(screen.queryByRole('option', { name: 'FLT-RET' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(lastList(api).query.get('status')).toBe('COMPLETED'));
    const [blockSel, areaSel, ahuSel, filterSel] = screen.getAllByRole('combobox');
    expect(areaSel).toBeDisabled();
    expect(ahuSel).toBeDisabled();
    fireEvent.change(filterSel, { target: { value: 'f1' } });
    await waitFor(() => expect(lastList(api).query.get('filterId')).toBe('f1'));
    fireEvent.change(blockSel, { target: { value: 'b1' } });
    await waitFor(() => expect(api.calls('GET', '/api/hierarchy/areas')[0]?.query.get('blockId')).toBe('b1'));
    await screen.findByRole('option', { name: 'Area 1' });
    fireEvent.change(areaSel, { target: { value: 'ar1' } });
    await waitFor(() => expect(api.calls('GET', '/api/hierarchy/ahus')[0]?.query.get('areaId')).toBe('ar1'));
    await screen.findByRole('option', { name: 'AHU-1' });
    fireEvent.change(ahuSel, { target: { value: 'h1' } });
    await waitFor(() => {
      const q = lastList(api).query;
      expect([q.get('blockId'), q.get('areaId'), q.get('ahuId'), q.get('status'), q.get('page')]).toEqual(['b1', 'ar1', 'h1', 'COMPLETED', '1']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'All (9)' }));
    await waitFor(() => expect(lastList(api).query.get('status')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => {
      const q = lastList(api).query;
      expect([q.get('blockId'), q.get('filterId'), q.get('ahuId')]).toEqual([null, null, null]);
    });
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('search is debounced and sent trimmed', async () => {
    const api = open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.change(screen.getByPlaceholderText('Filter name…'), { target: { value: '  FLT-0  ' } });
    expect(lastList(api).query.get('search')).toBeNull();
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('FLT-0'));
  });

  it('pagination: Next asks for page 2; changing rows per page asks for that limit', async () => {
    const api = open(SA, [], {}, recordRoute(ROWS, ROWS, 60));
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    // second page numbers continue from the first
    await waitFor(() => expect(cells('FLT-001')[0]).toBe(String(Number(lastList(api).query.get('limit')) + 1)));
    const sizeSel = screen.getAllByRole('combobox').at(-1)!;
    fireEvent.change(sizeSel, { target: { value: '50' } });
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('50'));
  });

  it('an inverted date range is refused by the control (To before From)', async () => {
    const api = open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    const from = screen.getByLabelText('Cleaning history from date and time');
    const to = screen.getByLabelText('Cleaning history to date and time');
    fireEvent.change(to, { target: { value: '2026-10-01T00:00' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-01T00:00:59.999Z'));
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.change(from, { target: { value: '2026-10-05T00:00' } });
    expect(from).toHaveValue('');
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(lastList(api).query.get('from')).toBeNull();
  });


});

describe('Filter Cleaning Record — export', () => {
  it('is offered to REPORT_EXPORT / REPORT_GENERATE holders only', async () => {
    open(role('OPERATOR', ['CYCLE_READ']));
    await screen.findByText('FLT-001', { selector: 'td div' });
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });

  it('Excel: reads the WHOLE filtered record (100/page), drops manual rows, logs, then builds rows via the shared stage rule', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...C_TERM, id: `t${i}`, filterName: `T-${i}` }));
    const api = open(role('QA', ['REPORT_EXPORT']), [], {}, recordRoute(ROWS, [C1, M1, ...many]));
    vi.mocked(exportToExcel).mockImplementation(async () => { expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1); });
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.click(screen.getByRole('button', { name: 'Completed' }));
    await waitFor(() => expect(lastList(api).query.get('status')).toBe('COMPLETED'));
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    const exportReads = api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') === '100');
    expect(exportReads.map((r) => r.query.get('page'))).toEqual(['1', '2']);
    expect(exportReads[0].query.get('status')).toBe('COMPLETED');
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Cleaning Record', format: 'Excel', recordCount: 151 });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.sheetName).toBe('Cleaning Record');
    expect(arg.filename).toMatch(/^cleaning-cycles-All-Filters-\d{4}-\d{2}-\d{2}$/);
    expect(arg.head).toHaveLength(14);
    expect(arg.rows).toHaveLength(151);
    expect(arg.rows[0]).toEqual(['1', 'FLT-001', '610X610X292', '6.123 bar', '2 bar', '2026-10-01 08:00', '2026-10-01 09:00', 'opr1', '1h 30m', '2026-10-01 10:00', '55 °C', '2026-10-01 12:00', 'opr3', 'Completed']);
    // the export says Skipped / Terminated exactly where the screen does
    expect(arg.rows[1]).toEqual(['2', 'T-0', '-', '-', '-', 'Skipped', '2026-10-01 05:00', 'opr9', 'Terminated', 'Terminated', 'Terminated', 'Terminated', '-', 'Terminated']);
  });

  it('PDF: subtitle names filter, status, period and cycle count; landscape table at 7pt; saved after logging', async () => {
    const api = open(SA, [DT_LOCAL]);
    await screen.findByText('FLT-001', { selector: 'td div' });
    const [, , , filterSel] = screen.getAllByRole('combobox');
    fireEvent.change(filterSel, { target: { value: 'f1' } });
    fireEvent.change(screen.getByLabelText('Cleaning history from date and time'), { target: { value: '2026-10-01T00:00' } });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalledTimes(1));
    const cfg = vi.mocked(createReport).mock.calls[0][0];
    expect(cfg).toMatchObject({ reportKey: 'cleaning-cycle-history', title: 'Filter Cleaning Record', orientation: 'landscape' });
    expect(cfg.subtitle).toBe('Filter: FLT-001  |  Status: All  |  Period: 2026-10-01 00:00 to Now  |  Total: 6 cycle(s)');
    expect(cfg.legend?.map((l: any) => l.abbr)).toEqual(['NA', 'Skipped', 'Terminated', 'Pending']);
    const table = report.tables()[0];
    expect(table.fontSize).toBe(7);
    expect(table.body).toHaveLength(6);
    expect(report.save.mock.calls[0][0]).toMatch(/cleaning-cycles.*FLT-001.*\.pdf$/);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ reportType: 'Cleaning Record', format: 'PDF', recordCount: 6 });
  });

  it('PDF period with only a To date reads "Start to …"', async () => {
    open(SA, [DT_LOCAL]);
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.change(screen.getByLabelText('Cleaning history to date and time'), { target: { value: '2026-10-09T00:00' } });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toContain('Period: Start to 2026-10-09 00:00');
  });

  it('a selection holding only manual updates has nothing to export', async () => {
    const api = open(SA, [], {}, recordRoute(ROWS, [M1, M2]));
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('Excel');
    expect(await screen.findByText('This selection contains no cleaning cycles.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /OK|Close|Dismiss/i }));
    await exportVia('PDF');
    await waitFor(() => expect(screen.getAllByText('Nothing to export').length).toBeGreaterThan(0));
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(createReport).not.toHaveBeenCalled();
  });

  it('a whole record above the export limit is refused before it is all fetched', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ ...C_TERM, id: `t${i}` }));
    const api = open(SA, [], { exportLimit: { maxRecords: 120, message: '{count} rows is over {max}' } }, recordRoute(ROWS, many));
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('Excel');
    expect(await screen.findByText('200 rows is over 120')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') === '100')).toHaveLength(2);
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
  });

  // The server's 5,000-cycle merge cap was removed on 2026-09-04 (6c5749d, "no
  // record caps"); a mirror of it here labelled every complete export of 5,000+
  // cycles as truncated, on the document itself.
  it('a complete export of 5,000 cycles is not called truncated', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: `t${i}`, filterName: `T${i}`, status: 'COMPLETED', startedAt: ISO(1), events: [] }));
    const api = open(SA, [], {}, recordRoute(ROWS, many));
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled(), { timeout: 5000 });
    expect(screen.queryByText('Export truncated')).toBeNull();
    expect(screen.queryByText('Export incomplete')).toBeNull();
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toBe('Filter: All Filters  |  Status: All  |  Period: All Time  |  Total: 5000 cycle(s)');
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ recordCount: 5000 });
  });

  it('a record longer than 100 pages is read to the end: no cycle is dropped behind manual updates', async () => {
    // 9,990 manual updates (newest) ahead of 60 cycles: 10,050 rows. The read
    // used to stop after 100 pages of 100, exporting 10 of the 60 cycles with no
    // word, because the cycle count never reached the old 5,000 mark.
    const manual = Array.from({ length: 9990 }, (_, i) => ({ ...M1, id: `mm${i}` }));
    const cycles = Array.from({ length: 60 }, (_, i) => ({ ...C_TERM, id: `t${i}`, filterName: `T-${i}` }));
    const api = open(SA, [], {}, recordRoute(ROWS, [...manual, ...cycles]));
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1), { timeout: 10000 });
    expect(api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') === '100')).toHaveLength(101);
    expect(vi.mocked(exportToExcel).mock.calls[0][0].rows).toHaveLength(60);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ recordCount: 60 });
    expect(screen.queryByText('Export incomplete')).toBeNull();
  });

  it('a server that stops answering rows before its own total gets an honest incomplete notice, on screen and on the PDF', async () => {
    // Evidence, not a size: 150 rows arrive although the server reports 400.
    const short = Array.from({ length: 150 }, (_, i) => ({ ...C_TERM, id: `t${i}`, filterName: `T-${i}` }));
    const api = open(SA, [{ path: /\/api\/filters\/cleaning-record\?.*limit=100/, body: (req: MockRequest) => {
      const p = Number(req.query.get('page'));
      return { data: short.slice((p - 1) * 100, p * 100), total: 400 };
    } }]);
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(screen.getByText('Export incomplete')).toBeInTheDocument();
    expect(screen.getByText(/The server returned 150 of 400 records/)).toBeInTheDocument();
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toContain('Total: 150 cycle(s) (incomplete: the server returned 150 of 400 records');
    expect(api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') === '100')).toHaveLength(3);
  });

  it('a gated export prompts for the password and signs the log write', async () => {
    const api = open(SA, [], { reauthActions: ['EXPORT_CLEANING_RECORD'] });
    await screen.findByText('FLT-001', { selector: 'td div' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await exportVia('PDF');
    await passReauth();
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('a cancelled prompt exports nothing and shows no error; a failing read is reported', async () => {
    const api = open(SA, [], { reauthActions: ['EXPORT_CLEANING_RECORD'] });
    await screen.findByText('FLT-001', { selector: 'td div' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await exportVia('Excel');
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(screen.queryByText('Export failed')).toBeNull();
    // now the export read itself fails
    api.add({ path: /\/api\/filters\/cleaning-record\?.*limit=100/, status: 500, body: { error: 'INTERNAL', message: 'Export read failed' } });
    await exportVia('PDF');
    expect(await screen.findByText('Export read failed')).toBeInTheDocument();
    expect(screen.getByText('Export failed')).toBeInTheDocument();
  });
});

describe('Filter Cleaning Record — SUPER_ADMIN edit', () => {
  it('non-SA rows carry no edit pencil', async () => {
    open(role('QA', ['REPORT_EXPORT']));
    await screen.findByText('FLT-001', { selector: 'td div' });
    expect(screen.queryByRole('button', { name: 'Edit record (Super Admin)' })).toBeNull();
  });

  it('editing a cycle PUTs the changed cycle field with the reason and confirms', async () => {
    const api = open(SA, [
      { path: '/api/users', body: { data: [] } },
      { method: 'PUT', path: '/api/super-admin/data/cleaning-cycles/cyc-1', body: { ok: true } },
    ]);
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.click(within(rowOf('FLT-001')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit cleaning record - FLT-001' });
    const reasonLabel = within(dialog).getByText('Cleaning reason');
    fireEvent.change(reasonLabel.nextElementSibling!, { target: { value: 'PM visit' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: 'Wrong label keyed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Record updated')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/data/cleaning-cycles/cyc-1')[0].json).toEqual({ cleaningReasonLabel: 'PM visit', _changeReason: 'Wrong label keyed' });
  });

  it('a manual row opens the edit dialog for that single event; Close dismisses it', async () => {
    open(SA, [{ path: '/api/users', body: { data: [] } }]);
    await screen.findByText('FLT-MAN', { selector: 'td div' });
    fireEvent.click(within(rowOf('FLT-MAN')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit manual status update - FLT-MAN' });
    expect(within(dialog).queryByText('Cleaning reason')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Filter Cleaning Record — edges', () => {
  const C_NOEV = { id: 'c7', filterId: 'f7', filterName: 'FLT-NOEV', status: 'COMPLETED', startedAt: ISO(6), profileStages: ['WASH_IN', 'WASH_OUT'] };
  const C_MSTAGE = { id: 'c8', filterId: 'f8', filterName: 'FLT-MSTAGE', status: 'IN_PROGRESS', startedAt: ISO(6), events: [tr(null, 'WASH_IN', ISO(6), 'adm', { manual: true })] };
  const M4 = { _kind: 'manual', id: 'm4', filterName: null, fromState: null, toState: null, performedAt: ISO(1), performedByName: 'ghost-user' };
  const EDGE = [C_NOEV, C_MSTAGE, M4];

  it('a cycle with no events: in-profile stages Skipped, the rest NA, no performers; a manually-set stage is orange', async () => {
    open(SA, [], {}, recordRoute(EDGE));
    await screen.findByText('FLT-NOEV', { selector: 'td div' });
    expect(cells('FLT-NOEV').slice(3, 14)).toEqual(['-', '-', 'Skipped', 'Skipped', '-', 'NA', 'NA', 'NA', 'NA', '-', 'Completed']);
    const set = within(rowOf('FLT-MSTAGE')).getByTitle('Set by manual update');
    expect(set).toHaveTextContent('2026-10-01 06:00');
    // a manual row with no target state reads "-"
    const m4 = screen.getByText('ghost-user').closest('tr')!;
    expect(within(m4).getAllByRole('cell')[12]).toHaveTextContent('-');
  });

  it('SA edit + View on rows missing names/events still open (titles fall back)', async () => {
    open(SA, [{ path: '/api/users', body: { data: [] } }], {}, recordRoute(EDGE));
    await screen.findByText('FLT-NOEV', { selector: 'td div' });
    fireEvent.click(within(rowOf('FLT-NOEV')).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const d1 = await screen.findByRole('dialog', { name: 'Edit cleaning record - FLT-NOEV' });
    fireEvent.click(within(d1).getByRole('button', { name: 'Cancel' }));
    const m4 = screen.getByText('ghost-user').closest('tr')!;
    fireEvent.click(within(m4).getByRole('button', { name: 'Edit record (Super Admin)' }));
    const d2 = await screen.findByRole('dialog', { name: 'Edit manual status update -' });
    fireEvent.click(within(d2).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(screen.getByText('ghost-user').closest('tr')!).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByText('Manual Update')).toBeInTheDocument();
  });

  it('export of event-less cycles; a server that omits data/total ends the read; PDF over the limit is refused', async () => {
    const api = open(SA, [], { exportLimit: { maxRecords: 1 } }, recordRoute(ROWS, [C_NOEV]));
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expect(vi.mocked(exportToExcel).mock.calls[0][0].rows[0]).toEqual(['1', 'FLT-NOEV', '-', '-', '-', 'Skipped', 'Skipped', '-', 'NA', 'NA', 'NA', 'NA', '-', 'Completed']);
    // over the limit in the PDF path too
    api.add({ path: /\/api\/filters\/cleaning-record\?.*limit=100/, body: { data: [C_NOEV, C_NOEV], total: 2 } });
    await exportVia('PDF');
    expect(await screen.findByText('Export too large')).toBeInTheDocument();
    expect(createReport).not.toHaveBeenCalled();
  });

  it('an export read that answers without data/total exports nothing', async () => {
    const api = open(SA, [{ path: /\/api\/filters\/cleaning-record\?.*limit=100/, body: {} }]);
    await screen.findByText('FLT-001', { selector: 'td div' });
    await exportVia('PDF');
    expect(await screen.findByText('This selection contains no cleaning cycles.')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') === '100')).toHaveLength(1);
  });
});

// Regressions for the 2026-10-21 coverage-campaign defects D4 / D6 / D10.
describe('Filter Cleaning Record — date range, page size, search debounce', () => {
  it('D4: a picked From/To reaches the server as instants in the configured zone; To covers its whole minute', async () => {
    const api = open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.change(screen.getByLabelText('Cleaning history from date and time'), { target: { value: '2026-10-01T08:30' } });
    fireEvent.change(screen.getByLabelText('Cleaning history to date and time'), { target: { value: '2026-10-02T17:45' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-02T17:45:59.999Z'));
    expect(lastList(api).query.get('from')).toBe('2026-10-01T08:30:00.000Z');
    expect(lastList(api).query.get('page')).toBe('1');
  });

  it('D4: the bounds follow the configured timezone, not UTC', async () => {
    const kolkata: MockRoute = { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'Asia/Kolkata' } };
    const api = open(SA, [kolkata]);
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.change(screen.getByLabelText('Cleaning history from date and time'), { target: { value: '2026-10-01T08:30' } });
    await waitFor(() => expect(lastList(api).query.get('from')).toBe('2026-10-01T03:00:00.000Z'));
    expect(lastList(api).query.get('to')).toBeNull();
  });

  it('D4: the export reads the same bounded range as the list', async () => {
    const api = open();
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.change(screen.getByLabelText('Cleaning history from date and time'), { target: { value: '2026-10-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Cleaning history to date and time'), { target: { value: '2026-10-09T23:59' } });
    await waitFor(() => expect(lastList(api).query.get('to')).toBe('2026-10-09T23:59:59.999Z'));
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const exportReads = api.calls('GET', '/api/filters/cleaning-record').filter((r) => r.query.get('limit') === '100');
    expect(exportReads.length).toBeGreaterThan(0);
    for (const r of exportReads) {
      expect(r.query.get('from')).toBe('2026-10-01T00:00:00.000Z');
      expect(r.query.get('to')).toBe('2026-10-09T23:59:59.999Z');
    }
  });

  it('D6: the configured page size is used on a cold load', async () => {
    const api = open(SA, [], { pagination: { limit: 50, count: 50, options: [10, 25, 50] } });
    await screen.findByText('FLT-001', { selector: 'td div' });
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('50'));
  });

  it('D10: the search debounce does not reset a page change made right after mount', async () => {
    // Intercept ONLY the page's 350 ms search-debounce timers so the test decides
    // when they fire; every other timer (SWR, React, polling) stays real.
    const pending = new Map<unknown, () => void>();
    const realSet = globalThis.setTimeout;
    const realClear = globalThis.clearTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: (...a: any[]) => void, ms?: number, ...args: any[]) => {
      if (ms !== 350) return realSet(fn, ms, ...args);
      const h = realSet(() => {}, 2 ** 30);
      pending.set(h, () => fn(...args));
      return h;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((h: any) => { pending.delete(h); realClear(h); }) as typeof clearTimeout);
    const fireDebounce = () => act(() => { for (const [h, f] of [...pending]) { pending.delete(h); realClear(h as any); f(); } });

    const api = open(SA, [], {}, recordRoute(ROWS, ROWS, 60));
    await screen.findByText('FLT-001', { selector: 'td div' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    const firstRowOnPage2 = String(Number(lastList(api).query.get('limit')) + 1);
    await waitFor(() => expect(cells('FLT-001')[0]).toBe(firstRowOnPage2));
    // whatever the mount scheduled now fires: the operator must still be on page 2
    await fireDebounce();
    await act(async () => { await new Promise((r) => realSet(r, 50)); });
    expect(cells('FLT-001')[0]).toBe(firstRowOnPage2);
    // typing still debounces into a server-side search from page 1
    fireEvent.change(screen.getByPlaceholderText('Filter name…'), { target: { value: 'FLT' } });
    await fireDebounce();
    await waitFor(() => expect(listReads(api).some((r) => r.query.get('search') === 'FLT' && r.query.get('page') === '1')).toBe(true));
    await waitFor(() => expect(cells('FLT-001')[0]).toBe('1'));
  });
});
