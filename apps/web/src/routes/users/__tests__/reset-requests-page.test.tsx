import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from './support/page-findings';
import { ResetRequestsPage } from '../reset-requests';

/** Password Reset Requests: real SWR -> apiClient -> fetch, real useReauth. */

const PENDING_FULL = {
  id: 'r1', userId: 'emp1001', userFullName: 'Asha Rao', userEmail: 'asha@x.io', userDepartment: 'QC',
  status: 'PENDING', requestedAt: '2026-10-20T09:15:00.000Z',
};
const PENDING_BARE = { id: 'r2', userId: 'emp2002', status: 'PENDING', requestedAt: '2026-10-20T10:00:00.000Z' };
const HISTORY = [
  { id: 'h1', userId: 'emp3003', userFullName: 'Ravi Kumar', status: 'APPROVED', requestedAt: '2026-10-01T08:00:00.000Z', processedAt: '2026-10-01T09:00:00.000Z', processedBy: 'root' },
  { id: 'h2', userId: 'emp4004', status: 'REJECTED', requestedAt: '2026-10-02T08:00:00.000Z' },
  { id: 'h3', userId: 'emp5005', userFullName: 'Old Entry', status: 'EXPIRED', requestedAt: '2026-09-02T08:00:00.000Z' },
];
const SA: TestUser = { id: 'u-test', role: 'SUPER_ADMIN', permissions: [] };

function routes(opts: { data?: unknown[]; reauth?: string[]; extra?: MockRoute[] } = {}): MockRoute[] {
  return [
    ...(opts.extra ?? []),
    ...commonConfigRoutes(),
    reauthActions(opts.reauth ?? []),
    { path: '/api/config/password-policy/current', body: { minLength: 10 } },
    { path: '/api/users/reset-requests', body: { data: opts.data ?? [PENDING_FULL, PENDING_BARE, ...HISTORY] } },
  ];
}

const card = (name: string) => screen.getByText(name, { selector: 'p.font-semibold' }).closest('.group') as HTMLElement;
const tempPassword = () => (document.querySelector('input[readonly]') as HTMLInputElement).value;

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

