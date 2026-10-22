/**
 * Filter Operations (web) — the LAST stage with a checklist after it (A-01).
 *
 * Since 2026-10-21 the server refuses a bare advance into the final stage when an
 * enabled checklist follows it (409 CHECKLIST_REQUIRED): the stage is entered and
 * the checklist answered in ONE call, advance-with-checklist. Every live desktop
 * advance went through the batch loop as a bare /advance, so the page answered
 * "0 succeeded, 1 failed: … must be answered in the same step" and never opened
 * the checklist — desktop could not complete those cycles at all.
 *
 * The page now asks the checklist FIRST, with each filter's advance parked on the
 * dialog, by the server's own rule (packages/shared advanceMustCarryChecklist over
 * the server-built stageLookup): a disabled checklist, a QA-interlock final stage
 * and a mid-pipeline stage keep the bare advance.
 *
 * Same boundaries as filter-operations-reauth.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { installFakeIndexedDB, openAppDb, cacheRow, type FakeIdb } from '../hooks/__tests__/fake-indexeddb';

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

import { usePageTestLifecycle, passReauth } from './fm-test-kit';
import { setup, scanAndSubmit, cancelPrompt, settle, F1, Q_YES } from './filter-operations-kit';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
let idb: FakeIdb;
beforeEach(async () => { idb = installFakeIndexedDB(); await openAppDb(); });

const F2 = { ...F1, id: 'f2', name: 'F-002' };
const PROFILE = { id: 'cl1', name: 'Release check', version: 3, isActive: true, questions: [Q_YES] };
const graph = (last: string) => ({
  stages: [
    { id: 'n-start', nodeType: 'START' },
    { id: 'n-a', nodeType: 'STAGE', stateKey: 'STORAGE_IN' },
    { id: 'n-b', nodeType: 'STAGE', stateKey: last },
    { id: 'n-cl', nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl1' } },
    { id: 'n-end', nodeType: 'END' },
  ],
  connections: [
    { fromStageId: 'n-start', toStageId: 'n-a' }, { fromStageId: 'n-a', toStageId: 'n-b' },
    { fromStageId: 'n-b', toStageId: 'n-cl' }, { fromStageId: 'n-cl', toStageId: 'n-end' },
  ],
});
/** A filter one step before `target`; `lookup` is the server's stageLookup entry for `target`. */
const before = (target: string, lookup: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  currentState: 'STORAGE_IN', tapeVersion: 7, blockChangeStatus: 'MATCH',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1' },
  actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance', params: { targetState: target } }],
  pipelineGraph: graph(target),
  stageLookup: { [target]: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: ['cl1'], interlockGated: false, ...lookup } },
  disabledChecklistProfileIds: [],
  ...extra,
});
const FINAL = before('STORAGE_OUT', {});
const DONE = { currentState: null, currentCycle: null, actions: [], tapeVersion: 0 };

function api(state: unknown, routes: any[] = [], o: { reauthActions?: string[]; two?: boolean } = {}) {
  const a = setup({
    state,
    reauthActions: o.reauthActions,
    routes: [
      { path: '/api/checklist-profiles', body: { data: [PROFILE] } },
      { path: '/api/filters/f2/current-state', body: state },
      ...routes,
    ],
  });
  if (o.two) a.routes.unshift({ path: '/api/hierarchy/filters', body: { data: [F1, F2] } });
  return a;
}
const posts = (a: ReturnType<typeof setup>, kind: string) => a.requests.filter((r) => r.method === 'POST' && r.path.endsWith(`/${kind}`));
const answerAndSubmit = async () => {
  await screen.findByText('Checklist Required');
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
  fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
  await settle();
};

