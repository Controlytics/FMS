/**
 * Tablet operations page — scanning into the queue and submitting it
 * (handleSubmitQueue): online one /bulk-operate per batch, refusals, the
 * interlock banner, transport failure, re-auth, cross-block confirmation, the
 * Dry In dryer start, readings for a mid-cycle Wash In, and the offline queue.
 *
 * Real: the page, use-core, use-offline, offline-store (in-memory IndexedDB),
 * offline-cache, action-tape, the offline gate, apiClient, SWR, useReauth.
 * Faked at their boundary: connectivity, the sync engine (protected surface,
 * own suite) and the native RFID bridge. The shared "Currently Drying" panel is
 * stubbed to its callbacks — it has its own suite (drying-filters-panel-flow).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { MockRequest } from '@/test-utils/page-harness';
import { useMobileLifecycle, flush, cachedValue, queuedOps, passReauth, cancelReauth, seedCache, OPERATOR } from './support/mobile-kit';
import {
  renderOps, scanTag, inQueue, state, adv, setDryer, terminate, graph, bulkOk, bulkItems, submitButton, message, dismissAll,
  F1, OPS_INSTANCES,
} from './support/ops-harness';
import { rfid } from './support/fakes';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/rfid-bridge', async () => (await import('./support/fakes')).rfidBridgeModule);
vi.mock('../../filter-management/components/drying-filters-panel', () => ({
  DryingFiltersPanel: (p: any) => (
    <div data-testid="drying">
      drying:{p.filters.map((f: any) => f.name).join(',')}
      <button onClick={() => p.onSuccess('Dry In recorded for 1 filter')}>panel-ok</button>
      <button onClick={() => p.onError('Panel failed')}>panel-err</button>
    </div>
  ),
}));

useMobileLifecycle();

const offlineFetch = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

describe('scanning into the queue', () => {
  it('a scanned tag joins the queue with its AHU; the same filter twice is refused; Remove and the ticks work', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    await scanTag('e1');
    // The FIRST scan names the AHU too: the reader's listener must call the
    // latest handler, not the one from before the master data arrived.
    expect(await inQueue('F-001')).toHaveTextContent('F-001· AHU-01');
    await scanTag('E1');
    expect(await message('Filter already in queue')).toBeInTheDocument();
    await dismissAll();
    await scanTag('e2');
    expect(await inQueue('F-002')).toHaveTextContent('F-002· AHU-01'); // the row names the filter's AHU
    expect(screen.getByText(/Queue \(2\) · 2 selected/)).toBeInTheDocument();
    const rowBox = (name: string) => (screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent?.startsWith(name) === true && el.className.includes('text-sm'))
      .parentElement!.querySelector('input[type="checkbox"]') as HTMLInputElement);
    fireEvent.click(rowBox('F-001'));
    expect(screen.getByText(/Queue \(2\) · 1 selected/)).toBeInTheDocument();
    expect(submitButton()).toHaveTextContent('Submit Selected (1)');
    const all = screen.getByText(/Queue \(2\)/).querySelector('input') as HTMLInputElement;
    expect(all.checked).toBe(false);
    fireEvent.click(all);
    expect(screen.getByText(/Queue \(2\) · 2 selected/)).toBeInTheDocument();
    fireEvent.click(all);
    expect(screen.getByText(/Queue \(2\) · 0 selected/)).toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
    fireEvent.click(rowBox('F-002'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(screen.queryByText(/F-001· AHU-01/)).toBeNull();
    expect(screen.getByText(/Queue \(1\) · 1 selected/)).toBeInTheDocument();
  });

  it('an unknown tag is explained (and the raw scan shown when it differs); online the cache self-heals on a hit', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    await scanTag('zz9');
    expect(await message('Filter not found for tag "ZZ9" (scanned "zz9"). This value is not assigned to any filter on the server — the scanned value may differ from the stored RFID number.')).toBeInTheDocument();
    await dismissAll();
    await scanTag('e1');
    await inQueue('F-001');
    expect(cachedValue('identifier-map')?.E1).toEqual({ filterId: 'f1', filterName: 'F-001', approvalStatus: null });
    expect(cachedValue('identifier-map')?.e1?.filterId).toBe('f1');
  });

  it('a filter not yet approved (or rejected) is refused at scan time with the server\'s wording', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    await scanTag('E5');
    expect(await message('Filter "F-005" is still awaiting review/approval, so it cannot be cleaned yet.')).toBeInTheDocument();
    await dismissAll();
    await scanTag('E6');
    expect(await message('Filter "F-006" was rejected and must be corrected and re-submitted, so it cannot be cleaned yet.')).toBeInTheDocument();
    expect(screen.queryByText(/Queue \(/)).toBeNull();
  });

  it('when the server has no tag, the cached map and then the filter NAME are tried; a filter id is accepted as-is', async () => {
    await renderOps({
      stage: 'WASH_OUT',
      cache: { 'identifier-map': { OLDTAG: { filterId: 'f2', filterName: 'F-002' }, NEWPEND: { filterId: 'f5', filterName: 'F-005' } } },
    });
    await scanTag('oldtag');
    await inQueue('F-002');
    await scanTag('f-003'); // a filter's name typed on the wedge
    await inQueue('F-003');
    await scanTag('NEWPEND'); // cached map + the instance row says pending → refused
    expect(await message(/still awaiting review\/approval/)).toBeInTheDocument();
    await dismissAll();
    await scanTag('12345678-aaaa-bbbb-cccc-1234567890ab');
    expect(await screen.findByText((_, el) => el?.tagName === 'SPAN' && el.textContent === '12345678')).toBeInTheDocument();
  });

  it('a retired holder is not written back into the offline map', async () => {
    await renderOps({ stage: 'WASH_OUT', routes: [{ path: '/api/assets/identifiers/lookup/E7', body: { asset: { id: 'f2', name: 'F-002', status: 'Retired' } } }] });
    await scanTag('E7');
    await inQueue('F-002');
    expect(cachedValue('identifier-map')?.E7).toBeUndefined();
  });

  it('a reader error shows a banner with Reconnect; a failed reconnect keeps it', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    await waitFor(() => expect(rfid.onError).toBeTypeOf('function'));
    await act(async () => { rfid.onError!('USB permission denied'); });
    expect(screen.getByText(/RFID reader: USB permission denied\. You can still type\/scan manually/)).toBeInTheDocument();
    rfid.reconnect.mockResolvedValueOnce({ ok: false, error: 'Reader unplugged' });
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText(/RFID reader: Reader unplugged/)).toBeInTheDocument();
    rfid.reconnect.mockResolvedValueOnce({ ok: false });
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText(/RFID reader: reconnect failed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await message('RFID reader reconnected')).toBeInTheDocument();
    expect(screen.queryByText(/RFID reader:/)).toBeNull();
  });

  it('a needs-block station asks for the block first; Change goes back to the picker', async () => {
    await renderOps({ stage: 'WASH_IN' });
    expect(await screen.findByText('Select Block')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Scan RFID tag...')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'South' }));
    expect(screen.getByText('Block: South')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Scan RFID tag...')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByText('Select Block')).toBeInTheDocument();
  });

  it('My Tasks Perform hands over a block, which is preselected once the blocks load (an unknown id is ignored)', async () => {
    const a = await renderOps({ props: { initialStageKey: 'WASH_IN', initialBlockId: 'b2' } });
    expect(await screen.findByText('Block: South')).toBeInTheDocument();
    a.unmount();
    await renderOps({ props: { initialStageKey: 'WASH_IN', initialBlockId: 'nope' } });
    expect(await screen.findByText('Select Block')).toBeInTheDocument();
    await flush();
  });
});

describe('keyboard-wedge readers', () => {
  it('a fast burst ending in Enter is submitted as one tag; the debug overlay shows the keys', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let t = new Date('2026-10-21T10:00:00Z').getTime();
    vi.setSystemTime(t);
    await renderOps({ stage: 'WASH_OUT' });
    await screen.findByPlaceholderText('Scan RFID tag...');
    for (const k of 'E2') { t += 20; vi.setSystemTime(t); fireEvent.keyDown(document.body, { key: k }); }
    t += 20; vi.setSystemTime(t); fireEvent.keyDown(document.body, { key: 'Enter' }); // only 2 chars: dropped
    for (const k of 'E1') { t += 400; vi.setSystemTime(t); fireEvent.keyDown(document.body, { key: k }); } // human speed resets
    for (const k of 'E1XX') { t += 20; vi.setSystemTime(t); fireEvent.keyDown(document.body, { key: k }); }
    t += 20; vi.setSystemTime(t); fireEvent.keyDown(document.body, { key: 'Shift' }); // non-character key ignored
    t += 20; vi.setSystemTime(t); fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(await message(/Filter not found for tag "E1XX"/)).toBeInTheDocument();
    await dismissAll();
    fireEvent.click(screen.getByTitle('Toggle RFID debug'));
    expect(screen.getByText(/RFID DEBUG \(\d+\)/)).toBeInTheDocument();
    expect(screen.getByText('SUBMIT: "E1XX" (len 4)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByText(/Waiting for keystrokes/)).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Toggle RFID debug'));
    expect(screen.queryByText(/RFID DEBUG/)).toBeNull();
  });

  it('a burst with no terminator is flushed after a short pause', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    await screen.findByPlaceholderText('Scan RFID tag...');
    for (const k of 'E2') fireEvent.keyDown(document.body, { key: k });
    for (const k of 'XY') fireEvent.keyDown(screen.getByPlaceholderText('Scan RFID tag...'), { key: k });
    expect(screen.getByPlaceholderText('Scan RFID tag...')).toHaveValue('E2XY');
    expect(await message(/Filter not found for tag "E2XY"/, )).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Scan RFID tag...')).toHaveValue('');
  });

  it('typing in the remarks box is never captured as a scan', async () => {
    await renderOps({ stage: 'WASH_OUT' });
    const remarks = await screen.findByPlaceholderText('Remarks (optional)');
    fireEvent.keyDown(document.body, { key: 'E' }); // stale wedge state…
    for (const k of 'fast typing') fireEvent.keyDown(remarks, { key: k });
    fireEvent.keyDown(remarks, { key: 'Enter' });
    await flush(300);
    expect(screen.queryAllByRole('button', { name: 'OK' })).toHaveLength(0);
    expect(screen.getByPlaceholderText('Scan RFID tag...')).toHaveValue('E');
  });
});

describe('submitting the queue — online (one /bulk-operate)', () => {
  it('sends every selected filter in ONE request with its tape version, then reports and clears', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]), f2: state('WASH_IN', [adv('WASH_OUT')], { tapeVersion: 'x' }) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.change(screen.getByPlaceholderText('Remarks (optional)'), { target: { value: 'shift A' } });
    fireEvent.click(submitButton());
    expect(await message('2 filter(s) → Wash Out')).toBeInTheDocument();
    const items = bulkItems(api);
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(1);
    expect(items.map((i: any) => [i.filterId, i.kind, i.payload])).toEqual([
      ['f1', 'advance', { targetState: 'WASH_OUT', remarks: 'shift A', tapeVersion: 7 }],
      ['f2', 'advance', { targetState: 'WASH_OUT', remarks: 'shift A' }], // a non-numeric tapeVersion is not sent
    ]);
    expect(new Set(items.map((i: any) => i.clientOpId)).size).toBe(2);
    await dismissAll();
    expect(screen.queryByText(/Queue \(/)).toBeNull();
    expect(screen.getByPlaceholderText('Remarks (optional)')).toHaveValue('');
    expect(screen.getByText('Submitted · 2')).toBeInTheDocument();
    expect(cachedValue('filter-state-f1')?.tapeVersion).toBe(8); // primed from the bulk snapshot
  });

  // 2026-10-22, CLAUDE.md: a cycle's profile is locked at its start, and its
  // readings validate against the equipment-group version it started with.
  // When the admin has since changed either, the cycle still finishes as it
  // started — the operator is TOLD, never stopped. Once per cycle.
  it('a cycle whose profile or equipment group changed since its start goes through, with a notice (once)', async () => {
    const warned = {
      profileSyncWarning: { cycleProfileId: 'p-old', cycleProfileName: 'Standard v1', expectedProfileId: 'p-new', expectedProfileName: 'Standard v2', recommendation: 'TERMINATE_AND_RESTART' },
      equipmentGroupSyncWarning: { groupId: 'g1', pinnedVersion: 2, liveVersion: 3, recommendation: 'CONTINUE_OR_TERMINATE_AND_RESTART' },
    };
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [adv('WASH_OUT')], warned), f2: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await message('2 filter(s) → Wash Out')).toBeInTheDocument(); // not blocked
    expect(bulkItems(api).map((i: any) => i.filterId)).toEqual(['f1', 'f2']);
    expect(screen.getByText('Cleaning profile changed')).toBeInTheDocument();
    expect(screen.getByText(/F-001: running on "Standard v1"; this block now uses "Standard v2"/)).toBeInTheDocument();
    expect(screen.getByText(/finishes on the profile it started with/)).toBeInTheDocument();
    expect(screen.getByText('Equipment group changed')).toBeInTheDocument();
    expect(screen.getByText(/F-001: group updated v2 → v3/)).toBeInTheDocument();
    expect(screen.queryByText(/F-002:/)).toBeNull();
    await dismissAll();
    // the same cycle again (its cached state still carries the warnings): not told twice
    await seedCache({ 'filter-state-f1': state('WASH_IN', [adv('WASH_OUT')], warned) });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Wash Out')).toBeInTheDocument();
    expect(screen.getAllByText('Cleaning profile changed')).toHaveLength(1);
    expect(screen.getAllByText('Equipment group changed')).toHaveLength(1);
    await dismissAll();
  });

  it('per-filter refusals are listed by NAME and shown under "Failed"; the successful ones still count', async () => {
    await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]), f2: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: [
        { clientOpId: r.json.items[0].clientOpId, filterId: 'f1', status: 'ok', snapshot: null },
        { clientOpId: r.json.items[1].clientOpId, filterId: 'f2', status: 'failed', error: { code: 'STALE_TAPE', message: 'Another operator moved it' } },
      ] }) }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    // the error and the success are both acknowledged, error first
    expect(await message('F-002: Another operator moved it')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('1 filter(s) → Wash Out (1 failed)')).toBeInTheDocument();
    await dismissAll();
    const failed = screen.getByText('Failed · 1').parentElement!;
    expect(failed).toHaveTextContent('F-002');
    expect(failed).toHaveTextContent('Another operator moved it');
  });

  it('a stage-interlock refusal names the approver in a banner (OQ-02)', async () => {
    await renderOps({
      stage: 'DRY_OUT',
      states: { f1: state('WASH_OUT', [adv('DRY_OUT')]) },
      routes: [
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: [
          { clientOpId: r.json.items[0].clientOpId, filterId: 'f1', status: 'failed', error: { code: 'STAGE_APPROVAL_PENDING', message: 'Wash Out awaits SHIFTOFFICER' } },
        ] }) },
        { path: '/api/filters/f1/current-state', body: { interlock: { stageKey: 'WASH_OUT', status: 'PENDING', approverRole: 'SHIFTOFFICER', blocksLeaving: true } } },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001: Wash Out awaits SHIFTOFFICER')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Wash Out awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('SHIFTOFFICER must verify and approve before this filter can continue.')).toBeInTheDocument();
  });

  it('an interlock refusal whose live state can no longer be read still lists the reason', async () => {
    await renderOps({
      stage: 'DRY_OUT',
      states: { f1: state('WASH_OUT', [adv('DRY_OUT')]) },
      routes: [
        { method: 'POST', path: '/api/filters/bulk-operate', body: (r: MockRequest) => ({ results: [
          { clientOpId: r.json.items[0].clientOpId, filterId: 'f1', status: 'failed', error: { code: 'STAGE_APPROVAL_REJECTED' } },
        ] }) },
        { path: '/api/filters/f1/current-state', status: 500, body: { error: 'X', message: 'db' } },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001: failed')).toBeInTheDocument();
    await dismissAll();
    expect(screen.queryByText(/awaiting approval/)).toBeNull();
  });

  it('a transport failure keeps the queue for a retry and says so', async () => {
    await renderOps({
      stage: 'WASH_OUT',
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', status: 502, body: { error: 'BAD_GATEWAY', message: 'upstream' } }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('Could not reach the server to submit the batch. Please try Submit again.')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText(/Queue \(1\)/)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('when the tablet storage cannot be read, the submit says so and the button recovers (never a stuck spinner)', async () => {
    const { api } = await renderOps({ stage: 'WASH_OUT', states: { f1: state('WASH_IN', [adv('WASH_OUT')]) } });
    await scanTag('E1'); await inQueue('F-001');
    vi.stubGlobal('indexedDB', undefined); // the WebView's IndexedDB is gone (storage evicted / quota)
    fireEvent.click(submitButton());
    expect(await screen.findByRole('button', { name: 'OK' })).toBeInTheDocument(); // the failure is shown
    await dismissAll();
    expect(screen.queryByText(/Submitting/)).toBeNull();
    expect(submitButton()).toBeEnabled();
    expect(screen.getByText(/Queue \(1\)/)).toBeInTheDocument(); // kept for a retry
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });

  it('with re-auth on, ONE password signs the batch; cancelling keeps the queue with no error', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      reauthActions: ['STAGE_WASH_OUT'],
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText(/Advance Filter to Next Stage/)).toBeInTheDocument(); // the prompt names the action
    await cancelReauth();
    await flush();
    expect(screen.queryAllByRole('button', { name: 'OK' })).toHaveLength(0);
    expect(screen.getByText(/Queue \(1\)/)).toBeInTheDocument();
    fireEvent.click(submitButton());
    await passReauth();
    expect(await message('1 filter(s) → Wash Out')).toBeInTheDocument();
    const req = api.calls('POST', '/api/filters/bulk-operate')[0];
    expect(req.headers['x-reauth-password']).toBe('Secret@123');
  });

  it('the offline gate also applies online: a filter scanned at the wrong station is refused before anything is sent', async () => {
    const { api } = await renderOps({
      stage: 'STORAGE_IN',
      states: { f1: state('WASH_IN', [adv('WASH_OUT'), terminate()]) },
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001: is at WASH IN — next allowed WASH OUT')).toBeInTheDocument();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });

  it('a held filter at an interlock-gated stage is reported with its approver; an approved one goes through', async () => {
    // A stale cached tape (still offering Dry In) fails the station gate; the live state then says why.
    const gated = (id: string) => state('WASH_OUT', [adv('DRY_IN')], { stageLookup: { WASH_OUT: { interlockGated: true } }, currentCycle: { id: `c-${id}`, status: 'IN_PROGRESS' } });
    const { api } = await renderOps({
      stage: 'DRY_OUT',
      states: { f1: gated('f1'), f2: gated('f2') },
      routes: [
        { path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i: any) => (i.id === 'f1' || i.id === 'f2' ? { ...i, currentLifecycleState: 'WASH_OUT' } : i)) } },
        { path: '/api/filters/f1/current-state', body: { interlock: { stageKey: 'WASH_OUT', status: 'REJECTED', approverRole: 'QA', blocksLeaving: true } } },
        { path: '/api/filters/f2/current-state', body: { currentState: 'WASH_OUT', actions: [adv('DRY_OUT')], tapeVersion: 9, currentCycle: { id: 'c-f2', status: 'IN_PROGRESS' } } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
      ],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await message('F-001: Wash Out was rejected — the filter has been sent back for re-cleaning.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(await message('1 filter(s) → Dry Out (1 failed)')).toBeInTheDocument();
    await dismissAll();
    expect(screen.getByText('Wash Out approval rejected')).toBeInTheDocument();
    expect(screen.getByText('Rejected — the filter has been sent back for re-cleaning.')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => [i.filterId, i.payload.tapeVersion])).toEqual([['f2', 9]]);
  });

  it('a filter this tablet never opened is read once, so a wrong-station START is refused before the reason is asked', async () => {
    const { api } = await renderOps({
      stage: 'WASH_OUT',
      routes: [{ path: '/api/filters/f3/current-state', body: { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_IN', 'WASH_OUT']), tapeVersion: 1 } }],
    });
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await message('F-003: cannot start cycle at Wash Out — start at WASH IN')).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/f3/current-state')).toHaveLength(1);
    expect(screen.queryByText('Cleaning Reason')).toBeNull();
  });

  it('an overdue AHU replacement blocks a START', async () => {
    await renderOps({
      stage: 'WASH_OUT',
      blockedFilterIds: ['f3'],
      states: { f3: { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_OUT']) } },
    });
    await waitFor(() => expect(cachedValue('blocked-filter-ids')).toEqual(['f3']));
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await message('F-003: AHU replacement overdue — replace this filter before cleaning')).toBeInTheDocument();
  });

  it('filters with no cycle open the Cleaning Reason dialog ONCE for the whole batch', async () => {
    await renderOps({
      stage: 'WASH_OUT',
      states: {
        f1: { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_OUT', 'STORAGE_IN']) },
        f3: { currentState: null, currentCycle: null, actions: [], pipelineGraph: graph(['WASH_OUT', 'STORAGE_IN']) },
      },
      routes: [{ path: '/api/assets/instances', body: { data: OPS_INSTANCES.map((i) => (i.id === 'f1' ? { ...F1, currentCycleId: null, currentLifecycleState: null } : i)) } }],
    });
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E3'); await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Cleaning Reason')).toBeInTheDocument();
    expect(screen.getByText('F-001', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Preventive Maintenance/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retired reason/ })).toBeNull();
  });
});

describe('cross-block (online, CONFIRM mode)', () => {
  it('a filter from another block asks for confirmation; once confirmed the re-scan goes through', async () => {
    const { api } = await renderOps({
      stage: 'WASH_IN',
      states: { f1: state('WASH_IN', [adv('WASH_IN')], { homeBlock: { id: 'b1', name: 'North' } }) },
      routes: [
        { path: '/api/filters/f1/current-state', body: (r: MockRequest) => ({ blockChangeStatus: r.query.get('cleaningAreaId') === 'b2' ? 'CONFIRM' : 'MATCH', homeBlock: { id: 'b1', name: 'North' } }) },
        { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Cleaning in a different block')).toBeInTheDocument();
    const dlg = screen.getByText('Cleaning in a different block').closest('div.p-6')! as HTMLElement;
    expect(dlg).toHaveTextContent('Belongs to: North');
    expect(dlg).toHaveTextContent('Cleaning in: South');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Continue with cleaning' }));
    expect(await message('Confirmed. Scan F-001 again to clean it in this block.')).toBeInTheDocument();
    await dismissAll();
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Wash In')).toBeInTheDocument();
    expect(bulkItems(api)[0].payload.cleaningAreaId).toBe('b2');
  });

  it('Cancel on the block dialog sends nothing', async () => {
    const { api } = await renderOps({
      stage: 'WASH_IN',
      states: { f1: state('WASH_IN', [adv('WASH_IN')], { homeBlock: { id: 'b1', name: 'North' }, blockChangeStatus: 'REQUIRED' }) },
      routes: [{ path: '/api/filters/f1/current-state', status: 500, body: { error: 'X', message: 'x' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Cleaning in a different block')).toBeNull();
    expect(api.calls('POST', '/api/filters/bulk-operate')).toHaveLength(0);
  });
});

describe('Dry In — the dryer is started for the whole selection', () => {
  it('ONE duration (header) is sent as SET_DURATION for every filter; the drying panel lists filters already drying', async () => {
    const { api } = await renderOps({
      stage: 'DRY_IN',
      states: { f1: state('WASH_OUT', [setDryer()]), f2: state('WASH_OUT', [setDryer()]) },
      routes: [
        { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
        { path: '/api/hierarchy/ahus', body: { data: [{ id: 'h1', blockId: 'b1' }, { id: 'h2', blockId: 'b2' }] } },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await waitFor(() => expect(screen.getByTestId('drying')).toHaveTextContent('drying:F-004'));
    fireEvent.click(screen.getByRole('button', { name: 'panel-ok' }));
    expect(await message('Dry In recorded for 1 filter')).toBeInTheDocument();
    await dismissAll();
    fireEvent.click(screen.getByRole('button', { name: 'panel-err' }));
    expect(await message('Panel failed')).toBeInTheDocument();
    await dismissAll();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'North' }));
    expect(screen.queryByTestId('drying')).toBeNull(); // nothing drying in North
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    const dur = screen.getByText(/Duration/).querySelector('select') as HTMLSelectElement;
    expect(dur.value).toBe('30');
    fireEvent.change(dur, { target: { value: '60' } });
    fireEvent.click(submitButton());
    expect(await message('2 filter(s) → Dry In')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => i.payload)).toEqual([
      { targetState: 'DRY_IN', cleaningAreaId: 'b1', dryerAction: 'SET_DURATION', dryerDurationMinutes: 60, remarks: 'Dryer started (60 min) - F-001', tapeVersion: 7 },
      { targetState: 'DRY_IN', cleaningAreaId: 'b1', dryerAction: 'SET_DURATION', dryerDurationMinutes: 60, remarks: 'Dryer started (60 min) - F-002', tapeVersion: 7 },
    ]);
  });

  // The header change is the ONLY render between the two scans: the listeners
  // must call the latest handler, not the one captured when the queue last grew.
  it.each(['native reader', 'keyboard wedge'])('a filter scanned AFTER the header duration changed takes the new duration (%s)', async (via) => {
    const { api } = await renderOps({
      stage: 'DRY_IN',
      states: { f1: state('WASH_OUT', [setDryer()]), f3: state('WASH_OUT', [setDryer()]) },
      routes: [
        { path: '/api/assets/identifiers/lookup/TAG3', body: { asset: { id: 'f3', name: 'F-003' } } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    const dur = screen.getByText(/Duration/).querySelector('select') as HTMLSelectElement;
    fireEvent.change(dur, { target: { value: '60' } });
    if (via === 'native reader') await scanTag('E3');
    else for (const key of ['T', 'A', 'G', '3', 'Enter']) fireEvent.keyDown(document.body, { key }); // a fast burst
    await inQueue('F-003');
    fireEvent.click(submitButton());
    expect(await message('2 filter(s) → Dry In')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => [i.filterId, i.payload.dryerDurationMinutes])).toEqual([['f1', 60], ['f3', 60]]);
  });
});

describe('readings for a mid-cycle Wash In (2026-10-08)', () => {
  const GROUP = { id: 'g1', name: 'Wash Bay', blockId: 'b1', instruments: [
    { id: 'ro', description: 'RO water pressure', stageKey: 'WASH_IN', uom: 'bar', operatingMin: 1, operatingMax: 2, leastCount: 0.5 },
    { id: 'tmp', description: 'Dryer temp', stageKey: 'DRY_IN', uom: '°C', operatingMin: 60, operatingMax: 70, leastCount: 1 },
  ] };

  it('the cycle\'s bound group asks ONCE for the queue; every advance then carries the readings', async () => {
    const { api } = await renderOps({
      stage: 'WASH_IN',
      states: {
        f1: state('DRY_OUT', [adv('WASH_IN')], { equipmentGroup: GROUP }),
        f2: state('DRY_OUT', [adv('WASH_IN')], { equipmentGroup: GROUP }),
      },
      // the bulk snapshot IS the filter's /current-state (cycle + bound group)
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk({}, () => state('WASH_IN', [adv('WASH_OUT')], { equipmentGroup: GROUP })) }],
    });
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    await scanTag('E2'); await inQueue('F-002');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Equipment Readings')).toBeInTheDocument();
    expect(screen.getByText('2 filter(s)')).toBeInTheDocument();
    expect(screen.queryByText('Dryer temp (°C)')).toBeNull(); // only this stage's instruments
    const sel = screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Select...', '1.0 bar', '1.5 bar', '2.0 bar']);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    fireEvent.change(sel, { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('2 filter(s) → Wash In')).toBeInTheDocument();
    expect(bulkItems(api).map((i: any) => [i.payload.equipmentGroupId, i.payload.instrumentReadings])).toEqual([['g1', { ro: 1.5 }], ['g1', { ro: 1.5 }]]);
    // readings apply to ONE submit only
    await dismissAll();
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Equipment Readings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Equipment Readings')).toBeNull();
  });

  it('with no bound group, Wash In asks for the block\'s group (live, else cached)', async () => {
    const { api } = await renderOps({
      stage: 'WASH_IN',
      states: { f1: state('DRY_OUT', [adv('WASH_IN')]) },
      routes: [
        { path: '/api/equipment-groups/by-block/b1', status: 500, body: { error: 'X', message: 'x' } },
        { method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() },
      ],
      equipmentGroups: [GROUP, { id: 'g2', name: 'Other', blockId: 'b2', instruments: [] }],
    });
    await waitFor(() => expect(cachedValue('equipment-groups')).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await screen.findByText('Equipment Readings')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wash Bay' }));
    fireEvent.change(screen.getByText('RO water pressure (bar)').parentElement!.parentElement!.querySelector('select')!, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await message('1 filter(s) → Wash In')).toBeInTheDocument();
    expect(bulkItems(api)[0].payload.instrumentReadings).toEqual({ ro: 2 });
  });

  it('a group with no instruments for this stage asks nothing', async () => {
    const { api } = await renderOps({
      stage: 'STORAGE_IN',
      states: { f1: state('DRY_OUT', [adv('STORAGE_IN')], { equipmentGroup: GROUP }) },
      routes: [{ method: 'POST', path: '/api/filters/bulk-operate', body: bulkOk() }],
    });
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Storage In')).toBeInTheDocument();
    expect(bulkItems(api)[0].payload.instrumentReadings).toBeUndefined();
  });
});

describe('submitting the queue — offline (the queue in IndexedDB)', () => {
  it('each advance is queued on this tablet (owned by this operator) and marked as pending', async () => {
    await renderOps({
      stage: 'WASH_OUT',
      online: false,
      states: { f1: state('WASH_IN', [adv('WASH_OUT')]) },
      cachedFilters: [F1],
      cache: { 'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' } } },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Wash Out')).toBeInTheDocument();
    const ops = queuedOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'advance', filterId: 'f1', filterName: 'F-001', userId: OPERATOR.id, tapeVersion: 7, status: 'pending' });
    expect(ops[0].payload).toMatchObject({ targetState: 'WASH_OUT', remarks: 'Wash Out - F-001' });
    expect(cachedValue('filter-state-f1')?.currentState).toBe('WASH_OUT');
    await dismissAll();
    expect(screen.getByText('Submitted · 1').parentElement).toHaveTextContent('⏳');
  });

  it('offline an unknown tag says connect once to sync', async () => {
    await renderOps({ stage: 'WASH_OUT', online: false });
    offlineFetch();
    await scanTag('NOPE');
    expect(await message(/You're offline and this tag isn't cached — connect once to sync\./)).toBeInTheDocument();
  });

  it('offline with nothing cached for the filter it refuses rather than guess', async () => {
    await renderOps({
      stage: 'WASH_OUT', online: false, cachedFilters: [F1],
      cache: { 'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' } } },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('F-001: offline data not cached — sync first')).toBeInTheDocument();
    expect(queuedOps()).toHaveLength(0);
  });

  it('offline a filter from another block is recorded with a note (cross-block never blocks offline)', async () => {
    await renderOps({
      stage: 'WASH_IN', online: false, cachedFilters: [BLOCK_ROWS[0], BLOCK_ROWS[1], F1],
      states: { f1: state('WASH_IN', [adv('WASH_IN')], { homeBlock: { id: 'b1', name: 'North' } }) },
      cache: { 'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' } }, templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }] },
    });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'South' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    // (The "belongs to North" note is set and then replaced by the batch result in the
    // same tick here — the in-memory IndexedDB resolves in microtasks, so React never
    // paints between them. In the WebView IDB yields, and the note shows first.)
    expect(await message('1 filter(s) → Wash In')).toBeInTheDocument();
    expect(queuedOps()[0]).toMatchObject({ type: 'advance', filterId: 'f1', payload: expect.objectContaining({ cleaningAreaId: 'b2' }) });
  });

  it('offline at an interlock-gated stage the stripped tape is ignored and the advance is queued (offline is exempt)', async () => {
    await renderOps({
      stage: 'STORAGE_IN', online: false, cachedFilters: [{ ...F1, currentLifecycleState: 'WASH_OUT' }],
      states: { f1: state('WASH_OUT', [terminate()], { pipelineGraph: graph(['WASH_IN', 'WASH_OUT', 'STORAGE_IN', 'STORAGE_OUT']), stageLookup: { WASH_OUT: { interlockGated: true } } }) },
      cache: { 'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' } } },
    });
    offlineFetch();
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Storage In')).toBeInTheDocument();
    expect(queuedOps()[0]).toMatchObject({ type: 'advance', filterId: 'f1' });
  });

  it('offline Dry In starts the dryer through the queue and records the timing', async () => {
    await renderOps({
      stage: 'DRY_IN', online: false, cachedFilters: [BLOCK_ROWS[0], { ...F1, currentLifecycleState: 'WASH_OUT' }],
      states: { f1: state('WASH_OUT', [setDryer()]) },
      cache: {
        'identifier-map': { E1: { filterId: 'f1', filterName: 'F-001' } },
        templates: [{ id: 'tpl-filter', templateKind: 'FILTER' }, { id: 'tpl-block', templateKind: 'BLOCK' }],
        'equipment-groups': [{ id: 'gd', name: 'Dryer', blockId: 'b1', instruments: [] }],
      },
    });
    offlineFetch();
    fireEvent.click(await screen.findByRole('button', { name: 'North' }));
    await scanTag('E1'); await inQueue('F-001');
    fireEvent.click(submitButton());
    expect(await message('1 filter(s) → Dry In')).toBeInTheDocument();
    expect(queuedOps()[0]).toMatchObject({ type: 'advance', payload: expect.objectContaining({ dryerAction: 'SET_DURATION', dryerDurationMinutes: 30 }) });
    const row = cachedValue('filter-state-f1');
    expect(row.currentState).toBe('DRY_IN');
    expect(row.currentCycle.dryerDurationMinutes).toBe(30);
    expect(row.currentCycle.dryerStartedAt).toBeTruthy();
    expect(row.equipmentGroup?.id).toBe('gd');
  });
});

const BLOCK_ROWS = [
  { id: 'b1', name: 'North', templateId: 'tpl-block', parentId: null },
  { id: 'b2', name: 'South', templateId: 'tpl-block', parentId: null },
];
