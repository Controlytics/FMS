import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { SIDEBAR_ITEMS } from '@digilog/shared';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { swrConfig } from '@/lib/swr-config';
import { RoleAccessPage } from '../role-access';
import { SUPER_ADMIN, commonRoutes, resetEnv } from './config-test-helpers';

/**
 * Item 2 (coverage campaign defects, 2026-10-21): the Permissions and Sidebar
 * tabs copied a role's config into local form state ONLY from SWR `onSuccess`.
 * `onSuccess` does not run when SWR serves a deduped/cached key and does not
 * run when the load fails, but it DOES run on every background revalidation —
 * so the form could show (and save) another role's values, hang on a failed
 * load, or silently discard unsaved edits. The form must be derived from the
 * selected role's current data plus a per-role draft.
 *
 * These tests run with the PRODUCTION SWR behaviour the harness normally turns
 * off (dedupingInterval 5000, revalidateOnFocus), which is what hid the defect.
 */

afterEach(resetEnv);
configure({ asyncUtilTimeout: 4000 });

const role = (name: string, displayName: string, hierarchyLevel: number) => ({
  id: `r-${name}`, name, displayName, hierarchyLevel, permissions: [], color: 'bg-blue-500', isSystem: true, isActive: true,
});
const ACTIVE = [role('SUPER_ADMIN', 'Super Admin', 6), role('ADMIN', 'Administrator', 5), role('QA_LEAD', 'QA Lead', 3), role('OPERATOR', 'Operator', 1)];
const USERS = { data: [{ id: 'u1', username: 'jdoe', fullName: 'Jane Doe', role: 'ADMIN', status: 'ENABLED' }, { id: 'u2', username: 'bsmith', fullName: 'Bob Smith', role: 'ADMIN', status: 'ENABLED' }] };
const ADMIN_CFG = { permissions: { 'debug.view': true, 'users.view': true }, sidebarItems: ['users', 'dashboard'] };
const QA_CFG = { permissions: {}, sidebarItems: ['checklists'] };

function setup(opts: { extra?: MockRoute[]; swr?: Record<string, unknown> } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/roles', body: ACTIVE },
    { path: '/api/roles/active', body: ACTIVE },
    { path: '/api/users', body: USERS },
    { path: '/api/config/roles/ADMIN', body: ADMIN_CFG },
    { path: '/api/config/roles/QA_LEAD', body: QA_CFG },
    { path: '/api/config/users/u1', body: { sidebarItems: ['dashboard'] } },
    ...commonRoutes(),
  ]);
  renderPage(
    <SWRConfig value={opts.swr ?? { dedupingInterval: swrConfig.dedupingInterval }}>
      <RoleAccessPage />
    </SWRConfig>,
    { route: '/config/roles', user: SUPER_ADMIN, api },
  );
  return api;
}

const box = (label: string) => screen.getByText(label).closest('label')!.querySelector('input') as HTMLInputElement;
const headerSave = () => screen.queryByRole('button', { name: /Save Changes|Saving\.\.\./ });
const statText = (label: string) => screen.getByText(label).parentElement!.textContent!;
const card = (label: string) => screen.getByRole('heading', { level: 4, name: label }).closest('div.relative') as HTMLElement;
const isOn = (el: HTMLElement) => el.className.includes('bg-brand-50');
const countLine = () => screen.getByText(/items enabled for/).parentElement!.textContent!;
const focusWindow = async () => { await act(async () => { window.dispatchEvent(new Event('focus')); }); };

async function openPermissions() {
  await screen.findByText('QA Lead', { selector: 'span' });
  fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
  await screen.findByRole('heading', { name: 'Debug Traces' });
  await waitFor(() => expect(box('View Debug Traces').checked).toBe(true));
}
async function openSidebar() {
  await screen.findByText('QA Lead', { selector: 'span' });
  fireEvent.click(screen.getByRole('button', { name: 'Sidebar' }));
  await screen.findByRole('heading', { name: 'Display Order' });
}

