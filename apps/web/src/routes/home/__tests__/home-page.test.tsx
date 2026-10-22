import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import HomePage from '../index';
import type { RoleAccess } from '../viewer-access';

/**
 * Module Guide (/home). Real SWR -> apiClient -> fetch with the real useAuth;
 * the live role matrix, the viewer's sidebar config and the QNN flag come from
 * the stubbed API, so the tests assert what a given viewer is shown.
 */

const MATRIX: RoleAccess[] = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin', hierarchyLevel: 6, color: 'bg-red-500', permissions: [], sidebarItems: [] },
  { name: 'OPERATOR', displayName: 'Operator', hierarchyLevel: 2, color: 'bg-emerald-500', permissions: ['FILTER_OPERATE', 'ASSET_READ'], sidebarItems: [] },
  { name: 'PM_LEAD', displayName: 'PM Lead', hierarchyLevel: 3, color: '#6366f1', permissions: ['PM_APPROVE', 'PM_READ'], sidebarItems: [] },
];

// Page flows run several real round trips; under a loaded machine (other
// agents run vitest in parallel) a few take longer than the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

function routes(opts: { sidebarItems?: string[]; qnn?: boolean; profiles?: unknown; matrix?: RoleAccess[] } = {}): MockRoute[] {
  return [
    ...commonConfigRoutes(),
    { path: '/api/roles/access-matrix', body: { roles: opts.matrix ?? MATRIX } },
    { path: '/api/config/my-config', body: { sidebarItems: opts.sidebarItems ?? [] } },
    { path: '/api/pm-schedules/qnn/visible', body: { visible: opts.qnn ?? false } },
    { path: '/api/filter-cleaning-profiles', body: opts.profiles ?? [] },
  ];
}

const OPERATOR = { role: 'OPERATOR', permissions: ['FILTER_OPERATE', 'ASSET_READ'] };
const heading = (name: string) => screen.queryByRole('heading', { level: 3, name });

