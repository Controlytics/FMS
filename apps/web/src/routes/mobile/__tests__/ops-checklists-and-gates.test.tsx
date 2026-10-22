/**
 * Tablet operations page — mandatory checklists (pre-advance, dialog-first,
 * post-advance; batch and single; online and offline), the checklist question
 * types, the block-change APPROVAL request and the AHU-completion pre-flights.
 * Same boundaries as ops-scan-queue.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import type { MockRequest, MockRoute } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, queuedOps, passReauth, cancelReauth, allowConsoleError, cachedValue } from './support/mobile-kit';
import {
  renderOps, scanTag, inQueue, state, adv, graph, bulkOk, bulkItems, submitButton, message, dismissAll, submitChecklist,
  OPS_INSTANCES, F1, F2, CHECKLIST_PROFILE, Q_YES,
} from './support/ops-harness';
import { setOnline } from './support/fakes';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

const offlineFetch = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
const submitCl = () => fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
const closeCl = () => fireEvent.click(screen.getByRole('button', { name: 'Close' }));
const yes = () => fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
const queueCount = () => screen.queryByText(/Queue \(\d+\)/)?.textContent?.match(/Queue \((\d+)\)/)?.[1];
const deferredState = (over: any = {}) => state('WASH_IN', [adv('WASH_OUT')], { stageLookup: { WASH_OUT: { pendingChecklistProfileIds: ['cl1'] } }, ...over });
const OFFLINE_ROWS = [F1, F2];
const offlineCache = (extra: Record<string, unknown> = {}) => ({
  'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E2: { filterId: 'f2', filterName: 'F-002' } },
  'checklist-profiles': [CHECKLIST_PROFILE],
  ...extra,
});

/** What the server sends for a Wash In → Wash Out pipeline: Wash Out is the stage after Wash In. */
const WASH_IN_THEN_OUT = { stageLookup: { WASH_IN: { nextStages: ['WASH_OUT'] } } };

describe('a pending checklist is answered only at its own station or the next one (2026-10-22)', () => {
  // A cycle parked at Storage Out with its final checklist pending, scanned at
  // the Wash In station, used to get that checklist — and submitting it completed
  // the old cycle. The rule: lib/filter-ops/checklist-station.ts.
  // As the cache holds it after a server read (cacheServerStateResponse also
  // derives `pendingChecklist` from the tape — the page's post-submit resolver
  // reads that, so the rule is checked there too).
  const AT_STORAGE_OUT = () => state('STORAGE_OUT', [submitChecklist('STORAGE_OUT')], {
    stageLookup: { STORAGE_OUT: { nextStages: [], pendingChecklistProfileIds: ['cl1'], leadsToEnd: true } },
    pipelineGraph: graph(['WASH_IN', 'WASH_OUT', 'STORAGE_OUT'], { stage: 'STORAGE_OUT', profileId: 'cl1' }),
    pendingChecklist: [{ pipelineNodeId: 'STORAGE_OUT-cl1', checklistProfileId: 'cl1', checklistProfileName: 'Post-stage check', profileVersion: 3, questions: [Q_YES] }],
  });
  // the filter list agrees with the cached state (the page reads the stage from both)
  const F1_AT = (stage: string) => ({ ...F1, currentLifecycleState: stage });
  const instancesAt = (stage: string): MockRoute => ({ path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (i.id === 'f1' ? F1_AT(stage) : i)) } });

  it('another station is refused before anything opens or is sent, naming where to go', async () => {
    const { api } = await renderOps({ stage: 'WASH_IN', states: { f1: AT_STORAGE_OUT() }, routes: [instancesAt('STORAGE_OUT')] });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001 has a pending Storage Out checklist — scan it at Storage Out')).toBeInTheDocument();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });

  it('offline too: refused, and nothing is queued', async () => {
    await renderOps({ stage: 'WASH_IN', online: false, cachedFilters: [{ id: 'b1', name: 'North', templateId: 'tpl-block' }, F1_AT('STORAGE_OUT')], cache: offlineCache({ templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }] }), states: { f1: AT_STORAGE_OUT() } });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001 has a pending Storage Out checklist — scan it at Storage Out')).toBeInTheDocument();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(queuedOps()).toHaveLength(0);
  });

  it('its own station opens it, and the dialog says which stage it belongs to', async () => {
    await renderOps({ stage: 'STORAGE_OUT', states: { f1: AT_STORAGE_OUT() }, routes: [instancesAt('STORAGE_OUT')] });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('Storage Out stage checklist')).toBeInTheDocument();
  });

  it('the next station opens it too (answer, then advance there); the dialog names the earlier stage', async () => {
    await renderOps({ stage: 'WASH_OUT', states: { f1: state('WASH_IN', [submitChecklist('WASH_IN')], { stageLookup: { WASH_IN: { nextStages: ['WASH_OUT'], pendingChecklistProfileIds: ['cl1'], leadsToEnd: false } } }) } });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('Wash In stage checklist')).toBeInTheDocument();
  });
});