describe('Reset requests — lists', () => {
  it('splits pending from history, counts pending, and renders optional fields only when present', async () => {
    const api = mockApi(routes());
    renderPage(<ResetRequestsPage />, { user: SA, api });
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    // pending count badge
    expect(screen.getByText('Pending Requests').parentElement).toHaveTextContent('2');
    expect(within(card('Asha Rao')).getByText('asha@x.io')).toBeInTheDocument();
    expect(within(card('Asha Rao')).getByText('QC')).toBeInTheDocument();
    expect(within(card('Asha Rao')).getByText(/^Requested /)).toBeInTheDocument();
    // no full name -> the User ID stands in as the title (title + id chip), and
    // no email / department line is rendered for it
    expect(within(card('emp2002')).getAllByText('emp2002')).toHaveLength(2);
    expect(card('emp2002').querySelectorAll('span.flex.items-center')).toHaveLength(1);
    expect(card('Asha Rao').querySelectorAll('span.flex.items-center')).toHaveLength(3);

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Approved')).toBeInTheDocument();
    expect(within(rows[0]).getByText('RK')).toBeInTheDocument();
    expect(within(rows[0]).getByText('emp3003')).toBeInTheDocument();
    expect(within(rows[0]).getByText('root')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Rejected')).toBeInTheDocument();
    // not processed / no processor -> dashes
    expect(within(rows[1]).getAllByText('-')).toHaveLength(2);
    expect(within(rows[2]).getByText('EXPIRED')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Users/ })).toHaveAttribute('href', '/users');
    expect(api.unmatched).toEqual([]);
  });

  it('empty feed: "All caught up!" and "No history yet"', async () => {
    const api = mockApi(routes({ data: [] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    expect(await screen.findByText('All caught up!')).toBeInTheDocument();
    expect(screen.getByText('No history yet')).toBeInTheDocument();
  });
});

describe('Reset requests — approve', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
  });

  it('opens with a policy-length temporary password; show/hide, copy, regenerate work; Cancel sends nothing', async () => {
    const api = mockApi(routes());
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    await waitFor(() => expect(api.calls('GET', '/api/config/password-policy/current').length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));

    expect(await screen.findByText('Approve Password Reset')).toBeInTheDocument();
    expect(screen.getAllByText('emp1001').length).toBeGreaterThan(1); // card + dialog
    expect(tempPassword()).toHaveLength(10);
    const input = document.querySelector('input[readonly]') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input.type).toBe('password');

    const first = tempPassword();
    fireEvent.click(screen.getByRole('button', { name: /Copy/ }));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(first);
    fireEvent.click(screen.getByRole('button', { name: /Regenerate/ }));
    await waitFor(() => expect(tempPassword()).not.toBe(first));
    expect(screen.queryByText('Copied!')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Approve Password Reset')).toBeNull());
    expect(api.calls('POST', '/api/users/reset-requests/r1/process')).toHaveLength(0);
  });

  it('copy falls back to execCommand when the clipboard API is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('no')) }, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    const api = mockApi(routes());
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Copy/ }));
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
    expect(exec).toHaveBeenCalledWith('copy');
    await waitFor(() => expect(screen.queryByText('Copied!')).toBeNull(), { timeout: 3000 });
  });

  it('Approve POSTs action + the shown password, shows a dismissible success banner, and re-reads the list', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/reset-requests/r1/process', body: { ok: true } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    const reads = api.calls('GET', '/api/users/reset-requests').length;
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));
    await screen.findByText('Approve Password Reset');
    const pw = tempPassword();
    fireEvent.click(screen.getByRole('button', { name: /Approve & Reset Password/ }));

    await waitFor(() => expect(api.calls('POST', '/api/users/reset-requests/r1/process')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/reset-requests/r1/process')[0].json).toEqual({ action: 'approve', newPassword: pw });
    const banner = await screen.findByText('Password reset approved for emp1001. Make sure to share the temporary password securely.');
    await waitFor(() => expect(screen.queryByText('Approve Password Reset')).toBeNull());
    await waitFor(() => expect(api.calls('GET', '/api/users/reset-requests').length).toBeGreaterThan(reads));
    fireEvent.click(within(banner.parentElement as HTMLElement).getByRole('button'));
    await waitFor(() => expect(screen.queryByText(/Password reset approved/)).toBeNull());
  });

  it('a server refusal is shown inside the dialog and the button is usable again', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/reset-requests/r1/process', status: 409, body: { error: 'ALREADY_PROCESSED', message: 'Request already processed' } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Reset Password/ }));
    expect(await screen.findByText('Request already processed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve & Reset Password/ })).toBeEnabled();
    expect(screen.queryByText(/Password reset approved/)).toBeNull();
  });

  it('PROCESS_RESET_REQUEST under re-auth: prompt, then the POST carries the signature', async () => {
    const api = mockApi(routes({ reauth: ['PROCESS_RESET_REQUEST'], extra: [{ method: 'POST', path: '/api/users/reset-requests/r1/process', body: { ok: true } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));
    await screen.findByText('Approve Password Reset');
    const pw = tempPassword();
    fireEvent.click(screen.getByRole('button', { name: /Approve & Reset Password/ }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    // the decision dialog shows it is waiting
    expect(screen.getByRole('button', { name: /Processing/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'sig1' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/reset-requests/r1/process')).toHaveLength(1));
    const sent = api.calls('POST', '/api/users/reset-requests/r1/process')[0];
    expect(sent.json).toEqual({ action: 'approve', newPassword: pw, _currentPassword: 'sig1' });
    expect(sent.headers['x-reauth-password']).toBe('sig1');
    expect(await screen.findByText(/Password reset approved for emp1001/)).toBeInTheDocument();
  });

  it('cancelling the password prompt unwinds silently: no request, no error, button usable again (M64)', async () => {
    const api = mockApi(routes({ reauth: ['PROCESS_RESET_REQUEST'] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Approve & Reset Password/ }));
    await screen.findByText('Confirm Your Identity');
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).slice(-1)[0]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(await screen.findByRole('button', { name: /Approve & Reset Password/ })).toBeEnabled();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(api.calls('POST', '/api/users/reset-requests/r1/process')).toHaveLength(0);
  });
});

describe('Reset requests — reject', () => {
  it('Reject with a reason POSTs action=reject + notes and reports it', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/reset-requests/r2/process', body: { ok: true } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    fireEvent.click(within(card('emp2002')).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Reject Password Reset Request')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('e.g., User should contact IT directly'), { target: { value: 'Contact IT' } });
    fireEvent.click(screen.getByRole('button', { name: /Reject Request/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/reset-requests/r2/process')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/reset-requests/r2/process')[0].json).toEqual({ action: 'reject', notes: 'Contact IT' });
    expect(await screen.findByText('Password reset request rejected for emp2002.')).toBeInTheDocument();
  });

  it('Reject without a reason omits notes (the field is optional); Cancel closes the dialog', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/reset-requests/r1/process', body: { ok: true } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: 'Reject' }));
    await screen.findByText('Reject Password Reset Request');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Reject Password Reset Request')).toBeNull());

    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: 'Reject' }));
    fireEvent.click(await screen.findByRole('button', { name: /Reject Request/ }));
    await waitFor(() => expect(api.calls('POST', '/api/users/reset-requests/r1/process')).toHaveLength(1));
    expect(api.calls('POST', '/api/users/reset-requests/r1/process')[0].json).toEqual({ action: 'reject' });
  });

  it('a refused reject shows the error inside the reject dialog', async () => {
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/reset-requests/r1/process', status: 500, body: { error: 'X', message: 'Server exploded' } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: 'Reject' }));
    fireEvent.click(await screen.findByRole('button', { name: /Reject Request/ }));
    expect(await screen.findByText('Server exploded')).toBeInTheDocument();
    expect(screen.getByText('Reject Password Reset Request')).toBeInTheDocument();
  });
});

describe('Reset requests — accessibility + console', () => {
  it('flags only the known unnamed controls and logs nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    const api = mockApi(routes({ extra: [{ method: 'POST', path: '/api/users/reset-requests/r2/process', body: { ok: true } }] }));
    renderPage(<ResetRequestsPage />, { user: SA, api });
    await screen.findByText('Asha Rao');
    // produce the success banner (its dismiss button is svg-only)
    fireEvent.click(within(card('emp2002')).getByRole('button', { name: 'Reject' }));
    fireEvent.click(await screen.findByRole('button', { name: /Reject Request/ }));
    await screen.findByText(/rejected for emp2002/);
    fireEvent.click(within(card('Asha Rao')).getByRole('button', { name: /Approve & Reset/ }));
    await screen.findByText('Approve Password Reset');
    const unl = unlabeledControls();
    // Findings: the success banner's dismiss "x" is svg-only (reset-requests.tsx:188),
    // the approve dialog's read-only password input has no label association (:463).
    const KNOWN = (d: string) => (d.startsWith('button') && d.includes('text-emerald-600 hover:bg-emerald-100'))
      || d.startsWith('input[type=password]');
    expect(unl.none.filter((d) => !KNOWN(d))).toEqual([]);
    expect(unl.placeholderOnly).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
