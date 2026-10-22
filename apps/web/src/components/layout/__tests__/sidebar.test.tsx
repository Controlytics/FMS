/**
 * <Sidebar> — which menu entries a user sees, in what order, the collapsible
 * Reports group, the active-page marker, and the mobile drawer.
 *
 * Real useAuth / useBranding / SWR; only fetch is stubbed (page harness).
 * The per-item permission rule itself (isSidebarItemVisible) has its own parity
 * suite (sidebar-visibility.test.ts); this file covers what sidebar.tsx adds on
 * top: the SUPER_ADMIN bypass, the QNN server flag, the ADMIN-only System Health
 * entry, the per-role `sidebarItems` allow-list + order, and the Reports group.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { Sidebar } from '../sidebar';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';

const ALL_TOP_LEVEL = ['Home', 'Dashboard', 'Users', 'Admin Requests', 'Configuration', 'Notifications', 'Audit Trail',
  'Report Reviews', 'Stage Approvals', 'System Health', 'Debug Traces', 'Filters', 'Retirement List', 'Replacement List',
  'Reports', 'Filter Operations', 'Checklists', 'Cleaning Profiles', 'Equipment Groups', 'PM Schedules', 'My Tasks',
  'Approvals', 'Version History'];
const REPORT_CHILDREN = ['RFID Track Record', 'Filter Cleaning Record', 'Filter Lifecycle Report', 'Deviations', 'Quality Notifications'];

interface Opts { route?: string; user: TestUser; config?: unknown; qnnVisible?: boolean; open?: boolean; branding?: Record<string, unknown> }

function renderSidebar(o: Opts) {
  const onClose = vi.fn();
  const routes: MockRoute[] = [
    { path: '/api/config/my-config', body: o.config ?? {} },
    { path: '/api/pm-schedules/qnn/visible', body: { visible: o.qnnVisible ?? false } },
    { path: '/api/config/branding', body: o.branding ?? { appName: 'Acme FMS', companyName: 'Acme Pharma Ltd' } },
  ];
  const api = mockApi(routes);
  const view = renderPage(<Sidebar userRole={o.user.role} open={o.open ?? false} onClose={onClose} />, { route: o.route ?? '/', user: o.user, api });
  return { ...view, onClose, api };
}

const nav = () => screen.getByRole('navigation', { name: 'Main' });
const navLabels = () => within(nav()).getAllByRole('link').map((l) => l.textContent)
  .concat([]).filter(Boolean);
/** Top-level entries in display order: links + the Reports group button. */
const topLevel = () => Array.from(nav().children).map((el) =>
  (el.tagName === 'A' ? el.textContent : el.querySelector('button')?.textContent) ?? '');
