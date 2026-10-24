/**
 * Stage Approvals page (coverage campaign 2026-10-21) — real SWR / apiClient /
 * useAuth / useCan / useReauth through the page harness; only fetch is stubbed.
 *
 * Rules exercised:
 *  - the performer of a stage can never approve or reject it (`selfRequested`
 *    rows are not actionable and never enter a selection or a bulk request);
 *  - Approve / Reject are hidden without STAGE_APPROVAL_DECIDE;
 *  - a reject needs >= 3 characters of remarks (single and bulk);
 *  - one password signs a whole bulk run; per-item failures are reported;
 *  - the "All" tab asks for the last 30 days only;
 *  - SUPER_ADMIN edits go through the audited console endpoints;
 *  - the tablet's Android-back hook closes the topmost dialog first.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRef, type MutableRefObject } from 'react';
import { screen, fireEvent, waitFor, within, act, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, reauthOnce, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { StageApprovalsPage, eventsForApproval } from '../index';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const AT = '2026-10-20T09:15:00.000Z';
const snap = (name: string) => ({
  filterName: name, block: 'Block A', area: 'Area 1', ahu: 'AHU-1', ahuType: 'Recirculation',
  micronSize: '5', filterType: 'HEPA', filterDimensions: '610x610', filterSet: 'SET_A',
});
const washDetails = {
  cleaningReason: 'Preventive',
  washIn: { at: AT, by: 'opr1', readings: [{ description: 'RO Water Pressure', value: 2, uom: 'bar', leastCount: null }] },
  washOut: { at: AT, by: 'opr1', readings: [] },
};
const row = (id: string, over: Record<string, any> = {}) => ({
  id, cycleId: `cyc-${id}`, filterId: `f-${id}`, stageKey: 'WASH_OUT', status: 'PENDING', approverRole: 'QA',
  rejectToStateKey: 'WASH_IN', attemptSeq: 1, detailsSnapshot: snap(`FLT-${id}`), requestedByName: 'opr1',
  requestedAt: AT, stageDetails: washDetails, ...over,
});
const A = row('a');
const B = row('b', { stageKey: 'DRY_OUT', rejectToStateKey: 'DRY_IN', stageDetails: null, detailsSnapshot: { ...snap('FLT-b'), block: null, ahu: null } });
const SELF = row('self', { selfRequested: true });
const ARCHIVE = [
  row('ok', { status: 'APPROVED', decidedByName: 'qa1', decidedAt: AT }),
  row('no', { status: 'REJECTED', decidedByName: 'qa2', decidedAt: AT, decisionRemarks: 'Pressure too low' }),
  row('sup', { status: 'SUPERSEDED' }),
  row('odd', { status: 'WEIRD', detailsSnapshot: { ...snap(''), filterName: null } }),
];

const DECIDER = role('QA', ['STAGE_APPROVAL_VIEW', 'STAGE_APPROVAL_DECIDE']);
const VIEWER = role('MANAGER', ['STAGE_APPROVAL_VIEW']);

function routes(queue: any[] = [A, B, SELF], all: any[] = ARCHIVE, extra: MockRoute[] = [], reauthActions: string[] = []) {
  return mockApi([
    ...extra,
    { path: '/api/stage-approvals/queue', body: { data: queue } },
    { path: '/api/stage-approvals', body: { data: all } },
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'qa1', fullName: 'QA One' }] } },
    { path: '/api/roles/active', body: [{ name: 'QA', displayName: 'Quality Assurance', color: 'bg-emerald-600' }] },
    { path: '/api/roles', body: [{ name: 'QA', displayName: 'Quality' }, { name: 'MANAGER' }] },
    DT_UTC,
    ...baseRoutes({ reauthActions }),
  ]);
}

function open(user = DECIDER, api = routes(), ref?: MutableRefObject<(() => boolean) | null>) {
  const view = renderPage(<StageApprovalsPage overlayBackRef={ref} />, { user, api });
  return view; // renderPage returns the api it was given
}
const waitReauthConfig = (api: ReturnType<typeof mockApi>) =>
  waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
const rowEl = (name: string) => screen.getByText(name, { selector: 'div.font-medium' }).closest('div.grid') as HTMLElement;
/** The page's own decision / bulk dialog panel, by its heading. */
const dlgOf = (heading: string) => screen.getByRole('heading', { name: heading }).closest('.max-w-md') as HTMLElement;
/** Run the tablet back hook inside act() and return its answer. */
const pressBack = (ref: MutableRefObject<(() => boolean) | null>) => {
  let handled: boolean | undefined;
  act(() => { handled = ref.current!(); });
  return handled;
};
/** Cancel inside the ReauthDialog (its Cancel, not the page dialog's). */
const reauthCancel = () => {
  const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
  fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
};
const okDialog = async (title: string, message?: string | RegExp) => {
  const h = await screen.findByRole('heading', { name: title });
  const dlg = h.closest('[role="dialog"]') as HTMLElement;
  if (message) expect(dlg).toHaveTextContent(message);
  fireEvent.click(within(dlg).getByRole('button', { name: 'OK' }));
};

