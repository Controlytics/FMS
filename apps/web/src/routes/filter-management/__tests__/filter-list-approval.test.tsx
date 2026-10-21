import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, role, passReauth, expectSigned, reauthOnce, allowConsoleError } from './fm-test-kit';
import { setupApi, renderFilters, openFiltersTab, row, cancelReauth, waitForReauthConfig, makeTree, F, ADMIN_ALL } from './filter-list-fixtures';

usePageTestLifecycle();

const REVIEWER = role('MANAGER', ['ASSET_READ', 'FILTER_REVIEW']);
const APPROVER = role('QA', ['ASSET_READ', 'FILTER_APPROVE']);
const dlg = () => screen.getByTestId('filter-approval-dialog');
const bulk = () => screen.getByTestId('filter-bulk-approval-dialog');

const DETAIL_F3 = {
  id: 'f3', approvalStatus: 'PENDING_REVIEW', attributes: { filterType: 'HEPA', pressureDrop: 120, vendor: 'Acme', note: '' },
  template: { attributeSchema: [{ fieldName: 'pressureDrop', unit: 'Pa' }, { fieldName: 'filterType' }] },
  submittedByName: 'Op One', submittedAt: '2026-10-20T08:00:00Z',
  identifiers: [{ identifierType: 'RFID', identifierValue: 'E2003333' }],
};

