/**
 * Filter Operations — leaving Dry In before its readings (2026-10-23).
 *
 * Since 3404627 the tape offers no way out of Dry In until the readings are in
 * (guard #27). The page then said "no next stage is cached — re-sync" offline,
 * and named the next stage as if the scan were simply the wrong one online. The
 * shared leavingDryInRefusal (lib/filter-ops/validate-offline-gate.ts) speaks
 * first now, before both checks: the countdown before half-time, the readings
 * after it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });
afterEach(() => { vi.useRealTimers(); });

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
/** A cycle at Dry In; the tape offers no way out until the readings are in. */
const atDryIn = (dryerStartedAt: string, actions: any[]) => ({
  currentState: 'DRY_IN', tapeVersion: 7, blockChangeStatus: 'MATCH',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS', dryerStartedAt, dryerDurationMinutes: 60, dryerReadingsSubmitted: false },
  actions,
  stageLookup: { DRY_IN: { nextStages: ['DRY_OUT'], leadsToEnd: false, pendingChecklistProfileIds: [], interlockGated: false } },
  disabledChecklistProfileIds: [],
});
const READINGS = { type: 'SUBMIT_DRYER_READINGS', label: 'Submit dryer readings', params: { instrumentIds: ['t1'] } };
const TERMINATE = { type: 'TERMINATE_CYCLE', label: 'Terminate' };
const advances = (api: ReturnType<typeof setup>) => api.calls('POST', /\/api\/filters\/f1\/advance/);

describe('Filter Operations — scanning Dry Out while Dry In is not finished', () => {
  it('readings due: says to submit the dryer temperature; nothing is sent', async () => {
    const api = setup({ state: atDryIn(ago(45), [READINGS, TERMINATE]) });
    await scanAndSubmit(api, 'DRY_OUT');
    expect(await screen.findByText(/F-001: submit dryer temperature before leaving Dry In/)).toBeInTheDocument();
    expect(advances(api)).toHaveLength(0);
  });

  it('before half-time: the countdown; nothing is sent', async () => {
    const api = setup({ state: atDryIn(ago(5), [TERMINATE]) });
    await scanAndSubmit(api, 'DRY_OUT');
    expect(await screen.findByText(/F-001: dryer still running — wait 25 more minute\(s\) before leaving Dry In/)).toBeInTheDocument();
    expect(advances(api)).toHaveLength(0);
  });
});
