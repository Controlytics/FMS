/**
 * Filter Operations (web) — the two re-auth signatures on the stage screen
 * (2026-10-22):
 *
 *  - START_CLEANING_CYCLE (+ the station row), asked once for a batch of new
 *    cycles from the cleaning-reason dialog. A dismissed prompt used to come back
 *    through the hook's fallback onError as a "Cancelled — …" error popup AND a
 *    red line in the reason dialog.
 *  - SUBMIT_CHECKLIST_WITH_SIGNATURE, asked once for a checklist submitted for a
 *    batch. The call passed no handlers at all, and the batch loop swallowed the
 *    re-auth answers: a wrong password closed the prompt and listed every filter
 *    as "failed", and a server REAUTH_REQUIRED (stale gate) never opened the
 *    prompt. The tablet copy (mobile-operations) already re-throws them.
 *
 * Boundaries faked: Capacitor connectivity + the sync engine (protected surface;
 * no background replay mid-test), the drying panel, and IndexedDB (the real
 * offline-store runs on an in-memory stand-in). Everything else is real: the page,
 * useReauth + ReauthDialog, useOffline.executeOrQueue, the filter-ops core,
 * apiClient and SWR — only fetch is stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, act, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { usePageTestLifecycle, passReauth, expectSigned, allowConsoleError } from './fm-test-kit';
import { installFakeIndexedDB, openAppDb, cacheRow } from '../hooks/__tests__/fake-indexeddb';

const conn = vi.hoisted(() => ({ online: true }));
vi.mock('@/lib/connectivity', () => ({
  isOnline: () => conn.online,
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

import { FilterOperationsPage } from '../filter-operations';

// Whole-page renders (SWR + IndexedDB + many reads): under a loaded run the
// default 1 s findBy / 5 s test budgets flake. Upper bounds, not delays.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });
usePageTestLifecycle();
beforeEach(async () => {
  conn.online = true;
  installFakeIndexedDB();
  await openAppDb();
});

const OPERATOR: TestUser = { id: 'u-op', username: 'op1', fullName: 'Ravi Kumar', role: 'OPERATOR', permissions: ['FILTER_OPERATE', 'ASSET_READ'] };
const F1 = { id: 'f1', name: 'F-001', ahuId: 'h1', approvalStatus: 'APPROVED', currentLifecycleState: null, isActive: true };
const Q_YES = { id: 'q1', question: 'Filter intact?', questionType: 'YES_NO', required: true };
const SUBMIT_CL = {
  type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Post-wash check', blocking: true,
  params: { checklistProfileId: 'cl1', checklistProfileName: 'Post-wash check', versionPin: 3, afterStage: 'WASH_IN', questions: [Q_YES] },
};
const NEW_FILTER_STATE = { currentState: null, currentCycle: null, actions: [], tapeVersion: 0, blockChangeStatus: 'MATCH' };
const AWAITING_CHECKLIST = {
  currentState: 'WASH_IN', currentCycle: { id: 'c1', status: 'IN_PROGRESS' }, actions: [SUBMIT_CL], tapeVersion: 7, blockChangeStatus: 'MATCH',
};
const REAUTH_FAILED: MockRoute['body'] = { error: 'REAUTH_FAILED', message: 'Invalid password' };

function setup(o: { reauthActions?: string[]; state: unknown; routes?: MockRoute[] }) {
  return mockApi([
    ...(o.routes ?? []),
    { path: '/api/filters/f1/current-state', body: o.state },
    { path: /^\/api\/assets\/identifiers\/lookup\//, body: { asset: null } },
    { path: '/api/hierarchy/filters', body: { data: [F1] } },
    { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b1', name: 'North', isActive: true }] } },
    { path: '/api/hierarchy/ahus', body: { data: [{ id: 'h1', name: 'AHU-01', areaId: null, blockId: 'b1' }] } },
    { path: '/api/hierarchy/areas', body: { data: [] } },
    { path: '/api/assets/instances', body: { data: [] } },
    { path: '/api/assets/templates', body: { data: [] } },
    { path: '/api/assets/identifiers', body: [] },
    { path: '/api/filters/reasons', body: { reasons: [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }] } },
    { path: '/api/equipment-groups', body: [] },
    { path: '/api/checklist-profiles', body: { data: [] } },
    { path: '/api/filter-cleaning-profiles', body: { data: [] } },
    { path: '/api/config/action-reauth/my-actions', body: { actions: o.reauthActions ?? [] } },
    { path: '/api/config/ahu-completion-process/current', body: { mode: 'NONE' } },
    { path: '/api/config/block-change-approval/current', body: { mode: 'CONFIRM' } },
    { path: '/api/config/datetime/current', body: {} },
    { path: '/api/config/field-ids/current', body: [] },
    { path: '/api/config/cleaning-profile-assignment/current', body: { mode: 'BY_AHU', rules: [] } },
    { path: '/api/filters/batch-states', body: { states: {}, cachedAt: '2026-10-22T00:00:00.000Z' } },
    { path: '/api/pm-schedules/pending-tasks-map', body: {} },
    { path: '/api/replacement-schedules/blocked-filters', body: { filterIds: [] } },
    { path: '/api/health', body: { status: 'ok' } },
  ]);
}

async function openWashOut(api: ReturnType<typeof setup>) {
  renderPage(<FilterOperationsPage />, { route: '/filters/stage/WASH_OUT', path: '/filters/stage/:stageKey', user: OPERATOR, api });
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await waitFor(() => expect(api.calls('GET', '/api/hierarchy/filters').length).toBeGreaterThan(0));
  const input = await screen.findByPlaceholderText('Scan tag or type filter name');
  fireEvent.change(input, { target: { value: 'F-001' } });
  fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
  await screen.findByRole('button', { name: /Submit Selected \(1\)/ });
  fireEvent.click(screen.getByRole('button', { name: /Submit Selected \(1\)/ }));
}

const cancelPrompt = async () => {
  const pw = await screen.findByPlaceholderText('Enter your password');
  fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

describe('Filter Operations — starting cycles under re-auth (START_CLEANING_CYCLE)', () => {
  async function toReasonSubmit(api: ReturnType<typeof setup>) {
    await openWashOut(api);
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start & Submit' }));
    await settle();
  }

  it('a dismissed prompt is silent: no error, the reason dialog stays with its choice, nothing is sent; the retry is signed', async () => {
    const api = setup({
      reauthActions: ['START_CLEANING_CYCLE'],
      state: NEW_FILTER_STATE,
      routes: [
        { method: 'POST', path: '/api/filters/f1/start-cycle', body: { id: 'c9' } },
        { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_OUT', actions: [] } },
      ],
    });
    await toReasonSubmit(api);
    await cancelPrompt();
    await settle();
    expect(screen.queryAllByText(/Cancelled/)).toEqual([]);
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(api.calls('POST', '/api/filters/f1/start-cycle')).toEqual([]);
    // the reason dialog is still there, its reason still chosen, ready for a retry
    expect(screen.getByRole('button', { name: 'Start & Submit' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Start & Submit' }));
    await passReauth();
    await waitFor(() => expect(api.calls('POST', '/api/filters/f1/start-cycle')).toHaveLength(1));
    expectSigned(api.calls('POST', '/api/filters/f1/start-cycle')[0]);
    expect(api.calls('POST', '/api/filters/f1/start-cycle')[0].json).toMatchObject({ cleaningReasonKey: 'PM' });
  });

  it('a refused start is shown, naming the filter (unchanged)', async () => {
    const api = setup({
      state: NEW_FILTER_STATE,
      routes: [{ method: 'POST', path: '/api/filters/f1/start-cycle', status: 409, body: { error: 'CYCLE_ACTIVE', message: 'Filter already has an active cycle' } }],
    });
    await toReasonSubmit(api);
    expect(await screen.findByText(/F-001: Filter already has an active cycle/)).toBeInTheDocument();
  });
});

describe('Filter Operations — a checklist submitted under re-auth (SUBMIT_CHECKLIST_WITH_SIGNATURE)', () => {
  async function toChecklistSubmit(api: ReturnType<typeof setup>) {
    await openWashOut(api);
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    // The handler's post-execute state reset lands a microtask later: let it land inside act().
    await settle();
  }
  const submitted = (api: ReturnType<typeof setup>) => api.calls('POST', '/api/filters/f1/submit-checklist');

  it('a wrong password keeps the prompt open with "Incorrect password" and fails no filter; the signed retry submits', async () => {
    const api = setup({
      reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      state: AWAITING_CHECKLIST,
      routes: [
        { method: 'POST', path: '/api/filters/f1/submit-checklist', status: 401, times: 1, body: REAUTH_FAILED },
        { method: 'POST', path: '/api/filters/f1/submit-checklist', body: { currentState: 'WASH_IN', actions: [] } },
      ],
    });
    await toChecklistSubmit(api);
    await passReauth('Wrong@1');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).toBeNull();

    await passReauth();
    expect(await screen.findByText('Checklist submitted for 1 filter(s)')).toBeInTheDocument();
    expect(submitted(api)).toHaveLength(2);
    expectSigned(submitted(api)[1]);
    expect(submitted(api)[1].json).toMatchObject({ answers: { q1: 'Yes' } });
  });

  it('a stale gate (the server answers REAUTH_REQUIRED) opens the prompt instead of failing the filter', async () => {
    const api = setup({
      state: AWAITING_CHECKLIST,
      routes: [
        { method: 'POST', path: '/api/filters/f1/submit-checklist', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
        { method: 'POST', path: '/api/filters/f1/submit-checklist', body: { currentState: 'WASH_IN', actions: [] } },
      ],
    });
    await toChecklistSubmit(api);
    await passReauth();
    expect(await screen.findByText('Checklist submitted for 1 filter(s)')).toBeInTheDocument();
    expect(screen.queryByText(/failed/)).toBeNull();
    expect(submitted(api)).toHaveLength(2);
    expectSigned(submitted(api)[1]);
  });

  it('a refusal is shown naming the filter, and the prompt is not left open (unchanged)', async () => {
    const api = setup({
      state: AWAITING_CHECKLIST,
      routes: [{ method: 'POST', path: '/api/filters/f1/submit-checklist', status: 409, body: { error: 'SCHEMA_DRIFT', message: 'The checklist changed since it was opened' } }],
    });
    await toChecklistSubmit(api);
    expect(await screen.findByText(/F-001: The checklist changed since it was opened/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
  });

  it('answers survive a page re-render (an RFID burst into the scan box behind the dialog)', async () => {
    // The page used to hand the dialogs a NEW object on every render, and they
    // reset on a new object: any re-render — a reader burst, a toast, a refresh —
    // wiped a half-filled compliance checklist (and typed readings, and a chosen
    // cleaning reason).
    const api = setup({ state: AWAITING_CHECKLIST });
    await openWashOut(api);
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByPlaceholderText('Scan tag or type filter name'), { target: { value: 'E200' } });
    await settle();
    expect(screen.getByRole('button', { name: 'Yes' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a dismissed prompt is silent: nothing sent, the checklist stays open for a retry', async () => {
    const api = setup({
      reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      state: AWAITING_CHECKLIST,
      routes: [{ method: 'POST', path: '/api/filters/f1/submit-checklist', body: { currentState: 'WASH_IN', actions: [] } }],
    });
    await toChecklistSubmit(api);
    await cancelPrompt();
    await settle();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(submitted(api)).toEqual([]);
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Checklist/ })).toBeEnabled();
  });
});

/**
 * The checklist dialog for ONE filter (no batch snapshot) opens after an advance
 * that went to the offline queue: the page recomputes the tape from the cached
 * pipeline and asks the post-stage checklist on the spot. Its submit goes through
 * core.submitChecklist — online again here, so the server answers it.
 */
