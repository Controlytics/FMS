import { describe, it, expect, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { resetEnv, signReauth, ackMessage, reauthRequired } from './config-test-helpers';
import { renderFdm, modal, field, setField, typeReason, click, waitForCalls, openTab } from './fdm-helpers';

afterEach(resetEnv);

const EVENTS = '/api/filters/events';
const SA_EVENTS = '/api/super-admin/data/filter-events';
const USERS = '/api/users';

const RO = { instrumentId: 'i-ro', description: 'RO Water Pressure', value: 2.5, uom: 'bar', leastCount: 0.1 };
const AIR = { instrumentId: 'i-air', description: 'Compressed Air Pressure', value: 6, uom: 'bar' };
const ANON = { value: 9 };

const EV1 = { id: 'ev1', eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'WASH_OUT', performedAt: '2026-07-01T08:20:00.000Z', performedBy: 'u1', remarks: 'all good', checksum: 'abcdef0123456789abcdef', manualEntry: true, attributes: { instrumentReadings: [RO, AIR, ANON] } };
const EV2 = { id: 'ev2', eventType: 'BYPASS_DEVIATION', fromState: null, toState: 'WASH_IN', performedAt: '2026-07-01T08:00:00.000Z', performedBy: null, attributes: {} };
const EV3 = { id: 'ev3', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: '2026-07-01T08:40:00.000Z', attributes: { action: 'DRYER_STARTED' } };
const EV4 = { id: 'ev4', eventType: 'REMARK_ADDED', fromState: null, toState: null, performedAt: '2026-07-01T09:00:00.000Z' };
const EV5 = { id: 'ev5', eventType: 'STATE_TRANSITION', fromState: 'washin', toState: 'WASH-OUT', performedAt: '2026-07-01T10:00:00.000Z', performedBy: 'u2' };
const EV6 = { id: 'ev6', eventType: null, fromState: 'STORAGE_IN', toState: null, performedAt: '2026-07-01T11:00:00.000Z' };
const ALL = [EV1, EV2, EV3, EV4, EV5, EV6];

const USER_LIST = { data: [{ id: 'u1', fullName: 'Op One', username: 'op1' }, { id: 'u2', username: 'op2' }] };

function eventRoutes(events: unknown[] = ALL, total?: number) {
  return [{ path: EVENTS, body: { data: events, ...(total !== undefined ? { total } : {}) } }];
}

function card(text: string): HTMLElement {
  return screen.getByText(text).closest('div.group') as HTMLElement;
}

describe('Filter Events tab — list', () => {
  it('requests the events feed and renders each transition like the traceability timeline', async () => {
    const api = renderFdm(eventRoutes(ALL, 6));
    await openTab('Filter Events');
    await screen.findByText('all good');
    const q = api.calls('GET', EVENTS)[0].query;
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('20');
    expect(q.has('eventType')).toBe(false);

    const c1 = card('all good');
    expect(c1).toHaveTextContent('STATE TRANSITIONManual entry');
    expect(c1).toHaveTextContent('WASH IN → WASH OUT');
    expect(c1).toHaveTextContent('Checksum: abcdef0123456789...');
    expect(c1).toHaveTextContent('2026-07-01 08:20');
    expect(c1.className).toContain('border-cyan-600');
    // Bypass: red border, no from-state reads "To Be Cleaned".
    const c2 = screen.getByText('BYPASS DEVIATION', { selector: 'span' }).closest('div.group') as HTMLElement;
    expect(c2.className).toContain('border-red-500');
    expect(c2).toHaveTextContent('To Be Cleaned → WASH IN');
    // Dryer start reads "(Started)".
    expect(screen.getByText(/DRY IN \(Started\)/)).toBeInTheDocument();
    // No states -> no transition line.
    const c4 = screen.getByText('REMARK ADDED', { selector: 'span' }).closest('div.group') as HTMLElement;
    expect(c4.textContent).not.toContain('→');
    // From-state only.
    const c6 = screen.getByText('2026-07-01 11:00').closest('div.group') as HTMLElement;
    expect(c6).toHaveTextContent('STORAGE IN');
    expect(c6.textContent).not.toContain('→');
    expect(screen.getByText('Records').previousElementSibling).toHaveTextContent('6');
    expect(api.unmatched).toEqual([]);
  });

  it('the Event Type filter is sent as eventType; search narrows by type and states', async () => {
    const api = renderFdm(eventRoutes());
    await openTab('Filter Events');
    await screen.findByText('all good');
    const select = screen.getByText('Event Type', { selector: 'span' }).closest('label')!.querySelector('select')!;
    expect(select.options).toHaveLength(12);
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('BYPASS DEVIATION');
    fireEvent.change(select, { target: { value: 'BYPASS_DEVIATION' } });
    await waitFor(() => expect(api.calls('GET', EVENTS).at(-1)!.query.get('eventType')).toBe('BYPASS_DEVIATION'));
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(api.calls('GET', EVENTS).at(-1)!.query.has('eventType')).toBe(false));

    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'remark' } });
    expect(screen.getByText('REMARK ADDED', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('all good')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'storage_in' } });
    expect(screen.getByText('2026-07-01 11:00')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'dry_in' } });
    expect(screen.getByText(/DRY IN \(Started\)/)).toBeInTheDocument();
    expect(screen.queryByText('REMARK ADDED', { selector: 'span' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'zzz' } });
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('date range is widened to instants for the events endpoint (format: date-time)', async () => {
    const api = renderFdm(eventRoutes());
    await openTab('Filter Events');
    await screen.findByText('all good');
    fireEvent.change(screen.getByLabelText('Records to date'), { target: { value: '2026-07-02' } });
    await waitFor(() => expect(api.calls('GET', EVENTS).at(-1)!.query.get('to')).toBe(new Date('2026-07-02T23:59:59.999').toISOString()));
    expect(api.calls('GET', EVENTS).at(-1)!.query.has('from')).toBe(false);
  });

  it('empty feed shows "No filter events"; record count falls back to the array length', async () => {
    renderFdm(eventRoutes([]));
    await openTab('Filter Events');
    expect(await screen.findByText('No filter events')).toBeInTheDocument();
  });
});

