import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

/**
 * PM Schedules list + AHU detail:
 * M79  — no SWR error state: a failed entries fetch read "No schedule entries
 *        found"; a failed workflow-config fetch fell back to `workflowEnabled:
 *        false` and silently switched Review/Approve to the legacy rules; the
 *        detail page read "No PM schedule exists" on a failed fetch.
 * OQ-08/09 — toasts / hints said "QA approval" whatever the configured flow.
 * OQ-10 — rejection remarks, who, when and the step appeared only in the PDF.
 * M80 / OQ-11 — /pm-schedules/:entityId had no inbound link (operator: link it).
 */

const TODAY = new Date().toISOString();
const entry = (over: Record<string, unknown>) => ({
  id: 'e1', scheduleId: 's1', ahuId: 'ahu-1', ahuName: 'AHU-01', month: new Date().getMonth() + 1,
  plannedDate: TODAY, toleranceDays: 5, windowStart: TODAY, windowEnd: TODAY,
  approvalStatus: 'APPROVED', approvalRemarks: null, approvedByName: null, approvedAt: null,
  submittedByName: 'uploader', pendingPlannedDate: null, pendingToleranceDays: null, ...over,
});

type Swr = { data?: any; error?: any; isLoading?: boolean };
const st: { entries: Swr; wf: Swr; detail: Swr } = { entries: {}, wf: {}, detail: {} };
const reload = { entries: vi.fn(), wf: vi.fn(), detail: vi.fn() };
vi.mock('swr', () => ({
  default: (key: any) => {
    if (Array.isArray(key) && key[0] === 'pm-entries') return { ...st.entries, mutate: reload.entries };
    if (key === '/api/pm-schedules/workflow-config') return { ...st.wf, mutate: reload.wf };
    if (key === '/api/pm-schedules/settings') return { data: { enabled: true } };
    if (typeof key === 'string' && /^\/api\/pm-schedules\/ahu-1\?year=/.test(key)) return { ...st.detail, mutate: reload.detail };
    return { data: undefined, mutate: vi.fn() };
  },
  mutate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
  useParams: () => ({ entityId: 'ahu-1' }),
}));
const auth = vi.hoisted(() => ({ user: { role: 'QA', username: 'qa1', permissions: ['PM_APPROVE', 'PM_READ'] as string[] } }));
vi.mock('../../../hooks/use-auth', () => ({ useAuth: () => auth }));
vi.mock('../../../hooks/use-can', () => ({ useCan: () => () => true }));
const reauthExecute = vi.fn(async (_a: string, cb: (pw?: string) => Promise<void>, opts?: any) => {
  try { await cb(); opts?.onSuccess?.(); } catch (e) { opts?.onError?.(e); }
});
vi.mock('../../../hooks/use-reauth', () => ({
  useReauth: () => ({ execute: reauthExecute, executeWithResult: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), setPassword: vi.fn(), isOpen: false, password: '', error: '', isVerifying: false }),
}));
vi.mock('@/hooks/use-reauth', () => ({
  useReauth: () => ({ execute: reauthExecute, executeWithResult: vi.fn(), cancel: vi.fn(), confirm: vi.fn(), setPassword: vi.fn(), isOpen: false, password: '', error: '', isVerifying: false }),
}));
vi.mock('../../../components/reauth-dialog', () => ({ ReauthDialog: () => null }));
vi.mock('@/components/reauth-dialog', () => ({ ReauthDialog: () => null }));
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('../../../hooks/use-datetime-format', () => ({
  useDatetimeFormat: () => ({ formatDate: () => '19 Oct 2026', formatDateTime: () => '18 Oct 2026 14:05', config: { timezone: 'UTC' } }),
}));
vi.mock('@/hooks/use-pagination-config', () => ({ usePaginationConfig: () => [25], usePageSize: () => [25, vi.fn()] }));
vi.mock('../../../hooks/use-pm-filters-enabled', () => ({ usePmFiltersEnabled: () => false }));
vi.mock('@/hooks/use-export-limit', () => ({ useExportLimit: () => ({ maxRecords: 100000, tooLargeMessage: () => '' }) }));
vi.mock('@/components/ExportMenu', () => ({ ExportMenu: () => null }));
vi.mock('@/components/SendForReviewButton', () => ({ SendForReviewButton: () => null }));
vi.mock('@/components/upload-validation-result', () => ({ UploadValidationResult: () => null }));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
const put = vi.fn(async (..._a: any[]) => ({}));
const post = vi.fn(async (..._a: any[]) => ({}));
vi.mock('../../../lib/api-client', () => ({ apiClient: { get: vi.fn(), put: (...a: any[]) => put(...a), post: (...a: any[]) => post(...a) }, api: {} }));

