/**
 * Tablet shell — Filter Status (tiles + Block → Area → AHU → Filter cascade +
 * the Scan RFID lookup) and the Filter Cleaning Record (list, filters, detail
 * timeline). Same boundary fakes as wrapper-shell.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useMobileLifecycle, flush, seedCache, allowConsoleError } from './support/mobile-kit';
import { renderWrapper } from './support/wrapper-harness';

vi.mock('@/lib/connectivity', async () => (await import('./support/fakes')).connectivityModule);
vi.mock('@/lib/sync-engine', async () => (await import('./support/fakes')).syncEngineModule);
vi.mock('@/lib/sync-since', async () => (await import('./support/fakes')).syncSinceModule);
vi.mock('@/lib/offline-sync-service', async (orig) => ({ ...(await orig() as any), syncAllDataForOffline: (await import('./support/fakes')).fakeSyncAllDataForOffline }));
vi.mock('@capacitor/app', async () => (await import('./support/fakes')).capacitorAppModule);
vi.mock('../mobile-operations', () => ({ MobileOperationsPage: () => <div data-testid="ops" /> }));

useMobileLifecycle();

/** The <select> under a cascade label (also its accessible name — the label carries htmlFor since 2026-10-22). */
const selectUnder = (label: string, scope: HTMLElement = document.body) =>
  within(scope).getAllByText(label, { selector: 'label' })[0].parentElement!.querySelector('select') as HTMLSelectElement;
const pick = (label: string, value: string, scope?: HTMLElement) => fireEvent.change(selectUnder(label, scope), { target: { value } });
/** Open a SearchableSelect (trigger sits under the label) and choose an option. */
function searchPick(label: string, option: string) {
  const trigger = screen.getAllByText(label, { selector: 'label' })[0].parentElement!.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
}
const rowNames = () => screen.queryAllByText(/^F-\d{3}$/, { selector: 'div.text-sm' }).map((e) => e.textContent);
const tile = (label: string) => screen.getAllByText(label).map((e) => e.closest('button')).find((b) => b && b.className.includes('border-2'))!;

const CYCLES_FOR_STATUS = {
  data: [
    { id: 'c-old', filterId: 'f101', events: [
      { eventType: 'STATE_TRANSITION', performedAt: '2026-10-19T08:00:00.000Z' },
      { eventType: 'CHECKLIST_COMPLETED', performedAt: '2026-10-21T08:00:00.000Z' }, // not a cleaning stage
      { eventType: 'CYCLE_COMPLETED', performedAt: '2026-10-20T11:45:00.000Z' },
      { eventType: 'STATE_TRANSITION' }, // no time
    ] },
    { id: 'c-none', filterId: null, events: [] },
    { id: 'c-x', filterId: 'f101' },
  ],
};

async function openStatus(opts: Parameters<typeof renderWrapper>[0] = {}) {
  const view = renderWrapper({ ...opts, routes: [...(opts.routes ?? []), { path: '/api/filters/cycles', body: CYCLES_FOR_STATUS }] });
  fireEvent.click(await screen.findByRole('button', { name: /Status/ }));
  await screen.findByRole('heading', { name: 'Filter Status' });
  await waitFor(() => expect(rowNames().length).toBeGreaterThan(0));
  return view;
}

