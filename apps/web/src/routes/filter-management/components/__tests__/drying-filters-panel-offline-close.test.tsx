/**
 * DryingFiltersPanel — a FINAL Dry In whose readings are QUEUED (offline)
 * closes its cycle on this device (2026-10-22, item 6 / 3b).
 *
 * A final Dry In's work is the dryer run: its readings (SUBMIT_READINGS) finish
 * the cycle (shared callCompletesStageWork). offline-cache's recompute completes
 * the cycle once the row says the readings are in
 * (`currentCycle.dryerReadingsSubmitted`, f81c3fa) — but the panel set that flag
 * AFTER its recompute, and then wrote `currentCycle: {...}` back, so the cycle
 * stayed open on the tablet until sync and the next scan offered no next step.
 * The flag now goes on the row first (use-core rememberQueuedDryerReadings), and
 * the panel never writes a cycle back.
 *
 * Same for the final Dry In with a checklist after it: the queued
 * advance-with-checklist logs the answer (afterStage DRY_IN) and the cycle
 * closes locally too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act, configure } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role } from '../../__tests__/fm-test-kit';
import { installFakeIndexedDB, openAppDb, cacheRow, type FakeIdb } from '../../hooks/__tests__/fake-indexeddb';
import { DryingFiltersPanel } from '../drying-filters-panel';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();

let idb: FakeIdb;
beforeEach(async () => { idb = installFakeIndexedDB(); await openAppDb(); });

const OPERATOR = role('OPERATOR', ['FILTER_OPERATE']);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const TEMP = { id: 't1', instrumentId: 'TG-1', description: 'Dryer Temperature', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 61, leastCount: 1 };
const DRYER = { id: 'gd', name: 'Dryer bay', instruments: [TEMP] };
const Q = { id: 'q1', question: 'Filter intact?', questionType: 'YES_NO', required: true };
const CL1 = { id: 'cl1', name: 'Release check', version: 3, isActive: true, questions: [Q] };

/** START → WASH_IN → DRY_IN → [CHECKLIST cl1] → END (the checklist only when `checklist`). */
function graph(checklist: boolean) {
  const stages: any[] = [
    { id: 'n-s', nodeType: 'START', stateKey: null, configuration: {} },
    { id: 'n-wi', nodeType: 'STAGE', stateKey: 'WASH_IN', configuration: {} },
    { id: 'n-di', nodeType: 'STAGE', stateKey: 'DRY_IN', configuration: {} },
    ...(checklist ? [{ id: 'n-cl', nodeType: 'CHECKLIST', stateKey: null, configuration: { checklistProfileId: 'cl1' } }] : []),
    { id: 'n-e', nodeType: 'END', stateKey: null, configuration: {} },
  ];
  const connections = [
    { fromStageId: 'n-s', toStageId: 'n-wi' }, { fromStageId: 'n-wi', toStageId: 'n-di' },
    ...(checklist
      ? [{ fromStageId: 'n-di', toStageId: 'n-cl' }, { fromStageId: 'n-cl', toStageId: 'n-e' }]
      : [{ fromStageId: 'n-di', toStageId: 'n-e' }]),
  ];
  return { stages, connections };
}
const row = (checklist: boolean) => ({
  currentState: 'DRY_IN',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: 'gd', profileVersion: 1, dryerStartedAt: ago(60), dryerDurationMinutes: 10, dryerReadingsSubmitted: false },
  equipmentGroup: DRYER, blockEquipmentGroups: [],
  pipelineGraph: graph(checklist),
  stageLookup: { DRY_IN: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: checklist ? ['cl1'] : [], interlockGated: false } },
  disabledChecklistProfileIds: [],
  pendingChecklist: [],
});

async function setup(checklist: boolean) {
  const { getCachedData, cacheData } = await import('@/lib/offline-store');
  idb.seed('cache', [cacheRow('filter-state-f1', row(checklist)), cacheRow('checklist-profiles', [CL1])]);
  const api = mockApi([...baseRoutes({})]);
  const props = {
    executeOrQueue: vi.fn(async (..._args: any[]) => ({ executed: false })),
    getCache: getCachedData,
    cacheData: vi.fn((k: string, v: any, ttl?: number) => cacheData(k, v, ttl)),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onAfterSubmit: vi.fn(),
  };
  renderPage(<DryingFiltersPanel filters={[{ id: 'f1', name: 'FLT-1' }]} online={false} variant="mobile" {...props} />, { user: OPERATOR, api });
  return props;
}
const submit = () => screen.getByRole('button', { name: /^Submit \(/ });
const cachedRow = () => idb.rows('cache').find((r) => r.key === 'filter-state-f1')?.data;
async function enterTemperature() {
  await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
  fireEvent.change(await screen.findByDisplayValue('Temperature for selected (°C)'), { target: { value: '60' } });
  await waitFor(() => expect(submit()).toBeEnabled());
}
const settled = async (s: { onAfterSubmit: ReturnType<typeof vi.fn> }) => {
  await waitFor(() => expect(s.onAfterSubmit).toHaveBeenCalled());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

describe('a final Dry In queued offline closes on this device', () => {
  it('readings only: the cycle is closed locally; no cycle is written back onto the row', async () => {
    const s = await setup(false);
    await enterTemperature();
    fireEvent.click(submit());
    await settled(s);
    expect(s.executeOrQueue.mock.calls[0][0]).toBe('advance');
    expect(s.onError).not.toHaveBeenCalled();
    await waitFor(() => expect(cachedRow()?.currentCycle ?? null).toBeNull());
    expect(cachedRow()?.currentState ?? null).toBeNull();
    // the panel never wrote `currentCycle: {...}` back over the closed row
    expect(s.cacheData.mock.calls.some(([k, v]: any[]) => k === 'filter-state-f1' && v?.currentCycle)).toBe(false);
  });

  it('with the checklist after it: the queued advance-with-checklist logs the answer and the cycle closes locally', async () => {
    const s = await setup(true);
    await enterTemperature();
    fireEvent.click(submit());
    await screen.findByText('Checklist Required');
    await waitFor(() => {
      const yes = screen.getByRole('button', { name: 'Yes' });
      if (yes.getAttribute('aria-pressed') !== 'true') fireEvent.click(yes);
      expect(yes).toHaveAttribute('aria-pressed', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await settled(s);
    expect(s.executeOrQueue.mock.calls[0][0]).toBe('advance-with-checklist');
    expect(s.onError).not.toHaveBeenCalled();
    await waitFor(() => expect(cachedRow()?.currentCycle ?? null).toBeNull());
    expect(cachedRow()?.currentState ?? null).toBeNull();
  });
});
