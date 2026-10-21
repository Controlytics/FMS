import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { NotificationRulesPage } from '../notification-rules/index';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

// Multi-request flows; generous under coverage + a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const EVENT_TYPES = [
  { value: 'CYCLE_COMPLETED', label: 'Cycle Completed', module: 'Filters', variables: ['entityName', 'eventType'] },
];
const GROUPS = [
  { id: 'g1', name: 'QA team', description: 'Quality reviewers', isActive: true, memberCount: 1, createdAt: '' },
  { id: 'g2', name: 'Night shift', isActive: true, memberCount: 3, createdAt: '' },
];
const USERS = [
  { id: 'u1', username: 'jdoe', fullName: 'Jane Doe', email: 'j@x.test', role: 'QA' },
  { id: 'u2', username: 'bsmith', fullName: 'Bob Smith', email: 'b@x.test', role: 'OPERATOR' },
  { id: 'u0', username: 'superadmin', fullName: 'Super', email: 's@x.test', role: 'SUPER_ADMIN' },
];
const MEMBERS = [
  { id: 'm1', userId: 'u1', user: USERS[0] },
  { id: 'm2', userId: 'u-gone' },
];
const TEMPLATES = [
  { id: 't1', name: 'Cycle mail', channel: 'EMAIL', subject: 'Cycle done', bodyTemplate: '<p>${entityName}</p>', isActive: true },
  { id: 't2', name: 'Cycle sms', channel: 'SMS', bodyTemplate: 'done', isActive: true, eventType: 'CYCLE_COMPLETED' },
];
const LOG_ROWS = [
  { id: 'l1', channel: 'EMAIL', recipient: 'qa@acme.test', subject: 'Done', message: 'Filter cleaned', status: 'DELIVERED', retryCount: 1, errorMessage: 'first try bounced', triggeredBy: 'CYCLE_COMPLETED', createdAt: '2026-10-01T10:00:00Z', sentAt: '2026-10-01T10:01:00Z' },
  { id: 'l2', channel: 'FAX', recipient: '+1', subject: null, message: '', status: 'UNKNOWN', retryCount: 0, errorMessage: null, triggeredBy: null, createdAt: '2026-10-02T10:00:00Z', sentAt: null },
];
const LOGS = /^\/api\/notification-settings\/logs\?/;

