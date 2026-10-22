/**
 * Tablet operations page — starting cycles: the Cleaning Reason dialog, the
 * Equipment Readings dialog (incl. "Get Values" auto-fetch), the missed-PM
 * question online (409) and offline (cached map), and batch starts through
 * ONE /bulk-operate. Same boundaries as ops-scan-queue.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { MockRequest, MockRoute } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, queuedOps, passReauth, cancelReauth, cachedValue } from './support/mobile-kit';
import {
  renderOps, scanTag, inQueue, adv, graph, bulkItems, submitButton, message, dismissAll, submitChecklist,
  OPS_INSTANCES, F1, F3, CHECKLIST_PROFILE,
} from './support/ops-harness';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

const offlineFetch = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
const NO_CYCLE = (keys: string[], over: any = {}) => ({ currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(keys), homeBlock: { id: 'b1', name: 'North' }, blockChangeStatus: 'MATCH', ...over });
/** Instances where the given filters have NO cycle (the batch submit reads this). */
const instancesWithoutCycle = (...ids: string[]): MockRoute => ({ path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (ids.includes(i.id) ? { ...i, currentCycleId: null, currentLifecycleState: null } : i)) } });
const GROUP_W = { id: 'gw', name: 'Wash Bay', blockId: 'b1', instruments: [
  { id: 'ro', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 0.5 },
  { id: 'ca', description: 'Compressed air', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 4, operatingMax: 6, leastCount: 1, autoFetchEnabled: true },
  { id: 'dt', description: 'Dryer temp', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 70, leastCount: 1 },
] };
/** start-cycle + current-state + advance, as the server answers a start-and-advance. */
const startRoutes = (id: string, afterActions: any[] = [adv('WASH_OUT')]): MockRoute[] => [
  { method: 'POST', path: `/api/filters/${id}/start-cycle`, status: 201, body: { id: `new-${id}` } },
  { path: `/api/filters/${id}/current-state`, body: { currentState: null, tapeVersion: 11, actions: [], currentCycle: { id: `new-${id}`, status: 'IN_PROGRESS' } } },
  { method: 'POST', path: `/api/filters/${id}/advance`, body: { currentState: 'WASH_IN', tapeVersion: 12, actions: afterActions } },
];
async function toReasonDialog(stage = 'WASH_IN', block = 'North') {
  if (stage === 'WASH_IN' || stage === 'DRY_IN') fireEvent.click(await screen.findByRole('button', { name: block }));
  fireEvent.click(submitButton());
  return screen.findByText('Cleaning Reason');
}
const reasonBtn = (name: RegExp) => screen.getByRole('button', { name });
/** The missed-PM dialog's own Cancel (the reason dialog's Cancel is also on screen). */
async function cancelPmQuestion() {
  const save = await screen.findByRole('button', { name: 'Save reasons & start cleaning' });
  fireEvent.click(within(save.parentElement!).getByRole('button', { name: 'Cancel' }));
}
const startBtn = () => screen.getByRole('button', { name: 'Start' });

