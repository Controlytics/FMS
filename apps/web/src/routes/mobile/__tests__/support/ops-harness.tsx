/**
 * Render helper + fixtures for the MobileOperationsPage suites (coverage
 * campaign, 2026-10-21). NOT a test file. Suites declare their own vi.mocks.
 *
 * The page is rendered the way the shell renders it: on one station
 * (`initialStageKey`, optionally `initialBlockId`).
 *
 * Driving it:
 *  - scans go through the native RFID bridge callback (`scanTag`), exactly as
 *    the Reader_Usb plugin delivers them;
 *  - a filter's action TAPE is controlled through its `filter-state-<id>` cache
 *    row (`state()`), which `getCurrentActions` returns verbatim when non-empty —
 *    that is the same server tape the page caches from /current-state;
 *  - the server answers through the page harness (`mockApi`), so every write's
 *    method, URL and body is asserted from `api.calls(...)`.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { mockApi, renderPage, type MockRequest, type MockRoute, type TestUser } from '@/test-utils/page-harness';
import { MobileOperationsPage } from '../../mobile-operations';
import { mobileRoutes, LocationProbe, OPERATOR, cacheUser, seedCache, seedFilters, type MobileRouteOpts } from './mobile-kit';
import { rfid, setOnline } from './fakes';

export const BLOCK_N = { id: 'b1', name: 'North', templateId: 'tpl-block', parentId: null };
export const BLOCK_S = { id: 'b2', name: 'South', templateId: 'tpl-block', parentId: null };
export const AHU1 = { id: 'h1', name: 'AHU-01', templateId: 'tpl-ahu', parentId: 'b1' };
export const AHU2 = { id: 'h2', name: 'AHU-02', templateId: 'tpl-ahu', parentId: 'b2' };
export const mkFilter = (id: string, name: string, over: any = {}) => ({ id, name, templateId: 'tpl-filter', parentId: 'h1', currentLifecycleState: null, attributes: {}, ...over });
export const F1 = mkFilter('f1', 'F-001', { currentLifecycleState: 'WASH_IN', currentCycleId: 'cyc1' });
export const F2 = mkFilter('f2', 'F-002', { currentLifecycleState: 'WASH_IN', currentCycleId: 'cyc2' });
export const F3 = mkFilter('f3', 'F-003');
export const F4 = mkFilter('f4', 'F-004', { currentLifecycleState: 'DRY_IN', currentCycleId: 'cyc4', parentId: 'h2' });
export const F5 = mkFilter('f5', 'F-005', { approvalStatus: 'PENDING_REVIEW' });
export const F6 = mkFilter('f6', 'F-006', { approvalStatus: 'REJECTED' });
export const OPS_INSTANCES = [BLOCK_N, BLOCK_S, AHU1, AHU2, F1, F2, F3, F4, F5, F6];
export const OPS_TEMPLATES = [
  { id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }, { id: 'tpl-ahu', templateKind: 'AHU' },
];
/** tag → filter, as /api/assets/identifiers/lookup answers. */
export const TAGS: Record<string, any> = {
  E1: { id: 'f1', name: 'F-001' },
  E2: { id: 'f2', name: 'F-002' },
  E3: { id: 'f3', name: 'F-003' },
  E4: { id: 'f4', name: 'F-004' },
  E5: { id: 'f5', name: 'F-005', approvalStatus: 'PENDING_REVIEW' },
  E6: { id: 'f6', name: 'F-006', approvalStatus: 'REJECTED' },
};

// ── action tapes (the server's /current-state `actions[]`) ───────────────
export const adv = (targetState: string) => ({ type: 'ADVANCE_TO_STAGE', label: `Advance to ${targetState}`, params: { targetState } });
export const setDryer = () => ({ type: 'SET_DRYER_DURATION', label: 'Set dryer duration', params: { targetState: 'DRY_IN', minMinutes: 5, maxMinutes: 240 } });
export const terminate = () => ({ type: 'TERMINATE_CYCLE', label: 'Terminate', requiresJustification: { minLength: 10 } });
export const Q_YES = { id: 'q1', question: 'Filter intact?', questionType: 'YES_NO', required: true };
export const submitChecklist = (afterStage: string, questions: any[] = [Q_YES], id = 'cl1', version = 3) => ({
  type: 'SUBMIT_CHECKLIST', label: 'Submit Checklist: Post-stage check', blocking: true,
  params: { checklistProfileId: id, versionPin: version, afterStage, questions },
});

/** A filter-state cache row for a filter with a cycle IN PROGRESS. */
export function state(currentState: string | null, actions: any[], over: any = {}) {
  return {
    currentState,
    currentCycle: currentState ? { id: `cyc-${currentState}`, status: 'IN_PROGRESS', ...(over.cycle ?? {}) } : null,
    actions,
    tapeVersion: 7,
    homeBlock: { id: 'b1', name: 'North' },
    blockChangeStatus: 'MATCH',
    ...over,
  };
}

/** Linear START → stages… → END graph (optionally with a checklist after a stage). */
export function graph(stageKeys: string[], checklistAfter?: { stage: string; profileId: string }) {
  const stages: any[] = [{ id: 'n-start', nodeType: 'START' }];
  const connections: any[] = [];
  let prev = 'n-start';
  for (const k of stageKeys) {
    const id = `n-${k}`;
    stages.push({ id, nodeType: 'STAGE', stateKey: k });
    connections.push({ fromStageId: prev, toStageId: id });
    prev = id;
    if (checklistAfter?.stage === k) {
      const cid = `n-cl-${k}`;
      stages.push({ id: cid, nodeType: 'CHECKLIST', configuration: { checklistProfileId: checklistAfter.profileId } });
      connections.push({ fromStageId: prev, toStageId: cid });
      prev = cid;
    }
  }
  stages.push({ id: 'n-end', nodeType: 'END' });
  connections.push({ fromStageId: prev, toStageId: 'n-end' });
  return { stages, connections };
}

