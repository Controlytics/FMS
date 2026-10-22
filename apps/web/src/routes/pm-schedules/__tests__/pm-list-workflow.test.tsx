/**
 * PM Schedules list — rendering, filters, and the review / approve / reject /
 * edit / resubmit workflow, through the page harness (real SWR, apiClient,
 * useAuth, useCan, useReauth; only fetch is stubbed). Coverage campaign
 * 2026-10-21.
 *
 * Business rules exercised:
 *  - workflow ON: Review is for the configured review ROLE, Approve for the
 *    configured approval ROLE (assertPmRole), whatever permissions they hold;
 *  - workflow OFF: legacy permission rules (PM_APPROVE) on the PENDING status;
 *  - a date change to an approved visit (`pendingPlannedDate`) that is rejected
 *    leaves the visit approved, and the toast says so;
 *  - the reviewer's Modify starts from the PROPOSED date;
 *  - an entry the viewer submitted (or, at approval, reviewed) is never
 *    selectable for a bulk run (the server refuses the whole batch).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { renderPage, clearGlobalSwrCache } from '@/test-utils/page-harness';
import { usePageTestLifecycle, passReauth, expectSigned, reauthOnce, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { LocationProbe } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { PmScheduleListPage } from '../index';
import {
  pmApi, entry, day, shown, okDialog, rowWith, Y,
  WF_ON, WF_OFF, VIEWER, REVIEWER, APPROVER, EDITOR, SA, type PmRouteOpts,
} from './pm-kit';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

function open(user: any, o: PmRouteOpts = {}) {
  const api = pmApi(o);
  renderPage(<><PmScheduleListPage /><LocationProbe /></>, { user, api });
  return api;
}
const entryReads = (api: ReturnType<typeof pmApi>) => api.calls('GET', '/api/pm-schedules/entries').filter((r) => !r.query.get('page'));
const tile = (label: string) => screen.getByText(label, { selector: 'p' }).nextSibling as HTMLElement;
const rejectDlg = () => screen.getByRole('heading', { name: /^Reject \d+ Entry\(s\)$/ }).closest('.max-w-md') as HTMLElement;

describe('PM list — what is shown', () => {
  it('groups rows by AHU with serials, dates, window, status, approver, and summary tiles; reads nothing unmocked', async () => {
    const api = open(VIEWER, {
      wf: WF_OFF,
      entries: [
        entry('e1', { approvalStatus: 'APPROVED', pendingPlannedDate: day(18) }),
        entry('e2', { approvalStatus: 'PENDING', plannedDate: day(12), approvedByName: null }),
        entry('e3', { approvalStatus: 'REJECTED', ahuId: 'ahu-2', ahuName: 'AHU-02', approvedByName: null, submittedByName: null,
          approvalRemarks: '  ', rejectedByName: null, rejectedAt: null, rejectionStage: 'QA_CHECK' }),
      ],
    });
    expect(screen.getByText('Loading schedules...')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'AHU-02' })).toHaveAttribute('href', '/pm-schedules/ahu-2');
    expect(screen.getAllByRole('link', { name: 'AHU-01' })).toHaveLength(2);
    expect(tile('Total')).toHaveTextContent('3');
    expect(tile('Approved')).toHaveTextContent('1');
    expect(tile('Pending')).toHaveTextContent('1');
    expect(tile('Rejected')).toHaveTextContent('1');

    const approved = rowWith(`Pending: ${shown(18)}`);
    expect(approved).toHaveTextContent('1');
    expect(approved).toHaveTextContent(shown(15));
    expect(approved).toHaveTextContent('5 days');
    expect(approved).toHaveTextContent(`${shown(10)} — ${shown(20)}`);
    expect(approved).toHaveTextContent('Approved');
    expect(approved).toHaveTextContent('qa9');
    expect(rowWith(shown(12))).toHaveTextContent('by uploader');
    // A rejection with no name / time / remarks still says what is known.
    const rejected = rowWith('AHU-02');
    expect(rejected).toHaveTextContent('Rejected at qa_check');
    expect(rejected).toHaveTextContent('Remarks: none recorded');
    expect(rejected).toHaveTextContent('--');
    // A viewer has no select column and no actions.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /^(Approve|Review ✓|Reject|Edit|Resubmit|Modify)$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Template|New Schedule|Upload Schedule/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete schedule for/ })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('the AHU link navigates to that AHU\'s schedule page', async () => {
    open(VIEWER, { entries: [entry('e1')] });
    fireEvent.click(await screen.findByRole('link', { name: 'AHU-01' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/pm-schedules/ahu-1');
  });

  it('PM disabled in settings shows the disabled notice instead of the table', async () => {
    open(VIEWER, { settings: { enabled: false } });
    expect(await screen.findByText('PM Module Disabled')).toBeInTheDocument();
    expect(screen.queryByText('PM Schedules')).toBeNull();
  });

  it('an empty period says so', async () => {
    open(VIEWER, { entries: [] });
    expect(await screen.findByText('No schedule entries found')).toBeInTheDocument();
  });

  it('a status tab narrows the table, not the counts; empty review/approval tabs are hidden', async () => {
    const api = open(VIEWER, { entries: [entry('e1'), entry('e2', { approvalStatus: 'PENDING_REVIEW', plannedDate: day(12) })] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.getByRole('button', { name: /To Review/ })).toHaveTextContent('(1)');
    expect(screen.queryByRole('button', { name: /To Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Pending/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Approved/ }));
    await waitFor(() => expect(screen.queryByText(shown(12))).toBeNull());
    expect(screen.getByText(shown(15))).toBeInTheDocument();
    // D03-04: the tiles and the other tabs keep counting the whole range.
    expect(tile('Total')).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /To Review/ })).toHaveTextContent('(1)');
    expect(entryReads(api).every((r) => !r.query.has('approvalStatus'))).toBe(true);
    // The active tab stays visible even when empty.
    fireEvent.click(screen.getByRole('button', { name: /^Rejected/ }));
    expect(await screen.findByText('No schedule entries found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Rejected/ })).toBeInTheDocument();
  });

  it('a range that spans years reads every year in it (one GET per year)', async () => {
    const api = open(VIEWER, { entries: [entry('e1'), entry('old', { plannedDate: `${Y - 1}-12-20T06:00:00.000Z` })] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('PM schedule from date'), { target: { value: `${Y - 1}-12-01` } });
    await waitFor(() => {
      const years = entryReads(api).map((r) => r.query.get('year'));
      expect(years).toEqual(expect.arrayContaining([String(Y - 1), String(Y)]));
    });
    expect(await screen.findByText(`${Y - 1}-12-20`)).toBeInTheDocument();
    expect(tile('Total')).toHaveTextContent('2');
  });

  it('a range ending before it starts keeps reading the start year only', async () => {
    const api = open(VIEWER, { entries: [entry('e1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    // The control refuses an inverted range, so this exercises the page guard via a cleared end.
    fireEvent.change(screen.getByLabelText('PM schedule to date'), { target: { value: '' } });
    await waitFor(() => expect(entryReads(api).every((r) => r.query.get('year') === String(Y))).toBe(true));
  });

  it('the AHU filter list expands when the role may see it, and pages past the first page size', async () => {
    const many = Array.from({ length: 12 }, (_, i) => entry(`m${i}`, { plannedDate: day(10 + (i % 10)) }));
    open(VIEWER, {
      entries: many,
      instances: [{ id: 'f1', name: 'FLT-A', parentId: 'ahu-1' }, { id: 'f2', name: 'FLT-B', parentId: 'ahu-1' }, { id: 'x', name: 'ELSE', parentId: 'ahu-9' }],
    });
    // The toggle sits on every row of the AHU group; the list opens under the first.
    const toggles = await screen.findAllByRole('button', { name: '2 filters ▸' });
    expect(toggles).toHaveLength(10);
    fireEvent.click(toggles[3]);
    expect(screen.getByText('FLT-A')).toBeInTheDocument();
    expect(screen.getByText('FLT-B')).toBeInTheDocument();
    expect(screen.queryByText('ELSE')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '2 filters ▾' })[0]);
    expect(screen.queryByText('FLT-A')).toBeNull();
    // 10 per page (first configured option): serials 11-12 are on page 2.
    expect(screen.getAllByRole('row')).toHaveLength(11);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('11', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('12', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    fireEvent.change(screen.getByRole('combobox', { name: /Rows/ }), { target: { value: '25' } });
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(13));
  });

  it('the filter list stays hidden when the role is not enabled for it', async () => {
    open(VIEWER, {
      entries: [entry('e1')], instances: [{ id: 'f1', name: 'FLT-A', parentId: 'ahu-1' }],
      extra: [{ path: '/api/config/pm-schedule-filters/current', body: { enabled: false } }],
    });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: /filters ▸/ })).toBeNull();
  });
});

describe('PM list — review step (workflow ON)', () => {
  const pendingReview = (over = {}) => entry('r1', { approvalStatus: 'PENDING_REVIEW', approvedByName: null, ...over });

  it('the configured reviewer sends an entry on to approval', async () => {
    const api = open(REVIEWER, { entries: [pendingReview()], extra: [{ method: 'POST', path: '/api/pm-schedules/entries/review', body: { ok: true } }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Review ✓' }));
    await okDialog('Reviewed', '1 entry(s) sent for approval');
    expect(api.calls('POST', '/api/pm-schedules/entries/review')[0].json).toEqual({ entryIds: ['r1'], action: 'approve' });
    // (The re-read after it goes through swr's GLOBAL mutate: see the globalCache test below.)
  });

  it('after a decision the list and the pending counts are re-read (global mutate, global SWR cache)', async () => {
    await clearGlobalSwrCache();
    const api = pmApi({ entries: [pendingReview()], extra: [{ method: 'POST', path: '/api/pm-schedules/entries/review', body: { ok: true } }] });
    renderPage(<PmScheduleListPage />, { user: REVIEWER, api, globalCache: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Review ✓' }));
    await okDialog('Reviewed');
    await waitFor(() => expect(entryReads(api).length).toBeGreaterThan(1));
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/entries/pending-counts').length).toBeGreaterThan(1));
  });

  it('the reviewer also reviews a legacy PENDING entry, but never sees Approve', async () => {
    open(REVIEWER, { entries: [entry('p1', { approvalStatus: 'PENDING', approvedByName: null })] });
    expect(await screen.findByRole('button', { name: 'Review ✓' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('PM_REVIEW alone is not enough when the workflow names another role', async () => {
    open({ ...REVIEWER, role: 'SUPERVISOR' }, { entries: [pendingReview()] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: 'Review ✓' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('reject at review needs 3+ characters and posts to the review endpoint', async () => {
    const api = open(REVIEWER, { entries: [pendingReview()], extra: [{ method: 'POST', path: '/api/pm-schedules/entries/review', body: { ok: true } }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dlg = rejectDlg();
    expect(dlg).toHaveTextContent('Reject 1 Entry(s)');
    const submit = within(dlg).getByRole('button', { name: 'Reject' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dlg).getByPlaceholderText(/Why are these entries being rejected/), { target: { value: 'ab' } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dlg).getByPlaceholderText(/Why are these entries being rejected/), { target: { value: '  Wrong AHU  ' } });
    fireEvent.click(submit);
    await okDialog('Rejected', '1 entry(s) rejected');
    expect(api.calls('POST', '/api/pm-schedules/entries/review')[0].json).toEqual({ entryIds: ['r1'], action: 'reject', remarks: 'Wrong AHU' });
    expect(screen.queryByRole('heading', { name: /Reject 1 Entry/ })).toBeNull();
  });

  it('Cancel closes the reject dialog without a request', async () => {
    const api = open(REVIEWER, { entries: [pendingReview()] });
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: /Reject 1 Entry/ })).toBeNull();
    expect(api.calls('POST', /\/entries\/(review|reject)$/)).toHaveLength(0);
  });

  it('Modify on a date change under review starts from the PROPOSED date and tolerance, and PUTs review-edit', async () => {
    const api = open(REVIEWER, {
      entries: [pendingReview({ pendingPlannedDate: day(19), pendingToleranceDays: 3 })],
      extra: [{ method: 'PUT', path: '/api/pm-schedules/entries/r1/review-edit', body: { ok: true } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Modify' }));
    const row = screen.getByRole('button', { name: 'Save' }).closest('tr') as HTMLElement;
    expect(row.querySelector('input[type="date"]')).toHaveValue(shown(19));
    expect(within(row).getByPlaceholderText('5')).toHaveValue(3);
    fireEvent.change(row.querySelector('input[type="date"]')!, { target: { value: shown(17) } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await okDialog('Modified', 'Schedule updated (still awaiting review approval)');
    expect(api.calls('PUT', '/api/pm-schedules/entries/r1/review-edit')[0].json).toEqual({ plannedDate: shown(17), toleranceDays: 3 });
  });

  it('Modify on a fresh entry starts from its own date; a blank tolerance is not sent; a blank date disables Save', async () => {
    const api = open(REVIEWER, {
      entries: [pendingReview()],
      extra: [{ method: 'PUT', path: '/api/pm-schedules/entries/r1/review-edit', status: 409, body: { error: 'PM_VISIT_OVERLAP', message: 'Overlaps the previous visit' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Modify' }));
    const row = screen.getByRole('button', { name: 'Save' }).closest('tr') as HTMLElement;
    const date = row.querySelector('input[type="date"]') as HTMLInputElement;
    expect(date).toHaveValue(shown(15));
    fireEvent.change(within(row).getByPlaceholderText('5'), { target: { value: '' } });
    fireEvent.change(date, { target: { value: '' } });
    expect(within(row).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(date, { target: { value: shown(16) } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await okDialog('Error', 'Overlaps the previous visit');
    expect(api.calls('PUT', '/api/pm-schedules/entries/r1/review-edit')[0].json).toEqual({ plannedDate: shown(16) });
    // Still editing after a refusal; Cancel leaves edit mode.
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument();
  });

  it('an entry the reviewer submitted is not selectable for a bulk run', async () => {
    open(REVIEWER, { entries: [pendingReview({ submittedByName: 'mgr1' }), entry('r2', { approvalStatus: 'PENDING_REVIEW', plannedDate: day(12) })] });
    await screen.findAllByRole('button', { name: 'Review ✓' });
    // One selectable row (r2) + the header checkbox.
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(rowWith(shown(15)).querySelector('input[type="checkbox"]')).toBeNull();
    expect(rowWith(shown(12)).querySelector('input[type="checkbox"]')).not.toBeNull();
  });
});

describe('PM list — approval step', () => {
  const pendingApproval = (id: string, over = {}) => entry(id, { approvalStatus: 'PENDING_APPROVAL', approvedByName: null, reviewedByName: 'mgr1', ...over });

  it('the configured approver approves; a server error is reported', async () => {
    const api = open(APPROVER, {
      entries: [pendingApproval('a1')],
      extra: [
        { method: 'POST', path: '/api/pm-schedules/entries/approve', status: 409, times: 1, body: { error: 'PM_VISIT_OVERLAP', message: 'Overlap with 12th' } },
        { method: 'POST', path: '/api/pm-schedules/entries/approve', body: { ok: true } },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await okDialog('Error', 'Overlap with 12th');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await okDialog('Approved', '1 entry(s) approved');
    expect(api.calls('POST', '/api/pm-schedules/entries/approve').map((r) => r.json)).toEqual([{ entryIds: ['a1'] }, { entryIds: ['a1'] }]);
  });

  it('D2: rejecting a DATE CHANGE says the visit stays approved; a plain entry says it was rejected', async () => {
    const api = open(APPROVER, {
      entries: [
        pendingApproval('chg', { pendingPlannedDate: day(19), plannedDate: day(14) }),
        pendingApproval('new', { plannedDate: day(12) }),
      ],
      extra: [{ method: 'POST', path: '/api/pm-schedules/entries/reject', body: { ok: true } }],
    });
    await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(within(rowWith(shown(14))).getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(rejectDlg()).getByPlaceholderText(/required/), { target: { value: 'Keep the old date' } });
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Reject' }));
    await okDialog('Rejected', '1 date change(s) rejected; those visits stay approved on their current date.');
    expect(api.calls('POST', '/api/pm-schedules/entries/reject')[0].json).toEqual({ entryIds: ['chg'], remarks: 'Keep the old date' });

    // Both at once: the toast names each outcome.
    fireEvent.click(screen.getByTitle('Select every entry waiting on your step'));
    fireEvent.click(screen.getByRole('button', { name: 'Reject (2)' }));
    fireEvent.change(within(rejectDlg()).getByPlaceholderText(/required/), { target: { value: 'Whole batch wrong' } });
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Reject' }));
    await okDialog('Rejected', '1 entry(s) rejected. 1 date change(s) rejected; those visits stay approved on their current date.');
  });

  it('a rejection refused by the server keeps the dialog open', async () => {
    open(APPROVER, {
      entries: [pendingApproval('a1')],
      extra: [{ method: 'POST', path: '/api/pm-schedules/entries/reject', status: 403, body: { error: 'SELF_APPROVAL_FORBIDDEN', message: 'You reviewed it' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    fireEvent.change(within(rejectDlg()).getByPlaceholderText(/required/), { target: { value: 'nope nope' } });
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Reject' }));
    await okDialog('Error', 'You reviewed it');
    expect(within(rejectDlg()).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('an entry the approver reviewed (or submitted) is not selectable', async () => {
    open(APPROVER, { entries: [pendingApproval('mine', { reviewedByName: 'qa1' }), pendingApproval('up', { submittedByName: 'qa1', plannedDate: day(13) }), pendingApproval('ok', { plannedDate: day(12) })] });
    await screen.findAllByRole('button', { name: 'Approve' });
    expect(rowWith(shown(15)).querySelector('input[type="checkbox"]')).toBeNull();
    expect(rowWith(shown(13)).querySelector('input[type="checkbox"]')).toBeNull();
    expect(rowWith(shown(12)).querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it('workflow OFF: a PM_APPROVE holder approves legacy PENDING entries whatever their role', async () => {
    open({ ...APPROVER, role: 'MANAGER' }, { wf: WF_OFF, entries: [entry('p1', { approvalStatus: 'PENDING', approvedByName: null })] });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review ✓' })).toBeNull();
  });

  it('workflow ON: PM_APPROVE without the approval role gets nothing', async () => {
    open({ ...APPROVER, role: 'MANAGER' }, { entries: [pendingApproval('a1')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('with the approve row on, the password signs the request', async () => {
    const api = open(APPROVER, {
      entries: [pendingApproval('a1')], reauthActions: ['APPROVE_PM_SCHEDULE'],
      extra: [{ method: 'POST', path: '/api/pm-schedules/entries/approve', body: { ok: true } }],
    });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await passReauth();
    await okDialog('Approved');
    expectSigned(api.calls('POST', '/api/pm-schedules/entries/approve')[0]);
  });
});

describe('PM list — bulk (Super Admin is reviewer and approver)', () => {
  it('a mixed selection offers both steps; each posts only the ids waiting on that step', async () => {
    const api = open(SA, {
      entries: [
        entry('rv', { approvalStatus: 'PENDING_REVIEW', plannedDate: day(12) }),
        entry('ap', { approvalStatus: 'PENDING_APPROVAL', plannedDate: day(13) }),
        entry('done', { approvalStatus: 'APPROVED', plannedDate: day(14) }),
      ],
      extra: [
        { method: 'POST', path: '/api/pm-schedules/entries/review', body: { ok: true } },
        { method: 'POST', path: '/api/pm-schedules/entries/approve', body: { ok: true } },
        { method: 'POST', path: '/api/pm-schedules/entries/reject', body: { ok: true } },
      ],
    });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    const all = screen.getByTitle('Select every entry waiting on your step');
    fireEvent.click(all);
    expect(await screen.findByText('entries selected')).toBeInTheDocument();
    expect(all).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Review selected (1)' }));
    await okDialog('Reviewed', '1 entry(s) sent for approval');
    expect(api.calls('POST', '/api/pm-schedules/entries/review')[0].json).toEqual({ entryIds: ['rv'], action: 'approve' });

    fireEvent.click(all);
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (1)' }));
    await okDialog('Approved', '1 entry(s) approved');
    expect(api.calls('POST', '/api/pm-schedules/entries/approve')[0].json).toEqual({ entryIds: ['ap'] });

    fireEvent.click(all);
    fireEvent.click(screen.getByRole('button', { name: 'Reject at review (1)' }));
    expect(rejectDlg()).toHaveTextContent('Reject 1 Entry(s)');
    fireEvent.change(within(rejectDlg()).getByPlaceholderText(/required/), { target: { value: 'not needed' } });
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Reject' }));
    await okDialog('Rejected');
    expect(api.calls('POST', '/api/pm-schedules/entries/review').at(-1)!.json).toEqual({ entryIds: ['rv'], action: 'reject', remarks: 'not needed' });
  });

  it('single row ticks build the selection; Select all on a full selection and Clear both empty it', async () => {
    open(SA, { entries: [entry('rv', { approvalStatus: 'PENDING_REVIEW', plannedDate: day(12) }), entry('ap', { approvalStatus: 'PENDING_APPROVAL', plannedDate: day(13) })] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    const rowBox = rowWith(shown(12)).querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(rowBox);
    expect(rowBox).toBeChecked();
    expect(screen.getByRole('button', { name: 'Review selected (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve selected/ })).toBeNull();
    fireEvent.click(rowBox);
    expect(screen.queryByText('entries selected')).toBeNull();
    const all = screen.getByTitle('Select every entry waiting on your step');
    fireEvent.click(all);
    fireEvent.click(all);
    expect(screen.queryByText('entries selected')).toBeNull();
    fireEvent.click(all);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('entries selected')).toBeNull();
  });

  it('with nothing waiting on the viewer, the header checkbox is disabled', async () => {
    open(SA, { entries: [entry('done')] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.getByTitle('Select every entry waiting on your step')).toBeDisabled();
  });
});

describe('PM list — edit an approved entry / resubmit a rejected one', () => {
  it('Edit stages a change: PUT edit with the new date + tolerance; the toast names the review route', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], extra: [{ method: 'PUT', path: '/api/pm-schedules/entries/e1/edit', body: { ok: true } }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const row = screen.getByRole('button', { name: 'Save' }).closest('tr') as HTMLElement;
    fireEvent.change(row.querySelector('input[type="date"]')!, { target: { value: shown(16) } });
    fireEvent.change(within(row).getByPlaceholderText('5'), { target: { value: '7' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    await okDialog('Edit Submitted', 'Change sent for review by MANAGER. The current date stays active until the change is approved.');
    expect(api.calls('PUT', '/api/pm-schedules/entries/e1/edit')[0].json).toEqual({ plannedDate: shown(16), toleranceDays: 7 });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('an approved entry that already has a change pending offers no second Edit', async () => {
    open(EDITOR, { entries: [entry('e1', { pendingPlannedDate: day(18) })] });
    await screen.findAllByRole('link', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('an edit refused by the server is reported; with the row on the edit is signed', async () => {
    const api = open(EDITOR, {
      entries: [entry('e1')], reauthActions: ['EDIT_PM_SCHEDULE'],
      extra: [
        { method: 'PUT', path: '/api/pm-schedules/entries/e1/edit', status: 409, times: 1, body: { error: 'PM_VISIT_OVERLAP', message: 'Overlaps' } },
        { method: 'PUT', path: '/api/pm-schedules/entries/e1/edit', body: { ok: true } },
      ],
    });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await passReauth();
    await okDialog('Error', 'Overlaps');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await passReauth();
    await okDialog('Edit Submitted');
    const puts = api.calls('PUT', '/api/pm-schedules/entries/e1/edit');
    expect(puts).toHaveLength(2);
    expectSigned(puts[1]);
  });

  it('Resubmit a rejected entry: POST resubmit with the corrected date; workflow ON says who reviews it', async () => {
    const api = open(EDITOR, {
      entries: [entry('x1', { approvalStatus: 'REJECTED', approvalRemarks: 'Clashes', rejectedByName: 'qa2', rejectedAt: day(11), rejectionStage: 'APPROVAL' })],
      extra: [
        reauthOnce('POST', '/api/pm-schedules/entries/x1/resubmit'),
        { method: 'POST', path: '/api/pm-schedules/entries/x1/resubmit', body: { ok: true } },
      ],
    });
    expect(await screen.findByText(`Rejected at approval by qa2 on ${shown(11)} 06:00`, { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit' }));
    const row = screen.getByRole('button', { name: 'Save' }).closest('tr') as HTMLElement;
    fireEvent.change(row.querySelector('input[type="date"]')!, { target: { value: shown(17) } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    // The server asked for a password the config had not (stale) -> retroactive prompt.
    await passReauth();
    await okDialog('Re-submitted', 'Entry sent for review by MANAGER.');
    const posts = api.calls('POST', '/api/pm-schedules/entries/x1/resubmit');
    expect(posts[1].json).toMatchObject({ plannedDate: shown(17), toleranceDays: 5 });
    expectSigned(posts[1]);
  });

  it('a resubmit the server refuses is reported', async () => {
    open(EDITOR, {
      entries: [entry('x1', { approvalStatus: 'REJECTED' })],
      extra: [{ method: 'POST', path: '/api/pm-schedules/entries/x1/resubmit', status: 400, body: { error: 'BAD', message: 'Date in the past' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Resubmit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await okDialog('Error', 'Date in the past');
  });

  it('cancelling the password prompt leaves the row in edit mode with nothing sent', async () => {
    const api = open(EDITOR, { entries: [entry('e1')], reauthActions: ['EDIT_PM_SCHEDULE'] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByPlaceholderText('Enter your password');
    const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    // A dismissed prompt is not an error: no message at all (D-OPS-8).
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(api.calls('PUT', /\/edit$/)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('PM list — every decision is signed when its re-auth row is on', () => {
  const signedOpen = async (user: any, entries: any[], reauthActions: string[], extra: any[]) => {
    const api = open(user, { entries, reauthActions, extra });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await screen.findAllByRole('link', { name: 'AHU-01' });
    return api;
  };

  it('review and reject-at-review sign with REVIEW_PM_SCHEDULE; Modify too', async () => {
    const api = await signedOpen(REVIEWER, [entry('r1', { approvalStatus: 'PENDING_REVIEW' })], ['REVIEW_PM_SCHEDULE'], [
      { method: 'POST', path: '/api/pm-schedules/entries/review', body: { ok: true } },
      { method: 'PUT', path: '/api/pm-schedules/entries/r1/review-edit', body: { ok: true } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Review ✓' }));
    await passReauth();
    await okDialog('Reviewed');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(rejectDlg()).getByPlaceholderText(/required/), { target: { value: 'Wrong date' } });
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Reject' }));
    await passReauth();
    await okDialog('Rejected');
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await passReauth();
    await okDialog('Modified');
    const reviews = api.calls('POST', '/api/pm-schedules/entries/review');
    expect(reviews.map((r) => r.json.action)).toEqual(['approve', 'reject']);
    reviews.forEach((r) => expectSigned(r));
    expectSigned(api.calls('PUT', '/api/pm-schedules/entries/r1/review-edit')[0]);
  });

  it('reject at approval signs with REJECT_PM_SCHEDULE', async () => {
    const api = await signedOpen(APPROVER, [entry('a1', { approvalStatus: 'PENDING_APPROVAL' })], ['REJECT_PM_SCHEDULE'], [
      { method: 'POST', path: '/api/pm-schedules/entries/reject', body: { ok: true } },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(within(rejectDlg()).getByPlaceholderText(/required/), { target: { value: 'Clashes with audit' } });
    fireEvent.click(within(rejectDlg()).getByRole('button', { name: 'Reject' }));
    await passReauth();
    await okDialog('Rejected', '1 entry(s) rejected');
    expectSigned(api.calls('POST', '/api/pm-schedules/entries/reject')[0]);
  });

  it('Super Admin delete signs with DELETE_PM_SCHEDULE', async () => {
    const api = await signedOpen(SA, [entry('e1')], ['DELETE_PM_SCHEDULE'], [{ method: 'DELETE', path: '/api/pm-schedules/s1', status: 204 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule for AHU-01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete schedule' }));
    await passReauth();
    await okDialog('Deleted');
    expectSigned(api.calls('DELETE', '/api/pm-schedules/s1')[0]);
  });
});

describe('PM list — wording when the workflow names no role', () => {
  it('review / approval roles left blank: the upload hint and the edit toast name no role', async () => {
    open(EDITOR, { wf: { workflowEnabled: true, reviewRole: ' ', approvalRole: '' }, entries: [entry('e1')], extra: [{ method: 'PUT', path: '/api/pm-schedules/entries/e1/edit', body: { ok: true } }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    expect(screen.getByText(/CSV or XLSX • max 5 MB • entries go to review, then approval$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await okDialog('Edit Submitted', 'Change sent for review. The current date stays active until the change is approved.');
  });

  it('workflow config unreadable: the upload hint makes no specific claim', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(EDITOR, { entries: [entry('e1')], extra: [{ path: '/api/pm-schedules/workflow-config', status: 500, body: { error: 'X', message: 'cfg' } }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Schedule' }));
    expect(screen.getByText(/entries go through the PM approval workflow$/)).toBeInTheDocument();
  });
});

describe('PM list — load errors', () => {
  it('a failed entries read is an error with Retry, not an empty table', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(VIEWER, { extra: [{ path: '/api/pm-schedules/entries', status: 500, body: { error: 'X', message: 'db down' } }] });
    const alert = (await screen.findAllByRole('alert')).find((a) => /Could not load PM schedule entries/.test(a.textContent ?? ''))!;
    expect(alert).toHaveTextContent('db down');
    expect(screen.queryByText('No schedule entries found')).toBeNull();
    const before = api.calls('GET', '/api/pm-schedules/entries').length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/entries').length).toBeGreaterThan(before));
  });

  it('a failed entries read with no message still explains itself', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(VIEWER, { extra: [{ path: '/api/pm-schedules/entries', status: 502, body: { message: '' } }] });
    const alert = (await screen.findAllByRole('alert')).find((a) => /Could not load PM schedule entries/.test(a.textContent ?? ''))!;
    expect(alert).toHaveTextContent('The server did not answer.');
  });

  it('a failed workflow-config read hides Review / Approve and offers Retry', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(SA, {
      entries: [entry('rv', { approvalStatus: 'PENDING_REVIEW' })],
      extra: [{ path: '/api/pm-schedules/workflow-config', status: 500, body: { error: 'X', message: 'cfg down' } }],
    });
    const alert = (await screen.findAllByRole('alert')).find((a) => /workflow settings/.test(a.textContent ?? ''))!;
    expect(screen.queryByRole('button', { name: 'Review ✓' })).toBeNull();
    const before = api.calls('GET', '/api/pm-schedules/workflow-config').length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/workflow-config').length).toBeGreaterThan(before));
  });
});

