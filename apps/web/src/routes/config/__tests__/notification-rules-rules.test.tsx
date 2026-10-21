import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { NotificationRulesPage } from '../notification-rules/index';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';

// Multi-request flows; generous under coverage + a busy machine.
vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => { resetEnv(); vi.restoreAllMocks(); });

const EVENT_TYPES = [
  { value: 'CYCLE_COMPLETED', label: 'Cycle Completed', module: 'Filters', variables: ['entityName', 'eventType'] },
  { value: 'CYCLE_TERMINATED', label: 'Cycle Terminated', module: 'Filters', variables: ['entityName'] },
  { value: 'PM_OVERDUE', label: 'PM Overdue', module: 'PM', variables: ['ahu'] },
];
const TEMPLATES = [
  { id: 't-mail', name: 'Mail tpl', channel: 'EMAIL', subject: 'S', bodyTemplate: 'b', isActive: true },
  { id: 't-mail-off', name: 'Retired mail tpl', channel: 'EMAIL', bodyTemplate: 'b', isActive: false },
  { id: 't-sms', name: 'SMS tpl', channel: 'SMS', bodyTemplate: 'b', isActive: true },
];
const GROUPS = [{ id: 'g1', name: 'QA team', isActive: true, memberCount: 3, createdAt: '' }];
const USERS = [
  { id: 'u1', username: 'jdoe', fullName: 'Jane Doe', email: 'j@x.test', role: 'QA' },
  { id: 'u0', username: 'superadmin', fullName: 'Super', email: 's@x.test', role: 'SUPER_ADMIN' },
];
const ROLES = [{ name: 'SUPER_ADMIN', displayName: 'Super Admin' }, { name: 'QA', displayName: 'Quality' }];

const RULE_A = {
  id: 'r1', name: 'Cycle alert', description: 'd', eventType: 'CYCLE_COMPLETED', eventTypes: ['CYCLE_COMPLETED', 'CYCLE_TERMINATED'],
  conditions: {}, emailEnabled: true, smsEnabled: true, inAppEnabled: true, cooldownMinutes: 5, isActive: true, priority: 2,
  createdAt: '2026-10-01T00:00:00Z',
  recipients: [
    { id: 'rc1', recipientType: 'ROLE', roleValue: 'QA', displayName: 'Quality' },
    { id: 'rc2', recipientType: 'GROUP', groupId: 'g1', displayName: 'QA team' },
    { id: 'rc3', recipientType: 'USER', userId: 'u1', displayName: 'Jane Doe' },
  ],
  eventTypesMeta: [EVENT_TYPES[0], EVENT_TYPES[1]],
};
const RULE_B = {
  id: 'r2', name: 'Legacy PM rule', eventType: 'PM_OVERDUE', conditions: {}, emailEnabled: false, smsEnabled: false,
  inAppEnabled: false, cooldownMinutes: 0, isActive: false, priority: 0, createdAt: '2026-10-01T00:00:00Z', recipients: [],
  eventTypeMeta: { value: 'PM_OVERDUE', module: 'PM', variables: [] },
};
const RULE_C = {
  id: 'r3', name: 'No meta rule', eventType: 'X', conditions: {}, emailEnabled: false, smsEnabled: false, inAppEnabled: true,
  cooldownMinutes: 0, isActive: true, priority: 0, createdAt: '', recipients: [],
};

