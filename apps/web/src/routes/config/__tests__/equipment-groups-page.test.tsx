import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { EquipmentGroupsConfigPage } from '../equipment-groups';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

// Multi-request flows: the 5s / 1s defaults are too tight when the suite runs
// under coverage alongside other workers.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });


afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const BLOCKS = { data: [{ id: 'b1', name: 'Block A' }, { id: 'b2', name: 'Block B' }] };
const inst = (o: Record<string, unknown>) => ({
  description: 'Compressed Air Pressure', stageKey: 'WASH_IN', serialNumber: 'S1', instrumentId: 'CAP-1', uom: 'bar',
  instrumentMin: 0, instrumentMax: 10, operatingMin: 2, operatingMax: 8, leastCount: 0.1, ...o,
});
const G1 = {
  id: 'g1', name: 'EG Alpha', blockId: 'b1', isActive: true, readingUrl: 'http://10.0.0.5/r',
  instruments: [
    inst({ id: 'i1', responseKey: 'air_pressure', autoFetchEnabled: true }),
    inst({ id: 'i2', description: 'RO Water Pressure', instrumentId: '', autoFetchEnabled: true }),
    inst({ id: 'i3', description: 'Dryer Temperature', stageKey: 'DRY_IN', instrumentId: 'DT-1', uom: '°C', instrumentMax: 100, operatingMax: 90, leastCount: 0.5 }),
  ],
};
// Unknown stage key (fallback styling) and instruments without ids.
const G2 = { id: 'g2', name: 'EG Beta', blockId: 'b1', isActive: true, instruments: [inst({ stageKey: 'STORAGE_IN', description: 'Odd gauge' })] };
const CYCLES = '/api/filters/cycles';
const groupsPath = '/api/equipment-groups';

function setup(opts: { user?: any; groups?: unknown; blocks?: unknown; extra?: MockRoute[]; cycles?: unknown; reauth?: string[]; route?: string; path?: string; withConfigIndex?: boolean } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/hierarchy/blocks', body: opts.blocks ?? BLOCKS },
    { path: groupsPath, body: (r: MockRequest) => (r.query.get('blockId') === 'b2' ? [] : (opts.groups ?? [G1, G2])) },
    { path: CYCLES, body: opts.cycles ?? { data: [] } },
    { path: '/api/config/pagination/current', body: {} },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  const ui = opts.withConfigIndex
    ? (
      <Routes>
        <Route path="/config/equipment-groups" element={<EquipmentGroupsConfigPage />} />
        <Route path="/config" element={<p>CONFIG INDEX</p>} />
      </Routes>
    )
    : <EquipmentGroupsConfigPage />;
  renderPage(ui, { user: opts.user ?? SUPER_ADMIN, api, route: opts.route, path: opts.path });
  return api;
}

const dialog = () => screen.getByRole('heading', { name: /(Add|Edit) Equipment Group/, level: 2 }).closest('div.bg-white') as HTMLElement;
/** One instrument's editor block, by its description. */
function instBlock(desc: string) {
  const h = within(dialog()).getAllByRole('heading', { level: 3 }).find((x) => x.textContent?.includes(desc))!;
  return h.parentElement!.parentElement as HTMLElement;
}
function fields(desc: string) {
  const b = instBlock(desc);
  const [serial, id, uom] = within(b).getAllByRole('textbox') as HTMLInputElement[];
  const [lc, iMin, iMax, oMin, oMax] = within(b).getAllByRole('spinbutton') as HTMLInputElement[];
  return { serial, id, uom, lc, iMin, iMax, oMin, oMax };
}
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const errorText = () => within(dialog()).getByText((_, el) => !!el && el.tagName === 'SPAN' && !!el.parentElement?.className.includes('bg-red-50')).textContent;
const autoSwitch = () => within(dialog()).getAllByRole('button').find((b) => b.hasAttribute('aria-pressed'))!;
const saveBtn = () => screen.getByRole('button', { name: /Save Equipment Group|Saving/ });
const save = async () => { await act(async () => { fireEvent.click(saveBtn()); }); };
const groupCard = (name: string) => screen.getByRole('heading', { name, level: 3 }).closest('div.bg-white') as HTMLElement;

