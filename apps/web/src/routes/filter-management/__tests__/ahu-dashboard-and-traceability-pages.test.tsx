import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA } from './fm-test-kit';
import { AhuDashboardPage } from '../ahu-dashboard';
import { FilterTraceabilityPage } from '../filter-traceability';

usePageTestLifecycle();

describe('AHU dashboard', () => {
  const FILTERS = [
    { id: 'f1', name: 'FLT-A1', filterSet: 'SET_A', currentLifecycleState: 'WASH_IN' },
    { id: 'f2', name: 'FLT-A2', filterSet: 'SET_A', currentLifecycleState: null },
    { id: 'f3', name: 'FLT-B1', filterSet: 'SET_B', currentLifecycleState: null },
    { id: 'f4', name: 'FLT-U1', filterSet: null, currentLifecycleState: 'STORAGE_IN' },
    { id: 'f5', name: 'FLT-U2', filterSet: null },
    { id: 'f6', name: 'FLT-RETIRED', filterSet: 'SET_A', status: 'Retired' },
    { id: 'f7', name: 'FLT-INACTIVE', filterSet: 'SET_B', isActive: false },
  ];
  const setup = (extra: MockRoute[] = []) => mockApi([
    ...extra,
    { path: '/api/hierarchy/ahus/a1', body: { id: 'a1', name: 'AHU-01' } },
    { path: '/api/hierarchy/filters', body: { data: FILTERS, total: FILTERS.length } },
    { path: '/api/filters/events', body: { data: [
      { id: 'e1', eventType: 'STATE_TRANSITION', toState: 'WASH_IN', performedAt: '2026-10-01T09:00:00Z' },
      { id: 'e2', eventType: 'BYPASS_DEVIATION', toState: null, performedAt: '2026-10-01T10:00:00Z' },
    ] } },
    ...baseRoutes(),
  ]);
  const card = (label: string) => screen.getByRole('heading', { name: label }).closest('.rounded-xl') as HTMLElement;

  it('splits active filters into Set A / Set B / unassigned, hides retired and inactive ones', async () => {
    const api = setup();
    renderPage(<AhuDashboardPage />, { user: SA, route: '/ahus/a1', path: '/ahus/:id', api });
    expect(await screen.findByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
    await screen.findByText('FLT-A1');
    expect(screen.getByText('5 filter(s)')).toBeInTheDocument();
    const a = card('Set A');
    expect(a).toHaveTextContent('In Use');
    expect(a).toHaveTextContent('WASH IN');
    expect(a).toHaveTextContent('No state');
    expect(a).toHaveTextContent('2 filter(s)');
    expect(a).not.toHaveTextContent('FLT-RETIRED');
    const b = card('Set B');
    expect(b).toHaveTextContent('Spare');
    expect(b).toHaveTextContent('1 filter(s)');
    expect(b).not.toHaveTextContent('FLT-INACTIVE');
    const u = card('Unassigned Filters');
    expect(u).toHaveTextContent('FLT-U1');
    expect(u).toHaveTextContent('STORAGE IN');
    expect(u).toHaveTextContent('FLT-U2');
    expect(screen.getByRole('button', { name: 'Swap Sets' })).toBeDisabled();
    expect(screen.getByText('STATE TRANSITION')).toBeInTheDocument();
    expect(screen.getByText('BYPASS DEVIATION')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/events')[0].query.get('ahuId')).toBe('a1');
    expect(api.calls('GET', '/api/hierarchy/filters')[0].query.get('ahuId')).toBe('a1');
    expect(screen.queryByText(/contact admin/)).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('empty AHU: placeholder title until loaded, no filters assigned, no recent events', async () => {
    const api = setup([
      { path: '/api/hierarchy/ahus/a1', body: {} },
      { path: '/api/hierarchy/filters', body: { data: [], total: 0 } },
      { path: '/api/filters/events', body: { data: [] } },
    ]);
    renderPage(<AhuDashboardPage />, { user: SA, route: '/ahus/a1', path: '/ahus/:id', api });
    expect(screen.getByRole('heading', { name: 'AHU Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('No filters assigned')).toHaveLength(2));
    expect(await screen.findByText('No recent events')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unassigned Filters' })).toBeNull();
  });

  it('warns when the AHU has more filters than were returned', async () => {
    const api = setup([{ path: '/api/hierarchy/filters', body: { data: FILTERS.slice(0, 2), total: 1500 } }]);
    renderPage(<AhuDashboardPage />, { user: SA, route: '/ahus/a1', path: '/ahus/:id', api });
    expect(await screen.findByText('Showing first 2 of 1500 — contact admin')).toBeInTheDocument();
  });

  it('with no id in the route nothing is requested', async () => {
    const api = setup();
    renderPage(<AhuDashboardPage />, { user: SA, route: '/ahus', path: '/ahus', api });
    expect(screen.getByRole('heading', { name: 'AHU Dashboard' })).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/config/datetime/current').length).toBeGreaterThan(0));
    expect(api.calls('GET', '/api/hierarchy/filters')).toHaveLength(0);
    expect(api.calls('GET', '/api/filters/events')).toHaveLength(0);
  });
});

describe('Filter traceability', () => {
  const EVENTS = [
    { id: 'e1', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: '2026-10-01T09:00:00Z', remarks: 'Rinsed twice', checksum: 'abcdef0123456789abcdef' },
    { id: 'e2', eventType: 'STATE_TRANSITION', fromState: null, toState: 'DRY_IN', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 90 }, performedAt: '2026-10-01T10:00:00Z', checksum: '1111222233334444ffff' },
    { id: 'e3', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: '2026-10-01T08:00:00Z', checksum: null },
    { id: 'e4', eventType: 'BYPASS_DEVIATION', fromState: null, toState: null, performedAt: '2026-10-01T11:00:00Z', checksum: 'x' },
  ];
  const CYCLES = [
    { id: 'c1', cycleCode: 'CC-0001', cleaningReasonLabel: 'PM', status: 'COMPLETED', startedAt: '2026-10-01T08:00:00Z', completedAt: '2026-10-01T12:00:00Z', sequenceNumber: 1 },
    { id: 'c2', cycleCode: 'CC-0002', cleaningReasonLabel: 'Breakdown', status: 'IN_PROGRESS', startedAt: '2026-10-02T08:00:00Z', completedAt: null, sequenceNumber: 2 },
    { id: 'c3', cycleCode: 'CC-0003', cleaningReasonLabel: 'PM', status: 'TERMINATED', startedAt: '2026-10-03T08:00:00Z', completedAt: '2026-10-03T09:00:00Z', sequenceNumber: 3 },
  ];
  const DEVS = [
    { id: 'd1', eventType: 'BYPASS_DEVIATION', fromState: 'WASH_IN', toState: 'DRY_IN', performedAt: '2026-10-01T09:30:00Z', remarks: 'Washer down', deviationDetails: { skipped: ['WASH_OUT'] } },
    { id: 'd2', eventType: 'BYPASS_DEVIATION', fromState: null, toState: null, performedAt: '2026-10-01T09:40:00Z' },
  ];
  const paged = (data: any[], total = data.length) => ({ data, total, page: 1, limit: 20, totalPages: Math.max(1, Math.ceil(total / 20)) });
  const setup = (extra: MockRoute[] = []) => mockApi([
    ...extra,
    { path: '/api/filters/f1/current-state', body: { filterName: 'FLT-001', currentState: 'DRY_IN', filterSet: 'SET_B', totalCycles: 3 } },
    { path: /\/api\/filters\/events\?filterId=f1&eventType=BYPASS_DEVIATION/, body: paged(DEVS) },
    { path: '/api/filters/events', body: paged(EVENTS, 45) },
    { path: '/api/filters/cycles', body: paged(CYCLES) },
    ...baseRoutes(),
  ]);
  const open = (api: ReturnType<typeof setup>) => renderPage(<FilterTraceabilityPage />, { user: SA, route: '/filters/f1/trace', path: '/filters/:id/trace', api });

  it('header shows name, state, set and cycle count; event log renders transitions, dryer phase and checksum', async () => {
    const api = setup();
    open(api);
    expect(await screen.findByRole('heading', { name: 'FLT-001 — Filter Traceability' })).toBeInTheDocument();
    expect(screen.getByText('DRY IN', { selector: 'span.text-cyan-600' })).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('Total Cycles:').parentElement).toHaveTextContent('Total Cycles: 3');
    await screen.findByText('Rinsed twice');
    const e1 = screen.getByText('Rinsed twice').parentElement!;
    expect(e1).toHaveTextContent('WASH IN → WASH OUT');
    expect(e1).toHaveTextContent('Checksum: abcdef0123456789...');
    // dryer start: no from-state reads as DRY IN (Started)
    expect(screen.getByText('DRY IN (Started)')).toBeInTheDocument();
    // first transition with no from-state reads "To Be Cleaned → WASH IN"
    expect(screen.getByText(/To Be Cleaned/).parentElement).toHaveTextContent('To Be Cleaned → WASH IN');
    const q = api.calls('GET', '/api/filters/events')[0].query;
    expect(q.get('filterId')).toBe('f1');
    expect(q.get('page')).toBe('1');
    expect(api.unmatched).toEqual([]);
  });

  it('cycle history tab: statuses, reasons, a dash for an open cycle, the sequence number', async () => {
    const api = setup();
    open(api);
    await screen.findByText('Rinsed twice');
    fireEvent.click(screen.getByRole('button', { name: 'Cycle History' }));
    expect(await screen.findByText('CC-0001')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Code', 'Reason', 'Status', 'Started', 'Completed', '#']);
    const open2 = screen.getByText('CC-0002').closest('tr')!;
    expect(open2).toHaveTextContent('IN_PROGRESS');
    expect(open2).toHaveTextContent('Breakdown');
    expect(within(open2).getAllByRole('cell')[4]).toHaveTextContent('-');
    expect(open2).toHaveTextContent('#2');
    expect(screen.getByText('CC-0003').closest('tr')).toHaveTextContent('TERMINATED');
    expect(api.calls('GET', '/api/filters/cycles')[0].query.get('filterId')).toBe('f1');
  });

  it('deviations tab: from → to, remarks and deviation details', async () => {
    const api = setup();
    open(api);
    await screen.findByText('Rinsed twice');
    fireEvent.click(screen.getByRole('button', { name: 'Deviations' }));
    expect(await screen.findByText('Washer down')).toBeInTheDocument();
    expect(screen.getByText('{"skipped":["WASH_OUT"]}')).toBeInTheDocument();
    expect(screen.getAllByText('BYPASS DEVIATION')).toHaveLength(2);
    expect(screen.getByText('Washer down').parentElement).toHaveTextContent('WASH IN → DRY IN');
  });

  it('empty tabs say so; pagination moves pages and resets on a tab change', async () => {
    const api = setup([
      { path: /\/api\/filters\/events\?filterId=f1&eventType=BYPASS_DEVIATION/, body: paged([]) },
      { path: '/api/filters/cycles', body: paged([]) },
    ]);
    open(api);
    await screen.findByText('Rinsed twice');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(api.calls('GET', '/api/filters/events').at(-1)!.query.get('page')).toBe('2'));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: '50' } });
    await waitFor(() => expect(api.calls('GET', '/api/filters/events').at(-1)!.query.get('limit')).toBe('50'));
    fireEvent.click(screen.getByRole('button', { name: 'Cycle History' }));
    expect(await screen.findByText('No cycles')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cycles').at(-1)!.query.get('page')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'Deviations' }));
    expect(await screen.findByText('No deviations recorded')).toBeInTheDocument();
  });

  it('no events: "No events recorded"; an unknown filter keeps the generic heading', async () => {
    const api = setup([
      { path: '/api/filters/f1/current-state', body: {} },
      { path: '/api/filters/events', body: paged([]) },
    ]);
    open(api);
    expect(await screen.findByText('No events recorded')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Filter — Filter Traceability' })).toBeInTheDocument();
    expect(screen.getByText('Total Cycles:').parentElement).toHaveTextContent('Total Cycles: 0');
  });
});

describe('Filter traceability — configured page size (D6)', () => {
  it('reads the configured Pagination default on a cold load, for every tab', async () => {
    const api = mockApi([
      { path: '/api/config/pagination/current', body: { limit: 50, count: 50, options: [10, 25, 50] } },
      { path: '/api/filters/f1/current-state', body: { filterName: 'FLT-001' } },
      { path: '/api/filters/events', body: { data: [], total: 0, page: 1, limit: 50, totalPages: 1 } },
      { path: '/api/filters/cycles', body: { data: [], total: 0, page: 1, limit: 50, totalPages: 1 } },
      ...baseRoutes(),
    ]);
    renderPage(<FilterTraceabilityPage />, { user: SA, route: '/filters/f1/trace', path: '/filters/:id/trace', api });
    await waitFor(() => expect(api.calls('GET', '/api/filters/events').at(-1)!.query.get('limit')).toBe('50'));
    fireEvent.click(screen.getByRole('button', { name: 'Cycle History' }));
    await waitFor(() => expect(api.calls('GET', '/api/filters/cycles').at(-1)!.query.get('limit')).toBe('50'));
    await screen.findByText('No cycles');
  });
});
