import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, LocationProbe, completedCycle, fakeReport, ISO } from './cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { CleaningCycleTimelinePage } from '../timeline';

usePageTestLifecycle();
// These pages chain many SWR reads; give them headroom when the machine is busy.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); });

const LOG = { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } } as const;

function open(user: any, cycleRoute: MockRoute | MockRoute[] = { path: '/api/filters/cycles/cyc-1', body: completedCycle() }, base = {}) {
  const api = mockApi([...([] as MockRoute[]).concat(cycleRoute), LOG, DT_UTC, ...baseRoutes(base)]);
  renderPage(<><CleaningCycleTimelinePage /><LocationProbe /></>, { route: '/cleaning-cycles/cyc-1', path: '/cleaning-cycles/:id', user, api });
  return api;
}
const exportVia = (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Cycle detail page (timeline.tsx)', () => {
  it('loads the cycle by id and renders the shared detail view; Back returns to the history', async () => {
    const api = open(SA);
    expect(await screen.findByRole('heading', { name: 'FLT-001' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/cleaning-cycles/cyc-1');
    expect(api.calls('GET', '/api/filters/cycles/cyc-1')).toHaveLength(1);
    // only retire/replace-ended cycles need the audit lists
    expect(api.calls('GET', '/api/filters/retirements')).toHaveLength(0);
    expect(api.unmatched).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Back to History/ }));
    // navigated to /cleaning-cycles: the :id route no longer matches, so the detail page is gone
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'FLT-001' })).toBeNull());
    expect(screen.queryByTestId('location')).toBeNull();
  });

  it('shows a spinner while loading', async () => {
    const api = mockApi([DT_UTC, ...baseRoutes()]);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/api/filters/cycles/')) await gate;
      return (realFetch as any)(input, init);
    }));
    api.add({ path: '/api/filters/cycles/cyc-1', body: completedCycle() });
    renderPage(<CleaningCycleTimelinePage />, { route: '/cleaning-cycles/cyc-1', path: '/cleaning-cycles/:id', user: SA, api });
    expect(await screen.findByText('Loading cycle details...')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('heading', { name: 'FLT-001' })).toBeInTheDocument();
  });

  it('a real 404 reads "Cycle not found"', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(SA, { path: '/api/filters/cycles/cyc-1', status: 404, body: { error: 'NOT_FOUND', message: 'Cycle not found' } });
    expect(await screen.findByText('Cycle not found', { selector: 'div' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a 500 shows the server message with Retry, and Retry refetches', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(SA, [
      { path: '/api/filters/cycles/cyc-1', status: 500, times: 1, body: { error: 'INTERNAL', message: 'DB timeout' } },
      { path: '/api/filters/cycles/cyc-1', body: completedCycle() },
    ]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load this cycle');
    expect(alert).toHaveTextContent('DB timeout');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'FLT-001' })).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cycles/cyc-1')).toHaveLength(2);
  });

  it('a 403 says the viewer lacks permission and offers no Retry', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('OPERATOR'), { path: '/api/filters/cycles/cyc-1', status: 403, body: { error: 'FORBIDDEN', message: 'Forbidden' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view this.');
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('a role without REPORT_EXPORT/REPORT_GENERATE sees neither Export nor Edit record', async () => {
    open(role('OPERATOR', ['CYCLE_READ']));
    await screen.findByRole('heading', { name: 'FLT-001' });
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
  });

  it('REPORT_GENERATE alone enables Export but not the SUPER_ADMIN edit', async () => {
    open(role('QA', ['REPORT_GENERATE']));
    await screen.findByRole('heading', { name: 'FLT-001' });
    expect(screen.getByRole('button', { name: /^Export$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
  });

  it('Excel export: the event timeline as rows, logged before the file is built', async () => {
    const api = open(role('QA', ['REPORT_EXPORT']));
    vi.mocked(exportToExcel).mockImplementation(async () => { expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1); });
    await screen.findByRole('heading', { name: 'FLT-001' });
    exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Cleaning Cycle Detail', format: 'Excel', recordCount: 5 });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.filename).toBe('cycle-FLT-001-2026-10-01');
    expect(arg.head).toEqual(['S.No', 'Event', 'From', 'To', 'Performed By', 'Time', 'Remarks']);
    expect(arg.rows).toEqual([
      ['1', 'STATE TRANSITION', 'To Be Cleaned', 'WASH IN', 'opr1', '2026-10-01 08:00', '-'],
      ['2', 'STATE TRANSITION', 'WASH IN', 'WASH OUT', 'opr1', '2026-10-01 09:00', '-'],
      ['3', 'STATE TRANSITION', 'WASH OUT', 'DRY IN (Started)', 'opr2', '2026-10-01 10:00', '-'],
      ['4', 'STATE TRANSITION', 'DRY IN', 'DRY IN (Ended)', 'opr2', '2026-10-01 11:30', '-'],
      ['5', 'STATE TRANSITION', 'DRY IN', 'DRY OUT', 'opr3', '2026-10-01 12:00', '-'],
    ]);
  });

  it('Excel export of a cycle with non-transition events and no name/events falls back cleanly', async () => {
    open(SA, { path: '/api/filters/cycles/cyc-1', body: { id: 'cyc-1', status: 'COMPLETED', startedAt: ISO(8), events: [
      { id: 'e', eventType: 'REMARK_ADDED', performedAt: ISO(9), remarks: 'note' },
    ] } });
    await screen.findByRole('heading', { name: 'Filter' });
    exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.filename).toBe('cycle-filter-2026-10-01');
    expect(arg.rows).toEqual([['1', 'REMARK ADDED', '-', '-', '-', '2026-10-01 09:00', 'note']]);
  });

  it('PDF export: header line names filter / AHU / set / status, the detail is appended, then logged and saved', async () => {
    const api = open(SA);
    await screen.findByRole('heading', { name: 'FLT-001' });
    exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({
      reportKey: 'cleaning-cycle-detail', title: 'Cleaning Cycle Detail', orientation: 'portrait',
      subtitle: 'Filter: FLT-001  |  AHU: AHU-1  |  Set A  |  Status: COMPLETED',
    });
    expect(report.titles()).toEqual(['Stage Progress', 'Event Timeline']);
    expect(report.kvs()[0]['Completed by']).toBe('opr2');
    expect(report.save.mock.calls[0][0]).toMatch(/^cycle.*FLT-001.*\.pdf$/);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Cleaning Cycle Detail', format: 'PDF', recordCount: 5 });
  });

  it('PDF of a minimal cycle: header omits AHU/set; a build failure is reported, not swallowed', async () => {
    open(SA, [
      { path: '/api/filters/cycles/cyc-1', body: { id: 'cyc-1', status: 'TERMINATED', terminationReason: 'RETIRED', filterId: 'f9', startedAt: ISO(8) } },
      { path: '/api/filters/retirements', body: [] },
      { path: '/api/filters/replacements', body: [] },
    ]);
    await screen.findByRole('heading', { name: 'Filter' });
    exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toBe('Filter: -  |  Status: RETIRED');
    vi.mocked(createReport).mockRejectedValueOnce(new Error('jsPDF font load failed'));
    exportVia('PDF');
    expect(await screen.findByText('jsPDF font load failed')).toBeInTheDocument();
    expect(screen.getByText('Export failed')).toBeInTheDocument();
  });

  it('a RETIRED cycle fetches the retirement list and names its retirer as "Terminated by"', async () => {
    const api = open(SA, [
      { path: '/api/filters/cycles/cyc-1', body: { id: 'cyc-1', filterId: 'f1', filterName: 'FLT-001', status: 'TERMINATED', terminationReason: 'RETIRED', startedAt: ISO(8), completedAt: ISO(9), events: [] } },
      { path: '/api/filters/retirements', body: [{ id: 'f0', retiredBy: 'someone-else' }, { id: 'f1', retiredBy: 'qa-retirer' }] },
      { path: '/api/filters/replacements', body: [] },
    ]);
    await screen.findByRole('heading', { name: 'FLT-001' });
    await waitFor(() => expect(screen.getByText('Terminated by').nextSibling).toHaveTextContent('qa-retirer'));
    expect(api.calls('GET', '/api/filters/replacements')).toHaveLength(1);
  });

  it('a REPLACED cycle names the replacer from the replacements list', async () => {
    open(SA, [
      { path: '/api/filters/cycles/cyc-1', body: { id: 'cyc-1', filterId: 'f1', filterName: 'FLT-001', status: 'TERMINATED', terminationReason: 'REPLACED', startedAt: ISO(8), completedAt: ISO(9), events: [] } },
      { path: '/api/filters/retirements', body: [] },
      { path: '/api/filters/replacements', body: [{ oldFilterId: 'f1', performedBy: 'qa-replacer' }] },
    ]);
    await screen.findByRole('heading', { name: 'FLT-001' });
    await waitFor(() => expect(screen.getByText('Terminated by').nextSibling).toHaveTextContent('qa-replacer'));
  });

  it('a gated export asks for the password and signs the export-log write', async () => {
    const api = open(SA, undefined, { reauthActions: ['EXPORT_CLEANING_CYCLE_DETAIL'] });
    await screen.findByRole('heading', { name: 'FLT-001' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    exportVia('Excel');
    expect(await screen.findByText(/Performing "Export Cleaning Cycle Detail" requires identity verification/)).toBeInTheDocument();
    await passReauth();
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('a server REAUTH_REQUIRED (stale gate list) opens the prompt and the retried write is signed', async () => {
    const api = open(SA, [{ path: '/api/filters/cycles/cyc-1', body: completedCycle() }, reauthOnce('POST', '/api/audit/report-export-log')]);
    await screen.findByRole('heading', { name: 'FLT-001' });
    exportVia('PDF');
    await passReauth();
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    const posts = api.calls('POST', '/api/audit/report-export-log');
    expect(posts).toHaveLength(2);
    expect(posts[0].headers['x-reauth-password']).toBeUndefined();
    expectSigned(posts[1]);
  });

  it('a wrong password keeps the prompt open with "Incorrect password"; cancelling exports nothing, silently', async () => {
    const api = open(SA, [
      { path: '/api/filters/cycles/cyc-1', body: completedCycle() },
      { method: 'POST', path: '/api/audit/report-export-log', status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } },
    ], { reauthActions: ['EXPORT_CLEANING_CYCLE_DETAIL'] });
    await screen.findByRole('heading', { name: 'FLT-001' });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    exportVia('Excel');
    await passReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(screen.queryByText('Export failed')).toBeNull();
  });

  it('SUPER_ADMIN edits the record: the dialog PUTs only the changed event with the reason, then confirms', async () => {
    const api = open(SA, [
      { path: '/api/filters/cycles/cyc-1', body: completedCycle() },
      { path: '/api/users', body: { data: [{ id: 'u1', username: 'opr1', fullName: 'Operator One' }] } },
      { method: 'PUT', path: '/api/super-admin/data/filter-events/e2', body: { ok: true } },
    ]);
    await screen.findByRole('heading', { name: 'FLT-001' });
    fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit cleaning record - FLT-001' });
    const remarks = within(dialog).getAllByText('Remarks').map((l) => l.nextElementSibling as HTMLInputElement);
    fireEvent.change(remarks[1], { target: { value: 'Washed twice' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for this change/), { target: { value: 'Operator forgot remark' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Record updated')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/super-admin/data/filter-events/e2')[0].json).toEqual({ remarks: 'Washed twice', _changeReason: 'Operator forgot remark' });
    expect(screen.queryByRole('dialog', { name: /Edit cleaning record/ })).toBeNull();
  });

  it('SUPER_ADMIN edit dialog closes on Cancel without writing', async () => {
    const api = open(SA, [{ path: '/api/filters/cycles/cyc-1', body: completedCycle() }, { path: '/api/users', body: { data: [] } }]);
    await screen.findByRole('heading', { name: 'FLT-001' });
    fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit cleaning record - FLT-001' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: /Edit cleaning record/ })).toBeNull();
    expect(api.requests.filter((r) => r.method === 'PUT')).toEqual([]);
  });
});

describe('Cycle detail page — edges', () => {
  it('without an id in the route nothing is fetched and it reads "Cycle not found"', async () => {
    const api = mockApi([DT_UTC, ...baseRoutes()]);
    renderPage(<CleaningCycleTimelinePage />, { route: '/cleaning-cycles', user: SA, api });
    expect(await screen.findByText('Cycle not found')).toBeInTheDocument();
    expect(api.calls('GET', /\/api\/filters\/cycles/)).toHaveLength(0);
  });

  it('a cycle with no events array: Excel has no rows; the SA editor opens with only the cycle fields', async () => {
    open(SA, [
      { path: '/api/filters/cycles/cyc-1', body: { id: 'cyc-1', status: 'COMPLETED', startedAt: ISO(8) } },
      { path: '/api/users', body: { data: [] } },
    ]);
    await screen.findByRole('heading', { name: 'Filter' });
    exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    expect(vi.mocked(exportToExcel).mock.calls[0][0].rows).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit cleaning record -' })).toBeInTheDocument();
  });
});
