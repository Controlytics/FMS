/**
 * Filter Operations (web) — which station may answer a pending checklist
 * (2026-10-22; ONE rule with the tablet, lib/filter-ops/checklist-station.ts).
 *
 * A checklist pending at a cycle's current stage is answered only at that
 * stage's station or at one of its NEXT stages ("answer, then move on"). The
 * desktop opened it at ANY station: a cycle parked at Storage Out with its final
 * checklist pending, scanned at another station, was handed that checklist — and
 * submitting it completed the cycle. Neither the server nor the offline replay
 * knows which station scanned the filter, so the page is the only place to decide.
 * The dialog names the stage the checklist belongs to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, configure } from '@testing-library/react';
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
import { setup, scanAndSubmit, settle, answerYes, F1, Q_YES } from './filter-operations-kit';

configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
beforeEach(async () => { installFakeIndexedDB(); await openAppDb(); });

const F2 = { ...F1, id: 'f2', name: 'F-002' };
const CL = { id: 'cl1', name: 'Release check', version: 3, isActive: true, questions: [Q_YES] };
/** A cycle at `stage` whose checklist after it is pending; `next` = the stages after it. */
const waitingAt = (stage: string, next: string[]) => ({
  currentState: stage, tapeVersion: 7, blockChangeStatus: 'MATCH',
  currentCycle: { id: 'c1', status: 'IN_PROGRESS' },
  actions: [{
    type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Release check', blocking: true,
    params: { checklistProfileId: 'cl1', checklistProfileName: 'Release check', versionPin: 3, afterStage: stage, questions: [Q_YES] },
  }],
  stageLookup: { [stage]: { nextStages: next, leadsToEnd: next.length === 0, pendingChecklistProfileIds: ['cl1'], interlockGated: false } },
  disabledChecklistProfileIds: [],
});
const submits = (a: ReturnType<typeof setup>) => a.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/submit-checklist'));
const submitChecklist = () => fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
const routes = [
  { path: '/api/checklist-profiles', body: { data: [CL] } },
  { method: 'POST', path: /\/api\/filters\/f\d\/submit-checklist/, body: { currentState: null, actions: [] } },
];

describe('Filter Operations — the station a pending checklist is answered at', () => {
  it('the wrong station: refused with the station to go to; nothing opened, nothing sent', async () => {
    const a = setup({ state: waitingAt('STORAGE_OUT', []), routes });
    await scanAndSubmit(a, 'WASH_OUT');
    expect(await screen.findByText(/F-001 has a pending Storage Out checklist — scan it at Storage Out/)).toBeInTheDocument();
    await settle();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(submits(a)).toEqual([]);
  });

  it('its own station: the dialog opens, naming the checklist\'s stage, and the answers are sent', async () => {
    const a = setup({ state: waitingAt('STORAGE_OUT', []), routes });
    await scanAndSubmit(a, 'STORAGE_OUT');
    await answerYes();
    expect(screen.getByText('Storage Out stage checklist')).toBeInTheDocument();
    submitChecklist();
    await waitFor(() => expect(submits(a)).toHaveLength(1));
  });

  it('a legal NEXT station: allowed ("answer, then move on"), still named after its own stage', async () => {
    const a = setup({ state: waitingAt('WASH_IN', ['WASH_OUT']), routes });
    await scanAndSubmit(a, 'WASH_OUT');
    await answerYes();
    expect(screen.getByText('Wash In stage checklist')).toBeInTheDocument();
    submitChecklist();
    await waitFor(() => expect(submits(a)).toHaveLength(1));
  });

  it('a batch: the filter at the wrong station is named and left out; the other is asked', async () => {
    const a = setup({ state: waitingAt('STORAGE_OUT', []), routes: [{ path: '/api/filters/f2/current-state', body: waitingAt('WASH_IN', ['WASH_OUT']) }, ...routes] });
    a.routes.unshift({ path: '/api/hierarchy/filters', body: { data: [F1, F2] } });
    await scanAndSubmit(a, 'WASH_OUT', undefined, ['F-001', 'F-002']);
    await answerYes();
    expect(screen.getByText('1 filter(s)', { selector: 'p' })).toBeInTheDocument(); // F-002 only
    submitChecklist();
    await waitFor(() => expect(submits(a).map((r) => r.path)).toEqual(['/api/filters/f2/submit-checklist']));
    expect(screen.getByText(/F-001 has a pending Storage Out checklist — scan it at Storage Out/)).toBeInTheDocument();
  });
  // c4621a7: a cycle waiting at START (started, no stage entered) answers its
  // checklist before the first stage only at a first stage's station.
  const waitingAtStart = {
    currentState: null, tapeVersion: 3, blockChangeStatus: 'MATCH',
    currentCycle: { id: 'c1', status: 'IN_PROGRESS' },
    actions: [{
      type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Release check', blocking: true,
      params: { checklistProfileId: 'cl1', checklistProfileName: 'Release check', versionPin: 3, afterStage: null, questions: [Q_YES] },
    }],
    pipelineGraph: {
      stages: [
        { id: 'n-start', nodeType: 'START' },
        { id: 'n-cl', nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl1' } },
        { id: 'n-a', nodeType: 'STAGE', stateKey: 'STORAGE_IN' },
        { id: 'n-b', nodeType: 'STAGE', stateKey: 'STORAGE_OUT' },
        { id: 'n-end', nodeType: 'END' },
      ],
      connections: [
        { fromStageId: 'n-start', toStageId: 'n-cl' }, { fromStageId: 'n-cl', toStageId: 'n-a' },
        { fromStageId: 'n-a', toStageId: 'n-b' }, { fromStageId: 'n-b', toStageId: 'n-end' },
      ],
    },
    stageLookup: {
      STORAGE_IN: { nextStages: ['STORAGE_OUT'], leadsToEnd: false, pendingChecklistProfileIds: [], interlockGated: false },
      STORAGE_OUT: { nextStages: [], leadsToEnd: true, pendingChecklistProfileIds: [], interlockGated: false },
    },
    disabledChecklistProfileIds: [],
  };

  it('a cycle waiting at START, scanned past its first stage: refused, naming the first stage; nothing sent', async () => {
    const a = setup({ state: waitingAtStart, routes });
    await scanAndSubmit(a, 'STORAGE_OUT');
    expect(await screen.findByText(/F-001 has a pending checklist before its first stage — scan it at Storage In/)).toBeInTheDocument();
    await settle();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(submits(a)).toEqual([]);
  });

  it('a cycle waiting at START, scanned at its first stage: asked there', async () => {
    const a = setup({ state: waitingAtStart, routes });
    await scanAndSubmit(a, 'STORAGE_IN');
    await answerYes();
    submitChecklist();
    await waitFor(() => expect(submits(a)).toHaveLength(1));
  });
});
