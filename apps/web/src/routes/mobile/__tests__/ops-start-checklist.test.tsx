/**
 * Tablet — a checklist BEFORE the first stage (a START checklist), 2026-10-22.
 *
 * Operator rules (the server half is 00bf4d3, the desktop half 00a7ac8):
 *  - the dialog comes FIRST and nothing is written until it is answered;
 *  - on submit, per filter: start-cycle → submit-checklist at START → enter the
 *    first stage, signed ONCE for the three writes;
 *  - the missed-PM question is answered before the checklist is sent, and only
 *    a successful start sends it; a cancelled question sends nothing;
 *  - offline the three ops are queued in that order, never as the compound
 *    start-and-advance (an offline replay exempts START_CHECKLIST, so the
 *    compound op would silently skip a GMP checklist);
 *  - a start that succeeded but whose checklist was refused leaves the cycle at
 *    START: the next scan reopens the START checklist from the tape, never a
 *    second start;
 *  - one dialog per distinct START checklist; filters that cannot join stay
 *    queued, ticked, with the reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { MockRequest, MockRoute } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, queuedOps, passReauth, cachedValue } from './support/mobile-kit';
import {
  renderOps, scanTag, inQueue, adv, graph, bulkItems, submitButton, message, dismissAll, submitChecklist,
  OPS_INSTANCES, F1, F3, CHECKLIST_PROFILE,
} from './support/ops-harness';
import { getAllOperations } from '@/lib/offline-store';
import { getCurrentActions } from '@/lib/action-tape';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

const Q_START = { id: 'qs', question: 'Bay cleared of debris?', questionType: 'YES_NO', required: true };
const START_PROFILE = { id: 'clS', name: 'Pre-clean check', version: 2, isActive: true, questions: [Q_START] };
const OTHER_START_PROFILE = { id: 'clT', name: 'Gowning check', version: 1, isActive: true, questions: [{ id: 'qt', question: 'Gowned?', questionType: 'YES_NO', required: true }] };

/** START → CHECKLIST(profileId) → stages… → END. */
function startGraph(stageKeys: string[], profileId = 'clS') {
  const g = graph(stageKeys);
  const first = g.connections[0]; // n-start → first stage
  g.stages.splice(1, 0, { id: `n-cl-start-${profileId}`, nodeType: 'CHECKLIST', configuration: { checklistProfileId: profileId } });
  g.connections.splice(0, 1, { fromStageId: 'n-start', toStageId: `n-cl-start-${profileId}` }, { fromStageId: `n-cl-start-${profileId}`, toStageId: first.toStageId });
  return g;
}
const NO_CYCLE = (g: any, over: any = {}) => ({ currentState: null, currentCycle: null, actions: [], pipelineGraph: g, homeBlock: { id: 'b1', name: 'North' }, blockChangeStatus: 'MATCH', ...over });
const START_TAPE = (questions = [Q_START], id = 'clS', version = 2) => ({
  type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Pre-clean check', blocking: true,
  params: { checklistProfileId: id, versionPin: version, afterStage: null, questions },
});
const instancesWithoutCycle = (...ids: string[]): MockRoute => ({ path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (ids.includes(i.id) ? { ...i, currentCycleId: null, currentLifecycleState: null } : i)) } });
const offlineFetch = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

/** The server, for one filter: start → (cycle at START, checklist pending) → checklist → advance.
 *  Its current-state carries the pipeline graph, as the real one does. */
const startChecklistRoutes = (id: string, g: any = startGraph(['WASH_OUT', 'STORAGE_IN'])): MockRoute[] => [
  { method: 'POST', path: `/api/filters/${id}/start-cycle`, status: 201, body: { id: `new-${id}` } },
  { path: `/api/filters/${id}/current-state`, body: { currentState: null, tapeVersion: 11, actions: [START_TAPE()], currentCycle: { id: `new-${id}`, status: 'IN_PROGRESS' }, pipelineGraph: g } },
  { method: 'POST', path: `/api/filters/${id}/submit-checklist`, body: { currentState: null, tapeVersion: 12, actions: [adv('WASH_OUT')], currentCycle: { id: `new-${id}`, status: 'IN_PROGRESS' } } },
  { method: 'POST', path: `/api/filters/${id}/advance`, body: { currentState: 'WASH_OUT', tapeVersion: 13, actions: [adv('STORAGE_IN')], currentCycle: { id: `new-${id}`, status: 'IN_PROGRESS' } } },
];
async function toReasonDialog() {
  fireEvent.click(submitButton());
  return screen.findByText('Cleaning Reason');
}
const reasonBtn = (name: RegExp) => screen.getByRole('button', { name });
const startBtn = () => screen.getByRole('button', { name: 'Start' });
/** POSTs to a filter's write routes, in the order they were sent. */
const writes = (api: any, id: string) => api.calls('POST', new RegExp(`^/api/filters/${id}/`)).map((c: MockRequest) => c.path.split('/').pop());