describe('Filters page — single review / approve / reject', () => {
  it('a reviewer completes the review from the row: details shown, POST /review with the filter id and remarks', async () => {
    const api = setupApi({ extra: [
      { path: '/api/assets/instances/f3', body: DETAIL_F3 },
      { method: 'POST', path: '/api/assets/instances/review', body: { updated: 1 } },
    ] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    expect(within(row('PF-004')).queryByRole('button', { name: 'Approve' })).toBeNull(); // not this role's step
    fireEvent.click(within(row('PF-003')).getByRole('button', { name: 'Review' }));
    const d = dlg();
    expect(within(d).getByRole('heading', { name: 'Review Filter' })).toBeInTheDocument();
    expect(d).toHaveTextContent('Block Alpha');
    expect(d).toHaveTextContent('Area North');
    expect(await within(d).findByText('Op One')).toBeInTheDocument();
    expect(d).toHaveTextContent('Pressure Drop');
    expect(d).toHaveTextContent('120 Pa');
    expect(d).toHaveTextContent('Acme');
    expect(d).toHaveTextContent('E2003333'); // RFID from the detail record
    fireEvent.change(within(d).getByPlaceholderText('Anything the approver should know'), { target: { value: ' Checked label ' } });
    fireEvent.click(within(d).getByRole('button', { name: 'Complete Review' }));
    expect(await screen.findByText('PF-003 reviewed')).toBeInTheDocument();
    expect(screen.getByText('Sent for approval.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/review')[0].json).toEqual({ filterIds: ['f3'], remarks: 'Checked label' });
    expect(screen.queryByTestId('filter-approval-dialog')).toBeNull();
  });

  it('an approver approves (no remarks → no remarks key); "It can now be cleaned."', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/approve', body: {} }] });
    renderFilters(APPROVER, api);
    await openFiltersTab();
    expect(within(row('PF-003')).queryByRole('button', { name: 'Review' })).toBeNull();
    fireEvent.click(within(row('PF-004')).getByRole('button', { name: 'Approve' }));
    expect(within(dlg()).getByRole('heading', { name: 'Approve Filter' })).toBeInTheDocument();
    expect(await within(dlg()).findByText('No workflow history recorded.')).toBeInTheDocument();
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('It can now be cleaned.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/approve')[0].json).toEqual({ filterIds: ['f4'] });
  });

  it('reject needs a reason; Back returns to the decision; Confirm Reject POSTs /reject', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/reject', body: {} }] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-003')).getByRole('button', { name: 'Review' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Reject…' }));
    const confirm = within(dlg()).getByRole('button', { name: 'Confirm Reject' });
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Back' }));
    expect(within(dlg()).getByRole('button', { name: 'Complete Review' })).toBeInTheDocument();
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Reject…' }));
    fireEvent.change(within(dlg()).getByPlaceholderText(/Why this filter is being rejected/), { target: { value: 'Wrong micron size' } });
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Confirm Reject' }));
    expect(await screen.findByText('PF-003 rejected')).toBeInTheDocument();
    expect(screen.getByText('It stays in the list as Rejected until corrected and resubmitted.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/reject')[0].json).toEqual({ filterIds: ['f3'], remarks: 'Wrong micron size' });
  });

  it('a server refusal (same person reviewed) keeps the dialog open and unlocked', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/assets/instances/approve', status: 409, body: { error: 'SAME_PERSON', message: 'The person who reviewed this filter cannot approve it' } }] });
    renderFilters(ADMIN_ALL, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-004')).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('The person who reviewed this filter cannot approve it')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(dlg()).getByRole('button', { name: 'Approve' })).toBeEnabled();
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('filter-approval-dialog')).toBeNull();
  });

  it('review under re-auth: signed retry; a cancelled prompt leaves the dialog open with no error', async () => {
    const api = setupApi({ extra: [reauthOnce('POST', '/api/assets/instances/review'), { method: 'POST', path: '/api/assets/instances/review', body: {} }] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-003')).getByRole('button', { name: 'Review' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Complete Review' }));
    await cancelReauth();
    await waitFor(() => expect(within(dlg()).getByRole('button', { name: 'Complete Review' })).toBeEnabled());
    expect(screen.queryByText(/failed/)).toBeNull();
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Complete Review' }));
    // the server already said REAUTH_REQUIRED once; the second attempt goes straight through
    expect(await screen.findByText('PF-003 reviewed')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/review')).toHaveLength(2);
  });

  it('review gated up front: password prompt, then the POST carries the password', async () => {
    const api = setupApi({ base: { reauthActions: ['REVIEW_FILTER'] }, extra: [{ method: 'POST', path: '/api/assets/instances/review', body: {} }] });
    renderFilters(REVIEWER, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-003')).getByRole('button', { name: 'Review' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Complete Review' }));
    await passReauth();
    await screen.findByText('PF-003 reviewed');
    expectSigned(api.calls('POST', '/api/assets/instances/review')[0]);
  });

  it('the Details eye on an approved row opens a read-only popup; a failed detail load says so', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = setupApi({ extra: [{ path: '/api/assets/instances/f1', status: 500, body: { error: 'X', message: 'Detail lookup failed' } }] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Filter Details'));
    const d = dlg();
    expect(within(d).getByRole('heading', { name: 'Filter Details' })).toBeInTheDocument();
    expect(await within(d).findByText(/Could not load the full record \(Detail lookup failed\)/)).toBeInTheDocument();
    expect(d).toHaveTextContent('Approved filter.');
    expect(d).toHaveTextContent('E200AA');
    expect(d).toHaveTextContent('10 µm');
    expect(within(d).queryByRole('button', { name: /Reject/ })).toBeNull();
    fireEvent.click(within(d).getAllByRole('button', { name: 'Close' }).at(-1)!); // footer Close (the header ✕ shares the name)
    expect(screen.queryByTestId('filter-approval-dialog')).toBeNull();
  });

  it('details of a rejected filter show who rejected it and why', async () => {
    const api = setupApi({ extra: [{ path: '/api/assets/instances/f5', body: {
      approvalStatus: 'REJECTED', rejectedByName: 'QA Lead', rejectedAt: '2026-10-19T09:00:00Z', rejectionRemarks: 'Dimensions missing',
      reviewedByName: 'Mgr', reviewRemarks: 'ok',
    } }] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-005')).getByTitle('Filter Details'));
    const d = dlg();
    expect(await within(d).findByText('QA Lead')).toBeInTheDocument();
    expect(d).toHaveTextContent('“Dimensions missing”');
    expect(d).toHaveTextContent('Rejected. Correct it and resubmit before it can be used.');
  });
});

describe('Filters page — bulk review / approve', () => {
  const twoPending = makeTree({ ahu1Filters: [F.pf1, F.pf3, { ...F.pf3, id: 'f8', name: 'PF-008' }, F.pf4], ahu2Filters: [] });

  it('toolbar Review (n) lists every pending filter with its submitter; untick one; Complete Review (1)', async () => {
    const api = setupApi({ tree: twoPending, extra: [
      { path: '/api/assets/instances/pending-approval', body: { data: [{ id: 'f3', submittedByName: 'Op One', submittedAt: '2026-10-20T08:00:00Z' }] } },
      { method: 'POST', path: '/api/assets/instances/review', body: {} },
    ] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Review (2)' }));
    const b = bulk();
    expect(b).toHaveTextContent('Review Pending Filters');
    expect(b).toHaveTextContent('2 filter(s) waiting for review in this block · 2 selected');
    expect(await within(b).findByText('Op One')).toBeInTheDocument();
    fireEvent.click(within(b).getByRole('checkbox', { name: 'Select PF-008' }));
    expect(b).toHaveTextContent('· 1 selected');
    fireEvent.click(within(b).getByRole('button', { name: 'Complete Review (1)' }));
    expect(await screen.findByText('PF-003 reviewed')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/review')[0].json).toEqual({ filterIds: ['f3'] });
    expect(screen.queryByTestId('filter-bulk-approval-dialog')).toBeNull();
  });

  it('bulk reject of several filters: one reason for all, plural wording', async () => {
    const api = setupApi({ tree: twoPending, extra: [{ method: 'POST', path: '/api/assets/instances/reject', body: {} }] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Review (2)' }));
    const b = bulk();
    // select-all toggle off then on
    fireEvent.click(within(b).getByRole('checkbox', { name: 'Select all' }));
    expect(within(b).getByRole('button', { name: 'Complete Review (0)' })).toBeDisabled();
    fireEvent.click(within(b).getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(within(b).getByRole('button', { name: 'Reject selected (2)…' }));
    fireEvent.change(within(b).getByPlaceholderText(/One reason recorded on every selected filter/), { target: { value: 'Batch has wrong sizes' } });
    fireEvent.click(within(b).getByRole('button', { name: 'Confirm Reject (2)' }));
    expect(await screen.findByText('2 filters rejected')).toBeInTheDocument();
    expect(screen.getByText('They stay in the list as Rejected until corrected and resubmitted.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/reject')[0].json).toEqual({ filterIds: ['f3', 'f8'], remarks: 'Batch has wrong sizes' });
  });

  it('ticked rows → "Approve selected" opens the bulk popup for just those; plural approve wording; the eye opens details', async () => {
    const tree = makeTree({ ahu1Filters: [F.pf1, F.pf4, { ...F.pf4, id: 'f10', name: 'PF-010' }], ahu2Filters: [] });
    const api = setupApi({ tree, extra: [
      { path: '/api/assets/instances/pending-approval', body: { data: [{ id: 'f4', reviewedByName: 'Mgr', reviewedAt: '2026-10-20T09:00:00Z', reviewRemarks: 'Looks right' }] } },
      { method: 'POST', path: '/api/assets/instances/approve', body: {} },
    ] });
    renderFilters(APPROVER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-004')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-010')).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Approve selected (2)' }));
    const b = bulk();
    expect(b).toHaveTextContent('Approve Pending Filters');
    expect(await within(b).findByText('“Looks right”')).toBeInTheDocument();
    // eye → single details popup stacked above
    fireEvent.click(within(b).getAllByTitle('Filter Details')[0]);
    expect(within(dlg()).getByRole('heading', { name: 'Filter Details' })).toBeInTheDocument();
    fireEvent.click(within(dlg()).getAllByRole('button', { name: 'Close' })[0]); // header ✕
    fireEvent.change(within(b).getByPlaceholderText('Approval remarks'), { target: { value: 'Batch OK' } });
    fireEvent.click(within(b).getByRole('button', { name: 'Approve (2)' }));
    expect(await screen.findByText('2 filters approved')).toBeInTheDocument();
    expect(screen.getByText('They can now be cleaned.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/assets/instances/approve')[0].json).toEqual({ filterIds: ['f4', 'f10'], remarks: 'Batch OK' });
    // decided rows left the selection
    expect(screen.queryByText(/filter\(s\) selected/)).toBeNull();
  });

  it('the bulk popup closes with Cancel and refuses to close while a decision is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = setupApi({ tree: twoPending, extra: [{ method: 'POST', path: '/api/assets/instances/review', body: {} }] });
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      if (String(input).includes('/api/assets/instances/review')) await gate;
      return orig(input, init);
    }) as any;
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(screen.getByRole('button', { name: 'Review (2)' }));
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('filter-bulk-approval-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Review (2)' }));
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Complete Review (2)' }));
    expect(await within(bulk()).findByRole('button', { name: 'Completing…' })).toBeDisabled();
    fireEvent.click(within(bulk()).getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('filter-bulk-approval-dialog')).toBeInTheDocument();
    release();
    expect(await screen.findByText('2 filters reviewed')).toBeInTheDocument();
  });
});

describe('Filters page — workflow failure titles name the action', () => {
  const refuse = (kind: string) => ({ method: 'POST', path: `/api/assets/instances/${kind}`, status: 409, body: { error: 'CONFLICT', message: `${kind} refused` } });

  it('a refused review reads "Review failed"', async () => {
    const api = setupApi({ extra: [refuse('review')] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-003')).getByRole('button', { name: 'Review' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Complete Review' }));
    expect(await screen.findByText('review refused')).toBeInTheDocument();
    expect(screen.getByText('Review failed')).toBeInTheDocument();
    expect(screen.queryByText(/Reviewed failed/)).toBeNull();
  });

  it('a refused approval reads "Approval failed"', async () => {
    const api = setupApi({ extra: [refuse('approve')] });
    renderFilters(APPROVER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-004')).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('approve refused')).toBeInTheDocument();
    expect(screen.getByText('Approval failed')).toBeInTheDocument();
  });

  it('a refused rejection reads "Rejection failed"', async () => {
    const api = setupApi({ extra: [refuse('reject')] });
    renderFilters(REVIEWER, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-003')).getByRole('button', { name: 'Review' }));
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Reject…' }));
    fireEvent.change(within(dlg()).getByPlaceholderText(/Why this filter is being rejected/), { target: { value: 'Wrong micron size' } });
    fireEvent.click(within(dlg()).getByRole('button', { name: 'Confirm Reject' }));
    expect(await screen.findByText('reject refused')).toBeInTheDocument();
    expect(screen.getByText('Rejection failed')).toBeInTheDocument();
  });
});
