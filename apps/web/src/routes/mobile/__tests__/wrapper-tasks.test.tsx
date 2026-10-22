/**
 * Tablet shell — My Tasks: period / search / block / area / status filters,
 * the cards, Perform (OQ-05: opens the profile's FIRST station with the block
 * chosen) and the overdue password confirmation (OQ-06). Same boundary fakes as
 * wrapper-shell.test.tsx; the operations page is a stub that prints the props
 * the shell hands it.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { MockRequest } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, seedCache, cachedValue, OPERATOR } from './support/mobile-kit';
import { renderWrapper, gateFetch } from './support/wrapper-harness';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/sync-since', async () => (await import('./support/fakes')).syncSinceModule);
vi.mock('@/lib/offline-sync-service', async (orig) => ({ ...(await orig() as any), syncAllDataForOffline: (await import('./support/fakes')).fakeSyncAllDataForOffline }));
vi.mock('@capacitor/app', async () => (await import('./support/fakes')).capacitorAppModule);
vi.mock('../mobile-operations', () => ({
  MobileOperationsPage: (p: any) => <div data-testid="ops">ops stage={p.initialStageKey} block={p.initialBlockId ?? '-'}</div>,
}));

useMobileLifecycle();

const T1 = { entryId: 'e1', ahuId: 'h1', ahuName: 'AHU-01', areaId: 'a1', areaName: 'Clean Room A', blockId: 'b1', blockName: 'North', overallStatus: 'pending', plannedDate: '2026-10-21', cleanedCount: 1, totalFilters: 2,
  filters: [{ filterId: 'f101', filterName: 'F-101', status: 'cleaned_in_window' }, { filterId: 'f102', filterName: 'F-102', status: 'in_progress', currentStage: 'WASH_OUT' }, { filterId: 'f103', filterName: 'F-103', status: 'pending' }] };
const T2 = { entryId: 'e2', ahuId: 'h2', ahuName: 'AHU-02', areaId: null, blockId: 'b1', blockName: 'North', overallStatus: 'in_progress', plannedDate: '2026-10-21', cleanedCount: 0, totalFilters: 0, filters: [] };
const T3 = { entryId: 'e3', ahuId: 'h3', ahuName: 'AHU-03', areaId: 'a2', areaName: 'Pack Hall', blockId: 'b2', blockName: 'South', overallStatus: 'complete', plannedDate: '2026-10-21', cleanedCount: 2, totalFilters: 2, filters: [] };
const T4 = { entryId: 'e4', ahuId: 'h9', ahuName: 'AHU-09', areaId: null, blockId: null, overallStatus: 'not_performed', skipReason: 'Plant shutdown', plannedDate: '2026-10-21', cleanedCount: 0, totalFilters: 3, filters: [] };
const T5 = { entryId: 'e5', ahuId: 'h8', ahuName: 'AHU-08', areaId: 'a8', blockId: 'b8', overallStatus: 'not_performed', plannedDate: '2026-10-21', cleanedCount: 0, totalFilters: 1, filters: [] };
const O1 = { entryId: 'o1', ahuId: 'h3', ahuName: 'AHU-03', areaId: 'a2', areaName: 'Pack Hall', blockId: 'b2', blockName: 'South', overallStatus: 'overdue', windowEnd: '2026-10-10', cleanedCount: 0, totalFilters: 2, filters: [],
  deviation: { deviationId: 'dev-1', deviationNumber: 'DEV-0042', status: 'OPEN', acknowledged: false, overdueDays: 11 } };
const O2 = { entryId: 'o2', ahuId: 'h7', ahuName: 'AHU-07', overallStatus: 'not_performed', windowEnd: '2026-10-01', cleanedCount: 0, totalFilters: 1, filters: [] };
const DUE = { tasks: [T1, T2, T3, T4, T5], overdue: [O1, O2] };

const DRY_FIRST = {
  stages: [{ id: 's', nodeType: 'START' }, { id: 'di', nodeType: 'STAGE', stateKey: 'DRY_IN' }, { id: 'e', nodeType: 'END' }],
  connections: [{ fromStageId: 's', toStageId: 'di' }, { fromStageId: 'di', toStageId: 'e' }],
};
const ASSIGN = { mode: 'BY_AHU', rules: [{ matchValue: 'h1', profileId: 'p1' }, { matchValue: 'h3', profileId: 'p3' }] };

async function openTasks(o: Parameters<typeof renderWrapper>[0] = {}) {
  const view = renderWrapper({ due: DUE, assignment: ASSIGN, ...o });
  fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
  await screen.findByRole('heading', { name: 'My Tasks' });
  return view;
}
const ahuNames = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent).filter((t) => /^AHU-/.test(t ?? ''));
const toggle = (label: string) => screen.getAllByRole('button').find((b) => b.firstElementChild?.textContent === label)!;
const card = (ahu: string, i = 0) => screen.getAllByRole('heading', { name: ahu })[i].closest('div.bg-white')! as HTMLElement;

describe('My Tasks — list', () => {
  it('shows due and overdue tasks with status, progress and the right action per state', async () => {
    const { api } = await openTasks();
    await waitFor(() => expect(ahuNames()).toEqual(['AHU-01', 'AHU-02', 'AHU-03', 'AHU-09', 'AHU-08', 'AHU-03', 'AHU-07']));
    expect(api.calls('GET', '/api/pm-schedules/due')[0].url).toBe('/api/pm-schedules/due');
    expect(card('AHU-01')).toHaveTextContent('Pending');
    expect(card('AHU-01')).toHaveTextContent('1/2 cleaned');
    expect(card('AHU-01')).toHaveTextContent('21/10/2026 • 1/2 cleaned'); // the planned DATE, in the configured format
    expect(card('AHU-01').querySelector('[style*="width: 50%"]')).not.toBeNull();
    expect(within(card('AHU-01')).getByRole('button', { name: 'Perform →' })).toBeInTheDocument();
    expect(card('AHU-02')).toHaveTextContent('In Progress');
    expect(card('AHU-03')).toHaveTextContent('Complete');
    expect(within(card('AHU-03')).queryByRole('button', { name: /Perform/ })).toBeNull();
    expect(card('AHU-03')).toHaveTextContent('Completed');
    expect(card('AHU-09')).toHaveTextContent('Not performed — Plant shutdown');
    expect(card('AHU-08')).toHaveTextContent(/Not performed$/);
    expect(within(card('AHU-09')).queryByRole('button', { name: /Perform/ })).toBeNull();
    expect(screen.getByText('Overdue', { selector: 'h3' })).toBeInTheDocument();
    expect(card('AHU-03', 1)).toHaveTextContent('Window closed 10/10/2026 • 0/2 cleaned');
    expect(within(card('AHU-03', 1)).getByRole('button', { name: 'Perform (overdue) →' })).toBeInTheDocument();
    expect(card('AHU-07')).toHaveTextContent('Not performed');
    expect(within(card('AHU-07')).queryByRole('button')).toBeNull();
  });

  it('a card expands to its filters (or says it has none)', async () => {
    await openTasks();
    const head = await screen.findByRole('heading', { name: 'AHU-01' });
    fireEvent.click(head.closest('button')!);
    const chips = within(card('AHU-01'));
    expect(chips.getByText('F-101').className).toContain('emerald');
    expect(chips.getByText('F-102').className).toContain('cyan');
    expect(chips.getByText('F-103').className).toContain('amber');
    // the status is written out, not only coloured; a filter mid-cycle names its stage
    expect(chips.getByText('F-101')).toHaveTextContent('F-101· Cleaned');
    expect(chips.getByText('F-102')).toHaveTextContent('F-102· Wash Out· In progress');
    expect(chips.getByText('F-103')).toHaveTextContent('F-103· Pending');
    fireEvent.click(head.closest('button')!);
    expect(within(card('AHU-01')).queryByText('F-101')).toBeNull();
    fireEvent.click(screen.getByRole('heading', { name: 'AHU-02' }).closest('button')!);
    expect(within(card('AHU-02')).getByText('No active child filters.')).toBeInTheDocument();
  });

  it('status toggles count and filter (Pending = pending + in progress; Overdue is its own list)', async () => {
    await openTasks();
    await waitFor(() => expect(ahuNames()).toHaveLength(7));
    expect(toggle('All')).toHaveTextContent('7');
    expect(toggle('Pending')).toHaveTextContent('2');
    expect(toggle('Completed')).toHaveTextContent('1');
    expect(toggle('Overdue')).toHaveTextContent('2');
    fireEvent.click(toggle('Pending'));
    expect(ahuNames()).toEqual(['AHU-01', 'AHU-02']);
    fireEvent.click(toggle('Completed'));
    expect(ahuNames()).toEqual(['AHU-03']);
    fireEvent.click(toggle('Overdue'));
    expect(ahuNames()).toEqual(['AHU-03', 'AHU-07']);
    expect(toggle('Overdue').className).toContain('bg-rose-600');
    fireEvent.click(toggle('All'));
    expect(ahuNames()).toHaveLength(7);
  });

  it('search matches AHU, block or area; block and area dropdowns cascade; Clear all resets', async () => {
    await openTasks();
    await waitFor(() => expect(ahuNames()).toHaveLength(7));
    fireEvent.change(screen.getByPlaceholderText('Search AHU, block or area…'), { target: { value: 'pack' } });
    expect(ahuNames()).toEqual(['AHU-03', 'AHU-03']);
    fireEvent.change(screen.getByPlaceholderText('Search AHU, block or area…'), { target: { value: 'NORTH' } });
    expect(ahuNames()).toEqual(['AHU-01', 'AHU-02']);
    fireEvent.change(screen.getByPlaceholderText('Search AHU, block or area…'), { target: { value: 'ahu-09' } });
    expect(ahuNames()).toEqual(['AHU-09']);
    fireEvent.change(screen.getByPlaceholderText('Search AHU, block or area…'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    const blockSel = screen.getByText('Block', { selector: 'label' }).parentElement!.querySelector('select')!;
    const areaSel = screen.getByText('Area', { selector: 'label' }).parentElement!.querySelector('select')!;
    expect([...blockSel.options].map((o) => o.textContent)).toEqual(['All blocks', 'b8', 'North', 'South']);
    expect([...areaSel.options].map((o) => o.textContent)).toEqual(['All areas', 'a8', 'Clean Room A', 'Pack Hall']);
    fireEvent.change(blockSel, { target: { value: 'b2' } });
    expect([...areaSel.options].map((o) => o.textContent)).toEqual(['All areas', 'Pack Hall']);
    expect(ahuNames()).toEqual(['AHU-03', 'AHU-03']);
    fireEvent.change(areaSel, { target: { value: 'a2' } });
    expect(ahuNames()).toEqual(['AHU-03', 'AHU-03']);
    fireEvent.change(blockSel, { target: { value: 'b1' } }); // a block change clears the area
    expect(areaSel.value).toBe('');
    fireEvent.change(areaSel, { target: { value: 'a1' } });
    expect(ahuNames()).toEqual(['AHU-01']);
    fireEvent.click(toggle('Completed'));
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting or clearing the filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(ahuNames()).toHaveLength(7);
    expect(screen.queryByRole('button', { name: 'Clear all filters' })).toBeNull();
  });

  it('a period asks the server for that window, and only the unfiltered answer is kept for offline', async () => {
    const { api } = await openTasks({ routes: [{ path: '/api/pm-schedules/due', body: (r: MockRequest) => (r.query.get('from') ? { tasks: [T3], overdue: [] } : DUE) }] });
    await waitFor(() => expect(cachedValue('due-tasks')?.tasks).toHaveLength(5));
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText('Tasks from date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Tasks to date'), { target: { value: '2026-10-31' } });
    await waitFor(() => expect(ahuNames()).toEqual(['AHU-03']));
    const last = api.calls('GET', '/api/pm-schedules/due').at(-1)!;
    expect(last.query.get('from')).toBe('2026-10-01');
    expect(last.query.get('to')).toBe('2026-10-31');
    await flush(60);
    expect(cachedValue('due-tasks')?.tasks).toHaveLength(5); // the period result did not overwrite it
  });

  it('nothing due', async () => {
    await openTasks({ due: { tasks: [], overdue: [] } });
    expect(await screen.findByText('Nothing due right now')).toBeInTheDocument();
    expect(screen.getByText('Tasks appear when a schedule window opens')).toBeInTheDocument();
  });

  it('loading shows placeholders', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const view = renderWrapper({ due: DUE, beforeRender: () => gateFetch('/api/pm-schedules/due', gate) });
    fireEvent.click(await screen.findByRole('button', { name: /My Tasks/ }));
    await waitFor(() => expect(document.querySelectorAll('.animate-pulse').length).toBe(3));
    release();
    await flush(60);
    view.unmount();
  });

  it('offline: the cached list, a connection notice, and a date period that cannot be used', async () => {
    await seedCache({ 'due-tasks': { tasks: [T1], overdue: [] } });
    await openTasks({ online: false });
    expect(await screen.findByText('My Tasks requires an internet connection.')).toBeInTheDocument();
    await waitFor(() => expect(ahuNames()).toEqual(['AHU-01']));
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByText('Date period needs an internet connection.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tasks from date')).toBeDisabled();
  });

  it('offline with nothing cached shows only the connection notice', async () => {
    await openTasks({ online: false });
    expect(await screen.findByText('My Tasks requires an internet connection.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Filters/ })).toBeNull();
    expect(screen.getByText('Nothing due right now')).toBeInTheDocument();
  });
});

describe('My Tasks — Perform (OQ-05)', () => {
  it('opens the profile\'s FIRST station (Dry In here, not Wash In) with the task\'s block chosen', async () => {
    const { api } = await openTasks({ routes: [{ path: '/api/filter-cleaning-profiles/p1', body: DRY_FIRST }] });
    fireEvent.click(within(card('AHU-01')).getByRole('button', { name: 'Perform →' }));
    expect(await screen.findByTestId('ops')).toHaveTextContent('ops stage=DRY_IN block=b1');
    expect(screen.getByText('Ready to clean filters from AHU-01. Scan each filter now.', { exact: false })).toBeInTheDocument();
    expect(api.calls('GET', '/api/filter-cleaning-profiles/p1')).toHaveLength(1);
  });

  it('falls back to the cached profile when the live read fails', async () => {
    await seedCache({ 'active-profile-p1': DRY_FIRST });
    await openTasks({ routes: [{ path: '/api/filter-cleaning-profiles/p1', status: 500, body: { error: 'X', message: 'boom' } }] });
    fireEvent.click(within(card('AHU-01')).getByRole('button', { name: 'Perform →' }));
    expect(await screen.findByTestId('ops')).toHaveTextContent('ops stage=DRY_IN block=b1');
  });

  it('when the first station cannot be told it returns Home and asks the operator to choose', async () => {
    await openTasks({ routes: [{ path: '/api/filter-cleaning-profiles/p1', status: 404, body: { error: 'NOT_FOUND', message: 'x' } }] });
    fireEvent.click(within(card('AHU-02')).getByRole('button', { name: 'Perform →' })); // AHU-02 has no rule
    expect(await screen.findByText(/Ready to clean filters from AHU-02 — choose its first station below\./)).toBeInTheDocument();
    expect(screen.getByText('Scan stations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /My Tasks/ }));
    fireEvent.click(within(card('AHU-01')).getByRole('button', { name: 'Perform →' })); // rule, but no profile anywhere
    expect(await screen.findByText(/Ready to clean filters from AHU-01 — choose its first station below\./)).toBeInTheDocument();
  });

  it('offline it resolves from the cached assignment + cached profile, without the server', async () => {
    await seedCache({ 'due-tasks': { tasks: [T1], overdue: [] }, 'cleaning-profile-assignment': ASSIGN, 'cleaning-profile-p1': DRY_FIRST });
    const { api } = await openTasks({ online: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Perform →' }));
    expect(await screen.findByTestId('ops')).toHaveTextContent('ops stage=DRY_IN block=b1');
    expect(api.calls('GET', /\/api\/filter-cleaning-profiles\//)).toHaveLength(0);
  });

  it('an unreadable cache offline falls back to the station picker', async () => {
    await seedCache({ 'due-tasks': { tasks: [T1], overdue: [] } });
    await openTasks({ online: false });
    const btn = await screen.findByRole('button', { name: 'Perform →' });
    vi.stubGlobal('indexedDB', undefined);
    fireEvent.click(btn);
    expect(await screen.findByText(/choose its first station below/)).toBeInTheDocument();
  });

  it('online the assignment is cached for offline Perform', async () => {
    await openTasks();
    await waitFor(() => expect(cachedValue('cleaning-profile-assignment')).toEqual(ASSIGN));
  });
});

describe('My Tasks — overdue confirmation (OQ-06)', () => {
  const ACK_USER = { ...OPERATOR, permissions: [...OPERATOR.permissions!, 'PM_EXECUTE'] };

  it('an overdue task with an open deviation asks for the password; Confirm signs, refreshes and then performs', async () => {
    const { api } = await openTasks({
      user: ACK_USER,
      routes: [
        { method: 'POST', path: '/api/pm-schedules/deviations/dev-1/acknowledge', body: { ok: true } },
        { path: '/api/filter-cleaning-profiles/p3', body: DRY_FIRST },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Perform (overdue) →' }));
    const dlg = await screen.findByRole('dialog', { name: 'Overdue cleaning confirmation' });
    expect(dlg).toHaveTextContent('These AHU-03 filters are already overdue by 11 days (2 filters).');
    expect(dlg).toHaveTextContent('Deviation DEV-0042');
    const dueBefore = api.calls('GET', '/api/pm-schedules/due').length;
    fireEvent.change(within(dlg).getByLabelText('Password'), { target: { value: 'Secret@123' } });
    fireEvent.click(within(dlg).getByRole('button', { name: /Confirm & Continue/ }));
    expect(await screen.findByTestId('ops')).toHaveTextContent('ops stage=DRY_IN block=b2');
    const ack = api.calls('POST', '/api/pm-schedules/deviations/dev-1/acknowledge')[0];
    expect(ack.headers['x-reauth-password']).toBe('Secret@123');
    expect(api.calls('GET', '/api/pm-schedules/due').length).toBeGreaterThan(dueBefore);
  });

  it('Cancel closes it without performing; a role that cannot acknowledge sees no Confirm', async () => {
    await openTasks();
    fireEvent.click(await screen.findByRole('button', { name: 'Perform (overdue) →' }));
    const dlg = await screen.findByRole('dialog', { name: 'Overdue cleaning confirmation' });
    expect(within(dlg).queryByRole('button', { name: /Confirm/ })).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: 'My Tasks' })).toBeInTheDocument();
  });

  it('offline there is no server to sign against, so Perform proceeds without asking', async () => {
    await seedCache({ 'due-tasks': { tasks: [], overdue: [O1] }, 'cleaning-profile-assignment': ASSIGN, 'active-profile-p3': DRY_FIRST });
    await openTasks({ online: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Perform (overdue) →' }));
    expect(await screen.findByTestId('ops')).toHaveTextContent('ops stage=DRY_IN block=b2');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an acknowledged deviation does not ask again', async () => {
    const acked = { ...O1, deviation: { ...O1.deviation, acknowledged: true } };
    await openTasks({ due: { tasks: [], overdue: [acked] }, routes: [{ path: '/api/filter-cleaning-profiles/p3', body: DRY_FIRST }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Perform (overdue) →' }));
    expect(await screen.findByTestId('ops')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
