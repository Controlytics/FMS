import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { resetEnv, signReauth, cancelReauth, ackMessage, reauthRequired } from './config-test-helpers';
import { renderFdm, modal, field, setField, typeReason, click, row, waitForCalls, openTab } from './fdm-helpers';

afterEach(resetEnv);

const PM = '/api/super-admin/data/pm-entries';
const AUDIT = '/api/audit';

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const PM1 = {
  id: 'pm1', month: 3, plannedDate: '2026-03-10T00:00:00.000Z', windowStart: '2026-03-01T00:00:00.000Z', windowEnd: '2026-03-20T00:00:00.000Z',
  toleranceDays: 0, approvalStatus: 'APPROVED', submittedByName: 'Sup One', approvedByName: 'QA Lead', approvedAt: '2026-02-20T10:00:00.000Z',
  notes: 'annual', manualEntry: true, approvalRemarks: 'ok',
  execution: { status: 'COMPLETED', startedAt: '2026-03-21T08:00:00.000Z', completedAt: '2026-03-21T09:00:00.000Z', isWithinWindow: false },
};
const PM2 = { id: 'pm2', month: 4, plannedDate: '2026-04-10T00:00:00.000Z', approvalStatus: 'REJECTED', execution: { status: 'IN_PROGRESS' } };
const PM3 = { id: 'pm3', month: 5, plannedDate: iso(-20), windowStart: iso(-25), windowEnd: iso(-15), toleranceDays: 5, approvalStatus: 'PENDING' };
const PM4 = { id: 'pm4', month: 6, plannedDate: iso(0), windowStart: iso(-2), windowEnd: iso(2), toleranceDays: 2 };
const PM5 = { id: 'pm5', month: 13, windowStart: iso(30), windowEnd: iso(40), toleranceDays: null };
const PM6 = { id: 'pm6', windowStart: iso(30), windowEnd: iso(40) };

function pmCard(heading: string | RegExp): HTMLElement {
  return screen.getByText(heading, { selector: 'span.text-lg' }).closest('div.group') as HTMLElement;
}