describe('Module Guide — viewer modules', () => {
  it('shows "Loading roles…" until the matrix arrives, then the live role legend (class and raw-hex colours)', async () => {
    const api = mockApi(routes());
    renderPage(<HomePage />, { user: OPERATOR, api });
    expect(screen.getByText('Loading roles…')).toBeInTheDocument();
    const legend = (await screen.findByRole('heading', { name: 'Roles' })).parentElement!;
    const pm = within(legend).getByText('PM Lead');
    // custom role: raw colour goes on the style, not the class list
    expect(pm).toHaveStyle({ backgroundColor: '#6366f1' });
    expect(within(legend).getByText('Operator')).toHaveClass('bg-emerald-500');
    expect(within(legend).getByText('Operator').getAttribute('style')).toBeNull();
    expect(screen.queryByText('Loading roles…')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('an operator sees only the modules their sidebar would show; the audit toggle shows every module', async () => {
    const api = mockApi(routes());
    renderPage(<HomePage />, { user: OPERATOR, api });
    expect(await screen.findByRole('heading', { level: 3, name: 'Filter Operations' })).toBeInTheDocument();
    expect(heading('Users')).toBeNull();
    expect(heading('Audit Trail')).toBeNull();
    // the operator does not hold FCP_READ, so the profile count is never asked for
    expect(api.calls('GET', '/api/filter-cleaning-profiles')).toHaveLength(0);
    // table of contents links to the section anchors
    expect(screen.getByRole('link', { name: 'Filter Operations' })).toHaveAttribute('href', '#mod-filter-operations');
    expect(document.getElementById('mod-filter-operations')).not.toBeNull();

    const mine = screen.getByRole('button', { name: 'My modules' });
    const all = screen.getByRole('button', { name: 'All modules (audit)' });
    expect(mine).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/You see the modules your role can access/)).toBeInTheDocument();

    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(mine).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Audit view — every module and every role permitted/)).toBeInTheDocument();
    expect(heading('Users')).toBeInTheDocument();
    expect(heading('Audit Trail')).toBeInTheDocument();
    expect(heading('Quality Notifications')).toBeInTheDocument();

    fireEvent.click(mine);
    expect(heading('Users')).toBeNull();
  });

  it('the viewer\'s own sidebar override narrows the guide to the pinned items', async () => {
    const api = mockApi(routes({ sidebarItems: ['system-health'] }));
    renderPage(<HomePage />, { user: OPERATOR, api });
    expect(await screen.findByRole('heading', { level: 3, name: 'System Health' })).toBeInTheDocument();
    expect(heading('Filter Operations')).toBeNull();
  });

  it('a viewer with no permissions is told no modules are assigned', async () => {
    const api = mockApi(routes());
    renderPage(<HomePage />, { user: { role: 'GUEST', permissions: [] }, api });
    expect(await screen.findByText('No modules are assigned to your role yet.')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('Quality Notifications appears only when the QNN flag is on for the viewer', async () => {
    const perms = { role: 'QA', permissions: ['FILTER_OPERATE', 'ASSET_READ', 'QNN_VIEW', 'PM_READ', 'REPORT_EXPORT', 'FILTER_LIST_EXPORT'] };
    const off = mockApi(routes({ qnn: false }));
    const first = renderPage(<HomePage />, { user: perms, api: off });
    await screen.findByRole('heading', { level: 3, name: 'Filter Operations' });
    expect(heading('Quality Notifications')).toBeNull();
    first.unmount();
    sessionStorage.clear(); localStorage.clear();

    const on = mockApi(routes({ qnn: true, sidebarItems: ['quality-notifications'] }));
    renderPage(<HomePage />, { user: perms, api: on });
    expect(await screen.findByRole('heading', { level: 3, name: 'Quality Notifications' })).toBeInTheDocument();
  });
});

describe('Module Guide — active cleaning profile count (FCP_READ / Super Admin)', () => {
  it('counts ACTIVE profiles from a bare array (plural)', async () => {
    const api = mockApi(routes({ profiles: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'DRAFT' }, null] }));
    renderPage(<HomePage />, { user: { role: 'SUPER_ADMIN', permissions: [] }, api });
    expect(await screen.findByText('2 active cleaning profiles are configured.')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filter-cleaning-profiles')[0].query.get('limit')).toBe('1000000');
  });

  it('counts ACTIVE profiles from a { data } envelope (singular)', async () => {
    const api = mockApi(routes({ profiles: { data: [{ status: 'ACTIVE' }, { status: 'ARCHIVED' }] } }));
    renderPage(<HomePage />, { user: { role: 'SUPERVISOR', permissions: ['FCP_READ', 'FILTER_OPERATE'] }, api });
    expect(await screen.findByText('1 active cleaning profile is configured.')).toBeInTheDocument();
  });

  it('an unrecognised payload or no ACTIVE profile adds no count sentence', async () => {
    const api = mockApi(routes({ profiles: { total: 4 } }));
    renderPage(<HomePage />, { user: { role: 'SUPER_ADMIN', permissions: [] }, api });
    const note = await screen.findByText(/The stages below are the full teaching flow/);
    await waitFor(() => expect(api.calls('GET', '/api/filter-cleaning-profiles').length).toBeGreaterThan(0));
    expect(note.textContent).not.toMatch(/active cleaning profile/);
  });
});

describe('Module Guide — refresh', () => {
  it('Refresh re-reads the matrix, the sidebar config and the QNN flag, showing "Refreshing…" meanwhile', async () => {
    const api = mockApi(routes());
    renderPage(<HomePage />, { user: OPERATOR, api });
    await screen.findByRole('heading', { level: 3, name: 'Filter Operations' });
    const counts = () => ['/api/roles/access-matrix', '/api/config/my-config', '/api/pm-schedules/qnn/visible'].map((p) => api.calls('GET', p).length);
    const before = counts();
    const btn = screen.getByRole('button', { name: 'Refresh' });
    expect(btn).toHaveAttribute('title', 'Reload roles from the latest configuration');
    fireEvent.click(btn);
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    const after = counts();
    after.forEach((n, i) => expect(n).toBeGreaterThan(before[i]));
  });

  it('a failed refresh still re-enables the button', async () => {
    const api = mockApi(routes());
    renderPage(<HomePage />, { user: OPERATOR, api });
    await screen.findByRole('heading', { level: 3, name: 'Filter Operations' });
    api.add({ path: '/api/roles/access-matrix', status: 500, body: { error: 'INTERNAL', message: 'matrix down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    // the previous matrix stays on screen
    expect(screen.getByRole('heading', { level: 3, name: 'Filter Operations' })).toBeInTheDocument();
  });
});

describe('Module Guide — accessibility + console', () => {
  it('has no unnamed controls and logs nothing in normal use', async () => {
    const api = mockApi(routes());
    renderPage(<HomePage />, { user: OPERATOR, api });
    await screen.findByRole('heading', { level: 3, name: 'Filter Operations' });
    expectAllControlsNamed();
    const unl = unlabeledControls();
    expect(unl.none).toEqual([]);
    expect(unl.placeholderOnly).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
