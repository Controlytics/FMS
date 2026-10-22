/**
 * Filter Operations (web) — a batch whose filters need DIFFERENT treatment
 * (2026-10-22). The desktop batch decided everything on the FIRST filter's state
 * and sent every filter a call shaped for that filter's profile/cycle:
 *
 *  - readings into a batch: the chosen equipment group went to every filter, so a
 *    filter whose cycle is bound to ANOTHER group got readings validated against
 *    the wrong group (the server now refuses that: 409 EQUIPMENT_GROUP_MISMATCH);
 *  - the last stage with a checklist after it (A-01): one filter's profile may
 *    need advance-with-checklist and another's a bare advance, or a different
 *    checklist;
 *  - a batch START whose first stage is also the last, with a checklist after it:
 *    start-cycle was written, then the bare advance refused (CHECKLIST_REQUIRED).
 *
 * Each filter is now decided on its OWN state (like the tablet). A filter that
 * cannot ride with the batch stays in the scan queue, named, for a separate
 * submit — it is never sent a call shaped for another filter.
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

import { usePageTestLifecycle, passReauth, expectSigned } from './fm-test-kit';
import { setup, scanAndSubmit, settle, answerYes, pickReasonAndStart, cancelPrompt, F1, Q_YES, NEW_FILTER_STATE } from './filter-operations-kit';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });

const F2 = { ...F1, id: 'f2', name: 'F-002' };
const posts = (a: ReturnType<typeof setup>, kind: string) => a.requests.filter((r) => r.method === 'POST' && r.path.endsWith(`/${kind}`));
const two = (states: { f1: unknown; f2: unknown }, routes: any[] = []) => {
  const a = setup({
    state: states.f1,
    routes: [
      { path: '/api/filters/f2/current-state', body: states.f2 },
      { path: '/api/checklist-profiles', body: { data: [CL1, CL2] } },
      ...routes,
    ],
  });
  a.routes.unshift({ path: '/api/hierarchy/filters', body: { data: [F1, F2] } });
  return a;
};
/** The scan queue still holds exactly this filter, ticked for the next submit. */
const queuedAlone = (name: string) =>
  screen.queryAllByText(name).length > 0 && !!screen.queryByRole('button', { name: /Submit Selected \(1\)/ });

// ── readings: equipment groups ──────────────────────────────────────────────
const inst = (id: string) => ({ id, instrumentId: id.toUpperCase(), description: `RO pressure ${id}`, stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 1 });
const GA = { id: 'ga', name: 'Bay A', blockId: 'b1', instruments: [inst('pa')] };
const GB = { id: 'gb', name: 'Bay B', blockId: 'b1', instruments: [inst('pb')] };
const atWashIn = (bound: any | null) => ({
  currentState: 'DRY_OUT', tapeVersion: 7, blockChangeStatus: 'MATCH',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: bound?.id ?? null },
  actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance', params: { targetState: 'WASH_IN' } }],
  equipmentGroup: bound ?? GA, blockEquipmentGroups: bound ? [] : [GA, GB],
});

