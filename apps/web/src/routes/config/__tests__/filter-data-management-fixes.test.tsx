/**
 * Regression tests for the Filter Data Management defects found in the
 * 2026-10-21 coverage campaign (items 7, 9 and 10 of the fix list).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { FilterDataManagementPage } from '../filter-data-management';
import { resetEnv, cancelReauth, ackMessage, SUPER_ADMIN } from './config-test-helpers';
import { renderFdm, baseRoutes, modal, field, setField, typeReason, click, row, waitForCalls, openTab } from './fdm-helpers';

vi.setConfig({ testTimeout: 30_000 });
afterEach(resetEnv);

const AUDIT = '/api/audit';
const PM = '/api/super-admin/data/pm-entries';
const ADMIN_REQ = '/api/admin-requests';
const SA_ADMIN_REQ = '/api/super-admin/data/admin-requests';
const BCR = '/api/block-change-requests';
const SA_BCR = '/api/super-admin/data/block-change-requests';

const options = (el: HTMLElement) => Array.from((el as unknown as HTMLSelectElement).options).map((o) => o.value);

describe('item 7 — hooks are called on every render, whoever is signed in', () => {
  it('a SUPER_ADMIN whose profile arrives after the first render gets the console, not a React crash', async () => {
    // No RequireRole and no cached user: the first render has no user (the
    // access-denied branch), the next one has SUPER_ADMIN. Every hook must run
    // on both, or React throws "Rendered more hooks than during the previous render".
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = mockApi(baseRoutes());
    renderPage(<FilterDataManagementPage />, { user: SUPER_ADMIN, api });
    expect(await screen.findByRole('heading', { name: 'Filter Data Management' })).toBeInTheDocument();
    expect(await screen.findByText('FLT-001')).toBeInTheDocument();
    const hookErrors = errors.mock.calls.flat().map(String).filter((m) => /more hooks|fewer hooks|order of Hooks/i.test(m));
    expect(hookErrors).toEqual([]);
  });

  it('a non-SUPER_ADMIN still gets the access-restricted panel and no data requests', async () => {
    const api = mockApi(baseRoutes());
    renderPage(<FilterDataManagementPage />, { user: { role: 'ADMIN', permissions: ['CONFIG_READ', 'CONFIG_UPDATE'] }, api });
    expect(await screen.findByRole('heading', { name: 'Access Restricted' })).toBeInTheDocument();
    expect(screen.getByText('This page is available to Super Admin only.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Filter Data Management' })).toBeNull();
    expect(api.calls('GET', '/api/hierarchy/filters')).toHaveLength(0);
  });
});

describe('item 10 — the password prompt names the action it signs', () => {
  const A1 = { id: 'a1', timestamp: '2026-07-05T06:00:00.000Z', action: 'USER_CREATED', userId: 'admin', userName: 'Admin User', userRole: 'ADMIN', targetType: 'USER', targetId: 'abcdef1234567890' };
  const auditRoutes = [{ path: AUDIT, body: { data: [A1] } }];

  it('Delete on an audit row says "Delete Audit Record"; Edit says "Edit Audit Record"; a retirement edit says "Super-Admin Data Edit"', async () => {
    renderFdm(auditRoutes, { reauth: ['DELETE_AUDIT_RECORD', 'UPDATE_AUDIT_RECORD', 'SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');

    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Delete' }));
    let dlg = modal('Delete audit record');
    typeReason(dlg, 'Duplicate row');
    await click(within(dlg).getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText(/Performing "Delete Audit Record" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
    await click(within(modal('Delete audit record')).getByRole('button', { name: 'Cancel' }));

    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Edit' }));
    dlg = modal('Edit audit record');
    typeReason(dlg, 'Wrong role captured');
    await click(within(dlg).getByRole('button', { name: 'Save & break chain' }));
    expect(await screen.findByText(/Performing "Edit Audit Record" requires identity verification/)).toBeInTheDocument();
    await cancelReauth();
  });

  it('a retirement edit is signed as "Super-Admin Data Edit"', async () => {
    renderFdm([], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await screen.findByText('FLT-001');
    await click(within(row('FLT-001')).getByRole('button', { name: /Edit/ }));
    const editing = screen.getByDisplayValue('FLT-001').closest('tr') as HTMLElement;
    await click(within(editing).getByRole('button', { name: /Save/ }));
    const dlg = modal('Edit retirement record');
    typeReason(dlg, 'Fix the set');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/Performing "Super-Admin Data Edit" requires identity verification/)).toBeInTheDocument();
  });
});

describe('item 9 — cancelling the password prompt is not a failure (audit delete / redact)', () => {
  const A1 = { id: 'a1', timestamp: '2026-07-05T06:00:00.000Z', action: 'USER_CREATED', userId: 'admin', targetType: 'USER', targetId: 'abcdef1234567890' };

  for (const [btn, title, confirm, action] of [
    ['Delete', 'Delete audit record', 'Delete permanently', 'DELETE_AUDIT_RECORD'],
    ['Redact', 'Redact audit record', 'Redact record', 'REDACT_AUDIT_RECORD'],
  ] as const) {
    it(`${btn}: cancel sends nothing, shows no "Cancelled" text or failure, and the prompt stays usable`, async () => {
      const api = renderFdm([{ path: AUDIT, body: { data: [A1] } }], { reauth: [action] });
      await openTab('Audit Trail');
      await screen.findByText('USER_CREATED');
      await click(within(row('USER_CREATED')).getByRole('button', { name: btn }));
      const dlg = modal(title);
      typeReason(dlg, 'Reason given');
      await click(within(dlg).getByRole('button', { name: confirm }));
      await cancelReauth();
      await waitFor(() => expect(within(modal(title)).getByRole('button', { name: confirm })).not.toBeDisabled());
      expect(screen.queryByText(/Cancelled/)).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Failed' })).toBeNull();
      expect(api.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    });
  }
});

describe('item 10 — an edit dropdown shows the stored value, and offers only values the server accepts', () => {
  it('PM entry: a PENDING_REVIEW entry shows PENDING_REVIEW, and an untouched save keeps it', async () => {
    const entry = { id: 'pm9', month: 3, plannedDate: '2026-03-10T00:00:00.000Z', approvalStatus: 'PENDING_REVIEW' };
    const api = renderFdm([{ path: PM, body: { data: [entry] } }, { method: 'PUT', path: `${PM}/pm9`, body: {} }]);
    await openTab('PM Entries');
    await screen.findByText(/PENDING_REVIEW/);
    await click(screen.getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit PM Entry');
    expect(field(dlg, 'Approval Status').value).toBe('PENDING_REVIEW');
    // The full PmEntryApprovalStatus enum is offered (the 3-step workflow states included).
    expect(options(field(dlg, 'Approval Status'))).toEqual(expect.arrayContaining(['PENDING_REVIEW', 'PENDING_APPROVAL', 'PENDING', 'APPROVED', 'REJECTED']));
    typeReason(dlg, 'Notes only change');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${PM}/pm9`, 1);
    expect(put.json).toMatchObject({ approvalStatus: 'PENDING_REVIEW', _changeReason: 'Notes only change' });
    await ackMessage('Updated');
  });

  it('Admin request: a legacy RESET_PASSWORD request shows RESET_PASSWORD, and an untouched save keeps it', async () => {
    const legacy = { id: 'q7', requesterName: 'Lee', requestType: 'RESET_PASSWORD', status: 'PENDING', requestedAt: '2026-07-01T09:00:00.000Z' };
    const api = renderFdm([{ path: ADMIN_REQ, body: [legacy] }, { method: 'PUT', path: `${SA_ADMIN_REQ}/q7`, body: {} }]);
    await openTab('Admin Requests');
    await screen.findByText('Lee');
    await click(within(row('Lee')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Admin Request');
    expect(field(dlg, 'Request Type').value).toBe('RESET_PASSWORD');
    typeReason(dlg, 'Remarks only change');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_ADMIN_REQ}/q7`, 1);
    expect(put.json).toMatchObject({ requestType: 'RESET_PASSWORD', _changeReason: 'Remarks only change' });
    await ackMessage('Updated');
  });

  it('Block change: an EXPIRED request shows EXPIRED; the list is the BlockChangeStatus enum (no CONSUMED)', async () => {
    const expired = { id: 'b8', filterName: 'FLT-8', status: 'EXPIRED', reason: 'moved', createdAt: '2026-07-01T09:00:00.000Z' };
    const api = renderFdm([{ path: BCR, body: { data: [expired] } }, { method: 'PUT', path: `${SA_BCR}/b8`, body: {} }]);
    await openTab('Block Changes');
    await screen.findByRole('heading', { name: 'FLT-8' });
    await click(within(screen.getByRole('heading', { name: 'FLT-8' }).closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Block Change Request');
    expect(field(dlg, 'Status').value).toBe('EXPIRED');
    // CONSUMED is not a BlockChangeStatus: the API answers 400 INVALID_VALUE.
    expect(options(field(dlg, 'Status'))).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
    typeReason(dlg, 'Comment only change');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_BCR}/b8`, 1);
    expect(put.json).toMatchObject({ status: 'EXPIRED', _changeReason: 'Comment only change' });
    await ackMessage('Updated');
  });

  it('Block change card: an EXPIRED (consumed) approval reads "Used" as on /approvals, not "Pending"', async () => {
    const expired = { id: 'b8', filterName: 'FLT-8', status: 'EXPIRED', createdAt: '2026-07-01T09:00:00.000Z' };
    renderFdm([{ path: BCR, body: { data: [expired] } }]);
    await openTab('Block Changes');
    const card = (await screen.findByRole('heading', { name: 'FLT-8' })).closest('div.group') as HTMLElement;
    expect(card).toHaveTextContent('Used');
    expect(card).not.toHaveTextContent('Pending');
  });

  it('Block change create offers the same enum values', async () => {
    renderFdm([{ path: BCR, body: { data: [] } }, { path: '/api/hierarchy/filters', body: { data: [] } }]);
    await openTab('Block Changes');
    await screen.findByText('No block change requests');
    await click(screen.getByRole('button', { name: 'Create' }));
    expect(options(field(modal('Create Block Change Request'), 'Status'))).toEqual(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED']);
  });

  it('PM entry create offers the full approval enum after the blank (server default)', async () => {
    renderFdm([{ path: PM, body: { data: [] } }, { path: '/api/super-admin/data/pm-schedules', body: { data: [] } }]);
    await openTab('PM Entries');
    await click(await screen.findByRole('button', { name: 'Create' }));
    expect(options(field(modal('Create PM Entry'), 'Approval Status'))).toEqual(['', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'PENDING', 'APPROVED', 'REJECTED']);
  });

  it('a value the user picks is still sent (the helper only adds the stored value)', async () => {
    const entry = { id: 'pm9', month: 3, plannedDate: '2026-03-10T00:00:00.000Z', approvalStatus: 'PENDING_REVIEW' };
    const api = renderFdm([{ path: PM, body: { data: [entry] } }, { method: 'PUT', path: `${PM}/pm9`, body: {} }]);
    await openTab('PM Entries');
    await screen.findByText(/PENDING_REVIEW/);
    await click(screen.getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit PM Entry');
    setField(dlg, 'Approval Status', 'PENDING_APPROVAL');
    typeReason(dlg, 'Reviewed on paper');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${PM}/pm9`, 1);
    expect(put.json).toMatchObject({ approvalStatus: 'PENDING_APPROVAL' });
    await ackMessage('Updated');
  });
});

describe('D6 — the configured page size applies on a cold load', () => {
  // baseRoutes() configures limit 20, which equals the hook's pre-load fallback
  // (20) - that is how a page size seeded from the fallback stayed invisible.
  const CONFIGURED = { limit: 5, count: 3, options: [2, 5, 20] };
  const CYCLES = '/api/filters/cycles';
  const cycleRoutes = [
    { path: CYCLES, body: { data: [], total: 40 } },
    { path: '/api/hierarchy/filters', body: { data: [] } },
  ];

  it('a server-paged tab requests the configured page size, not the fallback the state was seeded from', async () => {
    const api = renderFdm(cycleRoutes, { pagination: CONFIGURED });
    await waitFor(() => expect(api.calls('GET', '/api/config/pagination/current').length).toBeGreaterThan(0));
    await openTab('Cleaning Cycles');
    await waitFor(() => expect(api.calls('GET', CYCLES).at(-1)!.query.get('limit')).toBe('5'));
  });

  it('a size the operator picks still sticks', async () => {
    const api = renderFdm(cycleRoutes, { pagination: CONFIGURED });
    await openTab('Cleaning Cycles');
    await waitFor(() => expect(api.calls('GET', CYCLES).at(-1)!.query.get('limit')).toBe('5'));
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '2' } });
    await waitFor(() => expect(api.calls('GET', CYCLES).at(-1)!.query.get('limit')).toBe('2'));
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });
});