/** Wait until /api/auth/me AND the sidebar config have arrived, so the menu is final. */
async function settled(api: ReturnType<typeof mockApi>) {
  await waitFor(() => {
    expect(api.calls('GET', '/api/auth/me')).toHaveLength(1);
    expect(api.calls('GET', '/api/config/my-config')).toHaveLength(1);
    expect(api.calls('GET', '/api/pm-schedules/qnn/visible')).toHaveLength(1);
  });
  await screen.findByText('Acme FMS', { selector: 'span' });
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn'); error = vi.spyOn(console, 'error'); });
afterEach(() => {
  expect(warn).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Sidebar — who sees what', () => {
  it('SUPER_ADMIN sees every entry, in the default order, with the Reports children folded away', async () => {
    const { api } = renderSidebar({ user: { role: 'SUPER_ADMIN', permissions: [] } });
    await settled(api);
    await waitFor(() => expect(topLevel()).toEqual(ALL_TOP_LEVEL));
    for (const child of REPORT_CHILDREN) expect(within(nav()).queryByRole('link', { name: child })).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('a role sees only the entries its permissions unlock (plus the ungated ones)', async () => {
    const { api } = renderSidebar({ user: { role: 'QA', permissions: ['AUDIT_READ', 'PM_READ'] } });
    await settled(api);
    await waitFor(() => expect(topLevel()).toEqual(['Home', 'Dashboard', 'Audit Trail', 'Report Reviews', 'PM Schedules', 'My Tasks', 'Reports']));
  });

  it('a user with no permissions at all sees an empty menu', async () => {
    const { api } = renderSidebar({ user: { role: 'OPERATOR', permissions: [] } });
    await settled(api);
    expect(within(nav()).queryAllByRole('link')).toHaveLength(0);
    expect(within(nav()).queryByRole('button')).toBeNull();
  });

  it('System Health is offered to ADMIN only (OQ-17)', async () => {
    const a = renderSidebar({ user: { role: 'ADMIN', permissions: ['USER_READ'] } });
    await settled(a.api);
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'System Health' })).toBeInTheDocument());
    a.unmount();

    const q = renderSidebar({ user: { role: 'QA', permissions: ['USER_READ'] } });
    await settled(q.api);
    expect(within(nav()).queryByRole('link', { name: 'System Health' })).toBeNull();
    expect(within(nav()).getByRole('link', { name: 'Users' })).toBeInTheDocument();
  });

  it('Quality Notifications follows the server visibility flag, not permissions', async () => {
    const hidden = renderSidebar({ route: '/quality-notifications', user: { role: 'QA', permissions: ['PM_READ'] }, qnnVisible: false });
    await settled(hidden.api);
    expect(within(nav()).queryByRole('link', { name: 'Quality Notifications' })).toBeNull();
    hidden.unmount();

    const shown = renderSidebar({ route: '/quality-notifications', user: { role: 'QA', permissions: ['PM_READ'] }, qnnVisible: true });
    await settled(shown.api);
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Quality Notifications' })).toHaveAttribute('aria-current', 'page'));
  });

  it('a per-role sidebarItems list both restricts and ORDERS the menu', async () => {
    const { api } = renderSidebar({
      user: { role: 'QA', permissions: ['AUDIT_READ', 'PM_READ', 'USER_READ'] },
      config: { sidebarItems: ['my-tasks', 'audit', 'deviations', 'home', 'cleaning-cycles'] },
    });
    await settled(api);
    // Users is permitted but not in the list -> hidden; Reports sits where its first child is.
    await waitFor(() => expect(topLevel()).toEqual(['My Tasks', 'Audit Trail', 'Reports', 'Home']));
    fireEvent.click(within(nav()).getByRole('button', { name: 'Reports' }));
    expect(within(nav()).getAllByRole('link').map((l) => l.textContent)).toEqual(['My Tasks', 'Audit Trail', 'Deviations', 'Home']);
  });

  it('the allow-list can never show an item the permissions deny', async () => {
    const { api } = renderSidebar({ user: { role: 'QA', permissions: ['AUDIT_READ'] }, config: { sidebarItems: ['users', 'audit'] } });
    await settled(api);
    await waitFor(() => expect(topLevel()).toEqual(['Audit Trail']));
  });

  it('an empty or malformed sidebarItems value means "no restriction"', async () => {
    for (const config of [{ sidebarItems: [] }, { sidebarItems: 'audit' }]) {
      const v = renderSidebar({ user: { role: 'QA', permissions: ['AUDIT_READ'] }, config });
      await settled(v.api);
      await waitFor(() => expect(topLevel()).toEqual(['Home', 'Dashboard', 'Audit Trail', 'Report Reviews']));
      v.unmount();
    }
  });

  it('SUPER_ADMIN ignores the allow-list for visibility but still follows its order', async () => {
    const { api } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, config: { sidebarItems: ['version-history', 'users'] } });
    await settled(api);
    await waitFor(() => expect(topLevel().slice(0, 3)).toEqual(['Version History', 'Users', 'Home']));
    expect(topLevel()).toHaveLength(ALL_TOP_LEVEL.length);
  });
});