describe('a checklist pending at the CURRENT stage (answered before the advance)', () => {
  it('opens ONE dialog for every same-checklist filter; after it, the queue is replayed and advanced', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [submitChecklist('WASH_IN')], WASH_IN_THEN_OUT), f2: state('WASH_IN', [submitChecklist('WASH_IN')], WASH_IN_THEN_OUT) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk({}, () => state('WASH_IN', [adv('WASH_OUT')])) }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Post-stage check')).toBeInTheDocument();
    yes();
    submitCl();
    expect(await message('Checklist submitted for 2 filter(s)')).toBeInTheDocument();
    // the replay: the kept queue is submitted again by itself (asserted on the
    // request, not its message — that message lands within the page's 100 ms
    // message-clear window here, where requests resolve without a round trip)
    await waitFor(() => expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(2));
    await waitFor(() => expect(screen.getByText('Submitted · 2')).toBeInTheDocument());
    const [sub, advance] = [bulkItems(api, 0), bulkItems(api, 1)];
    expect(sub.map((i: any) => [i.filterId, i.kind, i.payload.answers, i.payload.tapeVersion])).toEqual([['f1', 'submit-checklist', { q1: 'Yes' }, 7], ['f2', 'submit-checklist', { q1: 'Yes' }, 7]]);
    expect(advance.map((i: any) => [i.filterId, i.kind, i.payload.targetState])).toEqual([['f1', 'advance', 'WASH_OUT'], ['f2', 'advance', 'WASH_OUT']]);
  });

  it('a filter waiting on a DIFFERENT checklist, or none, is left out of the dialog', async () => {
    const other = submitChecklist('WASH_IN', [{ id: 'q9', question: 'Other?', questionType: 'YES_NO', required: true }], 'cl2', 1);
    await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [submitChecklist('WASH_IN')], WASH_IN_THEN_OUT), f2: state('WASH_IN', [other], WASH_IN_THEN_OUT), f4: state('WASH_IN', [adv('WASH_OUT')]) },
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    await scanTag('E4'); await inQueue('F-004');
    fireEvent.click(submitButton());
    expect(await screen.findByText('F-001', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Other?')).toBeNull();
  });

  it('Close keeps the cycle paused and sends nothing', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', states: { f1: state('WASH_IN', [submitChecklist('WASH_IN')], WASH_IN_THEN_OUT) } });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    expect(screen.getByText(/This checklist is mandatory under 21 CFR §11/)).toBeInTheDocument();
    closeCl();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    await flush(100);
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });
});

