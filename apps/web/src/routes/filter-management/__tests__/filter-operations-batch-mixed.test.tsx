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
import { setup, scanAndSubmit, settle, answerYes, answerPmQuestion, pickReasonAndStart, cancelPrompt, F1, Q_YES, NEW_FILTER_STATE } from './filter-operations-kit';

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
    fireEvent.click(within(screen.getByRole('button', { name: /Submit Checklist/ }).parentElement as HTMLElement).getByRole('button', { name: 'Cancel' }));
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
    await answerPmQuestion('Plant shutdown in Sept');
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
    stageLookup: { WASH_IN: { nextStages: ['WASH_OUT'], leadsToEnd: false, pendingChecklistProfileIds: [cl.id], interlockGated: false } },
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

// ── the Dry In readings step (2026-10-22: every pipeline shape completes) ───
// A FINAL Dry In completes on its readings (SUBMIT_READINGS), so the checklist
// after it rides on them — one advance-with-checklist; a bare SUBMIT_READINGS
// there is refused CHECKLIST_REQUIRED. A Dry In with no group, or a group with
// no Dry In instrument, has nothing to read: the step is SUBMIT_READINGS with no
// readings (the server accepts it); desktop sent a bare advance into Dry In.
describe('the Dry In readings step', () => {
  const temp = { id: 't1', instrumentId: 'TG-1', description: 'Dryer temp TG-1', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 61, leastCount: 1 };
  const DRYER = { id: 'gd', name: 'Dryer bay', blockId: 'b1', instruments: [temp] };
  const atHalfTime = (o: { group?: any; final?: string | null } = {}) => ({
    currentState: 'DRY_IN', tapeVersion: 7, blockChangeStatus: 'MATCH', actions: [],
    currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: o.group?.id ?? null, dryerStartedAt: new Date(Date.now() - 60 * 60_000).toISOString(), dryerDurationMinutes: 10, dryerReadingsSubmitted: false },
    equipmentGroup: o.group ?? null, blockEquipmentGroups: [],
    ...(o.final !== undefined ? {
      stageLookup: { DRY_IN: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: o.final ? [o.final] : [], interlockGated: false } },
      disabledChecklistProfileIds: [],
    } : {}),
  });
  const one = (state: unknown, routes: any[]) => setup({ state, routes: [{ path: '/api/checklist-profiles', body: { data: [CL1] } }, ...routes] });

  it('a FINAL Dry In with a checklist after it: readings, then the checklist, then ONE advance-with-checklist', async () => {
    const a = one(atHalfTime({ group: DRYER, final: 'cl1' }), [{ method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE }]);
    await scanAndSubmit(a, 'DRY_IN', 'North');
    const d = (await screen.findByText('Dryer Temperature Reading')).closest('.bg-white') as HTMLElement;
    await within(d).findByText('Dryer temp TG-1');
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: '60' } });
    fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
    await answerYes();
    expect(posts(a, 'advance')).toEqual([]); // nothing written while the checklist is open
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    expect(posts(a, 'advance-with-checklist')[0].json).toMatchObject({
      targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', equipmentGroupId: 'gd', instrumentReadings: { t1: 60 }, answers: { q1: 'Yes' },
    });
    expect(posts(a, 'advance')).toEqual([]);
  });

  it('no equipment group: the readings step is sent with no readings (was a bare advance into Dry In)', async () => {
    const a = one(atHalfTime(), [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'DRY_IN', actions: [] } }]);
    await scanAndSubmit(a, 'DRY_IN', 'North');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    const body = posts(a, 'advance')[0].json;
    expect(body).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect(body.instrumentReadings).toBeUndefined();
    expect(body.equipmentGroupId).toBeUndefined();
  });

  it('a group with no Dry In instrument: no readings dialog, the step is sent with no readings', async () => {
    const WASH_ONLY = { id: 'gw', name: 'Wash bay', blockId: 'b1', instruments: [{ ...temp, id: 'p1', stageKey: 'WASH_IN', description: 'RO pressure' }] };
    const a = one(atHalfTime({ group: WASH_ONLY }), [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'DRY_IN', actions: [] } }]);
    await scanAndSubmit(a, 'DRY_IN', 'North');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    expect(screen.queryByText('Dryer Temperature Reading')).toBeNull();
    expect(posts(a, 'advance')[0].json).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS' });
    expect(posts(a, 'advance')[0].json.instrumentReadings).toBeUndefined();
  });

  it('nothing to read at a FINAL Dry In with a checklist: the checklist, then ONE advance-with-checklist with no readings', async () => {
    const a = one(atHalfTime({ final: 'cl1' }), [{ method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE }]);
    await scanAndSubmit(a, 'DRY_IN', 'North');
    await answerYes();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    const body = posts(a, 'advance-with-checklist')[0].json;
    expect(body).toMatchObject({ targetState: 'DRY_IN', dryerAction: 'SUBMIT_READINGS', answers: { q1: 'Yes' } });
    expect(body.instrumentReadings).toBeUndefined();
    expect(posts(a, 'advance')).toEqual([]);
  });
});

