import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { resetEnv, signReauth, cancelReauth, ackMessage, reauthRequired } from './config-test-helpers';
import { renderFdm, modal, field, setField, typeReason, click, row, waitForCalls, openTab } from './fdm-helpers';

// Page flows run several real round trips; under full-suite load one took 5.3 s,
// past the 5 s default (2026-10-22). Same limit as the other heavy page suites.
vi.setConfig({ testTimeout: 20_000 });

afterEach(resetEnv);

const CYCLES = '/api/filters/cycles';
const SA_CYCLES = '/api/super-admin/data/cleaning-cycles';
const SA_EVENTS = '/api/super-admin/data/filter-events';

const RO = { instrumentId: 'i-ro', description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 };
const AIR = { instrumentId: 'i-air', description: 'Compressed Air Pressure', value: 6, uom: 'bar' };
const DRY = { instrumentId: 'i-dry', description: 'Dryer Temperature', value: 80, uom: '°C', leastCount: 1 };

const C1 = {
  id: 'c1', cycleCode: 'CYC-001', filterId: 'f1', filterName: 'FLT-100', status: 'COMPLETED', manualEntry: true,
  startedAt: '2026-07-01T08:00:00.000Z', completedAt: '2026-07-01T09:30:00.000Z',
  cleaningReasonLabel: 'PM', sequenceNumber: 3, dryerDurationMinutes: 45, dryerStartedAt: '2026-07-01T08:40:00.000Z',
  terminatedAt: null, terminationReason: null,
  events: [
    // Deliberately out of order: the lifecycle panel sorts by performedAt.
    { id: 'e5', eventType: 'STATE_TRANSITION', fromState: 'DRY_IN', toState: 'DRY_OUT', performedAt: '2026-07-01T09:30:00.000Z', performedByName: 'Op Three', attributes: {} },
    { id: 'e1', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: '2026-07-01T08:05:00.000Z', performedByName: 'Op One', performedBy: 'user-0001-xxxx', attributes: { instrumentReadings: [RO, AIR] }, remarks: 'start', manualEntry: true },
    { id: 'e2', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: '2026-07-01T08:20:00.000Z', performedBy: 'abcdef1234567890', attributes: {} },
    { id: 'e3', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: '2026-07-01T08:40:00.000Z', performedByName: 'Op Two', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 45 } },
    { id: 'e4', eventType: 'STATE_TRANSITION', fromState: 'DRY_IN', toState: 'DRY_IN', performedAt: '2026-07-01T09:25:00.000Z', performedByName: 'Op Two', attributes: { instrumentReadings: [DRY] } },
  ],
};
// In progress, no events, filter not in the hierarchy map.
const C2 = { id: 'c2', cycleCode: 'CYC-002', filterId: 'f-missing', filterName: 'FLT-200', status: 'IN_PROGRESS', startedAt: new Date(Date.now() - 2 * 3600_000 - 5 * 60_000).toISOString(), completedAt: null, events: [] };
// Unknown status, no completion, wash-out only, dry-out readings on "temperature".
const C3 = {
  id: 'c3', cycleCode: null, filterId: 'f2', filterName: 'FLT-300', status: 'RETIRED', startedAt: '2026-07-02T08:00:00.000Z', completedAt: null,
  events: [
    { id: 'e31', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: '2026-07-02T08:10:00.000Z', performedBy: '9999aaaa-bbbb', attributes: {} },
    { id: 'e32', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: '2026-07-02T08:20:00.000Z', attributes: {} },
    { id: 'e33', eventType: 'STATE_TRANSITION', fromState: 'DRY_IN', toState: 'DRY_OUT', performedAt: '2026-07-02T09:00:00.000Z', attributes: { instrumentReadings: [{ description: 'Outlet temperature', value: 41 }] } },
  ],
};
// Short cycle (< 60 min) with a terminated status.
const C4 = { id: 'c4', cycleCode: 'CYC-004', filterId: 'f2', filterName: 'FLT-400', status: 'TERMINATED', startedAt: '2026-07-03T08:00:00.000Z', completedAt: '2026-07-03T08:25:00.000Z' };