describe('dialog-first: the target stage has a mandatory checklist (2026-07-16)', () => {
  it('nothing is written until the checklist is answered; then ONE advance-with-checklist per filter, and the queue clears', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT', cache: { 'checklist-profiles': [CHECKLIST_PROFILE] },
      states: { f1: deferredState(), f2: deferredState() },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.change(screen.getByPlaceholderText('Remarks (optional)'), { target: { value: 'ok' } });
    fireEvent.click(submitButton());
    expect(await screen.findByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    yes();
    submitCl();
    expect(await message('Checklist submitted for 2 filter(s)')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => [i.filterId, i.kind, i.payload])).toEqual([
      ['f1', 'advance-with-checklist', { targetState: 'WASH_OUT', remarks: 'ok', answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 }, tapeVersion: 7 }],
      ['f2', 'advance-with-checklist', { targetState: 'WASH_OUT', remarks: 'ok', answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 }, tapeVersion: 7 }],
    ]);
    await dismissAll();
    expect(queueCount()).toBeUndefined();
  });

  it('Close discards the intent: nothing written, the scanned filters stay queued for a retry', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', cache: { 'checklist-profiles': [CHECKLIST_PROFILE] }, states: { f1: deferredState(), f2: deferredState() } });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    closeCl();
    await flush(100);
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    expect(queueCount()).toBe('2');
  });

  it('a mixed batch advances the checklist-free filter now and parks only the other', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT', cache: { 'checklist-profiles': [CHECKLIST_PROFILE] },
      states: { f1: deferredState(), f2: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Wash Out')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => [i.filterId, i.kind])).toEqual([['f2', 'advance']]);
    await dismissAll();
    expect(screen.getByText('F-001', { selector: 'p' })).toBeInTheDocument();
    closeCl();
    expect(queueCount()).toBe('1');
  });

  it('two different checklists: ONE dialog for the larger group; a gated stage whose checklist completes the cycle is entered on its own', async () => {
    const cl2 = { id: 'cl2', name: 'Other check', version: 1, isActive: true, questions: [{ id: 'q2', question: 'Bag sealed?', questionType: 'YES_NO', required: true }] };
    const { api } = await renderOps({
      stage: 'WASH_OUT', cache: { 'checklist-profiles': [CHECKLIST_PROFILE, cl2] }, checklistProfiles: [CHECKLIST_PROFILE, cl2],
      states: {
        f1: deferredState(),
        f2: state('WASH_IN', [adv('WASH_OUT')], { stageLookup: { WASH_OUT: { pendingChecklistProfileIds: ['cl2'] } } }),
        f4: state('WASH_IN', [adv('WASH_OUT')], { stageLookup: { WASH_OUT: { pendingChecklistProfileIds: ['cl1'], interlockGated: true, leadsToEnd: true, nextStages: [] } } }),
      },
      routes: [
        { path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (i.id === 'f4' ? { ...i, currentLifecycleState: 'WASH_IN', parentId: 'h1' } : i)) } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    await scanTag('E4'); await inQueue('F-004');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Wash Out')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => i.filterId)).toEqual(['f4']); // gated: no answers up front
    await dismissAll();
    expect(screen.getByText('F-001', { selector: 'p' })).toBeInTheDocument(); // cl1 group (first of equal size)
    closeCl();
    expect(queueCount()).toBe('2'); // F-001 and F-002 stay parked
  });

  it('offline: answered once, each filter is queued as ONE advance-with-checklist; the queue clears', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: OFFLINE_ROWS,
      cache: offlineCache(), states: { f1: deferredState(), f2: deferredState() },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await screen.findByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument();
    yes();
    submitCl();
    expect(await message('Checklist queued for 2 filter(s) — will sync when online')).toBeInTheDocument();
    expect(queuedOps().map((o) => [o.type, o.filterId, o.payload.targetState, o.payload.answers])).toEqual([
      ['advance-with-checklist', 'f1', 'WASH_OUT', { q1: 'Yes' }], ['advance-with-checklist', 'f2', 'WASH_OUT', { q1: 'Yes' }],
    ]);
    await dismissAll();
    expect(queueCount()).toBeUndefined();
  });

  it('offline with a server that still answers: a refused member is listed, the rest count', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: OFFLINE_ROWS, cache: offlineCache(),
      states: { f1: deferredState(), f2: deferredState() },
      routes: [
        { method: 'POST', path: '/api/filters/f1/advance-with-checklist', body: { tapeVersion: 9, actions: [] } },
        { method: 'POST', path: '/api/filters/f2/advance-with-checklist', status: 409, body: { error: 'STALE', message: 'Moved on' } },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    await screen.findByText('2 filter(s)', { selector: 'p' });
    yes();
    submitCl();
    expect(await message(/1 succeeded, 1 failed:\s+F-002: Moved on/)).toBeInTheDocument();
  });

  it('offline with every member refused: only the refusals', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: OFFLINE_ROWS, cache: offlineCache(),
      states: { f1: deferredState() },
      routes: [{ method: 'POST', path: '/api/filters/f1/advance-with-checklist', status: 409, body: { error: 'X', message: 'Refused' } }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    yes();
    submitCl();
    expect(await message('F-001: Refused')).toBeInTheDocument();
  });
});