function setup(extra: MockRoute[] = [], opts: { groups?: unknown; templates?: unknown; members?: unknown; logs?: unknown; stats?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...extra,
    { path: '/api/notification-rules', body: { data: [], total: 0 } },
    { path: '/api/notification-rules/event-types', body: EVENT_TYPES },
    { path: '/api/user-groups', body: opts.groups ?? GROUPS },
    { path: /^\/api\/user-groups\/g\d\/members$/, body: opts.members ?? MEMBERS },
    { path: '/api/notification-settings/templates', body: opts.templates ?? TEMPLATES },
    { path: '/api/users', body: { data: USERS } },
    { path: '/api/roles', body: [] },
    { path: LOGS, body: opts.logs ?? { data: LOG_ROWS, total: 2 } },
    opts.stats === null
      ? { path: '/api/notification-settings/logs/stats', status: 204 }
      : { path: '/api/notification-settings/logs/stats', body: opts.stats ?? { total: 9, email: { sent: 5, failed: 1 }, sms: { sent: 2, failed: 1 } } },
    { path: '/api/config/pagination/current', body: { limit: 25, count: 3, options: [10, 25, 50] } },
    { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<NotificationRulesPage />, { user: SUPER_ADMIN, api });
  return api;
}

const openTab = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const groupCard = (name: string) => screen.getByText(name, { selector: 'h4' }).closest('div.rounded-xl') as HTMLElement;
const tplCard = (name: string) => screen.getByText(name, { selector: 'h4' }).closest('div.rounded-xl') as HTMLElement;

// ─── User Groups ────────────────────────────────────────────────────────────
describe('Notification Rules — User Groups tab', () => {
  it('lists groups with description and singular/plural member counts', async () => {
    const api = setup();
    openTab(/User Groups/);
    expect(await screen.findByText('QA team')).toBeInTheDocument();
    expect(screen.getByText('2 user groups')).toBeInTheDocument();
    expect(screen.getByText('Quality reviewers')).toBeInTheDocument();
    expect(within(groupCard('QA team')).getByText('1 member')).toBeInTheDocument();
    expect(within(groupCard('Night shift')).getByText('3 members')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/users').length).toBeGreaterThan(0));
    expect(api.unmatched).toEqual([]);
  });

  it('empty state, which the create form replaces', async () => {
    setup([], { groups: [] });
    openTab(/User Groups/);
    expect(await screen.findByText('No user groups yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));
    expect(screen.queryByText('No user groups yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('No user groups yet')).toBeInTheDocument();
  });

  it('creates a group: name is required, POST carries name + description, then the form closes and the list reloads', async () => {
    const api = setup([{ method: 'POST', path: '/api/user-groups', status: 201, body: { id: 'g3' } }]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Group name'), { target: { value: 'Engineers' } });
    fireEvent.change(screen.getByPlaceholderText('Description (optional)'), { target: { value: 'Plant engineers' } });
    const before = api.calls('GET', '/api/user-groups').length;
    await act(async () => { fireEvent.click(create); });
    await waitFor(() => expect(api.calls('POST', '/api/user-groups')).toHaveLength(1));
    expect(api.calls('POST', '/api/user-groups')[0].json).toEqual({ name: 'Engineers', description: 'Plant engineers' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Group name')).toBeNull());
    await waitFor(() => expect(api.calls('GET', '/api/user-groups').length).toBeGreaterThan(before));
  });

  it('create the server wants signed: prompt, then the retry carries the password', async () => {
    const api = setup([reauthRequired('POST', '/api/user-groups'), { method: 'POST', path: '/api/user-groups', status: 201, body: { id: 'g3' } }]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));
    fireEvent.change(screen.getByPlaceholderText('Group name'), { target: { value: 'Signed group' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
    await signReauth('pw-g');
    await waitFor(() => expect(api.calls('POST', '/api/user-groups')).toHaveLength(2));
    const retry = api.calls('POST', '/api/user-groups')[1];
    expect(retry.headers['x-reauth-password']).toBe('pw-g');
    expect(retry.json).toEqual({ name: 'Signed group', description: '', _currentPassword: 'pw-g' });
    await waitFor(() => expect(screen.queryByPlaceholderText('Group name')).toBeNull());
  });

  it('cancelling the signature on create leaves the typed form in place', async () => {
    const api = setup([reauthRequired('POST', '/api/user-groups')]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    fireEvent.click(screen.getByRole('button', { name: '+ New Group' }));
    fireEvent.change(screen.getByPlaceholderText('Group name'), { target: { value: 'Kept' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
    await cancelReauth();
    expect((screen.getByPlaceholderText('Group name') as HTMLInputElement).value).toBe('Kept');
    expect(api.calls('POST', '/api/user-groups')).toHaveLength(1);
  });

  it('delete asks for confirmation; declined sends nothing, confirmed sends DELETE', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = setup([{ method: 'DELETE', path: '/api/user-groups/g2', status: 204 }]);
    openTab(/User Groups/);
    await screen.findByText('Night shift');
    await act(async () => { fireEvent.click(within(groupCard('Night shift')).getByTitle('Delete')); });
    expect(confirmSpy).toHaveBeenCalledWith('Delete this group?');
    expect(api.calls('DELETE', '/api/user-groups/g2')).toHaveLength(0);
    await act(async () => { fireEvent.click(within(groupCard('Night shift')).getByTitle('Delete')); });
    await waitFor(() => expect(api.calls('DELETE', '/api/user-groups/g2')).toHaveLength(1));
  });

  it('members: lists them (falling back to the user id), offers only non-members, adds and removes', async () => {
    const api = setup([
      { method: 'POST', path: '/api/user-groups/g1/members', status: 201, body: { ok: true } },
      { method: 'DELETE', path: '/api/user-groups/g1/members/u1', status: 204 },
    ]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    await waitFor(() => expect(api.calls('GET', '/api/users').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(within(groupCard('QA team')).getByTitle('Manage Members')); });
    expect(await screen.findByRole('heading', { name: 'Members of "QA team"' })).toBeInTheDocument();
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jdoe - j@x.test')).toBeInTheDocument();
    expect(screen.getByText('u-gone')).toBeInTheDocument();
    const sel = screen.getByRole('combobox');
    // u1 already a member, superadmin hidden -> only Bob is offered.
    expect(within(sel).queryByText(/Jane Doe/)).toBeNull();
    expect(within(sel).queryByText(/superadmin/)).toBeNull();
    expect(within(sel).getByText('Bob Smith (bsmith) - OPERATOR')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'u2' } });
    await act(async () => { fireEvent.click(add); });
    await waitFor(() => expect(api.calls('POST', '/api/user-groups/g1/members')).toHaveLength(1));
    expect(api.calls('POST', '/api/user-groups/g1/members')[0].json).toEqual({ userIds: ['u2'] });
    // members reloaded after add, picker reset
    await waitFor(() => expect(api.calls('GET', '/api/user-groups/g1/members').length).toBe(2));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');

    const janeRow = screen.getByText('Jane Doe').closest('div.flex.items-center.justify-between') as HTMLElement;
    await act(async () => { fireEvent.click(within(janeRow).getByRole('button')); });
    await waitFor(() => expect(api.calls('DELETE', '/api/user-groups/g1/members/u1')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', '/api/user-groups/g1/members').length).toBe(3));

    // Close (X) returns to the group list.
    const heading = screen.getByRole('heading', { name: 'Members of "QA team"' });
    fireEvent.click(within(heading.parentElement!).getByRole('button'));
    expect(await screen.findByText('2 user groups')).toBeInTheDocument();
  });

  it('delete the server wants signed: prompt, then the retry carries the password; a refused delete does not reload', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = setup([
      reauthRequired('DELETE', '/api/user-groups/g1'),
      { method: 'DELETE', path: '/api/user-groups/g1', times: 1, status: 204 },
      { method: 'DELETE', path: '/api/user-groups/g2', status: 409, body: { error: 'IN_USE', message: 'Group used by a rule' } },
    ]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    await act(async () => { fireEvent.click(within(groupCard('QA team')).getByTitle('Delete')); });
    await signReauth('pw-gd');
    await waitFor(() => expect(api.calls('DELETE', '/api/user-groups/g1')).toHaveLength(2));
    expect(api.calls('DELETE', '/api/user-groups/g1')[1].headers['x-reauth-password']).toBe('pw-gd');
    await waitFor(() => expect(api.calls('GET', '/api/user-groups').length).toBeGreaterThan(1));
    const reads = api.calls('GET', '/api/user-groups').length;
    await act(async () => { fireEvent.click(within(groupCard('Night shift')).getByTitle('Delete')); });
    await waitFor(() => expect(api.calls('DELETE', '/api/user-groups/g2')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('GET', '/api/user-groups')).toHaveLength(reads);
    expect(screen.getByText('Night shift')).toBeInTheDocument();
  });

  it('a refused add/remove member does not reload the member list', async () => {
    const api = setup([
      { method: 'POST', path: '/api/user-groups/g1/members', status: 409, body: { error: 'DUP', message: 'Already a member' } },
      { method: 'DELETE', path: '/api/user-groups/g1/members/u1', status: 403, body: { error: 'FORBIDDEN', message: 'No' } },
    ]);
    openTab(/User Groups/);
    await screen.findByText('QA team');
    await waitFor(() => expect(api.calls('GET', '/api/users').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(within(groupCard('QA team')).getByTitle('Manage Members')); });
    await screen.findByText('Jane Doe');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
    await waitFor(() => expect(api.calls('POST', '/api/user-groups/g1/members')).toHaveLength(1));
    const janeRow = screen.getByText('Jane Doe').closest('div.flex.items-center.justify-between') as HTMLElement;
    await act(async () => { fireEvent.click(within(janeRow).getByRole('button')); });
    await waitFor(() => expect(api.calls('DELETE', '/api/user-groups/g1/members/u1')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('GET', '/api/user-groups/g1/members')).toHaveLength(1);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('u2');
  });

  it('a group with no members says so', async () => {
    setup([], { members: [] });
    openTab(/User Groups/);
    await screen.findByText('Night shift');
    await act(async () => { fireEvent.click(within(groupCard('Night shift')).getByTitle('Manage Members')); });
    expect(await screen.findByText('No members in this group yet')).toBeInTheDocument();
  });
});

// ─── Templates ──────────────────────────────────────────────────────────────
describe('Notification Rules — Templates tab', () => {
  it('lists templates with channel and subject', async () => {
    setup();
    openTab(/Templates/);
    expect(await screen.findByText('Cycle mail')).toBeInTheDocument();
    expect(screen.getByText('2 templates')).toBeInTheDocument();
    expect(within(tplCard('Cycle mail')).getByText('EMAIL')).toBeInTheDocument();
    expect(within(tplCard('Cycle mail')).getByText('Subject: Cycle done')).toBeInTheDocument();
    expect(within(tplCard('Cycle sms')).getByText('SMS')).toBeInTheDocument();
    expect(within(tplCard('Cycle sms')).queryByText(/^Subject:/)).toBeNull();
  });

  it('empty state', async () => {
    setup([], { templates: [] });
    openTab(/Templates/);
    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    expect(screen.getByText('0 templates')).toBeInTheDocument();
  });

  it('creates an email template: name + body required, subject only for EMAIL, POST body', async () => {
    const api = setup([{ method: 'POST', path: '/api/notification-settings/templates', status: 201, body: { id: 't9' } }]);
    openTab(/Templates/);
    await screen.findByText('Cycle mail');
    fireEvent.click(screen.getByRole('button', { name: '+ New Template' }));
    expect(screen.getByRole('heading', { name: 'New Template' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g. Cycle Completion Email'), { target: { value: 'PM mail' } });
    expect(create).toBeDisabled();
    const textarea = document.querySelector('textarea')!;
    expect(textarea.placeholder).toContain('<h2>');
    // Switch to SMS: subject field disappears, placeholder changes; back to EMAIL.
    const channelSel = screen.getByRole('combobox');
    fireEvent.change(channelSel, { target: { value: 'SMS' } });
    expect(screen.queryByText('Subject')).toBeNull();
    expect(document.querySelector('textarea')!.placeholder).toContain('DigiLog Alert');
    fireEvent.change(channelSel, { target: { value: 'EMAIL' } });
    fireEvent.change(screen.getByPlaceholderText('[DigiLog] Cycle ${eventType} on ${entityName}'), { target: { value: 'PM due' } });
    fireEvent.change(document.querySelector('textarea')!, { target: { value: '<p>PM due on ${ahu}</p>' } });
    expect(create).not.toBeDisabled();
    await act(async () => { fireEvent.click(create); });
    await waitFor(() => expect(api.calls('POST', '/api/notification-settings/templates')).toHaveLength(1));
    expect(api.calls('POST', '/api/notification-settings/templates')[0].json).toEqual({
      name: 'PM mail', channel: 'EMAIL', subject: 'PM due', bodyTemplate: '<p>PM due on ${ahu}</p>', isActive: true,
    });
    expect(await screen.findByText('2 templates')).toBeInTheDocument();
  });

  it('edits a template with PUT and shows the available variables for its event type', async () => {
    const api = setup([{ method: 'PUT', path: '/api/notification-settings/templates/t2', body: { ok: true } }]);
    openTab(/Templates/);
    await screen.findByText('Cycle sms');
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules/event-types').length).toBeGreaterThan(0));
    fireEvent.click(within(tplCard('Cycle sms')).getAllByRole('button')[0]);
    expect(screen.getByRole('heading', { name: 'Edit Template' })).toBeInTheDocument();
    expect(await screen.findByText('Available variables:')).toBeInTheDocument();
    // One hint per variable of the template's event type. (The exact rendering is
    // reported as a defect: it shows `${$entityName}`, not the engine's `${entityName}`.)
    const hints = Array.from(document.querySelectorAll('code')).map((c) => c.textContent ?? '');
    expect(hints).toHaveLength(2);
    expect(hints[0]).toContain('entityName');
    expect(hints[1]).toContain('eventType');
    fireEvent.change(document.querySelector('textarea')!, { target: { value: 'Cycle ${entityName} done' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/notification-settings/templates/t2')).toHaveLength(1));
    expect(api.calls('PUT', '/api/notification-settings/templates/t2')[0].json).toMatchObject({ id: 't2', bodyTemplate: 'Cycle ${entityName} done', channel: 'SMS' });
    expect(await screen.findByText('2 templates')).toBeInTheDocument();
  });

  it('a template without an event type shows no variable hint; X and Cancel discard', async () => {
    const api = setup();
    openTab(/Templates/);
    await screen.findByText('Cycle mail');
    fireEvent.click(within(tplCard('Cycle mail')).getAllByRole('button')[0]);
    expect(screen.queryByText('Available variables:')).toBeNull();
    const heading = screen.getByRole('heading', { name: 'Edit Template' });
    fireEvent.click(within(heading.parentElement!).getByRole('button'));
    expect(await screen.findByText('2 templates')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ New Template' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('2 templates')).toBeInTheDocument();
    expect(api.calls('POST', /templates/)).toHaveLength(0);
    expect(api.calls('PUT', /templates/)).toHaveLength(0);
  });

  it('an email template saved without a subject edits with a blank subject', async () => {
    const api = setup([{ method: 'PUT', path: '/api/notification-settings/templates/t5', body: { ok: true } }], {
      templates: [{ id: 't5', name: 'No subject', channel: 'EMAIL', bodyTemplate: 'b', isActive: true }],
    });
    openTab(/Templates/);
    await screen.findByText('No subject');
    fireEvent.click(within(tplCard('No subject')).getAllByRole('button')[0]);
    const subject = screen.getByPlaceholderText('[DigiLog] Cycle ${eventType} on ${entityName}') as HTMLInputElement;
    expect(subject.value).toBe('');
    fireEvent.change(subject, { target: { value: 'Now with subject' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/notification-settings/templates/t5')).toHaveLength(1));
    expect(api.calls('PUT', '/api/notification-settings/templates/t5')[0].json).toMatchObject({ subject: 'Now with subject' });
  });

  it('a refused save alerts the server message and keeps the editor open', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    setup([{ method: 'PUT', path: '/api/notification-settings/templates/t1', status: 400, body: { error: 'VALIDATION', message: 'Body too long' } }]);
    openTab(/Templates/);
    await screen.findByText('Cycle mail');
    fireEvent.click(within(tplCard('Cycle mail')).getAllByRole('button')[0]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update' })); });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Body too long'));
    expect(screen.getByRole('heading', { name: 'Edit Template' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update' })).not.toBeDisabled();
  });

  it('delete asks for confirmation; confirmed sends DELETE and reloads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const api = setup([{ method: 'DELETE', path: '/api/notification-settings/templates/t1', status: 204 }]);
    openTab(/Templates/);
    await screen.findByText('Cycle mail');
    const del = () => within(tplCard('Cycle mail')).getAllByRole('button')[1];
    await act(async () => { fireEvent.click(del()); });
    expect(api.calls('DELETE', '/api/notification-settings/templates/t1')).toHaveLength(0);
    const before = api.calls('GET', '/api/notification-settings/templates').length;
    await act(async () => { fireEvent.click(del()); });
    await waitFor(() => expect(api.calls('DELETE', '/api/notification-settings/templates/t1')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', '/api/notification-settings/templates').length).toBeGreaterThan(before));
  });
});

// ─── Delivery Logs ──────────────────────────────────────────────────────────
describe('Notification Rules — Delivery Logs tab', () => {
  it('shows stats and rows; expanding shows message, error and sent time', async () => {
    const api = setup();
    openTab(/Delivery Logs/);
    expect(await screen.findByText('qa@acme.test')).toBeInTheDocument();
    expect(await screen.findByText('9')).toBeInTheDocument();
    expect(screen.getByText('Emails Failed').previousSibling).toHaveTextContent('1');
    const odd = screen.getByText('+1').closest('tr')!;
    expect(within(odd).getByText('FAX')).toBeInTheDocument();
    expect(within(odd).getAllByText('-')).toHaveLength(2);
    expect(within(screen.getByText('qa@acme.test').closest('tr')!).getByText('(retry 1)')).toBeInTheDocument();
    // first request uses the tab's own default page size of 25
    expect(api.calls('GET', LOGS)[0].query.get('limit')).toBe('25');
    fireEvent.click(screen.getByText('qa@acme.test'));
    expect(screen.getByText('Filter cleaned')).toBeInTheDocument();
    expect(screen.getByText('first try bounced')).toBeInTheDocument();
    expect(screen.getByText('Sent At:')).toBeInTheDocument();
    fireEvent.click(screen.getByText('+1'));
    expect(screen.queryByText('Filter cleaned')).toBeNull();
    expect(screen.queryByText('Error:')).toBeNull();
    expect(screen.queryByText('Sent At:')).toBeNull();
    fireEvent.click(screen.getByText('+1'));
    expect(screen.queryByText('Message:')).toBeNull();
  });

  it('empty: empty row, no pagination; absent stats render no tiles; partial stats render zeros', async () => {
    setup([], { logs: { data: [], total: 0 }, stats: null });
    openTab(/Delivery Logs/);
    expect(await screen.findByText('No notification logs found')).toBeInTheDocument();
    expect(screen.queryByText('Emails Sent')).toBeNull();
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it('partial stats render zeros', async () => {
    setup([], { stats: { total: 3 } });
    openTab(/Delivery Logs/);
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('SMS Sent').previousSibling).toHaveTextContent('0');
  });

  it('filters and pagination drive the request query', async () => {
    const api = setup([], { logs: { data: LOG_ROWS, total: 80 } });
    openTab(/Delivery Logs/);
    await screen.findByText('qa@acme.test');
    const last = () => { const c = api.calls('GET', LOGS); return c[c.length - 1].query; };
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(last().get('page')).toBe('2'));
    fireEvent.change(screen.getByPlaceholderText('Search by recipient or subject...'), { target: { value: 'acme' } });
    await waitFor(() => expect(last().get('search')).toBe('acme'));
    expect(last().get('page')).toBe('1');
    const [channelSel, statusSel] = screen.getAllByRole('combobox');
    fireEvent.change(channelSel, { target: { value: 'EMAIL' } });
    await waitFor(() => expect(last().get('channel')).toBe('EMAIL'));
    fireEvent.change(statusSel, { target: { value: 'RETRYING' } });
    await waitFor(() => expect(last().get('status')).toBe('RETRYING'));
    fireEvent.change(screen.getByText('Rows:').querySelector('select')!, { target: { value: '50' } });
    await waitFor(() => expect(last().get('limit')).toBe('50'));
  });

  it('delete: plain DELETE, signature retry, cancel, and a refused delete reported', async () => {
    const P1 = '/api/notification-settings/logs/l1';
    const P2 = '/api/notification-settings/logs/l2';
    const api = setup([
      { method: 'DELETE', path: P1, times: 1, status: 204 },
      reauthRequired('DELETE', P2),
      { method: 'DELETE', path: P2, times: 1, status: 204 },
      reauthRequired('DELETE', P1),
      { method: 'DELETE', path: P1, status: 404, body: { error: 'NOT_FOUND', message: 'Log entry not found' } },
    ]);
    openTab(/Delivery Logs/);
    await screen.findByText('qa@acme.test');
    const del = (text: string) => within(screen.getByText(text).closest('tr')!).getByRole('button', { name: 'Delete' });

    await act(async () => { fireEvent.click(del('qa@acme.test')); });
    await waitFor(() => expect(api.calls('DELETE', P1)).toHaveLength(1));
    expect(screen.queryByText('Filter cleaned')).toBeNull(); // the click did not expand the row

    await act(async () => { fireEvent.click(del('+1')); });
    await signReauth('pw-log');
    await waitFor(() => expect(api.calls('DELETE', P2)).toHaveLength(2));
    expect(api.calls('DELETE', P2)[1].headers['x-reauth-password']).toBe('pw-log');

    await act(async () => { fireEvent.click(del('qa@acme.test')); });
    await cancelReauth();
    expect(api.calls('DELETE', P1)).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Log entry not found' })).toBeNull();

    await act(async () => { fireEvent.click(del('qa@acme.test')); });
    expect(await ackMessage('Log entry not found')).toContain('Log entry not found');
    expect(api.calls('DELETE', P1)).toHaveLength(3);
  });
});