describe('Filter Events tab — edit an event', () => {
  it('From/To are dropdowns of lifecycle states, Performed By is a user picker, readings edit value only', async () => {
    const api = renderFdm([
      ...eventRoutes(),
      { path: USERS, body: USER_LIST },
      { method: 'PUT', path: `${SA_EVENTS}/ev1`, body: {} },
    ]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    // The user list is fetched only while an event edit is open.
    expect(api.calls('GET', USERS)).toHaveLength(0);
    await click(within(card('all good')).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Filter Event');
    expect(dlg).toHaveTextContent('STATE_TRANSITION');
    await waitFor(() => expect(within(field(dlg, 'Performed By') as any).getByRole('option', { name: 'Op One (op1)' })).toBeInTheDocument());
    expect(api.calls('GET', USERS)[0].query.get('limit')).toBe('1000000');
    expect(within(field(dlg, 'Performed By') as any).getByRole('option', { name: 'op2 (op2)' })).toBeInTheDocument();
    expect(field(dlg, 'Performed By').value).toBe('u1');

    const from = field(dlg, 'From State') as unknown as HTMLSelectElement;
    expect(from.tagName).toBe('SELECT');
    expect(Array.from(from.options).map((o) => o.value)).toEqual(['', 'WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT', 'STORAGE_IN', 'STORAGE_OUT', 'CYCLE_STARTED', 'CLEANING_CYCLE_COMPLETED', 'IN_USE']);
    expect(from.options[0].textContent).toBe('— none —');
    expect(from.value).toBe('WASH_IN');
    expect(field(dlg, 'To State').value).toBe('WASH_OUT');
    expect(field(dlg, 'Performed At').value).toBe('2026-07-01T08:20');
    expect(field(dlg, 'Remarks').value).toBe('all good');
    expect(field(dlg, 'RO Water Pressure (bar)').value).toBe('2.5');
    expect(field(dlg, 'Reading').value).toBe('9');
    expect(dlg).toHaveTextContent('Note: SHA-256 checksum is not editable.');

    setField(dlg, 'To State', 'DRY_IN');
    setField(dlg, 'Performed By', 'u2');
    setField(dlg, 'RO Water Pressure (bar)', '3.1');
    setField(dlg, 'Compressed Air Pressure (bar)', '');
    setField(dlg, 'Remarks', 'corrected');
    typeReason(dlg, 'Gauge reading typo');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/ev1`, 1);
    expect(put.json).toEqual({
      eventType: 'STATE_TRANSITION', fromState: 'WASH_IN', toState: 'DRY_IN', performedAt: '2026-07-01T08:20:00.000Z',
      performedBy: 'u2', remarks: 'corrected',
      // Identity (instrumentId, description, uom, leastCount) preserved; blank keeps the stored value.
      attributes: { instrumentReadings: [{ ...RO, value: 3.1 }, AIR, ANON] },
      _changeReason: 'Gauge reading typo',
    });
    expect(Object.keys(put.json).some((k) => k.startsWith('reading_'))).toBe(false);
    expect(await ackMessage('Updated')).toContain('Event updated and audited');
  });

  it('a legacy free-text state is kept as the first option rather than silently discarded', async () => {
    const api = renderFdm([...eventRoutes(), { path: USERS, body: USER_LIST }, { method: 'PUT', path: `${SA_EVENTS}/ev5`, body: {} }]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    await click(within(screen.getByText('2026-07-01 10:00').closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Filter Event');
    const from = field(dlg, 'From State') as unknown as HTMLSelectElement;
    expect(from.options[1].value).toBe('washin');
    expect(from.value).toBe('washin');
    expect((field(dlg, 'To State') as unknown as HTMLSelectElement).options[1].value).toBe('WASH-OUT');
    // Correct it to the canonical value.
    setField(dlg, 'From State', 'WASH_IN');
    typeReason(dlg, 'Normalise legacy state');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/ev5`, 1);
    expect(put.json.fromState).toBe('WASH_IN');
    expect(put.json.toState).toBe('WASH-OUT');
    // No readings on this event -> no attributes written.
    expect(put.json).not.toHaveProperty('attributes');
  });

  it('an event with no readings, no states and no performer sends only what is set', async () => {
    const api = renderFdm([...eventRoutes(), { path: USERS, body: { data: [] } }, { method: 'PUT', path: `${SA_EVENTS}/ev2`, body: {} }]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    await click(within(screen.getByText('BYPASS DEVIATION', { selector: 'span' }).closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Filter Event');
    expect(field(dlg, 'From State').value).toBe('');
    expect(field(dlg, 'Performed By').value).toBe('');
    expect((field(dlg, 'Performed By') as unknown as HTMLSelectElement).options[0].textContent).toBe('— unchanged —');
    typeReason(dlg, 'touch for audit');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    const [put] = await waitForCalls(api, 'PUT', `${SA_EVENTS}/ev2`, 1);
    expect(put.json).toEqual({ eventType: 'BYPASS_DEVIATION', toState: 'WASH_IN', performedAt: '2026-07-01T08:00:00.000Z', _changeReason: 'touch for audit' });
  });

  it('an event with no type is titled "Event"; the server asking for a signature retries with the password', async () => {
    const api = renderFdm([
      ...eventRoutes(), { path: USERS, body: USER_LIST },
      reauthRequired('PUT', `${SA_EVENTS}/ev6`), { method: 'PUT', path: `${SA_EVENTS}/ev6`, body: {} },
    ]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    await click(within(screen.getByText('2026-07-01 11:00').closest('div.group') as HTMLElement).getByRole('button', { name: 'Edit' }));
    const dlg = modal('Edit Filter Event');
    expect(dlg).toHaveTextContent('Event');
    expect(field(dlg, 'Event Type').value).toBe('');
    setField(dlg, 'Event Type', 'REMARK_ADDED');
    typeReason(dlg, 'Missing event type');
    await click(within(dlg).getByRole('button', { name: 'Save Changes' }));
    await signReauth('pw-ev');
    const puts = await waitForCalls(api, 'PUT', `${SA_EVENTS}/ev6`, 2);
    expect(puts[1].headers['x-reauth-password']).toBe('pw-ev');
    expect(puts[1].json).toMatchObject({ eventType: 'REMARK_ADDED', fromState: 'STORAGE_IN', _changeReason: 'Missing event type' });
    await ackMessage('Updated');
  });
});

describe('Filter Events tab — delete and create', () => {
  it('Delete targets the filter-events endpoint with the reason; event with no type is named "Event"', async () => {
    const api = renderFdm([...eventRoutes(), { method: 'DELETE', path: `${SA_EVENTS}/ev6`, body: {} }]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    await click(within(screen.getByText('2026-07-01 11:00').closest('div.group') as HTMLElement).getByRole('button', { name: 'Delete' }));
    const dlg = modal('Permanent Deletion');
    expect(dlg).toHaveTextContent('Event will be permanently removed');
    typeReason(dlg, 'Orphan event');
    await click(within(dlg).getByRole('button', { name: 'Delete Forever' }));
    const [del] = await waitForCalls(api, 'DELETE', `${SA_EVENTS}/ev6`, 1);
    expect(del.json).toEqual({ _changeReason: 'Orphan event' });
    await ackMessage('Deleted');
  });

  it('Create Filter Event: filter picker + event-type enum, POST with the reason', async () => {
    const api = renderFdm([
      ...eventRoutes(),
      { path: '/api/hierarchy/filters', body: { data: [{ id: 'f1', name: 'FLT-1' }, { id: 'f2' }] } },
      { method: 'POST', path: SA_EVENTS, body: {} },
    ]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Filter Event');
    await waitFor(() => expect(within(field(dlg, 'Filter') as any).getByRole('option', { name: 'FLT-1' })).toBeInTheDocument());
    // A filter with no name is listed by id.
    expect(within(field(dlg, 'Filter') as any).getByRole('option', { name: 'f2' })).toBeInTheDocument();
    const types = Array.from((field(dlg, 'Event Type') as unknown as HTMLSelectElement).options).map((o) => o.value);
    expect(types[0]).toBe('');
    expect(types).toContain('CYCLE_TERMINATED');
    expect(dlg).toHaveTextContent('Performed-by, IP and the SHA-256 checksum are stamped automatically.');
    setField(dlg, 'Filter', 'f1');
    setField(dlg, 'Event Type', 'REMARK_ADDED');
    setField(dlg, 'Cycle ID (optional)', 'cyc-9');
    setField(dlg, 'From State', 'WASH_IN');
    setField(dlg, 'To State', 'WASH_OUT');
    setField(dlg, 'Performed At', '2026-06-10T12:00');
    setField(dlg, 'Remarks', 'paper log');
    typeReason(dlg, 'Back-fill from paper');
    await click(within(dlg).getByRole('button', { name: 'Create Record' }));
    const [post] = await waitForCalls(api, 'POST', SA_EVENTS, 1);
    expect(post.json).toEqual({
      filterId: 'f1', eventType: 'REMARK_ADDED', cycleId: 'cyc-9', fromState: 'WASH_IN', toState: 'WASH_OUT',
      performedAt: '2026-06-10T12:00:00.000Z', remarks: 'paper log', _changeReason: 'Back-fill from paper',
    });
    expect(await ackMessage('Created')).toContain('Filter event added');
  });

  it('if the filter hierarchy cannot be loaded the picker is empty and the load error is shown', async () => {
    renderFdm([...eventRoutes(), { path: '/api/hierarchy/filters', status: 500, body: { error: 'INTERNAL', message: 'hierarchy unavailable' } }]);
    await openTab('Filter Events');
    await screen.findByText('all good');
    await click(screen.getByRole('button', { name: 'Create' }));
    const dlg = modal('Create Filter Event');
    expect(await screen.findByText('hierarchy unavailable')).toBeInTheDocument();
    const picker = field(dlg, 'Filter') as unknown as HTMLSelectElement;
    await waitFor(() => expect(picker.options[0].textContent).toBe('Select a filter'));
    expect(picker.options).toHaveLength(1);
  });
});