import { PmScheduleListPage, pmSubmissionText, pmUploadHint, rejectToastText } from '../index';
import { PmScheduleDetailPage } from '../detail';

const WF_ON = { workflowEnabled: true, reviewRole: 'MANAGER', approvalRole: 'QA' };
const WF_OFF = { workflowEnabled: false, reviewRole: '', approvalRole: '' };

beforeEach(() => {
  vi.clearAllMocks();
  st.entries = { data: { data: [] } }; st.wf = { data: WF_ON }; st.detail = {};
  auth.user = { role: 'QA', username: 'qa1', permissions: ['PM_APPROVE', 'PM_READ'] };
});

describe('OQ-08 / OQ-09 — messages follow the configured flow, never "QA approval"', () => {
  it('workflow on: "sent for review by <review role>"', () => {
    expect(pmSubmissionText(WF_ON)).toEqual({ title: 'Sent for review', phrase: 'sent for review by MANAGER' });
    expect(pmUploadHint(WF_ON, false)).toBe('entries go to review by MANAGER, then approval by QA');
  });
  it('workflow off: "sent for approval"; a Super Admin upload is approved directly', () => {
    expect(pmSubmissionText(WF_OFF)).toEqual({ title: 'Sent for approval', phrase: 'sent for approval' });
    expect(pmUploadHint(WF_OFF, false)).toBe('entries go to Pending for approval');
    expect(pmUploadHint(WF_OFF, true)).toBe('entries you upload are approved directly');
  });
  it('workflow config unknown: no specific claim', () => {
    expect(pmSubmissionText(undefined).phrase).not.toMatch(/QA|review by|approval by/);
  });

  it('editing an approved entry toasts the review route and that the current date stays active', async () => {
    st.entries = { data: { data: [entry({ approvalStatus: 'APPROVED' })] } };
    render(<PmScheduleListPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [, msg] = toast.success.mock.calls[0];
    expect(msg).toBe('Change sent for review by MANAGER. The current date stays active until the change is approved.');
    expect(msg).not.toMatch(/QA approval/);
  });

  it('D10: the reviewer\'s Modify on an edit under review starts from the PROPOSED date, not the approved one', async () => {
    auth.user = { role: 'MANAGER', username: 'mgr1', permissions: ['PM_REVIEW', 'PM_READ'] };
    const proposed = new Date(Date.now() + 10 * 86_400_000).toISOString();
    st.entries = { data: { data: [entry({
      approvalStatus: 'PENDING_REVIEW', submittedByName: 'editor', toleranceDays: 5,
      pendingPlannedDate: proposed, pendingToleranceDays: 3,
    })] } };
    render(<PmScheduleListPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [url, body] = put.mock.calls[0];
    expect(url).toBe('/api/pm-schedules/entries/e1/review-edit');
    expect(body).toEqual({ plannedDate: proposed.slice(0, 10), toleranceDays: 3 });
  });

  it('D2: rejecting a date change says the visit stays approved', () => {
    const rows = [{ id: 'a', pendingPlannedDate: null }, { id: 'b', pendingPlannedDate: '2026-11-20' }];
    expect(rejectToastText(['a'], rows)).toBe('1 entry(s) rejected');
    expect(rejectToastText(['b'], rows)).toBe('1 date change(s) rejected; those visits stay approved on their current date.');
    expect(rejectToastText(['a', 'b'], rows)).toBe('1 entry(s) rejected. 1 date change(s) rejected; those visits stay approved on their current date.');
  });

  it('re-submitting a rejected entry with the workflow off says "sent for approval"', async () => {
    st.wf = { data: WF_OFF };
    st.entries = { data: { data: [entry({ approvalStatus: 'REJECTED', rejectedByName: 'qa2', rejectionStage: 'APPROVAL', approvalRemarks: 'wrong date' })] } };
    render(<PmScheduleListPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Re-submitted', 'Entry sent for approval.'));
  });
});

describe('M79 — PM list error states', () => {
  it('a failed entries fetch shows an error with Retry, not "No schedule entries found"', () => {
    st.entries = { error: Object.assign(new Error('Internal server error'), { status: 500 }) };
    render(<PmScheduleListPage />);
    expect(screen.queryByText('No schedule entries found')).toBeNull();
    const alert = screen.getAllByRole('alert').find((a) => /PM schedule entries/.test(a.textContent ?? ''))!;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reload.entries).toHaveBeenCalled();
  });

  it('a failed workflow-config fetch hides Approve instead of falling back to the legacy rule', () => {
    // PM_APPROVE holder + legacy PENDING entry: the old fallback (workflow "off")
    // offered Approve; with the workflow really ON the server would refuse it.
    st.wf = { error: Object.assign(new Error('boom'), { status: 500 }) };
    st.entries = { data: { data: [entry({ approvalStatus: 'PENDING' })] } };
    render(<PmScheduleListPage />);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    const alert = screen.getAllByRole('alert').find((a) => /workflow settings/.test(a.textContent ?? ''))!;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reload.wf).toHaveBeenCalled();
  });

  it('control: with the config loaded (workflow off) the same approver does get Approve', () => {
    st.wf = { data: WF_OFF };
    st.entries = { data: { data: [entry({ approvalStatus: 'PENDING' })] } };
    render(<PmScheduleListPage />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});

describe('OQ-10 — rejection details on screen', () => {
  it('a REJECTED row shows the remarks, who rejected, when and at which step', () => {
    st.entries = { data: { data: [entry({ approvalStatus: 'REJECTED', approvalRemarks: 'Date clashes with shutdown', rejectedByName: 'manager1', rejectedAt: TODAY, rejectionStage: 'REVIEW' })] } };
    render(<PmScheduleListPage />);
    expect(screen.getByText(/Rejected at review by manager1 on 18 Oct 2026 14:05/)).toBeInTheDocument();
    expect(screen.getByText('Date clashes with shutdown')).toBeInTheDocument();
  });
});

describe('M80 / OQ-11 — AHU name links to its schedule page', () => {
  it('the AHU name in a row opens /pm-schedules/<ahuId>', () => {
    st.entries = { data: { data: [entry({})] } };
    render(<PmScheduleListPage />);
    expect(screen.getByRole('link', { name: 'AHU-01' })).toHaveAttribute('href', '/pm-schedules/ahu-1');
  });
});

describe('PM schedule detail (detail.tsx)', () => {
  it('M79: a failed fetch is not reported as "No PM schedule exists"', () => {
    st.detail = { error: Object.assign(new Error('Internal server error'), { status: 500 }) };
    render(<PmScheduleDetailPage />);
    expect(screen.queryByText(/No PM schedule exists/)).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Could not load the PM schedule/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reload.detail).toHaveBeenCalled();
  });

  it('M79: a genuine empty year still says no schedule exists, without "QA"', () => {
    st.detail = { data: null };
    render(<PmScheduleDetailPage />);
    expect(screen.getByText(/No PM schedule exists/)).toBeInTheDocument();
    expect(screen.queryByText(/QA for approval/)).toBeNull();
  });

  it('OQ-10: a rejected visit shows who, when, step and remarks', () => {
    st.detail = { data: { version: 1, status: 'ACTIVE', entries: [entry({ approvalStatus: 'REJECTED', approvalRemarks: 'Wrong tolerance', rejectedByName: 'qa2', rejectedAt: TODAY, rejectionStage: 'APPROVAL', execution: null })] } };
    render(<PmScheduleDetailPage />);
    expect(screen.getByText(/Rejected at approval by qa2/)).toBeInTheDocument();
    expect(screen.getByText('Wrong tolerance')).toBeInTheDocument();
  });
});