describe('a checklist that opens AFTER the advance (server tape)', () => {
  it('the batch advance returns a checklist for both → ONE dialog → ONE bulk submit', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]), f2: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [
        { method: 'POST', path: '/api/filters/bulk-operate', times: 1, body: bulkOk({ f1: [submitChecklist('WASH_OUT')], f2: [submitChecklist('WASH_OUT')] }) },
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: [
          { clientOpId: r.json.items[0].clientOpId, filterId: 'f1', status: 'ok', snapshot: null },
          { clientOpId: r.json.items[1].clientOpId, filterId: 'f2', status: 'failed', error: { code: 'X', message: 'Answer rejected' } },
        ] }) },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await message('2 filter(s) → Wash Out')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('2 filter(s)', { selector: 'p' })).toBeInTheDocument();
    yes();
    submitCl();
    expect(await message(/1 succeeded, 1 failed:\s+F-002: Answer rejected/)).toBeInTheDocument();
    expect(bulkItems(api, 1).map((i: any) => i.kind)).toEqual(['submit-checklist', 'submit-checklist']);
  });

  it('every member refused, a transport failure, and a cancelled password', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT', reauthActions: ['SUBMIT_CHECKLIST_WITH_SIGNATURE'],
      states: { f1: state('WASH_IN', [submitChecklist('WASH_IN')], WASH_IN_THEN_OUT) },
      routes: [
        { method: 'POST', path: '/api/filters/bulk-operate', status: 502, times: 1, body: { error: 'X', message: 'x' } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: [{ clientOpId: r.json.items[0].clientOpId, filterId: 'f1', status: 'failed', error: { code: 'X' } }] }) },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    yes();
    submitCl();
    await cancelReauth();
    await flush();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
    submitCl();
    await passReauth();
    expect(await message('Could not reach the server to submit the checklist. Please try again.')).toBeInTheDocument();
    await dismissAll();
    submitCl();
    await passReauth();
    expect(await message('F-001: failed')).toBeInTheDocument();
  });
});