function setup(extra: MockRoute[] = [], opts: { rules?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...extra,
    { path: '/api/notification-rules', body: opts.rules ?? { data: [RULE_A, RULE_B, RULE_C], total: 3 } },
    { path: '/api/notification-rules/event-types', body: EVENT_TYPES },
    { path: '/api/user-groups', body: GROUPS },
    { path: '/api/notification-settings/templates', body: TEMPLATES },
    { path: '/api/users', body: { data: USERS } },
    { path: '/api/roles', body: ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<NotificationRulesPage />, { user: SUPER_ADMIN, api });
  return api;
}

const card = (name: string) => screen.getByText(name, { selector: 'h4' }).closest('div.rounded-xl') as HTMLElement;
const selectAfterLabel = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('select') as HTMLSelectElement;

async function waitForEditorData(api: ReturnType<typeof mockApi>) {
  await waitFor(() => {
    expect(api.calls('GET', '/api/roles').length).toBeGreaterThan(0);
    expect(api.calls('GET', '/api/users').length).toBeGreaterThan(0);
    expect(api.calls('GET', '/api/notification-settings/templates').length).toBeGreaterThan(0);
  });
}

describe('Notification Rules — Rules tab', () => {
  it('lists rules from the {data,total} envelope with status, event types, channels and recipients', async () => {
    const api = setup();
    expect(await screen.findByText('Cycle alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notification Rules' })).toBeInTheDocument();
    expect(screen.getByText('3 notification rules configured')).toBeInTheDocument();
    const a = card('Cycle alert');
    expect(within(a).getByText('Active')).toBeInTheDocument();
    expect(within(a).getByText('Cycle Completed')).toBeInTheDocument();
    expect(within(a).getByText('Cycle Terminated')).toBeInTheDocument();
    expect(within(a).getByText('Email')).toBeInTheDocument();
    expect(within(a).getByText('SMS')).toBeInTheDocument();
    expect(within(a).getByText('In-App')).toBeInTheDocument();
    expect(within(a).getByText('Role: Quality')).toBeInTheDocument();
    expect(within(a).getByText('Group: QA team')).toBeInTheDocument();
    expect(within(a).getByText('User: Jane Doe')).toBeInTheDocument();
    // Legacy single-event rule: meta without a label falls back to the raw event type.
    const b = card('Legacy PM rule');
    expect(within(b).getByText('Inactive')).toBeInTheDocument();
    expect(within(b).getByText('PM_OVERDUE')).toBeInTheDocument();
    expect(within(b).queryByText('Email')).toBeNull();
    expect(within(b).queryByText(/^Role:/)).toBeNull();
    // No meta at all: no event chip, but the card still renders.
    const c = card('No meta rule');
    expect(within(c).queryByText('X')).toBeNull();
    expect(within(c).getByText('In-App')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/roles').length).toBeGreaterThan(0));
    expect(api.unmatched).toEqual([]);
  });

  it('accepts a plain-array response too', async () => {
    setup([], { rules: [RULE_C] });
    expect(await screen.findByText('No meta rule')).toBeInTheDocument();
    expect(screen.getByText('1 notification rules configured')).toBeInTheDocument();
  });

  it('empty list shows the empty state', async () => {
    const api = setup([], { rules: { data: [], total: 0 } });
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules')).toHaveLength(1));
    expect(await screen.findByText('No notification rules yet')).toBeInTheDocument();
    expect(screen.getByText('0 notification rules configured')).toBeInTheDocument();
  });

  it('creates a rule: required fields gate Create, event multi-select, channels, templates and recipients are all sent', async () => {
    const api = setup([{ method: 'POST', path: '/api/notification-rules', status: 201, body: { id: 'new' } }]);
    await screen.findByText('Cycle alert');
    await waitForEditorData(api);
    fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));
    expect(screen.getByRole('heading', { name: 'New Notification Rule' })).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create Rule' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('e.g. Cycle Completion Alert'), { target: { value: 'Overdue PM' } });
    expect(create).toBeDisabled(); // still no event type

    // Event types: open the dropdown, grouped by module.
    fireEvent.click(screen.getByRole('button', { name: 'Select event types...' }));
    expect(screen.getByText('Filters', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('PM', { selector: 'div' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('PM Overdue'));
    fireEvent.click(screen.getByLabelText('Cycle Completed'));
    expect(screen.getByRole('button', { name: '2 event types selected' })).toBeInTheDocument();
    // Untick one inside the dropdown
    fireEvent.click(screen.getByLabelText('Cycle Completed'));
    expect(screen.getByRole('button', { name: '1 event type selected' })).toBeInTheDocument();
    // Click outside closes the dropdown
    fireEvent.click(document.querySelector('.fixed.inset-0.z-10')!);
    expect(screen.queryByLabelText('PM Overdue')).toBeNull();
    expect(create).not.toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Optional description'), { target: { value: 'Tell QA' } });

    // Email is on by default -> its template picker lists ACTIVE email templates only.
    const emailTpl = selectAfterLabel('Email Template');
    expect(within(emailTpl).getByText('Mail tpl')).toBeInTheDocument();
    expect(within(emailTpl).queryByText('Retired mail tpl')).toBeNull();
    expect(within(emailTpl).queryByText('SMS tpl')).toBeNull();
    fireEvent.change(emailTpl, { target: { value: 't-mail' } });
    expect(screen.queryByText('SMS Template')).toBeNull();
    fireEvent.click(screen.getByLabelText('SMS'));
    const smsTpl = selectAfterLabel('SMS Template');
    expect(within(smsTpl).getByText('SMS tpl')).toBeInTheDocument();
    fireEvent.change(smsTpl, { target: { value: 't-sms' } });
    // Unsetting a template back to "default" clears it
    fireEvent.change(smsTpl, { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('In-App')); // default checked -> off

    // Recipients: a role (SUPER_ADMIN filtered out), a group, a user (superadmin filtered out).
    fireEvent.click(screen.getByRole('button', { name: '+ Add Role' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add Group' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add User' }));
    const roleSel = screen.getByText('Select role...').closest('select')!;
    expect(within(roleSel).queryByText('Super Admin')).toBeNull();
    fireEvent.change(roleSel, { target: { value: 'QA' } });
    const groupSel = screen.getByText('Select group...').closest('select')!;
    expect(within(groupSel).getByText('QA team (3 members)')).toBeInTheDocument();
    fireEvent.change(groupSel, { target: { value: 'g1' } });
    const userSel = screen.getByText('Select user...').closest('select')!;
    expect(within(userSel).queryByText(/superadmin/)).toBeNull();
    fireEvent.change(userSel, { target: { value: 'u1' } });

    const [cooldown, priority] = screen.getAllByRole('spinbutton');
    fireEvent.change(cooldown, { target: { value: '15' } });
    fireEvent.change(priority, { target: { value: '7' } });

    await act(async () => { fireEvent.click(create); });
    await waitFor(() => expect(api.calls('POST', '/api/notification-rules')).toHaveLength(1));
    expect(api.calls('POST', '/api/notification-rules')[0].json).toEqual({
      name: 'Overdue PM', description: 'Tell QA', eventType: 'PM_OVERDUE', eventTypes: ['PM_OVERDUE'],
      emailEnabled: true, smsEnabled: true, inAppEnabled: false, emailTemplateId: 't-mail',
      cooldownMinutes: 15, priority: 7, isActive: true, conditions: {},
      recipients: [
        { recipientType: 'ROLE', roleValue: 'QA', groupId: '', userId: '' },
        { recipientType: 'GROUP', roleValue: '', groupId: 'g1', userId: '' },
        { recipientType: 'USER', roleValue: '', groupId: '', userId: 'u1' },
      ],
    });
    // Back on the list, which refetched.
    expect(await screen.findByText('3 notification rules configured')).toBeInTheDocument();
    expect(api.calls('GET', '/api/notification-rules').length).toBeGreaterThan(1);
  });

  it('recipient type can be switched and a recipient removed; removing an event chip unselects it', async () => {
    const api = setup();
    await screen.findByText('Cycle alert');
    await waitForEditorData(api);
    fireEvent.click(screen.getByRole('button', { name: '+ New Rule' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add Role' }));
    const row = screen.getByText('Select role...').closest('div.bg-slate-50') as HTMLElement;
    fireEvent.change(within(row).getAllByRole('combobox')[0], { target: { value: 'USER' } });
    expect(within(row).getByText('Select user...')).toBeInTheDocument();
    expect(within(row).queryByText('Select role...')).toBeNull();
    fireEvent.click(within(row).getByRole('button'));
    expect(screen.queryByText('Select user...')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Select event types...' }));
    fireEvent.click(screen.getByLabelText('Cycle Terminated'));
    fireEvent.click(screen.getByRole('button', { name: '1 event type selected' })); // toggle closes it
    const chip = screen.getByText('Cycle Terminated', { selector: 'span' });
    fireEvent.click(within(chip).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Select event types...' })).toBeInTheDocument();
    // Cancel returns to the list without sending anything.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('3 notification rules configured')).toBeInTheDocument();
    expect(api.calls('POST', '/api/notification-rules')).toHaveLength(0);
  });

  it('edits an existing rule with PUT; a rule with only a legacy eventType preselects it', async () => {
    const api = setup([
      { method: 'PUT', path: '/api/notification-rules/r2', body: { ok: true } },
    ]);
    await screen.findByText('Legacy PM rule');
    await waitForEditorData(api);
    fireEvent.click(within(card('Legacy PM rule')).getByTitle('Edit'));
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 event type selected' })).toBeInTheDocument();
    expect(screen.getByText('PM Overdue', { selector: 'span' })).toBeInTheDocument();
    // Email off for this rule -> no Email Template picker, In-App reflects the stored false.
    expect(screen.queryByText('Email Template')).toBeNull();
    expect(screen.getByLabelText('In-App')).not.toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('e.g. Cycle Completion Alert'), { target: { value: 'PM overdue (v2)' } });
    // Selecting an event type updates eventTypes AND the legacy eventType field.
    fireEvent.click(screen.getByRole('button', { name: '1 event type selected' }));
    fireEvent.click(screen.getByLabelText('Cycle Completed'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/notification-rules/r2')).toHaveLength(1));
    expect(api.calls('PUT', '/api/notification-rules/r2')[0].json).toMatchObject({
      id: 'r2', name: 'PM overdue (v2)', eventTypes: ['PM_OVERDUE', 'CYCLE_COMPLETED'], eventType: 'PM_OVERDUE',
    });
    expect(await screen.findByText('3 notification rules configured')).toBeInTheDocument();
  });

  it('the editor close (X) button discards the draft', async () => {
    const api = setup();
    await screen.findByText('Cycle alert');
    fireEvent.click(within(card('Cycle alert')).getByTitle('Edit'));
    const heading = screen.getByRole('heading', { name: 'Edit Rule' });
    fireEvent.click(within(heading.parentElement!).getByRole('button'));
    expect(screen.getByText('3 notification rules configured')).toBeInTheDocument();
    expect(api.calls('PUT', /notification-rules\/r1/)).toHaveLength(0);
  });

  it('a refused save keeps the editor open and shows the server message', async () => {
    const api = setup([{ method: 'PUT', path: '/api/notification-rules/r1', status: 400, body: { error: 'VALIDATION', message: 'Cooldown must be >= 0' } }]);
    await screen.findByText('Cycle alert');
    fireEvent.click(within(card('Cycle alert')).getByTitle('Edit'));
    // Edit shows both selected event types as chips.
    expect(screen.getByRole('button', { name: '2 event types selected' })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    expect(await screen.findByText('Cooldown must be >= 0')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit Rule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update Rule' })).not.toBeDisabled();
    expect(api.calls('PUT', '/api/notification-rules/r1')).toHaveLength(1);
  });

  it('toggle sends PUT /toggle and reloads', async () => {
    const api = setup([{ method: 'PUT', path: '/api/notification-rules/r1/toggle', body: { isActive: false } }]);
    await screen.findByText('Cycle alert');
    const before = api.calls('GET', '/api/notification-rules').length;
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Toggle')); });
    await waitFor(() => expect(api.calls('PUT', '/api/notification-rules/r1/toggle')).toHaveLength(1));
    expect(api.calls('PUT', '/api/notification-rules/r1/toggle')[0].json).toEqual({});
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules').length).toBeGreaterThan(before));
  });

  it('toggle the server wants signed: prompt, then the retry carries the password', async () => {
    const P = '/api/notification-rules/r2/toggle';
    const api = setup([reauthRequired('PUT', P), { method: 'PUT', path: P, body: { isActive: true } }]);
    await screen.findByText('Legacy PM rule');
    await act(async () => { fireEvent.click(within(card('Legacy PM rule')).getByTitle('Toggle')); });
    await signReauth('pw-toggle');
    await waitFor(() => expect(api.calls('PUT', P)).toHaveLength(2));
    expect(api.calls('PUT', P)[1].headers['x-reauth-password']).toBe('pw-toggle');
    expect(api.calls('PUT', P)[1].json).toEqual({ _currentPassword: 'pw-toggle' });
  });

  it('delete asks for confirmation; declining sends nothing', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const api = setup();
    await screen.findByText('Cycle alert');
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Delete')); });
    expect(confirmSpy).toHaveBeenCalledWith('Delete this notification rule?');
    expect(api.calls('DELETE', /notification-rules/)).toHaveLength(0);
  });

  it('confirmed delete sends DELETE and reloads', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = setup([{ method: 'DELETE', path: '/api/notification-rules/r1', status: 204 }]);
    await screen.findByText('Cycle alert');
    const before = api.calls('GET', '/api/notification-rules').length;
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Delete')); });
    await waitFor(() => expect(api.calls('DELETE', '/api/notification-rules/r1')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules').length).toBeGreaterThan(before));
  });

  it('delete gated up front by MANAGE_NOTIFICATION_RULES: prompt first, cancel sends nothing, sign sends the password', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const P = '/api/notification-rules/r1';
    const api = setup([{ method: 'DELETE', path: P, status: 204 }], { reauth: ['MANAGE_NOTIFICATION_RULES'] });
    await screen.findByText('Cycle alert');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Delete')); });
    expect(await screen.findByText(/Create \/ Edit \/ Delete Notification Rule/)).toBeInTheDocument();
    await cancelReauth();
    expect(api.calls('DELETE', P)).toHaveLength(0);
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Delete')); });
    await signReauth('pw-del');
    await waitFor(() => expect(api.calls('DELETE', P)).toHaveLength(1));
    expect(api.calls('DELETE', P)[0].headers['x-reauth-password']).toBe('pw-del');
  });

  it('editor fallbacks: unknown event chips show their raw value; missing channel/cooldown/priority fields use defaults', async () => {
    const SPARSE = {
      id: 'r9', name: 'Sparse rule', eventType: '', eventTypes: ['GONE_EVENT'], conditions: {}, isActive: true, createdAt: '',
      recipients: [{ id: 'x1', recipientType: 'ROLE', roleValue: 'QA', displayName: 'Quality' }],
    };
    const api = setup([{ method: 'PUT', path: '/api/notification-rules/r9', body: { ok: true } }], { rules: [SPARSE] });
    await screen.findByText('Sparse rule');
    await waitForEditorData(api);
    fireEvent.click(within(card('Sparse rule')).getByTitle('Edit'));
    // An event type no longer in the catalog still shows (by its raw value).
    expect(screen.getByText('GONE_EVENT', { selector: 'span' })).toBeInTheDocument();
    // No stored channel flags: In-App defaults on, Email/SMS off; cooldown/priority default 0.
    expect(screen.getByLabelText('In-App')).toBeChecked();
    expect(screen.getByLabelText('Email')).not.toBeChecked();
    const [cooldown, priority] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(cooldown.value).toBe('0');
    expect(priority.value).toBe('0');
    // Switching a stored ROLE recipient to GROUP / USER starts with an empty pick.
    const row = screen.getByText('Select role...').closest('div.bg-slate-50') as HTMLElement;
    const typeSel = within(row).getAllByRole('combobox')[0];
    fireEvent.change(typeSel, { target: { value: 'GROUP' } });
    expect((within(row).getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('');
    fireEvent.change(typeSel, { target: { value: 'USER' } });
    expect((within(row).getAllByRole('combobox')[1] as HTMLSelectElement).value).toBe('');
    // Email on, pick then un-pick a template -> the template id is cleared again.
    fireEvent.click(screen.getByLabelText('Email'));
    const emailTpl = selectAfterLabel('Email Template');
    fireEvent.change(emailTpl, { target: { value: 't-mail' } });
    fireEvent.change(emailTpl, { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    await waitFor(() => expect(api.calls('PUT', '/api/notification-rules/r9')).toHaveLength(1));
    const sent = api.calls('PUT', '/api/notification-rules/r9')[0].json;
    expect(sent.emailEnabled).toBe(true);
    expect(sent.emailTemplateId).toBeUndefined();
    expect(sent.eventTypes).toEqual(['GONE_EVENT']);
    expect(sent.recipients[0]).toMatchObject({ recipientType: 'USER', roleValue: 'QA' });
  });

  it('a rule with no event type at all opens with nothing selected; the editor works before event types load', async () => {
    const NONE = { ...RULE_C, id: 'r8', name: 'Blank events', eventType: '' };
    const api = mockApi([
      { path: '/api/notification-rules', body: [NONE] },
      { path: '/api/notification-rules/event-types', status: 204 },
      { path: '/api/user-groups', body: GROUPS },
      { path: '/api/notification-settings/templates', body: TEMPLATES },
      { path: '/api/users', body: { data: USERS } },
      { path: '/api/roles', body: ROLES },
      ...commonRoutes(),
    ]);
    renderPage(<NotificationRulesPage />, { user: SUPER_ADMIN, api });
    await screen.findByText('Blank events');
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules/event-types')).toHaveLength(1));
    fireEvent.click(within(card('Blank events')).getByTitle('Edit'));
    const picker = screen.getByRole('button', { name: 'Select event types...' });
    fireEvent.click(picker);
    // No catalog -> the open dropdown lists nothing; Update stays disabled with no event selected.
    const dropdown = picker.parentElement!.querySelector('.absolute') as HTMLElement;
    expect(dropdown).not.toBeNull();
    expect(within(dropdown).queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Update Rule' })).toBeDisabled();
  });

  it('a save refused with an empty message falls back to "Failed to save"', async () => {
    setup([{ method: 'PUT', path: '/api/notification-rules/r1', status: 500, body: { error: 'INTERNAL', message: '' } }]);
    await screen.findByText('Cycle alert');
    fireEvent.click(within(card('Cycle alert')).getByTitle('Edit'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Rule' })); });
    expect(await screen.findByText('Failed to save')).toBeInTheDocument();
  });

  it('a refused toggle or delete does not reload the list', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const api = setup([
      { method: 'PUT', path: '/api/notification-rules/r1/toggle', status: 409, body: { error: 'CONFLICT', message: 'Rule locked' } },
      { method: 'DELETE', path: '/api/notification-rules/r1', status: 403, body: { error: 'FORBIDDEN', message: 'No' } },
    ]);
    await screen.findByText('Cycle alert');
    await waitFor(() => expect(api.calls('GET', '/api/notification-rules')).toHaveLength(1));
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Toggle')); });
    await waitFor(() => expect(api.calls('PUT', '/api/notification-rules/r1/toggle')).toHaveLength(1));
    await act(async () => { fireEvent.click(within(card('Cycle alert')).getByTitle('Delete')); });
    await waitFor(() => expect(api.calls('DELETE', '/api/notification-rules/r1')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('GET', '/api/notification-rules')).toHaveLength(1);
    expect(screen.getByText('Cycle alert')).toBeInTheDocument();
  });

  it('Test sends POST /test and alerts the result message, the error, or the transport failure', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const P = '/api/notification-rules/r1/test';
    const api = setup([
      { method: 'POST', path: P, times: 1, body: { success: true, message: 'Sent to 3 recipients' } },
      { method: 'POST', path: P, times: 1, body: { success: false, error: 'No recipients resolved' } },
      { method: 'POST', path: P, status: 500, body: { error: 'INTERNAL', message: 'SMTP down' } },
    ]);
    await screen.findByText('Cycle alert');
    const test = () => within(card('Cycle alert')).getByTitle('Test');
    await act(async () => { fireEvent.click(test()); });
    await waitFor(() => expect(alertSpy).toHaveBeenLastCalledWith('Sent to 3 recipients'));
    await act(async () => { fireEvent.click(test()); });
    await waitFor(() => expect(alertSpy).toHaveBeenLastCalledWith('No recipients resolved'));
    await act(async () => { fireEvent.click(test()); });
    await waitFor(() => expect(alertSpy).toHaveBeenLastCalledWith('SMTP down'));
    expect(api.calls('POST', P)).toHaveLength(3);
    expect(api.calls('POST', P)[0].json).toEqual({});
  });
});
