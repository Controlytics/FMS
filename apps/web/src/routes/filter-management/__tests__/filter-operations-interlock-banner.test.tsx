/**
 * Filter Operations — the stage-interlock banner (2026-10-24).
 *
 * It said "is awaiting QA approval" whatever role the Stage Interlock config
 * names, and printed that role as its code (SHIFTOFFICER). Now: no hard-coded
 * QA, and the role by its display name from the roles table.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, configure } from '@testing-library/react';
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
vi.mock('../components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

import { usePageTestLifecycle } from './fm-test-kit';
import { setup, scanAndSubmit } from './filter-operations-kit';

configure({ asyncUtilTimeout: 4000 });
usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });

const HELD = {
  currentState: 'WASH_OUT',
  currentCycle: { id: 'c1' },
  actions: [{ type: 'TERMINATE_CYCLE', label: 'Terminate', params: {} }],
  tapeVersion: 3,
  blockChangeStatus: 'MATCH',
  interlock: { gatedStage: true, stageKey: 'WASH_OUT', status: 'PENDING', approvalId: 'a1', approverRole: 'SHIFTOFFICER', blocksLeaving: true },
};

describe('Filter Operations — stage interlock banner', () => {
  it('names the configured approver by display name, never a hard-coded QA', async () => {
    const api = setup({
      state: HELD,
      routes: [{ path: '/api/roles/active', body: [{ name: 'SHIFTOFFICER', displayName: 'Shift Officer', color: 'bg-amber-600' }] }],
    });
    await scanAndSubmit(api, 'DRY_OUT');
    expect(await screen.findByText('Wash Out is awaiting approval.')).toBeInTheDocument();
    expect(await screen.findByText(/^Shift Officer must verify the filter details and approve/)).toBeInTheDocument();
    expect(screen.queryByText(/QA approval/)).toBeNull();
    expect(screen.queryByText(/SHIFTOFFICER/)).toBeNull();
  });
});