describe('Sidebar — Reports group', () => {
  it('toggles open and closed, reporting aria-expanded', async () => {
    const { api } = renderSidebar({ user: { role: 'SUPER_ADMIN' } });
    await settled(api);
    const btn = await within(nav()).findByRole('button', { name: 'Reports' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    // RFID first, Quality Notifications last — the group's own display order
    const links = within(nav()).getAllByRole('link').map((l) => l.textContent);
    const start = links.indexOf('RFID Track Record');
    expect(links.slice(start, start + 5)).toEqual(REPORT_CHILDREN);
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByRole('link', { name: 'Deviations' })).toBeNull();
  });

  it('opens by itself on a report page and marks that page current', async () => {
    const { api } = renderSidebar({ route: '/filter-lifecycle-report', user: { role: 'QA', permissions: ['CYCLE_READ'] } });
    await settled(api);
    const link = await within(nav()).findByRole('link', { name: 'Filter Lifecycle Report' });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(within(nav()).getByRole('button', { name: 'Reports' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(nav()).getByRole('link', { name: 'Filter Cleaning Record' })).not.toHaveAttribute('aria-current');
  });

  it('is hidden entirely when none of its reports is visible', async () => {
    const { api } = renderSidebar({ user: { role: 'QA', permissions: ['AUDIT_READ'] } });
    await settled(api);
    expect(within(nav()).queryByRole('button', { name: 'Reports' })).toBeNull();
  });
});

describe('Sidebar — active page and drawer', () => {
  it('Dashboard is current only on "/" exactly; other entries match by prefix', async () => {
    const root = renderSidebar({ route: '/', user: { role: 'SUPER_ADMIN' } });
    await settled(root.api);
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page'));
    expect(within(nav()).getByRole('link', { name: 'Audit Trail' })).not.toHaveAttribute('aria-current');
    root.unmount();

    const deep = renderSidebar({ route: '/audit/abc-123', user: { role: 'SUPER_ADMIN' } });
    await settled(deep.api);
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Audit Trail' })).toHaveAttribute('aria-current', 'page'));
    expect(within(nav()).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
  });

  it('links point at their routes', async () => {
    const { api } = renderSidebar({ user: { role: 'SUPER_ADMIN' } });
    await settled(api);
    await waitFor(() => expect(within(nav()).getByRole('link', { name: 'Filter Operations' })).toHaveAttribute('href', '/filters'));
    expect(within(nav()).getByRole('link', { name: 'Equipment Groups' })).toHaveAttribute('href', '/config/equipment-groups');
    expect(within(nav()).getByRole('link', { name: 'Debug Traces' })).toHaveAttribute('href', '/debug/traces');
  });

  it('choosing an entry (flat or inside Reports) closes the mobile drawer', async () => {
    const { api, onClose } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, open: true });
    await settled(api);
    fireEvent.click(await within(nav()).findByRole('link', { name: 'Users' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Reports' }));
    fireEvent.click(within(nav()).getByRole('link', { name: 'Deviations' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('when open, a backdrop covers the page and tapping it closes the drawer', async () => {
    const { api, onClose, container } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, open: true });
    await settled(api);
    const aside = container.querySelector('aside')!;
    expect(aside.className).toContain('translate-x-0');
    const backdrop = aside.previousElementSibling as HTMLElement;
    expect(backdrop.className).toContain('bg-black/30');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('when closed, there is no backdrop and the drawer is translated off-screen', async () => {
    const { api, container } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, open: false });
    await settled(api);
    const aside = container.querySelector('aside')!;
    expect(aside.previousElementSibling).toBeNull();
    expect(aside.className).toContain('-translate-x-full');
  });

  // A-L2: the open drawer must be dismissable from the keyboard, not only by tapping
  // the backdrop. The drawer carries the id the header's toggle points at (aria-controls).
  it('Escape closes the open drawer; other keys and a closed drawer are ignored', async () => {
    const { api, onClose, container } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, open: true });
    await settled(api);
    expect(container.querySelector('aside')).toHaveAttribute('id', 'app-sidebar');
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a closed drawer does not react to Escape', async () => {
    const { api, onClose } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, open: false });
    await settled(api);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('every control in the open drawer has an accessible name', async () => {
    const { api, container } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, open: true });
    await settled(api);
    fireEvent.click(within(nav()).getByRole('button', { name: 'Reports' }));
    expectAllControlsNamed(container);
  });

  it('shows the configured logo, app name and company', async () => {
    const { api } = renderSidebar({ user: { role: 'SUPER_ADMIN' }, branding: { appName: 'Acme FMS', companyName: 'Acme Pharma Ltd', logoUrl: '/uploads/logo.png' } });
    await settled(api);
    expect(screen.getByRole('img', { name: 'Acme FMS' })).toHaveAttribute('src', '/uploads/logo.png');
    expect(screen.getByText('Acme Pharma Ltd')).toBeInTheDocument();
    expect(screen.getByText('21 CFR Part 11 compliant')).toBeInTheDocument();
    expect(navLabels().length).toBeGreaterThan(0);
  });
});