describe('the checklist dialog itself', () => {
  it('a NUMERIC question opened from the server tape keeps its range, unit and step', async () => {
    const numeric = [{ id: 'n1', question: 'Pressure drop', questionType: 'NUMERIC', required: true, validation: { min: 0, max: 250, unit: 'Pa', leastCount: 0.5 } }];
    await renderOps({ stage: 'WASH_OUT', states: { f1: state('WASH_IN', [submitChecklist('WASH_IN', numeric)], WASH_IN_THEN_OUT) } });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    expect(screen.getByText('Range: 0 – 250 Pa')).toBeInTheDocument();
    const input = screen.getByRole('spinbutton', { name: 'Pressure drop' });
    expect(input).toHaveAttribute('min', '0');
    expect(input).toHaveAttribute('max', '250');
    expect(input).toHaveAttribute('step', '0.5');
    await flush();
  });

  const ALL_TYPES = [
    { id: 'a', question: 'Gasket ok?', questionType: 'YES_NO', required: true, section: 'Visual', description: 'Look at all four sides' },
    { id: 'b', question: 'Pleats ok?', questionType: 'YES_NO_NA', section: 'Visual' },
    { id: 'c', question: 'Leak test', questionType: 'PASS_FAIL', section: 'Tests' },
    { id: 'd', question: 'Washer', questionType: 'DROPDOWN', options: ['W1', { value: 'w2', label: 'Washer 2' }] },
    { id: 'e', question: 'Defects', questionType: 'MULTI_SELECT', options: ['Dent', { value: 'tear', label: 'Tear' }] },
    { id: 'f', question: 'Pressure drop', questionType: 'NUMERIC', validation: { min: 0, max: 250, unit: 'Pa', leastCount: 0.5 } },
    { id: 'g', question: 'Count', questionType: 'NUMERIC', validation: { max: 9 } },
    { id: 'h', question: 'Photo', questionType: 'PHOTO' },
    { id: 'i', question: 'Sign here', questionType: 'SIGNATURE', required: true },
    { id: 'j', question: 'Weird options', questionType: 'DROPDOWN', options: 'nope' },
    { id: 'k', question: 'Weird multi', questionType: 'MULTI_SELECT' },
  ];

  it('renders every question type and sends what was entered', async () => {
    // Opened dialog-first from the cached checklist profile. (A checklist opened
    // from the server TAPE carries the same NUMERIC `validation` since 037520a:
    // lib/offline-cache.ts dialogChecklistsFromActions.)
    const profile = { ...CHECKLIST_PROFILE, questions: ALL_TYPES };
    const { api } = await renderOps({
      stage: 'WASH_OUT', cache: { 'checklist-profiles': [profile] }, checklistProfiles: [profile],
      states: { f1: deferredState() },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    expect(screen.getByText('Visual')).toBeInTheDocument();
    expect(screen.getByText('Tests')).toBeInTheDocument();
    expect(screen.getByText('Look at all four sides')).toBeInTheDocument();
    expect(screen.getByText('Range: 0 – 250 Pa')).toBeInTheDocument();
    expect(screen.getByText('Range: — – 9')).toBeInTheDocument();
    // required checks come first
    submitCl();
    expect(await message('Answer required: "Gasket ok?"')).toBeInTheDocument();
    await dismissAll();
    const q = (text: string) => screen.getByText(text).closest('div.space-y-2')! as HTMLElement;
    fireEvent.click(within(q('Gasket ok?')).getByRole('button', { name: 'No' }));
    expect(within(q('Gasket ok?')).getByRole('button', { name: /No/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(q('Pleats ok?')).getByRole('button', { name: 'N/A' }));
    fireEvent.click(within(q('Leak test')).getByRole('button', { name: 'Pass' }));
    fireEvent.click(within(q('Leak test')).getByRole('button', { name: 'Fail' }));
    fireEvent.change(q('Washer').querySelector('select')!, { target: { value: 'w2' } });
    expect([...q('Washer').querySelector('select')!.options].map((o) => o.textContent)).toEqual(['Select...', 'W1', 'Washer 2']);
    fireEvent.click(within(q('Defects')).getByRole('button', { name: 'Dent' }));
    fireEvent.click(within(q('Defects')).getByRole('button', { name: 'Tear' }));
    fireEvent.click(within(q('Defects')).getByRole('button', { name: /Dent/ })); // untick
    fireEvent.change(screen.getByPlaceholderText('Enter value (Pa)'), { target: { value: '120' } });
    fireEvent.change(q('Count').querySelector('input')!, { target: { value: '3' } });
    submitCl();
    expect(await message('Answer required: "Sign here"')).toBeInTheDocument();
    await dismissAll();
    fireEvent.change(q('Sign here').querySelector('textarea')!, { target: { value: 'R. Kumar' } });
    // photo: read as a data URL and previewed
    const file = new File([new Uint8Array([1, 2, 3])], 'p.png', { type: 'image/png' });
    fireEvent.change(q('Photo').querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(await screen.findByRole('img', { name: 'Captured' })).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/));
    fireEvent.change(q('Photo').querySelector('input[type="file"]')!, { target: { files: [] } }); // nothing picked: unchanged
    submitCl();
    expect(await message('Checklist submitted for 1 filter(s)')).toBeInTheDocument();
    const answers = bulkItems(api)[0].payload.answers;
    expect(answers).toMatchObject({ a: 'No', b: 'N/A', c: 'Fail', d: 'w2', e: ['tear'], f: '120', g: '3', i: 'R. Kumar' });
    expect(answers.h).toMatch(/^data:image\/png;base64,/);
  });

  it('a stale cached checklist with no questions shows the reload warning and refuses to submit', async () => {
    const stale = { pipelineNodeId: 'x', checklistProfileId: 'cl1', checklistProfileName: 'Post-stage check', profileVersion: 3 };
    await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [submitChecklist('WASH_IN', [])], { pendingChecklist: [stale], ...WASH_IN_THEN_OUT }) },
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText(/Couldn't load this checklist's questions/)).toBeInTheDocument();
    submitCl();
    expect(await message('This checklist could not load its questions. Reconnect and refresh, then reopen it before submitting.')).toBeInTheDocument();
  });
});

