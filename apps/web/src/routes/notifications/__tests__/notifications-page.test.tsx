import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest, type MockRoute, type MockApi } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { findDialog } from '@/routes/auth/__tests__/support';
import { NotificationsPage } from '../index';

/**
 * Notifications page. Real SWR list + filters -> query string, real useCan
 * (notifications.mark gate NOTIFICATION_VIEW, notifications.delete gate
 * NOTIFICATION_DELETE, SUPER_ADMIN bypass), real useReauth for both deletes,
 * and the SUPER_ADMIN record-edit dialog. Only fetch is stubbed.
 */

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

const N = (over: Record<string, unknown> = {}) => ({
  id: 'n1', type: 'ACCOUNT_LOCKED', title: 'Account locked', message: 'User asha01 was locked',
  targetUserId: 'asha01', isRead: false, createdAt: ago(10 * 1000), forUserId: null, forRole: null, ...over,
});

const LIST = [
  N(),
  N({ id: 'n2', type: 'USER_CREATED', title: 'User created', message: 'jdoe01 created', isRead: true, targetUserId: null, createdAt: ago(5 * MIN) }),
  N({ id: 'n3', type: 'PM_OVERDUE', title: 'PM overdue', message: 'AHU-1 PM overdue', createdAt: ago(3 * HOUR), targetUserId: null }),
  N({ id: 'n4', type: 'PASSWORD_EXPIRY_WARNING', title: 'Password expiring', message: 'Change soon', createdAt: ago(2 * DAY), isRead: true, targetUserId: null }),
  N({ id: 'n5', type: 'ROLE_CHANGED', title: 'Role changed', message: 'Now QA', createdAt: '2026-01-15T10:00:00.000Z', targetUserId: null }),
];

const VIEWER = { role: 'OPERATOR', permissions: ['NOTIFICATION_VIEW'] };
const DELETER = { role: 'ADMIN', permissions: ['NOTIFICATION_VIEW', 'NOTIFICATION_DELETE'] };
const READ_ONLY = { role: 'GUEST_ROLE', permissions: [] as string[] };

function page(opts: { user?: Record<string, unknown>; list?: unknown; unread?: number; total?: number; reauth?: string[]; routes?: MockRoute[] } = {}): MockApi {
  const api = mockApi([
    ...(opts.routes ?? []),
    ...commonConfigRoutes(), reauthActions(opts.reauth ?? []),
    { path: '/api/notifications', body: { data: opts.list ?? LIST, total: opts.total ?? (Array.isArray(opts.list) ? (opts.list as unknown[]).length : LIST.length), unreadCount: opts.unread ?? 3 } },
  ]);
  renderPage(<NotificationsPage />, { route: '/notifications', api, user: (opts.user ?? DELETER) as { role: string } });
  return api;
}

const lastList = (api: MockApi) => { const c = api.calls('GET', '/api/notifications'); return c[c.length - 1]; };
const row = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('div.p-5') as HTMLElement;
const rowBox = (title: string) => within(row(title)).getByRole('checkbox');
const rowDelete = (title: string) => row(title).querySelector('button.text-red-500') as HTMLButtonElement;
// The Time Period / Status selects have no accessible name (finding), so find them by their options.
const periodSelect = () => document.querySelector('option[value="custom"]')!.closest('select') as HTMLSelectElement;
const statusSelect = () => document.querySelector('option[value="false"]')!.closest('select') as HTMLSelectElement;
/** toast.error / toast.success open a one-at-a-time acknowledgement modal; OK dismisses it. */
const ack = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'OK' })).toBeNull());
};