describe('a batch of readings: each filter keeps the equipment group its cycle is bound to', () => {
  it('a filter bound to ANOTHER group is not sent this group\'s readings: it stays queued, named', async () => {
    const a = two({ f1: atWashIn(GA), f2: atWashIn(GB) }, [{ method: 'POST', path: /\/api\/filters\/f\d\/advance$/, body: { currentState: 'WASH_IN', actions: [] } }]);
    await scanAndSubmit(a, 'WASH_IN', 'North', ['F-001', 'F-002']);
    const d = (await screen.findByText('Equipment & Pressure Readings')).closest('.bg-white') as HTMLElement;
    expect(within(d).getByText('1 filter(s) → Wash In')).toBeInTheDocument();
    await within(d).findByText('RO pressure pa');
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    await settle();
    expect(posts(a, 'advance')[0]).toMatchObject({ path: '/api/filters/f1/advance', json: expect.objectContaining({ equipmentGroupId: 'ga', instrumentReadings: { pa: 1 } }) });
    expect(queuedAlone('F-002')).toBe(true);
    expect(screen.getByText(/F-002.*Bay B/)).toBeInTheDocument();
  });

  it('two filters bound to the same group (unchanged): one dialog, both sent with that group', async () => {
    const a = two({ f1: atWashIn(GA), f2: atWashIn(GA) }, [{ method: 'POST', path: /\/api\/filters\/f\d\/advance$/, body: { currentState: 'WASH_IN', actions: [] } }]);
    await scanAndSubmit(a, 'WASH_IN', 'North', ['F-001', 'F-002']);
    const d = (await screen.findByText('Equipment & Pressure Readings')).closest('.bg-white') as HTMLElement;
    expect(within(d).getByText('2 filter(s) → Wash In')).toBeInTheDocument();
    await within(d).findByText('RO pressure pa');
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(2));
    expect(posts(a, 'advance').map((r) => r.json.equipmentGroupId)).toEqual(['ga', 'ga']);
  });
});

// ── the last stage with a checklist after it, per filter ────────────────────
const CL1 = { id: 'cl1', name: 'Release check', version: 3, isActive: true, questions: [Q_YES] };
const CL2 = { id: 'cl2', name: 'Other check', version: 1, isActive: true, questions: [{ ...Q_YES, id: 'q2', question: 'Bagged?' }] };
const graph = (clId: string | null, first = 'STORAGE_IN') => ({
  stages: [
    { id: 'n-start', nodeType: 'START' },
    ...(first ? [{ id: 'n-a', nodeType: 'STAGE', stateKey: first }] : []),
    { id: 'n-b', nodeType: 'STAGE', stateKey: 'STORAGE_OUT' },
    ...(clId ? [{ id: 'n-cl', nodeType: 'CHECKLIST', configuration: { checklistProfileId: clId } }] : []),
    { id: 'n-end', nodeType: 'END' },
  ],
  connections: [
    ...(first ? [{ fromStageId: 'n-start', toStageId: 'n-a' }, { fromStageId: 'n-a', toStageId: 'n-b' }] : [{ fromStageId: 'n-start', toStageId: 'n-b' }]),
    ...(clId ? [{ fromStageId: 'n-b', toStageId: 'n-cl' }, { fromStageId: 'n-cl', toStageId: 'n-end' }] : [{ fromStageId: 'n-b', toStageId: 'n-end' }]),
  ],
});
const lookup = (clId: string | null) => ({ STORAGE_OUT: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: clId ? [clId] : [], interlockGated: false } });
const beforeFinal = (clId: string | null) => ({
  currentState: 'STORAGE_IN', tapeVersion: 7, blockChangeStatus: 'MATCH',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS' },
  actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance', params: { targetState: 'STORAGE_OUT' } }],
  pipelineGraph: graph(clId), stageLookup: lookup(clId), disabledChecklistProfileIds: [],
});
const DONE = { currentState: null, currentCycle: null, actions: [], tapeVersion: 0 };

