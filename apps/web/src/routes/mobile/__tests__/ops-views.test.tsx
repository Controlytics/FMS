/**
 * Tablet operations page — what it does around the station itself: the sign-in /
 * tablet-access redirects, the offline caches it fills while online, the batch
 * pre-cache and its Retry, the RFID subscription's lifetime, and the filter list
 * re-read after writes.
 *
 * (Until 2026-10-22 this file also drove the page's own header, Home, Filter
 * Status, My Tasks and Filter Cleaning Record views. Inside the shell (/m) the
 * page is always opened on a station, so those were unreachable and were
 * removed from the page; the shell's own screens are covered by wrapper-*.)
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { mockApi, renderPage, clearGlobalSwrCache } from '@/test-utils/page-harness';
import { MobileOperationsPage } from '../mobile-operations';
import { useMobileLifecycle, flush, seedOps, cachedValue, mobileRoutes, LocationProbe, currentPath, OPERATOR } from './support/mobile-kit';
import { renderOps, scanTag, inQueue, state, adv, bulkOk, submitButton, message, dismissAll, OPS_TEMPLATES } from './support/ops-harness';
import { emitSync, rfid } from './support/fakes';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

describe('redirects', () => {
  it('with no session at all it goes to the tablet login', async () => {
    const api = mockApi(mobileRoutes());
    renderPage(<><MobileOperationsPage /><LocationProbe /></>, { route: '/m', api });
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
  });

  it('a configured role without "login" goes to the tablet login', async () => {
    await renderOps({ tabletAccess: { configured: true, allowed: ['my_tasks'] } });
    await waitFor(() => expect(currentPath()).toBe('/m/login'));
  });
});

describe('offline caches filled while online', () => {
  it('each master-data read is cached for an offline shift', async () => {
    const reauthUser = { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'BLOCK_CHANGE_REQUEST'] };
    const { api } = await renderOps({
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
    // 2026-10-22: every APPROVED block-change request ever (limit 1,000,000) was
    // read and cached for nothing — no offline path reads it since offline
    // cross-block stopped blocking (2026-06-09). A table that grows with use.
    expect(api.calls('GET', '/api/block-change-requests')).toEqual([]);
    expect(cachedValue('approved-block-changes')).toBeUndefined();
    expect(cachedValue('my-reauth-actions')).toEqual(['STAGE_WASH_IN']);
    expect(cachedValue('branding-config')).toMatchObject({ appName: 'FMS Tablet' });
    expect(cachedValue('datetime-config')).toMatchObject({ dateFormat: 'DD/MM/YYYY' });
    expect(cachedValue('field-ids-config')).toEqual([]);
    expect(cachedValue('identifier-map')).toBeUndefined(); // no tags at all → nothing to cache
  });

  it('the identifier map is built from the tag list (retired holders left out)', async () => {
    await renderOps({ identifiers: [
      { id: 'i1', identifierType: 'RFID', identifierValue: 'AB12', assetId: 'f1', asset: { id: 'f1', name: 'F-001' } },
    ] });
    await waitFor(() => expect(cachedValue('identifier-map')?.AB12).toMatchObject({ filterId: 'f1', filterName: 'F-001' }));
  });

  it('a batch pre-cache of every filter state runs after 2 s; a failure shows a Retry that reports its result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderOps({ routes: [
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

  it('leaving the station (the shell unmounts the page) drops the RFID subscription', async () => {
    const view = await renderOps({ stage: 'WASH_OUT' });
    await waitFor(() => expect(rfid.onTag).toBeTypeOf('function'));
    view.unmount();
    await waitFor(() => expect(rfid.unsubscribed).toBeGreaterThan(0));
  });
});

describe('the filter list is re-read after a write (global SWR cache)', () => {
  // The page refreshes /api/assets/instances through swr's GLOBAL mutate(key);
  // only a render on the default cache can see it. Unmounted before the shared
  // cache is emptied, so nothing re-renders afterwards.
  it('after a batch submit, after a completed sync, and when the queue shrinks', async () => {
    await clearGlobalSwrCache();
    await seedOps([{ id: 'p1', userId: OPERATOR.id as string }]);
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
    const { clearAllOperations } = await import('@/lib/offline-store');
    await clearAllOperations();
    await act(async () => { emitSync({ type: 'complete' }); }); // the queue shrinks 1 → 0
    await waitFor(() => expect(count()).toBeGreaterThan(before));
    await flush(60);
    view.unmount();
    await clearGlobalSwrCache();
  });
});