describe('a START checklist, one filter, online', () => {
  it('the dialog comes first and writes nothing; Submit sends start → checklist (at START) → advance, signed once', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT', reauthActions: ['START_CLEANING_CYCLE'],
      states: { f3: NO_CYCLE(startGraph(['WASH_OUT', 'STORAGE_IN'])) }, checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: startChecklistRoutes('f3'),
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('Bay cleared of debris?')).toBeInTheDocument();
    // The dialog says where the checklist sits: before the first stage.
    expect(screen.getByText(/before the first stage/i)).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual([]); // nothing written yet
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await passReauth();
    expect(await message(/F-003 → WASH OUT/)).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual(['start-cycle', 'submit-checklist', 'advance']);
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[0].json).toMatchObject({ cleaningReasonKey: 'PM' });
    expect(api.calls('POST', '/api/filters/f3/submit-checklist')[0].json).toMatchObject({ answers: { qs: 'Yes' }, expectedProfileVersions: { clS: 2 }, tapeVersion: 11 });
    expect(api.calls('POST', '/api/filters/f3/advance')[0].json).toMatchObject({ targetState: 'WASH_OUT', tapeVersion: 12 });
    // ONE password for the three writes.
    for (const route of ['start-cycle', 'submit-checklist', 'advance']) {
      expect(api.calls('POST', `/api/filters/f3/${route}`)[0].headers['x-reauth-password']).toBe('Secret@123');
    }
    await dismissAll();
    expect(screen.queryByText('Checklist Required')).toBeNull();
  });

  it('closing the dialog writes nothing', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT', states: { f3: NO_CYCLE(startGraph(['WASH_OUT'])) }, checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: startChecklistRoutes('f3'),
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await flush(100);
    expect(writes(api, 'f3')).toEqual([]);
  });

  it('missed PM: the answers wait through the PM question; the checklist is sent only after the start succeeds', async () => {
    const PM_TASK = { entryId: 'pm1', ahuName: 'AHU-01', plannedDate: '2026-09-15', windowStart: '2026-09-10', windowEnd: '2026-09-20', overdueDays: 31 };
    const { api } = await renderOps({
      stage: 'WASH_OUT', states: { f3: NO_CYCLE(startGraph(['WASH_OUT', 'STORAGE_IN'])) }, checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, times: 1, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK], minReasonLength: 5 } } },
        ...startChecklistRoutes('f3'),
      ],
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    fireEvent.change(await screen.findByPlaceholderText('Why was this scheduled cleaning not done?'), { target: { value: 'Plant shutdown' } });
    expect(writes(api, 'f3')).toEqual(['start-cycle']); // refused: no checklist sent
    fireEvent.click(screen.getByRole('button', { name: 'Save reasons & start cleaning' }));
    expect(await message(/F-003 → WASH OUT/)).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual(['start-cycle', 'start-cycle', 'submit-checklist', 'advance']);
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[1].json.pmSkips).toEqual([{ entryId: 'pm1', reason: 'Plant shutdown' }]);
    expect(api.calls('POST', '/api/filters/f3/submit-checklist')[0].json.answers).toEqual({ qs: 'Yes' });
  });

  it('missed PM cancelled: nothing but the refused start is sent, and the refusal is shown', async () => {
    const PM_TASK = { entryId: 'pm1', ahuName: 'AHU-01', plannedDate: '2026-09-15', windowStart: '2026-09-10', windowEnd: '2026-09-20', overdueDays: 31 };
    const { api } = await renderOps({
      stage: 'WASH_OUT', states: { f3: NO_CYCLE(startGraph(['WASH_OUT'])) }, checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [{ method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK] } } }],
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    const save = await screen.findByRole('button', { name: 'Save reasons & start cleaning' });
    fireEvent.click(within(save.parentElement!).getByRole('button', { name: 'Cancel' }));
    expect(await message('An earlier PM is pending')).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual(['start-cycle']);
  });

  it('start OK, checklist refused: the cycle waits at START; the next scan reopens the START checklist, never a second start', async () => {
    let started = false;
    const { api } = await renderOps({
      stage: 'WASH_OUT', states: { f3: NO_CYCLE(startGraph(['WASH_OUT', 'STORAGE_IN'])) }, checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [
        { method: 'POST', path: '/api/filters/f3/submit-checklist', status: 409, times: 1, body: { error: 'SCHEMA_DRIFT', message: 'The checklist changed — reopen it' } },
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: () => { started = true; return { id: 'new-f3' }; } },
        ...startChecklistRoutes('f3'),
        // Once started, the instance list says the cycle exists.
        { path: '/api/assets/instances', body: () => ({ data: OPS_INSTANCES.map((i: any) => (i.id === 'f3' ? { ...i, currentCycleId: started ? 'new-f3' : null, currentLifecycleState: null } : i)) }) },
        // The scan queue's own writes (online): the answer at START, then the entry.
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => ({
          clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok',
          snapshot: it.kind === 'submit-checklist'
            ? { currentState: null, tapeVersion: 12, actions: [adv('WASH_OUT')], currentCycle: { id: 'new-f3', status: 'IN_PROGRESS' } }
            : { currentState: 'WASH_OUT', tapeVersion: 13, actions: [adv('STORAGE_IN')], currentCycle: { id: 'new-f3', status: 'IN_PROGRESS' } },
        })) }) },
      ],
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    expect(await message(/the cycle started, but its first checklist was not recorded/)).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual(['start-cycle', 'submit-checklist']); // no advance
    await dismissAll();
    // Rescan: the tape (cycle at START, checklist pending) reopens the START checklist.
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await message(/Checklist submitted/);
    await dismissAll();
    // …then the filter enters its first stage (the queue replays after the dialog).
    await flush(300);
    expect(writes(api, 'f3').filter((w: string) => w === 'start-cycle')).toHaveLength(1);
    // Online the queue sends its writes through /bulk-operate: the answer at START, then the entry.
    const bulk = api.calls('POST', '/api/filters/bulk-operate').map((c: MockRequest) => (c.json.items as any[]).map((i) => [i.filterId, i.kind]));
    expect(bulk).toEqual([[['f3', 'submit-checklist']], [['f3', 'advance']]]);
    expect(api.calls('POST', '/api/filters/bulk-operate')[0].json.items[0].payload).toMatchObject({ answers: { qs: 'Yes' } });
    expect(api.calls('POST', '/api/filters/bulk-operate')[1].json.items[0].payload).toMatchObject({ targetState: 'WASH_OUT' });
  });
});