describe('the last stage with a checklist after it: decided per filter', () => {
  it('one filter must carry the checklist, the other\'s profile has none: a bare advance for it, the checklist for the first', async () => {
    const a = two({ f1: beforeFinal('cl1'), f2: beforeFinal(null) }, [
      { method: 'POST', path: '/api/filters/f2/advance', body: DONE },
      { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
    ]);
    await scanAndSubmit(a, 'STORAGE_OUT', undefined, ['F-001', 'F-002']);
    await waitFor(() => expect(posts(a, 'advance').map((r) => r.path)).toEqual(['/api/filters/f2/advance']));
    await answerYes();
    expect(screen.getByText('1 filter(s)', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist').map((r) => r.path)).toEqual(['/api/filters/f1/advance-with-checklist']));
    expect(posts(a, 'advance').map((r) => r.path)).toEqual(['/api/filters/f2/advance']); // never a bare advance for f1
  });

  it('two filters with DIFFERENT checklists: one is asked, the other stays queued for its own submit', async () => {
    const a = two({ f1: beforeFinal('cl1'), f2: beforeFinal('cl2') }, [
      { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
    ]);
    await scanAndSubmit(a, 'STORAGE_OUT', undefined, ['F-001', 'F-002']);
    await answerYes();
    expect(screen.getByText('Release check')).toBeInTheDocument();
    expect(screen.queryByText('Other check')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    await settle();
    expect(posts(a, 'advance-with-checklist')[0].path).toBe('/api/filters/f1/advance-with-checklist');
    expect(posts(a, 'advance')).toEqual([]);
    expect(queuedAlone('F-002')).toBe(true);
    expect(screen.getByText(/F-002.*different checklist/)).toBeInTheDocument();
  });
});

// ── a batch START whose first stage is also the last ────────────────────────
describe('a cycle START whose first stage is the last, with a checklist after it', () => {
  const NEW = {
    currentState: null, currentCycle: null, actions: [], tapeVersion: 0, blockChangeStatus: 'MATCH',
    pipelineGraph: graph('cl1', ''), stageLookup: lookup('cl1'), disabledChecklistProfileIds: [],
  };

  it('asks the checklist BEFORE anything is written, then starts and enters + answers in one compound op', async () => {
    const a = setup({
      state: NEW,
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1] } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: { id: 'c9' } },
        { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
      ],
    });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await pickReasonAndStart();
    await answerYes();
    expect(posts(a, 'start-cycle')).toEqual([]); // nothing written while the checklist is open
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    expect(posts(a, 'start-cycle')[0].json).toMatchObject({ cleaningReasonKey: 'PM' });
    expect(posts(a, 'advance-with-checklist')[0].json).toMatchObject({ targetState: 'STORAGE_OUT', answers: { q1: 'Yes' } });
    expect(posts(a, 'advance')).toEqual([]); // never the refused bare advance
    expect(a.requests.filter((r) => r.method === 'POST').map((r) => r.path.split('/').pop())).toEqual(['start-cycle', 'advance-with-checklist']);
  });

  it('closing the checklist starts nothing', async () => {
    const a = setup({
      state: NEW,
      routes: [{ path: '/api/checklist-profiles', body: { data: [CL1] } }],
    });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await pickReasonAndStart();
    await answerYes();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(a.requests.filter((r) => r.method === 'POST')).toEqual([]);
  });
});

// ── a START whose first stage is the last: signature + missed-PM question ───
const NEW_FINAL = {
  currentState: null, currentCycle: null, actions: [], tapeVersion: 0, blockChangeStatus: 'MATCH',
  pipelineGraph: graph('cl1', ''), stageLookup: lookup('cl1'), disabledChecklistProfileIds: [],
};

describe('the parked START: one signature, the missed-PM question', () => {
  it('signed once for start + stage + checklist; a dismissed prompt is silent, nothing sent, the checklist stays', async () => {
    const a = setup({
      state: NEW_FINAL,
      reauthActions: ['START_CLEANING_CYCLE'],
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1] } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: { id: 'c9' } },
        { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
      ],
    });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await pickReasonAndStart(); // nothing is written here, so nothing is signed here
    await answerYes();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await cancelPrompt();
    await settle();
    expect(a.requests.filter((r) => r.method === 'POST')).toEqual([]);
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    expect(screen.queryByText(/failed|Cancelled/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await passReauth();
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    expectSigned(posts(a, 'start-cycle')[0]);
    expectSigned(posts(a, 'advance-with-checklist')[0]);
  });

  it('the start answers "an earlier PM is pending": asked once, the reasons ride on the retried start', async () => {
    const PM_TASK = { entryId: 'pm1', ahuName: 'AHU-01', plannedDate: '2026-09-15', windowStart: '2026-09-10', windowEnd: '2026-09-20', overdueDays: 31 };
    const a = setup({
      state: NEW_FINAL,
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1] } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 409, times: 1, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK], minReasonLength: 5 } } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: { id: 'c9' } },
        { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
      ],
    });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await pickReasonAndStart();
    await answerYes();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    fireEvent.change(await screen.findByPlaceholderText('Why was this scheduled cleaning not done?'), { target: { value: 'Plant shutdown in Sept' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save reasons & start cleaning' }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    const starts = posts(a, 'start-cycle');
    expect(starts).toHaveLength(2);
    expect(starts[0].json.pmSkips).toBeUndefined();
    expect(starts[1].json.pmSkips).toEqual([{ entryId: 'pm1', reason: 'Plant shutdown in Sept' }]);
    expect(posts(a, 'advance')).toEqual([]);
  });

  it('a mixed START batch: the plain filter starts and enters now, the checklist filter is asked, then started in one op', async () => {
    const NEW_PLAIN = { ...NEW_FINAL, pipelineGraph: graph(null, ''), stageLookup: lookup(null) };
    const a = two({ f1: NEW_FINAL, f2: NEW_PLAIN }, [
      { method: 'POST', path: /\/api\/filters\/f\d\/start-cycle/, status: 201, body: { id: 'c9' } },
      { method: 'POST', path: '/api/filters/f2/advance', body: DONE },
      { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
    ]);
    await scanAndSubmit(a, 'STORAGE_OUT', undefined, ['F-001', 'F-002']);
    await pickReasonAndStart();
    await answerYes();
    // F-002 (no checklist) was started and entered already; F-001 nothing yet.
    expect(posts(a, 'start-cycle').map((r) => r.path)).toEqual(['/api/filters/f2/start-cycle']);
    expect(posts(a, 'advance').map((r) => r.path)).toEqual(['/api/filters/f2/advance']);
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist').map((r) => r.path)).toEqual(['/api/filters/f1/advance-with-checklist']));
    expect(posts(a, 'start-cycle').map((r) => r.path)).toEqual(['/api/filters/f2/start-cycle', '/api/filters/f1/start-cycle']);
    expect(posts(a, 'advance').map((r) => r.path)).toEqual(['/api/filters/f2/advance']);
  });
});

