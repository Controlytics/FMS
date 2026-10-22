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
export async function scanAndSubmit(api: ReturnType<typeof setup>, stageKey = 'WASH_OUT', blockName?: string, names: string[] = ['F-001']) {
  renderPage(<FilterOperationsPage />, { route: `/filters/stage/${stageKey}`, path: '/filters/stage/:stageKey', user: OPERATOR, api });
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
  await waitFor(() => expect(api.calls('GET', '/api/hierarchy/filters').length).toBeGreaterThan(0));
  if (blockName) fireEvent.click(await screen.findByRole('button', { name: new RegExp(blockName) }));
  for (const name of names) {
    fireEvent.change(await screen.findByPlaceholderText('Scan tag or type filter name'), { target: { value: name } });
    fireEvent.click(screen.getByRole('button', { name: /Add to Queue/ }));
    await screen.findAllByText(name);
  }
  const submit = new RegExp(`Submit Selected \\(${names.length}\\)`);
  fireEvent.click(await screen.findByRole('button', { name: submit }));
}
export const openWashOut = (api: ReturnType<typeof setup>) => scanAndSubmit(api, 'WASH_OUT');

/**
 * Pick the cleaning reason and start. The reason dialog clears its choice in an
 * effect when it opens, one render after its buttons appear (the reasons are
 * already in SWR from the page) — under a loaded run a click landed before that
 * effect and was wiped, so Start stayed disabled and nothing happened. Re-pick
 * until Start is live (picking is idempotent), then start.
 */
export async function pickReasonAndStart(reason = /Preventive Maintenance/) {
  await waitFor(() => {
    fireEvent.click(screen.getByRole('button', { name: reason }));
    expect(screen.getByRole('button', { name: 'Start & Submit' })).toBeEnabled();
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start & Submit' }));
  await settle();
}

export const cancelPrompt = async () => {
  const pw = await screen.findByPlaceholderText('Enter your password');
  fireEvent.click(within(pw.closest('.max-w-lg') as HTMLElement).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
};
export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
