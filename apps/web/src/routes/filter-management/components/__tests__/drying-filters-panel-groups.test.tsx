/**
 * DryingFiltersPanel — which equipment group a Dry In reading belongs to
 * (operator decision 2026-10-22). Shared by the web Dry In stage and the tablet.
 *
 * A cycle not yet bound to a group, on a block with more than one active group,
 * makes the operator PICK the group on the row. Before, the row silently used the
 * state's `equipmentGroup` — the block's OLDEST group for an unbound cycle — and
 * sent its id with the reading. One group, or a bound cycle, works as before.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role } from '../../__tests__/fm-test-kit';
import { DryingFiltersPanel } from '../drying-filters-panel';

usePageTestLifecycle();

const OPERATOR = role('OPERATOR', ['FILTER_OPERATE']);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const temp = (id: string, label: string, auto = false) => ({ id, instrumentId: label, description: `Dryer temp ${label}`, stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 61, leastCount: 1, ...(auto ? { autoFetchEnabled: true } : {}) });
const DA = { id: 'da', name: 'Dryer A (oldest)', instruments: [temp('ta', 'TG-A')] };
const DB = { id: 'db', name: 'Dryer B', instruments: [temp('tb', 'TG-B')] };
const cycle = (over: Record<string, unknown> = {}) => ({ id: 'c1', cleaningAreaId: 'b1', equipmentGroupId: null, dryerStartedAt: ago(60), dryerDurationMinutes: 10, dryerReadingsSubmitted: false, ...over });

function setup(state: unknown, routes: any[] = []) {
  const api = mockApi([...routes, { path: '/api/filters/f1/current-state', body: state }, ...baseRoutes()]);
  const props = {
    executeOrQueue: vi.fn(async (..._args: any[]) => ({ executed: true })),
    getCache: vi.fn(async () => null),
    cacheData: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onAfterSubmit: vi.fn(),
  };
  renderPage(<DryingFiltersPanel filters={[{ id: 'f1', name: 'FLT-1' }]} online variant="desktop" {...props} />, { user: OPERATOR, api });
  return { ...props, api };
}
const submit = () => screen.getByRole('button', { name: /^Submit/ });
const groupPicker = () => screen.queryByRole('combobox', { name: 'Equipment group for FLT-1' }) as HTMLSelectElement | null;
const ready = () => waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());

describe('DryingFiltersPanel — the equipment group of a Dry In reading', () => {
  it('two groups, cycle not bound: the row asks for the group (nothing preselected); Submit says so; the PICKED group is sent', async () => {
    const s = setup({ currentCycle: cycle(), equipmentGroup: DA, blockEquipmentGroups: [DA, DB] });
    await ready();
    const picker = await waitFor(() => { const p = groupPicker(); expect(p).not.toBeNull(); return p!; });
    expect([...picker.options].map((o) => o.textContent)).toEqual(['Choose equipment group…', 'Dryer A (oldest)', 'Dryer B']);
    expect(picker.value).toBe('');
    // no instrument of a group nobody chose, and not mistaken for a missing instrument
    expect(screen.queryByText('No dryer temperature instrument configured')).toBeNull();
    fireEvent.click(submit());
    expect(s.onError).toHaveBeenCalledWith('Choose the equipment group for: FLT-1');
    expect(s.executeOrQueue).not.toHaveBeenCalled();

    fireEvent.change(picker, { target: { value: 'db' } });
    const shared = await screen.findByDisplayValue('Temperature for selected (°C)');
    fireEvent.change(shared, { target: { value: '60' } });
    await waitFor(() => expect(screen.getAllByRole('combobox').some((c) => (c as HTMLSelectElement).value === '60')).toBe(true));
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ equipmentGroupId: 'db', instrumentReadings: { tb: 60 } });
  });

  it('changing the pick after a fetched value drops that value and reads the new group\'s instrument', async () => {
    const AA = { ...DA, instruments: [temp('ta', 'TG-A', true)] };
    const AB = { ...DB, instruments: [temp('tb', 'TG-B', true)] };
    const s = setup({ currentCycle: cycle(), equipmentGroup: AA, blockEquipmentGroups: [AA, AB] }, [{
      method: 'POST', path: '/api/equipment-groups/fetch-readings',
      body: (r: any) => ({ results: [r.json.groupId === 'da' ? { instrumentId: 'ta', ok: true, value: 60.4 } : { instrumentId: 'tb', ok: true, value: 61 }] }),
    }]);
    await ready();
    const picker = await waitFor(() => { const p = groupPicker(); expect(p).not.toBeNull(); return p!; });
    expect(s.api.calls('POST', '/api/equipment-groups/fetch-readings')).toHaveLength(0); // nothing fetched for an unchosen group
    fireEvent.change(picker, { target: { value: 'da' } });
    expect(await screen.findByText('60.4 °C')).toBeInTheDocument();
    fireEvent.change(groupPicker()!, { target: { value: 'db' } });
    expect(await screen.findByText('61 °C')).toBeInTheDocument();
    expect(screen.queryByText('60.4 °C')).toBeNull();
    expect(s.api.calls('POST', '/api/equipment-groups/fetch-readings').map((c) => c.json.groupId)).toEqual(['da', 'db']);
    // The fetched 61 reaches the panel through the row's report EFFECT, which can
    // still be pending when "61 °C" is on screen; a click in that gap read an empty
    // temperature and was refused "Enter a temperature" (failed once under
    // full-suite load, 2026-10-24). Let pending effects run before clicking.
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(submit()).toBeEnabled());
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ equipmentGroupId: 'db', instrumentReadings: { tb: 61 } });
  });

  it('one group (unchanged): no picker, that group is used', async () => {
    const s = setup({ currentCycle: cycle(), equipmentGroup: DA, blockEquipmentGroups: [DA] });
    await ready();
    expect(groupPicker()).toBeNull();
    fireEvent.change(await screen.findByDisplayValue('Temperature for selected (°C)'), { target: { value: '61' } });
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveValue('61'));
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ equipmentGroupId: 'da', instrumentReadings: { ta: 61 } });
  });

  it('a bound cycle (unchanged): its group, no picker — even with two listed', async () => {
    const s = setup({ currentCycle: cycle({ equipmentGroupId: 'db' }), equipmentGroup: DB, blockEquipmentGroups: [DA, DB] });
    await ready();
    expect(groupPicker()).toBeNull();
    const row = screen.getByText('FLT-1').closest('.flex.items-center') as HTMLElement;
    expect(within(row).getAllByRole('option').map((o) => o.textContent)).toContain('60 °C');
    fireEvent.change(await screen.findByDisplayValue('Temperature for selected (°C)'), { target: { value: '60' } });
    await waitFor(() => expect(screen.getAllByRole('combobox')[0]).toHaveValue('60'));
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ equipmentGroupId: 'db', instrumentReadings: { tb: 60 } });
  });
});
