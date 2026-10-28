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
  { id: 'e3', slNo: 3, ahuName: 'AHU-1', ahuId: 'a1', filterMicron: '5', filterSize: '', qty: 1, scheduleDate: '2026-11-03T00:00:00Z', toleranceDays: 3, computedStatus: 'COMPLETED', approvalStatus: 'APPROVED', submittedByName: 'uploader', reviewedByName: 'mgr', approvedByName: 'qa1',
    replacements: [{ filterId: 'f1', performedAt: '2026-11-03T06:00:00Z', performedByName: 'opr1' }] },
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
// A review or an approval asks for remarks first (D03-13, 2026-10-22).
const REMARKS = 'checked on site';
const decisionDialog = () => screen.getByRole('dialog', { name: /^(Review|Approve) (Entry|\d+ Entries)$/ });
const decide = (remarks = REMARKS) => {
  const dlg = decisionDialog();
  fireEvent.change(within(dlg).getByLabelText(/Remarks/), { target: { value: remarks } });
  fireEvent.click(within(dlg).getByRole('button', { name: /^(Send for approval|Approve)$/ }));
};

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

  it('expanding an AHU lazy-loads its filters with RFID tags, set, NA attributes and each filter\'s replacement status', async () => {
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
    expect(within(fA).getByText('NA')).toBeInTheDocument();
    // The last column is the REPLACEMENT status for the AHU's approved row (e3),
    // not the cleaning stage (2026-10-24).
    expect(screen.getByRole('columnheader', { name: 'Replacement' })).toBeInTheDocument();
    expect(fA).not.toHaveTextContent('WASH IN');
    const done = within(fA).getByText(/^Completed · /);
    expect(done).toHaveAttribute('title', 'Replaced by opr1');
    expect(fA).not.toHaveTextContent('Micron'); // one approved row: no row label
    const fB = rowOf('FLT-B');
    expect(fB).toHaveTextContent('—');
    expect(within(fB).getByText('Pending')).toBeInTheDocument();
    expect(fB).not.toHaveTextContent('To Be Cleaned');
    fireEvent.click(screen.getByRole('button', { name: 'AHU-2' }));
    expect(await screen.findByText('No filters under this AHU.')).toBeInTheDocument();
    // collapse
    fireEvent.click(screen.getByRole('button', { name: 'AHU-1' }));
    expect(screen.queryByText('FLT-A')).toBeNull();
    // AHU-3 has no ahuId → not expandable
    expect(screen.queryByRole('button', { name: 'AHU-3' })).toBeNull();
  });

  it('an AHU with one schedule row per micron shows a status line per approved row; no approved row says so', async () => {
    const rows = [
      { id: 'r1', ahuName: 'RDU', ahuId: 'rdu', filterMicron: '1', filterSize: '610', qty: 3, scheduleDate: '2026-10-10T00:00:00Z', toleranceDays: 7, computedStatus: 'COMPLETED', approvalStatus: 'APPROVED',
        replacements: [{ filterId: 'g1', performedAt: '2026-10-09T06:00:00Z', performedByName: null }, { filterId: 'g2', performedAt: '2026-10-09T06:00:00Z' }] },
      { id: 'r2', ahuName: 'RDU', ahuId: 'rdu', filterMicron: '15', filterSize: '610', qty: 3, scheduleDate: '2026-10-15T00:00:00Z', toleranceDays: 7, computedStatus: 'IN_PROGRESS', approvalStatus: 'APPROVED',
        replacements: [{ filterId: 'g1', performedAt: '2026-10-14T06:00:00Z', performedByName: 'opr2' }] },
      { id: 'r3', ahuName: 'RDU', ahuId: 'rdu', filterMicron: '30', filterSize: '610', qty: 1, scheduleDate: '2026-12-01T00:00:00Z', toleranceDays: 7, computedStatus: 'PENDING', approvalStatus: 'PENDING_REVIEW' },
      { id: 'r4', ahuName: 'NEW', ahuId: 'new', filterMicron: '1', filterSize: '610', qty: 1, scheduleDate: '2026-12-01T00:00:00Z', toleranceDays: 1, computedStatus: 'PENDING', approvalStatus: 'PENDING_REVIEW' },
    ];
    const api = setup([
      { path: /\/api\/hierarchy\/filters\?ahuId=rdu/, body: { data: [{ id: 'g1', name: 'RDU-1', attributes: {} }, { id: 'g2', name: 'RDU-2', attributes: {} }, { id: 'g3', name: 'RDU-3', attributes: {} }] } },
      { path: /\/api\/hierarchy\/filters\?ahuId=new/, body: { data: [{ id: 'n1', name: 'NEW-1', attributes: {} }] } },
    ], {}, { data: [{ id: 's9', uploadedByName: 'uploader', createdAt: '2026-10-01T10:00:00Z', entries: rows }] });
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    fireEvent.click(await screen.findByRole('button', { name: 'RDU' }));
    expect(await screen.findByText('RDU-1')).toBeInTheDocument();
    const line = (filter: string, micron: string) =>
      within(rowOf(filter)).getByText(new RegExp(`^Micron ${micron} · `)).parentElement as HTMLElement;
    expect(within(line('RDU-1', '1')).getByText(/^Completed · /)).not.toHaveAttribute('title');
    expect(within(line('RDU-1', '15')).getByText(/^Completed · /)).toHaveAttribute('title', 'Replaced by opr2');
    expect(within(line('RDU-2', '1')).getByText(/^Completed · /)).toBeInTheDocument();
    expect(within(line('RDU-2', '15')).getByText('Pending')).toBeInTheDocument();
    expect(within(line('RDU-3', '1')).getByText('Pending')).toBeInTheDocument();
    expect(rowOf('RDU-3')).not.toHaveTextContent('Micron 30'); // a row not yet approved is not a task
    fireEvent.click(screen.getByRole('button', { name: 'NEW' }));
    expect(within(await screen.findByText('NEW-1').then((el) => el.closest('tr')!)).getByText('No approved replacement')).toBeInTheDocument();
  });

  // 2026-10-26: a row covers its micron's filters, kept in step with the AHU.
  // The table shows today's Qty (the uploaded one under it when they differ),
  // the PDF prints today's, and a filter gets a line only for its own rows.
  it('Qty is today\'s (uploaded shown beside it when different); each filter is listed only on the rows it belongs to', async () => {
    const rows = [
      { id: 'q1', ahuName: 'CWH', ahuId: 'cwh', filterMicron: '1', filterSize: '610', qty: 3, currentQty: 4, scheduleDate: '2026-12-01T00:00:00Z', toleranceDays: 7, computedStatus: 'PENDING', approvalStatus: 'APPROVED',
        memberFilterIds: ['m1', 'm2', 'm3', 'm4'], replacements: [] },
      { id: 'q2', ahuName: 'CWH', ahuId: 'cwh', filterMicron: '15', filterSize: '610', qty: 2, currentQty: 2, scheduleDate: '2026-12-02T00:00:00Z', toleranceDays: 7, computedStatus: 'PENDING', approvalStatus: 'APPROVED',
        memberFilterIds: ['x1', 'x2'], replacements: [{ filterId: 'x1', performedAt: '2026-11-20T06:00:00Z' }] },
    ];
    const api = setup([
      { path: /\/api\/hierarchy\/filters\?ahuId=cwh/, body: { data: [
        { id: 'm1', name: 'CWH-M1', attributes: { micronSize: '1' } },
        { id: 'x1', name: 'CWH-X1', attributes: { micronSize: '15' } },
        { id: 'late', name: 'CWH-LATE', attributes: { micronSize: '1' } },
      ] } },
    ], {}, { data: [{ id: 's8', uploadedByName: 'uploader', createdAt: '2026-10-01T10:00:00Z', entries: rows }] });
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    const oneMicron = (await screen.findAllByText('PENDING')).map((el) => el.closest('tr')!)[0] as HTMLElement;
    expect(oneMicron).toHaveTextContent('4');
    expect(within(oneMicron).getByText('(uploaded 3)')).toBeInTheDocument();
    expect(screen.getAllByText(/^\(uploaded /)).toHaveLength(1); // the 15 µm row's Qty did not change

    fireEvent.click(screen.getByRole('button', { name: 'CWH' }));
    expect(await screen.findByText('CWH-M1')).toBeInTheDocument();
    // One row each: no "Micron … ·" prefix, and the other micron's row is not listed.
    expect(within(rowOf('CWH-M1')).getByText('Pending')).toBeInTheDocument();
    expect(within(rowOf('CWH-M1')).queryByText(/^Micron /)).toBeNull();
    expect(within(rowOf('CWH-X1')).getByText(/^Completed · /)).toBeInTheDocument();
    expect(within(rowOf('CWH-X1')).queryByText('Pending')).toBeNull();
    // A filter none of the rows covers (added after its row closed, or another micron).
    expect(within(rowOf('CWH-LATE')).getByText('No approved replacement')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
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
    // 25 per page = the first configured option (2026-10-22: usePageSize; it used a fixed 25).
    const api = setup([], { pagination: { limit: 100, options: [25, 50, 100] } }, { data: [{ id: 's', uploadedByName: null, createdAt: '2026-10-01T00:00:00Z', entries: many }] });
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('S0');
    expect(screen.getByText(/last upload by —/)).toBeInTheDocument();
    // Ready state before acting: page 1 holds exactly the configured 25 (S0-S24).
    // Until the config is read the hook's fallback is 10 per page, and a Next
    // clicked then lands on S10-S19 (2026-10-22, the fallback-10 rule of 9f47353).
    await screen.findByText('S24');
    expect(screen.queryByText('S25')).toBeNull();
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
    // remarks are required: the confirm stays disabled under 3 characters, Cancel sends nothing
    const dlg = decisionDialog();
    const confirm = within(dlg).getByRole('button', { name: 'Send for approval' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText(/Remarks/), { target: { value: ' ok ' } });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Review Entry' })).toBeNull();
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')).toHaveLength(0);
    fireEvent.click(within(rowOf('610x610')).getByRole('button', { name: 'Review ✓' }));
    decide('  sizes match the drawing  ');
    expect(await screen.findByText('Reviewed')).toBeInTheDocument();
    expect(screen.getByText('1 entry sent for approval')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json).toEqual({ entryIds: ['e1'], action: 'approve', remarks: 'sizes match the drawing' });
    expect(screen.queryByRole('dialog', { name: 'Review Entry' })).toBeNull();
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
    decide();
    expect(await screen.findByText('You reviewed this entry')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(approveBtn).toBeEnabled());
    // the refusal leaves the remarks dialog open with what was typed, for the retry
    expect(within(decisionDialog()).getByLabelText(/Remarks/)).toHaveValue(REMARKS);
    fireEvent.click(within(decisionDialog()).getByRole('button', { name: 'Approve' }));
    // no `processed` in the response -> falls back to the request size
    expect(await screen.findByText('1 entry approved')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')[1].json).toEqual({ entryIds: ['e2'], comment: REMARKS });
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
    decide();
    expect(await screen.findByText('1 entry approved')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')[0].json).toEqual({ entryIds: ['e2'], comment: REMARKS });
    // selection cleared after success
    expect(within(rowOf('305x610')).getByRole('checkbox')).not.toBeChecked();
  });

  // The SUPER_ADMIN bulk flow was ONE test of three server round trips plus a
  // fourth click left in flight at its end: 1.5-3.1 s in loaded runs, 5.15 s in
  // one (2026-10-22), past the 5 s default. One bulk action per test; every
  // assertion of the original is kept, and the trailing Approve click (which had
  // no route and nothing asserted on it) is now a test of its own.
  const renderBulkSa = async (routes: MockRoute[]) => {
    const api = setup(routes);
    renderPage(<ReplacementSchedulePage />, { user: { ...SA, username: 'sa' }, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    // e1 + e6 at review, e2 + e5 at approval
    expect(screen.getByText('4 entries selected')).toBeInTheDocument();
    return api;
  };

  it('bulk as SUPER_ADMIN: select-all takes both stages side by side and toggles off again', async () => {
    await renderBulkSa([]);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.queryByText('4 entries selected')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Review selected/ })).toBeNull();
  });

  it('bulk as SUPER_ADMIN: Review selected sends only the review-stage rows', async () => {
    const api = await renderBulkSa([{ method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 3 } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Review selected (2)' }));
    expect(screen.getByRole('dialog', { name: 'Review 2 Entries' })).toBeInTheDocument();
    decide();
    expect(await screen.findByText('3 entries sent for approval')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json.entryIds.sort()).toEqual(['e1', 'e6']);
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json.remarks).toBe(REMARKS);
    expect(screen.queryByText('4 entries selected')).toBeNull();
    // a finished action re-enables the bulk bar: the next selection can act again
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText('4 entries selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject (2)' }));
    expect(screen.getByRole('heading', { name: 'Reject 2 Entries' })).toBeInTheDocument();
  });

  it('bulk as SUPER_ADMIN: Reject (n) rejects the approval-stage rows with the remarks', async () => {
    const api = await renderBulkSa([{ method: 'POST', path: '/api/replacement-schedules/entries/reject', body: { processed: 2 } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject (2)' }));
    expect(screen.getByRole('heading', { name: 'Reject 2 Entries' })).toBeInTheDocument();
    const dlg = screen.getByRole('heading', { name: 'Reject 2 Entries' }).parentElement!;
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: 'Duplicate rows' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('2 entries rejected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/replacement-schedules/entries/reject')[0].json).toEqual({ entryIds: expect.arrayContaining(['e2', 'e5']), remarks: 'Duplicate rows' });
  });

  it('bulk as SUPER_ADMIN: Reject at review (n) rejects the review-stage rows through /entries/review', async () => {
    const api = await renderBulkSa([{ method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 2 } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject at review (2)' }));
    expect(screen.getByRole('heading', { name: 'Reject 2 Entries' })).toBeInTheDocument();
    const dlg = screen.getByRole('heading', { name: 'Reject 2 Entries' }).parentElement!;
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: 'Duplicate rows' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('2 entries rejected')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')[0].json).toEqual({ entryIds: expect.arrayContaining(['e1', 'e6']), action: 'reject', remarks: 'Duplicate rows' });
  });

  it('bulk as SUPER_ADMIN: Approve selected (n) approves the approval-stage rows', async () => {
    const api = await renderBulkSa([{ method: 'POST', path: '/api/replacement-schedules/entries/approve', body: { processed: 2 } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));
    expect(screen.getByRole('dialog', { name: 'Approve 2 Entries' })).toBeInTheDocument();
    decide();
    expect(await screen.findByText('2 entries approved')).toBeInTheDocument();
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')[0].json.entryIds.sort()).toEqual(['e2', 'e5']);
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')[0].json.comment).toBe(REMARKS);
  });

  it('a gated approval prompts for the password and signs; cancelling silently re-enables the buttons', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/approve', body: { processed: 1 } }], { reauthActions: ['APPROVE_REPLACEMENT_SCHEDULE'] });
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const approveBtn = within(rowOf('305x610')).getByRole('button', { name: 'Approve' });
    fireEvent.click(approveBtn);
    decide();
    expect(await screen.findByText(/Performing "Approve Replacement Schedule" requires identity verification/)).toBeInTheDocument();
    expect(approveBtn).toBeDisabled();
    const pw = screen.getByPlaceholderText('Enter your password');
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(approveBtn).toBeEnabled());
    // a dismissed prompt is a choice, not a failure: no error dialog
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(api.calls('POST', '/api/replacement-schedules/entries/approve')).toHaveLength(0);
    // the remarks dialog is still open with the remarks kept; confirming again asks for the password
    fireEvent.click(within(decisionDialog()).getByRole('button', { name: 'Approve' }));
    await passReauth();
    expect(await screen.findByText('1 entry approved')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/replacement-schedules/entries/approve')[0]);
  });

  it('a cancelled review prompt is silent and re-enables the buttons', async () => {
    const api = setup([], { reauthActions: ['REVIEW_REPLACEMENT_SCHEDULE'] });
    renderPage(<ReplacementSchedulePage />, { user: MANAGER, api });
    await screen.findByText('610x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const reviewBtn = within(rowOf('610x610')).getByRole('button', { name: 'Review ✓' });
    fireEvent.click(reviewBtn);
    decide();
    const pw = await screen.findByPlaceholderText('Enter your password');
    expect(reviewBtn).toBeDisabled();
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(reviewBtn).toBeEnabled());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(api.calls('POST', '/api/replacement-schedules/entries/review')).toHaveLength(0);
  });

  it('a cancelled reject prompt is silent; the reject dialog stays open with the remarks kept', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/reject', body: { processed: 1 } }], { reauthActions: ['REJECT_REPLACEMENT_SCHEDULE'] });
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(rowOf('305x610')).getByRole('button', { name: 'Reject' }));
    const dlg = screen.getByRole('heading', { name: 'Reject Entry' }).parentElement!;
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: 'Qty mismatch' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    const pw = await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Reject Entry' })).toBeInTheDocument();
    expect(within(dlg).getByPlaceholderText('Reason for rejection…')).toHaveValue('Qty mismatch');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Reject' })).toBeEnabled());
    expect(api.calls('POST', '/api/replacement-schedules/entries/reject')).toHaveLength(0);
    // and the retry goes through, signed
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    await passReauth();
    expect(await screen.findByText('1 entry rejected')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/replacement-schedules/entries/reject')[0]);
  });

  it('a stale gate: the server answers REAUTH_REQUIRED, the prompt opens and the retry is signed', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/entries/review', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'POST', path: '/api/replacement-schedules/entries/review', body: { processed: 1 } },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: MANAGER, api });
    await screen.findByText('610x610');
    fireEvent.click(within(rowOf('610x610')).getByRole('button', { name: 'Review ✓' }));
    decide();
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
    expect(log.json.filters).toEqual({}); // the whole schedule: the page has no filters
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

  // 2026-10-21 (web coverage F3): the page built its upload error with the code
  // on `.code` only, while the re-auth hook reads `.error`, so neither refusal
  // below reached the prompt. Errors now come from apiErrorFromResponse.
  it('a wrong password on the gated upload keeps the prompt open with "Incorrect password"', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW },
      { method: 'POST', path: '/api/replacement-schedules', status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } },
      { method: 'POST', path: '/api/replacement-schedules', status: 201, body: { created: 2, failed: 0, results: [] } },
    ], { reauthActions: ['UPLOAD_REPLACEMENT_SCHEDULE'] });
    await openAndPick(api);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 2 row(s)' }));
    await passReauth('wrong');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
  });

  it('a stale gate (server says REAUTH_REQUIRED) opens the prompt for the upload', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: PREVIEW },
      { method: 'POST', path: '/api/replacement-schedules', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'POST', path: '/api/replacement-schedules', status: 201, body: { created: 2, failed: 0, results: [] } },
    ]);
    await openAndPick(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload 2 row(s)' }));
    expect(await screen.findByPlaceholderText('Enter your password')).toBeInTheDocument();
  });
});
