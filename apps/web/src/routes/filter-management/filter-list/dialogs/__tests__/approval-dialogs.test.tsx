import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { usePageTestLifecycle, allowConsoleError } from '../../../__tests__/fm-test-kit';
import { FilterApprovalDialog, type ApprovalDialogFilter } from '../FilterApprovalDialog';
import { FilterBulkApprovalDialog } from '../FilterBulkApprovalDialog';

usePageTestLifecycle();

const fmt = (v: string | Date) => `fmt(${String(v)})`;

const F1: ApprovalDialogFilter = {
  id: 'f1', name: 'FLT-001', approvalStatus: 'PENDING_REVIEW', blockName: 'Block A', areaName: null, ahuName: 'AHU-1', ahuType: 'Supply',
  filterType: 'HEPA', micronSize: '0.3', filterSize: '610x610', filterSet: 'SET_A', currentState: 'WASH_IN', rfid: null, lastCleanedAt: '2026-10-01T10:00:00Z',
};

/** Value cell next to a Row label. */
const rowValue = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement;

describe('FilterApprovalDialog — view mode', () => {
  it('paints the row data, then the full record: status, other fields with units, RFID from identifiers, workflow attribution', async () => {
    const api = mockApi([{ path: '/api/assets/instances/f1', body: {
      approvalStatus: 'APPROVED',
      attributes: { filterType: 'HEPA', airFlow: 1200, gasket: { material: 'PU' }, strayKey: 'x', emptyOne: '', snake_case_key: 'v' },
      template: { attributeSchema: [{ fieldName: 'airFlow', unit: 'CFM' }, { fieldName: 'pressureDrop', unit: 'Pa' }, { fieldName: 'filterType' }] },
      identifiers: [{ identifierType: 'BARCODE', identifierValue: 'BC-1' }, { identifierType: 'RFID', identifierValue: 'E200FROMDETAIL' }],
      submittedByName: 'Op One', submittedAt: '2026-09-01T00:00:00Z',
      reviewedByName: 'Mgr Two', reviewedAt: '2026-09-02T00:00:00Z', reviewRemarks: 'Looks right',
      approvedByName: 'QA Three', approvedAt: '2026-09-03T00:00:00Z', approvalRemarks: null,
      rejectedByName: null, rejectedAt: null,
    } }]);
    const onClose = vi.fn();
    renderPage(<FilterApprovalDialog filter={F1} mode="view" canReject submitting={false} formatDateTime={fmt} onClose={onClose} onComplete={vi.fn()} onReject={vi.fn()} />, { api });

    expect(screen.getByRole('heading', { name: 'Filter Details' })).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    // Row data straight from the list
    expect(rowValue('Block')).toHaveTextContent('Block A');
    expect(rowValue('Area')).toHaveTextContent('--');
    expect(rowValue('Micron Size')).toHaveTextContent('0.3 µm');
    expect(rowValue('Set')).toHaveTextContent('Set A');
    expect(rowValue('Cleaning Status')).toHaveTextContent('WASH IN');
    expect(rowValue('Last Cleaned')).toHaveTextContent('fmt(2026-10-01T10:00:00Z)');

    // Full record arrives
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/Approved filter\. The workflow record below/)).toBeInTheDocument();
    expect(rowValue('RFID Tag')).toHaveTextContent('E200FROMDETAIL');
    expect(screen.getByText('Other Fields')).toBeInTheDocument();
    expect(rowValue('Air Flow')).toHaveTextContent('1200 CFM');
    expect(rowValue('Pressure Drop')).toHaveTextContent('--'); // declared in schema, no value
    expect(rowValue('Gasket')).toHaveTextContent('{"material":"PU"}');
    expect(rowValue('Stray Key')).toHaveTextContent('x');
    expect(rowValue('Empty One')).toHaveTextContent('--');
    expect(rowValue('Snake case key')).toHaveTextContent('v');
    expect(screen.getAllByText('Filter Type')).toHaveLength(1); // a SHOWN attribute is not repeated under Other Fields
    // Workflow attribution
    const submitted = screen.getByText('Submitted by').parentElement!;
    expect(submitted).toHaveTextContent('Op One · fmt(2026-09-01T00:00:00Z)');
    const reviewed = screen.getByText('Reviewed by').closest('div')!.parentElement!;
    expect(reviewed).toHaveTextContent('“Looks right”');
    expect(screen.getByText('Approved by').parentElement!).toHaveTextContent('QA Three');
    expect(screen.queryByText('Rejected by')).toBeNull();
    // view mode has no decision controls
    expect(screen.queryByRole('button', { name: /Complete Review|Approve|Reject/ })).toBeNull();
    const closes = screen.getAllByRole('button', { name: 'Close' }); // header X + footer
    expect(closes).toHaveLength(2);
    closes.forEach((b) => fireEvent.click(b));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(api.unmatched).toEqual([]);
  });

  it('a rejected filter explains how to proceed and shows who rejected it and why', async () => {
    const api = mockApi([{ path: '/api/assets/instances/f1', body: {
      approvalStatus: 'REJECTED', rejectedByName: 'QA Three', rejectedAt: '2026-09-04T00:00:00Z', rejectionRemarks: 'Wrong AHU',
    } }]);
    renderPage(<FilterApprovalDialog filter={{ ...F1, filterSet: 'SET_B', micronSize: '-', rfid: 'E200ROW', currentState: null, lastCleanedAt: null }} mode="view" canReject={false} submitting={false} formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api });
    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Rejected. Correct it and resubmit before it can be used.')).toBeInTheDocument();
    expect(screen.getByText('Rejected by').closest('div')!.parentElement!).toHaveTextContent('QA Three · fmt(2026-09-04T00:00:00Z)“Wrong AHU”');
    expect(rowValue('Set')).toHaveTextContent('Set B');
    expect(rowValue('Micron Size')).toHaveTextContent('--');
    expect(rowValue('RFID Tag')).toHaveTextContent('E200ROW'); // the row's own tag wins
    expect(rowValue('Cleaning Status')).toHaveTextContent('To Be Cleaned');
    expect(rowValue('Last Cleaned')).toHaveTextContent('NA');
    expect(screen.queryByText('Other Fields')).toBeNull();
  });

  it('a workflow step with a date but no recorded name shows a dash for the name', async () => {
    const api = mockApi([{ path: '/api/assets/instances/f1', body: { approvalStatus: 'PENDING_APPROVAL', reviewedByName: 'Mgr Two', submittedAt: '2026-09-01T00:00:00Z' } }]);
    renderPage(<FilterApprovalDialog filter={F1} mode="view" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api });
    expect(await screen.findByText('Pending Approval')).toBeInTheDocument();
    expect(screen.getByText('Submitted by').parentElement!).toHaveTextContent('-- · fmt(2026-09-01T00:00:00Z)');
    expect(screen.getByText('Reviewed by').parentElement!).toHaveTextContent('Mgr Two');
    expect(screen.queryByText('No workflow history recorded.')).toBeNull();
  });

  it('a pending filter with no workflow rows says "No workflow history recorded"; an unknown status shows raw', async () => {
    const api = mockApi([{ path: '/api/assets/instances/f1', body: { approvalStatus: 'ON_HOLD', attributes: {} } }]);
    renderPage(<FilterApprovalDialog filter={{ ...F1, filterSet: 'SET_X' }} mode="view" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api });
    expect(await screen.findByText('No workflow history recorded.')).toBeInTheDocument();
    expect(screen.getByText('ON_HOLD')).toBeInTheDocument();
    expect(screen.getByText(/in the creation workflow and cannot be operated yet/)).toBeInTheDocument();
    expect(rowValue('Set')).toHaveTextContent('SET_X');
  });

  it('when the full record cannot be loaded it says so and still shows the list data', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = mockApi([{ path: '/api/assets/instances/f1', status: 500, body: { error: 'INTERNAL', message: 'db timeout' } }]);
    renderPage(<FilterApprovalDialog filter={F1} mode="view" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api });
    expect(await screen.findByText(/Could not load the full record \(db timeout\)\. Showing the list data only\./)).toBeInTheDocument();
    expect(screen.getByText('Unavailable.')).toBeInTheDocument();
    expect(screen.getByText('Pending Review')).toBeInTheDocument();
    expect(rowValue('AHU')).toHaveTextContent('AHU-1');
  });
});

