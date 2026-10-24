/**
 * Shared harness for the Filter Operations (web) page suites. NOT a test file.
 *
 * Each suite declares its own boundary fakes with vi.mock (vi.mock is hoisted
 * per test file, so it cannot live here): Capacitor connectivity, the sync
 * engine and the drying panel, plus an in-memory IndexedDB in beforeEach. This
 * kit holds the routes, fixtures and navigation the suites share.
 */
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { expect } from 'vitest';
import { mockApi, renderPage, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { FilterOperationsPage } from '../filter-operations';

export const OPERATOR: TestUser = { id: 'u-op', username: 'op1', fullName: 'Ravi Kumar', role: 'OPERATOR', permissions: ['FILTER_OPERATE', 'ASSET_READ'] };
export const F1 = { id: 'f1', name: 'F-001', ahuId: 'h1', approvalStatus: 'APPROVED', currentLifecycleState: null, isActive: true };
export const Q_YES = { id: 'q1', question: 'Filter intact?', questionType: 'YES_NO', required: true };
export const SUBMIT_CL = {
  type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Post-wash check', blocking: true,
  params: { checklistProfileId: 'cl1', checklistProfileName: 'Post-wash check', versionPin: 3, afterStage: 'WASH_IN', questions: [Q_YES] },
};
export const NEW_FILTER_STATE = { currentState: null, currentCycle: null, actions: [], tapeVersion: 0, blockChangeStatus: 'MATCH' };
export const AWAITING_CHECKLIST = {
  currentState: 'WASH_IN', currentCycle: { id: 'c1', status: 'IN_PROGRESS' }, actions: [SUBMIT_CL], tapeVersion: 7, blockChangeStatus: 'MATCH',
  // As the server sends it: the station rule reads the next stages here (Wash Out
  // may answer the Wash In checklist), and refuses when it cannot tell.
  stageLookup: { WASH_IN: { nextStages: ['WASH_OUT'], leadsToEnd: false, pendingChecklistProfileIds: ['cl1'], interlockGated: false } },
};
export const REAUTH_FAILED: MockRoute['body'] = { error: 'REAUTH_FAILED', message: 'Invalid password' };

export function setup(o: { reauthActions?: string[]; state: unknown; routes?: MockRoute[] }) {
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
    // Role display names (useRoleColors) for the interlock banner; public on the server.
    { path: '/api/roles/active', body: [] },
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

/**
 * Open a stage screen, pick the block when the stage needs one, queue F-001 and
 * submit the queue.
 */
export async function scanAndSubmit(
  api: ReturnType<typeof setup>, stageKey = 'WASH_OUT', blockName?: string, names: string[] = ['F-001'],
  opts: { remarks?: string } = {},
) {
  renderPage(<FilterOperationsPage />, { route: `/filters/stage/${stageKey}`, path: '/filters/stage/:stageKey', user: OPERATOR, api });
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await waitFor(() => expect(api.calls('GET', '/api/hierarchy/filters').length).toBeGreaterThan(0));
  // The AHU completion mode decides the pre-flight at Submit; a test that sets one must not race it.
  await waitFor(() => expect(api.calls('GET', '/api/config/ahu-completion-process/current').length).toBeGreaterThan(0));
  if (blockName) fireEvent.click(await screen.findByRole('button', { name: new RegExp(blockName) }));
  for (const name of names) {
    fireEvent.change(await screen.findByPlaceholderText('Scan tag or type filter name'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
    await screen.findAllByText(name);
  }
  if (opts.remarks !== undefined) fireEvent.change(screen.getByPlaceholderText('Remarks (optional)'), { target: { value: opts.remarks } });
  const submit = new RegExp(`Submit Selected \\(${names.length}\\)`);
  fireEvent.click(await screen.findByRole('button', { name: submit }));
}
export const openWashOut = (api: ReturnType<typeof setup>) => scanAndSubmit(api, 'WASH_OUT');

/*
 * The reason and checklist dialogs clear their inputs in an effect when they
 * open — one render AFTER their buttons appear. A test acts at sub-frame speed:
 * under a loaded run a click landed before that effect and was wiped, so Start /
 * Submit then did nothing (seen 2026-10-22: the START prompt never opened; the
 * stale-gate test's answers were empty). Let the open settle first, then act,
 * and re-apply until the input is visibly held. (A person cannot click inside
 * one frame; this is the harness catching up, not a page defect.)
 */

/** Pick the cleaning reason and start. */
export async function pickReasonAndStart(reason = /Preventive Maintenance/) {
  await settle();
  await waitFor(() => {
    const start = screen.getByRole('button', { name: 'Start & Submit' });
    if ((start as HTMLButtonElement).disabled) fireEvent.click(screen.getByRole('button', { name: reason }));
    expect(start).toBeEnabled();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start & Submit' }));
  await settle();
}

/** Answer the (single YES/NO) checklist question "Yes". */
export async function answerYes() {
  await screen.findByText('Checklist Required');
  await settle();
  await waitFor(() => {
    const yes = screen.getByRole('button', { name: 'Yes' });
    if (yes.getAttribute('aria-pressed') !== 'true') fireEvent.click(yes);
    expect(yes).toHaveAttribute('aria-pressed', 'true');
  });
}

/**
 * Answer the missed-PM question and save. The dialog clears its reasons in an
 * effect when it opens (pm-pending-tasks-dialog.tsx), so a reason typed in the
 * same frame was wiped and Save stayed disabled; re-type until Save is enabled.
 */
export async function answerPmQuestion(text = 'Plant shutdown in Sept') {
  const placeholder = 'Why was this scheduled cleaning not done?';
  await screen.findByPlaceholderText(placeholder);
  await settle();
  const save = screen.getByRole('button', { name: 'Save reasons & start cleaning' });
  await waitFor(() => {
    const t = screen.getByPlaceholderText(placeholder) as HTMLTextAreaElement;
    if (t.value !== text) fireEvent.change(t, { target: { value: text } });
    expect(save).toBeEnabled();
  });
  fireEvent.click(save);
}

export const cancelPrompt = async () => {
  const pw = await screen.findByPlaceholderText('Enter your password');
  fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
};
export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
