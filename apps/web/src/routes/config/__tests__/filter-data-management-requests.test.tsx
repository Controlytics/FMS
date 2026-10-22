import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { resetEnv, signReauth, ackMessage } from './config-test-helpers';
import { renderFdm, modal, field, setField, typeReason, click, row, waitForCalls, openTab } from './fdm-helpers';

afterEach(resetEnv);

// First test of the file pays the page's cold render; under full-suite load the
// heaviest flow measured 2.7-5.6 s (CPU, no missing wait; 2026-10-22). Same limit as FDM cycles.
vi.setConfig({ testTimeout: 20_000 });

const NOTIF = '/api/super-admin/data/notifications';
const ADMIN_REQ = '/api/admin-requests';
const SA_ADMIN_REQ = '/api/super-admin/data/admin-requests';
const BCR = '/api/block-change-requests';
const SA_BCR = '/api/super-admin/data/block-change-requests';

describe('Notifications tab', () => {
  const N1 = { id: 'n1', type: 'CYCLE_COMPLETED', title: 'Cycle done', message: 'FLT-1 cleaned', targetUserId: 'user-42', forRole: 'OPERATOR', createdAt: '2026-07-01T10:00:00.000Z', readAt: '2026-07-01T11:00:00.000Z', isRead: true, manualEntry: true };
  const N2 = { id: 'n2', type: 'MYSTERY_TYPE', title: 'Hello', isRead: false, createdAt: '2026-07-02T10:00:00.000Z' };
  const N3 = { id: 'n3', type: null, title: null, message: null, isRead: false, createdAt: '2026-07-03T10:00:00.000Z' };
  const routes = (items: unknown[] = [N1, N2, N3]) => [{ path: NOTIF, body: { data: items } }];
  const ncard = (text: string) => screen.getByText(text).closest('div.group') as HTMLElement;

  it('renders the notification cards like /notifications, sends type filter to the server', async () => {
    const api = renderFdm(routes());
    await openTab('Notifications');
    await screen.findByText('Cycle done');
    expect(api.calls('GET', NOTIF)[0].query.get('limit')).toBe('20');
    const c1 = ncard('Cycle done');
    expect(c1).toHaveTextContent('CYCLE COMPLETED');
    expect(within(c1).getByText('CYCLE COMPLETED').className).toContain('bg-emerald-50');
    expect(c1).toHaveTextContent('Manual entry');
    expect(c1).toHaveTextContent('FLT-1 cleaned');
    expect(c1).toHaveTextContent('For: user-42');
    expect(c1).toHaveTextContent('Role: OPERATOR');
    expect(c1).toHaveTextContent('Read: 2026-07-01 11:00');
    expect(c1).not.toHaveTextContent('UNREAD');
    const c2 = ncard('Hello');
    expect(c2).toHaveTextContent('UNREAD');
    expect(within(c2).getByText('MYSTERY TYPE').className).toContain('bg-slate-50');
    expect(c2.className).toContain('border-cyan-300');
    // Header count falls back to the array length when the server gives no total.
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('3');

    const select = screen.getByText('Type', { selector: 'span' }).closest('label')!.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'PM_OVERDUE' } });
    await waitFor(() => expect(api.calls('GET', NOTIF).at(-1)!.query.get('type')).toBe('PM_OVERDUE'));
    expect(api.unmatched).toEqual([]);
  });

  it('search matches title, message, type and target user', async () => {
    renderFdm(routes());
    await openTab('Notifications');
    await screen.findByText('Cycle done');
    const s = screen.getByPlaceholderText('Search...');
    fireEvent.change(s, { target: { value: 'flt-1' } });
    expect(screen.getByText('Cycle done')).toBeInTheDocument();
    expect(screen.queryByText('Hello')).toBeNull();
    fireEvent.change(s, { target: { value: 'mystery' } });
    expect(screen.getByText('Hello')).toBeInTheDocument();
    fireEvent.change(s, { target: { value: 'user-42' } });
    expect(screen.getByText('Cycle done')).toBeInTheDocument();
    fireEvent.change(s, { target: { value: 'nope' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('empty feed', async () => {
    renderFdm(routes([]));
    await openTab('Notifications');
    expect(await screen.findByText('No notifications')).toBeInTheDocument();
  });

  it('edit sends isRead as a boolean and the read time as an instant', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${NOTIF}/n2`, body: {} }]);
    await openTab('Notifications');
    await screen.findByText('Hello');
    await click(within(ncard('Hello')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Notification');
    expect(field(dlg, 'Read').value).toBe('false');
    setField(dlg, 'Read', 'true');
    setField(dlg, 'Read At', '2026-07-02T12:00');
    setField(dlg, 'Message', 'Greeting');
    typeReason(dlg, 'Mark as read');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${NOTIF}/n2`, 1);
    expect(put.json).toEqual({ type: 'MYSTERY_TYPE', title: 'Hello', message: 'Greeting', isRead: true, readAt: '2026-07-02T12:00:00.000Z', _changeReason: 'Mark as read' });
    expect(await ackMessage('Updated')).toContain('Notification updated and audited');
  });

  it('a read notification edits with Read=true; an untitled one is labelled "Notification" in edit and delete', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${NOTIF}/n1`, body: {} }, { method: 'DELETE', path: `${NOTIF}/n3`, body: {} }]);
    await openTab('Notifications');
    await screen.findByText('Cycle done');
    await click(within(ncard('Cycle done')).getByRole('button', { name: 'Edit' }));
    let dlg = modal('Edit Notification');
    expect(field(dlg, 'Read').value).toBe('true');
    expect(field(dlg, 'Read At').value).toBe('2026-07-01T11:00');
    setField(dlg, 'Read', 'false');
    typeReason(dlg, 'Mark unread again');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${NOTIF}/n1`, 1);
    expect(put.json.isRead).toBe(false);
    await ackMessage('Updated');

    const untitled = screen.getByText('2026-07-03 10:00').closest('div.group') as HTMLElement;
    await click(within(untitled).getByRole('button', { name: 'Edit' }));
    dlg = modal('Edit Notification');
    expect(dlg).toHaveTextContent('Notification');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await click(within(untitled).getByRole('button', { name: 'Delete' }));
    dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('Notification will be permanently removed');
    typeReason(dlg, 'Junk notification');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    expect((await waitForCalls(api, 'DELETE', `${NOTIF}/n3`, 1))[0].json).toEqual({ _changeReason: 'Junk notification' });
    await ackMessage('Deleted');
  });

  it('create: type enum, required title/message, boolean read flag', async () => {
    const api = renderFdm([...routes(), { method: 'POST', path: NOTIF, body: {} }]);
    await openTab('Notifications');
    await screen.findByText('Cycle done');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Notification');
    const types = Array.from((field(dlg, 'Type') as unknown as HTMLSelectElement).options).map((o) => o.value);
    expect(types[0]).toBe('');
    expect(types).toContain('BLOCK_CHANGE_REJECTED');
    setField(dlg, 'Type', 'SYSTEM_ERROR');
    setField(dlg, 'Title', 'Backfilled');
    setField(dlg, 'Message', 'From paper');
    setField(dlg, 'Target User ID', 'u-1');
    setField(dlg, 'For User ID', 'u-2');
    setField(dlg, 'For Role', 'QA');
    setField(dlg, 'Created At', '2026-06-01T09:00');
    setField(dlg, 'Read', 'true');
    setField(dlg, 'Read At', '2026-06-01T10:00');
    typeReason(dlg, 'Restore lost alert');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', NOTIF, 1);
    expect(post.json).toEqual({
      type: 'SYSTEM_ERROR', title: 'Backfilled', message: 'From paper', targetUserId: 'u-1', forUserId: 'u-2', forRole: 'QA',
      createdAt: '2026-06-01T09:00:00.000Z', isRead: true, readAt: '2026-06-01T10:00:00.000Z', _changeReason: 'Restore lost alert',
    });
    expect(await ackMessage('Created')).toContain('Notification added');
  });
});

