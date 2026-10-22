import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import { mockApi, renderPage, clearGlobalSwrCache, type MockRequest } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { AdminRequestsPage } from '../index';

/**
 * Admin Requests queue, end to end through the real SWR -> apiClient -> fetch
 * path with the real useAuth/useCan/useReauth. Complements the two older
 * suites in this folder (which mock swr) with request-level assertions.
 */

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const REQS = () => [
  { id: 'r1', requestType: 'CREATE_USER', status: 'PENDING', requesterName: 'alice', requesterEmployeeId: 'E-100', requesterEmail: 'alice@plant.local',
    requestedAt: ago(20_000), remarks: 'New joiner', requestData: { username: '', fullName: 'Alice Smith', email: 'alice@plant.local', department: '', requestedRole: 'OPERATOR' } },
  { id: 'r2', requestType: 'MODIFY_USER', status: 'APPROVED', requesterName: 'bob', requestedAt: ago(5 * MIN),
    processedAt: ago(2 * MIN), processedBy: 'admin1', adminRemarks: 'Done as asked',
    requestData: { username: '101010', modifyField: 'role', currentRole: 'OPERATOR', newValue: 'SUPERVISOR' } },
  { id: 'r3', requestType: 'UNLOCK', status: 'REJECTED', requesterName: 'carol', requestedAt: ago(3 * 60 * MIN),
    processedAt: ago(60 * MIN), requestData: { username: '101011' } },
  { id: 'r4', requestType: 'FORGOT_PASSWORD', status: 'PENDING', requesterName: 'dave', requestedAt: ago(2 * 24 * 60 * MIN), requestData: { username: '101012' } },
  { id: 'r5', requestType: 'TRANSFER_SITE', status: 'ON_HOLD', requesterName: 'erin', requestedAt: ago(10 * MIN), requestData: { site: 'B' } },
  { id: 'r6', requestType: 'MODIFY_USER', status: 'PENDING', requesterName: 'frank', requestedAt: ago(7 * MIN),
    requestData: { username: '101013', modifyField: 'email', newValue: 'f@x.io' } },
];

const APPROVER = { role: 'ADMIN', permissions: ['ADMIN_REQUEST_APPROVE', 'ADMIN_REQUEST_REJECT'] };

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

function routes(list: unknown[], reauth: string[] = []) {
  return [
    ...commonConfigRoutes(),
    reauthActions(reauth),
    { path: '/api/admin-requests', body: { data: list } },
  ];
}

const row = (re: RegExp) => screen.getByRole('button', { name: re });