describe('Cleaning Reason dialog', () => {
  it('Start needs a reason; a reason that needs justification needs 10+ characters; Cancel closes', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT']) } });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    expect(startBtn()).toBeDisabled();
    fireEvent.click(reasonBtn(/Breakdown/));
    expect(screen.getByText('Requires justification')).toBeInTheDocument();
    const just = screen.getByPlaceholderText('Justification (min 10 chars)');
    fireEvent.change(just, { target: { value: 'too short' } });
    expect(startBtn()).toBeDisabled();
    fireEvent.change(just, { target: { value: 'Fan bearing seized' } });
    expect(startBtn()).toBeEnabled();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    expect(screen.queryByPlaceholderText('Justification (min 10 chars)')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
  });

  it('a filter due for PM opens the dialog on the PM reason, with the PM banner (as the desktop page does)', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT', 'STORAGE_IN'], { isPmDue: true, pmReasonKey: 'PM' }) }, routes: startRoutes('f3') });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    expect(screen.getByText(/This filter is in the/)).toHaveTextContent('This filter is in the PM schedule. Reason defaults to PM — confirm to continue, or pick another reason.');
    expect(screen.getByText('A non-PM reason will leave this task pending in My Tasks.')).toBeInTheDocument();
    expect(reasonBtn(/Preventive Maintenance/).className).toContain('border-cyan-500'); // preselected
    fireEvent.click(startBtn()); // confirm as-is
    expect(await message('F-003 → WASH OUT')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[0].json.cleaningReasonKey).toBe('PM');
  });

  it('a filter not due for PM: no banner, nothing preselected', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT', 'STORAGE_IN']) } });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    expect(screen.queryByText(/This filter is in the/)).toBeNull();
    expect(reasonBtn(/Preventive Maintenance/).className).not.toContain('border-cyan-500');
    await flush();
  });

  it('a single start (no equipment) posts start-cycle then advance with the fresh tape, and reports it', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT', 'STORAGE_IN']) }, routes: startRoutes('f3') });
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.change(screen.getByPlaceholderText('Remarks (optional)'), { target: { value: 'night shift' } });
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Breakdown/));
    fireEvent.change(screen.getByPlaceholderText('Justification (min 10 chars)'), { target: { value: 'Fan bearing seized' } });
    fireEvent.click(startBtn());
    expect(await message('F-003 → WASH OUT')).toBeInTheDocument();
    const start = api.calls('POST', '/api/filters/f3/start-cycle')[0].json;
    expect(start).toMatchObject({ cleaningReasonKey: 'BREAKDOWN', cleaningJustification: 'Fan bearing seized', acknowledgeBlockChange: false });
    expect(start.clientOpId).toMatch(/:start$/);
    const advance = api.calls('POST', '/api/filters/f3/advance')[0].json;
    expect(advance).toMatchObject({ targetState: 'WASH_OUT', remarks: 'night shift', tapeVersion: 11 });
    expect(advance.clientOpId).toMatch(/:advance$/);
    await dismissAll();
    // The started filter's reason dialog is done with: it closes.
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
    expect(screen.getByPlaceholderText('Scan RFID tag...')).toBeInTheDocument();
  });

  it('a single start whose first stage asks for a checklist AFTER it is entered hands over to the checklist', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT', 'STORAGE_IN']) }, routes: startRoutes('f3', [submitChecklist('WASH_OUT')]) });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message('F-003 → WASH OUT')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
  });

  it('a start the server refuses keeps the reason dialog\'s payload and shows the reason (2026-10-01)', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT']) }, routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'REPLACEMENT_OVERDUE', message: 'AHU-01 replacement overdue' } },
    ] });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message('AHU-01 replacement overdue')).toBeInTheDocument();
  });

  it('a start into a block the filter does not belong to opens the block dialog instead', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT']) }, routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'BLOCK_CHANGE_REQUIRED', message: 'block', details: { filterId: 'f3', homeBlockId: 'b1', homeBlockName: 'North', requestedBlockId: 'b2', requestedBlockName: 'South' } } },
    ] });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await screen.findByText('Cleaning in a different block')).toBeInTheDocument();
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
  });

  it('a profile that begins with Dry In starts the dryer with the header duration (2026-10-06)', async () => {
    const { api } = await renderOps({ stage: 'DRY_IN', states: { f3: NO_CYCLE(['DRY_IN', 'DRY_OUT']) }, routes: startRoutes('f3') });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.change(screen.getByText(/Duration/).querySelector('select')!, { target: { value: '45' } });
    fireEvent.click(submitButton());
    await screen.findByText('Cleaning Reason');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message('F-003 → DRY IN')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/advance')[0].json).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 45 });
  });

  it('with re-auth on the start is signed (start AND advance carry the password); a dismissed prompt is silent', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', reauthActions: ['START_CLEANING_CYCLE'], states: { f3: NO_CYCLE(['WASH_OUT']) }, routes: startRoutes('f3') });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await cancelReauth();
    await flush(150);
    // D-OPS-8: a dismissed prompt is not an error — no message, nothing sent, the dialog stays
    expect(screen.queryAllByRole('button', { name: 'OK' })).toHaveLength(0);
    expect(screen.getByText('Cleaning Reason')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(0);
    fireEvent.click(startBtn());
    await passReauth();
    expect(await message('F-003 → WASH OUT')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[0].headers['x-reauth-password']).toBe('Secret@123');
    expect(api.calls('POST', '/api/filters/f3/advance')[0].headers['x-reauth-password']).toBe('Secret@123');
  });

  it('a first stage with a mandatory checklist is NOT started until the checklist is answered (dialog-first)', async () => {
    const g = graph(['WASH_OUT', 'STORAGE_IN'], { stage: 'WASH_OUT', profileId: 'cl1' });
    const { api } = await renderOps({
      stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT'], { pipelineGraph: g }) }, cache: { 'checklist-profiles': [CHECKLIST_PROFILE] },
      routes: [
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: {} },
        { path: '/api/filters/f3/current-state', body: { tapeVersion: 21 } },
        { method: 'POST', path: '/api/filters/f3/advance-with-checklist', body: { currentState: 'WASH_OUT', tapeVersion: 22, actions: [] } },
      ],
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(0); // nothing written yet
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    expect(await message('Checklist submitted')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[0].json).toMatchObject({ cleaningReasonKey: 'PM' });
    expect(api.calls('POST', '/api/filters/f3/advance-with-checklist')[0].json).toMatchObject({
      targetState: 'WASH_OUT', answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 }, tapeVersion: 21,
    });
  });
});

