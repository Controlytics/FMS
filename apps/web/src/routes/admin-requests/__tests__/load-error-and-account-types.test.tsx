import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

/**
 * M82 — a failed `/api/admin-requests` fetch rendered "No requests found",
 *   telling an approver the queue was empty when it had never been read. A 403
 *   gets no toast (swr-config.ts suppresses it), so the page was the only place
 *   the reason could appear, and it showed none.
 * OQ-19 — ENABLE_ACCOUNT / DISABLE_ACCOUNT (submitted by Contact Admin, executed
 *   by the server) were missing from TYPE_CFG: the queue showed the raw code,
 *   the details panel dumped JSON, and the toast read "undefined request …".
 */

const swrState: { data: any; error: any; isLoading: boolean } = { data: undefined, error: undefined, isLoading: false };
const reload = vi.fn();
vi.mock('swr', () => ({
  default: (key: string | null) => (key === '/api/admin-requests'
    ? { ...swrState, mutate: reload }
    : { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }),
  mutate: vi.fn(),
}));
vi.mock('@/hooks/use-can', () => ({ useCan: () => () => true }));

// Real-shaped execute: run the callback, then onSuccess (no password needed).
vi.mock('@/hooks/use-reauth', () => ({
  useReauth: () => ({
    execute: async (_a: string, cb: (pw?: string) => Promise<void>, opts?: any) => {
      try { await cb(); opts?.onSuccess?.(); } catch (e) { opts?.onError?.(e); }
    },
    cancel: vi.fn(), confirm: vi.fn(), setPassword: vi.fn(),
    isOpen: false, password: '', error: '', isVerifying: false,
  }),
}));
vi.mock('@/components/reauth-dialog', () => ({ ReauthDialog: () => null }));
vi.mock('@/hooks/use-datetime-format', () => ({
  useDatetimeFormat: () => ({ formatDateTime: () => '15 Jul 2026 10:00' }),
}));
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
const post = vi.fn();
vi.mock('@/lib/api-client', () => ({ api: { post: (...a: any[]) => post(...a) } }));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
vi.mock('@/components/super-admin-record-edit', () => ({
  SuperAdminRecordEditDialog: () => null, SuperAdminEditButton: () => null,
  useIsSuperAdmin: () => false, userOptions: () => [],
}));

import { AdminRequestsPage } from '../index';

const ENABLE_REQ = {
  id: 'req-9', requestType: 'ENABLE_ACCOUNT', status: 'PENDING',
  requesterName: 'Ravi Kumar', requesterEmployeeId: 'EMP-7',
  requestedAt: '2026-10-15T10:00:00.000Z', remarks: 'Back from leave',
  requestData: { username: '101020' },
};

beforeEach(() => {
  vi.clearAllMocks();
  swrState.data = undefined; swrState.error = undefined; swrState.isLoading = false;
});

describe('M82 — admin requests load failure', () => {
  it('shows an error with Retry, not "No requests found", when the fetch fails', () => {
    swrState.error = Object.assign(new Error('Internal server error'), { status: 500 });
    render(<AdminRequestsPage />);
    expect(screen.queryByText('No requests found')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load admin requests');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reload).toHaveBeenCalled();
  });

  it('names the 403 case', () => {
    swrState.error = Object.assign(new Error('Forbidden'), { status: 403 });
    render(<AdminRequestsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have permission/i);
    expect(screen.queryByText('No requests found')).toBeNull();
  });

  it('keeps showing stale rows when a refresh fails after a good load', () => {
    swrState.data = { data: [ENABLE_REQ] };
    swrState.error = Object.assign(new Error('flaky'), { status: 500 });
    render(<AdminRequestsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });
});

describe('OQ-19 — Enable / Disable Account requests', () => {
  it('labels the row and renders the target user + reason instead of raw JSON', () => {
    swrState.data = { data: [ENABLE_REQ] };
    render(<AdminRequestsPage />);
    expect(screen.queryByText('ENABLE_ACCOUNT')).toBeNull();
    const row = screen.getByRole('button', { name: /Review Enable Account request from Ravi Kumar/i });
    fireEvent.click(row);
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByText('101020')).toBeInTheDocument();
    expect(within(panel).getByText('Enable the account')).toBeInTheDocument();
    expect(panel.querySelector('pre')).toBeNull();
  });

  it('approval toast names the request type, never "undefined"', async () => {
    swrState.data = { data: [{ ...ENABLE_REQ, requestType: 'DISABLE_ACCOUNT' }] };
    post.mockResolvedValue({ username: '101020', actionTaken: true, message: 'Account "101020" disabled (was ENABLED).' });
    render(<AdminRequestsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Disable Account request/i }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/i), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalled());
    const text = toast.success.mock.calls[0].join(' ');
    expect(text).not.toMatch(/undefined/);
    expect(text).toMatch(/disabled/);
    // No credentials to share: the "Request Approved" credentials dialog must not open.
    expect(screen.queryByRole('dialog', { name: 'Request processed' })).toBeNull();
  });

  it('a "no action taken" approval warns instead of claiming approval', async () => {
    swrState.data = { data: [ENABLE_REQ] };
    post.mockResolvedValue({ username: '101020', actionTaken: false, message: 'No action taken — account "101020" is already enabled.' });
    render(<AdminRequestsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Enable Account request/i }));
    fireEvent.change(screen.getByPlaceholderText(/Enter notes/i), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning.mock.calls[0][1]).toMatch(/already enabled/);
    expect(screen.queryByRole('dialog', { name: 'Request processed' })).toBeNull();
  });
});