describe('Admin Requests — queue', () => {
  it('shows a loader first, then counts, type/status labels and relative times', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    expect(screen.getByText('Loading requests...')).toBeInTheDocument();

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('3 pending')).toBeInTheDocument();
    // stat cards: All 6, Pending 3, Approved 1, Rejected 1
    const cards = ['All Requests', 'Pending', 'Approved', 'Rejected'].map((l) => screen.getAllByText(l)[0].closest('button')!);
    expect(cards.map((c) => within(c).getByText(/^\d+$/).textContent)).toEqual(['6', '3', '1', '1']);

    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.getByText('2d ago')).toBeInTheDocument();
    // a request type / status this page does not know is shown raw, not "undefined"
    expect(screen.getByText('TRANSFER_SITE')).toBeInTheDocument();
    expect(screen.getByText('ON_HOLD')).toBeInTheDocument();
    expect(screen.getByText('E-100')).toBeInTheDocument();
    // pending rows say Review, processed rows say View
    expect(row(/Review Create User request from alice/)).toBeInTheDocument();
    expect(row(/View Modify User request from bob/)).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('stat cards filter by status, search matches name or employee ID, and Clear filters resets both', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    await screen.findByText('alice');

    const approvedCard = screen.getAllByText('Approved')[0].closest('button')!;
    fireEvent.click(approvedCard);
    expect(approvedCard).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.queryByText('alice')).toBeNull();

    fireEvent.click(screen.getAllByText('All Requests')[0].closest('button')!);
    const search = screen.getByPlaceholderText('Search requester or ID…');
    fireEvent.change(search, { target: { value: 'e-100' } });
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.queryByText('bob')).toBeNull();

    // the × clears the search
    fireEvent.click(screen.getByRole('button', { name: '×' }));
    expect(search).toHaveValue('');
    expect(screen.getByText('bob')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    fireEvent.click(screen.getAllByText('Rejected')[0].closest('button')!);
    expect(screen.getByText('No matching requests')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(search).toHaveValue('');
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getAllByText('All Requests')[0].closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('an empty queue says so and reports everything processed', async () => {
    const api = mockApi(routes([]));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    expect(await screen.findByText('No requests found')).toBeInTheDocument();
    expect(screen.getByText('All requests have been processed')).toBeInTheDocument();
  });

  it('a 403 names the permission problem and offers no Retry', async () => {
    const api = mockApi([...commonConfigRoutes(), reauthActions(), { path: '/api/admin-requests', status: 403, body: { error: 'FORBIDDEN', message: 'Forbidden' } }]);
    renderPage(<AdminRequestsPage />, { user: { role: 'OPERATOR', permissions: [] }, api });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view admin requests');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByText('Request list unavailable')).toBeInTheDocument();
  });

  it('a 500 shows the server message and Retry re-reads the queue', async () => {
    const api = mockApi([...commonConfigRoutes(), reauthActions(), { path: '/api/admin-requests', status: 500, body: { error: 'INTERNAL', message: 'db down' } }]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load admin requests');
    expect(alert).toHaveTextContent('db down');
    const before = api.calls('GET', '/api/admin-requests').length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.calls('GET', '/api/admin-requests').length).toBeGreaterThan(before));
  });

  it('pages at the configured size (25 here) and the page-size selector re-slices', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `p${i}`, requestType: 'UNLOCK', status: 'PENDING', requesterName: `user${String(i).padStart(2, '0')}`, requestedAt: ago(MIN), requestData: { username: `u${i}` },
    }));
    // first option and limit agree, so the opening size is 25 under either reading
    const api = mockApi([
      { path: '/api/config/pagination/current', body: { limit: 25, count: 3, options: [25, 50, 100] } },
      ...routes(many),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    expect(await screen.findByText('user00')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('user24')).toBeInTheDocument());
    expect(screen.queryByText('user25')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('user25')).toBeInTheDocument();
    expect(screen.queryByText('user00')).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '50' } });
    expect(await screen.findByText('user00')).toBeInTheDocument();
    expect(screen.getByText('user29')).toBeInTheDocument();
  });
});