describe('a START checklist, offline', () => {
  const CACHE = (over: any = {}) => ({
    'identifier-map': { E3: { filterId: 'f3', filterName: 'F-003' } },
    'filter-state-f3': NO_CYCLE(startGraph(['WASH_OUT', 'STORAGE_IN'])),
    'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
    'checklist-profiles': [START_PROFILE],
    ...over,
  });

  async function queueOne() {
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    expect(queuedOps()).toHaveLength(0); // the dialog writes nothing
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await message(/queued/);
    await dismissAll();
  }

  it('queues start-cycle → submit-checklist → advance (never the compound start-and-advance), in time order', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [F3], cache: CACHE() });
    offlineFetch();
    await queueOne();
    const ops = queuedOps();
    expect(ops.map((o) => o.type)).toEqual(['start-cycle', 'submit-checklist', 'advance']);
    expect(ops[1].payload).toMatchObject({ answers: { qs: 'Yes' }, expectedProfileVersions: { clS: 2 } });
    expect(ops[2].payload).toMatchObject({ targetState: 'WASH_OUT' });
    // offlinePerformedAt is the queue time: start ≤ checklist ≤ advance.
    const t = ops.map((o) => Date.parse(o.createdAt));
    expect(t[0]).toBeLessThanOrEqual(t[1]);
    expect(t[1]).toBeLessThanOrEqual(t[2]);
    // …and the drain reads them back in that order.
    expect((await getAllOperations()).map((o) => o.type)).toEqual(['start-cycle', 'submit-checklist', 'advance']);
  });

  it('the cache shows the cycle at the first stage: a rescan neither starts again nor re-asks the START checklist', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [F3], cache: CACHE() });
    offlineFetch();
    await queueOne();
    const row = cachedValue('filter-state-f3');
    expect(row.currentState).toBe('WASH_OUT');
    expect(row.currentCycle?.id).toBeTruthy(); // the cycle stub
    const tape = await getCurrentActions('f3', null);
    expect(tape.some((a: any) => a.type === 'SUBMIT_CHECKLIST')).toBe(false);
    expect(tape.some((a: any) => a.type === 'ADVANCE_TO_STAGE' && a.params.targetState === 'STORAGE_IN')).toBe(true);
  });

  it('a START checklist whose questions are not cached is refused, never started without it', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [F3], cache: CACHE({ 'checklist-profiles': [] }) });
    offlineFetch();
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message(/first checklist could not be loaded/)).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
  });
});