const HIER = { data: [{ id: 'f1', name: 'FLT-100', attributes: { micronSize: '10 µm' } }, { id: 'f2', name: 'FLT-300' }] };

function cycleRoutes(over: { cycles?: unknown[]; total?: number } = {}) {
  return [
    { path: CYCLES, body: (req: any) => ({ data: over.cycles ?? [C1, C2, C3, C4], total: over.total ?? (over.cycles ?? [C1, C2, C3, C4]).length, _q: req.url }) },
    { path: '/api/hierarchy/filters', body: HIER },
  ];
}

describe('Cleaning Cycles tab — list', () => {
  it('requests the cycles feed with events, renders the derived columns exactly like the Cleaning Record page', async () => {
    const api = renderFdm(cycleRoutes());
    await openTab('Cleaning Cycles');
    const r1 = await screen.findByText('FLT-100').then((el) => el.closest('tr') as HTMLElement);
    const read = api.calls('GET', CYCLES)[0];
    expect(read.query.get('page')).toBe('1');
    expect(read.query.get('limit')).toBe('20');
    expect(read.query.get('includeEvents')).toBe('true');
    expect(read.query.has('status')).toBe(false);
    expect(read.query.has('from')).toBe(false);

    const cells = within(r1).getAllByRole('cell').map((c) => c.textContent);
    // S.No, Filter(+manual badge), Micron, Air, RO, Wash In, Wash Out, Wash By, Dryer Temp, Dry In, Dry Out, Dry By, Duration, Status
    expect(cells.slice(0, 14)).toEqual([
      '1', 'FLT-100Manual entry', '10 µm', '6 bar', '2.5 bar', '2026-07-01 08:05', '2026-07-01 08:20', 'Op One',
      '80 °C', '2026-07-01 09:25', '2026-07-01 09:30', 'Op Two', '1h 30m', 'Completed',
    ]);
    const r2 = row('FLT-200');
    const c2 = within(r2).getAllByRole('cell').map((c) => c.textContent);
    expect(c2[2]).toBe('-'); // filter missing from the hierarchy map
    expect(c2[3]).toBe('-');
    expect(c2[12]).toMatch(/^2h \d+m$/); // in progress -> measured to now
    expect(c2[13]).toBe('In Progress');
    const c3 = within(row('FLT-300')).getAllByRole('cell').map((c) => c.textContent);
    expect(c3[2]).toBe('-'); // f2 has no attributes
    expect(c3[7]).toBe('9999aaaa'); // Wash By falls back to the wash-out performer id prefix
    expect(c3[8]).toBe('41'); // dry-in has no readings -> dry-out "temperature" reading, no uom
    expect(c3[9]).toBe('-'); // DRY_IN needs readings to count as the dry-in time
    expect(c3[11]).toBe('-'); // no dry performer name or id
    expect(c3[12]).toBe('-'); // not in progress, no completion
    expect(c3[13]).toBe('RETIRED'); // unknown status renders its raw value
    const c4 = within(row('FLT-400')).getAllByRole('cell').map((c) => c.textContent);
    expect(c4[12]).toBe('25m');
    expect(c4[13]).toBe('Terminated');
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('4');
    expect(api.unmatched).toEqual([]);
  });

  it('status filter, date range and paging all go to the server', async () => {
    const api = renderFdm(cycleRoutes({ total: 45 }));
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    const statusSelect = screen.getByText('Status', { selector: 'span' }).closest('label')!.querySelector('select')!;
    expect(Array.from(statusSelect.options).map((o) => o.textContent)).toEqual(['All', 'In Progress', 'Completed', 'Terminated', 'Retired', 'Replaced']);
    fireEvent.change(statusSelect, { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(api.calls('GET', CYCLES).some((c) => c.query.get('status') === 'COMPLETED')).toBe(true));

    // A bare date is widened to a local-midnight / end-of-day instant (the endpoint is format: date-time).
    fireEvent.change(screen.getByLabelText('Records from date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Records to date'), { target: { value: '2026-07-31' } });
    await waitFor(() => {
      const last = api.calls('GET', CYCLES).at(-1)!;
      expect(last.query.get('from')).toBe(new Date('2026-07-01T00:00:00.000').toISOString());
      expect(last.query.get('to')).toBe(new Date('2026-07-31T23:59:59.999').toISOString());
      expect(last.query.get('status')).toBe('COMPLETED');
    });

    // Server total 45 -> pages; page 2 is requested from the server.
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('45');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(api.calls('GET', CYCLES).at(-1)!.query.get('page')).toBe('2'));
    // Changing the page size returns to page 1 with the new limit.
    fireEvent.change(screen.getByDisplayValue('20'), { target: { value: '5' } });
    await waitFor(() => {
      const last = api.calls('GET', CYCLES).at(-1)!;
      expect(last.query.get('limit')).toBe('5');
      expect(last.query.get('page')).toBe('1');
    });
    // A filter change resets to page 1.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => expect(api.calls('GET', CYCLES).at(-1)!.query.get('page')).toBe('2'));
    fireEvent.change(statusSelect, { target: { value: '' } });
    await waitFor(() => {
      const last = api.calls('GET', CYCLES).at(-1)!;
      expect(last.query.get('page')).toBe('1');
      expect(last.query.has('status')).toBe(false);
    });
  });

  it('search filters the loaded page by filter name or cycle code; empty states', async () => {
    renderFdm(cycleRoutes());
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'cyc-004' } });
    expect(screen.getByText('FLT-400')).toBeInTheDocument();
    expect(screen.queryByText('FLT-100')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'nothing-here' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('shows "No cleaning cycles" for an empty feed, and falls back to the array length with no total', async () => {
    renderFdm([{ path: CYCLES, body: { data: [] } }, { path: '/api/hierarchy/filters', body: { data: [] } }]);
    await openTab('Cleaning Cycles');
    expect(await screen.findByText('No cleaning cycles')).toBeInTheDocument();
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('0');
  });

  it('a failed cycles load shows the empty table and a non-blocking load error', async () => {
    renderFdm([{ path: CYCLES, status: 500, body: { error: 'INTERNAL', message: 'cycles exploded' } }, { path: '/api/hierarchy/filters', body: HIER }]);
    await openTab('Cleaning Cycles');
    expect(await screen.findByText('cycles exploded')).toBeInTheDocument();
    expect(screen.getByText('No cleaning cycles')).toBeInTheDocument();
  });
});