describe('Filter Status — tiles and list', () => {
  it('lists every live filter (never retired / deactivated) with its AHU, last-cleaned and stage', async () => {
    const { api } = await openStatus();
    expect(screen.getByText('All Filters (5)')).toBeInTheDocument();
    expect(rowNames().sort()).toEqual(['F-101', 'F-102', 'F-201', 'F-301', 'F-302']);
    expect(screen.queryByText('F-OLD')).toBeNull();
    expect(screen.queryByText('F-OFF')).toBeNull();
    const row = (n: string) => screen.getByText(n).closest('div.bg-white')! as HTMLElement;
    // last cleaned: server value wins; else the latest cleaning-STAGE event; else the seed date; else —
    await waitFor(() => expect(row('F-101')).toHaveTextContent('Last Cleaned: 20/10/2026 11:45'));
    expect(row('F-102')).toHaveTextContent('Last Cleaned: 20/10/2026 09:30');
    expect(row('F-201')).toHaveTextContent('Last Cleaned: 05/01/2026');
    expect(row('F-301')).toHaveTextContent('Last Cleaned: —');
    expect(row('F-101')).toHaveTextContent('AHU: AHU-01');
    expect(row('F-101')).toHaveTextContent('WASH IN');
    expect(row('F-201')).toHaveTextContent('To Be Cleaned');
    // the status view loads the cycle list (no 30-day window here)
    const cyc = api.calls('GET', '/api/filters/cycles')[0];
    expect(cyc.query.get('includeEvents')).toBe('true');
    expect(cyc.query.get('from')).toBeNull();
  });

  it('a stage tile filters the list and tapping it again (or "Show all") clears it; counts never change', async () => {
    await openStatus();
    expect(tile('Wash In')).toHaveTextContent('1');
    expect(tile('Storage Out')).toHaveTextContent('1');
    expect(tile('Wash Out')).toHaveTextContent('0');
    fireEvent.click(tile('Wash In'));
    expect(screen.getByText('Wash In (1)')).toBeInTheDocument();
    expect(rowNames()).toEqual(['F-101']);
    expect(tile('Dry In')).toHaveTextContent('1');
    fireEvent.click(tile('Wash In'));
    expect(screen.getByText('All Filters (5)')).toBeInTheDocument();
    fireEvent.click(tile('Storage Out'));
    fireEvent.click(screen.getByRole('button', { name: 'Show all filters' }));
    expect(rowNames()).toHaveLength(5);
  });

  it('the Stage dropdown includes Completed; an empty stage says so', async () => {
    await openStatus();
    pick('Stage', 'CLEANING_CYCLE_COMPLETED');
    expect(screen.getByText('Completed (0)')).toBeInTheDocument();
    expect(screen.getByText('No filters in this stage')).toBeInTheDocument();
    pick('Stage', 'all');
    expect(rowNames()).toHaveLength(5);
  });
});

describe('Filter Status — cascade', () => {
  it('Block keeps block-parented AHUs (kind-aware), Area narrows further, "clear" resets', async () => {
    await openStatus();
    pick('Block', 'b1');
    expect(screen.getByText('All Filters (3)')).toBeInTheDocument();
    expect(rowNames().sort()).toEqual(['F-101', 'F-102', 'F-201']);
    expect(tile('Storage Out')).toHaveTextContent('0'); // tiles follow the cascade
    // only North's area is offered
    const areaOpts = [...selectUnder('Area').options].map((o) => o.textContent);
    expect(areaOpts).toEqual(['All', 'Clean Room A']);
    pick('Area', 'a1');
    expect(rowNames().sort()).toEqual(['F-101', 'F-102']);
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(rowNames()).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'clear' })).toBeNull();
  });

  it('AHU and Filter are searchable; choosing a block the AHU/filter is not under resets them', async () => {
    await openStatus();
    searchPick('AHU', 'AHU-02');
    expect(rowNames()).toEqual(['F-201']);
    searchPick('Filter', 'F-201');
    expect(rowNames()).toEqual(['F-201']);
    pick('Block', 'b1'); // AHU-02 is in North — kept
    expect(rowNames()).toEqual(['F-201']);
    pick('Block', 'b2'); // not in South — AHU and filter reset
    expect(rowNames().sort()).toEqual(['F-301', 'F-302']);
  });

  it('choosing an Area resets an AHU / filter outside it; choosing an AHU resets a filter outside it', async () => {
    await openStatus();
    searchPick('Filter', 'F-101');
    searchPick('AHU', 'AHU-03'); // F-101 is not under AHU-03 → filter resets
    expect(rowNames().sort()).toEqual(['F-301', 'F-302']);
    searchPick('AHU', 'AHU-01');
    searchPick('Filter', 'F-102');
    pick('Area', 'a2'); // AHU-01 and F-102 are not in Pack Hall → both reset
    expect(rowNames().sort()).toEqual(['F-301', 'F-302']);
    pick('Area', 'a1');
    searchPick('AHU', 'AHU-01');
    searchPick('Filter', 'F-101');
    pick('Area', 'a1'); // same area again keeps both
    expect(rowNames()).toEqual(['F-101']);
    pick('Block', 'b1'); // the area belongs to North — kept
    expect(rowNames()).toEqual(['F-101']);
    pick('Area', 'all');
    pick('Block', 'b2'); // with the area cleared, a South block resets AHU + filter
    expect(rowNames().sort()).toEqual(['F-301', 'F-302']);
  });

  it('a Block change also resets an Area that belongs to another block', async () => {
    await openStatus();
    pick('Area', 'a2');
    pick('Block', 'b1');
    expect(selectUnder('Area').value).toBe('all');
    expect(rowNames().sort()).toEqual(['F-101', 'F-102', 'F-201']);
  });
});