describe('a START checklist in a batch', () => {
  it('online: ONE dialog for the same START checklist; per filter start → checklist → advance; never a bulk start-and-advance', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT', reauthActions: ['START_CLEANING_CYCLE'],
      states: { f1: NO_CYCLE(startGraph(['WASH_OUT'])), f3: NO_CYCLE(startGraph(['WASH_OUT'])) },
      checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [instancesWithoutCycle('f1'), ...startChecklistRoutes('f1'), ...startChecklistRoutes('f3')],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument();
    expect(writes(api, 'f1')).toEqual([]);
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await passReauth();
    expect(await message(/2 filter\(s\) → WASH OUT/)).toBeInTheDocument();
    expect(writes(api, 'f1')).toEqual(['start-cycle', 'submit-checklist', 'advance']);
    expect(writes(api, 'f3')).toEqual(['start-cycle', 'submit-checklist', 'advance']);
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull(); // signed once
  });

  it('a filter with no START checklist keeps today\'s path; the START group stays queued, ticked, with the reason', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: NO_CYCLE(graph(['WASH_OUT'])), f3: NO_CYCLE(startGraph(['WASH_OUT'])) },
      checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [
        instancesWithoutCycle('f1'),
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: { id: 'new-f1' } },
        { path: '/api/filters/f1/current-state', body: { currentState: null, tapeVersion: 4, actions: [adv('WASH_OUT')], currentCycle: { id: 'new-f1', status: 'IN_PROGRESS' } } },
        { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_OUT', tapeVersion: 5, actions: [], currentCycle: { id: 'new-f1', status: 'IN_PROGRESS' } } },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message(/F-003: its first checklist is asked on its own/)).toBeInTheDocument();
    // F-001 alone: today's single-filter start (start → advance), no checklist write.
    await waitFor(() => expect(writes(api, 'f1')).toEqual(['start-cycle', 'advance']));
    await dismissAll();
    // F-003 is back in the queue, ticked, for its own submit.
    await inQueue('F-003');
    expect(screen.getByRole('checkbox', { name: /F-003/ })).toBeChecked();
    expect(writes(api, 'f3')).toEqual([]);
  });

  it('two different START checklists: the larger group is asked; the other stays queued with the reason', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: NO_CYCLE(startGraph(['WASH_OUT'], 'clT')), f3: NO_CYCLE(startGraph(['WASH_OUT'])) },
      checklistProfiles: [START_PROFILE, OTHER_START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE, OTHER_START_PROFILE] },
      routes: [instancesWithoutCycle('f1'), ...startChecklistRoutes('f1'), ...startChecklistRoutes('f3')],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message(/its profile asks a different first checklist/)).toBeInTheDocument();
    await dismissAll();
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('Gowned?')).toBeInTheDocument(); // the first scanned filter's group (a tie)
    expect(writes(api, 'f1')).toEqual([]);
    expect(writes(api, 'f3')).toEqual([]);
  });

  it('offline: each filter of the group queues start → checklist → advance; no compound op', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(startGraph(['WASH_OUT', 'STORAGE_IN'])), 'filter-state-f3': NO_CYCLE(startGraph(['WASH_OUT', 'STORAGE_IN'])),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
        'checklist-profiles': [START_PROFILE],
      },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await message(/queued/);
    expect(queuedOps().map((o) => [o.type, o.filterId])).toEqual([
      ['start-cycle', 'f1'], ['submit-checklist', 'f1'], ['advance', 'f1'],
      ['start-cycle', 'f3'], ['submit-checklist', 'f3'], ['advance', 'f3'],
    ]);
  });
});

