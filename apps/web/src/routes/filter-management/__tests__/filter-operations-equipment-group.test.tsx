/**
 * Filter Operations (web) — which equipment group the readings go to
 * (operator decision 2026-10-22).
 *
 * A block can have more than one active equipment group. Until a cycle is bound
 * to one, the OPERATOR picks it in the readings dialog. Before, the page silently
 * used the state's `equipmentGroup` — which the server fills with the block's
 * OLDEST group for an unbound cycle — so the readings were recorded against a
 * group nobody chose. A single group, or a cycle already bound, works as before.
 *
 * Same boundaries as filter-operations-reauth.test.tsx.
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
vi.mock('../components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

import { usePageTestLifecycle } from './fm-test-kit';
import { setup, scanAndSubmit } from './filter-operations-kit';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });

const inst = (id: string, label: string) => ({ id, instrumentId: label, description: `RO pressure ${label}`, stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 1 });
const GA = { id: 'ga', name: 'Bay A (oldest)', blockId: 'b1', instruments: [inst('pa', 'PG-A')] };
const GB = { id: 'gb', name: 'Bay B', blockId: 'b1', instruments: [inst('pb', 'PG-B')] };
/** A cycle mid-way at Wash In (e.g. a Dry In → Dry Out → Wash In profile). */
const atWashIn = (cycle: Record<string, unknown>, groups: { equipmentGroup: any; blockEquipmentGroups: any[] }) => ({
  currentState: 'DRY_OUT', tapeVersion: 7, blockChangeStatus: 'MATCH',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: null, ...cycle },
  actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance', params: { targetState: 'WASH_IN' } }],
  ...groups,
});
const advanceRoute = { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_IN', actions: [] } };
const dialog = () => screen.getByText('Equipment & Pressure Readings').closest('.bg-white') as HTMLElement;
const sent = (api: ReturnType<typeof setup>) => api.calls('POST', '/api/filters/f1/advance').map((r) => r.json);

async function readAndSubmit(d: HTMLElement, value = '1') {
  const select = within(d).getByRole('combobox');
  fireEvent.change(select, { target: { value } });
  fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
}

describe('Filter Operations — the equipment group for the readings', () => {
  it('two active groups, cycle not bound: both offered, none preselected, nothing submittable until a pick; the PICKED group is sent', async () => {
    const api = setup({ state: atWashIn({}, { equipmentGroup: GA, blockEquipmentGroups: [GA, GB] }), routes: [advanceRoute] });
    await scanAndSubmit(api, 'WASH_IN', 'North');
    await screen.findByText('Equipment & Pressure Readings');
    const d = dialog();
    expect(within(d).getByText('Select Equipment Group:')).toBeInTheDocument();
    const a = within(d).getByRole('button', { name: /Bay A/ });
    const b = within(d).getByRole('button', { name: /Bay B/ });
    expect(a).toBeInTheDocument();
    // the oldest is NOT quietly chosen: no reading fields until the operator picks
    expect(within(d).queryByText('RO pressure PG-A')).toBeNull();
    expect(within(d).getByRole('button', { name: /Submit/ })).toBeDisabled();
    fireEvent.click(b);
    expect(within(d).getByText('RO pressure PG-B')).toBeInTheDocument();
    await readAndSubmit(d);
    await waitFor(() => expect(sent(api)).toHaveLength(1));
    expect(sent(api)[0]).toMatchObject({ targetState: 'WASH_IN', equipmentGroupId: 'gb', instrumentReadings: { pb: 1 } });
  });

  it('Dry In readings step, two groups, not bound: the dryer-temperature dialog asks for the group too', async () => {
    const temp = (id: string, label: string) => ({ id, instrumentId: label, description: `Dryer temp ${label}`, stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 61, leastCount: 1 });
    const DA = { id: 'da', name: 'Dryer A (oldest)', instruments: [temp('ta', 'TG-A')] };
    const DB = { id: 'db', name: 'Dryer B', instruments: [temp('tb', 'TG-B')] };
    const api = setup({
      state: {
        currentState: 'DRY_IN', tapeVersion: 7, blockChangeStatus: 'MATCH', actions: [],
        currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: null, dryerStartedAt: new Date(Date.now() - 60 * 60_000).toISOString(), dryerDurationMinutes: 10, dryerReadingsSubmitted: false },
        equipmentGroup: DA, blockEquipmentGroups: [DA, DB],
      },
      routes: [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'DRY_IN', actions: [] } }],
    });
    await scanAndSubmit(api, 'DRY_IN', 'North');
    const d = (await screen.findByText('Dryer Temperature Reading')).closest('.bg-white') as HTMLElement;
    expect(within(d).getByText('Select Equipment Group:')).toBeInTheDocument();
    expect(within(d).queryByText('Dryer temp TG-A')).toBeNull();
    fireEvent.click(within(d).getByRole('button', { name: /Dryer B/ }));
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: '60' } });
    fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(sent(api)).toHaveLength(1));
    expect(sent(api)[0]).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', equipmentGroupId: 'db', instrumentReadings: { tb: 60 } });
  });

  it('one active group (unchanged): no choice, that group is used', async () => {
    const api = setup({ state: atWashIn({}, { equipmentGroup: GA, blockEquipmentGroups: [GA] }), routes: [advanceRoute] });
    await scanAndSubmit(api, 'WASH_IN', 'North');
    await screen.findByText('Equipment & Pressure Readings');
    const d = dialog();
    expect(within(d).queryByText('Select Equipment Group:')).toBeNull();
    // the dialog preselects its group in an effect, a render after it opens
    expect(await within(d).findByText('RO pressure PG-A')).toBeInTheDocument();
    await readAndSubmit(d);
    await waitFor(() => expect(sent(api)).toHaveLength(1));
    expect(sent(api)[0]).toMatchObject({ equipmentGroupId: 'ga', instrumentReadings: { pa: 1 } });
  });

  it('a cycle already bound to a group (unchanged): that group, no choice — even with two groups on the block', async () => {
    const api = setup({ state: atWashIn({ equipmentGroupId: 'gb' }, { equipmentGroup: GB, blockEquipmentGroups: [GA, GB] }), routes: [advanceRoute] });
    await scanAndSubmit(api, 'WASH_IN', 'North');
    await screen.findByText('Equipment & Pressure Readings');
    const d = dialog();
    expect(within(d).queryByText('Select Equipment Group:')).toBeNull();
    expect(await within(d).findByText('RO pressure PG-B')).toBeInTheDocument();
    await readAndSubmit(d);
    await waitFor(() => expect(sent(api)).toHaveLength(1));
    expect(sent(api)[0]).toMatchObject({ equipmentGroupId: 'gb', instrumentReadings: { pb: 1 } });
  });
});