export const CHECKLIST_PROFILE = { id: 'cl1', name: 'Post-stage check', version: 3, isActive: true, questions: [Q_YES] };

export interface OpsOpts extends MobileRouteOpts {
  user?: TestUser;
  routes?: MockRoute[];
  online?: boolean;
  /** Props for the page. Defaults to the shell's: { initialStageKey }. */
  props?: Record<string, any>;
  stage?: string;
  /** filter-state-<id> rows to seed BEFORE render. */
  states?: Record<string, any>;
  /** extra cache rows to seed before render */
  cache?: Record<string, unknown>;
  /** rows of the legacy `filters` store (what the batch submit reads) */
  cachedFilters?: any[];
  reasons?: any[];
  checklistProfiles?: any[];
  equipmentGroups?: any[];
  blockedFilterIds?: string[];
  /** Mount on SWR's default cache so the page's global mutate(key) refreshes are observable. */
  globalCache?: boolean;
}

export function lookupRoute(): MockRoute {
  return {
    path: /^\/api\/assets\/identifiers\/lookup\//,
    status: 200,
    body: (r: MockRequest) => {
      const tag = decodeURIComponent(r.path.split('/').pop() ?? '');
      const asset = TAGS[tag];
      return asset ? { asset } : { asset: null };
    },
  };
}

export async function renderOps(o: OpsOpts = {}) {
  if (o.online === false) setOnline(false);
  const user = o.user ?? OPERATOR;
  cacheUser(user);
  const states = o.states ?? {};
  await seedCache({
    ...Object.fromEntries(Object.entries(states).map(([id, s]) => [`filter-state-${id}`, s])),
    ...(o.cache ?? {}),
  });
  if (o.cachedFilters) await seedFilters(o.cachedFilters);
  const api = mockApi([
    ...(o.routes ?? []),
    lookupRoute(),
    { path: '/api/filters/reasons', body: { reasons: o.reasons ?? REASONS } },
    { path: '/api/checklist-profiles', body: { data: o.checklistProfiles ?? [CHECKLIST_PROFILE] } },
    { path: '/api/equipment-groups', body: o.equipmentGroups ?? [] },
    { path: '/api/replacement-schedules/blocked-filters', body: { filterIds: o.blockedFilterIds ?? [] } },
    ...mobileRoutes({ instances: OPS_INSTANCES, templates: OPS_TEMPLATES, ...o }),
  ]);
  const props = o.props ?? { initialStageKey: o.stage ?? 'WASH_OUT' };
  const view = renderPage(<><MobileOperationsPage {...props} /><LocationProbe /></>, { route: '/m', user, api, globalCache: o.globalCache });
  // Let the master data land first (the queue row names the filter's AHU from it).
  if (o.online !== false) await waitFor(() => expect(api.calls('GET', '/api/assets/instances').length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return view; // renderPage already carries `api`
}

export const REASONS = [
  { key: 'PM', name: 'Preventive Maintenance', isActive: true },
  { key: 'BREAKDOWN', name: 'Breakdown', isActive: true, requiresJustification: true },
  { key: 'OLD', name: 'Retired reason', isActive: false },
];

/** Deliver a tag exactly as the native RFID plugin does. */
export async function scanTag(epc: string) {
  await waitFor(() => expect(rfid.onTag).toBeTypeOf('function'));
  await act(async () => { rfid.onTag!({ epc }); });
}
/** Wait until a filter shows in the scan queue. */
export async function inQueue(name: string) {
  return screen.findByText((_, el) => el?.tagName === 'SPAN' && !!el.textContent?.startsWith(name) && el.className.includes('text-sm'));
}
export const submitButton = () => screen.getByRole('button', { name: /Submit/ });
/** The acknowledgement modal used for every success / error on this page. */
export async function message(text: string | RegExp) {
  return screen.findByText(text, { selector: 'p' });
}
export async function dismissAll() {
  for (let i = 0; i < 10; i++) {
    const ok = screen.queryAllByRole('button', { name: 'OK' });
    if (ok.length === 0) break;
    fireEvent.click(ok[0]);
    await act(async () => {});
  }
  // The page clears its success/error state 100 ms after showing it; let that
  // land so the NEXT message is not batched together with the clear (an
  // operator acknowledging the dialog always takes longer than that).
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
}
export const bulkItems = (api: { calls: (m: string, p: string) => MockRequest[] }, i = 0) => api.calls('POST', '/api/filters/bulk-operate')[i]?.json?.items ?? [];
/** A /bulk-operate answer: every item ok (snapshot carries `actions` if given). */
export function bulkOk(actionsById: Record<string, any[]> = {}, snapshot: (filterId: string) => any = () => ({})) {
  return (r: MockRequest) => ({
    results: (r.json.items as any[]).map((it) => ({ clientOpId: it.clientOpId, filterId: it.filterId, status: 'ok', snapshot: { currentState: 'X', actions: actionsById[it.filterId] ?? [], tapeVersion: 8, ...snapshot(it.filterId) } })),
  });
}
