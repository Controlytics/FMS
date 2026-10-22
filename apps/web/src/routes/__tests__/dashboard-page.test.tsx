import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { holdRequests } from '@/routes/auth/__tests__/support';
import { DashboardPage } from '../dashboard';

/**
 * Dashboard: real useAuth / useBranding / SWR -> apiClient -> fetch; only fetch
 * is stubbed. Each stat is fetched only when the role can read it.
 */

vi.setConfig({ testTimeout: 20_000 });

const STATS = {
  stageCounts: { WASH_IN: 3, DRY_IN: 1, STORAGE_OUT: 0 },
  statusCounts: { IN_PROGRESS: 2, COMPLETED: 6, TERMINATED: 1 },
  dailyCycles: [{ day: '2026-10-19', count: 2 }, { day: '2026-10-20', count: 0 }, { day: '2026-10-21' }],
  monthlyCycles: [{ month: '2026-09', count: 7 }, { month: '2026-10', count: 5 }],
  totalFilters: 120, activeCycles: 4, completedToday: 2,
  filterSetCounts: { SET_A: 60, SET_B: 50, UNSET: 9, SET_X: 1 },
  filterStatusCounts: { Active: 100, Retired: 20 },
  cleaningReasons: [{ label: 'PM', count: 9 }, { label: 'Breakdown', count: 3 }],
  filterTypeCounts: [{ label: 'HEPA', count: 70 }],
  micronCounts: [{ label: '0.3', count: 70 }],
  deviations30: 2, completed30: 31, avgCycleHours: 5.5,
};

const INSTANCES = [
  { id: 'ahu-1', name: 'AHU-01', status: 'Active' },
  { id: 'f1', name: 'FLT-001', parentId: 'ahu-1', filterSet: 'SET_A', status: 'Active', attributes: { filterType: 'HEPA', micronSize: '0.3' }, lastCleanedAt: '2026-10-10T08:00:00.000Z' },
  { id: 'f2', name: 'FLT-002', parentId: 'gone', filterSet: 'SET_A', status: 'Retired', attributes: {}, lastCleanedAt: null },
  { id: 'f3', name: 'FLT-003', filterSet: null, status: 'Active', attributes: { filterType: 'Pre', micronSize: '10' }, lastCleanedAt: null },
  { id: 'f4', name: 'FLT-004', filterSet: 'SET_B', attributes: { filterType: 'HEPA', micronSize: '0.3' } },
];

const SA: TestUser = { id: 'u-test', fullName: 'Asha Rao', role: 'SUPER_ADMIN', permissions: [] };

function routes(opts: { cards?: Record<string, string[]>; stats?: unknown; branding?: Record<string, unknown>; extra?: MockRoute[] } = {}): MockRoute[] {
  return [
    ...(opts.extra ?? []),
    ...commonConfigRoutes(),
    { path: '/api/config/branding', body: { appName: 'FMS Test', appTagline: 'Clean rooms', companyName: 'Test Pharma Ltd', ...(opts.branding ?? {}) } },
    { path: '/api/config/dashboard-cards/current', body: opts.cards ? { roles: opts.cards } : {} },
    { path: '/api/users/stats', body: { total: 42 } },
    { path: '/api/audit', body: { total: 1234, data: [] } },
    { path: '/api/notifications', body: { total: 7, data: [] } },
    { path: '/api/filters/dashboard-stats', body: opts.stats ?? STATS },
    { path: '/api/assets/instances', body: { data: INSTANCES } },
  ];
}

const tile = (label: string) => screen.getByText(label).closest('a') as HTMLElement;
const section = (heading: string) => screen.getByText(heading, { selector: 'h3' }).parentElement as HTMLElement;

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); vi.unstubAllGlobals(); });