describe('Scan RFID lookup (from Filter Status)', () => {
  async function openLookup() {
    await openStatus();
    fireEvent.click(screen.getByRole('button', { name: /Scan RFID/ }));
    await screen.findByText('Look up filter by tag');
    return document.querySelector('input[data-rfid="true"][aria-hidden="true"]') as HTMLInputElement;
  }
  const scan = (input: HTMLInputElement, raw: string) => { input.value = raw; fireEvent.keyDown(input, { key: 'Enter' }); };

  it('idle until a scan; a scan of an assigned tag shows the filter, its hierarchy and last cleaned', async () => {
    const input = await openLookup();
    expect(screen.getByText('Scan a tag to look up the mapped filter.')).toBeInTheDocument();
    expect(screen.getByText('Awaiting scan...')).toBeInTheDocument();
    scan(input, ' e200a1\r\n');
    expect(input.value).toBe('');
    expect(await screen.findByText('Match Found')).toBeInTheDocument();
    const card = screen.getByText('Match Found').closest('div.rounded-2xl')! as HTMLElement;
    expect(card).toHaveTextContent('F-101');
    expect(card).toHaveTextContent('WASH IN');
    expect(card).toHaveTextContent('BlockNorth');
    expect(card).toHaveTextContent('AreaClean Room A');
    expect(card).toHaveTextContent('AHUAHU-01');
    expect(card).toHaveTextContent('RFID TagE200A1');
    expect(card).toHaveTextContent('Last Cleaned20/10/2026 11:45');
    expect(screen.getByText('Scanned')).toBeInTheDocument();
  });

  it('a block-parented AHU has no area; a filter with no stage reads "To Be Cleaned"; no history reads —', async () => {
    const input = await openLookup();
    scan(input, 'E200B3');
    const card = (await screen.findByText('Match Found')).closest('div.rounded-2xl')! as HTMLElement;
    expect(card).toHaveTextContent('F-201');
    expect(card).toHaveTextContent('BlockNorth');
    expect(card).toHaveTextContent('Area—');
    expect(card).toHaveTextContent('To Be Cleaned');
    expect(card).toHaveTextContent('Last Cleaned05/01/2026');
  });

  it('unassigned, stale and non-filter tags each explain themselves; a QR identifier is not an RFID match', async () => {
    const input = await openLookup();
    scan(input, 'zz99');
    expect(await screen.findByText('Tag Not Assigned')).toBeInTheDocument();
    expect(screen.getByText('ZZ99', { selector: 'div' })).toBeInTheDocument();
    scan(input, 'E200GONE');
    expect(await screen.findByText('Stale RFID Mapping')).toBeInTheDocument();
    scan(input, 'E200H1');
    expect(await screen.findByText('Not a Filter')).toBeInTheDocument();
    expect(screen.getByText('"AHU-01"')).toBeInTheDocument();
    scan(input, 'QR-301');
    expect(await screen.findByText('Tag Not Assigned')).toBeInTheDocument();
  });

  it('a double-fired identical scan within a second is ignored; blank scans and other keys do nothing', async () => {
    const input = await openLookup();
    scan(input, 'E200A1');
    await screen.findByText('Match Found');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Awaiting scan...')).toBeInTheDocument();
    scan(input, 'E200A1'); // after Clear the duplicate guard is reset
    expect(await screen.findByText('Match Found')).toBeInTheDocument();
    scan(input, 'E200A1'); // immediate repeat: dropped (still the same result)
    scan(input, '   ');
    input.value = 'E200B2';
    fireEvent.keyDown(input, { key: 'a' });
    expect(screen.getByText('E200A1', { selector: 'span' })).toBeInTheDocument();
  });

  it('closes from the Close button, the X, and a tap on the backdrop — not from a tap on the sheet', async () => {
    const input = await openLookup();
    const sheet = screen.getByText('Look up filter by tag').closest('div.w-full')!.parentElement!.parentElement! as HTMLElement;
    fireEvent.mouseDown(sheet);
    fireEvent.click(sheet);
    expect(screen.getByText('Look up filter by tag')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Awaiting scan...'));
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Look up filter by tag')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Scan RFID/ }));
    await screen.findByText('Look up filter by tag');
    fireEvent.click(screen.getByRole('button', { name: 'Close tag lookup' })); // the X
    expect(screen.queryByText('Look up filter by tag')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Scan RFID/ }));
    await screen.findByText('Look up filter by tag');
    const backdrop = document.querySelector('.fixed.inset-0.z-50') as HTMLElement;
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(screen.queryByText('Look up filter by tag')).toBeNull();
  });
});

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const CYCLES = [
  { id: 'c1', filterId: 'f101', filter: { name: 'F-101' }, cycleCode: 'CC-0001', status: 'COMPLETED', startedAt: iso(200), completedAt: iso(50), cleaningReasonLabel: 'Preventive Maintenance' },
  { id: 'c2', filterId: 'f201', filterName: 'F-201 (name only)', cycleCode: 'CC-0002', status: 'IN_PROGRESS', startedAt: iso(5) },
  { id: 'c3', filterId: 'f301', cycleCode: 'CC-0003', status: 'TERMINATED', terminationReason: 'REPLACED', startedAt: iso(3000), completedAt: iso(2900) },
  { id: 'c4', filterId: 'f301', cycleCode: 'CC-0004', status: 'TERMINATED', terminationReason: 'RETIRED', startedAt: iso(4000), completedAt: iso(3999) },
  { id: 'c5', filterId: 'f102', cycleCode: 'CC-0005', status: 'TERMINATED', terminationReason: 'Operator error', startedAt: iso(5000), completedAt: iso(4990) },
  { id: 'c6', filterId: 'f102', cycleCode: 'CC-0006', status: 'WEIRD', startedAt: iso(6000) },
];