describe('PM Entries tab', () => {
  const routes = (entries: unknown[] = [PM1, PM2, PM3, PM4, PM5, PM6], total?: number) =>
    [{ path: PM, body: { data: entries, ...(total !== undefined ? { total } : {}) } }];

  it('renders entry cards with the same status rules as the PM detail page', async () => {
    const api = renderFdm(routes(undefined, 6));
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    const q = api.calls('GET', PM)[0].query;
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('20');
    expect(q.has('approvalStatus')).toBe(false);

    const c1 = pmCard(/^Mar/);
    expect(c1).toHaveTextContent('Manual entry');
    expect(c1).toHaveTextContent('Completed');
    expect(c1).toHaveTextContent('Planned: 2026-03-10 00:00');
    expect(c1).toHaveTextContent('Window: 2026-03-01 00:00 - 2026-03-20 00:00');
    expect(c1).toHaveTextContent('Tolerance: 0 days');
    expect(c1).toHaveTextContent('Started: 2026-03-21 08:00');
    expect(c1).toHaveTextContent('Done: 2026-03-21 09:00');
    expect(c1).toHaveTextContent('Out of window');
    expect(c1).toHaveTextContent('Approval: APPROVED');
    expect(c1).toHaveTextContent('Submitted by: Sup One');
    expect(c1).toHaveTextContent('Approved by: QA Lead');
    expect(c1).toHaveTextContent('Approved at: 2026-02-20 10:00');
    expect(c1).toHaveTextContent('"annual"');
    expect(within(c1).getByText('APPROVED').className).toContain('text-emerald-600');

    const c2 = pmCard(/^Apr/);
    expect(c2).toHaveTextContent('In Progress');
    expect(within(c2).getByText('REJECTED').className).toContain('text-red-600');
    expect(c2).not.toHaveTextContent('Window:');
    expect(c2).not.toHaveTextContent('Started:');

    const c3 = pmCard(/^May/);
    expect(c3).toHaveTextContent('Overdue');
    expect(within(c3).getByText('PENDING').className).toContain('text-amber-600');
    expect(pmCard(/^Jun/)).toHaveTextContent('Due');
    const c5 = pmCard('Month 13');
    expect(c5).toHaveTextContent('Scheduled');
    expect(c5).not.toHaveTextContent('Tolerance');
    expect(c5).not.toHaveTextContent('Planned:');
    expect(c5).not.toHaveTextContent('Approval:');
    // Missing month falls back to January.
    expect(pmCard(/^Jan/)).toHaveTextContent('Scheduled');
    expect(api.unmatched).toEqual([]);
  });

  it('the Approval filter and date range go to the server; search matches month, status and people', async () => {
    const api = renderFdm(routes());
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    const select = screen.getByText('Approval', { selector: 'span' }).closest('label')!.querySelector('select')!;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'PENDING', 'APPROVED', 'REJECTED']);
    fireEvent.change(select, { target: { value: 'PENDING_REVIEW' } });
    await waitFor(() => expect(api.calls('GET', PM).at(-1)!.query.get('approvalStatus')).toBe('PENDING_REVIEW'));
    // super-admin data lists take bare from/to too (widened the same way).
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-03-01' } });
    await waitFor(() => expect(api.calls('GET', PM).at(-1)!.query.get('from')).toBe(new Date('2026-03-01T00:00:00.000').toISOString()));

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'mar' } });
    expect(pmCard(/^Mar/)).toBeInTheDocument();
    expect(screen.queryByText(/^Apr/, { selector: 'span.text-lg' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'rejected' } });
    expect(pmCard(/^Apr/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'qa lead' } });
    expect(pmCard(/^Mar/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'ANNUAL' } });
    expect(pmCard(/^Mar/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'sup one' } });
    expect(pmCard(/^Mar/)).toBeInTheDocument();
    expect(screen.queryByText(/^Jun/, { selector: 'span.text-lg' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'nothing' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('empty feed', async () => {
    renderFdm(routes([]));
    await openTab('PM Entries');
    expect(await screen.findByText('No PM entries')).toBeInTheDocument();
  });

  it('edit sends the entry columns with numeric month/tolerance and the reason', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${PM}/pm1`, body: {} }]);
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    await click(within(pmCard(/^Mar/)).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit PM Entry');
    expect(dlg).toHaveTextContent('Mar 2026');
    expect(field(dlg, 'Month (1-12)').value).toBe('3');
    expect(field(dlg, 'Planned Date').value).toBe('2026-03-10T00:00');
    expect(field(dlg, 'Tolerance Days').value).toBe('0');
    expect(field(dlg, 'Approval Status').value).toBe('APPROVED');
    expect(field(dlg, 'Approval Remarks').value).toBe('ok');
    expect(dlg).toHaveTextContent('execution status (Completed / In Progress / Overdue / Due) is computed');
    setField(dlg, 'Month (1-12)', '4');
    setField(dlg, 'Tolerance Days', '7');
    setField(dlg, 'Window End', '2026-03-25T00:00');
    setField(dlg, 'Notes', '');
    typeReason(dlg, 'Window extended by QA');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${PM}/pm1`, 1);
    expect(put.json).toEqual({
      month: 4, plannedDate: '2026-03-10T00:00:00.000Z', windowStart: '2026-03-01T00:00:00.000Z', windowEnd: '2026-03-25T00:00:00.000Z',
      toleranceDays: 7, approvalStatus: 'APPROVED', approvalRemarks: 'ok', _changeReason: 'Window extended by QA',
    });
    expect(await ackMessage('Updated')).toContain('PM entry updated and audited');
  });

  it('an entry with no planned date and no fields is titled by month alone; blank fields are not sent', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${PM}/pm6`, body: {} }]);
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    await click(within(pmCard(/^Jan/)).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit PM Entry');
    expect(field(dlg, 'Month (1-12)').value).toBe('');
    expect(field(dlg, 'Approval Status').value).toBe('');
    typeReason(dlg, 'touch for audit');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${PM}/pm6`, 1);
    expect(put.json).toEqual({ windowStart: expect.any(String), windowEnd: expect.any(String), _changeReason: 'touch for audit' });
  });

  it('delete names the month and hits the pm-entries endpoint', async () => {
    const api = renderFdm([...routes(), { method: 'DELETE', path: `${PM}/pm2`, body: {} }]);
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    await click(within(pmCard(/^Apr/)).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('Apr entry will be permanently removed');
    typeReason(dlg, 'Duplicate visit');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    const [del] = await waitForCalls(api, 'DELETE', `${PM}/pm2`, 1);
    expect(del.json).toEqual({ _changeReason: 'Duplicate visit' });
    await ackMessage('Deleted');
  });

  it('create picks a PM schedule by AHU name and year; numbers are coerced', async () => {
    const api = renderFdm([
      ...routes(),
      { path: '/api/super-admin/data/pm-schedules', body: { data: [
        { id: 's1', entityName: 'AHU-01', year: 2026, version: 2 },
        { id: 's2', entityId: 'abcdef12-3456', year: 2025 },
      ] } },
      { method: 'POST', path: PM, body: {} },
    ]);
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create PM Entry');
    await waitFor(() => expect(within(field(dlg, 'PM Schedule') as any).getByRole('option', { name: 'AHU-01 — 2026 (v2)' })).toBeInTheDocument());
    expect(within(field(dlg, 'PM Schedule') as any).getByRole('option', { name: 'Entity abcdef12 — 2025' })).toBeInTheDocument();
    setField(dlg, 'PM Schedule', 's1');
    setField(dlg, 'Month (1-12)', '8');
    setField(dlg, 'Planned Date', '2026-08-15T00:00');
    setField(dlg, 'Window Start', '2026-08-10T00:00');
    setField(dlg, 'Window End', '2026-08-20T00:00');
    setField(dlg, 'Tolerance Days', '5');
    setField(dlg, 'Approval Status', 'APPROVED');
    setField(dlg, 'Approval Remarks', 'pre-approved');
    setField(dlg, 'Notes', 'from paper');
    typeReason(dlg, 'Add missed visit');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', PM, 1);
    expect(post.json).toEqual({
      scheduleId: 's1', month: 8, plannedDate: '2026-08-15T00:00:00.000Z', windowStart: '2026-08-10T00:00:00.000Z',
      windowEnd: '2026-08-20T00:00:00.000Z', toleranceDays: 5, approvalStatus: 'APPROVED', approvalRemarks: 'pre-approved',
      notes: 'from paper', _changeReason: 'Add missed visit',
    });
    expect(await ackMessage('Created')).toContain('PM entry added');
  });

  it('with no PM schedules the create dialog asks for a schedule UUID instead', async () => {
    const api = renderFdm([
      ...routes(),
      { path: '/api/super-admin/data/pm-schedules', body: { data: [] } },
      { method: 'POST', path: PM, body: {} },
    ]);
    await openTab('PM Entries');
    await screen.findByText(/Sup One/);
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create PM Entry');
    await waitFor(() => expect(field(dlg, 'PM Schedule ID')).toHaveAttribute('placeholder', 'No PM schedules exist yet — paste a schedule UUID'));
    setField(dlg, 'PM Schedule ID', 'sched-uuid');
    setField(dlg, 'Month (1-12)', '2');
    setField(dlg, 'Planned Date', '2026-02-01T00:00');
    typeReason(dlg, 'Add missed visit');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', PM, 1);
    expect(post.json).toEqual({ scheduleId: 'sched-uuid', month: 2, plannedDate: '2026-02-01T00:00:00.000Z', _changeReason: 'Add missed visit' });
  });
});

