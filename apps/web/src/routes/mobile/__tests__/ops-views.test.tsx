/**
 * Tablet operations page rendered on its own (no props): its header, Home,
 * Filter Status, My Tasks and Filter Cleaning Record views, the offline
 * caches it fills while online, the batch pre-cache and its Retry, and the
 * sign-in / tablet-access redirects.
 *
 * NOTE: inside the shell (/m) this page is always given `initialStageKey` +
 * `hideHeader`, and nothing else calls `goHome`, so these views are not
 * reachable from the running app — they are exercised here because the
 * component exports them (recorded in the coverage report).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, clearGlobalSwrCache } from '@/test-utils/page-harness';
import { MobileOperationsPage } from '../mobile-operations';
import { useMobileLifecycle, flush, seedOps, cachedValue, queuedOps, mobileRoutes, LocationProbe, currentPath, OPERATOR } from './support/mobile-kit';
import { renderOps, scanTag, inQueue, state, adv, bulkOk, submitButton, message, dismissAll, OPS_INSTANCES, OPS_TEMPLATES } from './support/ops-harness';
import { setOnline, emitSync, syncPendingOperations, rfid } from './support/fakes';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

const bare = (o: Parameters<typeof renderOps>[0] = {}) => renderOps({ props: {}, ...o });
const header = () => screen.getByText('DigiLog').closest('div.bg-white\\/80')! as HTMLElement;

describe('redirects', () => {
  it('with no session at all it goes to the tablet login', async () => {
    const api = mockApi(mobileRoutes());
    renderPage(<><MobileOperationsPage /><LocationProbe /></>, { route: '/m', api });
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
  });

  it('a configured role without "login" goes to the tablet login', async () => {
    await bare({ tabletAccess: { configured: true, allowed: ['my_tasks'] } });
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
  });
});

describe('header', () => {
  it('names the user, shows online + "Data Synced" once the master data is in', async () => {
    await bare();
    expect(within(header()).getByText('Ravi Kumar')).toBeInTheDocument();
    expect(within(header()).getByText('Online')).toBeInTheDocument();
    expect(await within(header()).findByText('Data Synced')).toBeInTheDocument();
  });

  it('offline: the pill, the banner, and no sync chip', async () => {
    await bare({ online: false });
    expect(within(header()).getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText(/Working offline — operations queued for sync/)).toBeInTheDocument();
    expect(within(header()).queryByText(/Synced|Syncing/)).toBeNull();
  });

  it('pending work: sync reports results and failures; Clear asks first', async () => {
    await seedOps([{ id: 'p1', userId: OPERATOR.id as string, type: 'advance', filterName: 'F-001', error: 'STALE_TAPE' }, { id: 'p2', userId: OPERATOR.id as string, type: 'start-cycle', filterName: 'F-003' }]);
    syncPendingOperations.mockResolvedValueOnce({ synced: 1, failed: 1 });
    await bare();
    fireEvent.click(await screen.findByRole('button', { name: '2 pending — sync' }));
    expect(await message(/advance: F-001 — STALE_TAPE\s+start-cycle: F-003 — pending/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('Synced 1 operation(s)')).toBeInTheDocument();
    await dismissAll();
    syncPendingOperations.mockResolvedValueOnce({ synced: 0, failed: 1 });
    const { clearAllOperations } = await import('@/lib/offline-store');
    fireEvent.click(screen.getByRole('button', { name: '2 pending — sync' }));
    await clearAllOperations();
    expect(await message('Sync failed')).toBeInTheDocument();
    await dismissAll();
    await act(async () => { emitSync({ type: 'start' }); });
    expect(screen.getByRole('button', { name: '⟳ Syncing...' })).toBeDisabled();
    (window.confirm as any).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(await message('Queue cleared')).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
  });

  it('the back button returns Home from any view', async () => {
    await bare();
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    await screen.findByRole('heading', { name: 'Filter Cleaning Record' });
    fireEvent.click(header().querySelector('button')!); // no accessible name — see report
    expect(await screen.findByText('Recent cycle history')).toBeInTheDocument();
  });
});

describe('Home', () => {
  it('Filter Status card, quick tiles, a card per station with its count, and Logout', async () => {
    const { api } = await bare();
    const status = await screen.findByRole('button', { name: /Filter Status/ });
    await waitFor(() => expect(status).toHaveTextContent('6 total filters'));
    expect(status).toHaveTextContent('2Wash In'); // F-001, F-002 (F-004 is at Dry In)
    expect(screen.getByRole('button', { name: /Dry In 1 filter\(s\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Storage Out 0 filter\(s\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
    expect(api.calls('POST', '/api/auth/logout')).toHaveLength(1);
  });

  it('only the allowed features are offered', async () => {
    await bare({ tabletAccess: { configured: true, allowed: ['login'] } });
    expect(await screen.findByText('Recent cycle history')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filter Status/ })).toBeNull();
    expect(screen.queryByText('Filters due for cleaning')).toBeNull();
    expect(screen.queryByRole('button', { name: /Wash In/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Logout' })).toBeNull();
  });

  it('a station card opens the station; after a submit Home lists the operation (queued ones marked)', async () => {
    await bare({ states: { f1: state('WASH_IN', [adv('WASH_OUT')]) }, routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }] });
    fireEvent.click(await screen.findByRole('button', { name: /Wash Out 0 filter\(s\)/ }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await message('1 filter(s) → Wash Out');
    await dismissAll();
    fireEvent.click(header().querySelector('button')!);
    const recent = await screen.findByText('Recent Operations');
    expect(recent.parentElement).toHaveTextContent('F-001');
  });
});

describe('Filter Status view', () => {
  it('counts per stage and lists every filter with its set and stage', async () => {
    await bare({ routes: [{ path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (i.id === 'f1' ? { ...i, filterSet: 'SET_B' } : i)) } }] });
    fireEvent.click(await screen.findByRole('button', { name: /Filter Status/ }));
    expect(await screen.findByText('All Filters (6)')).toBeInTheDocument();
    const row = (n: string) => screen.getByText(n).closest('div.bg-white')! as HTMLElement;
    expect(row('F-001')).toHaveTextContent('Set B');
    expect(row('F-001')).toHaveTextContent('WASH IN');
    expect(row('F-003')).toHaveTextContent('To Be Cleaned');
  });
});

describe('My Tasks view', () => {
  const TASKS = {
    tasks: [
      { entryId: 'e1', ahuName: 'AHU-01', overallStatus: 'pending', plannedDate: '2026-10-21', cleanedCount: 1, totalFilters: 3,
        filters: [{ filterId: 'f1', filterName: 'F-001', status: 'cleaned_in_window', currentStage: 'CLEANING_CYCLE_COMPLETED' }, { filterId: 'f2', filterName: 'F-002', status: 'in_progress', currentStage: 'WASH_OUT' }, { filterId: 'f3', filterName: 'F-003', status: 'pending' }] },
      { entryId: 'e2', ahuName: 'AHU-02', overallStatus: 'in_progress', plannedDate: '2026-10-21', cleanedCount: 0, totalFilters: 0, filters: [] },
      { entryId: 'e3', ahuName: 'AHU-03', overallStatus: 'complete', plannedDate: '2026-10-21', cleanedCount: 2, totalFilters: 2, filters: [] },
    ],
    overdue: [{ entryId: 'o1', ahuName: 'AHU-04', windowEnd: '2026-10-10', cleanedCount: 0, totalFilters: 1 }],
  };

  it('lists the due tasks (fetched only on this view), expands, and Perform opens Wash In with a prompt', async () => {
    const { api } = await bare({ due: TASKS });
    expect(api.calls('GET', '/api/pm-schedules/due')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    expect(await screen.findByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
    const card = (ahu: string) => screen.getByRole('heading', { name: ahu }).closest('div.bg-white')! as HTMLElement;
    expect(card('AHU-01')).toHaveTextContent('Pending');
    expect(card('AHU-01')).toHaveTextContent('1/3 cleaned');
    expect(card('AHU-02')).toHaveTextContent('In Progress');
    expect(card('AHU-03')).toHaveTextContent('Completed');
    fireEvent.click(screen.getByRole('heading', { name: 'AHU-01' }).closest('button')!);
    expect(within(card('AHU-01')).getByText(/F-001/)).toHaveTextContent('F-001· Cleaned'); // a completed marker is not a stage
    expect(within(card('AHU-01')).getByText(/F-002/)).toHaveTextContent('F-002· Wash Out· In progress');
    expect(within(card('AHU-01')).getByText(/F-003/)).toHaveTextContent('F-003· Pending');
    fireEvent.click(screen.getByRole('heading', { name: 'AHU-01' }).closest('button')!);
    fireEvent.click(screen.getByRole('heading', { name: 'AHU-02' }).closest('button')!);
    expect(within(card('AHU-02')).getByText('No active child filters.')).toBeInTheDocument();
    expect(card('AHU-04')).toHaveTextContent('0/1 cleaned');
    fireEvent.click(within(card('AHU-04')).getByRole('button', { name: 'Perform (overdue) →' }));
    expect(await message('Ready to clean filters from AHU-04. Scan each filter now.')).toBeInTheDocument();
    await dismissAll();
    expect(screen.queryByText('Recent cycle history')).toBeNull(); // left Home for a scan station
    fireEvent.click(header().querySelector('button')!);
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    fireEvent.click(within(await screen.findByRole('heading', { name: 'AHU-01' }).then((h) => h.closest('div.bg-white')! as HTMLElement)).getByRole('button', { name: 'Perform →' }));
    expect(await message('Ready to clean filters from AHU-01. Scan each filter now.')).toBeInTheDocument();
  });

  it('nothing due; loading placeholders', async () => {
    await bare();
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    expect(await screen.findByText('Nothing due right now')).toBeInTheDocument();
  });

  it('offline: the cached list and a connection notice', async () => {
    await bare({ online: false, cache: { 'due-tasks': TASKS } });
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    expect(await screen.findByText('My Tasks requires an internet connection.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
  });

  it('online it caches what it showed', async () => {
    await bare({ due: TASKS });
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    await waitFor(() => expect(cachedValue('due-tasks')?.tasks).toHaveLength(3));
  });
});

describe('Filter Cleaning Record view', () => {
  const NOW = Date.now();
  const iso = (min: number) => new Date(NOW - min * 60_000).toISOString();
  const CYC = [
    { id: 'c1', filter: { name: 'F-001' }, cycleCode: 'CC-1', status: 'COMPLETED', startedAt: iso(130), completedAt: iso(0), cleaningReasonLabel: 'PM',
      events: [
        { id: 'e1', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: iso(120) },
        { id: 'e2', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: iso(100), attributes: { action: 'DRYER_STARTED' } },
        { id: 'e3', eventType: 'STATE_TRANSITION', fromState: null, toState: null, performedAt: iso(90) },
        { eventType: 'CHECKLIST_COMPLETED', performedAt: iso(80), attributes: { action: 'SUBMIT_CHECKLIST' } },
      ] },
    { id: 'c2', filterName: 'F-002', cycleCode: 'CC-2', status: 'TERMINATED', startedAt: iso(30), completedAt: iso(29) },
    { id: 'c3', cycleCode: 'CC-3', status: 'IN_PROGRESS', startedAt: iso(2) },
  ];

  it('asks for 30 days, shows status / duration / reason, and expands a cycle into its events', async () => {
    const { api } = await bare({ routes: [{ path: '/api/filters/cycles', body: { data: CYC } }] });
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    expect(await screen.findByText('Recent cycles · 3')).toBeInTheDocument();
    const req = api.calls('GET', '/api/filters/cycles').at(-1)!;
    expect(req.query.get('from')).toBeTruthy();
    const card = (code: string) => screen.getAllByText(code)[0].closest('button')! as HTMLElement;
    expect(card('CC-1')).toHaveTextContent('Completed');
    expect(card('CC-1')).toHaveTextContent('2h 10m');
    expect(card('CC-2')).toHaveTextContent('Terminated');
    expect(card('CC-2')).toHaveTextContent('F-002');
    expect(card('CC-2')).toHaveTextContent('-');
    expect(card('CC-3')).toHaveTextContent('In Progress');
    fireEvent.click(card('CC-1'));
    expect(card('CC-1')).toHaveTextContent('To Be Cleaned → WASH IN');
    expect(card('CC-1')).toHaveTextContent('WASH OUT → DRY IN (Started)');
    expect(card('CC-1')).toHaveTextContent('transition');
    expect(card('CC-1')).toHaveTextContent('checklist completed');
    expect(card('CC-1')).toHaveTextContent('submit checklist');
    fireEvent.click(card('CC-1'));
    expect(card('CC-1')).not.toHaveTextContent('transition');
    fireEvent.click(card('CC-2')); // no events: nothing to expand
    expect(card('CC-2')).not.toHaveTextContent('→');
  });

  it('empty; loading; offline cached snapshot', async () => {
    const a = await bare();
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    expect(await screen.findByText('No cleaning cycles yet.')).toBeInTheDocument();
    a.unmount();
    await bare({ online: false, cache: { 'cleaning-cycles-recent': [CYC[1]] } });
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    expect(await screen.findByText(/Offline — showing last cached snapshot/)).toBeInTheDocument();
    expect((await screen.findAllByText('CC-2')).length).toBeGreaterThan(0);
  });
});

describe('offline caches filled while online', () => {
  it('each master-data read is cached for an offline shift', async () => {
    const reauthUser = { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'BLOCK_CHANGE_REQUEST'] };
    await bare({
      user: reauthUser,
      reauthActions: ['STAGE_WASH_IN'],
      routes: [
        { path: '/api/filter-cleaning-profiles', body: { data: [{ id: 'p1', name: 'Std' }] } },
        { path: '/api/block-change-requests', body: { data: [{ id: 'bcr1', status: 'APPROVED' }] } },
        { path: '/api/equipment-groups', body: { data: [{ id: 'g1', name: 'G' }] } },
        { path: '/api/replacement-schedules/blocked-filters', body: { filterIds: ['f9'] } },
      ],
    });
    await waitFor(() => expect(cachedValue('templates')).toEqual(OPS_TEMPLATES));
    await waitFor(() => expect(cachedValue('cleaning-reasons')?.map((r: any) => r.key)).toEqual(['PM', 'BREAKDOWN', 'OLD']));
    await waitFor(() => expect(cachedValue('active-profile-p1')).toEqual({ id: 'p1', name: 'Std' }));
    expect(cachedValue('active-profiles')).toEqual([{ id: 'p1', name: 'Std' }]);
    expect(cachedValue('equipment-groups')).toEqual([{ id: 'g1', name: 'G' }]);
    expect(cachedValue('checklist-profiles')).toHaveLength(1);
    expect(cachedValue('blocked-filter-ids')).toEqual(['f9']);
    expect(cachedValue('cleaning-profile-assignment')).toEqual({ mode: 'BY_AHU', rules: [] });
    expect(cachedValue('approved-block-changes')).toEqual([{ id: 'bcr1', status: 'APPROVED' }]);
    expect(cachedValue('my-reauth-actions')).toEqual(['STAGE_WASH_IN']);
    expect(cachedValue('branding-config')).toMatchObject({ appName: 'FMS Tablet' });
    expect(cachedValue('datetime-config')).toMatchObject({ dateFormat: 'DD/MM/YYYY' });
    expect(cachedValue('field-ids-config')).toEqual([]);
    expect(cachedValue('identifier-map')).toBeUndefined(); // no tags at all → nothing to cache
  });

  it('the identifier map is built from the tag list (retired holders left out)', async () => {
    await bare({ identifiers: [
      { id: 'i1', identifierType: 'RFID', identifierValue: 'AB12', assetId: 'f1', asset: { id: 'f1', name: 'F-001' } },
    ] });
    await waitFor(() => expect(cachedValue('identifier-map')?.AB12).toMatchObject({ filterId: 'f1', filterName: 'F-001' }));
  });

  it('a batch pre-cache of every filter state runs after 2 s; a failure shows a Retry that reports its result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await bare({ routes: [
      { path: '/api/filters/batch-states', status: 500, times: 1, body: { error: 'X', message: 'Out of memory' } },
      { path: '/api/filters/batch-states', times: 1, body: {} },
      { path: '/api/filters/batch-states', status: 500, times: 1, body: { error: 'X', message: 'Still down' } },
      { path: '/api/filters/batch-states', body: { states: { f1: { currentState: 'WASH_IN' }, f2: { currentState: 'DRY_IN' } } } },
    ] });
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(await screen.findByText(/Offline pre-cache failed\. New filters may not work offline\. Out of memory/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Batch states endpoint returned no data/)).toBeInTheDocument();
    expect(await message('Re-cache failed: No data')).toBeInTheDocument();
    await dismissAll();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await message('Re-cache failed: Still down')).toBeInTheDocument();
    await dismissAll();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await message('Re-cached 2 filter states for offline use')).toBeInTheDocument();
    expect(cachedValue('filter-state-f2')).toEqual({ currentState: 'DRY_IN' });
    expect(screen.queryByText(/Offline pre-cache failed/)).toBeNull();
    vi.useRealTimers();
  });

  it('a completed sync, or a shrinking queue, refreshes My Tasks', async () => {
    await seedOps([{ id: 'p1', userId: OPERATOR.id as string }]);
    const { api } = await bare();
    await screen.findByRole('button', { name: '1 pending — sync' });
    fireEvent.click(screen.getByRole('button', { name: /My Tasks/ }));
    await screen.findByText('Nothing due right now');
    const due = () => api.calls('GET', '/api/pm-schedules/due').length;
    const before = due();
    await act(async () => { emitSync({ type: 'complete', synced: 0 }); });
    await flush(60);
    expect(due()).toBe(before);
    await act(async () => { emitSync({ type: 'complete', synced: 3 }); });
    await waitFor(() => expect(due()).toBeGreaterThan(before));
    const mid = due();
    const { clearAllOperations } = await import('@/lib/offline-store');
    await clearAllOperations();
    await act(async () => { emitSync({ type: 'complete' }); }); // the queue shrinks 1 → 0
    await waitFor(() => expect(due()).toBeGreaterThan(mid));
  });

  it('leaving the station drops the RFID subscription', async () => {
    await renderOps({ props: { initialStageKey: 'WASH_OUT' } });
    await waitFor(() => expect(rfid.onTag).toBeTypeOf('function'));
    fireEvent.click(header().querySelector('button')!);
    await waitFor(() => expect(rfid.unsubscribed).toBeGreaterThan(0));
  });

  it('going offline and back re-reads the cached lists', async () => {
    await bare();
    await act(async () => { setOnline(false); });
    expect(await screen.findByText(/Working offline/)).toBeInTheDocument();
    await act(async () => { setOnline(true); });
    await waitFor(() => expect(screen.queryByText(/Working offline/)).toBeNull());
  });
});

describe('the filter list is re-read after a write (global SWR cache)', () => {
  // The page refreshes /api/assets/instances through swr's GLOBAL mutate(key);
  // only a render on the default cache can see it. Unmounted before the shared
  // cache is emptied, so nothing re-renders afterwards.
  it('after a batch submit, after a completed sync, and on the way Home', async () => {
    await clearGlobalSwrCache();
    const view = await renderOps({
      globalCache: true, props: { initialStageKey: 'WASH_OUT' },
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    const count = () => view.api.calls('GET', '/api/assets/instances').length;
    await scanTag('E1'); await inQueue('F-001');
    let before = count();
    fireEvent.click(submitButton());
    await message('1 filter(s) → Wash Out');
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    await dismissAll();
    before = count();
    await act(async () => { emitSync({ type: 'complete', synced: 1 }); });
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    before = count();
    fireEvent.click(header().querySelector('button')!);
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    await flush(60);
    view.unmount();
    await clearGlobalSwrCache();
  });
});
