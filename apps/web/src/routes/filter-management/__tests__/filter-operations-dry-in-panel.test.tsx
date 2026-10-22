/**
 * Filter Operations (web) — the Dry In panel's readings that COMPLETE a cycle
 * pass the page's AHU completion pre-flight (2026-10-22). A final Dry In
 * completes its cycle on the readings, and the panel sent them with no
 * pre-flight, so POPUP never warned and INTERLOCK never blocked there. The page
 * now supplies its own gate (runAhuGate) through the panel's `ahuPreflight`.
 *
 * The real panel is rendered here (the other page suites mock it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { installFakeIndexedDB, openAppDb } from '../hooks/__tests__/fake-indexeddb';

vi.mock('@/lib/connectivity', () => ({
  isOnline: () => true,
  onConnectivityChange: () => () => {},
  startConnectivityEngine: async () => {},
}));
vi.mock('@/lib/sync-engine', () => ({
  onSyncEvent: () => () => {},
  startAutoSync: () => {},
  stopAutoSync: () => {},
  emitSyncStage: () => {},
  withReplayTimeout: <T,>(p: Promise<T>) => p,
  syncPendingOperations: async () => ({ synced: 0, failed: 0 }),
}));

import { renderPage } from '@/test-utils/page-harness';
import { usePageTestLifecycle } from './fm-test-kit';
import { setup, OPERATOR, F1 } from './filter-operations-kit';
import { FilterOperationsPage } from '../filter-operations';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
// No Dry In instrument: the row needs no temperature, so Submit is the only step.
const WASH_ONLY = { id: 'gw', name: 'Wash bay', blockId: 'b1', instruments: [{ id: 'p1', instrumentId: 'PG-1', description: 'RO pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 1 }] };
const dryIn = (final: boolean) => ({
  currentState: 'DRY_IN', tapeVersion: 7, blockChangeStatus: 'MATCH', actions: [],
  currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: 'gw', dryerStartedAt: ago(60), dryerDurationMinutes: 10, dryerReadingsSubmitted: false },
  equipmentGroup: WASH_ONLY, blockEquipmentGroups: [],
  stageLookup: { DRY_IN: final
    ? { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: [], interlockGated: false }
    : { nextStages: ['DRY_OUT'], leadsToEnd: false, pendingChecklistProfileIds: [], interlockGated: false } },
  disabledChecklistProfileIds: [],
});
const AHU_PENDING = {
  ahus: [{
    ahuId: 'h1', ahuName: 'AHU-01', allAtFinal: false,
    filters: [{ id: 'f1', name: 'F-001', stage: 'DRY_IN', done: false }, { id: 'f9', name: 'F-009', stage: 'WASH_IN', done: false }],
  }],
};

async function openPanel(mode: 'POPUP' | 'INTERLOCK' | 'NONE', final: boolean) {
  const api = setup({
    state: dryIn(final),
    routes: [
      { path: '/api/config/ahu-completion-process/current', body: { mode } },
      { method: 'POST', path: '/api/filters/ahu-set-availability', body: { hasBothSets: false } },
      { method: 'POST', path: '/api/filters/ahu-completion-status/batch', body: AHU_PENDING },
      { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'DRY_IN', actions: [] } },
    ],
  });
  api.routes.unshift({ path: '/api/hierarchy/filters', body: { data: [{ ...F1, currentLifecycleState: 'DRY_IN' }] } });
  renderPage(<FilterOperationsPage />, { route: '/filters/stage/DRY_IN', path: '/filters/stage/:stageKey', user: OPERATOR, api });
  await waitFor(() => expect(api.calls('GET', '/api/config/ahu-completion-process/current').length).toBeGreaterThan(0));
  fireEvent.click(await screen.findByRole('button', { name: /North/ }));
  await screen.findByText(/No reading to take/);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Submit \(1\)/ })).toBeEnabled());
  return api;
}
const advances = (api: ReturnType<typeof setup>) => api.calls('POST', '/api/filters/f1/advance');
const checks = (api: ReturnType<typeof setup>) => api.calls('POST', '/api/filters/ahu-completion-status/batch');

describe('Filter Operations — Dry In panel readings that complete a cycle', () => {
  it('POPUP: the remaining-filters warning comes first; "Continue anyway" sends the readings', async () => {
    const api = await openPanel('POPUP', true);
    fireEvent.click(screen.getByRole('button', { name: /^Submit \(1\)/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Continue anyway/ }));
    await waitFor(() => expect(advances(api)).toHaveLength(1));
    expect(advances(api)[0].json).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect(checks(api).map((c) => c.json.filterIds)).toEqual([['f1']]);
  });

  it('INTERLOCK: blocked while other filters of the AHU are in cleaning; nothing is sent', async () => {
    const api = await openPanel('INTERLOCK', true);
    fireEvent.click(screen.getByRole('button', { name: /^Submit \(1\)/ }));
    expect(await screen.findByText('AHU interlock — cleaning completion blocked')).toBeInTheDocument();
    const gate = screen.getByText('AHU interlock — cleaning completion blocked').closest('.max-w-lg') as HTMLElement;
    fireEvent.click(within(gate).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByText('AHU interlock — cleaning completion blocked')).toBeNull());
    expect(advances(api)).toEqual([]);
  });

  it('a Dry In with stages after it completes nothing: no pre-flight, the readings go straight through', async () => {
    const api = await openPanel('INTERLOCK', false);
    fireEvent.click(screen.getByRole('button', { name: /^Submit \(1\)/ }));
    await waitFor(() => expect(advances(api)).toHaveLength(1));
    expect(checks(api)).toEqual([]);
  });
});