/** GET /api/filters/cycles as the server answers it: filterId / from / to applied, one page, the total. */
const AHU_OF: Record<string, string> = { f101: 'h1', f102: 'h1', f201: 'h2', f301: 'h3', f302: 'h3' };
function cyclesServer(all: any[]) {
  return (r: any) => {
    const q: URLSearchParams = r.query;
    let rows = all.slice();
    if (q.get('filterId')) rows = rows.filter((c) => c.filterId === q.get('filterId'));
    if (q.get('ahuId')) rows = rows.filter((c) => AHU_OF[c.filterId] === q.get('ahuId'));
    if (q.get('from')) rows = rows.filter((c) => c.startedAt >= q.get('from')!);
    if (q.get('to')) rows = rows.filter((c) => c.startedAt <= q.get('to')!);
    const page = Number(q.get('page') ?? 1);
    const limit = Number(q.get('limit') ?? 20);
    return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
  };
}

async function openCycles({ cycles, routes, ...o }: Parameters<typeof renderWrapper>[0] & { cycles?: any[] } = {}) {
  const view = renderWrapper({ ...o, routes: [...(routes ?? []), { path: '/api/filters/cycles', body: cyclesServer(cycles ?? CYCLES) }] });
  fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
  await screen.findByRole('heading', { name: 'Filter Cleaning Record' });
  return view;
}
const cards = () => screen.queryAllByText(/^CC-\d{4}$/, { selector: 'div.font-mono-tab' }).map((e) => e.textContent);