describe('Dashboard — welcome, overview and quick actions', () => {
  it('SUPER_ADMIN sees the welcome banner, three stat tiles with live counts, and all quick actions', async () => {
    const api = mockApi(routes());
    renderPage(<DashboardPage />, { user: SA, api });
    expect(await screen.findByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('SUPER ADMIN')).toBeInTheDocument();
    expect(await screen.findByText('FMS Test — Clean rooms')).toBeInTheDocument();
    expect(screen.getByText('Test Pharma Ltd')).toBeInTheDocument();

    expect(screen.getByText('Quick Overview')).toBeInTheDocument();
    await waitFor(() => expect(tile('Total Users')).toHaveTextContent('42'));
    expect(tile('Total Users')).toHaveAttribute('href', '/users');
    await waitFor(() => expect(tile('Audit Trail')).toHaveTextContent('1234'));
    expect(tile('Audit Trail')).toHaveAttribute('href', '/audit');
    await waitFor(() => expect(tile('Notifications')).toHaveTextContent('7'));

    expect(screen.getByText('Create User').closest('a')).toHaveAttribute('href', '/users/create');
    expect(screen.getByText('View Audit Trail').closest('a')).toHaveAttribute('href', '/audit');
    expect(screen.getByText('System Configuration').closest('a')).toHaveAttribute('href', '/config');
    expect(screen.getByText('21 CFR Part 11 Compliant')).toBeInTheDocument();

    expect(api.calls('GET', '/api/audit')[0].query.get('limit')).toBe('1');
    expect(api.calls('GET', '/api/notifications')[0].query.get('limit')).toBe('1');
    expect(await screen.findByText('Filter Cleaning Analytics')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('a role with none of USER_READ / AUDIT_READ / CYCLE_READ never asks for those stats and gets only the notifications tile', async () => {
    const api = mockApi(routes());
    renderPage(<DashboardPage />, { user: { id: 'u-op', fullName: 'Op One', role: 'OPERATOR', permissions: ['ASSET_READ'] }, api });
    expect(await screen.findByRole('heading', { name: 'Op One' })).toBeInTheDocument();
    await waitFor(() => expect(tile('Notifications')).toHaveTextContent('7'));
    expect(screen.queryByText('Total Users')).toBeNull();
    expect(screen.queryByText('Audit Trail')).toBeNull();
    expect(screen.queryByText('Create User')).toBeNull();
    expect(screen.queryByText('System Configuration')).toBeNull();
    expect(screen.queryByText('Filter Cleaning Analytics')).toBeNull();
    expect(api.calls('GET', '/api/users/stats')).toHaveLength(0);
    expect(api.calls('GET', '/api/audit')).toHaveLength(0);
    expect(api.calls('GET', '/api/filters/dashboard-stats')).toHaveLength(0);
  });

  it('each stat is unlocked by its own permission (AUDIT_READ, CYCLE_READ), and shows "-" until it loads', async () => {
    const api = mockApi(routes());
    const hold = holdRequests(/\/api\/audit/);
    renderPage(<DashboardPage />, { user: { role: 'QA', fullName: 'Q A', permissions: ['AUDIT_READ', 'CYCLE_READ'] }, api });
    expect(await screen.findByText('Audit Trail')).toBeInTheDocument();
    expect(tile('Audit Trail')).toHaveTextContent('-');
    hold.release();
    await waitFor(() => expect(tile('Audit Trail')).toHaveTextContent('1234'));
    expect(await screen.findByText('Filter Cleaning Analytics')).toBeInTheDocument();
    expect(screen.queryByText('Total Users')).toBeNull();
    expect(api.calls('GET', '/api/users/stats')).toHaveLength(0);
  });

  it('the dashboard-cards config limits what a role sees; with no tile enabled the Quick Overview heading is gone', async () => {
    const api = mockApi(routes({ cards: { SUPER_ADMIN: ['filter_analytics', 'total_filters'] }, branding: { appTagline: '' } }));
    renderPage(<DashboardPage />, { user: SA, api });
    expect(await screen.findByText('Filter Cleaning Analytics')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Quick Overview')).toBeNull());
    expect(screen.queryByText('Quick Actions')).toBeNull();
    expect(screen.getByText('Total Filters')).toBeInTheDocument();
    expect(screen.queryByText('Active Cycles')).toBeNull();
    expect(screen.queryByText('Completed Today')).toBeNull();
    expect(screen.queryByText('Filters by Current Stage')).toBeNull();
    expect(screen.queryByText('Cycle Status Breakdown')).toBeNull();
    expect(screen.queryByText(/Daily Cycles/)).toBeNull();
    expect(screen.queryByText(/Monthly Cycles/)).toBeNull();
    // empty tagline -> app name alone, no dangling dash
    expect(await screen.findByText('FMS Test')).toBeInTheDocument();
  });

  it('a role absent from the cards config falls back to every card', async () => {
    const api = mockApi(routes({ cards: { QA: ['notifications'] } }));
    renderPage(<DashboardPage />, { user: SA, api });
    expect(await screen.findByText('Quick Actions')).toBeInTheDocument();
    expect(screen.getByText('Quick Overview')).toBeInTheDocument();
    expect(await screen.findByText('Active Cycles')).toBeInTheDocument();
  });
});

describe('Dashboard — filter cleaning analytics', () => {
  it('summarises counts, stages, statuses, daily + monthly totals and breakdowns', async () => {
    const api = mockApi(routes());
    renderPage(<DashboardPage />, { user: SA, api });
    await screen.findByText('Filter Cleaning Analytics');
    const num = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement;
    expect(num('Total Filters')).toHaveTextContent('120');
    expect(num('Active Cycles')).toHaveTextContent('4');
    expect(num('Completed Today')).toHaveTextContent('2');
    expect(num('Total Cycles')).toHaveTextContent('9');
    expect(num('Completed (30d)')).toHaveTextContent('31');
    expect(num('Avg Cycle')).toHaveTextContent('5.5h');
    expect(num('Deviations (30d)')).toHaveTextContent('2');
    expect(num('Deviations (30d)').className).toContain('text-rose-600');
    expect(screen.getByRole('link', { name: /Go to Operations/ })).toHaveAttribute('href', '/filters');

    const stages = section('Filters by Current Stage');
    expect(within(stages).getByText('Wash In').parentElement).toHaveTextContent('3');
    expect(within(stages).getByText('Storage Out').parentElement).toHaveTextContent('0');

    const status = section('Cycle Status Breakdown');
    expect(within(status).getByText('total').previousElementSibling).toHaveTextContent('9');
    expect(within(status).getByText('Completed').nextElementSibling).toHaveTextContent('6');
    expect(status.querySelectorAll('circle')).toHaveLength(3);

    expect(screen.getByText(/Daily Cycles/)).toHaveTextContent('· 2 total');
    expect(screen.getByText(/Monthly Cycles/)).toHaveTextContent('· 12 total');
    // bars carry label + value in their tooltip; a zero bar shows no number
    const daily = screen.getByText(/Daily Cycles/, { selector: 'h3' }).parentElement as HTMLElement;
    expect(daily.querySelector('[title="19/10: 2"]')).not.toBeNull();
    expect(daily.querySelector('[title="20/10: 0"]')).not.toBeNull();
    // a day with no count is drawn as 0
    expect(daily.querySelector('[title="21/10: 0"]')).not.toBeNull();
    const monthly = screen.getByText(/Monthly Cycles/, { selector: 'h3' }).parentElement as HTMLElement;
    expect(monthly.querySelectorAll('[title]')).toHaveLength(2);
    expect(monthly.querySelector('[title$=": 7"]')).not.toBeNull();

    const sets = section('Filters by Set');
    expect(within(sets).getByText('Set A').parentElement).toHaveTextContent('60');
    expect(within(sets).getByText('Unset')).toBeInTheDocument();
    expect(within(sets).getByText('SET_X')).toBeInTheDocument(); // unknown key shown raw
    expect(within(sets).getByText('· click a row to view')).toBeInTheDocument();
    const reasons = section('Top Cleaning Reasons');
    expect(within(reasons).getByText('PM').parentElement).toHaveTextContent('9');
    expect(within(reasons).queryByText('· click a row to view')).toBeNull();
  });

  it('shows empty states for every widget when the stats are empty, and no deviation colour at zero', async () => {
    const api = mockApi(routes({ stats: {} }));
    renderPage(<DashboardPage />, { user: SA, api });
    await screen.findByText('Filter Cleaning Analytics');
    expect(screen.getByText('No filters in cleaning stages')).toBeInTheDocument();
    // cycle status breakdown + top cleaning reasons
    expect(screen.getAllByText('No cycles yet')).toHaveLength(2);
    expect(screen.getAllByText('No data')).toHaveLength(2);
    expect(screen.getAllByText('No filters')).toHaveLength(2);
    expect(screen.getByText('No filter-type data')).toBeInTheDocument();
    expect(screen.getByText('No micron data')).toBeInTheDocument();
    expect((screen.getByText('Deviations (30d)').nextElementSibling as HTMLElement).className).toContain('text-slate-800');
  });
});

describe('Dashboard — drill-down into the filters behind a breakdown row', () => {
  async function drill(sectionTitle: string, row: string) {
    await screen.findByText('Filter Cleaning Analytics');
    fireEvent.click(within(section(sectionTitle)).getByText(row));
    return screen.findByRole('heading', { name: `Filters · ${row}` });
  }

  it('Set A lists its filters with AHU name, set, type, micron, status and last-cleaned', async () => {
    const api = mockApi(routes());
    renderPage(<DashboardPage />, { user: SA, api });
    await drill('Filters by Set', 'Set A');
    expect(await screen.findByText('2 filters')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('FLT-001')).toBeInTheDocument();
    expect(within(rows[0]).getByText('AHU-01')).toBeInTheDocument();
    expect(within(rows[0]).getAllByText('Set A')).toHaveLength(1);
    expect(within(rows[0]).getByText('HEPA')).toBeInTheDocument();
    expect(within(rows[0]).getByText('10/10/2026')).toBeInTheDocument();
    // unknown parent / missing attributes / never cleaned -> em dashes
    expect(within(rows[1]).getAllByText('—')).toHaveLength(4);
    expect(api.calls('GET', '/api/assets/instances')).toHaveLength(1);
  });

  it('Unset, Status, Type and Micron each filter on their own dimension', async () => {
    const api = mockApi(routes());
    renderPage(<DashboardPage />, { user: SA, api });

    await drill('Filters by Set', 'Unset');
    // AHU-01 has no filterSet either; Unset = everything without a set
    expect(await screen.findByText('FLT-003')).toBeInTheDocument();
    expect(screen.queryByText('FLT-001')).toBeNull();
    fireEvent.click(screen.getByRole('heading', { name: 'Filters · Unset' }).parentElement!.nextElementSibling as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Filters · Unset' })).toBeNull());

    await drill('Filters by Status', 'Retired');
    expect(await screen.findByText('1 filter')).toBeInTheDocument();
    expect(screen.getByText('FLT-002')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('heading', { name: 'Filters · Retired' }).parentElement!.nextElementSibling as HTMLElement);

    await drill('Filters by Type', 'HEPA');
    expect(await screen.findByText('2 filters')).toBeInTheDocument();
    expect(screen.getByText('FLT-004')).toBeInTheDocument();
    expect(screen.getAllByText('Set B').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('heading', { name: 'Filters · HEPA' }).parentElement!.nextElementSibling as HTMLElement);

    await drill('Filters by Micron Size', '0.3');
    expect(await screen.findByText('2 filters')).toBeInTheDocument();
  });

  it('shows Loading… while the filter list is fetched, "No filters match." when nothing matches, and closes on the backdrop but not on the panel', async () => {
    const api = mockApi(routes());
    const hold = holdRequests(/\/api\/assets\/instances/);
    renderPage(<DashboardPage />, { user: SA, api });
    const heading = await drill('Filters by Set', 'SET_X');
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    hold.release();
    expect(await screen.findByText('No filters match.')).toBeInTheDocument();
    expect(screen.getByText('0 filters')).toBeInTheDocument();

    const panel = heading.closest('.bg-white') as HTMLElement;
    fireEvent.click(panel);
    expect(screen.getByRole('heading', { name: 'Filters · SET_X' })).toBeInTheDocument();
    fireEvent.click(panel.parentElement as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Filters · SET_X' })).toBeNull());
  });
});

describe('Dashboard — accessibility + console', () => {
  it('flags only the drill-down close "x" (svg-only) and logs nothing', async () => {
    const api = mockApi(routes());
    renderPage(<DashboardPage />, { user: SA, api });
    await screen.findByText('Filter Cleaning Analytics');
    fireEvent.click(within(section('Filters by Set')).getByText('Set A'));
    await screen.findByText('2 filters');
    const unl = unlabeledControls();
    // Finding: the drill-down close button is an svg with no name (dashboard.tsx:312).
    expect(unl.none.filter((d) => !d.includes('text-white/80 hover:text-white'))).toEqual([]);
    expect(unl.placeholderOnly).toEqual([]);
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