describe('Admin Requests tab', () => {
  const Q1 = { id: 'q1', requesterName: 'Jane Doe', requesterEmployeeId: 'E100', requesterEmail: 'jane@x.test', requestType: 'UNLOCK', status: 'PENDING', requestedAt: '2026-07-01T09:00:00.000Z', processedByName: 'Admin A', manualEntry: true, remarks: 'locked out', adminRemarks: '' };
  const Q2 = { id: 'q2', requesterName: 'Bob Roe', requestType: 'FORGOT_PASSWORD', status: 'REJECTED', requestedAt: '2026-07-10T09:00:00.000Z', processedBy: 'u-9' };
  const Q3 = { id: 'q3', requesterName: 'Cat', requestType: 'WEIRD_TYPE', status: 'ODD', requestedAt: '2026-08-01T09:00:00.000Z' };

  it('reads the whole set (array body), renders labels and colours, and pages client-side', async () => {
    const api = renderFdm([{ path: ADMIN_REQ, body: [Q1, Q2, Q3] }]);
    await openTab('Admin Requests');
    await screen.findByText('Jane Doe');
    expect(api.calls('GET', ADMIN_REQ)[0].url).toBe('/api/admin-requests');
    const r1 = within(row('Jane Doe')).getAllByRole('cell').map((c) => c.textContent);
    expect(r1.slice(0, 5)).toEqual(['Jane DoeManual entryE100', 'Unlock Account', 'PENDING', '2026-07-01 09:00', 'Admin A']);
    expect(within(row('Jane Doe')).getByText('PENDING').className).toContain('bg-amber-50');
    const r2 = within(row('Bob Roe')).getAllByRole('cell').map((c) => c.textContent);
    expect(r2.slice(1, 5)).toEqual(['Password Reset', 'REJECTED', '2026-07-10 09:00', 'u-9']);
    const r3 = within(row('Cat')).getAllByRole('cell').map((c) => c.textContent);
    expect(r3.slice(1, 5)).toEqual(['WEIRD_TYPE', 'ODD', '2026-08-01 09:00', '-']);
    expect(within(row('Cat')).getByText('ODD').className).toContain('bg-slate-50');
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('3');
    expect(api.unmatched).toEqual([]);

    // Client-side paging.
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '2' } });
    expect(screen.queryByText('Cat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Cat')).toBeInTheDocument();
  });

  it('the status filter is a server query; dates and search filter in the browser', async () => {
    const api = renderFdm([{ path: ADMIN_REQ, body: { data: [Q1, Q2, Q3] } }]);
    await openTab('Admin Requests');
    await screen.findByText('Jane Doe');
    const select = screen.getByText('Status', { selector: 'span' }).closest('label')!.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'APPROVED' } });
    await waitFor(() => expect(api.calls('GET', ADMIN_REQ).at(-1)!.url).toBe('/api/admin-requests?status=APPROVED'));
    fireEvent.change(select, { target: { value: '' } });
    await screen.findByText('Jane Doe');
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-07-05' } });
    expect(screen.queryByText('Jane Doe')).toBeNull();
    expect(screen.getByText('Bob Roe')).toBeInTheDocument();
    // No date params on this endpoint.
    expect(api.calls('GET', ADMIN_REQ).every((c) => !c.query.has('from'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    const s = screen.getByPlaceholderText('Search...');
    fireEvent.change(s, { target: { value: 'e100' } });
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('Bob Roe')).toBeNull();
    fireEvent.change(s, { target: { value: 'forgot' } });
    expect(screen.getByText('Bob Roe')).toBeInTheDocument();
    fireEvent.change(s, { target: { value: 'odd' } });
    expect(screen.getByText('Cat')).toBeInTheDocument();
    fireEvent.change(s, { target: { value: 'nobody' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('empty / non-array responses read as "No admin requests"', async () => {
    renderFdm([{ path: ADMIN_REQ, body: { data: { unexpected: true } } }]);
    await openTab('Admin Requests');
    expect(await screen.findByText('No admin requests')).toBeInTheDocument();
  });

  it('edit offers the server\'s request types and PUTs to the super-admin data endpoint', async () => {
    const api = renderFdm([{ path: ADMIN_REQ, body: [Q1, Q2, Q3] }, { method: 'PUT', path: `${SA_ADMIN_REQ}/q1`, body: {} }]);
    await openTab('Admin Requests');
    await screen.findByText('Jane Doe');
    await click(within(row('Jane Doe')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Admin Request');
    expect(dlg).toHaveTextContent('Unlock Account - Jane Doe');
    expect(Array.from((field(dlg, 'Request Type') as unknown as HTMLSelectElement).options).map((o) => o.value))
      .toEqual(['CREATE_USER', 'MODIFY_USER', 'UNLOCK', 'ENABLE_ACCOUNT', 'DISABLE_ACCOUNT', 'FORGOT_PASSWORD']);
    expect(field(dlg, 'Request Type').value).toBe('UNLOCK');
    expect(field(dlg, 'Requester Email').value).toBe('jane@x.test');
    setField(dlg, 'Status', 'APPROVED');
    setField(dlg, 'Admin Remarks', 'unlocked by phone');
    typeReason(dlg, 'Processed offline');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_ADMIN_REQ}/q1`, 1);
    expect(put.json).toEqual({
      requestType: 'UNLOCK', status: 'APPROVED', requesterName: 'Jane Doe', requesterEmployeeId: 'E100', requesterEmail: 'jane@x.test',
      remarks: 'locked out', adminRemarks: 'unlocked by phone', _changeReason: 'Processed offline',
    });
    expect(await ackMessage('Updated')).toContain('Admin request updated and audited');
  });

  it('a request with no status edits as PENDING; delete names type and requester', async () => {
    const noStatus = { id: 'q4', requesterName: 'Dee', requestType: 'CREATE_USER', requestedAt: '2026-07-01T09:00:00.000Z' };
    const api = renderFdm([{ path: ADMIN_REQ, body: [noStatus] }, { method: 'DELETE', path: `${SA_ADMIN_REQ}/q4`, body: {} }]);
    await openTab('Admin Requests');
    await screen.findByText('Dee');
    await click(within(row('Dee')).getByRole('button', { name: 'Edit' }));
    expect(field(modal('Edit Admin Request'), 'Status').value).toBe('PENDING');
    await click(within(modal('Edit Admin Request')).getByRole('button', { name: 'Cancel' }));
    await click(within(row('Dee')).getByRole('button', { name: 'Delete' }));
    const dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('Create User - Dee will be permanently removed');
    typeReason(dlg, 'Test request');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    expect((await waitForCalls(api, 'DELETE', `${SA_ADMIN_REQ}/q4`, 1))[0].json).toEqual({ _changeReason: 'Test request' });
    await ackMessage('Deleted');
  });

  it('create defaults status to PENDING and POSTs the request', async () => {
    const api = renderFdm([{ path: ADMIN_REQ, body: [] }, { method: 'POST', path: SA_ADMIN_REQ, body: {} }]);
    await openTab('Admin Requests');
    await screen.findByText('No admin requests');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Admin Request');
    expect(field(dlg, 'Status').value).toBe('PENDING');
    setField(dlg, 'Request Type', 'ENABLE_ACCOUNT');
    setField(dlg, 'Requester Name', 'Eve');
    setField(dlg, 'Requester Employee ID', 'E7');
    setField(dlg, 'Requester Email', 'eve@x.test');
    setField(dlg, 'Requested At', '2026-05-05T05:00');
    setField(dlg, 'Requester Remarks', 'please');
    setField(dlg, 'Admin Remarks', 'ok');
    typeReason(dlg, 'Paper request');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', SA_ADMIN_REQ, 1);
    expect(post.json).toEqual({
      status: 'PENDING', requestType: 'ENABLE_ACCOUNT', requesterName: 'Eve', requesterEmployeeId: 'E7', requesterEmail: 'eve@x.test',
      requestedAt: '2026-05-05T05:00:00.000Z', remarks: 'please', adminRemarks: 'ok', _changeReason: 'Paper request',
    });
    expect(await ackMessage('Created')).toContain('Admin request added');
  });
});

describe('Block Changes tab', () => {
  const B1 = { id: 'b1', filterName: 'FLT-9', fromBlockName: 'Block A', toBlockName: 'Block B', status: 'APPROVED', reason: 'moved', requestedByName: 'Sup', createdAt: '2026-07-01T09:00:00.000Z', processedByName: 'QA', processedComment: 'fine', manualEntry: true };
  const B2 = { id: 'b2', filterName: null, fromBlockName: null, toBlockName: null, status: 'WEIRD', createdAt: '2026-07-02T09:00:00.000Z' };
  const routes = (items: unknown[] = [B1, B2], total?: number) => [{ path: BCR, body: { data: items, ...(total !== undefined ? { total } : {}) } }];
  const bcard = (text: string) => screen.getByRole('heading', { name: text }).closest('div.group') as HTMLElement;

  it('renders cards like /approvals; status ALL by default, filter + paging go to the server', async () => {
    const api = renderFdm(routes(undefined, 30));
    await openTab('Block Changes');
    await screen.findByText('Reason: moved');
    const q = api.calls('GET', BCR)[0].query;
    expect(q.get('status')).toBe('ALL');
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('20');
    const c1 = bcard('FLT-9');
    expect(c1).toHaveTextContent('Manual entry');
    expect(c1).toHaveTextContent('Approved');
    expect(c1).toHaveTextContent('Block A');
    expect(c1).toHaveTextContent('Block B');
    expect(c1).toHaveTextContent('By: Sup');
    expect(c1).toHaveTextContent('Processed by: QA');
    expect(c1).toHaveTextContent('Comment: fine');
    // Unknown status falls back to the Pending style; missing names render "-".
    const c2 = bcard('-');
    expect(c2).toHaveTextContent('Pending');
    expect(c2).toHaveTextContent('By: -');
    expect(c2).not.toHaveTextContent('Reason:');
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('30');

    const select = screen.getByText('Status', { selector: 'span' }).closest('label')!.querySelector('select')!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
    fireEvent.change(select, { target: { value: 'EXPIRED' } });
    await waitFor(() => expect(api.calls('GET', BCR).at(-1)!.query.get('status')).toBe('EXPIRED'));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(api.calls('GET', BCR).at(-1)!.query.get('page')).toBe('2'));
    expect(api.unmatched).toEqual([]);
  });

  it('search covers filter, blocks, status and requester; empty states', async () => {
    renderFdm(routes());
    await openTab('Block Changes');
    await screen.findByText('Reason: moved');
    const s = screen.getByPlaceholderText('Search...');
    for (const term of ['flt-9', 'block a', 'block b', 'approved', 'sup']) {
      fireEvent.change(s, { target: { value: term } });
      expect(screen.getByRole('heading', { name: 'FLT-9' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '-' })).toBeNull();
    }
    fireEvent.change(s, { target: { value: 'zzz' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('no requests', async () => {
    renderFdm(routes([]));
    await openTab('Block Changes');
    expect(await screen.findByText('No block change requests')).toBeInTheDocument();
  });

  it('edit changes status/reason/comment only', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${SA_BCR}/b1`, body: {} }]);
    await openTab('Block Changes');
    await screen.findByText('Reason: moved');
    await click(within(bcard('FLT-9')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Block Change Request');
    expect(dlg).toHaveTextContent('filter / from-block / to-block references and the requester are not editable here');
    expect(field(dlg, 'Status').value).toBe('APPROVED');
    // A used approval is EXPIRED (BlockChangeStatus); CONSUMED was never a value the API accepts.
    setField(dlg, 'Status', 'EXPIRED');
    setField(dlg, 'Processed Comment', 'applied');
    typeReason(dlg, 'Request was applied');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_BCR}/b1`, 1);
    expect(put.json).toEqual({ status: 'EXPIRED', reason: 'moved', processedComment: 'applied', _changeReason: 'Request was applied' });
    expect(await ackMessage('Updated')).toContain('Block change updated and audited');
  });

  it('a request with no filter name and no status: edit title, defaults and delete label fall back', async () => {
    const bare = { id: 'b3', createdAt: '2026-07-03T09:00:00.000Z' };
    const api = renderFdm([...routes([bare]), { method: 'DELETE', path: `${SA_BCR}/b3`, body: {} }]);
    await openTab('Block Changes');
    const c = await screen.findByRole('heading', { name: '-' }).then((h) => h.closest('div.group') as HTMLElement);
    await click(within(c).getByRole('button', { name: 'Edit' }));
    let dlg = modal('Edit Block Change Request');
    expect(dlg).toHaveTextContent('Block change');
    expect(field(dlg, 'Status').value).toBe('PENDING');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await click(within(c).getByRole('button', { name: 'Delete' }));
    dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('Block change for filter will be permanently removed');
    typeReason(dlg, 'Bad request');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    expect((await waitForCalls(api, 'DELETE', `${SA_BCR}/b3`, 1))[0].json).toEqual({ _changeReason: 'Bad request' });
    await ackMessage('Deleted');
  });

  it('create: filter picker, block ids/names typed, status defaults to PENDING; signed when required', async () => {
    const api = renderFdm([
      ...routes(),
      { path: '/api/hierarchy/filters', body: { data: [{ id: 'f9', name: 'FLT-9' }] } },
      { method: 'POST', path: SA_BCR, body: {} },
    ], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Block Changes');
    await screen.findByText('Reason: moved');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Block Change Request');
    await waitFor(() => expect(within(field(dlg, 'Filter') as any).getByRole('option', { name: 'FLT-9' })).toBeInTheDocument());
    expect(field(dlg, 'Status').value).toBe('PENDING');
    setField(dlg, 'Filter', 'f9');
    setField(dlg, 'Filter Name', 'FLT-9');
    setField(dlg, 'From Block ID', 'blk-a');
    setField(dlg, 'From Block Name', 'Block A');
    setField(dlg, 'To Block ID', 'blk-b');
    setField(dlg, 'To Block Name', 'Block B');
    setField(dlg, 'Reason', 'relocation');
    setField(dlg, 'Processed Comment', '');
    typeReason(dlg, 'Paper request');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    await signReauth('pw-bcr');
    const [post] = await waitForCalls(api, 'POST', SA_BCR, 1);
    expect(post.headers['x-reauth-password']).toBe('pw-bcr');
    expect(post.json).toEqual({
      status: 'PENDING', filterId: 'f9', filterName: 'FLT-9', fromBlockId: 'blk-a', fromBlockName: 'Block A',
      toBlockId: 'blk-b', toBlockName: 'Block B', reason: 'relocation', _changeReason: 'Paper request', _currentPassword: 'pw-bcr',
    });
    expect(await ackMessage('Created')).toContain('Block change added');
  });
});
