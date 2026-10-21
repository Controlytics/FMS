import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { RoleAssignmentsPage } from '../role-assignments';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

// Multi-request flows: the 5s / 1s defaults are too tight when the suite runs
// under coverage alongside other workers.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });


afterEach(resetEnv);

const KEYS = ['pm-schedule-approval', 'replacement-schedule-approval', 'filter-approval', 'qnn-notifications',
  'guest-cleaning-requests', 'block-change-approval', 'stage-interlock', 'pm-schedule-settings'];
const dyn = (k: string) => `/api/config/dynamic/${k}`;

// The roles feed in every shape the hook accepts; the nameless entry is dropped.
const ROLES = [
  { name: 'QA', displayName: 'Quality' },
  { name: 'MANAGER' },
  'OPERATOR',
  { value: 'SUPERVISOR' },
  { displayName: 'Ghost' },
];

const BASE: Record<string, any> = {
  'pm-schedule-approval': { workflowEnabled: true, uploadRole: 'MANAGER', reviewRole: 'QA', approvalRole: '' },
  'replacement-schedule-approval': {},
  'filter-approval': { workflowEnabled: false, uploadRole: ['OPERATOR'] },
  'qnn-notifications': { visibleRoles: ['QA'] },
  'guest-cleaning-requests': { recipientRoles: [] },
  'block-change-approval': { mode: 'CONFIRM' },
  'stage-interlock': { enabled: false },
  'pm-schedule-settings': { enabled: false },
};