describe('Admin Requests — details panel', () => {
  it('renders each request type\'s details and the processed timeline', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    await screen.findByText('alice');

    // CREATE_USER: blank username -> auto-generated, blank department -> "-"
    fireEvent.click(row(/Create User request from alice/));
    let panel = screen.getByRole('dialog', { name: 'Create User request from alice' });
    expect(within(panel).getByText('(auto-generated)')).toBeInTheDocument();
    expect(within(panel).getByText('Alice Smith')).toBeInTheDocument();
    expect(within(panel).getByText('OPERATOR')).toBeInTheDocument();
    expect(within(panel).getByText('alice@plant.local', { selector: 'div.text-\\[11px\\]' })).toBeInTheDocument();
    expect(within(panel).getByText("Requester's Reason")).toBeInTheDocument();
    expect(within(panel).getByText('New joiner')).toBeInTheDocument();
    expect(panel).toHaveFocus();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close request details' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // MODIFY_USER role change: current + new role, approved timeline, processed by, admin notes, no actions
    fireEvent.click(row(/Modify User request from bob/));
    panel = screen.getByRole('dialog', { name: 'Modify User request from bob' });
    expect(within(panel).getByText('Current Role')).toBeInTheDocument();
    expect(within(panel).getByText('SUPERVISOR')).toBeInTheDocument();
    expect(within(panel).getAllByText('Approved').length).toBeGreaterThan(0);
    expect(within(panel).getByText('Processed by')).toBeInTheDocument();
    expect(within(panel).getByText('admin1')).toBeInTheDocument();
    expect(within(panel).getByText('Admin Notes')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(panel).queryByPlaceholderText(/Enter notes/)).toBeNull();
    // the backdrop closes it
    fireEvent.click(panel.previousElementSibling as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();

    // UNLOCK rejected: the timeline says Rejected
    fireEvent.click(row(/Unlock Account request from carol/));
    panel = screen.getByRole('dialog', { name: 'Unlock Account request from carol' });
    expect(within(panel).getByText('101011')).toBeInTheDocument();
    expect(within(panel).getAllByText('Rejected').length).toBe(2); // badge + timeline
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    // MODIFY_USER other field: the generic Modify Field / New Value layout
    fireEvent.click(row(/Modify User request from frank/));
    panel = screen.getByRole('dialog', { name: 'Modify User request from frank' });
    expect(within(panel).getByText('Modify Field')).toBeInTheDocument();
    expect(within(panel).getByText('f@x.io')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Tab' }); // not Escape: stays open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });

    // unknown type: raw JSON, raw label in the panel header
    fireEvent.click(row(/TRANSFER_SITE request from erin/));
    panel = screen.getByRole('dialog', { name: 'TRANSFER_SITE request from erin' });
    expect(panel.querySelector('pre')).toHaveTextContent('"site": "B"');
    expect(within(panel).getByText('ON_HOLD')).toBeInTheDocument();
  });

  it('a pending request with no remarks warns instead of sending', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Remarks Required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/admin-requests/r4/process')).toHaveLength(0);
  });

  it('approving a password reset shows the one-time credentials, copies them, and Escape / Done dismiss', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r4/process', body: { username: '101012', temporaryPassword: 'Tmp@4821', message: 'Password reset' } },
      ...routes(REQS()),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: '  verified by phone  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    const result = await screen.findByRole('dialog', { name: 'Request processed' });
    expect(api.calls('POST', '/api/admin-requests/r4/process')[0].json).toEqual({ action: 'approve', adminRemarks: 'verified by phone' });
    expect(within(result).getByText('Password reset')).toBeInTheDocument();
    expect(within(result).getByText(/Share these credentials/)).toBeInTheDocument();
    expect(within(result).getByText('Tmp@4821')).toBeInTheDocument();
    expect(result).toHaveFocus();
    // the panel closed. (The page then calls swr's GLOBAL mutate('/api/admin-requests'),
    // which reaches the app's default cache but not the harness's per-test cache
    // provider, so the re-read itself is not observable here.)
    expect(screen.queryByRole('dialog', { name: /Forgot Password request/ })).toBeNull();

    fireEvent.click(within(result).getByRole('button', { name: 'Copy temporary password' }));
    await waitFor(() => expect(within(result).getByRole('button', { name: 'Copy temporary password' })).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith('Tmp@4821');
    fireEvent.click(within(result).getByRole('button', { name: 'Copy User ID' }));
    await waitFor(() => expect(within(result).getByRole('button', { name: 'Copy User ID' })).toHaveTextContent('Copied'));
    expect(writeText).toHaveBeenCalledWith('101012');
    // the "Copied" state resets after the configured delay
    await waitFor(() => expect(within(result).getByRole('button', { name: 'Copy User ID' })).toHaveTextContent('Copy'), { timeout: 3000 });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Request processed' })).toBeNull();
  });

  it('approving a create-user request with only a username still opens the result dialog; Done closes it', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r1/process', body: { username: 'alice01' } },
      ...routes(REQS()),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Create User request from alice/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const result = await screen.findByRole('dialog', { name: 'Request processed' });
    expect(within(result).getByText('Action completed successfully.')).toBeInTheDocument();
    expect(within(result).getByText('alice01')).toBeInTheDocument();
    expect(within(result).queryByText(/Share these credentials/)).toBeNull();
    expect(within(result).queryByRole('button', { name: 'Copy temporary password' })).toBeNull();
    fireEvent.click(within(result).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Request processed' })).toBeNull();
  });

  it('an approval with no credentials toasts the server message; a rejection names the request type', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r6/process', body: (req: MockRequest) => (req.json.action === 'approve' ? { message: 'Email updated' } : {}) },
      ...routes(REQS()),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Modify User request from frank/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'fine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Request Approved')).toBeInTheDocument();
    expect(screen.getByText('Email updated')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    fireEvent.click(screen.getByRole('button', { name: /Modify User request from frank/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'not allowed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Request Rejected')).toBeInTheDocument();
    expect(screen.getByText('Modify User request has been rejected.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/admin-requests/r6/process').map((r) => r.json.action)).toEqual(['approve', 'reject']);
  });

  it('a server refusal shows "Action Failed" and re-enables the buttons', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r4/process', status: 409, body: { error: 'ALREADY_PROCESSED', message: 'Request already processed' } },
      ...routes(REQS()),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Action Failed')).toBeInTheDocument();
    expect(screen.getByText('Request already processed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('only the actions the role holds are offered', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: { role: 'MANAGER', permissions: ['ADMIN_REQUEST_REJECT'] }, api });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    expect(await screen.findByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a viewer without approve/reject sees the request but no response box', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: { role: 'AUDITOR', permissions: ['ADMIN_REQUEST_READ'] }, api });
    await screen.findByText('dave');
    await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /Forgot Password request from dave/ }));
    expect(screen.getByRole('dialog', { name: /Forgot Password request from dave/ })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Enter notes/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });
});