describe('Filter Cleaning Record — list', () => {
  it('asks for ONE page of the last 30 days (the configured page size, never every cycle) and shows each cycle with status, duration and reason', async () => {
    const { api } = await openCycles();
    await waitFor(() => expect(cards()).toHaveLength(6));
    const req = api.calls('GET', '/api/filters/cycles').find((r) => r.query.get('from'))!;
    const from = new Date(req.query.get('from')!).getTime();
    expect(Math.round((NOW - from) / 86_400_000)).toBe(30);
    expect(req.query.get('includeEvents')).toBe('true');
    // D-DB-9 (2026-10-22): ~1,500 cycles a day overflowed the server within weeks.
    expect(req.query.get('page')).toBe('1');
    expect(req.query.get('limit')).toBe('10');
    expect(screen.getByText(/showing/)).toHaveTextContent('showing 6 of 6');
    const card = (code: string) => screen.getByText(code, { selector: 'div.font-mono-tab' }).closest('button')! as HTMLElement;
    expect(card('CC-0001')).toHaveTextContent('F-101');
    expect(card('CC-0001')).toHaveTextContent('Completed');
    expect(card('CC-0001')).toHaveTextContent('2h 30m');
    expect(card('CC-0001')).toHaveTextContent('Preventive Maintenance');
    expect(card('CC-0002')).toHaveTextContent('F-201 (name only)');
    expect(card('CC-0002')).toHaveTextContent('In Progress');
    expect(card('CC-0002')).toHaveTextContent(/5m \d+s/);
    expect(card('CC-0002')).toHaveTextContent('—');
    expect(card('CC-0003')).toHaveTextContent('Replaced');
    expect(card('CC-0004')).toHaveTextContent('Retired');
    expect(card('CC-0005')).toHaveTextContent('Terminated');
    expect(card('CC-0006')).toHaveTextContent('In Progress'); // unknown status → In Progress chip
  });

  it('pages on the server: the page size and the next page are fetched, with the total', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `m${i}`, filterId: 'f101', filter: { name: 'F-101' }, cycleCode: `CC-${String(i + 100).padStart(4, '0')}`, status: 'COMPLETED', startedAt: iso(10 + i), completedAt: iso(5 + i) }));
    const { api } = await openCycles({ cycles: many });
    await waitFor(() => expect(cards()).toHaveLength(10));
    expect(screen.getByText(/showing/)).toHaveTextContent('showing 10 of 25');
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(cards()[0]).toBe('CC-0110'));
    expect(api.calls('GET', '/api/filters/cycles').some((r) => r.query.get('page') === '2' && r.query.get('limit') === '10')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(cards()).toHaveLength(5));
  });

  it('the Filter and From / To pickers are sent to the server (a paged list cannot be narrowed in the browser)', async () => {
    const { api } = await openCycles();
    await waitFor(() => expect(cards()).toHaveLength(6));
    pick('Filter', 'f301');
    await waitFor(() => expect(cards()).toEqual(['CC-0003', 'CC-0004']));
    expect(api.calls('GET', '/api/filters/cycles').some((r) => r.query.get('filterId') === 'f301' && r.query.get('page') === '1')).toBe(true);
    const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    fireEvent.click(screen.getByRole('button', { name: 'clear filters' }));
    fireEvent.change(screen.getByLabelText('Cycles to date and time'), { target: { value: local(new Date(NOW - 100 * 60_000)) } });
    await waitFor(() => expect(api.calls('GET', '/api/filters/cycles').some((r) => !!r.query.get('to'))).toBe(true));
  });

  it('the AHU picker alone is sent to the server too (ahuId, d9aa1b3); a chosen filter wins', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, filterId: i < 11 ? 'f101' : 'f301', cycleCode: `CC-${String(i + 200).padStart(4, '0')}`, status: 'COMPLETED', startedAt: iso(10 + i), completedAt: iso(5 + i) }));
    const { api } = await openCycles({ cycles: many });
    await waitFor(() => expect(cards()).toHaveLength(10));
    pick('AHU', 'h3');
    // the one AHU-03 cycle sits on page 2 of the unfiltered record: only the server can find it
    await waitFor(() => expect(cards()).toEqual(['CC-0211']));
    expect(api.calls('GET', '/api/filters/cycles').some((r) => r.query.get('ahuId') === 'h3' && !r.query.get('filterId'))).toBe(true);
    pick('Filter', 'f301');
    await waitFor(() => expect(api.calls('GET', '/api/filters/cycles').some((r) => r.query.get('filterId') === 'f301' && !r.query.get('ahuId'))).toBe(true));
  });

  it('AHU + Filter + From/To narrow the list (Filter and From/To on the server); switching AHU drops a filter that is not under it; clear resets', async () => {
    await openCycles();
    await waitFor(() => expect(cards()).toHaveLength(6));
    expect([...selectUnder('AHU').options].map((o) => o.textContent)).toEqual(['All AHUs', 'AHU-01', 'AHU-02', 'AHU-03']);
    pick('AHU', 'h3');
    await waitFor(() => expect(cards()).toEqual(['CC-0003', 'CC-0004']));
    expect([...selectUnder('Filter').options].map((o) => o.textContent)).toEqual(['All filters', 'F-301', 'F-302']);
    pick('Filter', 'f301');
    await waitFor(() => expect(cards()).toEqual(['CC-0003', 'CC-0004']));
    pick('AHU', 'h3'); // same AHU keeps the filter
    expect(selectUnder('Filter').value).toBe('f301');
    pick('AHU', 'h1'); // F-301 is not under AHU-01 → filter resets
    expect(selectUnder('Filter').value).toBe('all');
    await waitFor(() => expect(cards()).toEqual(['CC-0001', 'CC-0005', 'CC-0006']));
    pick('AHU', 'all');
    pick('Filter', 'f102');
    pick('AHU', 'h1'); // F-102 IS under AHU-01 → kept
    expect(selectUnder('Filter').value).toBe('f102');
    fireEvent.click(screen.getByRole('button', { name: 'clear filters' }));
    await waitFor(() => expect(cards()).toHaveLength(6));

    const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText('Cycles from date and time'), { target: { value: local(new Date(NOW - 300 * 60_000)) } });
    await waitFor(() => expect(cards()).toEqual(['CC-0001', 'CC-0002']));
    fireEvent.change(screen.getByLabelText('Cycles to date and time'), { target: { value: local(new Date(NOW - 100 * 60_000)) } });
    await waitFor(() => expect(cards()).toEqual(['CC-0001']));
    expect(screen.getByText(/showing/)).toHaveTextContent('showing 1 of 1'); // the server's count of the narrowed list
    fireEvent.change(screen.getByLabelText('Cycles from date and time'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Cycles to date and time'), { target: { value: local(new Date(NOW - 7000 * 60_000)) } });
    expect(await screen.findByText('No cycles match these filters.')).toBeInTheDocument();
  });

  it('no cycles at all says so; while loading there is no empty message', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const view = renderWrapper({ routes: [] });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/api/filters/cycles')) { await gate; return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
      return (realFetch as any)(input, init);
    }));
    fireEvent.click(await screen.findByRole('button', { name: /Filter Cleaning Record/ }));
    await screen.findByRole('heading', { name: 'Filter Cleaning Record' });
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('No cleaning cycles yet.')).toBeNull();
    release();
    expect(await screen.findByText('No cleaning cycles yet.')).toBeInTheDocument();
    view.unmount();
  });

  it('offline it shows the last cached snapshot and says so', async () => {
    await seedCache({ 'cleaning-cycles-recent': [CYCLES[0]] });
    await openCycles({ online: false });
    expect(await screen.findByText(/Offline — showing last cached snapshot/)).toBeInTheDocument();
    await waitFor(() => expect(cards()).toEqual(['CC-0001']));
  });

  it('online it caches what it showed for offline use', async () => {
    await openCycles();
    await waitFor(async () => {
      const { getCachedData } = await import('@/lib/offline-store');
      expect(((await getCachedData<any[]>('cleaning-cycles-recent')) ?? []).map((c) => c.id)).toHaveLength(6);
    });
  });
});

