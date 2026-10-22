import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';

// The PDF renderer draws to a canvas/jsPDF and triggers a browser download —
// neither exists in jsdom. Stub it at that edge and assert what it was asked
// to render (snapshot, signature lines, file name).
const renderSnapshotToPdf = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/pdf-report', () => ({ renderSnapshotToPdf: (...a: unknown[]) => renderSnapshotToPdf(...a) }));

import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { ReportReviewsPage } from '../index';

/**
 * Report Reviews: the queue of reports sent for review/approval. Real SWR ->
 * apiClient -> fetch, real useAuth/useCan/useReauth; only fetch is stubbed.
 */

const ROW = (over: Record<string, unknown> = {}) => ({
  id: 'rr-1', reportType: 'CLEANING_RECORD', title: 'Cleaning Record Oct', subtitle: 'Block A',
  status: 'PENDING_REVIEW', stage: 'REVIEW', generatedByName: 'asha', generatedAt: '2026-10-15T10:00:00.000Z',
  createdAt: '2026-10-15T10:00:00.000Z',
  ...over,
});
const APPROVE_ROW = ROW({ id: 'rr-2', title: 'Lifecycle Report', subtitle: undefined, status: 'PENDING_APPROVAL', stage: 'APPROVE', reviewedByName: 'ravi' });