describe('Notifications — list', () => {
  it('renders every notification with its type, target, unread marker and relative time; header counts unread', async () => {
    const api = page();
    expect(await screen.findByText('3 unread notifications')).toBeInTheDocument();
    expect(row('Account locked')).toHaveTextContent('User asha01 was locked');
    expect(row('Account locked')).toHaveTextContent('ACCOUNT LOCKED');
    expect(row('Account locked')).toHaveTextContent('@asha01');
    expect(row('Account locked')).toHaveTextContent('Just now');
    expect(row('User created')).toHaveTextContent('5m ago');
    expect(row('PM overdue')).toHaveTextContent('3h ago');
    expect(row('Password expiring')).toHaveTextContent('2d ago');
    expect(row('Role changed')).toHaveTextContent('15/01/2026');
    expect(row('PM overdue')).toHaveTextContent('PM OVERDUE'); // type with no colour/icon entry still renders
    // unread rows carry the pulse dot, read rows do not
    expect(row('Account locked').querySelector('.animate-pulse')).not.toBeNull();
    expect(row('User created').querySelector('.animate-pulse')).toBeNull();
    // (the first page's size is covered by the D6 case below)
    const q = lastList(api).query;
    expect(q.get('page')).toBe('1');
    expect(q.get('period')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('header wording: one unread is singular, none is "All caught up!"', async () => {
    page({ unread: 1 });
    expect(await screen.findByText('1 unread notification')).toBeInTheDocument();
    cleanup();
    page({ unread: 0 });
    expect(await screen.findByText('All caught up!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark All as Read/ })).toBeNull();
  });

  it('an empty list says "Try adjusting your filters"; no select-all, no pagination', async () => {
    page({ list: [], total: 0, unread: 0 });
    expect(await screen.findByText('No notifications found')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument();
    expect(screen.queryByText('Select All on Page')).toBeNull();
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });
});

describe('Notifications — permissions', () => {
  it('a user with NOTIFICATION_VIEW can mark but not delete', async () => {
    page({ user: VIEWER });
    await screen.findByText('Account locked');
    expect(await screen.findByRole('button', { name: /Mark All as Read/ })).toBeInTheDocument();
    expect(within(row('Account locked')).getByRole('button', { name: 'Mark Read' })).toBeInTheDocument();
    expect(rowDelete('Account locked')).toBeNull();
    fireEvent.click(rowBox('Account locked'));
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Selected/ })).toBeNull();
  });

  it('a user without NOTIFICATION_VIEW sees the list but no mark or delete controls', async () => {
    page({ user: READ_ONLY });
    await screen.findByText('3 unread notifications');
    expect(screen.getByText('Account locked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark All as Read/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark Read' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark Unread' })).toBeNull();
    expect(rowDelete('Account locked')).toBeNull();
  });

  it('SUPER_ADMIN gets every control without holding the permissions, plus the edit pencil', async () => {
    const api = page({
      user: { role: 'SUPER_ADMIN', permissions: [] },
      routes: [
        { path: '/api/users', body: { data: [{ id: 'u1', username: 'asha01', fullName: 'Asha Rao' }] } },
        { path: '/api/roles/active', body: [{ name: 'QA', displayName: 'Quality' }] },
      ],
    });
    await screen.findByText('Account locked');
    expect(await screen.findByRole('button', { name: /Mark All as Read/ })).toBeInTheDocument();
    expect(rowDelete('Account locked')).not.toBeNull();
    expect(within(row('Account locked')).getByRole('button', { name: 'Edit record (Super Admin)' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/users')[0]?.query.get('limit')).toBe('1000000'));
    expect(api.calls('GET', '/api/roles/active').length).toBeGreaterThan(0);
  });

  it('a non-SUPER_ADMIN never fetches the users/roles lists and has no pencil', async () => {
    const api = page();
    await screen.findByText('Account locked');
    expect(within(row('Account locked')).queryByRole('button', { name: 'Edit record (Super Admin)' })).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
    expect(api.calls('GET', '/api/roles/active')).toHaveLength(0);
  });
});

describe('Notifications — mark read / unread', () => {
  const ok = (path: string): MockRoute => ({ method: 'PUT', path, body: { ok: true } });

  it('row Mark Read / Mark Unread call their endpoints and refetch the list', async () => {
    const api = page({ routes: [ok('/api/notifications/n1/read'), ok('/api/notifications/n2/unread')] });
    await screen.findByText('Account locked');
    const before = api.calls('GET', '/api/notifications').length;
    fireEvent.click(within(row('Account locked')).getByRole('button', { name: 'Mark Read' }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/n1/read')).toHaveLength(1));
    fireEvent.click(within(row('User created')).getByRole('button', { name: 'Mark Unread' }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/n2/unread')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', '/api/notifications').length).toBeGreaterThanOrEqual(before + 2));
    expect(api.calls('PUT', '/api/notifications/n1/read')[0].json).toEqual({});
  });

  it('Mark All as Read calls mark-all-read', async () => {
    const api = page({ routes: [ok('/api/notifications/mark-all-read')] });
    fireEvent.click(await screen.findByRole('button', { name: /Mark All as Read/ }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/mark-all-read')).toHaveLength(1));
  });

  it('each failure raises its own error toast with the server message (or a generic one)', async () => {
    page({
      routes: [
        { method: 'PUT', path: '/api/notifications/n1/read', status: 500, body: { error: 'X', message: 'db down' } },
        { method: 'PUT', path: '/api/notifications/n2/unread', status: 500, body: { error: 'X', message: '' } },
        { method: 'PUT', path: '/api/notifications/mark-all-read', status: 409, body: { error: 'X', message: 'busy' } },
      ],
    });
    await screen.findByText('Account locked');
    fireEvent.click(within(row('Account locked')).getByRole('button', { name: 'Mark Read' }));
    expect(await screen.findByText('Failed to mark as read')).toBeInTheDocument();
    expect(screen.getByText('db down')).toBeInTheDocument();
    await ack();
    fireEvent.click(within(row('User created')).getByRole('button', { name: 'Mark Unread' }));
    expect(await screen.findByText('Failed to mark as unread')).toBeInTheDocument();
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
    await ack();
    fireEvent.click(screen.getByRole('button', { name: /Mark All as Read/ }));
    expect(await screen.findByText('Failed to mark all as read')).toBeInTheDocument();
    expect(screen.getByText('busy')).toBeInTheDocument();
  });

  it('message-less failures of row read, mark-all and bulk read all fall back to "Operation failed"', async () => {
    page({
      routes: [
        { method: 'PUT', path: '/api/notifications/n1/read', status: 500, body: { error: 'X', message: '' } },
        { method: 'PUT', path: '/api/notifications/mark-all-read', status: 500, body: { error: 'X', message: '' } },
        { method: 'PUT', path: '/api/notifications/bulk-read', status: 500, body: { error: 'X', message: '' } },
      ],
    });
    await screen.findByText('Account locked');
    fireEvent.click(within(row('Account locked')).getByRole('button', { name: 'Mark Read' }));
    expect(await screen.findByText('Failed to mark as read')).toBeInTheDocument();
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
    await ack();
    fireEvent.click(screen.getByRole('button', { name: /Mark All as Read/ }));
    expect(await screen.findByText('Failed to mark all as read')).toBeInTheDocument();
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
    await ack();
    fireEvent.click(rowBox('PM overdue'));
    const bar = (await screen.findByText('1 selected')).closest('div.border-2') as HTMLElement;
    fireEvent.click(within(bar).getByRole('button', { name: 'Mark Read' }));
    expect(await screen.findByText('Failed to bulk mark as read')).toBeInTheDocument();
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
  });
});

describe('Notifications — selection + bulk actions', () => {
  it('select one, select all on page, toggle off, and Clear Selection', async () => {
    page();
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect(screen.getByText('(1 selected)')).toBeInTheDocument();
    expect(row('Account locked').className).toContain('border-indigo-300');
    fireEvent.click(rowBox('Account locked'));
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());

    const all = screen.getByRole('checkbox', { name: 'Select All on Page' });
    fireEvent.click(all);
    expect(await screen.findByText('5 selected')).toBeInTheDocument();
    expect(all).toBeChecked();
    fireEvent.click(all);
    await waitFor(() => expect(screen.queryByText('5 selected')).toBeNull());
    expect(all).not.toBeChecked();

    fireEvent.click(rowBox('PM overdue'));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Selection' }));
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });

  it('bulk Mark Read / Mark Unread send the selected ids and clear the selection', async () => {
    const api = page({
      routes: [
        { method: 'PUT', path: '/api/notifications/bulk-read', body: { ok: true } },
        { method: 'PUT', path: '/api/notifications/bulk-unread', body: { ok: true } },
      ],
    });
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    fireEvent.click(rowBox('PM overdue'));
    const bar = (await screen.findByText('2 selected')).closest('div.border-2') as HTMLElement;
    fireEvent.click(within(bar).getByRole('button', { name: 'Mark Read' }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/bulk-read')).toHaveLength(1));
    expect(api.calls('PUT', '/api/notifications/bulk-read')[0].json).toEqual({ ids: ['n1', 'n3'] });
    await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());

    fireEvent.click(rowBox('User created'));
    const bar2 = (await screen.findByText('1 selected')).closest('div.border-2') as HTMLElement;
    fireEvent.click(within(bar2).getByRole('button', { name: 'Mark Unread' }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/bulk-unread')).toHaveLength(1));
    expect(api.calls('PUT', '/api/notifications/bulk-unread')[0].json).toEqual({ ids: ['n2'] });
  });

  it('bulk mark failures toast and keep the selection', async () => {
    page({
      routes: [
        { method: 'PUT', path: '/api/notifications/bulk-read', status: 500, body: { error: 'X', message: 'nope' } },
        { method: 'PUT', path: '/api/notifications/bulk-unread', status: 500, body: { error: 'X', message: '' } },
      ],
    });
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    const bar = (await screen.findByText('1 selected')).closest('div.border-2') as HTMLElement;
    fireEvent.click(within(bar).getByRole('button', { name: 'Mark Read' }));
    expect(await screen.findByText('Failed to bulk mark as read')).toBeInTheDocument();
    expect(screen.getByText('nope')).toBeInTheDocument();
    await ack();
    fireEvent.click(within(bar).getByRole('button', { name: 'Mark Unread' }));
    expect(await screen.findByText('Failed to bulk mark as unread')).toBeInTheDocument();
    expect(screen.getByText('Operation failed')).toBeInTheDocument();
    await ack();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});

describe('Notifications — bulk delete', () => {
  async function selectTwoAndOpen() {
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    fireEvent.click(rowBox('User created'));
    fireEvent.click(await screen.findByRole('button', { name: /Delete Selected/ }));
    return findDialog('Delete Notifications');
  }

  it('asks for confirmation naming the count; Cancel closes without deleting', async () => {
    const api = page();
    const dlg = await selectTwoAndOpen();
    expect(dlg).toHaveTextContent('permanently delete 2 notifications?');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete Notifications')).toBeNull());
    expect(api.calls('POST', '/api/notifications/bulk-delete')).toHaveLength(0);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('singular wording for one; confirming posts the ids, closes, clears the selection and refetches', async () => {
    const api = page({ routes: [{ method: 'POST', path: '/api/notifications/bulk-delete', body: { deleted: 1 } }] });
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    fireEvent.click(await screen.findByRole('button', { name: /Delete Selected/ }));
    const dlg = await findDialog('Delete Notifications');
    expect(dlg).toHaveTextContent('permanently delete 1 notification?');
    const before = api.calls('GET', '/api/notifications').length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete 1 Notification' }));
    await waitFor(() => expect(api.calls('POST', '/api/notifications/bulk-delete')).toHaveLength(1));
    const sent = api.calls('POST', '/api/notifications/bulk-delete')[0];
    expect(sent.json).toEqual({ ids: ['n1'] });
    expect(sent.headers['x-reauth-password']).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('Delete Notifications')).toBeNull());
    expect(screen.queryByText('1 selected')).toBeNull();
    await waitFor(() => expect(api.calls('GET', '/api/notifications').length).toBeGreaterThan(before));
  });

  it('Escape closes the confirmation', async () => {
    page();
    await selectTwoAndOpen();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Delete Notifications')).toBeNull());
  });

  it('with BULK_DELETE_NOTIFICATIONS gated: password prompt, then the password rides in header + body', async () => {
    const api = page({ reauth: ['BULK_DELETE_NOTIFICATIONS'], routes: [{ method: 'POST', path: '/api/notifications/bulk-delete', body: { deleted: 2 } }] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const dlg = await selectTwoAndOpen();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete 2 Notifications' }));
    const pw = await findDialog('Confirm Your Identity');
    expect(api.calls('POST', '/api/notifications/bulk-delete')).toHaveLength(0);
    fireEvent.change(within(pw).getByPlaceholderText('Enter your password'), { target: { value: 'Secret@1' } });
    fireEvent.click(within(pw).getByRole('button', { name: /Confirm|Verify/ }));
    await waitFor(() => expect(api.calls('POST', '/api/notifications/bulk-delete')).toHaveLength(1));
    const sent = api.calls('POST', '/api/notifications/bulk-delete')[0];
    expect(sent.headers['x-reauth-password']).toBe('Secret@1');
    expect(sent.json).toEqual({ ids: ['n1', 'n2'], _currentPassword: 'Secret@1' });
    await waitFor(() => expect(screen.queryByText('Delete Notifications')).toBeNull());
  });

  it('cancelling the BULK_DELETE_NOTIFICATIONS prompt deletes nothing, is silent and keeps the confirm dialog', async () => {
    const api = page({ reauth: ['BULK_DELETE_NOTIFICATIONS'] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const dlg = await selectTwoAndOpen();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete 2 Notifications' }));
    const pw = await findDialog('Confirm Your Identity');
    fireEvent.click(within(pw).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(api.calls('POST', '/api/notifications/bulk-delete')).toHaveLength(0);
    expect(screen.queryByText('Failed to delete notifications')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete 2 Notifications' })).toBeEnabled();
  });

  it('a refused bulk delete toasts and keeps the dialog open', async () => {
    page({ routes: [{ method: 'POST', path: '/api/notifications/bulk-delete', status: 403, body: { error: 'FORBIDDEN', message: 'Not allowed' } }] });
    const dlg = await selectTwoAndOpen();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete 2 Notifications' }));
    expect(await screen.findByText('Failed to delete notifications')).toBeInTheDocument();
    expect(screen.getByText('Not allowed')).toBeInTheDocument();
    expect(screen.getByText('Delete Notifications')).toBeInTheDocument();
  });

  it('a refused bulk delete with no message says "Operation failed"', async () => {
    page({ routes: [{ method: 'POST', path: '/api/notifications/bulk-delete', status: 500, body: { error: 'X', message: '' } }] });
    const dlg = await selectTwoAndOpen();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete 2 Notifications' }));
    expect(await screen.findByText('Operation failed')).toBeInTheDocument();
  });
});

describe('Notifications — single delete', () => {
  it('deletes one notification (DELETE with an empty JSON body) and drops it from the selection', async () => {
    const api = page({ routes: [{ method: 'DELETE', path: '/api/notifications/n1', status: 204 }] });
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    fireEvent.click(rowBox('User created'));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    fireEvent.click(rowDelete('Account locked'));
    await waitFor(() => expect(api.calls('DELETE', '/api/notifications/n1')).toHaveLength(1));
    expect(api.calls('DELETE', '/api/notifications/n1')[0].json).toEqual({});
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
  });

  it('with DELETE_NOTIFICATION gated: prompt, then DELETE carries the password', async () => {
    const api = page({ reauth: ['DELETE_NOTIFICATION'], routes: [{ method: 'DELETE', path: '/api/notifications/n3', status: 204 }] });
    await screen.findByText('PM overdue');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(rowDelete('PM overdue'));
    const pw = await findDialog('Confirm Your Identity');
    fireEvent.change(within(pw).getByPlaceholderText('Enter your password'), { target: { value: 'Pw#1' } });
    fireEvent.click(within(pw).getByRole('button', { name: /Confirm|Verify/ }));
    await waitFor(() => expect(api.calls('DELETE', '/api/notifications/n3')).toHaveLength(1));
    const sent = api.calls('DELETE', '/api/notifications/n3')[0];
    expect(sent.headers['x-reauth-password']).toBe('Pw#1');
    expect(sent.json).toEqual({ _currentPassword: 'Pw#1' });
  });

  it('cancelling the prompt deletes nothing and is silent', async () => {
    const api = page({ reauth: ['DELETE_NOTIFICATION'] });
    await screen.findByText('PM overdue');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(rowDelete('PM overdue'));
    const pw = await findDialog('Confirm Your Identity');
    fireEvent.click(within(pw).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('DELETE', '/api/notifications/n3')).toHaveLength(0);
    expect(screen.getByText('PM overdue')).toBeInTheDocument();
    // a dismissed prompt is not a failure (D-OPS-8 pattern)
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByText('Failed to delete notification')).toBeNull();
  });

  it('REAUTH_REQUIRED from the server opens the prompt even when the feed said no', async () => {
    const api = page({
      routes: [
        { method: 'DELETE', path: '/api/notifications/n1', times: 1, status: 403, body: { error: 'REAUTH_REQUIRED', message: 'Password required' } },
        { method: 'DELETE', path: '/api/notifications/n1', status: 204 },
      ],
    });
    await screen.findByText('Account locked');
    fireEvent.click(rowDelete('Account locked'));
    const pw = await findDialog('Confirm Your Identity');
    fireEvent.change(within(pw).getByPlaceholderText('Enter your password'), { target: { value: 'Pw#2' } });
    fireEvent.click(within(pw).getByRole('button', { name: /Confirm|Verify/ }));
    await waitFor(() => expect(api.calls('DELETE', '/api/notifications/n1')).toHaveLength(2));
    expect(api.calls('DELETE', '/api/notifications/n1')[1].headers['x-reauth-password']).toBe('Pw#2');
  });

  it('a refused delete toasts the server message or "Operation failed"', async () => {
    page({
      routes: [
        { method: 'DELETE', path: '/api/notifications/n1', status: 404, body: { error: 'NOT_FOUND', message: 'Notification not found' } },
        { method: 'DELETE', path: '/api/notifications/n2', status: 500, body: { error: 'X', message: '' } },
      ],
    });
    await screen.findByText('Account locked');
    fireEvent.click(rowDelete('Account locked'));
    expect(await screen.findByText('Notification not found')).toBeInTheDocument();
    expect(screen.getByText('Failed to delete notification')).toBeInTheDocument();
    await ack();
    fireEvent.click(rowDelete('User created'));
    expect(await screen.findByText('Operation failed')).toBeInTheDocument();
  });
});

describe('Notifications — filters', () => {
  it('search is debounced into ?search=, shows a chip + "1 active", and the x clears it', async () => {
    const api = page({ list: [], total: 0 });
    await screen.findByText('No notifications found');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notifications' }), { target: { value: '  locked ' } });
    // not sent on every keystroke
    expect(lastList(api).query.get('search')).toBeNull();
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('locked'));
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('"locked"')).toBeInTheDocument();
    expect(screen.getByText('Nothing matches "locked"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(lastList(api).query.get('search')).toBeNull());
    expect(screen.queryByText('1 active')).toBeNull();
  });

  it('the search chip has its own clear button', async () => {
    const api = page();
    await screen.findByText('Account locked');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notifications' }), { target: { value: 'pm' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear "pm" filter' }));
    await waitFor(() => expect(lastList(api).query.get('search')).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Search notifications' })).toHaveValue('');
  });

  it('a preset period is sent as ?period= and labelled; its chip clears it', async () => {
    const api = page();
    await screen.findByText('Account locked');
    for (const [value, label] of [['today', 'Today'], ['month', 'This Month'], ['quarter', 'Last 90 Days'], ['year', 'This Year'], ['week', 'Last 7 Days']] as const) {
      fireEvent.change(periodSelect(), { target: { value } });
      await waitFor(() => expect(lastList(api).query.get('period')).toBe(value));
      expect(screen.getByRole('button', { name: `Clear ${label} filter` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Clear Last 7 Days filter' }));
    await waitFor(() => expect(lastList(api).query.get('period')).toBeNull());
  });

  it('Custom range sends startDate/endDate (never period), chips "any" for an open end, and leaving Custom drops the dates', async () => {
    const api = page();
    await screen.findByText('Account locked');
    fireEvent.change(periodSelect(), { target: { value: 'custom' } });
    expect(await screen.findByLabelText('From date')).toBeInTheDocument();
    // custom with no dates yet: no chip, no params
    expect(screen.queryByText(/active$/)).toBeNull();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(lastList(api).query.get('startDate')).toBe('2026-10-01'));
    expect(lastList(api).query.get('period')).toBeNull();
    expect(screen.getByText('2026-10-01 to any')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-10' } });
    await waitFor(() => expect(lastList(api).query.get('endDate')).toBe('2026-10-10'));
    expect(screen.getByText('2026-10-01 to 2026-10-10')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Custom Range…'), { target: { value: 'all' } });
    await waitFor(() => expect(lastList(api).query.get('startDate')).toBeNull());
    // picking Custom again does not resurrect the old range
    fireEvent.change(periodSelect(), { target: { value: 'custom' } });
    expect(await screen.findByLabelText('From date')).toHaveValue('');
  });

  it('the range chip clears both dates and returns to All Time; a To-only range reads "any to …"', async () => {
    const api = page();
    await screen.findByText('Account locked');
    fireEvent.change(periodSelect(), { target: { value: 'custom' } });
    fireEvent.change(await screen.findByLabelText('To date'), { target: { value: '2026-10-10' } });
    expect(await screen.findByText('any to 2026-10-10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear any to 2026-10-10 filter' }));
    await waitFor(() => expect(lastList(api).query.get('endDate')).toBeNull());
    expect(screen.getByDisplayValue('All Time')).toBeInTheDocument();
  });

  it('read status filter: Unread -> isRead=false (empty: "all caught up"), Read -> isRead=true; chip clears it', async () => {
    const api = page({ list: [], total: 0 });
    await screen.findByText('No notifications found');
    fireEvent.change(statusSelect(), { target: { value: 'false' } });
    await waitFor(() => expect(lastList(api).query.get('isRead')).toBe('false'));
    expect(screen.getByText("You're all caught up!")).toBeInTheDocument();
    fireEvent.change(statusSelect(), { target: { value: 'true' } });
    await waitFor(() => expect(lastList(api).query.get('isRead')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear Read filter' }));
    await waitFor(() => expect(lastList(api).query.get('isRead')).toBeNull());
    fireEvent.change(statusSelect(), { target: { value: 'false' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Unread filter' }));
    await waitFor(() => expect(lastList(api).query.get('isRead')).toBeNull());
  });

  it('Clear All resets every filter at once; the badge counts each one', async () => {
    const api = page();
    await screen.findByText('Account locked');
    fireEvent.change(periodSelect(), { target: { value: 'week' } });
    fireEvent.change(statusSelect(), { target: { value: 'false' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search notifications' }), { target: { value: 'ahu' } });
    expect(await screen.findByText('3 active')).toBeInTheDocument();
    await waitFor(() => expect(lastList(api).query.get('search')).toBe('ahu'));
    fireEvent.click(screen.getByRole('button', { name: /Clear All/ }));
    await waitFor(() => {
      const q = lastList(api).query;
      expect([q.get('period'), q.get('isRead'), q.get('search')]).toEqual([null, null, null]);
    });
    expect(screen.queryByText(/\d active/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Search notifications' })).toHaveValue('');
  });

  it('changing a filter clears the selection (a hidden row must not stay selected)', async () => {
    page();
    await screen.findByText('Account locked');
    fireEvent.click(rowBox('Account locked'));
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    fireEvent.change(statusSelect(), { target: { value: 'true' } });
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });
});

describe('Notifications — pagination', () => {
  it('pages through the list and changes the page size', async () => {
    // A config where the first option and the limit agree, so the opening size
    // does not depend on which of the two a list page starts on.
    const api = page({ total: 45, routes: [{ path: '/api/config/pagination/current', body: { limit: 20, count: 3, options: [20, 50, 100] } }] });
    await screen.findByText('Account locked');
    await waitFor(() => expect(screen.getByText(/^Showing/).parentElement).toHaveTextContent('Showing 1–20 of 45'));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastList(api).query.get('page')).toBe('2'));
    fireEvent.change(screen.getByRole('combobox', { name: /Rows/ }), { target: { value: '50' } });
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('50'));
    expect(lastList(api).query.get('page')).toBe('1');
  });

  it('D6: a cold load settles on the configured default page size, not the hook\'s pre-load fallback', async () => {
    const api = page({ total: 45, routes: [{ path: '/api/config/pagination/current', body: { limit: 25, count: 3, options: [25, 50, 100] } }] });
    await screen.findByText('Account locked');
    await waitFor(() => expect(lastList(api).query.get('limit')).toBe('25'));
    expect(screen.getByText(/^Showing/).parentElement).toHaveTextContent('Showing 1–25 of 45');
    // the Rows selector offers exactly the configured sizes (no stray 10)
    expect(within(screen.getByRole('combobox', { name: /Rows/ })).getAllByRole('option').map((o) => o.textContent)).toEqual(['25', '50', '100']);
  });
});

describe('Notifications — SUPER_ADMIN record edit', () => {
  const SA = { role: 'SUPER_ADMIN', permissions: [] as string[] };
  const saRoutes = (extra: MockRoute[] = []): MockRoute[] => [
    ...extra,
    { path: '/api/users', body: { data: [{ id: 'u1', username: 'asha01', fullName: 'Asha Rao' }, { id: 'u2', username: 'ravi01', fullName: null }] } },
    { path: '/api/roles/active', body: [{ name: 'QA', displayName: 'Quality' }, { name: 'OPERATOR' }] },
  ];
  const editRow = async (title: string) => {
    await screen.findByText(title);
    fireEvent.click(within(row(title)).getByRole('button', { name: 'Edit record (Super Admin)' }));
    return screen.findByRole('dialog', { name: `Edit notification - ${title}` });
  };

  it('saves only the changed fields with the reason; clearing For user/For role sends null; toasts and refetches', async () => {
    const list = [N({ forUserId: 'asha01', forRole: 'QA' })];
    const api = page({
      user: SA, list,
      routes: saRoutes([{ method: 'PUT', path: '/api/super-admin/data/notifications/n1', body: (r: MockRequest) => ({ id: 'n1', ...r.json }) }]),
    });
    const dlg = await editRow('Account locked');
    // the user picker is keyed by USERNAME, labelled "Full name (username)"
    const forUser = within(dlg).getByLabelText('For user') as HTMLSelectElement;
    await waitFor(() => expect(within(forUser).getByRole('option', { name: 'Asha Rao (asha01)' })).toHaveValue('asha01'));
    expect(within(forUser).getByRole('option', { name: 'ravi01 (ravi01)' })).toBeInTheDocument();
    const forRole = within(dlg).getByLabelText('For role') as HTMLSelectElement;
    expect(within(forRole).getByRole('option', { name: 'Quality' })).toBeInTheDocument();
    expect(within(forRole).getByRole('option', { name: 'OPERATOR' })).toBeInTheDocument();
    expect(forUser).toHaveValue('asha01');
    expect(forRole).toHaveValue('QA');
    expect(within(dlg).getByLabelText(/^Type/)).toHaveValue('ACCOUNT_LOCKED');

    fireEvent.change(within(dlg).getByLabelText(/^Title/), { target: { value: 'Account locked (edited)' } });
    fireEvent.change(forUser, { target: { value: '' } });
    fireEvent.change(forRole, { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Typo in title' } });
    const before = api.calls('GET', '/api/notifications').length;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/data/notifications/n1')).toHaveLength(1));
    const put = api.calls('PUT', '/api/super-admin/data/notifications/n1')[0];
    expect(put.json).toEqual({ title: 'Account locked (edited)', forUserId: null, forRole: null, _changeReason: 'Typo in title' });
    expect(put.headers['x-reauth-password']).toBeUndefined();
    expect(await screen.findByText('Notification updated')).toBeInTheDocument();
    expect(screen.getByText('Recorded in the audit trail')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit notification/ })).toBeNull());
    await waitFor(() => expect(api.calls('GET', '/api/notifications').length).toBeGreaterThan(before));
  });

  it('assigning a user/role sends the value as-is; a gated save sends the password', async () => {
    const api = page({
      user: SA, list: [N()], reauth: ['SUPER_ADMIN_DATA_EDIT'],
      routes: saRoutes([{ method: 'PUT', path: '/api/super-admin/data/notifications/n1', body: { ok: true } }]),
    });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const dlg = await editRow('Account locked');
    const forUser = within(dlg).getByLabelText('For user');
    await within(forUser).findByRole('option', { name: 'Asha Rao (asha01)' });
    fireEvent.change(forUser, { target: { value: 'asha01' } });
    fireEvent.change(within(dlg).getByLabelText('For role'), { target: { value: 'QA' } });
    fireEvent.click(within(dlg).getByLabelText('Read'));
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Route to QA' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));

    const pw = await findDialog('Confirm Your Identity');
    fireEvent.change(within(pw).getByPlaceholderText('Enter your password'), { target: { value: 'Sa#pass1' } });
    fireEvent.click(within(pw).getByRole('button', { name: /Confirm|Verify/ }));
    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/data/notifications/n1')).toHaveLength(1));
    const put = api.calls('PUT', '/api/super-admin/data/notifications/n1')[0];
    expect(put.headers['x-reauth-password']).toBe('Sa#pass1');
    expect(put.json).toEqual({ forUserId: 'asha01', forRole: 'QA', isRead: true, _changeReason: 'Route to QA', _currentPassword: 'Sa#pass1' });
  });

  it('Cancel closes the edit dialog without saving', async () => {
    const api = page({ user: SA, list: [N()], routes: saRoutes() });
    const dlg = await editRow('Account locked');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Edit notification/ })).toBeNull());
    expect(api.calls('PUT', '/api/super-admin/data/notifications/n1')).toHaveLength(0);
  });
});

describe('Notifications — accessibility + console', () => {
  it('every control is named — filters, the custom range, row checkboxes and delete buttons — and nothing is logged', async () => {
    const api = page({ routes: [{ method: 'PUT', path: '/api/notifications/n1/read', body: { ok: true } }] });
    await screen.findByText('Account locked');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select notification: Account locked' }));
    await screen.findByText('1 selected');
    expect(screen.getByRole('button', { name: 'Delete notification: Account locked' })).toBe(rowDelete('Account locked'));
    expect(screen.getByLabelText('Time Period')).toBe(periodSelect());
    expect(screen.getByLabelText('Status')).toBe(statusSelect());
    fireEvent.change(periodSelect(), { target: { value: 'custom' } });
    expect(await screen.findByRole('group', { name: 'From / To' })).toBeInTheDocument();
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    fireEvent.click(within(row('Account locked')).getByRole('button', { name: 'Mark Read' }));
    await waitFor(() => expect(api.calls('PUT', '/api/notifications/n1/read')).toHaveLength(1));
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
