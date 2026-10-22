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
import { screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { renderPage } from '@/test-utils/page-harness';
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
import {
  OPERATOR, F1, Q_YES, NEW_FILTER_STATE, AWAITING_CHECKLIST, REAUTH_FAILED, setup, openWashOut, cancelPrompt, settle, pickReasonAndStart, answerYes,
} from './filter-operations-kit';

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


describe('Filter Operations — starting cycles under re-auth (START_CLEANING_CYCLE)', () => {
  async function toReasonSubmit(api: ReturnType<typeof setup>) {
    await openWashOut(api);
    await pickReasonAndStart();
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
    await answerYes();
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
    await answerYes(); // after the dialog's own open-time reset
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
 * A lockout (403 ACCOUNT_LOCKED) refuses the SIGNATURE, not one filter. Counted as
 * a per-filter failure, the batch re-sent the same wrong password for every
 * remaining filter — one more failed signature (audit row) each — and listed
 * every filter as failed (2026-10-22).
 */
describe('Filter Operations — a lockout stops a signed batch', () => {
  const LOCKED = { error: 'ACCOUNT_LOCKED', message: 'Account locked due to multiple failed attempts. Contact administrator.' };
  const F2 = { ...F1, id: 'f2', name: 'F-002' };
  async function queueTwo(api: ReturnType<typeof setup>) {
    renderPage(<FilterOperationsPage />, { route: '/filters/stage/WASH_OUT', path: '/filters/stage/:stageKey', user: OPERATOR, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await waitFor(() => expect(api.calls('GET', '/api/hierarchy/filters').length).toBeGreaterThan(0));
    for (const name of ['F-001', 'F-002']) {
      fireEvent.change(await screen.findByPlaceholderText('Scan tag or type filter name'), { target: { value: name } });
      fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
      await screen.findByText(name);
    }
    fireEvent.click(await screen.findByRole('button', { name: /Submit Selected \(2\)/ }));
  }
  const both = (o: Parameters<typeof setup>[0]) => {
    const api = setup(o);
    api.routes.unshift({ path: '/api/hierarchy/filters', body: { data: [F1, F2] } });
    return api;
  };

  it('starting cycles: one start-cycle sent, the lockout shown, the reason dialog kept', async () => {
    const api = both({
      reauthActions: ['START_CLEANING_CYCLE'],
      state: NEW_FILTER_STATE,
      routes: [{ method: 'POST', path: /\/api\/filters\/f\d\/start-cycle/, status: 403, body: LOCKED }],
    });
    await queueTwo(api);
    await pickReasonAndStart();
    await passReauth('Wrong@1');
    expect((await screen.findAllByText(LOCKED.message)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/cycle\(s\) started/)).toBeNull();
    expect(api.requests.filter((r) => r.method === 'POST' && /start-cycle$/.test(r.path)).map((r) => r.path)).toEqual(['/api/filters/f1/start-cycle']);
    expect(screen.getByRole('button', { name: 'Start & Submit' })).toBeInTheDocument();
  });

  it('a checklist for a batch: one submit sent, the lockout shown once', async () => {
    const api = both({
      reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      state: AWAITING_CHECKLIST,
      routes: [{ method: 'POST', path: /\/api\/filters\/f\d\/submit-checklist/, status: 403, body: LOCKED }],
    });
    await queueTwo(api);
    await answerYes();
    fireEvent.click(screen.getByRole('button', { name: /Submit Checklist/ }));
    await settle();
    await passReauth('Wrong@1');
    expect((await screen.findAllByText(LOCKED.message)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/succeeded, .* failed/)).toBeNull();
    expect(api.requests.filter((r) => r.method === 'POST' && /submit-checklist$/.test(r.path)).map((r) => r.path)).toEqual(['/api/filters/f1/submit-checklist']);
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
    await answerYes();
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