const ROLES = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin' },
  { name: 'QA', displayName: 'Quality Assurance' },
  { name: 'MANAGER', displayName: '' },
];

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); renderSnapshotToPdf.mockClear(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

function routes(queue: unknown[], all: unknown[], reauth: string[] = []) {
  return [
    ...commonConfigRoutes(),
    reauthActions(reauth),
    { path: '/api/report-reviews/queue', body: { data: queue } },
    { path: '/api/report-reviews', body: { data: all } },
    { path: '/api/roles/active', body: ROLES },
  ];
}

const REVIEWER = { username: 'ravi', role: 'MANAGER', permissions: ['REPORT_REVIEW'] };
const APPROVER = { username: 'qa1', role: 'QA', permissions: ['REPORT_APPROVE'] };

describe('Report Reviews — queue', () => {
  it('shows the queue count and only offers actions the user\'s permission allows (REPORT_REVIEW reviews, cannot approve)', async () => {
    const api = mockApi(routes([ROW(), APPROVE_ROW], []));
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });

    expect(await screen.findByText('Cleaning Record Oct')).toBeInTheDocument();
    expect(screen.getByText('CLEANING_RECORD · Block A')).toBeInTheDocument();
    expect(screen.getByText('Lifecycle Report')).toBeInTheDocument();
    // queue tab badge
    expect(screen.getByRole('button', { name: /To Action\s*2/ })).toBeInTheDocument();
    // stage chips in the queue
    expect(screen.getByText('Review now')).toBeInTheDocument();
    expect(screen.getByText('Approve now')).toBeInTheDocument();
    expect(screen.getByText('ravi', { selector: 'span' })).toBeInTheDocument();

    // REVIEW-stage row: Review + Reject; APPROVE-stage row: nothing (no REPORT_APPROVE)
    expect(screen.getAllByRole('button', { name: 'Review' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('an approver gets Approve/Reject on the approval-stage row only', async () => {
    const api = mockApi(routes([ROW(), APPROVE_ROW], []));
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
  });

  it('empty queue and empty "All Reports" each say so', async () => {
    const api = mockApi(routes([], []));
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });
    expect(await screen.findByText('Nothing awaiting your action.')).toBeInTheDocument();
    // no count badge when the queue is empty
    expect(screen.getByRole('button', { name: 'To Action' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All Reports' }));
    expect(await screen.findByText('No reports yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'To Action' }));
    expect(screen.getByText('Nothing awaiting your action.')).toBeInTheDocument();
  });

  it('review -> approve requires an approver role (SUPER_ADMIN not offered), then POSTs /review with assigneeRole', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/report-reviews/rr-1/review', body: { ok: true } },
      ...routes([ROW()], []),
    ]);
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

    const dialog = screen.getByText('Review report').closest('.bg-white') as HTMLElement;
    expect(within(dialog).getByText('Cleaning Record Oct')).toBeInTheDocument();
    const select = within(dialog).getByRole('combobox');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    // SUPER_ADMIN filtered out; an empty displayName falls back to the role name
    expect(options).toEqual(['Select a role…', 'Quality Assurance', 'MANAGER']);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Approver required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/report-reviews/rr-1/review')).toHaveLength(0);

    fireEvent.change(select, { target: { value: 'QA' } });
    // an approval says why, like a rejection (2026-10-22): no remarks, no request
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Remarks required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/report-reviews/rr-1/review')).toHaveLength(0);
    fireEvent.change(within(dialog).getByPlaceholderText('Reason for approval (required)'), { target: { value: '  looks complete  ' } });
    const before = api.calls('GET', '/api/report-reviews/queue').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(api.calls('POST', '/api/report-reviews/rr-1/review')).toHaveLength(1));
    expect(api.calls('POST', '/api/report-reviews/rr-1/review')[0].json).toEqual({ action: 'approve', remarks: 'looks complete', assigneeRole: 'QA' });
    expect(await screen.findByText('Sent for approval')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Review report')).toBeNull());
    // the queue and the full list are both re-read after a decision
    await waitFor(() => expect(api.calls('GET', '/api/report-reviews/queue').length).toBeGreaterThan(before));
  });

  it('reject needs at least 3 characters of remarks, then POSTs the rejection', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/report-reviews/rr-1/review', body: { ok: true } },
      ...routes([ROW()], []),
    ]);
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    expect(screen.getByText('Reject report')).toBeInTheDocument();
    // no approver picker on a rejection
    expect(screen.queryByRole('combobox')).toBeNull();
    const remarks = screen.getByPlaceholderText('Reason for rejection (required)');
    fireEvent.change(remarks, { target: { value: 'no' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    expect(await screen.findByText('Remarks required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(api.calls('POST', '/api/report-reviews/rr-1/review')).toHaveLength(0);

    fireEvent.change(remarks, { target: { value: 'Wrong block' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    await waitFor(() => expect(api.calls('POST', '/api/report-reviews/rr-1/review')).toHaveLength(1));
    expect(api.calls('POST', '/api/report-reviews/rr-1/review')[0].json).toEqual({ action: 'reject', remarks: 'Wrong block' });
    expect(await screen.findByText('Report rejected')).toBeInTheDocument();
  });

  it('approval-stage approve needs 3+ characters of remarks, then POSTs /approve with them and no assignee', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/report-reviews/rr-2/approve', body: { ok: true } },
      ...routes([APPROVE_ROW], []),
    ]);
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(screen.getByText('Approve report')).toBeInTheDocument();
    const remarks = screen.getByLabelText(/^Remarks/);
    expect(remarks).toHaveAttribute('placeholder', 'Reason for approval (required)');
    for (const value of ['', ' ok ']) {
      fireEvent.change(remarks, { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
      expect(await screen.findByText('Remarks required')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    }
    expect(api.calls('POST', '/api/report-reviews/rr-2/approve')).toHaveLength(0);
    fireEvent.change(remarks, { target: { value: '  Readings verified  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.calls('POST', '/api/report-reviews/rr-2/approve')).toHaveLength(1));
    expect(api.calls('POST', '/api/report-reviews/rr-2/approve')[0].json).toEqual({ action: 'approve', remarks: 'Readings verified' });
    expect(await screen.findByText('Report approved')).toBeInTheDocument();
  });

  it('a server refusal shows its message and re-enables the dialog', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/report-reviews/rr-2/approve', status: 409, body: { error: 'NOT_YOUR_TURN', message: 'This report is assigned to another role' } },
      ...routes([APPROVE_ROW], []),
    ]);
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText(/^Remarks/), { target: { value: 'Checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('This report is assigned to another role')).toBeInTheDocument();
    // dialog stays open, button is back to "Confirm" (not stuck on "Working…")
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('APPROVE_REPORT with re-auth on: prompts, then sends the password in header and body', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/report-reviews/rr-2/approve', body: (req: MockRequest) => ({ ok: !!req.json._currentPassword }) },
      ...routes([APPROVE_ROW], [], ['APPROVE_REPORT']),
    ]);
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for approval (required)'), { target: { value: 'all good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    expect(api.calls('POST', '/api/report-reviews/rr-2/approve')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Secret@1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));

    await waitFor(() => expect(api.calls('POST', '/api/report-reviews/rr-2/approve')).toHaveLength(1));
    const sent = api.calls('POST', '/api/report-reviews/rr-2/approve')[0];
    expect(sent.headers['x-reauth-password']).toBe('Secret@1');
    expect(sent.json).toEqual({ action: 'approve', remarks: 'all good', _currentPassword: 'Secret@1' });
    expect(await screen.findByText('Report approved')).toBeInTheDocument();
  });

  it('cancelling the password prompt sends nothing and un-busies the dialog', async () => {
    const api = mockApi(routes([ROW()], [], ['REVIEW_REPORT']));
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for rejection (required)'), { target: { value: 'Missing data' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' }).at(-1)!);
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    // the shared Dialog has no role="dialog"; its content box carries max-w-lg
    const reauthBox = screen.getByText('Confirm Your Identity').closest('.max-w-lg') as HTMLElement;
    fireEvent.click(within(reauthBox).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('POST', '/api/report-reviews/rr-1/review')).toHaveLength(0);
    // the decision dialog is still open and usable again
    expect(screen.getByText('Reject report')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Reject' }).at(-1)).toBeEnabled();
    // RR-1: a dismissed prompt is not a failure (D-OPS-8 pattern)
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('REAUTH_REQUIRED from the server opens the prompt even when my-actions said no', async () => {
    let n = 0;
    const api = mockApi([
      { method: 'POST', path: '/api/report-reviews/rr-2/approve',
        status: 200, body: (req: MockRequest) => ({ ok: true, pw: req.json._currentPassword }) },
      ...routes([APPROVE_ROW], []),
    ]);
    api.add({ method: 'POST', path: '/api/report-reviews/rr-2/approve', status: 401, times: 1,
      body: () => { n += 1; return { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' }; } });
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    fireEvent.change(screen.getByLabelText(/^Remarks/), { target: { value: 'Checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(n).toBe(1);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(api.calls('POST', '/api/report-reviews/rr-2/approve')).toHaveLength(2));
    expect(api.calls('POST', '/api/report-reviews/rr-2/approve')[1].headers['x-reauth-password']).toBe('pw');
    expect(await screen.findByText('Report approved')).toBeInTheDocument();
  });

  it('the backdrop and Cancel close the dialog; a click inside it does not', async () => {
    const api = mockApi(routes([ROW()], []));
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'Review' }));
    const title = screen.getByText('Review report');
    fireEvent.click(title); // inside: stopPropagation keeps it open
    expect(screen.getByText('Review report')).toBeInTheDocument();
    fireEvent.click(title.closest('.fixed') as HTMLElement); // backdrop
    expect(screen.queryByText('Review report')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Review report')).toBeNull();
  });
});

describe('Report Reviews — All Reports', () => {
  const ALL = [
    ROW({ id: 'a1', title: 'Mine approved', status: 'APPROVED', stage: undefined, generatedByName: 'qa1', reviewedByName: 'ravi', approvedByName: 'boss' }),
    ROW({ id: 'a2', title: 'Rejected at approval', status: 'REJECTED', stage: undefined, generatedByName: 'other', reviewRemarks: 'ok at review', approvalRemarks: 'bad numbers', assigneeRole: 'QA' }),
    ROW({ id: 'a3', title: 'Rejected at review', status: 'REJECTED', stage: undefined, generatedByName: 'other', reviewRemarks: 'missing sign' }),
    ROW({ id: 'a4', title: 'Not a party', status: 'ARCHIVED', stage: undefined, generatedByName: 'stranger' }),
  ];

  it('labels each status, shows the rejection remark, and offers Download only to parties of the report', async () => {
    const api = mockApi(routes([], ALL));
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'All Reports' }));
    expect(await screen.findByText('Mine approved')).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getAllByText('Rejected')).toHaveLength(2);
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument(); // unknown status shown raw
    // approval remark wins over the review remark; review remark when that is all there is
    expect(screen.getByText('bad numbers')).toBeInTheDocument();
    expect(screen.queryByText('ok at review')).toBeNull();
    expect(screen.getByText('missing sign')).toBeInTheDocument();
    expect(screen.getByText('boss')).toBeInTheDocument();

    // a1: generated by me; a2: assigned to my role; a3/a4: not a party
    expect(screen.getAllByRole('button', { name: 'Download PDF' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
  });

  it('SUPER_ADMIN can download every report', async () => {
    const api = mockApi(routes([], ALL));
    renderPage(<ReportReviewsPage />, { user: { role: 'SUPER_ADMIN', permissions: [] }, api });
    fireEvent.click(await screen.findByRole('button', { name: 'All Reports' }));
    await screen.findByText('Not a party');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Download PDF' })).toHaveLength(4));
  });

  it('Download PDF fetches the full review and renders its snapshot with the signature lines', async () => {
    const snapshot = { reportType: 'CLEANING_RECORD', title: 'Mine approved', rows: [] };
    const api = mockApi([
      { path: '/api/report-reviews/a1', body: { ...ALL[0], title: 'Mine approved / Oct', dataSnapshot: snapshot } },
      ...routes([], ALL),
    ]);
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'All Reports' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Download PDF' }))[0]);
    await waitFor(() => expect(renderSnapshotToPdf).toHaveBeenCalledTimes(1));
    const [snap, sigs, fmt, fname] = renderSnapshotToPdf.mock.calls[0] as [unknown, unknown, (d: string) => string, string];
    expect(snap).toEqual(snapshot);
    expect(sigs).toEqual([
      { label: 'Printed By', value: 'qa1' },
      { label: 'Reviewed By', value: 'ravi' },
      { label: 'Approved By', value: 'boss' },
    ]);
    expect(fname).toBe('Mine_approved_Oct.pdf');
    // the date formatter handed to the renderer is the page's configured one (DD/MM/YYYY)
    expect(fmt('2026-10-15T10:00:00.000Z')).toBe('15/10/2026');
  });

  it('a failed download shows "Download failed" with the server message', async () => {
    const api = mockApi([
      { path: '/api/report-reviews/a1', status: 403, body: { error: 'FORBIDDEN', message: 'Not a party to this report' } },
      ...routes([], ALL),
    ]);
    renderPage(<ReportReviewsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: 'All Reports' }));
    fireEvent.click((await screen.findAllByRole('button', { name: 'Download PDF' }))[0]);
    expect(await screen.findByText('Download failed')).toBeInTheDocument();
    expect(screen.getByText('Not a party to this report')).toBeInTheDocument();
    expect(renderSnapshotToPdf).not.toHaveBeenCalled();
  });
});

describe('Report Reviews — accessibility + console', () => {
  it('every control is named — the queue and the decision dialog, itself a named modal dialog — and the page logs nothing', async () => {
    const api = mockApi(routes([ROW()], []));
    renderPage(<ReportReviewsPage />, { user: REVIEWER, api });
    await screen.findByRole('button', { name: 'Review' });
    expectAllControlsNamed();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    const dlg = await screen.findByRole('dialog', { name: 'Review report' });
    expect(dlg).toHaveAttribute('aria-modal', 'true');
    expect(within(dlg).getByLabelText('Send to (approver role)')).toHaveDisplayValue('Select a role…');
    expect(within(dlg).getByLabelText(/^Remarks/)).toHaveAttribute('placeholder', 'Reason for approval (required)');
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