describe('a signed checklist (SUBMIT_CHECKLIST_WITH_SIGNATURE)', () => {
  it('a dismissed password prompt is silent; the checklist stays open and nothing is written', async () => {
    const g = graph(['WASH_OUT', 'STORAGE_IN'], { stage: 'WASH_OUT', profileId: 'cl1' });
    const { api } = await renderOps({
      stage: 'WASH_OUT', reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      states: { f3: NO_CYCLE(['WASH_OUT'], { pipelineGraph: g }) }, cache: { 'checklist-profiles': [CHECKLIST_PROFILE] },
      routes: [
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: {} },
        { path: '/api/filters/f3/current-state', body: { tapeVersion: 21 } },
        { method: 'POST', path: '/api/filters/f3/advance-with-checklist', body: { currentState: 'WASH_OUT', tapeVersion: 22, actions: [] } },
      ],
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await cancelReauth();
    await flush(150);
    expect(screen.queryAllByRole('button', { name: 'OK' })).toHaveLength(0);
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit Checklist' })).toBeEnabled();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await passReauth();
    expect(await message('Checklist submitted')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/advance-with-checklist')[0].headers['x-reauth-password']).toBe('Secret@123');
  });
});

describe('the missed-PM question (2026-10-01)', () => {
  const PM_TASK = { entryId: 'pm1', ahuName: 'AHU-01', plannedDate: '2026-09-15', windowStart: '2026-09-10', windowEnd: '2026-09-20', overdueDays: 31 };
  const answer = async (text: string) => fireEvent.change(await screen.findByPlaceholderText('Why was this scheduled cleaning not done?'), { target: { value: text } });

  it('online: the 409 carries the visits; the reasons are sent with a retried START', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT']) }, routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, times: 1, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK], minReasonLength: 5 } } },
      ...startRoutes('f3'),
    ] });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    const save = await screen.findByRole('button', { name: 'Save reasons & start cleaning' });
    expect(save).toBeDisabled();
    await answer('Plant shutdown in Sept');
    fireEvent.click(save);
    expect(await message('F-003 → WASH OUT')).toBeInTheDocument();
    const starts = api.calls('POST', '/api/filters/f3/start-cycle');
    expect(starts).toHaveLength(2);
    expect(starts[1].json.pmSkips).toEqual([{ entryId: 'pm1', reason: 'Plant shutdown in Sept' }]);
  });

  it('online: dismissing the question shows the server\'s refusal and starts nothing', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE(['WASH_OUT']) }, routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK] } } },
    ] });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await cancelPmQuestion();
    expect(await message('An earlier PM is pending')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/advance')).toHaveLength(0);
  });

  it('offline: asked from the cached map; the reasons ride in the queued START; dismissing queues nothing', async () => {
    const cache = {
      'identifier-map': { E3: { filterId: 'f3', filterName: 'F-003' } },
      'pm-pending-tasks-map': { h1: [PM_TASK] },
      'filter-state-f3': NO_CYCLE(['WASH_OUT', 'STORAGE_IN']),
      'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
    };
    // Every step here waits on IndexedDB reads (the cached PM map, the queue), which
    // a loaded full-suite run slows well past the default wait: give them room.
    const LOAD_SAFE = { timeout: 15_000 };
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [F3], cache });
    offlineFetch();
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    const save = () => screen.findByRole('button', { name: 'Save reasons & start cleaning' }, LOAD_SAFE);
    fireEvent.click(within((await save()).parentElement!).getByRole('button', { name: 'Cancel' })); // the question's own Cancel
    await flush();
    expect(queuedOps()).toHaveLength(0);
    // ask again
    fireEvent.click(startBtn());
    fireEvent.change(await screen.findByPlaceholderText('Why was this scheduled cleaning not done?', {}, LOAD_SAFE), { target: { value: 'Was on leave' } });
    fireEvent.click(await save());
    expect(await screen.findByText('F-003 → WASH OUT (queued)', { selector: 'p' }, LOAD_SAFE)).toBeInTheDocument();
    await dismissAll();
    expect(screen.queryByText('Cleaning Reason')).toBeNull(); // a queued start closes it too
    const op = queuedOps()[0];
    expect(op.type).toBe('start-and-advance');
    expect(op.payload.cyclePayload.pmSkips).toEqual([{ entryId: 'pm1', reason: 'Was on leave' }]);
    expect(cachedValue('pm-pending-tasks-map')).toEqual({}); // not asked again this session
  });

  it('batch: a start refused for a missed PM asks ONCE and re-sends only the refused filters', async () => {
    let first = true;
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: NO_CYCLE(['WASH_OUT']), f3: NO_CYCLE(['WASH_OUT']) },
      routes: [
        instancesWithoutCycle('f1'),
        { path: '/api/pm-schedules/pending-tasks-map', body: { h1: [PM_TASK] } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => {
          const res = (r.json.items as any[]).map((it) => (first && it.filterId === 'f3'
            ? { clientOpId: it.clientOpId, filterId: it.filterId, status: 'failed', error: { code: 'PM_PREVIOUS_TASK_PENDING', message: 'PM pending' } }
            : { clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: { actions: [], tapeVersion: 2 } }));
          first = false;
          return { results: res };
        } },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await answer('Shutdown week');
    fireEvent.click(await screen.findByRole('button', { name: 'Save reasons & start cleaning' }));
    expect(await message('Started 2 cycle(s)')).toBeInTheDocument();
    expect(bulkItems(api, 0).map((i: any) => [i.filterId, i.kind])).toEqual([['f1', 'start-and-advance'], ['f3', 'start-and-advance']]);
    const retry = bulkItems(api, 1);
    expect(retry.map((i: any) => i.filterId)).toEqual(['f3']);
    expect(retry[0].cyclePayload.pmSkips).toEqual([{ entryId: 'pm1', reason: 'Shutdown week' }]);
  });
});

