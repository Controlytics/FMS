import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role, passReauth } from '../../__tests__/fm-test-kit';
import { installFakeIndexedDB, openAppDb, cacheRow } from '../../hooks/__tests__/fake-indexeddb';
import { DryingFiltersPanel } from '../drying-filters-panel';

usePageTestLifecycle();
afterEach(() => { vi.useRealTimers(); });

const OPERATOR = role('OPERATOR', ['FILTER_OPERATE']);
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const TEMP = { id: 't1', instrumentId: 'TG-1', description: 'Dryer Temperature', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 62, leastCount: 1 };
const HUMID = { id: 'h1', instrumentId: 'HG-1', description: 'Dryer humidity', stageKey: 'DRY_IN', uom: '%', operatingMin: 10, operatingMax: 20, leastCount: 1 };
const WASH = { id: 'w1', instrumentId: 'PG-1', description: 'RO pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 1 };
const G = { id: 'g1', name: 'Dryer Bay', instruments: [TEMP, HUMID, WASH] };
const GA = { id: 'ga', name: 'Auto Dryer', instruments: [{ ...TEMP, autoFetchEnabled: true }, { ...HUMID, autoFetchEnabled: true }] };
const cycle = (over: any = {}) => ({ id: 'c1', dryerStartedAt: ago(60), dryerDurationMinutes: 10, dryerReadingsSubmitted: false, ...over });
const state = (over: any = {}, group: any = G) => ({ currentCycle: cycle(over), equipmentGroup: group });

interface Opts {
  filters?: Array<{ id: string; name: string }>;
  states?: Record<string, any>;
  online?: boolean;
  variant?: 'desktop' | 'mobile';
  routes?: MockRoute[];
  reauthActions?: string[];
  executeOrQueue?: any;
  getCache?: any;
}
function setup(o: Opts = {}) {
  const filters = o.filters ?? [{ id: 'f1', name: 'FLT-1' }];
  const states = o.states ?? { f1: state() };
  const api = mockApi([
    ...(o.routes ?? []),
    ...Object.entries(states).map(([id, body]) => ({ path: `/api/filters/${id}/current-state`, body })),
    ...baseRoutes({ reauthActions: o.reauthActions }),
  ]);
  const props = {
    executeOrQueue: o.executeOrQueue ?? vi.fn(async () => ({ executed: true })),
    getCache: o.getCache ?? vi.fn(async () => null),
    cacheData: vi.fn(),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onAfterSubmit: vi.fn(),
  };
  const view = renderPage(
    <DryingFiltersPanel filters={filters} online={o.online ?? true} variant={o.variant ?? 'desktop'} {...props} />,
    { user: OPERATOR, api },
  );
  return { ...props, ...view };
}
const submit = () => screen.getByRole('button', { name: /^Submit/ });

describe('DryingFiltersPanel — list states', () => {
  it('desktop with no filters says so; mobile renders nothing', async () => {
    const d = setup({ filters: [], states: {} });
    expect(screen.getByText('No filters drying in this block')).toBeInTheDocument();
    await waitFor(() => expect(d.api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
    d.unmount();
    const m = setup({ filters: [], states: {}, variant: 'mobile' });
    expect(m.container).toBeEmptyDOMElement();
    await waitFor(() => expect(m.api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
  });

  it('shows each filter with its countdown state: ready, counting down, waiting for dryer start', async () => {
    setup({
      filters: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2', name: 'FLT-2' }, { id: 'f3', name: 'FLT-3' }],
      states: { f1: state(), f2: state({ dryerStartedAt: ago(0), dryerDurationMinutes: 60 }), f3: state({ dryerStartedAt: null }) },
    });
    expect(screen.getByText('Currently Drying (3)')).toBeInTheDocument();
    expect(await screen.findByText('• ready for reading')).toBeInTheDocument();
    expect(await screen.findByText(/30 min until reading/)).toBeInTheDocument();
    expect(await screen.findByText('waiting for dryer start…')).toBeInTheDocument();
    // the single ready row is pre-ticked; the counting-down one cannot be ticked
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    const boxes = screen.getAllByTitle(/Select for submission|Available once/) as HTMLInputElement[];
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1]).toBeDisabled();
    expect(boxes[1].title).toBe('Available once the dryer reaches half time');
  });

  it('mobile shows the m:ss countdown and a progress bar', async () => {
    setup({ variant: 'mobile', states: { f1: state({ dryerStartedAt: ago(0), dryerDurationMinutes: 60 }) } });
    expect(await screen.findByText(/• (29:5\d|30:00) until reading/)).toBeInTheDocument();
    expect(document.querySelector('[style*="width"]')).not.toBeNull();
  });

  it('a ready row whose group has no dryer temperature instrument says so', async () => {
    setup({ states: { f1: state({}, { id: 'g9', name: 'No temp', instruments: [HUMID] }) } });
    expect(await screen.findByText('No dryer temperature instrument configured')).toBeInTheDocument();
  });
});

describe('DryingFiltersPanel — manual temperature + submit', () => {
  it('picks a temperature from the least-count list and records it, with sibling instruments at their minimum', async () => {
    const s = setup();
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    expect(screen.getByText('Pick a temperature to apply it to every selected filter, or set one row on its own.')).toBeInTheDocument();
    const [row, shared] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect([...row.options].map((o) => o.textContent)).toEqual(['°C', '60 °C', '61 °C', '62 °C']);
    expect([...shared.options].map((o) => o.textContent)).toEqual(['Temperature for selected (°C)', '60 °C', '61 °C', '62 °C']);
    fireEvent.change(shared, { target: { value: '61' } });
    await waitFor(() => expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('61'));
    // persisted for the row so a reload keeps it
    expect(s.cacheData).toHaveBeenCalledWith('dryer-temp-f1', 61, 24 * 60 * 60 * 1000);
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalledTimes(1));
    expect(s.executeOrQueue).toHaveBeenCalledWith('advance', 'f1', 'FLT-1', {
      targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', equipmentGroupId: 'g1',
      instrumentReadings: { t1: 61, h1: 10 }, readingSources: { t1: 'MANUAL', h1: 'MANUAL' },
      remarks: 'Dryer temperature 61°C - FLT-1',
    }, 'DRY_IN', undefined);
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete'));
    expect(s.onAfterSubmit).toHaveBeenCalled();
    expect(s.cacheData).toHaveBeenCalledWith('dryer-temp-f1', null, 0);
    // the submitted row leaves the panel
    expect(await screen.findByText('No filters drying in this block')).toBeInTheDocument();
  });

  it('a per-row pick applies to that row only; the cached filter-state is marked submitted', async () => {
    const cached = { currentCycle: { id: 'c1', x: 1 } };
    const getCache = vi.fn(async (k: string) => (k === 'filter-state-f1' ? cached : null));
    const s = setup({ getCache });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '62' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalled());
    expect(s.cacheData).toHaveBeenCalledWith('filter-state-f1', { currentCycle: { id: 'c1', x: 1, dryerReadingsSubmitted: true } });
  });

  it('two ready rows: select all / none; Submit names every selected row still missing a temperature', async () => {
    const s = setup({ filters: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2', name: 'FLT-2' }], states: { f1: state(), f2: state() } });
    await waitFor(() => expect(screen.getByText('0 of 2 ready filter(s) selected')).toBeInTheDocument());
    expect(submit()).toBeDisabled();
    const all = screen.getByRole('checkbox', { name: /Select all ready \(2\)/ }) as HTMLInputElement;
    fireEvent.click(all);
    expect(screen.getByText('2 of 2 ready filter(s) selected')).toBeInTheDocument();
    fireEvent.click(all);
    expect(screen.getByText('0 of 2 ready filter(s) selected')).toBeInTheDocument();
    fireEvent.click(all);
    fireEvent.click(submit());
    expect(s.onError).toHaveBeenCalledWith('Enter a temperature for: FLT-1, FLT-2');
    expect(s.executeOrQueue).not.toHaveBeenCalled();
    // untick one row by hand
    fireEvent.click(screen.getAllByTitle('Select for submission')[1]);
    expect(screen.getByText('1 of 2 ready filter(s) selected')).toBeInTheDocument();
  });

  it('a persisted temperature from an earlier visit is restored', async () => {
    setup({ getCache: vi.fn(async (k: string) => (k === 'dryer-temp-f1' ? 60 : null)) });
    await waitFor(() => expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('60'));
  });

  it('a failed advance is reported per filter and the rest still succeed', async () => {
    const executeOrQueue = vi.fn(async (_k: string, id: string) => {
      if (id === 'f2') throw new Error('Filter is not at Dry In');
      return { executed: true };
    });
    const s = setup({ filters: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2', name: 'FLT-2' }], states: { f1: state(), f2: state() }, executeOrQueue });
    await waitFor(() => expect(screen.getByText('0 of 2 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /Select all ready/ }));
    const boxes = screen.getAllByRole('combobox');
    fireEvent.change(boxes[boxes.length - 1], { target: { value: '60' } }); // the shared box
    fireEvent.click(submit());
    await waitFor(() => expect(s.onError).toHaveBeenCalledWith('1 failed:\nFLT-2: Filter is not at Dry In'));
    expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete');
  });

  it('a cache write failure after a successful advance does not fail the submit', async () => {
    const getCache = vi.fn(async (k: string) => { if (k === 'filter-state-f1') throw new Error('quota'); return null; });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = setup({ getCache });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete'));
    expect(warn).toHaveBeenCalledWith('[drying-panel] cache update failed —', 'quota');
    expect(s.onError).not.toHaveBeenCalled();
  });
});

describe('DryingFiltersPanel — offline', () => {
  it('reads the cycle + the block\'s equipment group from the cache, and a queued submit rewrites the cached tape', async () => {
    const idb = installFakeIndexedDB();
    await openAppDb();
    const { getCachedData, cacheData } = await import('@/lib/offline-store');
    idb.seed('cache', [
      cacheRow('filter-state-f1', { currentState: 'DRY_IN', currentCycle: cycle({ cleaningAreaId: 'b1' }), pipelineStages: [{ stateKey: 'WASH_IN', sortOrder: 1 }, { stateKey: 'DRY_IN', sortOrder: 2 }, { stateKey: 'DRY_OUT', sortOrder: 3 }] }),
      cacheRow('equipment-groups', [{ ...G, id: 'g-other', blockId: 'b2' }, { ...G, blockId: 'b1' }]),
    ]);
    const executeOrQueue = vi.fn(async () => ({ executed: false }));
    const s = setup({ online: false, states: {}, getCache: getCachedData, executeOrQueue });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '62' } });
    // the panel's own cache writes go to IndexedDB too
    s.cacheData.mockImplementation((k: string, v: any, ttl?: number) => cacheData(k, v, ttl));
    fireEvent.click(submit());
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete (1 queued)'));
    expect(s.onError).not.toHaveBeenCalled();
    expect((executeOrQueue.mock.calls[0] as unknown[])[3]).toMatchObject({ equipmentGroupId: 'g1', instrumentReadings: { t1: 62, h1: 10 } });
    // recomputeAndCacheFilterState re-derived the reachable stages, then the panel marked the readings submitted
    await waitFor(() => expect(idb.rows('cache').find((r) => r.key === 'filter-state-f1')?.data.currentCycle?.dryerReadingsSubmitted).toBe(true));
    const row = idb.rows('cache').find((r) => r.key === 'filter-state-f1')!;
    expect(row.data.currentState).toBe('DRY_IN');
    expect(row.data.nextAllowedStages).toEqual(['DRY_OUT']);
    expect(s.api.calls('GET', /current-state/)).toHaveLength(0);
  });

  it('offline without an area uses the only cached equipment group; a single block group is used online', async () => {
    const getCache = vi.fn(async (k: string) => {
      if (k === 'filter-state-f1') return { currentCycle: cycle() };
      if (k === 'equipment-groups') return [G];
      return null;
    });
    const off = setup({ online: false, states: {}, getCache });
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
    off.unmount();
    setup({ states: { f1: { currentCycle: cycle(), blockEquipmentGroups: [G] } } });
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(2));
  });

  it('offline with several cached groups and no area cannot pick one', async () => {
    const getCache = vi.fn(async (k: string) => {
      if (k === 'filter-state-f1') return { currentCycle: cycle() };
      if (k === 'equipment-groups') return [G, { ...G, id: 'g2' }];
      return null;
    });
    setup({ online: false, states: {}, getCache });
    expect(await screen.findByText('No dryer temperature instrument configured')).toBeInTheDocument();
  });

});

describe('DryingFiltersPanel — re-auth', () => {
  it('when Dry In is gated, asks once, verifies the password, and forwards it on every advance', async () => {
    const s = setup({ reauthActions: ['ADVANCE_FILTER_STAGE'], routes: [{ method: 'POST', path: '/api/auth/verify', body: { success: true } }] });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    await waitFor(() => expect(s.api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(submit());
    await passReauth('Secret@123');
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalled());
    expect(s.api.calls('POST', '/api/auth/verify')[0].json).toEqual({ password: 'Secret@123' });
    expect(s.executeOrQueue.mock.calls[0][5]).toBe('Secret@123');
  });

  it('cancelling the password prompt submits nothing and re-enables Submit', async () => {
    const s = setup({ reauthActions: ['STAGE_DRY_IN'] });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    await waitFor(() => expect(s.api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(submit());
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(s.executeOrQueue).not.toHaveBeenCalled();
    expect(s.onError).not.toHaveBeenCalled();
  });

  it('a verify failure that is not a wrong password is reported to the operator', async () => {
    const s = setup({ reauthActions: ['ADVANCE_FILTER_STAGE'], routes: [{ method: 'POST', path: '/api/auth/verify', status: 503, body: { error: 'UNAVAILABLE', message: 'Auth service unavailable' } }] });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    await waitFor(() => expect(s.api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(submit());
    await passReauth('x');
    await waitFor(() => expect(s.onError).toHaveBeenCalledWith('Auth service unavailable'));
    expect(s.executeOrQueue).not.toHaveBeenCalled();
    await waitFor(() => expect(submit()).toBeEnabled());
  });
});

describe('DryingFiltersPanel — instrument auto-fetch', () => {
  // Operator decision 2026-10-22: the screen shows the number that is recorded.
  // A fetched 60.47 on a least-count-1 dryer used to read "60 °C" while 60.47
  // went into the record.
  it('a fetched reading finer than the least count is shown exactly as it is recorded', async () => {
    const s = setup({
      states: { f1: state({}, GA) },
      routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [{ instrumentId: 't1', ok: true, value: 60.47 }, { instrumentId: 'h1', ok: true, value: 14 }] } }],
    });
    // 5 s: the half-time fetch lands after findBy's 1 s default when the full suite loads the machine.
    expect(await screen.findByText('60.47 °C', {}, { timeout: 5_000 })).toBeInTheDocument();
    // The row shows the value from its OWN state; the panel ticks a lone ready row
    // two effect passes later (row report → panel rows → auto-select). Under a
    // loaded run the click landed in between, on a still-disabled Submit, and was
    // lost (seen: disabled=true, onError never called). Act on what the operator
    // needs, as the other submit tests do: the row is ticked and Submit is live.
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    expect(submit()).toBeEnabled();
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalled());
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ instrumentReadings: { t1: 60.47, h1: 14 } });
  });

  it('fetches at half time, shows the value as Auto, lets the operator change it (Auto · changed) and sends both provenances', async () => {
    const s = setup({
      states: { f1: state({}, GA) },
      routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [{ instrumentId: 't1', ok: true, value: 61 }, { instrumentId: 'h1', ok: true, value: 14 }] } }],
    });
    expect(await screen.findByText('61 °C')).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('Temperature fetched from the instrument.')).toBeInTheDocument();
    expect(s.api.calls('POST', '/api/equipment-groups/fetch-readings')[0].json).toEqual({ filterId: 'f1', groupId: 'ga', stageKey: 'DRY_IN' });
    // shared box is a free number input when fetching is on
    expect(screen.getByPlaceholderText('Temperature for selected (°C)')).toBeInTheDocument();
    expect(screen.getByText(/Fetched values fill in on their own at half time/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change value' }));
    const box = within(screen.getByText('FLT-1').closest('.flex.items-center')!.parentElement!).getByPlaceholderText('°C');
    fireEvent.change(box, { target: { value: '62' } });
    expect(await screen.findByText('Auto · changed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('62 °C')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument()); // same race as above
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalled());
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({
      instrumentReadings: { t1: 62, h1: 14 },
      readingSources: { t1: 'AUTO_OVERRIDDEN', h1: 'AUTO' },
    });
  });

  it('the shared number box applies a typed value to every selected row', async () => {
    const s = setup({
      states: { f1: state({}, GA) },
      routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [{ instrumentId: 't1', ok: true, value: 61 }] } }],
    });
    await screen.findByText('61 °C');
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Temperature for selected (°C)'), { target: { value: '62' } });
    expect(await screen.findByText('62 °C')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Temperature for selected (°C)'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('Temperature for selected (°C)'), { target: { value: '61' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalled());
    // h1 not fetched → falls back to its minimum, recorded as MANUAL
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ instrumentReadings: { t1: 61, h1: 10 }, readingSources: { t1: 'AUTO_OVERRIDDEN', h1: 'MANUAL' } });
  });

  it('no value within a minute → the row falls back to the manual dropdown with a status line', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const s = setup({
      states: { f1: state({}, GA) },
      routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [] } }],
    });
    expect(await screen.findByText('No reading yet. Retrying…')).toBeInTheDocument();
    expect(screen.getByText('fetching…')).toBeInTheDocument();
    for (let i = 0; i < 13; i++) await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(await screen.findByText("Couldn't fetch in 1 minute — enter the value manually.")).toBeInTheDocument();
    const row = screen.getAllByRole('combobox');
    expect(row.length).toBeGreaterThanOrEqual(1);
    expect(s.api.calls('POST', '/api/equipment-groups/fetch-readings').length).toBeGreaterThanOrEqual(12);
  });
});