// ── a checklist already waiting ─────────────────────────────────────────────
describe('a checklist already waiting: one set of answers only for the filters waiting on the SAME checklist', () => {
  const waitingOn = (cl: typeof CL1) => ({
    currentState: 'WASH_IN', currentCycle: { id: 'c1', status: 'IN_PROGRESS' }, tapeVersion: 7, blockChangeStatus: 'MATCH',
    actions: [{
      type: 'SUBMIT_CHECKLIST', label: `Submit Checklist: ${cl.name}`, blocking: true,
      params: { checklistProfileId: cl.id, checklistProfileName: cl.name, versionPin: cl.version, afterStage: 'WASH_IN', questions: cl.questions },
    }],
  });

  it('F-002 waits on another checklist: the answers go to F-001 only; F-002 stays queued, named', async () => {
    const a = two({ f1: waitingOn(CL1), f2: waitingOn(CL2) }, [
      { method: 'POST', path: '/api/filters/f1/submit-checklist', body: DONE },
    ]);
    await scanAndSubmit(a, 'WASH_OUT', undefined, ['F-001', 'F-002']);
    await answerYes();
    expect(screen.getByText('1 filter(s)', { selector: 'p' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'submit-checklist')).toHaveLength(1));
    await settle();
    expect(posts(a, 'submit-checklist')[0]).toMatchObject({ path: '/api/filters/f1/submit-checklist', json: { answers: { q1: 'Yes' } } });
    expect(queuedAlone('F-002')).toBe(true);
    expect(screen.getByText(/F-002: is waiting on a different checklist/)).toBeInTheDocument();
  });
});

