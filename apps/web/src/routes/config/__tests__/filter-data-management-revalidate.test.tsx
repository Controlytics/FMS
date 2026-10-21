/**
 * REVALIDATE_KEYS — the one list of user-facing SWR keys each entity's
 * edit / create / delete must refresh (root CLAUDE.md "Filter Data Management:
 * cache invalidation"). A cycle edit that saved but did not refresh
 * /api/filters/cleaning-record read as "it didn't save".
 *
 * The page refreshes through the GLOBAL swr `mutate`, which only reaches SWR's
 * default cache, so these tests mount on the default cache (as production
 * does) with probe readers holding the user-facing keys. See fdm-helpers.tsx.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { resetEnv, ackMessage } from './config-test-helpers';
import { renderFdmGlobalCache, clearGlobalCache, modal, setField, typeReason, click, row, waitForCalls, openTab } from './fdm-helpers';

afterEach(async () => { resetEnv(); await clearGlobalCache(); });

const C1 = {
  id: 'c1', cycleCode: 'CYC-001', filterId: 'f1', filterName: 'FLT-100', status: 'COMPLETED',
  startedAt: '2026-07-01T08:00:00.000Z', completedAt: '2026-07-01T09:30:00.000Z', events: [],
};
const CYCLE_ROUTES = [
  { path: '/api/filters/cycles', body: { data: [C1], total: 1 } },
  { path: '/api/hierarchy/filters', body: { data: [] } },
];

async function settledGets(api: any, path: string, n = 1) {
  await waitFor(() => expect(api.calls('GET', path).length).toBe(n));
}

describe('Filter Data Management — refreshes the user-facing pages after a change', () => {
  it('a cleaning-cycle edit refetches the Cleaning Record, dashboard, batch-state and AHU feeds — and not unrelated ones', async () => {
    const probes = [
      '/api/filters/cleaning-record?page=1&t=a',
      '/api/filters/dashboard-stats?t=a',
      '/api/filters/batch-states?t=a',
      '/api/filters/ahu-completion-status?t=a',
      '/api/filters/manual-status-changes?t=a',
      '/api/notifications?t=a',
      '/api/pm-schedules/due?t=a',
    ];
    const api = renderFdmGlobalCache([...CYCLE_ROUTES, { method: 'PUT', path: '/api/super-admin/data/cleaning-cycles/c1', body: {} }], probes);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    for (const p of probes) await settledGets(api, p.split('?')[0]);
    const cyclesBefore = api.calls('GET', '/api/filters/cycles').length;

    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    setField(dlg, 'Cleaning Reason', 'Breakdown');
    typeReason(dlg, 'Wrong reason recorded');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await waitForCalls(api, 'PUT', '/api/super-admin/data/cleaning-cycles/c1', 1);
    await ackMessage('Updated');

    for (const p of ['/api/filters/cleaning-record', '/api/filters/dashboard-stats', '/api/filters/batch-states', '/api/filters/ahu-completion-status', '/api/filters/manual-status-changes']) {
      await settledGets(api, p, 2);
    }
    // The tab's own feed refreshes too.
    await waitFor(() => expect(api.calls('GET', '/api/filters/cycles').length).toBeGreaterThan(cyclesBefore));
    // Scoped: a cycle edit does not touch notifications or PM.
    expect(api.calls('GET', '/api/notifications')).toHaveLength(1);
    expect(api.calls('GET', '/api/pm-schedules/due')).toHaveLength(1);
  });

  it('deleting a filter event refreshes the event, cycle and Cleaning Record feeds', async () => {
    const probes = ['/api/filters/cleaning-record?t=b', '/api/notifications?t=b'];
    const api = renderFdmGlobalCache([
      { path: '/api/filters/events', body: { data: [{ id: 'ev1', eventType: 'REMARK_ADDED', performedAt: '2026-07-01T08:00:00.000Z', remarks: 'note one' }], total: 1 } },
      { method: 'DELETE', path: '/api/super-admin/data/filter-events/ev1', body: {} },
    ], probes);
    await openTab('Filter Events');
    await screen.findByText('note one');
    for (const p of probes) await settledGets(api, p.split('?')[0]);
    const eventsBefore = api.calls('GET', '/api/filters/events').length;
    await click(within(screen.getByText('note one').closest('div.group') as HTMLElement).getByRole('button', { name: 'Delete' }));
    const dlg = modal('Permanent Deletion');
    typeReason(dlg, 'Duplicate remark');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    await ackMessage('Deleted');
    await settledGets(api, '/api/filters/cleaning-record', 2);
    await waitFor(() => expect(api.calls('GET', '/api/filters/events').length).toBeGreaterThan(eventsBefore));
    expect(api.calls('GET', '/api/notifications')).toHaveLength(1);
  });

  it('creating a notification refreshes the bell / notifications page, not the cleaning record', async () => {
    const probes = ['/api/notifications?unread=1&t=c', '/api/filters/cleaning-record?t=c'];
    const api = renderFdmGlobalCache([
      { path: '/api/super-admin/data/notifications', body: { data: [{ id: 'n1', type: 'SYSTEM_ERROR', title: 'Existing', isRead: true, createdAt: '2026-07-01T00:00:00.000Z' }] } },
      { method: 'POST', path: '/api/super-admin/data/notifications', body: {} },
    ], probes);
    await openTab('Notifications');
    await screen.findByText('Existing');
    for (const p of probes) await settledGets(api, p.split('?')[0]);
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Notification');
    setField(dlg, 'Type', 'SYSTEM_ERROR');
    setField(dlg, 'Title', 'New one');
    setField(dlg, 'Message', 'Body');
    typeReason(dlg, 'Restore lost alert');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    await ackMessage('Created');
    await settledGets(api, '/api/notifications', 2);
    expect(api.calls('GET', '/api/filters/cleaning-record')).toHaveLength(1);
  });

  it('a PM entry edit refreshes the PM Schedules / My Tasks feeds', async () => {
    const probes = ['/api/pm-schedules/due?t=d', '/api/pm-schedules/pending-tasks-map?t=d'];
    const api = renderFdmGlobalCache([
      { path: '/api/super-admin/data/pm-entries', body: { data: [{ id: 'pm1', month: 3, plannedDate: '2026-03-10T00:00:00.000Z' }] } },
      { method: 'PUT', path: '/api/super-admin/data/pm-entries/pm1', body: {} },
    ], probes);
    await openTab('PM Entries');
    await screen.findByText(/^Mar/, { selector: 'span.text-lg' });
    for (const p of probes) await settledGets(api, p.split('?')[0]);
    await click(within(screen.getByText(/^Mar/, { selector: 'span.text-lg' }).closest('div.group') as HTMLElement).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit PM Entry');
    typeReason(dlg, 'Notes correction');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await ackMessage('Updated');
    await settledGets(api, '/api/pm-schedules/due', 2);
    await settledGets(api, '/api/pm-schedules/pending-tasks-map', 2);
  });

  it('an admin-request edit refreshes /api/admin-requests and leaves the block-change list alone', async () => {
    const probes = ['/api/block-change-requests?page=9&t=e'];
    const api = renderFdmGlobalCache([
      { path: '/api/admin-requests', body: [{ id: 'q1', requesterName: 'Jane', requestType: 'UNLOCK', status: 'PENDING', requestedAt: '2026-07-01T00:00:00.000Z' }] },
      { method: 'PUT', path: '/api/super-admin/data/admin-requests/q1', body: {} },
    ], probes);
    await openTab('Admin Requests');
    await screen.findByText('Jane');
    const before = api.calls('GET', '/api/admin-requests').length;
    await click(within(row('Jane')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Admin Request');
    typeReason(dlg, 'Processed offline');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await ackMessage('Updated');
    await waitFor(() => expect(api.calls('GET', '/api/admin-requests').length).toBeGreaterThan(before));
    // Not a block-change edit -> that list is untouched.
    expect(api.calls('GET', '/api/block-change-requests')).toHaveLength(1);
  });

  it('an audit-row edit refreshes every /api/audit list; a retirement edit refreshes both array feeds', async () => {
    const probes = ['/api/audit?page=3&t=f'];
    const api = renderFdmGlobalCache([
      { path: '/api/audit', body: { data: [{ id: 'a1', timestamp: '2026-07-01T00:00:00.000Z', action: 'USER_CREATED', userId: 'admin' }] } },
      { method: 'PUT', path: '/api/audit/a1', body: {} },
      { method: 'PUT', path: '/api/super-admin/filter-data/retirements/r1', body: {} },
    ], probes);
    await screen.findByText('FLT-001');
    const retBefore = api.calls('GET', '/api/filters/retirements').length;
    const repBefore = api.calls('GET', '/api/filters/replacements').length;
    await click(within(row('FLT-001')).getByRole('button', { name: /Edit/ }));
    await click(within(screen.getByDisplayValue('FLT-001').closest('tr') as HTMLElement).getByRole('button', { name: /Save/ }));
    let dlg = modal('Edit retirement record');
    typeReason(dlg, 'Corrected the name');
    await click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await ackMessage('Updated');
    await waitFor(() => expect(api.calls('GET', '/api/filters/retirements').length).toBeGreaterThan(retBefore));
    await waitFor(() => expect(api.calls('GET', '/api/filters/replacements').length).toBeGreaterThan(repBefore));

    await openTab('Audit Trail');
    await screen.findByText('USER_CREATED');
    const auditBefore = api.calls('GET', '/api/audit').length;
    await click(within(row('USER_CREATED')).getByRole('button', { name: 'Edit' }));
    dlg = modal('Edit audit record');
    typeReason(dlg, 'Wrong user recorded');
    await click(within(dlg).getByRole('button', { name: 'Save & break chain' }));
    await ackMessage('Audit record edited');
    // Both the tab's feed and the separate /api/audit?page=3 reader refetch.
    await waitFor(() => expect(api.calls('GET', '/api/audit').length).toBeGreaterThanOrEqual(auditBefore + 2));
    expect(api.calls('GET', '/api/audit').some((c, i) => i >= auditBefore && c.query.get('page') === '3')).toBe(true);
  });
});