const DETAIL = {
  id: 'c1', filterId: 'f101', filterName: 'F-101', cycleCode: 'CC-0001', status: 'COMPLETED',
  startedAt: '2026-10-20T06:00:00.000Z', completedAt: '2026-10-20T09:15:00.000Z',
  cleaningReasonKey: 'PM', cleaningJustification: 'Quarterly PM visit',
  lastStageByUsername: 'op1',
  events: [
    { id: 'e1', eventType: 'CYCLE_STARTED', performedAt: '2026-10-20T06:00:00.000Z', performedByName: 'Ravi Kumar' },
    { id: 'e2', eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: '2026-10-20T06:01:00.000Z', performedByUsername: 'op1',
      attributes: { instrumentReadings: [{ description: 'RO water pressure', value: 2.5, uom: 'bar' }, { instrumentCode: 'CA-1', value: 6 }, { unit: 'psi' }] } },
    { id: 'e3', eventType: 'STATE_TRANSITION', fromState: 'WASH_OUT', toState: 'DRY_IN', performedAt: '2026-10-20T07:00:00.000Z', performedBy: 'abcdef12-3456', attributes: { action: 'DRYER_STARTED', dryerDurationMinutes: 30 } },
    { id: 'e4', eventType: 'STATE_TRANSITION', fromState: null, toState: 'DRY_IN', performedAt: '2026-10-20T07:40:00.000Z', attributes: { action: 'DRYER_READINGS_SUBMITTED' } },
    { id: 'e5', eventType: 'STATE_TRANSITION', fromState: 'DRY_OUT', toState: 'CUSTOM_STAGE', performedAt: '2026-10-20T08:00:00.000Z' },
    { id: 'e6', eventType: 'CHECKLIST_COMPLETED', performedAt: '2026-10-20T08:30:00.000Z', remarks: 'All good',
      enrichedAnswers: [{ questionId: 'q1', question: 'Filter intact?', answer: true }, { questionId: 'q2', question: 'Seal ok?', answer: false }, { question: 'Notes', answer: null }, { questionId: 'q4', question: 'Count', answer: 4 }] },
    { id: 'e7', eventType: 'BYPASS_DEVIATION', performedAt: '2026-10-20T08:40:00.000Z', deviationDetails: { justification: 'Dryer broken' } },
    { id: 'e8', eventType: 'MYSTERY', performedAt: '2026-10-20T08:50:00.000Z', deviationDetails: { code: 7 } },
    { eventType: 'CYCLE_COMPLETED', performedAt: '2026-10-20T09:15:00.000Z' },
  ],
};