describe('FilterApprovalDialog — decisions', () => {
  const okDetail = () => mockApi([{ path: '/api/assets/instances/f1', body: { approvalStatus: 'PENDING_REVIEW', submittedByName: 'Op One', submittedAt: '2026-09-01T00:00:00Z' } }]);

  it('review: remarks are required (Complete Review stays disabled until they are typed), then sent trimmed', async () => {
    const onComplete = vi.fn();
    renderPage(<FilterApprovalDialog filter={F1} mode="review" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onComplete={onComplete} onReject={vi.fn()} />, { api: okDetail() });
    expect(screen.getByRole('heading', { name: 'Review Filter' })).toBeInTheDocument();
    expect(screen.getByText(/complete the review to send this filter for approval/)).toBeInTheDocument();
    await screen.findByText('Op One', { exact: false });
    const complete = screen.getByRole('button', { name: 'Complete Review' });
    expect(complete).toBeDisabled();
    expect(screen.getByLabelText(/^Remarks/)).toBeRequired();
    fireEvent.change(screen.getByPlaceholderText('Anything the approver should know'), { target: { value: '   ' } });
    expect(complete).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Anything the approver should know'), { target: { value: '  Checked against drawing  ' } });
    fireEvent.click(complete);
    expect(onComplete).toHaveBeenCalledWith('Checked against drawing');
  });

  it('reject: needs a reason; Back returns to the remarks; Confirm sends the trimmed reason', async () => {
    const onReject = vi.fn(); const onClose = vi.fn();
    renderPage(<FilterApprovalDialog filter={F1} mode="review" canReject submitting={false} formatDateTime={fmt} onClose={onClose} onComplete={vi.fn()} onReject={onReject} />, { api: okDetail() });
    await screen.findByText('Op One', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    expect(screen.queryByPlaceholderText('Anything the approver should know')).toBeNull();
    const confirm = screen.getByRole('button', { name: 'Confirm Reject' });
    expect(confirm).toBeDisabled();
    const reason = screen.getByPlaceholderText(/Why this filter is being rejected/);
    fireEvent.change(reason, { target: { value: '   ' } });
    expect(confirm).toBeDisabled();
    // Back leaves reject mode without closing the dialog
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Complete Review' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    fireEvent.change(screen.getByPlaceholderText(/Why this filter is being rejected/), { target: { value: '  Duplicate of FLT-009 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject' }));
    expect(onReject).toHaveBeenCalledWith('Duplicate of FLT-009');
    // Cancel (not rejecting) closes
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('approve without reject rights: no Reject button; Approve needs remarks, then sends them', async () => {
    const onComplete = vi.fn();
    renderPage(<FilterApprovalDialog filter={F1} mode="approve" canReject={false} submitting={false} formatDateTime={fmt} onClose={vi.fn()} onComplete={onComplete} onReject={vi.fn()} />, { api: okDetail() });
    expect(screen.getByRole('heading', { name: 'Approve Filter' })).toBeInTheDocument();
    expect(screen.getByText(/Once approved, this filter can be cleaned and operated/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Approval remarks')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject…' })).toBeNull();
    await screen.findByText('Op One', { exact: false });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Approval remarks'), { target: { value: ' Released ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onComplete).toHaveBeenCalledWith('Released');
  });

  it('while submitting every action is disabled and labelled', async () => {
    const api = okDetail();
    const view = renderPage(<FilterApprovalDialog filter={F1} mode="approve" canReject submitting formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api });
    await screen.findByText('Op One', { exact: false });
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    view.unmount();
    renderPage(<FilterApprovalDialog filter={F1} mode="review" canReject submitting formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api: okDetail() });
    await screen.findByText('Op One', { exact: false });
    expect(screen.getByRole('button', { name: 'Completing…' })).toBeDisabled();
  });

  it('a decision that is submitting while in reject mode reads "Rejecting…"', async () => {
    function Toggle() {
      const [sub, setSub] = useState(false);
      return <>
        <button onClick={() => setSub(true)}>start-submit</button>
        <FilterApprovalDialog filter={F1} mode="review" canReject submitting={sub} formatDateTime={fmt} onClose={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />
      </>;
    }
    renderPage(<Toggle />, { api: okDetail() });
    await screen.findByText('Op One', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }));
    fireEvent.change(screen.getByPlaceholderText(/Why this filter is being rejected/), { target: { value: 'Bad data' } });
    fireEvent.click(screen.getByRole('button', { name: 'start-submit' }));
    expect(screen.getByRole('button', { name: 'Rejecting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});

describe('FilterBulkApprovalDialog', () => {
  const ROWS: ApprovalDialogFilter[] = [
    { id: 'f1', name: 'FLT-001', approvalStatus: 'PENDING_REVIEW', areaName: 'Area N', ahuName: 'AHU-1', ahuType: 'Supply', filterType: 'HEPA', micronSize: '0.3', filterSize: '610', filterSet: 'SET_A', rfid: 'E200A' },
    { id: 'f2', name: 'FLT-002', approvalStatus: 'PENDING_REVIEW', areaName: null, ahuName: 'AHU-2', ahuType: null, filterType: '', micronSize: '-', filterSize: null, filterSet: 'SET_B', rfid: null },
    { id: 'f3', name: 'FLT-003', approvalStatus: 'PENDING_REVIEW', ahuName: 'AHU-2', filterSet: null },
    { id: 'f4', name: 'FLT-004', approvalStatus: 'PENDING_REVIEW', ahuName: 'AHU-2', filterSet: 'OTHER' },
  ];
  const pendingApi = () => mockApi([{ path: '/api/assets/instances/pending-approval', body: { data: [
    { id: 'f1', submittedByName: 'Op One', submittedAt: '2026-09-01T00:00:00Z', reviewedByName: 'Mgr Two', reviewedAt: '2026-09-02T00:00:00Z', reviewRemarks: 'Checked' },
    { id: 'f2', submittedByName: 'Op One', submittedAt: null },
  ] } }]);
  const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;

  it('review: every row starts ticked; untick + remarks → Complete Review sends only the ticked ids', async () => {
    const onComplete = vi.fn();
    renderPage(<FilterBulkApprovalDialog filters={ROWS} mode="review" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onViewDetails={vi.fn()} onComplete={onComplete} onReject={vi.fn()} />, { api: pendingApi() });
    expect(screen.getByRole('heading', { name: 'Review Pending Filters' })).toBeInTheDocument();
    expect(screen.getByText(/waiting for review/)).toHaveTextContent('4 filter(s) waiting for review in this block · 4 selected');
    // attribution still loading
    expect(within(rowOf('FLT-001')).getByText('…')).toBeInTheDocument();
    expect(await within(rowOf('FLT-001')).findByText('Op One')).toBeInTheDocument();
    expect(rowOf('FLT-001')).toHaveTextContent('· fmt(2026-09-01T00:00:00Z)');
    expect(within(rowOf('FLT-003')).getAllByText('--').length).toBeGreaterThan(0); // no attribution row → dash
    expect(screen.queryByRole('columnheader', { name: 'Reviewed' })).toBeNull();
    // row rendering
    expect(rowOf('FLT-001')).toHaveTextContent('0.3 µm');
    expect(within(rowOf('FLT-001')).getByText('Set A')).toBeInTheDocument();
    expect(within(rowOf('FLT-002')).getByText('Set B')).toBeInTheDocument();
    expect(within(rowOf('FLT-004')).getByText('OTHER')).toBeInTheDocument();
    expect(within(rowOf('FLT-002')).getAllByText('--').length).toBeGreaterThanOrEqual(5);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-001' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-003' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-004' }));
    expect(screen.getByText(/waiting for review/)).toHaveTextContent('· 1 selected');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-004' })); // tick it back
    expect(screen.getByRole('checkbox', { name: 'Select FLT-004' })).toBeChecked();
    expect(screen.getByText(/waiting for review/)).toHaveTextContent('· 2 selected');
    expect(screen.getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('Anything the approver should know'), { target: { value: ' ok ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Review (2)' }));
    expect(onComplete).toHaveBeenCalledWith(['f2', 'f4'], 'ok');
  });

  it('Select all clears then restores the whole list; with nothing ticked the actions are disabled', async () => {
    renderPage(<FilterBulkApprovalDialog filters={ROWS} mode="review" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onViewDetails={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api: pendingApi() });
    await within(rowOf('FLT-001')).findByText('Op One');
    const all = screen.getByRole('checkbox', { name: 'Select all' });
    expect(all).toBeChecked();
    fireEvent.click(all);
    expect(screen.getByRole('button', { name: 'Complete Review (0)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject selected (0)…' })).toBeDisabled();
    fireEvent.click(all);
    expect(screen.getByRole('button', { name: 'Complete Review (4)' })).toBeDisabled(); // no remarks yet
    fireEvent.change(screen.getByPlaceholderText('Anything the approver should know'), { target: { value: 'ok' } });
    expect(screen.getByRole('button', { name: 'Complete Review (4)' })).toBeEnabled();
  });

  it('bulk reject: one reason for every ticked row; Back returns; Cancel closes', async () => {
    const onReject = vi.fn(); const onClose = vi.fn();
    renderPage(<FilterBulkApprovalDialog filters={ROWS} mode="review" canReject submitting={false} formatDateTime={fmt} onClose={onClose} onViewDetails={vi.fn()} onComplete={vi.fn()} onReject={onReject} />, { api: pendingApi() });
    await within(rowOf('FLT-001')).findByText('Op One');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-004' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject selected (3)…' }));
    expect(screen.getByText(/Rejection reason for the 3 selected filter\(s\)/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm Reject (3)' });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reject selected (3)…' }));
    fireEvent.change(screen.getByPlaceholderText(/One reason recorded on every selected filter/), { target: { value: ' Wrong block ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Reject (3)' }));
    expect(onReject).toHaveBeenCalledWith(['f1', 'f2', 'f3'], 'Wrong block');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' })); // header X
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('approve: shows the Reviewed column with reviewer, date and remarks; eye icon opens a filter\'s details', async () => {
    const onViewDetails = vi.fn(); const onComplete = vi.fn();
    renderPage(<FilterBulkApprovalDialog filters={ROWS.slice(0, 2)} mode="approve" canReject={false} submitting={false} formatDateTime={fmt} onClose={vi.fn()} onViewDetails={onViewDetails} onComplete={onComplete} onReject={vi.fn()} />, { api: pendingApi() });
    expect(screen.getByRole('heading', { name: 'Approve Pending Filters' })).toBeInTheDocument();
    expect(screen.getByText(/waiting for approval/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Reviewed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject selected/ })).toBeNull();
    const reviewedCell = (await within(rowOf('FLT-001')).findByText('Mgr Two')).closest('td')!;
    expect(reviewedCell).toHaveAttribute('title', 'Checked');
    expect(reviewedCell).toHaveTextContent('Mgr Two · fmt(2026-09-02T00:00:00Z)“Checked”');
    expect(rowOf('FLT-002').querySelectorAll('td')[11]).toHaveTextContent('--');
    fireEvent.click(within(rowOf('FLT-002')).getByTitle('Filter Details'));
    expect(onViewDetails).toHaveBeenCalledWith(ROWS[1]);
    fireEvent.change(screen.getByPlaceholderText('Approval remarks'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Approve (2)' })).toBeDisabled();
    expect(screen.getByLabelText(/^Remarks/)).toBeRequired();
    fireEvent.change(screen.getByPlaceholderText('Approval remarks'), { target: { value: ' Batch OK ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve (2)' }));
    expect(onComplete).toHaveBeenCalledWith(['f1', 'f2'], 'Batch OK');
  });

  it('a row that leaves the list stops counting as selected', async () => {
    const props = { mode: 'review' as const, canReject: true, submitting: false, formatDateTime: fmt, onClose: vi.fn(), onViewDetails: vi.fn(), onComplete: vi.fn(), onReject: vi.fn() };
    const view = renderPage(<FilterBulkApprovalDialog filters={ROWS} {...props} />, { api: pendingApi() });
    await within(rowOf('FLT-001')).findByText('Op One');
    view.rerender(<FilterBulkApprovalDialog filters={ROWS.slice(1)} {...props} />);
    expect(screen.getByText(/waiting for review/)).toHaveTextContent('3 filter(s) waiting for review in this block · 3 selected');
    fireEvent.change(screen.getByPlaceholderText('Anything the approver should know'), { target: { value: 'Checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Review (3)' }));
    expect(props.onComplete).toHaveBeenCalledWith(['f2', 'f3', 'f4'], 'Checked');
  });

  it('empty block: says nothing is waiting and offers no action', async () => {
    const api = pendingApi();
    renderPage(<FilterBulkApprovalDialog filters={[]} mode="review" canReject submitting={false} formatDateTime={fmt} onClose={vi.fn()} onViewDetails={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />, { api });
    expect(screen.getByText('Nothing is waiting on this step in this block.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Complete Review (0)' })).toBeDisabled();
    await waitFor(() => expect(api.calls('GET', '/api/assets/instances/pending-approval')).toHaveLength(1));
  });

  it('while submitting the buttons are disabled with progress labels', async () => {
    function Toggle({ mode }: { mode: 'review' | 'approve' }) {
      const [sub, setSub] = useState(false);
      return <>
        <button onClick={() => setSub(true)}>start-submit</button>
        <FilterBulkApprovalDialog filters={ROWS} mode={mode} canReject submitting={sub} formatDateTime={fmt} onClose={vi.fn()} onViewDetails={vi.fn()} onComplete={vi.fn()} onReject={vi.fn()} />
      </>;
    }
    const view = renderPage(<Toggle mode="approve" />, { api: pendingApi() });
    await within(rowOf('FLT-001')).findByText('Op One');
    fireEvent.click(screen.getByRole('button', { name: 'start-submit' }));
    expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
    view.unmount();
    const v2 = renderPage(<Toggle mode="review" />, { api: pendingApi() });
    await within(rowOf('FLT-001')).findByText('Op One');
    fireEvent.click(screen.getByRole('button', { name: 'start-submit' }));
    expect(screen.getByRole('button', { name: 'Completing…' })).toBeDisabled();
    v2.unmount();
    renderPage(<Toggle mode="review" />, { api: pendingApi() });
    await within(rowOf('FLT-001')).findByText('Op One');
    fireEvent.click(screen.getByRole('button', { name: 'Reject selected (4)…' }));
    fireEvent.change(screen.getByPlaceholderText(/One reason recorded/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'start-submit' }));
    expect(screen.getByRole('button', { name: 'Rejecting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});
