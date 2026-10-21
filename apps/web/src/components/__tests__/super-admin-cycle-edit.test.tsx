/**
 * SuperAdminCycleEditDialog — one dialog for a cleaning cycle row AND its
 * stage events, saved through the two audited console endpoints with ONE
 * change reason and ONE re-auth (coverage campaign 2026-10-21).
 *
 * Real useReauth / useDatetimeFormat / SWR through the page harness; only
 * global `fetch` is stubbed. The dialog's field <label>s are not associated
 * with their controls (finding A9), so fields are reached through the label's
 * wrapper rather than getByLabelText.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, render, within } from '@testing-library/react';
import useSWR, { SWRConfig } from 'swr';
import { swrConfig } from '@/lib/swr-config';
import { renderPage, mockApi, type MockRequest } from '@/test-utils/page-harness';
import { SuperAdminCycleEditDialog, revalidateCycleData } from '../super-admin-cycle-edit';

const DT = { dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'UTC' };
const USERS = { data: [{ id: 'u1', username: 'op1', fullName: 'Operator One' }, { id: 'u2', username: 'op2' }] };

const CYCLE = {
  id: 'c1', cycleCode: 'CC-0001', status: 'IN_PROGRESS', cleaningReasonLabel: 'PM',
  startedAt: '2026-09-05T08:00:00.000Z', completedAt: null, terminatedAt: null, terminationReason: null,
  dryerDurationMinutes: 90, dryerStartedAt: '2026-09-05T09:00:00.000Z',
};
const EVENTS = [
  {
    id: 'e1', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: '2026-09-05T08:00:00.000Z',
    performedBy: 'u1', remarks: '', attributes: {
      action: 'START_CYCLE',
      instrumentReadings: [
        { instrumentId: 'i1', description: 'RO Water Pressure', uom: 'bar', leastCount: 0.1, value: 2.5, source: 'MANUAL' },
        { instrumentId: 'i2', instrumentCode: 'CA-1', leastCount: 0.1, value: null },
      ],
    },
  },
  { id: 'e2', eventType: 'STAGE_APPROVED', performedAt: '2026-09-05T08:40:00.000Z', performedBy: 'ghost', performedByName: 'Former User', remarks: 'ok', attributes: {} },
  { id: 'e3', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'washin', performedAt: null, performedBy: null, remarks: null },
];

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupApi(gated: string[] = [], extra: Parameters<typeof mockApi>[0] = []) {
  return mockApi([
    ...extra, // first, so a test's route wins over the defaults below
    { path: '/api/config/datetime/current', body: DT },
    { path: '/api/config/action-reauth/my-actions', body: { actions: gated } },
    { path: '/api/users', body: USERS },
    { method: 'PUT', path: '/api/super-admin/data/cleaning-cycles/c1', body: { ok: true } },
    { method: 'PUT', path: /\/api\/super-admin\/data\/filter-events\//, body: { ok: true } },
  ]);
}
async function settle(api: ReturnType<typeof mockApi>) {
  await waitFor(() => expect(api.calls('GET', '/api/users')).toHaveLength(1));
  await waitFor(() => expect(api.calls('GET', '/api/config/datetime/current')).toHaveLength(1));
  await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions')).toHaveLength(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
function open(over: Partial<Parameters<typeof SuperAdminCycleEditDialog>[0]> = {}, api = setupApi()) {
  const props = { cycle: CYCLE as any, events: EVENTS, title: 'Edit cleaning record - F-1', onClose: vi.fn(), onSaved: vi.fn(), ...over };
  renderPage(<SuperAdminCycleEditDialog {...props} />, { api, user: { role: 'SUPER_ADMIN' } });
  return { api, props };
}

/** The control in the same wrapper as the label with this exact text. */
function field(label: string | RegExp, scope: HTMLElement = document.body) {
  const lbl = within(scope).getAllByText(label, { selector: 'label' })[0];
  return lbl.parentElement!.querySelector('input, select, textarea') as HTMLInputElement & HTMLSelectElement;
}
const card = (heading: RegExp) => screen.getByText(heading).closest('div.border') as HTMLElement;
const reason = () => screen.getByLabelText(/Reason for this change/);
const save = () => screen.getByRole('button', { name: 'Save changes' });

