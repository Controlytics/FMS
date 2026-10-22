/**
 * Tablet operations page — edge paths. Most cover the case the code comments
 * call out repeatedly: the WebView's online flag says OFFLINE while the server
 * is in fact reachable, so the offline branch runs but the write still gets a
 * real server answer (a refusal, a re-auth demand). Same boundaries as
 * ops-scan-queue.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { MockRoute } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, queuedOps, allowConsoleError } from './support/mobile-kit';
import { renderOps, scanTag, inQueue, state, adv, setDryer, graph, submitButton, message, dismissAll, submitChecklist, F1, F2, F3 } from './support/ops-harness';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({ DryingFiltersPanel: () => null }));

useMobileLifecycle();

const MAP = { 'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' }, E2: { filterId: 'f2', filterName: 'F-002' }, E3: { filterId: 'f3', filterName: 'F-003' } } };
const BLOCKS = [{ id: 'b1', name: 'North', templateId: 'tpl-block', parentId: null }];
const TEMPLATES = { templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }] };

describe('"offline" flag, reachable server', () => {
  it('a refused advance is listed and shown under Failed; the others still go', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [F1, F2], cache: MAP,
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]), f2: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [
        { method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'WASH_OUT', tapeVersion: 8, actions: [adv('STORAGE_IN')] } },
        { method: 'POST', path: '/api/filters/f2/advance', status: 409, body: { error: 'OUT_OF_SEQUENCE', message: 'Not at Wash In' } },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await message('F-002: Not at Wash In')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('1 filter(s) → Wash Out (1 failed)')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Failed · 1').parentElement).toHaveTextContent('Not at Wash In');
    expect(screen.getByText('Submitted · 1').parentElement).toHaveTextContent('✓'); // executed, not queued
    expect(queuedOps()).toHaveLength(0);
  });

  it('a re-auth demand stops the batch with a clear instruction (it is never queued)', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [F1], cache: MAP,
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/f1/advance', status: 401, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('Re-authentication required — please enter your password and re-submit the batch.')).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
    await dismissAll();
    expect(submitButton()).toBeEnabled(); // the spinner always clears (D6)
  });

  it('Dry In: a refused dryer start is listed by filter', async () => {
    await renderOps({
      stage: 'DRY_IN', online: false, cachedFilters: [...BLOCKS, { ...F1, currentLifecycleState: 'WASH_OUT' }],
      cache: { ...MAP, ...TEMPLATES }, states: { f1: state('WASH_OUT', [setDryer()]) },
      routes: [{ method: 'POST', path: '/api/filters/f1/advance', status: 409, body: { error: 'X', message: 'Dryer busy' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001: Dryer busy')).toBeInTheDocument();
  });

  it('Dry In: an executed dryer start records its tape for the follow-up checklist', async () => {
    await renderOps({
      stage: 'DRY_IN', online: false, cachedFilters: [...BLOCKS, { ...F1, currentLifecycleState: 'WASH_OUT' }],
      cache: { ...MAP, ...TEMPLATES }, states: { f1: state('WASH_OUT', [setDryer()]) },
      routes: [{ method: 'POST', path: '/api/filters/f1/advance', body: { currentState: 'DRY_IN', tapeVersion: 9, actions: [submitChecklist('DRY_IN')] } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Checklist Required')).toBeInTheDocument();
    expect(screen.getByText('F-001', { selector: 'p' })).toBeInTheDocument();
  });

  it('a batch START whose server refuses one filter names it', async () => {
    const NO_CYCLE = { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_OUT', 'STORAGE_IN']) };
    const startOk: MockRoute[] = [
      { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: {} },
      { path: '/api/filters/f1/current-state', body: { tapeVersion: 2 } },
      { method: 'POST', path: '/api/filters/f1/advance', body: { tapeVersion: 3, actions: [] } },
    ];
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [{ ...F1, currentCycleId: null }, F3],
      cache: { ...MAP, 'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }], 'filter-state-f1': NO_CYCLE, 'filter-state-f3': NO_CYCLE },
      routes: [...startOk, { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'REPLACEMENT_OVERDUE', message: 'Replacement overdue' } }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await message('F-003: Replacement overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('Queued 1 cycle(s)')).toBeInTheDocument(); // the refused one is not counted
  });

  it('a batch START with readings tries every filter; a follow-on refusal is named and not counted', async () => {
    const NO_CYCLE = { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_IN', 'WASH_OUT']) };
    const G = { id: 'gw', name: 'Wash Bay', blockId: 'b1', instruments: [{ id: 'ro', description: 'RO', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 1 }] };
    const { api } = await renderOps({
      stage: 'WASH_IN', online: false, cachedFilters: [...BLOCKS, { ...F1, currentCycleId: null }, F3],
      cache: { ...MAP, ...TEMPLATES, 'cleaning-reasons': [{ key: 'PM', name: 'Preventive Maintenance', isActive: true }], 'equipment-groups': [G], 'filter-state-f1': NO_CYCLE, 'filter-state-f3': NO_CYCLE },
      routes: [
        { method: 'POST', path: '/api/filters/f1/start-cycle', status: 201, body: {} },
        { path: '/api/filters/f1/current-state', body: { tapeVersion: 2 } },
        { method: 'POST', path: '/api/filters/f1/advance', body: { tapeVersion: 3, actions: [] } },
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 409, body: { error: 'X', message: 'Blocked filter' } },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Wash Bay' }));
    fireEvent.change(screen.getByText('RO (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.calls('POST', '/api/filters/f3/start-cycle')).toHaveLength(1));
    // Both STARTs reach the server with the same reason and readings…
    expect(api.calls('POST', '/api/filters/f1/advance')[0].json.instrumentReadings).toEqual({ ro: 1 });
    expect(api.calls('POST', '/api/filters/f3/start-cycle')[0].json.cleaningReasonKey).toBe('PM');
    // …and F-003's 409 is shown, not swallowed (it was, until 2026-10-22: the
    // continuation loop ran inside reauth.execute, which never re-throws).
    expect(await message('F-003: Blocked filter')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('Started 1 cycle successfully')).toBeInTheDocument();
  });

  it('an offline batch checklist the server accepts reads as submitted, not queued', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [F1], cache: { ...MAP },
      states: { f1: state('WASH_IN', [submitChecklist('WASH_IN')], { pipelineGraph: graph(['WASH_IN', 'WASH_OUT'], { stage: 'WASH_IN', profileId: 'cl1' }) }) },
      routes: [{ method: 'POST', path: '/api/filters/f1/submit-checklist', body: { tapeVersion: 9, actions: [] } }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    await screen.findByText('Checklist Required');
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Checklist' }));
    expect(await message('Checklist submitted for 1 filter(s)')).toBeInTheDocument();
  });
});

describe('misc', () => {
  // The scan field re-takes focus 50 ms after a blur. A page closed inside that
  // window left the timer running against a torn-down document (the full suite's
  // unhandled "document is not defined", 2026-10-22).
  it('a blur just before the page closes leaves no refocus timer behind', async () => {
    const view = await renderOps({ stage: 'WASH_OUT' });
    const input = screen.getByPlaceholderText('Scan RFID tag...');
    const active = vi.spyOn(document, 'activeElement', 'get');
    fireEvent.blur(input);
    view.unmount();
    active.mockClear();
    await new Promise((r) => setTimeout(r, 120));
    expect(active).not.toHaveBeenCalled();
  });

  it('APPROVAL mode without re-auth posts the request plainly', async () => {
    const { api } = await renderOps({
      stage: 'WASH_IN', blockChangeMode: 'APPROVAL',
      states: { f1: state('WASH_IN', [adv('WASH_IN')]) },
      routes: [
        { path: '/api/filters/f1/current-state', body: { blockChangeStatus: 'CONFIRM', homeBlock: { id: 'b1', name: 'North' } } },
        { method: 'POST', path: '/api/block-change-requests', status: 201, body: {} },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    fireEvent.change(await screen.findByPlaceholderText('Why does this filter need to be cleaned in a different block?'), { target: { value: 'Washer down' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }));
    expect(await message('Block change request submitted. Waiting for approval.')).toBeInTheDocument();
    const req = api.calls('POST', '/api/block-change-requests')[0];
    expect(req.json.reason).toBe('Washer down');
    expect(req.headers['x-reauth-password']).toBeUndefined();
  });

  it('a readings dialog for a group with no instruments at this stage still records the step; the checklist says so', async () => {
    const G0 = { id: 'g0', name: 'Empty bay', blockId: 'b1', instruments: [{ id: 'x', description: 'Dryer temp', stageKey: 'DRY_IN', uom: 'C', operatingMin: 1, operatingMax: 2, leastCount: 1 }] };
    await renderOps({
      stage: 'WASH_IN', states: { f3: { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_IN', 'WASH_OUT']), homeBlock: { id: 'b1', name: 'North' } } },
      routes: [
        { path: '/api/equipment-groups/by-block/b1', body: [G0] },
        { method: 'POST', path: '/api/filters/f3/start-cycle', status: 201, body: {} },
        { path: '/api/filters/f3/current-state', body: { tapeVersion: 2 } },
        { method: 'POST', path: '/api/filters/f3/advance', body: { tapeVersion: 3, actions: [submitChecklist('WASH_IN')] } },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: /Preventive Maintenance/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Empty bay' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Readings recorded. Please complete the checklist below to finalize this step.')).toBeInTheDocument();
  });

  it('an unreachable completion-status read falls back to the cached state (POPUP still asks)', async () => {
    const FINAL = { STORAGE_OUT: { leadsToEnd: true, nextStages: [] } };
    await renderOps({
      stage: 'STORAGE_OUT', ahuMode: 'POPUP',
      states: { f1: state('STORAGE_IN', [adv('STORAGE_OUT')], { stageLookup: FINAL }) },
      routes: [
        { path: '/api/filters/f1/current-state', status: 500, body: { error: 'X', message: 'x' } },
        { method: 'POST', path: '/api/filters/ahu-set-availability', status: 500, body: { error: 'X', message: 'x' } },
        { method: 'POST', path: '/api/filters/ahu-completion-status/batch', body: { ahus: [{ ahuId: 'h1', ahuName: 'AHU-01', allAtFinal: false, filters: [] }] } },
      ],
    });
    allowConsoleError(/\[ahu-completion\] set-availability check failed/);
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByRole('button', { name: /Continue anyway/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await flush();
  });
});