describe('batch starts — one reason for the whole queue', () => {
  it('online without equipment: ONE bulk start-and-advance; a same-checklist batch then answers ONE dialog', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: NO_CYCLE(['WASH_OUT']), f3: NO_CYCLE(['WASH_OUT']) },
      routes: [
        instancesWithoutCycle('f1'),
        { method: 'POST', path: '/api/filters/bulk-operate', times: 1, body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => ({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: { actions: [submitChecklist('WASH_OUT')], tapeVersion: 5 } })) }) },
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => ({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: { actions: [], tapeVersion: 6 } })) }) },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message('Started 2 cycle(s)')).toBeInTheDocument();
    await dismissAll();
    const starts = bulkItems(api, 0);
    expect(starts.map((i: any) => [i.filterId, i.kind, i.cyclePayload.cleaningReasonKey, i.advancePayload.targetState])).toEqual([
      ['f1', 'start-and-advance', 'PM', 'WASH_OUT'], ['f3', 'start-and-advance', 'PM', 'WASH_OUT'],
    ]);
    expect(screen.getByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument(); // ONE checklist for both
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    expect(await message('Checklist submitted for 2 filter(s)')).toBeInTheDocument();
    const sub = bulkItems(api, 1);
    expect(sub.map((i: any) => [i.filterId, i.kind, i.payload.answers, i.payload.expectedProfileVersions])).toEqual([
      ['f1', 'submit-checklist', { q1: 'Yes' }, { cl1: 3 }], ['f3', 'submit-checklist', { q1: 'Yes' }, { cl1: 3 }],
    ]);
  });

  it('online without equipment: partial failures are listed; a transport failure and a cancelled password start nothing', async () => {
    const fail = (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => (it.filterId === 'f3'
      ? { clientOpId: it.clientOpId, filterId: 'f3', status: 'failed', error: { code: 'CYCLE_ACTIVE', message: 'Already has a cycle' } }
      : { clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: null })) });
    const { api } = await renderOps({
      stage: 'WASH_OUT', reauthActions: ['STAGE_WASH_OUT'],
      states: { f1: NO_CYCLE(['WASH_OUT']), f3: NO_CYCLE(['WASH_OUT']) },
      routes: [
        instancesWithoutCycle('f1'),
        { method: 'POST', path: '/api/filters/bulk-operate', status: 503, times: 1, body: { error: 'DOWN', message: 'down' } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: fail },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await cancelReauth();
    await flush();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    fireEvent.click(startBtn());
    await passReauth();
    expect(await message('Could not reach the server to start the cycles. Please try again.')).toBeInTheDocument();
    await dismissAll();
    fireEvent.click(startBtn());
    await passReauth();
    expect(await message('F-003: Already has a cycle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('Started 1 cycle(s)')).toBeInTheDocument();
  });

  it('offline without equipment: each start is queued; the dialog closes', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(['WASH_OUT', 'STORAGE_IN']), 'filter-state-f3': NO_CYCLE(['WASH_OUT', 'STORAGE_IN']),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
      },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message('Queued 2 cycle(s)')).toBeInTheDocument();
    expect(queuedOps().map((o) => [o.type, o.filterId])).toEqual([['start-and-advance', 'f1'], ['start-and-advance', 'f3']]);
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
  });

  it('offline without equipment: a start the server refuses is listed and not counted as queued', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(['WASH_OUT', 'STORAGE_IN']), 'filter-state-f3': NO_CYCLE(['WASH_OUT', 'STORAGE_IN']),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
      },
    });
    // A flapping link: F-001's start reaches the server and is refused.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/filters/f1/start-cycle')) {
        return new Response(JSON.stringify({ error: 'REPLACEMENT_OVERDUE', message: 'AHU-01 replacement overdue' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      throw new TypeError('Failed to fetch');
    }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog('WASH_OUT');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message('F-001: AHU-01 replacement overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' })); // messages queue: the refusal first
    expect(await message('Queued 1 cycle(s)')).toBeInTheDocument();
    expect(queuedOps().map((o) => o.filterId)).toEqual(['f3']);
  });
});

