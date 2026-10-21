import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { RoleAssignmentsPage } from '../role-assignments';
import { SUPER_ADMIN, commonRoutes, resetEnv, ackMessage } from './config-test-helpers';

vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(resetEnv);

const KEYS = ['pm-schedule-approval', 'replacement-schedule-approval', 'filter-approval', 'qnn-notifications',
  'guest-cleaning-requests', 'block-change-approval', 'stage-interlock', 'pm-schedule-settings'];
const dyn = (k: string) => `/api/config/dynamic/${k}`;
const ROLES = [{ name: 'QA', displayName: 'Quality' }, { name: 'MANAGER', displayName: 'Manager' }];
const BASE: Record<string, any> = {
  'pm-schedule-approval': { workflowEnabled: true, uploadRole: ['MANAGER'], reviewRole: 'QA' },
  'replacement-schedule-approval': {},
  'filter-approval': { workflowEnabled: false },
  'qnn-notifications': { visibleRoles: ['QA'] },
  'guest-cleaning-requests': { recipientRoles: [] },
  'block-change-approval': { mode: 'CONFIRM' },
  'stage-interlock': { enabled: true, washOutApproverRole: 'QA', dryOutApproverRole: 'QA' },
  'pm-schedule-settings': { enabled: true, defaultToleranceDays: 5 },
};

function setup(fail: Record<string, { status: number; message: string }> = {}, extra: MockRoute[] = []) {
  const api = mockApi([
    ...extra,
    ...KEYS.map((k): MockRoute => (fail[k]
      ? { path: dyn(k), status: fail[k].status, body: { error: 'X', message: fail[k].message } }
      : { path: dyn(k), body: BASE[k] })),
    { path: '/api/roles/active', body: ROLES },
    ...commonRoutes(),
  ]);
  renderPage(<RoleAssignmentsPage />, { user: SUPER_ADMIN, api });
  return api;
}
const loaded = () => screen.findByRole('heading', { name: 'Role Assignments' });
const section = (title: string) => screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;
const pressables = (el: HTMLElement) => within(el).queryAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'));
const saveBtn = () => screen.getByRole('button', { name: /Save All|Saving/ });

/**
 * Item 8 (2026-10-21): a section whose config failed to load was rendered from
 * `{}` - i.e. its defaults, indistinguishable from "never configured" - and was
 * editable, so Save All could write those defaults over the stored config.
 */
describe('Role Assignments — a section that fails to load', () => {
  it('shows the load error in that section, offers no controls, and Save All never writes it', async () => {
    const api = setup({ 'stage-interlock': { status: 500, message: 'db down' } }, [
      { method: 'PUT', path: dyn('qnn-notifications'), body: { ok: true } },
    ]);
    await loaded();
    const il = section('Cleaning Stage Interlock');
    expect(within(il).getByRole('alert')).toHaveTextContent('db down');
    // No defaults shown as if they were the stored values, nothing to edit.
    expect(within(il).queryByText(/Off — cleaning advances/)).toBeNull();
    expect(pressables(il)).toHaveLength(0);
    expect(within(il).queryAllByRole('combobox')).toHaveLength(0);

    // Edit another section and save: only that section is written.
    const qnn = section('QNN Notifications');
    await waitFor(() => expect(within(qnn).getByRole('button', { name: 'Manager' })).toBeInTheDocument());
    fireEvent.click(within(qnn).getByRole('button', { name: 'Manager' }));
    await act(async () => { fireEvent.click(saveBtn()); });
    await waitFor(() => expect(api.calls('PUT', dyn('qnn-notifications'))).toHaveLength(1));
    await ackMessage('Saved');
    expect(api.calls('PUT', dyn('stage-interlock'))).toHaveLength(0);
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
  });

  it('a 403 on a section is shown as that section\'s error, the other sections stay editable', async () => {
    setup({ 'pm-schedule-settings': { status: 403, message: 'Insufficient permissions' } });
    await loaded();
    const ps = section('PM Schedule Settings');
    expect(within(ps).getByRole('alert')).toHaveTextContent('Insufficient permissions');
    expect(within(ps).queryByText(/Off — all PM endpoints are disabled/)).toBeNull();
    expect(pressables(ps)).toHaveLength(0);
    expect(within(ps).queryAllByRole('spinbutton')).toHaveLength(0);
    // A section that loaded is unaffected.
    expect(within(section('Cleaning Stage Interlock')).queryByRole('alert')).toBeNull();
    expect(pressables(section('Cleaning Stage Interlock')).length).toBeGreaterThan(0);
  });

  it('when PM failed to load, a Replacement workflow that inherits from it cannot be toggled', async () => {
    const api = setup({ 'pm-schedule-approval': { status: 500, message: 'pm config unavailable' } });
    await loaded();
    expect(within(section('PM Schedule Workflow')).getByRole('alert')).toHaveTextContent('pm config unavailable');
    const rs = section('Replacement Schedule Workflow');
    const toggle = within(rs).getByRole('button', { name: 'Review & approval workflow' });
    expect(toggle).toBeDisabled();
    expect(rs).toHaveTextContent(/inherits from PM, which could not be loaded/);
    fireEvent.click(toggle);
    expect(saveBtn()).toBeDisabled();
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });
});

/**
 * Item 12 (2026-10-21): the multi-role Upload chips sat inside a <label>, so the
 * FIRST chip's accessible name was the whole label text; the on/off switches
 * had no accessible name at all.
 */
describe('Role Assignments — accessible names', () => {
  it('each Upload chip is named by its role, inside a group named by the step', async () => {
    setup();
    await loaded();
    const pm = section('PM Schedule Workflow');
    await waitFor(() => expect(within(pm).getByRole('group', { name: 'Upload' })).toBeInTheDocument());
    const upload = within(pm).getByRole('group', { name: 'Upload' });
    expect(within(upload).getByRole('button', { name: 'Quality' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(upload).getByRole('button', { name: 'Manager' })).toHaveAttribute('aria-pressed', 'true');
    const fc = section('Filter Creation Workflow');
    expect(within(within(fc).getByRole('group', { name: 'Create / Upload' })).getByRole('button', { name: 'Quality' })).toBeInTheDocument();
    // The single-role steps keep their label -> select association.
    expect(within(pm).getByRole('combobox', { name: /Review/ })).toBeInTheDocument();
  });

  it('every switch has an accessible name', async () => {
    setup({}, []);
    await loaded();
    for (const el of screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed') && !b.textContent?.trim())) {
      expect(el).toHaveAccessibleName();
    }
    expect(within(section('PM Schedule Workflow')).getByRole('button', { name: 'Review & approval workflow' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(section('Cleaning Stage Interlock')).getByRole('button', { name: 'Stage interlock' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(section('PM Schedule Settings')).getByRole('button', { name: 'PM scheduling' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(section('PM Schedule Settings')).getByRole('button', { name: 'Show overdue separately' })).toHaveAttribute('aria-pressed', 'true');
  });
});