// Every decision carries remarks, approvals too (D03-13, 2026-10-22).
const REMARKS = 'looks clean';

describe('eventsForApproval', () => {
  const ev = (toState: string, kind?: string, eventType = 'STATE_TRANSITION') => ({ id: `${toState}-${kind ?? ''}`, eventType, toState, attributes: kind ? { kind } : {} });
  it('a Wash Out approval edits the Wash In + Wash Out steps, never the interlock reject row', () => {
    const events = [ev('WASH_IN'), ev('WASH_OUT'), ev('WASH_IN', 'STAGE_INTERLOCK_REJECTED'), ev('DRY_IN'), ev('WASH_OUT', undefined, 'NOTE')];
    expect(eventsForApproval('WASH_OUT', events).map((e) => e.id)).toEqual(['WASH_IN-', 'WASH_OUT-']);
  });
  it('a Dry Out approval edits Dry In + Dry Out; any other stage edits nothing', () => {
    const events = [ev('DRY_IN'), ev('DRY_OUT'), ev('WASH_IN')];
    expect(eventsForApproval('DRY_OUT', events).map((e) => e.id)).toEqual(['DRY_IN-', 'DRY_OUT-']);
    expect(eventsForApproval('STORAGE_IN', events)).toEqual([]);
    expect(eventsForApproval('WASH_OUT', undefined as any)).toEqual([]);
  });
});