describe('DryingFiltersPanel — edge cases', () => {
  it('a row the server already recorded leaves the panel', async () => {
    setup({ states: { f1: state({ dryerReadingsSubmitted: true }) } });
    expect(await screen.findByText('No filters drying in this block')).toBeInTheDocument();
  });

  it('ticking an unticked ready row adds it to the selection', async () => {
    setup({ filters: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2', name: 'FLT-2' }], states: { f1: state(), f2: state() } });
    await waitFor(() => expect(screen.getByText('0 of 2 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('Select for submission')[0]);
    expect(screen.getByText('1 of 2 ready filter(s) selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit (1)' })).toBeEnabled();
  });

  it('mobile: manual row + shared selects, and a typed row value can be cleared', async () => {
    const s = setup({ variant: 'mobile' });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    const [row, shared] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(row.className).toContain('rounded-xl');
    expect(shared.className).toContain('rounded-xl');
    fireEvent.change(row, { target: { value: '60' } });
    fireEvent.change(row, { target: { value: '' } });
    await waitFor(() => expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe(''));
    fireEvent.click(submit());
    expect(s.onError).toHaveBeenCalledWith('Enter a temperature for: FLT-1');
  });

  it('mobile + auto-fetch: the row and shared boxes are number inputs; clearing the row value empties it', async () => {
    setup({
      variant: 'mobile',
      states: { f1: state({}, GA) },
      routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [{ instrumentId: 't1', ok: true, value: 61 }] } }],
    });
    await screen.findByText('61 °C');
    expect(screen.getByPlaceholderText('Temperature for selected (°C)').className).toContain('rounded-xl');
    fireEvent.click(screen.getByRole('button', { name: 'Change value' }));
    const box = screen.getByPlaceholderText('°C');
    expect(box.className).toContain('rounded-xl');
    fireEvent.change(box, { target: { value: '' } });
    await waitFor(() => expect((screen.getByPlaceholderText('°C') as HTMLInputElement).value).toBe(''));
  });

  it('a stepless temperature instrument (no least count) gets a number box even without auto-fetch', async () => {
    const s = setup({ states: { f1: state({}, { id: 'g5', instruments: [{ ...TEMP, leastCount: 0 }] }) } });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('°C'), { target: { value: '61.4' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.executeOrQueue).toHaveBeenCalled());
    expect(s.executeOrQueue.mock.calls[0][3]).toMatchObject({ instrumentReadings: { t1: 61.4 } });
  });

  it('a throwing cache write while picking a value is ignored (the cache is a convenience)', async () => {
    const s = setup();
    s.cacheData.mockImplementation(() => { throw new Error('quota exceeded'); });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '61' } });
    await waitFor(() => expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('61'));
  });

  it('message-less failures fall back to generic text; a cached state without a cycle gets none written onto it; non-Error cache faults are logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getCache = vi.fn(async (k: string) => {
      if (k === 'filter-state-f1') return { other: 1 };
      if (k === 'filter-state-f2') throw 'idb gone'; // eslint-disable-line no-throw-literal
      return null;
    });
    const executeOrQueue = vi.fn(async (_k: string, id: string) => {
      if (id === 'f3') throw {}; // eslint-disable-line no-throw-literal
      return { executed: true };
    });
    const s = setup({ filters: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2', name: 'FLT-2' }, { id: 'f3', name: 'FLT-3' }], states: { f1: state(), f2: state(), f3: state() }, getCache, executeOrQueue });
    await waitFor(() => expect(screen.getByText('0 of 3 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /Select all ready/ }));
    const boxes = screen.getAllByRole('combobox');
    fireEvent.change(boxes[boxes.length - 1], { target: { value: '60' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.onError).toHaveBeenCalledWith('1 failed:\nFLT-3: failed'));
    expect(s.onSuccess).toHaveBeenCalledWith('2 filter(s) → Dry In complete');
    // 2026-10-22: no cycle is written onto a row that holds none (a closed cycle
    // would be re-opened on this device); the temperature is still cleared.
    expect(s.cacheData.mock.calls.some(([k]: any[]) => k === 'filter-state-f1')).toBe(false);
    expect(s.cacheData).toHaveBeenCalledWith('dryer-temp-f1', null, 0);
    expect(warn).toHaveBeenCalledWith('[drying-panel] cache update failed —', 'idb gone');
  });

  it('a verify refusal with an empty body is reported with the client-side message', async () => {
    const s = setup({ reauthActions: ['ADVANCE_FILTER_STAGE'], routes: [{ method: 'POST', path: '/api/auth/verify', status: 400, body: {} }] });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    await waitFor(() => expect(s.api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(submit());
    await passReauth('x');
    // api-client turns an empty 400 body into "Request failed: 400"
    await waitFor(() => expect(s.onError).toHaveBeenCalledWith('Request failed: 400'));
  });
});

// 2026-10-21 (web coverage F1): /api/auth/verify answers a mistyped password
// with 401 INVALID_PASSWORD. The api-client used to treat every 401 as an ended
// session, so the operator was signed out before the prompt could say so.
describe('DryingFiltersPanel - a wrong password in the sign-once prompt', () => {
  it('stays in the prompt with "Incorrect password" and keeps the session', async () => {
    const G1 = { id: 'g1', instruments: [{ id: 't1', description: 'Dryer Temperature', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 62, leastCount: 1 }] };
    const api = mockApi([
      { method: 'POST', path: '/api/auth/verify', status: 401, body: { error: 'INVALID_PASSWORD', message: 'Password is incorrect' } },
      { path: '/api/filters/f1/current-state', body: { currentCycle: { id: 'c1', dryerStartedAt: ago(60), dryerDurationMinutes: 10 }, equipmentGroup: G1 } },
      ...baseRoutes({ reauthActions: ['ADVANCE_FILTER_STAGE'] }),
    ]);
    const executeOrQueue = vi.fn(async () => ({ executed: true }));
    renderPage(<DryingFiltersPanel filters={[{ id: 'f1', name: 'FLT-1' }]} online variant="desktop" executeOrQueue={executeOrQueue}
      getCache={vi.fn(async () => null) as any} cacheData={vi.fn()} onSuccess={vi.fn()} onError={vi.fn()} />, { user: OPERATOR, api });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }));
    await passReauth('typo-password');
    await waitFor(() => expect(api.calls('POST', '/api/auth/verify')).toHaveLength(1));
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(sessionStorage.getItem('access_token')).toBe('test-token');
    expect(executeOrQueue).not.toHaveBeenCalled();
  });
});

// D8 (2026-10-21): an item counted as queued must not also be reported as failed,
// nor stay selectable for a second (duplicate) reading.
describe('DryingFiltersPanel — a queued reading whose offline-view refresh fails', () => {
  it('is counted once, as queued; the refresh failure is named as such; the row cannot be submitted again', async () => {
    // No IndexedDB here: recomputeAndCacheFilterState re-throws (21 CFR fail-loud).
    const { allowConsoleError } = await import('../../__tests__/fm-test-kit');
    allowConsoleError(/\[offline-cache\] recomputeAndCacheFilterState failed/);
    const getCache = vi.fn(async (k: string) => (k === 'filter-state-f1' ? { currentCycle: cycle(), equipmentGroup: G } : null));
    const executeOrQueue = vi.fn(async () => ({ executed: false }));
    const s = setup({ online: false, states: {}, getCache, executeOrQueue });
    await waitFor(() => expect(screen.getByText('1 of 1 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '60' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete (1 queued)'));
    expect(s.onError).toHaveBeenCalledTimes(1);
    const msg = s.onError.mock.calls[0][0] as string;
    expect(msg).not.toMatch(/failed:/);
    expect(msg).toMatch(/^1 queued, but this device's offline view was not refreshed — do not submit it again; the reading will sync when online:\nFLT-1: /);
    // the reading is in the queue: the row leaves the panel instead of staying selectable
    expect(await screen.findByText('No filters drying in this block')).toBeInTheDocument();
    expect(executeOrQueue).toHaveBeenCalledTimes(1);
    // the reading is still marked submitted in the cache the panel writes, and the stored temperature cleared
    expect(s.cacheData).toHaveBeenCalledWith('filter-state-f1', expect.objectContaining({ currentCycle: expect.objectContaining({ dryerReadingsSubmitted: true }) }));
    expect(s.cacheData).toHaveBeenCalledWith('dryer-temp-f1', null, 0);
  });

  it('with a real failure beside it, one message lists the failure and the unrefreshed queued item separately', async () => {
    const { allowConsoleError } = await import('../../__tests__/fm-test-kit');
    allowConsoleError(/\[offline-cache\] recomputeAndCacheFilterState failed/);
    const getCache = vi.fn(async (k: string) => (k.startsWith('filter-state-') ? { currentCycle: cycle(), equipmentGroup: G } : null));
    const executeOrQueue = vi.fn(async (_k: string, id: string) => {
      if (id === 'f2') throw new Error('Filter is not at Dry In');
      return { executed: false };
    });
    const s = setup({ online: false, filters: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2', name: 'FLT-2' }], states: {}, getCache, executeOrQueue });
    await waitFor(() => expect(screen.getByText('0 of 2 ready filter(s) selected')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /Select all ready/ }));
    const boxes = screen.getAllByRole('combobox');
    fireEvent.change(boxes[boxes.length - 1], { target: { value: '60' } });
    fireEvent.click(submit());
    await waitFor(() => expect(s.onError).toHaveBeenCalledTimes(1));
    expect(s.onSuccess).toHaveBeenCalledWith('1 filter(s) → Dry In complete (1 queued)');
    const msg = s.onError.mock.calls[0][0] as string;
    expect(msg).toMatch(/^1 failed:\nFLT-2: Filter is not at Dry In\n\n1 queued, but this device's offline view was not refreshed/);
    expect(msg).toMatch(/\nFLT-1: /);
    // the failed one stays for another try; the queued one is gone
    await waitFor(() => expect(screen.queryByText('FLT-1')).toBeNull());
    expect(screen.getByText('FLT-2')).toBeInTheDocument();
  });
});