describe('single-filter checklist (opened by the start of a cycle)', () => {
  const NO_CYCLE = { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_OUT', 'STORAGE_IN']), homeBlock: { id: 'b1', name: 'North' } };
  const startThenChecklist = (submitRoute: MockRoute): MockRoute[] => [
    { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: {} },
    { path: '/api/filters/f3/current-state', body: { currentState: 'WASH_OUT', tapeVersion: 30, actions: [submitChecklist('WASH_OUT')] } },
    { method: 'POST', path: '/api/filters/f3/advance', body: { currentState: 'WASH_OUT', tapeVersion: 31, actions: [submitChecklist('WASH_OUT')] } },
    submitRoute,
  ];
  async function openSingle(o: any) {
    const view = await renderOps({ stage: 'WASH_OUT', states: { f3: NO_CYCLE }, ...o });
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByText('Checklist Required');
    expect(await message('F-003 → WASH OUT')).toBeInTheDocument();
    await dismissAll();
    return view;
  }

  it('posts submit-checklist with the profile versions and re-primes the filter state', async () => {
    const { api } = await openSingle({ routes: startThenChecklist({ method: 'POST', path: '/api/filters/f3/submit-checklist', body: { tapeVersion: 32, actions: [] } }) });
    expect(screen.getByText('F-003', { selector: 'p' })).toBeInTheDocument();
    yes();
    submitCl();
    expect(await message('Checklist submitted')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/f3/submit-checklist')[0].json).toMatchObject({ answers: { q1: 'Yes' }, expectedProfileVersions: { cl1: 3 }, tapeVersion: 30 });
    await waitFor(() => expect(api.calls('GET', '/api/filters/f3/current-state').length).toBeGreaterThan(1));
  });

  it('a refusal is shown and the dialog stays', async () => {
    await openSingle({ routes: startThenChecklist({ method: 'POST', path: '/api/filters/f3/submit-checklist', status: 409, body: { error: 'SCHEMA_DRIFT', message: 'Checklist changed' } }) });
    yes();
    submitCl();
    expect(await message('Checklist changed')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
  });

  it('INTERLOCK: the server holding the AHU shows which filters are still out; Close returns to the checklist', async () => {
    await openSingle({
      ahuMode: 'INTERLOCK',
      routes: startThenChecklist({ method: 'POST', path: '/api/filters/f3/submit-checklist', status: 422, body: { error: 'AHU_INTERLOCK_PENDING', message: 'held', details: { ahuName: 'AHU-01', currentFilterId: 'f3', pendingFilters: [{ id: 'f1', name: 'F-001', stage: 'WASH_IN' }] } } }),
    });
    yes();
    submitCl();
    expect(await screen.findByText('AHU interlock — cleaning completion blocked')).toBeInTheDocument();
    expect(screen.getByText(/AHU: AHU-01/)).toBeInTheDocument();
    expect(screen.getByText('F-001')).toBeInTheDocument();
    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]); // the interlock dialog's (rendered last)
    await flush();
    expect(screen.queryByText('AHU interlock — cleaning completion blocked')).toBeNull();
    expect(screen.getByText('Checklist Required')).toBeInTheDocument();
  });

  it('offline the submit is queued', async () => {
    await openSingle({ routes: startThenChecklist({ method: 'POST', path: '/api/filters/f3/submit-checklist', body: {} }) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument());
    await act(async () => { setOnline(false); });
    offlineFetch();
    yes();
    submitCl();
    expect(await message('Checklist submitted (queued)')).toBeInTheDocument();
    expect(queuedOps()[0]).toMatchObject({ type: 'submit-checklist', filterId: 'f3' });
  });
});

describe('block change — APPROVAL mode', () => {
  const crossBlock = { f1: state('WASH_IN', [adv('WASH_IN')], { homeBlock: { id: 'b1', name: 'North' } }) };
  const csRoute: MockRoute = { path: '/api/filters/f1/current-state', body: { blockChangeStatus: 'REQUIRED', homeBlock: { id: 'b1', name: 'North' } } };
  async function openApproval(o: any = {}) {
    const view = await renderOps({ stage: 'WASH_IN', blockChangeMode: 'APPROVAL', states: crossBlock, ...o, routes: [...(o.routes ?? []), csRoute] });
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Block change approval needed');
    return view;
  }

  it('asks for a reason and submits a request (signed when re-auth is on)', async () => {
    const { api } = await openApproval({ reauthActions: ['REQUEST_BLOCK_CHANGE'], routes: [{ method: 'POST', path: '/api/block-change-requests', status: 201, body: {} }] });
    const go = screen.getByRole('button', { name: 'Request approval' });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Why does this filter need to be cleaned in a different block?'), { target: { value: 'North washer down' } });
    fireEvent.click(go);
    await passReauth();
    expect(await message('Block change request submitted. Waiting for approval.')).toBeInTheDocument();
    const req = api.calls('POST', '/api/block-change-requests')[0];
    expect(req.json).toEqual({ filterId: 'f1', filterName: 'F-001', fromBlockId: 'b1', fromBlockName: 'North', toBlockId: 'b2', toBlockName: 'South', reason: 'North washer down', _currentPassword: 'Secret@123' });
    expect(screen.queryByText('Block change approval needed')).toBeNull();
  });

  it('a refused request is shown; a cancelled password frees the button', async () => {
    await openApproval({ reauthActions: ['REQUEST_BLOCK_CHANGE'], routes: [{ method: 'POST', path: '/api/block-change-requests', status: 409, body: { error: 'X', message: 'Already requested' } }] });
    fireEvent.change(screen.getByPlaceholderText('Why does this filter need to be cleaned in a different block?'), { target: { value: 'Reason' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }));
    await cancelReauth();
    expect(screen.getByRole('button', { name: 'Request approval' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }));
    await passReauth();
    expect(await message('Already requested')).toBeInTheDocument();
  });

  it('losing the connection with the dialog open keeps it an APPROVAL request (never a self-confirm)', async () => {
    const { api } = await openApproval();
    await act(async () => { setOnline(false); });
    await flush(50);
    // The mode read online stays in force offline; it used to fall back to CONFIRM,
    // turning the dialog into "Continue with cleaning" — a self-confirm.
    expect(screen.getByText('Block change approval needed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue with cleaning' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Why does this filter need to be cleaned in a different block?'), { target: { value: 'North washer down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }));
    expect(await message('Block change requests need an internet connection.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/block-change-requests')).toHaveLength(0);
  });

  it('the mode read online is remembered for the next offline start of the page', async () => {
    const view = await renderOps({ stage: 'WASH_IN', blockChangeMode: 'NONE' });
    await waitFor(() => expect(cachedValue('block-change-mode')).toBe('NONE'));
    view.unmount();
  });
});

describe('AHU completion pre-flight (POPUP / INTERLOCK)', () => {
  const FINAL = { STORAGE_OUT: { leadsToEnd: true, nextStages: [] } };
  const finalState = () => state('STORAGE_IN', [adv('STORAGE_OUT')], { stageLookup: FINAL });
  const ahuRoutes = (o: { both?: boolean; ahus?: any[]; batchStatus?: number } = {}): MockRoute[] => [
    { path: '/api/filters/f1/current-state', body: { stageLookup: FINAL } },
    { method: 'POST', path: '/api/filters/ahu-set-availability', body: { hasBothSets: o.both ?? false } },
    { method: 'POST', path: '/api/filters/ahu-completion-status/batch', status: o.batchStatus ?? 200, body: { ahus: o.ahus ?? [{ ahuId: 'h1', ahuName: 'AHU-01', allAtFinal: false, filters: [{ id: 'f1', name: 'F-001', stage: 'STORAGE_IN', done: false }, { id: 'f2', name: 'F-002', stage: 'WASH_IN', done: false }] }] } },
    { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
  ];

  it('POPUP: the set is chosen first; the remaining-filters warning can be overridden; the choice rides on the advance', async () => {
    const { api } = await renderOps({ stage: 'STORAGE_OUT', ahuMode: 'POPUP', states: { f1: finalState() }, routes: ahuRoutes({ both: true }) });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Choose the filter set before completing this AHU')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Set A/ }));
    expect(await screen.findByRole('button', { name: /Continue anyway/ })).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/ahu-completion-status/batch')[0].json).toEqual({ filterIds: ['f1'], set: 'SET_A' });
    fireEvent.click(screen.getByRole('button', { name: /Continue anyway/ }));
    expect(await message('1 filter(s) → Storage Out')).toBeInTheDocument();
    expect(bulkItems(api)[0].payload.filterSet).toBe('SET_A');
  });

  it('POPUP: Cancel on the chooser, or on the warning, submits nothing', async () => {
    const { api } = await renderOps({ stage: 'STORAGE_OUT', ahuMode: 'POPUP', states: { f1: finalState() }, routes: ahuRoutes({ both: true }) });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Choose the filter set before completing this AHU');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /All Filters/ }));
    await screen.findByRole('button', { name: /Continue anyway/ });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
    expect(queueCount()).toBe('1');
  });

  it('every sibling already final: no warning at all', async () => {
    const { api } = await renderOps({ stage: 'STORAGE_OUT', ahuMode: 'POPUP', states: { f1: finalState() }, routes: ahuRoutes({ ahus: [{ ahuId: 'h1', ahuName: 'AHU-01', allAtFinal: true, filters: [] }] }) });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Storage Out')).toBeInTheDocument();
    expect(bulkItems(api)[0].payload.filterSet).toBeUndefined();
  });

  it('INTERLOCK: a completion check that fails blocks the submit and says so', async () => {
    allowConsoleError(/\[ahu-completion\]/);
    const { api } = await renderOps({ stage: 'STORAGE_OUT', ahuMode: 'INTERLOCK', states: { f1: finalState() }, routes: ahuRoutes({ batchStatus: 500 }) });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('Could not verify AHU completion status. Check your connection and try again.')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });

  it('INTERLOCK: with siblings still out the dialog blocks; Close submits nothing', async () => {
    const { api } = await renderOps({ stage: 'STORAGE_OUT', ahuMode: 'INTERLOCK', states: { f1: finalState() }, routes: ahuRoutes() });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await flush();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });

  it('a terminal checklist at the target stage is gated before its dialog opens', async () => {
    const T = { STORAGE_OUT: { leadsToEnd: true, nextStages: [], pendingChecklistProfileIds: ['cl1'] } };
    const { api } = await renderOps({
      stage: 'STORAGE_OUT', ahuMode: 'POPUP', cache: { 'checklist-profiles': [CHECKLIST_PROFILE] },
      states: { f1: state('STORAGE_IN', [adv('STORAGE_OUT')], { stageLookup: T }) },
      routes: [{ path: '/api/filters/f1/current-state', body: { stageLookup: T } }, ...ahuRoutes().slice(1)],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Continue anyway/ }));
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });

  it('a terminal checklist pending at the current stage is gated too; Continue opens it, Cancel keeps it closed', async () => {
    // Storage Out leads to END through a checklist, so the "completing advance"
    // pre-flight stays out of the way and the CHECKLIST gate is the one that asks.
    const T = { STORAGE_OUT: { leadsToEnd: true, nextStages: [], pendingChecklistProfileIds: ['cl1'] } };
    const { api } = await renderOps({
      stage: 'STORAGE_OUT', ahuMode: 'POPUP',
      states: { f1: state('STORAGE_OUT', [submitChecklist('STORAGE_OUT')], { stageLookup: T }) },
      routes: [{ path: '/api/filters/f1/current-state', body: { currentState: 'STORAGE_OUT', stageLookup: T } }, ...ahuRoutes().slice(1)],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await flush();
    expect(screen.queryByText('Checklist Required')).toBeNull();
    expect(api.calls('POST', '/api/filters/ahu-completion-status/batch')).toHaveLength(1);
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Continue anyway/ }));
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
  });
});