describe('Cleaning Cycles tab — lifecycle expander', () => {
  it('shows the cycle\'s own stage history in time order with readings, and collapses again', async () => {
    const api = renderFdm(cycleRoutes());
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    const before = api.requests.length;
    const toggle = within(row('FLT-100')).getByRole('button', { name: /Lifecycle/ });
    expect(toggle).toHaveTextContent('(5)');
    await click(toggle);
    const panel = screen.getByText('Lifecycle · CYC-001').closest('div.rounded-xl') as HTMLElement;
    expect(within(panel).getByText('5 steps')).toBeInTheDocument();
    const steps = Array.from(panel.querySelectorAll('.divide-y > div')).map((d) => d.textContent ?? '');
    expect(steps).toHaveLength(5);
    expect(steps[0]).toMatch(/^1STATE_TRANSITION— → WASH_INManual entry2026-07-01 08:05by Op One“start”RO Water Pressure: 2.5 barCompressed Air Pressure: 6 bar/);
    expect(steps[1]).toMatch(/^2STATE_TRANSITIONWASH_IN → WASH_OUT2026-07-01 08:20EditDelete$/);
    expect(steps[3]).toContain('Dryer Temperature: 80 °C');
    expect(steps[4]).toMatch(/^5STATE_TRANSITIONDRY_IN → DRY_OUT/);
    // No extra request: the events came with the cycles feed.
    expect(api.requests.length).toBe(before);
    await click(toggle);
    expect(screen.queryByText('Lifecycle · CYC-001')).toBeNull();
  });

  it('a cycle with no events says so; a cycle with no code is labelled by filter; a single step is singular', async () => {
    const one = { ...C3, events: [C3.events[0]] };
    renderFdm(cycleRoutes({ cycles: [C2, one] }));
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-200');
    await click(within(row('FLT-200')).getByRole('button', { name: /Lifecycle/ }));
    expect(screen.getByText('This cycle has no recorded stage events yet.')).toBeInTheDocument();
    await click(within(row('FLT-300')).getByRole('button', { name: /Lifecycle/ }));
    // Only one panel open at a time.
    expect(screen.queryByText('This cycle has no recorded stage events yet.')).toBeNull();
    expect(screen.getByText('Lifecycle · FLT-300')).toBeInTheDocument();
    expect(screen.getByText('1 step')).toBeInTheDocument();
  });

  it('a step with neither from nor to state shows no transition line', async () => {
    const bare = { ...C2, events: [{ id: 'eb', eventType: 'REMARK_ADDED', performedAt: '2026-07-01T08:00:00.000Z', attributes: null }] };
    renderFdm(cycleRoutes({ cycles: [bare] }));
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-200');
    await click(within(row('FLT-200')).getByRole('button', { name: /Lifecycle/ }));
    const panel = screen.getByText('Lifecycle · CYC-002').closest('div.rounded-xl') as HTMLElement;
    expect(panel).toHaveTextContent('REMARK_ADDED');
    expect(panel.textContent).not.toContain('→');
  });

  it('deleting a lifecycle step targets the FILTER EVENT endpoint, not the cycle (F-02)', async () => {
    const api = renderFdm([...cycleRoutes(), { method: 'DELETE', path: `${SA_EVENTS}/e2`, body: {} }]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Lifecycle/ }));
    const panel = screen.getByText('Lifecycle · CYC-001').closest('div.rounded-xl') as HTMLElement;
    const step2 = Array.from(panel.querySelectorAll('.divide-y > div'))[1] as HTMLElement;
    await click(within(step2).getByRole('button', { name: 'Delete' }));
    const dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('STATE_TRANSITION (CYC-001) will be permanently removed');
    typeReason(dlg, 'Duplicate scan');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    const [del] = await waitForCalls(api, 'DELETE', `${SA_EVENTS}/e2`, 1);
    expect(del.json).toEqual({ _changeReason: 'Duplicate scan' });
    expect(api.calls('DELETE', /cleaning-cycles/)).toHaveLength(0);
    expect(await ackMessage('Deleted')).toContain('Record removed and audited');
  });

  it('a step with no cycle code is labelled "cycle" in the delete confirmation', async () => {
    renderFdm(cycleRoutes({ cycles: [C3] }));
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-300');
    await click(within(row('FLT-300')).getByRole('button', { name: /Lifecycle/ }));
    const panel = screen.getByText('Lifecycle · FLT-300').closest('div.rounded-xl') as HTMLElement;
    await click(within(panel).getAllByRole('button', { name: 'Delete' })[0]);
    expect(modal('Permanent Deletion')).toHaveTextContent('STATE_TRANSITION (cycle) will be permanently removed');
  });
});