describe('Audit Trail tab', () => {
  const A1 = { id: 'a1', timestamp: '2026-07-05T06:00:00.000Z', action: 'USER_CREATED', userId: 'admin', userName: 'Admin User', userRole: 'ADMIN', targetType: 'USER', targetId: 'abcdef1234567890', signatureMeaning: 'Created' };
  const A2 = { id: 'a2', timestamp: '2026-07-05T07:00:00.000Z', action: 'LOGIN_FAILED', userId: null, targetType: null };
  const A3 = { id: 'a3', timestamp: '2026-07-05T08:00:00.000Z', action: 'CONFIG_UPDATED', userId: 'sa', targetType: 'CONFIG' };
  const routes = (rows: unknown[] = [A1, A2, A3], total?: number) =>
    [{ path: AUDIT, body: { data: rows, ...(total !== undefined ? { total } : {}) } }];

  it('lists audit rows like /audit with Success/Fail from the shared rule', async () => {
    const api = renderFdm(routes(undefined, 3));
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    const q = api.calls('GET', AUDIT)[0].query;
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('20');
    expect(q.has('action')).toBe(false);
    const r1 = within(row('USER_CREATED')).getAllByRole('cell').map((c) => c.textContent);
    expect(r1.slice(0, 5)).toEqual(['2026-07-05 06:00', 'USER_CREATED', 'adminADMIN', 'USER(abcdef12)', 'Success']);
    const r2 = within(row('LOGIN_FAILED')).getAllByRole('cell').map((c) => c.textContent);
    expect(r2.slice(0, 5)).toEqual(['2026-07-05 07:00', 'LOGIN_FAILED', '-', '-', 'Fail']);
    const r3 = within(row('CONFIG_UPDATED')).getAllByRole('cell').map((c) => c.textContent);
    expect(r3[3]).toBe('CONFIG');
    // No status/type dropdown on this tab.
    expect(screen.queryByText('Status', { selector: 'span' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('date range is sent as startDate/endDate; search covers action, user id, user name and target type', async () => {
    const api = renderFdm(routes());
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Records to date'), { target: { value: '2026-07-05' } });
    await waitFor(() => {
      const last = api.calls('GET', AUDIT).at(-1)!.query;
      expect(last.get('startDate')).toBe(new Date('2026-07-01T00:00:00.000').toISOString());
      expect(last.get('endDate')).toBe(new Date('2026-07-05T23:59:59.999').toISOString());
      expect(last.has('from')).toBe(false);
    });
    const search = screen.getByPlaceholderText('Search...');
    fireEvent.change(search, { target: { value: 'login' } });
    expect(screen.getByText('LOGIN_FAILED')).toBeInTheDocument();
    expect(screen.queryByText('USER_CREATED')).toBeNull();
    fireEvent.change(search, { target: { value: 'admin user' } });
    expect(screen.getByText('USER_CREATED')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'config' } });
    expect(screen.getByText('CONFIG_UPDATED')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'SA' } });
    expect(screen.getByText('CONFIG_UPDATED')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'qqq' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('empty feed', async () => {
    renderFdm(routes([]));
    await openTab('Audit Trail');
    expect(await screen.findByText('No audit records')).toBeInTheDocument();
  });

  it('Edit: only safe fields, chain-break warning, sends `reason` to PUT /api/audit/:id', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${AUDIT}/a1`, body: {} }]);
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit audit record');
    expect(dlg).toHaveTextContent('breaks the tamper-evident hash chain');
    expect(dlg).toHaveTextContent('The checksum, previous checksum and chain position are not editable');
    expect(field(dlg, 'Timestamp').value).toBe('2026-07-05T06:00');
    expect(field(dlg, 'User Name').value).toBe('Admin User');
    expect(field(dlg, 'Signature Meaning').value).toBe('Created');
    expect(() => field(dlg, 'Checksum')).toThrow();
    const save = within(dlg).getByRole('button', { name: 'Save & break chain' });
    expect(save).toBeDisabled();
    setField(dlg, 'User Role', 'SUPERVISOR');
    setField(dlg, 'Timestamp', '2026-07-05T06:30');
    typeReason(dlg, 'Wrong role captured');
    await click(save);
    const [put] = await waitForCalls(api, 'PUT', `${AUDIT}/a1`, 1);
    expect(put.json).toEqual({
      reason: 'Wrong role captured', timestamp: '2026-07-05T06:30:00.000Z', userName: 'Admin User', userRole: 'SUPERVISOR',
      action: 'USER_CREATED', targetType: 'USER', targetId: 'abcdef1234567890', signatureMeaning: 'Created',
    });
    expect(await ackMessage('Audit record edited')).toContain('the hash chain is now broken at this record');
    expect(screen.queryByRole('heading', { name: 'Edit audit record' })).toBeNull();
  });

  it('a cleared timestamp is not sent; 409 META_AUDIT_IMMUTABLE is shown and the dialog stays', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${AUDIT}/a2`, status: 409, body: { error: 'META_AUDIT_IMMUTABLE', message: 'A record of an audit change cannot itself be edited' } }]);
    await openTab('Audit Trail');
    await screen.findByText('LOGIN_FAILED');
    await click(within(row('LOGIN_FAILED')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit audit record');
    expect(field(dlg, 'User Name').value).toBe('');
    setField(dlg, 'Timestamp', '');
    typeReason(dlg, 'Try editing meta row');
    await click(within(dlg).getByRole('button', { name: 'Save & break chain' }));
    const [put] = await waitForCalls(api, 'PUT', `${AUDIT}/a2`, 1);
    expect(put.json).not.toHaveProperty('timestamp');
    expect(put.json).toMatchObject({ reason: 'Try editing meta row', action: 'LOGIN_FAILED', userName: '', targetType: '' });
    expect(await ackMessage('Edit failed')).toContain('A record of an audit change cannot itself be edited');
    expect(screen.getByRole('heading', { name: 'Edit audit record' })).toBeInTheDocument();
    await click(within(modal('Edit audit record')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit audit record' })).toBeNull();
  });

  it('Edit is signed with UPDATE_AUDIT_RECORD; cancel is silent and re-enables Save', async () => {
    const api = renderFdm([...routes(), { method: 'PUT', path: `${AUDIT}/a1`, body: {} }], { reauth: ['UPDATE_AUDIT_RECORD'] });
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Edit' }));
    let dlg = modal('Edit audit record');
    typeReason(dlg, 'Wrong role captured');
    await click(within(dlg).getByRole('button', { name: 'Save & break chain' }));
    // Gated up front: the password is asked before anything is sent.
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(api.calls('PUT', `${AUDIT}/a1`)).toHaveLength(0);
    await cancelReauth();
    dlg = modal('Edit audit record');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Save & break chain' })).not.toBeDisabled());
    expect(screen.queryByRole('heading', { name: 'Edit failed' })).toBeNull();
    await click(within(dlg).getByRole('button', { name: 'Save & break chain' }));
    await signReauth('pw-audit');
    const [put] = await waitForCalls(api, 'PUT', `${AUDIT}/a1`, 1);
    expect(put.headers['x-reauth-password']).toBe('pw-audit');
    expect(put.json).toMatchObject({ reason: 'Wrong role captured', _currentPassword: 'pw-audit' });
  });

  it('Redact: recommended path, POST /redact with the reason (REDACT_AUDIT_RECORD)', async () => {
    const api = renderFdm([...routes(), reauthRequired('POST', `${AUDIT}/a1/redact`), { method: 'POST', path: `${AUDIT}/a1/redact`, body: {} }]);
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Redact' }));
    const dlg = modal('Redact audit record');
    expect(dlg).toHaveTextContent('the audit chain stays intact — this is the recommended alternative to deleting');
    typeReason(dlg, 'PII in payload');
    await click(within(dlg).getByRole('button', { name: 'Redact record' }));
    await signReauth('pw-red');
    const posts = await waitForCalls(api, 'POST', `${AUDIT}/a1/redact`, 2);
    expect(posts[0].json).toEqual({ reason: 'PII in payload' });
    expect(posts[1].json).toEqual({ reason: 'PII in payload', _currentPassword: 'pw-red' });
    expect(await ackMessage('Redacted')).toContain('Payload masked; hash chain preserved');
  });

  it('Delete: chain-break warning, DELETE with { reason } (DELETE_AUDIT_RECORD), failure reported', async () => {
    const api = renderFdm([
      ...routes(),
      { method: 'DELETE', path: `${AUDIT}/a3`, status: 403, times: 1, body: { error: 'FORBIDDEN', message: 'AUDIT_DELETE permission required' } },
      { method: 'DELETE', path: `${AUDIT}/a3`, body: {} },
    ], { reauth: ['DELETE_AUDIT_RECORD'] });
    await openTab('Audit Trail');
    await screen.findByText('CONFIG_UPDATED');
    await click(within(row('CONFIG_UPDATED')).getByRole('button', { name: 'Delete' }));
    let dlg = modal('Delete audit record');
    expect(dlg).toHaveTextContent('Verify Chain will report every later record as unverifiable');
    typeReason(dlg, 'Test data');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    await signReauth('pw-x');
    expect(await ackMessage('Failed')).toContain('AUDIT_DELETE permission required');
    dlg = modal('Delete audit record');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    await signReauth('pw-y');
    const dels = await waitForCalls(api, 'DELETE', `${AUDIT}/a3`, 2);
    expect(dels[1].json).toEqual({ reason: 'Test data', _currentPassword: 'pw-y' });
    expect(dels[1].headers['x-reauth-password']).toBe('pw-y');
    expect(await ackMessage('Deleted')).toContain('Audit record destroyed; the deletion itself is recorded');
  });

  it('Delete and redact without a signature requirement go straight through', async () => {
    const api = renderFdm([
      ...routes(),
      { method: 'DELETE', path: `${AUDIT}/a1`, body: {} },
      { method: 'POST', path: `${AUDIT}/a2/redact`, body: {} },
    ]);
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Delete' }));
    let dlg = modal('Delete audit record');
    typeReason(dlg, 'Test data');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    expect((await waitForCalls(api, 'DELETE', `${AUDIT}/a1`, 1))[0].json).toEqual({ reason: 'Test data' });
    await ackMessage('Deleted');
    await click(within(row('LOGIN_FAILED')).getByRole('button', { name: 'Redact' }));
    dlg = modal('Redact audit record');
    typeReason(dlg, 'Mask payload');
    await click(within(dlg).getByRole('button', { name: 'Redact record' }));
    expect((await waitForCalls(api, 'POST', `${AUDIT}/a2/redact`, 1))[0].json).toEqual({ reason: 'Mask payload' });
    await ackMessage('Redacted');
  });
});
