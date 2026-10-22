/**
 * Stage Approvals — defects found by the coverage campaign (2026-10-21), each
 * pinned failing-first:
 *  D-OPS-6  a failed load read "Nothing awaiting your approval." / "No stage
 *           approvals yet." instead of an error with Retry.
 *  D-OPS-8  a cancelled password prompt was reported as "Failed".
 *  3d       the decision remarks had no accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { unnamedControls } from '../../pm-schedules/__tests__/a11y-kit';
import { StageApprovalsPage } from '../index';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const AT = '2026-10-20T09:15:00.000Z';
const row = (id: string, over: Record<string, any> = {}) => ({
  id, cycleId: `cyc-${id}`, filterId: `f-${id}`, stageKey: 'WASH_OUT', status: 'PENDING', approverRole: 'QA',
  rejectToStateKey: 'WASH_IN', attemptSeq: 1, detailsSnapshot: { filterName: `FLT-${id}` }, requestedByName: 'opr1', requestedAt: AT,
  stageDetails: { cleaningReason: 'PM', washIn: { at: AT, by: 'opr1', readings: [] }, washOut: { at: AT, by: 'opr1', readings: [] } }, ...over,
});
const DECIDER = role('QA', ['STAGE_APPROVAL_VIEW', 'STAGE_APPROVAL_DECIDE']);

function open(user: any, queue: MockRoute, all: MockRoute, reauthActions: string[] = []) {
  const api = mockApi([queue, all,
    { path: '/api/users', body: { data: [] } }, { path: '/api/roles', body: [{ name: 'QA' }] },
    DT_UTC, ...baseRoutes({ reauthActions })]);
  renderPage(<StageApprovalsPage />, { user, api });
  return api;
}
const queueOk = (rows: any[]): MockRoute => ({ path: '/api/stage-approvals/queue', body: { data: rows } });
const allOk = (rows: any[]): MockRoute => ({ path: '/api/stage-approvals', body: { data: rows } });
const cancelPrompt = async () => {
  await screen.findByPlaceholderText('Enter your password');
  const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
  fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
};

// Every decision carries remarks, approvals too (D03-13, 2026-10-22).
const REMARKS = 'looks clean';

describe('D-OPS-6 — a failed load is an error with Retry, never the empty state', () => {
  it('the queue: error + Retry, and Retry re-reads it', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(DECIDER, { path: '/api/stage-approvals/queue', status: 500, times: 1, body: { error: 'X', message: 'queue exploded' } }, allOk([]));
    api.routes.push(queueOk([row('a')])); // answers the retry once the failing route is used up
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the stage approvals');
    expect(alert).toHaveTextContent('queue exploded');
    expect(screen.queryByText('Nothing awaiting your approval.')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('FLT-a')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the All tab: its own failure is shown on that tab', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(DECIDER, queueOk([]), { path: '/api/stage-approvals', status: 502, body: { message: '' } });
    expect(await screen.findByText('Nothing awaiting your approval.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server did not answer.');
    expect(screen.queryByText('No stage approvals yet.')).toBeNull();
  });

  it('a 403 says the reader may not view them, with no Retry', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('X', []), { path: '/api/stage-approvals/queue', status: 403, body: { error: 'FORBIDDEN', message: 'Missing STAGE_APPROVAL_VIEW' } }, allOk([]));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view stage approvals');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('D-OPS-8 — cancelling the password prompt is silent', () => {
  it('single decision: nothing sent, no message, the dialog is usable again', async () => {
    const api = open(DECIDER, queueOk([row('a')]), allOk([]), ['APPROVE_CLEANING_STAGE']);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await cancelPrompt();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(api.calls('POST', /\/approve$/)).toHaveLength(0);
  });

  it('bulk decision: nothing sent, no message, the bulk dialog is usable again', async () => {
    const api = open(DECIDER, queueOk([row('a'), row('b')]), allOk([]), ['REJECT_CLEANING_STAGE']);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject Selected (2)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: 'Too wet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject 2' }));
    await cancelPrompt();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reject 2' })).toBeEnabled();
    expect(api.calls('POST', '/api/stage-approvals/bulk-decide')).toHaveLength(0);
  });
});

describe('3d — every control on Stage Approvals has an accessible name', () => {
  it('queue, single decision dialog, bulk dialog, Super Admin record editor', async () => {
    open(SA, queueOk([row('a'), row('self', { selfRequested: true })]), allOk([row('ok', { status: 'APPROVED', decidedByName: 'qa1' })]));
    await screen.findByText('FLT-a');
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]);
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Reject' })[0]);
    expect(screen.getByLabelText(/Remarks/)).toHaveAttribute('placeholder', 'Reason for rejection (required)');
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    expect(screen.getByLabelText(/Remarks/)).toHaveAttribute('placeholder', 'What was checked (required, applies to all)');
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit approval record (Super Admin)' })[0]);
    expect(unnamedControls()).toEqual([]);
  });
});