describe('Cleaning Cycles tab — edit a cycle', () => {
  it('opens with the cycle\'s own columns and every reading grouped by its stage', async () => {
    renderFdm(cycleRoutes());
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    expect(dlg).toHaveTextContent('CYC-001');
    expect(field(dlg, 'Cycle Code').value).toBe('CYC-001');
    expect(field(dlg, 'Status').value).toBe('COMPLETED');
    expect(field(dlg, 'Cleaning Reason').value).toBe('PM');
    expect(field(dlg, 'Sequence Number').value).toBe('3');
    expect(field(dlg, 'Started At').value).toBe('2026-07-01T08:00');
    expect(field(dlg, 'Completed At').value).toBe('2026-07-01T09:30');
    expect(field(dlg, 'Terminated At').value).toBe('');
    expect(field(dlg, 'Dryer Duration (min)').value).toBe('45');
    expect(field(dlg, 'Dryer Started At').value).toBe('2026-07-01T08:40');
    // Readings: WASH_IN group (two) then DRY_IN group (one), values only.
    expect(dlg).toHaveTextContent('Instrument readings');
    expect(field(dlg, 'RO Water Pressure (bar)').value).toBe('2.5');
    expect(field(dlg, 'Compressed Air Pressure (bar)').value).toBe('6');
    expect(field(dlg, 'Dryer Temperature (°C)').value).toBe('80');
    expect(within(dlg).getByText('WASH_IN')).toBeInTheDocument();
    expect(within(dlg).getByText('DRY_IN')).toBeInTheDocument();
    // No checksum or instrument-identity fields.
    expect(dlg).not.toHaveTextContent('Checksum');
    // Save needs a reason.
    expect(within(dlg).getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  });

  it('saves the cycle columns, then writes each CHANGED reading to the event that owns it (value only)', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      { method: 'PUT', path: `${SA_CYCLES}/c1`, body: {} },
      { method: 'PUT', path: `${SA_EVENTS}/e1`, body: {} },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    setField(dlg, 'Status', 'TERMINATED');
    setField(dlg, 'Sequence Number', '');
    setField(dlg, 'Dryer Duration (min)', '50');
    setField(dlg, 'Terminated At', '2026-07-01T09:31');
    setField(dlg, 'Termination Reason', 'Operator error');
    setField(dlg, 'RO Water Pressure (bar)', '2.7');
    // Compressed air cleared -> left as stored; dryer temp untouched -> no write for e4.
    setField(dlg, 'Compressed Air Pressure (bar)', '');
    typeReason(dlg, 'RO gauge misread');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_CYCLES}/c1`, 1);
    expect(put.json).toEqual({
      cycleCode: 'CYC-001', status: 'TERMINATED', cleaningReasonLabel: 'PM',
      startedAt: '2026-07-01T08:00:00.000Z', completedAt: '2026-07-01T09:30:00.000Z', terminatedAt: '2026-07-01T09:31:00.000Z',
      terminationReason: 'Operator error', dryerDurationMinutes: 50, dryerStartedAt: '2026-07-01T08:40:00.000Z',
      _changeReason: 'RO gauge misread',
    });
    const [ev] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/e1`, 1);
    expect(ev.json).toEqual({ attributes: { instrumentReadings: [{ ...RO, value: 2.7 }, AIR] }, _changeReason: 'RO gauge misread' });
    expect(api.calls('PUT', `${SA_EVENTS}/e4`)).toHaveLength(0);
    expect(await ackMessage('Updated')).toContain('Cycle updated and audited');
    expect(screen.queryByRole('heading', { name: 'Edit Cleaning Cycle' })).toBeNull();
  });

  it('a cycle with no readings shows no readings block and makes no event writes', async () => {
    const api = renderFdm([...cycleRoutes({ cycles: [C4] }), { method: 'PUT', path: `${SA_CYCLES}/c4`, body: {} }]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-400');
    await click(within(row('FLT-400')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    expect(dlg).not.toHaveTextContent('Instrument readings');
    expect(field(dlg, 'Cleaning Reason').value).toBe('');
    typeReason(dlg, 'No changes, re-audit');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_CYCLES}/c4`, 1);
    expect(put.json).toEqual({
      cycleCode: 'CYC-004', status: 'TERMINATED', startedAt: '2026-07-03T08:00:00.000Z', completedAt: '2026-07-03T08:25:00.000Z',
      _changeReason: 'No changes, re-audit',
    });
    await ackMessage('Updated');
    expect(api.calls('PUT', new RegExp(SA_EVENTS))).toHaveLength(0);
  });

  it('a cycle with no code is titled by its filter; missing status defaults to IN_PROGRESS', async () => {
    const noStatus = { ...C3, status: undefined };
    renderFdm(cycleRoutes({ cycles: [noStatus] }));
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-300');
    await click(within(row('FLT-300')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    expect(dlg).toHaveTextContent('FLT-300');
    expect(field(dlg, 'Status').value).toBe('IN_PROGRESS');
    expect(field(dlg, 'Outlet temperature').value).toBe('41');
    expect(within(dlg).getByText('DRY_OUT')).toBeInTheDocument();
  });

  it('the server asking for a signature mid-save: the password reaches the cycle and the reading write', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      reauthRequired('PUT', `${SA_CYCLES}/c1`),
      { method: 'PUT', path: `${SA_CYCLES}/c1`, body: {} },
      { method: 'PUT', path: `${SA_EVENTS}/e4`, body: {} },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    setField(dlg, 'Dryer Temperature (°C)', '82');
    typeReason(dlg, 'Dryer probe recalibrated');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await signReauth('pw-cyc');
    const puts = await waitForCalls(api, 'PUT', `${SA_CYCLES}/c1`, 2);
    expect(puts[1].headers['x-reauth-password']).toBe('pw-cyc');
    const [ev] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/e4`, 1);
    expect(ev.json.attributes).toEqual({ instrumentReadings: [{ ...DRY, value: 82 }] });
    await ackMessage('Updated');
  });

  it('signature required up front: both the cycle and its reading write are signed', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      { method: 'PUT', path: `${SA_CYCLES}/c1`, body: {} },
      { method: 'PUT', path: `${SA_EVENTS}/e4`, body: {} },
    ], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    const dlg = modal('Edit Cleaning Cycle');
    setField(dlg, 'Dryer Temperature (°C)', '82');
    typeReason(dlg, 'Dryer probe recalibrated');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await signReauth('pw-1');
    await waitForCalls(api, 'PUT', `${SA_CYCLES}/c1`, 1);
    // The reading write asks again (each gated() call is its own signature).
    await signReauth('pw-2');
    const [ev] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/e4`, 1);
    expect(ev.headers['x-reauth-password']).toBe('pw-2');
    expect(ev.json).toMatchObject({ _changeReason: 'Dryer probe recalibrated', _currentPassword: 'pw-2' });
    await ackMessage('Updated');
  });

  it('cancelling the signature keeps the dialog open and re-enables Save; a refused save shows "Update failed"', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      { method: 'PUT', path: `${SA_CYCLES}/c1`, status: 409, body: { error: 'CONFLICT', message: 'Another in-progress cycle exists' } },
    ], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    let dlg = modal('Edit Cleaning Cycle');
    typeReason(dlg, 'Status correction');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await cancelReauth();
    dlg = modal('Edit Cleaning Cycle');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Save Changes' })).not.toBeDisabled());
    expect(api.calls('PUT', `${SA_CYCLES}/c1`)).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Update failed' })).toBeNull();

    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await signReauth('pw');
    expect(await ackMessage('Update failed')).toContain('Another in-progress cycle exists');
    expect(screen.getByRole('heading', { name: 'Edit Cleaning Cycle' })).toBeInTheDocument();
  });

  it('the close (X) and Cancel buttons discard the edit', async () => {
    const api = renderFdm(cycleRoutes());
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    let dlg = modal('Edit Cleaning Cycle');
    // The header X is the first button in the dialog.
    await click(within(dlg).getAllByRole('button')[0]);
    expect(screen.queryByRole('heading', { name: 'Edit Cleaning Cycle' })).toBeNull();
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    dlg = modal('Edit Cleaning Cycle');
    typeReason(dlg, 'abandon this');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit Cleaning Cycle' })).toBeNull();
    // Re-opening starts with an empty reason.
    await click(within(row('FLT-100')).getByRole('button', { name: /Edit/ }));
    expect(within(modal('Edit Cleaning Cycle')).getByRole('button', { name: 'Save Changes' })).toBeDisabled();
    expect(api.calls('PUT', /super-admin/)).toHaveLength(0);
  });
});

describe('Cleaning Cycles tab — delete a cycle', () => {
  it('Delete Forever needs a reason, sends DELETE with _changeReason, and Cancel aborts', async () => {
    const api = renderFdm([...cycleRoutes(), { method: 'DELETE', path: `${SA_CYCLES}/c4`, body: {} }]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-400');
    await click(within(row('FLT-400')).getByRole('button', { name: /Delete/ }));
    let dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('CYC-004 will be permanently removed');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Permanent Deletion' })).toBeNull();

    await click(within(row('FLT-400')).getByRole('button', { name: /Delete/ }));
    dlg = modal('Permanent Deletion');
    const go = within(dlg).getByRole('button', { name: 'Delete Forever' });
    expect(go).toBeDisabled();
    expect(go).toHaveAttribute('title', 'Enter a reason for this deletion');
    typeReason(dlg, 'abc');
    expect(go).toBeDisabled();
    typeReason(dlg, 'Test record');
    await click(go);
    const [del] = await waitForCalls(api, 'DELETE', `${SA_CYCLES}/c4`, 1);
    expect(del.json).toEqual({ _changeReason: 'Test record' });
    expect(await ackMessage('Deleted')).toContain('Record removed and audited');
    expect(screen.queryByRole('heading', { name: 'Permanent Deletion' })).toBeNull();
  });

  it('a cycle with no code is named by its filter; a refused delete shows the error and keeps the dialog', async () => {
    renderFdm([...cycleRoutes(), { method: 'DELETE', path: `${SA_CYCLES}/c3`, status: 403, body: { error: 'FORBIDDEN', message: 'Not allowed' } }]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-300');
    await click(within(row('FLT-300')).getByRole('button', { name: /Delete/ }));
    const dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('FLT-300 will be permanently removed');
    typeReason(dlg, 'Remove junk');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    expect(await ackMessage('Error')).toContain('Not allowed');
    expect(screen.getByRole('heading', { name: 'Permanent Deletion' })).toBeInTheDocument();
  });

  it('signed delete: the cancel path is silent and re-enables; the signed retry carries the password', async () => {
    const api = renderFdm([...cycleRoutes(), { method: 'DELETE', path: `${SA_CYCLES}/c4`, body: {} }], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-400');
    await click(within(row('FLT-400')).getByRole('button', { name: /Delete/ }));
    let dlg = modal('Permanent Deletion');
    typeReason(dlg, 'Test record');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    await cancelReauth();
    dlg = modal('Permanent Deletion');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Delete Forever' })).not.toBeDisabled());
    expect(screen.queryByRole('heading', { name: 'Error' })).toBeNull();
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    await signReauth('pw-del');
    const [del] = await waitForCalls(api, 'DELETE', `${SA_CYCLES}/c4`, 1);
    expect(del.headers['x-reauth-password']).toBe('pw-del');
    expect(del.json).toEqual({ _changeReason: 'Test record', _currentPassword: 'pw-del' });
  });
});

describe('Cleaning Cycles tab — create a cycle', () => {
  const PROFILES = { data: [{ id: 'pr1', name: 'Standard', version: 2 }, { id: 'pr2', name: 'Dry only' }] };

  it('picks filter + profile by name, defaults status to COMPLETED, coerces numbers and POSTs with the reason', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      { path: '/api/filter-cleaning-profiles', body: PROFILES },
      { method: 'POST', path: SA_CYCLES, body: { id: 'new' } },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Cleaning Cycle');
    expect(dlg).toHaveTextContent('New record — not written to the audit trail');
    await waitFor(() => expect(within(field(dlg, 'Cleaning Profile') as any).getByRole('option', { name: 'Standard (v2)' })).toBeInTheDocument());
    expect(within(field(dlg, 'Cleaning Profile') as any).getByRole('option', { name: 'Dry only' })).toBeInTheDocument();
    expect(within(field(dlg, 'Filter') as any).getByRole('option', { name: 'FLT-100' })).toBeInTheDocument();
    expect(field(dlg, 'Status').value).toBe('COMPLETED');
    expect(api.calls('GET', '/api/filter-cleaning-profiles')[0].query.get('limit')).toBe('1000000');
    setField(dlg, 'Filter', 'f1');
    setField(dlg, 'Cleaning Profile', 'pr1');
    setField(dlg, 'Cleaning Reason', 'Breakdown');
    setField(dlg, 'Sequence Number', '7');
    setField(dlg, 'Started At', '2026-06-01T07:00');
    setField(dlg, 'Completed At', '2026-06-01T08:00');
    setField(dlg, 'Dryer Duration (min)', '30');
    setField(dlg, 'Termination Reason', '');
    const create = within(dlg).getByRole('button', { name: 'Create Record' });
    expect(create).toBeDisabled();
    typeReason(dlg, 'Paper record backfill');
    await click(create);
    const [post] = await waitForCalls(api, 'POST', SA_CYCLES, 1);
    expect(post.json).toEqual({
      status: 'COMPLETED', filterId: 'f1', profileId: 'pr1', cleaningReasonLabel: 'Breakdown', sequenceNumber: 7,
      startedAt: '2026-06-01T07:00:00.000Z', completedAt: '2026-06-01T08:00:00.000Z', dryerDurationMinutes: 30,
      _changeReason: 'Paper record backfill',
    });
    expect(await ackMessage('Created')).toContain('Cleaning cycle added');
    expect(screen.queryByRole('heading', { name: 'Create Cleaning Cycle' })).toBeNull();
  });

  it('a refused create keeps the dialog; Cancel / X discard it', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      { path: '/api/filter-cleaning-profiles', body: { data: [] } },
      { method: 'POST', path: SA_CYCLES, status: 409, body: { error: 'IN_PROGRESS_EXISTS', message: 'Only ONE in-progress cycle is allowed per filter' } },
    ]);
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(screen.getByRole('button', { name: 'Create' }));
    let dlg = modal('Create Cleaning Cycle');
    setField(dlg, 'Status', 'IN_PROGRESS');
    typeReason(dlg, 'Paper record backfill');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    expect((await waitForCalls(api, 'POST', SA_CYCLES, 1))[0].json).toEqual({ status: 'IN_PROGRESS', _changeReason: 'Paper record backfill' });
    expect(await ackMessage('Create failed')).toContain('Only ONE in-progress cycle is allowed per filter');
    dlg = modal('Create Cleaning Cycle');
    await click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Create Cleaning Cycle' })).toBeNull();
    await click(screen.getByRole('button', { name: 'Create' }));
    await click(within(modal('Create Cleaning Cycle')).getAllByRole('button')[0]);
    expect(screen.queryByRole('heading', { name: 'Create Cleaning Cycle' })).toBeNull();
  });

  it('signed create: cancel is silent, a signed retry carries the password', async () => {
    const api = renderFdm([
      ...cycleRoutes(),
      { path: '/api/filter-cleaning-profiles', body: PROFILES },
      { method: 'POST', path: SA_CYCLES, body: {} },
    ], { reauth: ['SUPER_ADMIN_DATA_EDIT'] });
    await openTab('Cleaning Cycles');
    await screen.findByText('FLT-100');
    await click(screen.getByRole('button', { name: 'Create' }));
    let dlg = modal('Create Cleaning Cycle');
    typeReason(dlg, 'Paper record backfill');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    await cancelReauth();
    dlg = modal('Create Cleaning Cycle');
    await waitFor(() => expect(within(dlg).getByRole('button', { name: 'Create Record' })).not.toBeDisabled());
    expect(screen.queryByRole('heading', { name: 'Create failed' })).toBeNull();
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    await signReauth('pw-new');
    const [post] = await waitForCalls(api, 'POST', SA_CYCLES, 1);
    expect(post.headers['x-reauth-password']).toBe('pw-new');
    await ackMessage('Created');
  });
});