describe('Filter Cleaning Record — detail', () => {
  it('shows the summary and the full event timeline with readings, answers, remarks and deviations', async () => {
    const { api } = await openCycles({ routes: [{ path: '/api/filters/cycles/c1', body: DETAIL }] });
    fireEvent.click(await screen.findByText('CC-0001', { selector: 'div.font-mono-tab' }));
    expect(await screen.findByText(/Event timeline/)).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cycles/c1')).toHaveLength(1);
    const summary = screen.getByText('Quarterly PM visit').closest('div.bg-white')! as HTMLElement;
    expect(summary).toHaveTextContent('F-101');
    expect(summary).toHaveTextContent('Completed time20/10/2026'); // end label from cycleEndInfo
    expect(summary).toHaveTextContent('3h 15m');
    expect(summary).toHaveTextContent('ReasonPM');
    expect(summary).toHaveTextContent('Completed byop1');
    expect(screen.getByText('9', { selector: 'span.font-mono-tab' })).toBeInTheDocument(); // event count
    expect(screen.getByText('Cycle Started')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(screen.getByText('abcdef12')).toBeInTheDocument(); // uuid fallback
    expect(screen.getByText('Dryer Started')).toBeInTheDocument();
    expect(screen.getByText('Dryer Ended')).toBeInTheDocument();
    expect(screen.getByText('Dry In (Started)')).toBeInTheDocument();
    expect(screen.getByText('Dry In (Ended)')).toBeInTheDocument();
    expect(screen.getByText('→ CUSTOM STAGE')).toBeInTheDocument();
    expect(screen.getByText('CUSTOM_STAGE')).toBeInTheDocument();
    expect(screen.getAllByText('To Be Cleaned').length).toBeGreaterThan(0);
    expect(screen.getByText('RO water pressure')).toBeInTheDocument();
    expect(screen.getByText('CA-1')).toBeInTheDocument();
    expect(screen.getByText('Reading 3')).toBeInTheDocument();
    expect(screen.getByText('psi')).toBeInTheDocument();
    expect(screen.getByText('Filter intact?').nextSibling).toHaveTextContent('Yes');
    expect(screen.getByText('Seal ok?').nextSibling).toHaveTextContent('No');
    expect(screen.getByText('Notes').nextSibling).toHaveTextContent('—');
    expect(screen.getByText('Count').nextSibling).toHaveTextContent('4');
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.getByText('Deviation: Dryer broken')).toBeInTheDocument();
    expect(screen.getByText('Deviation: {"code":7}')).toBeInTheDocument();
    expect(screen.getByText('Remark Added')).toBeInTheDocument(); // unknown event type styled as a remark
    fireEvent.click(screen.getByRole('button', { name: /Cycles/ }));
    expect(await screen.findByText(/showing/)).toBeInTheDocument();
  });

  it('a terminated cycle shows who ended it and why; RETIRED is not repeated as a reason', async () => {
    const term = { ...DETAIL, id: 'c5', cycleCode: 'CC-0005', status: 'TERMINATED', terminationReason: 'Operator error', terminatedAt: '2026-10-20T10:00:00.000Z', completedByUsername: 'qa7', cleaningJustification: null, cleaningReasonLabel: 'Breakdown', events: [] };
    await openCycles({ routes: [{ path: '/api/filters/cycles/c5', body: term }, { path: '/api/filters/cycles/c4', body: { ...term, id: 'c4', cycleCode: 'CC-0004', terminationReason: 'RETIRED' } }] });
    fireEvent.click(await screen.findByText('CC-0005', { selector: 'div.font-mono-tab' }));
    expect(await screen.findByText('Termination reason:')).toBeInTheDocument();
    expect(screen.getByText('Operator error')).toBeInTheDocument();
    expect(screen.getByText('Terminated by')).toBeInTheDocument();
    expect(screen.getByText('qa7')).toBeInTheDocument();
    expect(screen.getByText('No events recorded.')).toBeInTheDocument();
    expect(screen.getByText('Breakdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cycles/ }));
    fireEvent.click(await screen.findByText('CC-0004', { selector: 'div.font-mono-tab' }));
    expect(await screen.findByText('Retired', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Termination reason:')).toBeNull();
  });

  it('an in-progress cycle shows its running duration; offline the detail is built from the cached list', async () => {
    await seedCache({ 'cleaning-cycles-recent': [CYCLES[1]] });
    await openCycles({ online: false });
    fireEvent.click(await screen.findByText('CC-0002', { selector: 'div.font-mono-tab' }));
    expect(await screen.findByText('Duration so far')).toBeInTheDocument();
    expect(screen.getByText('No events recorded.')).toBeInTheDocument();
    expect(screen.getByText('F-201 (name only)', { selector: 'div' })).toBeInTheDocument();
  });

  it('while the detail loads there is a spinner and a Back button (online the list is not kept for the detail view)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    await openCycles({ routes: [{ path: '/api/filters/cycles/c1', body: DETAIL }] });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('/api/filters/cycles/c1')) await gate;
      return (realFetch as any)(input, init);
    }));
    fireEvent.click(await screen.findByText('CC-0001', { selector: 'div.font-mono-tab' }));
    await waitFor(() => expect(document.querySelector('.animate-spin')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText(/showing/)).toBeInTheDocument();
    release();
    await flush(60);
  });

  it('a cycle the server cannot find says so, with a way back', async () => {
    allowConsoleError(/\[SWR Error\]/);
    await openCycles({ routes: [{ path: '/api/filters/cycles/c1', status: 404, body: { error: 'NOT_FOUND', message: 'Cycle gone' } }] });
    fireEvent.click(await screen.findByText('CC-0001', { selector: 'div.font-mono-tab' }));
    expect(await screen.findByText('Cycle not found.')).toBeInTheDocument();
    expect(await screen.findByText('Load Error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Cycles' }));
    expect(await screen.findByText(/showing/)).toBeInTheDocument();
    await flush();
  });
});
