import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, passReauth, expectSigned, type BaseRouteOpts } from './fm-test-kit';

const pdf = { addTable: vi.fn(), save: vi.fn(), getSnapshot: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
import { createReport } from '@/lib/pdf-report';
import { ReplacementSchedulePage } from '../replacement-schedule';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const ENTRIES = [
  { id: 'e1', slNo: 1, ahuName: 'AHU-1', ahuId: 'a1', filterMicron: '10', filterSize: '610x610', qty: 4, scheduleDate: '2026-11-01T00:00:00Z', toleranceDays: 5, computedStatus: 'DUE', approvalStatus: 'PENDING_REVIEW', submittedByName: 'uploader' },
  { id: 'e2', slNo: 2, ahuName: 'AHU-1', ahuId: 'a1', filterMicron: '10', filterSize: '305x610', qty: 2, scheduleDate: '2026-11-02T00:00:00Z', toleranceDays: 5, computedStatus: 'IN_PROGRESS', approvalStatus: 'PENDING_APPROVAL', submittedByName: 'uploader', reviewedByName: 'mgr' },
  { id: 'e3', slNo: 3, ahuName: 'AHU-1', ahuId: 'a1', filterMicron: '5', filterSize: '', qty: 1, scheduleDate: '2026-11-03T00:00:00Z', toleranceDays: 3, computedStatus: 'COMPLETED', approvalStatus: 'APPROVED', submittedByName: 'uploader', reviewedByName: 'mgr', approvedByName: 'qa1' },
  { id: 'e4', ahuName: 'AHU-2', ahuId: 'a2', filterMicron: null, filterSize: '[object Object]', qty: 3, scheduleDate: '2026-11-04T00:00:00Z', toleranceDays: 2, computedStatus: 'MISSED', approvalStatus: 'REJECTED', approvalRemarks: 'Wrong quantity', submittedByName: 'uploader' },
  { id: 'e5', ahuName: 'AHU-3', ahuId: null, filterMicron: '3', filterSize: '592x592', qty: 6, scheduleDate: '2026-11-05T00:00:00Z', toleranceDays: 1, approvalStatus: 'PENDING', submittedByName: 'qa1' },
  { id: 'e6', ahuName: 'AHU-2', ahuId: 'a2', filterMicron: '7', filterSize: '500x500', qty: 1, scheduleDate: '2026-11-06T00:00:00Z', toleranceDays: 2, computedStatus: 'PENDING', approvalStatus: 'PENDING_REVIEW', submittedByName: 'mgr' },
];
const SCHEDULES = { data: [{ id: 's1', uploadedByName: 'uploader', createdAt: '2026-10-01T10:00:00Z', entries: ENTRIES }] };

const MANAGER = { role: 'MANAGER', username: 'mgr', permissions: ['REPLACEMENT_SCHEDULE_VIEW', 'REPLACEMENT_SCHEDULE_REVIEW'] };
const QA = { role: 'QA', username: 'qa1', permissions: ['REPLACEMENT_SCHEDULE_VIEW', 'REPLACEMENT_SCHEDULE_APPROVE'] };
const VIEWER = { role: 'OPERATOR', username: 'op', permissions: ['REPLACEMENT_SCHEDULE_VIEW'] };

function setup(extra: MockRoute[] = [], base: BaseRouteOpts = {}, schedules: any = SCHEDULES, filtersEnabled = true) {
  return mockApi([
    ...extra,
    { path: '/api/replacement-schedules', body: schedules },
    { path: '/api/config/replacement-schedule-filters/current', body: { enabled: filtersEnabled } },
    { path: '/api/assets/identifiers', body: { data: [
      { assetId: 'f1', identifierType: 'RFID', identifierValue: 'E2001' },
      { assetId: 'f1', identifierType: 'RFID', identifierValue: 'E2002' },
      { assetId: 'f2', identifierType: 'QR', identifierValue: 'QR-9' },
    ] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } },
    ...baseRoutes(base),
  ]);
}

const rowOf = (text: string) => screen.getByText(text).closest('tr')! as HTMLElement;

describe('Replacement Schedule page — table', () => {
  it('shows a loading state, then grouped rows with merged AHU numbering, NA cells and chips', async () => {
    const api = setup();
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await screen.findByText('610x610');
    expect(screen.getByText('6 scheduled replacement(s)')).toBeInTheDocument();
    expect(screen.getByText(/last upload by uploader/)).toBeInTheDocument();
    // AHU-1 rows sort micron 5 before 10 (numeric) — the first AHU-1 row carries S.No 1 and the merged cells.
    const firstAhu1 = rowOf('AHU-1');
    // SA sees the selection column first; the merged S.No cell follows it
    expect(within(firstAhu1).getAllByRole('cell')[1]).toHaveTextContent(/^1$/);
    expect(firstAhu1).toHaveTextContent('COMPLETED');
    expect(firstAhu1).toHaveTextContent('Approved');
    // blank filterSize and stray "[object Object]" both read NA; null micron reads NA
    expect(within(firstAhu1).getAllByText('NA').length).toBeGreaterThanOrEqual(1);
    const rejected = rowOf('Wrong quantity');
    expect(rejected).toHaveTextContent('Rejected');
    expect(rejected).toHaveTextContent('MISSED');
    expect(within(rejected).getAllByText('NA')).toHaveLength(2);
    expect(rowOf('592x592')).toHaveTextContent('Pending');
    expect(rowOf('592x592')).toHaveTextContent('PENDING');
    expect(rowOf('305x610')).toHaveTextContent('To Approve');
    expect(rowOf('305x610')).toHaveTextContent('IN PROGRESS');
    expect(rowOf('610x610')).toHaveTextContent('To Review');
    expect(api.unmatched).toEqual([]);
  });

  it('empty schedule: an uploader is told to upload; a viewer is not offered Upload', async () => {
    const api = setup([], {}, { data: [] });
    const { unmount } = renderPage(<ReplacementSchedulePage />, { user: SA, api });
    expect(await screen.findByText('No replacement schedule yet')).toBeInTheDocument();
    expect(screen.getByText('Upload a schedule template to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload Schedule/ })).toBeInTheDocument();
    unmount();
    localStorage.clear(); // useAuth caches the previous user; start the second role cold
    const api2 = setup([], {}, { data: [] });
    renderPage(<ReplacementSchedulePage />, { user: VIEWER, api: api2 });
    expect(await screen.findByText('No schedule has been uploaded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload Schedule/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Review ✓|Approve/ })).toBeNull();
    // no selection column for a viewer
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('a viewer sees no workflow buttons and no selection column', async () => {
    const api = setup();
    renderPage(<ReplacementSchedulePage />, { user: VIEWER, api });
    await screen.findByText('610x610');
    expect(screen.queryByRole('button', { name: 'Review ✓' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('expanding an AHU lazy-loads its filters with RFID tags, set and NA attributes', async () => {
    const api = setup([
      { path: /\/api\/hierarchy\/filters\?ahuId=a1/, body: { data: [
        { id: 'f1', name: 'FLT-A', filterSet: 'SET_A', attributes: { micronSize: '10', filterSize: ' ' }, currentLifecycleState: 'WASH_IN' },
        { id: 'f2', name: 'FLT-B', attributes: null },
      ] } },
      { path: /\/api\/hierarchy\/filters\?ahuId=a2/, body: { data: [] } },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: 'AHU-1' }));
    expect(await screen.findByText('FLT-A')).toBeInTheDocument();
    const fA = rowOf('FLT-A');
    expect(fA).toHaveTextContent('Set A');
    expect(fA).toHaveTextContent('E2001, E2002');
    expect(fA).toHaveTextContent('WASH IN');
    expect(within(fA).getByText('NA')).toBeInTheDocument();
    const fB = rowOf('FLT-B');
    expect(fB).toHaveTextContent('—');
    expect(fB).toHaveTextContent('To Be Cleaned');
    fireEvent.click(screen.getByRole('button', { name: 'AHU-2' }));
    expect(await screen.findByText('No filters under this AHU.')).toBeInTheDocument();
    // collapse
    fireEvent.click(screen.getByRole('button', { name: 'AHU-1' }));
    expect(screen.queryByText('FLT-A')).toBeNull();
    // AHU-3 has no ahuId → not expandable
    expect(screen.queryByRole('button', { name: 'AHU-3' })).toBeNull();
  });

  it('with the per-role filter feature off, AHU names are plain text and identifiers are not fetched', async () => {
    const api = setup([], {}, SCHEDULES, false);
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/replacement-schedule-filters/current').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'AHU-1' })).toBeNull();
    expect(api.calls('GET', '/api/assets/identifiers')).toHaveLength(0);
  });

  it('paginates the combined entry list', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, ahuName: `AHU-${String(i).padStart(2, '0')}`, filterMicron: '1', filterSize: `S${i}`, qty: 1, scheduleDate: '2026-11-01T00:00:00Z', toleranceDays: 1, approvalStatus: 'APPROVED' }));
    const api = setup([], {}, { data: [{ id: 's', uploadedByName: null, createdAt: '2026-10-01T00:00:00Z', entries: many }] });
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('S0');
    expect(screen.getByText(/last upload by —/)).toBeInTheDocument();
    expect(screen.queryByText('S29')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('S29')).toBeInTheDocument();
    expect(screen.queryByText('S0')).toBeNull();
  });
});

describe('Replacement Schedule page — review / approve / reject', () => {
  it('a reviewer reviews one entry: POST /entries/review approve; server-processed count in the toast', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 1 } }]);
    renderPage(<ReplacementSchedulePage />, { user: MANAGER, api });
    await screen.findByText('610x610');
    // the manager's own upload (e6) offers no checkbox — separation of duties
    expect(within(rowOf('500x500')).queryByRole('checkbox')).toBeNull();
    expect(within(rowOf('610x610')).getByRole('checkbox')).toBeInTheDocument();
    // approval-stage rows are not reviewable by a reviewer
    expect(within(rowOf('305x610')).queryByRole('button', { name: 'Approve' })).toBeNull();
    fireEvent.click(within(rowOf('610x610')).getByRole('button', { name: 'Review ✓' }));
    expect(await screen.findByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('1 entry sent for approval')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json).toEqual({ entryIds: ['e1'], action: 'approve' });
  });

  it('an approver approves one entry; a refusal is shown and the buttons re-enable', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/entries/approve', status: 409, times: 1, body: { error: 'SELF_APPROVAL_FORBIDDEN', message: 'You reviewed this entry' } },
      { method: 'POST', path: '/api/replacement-schedules/entries/approve', body: {} },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    const approveBtn = within(rowOf('305x610')).getByRole('button', { name: 'Approve' });
    fireEvent.click(approveBtn);
    expect(await screen.findByText('You reviewed this entry')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(approveBtn).toBeEnabled());
    fireEvent.click(approveBtn);
    // no `processed` in the response -> falls back to the request size
    expect(await screen.findByText('1 entry approved')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')[1].json).toEqual({ entryIds: ['e2'] });
  });

  it('reject at review needs 3+ characters of remarks and posts action=reject with trimmed remarks', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 1 } }]);
    renderPage(<ReplacementSchedulePage />, { user: MANAGER, api });
    await screen.findByText('610x610');
    fireEvent.click(within(rowOf('610x610')).getByRole('button', { name: 'Reject' }));
    const dlg = screen.getByRole('heading', { name: 'Reject Entry' }).parentElement!;
    const confirm = within(dlg).getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: ' no ' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: '  wrong date  ' } });
    fireEvent.click(confirm);
    expect(await screen.findByText('1 entry rejected')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json).toEqual({ entryIds: ['e1'], action: 'reject', remarks: 'wrong date' });
    expect(screen.queryByRole('heading', { name: 'Reject Entry' })).toBeNull();
  });

  it('reject at approval posts to /entries/reject; Cancel closes the dialog without a request', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/reject', body: { processed: 1 } }]);
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    fireEvent.click(within(rowOf('305x610')).getByRole('button', { name: 'Reject' }));
    fireEvent.click(within(screen.getByRole('heading', { name: 'Reject Entry' }).parentElement!).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Reject Entry' })).toBeNull();
    fireEvent.click(within(rowOf('305x610')).getByRole('button', { name: 'Reject' }));
    const dlg = screen.getByRole('heading', { name: 'Reject Entry' }).parentElement!;
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: 'Qty mismatch' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('1 entry rejected')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/reject')[0].json).toEqual({ entryIds: ['e2'], remarks: 'Qty mismatch' });
  });

  it('bulk: select-all picks only rows waiting on the viewer (never their own); bulk approve + clear', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/approve', body: { processed: 1 } }]);
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    // QA uploaded e5 (PENDING) -> not selectable
    expect(within(rowOf('592x592')).queryByRole('checkbox')).toBeNull();
    const [all] = screen.getAllByRole('checkbox');
    fireEvent.click(all);
    expect(screen.getByText('1 entry selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('1 entry selected')).toBeNull();
    fireEvent.click(within(rowOf('305x610')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' }));
    expect(await screen.findByText('1 entry approved')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')[0].json).toEqual({ entryIds: ['e2'] });
    // selection cleared after success
    expect(within(rowOf('305x610')).getByRole('checkbox')).not.toBeChecked();
  });

  it('bulk as SUPER_ADMIN: review + approve stages side by side; bulk reject at each stage', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 3 } },
      { method: 'POST', path: '/api/replacement-schedules/entries/reject', body: { processed: 2 } },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: { ...SA, username: 'sa' }, api });
    await screen.findByText('610x610');
    const [all] = screen.getAllByRole('checkbox');
    fireEvent.click(all);
    // e1 + e6 at review, e2 + e5 at approval
    expect(screen.getByText('4 entries selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review selected (2)' }));
    expect(await screen.findByText('3 entries sent for approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json.entryIds.sort()).toEqual(['e1', 'e6']);
    // toggling select-all twice: on then off
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject (2)' }));
    expect(screen.getByRole('heading', { name: 'Reject 2 Entries' })).toBeInTheDocument();
    const dlg = screen.getByRole('heading', { name: 'Reject 2 Entries' }).parentElement!;
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: 'Duplicate rows' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('2 entries rejected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/replacement-schedules/entries/reject')[0].json).toEqual({ entryIds: expect.arrayContaining(['e2', 'e5']), remarks: 'Duplicate rows' });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject at review (2)' }));
    expect(screen.getByRole('heading', { name: 'Reject 2 Entries' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));
  });

  it('a gated approval prompts for the password and signs; cancelling re-enables the buttons', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/approve', body: { processed: 1 } }], { reauthActions: ['APPROVE_REPLACEMENT_SCHEDULE'] });
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const approveBtn = within(rowOf('305x610')).getByRole('button', { name: 'Approve' });
    fireEvent.click(approveBtn);
    expect(await screen.findByText(/Performing "Approve Replacement Schedule" requires identity verification/)).toBeInTheDocument();
    expect(approveBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(approveBtn).toBeEnabled());
    // no onCancel on this page: the hook's fallback reports the cancel through onError, with an honest message
    expect(await screen.findByText('Cancelled — password confirmation was not completed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')).toHaveLength(0);
    fireEvent.click(approveBtn);
    await passReauth();
    expect(await screen.findByText('1 entry approved')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/replacement-schedules/entries/approve')[0]);
  });

  it('a stale gate: the server answers REAUTH_REQUIRED, the prompt opens and the retry is signed', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/entries/review', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 1 } },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: MANAGER, api });
    await screen.findByText('610x610');
    fireEvent.click(within(rowOf('610x610')).getByRole('button', { name: 'Review ✓' }));
    await passReauth();
    expect(await screen.findByText('1 entry sent for approval')).toBeInTheDocument();
    const calls = api.calls('POST', '/api/replacement-schedules/entries/review');
    expect(calls).toHaveLength(2);
    expect(calls[0].headers['x-reauth-password']).toBeUndefined();
    expectSigned(calls[1]);
  });
});

