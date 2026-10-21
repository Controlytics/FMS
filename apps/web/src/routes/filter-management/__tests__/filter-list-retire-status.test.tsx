import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce } from './fm-test-kit';
import {
  setupApi, renderFilters, openFiltersTab, row, field, panel, cancelReauth, waitForReauthConfig, ADMIN_ALL,
} from './filter-list-fixtures';

usePageTestLifecycle();

/** The bulk action bar (shown while anything is ticked). */
const bulkBar = () => screen.getByText(/filter\(s\) selected/).closest('.rounded-xl') as HTMLElement;

const OPERATOR = role('SUPERVISOR', ['ASSET_READ', 'FILTER_RETIRE', 'FILTER_REPLACE', 'FILTER_STATUS_UPDATE']);

const REASONS = [{ key: 'PM', name: 'Preventive' }, { key: 'BD', name: 'Breakdown', requiresJustification: true }];
const opt = (state: string, classification: string, extra: Record<string, unknown> = {}) =>
  ({ state, classification, allowed: classification !== 'SKIP', isCurrent: classification === 'SAME', startsCycle: false, ...extra });

describe('Filters page — Retire / Replace (single)', () => {
  it('retire: remarks are required; POST /api/filters/:id/retire {remarks}; success closes the panel', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/filters/f1/retire', body: { success: true } }] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Retire / Replace'));
    const p = panel('Retire / Replace Filter');
    expect(within(p).getByDisplayValue('PF-001')).toBeInTheDocument();
    expect(p).toHaveTextContent('This will permanently retire the filter');
    const submit = within(p).getByRole('button', { name: 'Retire Filter' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(p).getByPlaceholderText(/reason for retirement/), { target: { value: '  Media torn  ' } });
    fireEvent.click(submit);
    expect(await screen.findByText('PF-001 has been retired')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f1/retire')[0].json).toEqual({ remarks: 'Media torn' });
    expect(screen.queryByRole('heading', { name: 'Retire / Replace Filter' })).toBeNull();
  });

  it('replace: switching the action changes the copy + endpoint; the new filter name is announced', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/filters/f2/replace', body: { success: true, newFilterName: 'PF-002-1' } }] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('Retire / Replace'));
    const p = panel('Retire / Replace Filter');
    fireEvent.change(field('Action', p), { target: { value: 'replace' } });
    expect(p).toHaveTextContent('create a new replacement filter');
    fireEvent.change(within(p).getByPlaceholderText(/reason for retirement/), { target: { value: 'End of life' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace Filter' }));
    expect(await screen.findByText('New filter created: PF-002-1')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f2/replace')[0].json).toEqual({ remarks: 'End of life' });
  });

  it('a Replace-only role lands on Replacement with no choice offered', async () => {
    renderFilters(role('X', ['FILTER_REPLACE']), setupApi());
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Replace Filter'));
    const p = panel('Replace Filter');
    expect(within(p).getByDisplayValue('Replacement')).toHaveAttribute('readonly');
    expect(within(p).getByRole('button', { name: 'Replace Filter' })).toBeInTheDocument();
  });

  it('a refused retire toasts "Action Failed" and keeps the panel with its remarks', async () => {
    const api = setupApi({ extra: [{ method: 'POST', path: '/api/filters/f1/retire', status: 409, body: { error: 'CYCLE_ACTIVE', message: 'Filter has an active cleaning cycle' } }] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Retire / Replace'));
    const p = panel('Retire / Replace Filter');
    fireEvent.change(within(p).getByPlaceholderText(/reason for retirement/), { target: { value: 'Damaged' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Retire Filter' }));
    expect(await screen.findByText('Filter has an active cleaning cycle')).toBeInTheDocument();
    expect(screen.getByText('Action Failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('Retire / Replace Filter')).getByDisplayValue('Damaged')).toBeInTheDocument();
    expect(within(panel('Retire / Replace Filter')).getByRole('button', { name: 'Retire Filter' })).toBeEnabled();
  });

  it('retire under re-auth: signed retry; Cancel / backdrop close the panel', async () => {
    const api = setupApi({ extra: [reauthOnce('POST', '/api/filters/f1/retire'), { method: 'POST', path: '/api/filters/f1/retire', body: {} }] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Retire / Replace'));
    fireEvent.click(within(panel('Retire / Replace Filter')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Retire / Replace Filter' })).toBeNull();
    fireEvent.click(within(row('PF-001')).getByTitle('Retire / Replace'));
    const p = panel('Retire / Replace Filter');
    fireEvent.change(within(p).getByPlaceholderText(/reason for retirement/), { target: { value: 'Damaged' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Retire Filter' }));
    await passReauth();
    expect(await screen.findByText('Filter Retired')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/filters/f1/retire')[1]);
  });
});

describe('Filters page — Update Status (single)', () => {
  it('profile-constrained move that starts a cycle: SKIP is refused, reason + justification required, PATCH body', async () => {
    const api = setupApi({ extra: [
      { path: '/api/filters/f2/stage-options', body: {
        hasProfile: true, hasActiveCycle: false, profileName: 'STD PROFILE', currentStage: null, orderedStages: [], immediateNext: [],
        options: [opt('WASH_IN', 'START', { startsCycle: true }), opt('DRY_IN', 'SKIP')], cleaningReasons: REASONS,
      } },
      { method: 'PATCH', path: '/api/assets/instances/f2/lifecycle-state', body: {} },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('Update Status'));
    const p = panel('Update Filter Status');
    expect(within(p).getByDisplayValue('To Be Cleaned')).toBeInTheDocument();
    expect(await within(p).findByText('Cleaning profile: STD PROFILE')).toBeInTheDocument();
    const submit = within(p).getByRole('button', { name: 'Update Status' });
    const sel = field('New Status', p);
    expect(within(sel).getByRole('option', { name: 'Dry In — out of sequence' })).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'DRY_IN' } });
    expect(p).toHaveTextContent('Invalid stage movement.');
    fireEvent.change(field('Remarks', p), { target: { value: 'Manual move' } });
    expect(submit).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'WASH_IN' } });
    expect(p).toHaveTextContent('This will start a new cleaning cycle.');
    expect(submit).toBeDisabled(); // no reason yet
    fireEvent.change(field('Cleaning Reason', p), { target: { value: 'BD' } });
    fireEvent.change(field('Justification', p), { target: { value: 'short' } });
    expect(submit).toBeDisabled();
    fireEvent.change(field('Justification', p), { target: { value: 'Fan motor seized overnight' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText('PF-002 updated to Wash In')).toBeInTheDocument();
    expect(api.calls('PATCH', '/api/assets/instances/f2/lifecycle-state')[0].json).toEqual({
      lifecycleState: 'WASH_IN', remarks: 'Manual move', cleaningReasonKey: 'BD', cleaningJustification: 'Fan motor seized overnight',
    });
  });

  it('a backward move with an active cycle warns that the cycle is interrupted; no reason needed for a plain forward move', async () => {
    const api = setupApi({ extra: [
      { path: '/api/filters/f1/stage-options', body: {
        hasProfile: true, hasActiveCycle: true, profileName: null, currentStage: 'WASH_IN', orderedStages: [], immediateNext: [],
        options: [opt('WASH_IN', 'SAME'), opt('WASH_OUT', 'FORWARD'), opt('STORAGE_OUT', 'BACKWARD', { startsCycle: true })], cleaningReasons: REASONS,
      } },
      { method: 'PATCH', path: '/api/assets/instances/f1/lifecycle-state', body: {} },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Update Status'));
    const p = panel('Update Filter Status');
    const sel = field('New Status', p);
    await waitFor(() => expect(within(sel).getByRole('option', { name: 'Wash In (current)' })).toBeDisabled());
    expect(within(sel).getByRole('option', { name: 'Storage Out (back)' })).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'STORAGE_OUT' } });
    expect(p).toHaveTextContent('will close the current cleaning cycle as interrupted');
    expect(p).not.toHaveTextContent('This will start a new cleaning cycle.');
    fireEvent.change(sel, { target: { value: 'WASH_OUT' } });
    expect(within(p).queryByText(/Cleaning Reason/)).toBeNull();
    fireEvent.change(field('Remarks', p), { target: { value: 'Next' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update Status' }));
    await screen.findByText('PF-001 updated to Wash Out');
    expect(api.calls('PATCH', '/api/assets/instances/f1/lifecycle-state')[0].json).toEqual({ lifecycleState: 'WASH_OUT', remarks: 'Next' });
  });

  it('no profile: the fixed list is offered; choosing the current state is refused; a 409 keeps the panel', async () => {
    const api = setupApi({ extra: [
      { path: '/api/filters/f1/stage-options', body: { hasProfile: false, options: [], cleaningReasons: [] } },
      { method: 'PATCH', path: '/api/assets/instances/f1/lifecycle-state', status: 409, body: { error: 'INVALID_TRANSITION', message: 'Invalid stage movement for this filter' } },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Update Status'));
    const p = panel('Update Filter Status');
    const sel = field('New Status', p);
    expect(within(sel).getAllByRole('option')).toHaveLength(8);
    fireEvent.change(sel, { target: { value: 'WASH_IN' } });
    expect(p).toHaveTextContent('Please select a different status from the current one.');
    fireEvent.change(field('Remarks', p), { target: { value: 'Try' } });
    expect(within(p).getByRole('button', { name: 'Update Status' })).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update Status' }));
    expect(await screen.findByText('Invalid stage movement for this filter')).toBeInTheDocument();
    expect(screen.getByText('Update Failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('Update Filter Status')).getByRole('button', { name: 'Update Status' })).toBeEnabled();
    // opening Retire from another row closes the status panel
    fireEvent.click(within(row('PF-002')).getByTitle('Retire / Replace'));
    expect(screen.queryByRole('heading', { name: 'Update Filter Status' })).toBeNull();
  });

  it('status update under re-auth (my-actions) sends a signed PATCH', async () => {
    const api = setupApi({
      base: { reauthActions: ['UPDATE_FILTER_LIFECYCLE'] },
      extra: [
        { path: '/api/filters/f1/stage-options', body: { hasProfile: false } },
        { method: 'PATCH', path: '/api/assets/instances/f1/lifecycle-state', body: {} },
      ],
    });
    renderFilters(OPERATOR, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByTitle('Update Status'));
    const p = panel('Update Filter Status');
    fireEvent.change(field('New Status', p), { target: { value: 'WASH_OUT' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Signed' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update Status' }));
    await passReauth();
    await screen.findByText('Status Updated');
    expectSigned(api.calls('PATCH', '/api/assets/instances/f1/lifecycle-state')[0]);
  });
});

describe('Filters page — bulk selection', () => {
  it('Select-all ticks only selectable rows; search hides some → hidden count; Clear empties', async () => {
    renderFilters(OPERATOR, setupApi());
    await openFiltersTab();
    const header = screen.getAllByRole('checkbox')[0];
    fireEvent.click(header);
    // OPERATOR: approved non-retired rows only (PF-001, PF-002, HF-007)
    expect(screen.getByText('3 filter(s) selected')).toBeInTheDocument();
    expect(header).toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('Search filters…'), { target: { value: 'PF-00' } });
    expect(screen.getByText(/2 filter\(s\) selected/)).toHaveTextContent('— 1 hidden by the current search and excluded');
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/filter\(s\) selected/)).toBeNull();
    // toggle one row on/off, and select-all on then off
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    expect(screen.getByText('1 filter(s) selected')).toBeInTheDocument();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    expect(screen.queryByText(/filter\(s\) selected/)).toBeNull();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.queryByText(/filter\(s\) selected/)).toBeNull();
  });

  it('bulk status: per-filter stage hints; skipped filters are grouped by reason in the result', async () => {
    const api = setupApi({ extra: [
      { path: '/api/filters/f1/stage-options', body: { hasProfile: true, options: [opt('WASH_IN', 'SAME'), opt('WASH_OUT', 'FORWARD')], cleaningReasons: REASONS } },
      { path: '/api/filters/f2/stage-options', body: { hasProfile: true, options: [opt('WASH_IN', 'START'), opt('WASH_OUT', 'SKIP')], cleaningReasons: [] } },
      { path: '/api/filters/f7/stage-options', status: 500, body: { error: 'X', message: 'boom' } },
      { method: 'PATCH', path: '/api/assets/instances/f1/lifecycle-state', body: {} },
      { method: 'PATCH', path: '/api/assets/instances/f2/lifecycle-state', status: 400, body: { error: 'INVALID_TRANSITION', message: 'Invalid stage movement' } },
      { method: 'PATCH', path: '/api/assets/instances/f7/lifecycle-state', status: 400, body: { error: 'INVALID_TRANSITION', message: 'Invalid stage movement' } },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    const p = panel('Bulk Status Update');
    expect(p).toHaveTextContent('Updating 3 filter(s)');
    const sel = field('New Status', p);
    await waitFor(() => expect(within(sel).getByRole('option', { name: 'Wash Out — valid for 1 of 3' })).toBeInTheDocument());
    expect(within(sel).getByRole('option', { name: 'Dry In — out of sequence' })).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'WASH_OUT' } });
    expect(p).toHaveTextContent('Only 1 of 3 selected filters can move to this stage');
    // moving into a cleaning stage needs a reason (taken from the first filter that lists any)
    fireEvent.change(field('Remarks', p), { target: { value: 'Batch move' } });
    const submit = within(p).getByRole('button', { name: 'Update 3 Filter(s)' });
    expect(submit).toBeDisabled();
    fireEvent.change(field('Cleaning Reason', p), { target: { value: 'PM' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Bulk Status Update — 1 updated, 2 skipped')).toBeInTheDocument();
    expect(screen.getByText(/• Invalid stage movement — PF-002, HF-007/)).toBeInTheDocument();
    expect(api.calls('PATCH', '/api/assets/instances/f1/lifecycle-state')[0].json).toEqual({ lifecycleState: 'WASH_OUT', remarks: 'Batch move', cleaningReasonKey: 'PM' });
    expect(screen.queryByText(/filter\(s\) selected/)).toBeNull();
  });

  it('bulk status: none valid → submit refused; all valid → success; none updated → error', async () => {
    const all = (s: string) => ({ hasProfile: true, options: [opt(s, 'FORWARD')], cleaningReasons: [] });
    const api = setupApi({ extra: [
      { path: /\/api\/filters\/f\d\/stage-options/, body: all('CLEANING_CYCLE_COMPLETED') },
      { method: 'PATCH', path: /\/api\/assets\/instances\/f\d\/lifecycle-state/, status: 409, times: 2, body: { error: 'X', message: 'Locked by an active cycle' } },
      { method: 'PATCH', path: /\/api\/assets\/instances\/f\d\/lifecycle-state/, body: {} },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    let p = panel('Bulk Status Update');
    const sel = field('New Status', p);
    await waitFor(() => expect(within(sel).getByRole('option', { name: 'Cleaning Cycle Completed' })).toBeEnabled());
    // initial state is the first option (Wash In) — out of sequence for both
    expect(p).toHaveTextContent('None of the selected filters can move to this stage');
    fireEvent.change(sel, { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Close out' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update 2 Filter(s)' }));
    expect(await screen.findByText('Bulk Status Update — none updated')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    // selection was cleared; re-select and succeed
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    p = panel('Bulk Status Update');
    await waitFor(() => expect(within(field('New Status', p)).getByRole('option', { name: 'Cleaning Cycle Completed' })).toBeEnabled());
    fireEvent.change(field('New Status', p), { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Close out' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update 1 Filter(s)' }));
    expect(await screen.findByText('1 filter(s) updated to Cleaning Cycle Completed')).toBeInTheDocument();
  });

  it('bulk status: a REAUTH_REQUIRED on the first filter escapes the loop → one prompt → every filter re-sent signed', async () => {
    const api = setupApi({ extra: [
      { path: /\/api\/filters\/f\d\/stage-options/, body: { hasProfile: true, options: [opt('CLEANING_CYCLE_COMPLETED', 'COMPLETE')], cleaningReasons: [] } },
      reauthOnce('PATCH', '/api/assets/instances/f1/lifecycle-state'),
      { method: 'PATCH', path: /\/api\/assets\/instances\/f\d\/lifecycle-state/, body: {} },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    const p = panel('Bulk Status Update');
    await waitFor(() => expect(within(field('New Status', p)).getByRole('option', { name: 'Cleaning Cycle Completed' })).toBeEnabled());
    fireEvent.change(field('New Status', p), { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Done' } });
    expect(within(p).getByRole('button', { name: 'Update 2 Filter(s)' })).toBeEnabled();
    fireEvent.click(within(p).getByRole('button', { name: 'Update 2 Filter(s)' }));
    await passReauth();
    expect(await screen.findByText('2 filter(s) updated to Cleaning Cycle Completed')).toBeInTheDocument();
    const signed = api.requests.filter((r) => r.method === 'PATCH' && r.headers['x-reauth-password']);
    expect(signed.map((r) => r.path)).toEqual(['/api/assets/instances/f1/lifecycle-state', '/api/assets/instances/f2/lifecycle-state']);
  });

  it('bulk retire: one prompt-free loop, partial failure reported with the first error; Cancel closes', async () => {
    const api = setupApi({ extra: [
      { method: 'POST', path: '/api/filters/f1/retire', body: {} },
      { method: 'POST', path: '/api/filters/f2/retire', status: 409, body: { error: 'X', message: 'Active cycle' } },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Retire' }));
    let p = panel('Bulk Retirement');
    expect(p).toHaveTextContent('permanently retire 2 filter(s)');
    fireEvent.click(within(p).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Bulk Retirement' })).toBeNull();
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Retire' }));
    p = panel('Bulk Retirement');
    expect(within(p).getByRole('button', { name: 'Retire 2 Filter(s)' })).toBeDisabled();
    fireEvent.change(within(p).getByPlaceholderText('Enter reason for retirement...'), { target: { value: 'Obsolete' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Retire 2 Filter(s)' }));
    expect(await screen.findByText('1 filter(s) retired, 1 failed — Active cycle')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f1/retire')[0].json).toEqual({ remarks: 'Obsolete' });
  });

  it('bulk replace: all fail → "Bulk Replacement Failed"; under re-auth the whole batch is re-sent signed', async () => {
    const api = setupApi({ extra: [
      reauthOnce('POST', '/api/filters/f1/replace'),
      { method: 'POST', path: /\/api\/filters\/f\d\/replace/, status: 409, body: { error: 'X', message: 'Not allowed' } },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Replace' }));
    const p = panel('Bulk Replacement');
    expect(p).toHaveTextContent('create replacement filters');
    fireEvent.change(within(p).getByPlaceholderText('Enter reason for replacement...'), { target: { value: 'Swap' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace 2 Filter(s)' }));
    await passReauth();
    expect(await screen.findByText('Bulk Replacement Failed')).toBeInTheDocument();
    expect(screen.getByText('2 filter(s) failed — Not allowed')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f1/replace')).toHaveLength(2);
    expectSigned(api.calls('POST', '/api/filters/f2/replace')[0]);
  });

  it('bulk replace: a non-reauth transport failure on the prompt path reports "Bulk action failed"', async () => {
    const api = setupApi({
      base: { reauthActions: ['REPLACE_FILTER'] },
      extra: [{ method: 'POST', path: /\/api\/filters\/f\d\/replace/, body: { newFilterName: 'x' } }],
    });
    renderFilters(OPERATOR, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Replace' }));
    const p = panel('Bulk Replacement');
    fireEvent.change(within(p).getByPlaceholderText('Enter reason for replacement...'), { target: { value: 'Swap' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace 1 Filter(s)' }));
    await cancelReauth();
    expect(await screen.findByText('Bulk action failed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled — password confirmation was not completed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('Bulk Replacement')).getByRole('button', { name: 'Replace 1 Filter(s)' })).toBeEnabled();
  });

  it('bulk bar actions follow FILTER_STATUS_UPDATE / RETIRE / REPLACE; SA sees all three', async () => {
    renderFilters(SA, setupApi());
    await openFiltersTab();
    fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
    for (const n of ['Update Status', 'Retire', 'Replace', 'Clear']) expect(within(bulkBar()).getByRole('button', { name: n })).toBeInTheDocument();
  });

  it('ticked pending rows go to Review/Approve, never to Update Status / Retire / Replace', async () => {
    renderFilters(ADMIN_ALL, setupApi());
    await openFiltersTab();
    fireEvent.click(within(row('PF-003')).getByRole('checkbox'));
    fireEvent.click(within(row('PF-004')).getByRole('checkbox'));
    expect(within(bulkBar()).getByRole('button', { name: 'Review selected (1)' })).toBeInTheDocument();
    expect(within(bulkBar()).getByRole('button', { name: 'Approve selected (1)' })).toBeInTheDocument();
    expect(within(bulkBar()).queryByRole('button', { name: 'Update Status' })).toBeNull();
    expect(within(bulkBar()).queryByRole('button', { name: 'Retire' })).toBeNull();
    expect(within(bulkBar()).queryByRole('button', { name: 'Replace' })).toBeNull();
  });
});

describe('Filters page — bulk status for filters with no cleaning profile (D5)', () => {
  it('the bulk panel offers the stages the single panel does, needs no cleaning reason, and updates the filter', async () => {
    // Real API shape for a filter without a cleaning profile (stage-rules.ts buildStageOptions):
    const noProfile = { hasProfile: false, hasActiveCycle: false, profileName: null, currentStage: null, orderedStages: [], immediateNext: [],
      options: [{ state: 'CLEANING_CYCLE_COMPLETED', classification: 'COMPLETE', allowed: true, isCurrent: false, startsCycle: false }], cleaningReasons: [] };
    const api = setupApi({ extra: [
      { path: /\/api\/filters\/f\d\/stage-options/, body: noProfile },
      { method: 'PATCH', path: /\/api\/assets\/instances\/f\d\/lifecycle-state/, body: {} },
    ] });
    renderFilters(OPERATOR, api);
    await openFiltersTab();
    fireEvent.click(within(row('PF-002')).getByTitle('Update Status'));
    const single = panel('Update Filter Status');
    await waitFor(() => expect(api.calls('GET', '/api/filters/f2/stage-options')).toHaveLength(1));
    expect(within(field('New Status', single)).getByRole('option', { name: 'Wash In' })).toBeEnabled();
    fireEvent.click(within(single).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    const bulk = panel('Bulk Status Update');
    await waitFor(() => expect(within(field('New Status', bulk)).getByRole('option', { name: 'Wash In' })).toBeEnabled());
    fireEvent.change(field('New Status', bulk), { target: { value: 'WASH_IN' } });
    // a no-profile move never starts a cycle, so the server takes no cleaning reason
    expect(within(bulk).queryByText(/a cleaning reason is required/)).toBeNull();
    fireEvent.change(within(bulk).getByPlaceholderText('Enter reason for status change...'), { target: { value: 'Moved by hand' } });
    fireEvent.click(within(bulk).getByRole('button', { name: 'Update 1 Filter(s)' }));
    expect(await screen.findByText('1 filter(s) updated to Wash In')).toBeInTheDocument();
    expect(api.calls('PATCH', '/api/assets/instances/f2/lifecycle-state')[0].json).toEqual({ lifecycleState: 'WASH_IN', remarks: 'Moved by hand' });
  });
});