describe('Equipment Readings dialog (Wash In start)', () => {
  const selectRo = (v: string) => fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: v } });
  const caInput = () => screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('input')! as HTMLInputElement;

  async function toEquipment(o: any = {}) {
    const view = await renderOps({ stage: 'WASH_IN', states: { f3: NO_CYCLE(['WASH_IN', 'WASH_OUT']) }, ...o, routes: [{ path: '/api/equipment-groups/by-block/b1', body: [GROUP_W] }, ...(o.routes ?? [])] });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    await screen.findByText('Cleaning Reason');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    return view;
  }

  it('pick the group, enter readings (steps follow the least count), start with them; the readings recap shows above the checklist', async () => {
    const { api } = await toEquipment({ routes: startRoutes('f3', [submitChecklist('WASH_IN')]) });
    const submit = screen.getByRole('button', { name: 'Submit' });
    expect(submit).toBeDisabled(); // no group yet
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    expect(screen.queryByText('Dryer temp (°C)')).toBeNull();
    expect(submit).toBeDisabled(); // readings missing
    selectRo('1.5');
    fireEvent.change(caInput(), { target: { value: '5' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('WASH IN submitted')).toBeInTheDocument();
    expect(screen.getByText('RO water pressure').nextSibling).toHaveTextContent('1.5 bar');
    expect(screen.getByText('Compressed air').nextSibling).toHaveTextContent('5 bar');
    expect(api.calls('POST', '/api/filters/f3/advance')[0].json).toMatchObject({
      targetState: 'WASH_IN', cleaningAreaId: 'b1', equipmentGroupId: 'gw', instrumentReadings: { ro: 1.5, ca: 5 }, remarks: 'WASH IN - F-003',
    });
    expect(await message('F-003 → WASH IN')).toBeInTheDocument();
  });

  it('with START re-auth on, the readings START is signed, then reported and closed; a cancelled prompt keeps the dialog', async () => {
    const { api } = await toEquipment({ reauthActions: ['START_CLEANING_CYCLE'], routes: startRoutes('f3') });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1');
    fireEvent.change(caInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByPlaceholderText('Enter your password');
    await act(async () => { await cancelReauth(); }); // the handler resumes on the rejection
    await flush(100);
    expect(screen.queryAllByRole('button', { name: 'OK' })).toHaveLength(0); // a dismissed prompt is not an error
    expect(screen.getByText('Equipment Readings')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await passReauth();
    expect(await message('F-003 → WASH IN')).toBeInTheDocument();
    expect(screen.queryByText('Equipment Readings')).toBeNull();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[0].headers['x-reauth-password']).toBe('Secret@123');
    expect(api.calls('POST', '/api/filters/f3/advance')[0].headers['x-reauth-password']).toBe('Secret@123');
    await dismissAll();
  });

  it('an out-of-range reading is flagged and must be confirmed', async () => {
    const { api } = await toEquipment({ routes: startRoutes('f3') });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('2');
    fireEvent.change(caInput(), { target: { value: '9' } });
    expect(screen.getByText('Operating range (4–6 bar) — confirm to submit.')).toBeInTheDocument();
    fireEvent.change(caInput(), { target: { value: 'x' } }); // not a number: cleared
    expect(caInput()).toHaveValue(null);
    fireEvent.change(caInput(), { target: { value: '9' } });
    (window.confirm as any).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((window.confirm as any).mock.calls[0][0]).toContain('• Compressed air: 9 bar (range 4–6)');
    await flush();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('F-003 → WASH IN')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/advance')[0].json.instrumentReadings).toEqual({ ro: 2, ca: 9 });
  });

  it('a refused START keeps the dialog and its payload: the next Submit is still a START, never a bare advance', async () => {
    const { api } = await toEquipment({ routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, times: 1, body: { error: 'REPLACEMENT_OVERDUE', message: 'Replacement overdue' } },
      ...startRoutes('f3'),
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1');
    fireEvent.change(caInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('F-003: Replacement overdue')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Equipment Readings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('F-003 → WASH IN')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(2);
    expect(api.calls('POST', '/api/filters/f3/advance')).toHaveLength(1);
  });

  it('a block-change refusal on the START opens the block dialog and drops the readings', async () => {
    await toEquipment({ routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'BLOCK_CHANGE_CONFIRM', message: 'confirm', details: { filterId: 'f3', homeBlockId: 'b2', homeBlockName: 'South', requestedBlockId: 'b1', requestedBlockName: 'North' } } },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1');
    fireEvent.change(caInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Cleaning in a different block')).toBeInTheDocument();
    expect(screen.queryByText('Equipment Readings')).toBeNull();
  });

  it('the missed-PM question also guards the readings-dialog START', async () => {
    const { api } = await toEquipment({ routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, times: 1, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'pending', details: { pendingPmTasks: [{ entryId: 'pm9', ahuName: 'AHU-01', plannedDate: '2026-09-01' }], minReasonLength: 5 } } },
      ...startRoutes('f3'),
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1');
    fireEvent.change(caInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    fireEvent.change(await screen.findByPlaceholderText('Why was this scheduled cleaning not done?'), { target: { value: 'Not scheduled crew' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reasons & start cleaning' }));
    expect(await message('F-003 → WASH IN')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[1].json.pmSkips).toEqual([{ entryId: 'pm9', reason: 'Not scheduled crew' }]);
  });

  it('dismissing the readings-dialog PM question reports the refusal and keeps the dialog', async () => {
    await toEquipment({ routes: [
      { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [{ entryId: 'pm9', ahuName: 'AHU-01', plannedDate: '2026-09-01' }] } } },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1');
    fireEvent.change(caInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const dlg = (await screen.findByPlaceholderText('Why was this scheduled cleaning not done?')).closest('div.fixed')! as HTMLElement;
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(await message('F-003: An earlier PM is pending')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Equipment Readings')).toBeInTheDocument();
  });

  it('Get Values fills the auto instrument and locks it; a failed fetch retries, then falls back to manual entry', async () => {
    let calls = 0;
    await toEquipment({ routes: [
      { method: 'POST', path: '/api/equipment-groups/fetch-readings', body: (r: MockRequest) => {
        calls += 1;
        expect(r.json).toEqual({ filterId: 'f3', groupId: 'gw', stageKey: 'WASH_IN' });
        return calls === 1 ? { results: [{ instrumentId: 'ca', ok: false }] } : { results: [{ instrumentId: 'ca', ok: true, value: 5 }, { instrumentId: 'ro', ok: true, value: 1 }] };
      } },
    ] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'Date'] });
    fireEvent.click(screen.getByRole('button', { name: 'Get Values' }));
    expect(await screen.findByText('Got 0/1. Retrying…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetching…' })).toBeDisabled();
    expect(caInput()).toHaveAttribute('placeholder', 'Fetching…');
    await act(async () => { vi.advanceTimersByTime(5_100); });
    expect(await screen.findByText('All readings fetched.')).toBeInTheDocument();
    expect(caInput()).toHaveValue(5);
    expect(caInput()).toHaveAttribute('readonly');
    expect(screen.getByText('Auto · locked')).toBeInTheDocument();
    fireEvent.change(caInput(), { target: { value: '6' } }); // locked: ignored
    expect(caInput()).toHaveValue(5);
    vi.useRealTimers();
  });

  it('a fetch that never lands within a minute reverts the instrument to the dropdown, says so, and Get Values retries', async () => {
    let reading: number | null = null; // the instrument answers nothing until the retry
    const { api } = await toEquipment({ routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: () => ({ results: reading === null ? [] : [{ instrumentId: 'ca', ok: true, value: reading }] }) }] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'Date'] });
    fireEvent.click(screen.getByRole('button', { name: 'Get Values' }));
    for (let i = 0; i < 13; i++) { await act(async () => { vi.advanceTimersByTime(5_100); }); }
    // The instrument reverts to the stepped dropdown so the reading can still be taken.
    await waitFor(() => expect(screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('select')).not.toBeNull());
    const caSelect = screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('select')!;
    expect([...caSelect.options].map((o) => o.textContent)).toEqual(['Select...', '4 bar', '5 bar', '6 bar']);
    // …and the operator is told why, and can try again (the only auto instrument timed out).
    expect(screen.getByText("1 reading(s) couldn't be fetched in 1 minute — select them manually.")).toBeInTheDocument();
    vi.useRealTimers();
    const before = api.calls('POST', '/api/equipment-groups/fetch-readings').length;
    reading = 5;
    fireEvent.click(screen.getByRole('button', { name: 'Get Values' }));
    await waitFor(() => expect(caInput()).toHaveValue(5));
    expect(caInput()).toHaveAttribute('readonly'); // fetched → locked
    expect(api.calls('POST', '/api/equipment-groups/fetch-readings').length).toBe(before + 1);
    expect(await screen.findByText('All readings fetched.')).toBeInTheDocument();
  });

  it('closing the dialog mid-fetch stops the polling', async () => {
    const { api } = await toEquipment({ routes: [{ method: 'POST', path: '/api/equipment-groups/fetch-readings', body: { results: [] } }] });
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'Date'] });
    fireEvent.click(screen.getByRole('button', { name: 'Get Values' }));
    await screen.findByText('Got 0/1. Retrying…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const n = api.calls('POST', '/api/equipment-groups/fetch-readings').length;
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(api.calls('POST', '/api/equipment-groups/fetch-readings').length).toBe(n);
    vi.useRealTimers();
  });

  it('offline the auto instrument is a plain dropdown and there is no Get Values', async () => {
    await renderOps({
      stage: 'WASH_IN', online: false, cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, F3],
      cache: {
        'identifier-map': { E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f3': NO_CYCLE(['WASH_IN', 'WASH_OUT']),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
        'equipment-groups': [GROUP_W, { id: 'gx', name: 'Elsewhere', blockId: 'b2', instruments: [] }],
        templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }],
      },
    });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    expect(screen.queryByRole('button', { name: 'Elsewhere' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    expect(screen.queryByRole('button', { name: 'Get Values' })).toBeNull();
    selectRo('1');
    fireEvent.change(screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('F-003 → WASH IN (queued)')).toBeInTheDocument();
    expect(queuedOps()[0].payload.advancePayload).toMatchObject({ equipmentGroupId: 'gw', instrumentReadings: { ro: 1, ca: 4 } });
  });
});

describe('batch START with readings (one reason, one readings dialog)', () => {
  const pick = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '1' } });
    fireEvent.change(screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('input')!, { target: { value: '5' } });
  };

  it('online: ONE bulk start-and-advance with the readings for every filter', async () => {
    const { api } = await renderOps({
      stage: 'WASH_IN', states: { f1: NO_CYCLE(['WASH_IN']), f3: NO_CYCLE(['WASH_IN']) },
      routes: [
        instancesWithoutCycle('f1'),
        { path: '/api/equipment-groups/by-block/b1', body: [GROUP_W] },
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => ({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: { actions: [submitChecklist('WASH_IN')], tapeVersion: 3 } })) }) },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    pick();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument(); // one checklist for both
    const items = bulkItems(api);
    expect(items.map((i: any) => [i.filterId, i.kind, i.advancePayload.equipmentGroupId, i.advancePayload.instrumentReadings])).toEqual([
      ['f1', 'start-and-advance', 'gw', { ro: 1, ca: 5 }], ['f3', 'start-and-advance', 'gw', { ro: 1, ca: 5 }],
    ]);
    expect(await message('Started 2 cycles successfully')).toBeInTheDocument();
  });

  it('online: when the FIRST filter is refused it is not reported as started; the refusal is listed', async () => {
    await renderOps({
      stage: 'WASH_IN', states: { f1: NO_CYCLE(['WASH_IN']), f3: NO_CYCLE(['WASH_IN']) },
      routes: [
        instancesWithoutCycle('f1'),
        { path: '/api/equipment-groups/by-block/b1', body: [GROUP_W] },
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => (it.filterId === 'f1'
          ? { clientOpId: it.clientOpId, filterId: 'f1', status: 'failed', error: { code: 'X', message: 'Filter busy' } }
          : { clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: null })) }) },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    pick();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('F-001: Filter busy')).toBeInTheDocument();
    expect(screen.queryByText('F-001 → WASH IN')).toBeNull();
    // Only F-003 started, and that is the count reported.
    fireEvent.click(screen.getByRole('button', { name: 'OK' })); // messages queue: the refusal first
    expect(await message('Started 1 cycle successfully')).toBeInTheDocument();
    expect(screen.queryByText(/Started 2 cycles/)).toBeNull();
  });

  it('online: a transport failure keeps the readings dialog for a retry; a cancelled password changes nothing', async () => {
    await renderOps({
      stage: 'WASH_IN', reauthActions: ['STAGE_WASH_IN'], states: { f1: NO_CYCLE(['WASH_IN']), f3: NO_CYCLE(['WASH_IN']) },
      routes: [
        instancesWithoutCycle('f1'),
        { path: '/api/equipment-groups/by-block/b1', body: [GROUP_W] },
        { method: 'POST', path: '/api/filters/bulk-operate', status: 500, body: { error: 'X', message: 'x' } },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    pick();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await cancelReauth();
    await flush(100);
    expect(screen.getByText('Equipment Readings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await passReauth();
    expect(await message('Could not reach the server to start the cycles. Please try again.')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Equipment Readings')).toBeInTheDocument();
  });

  it('offline: the first start and every following one are queued with the same reason and readings', async () => {
    await renderOps({
      stage: 'WASH_IN', online: false, cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, { ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(['WASH_IN', 'WASH_OUT']), 'filter-state-f3': NO_CYCLE(['WASH_IN', 'WASH_OUT']),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
        'equipment-groups': [{ ...GROUP_W, instruments: GROUP_W.instruments.map((i) => ({ ...i, autoFetchEnabled: false })) }],
        templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }],
      },
    });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '1' } });
    fireEvent.change(screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('Started 2 cycles successfully')).toBeInTheDocument();
    expect(queuedOps().map((o) => [o.type, o.filterId, o.payload.advancePayload.instrumentReadings])).toEqual([
      ['start-and-advance', 'f1', { ro: 1, ca: 4 }], ['start-and-advance', 'f3', { ro: 1, ca: 4 }],
    ]);
  });

  it('offline with START re-auth on: ONE password, then every filter of the batch is queued', async () => {
    await renderOps({
      stage: 'WASH_IN', online: false, reauthActions: ['START_CLEANING_CYCLE'], cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, { ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(['WASH_IN', 'WASH_OUT']), 'filter-state-f3': NO_CYCLE(['WASH_IN', 'WASH_OUT']),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
        'equipment-groups': [{ ...GROUP_W, instruments: GROUP_W.instruments.map((i) => ({ ...i, autoFetchEnabled: false })) }],
        templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }],
      },
    });
    await waitFor(() => expect(screen.getByText('North')).toBeInTheDocument());
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '1' } });
    fireEvent.change(screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await passReauth();
    expect(await message('Started 2 cycles successfully')).toBeInTheDocument();
    expect(screen.queryAllByPlaceholderText('Enter your password')).toHaveLength(0); // asked once, not per filter
    expect(queuedOps().map((o) => o.filterId)).toEqual(['f1', 'f3']);
    expect(queuedOps().every((o) => !('password' in o) && !JSON.stringify(o.payload).includes('Secret@123'))).toBe(true); // never persisted
  });

  it('offline: a following start the server refuses is reported by name and not counted as started', async () => {
    await renderOps({
      stage: 'WASH_IN', online: false, cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, { ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(['WASH_IN', 'WASH_OUT']), 'filter-state-f3': NO_CYCLE(['WASH_IN', 'WASH_OUT']),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
        'equipment-groups': [{ ...GROUP_W, instruments: GROUP_W.instruments.map((i) => ({ ...i, autoFetchEnabled: false })) }],
        templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }],
      },
    });
    // The tablet believes it is offline, but the link flaps: F-003's start reaches
    // the server, which refuses it. Everything else is unreachable (queued).
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/filters/f3/start-cycle')) {
        return new Response(JSON.stringify({ error: 'REPLACEMENT_OVERDUE', message: 'AHU-01 replacement overdue' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      throw new TypeError('Failed to fetch');
    }));
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(startBtn());
    await screen.findByText('Equipment Readings');
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '1' } });
    fireEvent.change(screen.getByText('Compressed air (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('F-003: AHU-01 replacement overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' })); // messages queue: the refusal first
    expect(await message('Started 1 cycle successfully')).toBeInTheDocument();
    expect(screen.queryByText(/Started 2 cycles/)).toBeNull();
    expect(queuedOps().map((o) => o.filterId)).toEqual(['f1']);
  });
});