describe('a cycle-start batch member whose state is not cached (offline)', () => {
  it('is not started blind: it stays queued, ticked, named; the others start as before', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F1, currentCycleId: null }, F3],
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f1': NO_CYCLE(graph(['WASH_OUT', 'STORAGE_IN'])),
        'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
      },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message(/F-003: its current state could not be read/)).toBeInTheDocument();
    await waitFor(() => expect(queuedOps().map((o) => [o.type, o.filterId])).toEqual([['start-and-advance', 'f1']]));
    await dismissAll();
    await inQueue('F-003');
    expect(screen.getByRole('checkbox', { name: /F-003/ })).toBeChecked();
  });
});

describe('a cycle waiting at START is answered at its first stage only (2026-10-22)', () => {
  const AT_START = { currentState: null, currentCycle: { id: 'new-f3', status: 'IN_PROGRESS' }, tapeVersion: 11, actions: [START_TAPE()], pipelineGraph: startGraph(['WASH_OUT', 'STORAGE_IN']), homeBlock: { id: 'b1', name: 'North' }, blockChangeStatus: 'MATCH' };
  const inCycle: MockRoute = { path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (i.id === 'f3' ? { ...i, currentCycleId: 'new-f3', currentLifecycleState: null } : i)) } };

  it('scanned at a later station: refused with the station to go to; nothing opened or written', async () => {
    const { api } = await renderOps({ stage: 'STORAGE_IN', states: { f3: AT_START }, checklistProfiles: [START_PROFILE], routes: [inCycle] });
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await message(/F-003 has a pending checklist before its first stage — scan it at Wash Out/)).toBeInTheDocument();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(writes(api, 'f3')).toEqual([]);
  });

  it('scanned at its first stage: the checklist opens', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f3: AT_START }, checklistProfiles: [START_PROFILE], routes: [inCycle] });
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Bay cleared of debris?')).toBeInTheDocument();
  });
});

describe('offline, a START checklist this tablet cannot read: fail CLOSED (2026-10-22)', () => {
  // The offline replay exempts START_CHECKLIST, so anything sent past an
  // unreadable START checklist would skip it for good. Refuse, say why.
  const LINEAR = [{ stateKey: 'WASH_OUT', sortOrder: 1 }, { stateKey: 'STORAGE_IN', sortOrder: 2 }];
  const BASE = {
    'identifier-map': { E3: { filterId: 'f3', filterName: 'F-003' } },
    'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
  };
  const AT_START = (over: any = {}) => ({
    currentState: null, currentCycle: { id: 'cyc-s', status: 'IN_PROGRESS' }, actions: [], pendingChecklist: [],
    pipelineGraph: startGraph(['WASH_OUT', 'STORAGE_IN']), homeBlock: { id: 'b1', name: 'North' }, blockChangeStatus: 'MATCH', ...over,
  });

  it('a cycle waiting at START whose first checklist\'s questions are cached nowhere: refused, nothing queued', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F3, currentCycleId: 'cyc-s' }], cache: { ...BASE, 'filter-state-f3': AT_START() } });
    offlineFetch();
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await message(/F-003: its first checklist could not be loaded — go online to load its questions/)).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
  });

  it('…its questions cached: the checklist is asked as usual (the rule only refuses what it cannot read)', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F3, currentCycleId: 'cyc-s' }], cache: { ...BASE, 'filter-state-f3': AT_START(), 'checklist-profiles': [START_PROFILE] } });
    offlineFetch();
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Bay cleared of debris?')).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
  });

  it('a cycle waiting at START with no pipeline graph cached (only the linear stage list): refused, nothing queued', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F3, currentCycleId: 'cyc-s' }], cache: { ...BASE, 'filter-state-f3': AT_START({ pipelineGraph: null, pipelineStages: LINEAR }) } });
    offlineFetch();
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await message(/F-003: its cleaning profile is not on this tablet — go online/)).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
  });

  it('a NEW cycle with no pipeline graph cached: not started (it could ask a checklist before the first stage); stays queued', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false, cachedFilters: [F3], cache: { ...BASE, 'filter-state-f3': NO_CYCLE(null, { pipelineStages: LINEAR }) } });
    offlineFetch();
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    expect(await message(/F-003: its cleaning profile is not on this tablet — go online/)).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
    await dismissAll();
    await inQueue('F-003');
  });
});