describe('Stage Approvals — queue and archive', () => {
  it('the queue lists each pending stage with its filter, stage, location and performer; nothing unmocked is read', async () => {
    const { api } = open();
    expect(await screen.findByText('FLT-a')).toBeInTheDocument();
    expect(within(rowEl('FLT-a')).getByText('Wash Out · Block A / AHU-1')).toBeInTheDocument();
    // A row with no block / AHU says so with a dash, not an empty line.
    expect(screen.getByText('Dry Out · —')).toBeInTheDocument();
    expect(screen.getAllByText('Verify now')).toHaveLength(3);
    // The To Action tab counts every row in the queue.
    expect(screen.getByRole('button', { name: /To Action\s*3/ })).toBeInTheDocument();
    expect(within(rowEl('FLT-a')).getByText('2026-10-20')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('the All tab asks for every pending row plus the last 30 days, and labels each status', async () => {
    const { api } = open();
    await screen.findByText('FLT-a');
    const read = api.calls('GET', '/api/stage-approvals')[0];
    const since = Date.parse(read.query.get('from')!);
    expect(Math.abs(Date.now() - 30 * 86_400_000 - since)).toBeLessThan(60_000);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Pressure too low')).toBeInTheDocument();
    expect(screen.getByText('Closed (not decided)')).toBeInTheDocument();
    // An unknown status falls back to its raw value; a nameless filter to its id.
    expect(screen.getByText('WEIRD')).toBeInTheDocument();
    expect(screen.getByText('f-odd')).toBeInTheDocument();
    // Decider lines name who decided.
    expect(screen.getByText('qa1').closest('div')).toHaveTextContent('Approved: qa1');
    expect(screen.getByText('qa2').closest('div')).toHaveTextContent('Rejected: qa2');
    // Archive rows carry no selection and no decision buttons.
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verify & Approve' })).toBeNull();
  });

  it('empty queue and empty archive each say so', async () => {
    open(DECIDER, routes([], []));
    expect(await screen.findByText('Nothing awaiting your approval.')).toBeInTheDocument();
    expect(screen.queryByText('Select all')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByText('No stage approvals yet.')).toBeInTheDocument();
  });

  it('a failed queue load is an error in the page (with Retry) as well as a Load Error toast', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(DECIDER, routes([], [], [{ path: '/api/stage-approvals/queue', status: 500, body: { error: 'INTERNAL', message: 'queue exploded' } }]));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('queue exploded');
    expect(screen.getByText('Load Error')).toBeInTheDocument(); // the non-blocking toast
    expect(screen.queryByText('Nothing awaiting your approval.')).toBeNull(); // D-OPS-6
  });

  it('Details expands the server-derived stage details for a row and collapses again', async () => {
    open();
    await screen.findByText('FLT-a');
    const btn = within(rowEl('FLT-a')).getByRole('button', { name: 'Details' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    const card = await screen.findByTestId('stage-details');
    expect(card).toHaveTextContent('Wash In');
    expect(card).toHaveTextContent('RO Water Pressure');
    expect(card).toHaveTextContent('Preventive');
    // Not a Super Admin: no edit pencil on the card.
    expect(within(card).queryByRole('button', { name: /Edit stage details/ })).toBeNull();
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByTestId('stage-details')).toBeNull();
  });
});

describe('Stage Approvals — permissions and segregation of duties', () => {
  it('a viewer without STAGE_APPROVAL_DECIDE sees the queue but no Approve / Reject, single or bulk', async () => {
    open(VIEWER);
    await screen.findByText('FLT-a');
    expect(screen.queryByRole('button', { name: 'Verify & Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve Selected/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Reject Selected/ })).toBeNull();
  });

  it('the performer of a stage gets no buttons, a disabled checkbox and a note naming the approver role', async () => {
    open();
    await screen.findByText('FLT-self');
    const self = rowEl('FLT-self');
    expect(within(self).queryByRole('button', { name: 'Verify & Approve' })).toBeNull();
    expect(within(self).queryByRole('button', { name: 'Reject' })).toBeNull();
    // The role by its display name from /api/roles/active, not the code (2026-10-24).
    expect(await within(self).findByText('You performed this stage — another Quality Assurance must sign off.')).toBeInTheDocument();
    expect(within(self).getByRole('checkbox', { name: 'Select FLT-self' })).toBeDisabled();
    // The decidable rows keep their buttons.
    expect(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' })).toBeEnabled();
  });

  it('Select all selects only the rows this reader may decide; the bulk POST never carries a self-performed row', async () => {
    const { api } = open(DECIDER, routes([A, B, SELF], ARCHIVE, [
      { method: 'POST', path: '/api/stage-approvals/bulk-decide', body: (req: MockRequest) => ({ results: req.json.ids.map((id: string) => ({ id, status: 'ok' })) }) },
    ]));
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select FLT-self' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    const dlg = screen.getByRole('heading', { name: 'Approve 2 stages' }).closest('.bg-white') as HTMLElement;
    expect(dlg).toHaveTextContent('Your password signs all 2 approvals below.');
    expect(within(dlg).getByText('FLT-a')).toBeInTheDocument();
    expect(within(dlg).getByText('FLT-b')).toBeInTheDocument();
    expect(within(dlg).queryByText('FLT-self')).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Approve 2' }));
    await okDialog('Done', '2 stages approved');
    const [post] = api.calls('POST', '/api/stage-approvals/bulk-decide');
    expect(post.json).toEqual({ ids: ['a', 'b'], action: 'approve', remarks: REMARKS });
    // The queue re-reads after the decision and the selection is cleared.
    await waitFor(() => expect(api.calls('GET', '/api/stage-approvals/queue').length).toBeGreaterThan(1));
    expect(screen.getByText('Select all')).toBeInTheDocument();
  });

  it('a partial selection reads as indeterminate; Select all on a full selection clears it; Clear empties it', async () => {
    open();
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    const all = screen.getByRole('checkbox', { name: '1 selected' }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' })); // untick again
    expect(await screen.findByText('Select all')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '2 selected' }));
    expect(await screen.findByText('Select all')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByText('Select all')).toBeInTheDocument();
    // Switching tabs drops the selection too.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: /To Action/ }));
    expect(await screen.findByText('Select all')).toBeInTheDocument();
  });
});

describe('Stage Approvals — single decision', () => {
  it('Verify & Approve shows the frozen filter details and the stage evidence, then POSTs approve and refreshes', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [{ method: 'POST', path: '/api/stage-approvals/a/approve', body: { ok: true } }]));
    await screen.findByText('FLT-a');
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    expect(screen.getByRole('heading', { name: 'Verify & approve stage' })).toBeInTheDocument();
    expect(screen.getByText('Wash Out — FLT-a')).toBeInTheDocument();
    for (const [label, value] of [['Micron Size', '5'], ['Filter Type', 'HEPA'], ['Filter Dimensions', '610x610'], ['Filter Set', 'Set A']]) {
      expect(screen.getByText(label).nextSibling).toHaveTextContent(value);
    }
    expect(screen.getByTestId('stage-details')).toHaveTextContent('Cleaned by');
    expect(screen.getByPlaceholderText('What was checked (required)')).toBeInTheDocument();
    expect(screen.queryByText(/Rejecting sends this filter back/)).toBeNull();
    // an approval needs remarks too (D03-13): fewer than 3 characters sends nothing
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: ' ok ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await okDialog('Remarks required', 'Add at least 3 characters.');
    expect(api.calls('POST', '/api/stage-approvals/a/approve')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: `  ${REMARKS}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await okDialog('Done', 'Cleaning stage approved');
    expect(api.calls('POST', '/api/stage-approvals/a/approve')[0].json).toEqual({ remarks: REMARKS });
    expect(screen.queryByRole('heading', { name: 'Verify & approve stage' })).toBeNull();
    await waitFor(() => expect(api.calls('GET', '/api/stage-approvals/queue').length).toBeGreaterThan(1));
    await waitFor(() => expect(api.calls('GET', '/api/stage-approvals').length).toBeGreaterThan(1));
  });

  it('Reject requires 3+ characters of remarks, says where the filter goes back to, and sends the trimmed reason', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [{ method: 'POST', path: '/api/stage-approvals/b/reject', body: { ok: true } }]));
    await screen.findByText('FLT-b');
    fireEvent.click(within(rowEl('FLT-b')).getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('heading', { name: 'Reject stage' })).toBeInTheDocument();
    expect(screen.getByText(/Rejecting sends this filter back to/)).toHaveTextContent('Dry In');
    // No stage details on this row: the card says so rather than rendering blank.
    expect(screen.queryByTestId('stage-details')).toBeNull();
    const box = screen.getByPlaceholderText('Reason for rejection (required)');
    fireEvent.change(box, { target: { value: ' x ' } });
    fireEvent.click(within(dlgOf('Reject stage')).getByRole('button', { name: 'Reject' }));
    await okDialog('Remarks required', 'Add at least 3 characters.');
    expect(api.calls('POST', '/api/stage-approvals/b/reject')).toHaveLength(0);
    fireEvent.change(box, { target: { value: '  Filter still damp  ' } });
    fireEvent.click(within(dlgOf('Reject stage')).getByRole('button', { name: 'Reject' }));
    await okDialog('Done', 'Cleaning stage rejected');
    expect(api.calls('POST', '/api/stage-approvals/b/reject')[0].json).toEqual({ remarks: 'Filter still damp' });
  });

  it('a server refusal is shown and the dialog stays open for another try', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [
      { method: 'POST', path: '/api/stage-approvals/a/approve', status: 403, times: 1, body: { error: 'SELF_APPROVAL_FORBIDDEN', message: 'You performed this stage' } },
      { method: 'POST', path: '/api/stage-approvals/a/approve', status: 500, body: {} },
    ]));
    await screen.findByText('FLT-a');
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await okDialog('Failed', 'You performed this stage');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    // A refusal with no message still says something.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await okDialog('Failed', 'Request failed: 500');
    expect(api.calls('POST', '/api/stage-approvals/a/approve')).toHaveLength(2);
  });

  it('with the approve row on, the password prompt signs the request', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [{ method: 'POST', path: '/api/stage-approvals/a/approve', body: { ok: true } }], ['APPROVE_CLEANING_STAGE']));
    await screen.findByText('FLT-a');
    await waitReauthConfig(api);
    await waitFor(() => {}); // let the my-actions answer land in SWR
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.change(screen.getByPlaceholderText('What was checked (required)'), { target: { value: 'checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await passReauth();
    await okDialog('Done', 'Cleaning stage approved');
    const [post] = api.calls('POST', '/api/stage-approvals/a/approve');
    expectSigned(post);
    expect(post.json.remarks).toBe('checked');
  });

  it('a server that demands re-auth anyway (stale config) gets the prompt retroactively', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [
      reauthOnce('POST', '/api/stage-approvals/b/approve'),
      { method: 'POST', path: '/api/stage-approvals/b/approve', body: { ok: true } },
    ]));
    await screen.findByText('FLT-b');
    fireEvent.click(within(rowEl('FLT-b')).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await passReauth();
    await okDialog('Done', 'Cleaning stage approved');
    const posts = api.calls('POST', '/api/stage-approvals/b/approve');
    expect(posts).toHaveLength(2);
    expectSigned(posts[1]);
  });

  it('cancelling the password prompt sends nothing and re-enables the dialog', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [], ['REJECT_CLEANING_STAGE']));
    await screen.findByText('FLT-a');
    await waitReauthConfig(api);
    await waitFor(() => {});
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByPlaceholderText('Reason for rejection (required)'), { target: { value: 'too wet' } });
    fireEvent.click(within(dlgOf('Reject stage')).getByRole('button', { name: 'Reject' }));
    await screen.findByPlaceholderText('Enter your password');
    reauthCancel();
    // A dismissed prompt is not a failure: no message at all (D-OPS-8).
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(api.calls('POST', /\/reject$/)).toHaveLength(0);
    expect(within(dlgOf('Reject stage')).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('Cancel and a backdrop click close the decision dialog; a click inside it does not', async () => {
    open();
    await screen.findByText('FLT-a');
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    const heading = screen.getByRole('heading', { name: 'Verify & approve stage' });
    fireEvent.click(heading); // inside: stays
    expect(screen.getByRole('heading', { name: 'Verify & approve stage' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Verify & approve stage' })).toBeNull();
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Reject' }));
    const backdrop = screen.getByRole('heading', { name: 'Reject stage' }).closest('.fixed') as HTMLElement;
    fireEvent.click(backdrop);
    expect(screen.queryByRole('heading', { name: 'Reject stage' })).toBeNull();
  });
});

describe('Stage Approvals — bulk decisions', () => {
  const bulk = (results: (ids: string[]) => any[]) => ({
    method: 'POST', path: '/api/stage-approvals/bulk-decide', body: (req: MockRequest) => ({ results: results(req.json.ids) }),
  });

  it('a bulk reject needs remarks, explains the send-back, and applies one reason to all', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [bulk((ids) => ids.map((id) => ({ id, status: 'ok' })))]));
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject Selected (1)' }));
    expect(screen.getByRole('heading', { name: 'Reject 1 stage' })).toBeInTheDocument();
    expect(screen.getByText('Your password signs all 1 approval below.')).toBeInTheDocument();
    expect(screen.getByText(/Each filter is sent back to its prior cleaning stage/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reject 1' }));
    await okDialog('Remarks required', 'Add at least 3 characters.');
    expect(api.calls('POST', '/api/stage-approvals/bulk-decide')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Reason for rejection (required, applies to all)'), { target: { value: 'Dirty' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject 1' }));
    await okDialog('Done', '1 stage rejected');
    expect(api.calls('POST', '/api/stage-approvals/bulk-decide')[0].json).toEqual({ ids: ['a'], action: 'reject', remarks: 'Dirty' });
  });

  it('a partly failed run names the failures; a wholly failed run says none were decided', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [
      { ...bulk((ids) => ids.map((id) => (id === 'b' ? { id, status: 'failed', error: { message: 'stale' } } : { id, status: 'ok' }))), times: 1 },
      bulk((ids) => ids.map((id) => ({ id, status: 'failed' }))),
    ]));
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.change(screen.getByPlaceholderText('What was checked (required, applies to all)'), { target: { value: 'checked' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    await okDialog('Partially done', '1 approved, 1 failed: FLT-b');
    expect(api.calls('POST', '/api/stage-approvals/bulk-decide')[0].json.remarks).toBe('checked');

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    await okDialog('Failed', 'None approved: FLT-a, FLT-b');
  });

  it('a failed item that is no longer in the queue is named by its id', async () => {
    open(DECIDER, routes(undefined, undefined, [bulk(() => [{ id: 'ghost', status: 'failed' }])]));
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1' }));
    // ok = selected - failed = 0, so it reads as a total failure.
    await okDialog('Failed', 'None approved: ghost');
  });

  it('a transport failure keeps the bulk dialog open; a server answer without results counts as all done', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [
      { method: 'POST', path: '/api/stage-approvals/bulk-decide', status: 400, times: 1, body: { error: 'BAD', message: 'ids too long' } },
      { method: 'POST', path: '/api/stage-approvals/bulk-decide', body: {} },
    ]));
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1' }));
    await okDialog('Failed', 'ids too long');
    expect(screen.getByRole('heading', { name: 'Approve 1 stage' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve 1' }));
    await okDialog('Done', '1 stage approved');
    expect(api.calls('POST', '/api/stage-approvals/bulk-decide')).toHaveLength(2);
  });

  it('with the row on, ONE password signs the whole batch', async () => {
    const { api } = open(DECIDER, routes(undefined, undefined, [bulk((ids) => ids.map((id) => ({ id, status: 'ok' })))], ['APPROVE_CLEANING_STAGE']));
    await screen.findByText('FLT-a');
    await waitReauthConfig(api);
    await waitFor(() => {});
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    await passReauth();
    await okDialog('Done', '2 stages approved');
    const posts = api.calls('POST', '/api/stage-approvals/bulk-decide');
    expect(posts).toHaveLength(1);
    expectSigned(posts[0]);
  });

  it('more than 200 selected is refused before any request (the server cap)', async () => {
    const many = Array.from({ length: 201 }, (_, i) => row(`m${i}`, { stageDetails: null }));
    const { api } = open(DECIDER, routes(many, []));
    await screen.findByText('FLT-m0');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (201)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 201' }));
    await okDialog('Too many selected', 'Approve/reject at most 200 at a time.');
    expect(api.calls('POST', '/api/stage-approvals/bulk-decide')).toHaveLength(0);
  }, 120_000); // 201 rendered rows: slow under coverage on a loaded machine

  it('Cancel and the backdrop close the bulk dialog', async () => {
    open();
    await screen.findByText('FLT-a');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('heading', { name: 'Approve 1 stage' }));
    expect(screen.getByRole('heading', { name: 'Approve 1 stage' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Approve 1 stage' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reject Selected (1)' }));
    fireEvent.click(screen.getByRole('heading', { name: 'Reject 1 stage' }).closest('.fixed') as HTMLElement);
    expect(screen.queryByRole('heading', { name: 'Reject 1 stage' })).toBeNull();
  });
});

describe('Stage Approvals — Super Admin edits', () => {
  it('the approval record editor PUTs only the changed fields with the reason; "clear" empties the decider', async () => {
    const { api } = open(SA, routes([A], ARCHIVE, [
      { method: 'PUT', path: '/api/super-admin/filter-data/stage-approvals/ok', body: (req: MockRequest) => ({ id: 'ok', ...req.json }) },
    ]));
    await screen.findByText('FLT-a');
    // No unrelated reads, and the SA-only lists are fetched for the pickers.
    await waitFor(() => expect(api.calls('GET', '/api/roles')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    await screen.findByText('FLT-ok');
    fireEvent.click(within(rowEl('FLT-ok')).getByRole('button', { name: 'Edit approval record (Super Admin)' }));
    const dlg = screen.getByRole('dialog', { name: 'Edit stage approval - FLT-ok' });
    expect(dlg).toHaveTextContent('Wash Out · attempt 1');
    expect(within(dlg).getByLabelText(/Approver role/)).toHaveDisplayValue('Quality (QA)');
    expect(within(dlg).getByLabelText(/Decided by/)).toHaveDisplayValue('-- keep current (qa1) --');
    fireEvent.change(within(dlg).getByLabelText(/Decided by/), { target: { value: '__clear__' } });
    fireEvent.change(within(dlg).getByLabelText(/^Status/), { target: { value: 'PENDING' } });
    fireEvent.change(within(dlg).getByLabelText(/Decided at/), { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Wrong approver recorded' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await okDialog('Stage approval updated', 'Recorded in the audit trail');
    const [put] = api.calls('PUT', '/api/super-admin/filter-data/stage-approvals/ok');
    expect(put.json).toEqual({ status: 'PENDING', decidedBy: '', decidedAt: '', _changeReason: 'Wrong approver recorded' });
    expect(screen.queryByRole('dialog', { name: 'Edit stage approval - FLT-ok' })).toBeNull();
  });

  it('with SUPER_ADMIN_DATA_EDIT on, the record save is signed; Close abandons the editor', async () => {
    const { api } = open(SA, routes([A], [], [
      { method: 'PUT', path: '/api/super-admin/filter-data/stage-approvals/a', body: { id: 'a' } },
    ], ['SUPER_ADMIN_DATA_EDIT']));
    await screen.findByText('FLT-a');
    await waitReauthConfig(api);
    await waitFor(() => {});
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Edit approval record (Super Admin)' }));
    let dlg = screen.getByRole('dialog', { name: 'Edit stage approval - FLT-a' });
    expect(within(dlg).getByLabelText(/Requested by/)).toHaveDisplayValue('-- keep current (opr1) --');
    expect(within(dlg).getByLabelText(/Decided by/)).toHaveDisplayValue('-- keep current (none) --');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Edit stage approval - FLT-a' })).toBeNull();

    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Edit approval record (Super Admin)' }));
    dlg = screen.getByRole('dialog', { name: 'Edit stage approval - FLT-a' });
    fireEvent.change(within(dlg).getByLabelText(/Decision remarks/), { target: { value: 'note' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Add the missing note' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await passReauth();
    await okDialog('Stage approval updated');
    const [put] = api.calls('PUT', '/api/super-admin/filter-data/stage-approvals/a');
    expectSigned(put);
    expect(put.json.decisionRemarks).toBe('note');
  });

  it('the stage-details pencil loads the cycle and opens the cycle editor on just this stage\'s events', async () => {
    const cycle = {
      id: 'cyc-a', status: 'IN_PROGRESS', startedAt: AT,
      events: [
        { id: 'e1', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: AT, attributes: {} },
        { id: 'e2', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: AT, attributes: {} },
        { id: 'e3', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'WASH_IN', performedAt: AT, attributes: { kind: 'STAGE_INTERLOCK_REJECTED' } },
      ],
    };
    const { api } = open(SA, routes([A], [], [{ path: '/api/filters/cycles/cyc-a', body: cycle }]));
    await screen.findByText('FLT-a');
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit stage details (Super Admin)' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit Wash Out stage details - FLT-a' });
    expect(api.calls('GET', '/api/filters/cycles/cyc-a')).toHaveLength(1);
    // Two wash steps, the interlock reject row left out.
    expect(within(dlg).getAllByText(/WASH_IN|WASH_OUT|Wash In|Wash Out/).length).toBeGreaterThan(0);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Edit Wash Out stage details - FLT-a' })).toBeNull();
  });

  it('a row with no cycle, or a cycle that will not load, says why instead of opening an empty editor', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const noCycle = row('nc', { cycleId: null });
    open(SA, routes([noCycle, A], [], [{ path: '/api/filters/cycles/cyc-a', status: 500, body: { error: 'X', message: 'cycle read failed' } }]));
    await screen.findByText('FLT-nc');
    fireEvent.click(within(rowEl('FLT-nc')).getByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit stage details (Super Admin)' }));
    await okDialog('No cycle', 'This approval is not bound to a cleaning cycle.');
    fireEvent.click(within(rowEl('FLT-nc')).getByRole('button', { name: 'Hide details' }));
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit stage details (Super Admin)' }));
    await okDialog('Failed', 'cycle read failed');
    expect(screen.queryByRole('dialog', { name: /stage details - FLT-a/ })).toBeNull();
  });
});

describe('Stage Approvals — rows without a filter name, plural reject, cycle-editor save', () => {
  const nameless = row('nn', { detailsSnapshot: { ...snap(''), filterName: null } });

  it('a row whose snapshot has no filter name is named by its filter id everywhere', async () => {
    open(SA, routes([nameless, A], []));
    expect(await screen.findByText('f-nn')).toBeInTheDocument();
    const r = screen.getByText('f-nn').closest('div.grid') as HTMLElement;
    fireEvent.click(within(r).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    expect(screen.getByText('Wash Out — f-nn')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select f-nn' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject Selected (2)' }));
    expect(screen.getByRole('heading', { name: 'Reject 2 stages' })).toBeInTheDocument();
    expect(within(dlgOf('Reject 2 stages')).getByText('f-nn')).toBeInTheDocument();
    fireEvent.click(within(dlgOf('Reject 2 stages')).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(r).getByRole('button', { name: 'Edit approval record (Super Admin)' }));
    expect(screen.getByRole('dialog', { name: 'Edit stage approval - f-nn' })).toBeInTheDocument();
  });

  it('a failed item of a nameless row is reported by its filter id', async () => {
    open(DECIDER, routes([nameless, A], [], [{ method: 'POST', path: '/api/stage-approvals/bulk-decide', body: (req: MockRequest) => ({ results: req.json.ids.map((id: string) => ({ id, status: id === 'nn' ? 'failed' : 'ok' })) }) }]));
    await screen.findByText('f-nn');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (2)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve 2' }));
    await okDialog('Partially done', '1 approved, 1 failed: f-nn');
  });

  it('saving the stage details from the cycle editor writes the audited cycle PUT and confirms', async () => {
    const cycle = { id: 'cyc-a', status: 'IN_PROGRESS', cleaningReasonLabel: 'Preventive', startedAt: AT };
    const { api } = open(SA, routes([A], [], [
      { path: '/api/filters/cycles/cyc-a', body: cycle },
      { method: 'PUT', path: '/api/super-admin/data/cleaning-cycles/cyc-a', body: { ok: true } },
    ]));
    await screen.findByText('FLT-a');
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Details' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit stage details (Super Admin)' }));
    const dlg = await screen.findByRole('dialog', { name: 'Edit Wash Out stage details - FLT-a' });
    // A cycle that came back without events edits the cycle row only.
    const reasonInput = within(dlg).getByText('Cleaning reason').parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(reasonInput, { target: { value: 'Breakdown' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Reason was mis-keyed' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await okDialog('Stage details updated', 'Recorded in the audit trail');
    expect(api.calls('PUT', '/api/super-admin/data/cleaning-cycles/cyc-a')[0].json).toEqual({ cleaningReasonLabel: 'Breakdown', _changeReason: 'Reason was mis-keyed' });
    expect(screen.queryByRole('dialog', { name: 'Edit Wash Out stage details - FLT-a' })).toBeNull();
  });
});

describe('Stage Approvals — tablet back button (overlayBackRef)', () => {
  it('closes the topmost thing first and returns false when nothing is open; cleared on unmount', async () => {
    const ref = createRef<(() => boolean) | null>() as MutableRefObject<(() => boolean) | null>;
    const { unmount } = open(DECIDER, routes(), ref);
    await screen.findByText('FLT-a');
    expect(pressBack(ref)).toBe(false);

    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' }));

    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    expect(pressBack(ref)).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Verify & approve stage' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select FLT-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve Selected (1)' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    expect(pressBack(ref)).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Approve 1 stage' })).toBeNull();

    unmount();
    expect(ref.current).toBeNull();
  });

  it('cancels an open password prompt first; swallows back while a Super Admin editor is open', async () => {
    const ref = createRef<(() => boolean) | null>() as MutableRefObject<(() => boolean) | null>;
    const api = routes([A], [], [], ['APPROVE_CLEANING_STAGE']);
    open(SA, api, ref);
    await screen.findByText('FLT-a');
    await waitReauthConfig(api);
    await waitFor(() => {});
    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Verify & Approve' }));
    fireEvent.change(screen.getByLabelText(/Remarks/), { target: { value: REMARKS } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByPlaceholderText('Enter your password');
    expect(pressBack(ref)).toBe(true);
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    // The cancel is silent (D-OPS-8): no message to dismiss.
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    // The decision dialog is still there, re-enabled; back closes it next.
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(pressBack(ref)).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Verify & approve stage' })).toBeNull();

    fireEvent.click(within(rowEl('FLT-a')).getByRole('button', { name: 'Edit approval record (Super Admin)' }));
    expect(pressBack(ref)).toBe(true);
    // Swallowed, not closed: the editor holds unsaved input.
    expect(screen.getByRole('dialog', { name: 'Edit stage approval - FLT-a' })).toBeInTheDocument();
  });
});
