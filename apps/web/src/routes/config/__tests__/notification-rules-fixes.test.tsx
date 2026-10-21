import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { NotificationRulesPage } from '../notification-rules/index';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

/**
 * Defect fixes from the 2026-10-21 coverage campaign (config slice):
 *  - item 1: the rule editor and the group-members view never rendered the
 *    password prompt, so a signed save hung on "Saving..." forever;
 *  - item 4: the variable hint rendered `${$entityName}`;
 *  - item 5: rule delete/toggle, group and template-delete failures were silent.
 */
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const EVENT_TYPES = [
  { value: 'CYCLE_COMPLETED', label: 'Cycle Completed', module: 'Filters', variables: ['entityName', 'eventType'] },
];
const GROUPS = [{ id: 'g1', name: 'QA team', isActive: true, memberCount: 1, createdAt: '' }];
const USERS = [
  { id: 'u1', username: 'jdoe', fullName: 'Jane Doe', email: 'j@x.test', role: 'QA' },
  { id: 'u2', username: 'bsmith', fullName: 'Bob Smith', email: 'b@x.test', role: 'OPERATOR' },
];
const MEMBERS = [{ id: 'm1', userId: 'u1', user: USERS[0] }];
const TEMPLATES = [
  { id: 't1', name: 'Cycle mail', channel: 'EMAIL', subject: 'Cycle done', bodyTemplate: '<p>x</p>', isActive: true },
  { id: 't2', name: 'Cycle sms', channel: 'SMS', bodyTemplate: 'done', isActive: true, eventType: 'CYCLE_COMPLETED' },
];
const RULE = {
  id: 'r1', name: 'Cycle alert', eventType: 'CYCLE_COMPLETED', eventTypes: ['CYCLE_COMPLETED'], conditions: {},
  emailEnabled: true, smsEnabled: false, inAppEnabled: true, cooldownMinutes: 0, isActive: true, priority: 0,
  createdAt: '2026-10-01T00:00:00Z', recipients: [], eventTypesMeta: [EVENT_TYPES[0]],
};

