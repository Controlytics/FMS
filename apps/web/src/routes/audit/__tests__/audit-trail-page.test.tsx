import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest } from '@/test-utils/page-harness';
import { captureConsole, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { VIEWER, EXPORTER, SA, REC, ROWS, page, auditRoutes, type AuditRouteOpts, listCalls, lastList, myActionsLoaded, rowOf, ack } from './audit-page-fixtures';
import { AuditTrailPage } from '../index';

// Full-page renders through the real SWR/auth/re-auth stack; under a loaded machine the
// default 5 s budget is too tight for the multi-step flows (budget only, no behaviour change).
vi.setConfig({ testTimeout: 20_000 });

/**
 * Audit Trail page. Real SWR -> apiClient -> fetch, real useAuth / useCan /
 * useReauth; only fetch is stubbed, plus the two FILE writers (jsPDF report and
 * the xlsx writer) whose inputs are asserted instead of producing a download.
 */

const pdf = vi.hoisted(() => ({ configs: [] as any[], reports: [] as any[] }));
vi.mock('@/lib/pdf-report', () => ({
  createReport: vi.fn(async (config: any) => {
    pdf.configs.push(config);
    const report = { addTable: vi.fn(), save: vi.fn(), getSnapshot: vi.fn(() => ({ title: config.title, sections: [{ kind: 'table' }] })) };
    pdf.reports.push(report);
    return report;
  }),
}));
const xls = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn(async (o: any) => { xls.calls.push(o); }) }));

const routes = auditRoutes;
type Opts = AuditRouteOpts;

let con: ConsoleCapture;
let prompt: MockInstance<typeof window.prompt>;
beforeEach(() => {
  con = captureConsole();
  pdf.configs.length = 0; pdf.reports.length = 0; xls.calls.length = 0;
  prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
});
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); prompt.mockRestore(); });

// ─────────────────────────────────────────────────────────────────────────────

describe('Audit Trail — read-only viewer (AUDIT_READ only)', () => {
  it('lists records with summary, inline diff, AHUs, redaction note and Fail status; no destructive or export controls', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    expect(screen.getByText('Loading audit records...')).toBeInTheDocument();

    expect(await screen.findByText('User "101020" updated by 101010')).toBeInTheDocument();
    // inline old -> new for an edit action
    expect(screen.getByText('old@x.io')).toHaveClass('line-through');
    expect(screen.getByText('new@x.io')).toBeInTheDocument();
    // AHU context from afterValue
    expect(screen.getByText('AHU-1, AHU-2')).toBeInTheDocument();
    expect(screen.getByText('AHU-7')).toBeInTheDocument();
    // redacted row names the redactor and the reason
    expect(within(rowOf(/PII entered by mistake/)).getByText('Payload redacted')).toBeInTheDocument();
    // a failed login reads Fail
    expect(within(rowOf('Failed login attempt for "intruder"')).getByText('Fail')).toBeInTheDocument();
    // total records in the header
    expect(screen.getByText('Total Records')).toBeInTheDocument();

    // read rights: every row can be opened...
    expect(screen.getAllByTitle('View record details')).toHaveLength(5);
    // ...but there is nothing to destroy, edit or export
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByTitle(/Redact record/)).toBeNull();
    expect(screen.queryByTitle(/Delete permanently/)).toBeNull();
    expect(screen.queryByTitle(/Edit record/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    // the SA-only lookups are never requested for a non-SA
    expect(api.calls('GET', '/api/users')).toHaveLength(0);

    const q = lastList(api).query;
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('20');
    expect(q.get('sortBy')).toBe('timestamp');
    expect(q.get('sortOrder')).toBe('desc');
    expect(api.unmatched).toEqual([]);
  });

  it('opening a record shows the change, without the SUPER_ADMIN-only record details', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');
    fireEvent.click(within(rowOf('User "101020" updated by 101010')).getByTitle('View record details'));
    const dlg = await screen.findByText('Audit Record Detail');
    expect(dlg).toBeInTheDocument();
    const panel = screen.getByTestId('audit-changes');
    expect(within(panel).getByText('Email')).toBeInTheDocument();
    expect(screen.queryByText('Record details')).toBeNull();
    expect(screen.queryByText('Integrity Checksum (SHA-256)')).toBeNull();
  });

  it('an empty trail says so', async () => {
    const api = mockApi(routes({ list: page([]) }));
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    expect(await screen.findByText('No audit records found')).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).toBeNull(); // no pager for zero rows
  });

  it('a long description is cut to two lines with the full text in a tooltip', async () => {
    const long = 'x'.repeat(260);
    const api = mockApi(routes({ list: page([REC({ id: 'L', action: 'SOMETHING_ELSE', beforeValue: { name: long }, afterValue: null })]) }));
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    const tip = await screen.findByRole('tooltip');
    expect(tip.textContent).toContain(long);
    expect(tip.previousElementSibling?.textContent?.endsWith('...')).toBe(true);
    expect(tip.previousElementSibling?.textContent?.length).toBe(230);
  });
});