describe('Admin Requests — re-auth (APPROVE_ADMIN_REQUEST)', () => {
  it('prompts for the password, then sends it in header and body', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r4/process', body: { message: 'ok' } },
      ...routes(REQS(), ['APPROVE_ADMIN_REQUEST']),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(screen.getByText('Performing "Approve / Reject Admin Request" requires identity verification.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Processing...' })).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Secret@1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(api.calls('POST', '/api/admin-requests/r4/process')).toHaveLength(1));
    const sent = api.calls('POST', '/api/admin-requests/r4/process')[0];
    expect(sent.headers['x-reauth-password']).toBe('Secret@1');
    expect(sent.json).toEqual({ action: 'approve', adminRemarks: 'checked', _currentPassword: 'Secret@1' });
  });

  it('a wrong password keeps the prompt open with an error', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r4/process', status: 401, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } },
      ...routes(REQS(), ['APPROVE_ADMIN_REQUEST']),
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Confirm Your Identity')).toBeInTheDocument();
  });

  it('cancelling sends nothing and puts the buttons back', async () => {
    const api = mockApi(routes(REQS(), ['APPROVE_ADMIN_REQUEST']));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const box = (await screen.findByText('Confirm Your Identity')).closest('.max-w-lg') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('POST', '/api/admin-requests/r4/process')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('a REAUTH_REQUIRED answer opens the prompt retroactively and the retry carries the password', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/admin-requests/r4/process', body: { message: 'ok' } },
      ...routes(REQS()),
    ]);
    api.add({ method: 'POST', path: '/api/admin-requests/r4/process', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } });
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'pw2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(api.calls('POST', '/api/admin-requests/r4/process')).toHaveLength(2));
    expect(api.calls('POST', '/api/admin-requests/r4/process')[1].headers['x-reauth-password']).toBe('pw2');
    expect(await screen.findByText('Request Approved')).toBeInTheDocument();
  });
});