describe('a compound start is never sent for a filter with a START checklist', () => {
  it('online bulk: the START-checklist filter is planned out of /bulk-operate', async () => {
    // Guarded at use-core too (a caller that skips the planner is refused).
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: NO_CYCLE(graph(['WASH_OUT'])), f2: NO_CYCLE(graph(['WASH_OUT'])), f3: NO_CYCLE(startGraph(['WASH_OUT'])) },
      checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [
        instancesWithoutCycle('f1', 'f2'),
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => ({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: { actions: [submitChecklist('WASH_OUT')], tapeVersion: 5 } })) }) },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await message(/F-003/);
    await dismissAll();
    const items = api.calls('POST', '/api/filters/bulk-operate').flatMap((c: MockRequest) => c.json.items);
    expect(items.map((i: any) => [i.filterId, i.kind])).toEqual([['f1', 'start-and-advance'], ['f2', 'start-and-advance']]);
    expect(writes(api, 'f3')).toEqual([]);
    expect(CHECKLIST_PROFILE.id).toBe('cl1'); // fixture sanity
  });
});

describe('the first stage after a START checklist', () => {
  const GROUP_W = { id: 'gw', name: 'Wash Bay', blockId: 'b1', instruments: [
    { id: 'ro', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 0.5 },
  ] };
  const selectRo = (v: string) => fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: v } });
  const answerStart = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
  };
  const BLOCKS_OFFLINE = {
    templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }],
    'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }],
    'checklist-profiles': [START_PROFILE],
  };
  const bulkOk = (snapshot: any) => ({
    method: 'POST', path: '/api/filters/bulk-operate',
    body: (r: MockRequest) => ({ results: (r.json.items as any[]).map((it) => ({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot })) }),
  }) as MockRoute;

  it('Wash In with an equipment group (online): the START checklist first, then start → checklist; the readings are asked next and the stage is entered with them', async () => {
    const cycle = { id: 'new-f3', status: 'IN_PROGRESS' };
    const g = startGraph(['WASH_IN', 'WASH_OUT']);
    const { api } = await renderOps({
      stage: 'WASH_IN', states: { f3: NO_CYCLE(g) },
      checklistProfiles: [START_PROFILE], cache: { 'checklist-profiles': [START_PROFILE] },
      routes: [
        { path: '/api/equipment-groups/by-block/b1', body: [GROUP_W] },
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: { id: 'new-f3' } },
        { path: '/api/filters/f3/current-state', body: { currentState: null, tapeVersion: 11, actions: [START_TAPE()], currentCycle: cycle, pipelineGraph: g } },
        { method: 'POST', path: '/api/filters/f3/submit-checklist', body: { currentState: null, tapeVersion: 12, actions: [adv('WASH_IN')], currentCycle: cycle, pipelineGraph: g } },
        bulkOk({ currentState: 'WASH_IN', tapeVersion: 13, actions: [adv('WASH_OUT')], currentCycle: cycle, pipelineGraph: g }),
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    await screen.findByText('Cleaning Reason');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    expect(screen.queryByText('Equipment Readings')).toBeNull();
    expect(writes(api, 'f3')).toEqual([]);
    answerStart();
    expect(await screen.findByText('Equipment Readings')).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual(['start-cycle', 'submit-checklist']);
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1.5');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(bulkItems(api, 0)).toHaveLength(1));
    expect(bulkItems(api, 0)[0]).toMatchObject({ filterId: 'f3', kind: 'advance', payload: { targetState: 'WASH_IN', equipmentGroupId: 'gw', instrumentReadings: { ro: 1.5 } } });
    expect(writes(api, 'f3').filter((w: string) => w === 'start-cycle')).toHaveLength(1);
  });

  it('Wash In with an equipment group (offline): the cached cycle sits at START with its checklist answered, so the readings come next and the entry is queued third', async () => {
    await renderOps({
      stage: 'WASH_IN', online: false, cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, F3],
      cache: {
        ...BLOCKS_OFFLINE,
        'identifier-map': { E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f3': NO_CYCLE(startGraph(['WASH_IN', 'WASH_OUT'])),
        'equipment-groups': [GROUP_W],
      },
    });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    await screen.findByText('Cleaning Reason');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    answerStart();
    expect(await screen.findByText('Equipment Readings')).toBeInTheDocument();
    expect(queuedOps().map((o) => o.type)).toEqual(['start-cycle', 'submit-checklist']);
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    selectRo('1');
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(queuedOps().map((o) => o.type)).toEqual(['start-cycle', 'submit-checklist', 'advance']));
    expect(queuedOps()[2].payload).toMatchObject({ targetState: 'WASH_IN', equipmentGroupId: 'gw', instrumentReadings: { ro: 1 } });
    expect(cachedValue('filter-state-f3').currentState).toBe('WASH_IN');
  });

  it('Dry In as the first stage (offline): the entry starts the dryer with the header duration, and the cached cycle carries the dryer timing', async () => {
    await renderOps({
      stage: 'DRY_IN', online: false, cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, F3],
      cache: {
        ...BLOCKS_OFFLINE,
        'identifier-map': { E3: { filterId: 'f3', filterName: 'F-003' } },
        'filter-state-f3': NO_CYCLE(startGraph(['DRY_IN', 'DRY_OUT'])),
      },
    });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.change(screen.getByText(/Duration/).querySelector('select')!, { target: { value: '45' } });
    fireEvent.click(submitButton());
    await screen.findByText('Cleaning Reason');
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Checklist Required');
    answerStart();
    expect(await message(/F-003 → DRY IN \(queued\)/)).toBeInTheDocument();
    expect(queuedOps().map((o) => o.type)).toEqual(['start-cycle', 'submit-checklist', 'advance']);
    expect(queuedOps()[2].payload).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SET_DURATION', dryerDurationMinutes: 45 });
    const row = cachedValue('filter-state-f3');
    expect(row.currentState).toBe('DRY_IN');
    expect(row.currentCycle).toMatchObject({ dryerDurationMinutes: 45, dryerReadingsSubmitted: false });
    expect(row.currentCycle.dryerStartedAt).toBeTruthy();
  });

  it('a first stage that is also the last, with a checklist after it (online): entered WITH that checklist in one advance-with-checklist, never a bare advance', async () => {
    const cycle = { id: 'new-f3', status: 'IN_PROGRESS' };
    const g = startGraph(['WASH_OUT']);
    // … → WASH_OUT → CHECKLIST(cl1) → END
    g.stages.splice(g.stages.length - 1, 0, { id: 'n-cl-after', nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl1' } });
    const toEnd = g.connections.find((c: any) => c.toStageId === 'n-end');
    toEnd.toStageId = 'n-cl-after';
    g.connections.push({ fromStageId: 'n-cl-after', toStageId: 'n-end' });
    const { api } = await renderOps({
      stage: 'WASH_OUT', states: { f3: NO_CYCLE(g) },
      checklistProfiles: [START_PROFILE, CHECKLIST_PROFILE], cache: { 'checklist-profiles': [START_PROFILE, CHECKLIST_PROFILE] },
      routes: [
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: { id: 'new-f3' } },
        { path: '/api/filters/f3/current-state', body: { currentState: null, tapeVersion: 11, actions: [START_TAPE()], currentCycle: cycle, pipelineGraph: g } },
        { method: 'POST', path: '/api/filters/f3/submit-checklist', body: { currentState: null, tapeVersion: 12, actions: [adv('WASH_OUT')], currentCycle: cycle, pipelineGraph: g } },
        bulkOk({ currentState: null, tapeVersion: 14, actions: [], currentCycle: null, pipelineGraph: g }),
      ],
    });
    await scanTag('E3'); await inQueue('F-003');
    await toReasonDialog();
    fireEvent.click(reasonBtn(/Preventive Maintenance/));
    fireEvent.click(startBtn());
    await screen.findByText('Bay cleared of debris?');
    answerStart();
    // The checklist AFTER the stage comes next, before the entry is written.
    expect(await screen.findByText('Filter intact?')).toBeInTheDocument();
    expect(writes(api, 'f3')).toEqual(['start-cycle', 'submit-checklist']);
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    await waitFor(() => expect(bulkItems(api, 0)).toHaveLength(1));
    expect(bulkItems(api, 0)[0]).toMatchObject({ filterId: 'f3', kind: 'advance-with-checklist', payload: { targetState: 'WASH_OUT', answers: { q1: 'Yes' } } });
    expect(writes(api, 'f3')).not.toContain('advance');
  });
});