describe('rendering', () => {
  it('seeds the cycle section (times in the configured zone) and names the cycle', async () => {
    const { api } = open();
    await settle(api);
    expect(screen.getByRole('dialog', { name: 'Edit cleaning record - F-1' })).toBeInTheDocument();
    expect(screen.getByText('Cycle · CC-0001')).toBeInTheDocument();
    expect(field('Status')).toHaveValue('IN_PROGRESS');
    expect([...field('Status').options].map((o) => o.textContent)).toEqual(['IN PROGRESS', 'COMPLETED', 'TERMINATED']);
    expect(field('Cleaning reason')).toHaveValue('PM');
    expect(field('Started at')).toHaveValue('2026-09-05T08:00');
    expect(field('Completed at')).toHaveValue('');
    expect(field('Dryer duration (min)')).toHaveValue(90);
    expect(field('Dryer started at')).toHaveValue('2026-09-05T09:00');
    expect(screen.getByText('Nothing changed yet')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('keeps an unknown stored status selectable instead of silently replacing it', async () => {
    const { api } = open({ cycle: { ...CYCLE, status: 'LEGACY_STATE', cycleCode: null } as any });
    await settle(api);
    expect(field('Status')).toHaveValue('LEGACY_STATE');
    expect(screen.getByText(/^Cycle\s*$/)).toBeInTheDocument();
  });

  it('heads each event by its transition (or type), shows the action badge, and lists every stage state', async () => {
    const { api } = open();
    await settle(api);
    expect(screen.getByText('Stage events (3)')).toBeInTheDocument();
    const e1 = card(/#1 start → WASH IN/);
    expect(within(e1).getByText('START CYCLE')).toBeInTheDocument();
    expect(field('From', e1)).toHaveValue('');
    expect([...field('From', e1).options][0].textContent).toBe('(start)');
    expect(field('To', e1)).toHaveValue('WASH_IN');
    expect([...field('To', e1).options][0].textContent).toBe('-');
    // Non-transition events have no From/To.
    const e2 = card(/#2 STAGE APPROVED/);
    expect(within(e2).queryByText('From', { selector: 'label' })).toBeNull();
    // A legacy free-text state (washin) stays selectable on its own row.
    const e3 = card(/#3 WASH IN → washin/);
    expect(field('To', e3)).toHaveValue('washin');
    expect([...field('To', e3).options].map((o) => o.value)).toContain('washin');
  });

  it('performed-by picker: users from /api/users, a departed performer kept by name, blank → "keep current"', async () => {
    const { api } = open();
    await settle(api);
    const pick1 = field('Performed by', card(/#1 start/));
    expect(pick1).toHaveValue('u1');
    expect([...pick1.options].map((o) => o.textContent)).toEqual(['Operator One (op1)', 'op2 (op2)']);
    const pick2 = field('Performed by', card(/#2 STAGE APPROVED/));
    expect(pick2).toHaveValue('ghost');
    expect(pick2.options[0].textContent).toBe('Former User');
    const pick3 = field('Performed by', card(/#3 WASH IN/));
    expect(pick3).toHaveValue('');
    expect(pick3.options[0].textContent).toBe('-- keep current --');
  });

  it('labels each reading by description / code with its unit and source', async () => {
    const { api } = open();
    await settle(api);
    const e1 = card(/#1 start/);
    expect(field('RO Water Pressure (bar) · manual', e1)).toHaveValue(2.5);
    expect(field('CA-1', e1)).toHaveValue(null);
  });

  // Finding A9 (defects-dialogs.md): the cycle / event fields have no programmatic label.
  // The assertions pinning that defect were removed so a fix does not turn this red;
  // the correctly-labelled change-reason box is still checked.
  it('the change-reason box is reachable by its label', async () => {
    const { api } = open();
    await settle(api);
    expect(reason()).toBeInTheDocument();
  });

  it('a manual status update (no cycle row) shows only the events; no events says so', async () => {
    const { api } = open({ cycle: null, events: [] });
    await settle(api);
    expect(screen.queryByText(/^Cycle/)).toBeNull();
    expect(screen.getByText('This record has no stage events.')).toBeInTheDocument();
  });

  it('falls back to "Reading" for an anonymous reading and "event" for an untyped event', async () => {
    const { api } = open({ cycle: null, events: [{ id: 'x', attributes: { instrumentReadings: [{ value: 1 }] } }] });
    await settle(api);
    expect(screen.getByText('#1 event')).toBeInTheDocument();
    expect(field('Reading')).toHaveValue(1);
  });
});

describe('saving', () => {
  it('sends only changed cycle fields (ISO, numbers, nulls) and only changed events, each with the reason', async () => {
    const { api, props } = open();
    await settle(api);
    fireEvent.change(field('Status'), { target: { value: 'COMPLETED' } });
    fireEvent.change(field('Completed at'), { target: { value: '2026-09-05T11:15' } });
    fireEvent.change(field('Dryer started at'), { target: { value: '' } });
    fireEvent.change(field('Dryer duration (min)'), { target: { value: '' } });
    const e1 = card(/#1 start/);
    fireEvent.change(field('RO Water Pressure (bar) · manual', e1), { target: { value: '3.1' } });
    fireEvent.change(field('Remarks', e1), { target: { value: 'gauge re-read' } });
    const e3 = card(/#3 WASH IN/);
    fireEvent.change(field('To', e3), { target: { value: 'WASH_OUT' } });
    fireEvent.change(field('Performed by', e3), { target: { value: 'u2' } });
    fireEvent.change(field('Performed at', e3), { target: { value: '2026-09-05T08:50' } });
    expect(screen.getByText('6 change(s) ready')).toBeInTheDocument(); // 4 cycle fields + 2 events
    expect(save()).toBeDisabled(); // no reason yet
    fireEvent.change(reason(), { target: { value: '  Logbook correction  ' } });
    fireEvent.click(save());
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
    expect(props.onSaved).toHaveBeenCalledTimes(1);

    expect(api.calls('PUT', '/api/super-admin/data/cleaning-cycles/c1')[0].json).toEqual({
      status: 'COMPLETED', completedAt: '2026-09-05T11:15:00.000Z', dryerStartedAt: null, dryerDurationMinutes: null,
      _changeReason: 'Logbook correction',
    });
    expect(api.calls('PUT', '/api/super-admin/data/filter-events/e1')[0].json).toEqual({
      remarks: 'gauge re-read',
      attributes: { instrumentReadings: [
        { instrumentId: 'i1', description: 'RO Water Pressure', uom: 'bar', leastCount: 0.1, value: 3.1, source: 'MANUAL' },
        { instrumentId: 'i2', instrumentCode: 'CA-1', leastCount: 0.1, value: null },
      ] },
      _changeReason: 'Logbook correction',
    });
    expect(api.calls('PUT', '/api/super-admin/data/filter-events/e3')[0].json).toEqual({
      toState: 'WASH_OUT', performedBy: 'u2', performedAt: '2026-09-05T08:50:00.000Z', _changeReason: 'Logbook correction',
    });
    expect(api.calls('PUT', '/api/super-admin/data/filter-events/e2')).toHaveLength(0);
    // The cycle is written before its events.
    const order = api.requests.filter((r) => r.method === 'PUT').map((r) => r.path);
    expect(order[0]).toBe('/api/super-admin/data/cleaning-cycles/c1');
  });

  it('terminating by hand: start / terminate times and the termination reason all reach the cycle PUT', async () => {
    const { api } = open();
    await settle(api);
    fireEvent.change(field('Status'), { target: { value: 'TERMINATED' } });
    fireEvent.change(field('Started at'), { target: { value: '2026-09-05T07:55' } });
    fireEvent.change(field('Terminated at'), { target: { value: '2026-09-05T10:00' } });
    fireEvent.change(field('Termination reason'), { target: { value: 'Filter torn' } });
    fireEvent.change(field('Dryer duration (min)'), { target: { value: '45' } });
    fireEvent.change(reason(), { target: { value: 'operator terminated on paper' } });
    fireEvent.click(save());
    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/data/cleaning-cycles/c1')).toHaveLength(1));
    expect(api.calls('PUT', '/api/super-admin/data/cleaning-cycles/c1')[0].json).toEqual({
      status: 'TERMINATED', startedAt: '2026-09-05T07:55:00.000Z', terminatedAt: '2026-09-05T10:00:00.000Z',
      terminationReason: 'Filter torn', dryerDurationMinutes: 45, _changeReason: 'operator terminated on paper',
    });
    expect(api.calls('PUT', /filter-events/)).toHaveLength(0);
  });

  it('clearing a state sends null; a cleared time / performer / non-numeric reading is ignored, not sent', async () => {
    const { api } = open({ cycle: null });
    await settle(api);
    const e1 = card(/#1 start/);
    fireEvent.change(field('To', e1), { target: { value: '' } });
    fireEvent.change(field('Performed at', e1), { target: { value: '' } });
    fireEvent.change(field('RO Water Pressure (bar) · manual', e1), { target: { value: '' } });
    const e3 = card(/#3 WASH IN/);
    fireEvent.change(field('From', e3), { target: { value: '' } });
    fireEvent.change(reason(), { target: { value: 'state cleanup' } });
    fireEvent.click(save());
    await waitFor(() => expect(api.calls('PUT', '/api/super-admin/data/filter-events/e3')).toHaveLength(1));
    expect(api.calls('PUT', '/api/super-admin/data/filter-events/e1')[0].json).toEqual({ toState: null, _changeReason: 'state cleanup' });
    expect(api.calls('PUT', '/api/super-admin/data/filter-events/e3')[0].json).toEqual({ fromState: null, _changeReason: 'state cleanup' });
    expect(api.calls('PUT', /cleaning-cycles/)).toHaveLength(0);
  });

  it('editing a reading back to its stored value is not a change', async () => {
    const { api } = open();
    await settle(api);
    const ro = field('RO Water Pressure (bar) · manual', card(/#1 start/));
    fireEvent.change(ro, { target: { value: '9' } });
    expect(screen.getByText('1 change(s) ready')).toBeInTheDocument();
    fireEvent.change(ro, { target: { value: '2.5' } });
    expect(screen.getByText('Nothing changed yet')).toBeInTheDocument();
  });

  it('with re-auth on, ONE password signs every PUT', async () => {
    const api = setupApi(['SUPER_ADMIN_DATA_EDIT']);
    open({}, api);
    await settle(api);
    fireEvent.change(field('Cleaning reason'), { target: { value: 'Breakdown' } });
    fireEvent.change(field('Remarks', card(/#2 STAGE APPROVED/)), { target: { value: 'fixed' } });
    fireEvent.change(reason(), { target: { value: 'wrong reason picked' } });
    fireEvent.click(save());
    expect(await screen.findByText(/Performing "Edit cleaning record - F-1" requires/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify & Continue' }));
    await waitFor(() => expect(api.calls('PUT', /filter-events\/e2/)).toHaveLength(1));
    const puts = api.requests.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.headers['x-reauth-password'])).toEqual(['pw', 'pw']);
    expect(puts.map((r) => r.json._currentPassword)).toEqual(['pw', 'pw']);
  });

  it('cancelling the password prompt leaves the dialog editable and writes nothing', async () => {
    const api = setupApi(['SUPER_ADMIN_DATA_EDIT']);
    const { props } = open({}, api);
    await settle(api);
    fireEvent.change(field('Cleaning reason'), { target: { value: 'Breakdown' } });
    fireEvent.change(reason(), { target: { value: 'wrong reason picked' } });
    fireEvent.click(save());
    await screen.findByText(/requires identity verification/);
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
    await waitFor(() => expect(save()).toBeEnabled());
    expect(api.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('shows the server refusal (or "Save failed") and stays open', async () => {
    const api = setupApi([], [{ method: 'PUT', path: '/api/super-admin/data/cleaning-cycles/c1', status: 409, body: { error: 'X', message: 'Cycle is locked' }, times: 1 }]);
    const { props } = open({}, api);
    await settle(api);
    fireEvent.change(field('Cleaning reason'), { target: { value: 'Breakdown' } });
    fireEvent.change(reason(), { target: { value: 'wrong reason picked' } });
    fireEvent.click(save());
    expect(await screen.findByText('Cycle is locked')).toBeInTheDocument();
    expect(save()).toBeEnabled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('a failure with no message reads "Save failed"', async () => {
    const { api } = open();
    await settle(api);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') throw {};
      return new Response('{}', { status: 200 });
    }));
    fireEvent.change(field('Cleaning reason'), { target: { value: 'Breakdown' } });
    fireEvent.change(reason(), { target: { value: 'wrong reason picked' } });
    fireEvent.click(save());
    expect(await screen.findByText('Save failed')).toBeInTheDocument();
  });

  it('shows "Saving..." while in flight, and Close / Cancel close without saving', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = setupApi([], [{ method: 'PUT', path: '/api/super-admin/data/cleaning-cycles/c1', body: (_req: MockRequest) => ({ ok: true }) }]);
    const { props } = open({}, api);
    await settle(api);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);

    const harness = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (i: RequestInfo | URL, init?: RequestInit) => { if (init?.method === 'PUT') await gate; return harness(i, init); }));
    fireEvent.change(field('Cleaning reason'), { target: { value: 'Breakdown' } });
    fireEvent.change(reason(), { target: { value: 'wrong reason picked' } });
    fireEvent.click(save());
    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(reason()).toBeDisabled();
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });
});

describe('revalidateCycleData', () => {
  it('refetches every cycle / event / hierarchy / dashboard view, and nothing else', async () => {
    // Global mutate reaches SWR's default cache (as in main.tsx), so no private provider here.
    const keys = [
      '/api/filters/cycles?rcd=1', '/api/filters/cleaning-record?rcd=1', '/api/filters/events?rcd=1',
      '/api/filters/manual-status-changes?rcd=1', '/api/hierarchy/tree?rcd=1', '/api/assets/instances?rcd=1',
      '/api/dashboards/stats?rcd=1', '/api/users?rcd=1',
    ];
    const api = mockApi([{ path: /.*/, body: {} }]);
    function Readers() {
      for (const k of keys) useSWR(k); // eslint-disable-line react-hooks/rules-of-hooks
      return null;
    }
    render(<SWRConfig value={{ ...swrConfig, dedupingInterval: 0, revalidateOnFocus: false }}><Readers /></SWRConfig>);
    await waitFor(() => expect(api.requests).toHaveLength(keys.length));
    await act(async () => { revalidateCycleData(); await new Promise((r) => setTimeout(r, 20)); });
    const counts = Object.fromEntries(keys.map((k) => [k, api.requests.filter((r) => r.url === k).length]));
    for (const k of keys.slice(0, 7)) expect(counts[k]).toBe(2);
    expect(counts['/api/users?rcd=1']).toBe(1);
  });
});