function setup(extra: MockRoute[] = [], opts: { reauth?: string[] } = {}) {
  const api = mockApi([
    ...extra,
    { path: '/api/notification-rules', body: { data: [RULE], total: 1 } },
    { path: '/api/notification-rules/event-types', body: EVENT_TYPES },
    { path: '/api/user-groups', body: GROUPS },
    { path: '/api/user-groups/g1/members', body: MEMBERS },
    { path: '/api/notification-settings/templates', body: TEMPLATES },
    { path: '/api/users', body: { data: USERS } },
    { path: '/api/roles', body: [] },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<NotificationRulesPage />, { user: SUPER_ADMIN, api });
  return api;
}

const openTab = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const card = (name: string) => screen.getByText(name, { selector: 'h4' }).closest('div.rounded-xl') as HTMLElement;
const noCancelledText = () => expect(screen.queryByText(/Cancelled/)).toBeNull();

async function openRuleEditor(api: ReturnType<typeof mockApi>) {
  await screen.findByText('Cycle alert');
  await waitFor(() => expect(api.calls('GET', '/api/notification-settings/templates').length).toBeGreaterThan(0));
  fireEvent.click(within(card('Cycle alert')).getByTitle('Edit'));
  expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument();
}

async function openMembers() {
  openTab(/User Groups/);
  await screen.findByText('QA team');
  await act(async () => { fireEvent.click(within(card('QA team')).getByTitle('Manage Members')); });
  await screen.findByText('Members of "QA team"');
}

// ─── Item 1: the password prompt exists in every view ───────────────────────
describe('item 1 — signed saves from the rule editor and the members view finish', () => {
  it('rule editor, signature required up front: prompt appears, the PUT carries the password, the editor closes', async () => {
    const api = setup([{ method: 'PUT', path: '/api/notification-rules/r1', body: { ok: true } }], { reauth: ['MANAGE_NOTIFICATION_RULES'] });
    await openRuleEditor(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    expect(await screen.findByText(/Performing "Create \/ Edit \/ Delete Notification Rule" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-rule');
    await waitFor(() => expect(api.calls('PUT', '/api/notification-rules/r1')).toHaveLength(1));
    const put = api.calls('PUT', '/api/notification-rules/r1')[0];
    expect(put.headers['x-reauth-password']).toBe('pw-rule');
    expect(put.json).toMatchObject({ id: 'r1', name: 'Cycle alert', _currentPassword: 'pw-rule' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Rule' })).toBeNull());
    expect(screen.getByText('1 notification rules configured')).toBeInTheDocument();
  });

  it('rule editor, signature demanded by the server (401 REAUTH_REQUIRED): prompt, then the retry carries the password', async () => {
    const api = setup([
      reauthRequired('PUT', '/api/notification-rules/r1'),
      { method: 'PUT', path: '/api/notification-rules/r1', body: { ok: true } },
    ]);
    await openRuleEditor(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    await signReauth('pw-2');
    await waitFor(() => expect(api.calls('PUT', '/api/notification-rules/r1')).toHaveLength(2));
    expect(api.calls('PUT', '/api/notification-rules/r1')[1].headers['x-reauth-password']).toBe('pw-2');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit Rule' })).toBeNull());
  });

  it('rule editor, cancelling the signature: nothing sent, no error, Save usable again, editor kept', async () => {
    const api = setup([], { reauth: ['MANAGE_NOTIFICATION_RULES'] });
    await openRuleEditor(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    await cancelReauth();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update Rule' })).not.toBeDisabled());
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument();
    expect(api.calls('PUT', '/api/notification-rules/r1')).toHaveLength(0);
    noCancelledText();
  });

  it('members view: add and remove a member with the signature required up front', async () => {
    const api = setup([
      { method: 'POST', path: '/api/user-groups/g1/members', body: { ok: true } },
      { method: 'DELETE', path: '/api/user-groups/g1/members/u1', body: { ok: true } },
    ], { reauth: ['MANAGE_USER_GROUPS'] });
    await openMembers();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    expect(await screen.findByText(/Performing "Create \/ Edit \/ Delete User Group" requires identity verification/)).toBeInTheDocument();
    await signReauth('pw-add');
    await waitFor(() => expect(api.calls('POST', '/api/user-groups/g1/members')).toHaveLength(1));
    expect(api.calls('POST', '/api/user-groups/g1/members')[0].json).toEqual({ userIds: ['u2'], _currentPassword: 'pw-add' });

    const row = screen.getByText('Jane Doe').closest('div.flex') as HTMLElement;
    await act(async () => { fireEvent.click(within(row).getByRole('button')); });
    await signReauth('pw-rm');
    await waitFor(() => expect(api.calls('DELETE', '/api/user-groups/g1/members/u1')).toHaveLength(1));
    expect(api.calls('DELETE', '/api/user-groups/g1/members/u1')[0].headers['x-reauth-password']).toBe('pw-rm');
  });

  it('members view, signature demanded by the server: prompt, then the retry carries the password', async () => {
    const api = setup([
      reauthRequired('POST', '/api/user-groups/g1/members'),
      { method: 'POST', path: '/api/user-groups/g1/members', body: { ok: true } },
    ]);
    await openMembers();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    await signReauth('pw-3');
    await waitFor(() => expect(api.calls('POST', '/api/user-groups/g1/members')).toHaveLength(2));
    expect(api.calls('POST', '/api/user-groups/g1/members')[1].headers['x-reauth-password']).toBe('pw-3');
  });
});

// ─── Item 4: the variable hint is the engine's syntax ───────────────────────
describe('item 4 — the template variable hint', () => {
  it('renders exactly ${name}, the syntax the template engine substitutes', async () => {
    const api = setup();
    openTab(/Templates/);
    await screen.findByText('Cycle sms');
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules/event-types').length).toBeGreaterThan(0));
    fireEvent.click(within(card('Cycle sms')).getAllByRole('button')[0]);
    await screen.findByText('Available variables:');
    const hints = Array.from(document.querySelectorAll('code')).map((c) => c.textContent);
    expect(hints).toEqual(['${entityName}', '${eventType}']);
  });
});

// ─── Item 5: failures are shown, cancels are not ────────────────────────────
describe('item 5 — failures are shown where they happen', () => {
  it('a refused rule delete shows the server message in the list, and it does not leak into the next editor', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = setup([{ method: 'DELETE', path: '/api/notification-rules/r1', status: 403, body: { error: 'FORBIDDEN', message: 'nope-delete' } }]);
    await screen.findByText('Cycle alert');
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Delete')); });
    expect(await screen.findByText('nope-delete')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/notification-rules/r1')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));
    expect(screen.getByRole('heading', { name: 'New Notification Rule' })).toBeInTheDocument();
    expect(screen.queryByText('nope-delete')).toBeNull();
  });

  it('a refused toggle shows the server message in the list', async () => {
    setup([{ method: 'PUT', path: '/api/notification-rules/r1/toggle', status: 409, body: { error: 'CONFLICT', message: 'Rule locked' } }]);
    await screen.findByText('Cycle alert');
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Toggle')); });
    expect(await screen.findByText('Rule locked')).toBeInTheDocument();
  });

  it('a save error does not reappear when the editor is closed and opened again', async () => {
    const api = setup([{ method: 'PUT', path: '/api/notification-rules/r1', status: 400, body: { error: 'VALIDATION', message: 'Bad recipients' } }]);
    await openRuleEditor(api);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    expect(await screen.findByText('Bad recipients')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(card('Cycle alert')).getByTitle('Edit'));
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument();
    expect(screen.queryByText('Bad recipients')).toBeNull();
  });

  it('a refused group create shows the server message and keeps the form', async () => {
    setup([{ method: 'POST', path: '/api/user-groups', status: 409, body: { error: 'DUPLICATE', message: 'Group exists' } }]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));
    fireEvent.change(screen.getByPlaceholderText('Group name'), { target: { value: 'QA team' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
    expect(await screen.findByText('Group exists')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('Group name') as HTMLInputElement).value).toBe('QA team');
  });

  it('cancelling the signature on group create stays silent', async () => {
    const api = setup([], { reauth: ['MANAGE_USER_GROUPS'] });
    openTab(/User Groups/);
    await screen.findByText('QA team');
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));
    fireEvent.change(screen.getByPlaceholderText('Group name'), { target: { value: 'Ops' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('POST', '/api/user-groups')).toHaveLength(0);
    noCancelledText();
  });

  it('a refused group delete shows the server message', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setup([{ method: 'DELETE', path: '/api/user-groups/g1', status: 409, body: { error: 'IN_USE', message: 'Group used by a rule' } }]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    await act(async () => { fireEvent.click(within(card('QA team')).getByTitle('Delete')); });
    expect(await screen.findByText('Group used by a rule')).toBeInTheDocument();
  });

  it('a refused member add and a refused member remove show the server message in the members view', async () => {
    setup([
      { method: 'POST', path: '/api/user-groups/g1/members', status: 409, body: { error: 'DUP', message: 'Already a member' } },
      { method: 'DELETE', path: '/api/user-groups/g1/members/u1', status: 403, body: { error: 'FORBIDDEN', message: 'Cannot remove' } },
    ]);
    await openMembers();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    expect(await screen.findByText('Already a member')).toBeInTheDocument();
    const row = screen.getByText('Jane Doe').closest('div.flex') as HTMLElement;
    await act(async () => { fireEvent.click(within(row).getByRole('button')); });
    expect(await screen.findByText('Cannot remove')).toBeInTheDocument();
    expect(screen.queryByText('Already a member')).toBeNull();
  });

  it('members that fail to load are reported, not shown as an empty group', async () => {
    setup([{ path: '/api/user-groups/g1/members', status: 500, body: { error: 'INTERNAL', message: 'members unavailable' } }]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    await act(async () => { fireEvent.click(within(card('QA team')).getByTitle('Manage Members')); });
    expect(await screen.findByText('members unavailable')).toBeInTheDocument();
  });

  it('a refused template delete is reported (no unhandled rejection) and the list stays', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = setup([{ method: 'DELETE', path: '/api/notification-settings/templates/t1', status: 409, body: { error: 'IN_USE', message: 'Template used by rule' } }]);
    openTab(/Templates/);
    await screen.findByText('Cycle mail');
    await act(async () => { fireEvent.click(within(card('Cycle mail')).getAllByRole('button')[1]); });
    expect(await ackMessage('Delete failed')).toContain('Template used by rule');
    expect(api.calls('DELETE', '/api/notification-settings/templates/t1')).toHaveLength(1);
    expect(screen.getByText('Cycle mail')).toBeInTheDocument();
  });
});
