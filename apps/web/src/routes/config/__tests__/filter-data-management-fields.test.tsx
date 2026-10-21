/**
 * Field wiring: each dialog input must land on its own key in the request body
 * (a label wired to the wrong state key silently writes the wrong column of a
 * §11 record), plus the edge rows the list renderers fall back on.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { RequireRole } from '@/components/require-role';
import { FilterDataManagementPage } from '../filter-data-management';
import { SUPER_ADMIN, resetEnv, ackMessage } from './config-test-helpers';
import { renderFdm, baseRoutes, modal, field, setField, typeReason, click, row, waitForCalls, openTab } from './fdm-helpers';

afterEach(resetEnv);

const SA_CYCLES = '/api/super-admin/data/cleaning-cycles';
const SA_EVENTS = '/api/super-admin/data/filter-events';
const HIER = { path: '/api/hierarchy/filters', body: { data: [{ id: 'f1', name: 'FLT-1' }] } };

describe('Cleaning cycle dialogs — every field reaches its column', () => {
  const C = {
    id: 'c1', cycleCode: 'CYC-1', filterId: 'f1', filterName: 'FLT-1', status: 'COMPLETED', cleaningReasonLabel: 'PM', sequenceNumber: 1,
    startedAt: '2026-07-01T08:00:00.000Z', completedAt: '2026-07-01T09:00:00.000Z', dryerStartedAt: '2026-07-01T08:30:00.000Z',
    events: [
      // Readings on an event with no toState (grouped under its event type), one with no description/uom, one with no value.
      { id: 'ex', eventType: 'PARAMETER_CAPTURE', fromState: 'WASH_IN', toState: null, performedAt: '2026-07-01T08:10:00.000Z',
        attributes: { instrumentReadings: [{ instrumentId: 'i1', value: 4 }, { instrumentId: 'i2', description: 'Flow', uom: 'lpm' }] } },
    ],
  };

  it('edit: code, times, reason; a cleared number or reading is not sent / keeps the stored value', async () => {
    const api = renderFdm([
      { path: '/api/filters/cycles', body: { data: [C], total: 1 } }, HIER,
      { method: 'PUT', path: `${SA_CYCLES}/c1`, body: {} },
      { method: 'PUT', path: `${SA_EVENTS}/ex`, body: {} },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-1');
    await click(within(row('FLT-1')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    // Grouped under the event type when the event has no to-state.
    expect(within(dlg).getByText('PARAMETER_CAPTURE')).toBeInTheDocument();
    expect(field(dlg, 'Reading').value).toBe('4');
    expect(field(dlg, 'Flow (lpm)').value).toBe('');
    setField(dlg, 'Cycle Code', 'CYC-1A');
    setField(dlg, 'Cleaning Reason', 'Breakdown');
    setField(dlg, 'Started At', '2026-07-01T07:55');
    setField(dlg, 'Completed At', '2026-07-01T09:05');
    setField(dlg, 'Dryer Started At', '2026-07-01T08:31');
    setField(dlg, 'Sequence Number', '');
    setField(dlg, 'Reading', '');
    setField(dlg, 'Flow (lpm)', '12');
    typeReason(dlg, 'Times re-keyed');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_CYCLES}/c1`, 1);
    expect(put.json).toEqual({
      cycleCode: 'CYC-1A', status: 'COMPLETED', cleaningReasonLabel: 'Breakdown',
      startedAt: '2026-07-01T07:55:00.000Z', completedAt: '2026-07-01T09:05:00.000Z', dryerStartedAt: '2026-07-01T08:31:00.000Z',
      _changeReason: 'Times re-keyed',
    });
    // The cleared reading is kept as stored; the Flow value (which had none) is written.
    const [ev] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/ex`, 1);
    expect(ev.json.attributes.instrumentReadings).toEqual([{ instrumentId: 'i1', value: 4 }, { instrumentId: 'i2', description: 'Flow', uom: 'lpm', value: 12 }]);
    await ackMessage('Updated');
  });

  it('create: cycle code, termination fields, dryer start; a profile without a name is listed by id', async () => {
    const api = renderFdm([
      { path: '/api/filters/cycles', body: { data: [C], total: 1 } }, HIER,
      { path: '/api/filter-cleaning-profiles', body: { data: [{ id: 'prof-x' }] } },
      { method: 'POST', path: SA_CYCLES, body: {} },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-1');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Cleaning Cycle');
    await waitFor(() => expect(within(field(dlg, 'Cleaning Profile') as any).getByRole('option', { name: 'prof-x' })).toBeInTheDocument());
    setField(dlg, 'Status', 'TERMINATED');
    setField(dlg, 'Cycle Code', 'CYC-OLD');
    setField(dlg, 'Terminated At', '2026-05-01T10:00');
    setField(dlg, 'Termination Reason', 'Power cut');
    setField(dlg, 'Dryer Started At', '2026-05-01T09:30');
    typeReason(dlg, 'Paper record backfill');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', SA_CYCLES, 1);
    expect(post.json).toEqual({
      status: 'TERMINATED', cycleCode: 'CYC-OLD', terminatedAt: '2026-05-01T10:00:00.000Z', terminationReason: 'Power cut',
      dryerStartedAt: '2026-05-01T09:30:00.000Z', _changeReason: 'Paper record backfill',
    });
  });

  it('the Filter picker says "Loading…" while the hierarchy is still in flight', async () => {
    const api = mockApi([{ path: '/api/filters/cycles', body: { data: [C], total: 1 } }, { path: '/api/filter-cleaning-profiles', body: { data: [] } }, ...baseRoutes()]);
    const stubbed = globalThis.fetch;
    vi.stubGlobal('fetch', (input: any, init?: any) => (String(typeof input === 'string' ? input : input.url).includes('/api/hierarchy/filters')
      ? new Promise(() => {}) : (stubbed as any)(input, init)));
    renderPage(<RequireRole roles={[]}><FilterDataManagementPage /></RequireRole>, { user: SUPER_ADMIN, api });
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-1');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Cleaning Cycle');
    expect((field(dlg, 'Filter') as unknown as HTMLSelectElement).options[0].textContent).toBe('Loading…');
  });
});

describe('Cleaning cycles — rows with missing identity', () => {
  const BARE = { id: 'cb', filterId: 'zz', status: 'COMPLETED', startedAt: '2026-07-01T08:00:00.000Z', completedAt: '2026-07-01T08:10:00.000Z' };
  const STEP = {
    id: 'cs', cycleCode: 'CYC-S', filterId: 'f1', filterName: 'FLT-S', status: 'COMPLETED', startedAt: '2026-07-01T08:00:00.000Z', completedAt: '2026-07-01T08:10:00.000Z',
    events: [{ id: 'st1', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: null, performedAt: '2026-07-01T08:05:00.000Z', performedBy: 'u1', remarks: 'half step',
      attributes: { instrumentReadings: [{ instrumentId: 'i9', description: 'Pressure', value: 3, uom: 'bar' }] } }],
  };

  it('a cycle with no code and no filter name reads "-" in the list and "Cycle" in its dialogs; no events -> empty lifecycle', async () => {
    renderFdm([{ path: '/api/filters/cycles', body: { data: [BARE], total: 1 } }, HIER]);
    await openTab('Cleaning Cycles');
    const r = await screen.findByText('10m').then((el) => el.closest('tr') as HTMLElement);
    expect(within(r).getAllByRole('cell')[1].textContent).toBe('-');
    expect(within(r).getByRole('button', { name: /Lifecycle/ })).toHaveTextContent('(0)');
    await click(within(r).getByRole('button', { name: /Lifecycle/ }));
    expect(screen.getByText('This cycle has no recorded stage events yet.')).toBeInTheDocument();
    await click(within(r).getByRole('button', { name: /Edit/ }));
    expect(modal('Edit Cleaning Cycle')).toHaveTextContent('Cycle');
    await click(within(modal('Edit Cleaning Cycle')).getByRole('button', { name: 'Cancel' }));
    await click(within(r).getByRole('button', { name: /Delete/ }));
    expect(modal('Permanent Deletion')).toHaveTextContent('Cycle will be permanently removed');
  });

  it('editing a lifecycle step opens the SAME event dialog and saves through the filter-events endpoint', async () => {
    const api = renderFdm([
      { path: '/api/filters/cycles', body: { data: [STEP], total: 1 } }, HIER,
      { path: '/api/users', body: { data: [{ id: 'u1', username: 'op1' }] } },
      { method: 'PUT', path: `${SA_EVENTS}/st1`, body: {} },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-S');
    await click(within(row('FLT-S')).getByRole('button', { name: /Lifecycle/ }));
    const panel = screen.getByText('Lifecycle · CYC-S').closest('div.rounded-xl') as HTMLElement;
    // From-state only: the missing to-state reads "—".
    expect(panel).toHaveTextContent('WASH_OUT → —');
    expect(panel).toHaveTextContent('“half step”');
    expect(panel).toHaveTextContent('Pressure: 3 bar');
    await click(within(panel).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Filter Event');
    expect(dlg).toHaveTextContent('STATE_TRANSITION · CYC-S');
    await waitFor(() => expect(within(field(dlg, 'Performed By') as any).getByRole('option', { name: 'op1 (op1)' })).toBeInTheDocument());
    setField(dlg, 'Performed At', '2026-07-01T08:06');
    setField(dlg, 'Pressure (bar)', '');
    typeReason(dlg, 'Stage time correction');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/st1`, 1);
    expect(put.json).toEqual({
      eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', performedAt: '2026-07-01T08:06:00.000Z', performedBy: 'u1', remarks: 'half step',
      // A cleared reading keeps the stored value and its instrument identity.
      attributes: { instrumentReadings: [{ instrumentId: 'i9', description: 'Pressure', value: 3, uom: 'bar' }] },
      _changeReason: 'Stage time correction',
    });
    expect(api.calls('PUT', new RegExp(SA_CYCLES))).toHaveLength(0);
    await ackMessage('Updated');
  });

  it('a lifecycle step with no cycle code titles the dialog with the event type alone', async () => {
    const noCode = { ...STEP, cycleCode: null };
    renderFdm([{ path: '/api/filters/cycles', body: { data: [noCode], total: 1 } }, HIER, { path: '/api/users', body: { data: [] } }]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-S');
    await click(within(row('FLT-S')).getByRole('button', { name: /Lifecycle/ }));
    await click(within(screen.getByText('Lifecycle · FLT-S').closest('div.rounded-xl') as HTMLElement).getByRole('button', { name: 'Edit' }));
    expect(modal('Edit Filter Event').querySelector('p.text-\\[12px\\]')!.textContent).toBe('STATE_TRANSITION · ');
  });

  it('an event-tab reading with no value seeds an empty input and is left as stored when blank', async () => {
    const api = renderFdm([
      { path: '/api/filters/events', body: { data: [{ id: 'ev9', eventType: 'PARAMETER_CAPTURE', performedAt: '2026-07-01T08:00:00.000Z', remarks: 'r9', attributes: { instrumentReadings: [{ instrumentId: 'q', description: 'Temp' }] } }] } },
      { path: '/api/users', body: { data: [] } },
      { method: 'PUT', path: `${SA_EVENTS}/ev9`, body: {} },
    ]);
    await openTab('Filter Events');
    await screen.findByText('r9');
    await click(within(screen.getByText('r9').closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Filter Event');
    expect(field(dlg, 'Temp').value).toBe('');
    typeReason(dlg, 'Remark re-audit');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/ev9`, 1);
    expect(put.json.attributes).toEqual({ instrumentReadings: [{ instrumentId: 'q', description: 'Temp' }] });
  });
});

describe('PM / notification / admin / block-change / audit dialogs — field wiring', () => {
  it('PM entry edit: planned date, window start, approval status and remarks', async () => {
    const api = renderFdm([
      { path: '/api/super-admin/data/pm-entries', body: { data: [{ id: 'pm1', month: 5, plannedDate: '2026-05-10T00:00:00.000Z', approvalStatus: 'PENDING' }, { id: 'pm6' }] } },
      { method: 'PUT', path: '/api/super-admin/data/pm-entries/pm1', body: {} },
      { method: 'DELETE', path: '/api/super-admin/data/pm-entries/pm6', body: {} },
    ]);
    await openTab('PM Entries');
    const card = (await screen.findByText(/^May/, { selector: 'span.text-lg' })).closest('div.group') as HTMLElement;
    await click(within(card).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit PM Entry');
    setField(dlg, 'Planned Date', '2026-05-12T00:00');
    setField(dlg, 'Window Start', '2026-05-05T00:00');
    setField(dlg, 'Approval Status', 'REJECTED');
    setField(dlg, 'Approval Remarks', 'clash with shutdown');
    typeReason(dlg, 'Reschedule visit');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', '/api/super-admin/data/pm-entries/pm1', 1);
    expect(put.json).toEqual({
      month: 5, plannedDate: '2026-05-12T00:00:00.000Z', windowStart: '2026-05-05T00:00:00.000Z',
      approvalStatus: 'REJECTED', approvalRemarks: 'clash with shutdown', _changeReason: 'Reschedule visit',
    });
    await ackMessage('Updated');
    // An entry with no month is named "Jan entry" (month defaults to 1) on delete.
    const jan = screen.getByText(/^Jan/, { selector: 'span.text-lg' }).closest('div.group') as HTMLElement;
    await click(within(jan).getByRole('button', { name: /Delete/ }));
    expect(modal('Permanent Deletion')).toHaveTextContent('Jan entry will be permanently removed');
  });

  it('notification edit: type, title, target user and role', async () => {
    const api = renderFdm([
      { path: '/api/super-admin/data/notifications', body: { data: [{ id: 'n1', type: 'USER_CREATED', title: 'T', message: 'M', isRead: false, createdAt: '2026-07-01T00:00:00.000Z' }] } },
      { method: 'PUT', path: '/api/super-admin/data/notifications/n1', body: {} },
    ]);
    await openTab('Notifications');
    await screen.findByText('M');
    expect(within(screen.getByText('M').closest('div.group') as HTMLElement).getByText('USER CREATED').className).toContain('bg-indigo-50');
    await click(within(screen.getByText('M').closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Notification');
    setField(dlg, 'Type', 'USER_UPDATED');
    setField(dlg, 'Title', 'T2');
    setField(dlg, 'Target User ID', 'u-5');
    setField(dlg, 'For Role', 'ADMIN');
    typeReason(dlg, 'Retarget notice');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', '/api/super-admin/data/notifications/n1', 1);
    expect(put.json).toEqual({ type: 'USER_UPDATED', title: 'T2', message: 'M', targetUserId: 'u-5', forRole: 'ADMIN', isRead: false, _changeReason: 'Retarget notice' });
  });

  it('admin request edit: type and requester fields; a request missing type/name; create status', async () => {
    const api = renderFdm([
      { path: '/api/admin-requests', body: [
        { id: 'q1', requesterName: 'Jane', requestType: 'UNLOCK', status: 'PENDING', requestedAt: '2026-07-01T00:00:00.000Z' },
        { id: 'q2', requestedAt: '2026-07-02T00:00:00.000Z' },
      ] },
      { method: 'PUT', path: '/api/super-admin/data/admin-requests/q1', body: {} },
      { method: 'POST', path: '/api/super-admin/data/admin-requests', body: {} },
    ]);
    await openTab('Admin Requests');
    await screen.findByText('Jane');
    // Search tolerates rows with no name/type/employee id/status.
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'jane' } });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: '' } });

    await click(within(row('Jane')).getByRole('button', { name: 'Edit' }));
    let dlg = modal('Edit Admin Request');
    setField(dlg, 'Request Type', 'MODIFY_USER');
    setField(dlg, 'Requester Name', 'Jane D');
    setField(dlg, 'Requester Employee ID', 'E1');
    setField(dlg, 'Requester Email', 'j@x.test');
    setField(dlg, 'Requester Remarks', 'role change');
    typeReason(dlg, 'Processed offline');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', '/api/super-admin/data/admin-requests/q1', 1);
    expect(put.json).toEqual({
      requestType: 'MODIFY_USER', status: 'PENDING', requesterName: 'Jane D', requesterEmployeeId: 'E1', requesterEmail: 'j@x.test',
      remarks: 'role change', _changeReason: 'Processed offline',
    });
    await ackMessage('Updated');

    // The nameless row: blank fields in the edit dialog.
    const blank = screen.getAllByRole('row')[2];
    await click(within(blank).getByRole('button', { name: 'Edit' }));
    dlg = modal('Edit Admin Request');
    expect(field(dlg, 'Requester Name').value).toBe('');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));

    await click(screen.getByRole('button', { name: 'Create' }));
    dlg = modal('Create Admin Request');
    setField(dlg, 'Status', 'APPROVED');
    setField(dlg, 'Request Type', 'UNLOCK');
    setField(dlg, 'Requester Name', 'Kim');
    typeReason(dlg, 'Paper request');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', '/api/super-admin/data/admin-requests', 1);
    expect(post.json).toEqual({ status: 'APPROVED', requestType: 'UNLOCK', requesterName: 'Kim', _changeReason: 'Paper request' });
  });

  it('block change edit reason; create status and processed comment; search tolerates missing fields', async () => {
    const api = renderFdm([
      { path: '/api/block-change-requests', body: { data: [
        { id: 'b1', filterName: 'FLT-9', status: 'PENDING', reason: 'old', createdAt: '2026-07-01T00:00:00.000Z' },
        { id: 'b2', createdAt: '2026-07-02T00:00:00.000Z' },
      ] } },
      { path: '/api/hierarchy/filters', body: { data: [] } },
      { method: 'PUT', path: '/api/super-admin/data/block-change-requests/b1', body: {} },
      { method: 'POST', path: '/api/super-admin/data/block-change-requests', body: {} },
    ]);
    await openTab('Block Changes');
    await screen.findByRole('heading', { name: 'FLT-9' });
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'pending' } });
    expect(screen.getByRole('heading', { name: 'FLT-9' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '-' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: '' } });

    await click(within(screen.getByRole('heading', { name: 'FLT-9' }).closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    let dlg = modal('Edit Block Change Request');
    setField(dlg, 'Reason', 'new reason');
    typeReason(dlg, 'Reason clarified');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', '/api/super-admin/data/block-change-requests/b1', 1);
    expect(put.json).toEqual({ status: 'PENDING', reason: 'new reason', _changeReason: 'Reason clarified' });
    await ackMessage('Updated');

    await click(screen.getByRole('button', { name: 'Create' }));
    dlg = modal('Create Block Change Request');
    setField(dlg, 'Status', 'REJECTED');
    setField(dlg, 'Processed Comment', 'denied on paper');
    typeReason(dlg, 'Paper request');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', '/api/super-admin/data/block-change-requests', 1);
    expect(post.json).toEqual({ status: 'REJECTED', processedComment: 'denied on paper', _changeReason: 'Paper request' });
  });

  it('audit edit: user name, action, target and signature meaning; a row with no action', async () => {
    const api = renderFdm([
      { path: '/api/audit', body: { data: [
        { id: 'a1', timestamp: '2026-07-01T00:00:00.000Z', action: 'USER_CREATED', userId: 'admin' },
        { id: 'a0', timestamp: '2026-07-02T00:00:00.000Z', userId: 'ghost' },
      ] } },
      { method: 'PUT', path: '/api/audit/a1', body: {} },
    ]);
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    // Search tolerates a row with no action/target.
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'ghost' } });
    expect(screen.queryByText('USER_CREATED')).toBeNull();
    const ghost = screen.getByText('ghost').closest('tr') as HTMLElement;
    expect(within(ghost).getByText('Success')).toBeInTheDocument();
    await click(within(ghost).getByRole('button', { name: 'Edit' }));
    expect(field(modal('Edit audit record'), 'Action').value).toBe('');
    await click(within(modal('Edit audit record')).getByRole('button', { name: 'Cancel' }));
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: '' } });

    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit audit record');
    setField(dlg, 'User Name', 'Admin Two');
    setField(dlg, 'Action', 'USER_UPDATED');
    setField(dlg, 'Target Type', 'USER');
    setField(dlg, 'Target ID', 'u-77');
    setField(dlg, 'Signature Meaning', 'Approved');
    typeReason(dlg, 'Corrected the record');
    await click(within(dlg).getByRole('button', { name: 'Save & break chain' }));
    const [put] = await waitForCalls(api, 'PUT', '/api/audit/a1', 1);
    expect(put.json).toEqual({
      reason: 'Corrected the record', timestamp: '2026-07-01T00:00:00.000Z', userName: 'Admin Two', userRole: '',
      action: 'USER_UPDATED', targetType: 'USER', targetId: 'u-77', signatureMeaning: 'Approved',
    });
  });

  it('retirement edit of a filter with no set sends an empty filterSet', async () => {
    const api = renderFdm([{ method: 'PUT', path: '/api/super-admin/filter-data/retirements/r2', body: {} }]);
    await screen.findByText('FLT-002');
    await click(within(row('FLT-002')).getByRole('button', { name: /Edit/ }));
    const r = screen.getByDisplayValue('FLT-002').closest('tr') as HTMLElement;
    expect((within(r).getByRole('combobox') as HTMLSelectElement).value).toBe('');
    await click(within(r).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    typeReason(dlg, 'Re-audit only');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    const [put] = await waitForCalls(api, 'PUT', '/api/super-admin/filter-data/retirements/r2', 1);
    expect(put.json).toEqual({ name: 'FLT-002', filterSet: '', updatedAt: '2026-08-01T00:00:00.000Z', _changeReason: 'Re-audit only' });
  });
});