describe('Equipment Groups page - list', () => {
  it('selects the first block and lists its groups with instrument details', async () => {
    const api = setup();
    await screen.findByRole('heading', { name: 'EG Alpha' });
    expect(api.calls('GET', groupsPath)[0].query.get('blockId')).toBe('b1');
    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('b1');
    const alpha = groupCard('EG Alpha');
    expect(within(alpha).getByText('3 instruments configured')).toBeInTheDocument();
    // Auto badge carries its response key, or a generic title when it has none.
    const autos = within(alpha).getAllByText('Auto');
    expect(autos.map((a) => a.getAttribute('title'))).toEqual(['Auto-fetch key: air_pressure', 'Auto-fetch enabled']);
    expect(within(alpha).getAllByText('WASH IN')).toHaveLength(2);
    expect(within(alpha).getByText('DRY IN')).toBeInTheDocument();
    expect(within(alpha).getByText('—')).toBeInTheDocument(); // blank instrument id
    expect(within(alpha).getAllByText('2.0 – 8.0')).toHaveLength(2); // operating range at 0.1 least count
    expect(within(alpha).getByText('0.0 – 100.0')).toBeInTheDocument(); // dryer instrument range at 0.5
    expect(within(groupCard('EG Beta')).getByText('STORAGE IN')).toBeInTheDocument();
    // Stat tiles: 2 groups, 4 instruments.
    expect(screen.getByText('Equipment Groups', { selector: 'p,span,div' })).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Equipment Group/ })).not.toBeDisabled();
    expect(within(alpha).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('switching block refetches; an empty block says so', async () => {
    const api = setup();
    await screen.findByRole('heading', { name: 'EG Alpha' });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'b2' } });
    expect(await screen.findByText('No equipment groups for this block')).toBeInTheDocument();
    expect(api.calls('GET', groupsPath).some((r) => r.query.get('blockId') === 'b2')).toBe(true);
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('no blocks: asks to select one and Add stays disabled; no groups request', async () => {
    const api = setup({ blocks: { data: [] } });
    expect(await screen.findByText('Select a block to view its equipment groups')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Equipment Group/ })).toBeDisabled();
    expect(api.calls('GET', groupsPath)).toHaveLength(0);
  });

  it('a non-array groups payload is treated as no groups', async () => {
    setup({ groups: { error: 'weird' } });
    expect(await screen.findByText('No equipment groups for this block')).toBeInTheDocument();
  });

  it('paginates the cards on the first configured page-size option (25 here)', async () => {
    const many = Array.from({ length: 27 }, (_, i) => ({ ...G2, id: `x${i}`, name: `Group ${String(i + 1).padStart(2, '0')}` }));
    // The page reads Config -> Pagination (2026-10-22: usePageSize); it used a fixed 25.
    setup({ groups: many, extra: [{ path: '/api/config/pagination/current', body: { limit: 100, count: 3, options: [25, 50, 100] } }] });
    await screen.findByRole('heading', { name: 'Group 01' });
    expect(screen.queryByRole('heading', { name: 'Group 26' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByRole('heading', { name: 'Group 26' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Group 01' })).toBeNull();
  });

  it('a role with only EG_VIEW sees the list but no Add / Edit / Delete', async () => {
    setup({ user: { role: 'OPERATOR', permissions: ['EG_VIEW'] } });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Add Equipment Group/ })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('EG_EDIT alone shows Edit only', async () => {
    setup({ user: { role: 'SUPERVISOR', permissions: ['EG_VIEW', 'EG_EDIT'] } });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Equipment Group/ })).toBeNull();
  });

  it('back arrow takes a SUPER_ADMIN to /config', async () => {
    setup({ route: '/config/equipment-groups', withConfigIndex: true });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    fireEvent.click(screen.getByRole('button', { name: 'Back to configuration' }));
    expect(await screen.findByText('CONFIG INDEX')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Equipment Groups', level: 1 })).toBeNull();
  });
});

describe('Equipment Groups page - delete', () => {
  it('declining the confirm sends nothing', async () => {
    const api = setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await screen.findByRole('heading', { name: 'EG Alpha' });
    fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Delete' }));
    expect(window.confirm).toHaveBeenCalledWith('Delete equipment group "EG Alpha"?');
    expect(api.calls('DELETE', `${groupsPath}/g1`)).toHaveLength(0);
  });

  it('confirming DELETEs the group', async () => {
    const api = setup({ extra: [{ method: 'DELETE', path: `${groupsPath}/g1`, status: 204 }] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Delete' })); });
    await waitFor(() => expect(api.calls('DELETE', `${groupsPath}/g1`)).toHaveLength(1));
    expect(screen.queryByText(/Failed to delete/)).toBeNull();
  });

  it('a refused delete shows the server message, dismissible', async () => {
    setup({ extra: [{ method: 'DELETE', path: `${groupsPath}/g1`, status: 409, body: { error: 'IN_USE', message: 'Group is referenced by cycles' } }] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Delete' })); });
    const banner = await screen.findByText('Group is referenced by cycles');
    fireEvent.click(within(banner.parentElement!).getByRole('button', { name: '×' }));
    expect(screen.queryByText('Group is referenced by cycles')).toBeNull();
  });

  it('server demands a signature for delete: retried with the password', async () => {
    const p = `${groupsPath}/g1`;
    const api = setup({ extra: [reauthRequired('DELETE', p), { method: 'DELETE', path: p, status: 204 }] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Delete' })); });
    await signReauth('del-pw');
    await waitFor(() => expect(api.calls('DELETE', p)).toHaveLength(2));
    expect(api.calls('DELETE', p)[1].headers['x-reauth-password']).toBe('del-pw');
    expect(api.calls('DELETE', p)[1].json).toEqual({ _currentPassword: 'del-pw' });
  });

  it('cancelling the delete signature deletes nothing and reports no failure (item 9)', async () => {
    const p = `${groupsPath}/g1`;
    const api = setup({ extra: [reauthRequired('DELETE', p)] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen.findByRole('heading', { name: 'EG Alpha' });
    const consoleError = spyConsoleError();
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Delete' })); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expectSilentCancel(consoleError);
    expect(api.calls('DELETE', p)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'EG Alpha' })).toBeInTheDocument();
  });
});

describe('Equipment Groups page - create', () => {
  async function openCreate(api = setup({ extra: [{ method: 'POST', path: groupsPath, status: 201, body: { id: 'new' } }] })) {
    await screen.findByRole('heading', { name: 'EG Alpha' });
    fireEvent.click(screen.getByRole('button', { name: /Add Equipment Group/ }));
    await screen.findByRole('heading', { name: 'Add Equipment Group', level: 2 });
    return api;
  }

  it('opens with the three default instruments and the block picker; overlay click closes it', async () => {
    await openCreate();
    expect(within(dialog()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      expect.stringContaining('Compressed Air Pressure'), expect.stringContaining('RO Water Pressure'), expect.stringContaining('Dryer Temperature'),
    ]);
    expect(fields('Dryer Temperature').uom.value).toBe('°C');
    expect((within(dialog()).getByRole('combobox') as HTMLSelectElement).value).toBe('b1');
    // Clicking inside does not close; the backdrop does.
    fireEvent.click(dialog());
    expect(screen.getByRole('heading', { name: 'Add Equipment Group', level: 2 })).toBeInTheDocument();
    fireEvent.click(dialog().parentElement!);
    expect(screen.queryByRole('heading', { name: 'Add Equipment Group', level: 2 })).toBeNull();
  });

  it('validates every instrument rule in order before sending anything', async () => {
    const api = await openCreate();
    await save();
    expect(errorText()).toBe('Group name is required');
    set(within(dialog()).getByPlaceholderText('e.g. Equipment Group 1'), '  New EG  ');
    await save();
    expect(errorText()).toBe('Instrument ID is required for Compressed Air Pressure');
    for (const [d, id] of [['Compressed Air Pressure', 'CAP-9'], ['RO Water Pressure', 'ROW-9'], ['Dryer Temperature', 'DT-9']]) set(fields(d).id, id);

    const f = fields('Compressed Air Pressure');
    set(f.uom, ' ');
    await save();
    expect(errorText()).toBe('UOM is required for Compressed Air Pressure');
    set(f.uom, 'bar');
    set(f.lc, '0');
    await save();
    expect(errorText()).toBe('Least Count must be > 0 for Compressed Air Pressure');
    set(f.lc, 'abc');
    expect(fields('Compressed Air Pressure').lc.value).toBe('0');
    set(f.lc, '0.1');
    set(f.iMax, '0');
    await save();
    expect(errorText()).toBe('Min Range must be less than Max Range for Compressed Air Pressure');
    set(f.iMax, '10');
    set(f.iMin, '1');
    set(f.oMin, '-1');
    await save();
    expect(errorText()).toBe('Operating Min must be within instrument range for Compressed Air Pressure');
    set(f.oMin, '11');
    await save();
    expect(errorText()).toBe('Operating Min must be within instrument range for Compressed Air Pressure');
    set(f.oMin, '2');
    set(f.oMax, '11');
    await save();
    expect(errorText()).toBe('Operating Max must be within instrument range for Compressed Air Pressure');
    set(f.oMax, '0');
    await save();
    expect(errorText()).toBe('Operating Max must be within instrument range for Compressed Air Pressure');
    set(f.oMax, '2');
    await save();
    expect(errorText()).toBe('Operating Min must be less than Operating Max for Compressed Air Pressure');
    // The error banner can be dismissed.
    fireEvent.click(within(dialog()).getByRole('button', { name: '×' }));
    expect(within(dialog()).queryByText(/Operating Min must be less/)).toBeNull();
    expect(api.calls('POST', groupsPath)).toHaveLength(0);
  });

  it('a valid manual group POSTs the trimmed payload with auto-fetch fields blanked, then confirms', async () => {
    const api = await openCreate();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    set(within(dialog()).getByPlaceholderText('e.g. Equipment Group 1'), '  New EG  ');
    fireEvent.change(within(dialog()).getByRole('combobox'), { target: { value: 'b2' } });
    for (const [d, id] of [['Compressed Air Pressure', 'CAP-9'], ['RO Water Pressure', 'ROW-9'], ['Dryer Temperature', 'DT-9']]) set(fields(d).id, id);
    set(fields('Compressed Air Pressure').serial, 'SN-1');
    set(fields('Compressed Air Pressure').oMin, '1');
    await save();
    await waitFor(() => expect(api.calls('POST', groupsPath)).toHaveLength(1));
    const body = api.calls('POST', groupsPath)[0].json;
    expect(body).toMatchObject({ name: 'New EG', blockId: 'b2', readingUrl: '' });
    expect(body.instruments).toHaveLength(3);
    expect(body.instruments[0]).toEqual({
      serialNumber: 'SN-1', instrumentId: 'CAP-9', uom: 'bar', instrumentMin: 0, instrumentMax: 10,
      operatingMin: 1, operatingMax: 10, leastCount: 0.1, responseKey: '',
    });
    expect(body.instruments.every((i: any) => i.responseKey === '')).toBe(true);
    expect(await screen.findByText('Equipment group created')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add Equipment Group', level: 2 })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText('Equipment group created')).toBeNull();
  });

  it('preview lists the dropdown values, notes when there are more than 100, and hides again', async () => {
    await openCreate();
    const b = instBlock('Compressed Air Pressure');
    fireEvent.click(within(b).getByRole('button', { name: 'Preview' }));
    // 0..10 step 0.1 = 101 values -> first 100 shown + "...and more".
    expect(within(b).getByText(/Dropdown values \(0\.0 to 10\.0, step 0\.1\)/)).toBeInTheDocument();
    expect(within(b).getByText('0.0 bar')).toBeInTheDocument();
    expect(within(b).getByText('...and more')).toBeInTheDocument();
    // A zero least count yields no values at all.
    set(fields('Compressed Air Pressure').lc, '0');
    expect(within(b).queryByText('0.0 bar')).toBeNull();
    expect(within(b).queryByText('...and more')).toBeNull();
    fireEvent.click(within(b).getByRole('button', { name: 'Hide' }));
    expect(within(b).queryByText(/Dropdown values/)).toBeNull();
    // A short range lists everything without the "more" note.
    const d = instBlock('Dryer Temperature');
    set(fields('Dryer Temperature').lc, '50');
    fireEvent.click(within(d).getByRole('button', { name: 'Preview' }));
    expect(within(d).getByText('100 °C')).toBeInTheDocument();
    expect(within(d).queryByText('...and more')).toBeNull();
  });

  it('auto-fetch on: URL, scheme and response-key rules are enforced, then readingUrl + keys are sent', async () => {
    const api = await openCreate();
    set(within(dialog()).getByPlaceholderText('e.g. Equipment Group 1'), 'Auto EG');
    for (const [d, id] of [['Compressed Air Pressure', 'CAP-9'], ['RO Water Pressure', 'ROW-9'], ['Dryer Temperature', 'DT-9']]) set(fields(d).id, id);
    fireEvent.click(autoSwitch());
    expect(autoSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog()).getByText('Instrument Auto-Fetch')).toBeInTheDocument();
    await save();
    expect(errorText()).toBe('Auto-fetch is on — enter the readings URL, or turn auto-fetch off.');
    const url = within(dialog()).getByPlaceholderText('http://192.168.1.x:port/readings');
    set(url, 'not a url');
    await save();
    expect(errorText()).toBe('Readings URL must be a valid http(s) URL.');
    set(url, 'ftp://10.0.0.9/r');
    await save();
    expect(errorText()).toBe('Readings URL must be a valid http(s) URL.');
    set(url, ' http://10.0.0.9/r ');
    const keys = within(dialog()).getAllByPlaceholderText('e.g. air_pressure');
    expect(keys.map((k) => (k as HTMLInputElement).value)).toEqual(['air_pressure', 'ro_water_pressure', 'dryer_temperature']);
    keys.forEach((k) => set(k, ' '));
    await save();
    expect(errorText()).toBe('Auto-fetch is on — set a response key for at least one instrument.');
    set(keys[0], ' air ');
    await save();
    await waitFor(() => expect(api.calls('POST', groupsPath)).toHaveLength(1));
    const body = api.calls('POST', groupsPath)[0].json;
    expect(body.readingUrl).toBe('http://10.0.0.9/r');
    expect(body.instruments.map((i: any) => i.responseKey)).toEqual(['air', '', '']);
  });

  it('Get Latest Values maps each response key to a reading, or explains why not', async () => {
    const TEST = '/api/equipment-groups/test-url';
    const api = await openCreate(setup({
      extra: [
        { method: 'POST', path: TEST, times: 1, body: { ok: true, reading: { air_pressure: 6.2, ro_water_pressure: 'n/a' } } },
        { method: 'POST', path: TEST, times: 1, body: { ok: false, error: 'timeout after 5s' } },
        { method: 'POST', path: TEST, times: 1, body: { ok: false } },
        { method: 'POST', path: TEST, times: 1, status: 502, body: { error: 'BAD_GATEWAY', message: 'Instrument unreachable' } },
        { method: 'POST', path: TEST, times: 1, status: 502, body: {} },
      ],
    }));
    fireEvent.click(autoSwitch());
    const getLatest = () => within(dialog()).getByRole('button', { name: /Get Latest Values|Fetching/ });
    await act(async () => { fireEvent.click(getLatest()); });
    expect(errorText()).toBe('Enter the readings URL first');
    expect(api.calls('POST', TEST)).toHaveLength(0);

    set(within(dialog()).getByPlaceholderText('http://192.168.1.x:port/readings'), 'http://10.0.0.9/r');
    const keys = within(dialog()).getAllByPlaceholderText('e.g. air_pressure');
    set(keys[2], '');
    await act(async () => { fireEvent.click(getLatest()); });
    await within(dialog()).findByText('6.2 bar');
    expect(api.calls('POST', TEST)[0].json).toEqual({ url: 'http://10.0.0.9/r' });
    expect(within(dialog()).getByText('Key "ro_water_pressure" not in response')).toBeInTheDocument();
    expect(within(dialog()).getByText('No key set')).toBeInTheDocument();

    await act(async () => { fireEvent.click(getLatest()); });
    await waitFor(() => expect(within(dialog()).getAllByText('timeout after 5s').length).toBe(4)); // 3 cells + banner

    await act(async () => { fireEvent.click(getLatest()); });
    await waitFor(() => expect(errorText()).toBe('Failed to fetch readings'));
    expect(within(dialog()).getAllByText('Failed')).toHaveLength(3);

    await act(async () => { fireEvent.click(getLatest()); });
    await waitFor(() => expect(errorText()).toBe('Instrument unreachable'));

    await act(async () => { fireEvent.click(getLatest()); });
    await waitFor(() => expect(errorText()).toBe('Request failed: 502'));
    expect(getLatest()).toHaveTextContent('Get Latest Values');
  });

  it('a refused create stays open with the server message', async () => {
    setup({ extra: [{ method: 'POST', path: groupsPath, status: 409, body: { error: 'DUPLICATE', message: 'Name already used in this block' } }] });
    await openCreate({} as any);
    set(within(dialog()).getByPlaceholderText('e.g. Equipment Group 1'), 'EG Alpha');
    for (const [d, id] of [['Compressed Air Pressure', 'CAP-9'], ['RO Water Pressure', 'ROW-9'], ['Dryer Temperature', 'DT-9']]) set(fields(d).id, id);
    await save();
    await waitFor(() => expect(errorText()).toBe('Name already used in this block'));
    expect(saveBtn()).toHaveTextContent('Save Equipment Group');
  });

  it('server demands a signature for create: retried with the password', async () => {
    const api = setup({ extra: [reauthRequired('POST', groupsPath), { method: 'POST', path: groupsPath, status: 201, body: { id: 'n' } }] });
    await openCreate({} as any);
    set(within(dialog()).getByPlaceholderText('e.g. Equipment Group 1'), 'EG New');
    for (const [d, id] of [['Compressed Air Pressure', 'CAP-9'], ['RO Water Pressure', 'ROW-9'], ['Dryer Temperature', 'DT-9']]) set(fields(d).id, id);
    await save();
    await signReauth('eg-pw');
    await waitFor(() => expect(api.calls('POST', groupsPath)).toHaveLength(2));
    expect(api.calls('POST', groupsPath)[1].headers['x-reauth-password']).toBe('eg-pw');
    expect(api.calls('POST', groupsPath)[1].json).toMatchObject({ name: 'EG New', _currentPassword: 'eg-pw' });
    expect(await screen.findByText('Equipment group created')).toBeInTheDocument();
  });

  it('cancelling the signature frees the Save button, sends nothing more and reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const api = setup({ reauth: ['CREATE_EQUIPMENT_GROUP'] });
    await openCreate({} as any);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    set(within(dialog()).getByPlaceholderText('e.g. Equipment Group 1'), 'EG New');
    for (const [d, id] of [['Compressed Air Pressure', 'CAP-9'], ['RO Water Pressure', 'ROW-9'], ['Dryer Temperature', 'DT-9']]) set(fields(d).id, id);
    await save();
    expect(saveBtn()).toHaveTextContent('Saving...');
    await cancelReauth();
    await waitFor(() => expect(saveBtn()).toHaveTextContent('Save Equipment Group'));
    expectSilentCancel(consoleError);
    expect(api.calls('POST', groupsPath)).toHaveLength(0);
    // The editor stays open with the operator's input.
    expect((within(dialog()).getByPlaceholderText('e.g. Equipment Group 1') as HTMLInputElement).value).toBe('EG New');
  });
});

describe('Equipment Groups page - edit', () => {
  it('a group not used by active cycles opens straight into the editor, prefilled', async () => {
    const api = setup({ cycles: { data: [{ id: 'c1', equipmentGroupId: 'other' }] } });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    await screen.findByRole('heading', { name: 'Edit Equipment Group', level: 2 });
    const q = api.calls('GET', CYCLES)[0].query;
    expect(q.get('status')).toBe('IN_PROGRESS');
    expect(q.get('limit')).toBe('1000000');
    // No block picker when editing; auto-fetch is on because instruments auto-fetch.
    expect(within(dialog()).queryByRole('combobox')).toBeNull();
    expect(autoSwitch()).toHaveAttribute('aria-pressed', 'true');
    expect((within(dialog()).getByPlaceholderText('http://192.168.1.x:port/readings') as HTMLInputElement).value).toBe('http://10.0.0.5/r');
    expect(fields('Compressed Air Pressure').id.value).toBe('CAP-1');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Edit Equipment Group', level: 2 })).toBeNull();
  });

  it('a group in use by active cycles warns first; Cancel aborts, Proceed opens the editor', async () => {
    setup({ cycles: { data: [{ id: 'c1', equipmentGroupId: 'g1' }, { id: 'c2', equipmentGroupId: 'g1' }] } });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    expect(await screen.findByText(/in use by 2 active cycles\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Group is in use')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Edit Equipment Group', level: 2 })).toBeNull();

    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    await screen.findByText('Group is in use');
    // Backdrop click also dismisses.
    fireEvent.click(screen.getByText('Group is in use').closest('div.fixed') as HTMLElement);
    expect(screen.queryByText('Group is in use')).toBeNull();

    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    fireEvent.click(await screen.findByRole('button', { name: 'Proceed with edit' }));
    expect(screen.getByRole('heading', { name: 'Edit Equipment Group', level: 2 })).toBeInTheDocument();
  });

  it('one active cycle reads in the singular', async () => {
    setup({ cycles: { data: [{ id: 'c1', equipmentGroupId: 'g2' }] } });
    await screen.findByRole('heading', { name: 'EG Beta' });
    await act(async () => { fireEvent.click(within(groupCard('EG Beta')).getByRole('button', { name: 'Edit' })); });
    expect(await screen.findByText(/in use by 1 active cycle\./)).toBeInTheDocument();
  });

  it('if the active-cycle check fails, the editor still opens (fail-open)', async () => {
    setup({ extra: [{ path: CYCLES, status: 500, body: { error: 'INTERNAL', message: 'boom' } }] });
    await screen.findByRole('heading', { name: 'EG Beta' });
    await act(async () => { fireEvent.click(within(groupCard('EG Beta')).getByRole('button', { name: 'Edit' })); });
    expect(await screen.findByRole('heading', { name: 'Edit Equipment Group', level: 2 })).toBeInTheDocument();
    expect(autoSwitch()).toHaveAttribute('aria-pressed', 'false');
  });

  it('a missing cycles list counts as no active cycles', async () => {
    setup({ cycles: {} });
    await screen.findByRole('heading', { name: 'EG Beta' });
    await act(async () => { fireEvent.click(within(groupCard('EG Beta')).getByRole('button', { name: 'Edit' })); });
    expect(await screen.findByRole('heading', { name: 'Edit Equipment Group', level: 2 })).toBeInTheDocument();
  });

  it('Get Latest Values on an existing group: instruments without a response key say so', async () => {
    const TEST = '/api/equipment-groups/test-url';
    const api = setup({ extra: [{ method: 'POST', path: TEST, body: { ok: true, reading: { air_pressure: 5.5 } } }] });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    await screen.findByRole('heading', { name: 'Edit Equipment Group', level: 2 });
    await act(async () => { fireEvent.click(within(dialog()).getByRole('button', { name: 'Get Latest Values' })); });
    expect(await within(dialog()).findByText('5.5 bar')).toBeInTheDocument();
    expect(api.calls('POST', TEST)[0].json).toEqual({ url: 'http://10.0.0.5/r' });
    expect(within(dialog()).getAllByText('No key set')).toHaveLength(2);
  });

  it('Save PUTs the edited group (auto-fetch turned off blanks URL and keys)', async () => {
    const p = `${groupsPath}/g1`;
    const api = setup({ extra: [{ method: 'PUT', path: p, body: { ok: true } }] });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    await screen.findByRole('heading', { name: 'Edit Equipment Group', level: 2 });
    set(fields('RO Water Pressure').id, 'ROW-2');
    fireEvent.click(autoSwitch()); // off
    expect(within(dialog()).queryByText('Instrument Auto-Fetch')).toBeNull();
    await save();
    await waitFor(() => expect(api.calls('PUT', p)).toHaveLength(1));
    const body = api.calls('PUT', p)[0].json;
    expect(body).toMatchObject({ name: 'EG Alpha', blockId: 'b1', readingUrl: '' });
    expect(body.instruments.map((i: any) => [i.instrumentId, i.responseKey])).toEqual([['CAP-1', ''], ['ROW-2', ''], ['DT-1', '']]);
    expect(await screen.findByText('Equipment group saved')).toBeInTheDocument();
  });

  it('server demands a signature for update: retried with the password', async () => {
    const p = `${groupsPath}/g1`;
    const api = setup({ extra: [reauthRequired('PUT', p), { method: 'PUT', path: p, body: { ok: true } }] });
    await screen.findByRole('heading', { name: 'EG Alpha' });
    await act(async () => { fireEvent.click(within(groupCard('EG Alpha')).getByRole('button', { name: 'Edit' })); });
    await screen.findByRole('heading', { name: 'Edit Equipment Group', level: 2 });
    set(fields('RO Water Pressure').id, 'ROW-3');
    await save();
    await signReauth('up-pw');
    await waitFor(() => expect(api.calls('PUT', p)).toHaveLength(2));
    expect(api.calls('PUT', p)[1].headers['x-reauth-password']).toBe('up-pw');
    // Auto-fetch stayed on: the URL and each key go with the signed retry.
    expect(api.calls('PUT', p)[1].json).toMatchObject({ name: 'EG Alpha', readingUrl: 'http://10.0.0.5/r', _currentPassword: 'up-pw' });
    expect(api.calls('PUT', p)[1].json.instruments.map((i: any) => i.responseKey)).toEqual(['air_pressure', '', '']);
    expect(await screen.findByText('Equipment group saved')).toBeInTheDocument();
  });
});