describe('Permissions tab — form state follows the selected role', { timeout: 30000 }, () => {
  it('A -> B -> A inside the production dedupe window shows A\'s boxes and saves A\'s full map', async () => {
    const api = setup({ extra: [{ method: 'PUT', path: '/api/config/roles/ADMIN', body: { success: true } }] });
    await openPermissions();
    fireEvent.click(screen.getByRole('button', { name: 'QA Lead' }));
    await waitFor(() => expect(statText('Selected Role')).toContain('QA Lead'));
    await waitFor(() => expect(box('View Debug Traces').checked).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Administrator' }));
    await waitFor(() => expect(statText('Selected Role')).toContain('Administrator'));
    // Served from cache - the role is NOT refetched inside the dedupe window...
    expect(api.calls('GET', '/api/config/roles/ADMIN')).toHaveLength(1);
    // ...and the form must still show ADMIN's stored permissions.
    expect(box('View Debug Traces').checked).toBe(true);
    expect(box('View Users').checked).toBe(true);

    fireEvent.click(box('Manage Debug Traces'));
    fireEvent.change(screen.getByPlaceholderText("Why are this role's permissions changing?"), { target: { value: 'grant manage' } });
    await act(async () => { fireEvent.click(headerSave()!); });
    await waitFor(() => expect(api.calls('PUT', '/api/config/roles/ADMIN')).toHaveLength(1));
    expect(api.calls('PUT', '/api/config/roles/ADMIN')[0].json).toEqual({
      permissions: { 'debug.view': true, 'users.view': true, 'debug.manage': true },
      reason: 'grant manage',
    });
    // After the save the boxes show the saved map, not the pre-save one.
    await waitFor(() => expect(headerSave()).toBeNull());
    expect(box('Manage Debug Traces').checked).toBe(true);
    expect(box('View Debug Traces').checked).toBe(true);
  });

  it('a role whose config fails to load shows an error, never the previous role\'s boxes', async () => {
    const api = setup({ extra: [{ path: '/api/config/roles/OPERATOR', status: 500, body: { error: 'INTERNAL', message: 'role config unavailable' } }] });
    await openPermissions();
    fireEvent.click(screen.getByRole('button', { name: 'Operator' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/OPERATOR')).toHaveLength(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('role config unavailable');
    expect(statText('Selected Role')).toContain('Operator');
    // No permission tree to edit for a role whose stored map is unknown.
    expect(screen.queryByText('View Debug Traces')).toBeNull();
    expect(headerSave()).toBeNull();
    // Back to a role that loads: its boxes, no error.
    fireEvent.click(screen.getByRole('button', { name: 'Administrator' }));
    await waitFor(() => expect(box('View Debug Traces').checked).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a background revalidation (window focus) keeps unsaved edits and the dirty state', async () => {
    const api = setup({ swr: { dedupingInterval: 0, revalidateOnFocus: true, focusThrottleInterval: 0 } });
    await openPermissions();
    fireEvent.click(box('Manage Debug Traces'));
    expect(headerSave()).not.toBeNull();
    const before = api.calls('GET', '/api/config/roles/ADMIN').length;
    await focusWindow();
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/ADMIN').length).toBeGreaterThan(before));
    // Give the revalidation's response time to land.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(box('Manage Debug Traces').checked).toBe(true);
    expect(headerSave()).not.toBeNull();
    expect(screen.getByPlaceholderText("Why are this role's permissions changing?")).toBeInTheDocument();
  });

  it('switching role tells the page header the tab is clean (no Save button for the new role)', async () => {
    setup();
    await openPermissions();
    fireEvent.click(box('Manage Debug Traces'));
    expect(headerSave()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'QA Lead' }));
    await waitFor(() => expect(statText('Selected Role')).toContain('QA Lead'));
    await waitFor(() => expect(headerSave()).toBeNull());
    expect(screen.queryByPlaceholderText("Why are this role's permissions changing?")).toBeNull();
    // Back on ADMIN the abandoned edit is gone.
    fireEvent.click(screen.getByRole('button', { name: 'Administrator' }));
    await waitFor(() => expect(statText('Selected Role')).toContain('Administrator'));
    expect(box('Manage Debug Traces').checked).toBe(false);
  });
});

describe('Sidebar tab — form state follows the selected role / user', { timeout: 30000 }, () => {
  it('a role whose config fails to load shows the error and lets the operator pick another role', async () => {
    const api = setup({ extra: [{ path: '/api/config/roles/OPERATOR', status: 500, body: { error: 'INTERNAL', message: 'sidebar config unavailable' } }] });
    await openSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Operator' }));
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/OPERATOR')).toHaveLength(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('sidebar config unavailable');
    expect(screen.queryByText('Loading configuration...')).toBeNull();
    expect(headerSave()).toBeNull();
    // Nothing to enable/save onto a role whose stored menu is unknown.
    expect(screen.queryByRole('heading', { level: 4, name: 'Users' })).toBeNull();
    // The role picker is not stuck.
    expect(screen.getByRole('button', { name: 'Administrator' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Administrator' }));
    await waitFor(() => expect(countLine()).toBe(`2 / ${SIDEBAR_ITEMS.length} items enabled for Administrator`));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a background revalidation (window focus) keeps unsaved menu edits', async () => {
    const api = setup({ swr: { dedupingInterval: 0, revalidateOnFocus: true, focusThrottleInterval: 0 } });
    await openSidebar();
    fireEvent.click(card('Checklists'));
    expect(isOn(card('Checklists'))).toBe(true);
    expect(headerSave()).not.toBeNull();
    const before = api.calls('GET', '/api/config/roles/ADMIN').length;
    await focusWindow();
    await waitFor(() => expect(api.calls('GET', '/api/config/roles/ADMIN').length).toBeGreaterThan(before));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(isOn(card('Checklists'))).toBe(true);
    expect(headerSave()).not.toBeNull();
  });

  it('a user whose override fails to load shows the error instead of spinning forever', async () => {
    const api = setup({ extra: [{ path: '/api/config/users/u2', status: 500, body: { error: 'INTERNAL', message: 'user config unavailable' } }] });
    await openSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Configure by User/ }));
    await screen.findByText('Bob Smith');
    fireEvent.click(screen.getByText('Bob Smith'));
    await waitFor(() => expect(api.calls('GET', '/api/config/users/u2')).toHaveLength(1));
    expect(await screen.findByRole('alert')).toHaveTextContent('user config unavailable');
    expect(screen.queryByText('Loading configuration...')).toBeNull();
    expect(headerSave()).toBeNull();
    // Another user still loads.
    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByText(/\/ \d+ items enabled$/).parentElement).toHaveTextContent(/^1 \/ \d+ items enabled$/));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * Review note (2026-10-21): the load-error alerts said "select the role again
 * to retry", but re-selecting the selected role is a no-op (same SWR key / the
 * sidebar handler ignores it). Each alert carries a real Retry.
 */
describe('Load errors offer a working Retry', { timeout: 30000 }, () => {
  const fail = (path: string, message: string): MockRoute => ({ path, status: 500, times: 1, body: { error: 'INTERNAL', message } });

  it('Permissions: Retry reloads the role, whose boxes then show and are editable', async () => {
    setup({ extra: [fail('/api/config/roles/OPERATOR', 'role config unavailable'), { path: '/api/config/roles/OPERATOR', body: { permissions: { 'debug.view': true } } }] });
    await openPermissions();
    fireEvent.click(screen.getByRole('button', { name: 'Operator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('role config unavailable');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(box('View Debug Traces').checked).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(box('Manage Debug Traces'));
    expect(headerSave()).not.toBeNull();
  });

  it('Sidebar by role: Retry reloads the role, whose menu then shows and is editable', async () => {
    setup({ extra: [fail('/api/config/roles/OPERATOR', 'sidebar config unavailable'), { path: '/api/config/roles/OPERATOR', body: { sidebarItems: ['dashboard', 'users'] } }] });
    await openSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Operator' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sidebar config unavailable');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(countLine()).toBe(`2 / ${SIDEBAR_ITEMS.length} items enabled for Operator`));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(card('Checklists'));
    expect(headerSave()).not.toBeNull();
  });

  it('Sidebar by user: Retry reloads the override, which then shows and is editable', async () => {
    setup({ extra: [fail('/api/config/users/u2', 'user config unavailable'), { path: '/api/config/users/u2', body: { sidebarItems: ['dashboard', 'users', 'checklists'] } }] });
    await openSidebar();
    fireEvent.click(screen.getByRole('button', { name: /Configure by User/ }));
    await screen.findByText('Bob Smith');
    fireEvent.click(screen.getByText('Bob Smith'));
    expect(await screen.findByRole('alert')).toHaveTextContent('user config unavailable');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
    await waitFor(() => expect(screen.getByText(/\/ \d+ items enabled$/).parentElement).toHaveTextContent(/^3 \/ \d+ items enabled$/));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getAllByText('Dashboard', { selector: 'span' })[0]);
    expect(headerSave()).not.toBeNull();
  });
});