describe('Filter Operations — a single-filter checklist under re-auth (opened after a queued advance)', () => {
  const graph = {
    stages: [
      { id: 'n-start', nodeType: 'START' },
      { id: 'n-WASH_IN', nodeType: 'STAGE', stateKey: 'WASH_IN' },
      { id: 'n-WASH_OUT', nodeType: 'STAGE', stateKey: 'WASH_OUT' },
      { id: 'n-cl', nodeType: 'CHECKLIST', configuration: { checklistProfileId: 'cl1' } },
      { id: 'n-DRY_IN', nodeType: 'STAGE', stateKey: 'DRY_IN' },
      { id: 'n-end', nodeType: 'END' },
    ],
    connections: [
      { fromStageId: 'n-start', toStageId: 'n-WASH_IN' },
      { fromStageId: 'n-WASH_IN', toStageId: 'n-WASH_OUT' },
      { fromStageId: 'n-WASH_OUT', toStageId: 'n-cl' },
      { fromStageId: 'n-cl', toStageId: 'n-DRY_IN' },
      { fromStageId: 'n-DRY_IN', toStageId: 'n-end' },
    ],
  };
  const AT_WASH_IN = {
    currentState: 'WASH_IN', currentCycle: { id: 'c1', status: 'IN_PROGRESS' }, tapeVersion: 7, blockChangeStatus: 'MATCH',
    actions: [{ type: 'ADVANCE_TO_STAGE', label: 'Advance to WASH_OUT', params: { targetState: 'WASH_OUT' } }],
    pipelineGraph: graph,
  };
  const PROFILE = { id: 'cl1', name: 'Post-wash check', version: 3, isActive: true, questions: [Q_YES] };

  async function toSingleChecklistSubmit(api: ReturnType<typeof setup>) {
    const idb = installFakeIndexedDB();
    await openAppDb();
    idb.seed('cache', [cacheRow('filter-state-f1', AT_WASH_IN), cacheRow('checklist-profiles', [PROFILE])]);
    renderPage(<FilterOperationsPage />, { route: '/filters/stage/WASH_OUT', path: '/filters/stage/:stageKey', user: OPERATOR, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await waitFor(() => expect(api.calls('GET', '/api/config/ahu-completion-process/current').length).toBeGreaterThan(0));
    await waitFor(() => expect(api.calls('GET', '/api/hierarchy/filters').length).toBeGreaterThan(0));
    fireEvent.change(await screen.findByPlaceholderText('Scan tag or type filter name'), { target: { value: 'F-001' } });
    fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
    const submit = await screen.findByRole('button', { name: /Submit Selected \(1\)/ });
    // The network drops: the state read falls back to the cache, the advance is queued.
    const serverFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    fireEvent.click(submit);
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('F-001', { exact: false })).toBeInTheDocument();
    vi.stubGlobal('fetch', serverFetch); // back online for the submit
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await settle();
  }
  const submitted = (api: ReturnType<typeof setup>) => api.calls('POST', '/api/filters/f1/submit-checklist');

  it('a wrong password re-prompts (was: shown as a failure, prompt closed); a refusal is then shown in the dialog and as a popup', async () => {
    allowConsoleError(/\[SWR Error\]|Failed to fetch/);
    const api = setup({
      reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      state: AT_WASH_IN,
      routes: [
        { method: 'POST', path: '/api/filters/f1/submit-checklist', status: 401, times: 1, body: REAUTH_FAILED },
        { method: 'POST', path: '/api/filters/f1/submit-checklist', status: 409, body: { error: 'SCHEMA_DRIFT', message: 'The checklist changed since it was opened' } },
      ],
    });
    await toSingleChecklistSubmit(api);
    await passReauth('Wrong@1');
    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid password/)).toBeNull();

    await passReauth();
    await waitFor(() => expect(submitted(api)).toHaveLength(2));
    expectSigned(submitted(api)[1]);
    await waitFor(() => expect(screen.getAllByText('The checklist changed since it was opened').length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Checklist/ })).toBeEnabled();
  });

  it('a dismissed prompt is silent and the checklist stays open', async () => {
    allowConsoleError(/\[SWR Error\]|Failed to fetch/);
    const api = setup({ reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'], state: AT_WASH_IN });
    await toSingleChecklistSubmit(api);
    await cancelPrompt();
    await settle();
    expect(screen.queryByText(/Cancelled/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(submitted(api)).toEqual([]);
    expect(screen.getByRole('button', { name: /Submit Checklist/ })).toBeEnabled();
  });
});