// ── a checklist BEFORE the first stage (2026-10-22) ─────────────────────────
// START is a position: the checklists between START and the first stage are
// answered after start-cycle and gate the first entry. Desktop started the
// cycle, then sent the advance, which the server refused (CHECKLIST_PENDING) —
// a cycle started at no stage. Now: the dialog FIRST, nothing written; then per
// filter start-cycle → submit-checklist (at START) → advance. Never the compound
// start-and-advance for such a filter (an offline replay would skip the START
// checklist silently).
describe('a checklist before the first stage', () => {
  const startGraph = (startCl: string | null, stages: string[], afterLast: string | null = null) => {
    const nodes: any[] = [{ id: 'n-start', nodeType: 'START' }];
    const edges: any[] = [];
    let prev = 'n-start';
    const link = (n: any) => { nodes.push(n); edges.push({ fromStageId: prev, toStageId: n.id }); prev = n.id; };
    if (startCl) link({ id: 'n-scl', nodeType: 'CHECKLIST', configuration: { checklistProfileId: startCl } });
    stages.forEach((k) => link({ id: `n-${k}`, nodeType: 'STAGE', stateKey: k }));
    if (afterLast) link({ id: 'n-acl', nodeType: 'CHECKLIST', configuration: { checklistProfileId: afterLast } });
    link({ id: 'n-end', nodeType: 'END' });
    const stageLookup = Object.fromEntries(stages.map((k, i) => [k, {
      nextStages: i < stages.length - 1 ? [stages[i + 1]] : [], leadsToEnd: i === stages.length - 1,
      pendingChecklistProfileIds: i === stages.length - 1 && afterLast ? [afterLast] : [], interlockGated: false,
    }]));
    return { currentState: null, currentCycle: null, actions: [], tapeVersion: 0, blockChangeStatus: 'MATCH', pipelineGraph: { stages: nodes, connections: edges }, stageLookup, disabledChecklistProfileIds: [] };
  };
  const order = (a: ReturnType<typeof setup>) => a.requests.filter((r) => r.method === 'POST' && r.path.startsWith('/api/filters/f')).map((r) => r.path.replace('/api/filters/', ''));
  const submitChecklist = () => fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
  const okRoutes = (id = 'f1') => [
    { method: 'POST', path: `/api/filters/${id}/start-cycle`, status: 201, body: { id: `c-${id}` } },
    { method: 'POST', path: `/api/filters/${id}/submit-checklist`, body: { currentState: null, actions: [] } },
    { method: 'POST', path: `/api/filters/${id}/advance`, body: { currentState: 'STORAGE_IN', actions: [] } },
  ];

  it('asks it FIRST (nothing written), then start-cycle → submit-checklist → advance, in that order', async () => {
    const a = setup({ state: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']), routes: [{ path: '/api/checklist-profiles', body: { data: [CL1, CL2] } }, ...okRoutes()] });
    await scanAndSubmit(a, 'STORAGE_IN');
    await pickReasonAndStart();
    await answerYes();
    expect(order(a)).toEqual([]);
    submitChecklist();
    await waitFor(() => expect(order(a)).toEqual(['f1/start-cycle', 'f1/submit-checklist', 'f1/advance']));
    expect(posts(a, 'submit-checklist')[0].json).toMatchObject({ answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 } });
    expect(posts(a, 'advance')[0].json).toMatchObject({ targetState: 'STORAGE_IN' });
    expect(await screen.findByText(/1 filter\(s\) → Storage In/)).toBeInTheDocument();
  });

  it('cancelling it writes nothing', async () => {
    const a = setup({ state: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']), routes: [{ path: '/api/checklist-profiles', body: { data: [CL1] } }, ...okRoutes()] });
    await scanAndSubmit(a, 'STORAGE_IN');
    await pickReasonAndStart();
    await answerYes();
    fireEvent.click(within(screen.getByRole('button', { name: /Submit Checklist/ }).parentElement as HTMLElement).getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(order(a)).toEqual([]);
  });

  it('a mixed batch: the filter without one starts and enters now; the other is asked, then started', async () => {
    const a = two({ f1: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']), f2: startGraph(null, ['STORAGE_IN', 'STORAGE_OUT']) }, [...okRoutes('f1'), ...okRoutes('f2')]);
    await scanAndSubmit(a, 'STORAGE_IN', undefined, ['F-001', 'F-002']);
    await pickReasonAndStart();
    await answerYes();
    expect(order(a)).toEqual(['f2/start-cycle', 'f2/advance']);
    submitChecklist();
    await waitFor(() => expect(order(a)).toEqual(['f2/start-cycle', 'f2/advance', 'f1/start-cycle', 'f1/submit-checklist', 'f1/advance']));
  });

  it('the first stage is also the last, with a checklist after it: the START checklist, then the last one, never a compound start', async () => {
    const a = setup({
      state: startGraph('cl2', ['STORAGE_OUT'], 'cl1'),
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1, CL2] } },
        ...okRoutes(),
        { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
      ],
    });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await pickReasonAndStart();
    expect(await screen.findByText('Other check')).toBeInTheDocument();
    await answerYes();
    submitChecklist();
    await waitFor(() => expect(order(a)).toEqual(['f1/start-cycle', 'f1/submit-checklist']));
    expect(await screen.findByText('Release check')).toBeInTheDocument();
    await answerYes();
    submitChecklist();
    await waitFor(() => expect(order(a)).toEqual(['f1/start-cycle', 'f1/submit-checklist', 'f1/advance-with-checklist']));
    expect(posts(a, 'submit-checklist')[0].json.answers).toEqual({ q2: 'Yes' });
    expect(posts(a, 'advance-with-checklist')[0].json).toMatchObject({ targetState: 'STORAGE_OUT', answers: { q1: 'Yes' } });
  });

  it('the start answers "an earlier PM is pending": asked once, the start retried with the reasons, then the checklist and the advance', async () => {
    const PM_TASK = { entryId: 'pm1', ahuName: 'AHU-01', plannedDate: '2026-09-15', windowStart: '2026-09-10', windowEnd: '2026-09-20', overdueDays: 31 };
    const a = setup({
      state: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']),
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1] } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 409, times: 1, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK], minReasonLength: 5 } } },
        ...okRoutes(),
      ],
    });
    await scanAndSubmit(a, 'STORAGE_IN');
    await pickReasonAndStart();
    await answerYes();
    submitChecklist();
    await answerPmQuestion('Plant shutdown in Sept');
    await waitFor(() => expect(order(a)).toEqual(['f1/start-cycle', 'f1/start-cycle', 'f1/submit-checklist', 'f1/advance']));
    expect(posts(a, 'start-cycle')[1].json.pmSkips).toEqual([{ entryId: 'pm1', reason: 'Plant shutdown in Sept' }]);
  });

  it('ONE signature covers the start, the checklist and the entry', async () => {
    const a = setup({
      state: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']),
      reauthActions: ['START_CLEANING_CYCLE', 'ADVANCE_FILTER_STAGE'],
      routes: [{ path: '/api/checklist-profiles', body: { data: [CL1] } }, { method: 'POST', path: '/api/auth/verify', body: { success: true } }, ...okRoutes()],
    });
    await scanAndSubmit(a, 'STORAGE_IN');
    await pickReasonAndStart(); // nothing is written here, so nothing is signed here
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
    await answerYes();
    submitChecklist();
    await passReauth();
    await waitFor(() => expect(order(a)).toEqual(['f1/start-cycle', 'f1/submit-checklist', 'f1/advance']));
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull(); // not asked a second time
    for (const kind of ['start-cycle', 'submit-checklist', 'advance']) expectSigned(posts(a, kind)[0]);
  });
  it('started, but the checklist is refused: named as started, nothing advanced', async () => {
    const a = setup({
      state: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']),
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1] } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: { id: 'c-f1' } },
        { method: 'POST', path: '/api/filters/f1/submit-checklist', status: 409, body: { error: 'SCHEMA_DRIFT', message: 'The checklist changed' } },
      ],
    });
    await scanAndSubmit(a, 'STORAGE_IN');
    await pickReasonAndStart();
    await answerYes();
    submitChecklist();
    expect(await screen.findByText(/F-001: the cycle started, but its first checklist was not recorded \(The checklist changed\)\. Scan it again to answer it\./)).toBeInTheDocument();
    expect(order(a)).toEqual(['f1/start-cycle', 'f1/submit-checklist']);
  });

  it('a cycle waiting at START: the next scan asks its checklist from the tape — never a second start', async () => {
    const atStart = {
      ...startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']),
      currentCycle: { id: 'c-f1', status: 'IN_PROGRESS' }, tapeVersion: 3,
      actions: [{
        type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Release check', blocking: true,
        params: { checklistProfileId: 'cl1', checklistProfileName: 'Release check', versionPin: 3, afterStage: null, questions: [Q_YES] },
      }],
    };
    const a = setup({ state: atStart, routes: [{ path: '/api/checklist-profiles', body: { data: [CL1] } }, ...okRoutes()] });
    await scanAndSubmit(a, 'STORAGE_IN');
    await answerYes();
    submitChecklist();
    await waitFor(() => expect(order(a)).toEqual(['f1/submit-checklist']));
    expect(posts(a, 'submit-checklist')[0].json).toMatchObject({ answers: { q1: 'Yes' } });
  });
  it('the missed-PM question closed: the filter is not started, no checklist sent; said so', async () => {
    const PM_TASK = { entryId: 'pm1', ahuName: 'AHU-01', plannedDate: '2026-09-15', windowStart: '2026-09-10', windowEnd: '2026-09-20', overdueDays: 31 };
    const a = setup({
      state: startGraph('cl1', ['STORAGE_IN', 'STORAGE_OUT']),
      routes: [
        { path: '/api/checklist-profiles', body: { data: [CL1] } },
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 409, body: { error: 'PM_PREVIOUS_TASK_PENDING', message: 'An earlier PM is pending', details: { pendingPmTasks: [PM_TASK], minReasonLength: 5 } } },
      ],
    });
    await scanAndSubmit(a, 'STORAGE_IN');
    await pickReasonAndStart();
    await answerYes();
    submitChecklist();
    await screen.findByPlaceholderText('Why was this scheduled cleaning not done?');
    await settle();
    fireEvent.click(within(screen.getByRole('button', { name: 'Save reasons & start cleaning' }).parentElement as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/F-001: not started — the missed-PM question was closed/)).toBeInTheDocument();
    expect(order(a)).toEqual(['f1/start-cycle']); // the refused start only
  });
});