describe('Admin Requests — Super Admin record edit', () => {
  const SA = { role: 'SUPER_ADMIN', permissions: [] };
  const USERS = { data: [{ id: 'u1', username: 'admin1', fullName: 'Admin One' }, { id: 'u2', username: 'admin2' }] };

  it('the pencil opens the edit dialog (not the review panel) and saves only the changed fields with a reason', async () => {
    const api = mockApi([
      { path: '/api/users', body: USERS },
      { method: 'PUT', path: '/api/super-admin/data/admin-requests/r2', body: { ok: true } },
      ...routes(REQS()),
    ]);
    renderPage(<AdminRequestsPage />, { user: SA, api });
    await screen.findByText('bob');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })).toHaveLength(6));
    const usersCall = api.calls('GET', '/api/users')[0];
    expect(usersCall.query.get('limit')).toBe('1000000');

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[1]);
    const dlg = screen.getByRole('dialog', { name: 'Edit request - bob' });
    expect(screen.queryByRole('dialog', { name: /Modify User request from bob/ })).toBeNull();
    // Processed-by options come from the users list
    const by = within(dlg).getByLabelText('Processed by') as HTMLSelectElement;
    expect(Array.from(by.options).map((o) => o.textContent)).toEqual(['-- nobody --', 'Admin One (admin1)', 'admin2 (admin2)']);
    expect(by.value).toBe('admin1');
    expect((within(dlg).getByLabelText(/^Type/) as HTMLSelectElement).value).toBe('MODIFY_USER');

    fireEvent.change(within(dlg).getByLabelText('Admin remarks'), { target: { value: 'Done as asked (role updated)' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'clarify the note' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/data/admin-requests/r2')).toHaveLength(1));
    expect(api.calls('PUT', '/api/super-admin/data/admin-requests/r2')[0].json).toEqual({ adminRemarks: 'Done as asked (role updated)', _changeReason: 'clarify the note' });
    expect(await screen.findByText('Request updated')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Edit request - bob' })).toBeNull();
  });

  it('with SUPER_ADMIN_DATA_EDIT re-auth on, the save carries the password; Close dismisses without saving', async () => {
    const api = mockApi([
      { path: '/api/users', body: USERS },
      { method: 'PUT', path: '/api/super-admin/data/admin-requests/r1', body: { ok: true } },
      ...routes(REQS(), ['SUPER_ADMIN_DATA_EDIT']),
    ]);
    renderPage(<AdminRequestsPage />, { user: SA, api });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })).toHaveLength(6));
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[0]);
    let dlg = screen.getByRole('dialog', { name: 'Edit request - alice' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Edit request - alice' })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit record (Super Admin)' })[0]);
    dlg = screen.getByRole('dialog', { name: 'Edit request - alice' });
    fireEvent.change(within(dlg).getByLabelText(/^Requester name/), { target: { value: 'Alicia' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'spelling fix' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    fireEvent.change(await screen.findByPlaceholderText('Enter your password'), { target: { value: 'SaPw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/data/admin-requests/r1')).toHaveLength(1));
    const put = api.calls('PUT', '/api/super-admin/data/admin-requests/r1')[0];
    expect(put.headers['x-reauth-password']).toBe('SaPw');
    expect(put.json).toEqual({ requesterName: 'Alicia', _changeReason: 'spelling fix', _currentPassword: 'SaPw' });
  });

  it('a non-Super-Admin never loads the users list and sees no pencil', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    await screen.findByText('alice');
    await waitFor(() => expect(api.calls('GET', '/api/auth/me').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Edit record (Super Admin)' })).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
  });
});

describe('Admin Requests — the queue refreshes after a decision (global SWR cache)', () => {
  // The page refreshes with swr's GLOBAL mutate('/api/admin-requests'), which
  // only reaches the default cache, so this render opts into it.
  beforeEach(async () => { await clearGlobalSwrCache(); });
  afterEach(async () => { await clearGlobalSwrCache(); });

  it('after a reject the list is re-read and the pending count drops', async () => {
    let rejected = false;
    const api = mockApi([
      ...commonConfigRoutes(),
      reauthActions(),
      { method: 'POST', path: '/api/admin-requests/r4/process', body: (req: MockRequest) => { rejected = req.json.action === 'reject'; return {}; } },
      { path: '/api/admin-requests', body: () => ({ data: REQS().map((r) => (r.id === 'r4' && rejected ? { ...r, status: 'REJECTED' } : r)) }) },
    ]);
    renderPage(<AdminRequestsPage />, { user: APPROVER, api, globalCache: true });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    expect(screen.getByText('3 pending')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/), { target: { value: 'identity not verified' } });
    const reads = api.calls('GET', '/api/admin-requests').length;
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(api.calls('POST', '/api/admin-requests/r4/process')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', '/api/admin-requests').length).toBeGreaterThan(reads));
    expect(await screen.findByText('2 pending')).toBeInTheDocument();
  });
});

describe('Admin Requests — accessibility + console', () => {
  it('scan with the review panel open; nothing is logged', async () => {
    const api = mockApi(routes(REQS()));
    renderPage(<AdminRequestsPage />, { user: APPROVER, api });
    fireEvent.click(await screen.findByRole('button', { name: /Forgot Password request from dave/ }));
    await act(async () => {});
    const unl = unlabeledControls();
    expect(unl.none).toEqual([]);
    // Findings (reported): the search box and the "Your Response" textarea are
    // named only by their placeholders (the h4 is not a <label>).
    expect(unl.placeholderOnly.filter((d) => !/Search requester or ID|Enter notes about your decision/.test(d))).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
