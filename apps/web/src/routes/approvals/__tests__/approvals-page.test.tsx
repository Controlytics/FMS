import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { ApprovalsPage } from '../index';

/**
 * Approvals (block change requests). Runs the real SWR -> apiClient -> fetch
 * path, the real useAuth/useCan and the real useReauth; only fetch is stubbed.
 */

const REQ = (over: Record<string, unknown> = {}) => ({
  id: 'bcr-1', status: 'PENDING', filterName: 'FLT-0001',
  fromBlockName: 'Block A', toBlockName: 'Block B', reason: 'Moved for rebalancing',
  requestedByName: 'Asha Rao', createdAt: '2026-10-15T10:00:00.000Z',
  ...over,
});

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

function baseRoutes(list: unknown, pending = 0, reauth: string[] = []) {
  return [
    ...commonConfigRoutes(),
    reauthActions(reauth),
    { path: '/api/block-change-requests/pending-count', body: { count: pending } },
    { path: '/api/block-change-requests', body: list },
  ];
}

const APPROVER = { role: 'MANAGER', permissions: ['BLOCK_CHANGE_APPROVE'] };

describe('Approvals page — approver', () => {
  it('lists pending requests with the pending count and asks for PENDING approver-wide (no mine=true)', async () => {
    const api = mockApi(baseRoutes({ data: [REQ(), REQ({ id: 'bcr-2', filterName: 'FLT-0002', reason: null })], total: 2 }, 2));
    renderPage(<ApprovalsPage />, { user: APPROVER, api });

    expect(await screen.findByText('FLT-0001')).toBeInTheDocument();
    expect(screen.getByText('FLT-0002')).toBeInTheDocument();
    expect(await screen.findByText('2 pending requests')).toBeInTheDocument();
    expect(screen.getByText('Review and process block change requests')).toBeInTheDocument();
    expect(screen.getByText('Reason: Moved for rebalancing')).toBeInTheDocument();
    expect(screen.getAllByText('By: Asha Rao')).toHaveLength(2);

    const list = api.calls('GET', '/api/block-change-requests');
    expect(list.length).toBeGreaterThan(0);
    const last = list[list.length - 1];
    expect(last.query.get('status')).toBe('PENDING');
    expect(last.query.get('mine')).toBeNull();
    expect(api.calls('GET', '/api/block-change-requests/pending-count').length).toBeGreaterThan(0);
  });

  it('Approve / Reject stay disabled until a comment is typed, then approve POSTs the comment', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/block-change-requests/bcr-1/approve', body: { ok: true } },
      ...baseRoutes({ data: [REQ()], total: 1 }, 1),
    ]);
    renderPage(<ApprovalsPage />, { user: APPROVER, api });

    const approve = await screen.findByRole('button', { name: 'Approve' });
    const reject = screen.getByRole('button', { name: 'Reject' });
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();

    // focus paints the theme border, blur clears it
    const box = screen.getByPlaceholderText('Comment (required) *');
    fireEvent.focus(box);
    expect(box.style.borderColor).toBe('var(--theme-primary-light)');
    fireEvent.blur(box);
    expect(box.style.borderColor).toBe('');

    fireEvent.change(screen.getByPlaceholderText('Comment (required) *'), { target: { value: '   ' } });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Comment (required) *'), { target: { value: 'Looks right' } });
    expect(approve).toBeEnabled();

    fireEvent.click(approve);
    await waitFor(() => expect(api.calls('POST', '/api/block-change-requests/bcr-1/approve')).toHaveLength(1));
    expect(api.calls('POST', '/api/block-change-requests/bcr-1/approve')[0].json).toEqual({ comment: 'Looks right' });
    expect(await screen.findByText('Request approved')).toBeInTheDocument();
    // comment box cleared on success
    await waitFor(() => expect(screen.getByPlaceholderText('Comment (required) *')).toHaveValue(''));
    expect(api.unmatched).toEqual([]);
  });

  it('a server refusal on reject shows its message as an error toast', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/block-change-requests/bcr-1/reject', status: 409, body: { error: 'ALREADY_PROCESSED', message: 'Request was already processed' } },
      ...baseRoutes({ data: [REQ()], total: 1 }, 1),
    ]);
    renderPage(<ApprovalsPage />, { user: APPROVER, api });
    fireEvent.change(await screen.findByPlaceholderText('Comment (required) *'), { target: { value: 'No' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Request was already processed')).toBeInTheDocument();
    expect(api.calls('POST', '/api/block-change-requests/bcr-1/reject')[0].json).toEqual({ comment: 'No' });
  });

  it('when APPROVE_BLOCK_CHANGE needs a password: prompt, then retry with the password', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/block-change-requests/bcr-1/approve', body: { ok: true } },
      ...baseRoutes({ data: [REQ()], total: 1 }, 1, ['APPROVE_BLOCK_CHANGE']),
    ]);
    renderPage(<ApprovalsPage />, { user: APPROVER, api });
    // wait for the my-actions feed so the gate is known before clicking
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(await screen.findByPlaceholderText('Comment (required) *'), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(api.calls('POST', '/api/block-change-requests/bcr-1/approve')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Secret@1' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));

    await waitFor(() => expect(api.calls('POST', '/api/block-change-requests/bcr-1/approve')).toHaveLength(1));
    const sent = api.calls('POST', '/api/block-change-requests/bcr-1/approve')[0];
    expect(sent.headers['x-reauth-password']).toBe('Secret@1');
    expect(sent.json).toEqual({ comment: 'ok', _currentPassword: 'Secret@1' });
    expect(await screen.findByText('Request approved')).toBeInTheDocument();
  });

  it('cancelling the password prompt sends nothing and unlocks the row', async () => {
    const api = mockApi(baseRoutes({ data: [REQ()], total: 1 }, 1, ['REJECT_BLOCK_CHANGE']));
    renderPage(<ApprovalsPage />, { user: APPROVER, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(await screen.findByPlaceholderText('Comment (required) *'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dlg = await screen.findByText('Confirm Your Identity');
    fireEvent.click(within(dlg.closest('[role="dialog"]') as HTMLElement ?? document.body).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('POST', '/api/block-change-requests/bcr-1/reject')).toHaveLength(0);
    // processingId reset -> the comment box no longer shows the typed text
    expect(screen.getByPlaceholderText('Comment (required) *')).toHaveValue('');
  });

  it('switching tabs re-queries by status and resets to page 1; empty tab names the status', async () => {
    const api = mockApi(baseRoutes({ data: [], total: 0 }, 0));
    renderPage(<ApprovalsPage />, { user: APPROVER, api });
    expect(await screen.findByText('No pending requests')).toBeInTheDocument();
    // pending count 0 -> no badge
    expect(screen.queryByText(/\d+ pending request/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rejected' }));
    expect(await screen.findByText('No rejected requests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('No requests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(await screen.findByText('No approved requests')).toBeInTheDocument();

    const statuses = api.calls('GET', '/api/block-change-requests').map((r) => r.query.get('status'));
    expect(statuses).toEqual(expect.arrayContaining(['PENDING', 'REJECTED', 'ALL', 'APPROVED']));
  });

  it('renders each status badge, processed-by + comment, counts approved/rejected, and pages', async () => {
    const rows = [
      REQ({ id: 'a', status: 'APPROVED', filterName: 'F-A', processedByName: 'QA Lead', processedComment: 'fine' }),
      REQ({ id: 'r', status: 'REJECTED', filterName: 'F-R' }),
      REQ({ id: 'e', status: 'EXPIRED', filterName: 'F-E' }),
      REQ({ id: 'x', status: 'WEIRD', filterName: 'F-X' }),
    ];
    const api = mockApi(baseRoutes({ data: rows, total: 45 }, 1));
    renderPage(<ApprovalsPage />, { user: { role: 'SUPER_ADMIN', permissions: [] }, api });
    expect(await screen.findByText('F-A')).toBeInTheDocument();
    expect(screen.getByText('Processed by: QA Lead')).toBeInTheDocument();
    expect(screen.getByText('Comment: fine')).toBeInTheDocument();
    expect(screen.getByText('Used')).toBeInTheDocument();
    // An unknown status falls back to the Pending badge; SUPER_ADMIN sees no
    // Approve on non-pending rows (only PENDING rows get the controls).
    expect(screen.queryAllByRole('button', { name: 'Approve' })).toHaveLength(0);

    // pagination: 45 rows span several pages at any configured size -> page 2 asked for
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.calls('GET', '/api/block-change-requests').some((r) => r.query.get('page') === '2')).toBe(true));
  });
});

describe('Approvals page — requester (no BLOCK_CHANGE_APPROVE)', () => {
  it('tracks only my requests (mine=true), never asks for the pending count, offers no Approve', async () => {
    const api = mockApi(baseRoutes({ data: [REQ()], total: 1 }, 5));
    renderPage(<ApprovalsPage />, { user: { role: 'OPERATOR', permissions: ['ASSET_READ'] }, api });
    expect(await screen.findByText('FLT-0001')).toBeInTheDocument();
    expect(await screen.findByText('Track your block change requests')).toBeInTheDocument();
    await waitFor(() => {
      const calls = api.calls('GET', '/api/block-change-requests');
      expect(calls[calls.length - 1].query.get('mine')).toBe('true');
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByText(/\d+ pending request/)).toBeNull();
  });
});

describe('Approvals page — accessibility + console', () => {
  it('every control has a name (the comment box is named only by its placeholder) and the page logs nothing', async () => {
    const api = mockApi(baseRoutes({ data: [REQ()], total: 1 }, 1));
    renderPage(<ApprovalsPage />, { user: APPROVER, api });
    await screen.findByRole('button', { name: 'Approve' });
    const unl = unlabeledControls();
    expect(unl.none).toEqual([]);
    // Finding (reported, not asserted as a pass condition): the per-row comment
    // input has no <label>/aria-label; its only name is the placeholder.
    expect(unl.placeholderOnly.filter((d) => !d.includes('Comment (required) *'))).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