describe('Filter Operations — the last stage with a checklist after it (A-01)', () => {
  it('asks the checklist FIRST (nothing written), then enters the stage and answers it in ONE call', async () => {
    const a = api(FINAL, [{ method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE }]);
    await scanAndSubmit(a, 'STORAGE_OUT');
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('Release check')).toBeInTheDocument();
    expect(posts(a, 'advance')).toEqual([]); // the advance is parked on the dialog, not sent
    await answerAndSubmit();
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    expect(posts(a, 'advance-with-checklist')[0].json).toMatchObject({
      targetState: 'STORAGE_OUT', answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 }, tapeVersion: 7, remarks: 'Storage Out - Batch - F-001',
    });
    expect(posts(a, 'advance')).toEqual([]);
    expect(posts(a, 'submit-checklist')).toEqual([]);
    expect(await screen.findByText(/1 filter\(s\) → Storage Out/)).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).toBeNull();
  });

  it('a batch: ONE dialog for every filter, then one advance-with-checklist per filter', async () => {
    idb.seed('cache', [cacheRow('filter-state-f2', { ...FINAL, tapeVersion: 9 })]);
    const a = api(FINAL, [{ method: 'POST', path: /\/api\/filters\/f\d\/advance-with-checklist/, body: DONE }], { two: true });
    await scanAndSubmit(a, 'STORAGE_OUT', undefined, ['F-001', 'F-002']);
    expect(await screen.findByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument();
    await answerAndSubmit();
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(2));
    expect(posts(a, 'advance-with-checklist').map((r) => [r.path, r.json.answers, r.json.tapeVersion])).toEqual([
      ['/api/filters/f1/advance-with-checklist', { q1: 'Yes' }, 7],
      ['/api/filters/f2/advance-with-checklist', { q1: 'Yes' }, 9],
    ]);
    expect(await screen.findByText(/2 filter\(s\) → Storage Out/)).toBeInTheDocument();
  });

  it('one filter refused in the batch: shown by name; the other goes through', async () => {
    idb.seed('cache', [cacheRow('filter-state-f2', FINAL)]);
    const a = api(FINAL, [
      { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE },
      { method: 'POST', path: '/api/filters/f2/advance-with-checklist', status: 409, body: { error: 'AHU_INTERLOCK_PENDING', message: 'Other filters of this AHU are still in cleaning' } },
    ], { two: true });
    await scanAndSubmit(a, 'STORAGE_OUT', undefined, ['F-001', 'F-002']);
    await answerAndSubmit();
    expect(await screen.findByText(/1 succeeded, 1 failed/)).toBeInTheDocument();
    expect(screen.getByText(/F-002: Other filters of this AHU are still in cleaning/)).toBeInTheDocument();
    expect(posts(a, 'advance-with-checklist')).toHaveLength(2);
  });

  it('a dismissed password prompt (both signatures asked once) is silent; nothing is sent, the checklist stays', async () => {
    const a = api(FINAL, [{ method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE }], { reauthActions: ['ADVANCE_FILTER_STAGE'] });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await answerAndSubmit();
    await cancelPrompt();
    await settle();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(posts(a, 'advance-with-checklist')).toEqual([]);
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    // and the retry is signed once for the combined call
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await passReauth();
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    expect(posts(a, 'advance-with-checklist')[0].headers['x-reauth-password']).toBe('Secret@123');
  });

  it('a DISABLED checklist is skipped: no dialog, a bare advance (unchanged)', async () => {
    const a = api(before('STORAGE_OUT', {}, { disabledChecklistProfileIds: ['cl1'] }), [{ method: 'POST', path: '/api/filters/f1/advance', body: DONE }]);
    await scanAndSubmit(a, 'STORAGE_OUT');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(posts(a, 'advance-with-checklist')).toEqual([]);
  });

  it('a QA-interlock final stage keeps the bare advance: enter → PENDING approval → checklist after approval (unchanged)', async () => {
    const a = api(before('DRY_OUT', { interlockGated: true }), [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'DRY_OUT', actions: [] } }]);
    await scanAndSubmit(a, 'DRY_OUT');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(posts(a, 'advance-with-checklist')).toEqual([]);
  });

  it('a mid-pipeline stage with a checklist after it keeps the bare advance (unchanged)', async () => {
    const a = api(before('STORAGE_OUT', { nextStages: ['WASH_IN'], leadsToEnd: false }), [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'STORAGE_OUT', actions: [] } }]);
    await scanAndSubmit(a, 'STORAGE_OUT');
    await waitFor(() => expect(posts(a, 'advance')).toHaveLength(1));
    expect(screen.queryByText('Checklist Required')).toBeNull();
  });

  it('readings into the last stage: equipment readings AND checklist go in the same single call', async () => {
    const inst = { id: 'pa', instrumentId: 'PG-A', description: 'RO pressure PG-A', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 1 };
    const GA = { id: 'ga', name: 'Bay A', blockId: 'b1', instruments: [inst] };
    const state = before('WASH_IN', {}, {
      currentCycle: { id: 'c1', status: 'IN_PROGRESS', cleaningAreaId: 'b1', equipmentGroupId: 'ga' },
      equipmentGroup: GA, blockEquipmentGroups: [],
    });
    const a = api(state, [{ method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: DONE }]);
    await scanAndSubmit(a, 'WASH_IN', 'North');
    const d = (await screen.findByText('Equipment & Pressure Readings')).closest('.bg-white') as HTMLElement;
    await within(d).findByText('RO pressure PG-A');
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: '1' } });
    fireEvent.click(within(d).getByRole('button', { name: /Submit/ }));
    // the readings dialog hands over to the checklist; nothing written yet
    await answerAndSubmit();
    await waitFor(() => expect(posts(a, 'advance-with-checklist')).toHaveLength(1));
    expect(posts(a, 'advance-with-checklist')[0].json).toMatchObject({
      targetState: 'WASH_IN', cleaningAreaId: 'b1', equipmentGroupId: 'ga', instrumentReadings: { pa: 1 }, answers: { q1: 'Yes' },
    });
    expect(posts(a, 'advance')).toEqual([]);
  });
});