// ── one AHU pre-flight for a split final-stage batch ────────────────────────
describe('the AHU pre-flight of a split final-stage batch', () => {
  it('POPUP: ONE completion check covers the checklist filter AND the completing plain one', async () => {
    const a = two({ f1: beforeFinal('cl1'), f2: beforeFinal(null) }, [
      { path: '/api/config/ahu-completion-process/current', body: { mode: 'POPUP' } },
      { method: 'POST', path: '/api/filters/ahu-set-availability', body: { hasBothSets: false } },
      { method: 'POST', path: '/api/filters/ahu-completion-status/batch', body: { ahus: [] } },
      { method: 'POST', path: '/api/filters/f2/advance', body: DONE },
      { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
    ]);
    await scanAndSubmit(a, 'STORAGE_OUT', undefined, ['F-001', 'F-002']);
    await answerYes();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    const checks = a.requests.filter((r) => r.method === 'POST' && r.path === '/api/filters/ahu-completion-status/batch');
    expect(checks.map((r) => r.json.filterIds)).toEqual([['f1', 'f2']]);
  });
});

// ── which filters a START is for ────────────────────────────────────────────
describe('a cycle START is only for filters with no cycle', () => {
  it('F-002 is already in a cycle: only F-001 is started; F-002 stays queued, named', async () => {
    const a = two({ f1: NEW_FILTER_STATE, f2: atWashIn(GA) }, [
      { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: { id: 'c9' } },
      { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_OUT', actions: [] } },
    ]);
    await scanAndSubmit(a, 'WASH_OUT', undefined, ['F-001', 'F-002']);
    expect(await screen.findByText(/^1 filter\(s\) .* Wash Out$/)).toBeInTheDocument();
    await pickReasonAndStart();
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    expect(posts(a, 'start-cycle').map((r) => r.path)).toEqual(['/api/filters/f1/start-cycle']);
    expect(screen.getByText(/F-002: is already in a cleaning cycle/)).toBeInTheDocument();
    expect(queuedAlone('F-002')).toBe(true);
  });
});

// ── a state that cannot be read ─────────────────────────────────────────────
describe('a filter whose state cannot be read', () => {
  it('never gets the first filter\'s call: it stays queued, named', async () => {
    const a = setup({
      state: { currentState: 'WASH_IN', currentCycle: { id: 'c1', status: 'IN_PROGRESS' }, tapeVersion: 7, blockChangeStatus: 'MATCH', actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance', params: { targetState: 'WASH_OUT' } }] },
      routes: [
        { path: '/api/filters/f2/current-state', status: 500, body: { error: 'INTERNAL', message: 'boom' } },
        { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_OUT', actions: [] } },
      ],
    });
    a.routes.unshift({ path: '/api/hierarchy/filters', body: { data: [F1, F2] } });
    await scanAndSubmit(a, 'WASH_OUT', undefined, ['F-001', 'F-002']);
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    await settle();
    expect(posts(a, 'advance')[0].path).toBe('/api/filters/f1/advance');
    expect(screen.getByText(/F-002: its current state could not be read/)).toBeInTheDocument();
    expect(queuedAlone('F-002')).toBe(true);
  });
});

// ── readings: the typed remark, readings left out, a block change ──────────
describe('the readings dialog', () => {
  const fillAndSubmit = async (expected: string) => {
    const d = (await screen.findByText('Equipment & Pressure Readings')).closest('.bg-white') as HTMLElement;
    expect(within(d).getByText(expected)).toBeInTheDocument();
    await within(d).findByText('RO pressure pa');
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
  };

  it('the remark typed before Submit is the one recorded (the dialog used to drop it for the default)', async () => {
    const a = two({ f1: atWashIn(GA), f2: atWashIn(GA) }, [{ method: 'POST', path: /\/api\/filters\/f\d\/advance$/, body: { currentState: 'WASH_IN', actions: [] } }]);
    await scanAndSubmit(a, 'WASH_IN', 'North', ['F-001', 'F-002'], { remarks: 'Night shift, bay 2' });
    await fillAndSubmit('2 filter(s) → Wash In');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(2));
    expect(posts(a, 'advance').map((r) => r.json.remarks)).toEqual(['Night shift, bay 2', 'Night shift, bay 2']);
  });

  it('a filter that takes readings at Wash In is not advanced without them when the first takes none', async () => {
    const GD = { id: 'gd', name: 'Dryer bay', blockId: 'b1', instruments: [{ ...inst('pd'), stageKey: 'DRY_IN' }] };
    const a = two({ f1: atWashIn(GD), f2: atWashIn(GA) }, [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_IN', actions: [] } }]);
    await scanAndSubmit(a, 'WASH_IN', 'North', ['F-001', 'F-002']);
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    await settle();
    expect(posts(a, 'advance')[0].json.instrumentReadings).toBeUndefined();
    expect(posts(a, 'advance')[0].path).toBe('/api/filters/f1/advance');
    expect(screen.getByText(/F-002: its cleaning cycle records readings with Bay A/)).toBeInTheDocument();
    expect(queuedAlone('F-002')).toBe(true);
  });

  it('a block-change refusal in a readings batch stays on screen (it was closed with the readings dialog)', async () => {
    const a = two({ f1: atWashIn(GA), f2: atWashIn(GA) }, [
      { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_IN', actions: [] } },
      { method: 'POST', path: '/api/filters/f2/advance', status: 409, body: {
        error: 'BLOCK_CHANGE_CONFIRM', message: 'F-002 belongs to South',
        details: { filterId: 'f2', homeBlockId: 'b2', homeBlockName: 'South', requestedBlockId: 'b1', requestedBlockName: 'North' },
      } },
    ]);
    await scanAndSubmit(a, 'WASH_IN', 'North', ['F-001', 'F-002']);
    await fillAndSubmit('2 filter(s) → Wash In');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(2));
    await settle();
    expect(screen.getByText('Cleaning in a different block')).toBeInTheDocument();
  });
});

// ── a cycle that finishes on what it started with ───────────────────────────
// CLAUDE.md: a cycle's profile is locked at its start, and its readings validate
// against the equipment-group version it started with. When the admin has since
// changed either, the cycle still finishes as it started: the operator is TOLD,
// never stopped (desktop BLOCKED on a changed profile until 2026-10-22, and its
// equipment-group notice was cleared by the same submit that set it).
describe('a cycle whose profile or equipment group changed since its start', () => {
  const inCycle = (extra: Record<string, unknown> = {}) => ({
    currentState: 'WASH_IN', tapeVersion: 7, blockChangeStatus: 'MATCH',
    currentCycle: { id: 'c1', status: 'IN_PROGRESS' },
    actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance', params: { targetState: 'WASH_OUT' } }],
    ...extra,
  });
  const warned = {
    profileSyncWarning: { cycleProfileId: 'p-old', cycleProfileName: 'Standard v1', expectedProfileId: 'p-new', expectedProfileName: 'Standard v2', recommendation: 'TERMINATE_AND_RESTART' },
    equipmentGroupSyncWarning: { groupId: 'g1', pinnedVersion: 2, liveVersion: 3, recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART' },
  };

  it('goes through, with a notice that stays after the submit and names only that filter', async () => {
    const a = two({ f1: inCycle(warned), f2: inCycle() }, [
      { method: 'POST', path: /\/api\/filters\/f\d\/advance$/, body: { currentState: 'WASH_OUT', actions: [] } },
    ]);
    await scanAndSubmit(a, 'WASH_OUT', undefined, ['F-001', 'F-002']);
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(2)); // not blocked
    await settle();
    expect(screen.queryByText(/Terminate the current cycle/)).toBeNull();
    expect(screen.getByText('Cleaning profile changed')).toBeInTheDocument();
    expect(screen.getByText(/F-001: running on "Standard v1"; this block now uses "Standard v2"/)).toBeInTheDocument();
    expect(screen.getByText(/finishes on the profile it started with/)).toBeInTheDocument();
    expect(screen.getByText('Equipment group changed')).toBeInTheDocument();
    expect(screen.getByText(/F-001: group updated v2 → v3/)).toBeInTheDocument();
    expect(screen.queryByText(/F-002:/)).toBeNull();
  });
});