function setup(opts: { cfg?: Record<string, any>; extra?: MockRoute[]; reauth?: string[]; roles?: unknown; failKey?: string } = {}) {
  const cfg = { ...BASE, ...(opts.cfg ?? {}) };
  const api = mockApi([
    ...(opts.extra ?? []),
    ...KEYS.map((k): MockRoute => (k === opts.failKey
      ? { path: dyn(k), status: 500, body: { error: 'INTERNAL', message: 'db down' } }
      : { path: dyn(k), body: cfg[k] })),
    { path: '/api/roles/active', body: opts.roles ?? ROLES },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<RoleAssignmentsPage />, { user: SUPER_ADMIN, api });
  return api;
}

const section = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;
/** Toggle switches have no text — only aria-pressed. */
const switches = (el: HTMLElement) => within(el).getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed') && !b.textContent?.trim());
// By text, not accessible name: the multi-role Upload chips sit inside a <label>,
// which makes the label's whole text the FIRST chip's accessible name.
const chip = (el: HTMLElement, label: string) => within(el).getByText(label, { selector: 'button' });
const saveBtn = () => screen.getByRole('button', { name: /Save All|Saving/ });
const loaded = () => screen.findByRole('heading', { name: 'Role Assignments' });

describe('Role Assignments page', () => {
  it('shows a skeleton until all eight sections load, then renders each one from its config key', async () => {
    const api = setup();
    expect(screen.queryByRole('heading', { name: 'Role Assignments' })).toBeNull();
    await loaded();
    for (const k of KEYS) expect(api.calls('GET', dyn(k))).toHaveLength(1);
    // Role options: displayName, else name, else value; the nameless one is dropped.
    const pm = section('PM Schedule Workflow');
    await waitFor(() => expect(chip(pm, 'Quality')).toBeInTheDocument());
    for (const label of ['MANAGER', 'OPERATOR', 'SUPERVISOR']) expect(chip(pm, label)).toBeInTheDocument();
    expect(within(pm).queryByText('Ghost')).toBeNull();
    // Legacy single-role upload string shows as one selected chip.
    expect(chip(pm, 'MANAGER')).toHaveAttribute('aria-pressed', 'true');
    expect(within(pm).getByText('1 role selected')).toBeInTheDocument();
    expect((within(pm).getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('QA');
    expect(switches(pm)[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(pm).getByText('Uploads must be reviewed, then approved.')).toBeInTheDocument();
    // Replacement inherits the PM toggle while it has no explicit value.
    const rs = section('Replacement Schedule Workflow');
    expect(within(rs).getByText('(inheriting from PM)')).toBeInTheDocument();
    expect(switches(rs)[0]).toHaveAttribute('aria-pressed', 'true');
    expect(within(rs).getByText('Inherit from PM', { selector: 'p' })).toBeInTheDocument();
    // Nothing changed -> Save All disabled, no unsaved marker.
    expect(saveBtn()).toBeDisabled();
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('Save All PUTs only the edited section (filter-approval workflow) and confirms', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: dyn('filter-approval'), body: { ok: true } }] });
    await loaded();
    const fa = section('Filter Creation Workflow');
    await waitFor(() => expect(chip(fa, 'OPERATOR')).toHaveAttribute('aria-pressed', 'true'));
    expect(within(fa).getByText('Uploads are approved in a single step.')).toBeInTheDocument();
    fireEvent.click(switches(fa)[0]); // workflow on
    fireEvent.click(chip(fa, 'Quality')); // add an uploader
    fireEvent.click(chip(fa, 'OPERATOR')); // remove the other
    const [review, approve] = within(fa).getAllByRole('combobox') as HTMLSelectElement[];
    fireEvent.change(review, { target: { value: 'MANAGER' } });
    fireEvent.change(approve, { target: { value: 'QA' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', dyn('filter-approval'))).toHaveLength(1));
    expect(api.calls('PUT', dyn('filter-approval'))[0].json).toEqual({
      workflowEnabled: true, uploadRole: ['QA'], reviewRole: 'MANAGER', approvalRole: 'QA',
    });
    // Only the changed key was written (so only it is audit-logged).
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(await ackMessage('Saved')).toContain('1 section updated.');
    await waitFor(() => expect(saveBtn()).toBeDisabled());
  });

  it('edits across several sections save each changed key and report the count', async () => {
    const changed = ['replacement-schedule-approval', 'qnn-notifications', 'guest-cleaning-requests', 'block-change-approval', 'stage-interlock', 'pm-schedule-settings', 'pm-schedule-approval'];
    const api = setup({ extra: changed.map((k): MockRoute => ({ method: 'PUT', path: dyn(k), body: { ok: true } })) });
    await loaded();

    // PM: uploader legacy string -> toggling another role makes it an array.
    const pm = section('PM Schedule Workflow');
    await waitFor(() => expect(chip(pm, 'MANAGER')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(chip(pm, 'MANAGER')); // deselect -> []
    expect(within(pm).getByText('Anyone with permission', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(chip(pm, 'SUPERVISOR'));

    // Replacement: explicit override of the inherited toggle (inherit=true -> false).
    const rs = section('Replacement Schedule Workflow');
    fireEvent.click(switches(rs)[0]);
    expect(within(rs).queryByText('(inheriting from PM)')).toBeNull();
    expect(switches(rs)[0]).toHaveAttribute('aria-pressed', 'false');

    // QNN: remove QA, add Quality? (QA is the "Quality" label) -> remove then add MANAGER.
    const qnn = section('QNN Notifications');
    fireEvent.click(chip(qnn, 'Quality'));
    fireEvent.click(chip(qnn, 'MANAGER'));
    const guest = section('Guest Cleaning Requests');
    fireEvent.click(chip(guest, 'OPERATOR'));

    // Cross-block: APPROVAL reveals approver, auto-expire, require-reason.
    const cb = section('Cross-Block Cleaning');
    expect(within(cb).getByText(/operator confirms/)).toBeInTheDocument();
    fireEvent.click(within(cb).getByRole('button', { name: 'Needs approval' }));
    expect(within(cb).getByText(/must approve before cleaning/)).toBeInTheDocument();
    fireEvent.change(within(cb).getByRole('combobox'), { target: { value: 'QA' } });
    const expire = within(cb).getByRole('spinbutton') as HTMLInputElement;
    expect(expire.value).toBe('24');
    fireEvent.change(expire, { target: { value: '-5' } });
    expect(expire.value).toBe('0');
    fireEvent.change(expire, { target: { value: '' } });
    expect(expire.value).toBe('');
    fireEvent.change(expire, { target: { value: '48' } });
    expect(within(cb).getByText('Operator must give a reason')).toBeInTheDocument();
    fireEvent.click(switches(cb)[0]);
    expect(within(cb).getByText('Reason optional')).toBeInTheDocument();

    // Stage interlock on -> approvers; a different approver is always required
    // (A-03, 2026-10-21: no longer a switch, so the only switch is the enable).
    const il = section('Cleaning Stage Interlock');
    expect(within(il).getByText(/Off — cleaning advances/)).toBeInTheDocument();
    fireEvent.click(switches(il)[0]);
    expect(within(il).getByText(/pause for an approver signature/)).toBeInTheDocument();
    const [wash, dry] = within(il).getAllByRole('combobox');
    fireEvent.change(wash, { target: { value: 'QA' } });
    fireEvent.change(dry, { target: { value: 'MANAGER' } });
    expect(within(il).getByText('Always required: the operator can’t approve their own stage.')).toBeInTheDocument();
    expect(switches(il)).toHaveLength(1);

    // PM settings on -> tolerance clamp, visibility warning, overdue switch, roles.
    const ps = section('PM Schedule Settings');
    expect(within(ps).getByText(/Off — all PM endpoints are disabled/)).toBeInTheDocument();
    fireEvent.click(switches(ps)[0]);
    const tol = within(ps).getByRole('spinbutton') as HTMLInputElement;
    expect(tol.value).toBe('3');
    fireEvent.change(tol, { target: { value: '999' } });
    expect(tol.value).toBe('365');
    fireEvent.change(tol, { target: { value: '' } });
    expect(tol.value).toBe('');
    fireEvent.change(tol, { target: { value: '7' } });
    const vis = within(ps).getByRole('combobox') as HTMLSelectElement;
    expect(vis.value).toBe('GLOBAL');
    fireEvent.change(vis, { target: { value: 'PER_USER' } });
    expect(within(ps).getByText(/Not yet implemented — the task list will error/)).toBeInTheDocument();
    fireEvent.change(vis, { target: { value: 'GLOBAL' } });
    expect(within(ps).getByText('Own “Overdue” section')).toBeInTheDocument();
    fireEvent.click(switches(ps)[1]);
    expect(within(ps).getByText('Hidden')).toBeInTheDocument();
    fireEvent.click(chip(ps, 'Quality'));

    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(changed.length));
    const body = (k: string) => api.calls('PUT', dyn(k))[0].json;
    expect(body('pm-schedule-approval')).toMatchObject({ uploadRole: ['SUPERVISOR'] });
    expect(body('replacement-schedule-approval')).toEqual({ workflowEnabled: false });
    expect(body('qnn-notifications')).toEqual({ visibleRoles: ['MANAGER'] });
    expect(body('guest-cleaning-requests')).toEqual({ recipientRoles: ['OPERATOR'] });
    expect(body('block-change-approval')).toEqual({ mode: 'APPROVAL', approvalRole: 'QA', autoExpireHours: 48, requireReason: false });
    expect(body('stage-interlock')).toEqual({ enabled: true, washOutApproverRole: 'QA', dryOutApproverRole: 'MANAGER' });
    expect(body('pm-schedule-settings')).toEqual({
      enabled: true, defaultToleranceDays: 7, taskVisibility: 'GLOBAL', showOverdueSeparately: false, overdueNotificationRoles: ['QA'],
    });
    expect(api.calls('PUT', dyn('filter-approval'))).toHaveLength(0);
    expect(await ackMessage('Saved')).toContain(`${changed.length} sections updated.`);
  });

  it('turning the PM workflow off also turns off the Replacement workflow that inherits it; only PM is saved', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: dyn('pm-schedule-approval'), body: { ok: true } }] });
    await loaded();
    const pm = section('PM Schedule Workflow');
    const rs = section('Replacement Schedule Workflow');
    await waitFor(() => expect(switches(pm)[0]).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(switches(pm)[0]);
    expect(switches(pm)[0]).toHaveAttribute('aria-pressed', 'false');
    expect(within(pm).getByText('Uploads are approved in a single step.')).toBeInTheDocument();
    // Still inheriting -> follows PM.
    expect(switches(rs)[0]).toHaveAttribute('aria-pressed', 'false');
    expect(within(rs).getByText('(inheriting from PM)')).toBeInTheDocument();
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', dyn('pm-schedule-approval'))).toHaveLength(1));
    expect(api.calls('PUT', dyn('pm-schedule-approval'))[0].json).toEqual({ workflowEnabled: false, uploadRole: 'MANAGER', reviewRole: 'QA', approvalRole: '' });
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    await ackMessage('Saved');
  });

  it('a cross-block config with no mode stored behaves as Self-confirm', async () => {
    setup({ cfg: { 'block-change-approval': {} } });
    await loaded();
    const cb = section('Cross-Block Cleaning');
    expect(within(cb).getByRole('button', { name: 'Self-confirm' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(cb).getByRole('button', { name: 'No restriction' }));
    expect(within(cb).getByText(/nothing is shown or asked/)).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('an unknown stored cross-block mode falls back to the Self-confirm hint', async () => {
    setup({ cfg: { 'block-change-approval': { mode: 'WEIRD' } } });
    await loaded();
    const cb = section('Cross-Block Cleaning');
    expect(within(cb).getByText(/operator confirms/)).toBeInTheDocument();
    expect(within(cb).queryByRole('combobox')).toBeNull();
  });

  it('an explicit replacement workflow value is not "inherited"', async () => {
    setup({ cfg: { 'replacement-schedule-approval': { workflowEnabled: true } } });
    await loaded();
    const rs = section('Replacement Schedule Workflow');
    expect(within(rs).queryByText('(inheriting from PM)')).toBeNull();
    expect(switches(rs)[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('server demands a signature: prompts, then re-sends the changed section with the password', async () => {
    const k = dyn('qnn-notifications');
    const api = setup({ extra: [reauthRequired('PUT', k), { method: 'PUT', path: k, body: { ok: true } }] });
    await loaded();
    const qnn = section('QNN Notifications');
    await waitFor(() => expect(chip(qnn, 'MANAGER')).toBeInTheDocument());
    fireEvent.click(chip(qnn, 'MANAGER'));
    await act(async () => { fireEvent.click(saveBtn()); });
    await signReauth('ra-pw');
    await waitFor(() => expect(api.calls('PUT', k)).toHaveLength(2));
    const retry = api.calls('PUT', k)[1];
    expect(retry.headers['x-reauth-password']).toBe('ra-pw');
    expect(retry.json).toEqual({ visibleRoles: ['QA', 'MANAGER'], _currentPassword: 'ra-pw' });
    await ackMessage('Saved');
  });

  it('cancelling the signature is not reported as a failure and keeps the edits', async () => {
    const api = setup({ reauth: ['UPDATE_CONFIG_PAGE'] });
    await loaded();
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const guest = section('Guest Cleaning Requests');
    await waitFor(() => expect(chip(guest, 'Quality')).toBeInTheDocument());
    fireEvent.click(chip(guest, 'Quality'));
    await act(async () => { fireEvent.click(saveBtn()); });
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save All'));
    expect(screen.queryByRole('heading', { name: 'Save failed' })).toBeNull();
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('a refused save shows the server message and keeps the edits unsaved', async () => {
    setup({ extra: [{ method: 'PUT', path: dyn('stage-interlock'), status: 400, body: { error: 'VALIDATION_ERROR', message: 'washOutApproverRole must be a role' } }] });
    await loaded();
    fireEvent.click(switches(section('Cleaning Stage Interlock'))[0]);
    await act(async () => { fireEvent.click(saveBtn()); });
    expect(await ackMessage('Save failed')).toContain('washOutApproverRole must be a role');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(saveBtn()).not.toBeDisabled();
  });

  it('a section that fails to load does not stop the other sections from rendering', async () => {
    const api = setup({ failKey: 'qnn-notifications' });
    await loaded();
    expect(api.calls('GET', dyn('qnn-notifications'))).toHaveLength(1);
    // The PM section still shows its stored values.
    await waitFor(() => expect(chip(section('PM Schedule Workflow'), 'MANAGER')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('with no roles defined, chip pickers say so', async () => {
    setup({ roles: [] });
    await loaded();
    expect(within(section('QNN Notifications')).getByText(/No roles defined yet/)).toBeInTheDocument();
    expect(within(section('Guest Cleaning Requests')).getByText(/No roles defined yet/)).toBeInTheDocument();
  });

  it('accepts the roles feed wrapped in { data }', async () => {
    setup({ roles: { data: [{ name: 'AUDITOR', displayName: 'Auditor' }] } });
    await loaded();
    await waitFor(() => expect(chip(section('QNN Notifications'), 'Auditor')).toBeInTheDocument());
  });
});