describe('Audit Trail — sorting, search, date range, paging', () => {
  it('header buttons sort by action / performer / timestamp and flip direction on a second click', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');

    fireEvent.click(await screen.findByRole('button', { name: /^Action/ }));
    await waitFor(() => expect(lastList(api).query.get('sortBy')).toBe('action'));
    expect(lastList(api).query.get('sortOrder')).toBe('asc');
    expect(await screen.findByRole('button', { name: /^Action/ })).toHaveTextContent('↑');

    fireEvent.click(await screen.findByRole('button', { name: /^Action/ }));
    await waitFor(() => expect(lastList(api).query.get('sortOrder')).toBe('desc'));
    expect(await screen.findByRole('button', { name: /^Action/ })).toHaveTextContent('↓');

    fireEvent.click(await screen.findByRole('button', { name: /^Performed By/ }));
    await waitFor(() => expect(lastList(api).query.get('sortBy')).toBe('userId'));
    expect(lastList(api).query.get('sortOrder')).toBe('asc');
    expect(await screen.findByRole('button', { name: /^Timestamp/ })).toHaveTextContent('↕');

    fireEvent.click(await screen.findByRole('button', { name: /^Timestamp/ }));
    await waitFor(() => expect(lastList(api).query.get('sortBy')).toBe('timestamp'));
    expect(lastList(api).query.get('sortOrder')).toBe('desc');
  });

  it('search is debounced into the query; chips and Clear All remove filters; dates go out as UTC ISO', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');

    fireEvent.change(screen.getByPlaceholderText('Search by user, action, target...'), { target: { value: 'login' } });
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('login'));
    expect(screen.getByText('Search: login')).toBeInTheDocument();

    const [fromInput, toInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(fromInput, { target: { value: '2026-10-01T08:00' } });
    fireEvent.change(toInput, { target: { value: '2026-10-05T18:00' } });
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('startDate')).toBe(new Date('2026-10-01T08:00').toISOString());
      expect(q.get('endDate')).toBe(new Date('2026-10-05T18:00').toISOString());
    });
    expect(screen.getByText(/^From:/)).toBeInTheDocument();
    expect(screen.getByText(/^To:/)).toBeInTheDocument();

    // remove each chip with its own x
    fireEvent.click(within(screen.getByText(/^From:/)).getByRole('button'));
    await waitFor(() => expect(lastList(api).query.get('startDate')).toBeNull());
    fireEvent.click(within(screen.getByText(/^To:/)).getByRole('button'));
    await waitFor(() => expect(lastList(api).query.get('endDate')).toBeNull());
    fireEvent.click(within(screen.getByText('Search: login')).getByRole('button'));
    await waitFor(() => expect(lastList(api).query.get('search')).toBeNull());
    expect(screen.queryByText('Active Filters:')).toBeNull();

    // Clear All resets everything at once
    fireEvent.change(screen.getByPlaceholderText('Search by user, action, target...'), { target: { value: 'pm' } });
    fireEvent.change(fromInput, { target: { value: '2026-10-01T08:00' } });
    fireEvent.click(await screen.findByRole('button', { name: /Clear All/ }));
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('search')).toBeNull();
      expect(q.get('startDate')).toBeNull();
    });
    expect(screen.getByPlaceholderText('Search by user, action, target...')).toHaveValue('');
  });

  it('D6: a cold load settles on the configured default page size, not the pre-load fallback', async () => {
    const api = mockApi(routes({ list: page(ROWS, { total: 120, totalPages: 3 }), pageCfg: { limit: 50, options: [25, 50, 100] } }));
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('50'));
  });

  it('a capped total ("10,000+", 2026-10-22) reads as such in the header and the pager', async () => {
    const api = mockApi(routes({ list: page(ROWS, { total: 10000, totalCapped: true, totalPages: 500 }) }));
    const { container } = renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');
    expect(screen.getByText('Total Records').previousElementSibling).toHaveTextContent('10,000+');
    expect(container.textContent).toMatch(/Showing 1–5 of 10,000\+/);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('pages through the trail and changes the page size', async () => {
    const api = mockApi(routes({ list: page(ROWS, { total: 45, totalPages: 3 }) }));
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '50' } });
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('limit')).toBe('50');
      expect(q.get('page')).toBe('1');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Audit Trail — export (AUDIT_EXPORT)', () => {
  /** All records across 2 server pages of 200, so the exporter must page. */
  const exportRoutes = (o: Opts = {}) => routes({
    ...o,
    list: (req: MockRequest) => {
      if (req.query.get('limit') !== '200') return page(ROWS, { total: 5 });
      const n = Number(req.query.get('page'));
      return n === 1 ? { data: ROWS.slice(0, 3), total: 5 } : { data: ROWS.slice(3), total: 5 };
    },
  });

  async function openExport(which: 'PDF' | 'Excel') {
    fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${which}`) }));
  }

  it('the Export control is shown only with the export permission (and SUPER_ADMIN bypass)', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    expect(await screen.findByRole('button', { name: /^Export$/ })).toBeInTheDocument();
    cleanup();
    const api2 = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: SA, api: api2 });
    expect(await screen.findByRole('button', { name: /^Export$/ })).toBeInTheDocument();
  });

  it('PDF: fetches EVERY filtered record, records the download first, then saves the file', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/report-export-log', body: { ok: true } }, ...exportRoutes()]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');

    await waitFor(() => expect(pdf.reports[0]?.save).toHaveBeenCalled());
    const fetched = api.calls('GET', '/api/audit').filter((r) => r.query.get('limit') === '200').map((r) => r.query.get('page'));
    expect(fetched).toEqual(['1', '2']);
    const log = api.calls('POST', '/api/audit/report-export-log');
    expect(log).toHaveLength(1);
    expect(log[0].json).toMatchObject({ reportType: 'Audit Trail', format: 'PDF', recordCount: 5, period: 'All Time' });
    expect(log[0].json.filters).toEqual({}); // nothing applied, and the record says so

    expect(pdf.configs[0]).toMatchObject({ reportKey: 'audit-trail', title: 'Audit Trail', orientation: 'landscape' });
    expect(pdf.configs[0].subtitle).toContain('Total: 5 record(s)');
    const table = pdf.reports[0].addTable.mock.calls[0][0];
    expect(table.head).toEqual(['Timestamp', 'Action', 'User', 'Role', 'Target Type', 'Description', 'IP Address']);
    expect(table.body).toHaveLength(5);
    expect(table.body[0].slice(1, 5)).toEqual(['USER UPDATED', '101010', 'ADMIN', 'User']);
    // the redacted record announces itself in the exported description
    expect(table.body[3][5]).toMatch(/^\[REDACTED by sa: PII entered by mistake\]/);
    expect(table.body[0][5].length).toBeLessThanOrEqual(80);
    expect(pdf.reports[0].save.mock.calls[0][0]).toMatch(/^audit-trail.*\.pdf$/);
  });

  it('Excel: records the download then writes the sheet with the same columns', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/report-export-log', body: { ok: true } }, ...exportRoutes()]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    // the search + date filters travel into both the fetch and the log
    fireEvent.change(screen.getByPlaceholderText('Search by user, action, target...'), { target: { value: 'user' } });
    const [fromInput, toInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(fromInput, { target: { value: '2026-10-01T08:00' } });
    fireEvent.change(toInput, { target: { value: '2026-10-05T18:00' } });
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('user'));
    await openExport('Excel');

    await waitFor(() => expect(xls.calls).toHaveLength(1));
    expect(xls.calls[0]).toMatchObject({ sheetName: 'Audit Trail', head: ['Timestamp', 'Action', 'User', 'Role', 'Target Type', 'Description', 'IP Address'] });
    expect(xls.calls[0].filename).toMatch(/^audit-trail-\d{4}-\d{2}-\d{2}$/);
    expect(xls.calls[0].rows).toHaveLength(5);
    const exportFetch = api.calls('GET', '/api/audit').find((r) => r.query.get('limit') === '200')!;
    expect(exportFetch.query.get('search')).toBe('user');
    expect(exportFetch.query.get('startDate')).toBe(new Date('2026-10-01T08:00').toISOString());
    expect(exportFetch.query.get('endDate')).toBe(new Date('2026-10-05T18:00').toISOString());
    const log = api.calls('POST', '/api/audit/report-export-log')[0].json;
    expect(log).toMatchObject({ format: 'Excel', recordCount: 5, search: 'user', startDate: new Date('2026-10-01T08:00').toISOString(), endDate: new Date('2026-10-05T18:00').toISOString() });
    // 2026-10-22: every filter that produced the file is on its audit record.
    expect(log.filters).toEqual({ Search: 'user', From: '2026-10-01T08:00', To: '2026-10-05T18:00' });
    expect(log.period).toMatch(/ to /);
    expect(pdf.reports).toHaveLength(0);
  });

  it('fail-closed: when the download cannot be recorded, no file is produced', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/report-export-log', status: 403, body: { error: 'FORBIDDEN', message: 'Insufficient permissions' } }, ...exportRoutes()]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');
    expect(await screen.findByText('Export blocked')).toBeInTheDocument();
    expect(screen.getByText(/Insufficient permissions\. Download cancelled\./)).toBeInTheDocument();
    expect(pdf.reports[0].save).not.toHaveBeenCalled();
    await ack('Export blocked');

    await openExport('Excel');
    expect(await screen.findByText('Export blocked')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(2);
    expect(xls.calls).toHaveLength(0);
  });

  it('EXPORT_AUDIT_TRAIL re-auth: the password signs the log write, then the file is saved', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/report-export-log', body: { ok: true } }, ...exportRoutes({ reauth: ['EXPORT_AUDIT_TRAIL'] })]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(pdf.reports[0].save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Pw@12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(pdf.reports[0].save).toHaveBeenCalled());
    const log = api.calls('POST', '/api/audit/report-export-log')[0];
    expect(log.headers['x-reauth-password']).toBe('Pw@12345');
    expect(log.json._currentPassword).toBe('Pw@12345');
  });

  it('cancelling the export password prompt produces no file and no error', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/report-export-log', body: { ok: true } }, ...exportRoutes({ reauth: ['EXPORT_AUDIT_TRAIL'] })]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('Excel');
    await screen.findByText('Confirm Your Identity');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(xls.calls).toHaveLength(0);
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(screen.queryByText(/Export (blocked|failed)/)).toBeNull();
    // the PDF path too
    await openExport('PDF');
    await screen.findByText('Confirm Your Identity');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(pdf.reports[0].save).not.toHaveBeenCalled();
    expect(screen.queryByText(/Export (blocked|failed)/)).toBeNull();
  });

  it('the export counts exactly (exactTotal) — the page list never does — and refuses before fetching every page', async () => {
    const api = mockApi(exportRoutes({ exportMax: 3 }));
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');
    expect(await screen.findByText('Export too large')).toBeInTheDocument();
    expect(screen.getByText(/match 5 records/)).toBeInTheDocument();
    const exportCalls = api.calls('GET', '/api/audit').filter((r) => r.query.get('limit') === '200');
    expect(exportCalls).toHaveLength(1);                                   // refused on page 1's exact total
    expect(exportCalls[0].query.get('exactTotal')).toBe('true');
    expect(listCalls(api).every((r) => r.query.get('exactTotal') === null)).toBe(true);
  });

  it('refuses an export larger than the configured limit, and says when nothing matches', async () => {
    const api = mockApi(exportRoutes({ exportMax: 3 }));
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');
    expect(await screen.findByText('Export too large')).toBeInTheDocument();
    expect(screen.getByText(/match 5 records, which exceeds the maximum export limit of 3/)).toBeInTheDocument();
    await ack('Export too large');
    await openExport('Excel');
    expect(await screen.findByText('Export too large')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(pdf.reports).toHaveLength(0);
    expect(xls.calls).toHaveLength(0);
  });

  it('says "Nothing to export" when the filtered fetch returns no rows', async () => {
    const api = mockApi(routes({ list: (req: MockRequest) => (req.query.get('limit') === '200' ? { data: [], total: 0 } : page(ROWS)) }));
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');
    expect(await screen.findByText('Nothing to export')).toBeInTheDocument();
    expect(screen.getByText('No audit records match the current filters.')).toBeInTheDocument();
    await ack('Nothing to export');
    await openExport('Excel');
    expect(await screen.findByText('Nothing to export')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
  });

  it('a failed fetch of the records reports "Export failed"', async () => {
    const api = mockApi([
      { path: /\/api\/audit\?.*limit=200/, status: 500, body: { error: 'INTERNAL', message: 'db timeout' } },
      ...routes(),
    ]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await openExport('PDF');
    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(screen.getByText('db timeout')).toBeInTheDocument();
    await ack('Export failed');
    await openExport('Excel');
    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    expect(xls.calls).toHaveLength(0);
  });

  it('custom report labels, a search term and a From-only range shape the PDF; sparse rows export "-" placeholders; a response without a total stops paging', async () => {
    // action is NOT NULL in audit_trail; userId / userRole / ipAddress are nullable
    const sparse = { id: 's1', timestamp: '2026-10-20T08:30:00.000Z', action: 'SYSTEM_TICK', userId: null, userRole: null, ipAddress: null, targetType: 'asset_relationship', beforeValue: null, afterValue: null };
    const api = mockApi([
      { method: 'POST', path: '/api/audit/report-export-log', body: { ok: true } },
      { path: '/api/config/report-labels/current', body: { 'audit-trail': { title: 'GxP Activity Log', subtitle: 'Site 2 — Line A', columns: { user: 'Performed by' } } } },
      ...routes({ list: (req: MockRequest) => (req.query.get('limit') === '200' ? { data: [sparse, REC({ id: 's2' })] } : page(ROWS)) }),
    ]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    // page header + report wrapper both carry the configured title
    expect((await screen.findAllByRole('heading', { name: 'GxP Activity Log' })).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByPlaceholderText('Search by user, action, target...'), { target: { value: 'ahu' } });
    const [fromInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(fromInput, { target: { value: '2026-10-01T08:00' } });
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('ahu'));
    await openExport('PDF');
    await waitFor(() => expect(pdf.reports[0]?.save).toHaveBeenCalled());

    // one page only: no total on the response means "this is everything"
    expect(api.calls('GET', '/api/audit').filter((r) => r.query.get('limit') === '200')).toHaveLength(1);
    expect(pdf.configs[0]).toMatchObject({ title: 'GxP Activity Log', subtitle: 'Site 2 — Line A' });
    const table = pdf.reports[0].addTable.mock.calls[0][0];
    expect(table.head[2]).toBe('Performed by');
    expect(table.body[0].slice(1)).toEqual(['SYSTEM TICK', '-', '-', 'Hierarchy Link', 'system tick by System', '-']);
    const log = api.calls('POST', '/api/audit/report-export-log')[0].json;
    expect(log.period).toMatch(/ to Now$/);
    expect(log.search).toBe('ahu');
  });

  it('a To-only range exports "Start to …" and the auto subtitle names the search', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/report-export-log', body: { ok: true } }, ...routes({ list: (req: MockRequest) => (req.query.get('limit') === '200' ? { data: ROWS, total: 5 } : page(ROWS)) })]);
    renderPage(<AuditTrailPage />, { user: EXPORTER, api });
    await myActionsLoaded(api);
    await screen.findByText('User "101020" updated by 101010');
    fireEvent.change(screen.getByPlaceholderText('Search by user, action, target...'), { target: { value: 'pm' } });
    const [, toInput] = document.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    fireEvent.change(toInput, { target: { value: '2026-10-05T18:00' } });
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('pm'));
    await openExport('PDF');
    await waitFor(() => expect(pdf.reports[0]?.save).toHaveBeenCalled());
    expect(pdf.configs[0].subtitle).toMatch(/^Period: Start to .+ {2}\| {2}Search: "pm"/);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json.period).toMatch(/^Start to /);
  });
});

describe('Audit Trail — dialogs and sort indicators', () => {
  it('the detail dialog closes on Escape; SUPER_ADMIN sees the record details + checksum', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: SA, api });
    await screen.findByText('User "101020" updated by 101010');
    fireEvent.click(within(rowOf('User "101020" updated by 101010')).getByTitle('View record details'));
    expect(await screen.findByText('Audit Record Detail')).toBeInTheDocument();
    expect(screen.getByText('Record details')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Audit Record Detail')).toBeNull());
  });

  it('the hard-delete confirm dialog closes on Cancel without sending', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: SA, api });
    await screen.findByText('User "101020" updated by 101010');
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(6));
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.click(screen.getByRole('button', { name: /Delete Permanently/ }));
    expect(screen.getByText('Delete Audit Records')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Delete Audit Records')).toBeNull();
    expect(api.calls('POST', '/api/audit/bulk-delete')).toHaveLength(0);
  });

  it('timestamp toggles to ascending, performer toggles to descending, each with its arrow; a row with no user shows "?"', async () => {
    const api = mockApi(routes({ list: page([...ROWS, REC({ id: 'nouser', userId: null, targetId: null, action: 'SYSTEM_TICK', beforeValue: null, afterValue: null })]) }));
    renderPage(<AuditTrailPage />, { user: VIEWER, api });
    await screen.findByText('User "101020" updated by 101010');
    expect(within(rowOf('system tick by System')).getByText('?')).toBeInTheDocument();

    // the table header unmounts while each re-sorted page loads, so re-find it every step
    fireEvent.click(screen.getByRole('button', { name: /^Timestamp/ }));
    await waitFor(() => expect(lastList(api).query.get('sortOrder')).toBe('asc'));
    expect(await screen.findByRole('button', { name: /^Timestamp/ })).toHaveTextContent('↑');

    fireEvent.click(await screen.findByRole('button', { name: /^Performed By/ }));
    await waitFor(() => expect(lastList(api).query.get('sortBy')).toBe('userId'));
    fireEvent.click(await screen.findByRole('button', { name: /^Performed By/ }));
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('sortBy')).toBe('userId');
      expect(q.get('sortOrder')).toBe('desc');
    });
    expect(await screen.findByRole('button', { name: /^Performed By/ })).toHaveTextContent('↓');
  });
});