describe('Replacement Schedule page — export + template', () => {
  it('Excel: logs the export, then downloads the server workbook with the same signature', async () => {
    const api = setup([{ path: '/api/replacement-schedules/export.xlsx', body: { bytes: 1 } }], { reauthActions: ['EXPORT_REPLACEMENT_SCHEDULE'] });
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await passReauth();
    await waitFor(() => expect(api.calls('GET', '/api/replacement-schedules/export.xlsx')).toHaveLength(1));
    const log = api.calls('POST', '/api/audit/report-export-log')[0];
    expect(log.json).toMatchObject({ reportType: 'Replacement Schedule', format: 'Excel', recordCount: 6 });
    expectSigned(log);
    const idxLog = api.requests.indexOf(log);
    const xlsx = api.calls('GET', '/api/replacement-schedules/export.xlsx')[0];
    expect(api.requests.indexOf(xlsx)).toBeGreaterThan(idxLog);
    expect(xlsx.headers['x-reauth-password']).toBe('Secret@123');
    expect(xlsx.headers.authorization).toBe('Bearer test-token');
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('Excel: a failed workbook download is reported; an oversize export is refused before logging', async () => {
    const api = setup([{ path: '/api/replacement-schedules/export.xlsx', status: 500, body: { error: 'X' } }]);
    const { unmount } = renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
    expect(screen.getByText('Export failed')).toBeInTheDocument();
    unmount();
    const api2 = setup([], { exportLimit: { maxRecords: 5, message: '{count} rows exceed {max}' } });
    renderPage(<ReplacementSchedulePage />, { user: SA, api: api2 });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    expect(await screen.findByText('6 rows exceed 5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('6 rows exceed 5')).toBeInTheDocument();
    expect(api2.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(createReport).not.toHaveBeenCalled();
  });

  it('PDF: builds the table with approval labels and NA cells, logs, then saves', async () => {
    const api = setup();
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({ reportKey: 'replacement-schedule', title: 'Replacement Schedule', subtitle: 'Total: 6 entries' });
    const t = pdf.addTable.mock.calls[0][0];
    expect(t.head).toEqual(['S.No', 'AHU', 'Micron', 'Filter Dimensions', 'Qty', 'Date', 'Status', 'Uploaded By', 'Reviewed By', 'Approved By']);
    expect(t.body[0]).toEqual(['1', 'AHU-1', '10', '610x610', '4', expect.any(String), 'To Review', 'uploader', '-', '-']);
    expect(t.body[3]).toEqual(['4', 'AHU-2', 'NA', 'NA', '3', expect.any(String), 'Rejected', 'uploader', '-', '-']);
    expect(t.body[2].slice(7)).toEqual(['uploader', 'mgr', 'qa1']);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toMatchObject({ reportType: 'Replacement Schedule', format: 'PDF', recordCount: 6 });
  });

  it('PDF with nothing scheduled says so; a cancelled prompt is silent', async () => {
    const api = setup([], { reauthActions: ['EXPORT_REPLACEMENT_SCHEDULE'] }, { data: [] });
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('No replacement schedule yet');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('No replacement entries')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/ }));
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText('Export failed')).toBeNull();
    expect(api.calls('GET', '/api/replacement-schedules/export.xlsx')).toHaveLength(0);
  });

  it('PDF: a build failure is reported as "Export failed"', async () => {
    const api = setup();
    vi.mocked(createReport).mockRejectedValueOnce(new Error('canvas unavailable'));
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    expect(await screen.findByText('canvas unavailable')).toBeInTheDocument();
  });

  it('Download Template: saves the file; 401 reads "Session expired."; other HTTP and network errors are named', async () => {
    const api = setup([
      { path: '/api/replacement-schedules/template.xlsx', times: 1, body: { bytes: 1 } },
      { path: '/api/replacement-schedules/template.xlsx', times: 1, status: 401, body: { error: 'X' } },
      { path: '/api/replacement-schedules/template.xlsx', times: 1, status: 503, body: { error: 'X' } },
      { path: '/api/replacement-schedules/template.xlsx', body: () => { throw new TypeError('Network down'); } },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: VIEWER, api });
    await screen.findByText('610x610');
    const btn = screen.getByRole('button', { name: /Download Template/ });
    fireEvent.click(btn);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));
    expect(api.calls('GET', '/api/replacement-schedules/template.xlsx')[0].headers.authorization).toBe('Bearer test-token');
    fireEvent.click(btn);
    expect(await screen.findByText('Session expired.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(btn);
    expect(await screen.findByText('HTTP 503')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(btn);
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});

describe('Replacement Schedule page — upload', () => {
  const file = () => new File(['x'], 'schedule.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const formBody = (url: string) => {
    const call = vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith(url));
    return call?.[1]?.body as FormData | undefined;
  };
  const PREVIEW = {
    rows: [
      { ahuName: 'AHU-9', filterMicron: '10', filterSize: '610x610', qty: 2, scheduleDate: '2026-12-01', toleranceDays: 5 },
      { ahuName: 'AHU-8', filterMicron: '5', filterSize: '305x305', qty: 1, scheduleDate: 'not-a-date', toleranceDays: 2 },
    ],
    results: [{ row: 2, status: 'ok' }, { row: 3, status: 'ok' }],
  };

  async function openAndPick(api: ReturnType<typeof setup>, user: any = SA) {
    renderPage(<ReplacementSchedulePage />, { user, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /Upload Schedule/ }));
    expect(screen.getByRole('heading', { name: 'Upload Replacement Schedule' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Schedule file (.xlsx)'), { target: { files: [file()] } });
  }

  it('validate → preview (sorted, merged) → upload → results; toast names the created count', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW },
      { method: 'POST', path: '/api/replacement-schedules', status: 201, body: { created: 2, failed: 0, results: [{ row: 2, status: 'ok' }, { row: 3, status: 'ok' }] } },
    ]);
    await openAndPick(api);
    expect(await screen.findByText('2 row(s) ready — no errors.')).toBeInTheDocument();
    expect((formBody('/api/replacement-schedules/validate') as FormData).get('file')).toBeInstanceOf(File);
    // AHU-8 sorts before AHU-9 in the preview
    const previewRows = screen.getAllByRole('row').filter((r) => /AHU-[89]/.test(r.textContent ?? ''));
    expect(previewRows[0]).toHaveTextContent('AHU-8');
    expect(previewRows[0]).toHaveTextContent('not-a-date');
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 row(s)' }));
    expect(await screen.findByText('Schedule uploaded')).toBeInTheDocument();
    expect(screen.getByText('2 entries created')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText(/All rows passed validation/)).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules')[0].headers['x-reauth-password']).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Upload Replacement Schedule' })).toBeNull();
  });

  it('validation errors list each row and keep Upload disabled', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/validate', body: { rows: PREVIEW.rows, results: [
      { row: 2, status: 'ok' }, { row: 3, status: 'error', column: 'Schedule Date', error: 'Invalid date' }, { row: 4, status: 'error', error: 'Unknown AHU' },
    ] } }]);
    await openAndPick(api);
    expect(await screen.findByText(/2 error\(s\) found/)).toBeInTheDocument();
    expect(screen.getByText('Row 3 · Schedule Date: Invalid date')).toBeInTheDocument();
    expect(screen.getByText('Row 4: Unknown AHU')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload 2 row(s)' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Upload Replacement Schedule' })).toBeNull();
  });

  it('an unreadable file shows the server message; a network failure shows its message; no file = nothing sent', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', times: 1, status: 400, body: { error: 'BAD_FILE', message: 'Missing column: Qty' } },
      { method: 'POST', path: '/api/replacement-schedules/validate', times: 1, status: 415, body: {} },
      { method: 'POST', path: '/api/replacement-schedules/validate', body: () => { throw new TypeError('Connection reset'); } },
    ]);
    await openAndPick(api);
    expect(await screen.findByText('Missing column: Qty')).toBeInTheDocument();
    const input = screen.getByLabelText('Schedule file (.xlsx)');
    fireEvent.change(input, { target: { files: [file()] } });
    expect(await screen.findByText('Could not read file (HTTP 415)')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [file()] } });
    expect(await screen.findByText('Connection reset')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [] } });
    expect(api.calls('POST', '/api/replacement-schedules/validate')).toHaveLength(3);
  });

  it('an upload refused without row results returns to the preview with the message', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW },
      { method: 'POST', path: '/api/replacement-schedules', status: 409, times: 1, body: { error: 'PM_VISIT_OVERLAP', message: 'Overlapping dates for AHU-9' } },
      { method: 'POST', path: '/api/replacement-schedules', status: 500, body: {} },
    ]);
    await openAndPick(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 2 row(s)' }));
    expect(await screen.findByText('Overlapping dates for AHU-9')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 row(s)' }));
    expect(await screen.findByText('Upload failed (HTTP 500)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload 2 row(s)' })).toBeInTheDocument();
  });

  it('a partially refused upload (row results returned) shows the results without a success toast', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW },
      { method: 'POST', path: '/api/replacement-schedules', status: 400, body: { created: 0, failed: 1, results: [{ row: 2, status: 'error', column: 'AHU Name', value: 'AHU-9', error: 'AHU not found' }, { row: 3, status: 'error' }] } },
    ]);
    await openAndPick(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 2 row(s)' }));
    expect(await screen.findByText('Rows with errors — fix and re-upload')).toBeInTheDocument();
    expect(screen.getByText(/AHU not found/)).toBeInTheDocument();
    expect(screen.getByText(/Failed/)).toBeInTheDocument();
    expect(screen.queryByText('Schedule uploaded')).toBeNull();
  });

  it('a gated upload sends the password in x-reauth-password; cancelling the prompt returns to the preview', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW },
      { method: 'POST', path: '/api/replacement-schedules', status: 201, body: { created: 1, failed: 0, results: [] } },
    ], { reauthActions: ['UPLOAD_REPLACEMENT_SCHEDULE'] });
    await openAndPick(api);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 2 row(s)' }));
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    const pw = await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Upload 2 row(s)' })).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 row(s)' }));
    await passReauth();
    expect(await screen.findByText('1 entry created')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules')[0].headers['x-reauth-password']).toBe('Secret@123');
  });

  it('closing the dialog with the X keeps nothing; reopening starts at file selection', async () => {

    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW }]);
    await openAndPick(api);
    await screen.findByText('2 row(s) ready — no errors.');
    const header = screen.getByRole('heading', { name: 'Upload Replacement Schedule' }).parentElement!.parentElement!;
    fireEvent.click(within(header).getByRole('button'));
    expect(screen.queryByRole('heading', { name: 'Upload Replacement Schedule' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Upload Schedule/ }));
    expect(screen.getByLabelText('Schedule file (.xlsx)')).toBeInTheDocument();
    expect(screen.queryByText('2 row(s) ready — no errors.')).toBeNull();
  });
});
