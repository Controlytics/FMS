import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, passReauth, expectSigned, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, fakeReport } from './cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { FilterLifecycleReportPage } from '../filter-lifecycle';

usePageTestLifecycle();
// These pages chain many SWR reads; give them headroom when the machine is busy.
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); });

const d = (day: string, h = 8) => `2026-${day}T${String(h).padStart(2, '0')}:00:00.000Z`;

const HIER: MockRoute[] = [
  { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b2', name: 'Block B' }, { id: 'b1', name: 'Block A' }] } },
  { path: '/api/hierarchy/areas', body: { data: [{ id: 'ar2', name: 'Area Z', blockId: 'b1' }, { id: 'ar1', name: 'Area 1', blockId: 'b1' }] } },
  { path: '/api/hierarchy/ahus', body: { data: [
    { id: 'h1', name: 'AHU-1', areaId: 'ar1', blockId: 'b1' },
    { id: 'h2', name: 'AHU-Direct', areaId: null, blockId: 'b2' },
  ] } },
  { path: '/api/hierarchy/filters', body: { data: [
    { id: 'f1', name: 'FLT-001', ahuId: 'h1', status: 'Active', filterSet: 'SET_A' },
    { id: 'f3', name: 'FLT-NEW', ahuId: 'h1', status: 'Active' },
    { id: 'f2', name: 'FLT-002', ahuId: 'h2', status: 'Active' },
    { id: 'fx', name: 'FLT-GONE', ahuId: 'h1', status: 'Retired' },
  ] } },
  { path: '/api/filters/retirements', body: [
    { id: 'fOld', name: 'FLT-OLD', preRetireParentId: 'h1', filterSet: 'SET_B', retiredAt: d('09-20'), retiredBy: 'qa1', remarks: 'end of life' },
    { id: 'fR', name: 'FLT-RET', preRetireParentId: 'h2', retiredAt: d('09-25'), retiredBy: 'qa3', remarks: null },
  ] },
  { path: '/api/filters/replacements', body: [
    { oldFilterId: 'fOld', newFilterId: 'f3', oldFilterName: 'FLT-OLD', newFilterName: 'FLT-NEW', replacedAt: d('09-20', 9), performedBy: 'qa2', remarks: 'worn' },
    { oldFilterId: null, newFilterId: null },
  ] },
];

const CYCLES: Record<string, any[]> = {
  fOld: [
    { id: 'cOld2', cycleCode: 'CC-OLD-2', status: 'TERMINATED', terminationReason: 'REPLACED', startedAt: d('09-10'), completedAt: d('09-20', 9) },
    { id: 'cOld1', cycleCode: 'CC-OLD-1', status: 'COMPLETED', startedAt: d('09-01'), completedAt: d('09-01', 12), lastStageByUsername: 'opr1' },
  ],
  f3: [{ id: 'cNew1', cycleCode: null, cleaningReasonKey: 'PM', status: 'IN_PROGRESS', startedAt: d('10-01') }],
  f1: [{ id: 'c1', cleaningReasonLabel: 'Preventive', status: 'COMPLETED', startedAt: d('09-15'), completedAt: d('09-15', 11), completedBy: 'abcdef123456' }],
  fR: [{ id: 'cR', status: 'TERMINATED', terminationReason: 'RETIRED', startedAt: d('09-24'), completedAt: d('09-25') }],
};
const MANUAL: Record<string, any[]> = {
  fOld: [{ id: 'mOld', fromState: 'WASH_IN', toState: 'DRY_IN', performedAt: d('09-05'), performedByName: 'admin', remarks: 'forced' }],
  f1: [{ id: 'm1', fromState: null, toState: 'CLEANING_CYCLE_COMPLETED', performedAt: d('09-16'), performedBy: '99999999-xx' }],
};
const DETAIL = (id: string) => ({
  id, filterName: 'detail-' + id, status: 'COMPLETED', startedAt: d('09-01'), completedAt: d('09-01', 12),
  events: [{ id: `${id}-e1`, eventType: 'STATE_TRANSITION', fromState: null, toState: 'WASH_IN', performedAt: d('09-01'), performedByName: 'opr1' }],
});

const cyclesRoute = (map = CYCLES): MockRoute => ({
  path: '/api/filters/cycles',
  body: (r: MockRequest) => { const all = map[r.query.get('filterId') ?? ''] ?? []; return { data: all, total: all.length }; },
});
const manualRoute = (map = MANUAL): MockRoute => ({
  path: '/api/filters/manual-status-changes',
  body: (r: MockRequest) => { const all = map[r.query.get('filterId') ?? ''] ?? []; return { data: all, total: all.length }; },
});
const detailRoute: MockRoute = { path: /^\/api\/filters\/cycles\/[^/?]+$/, body: (r: MockRequest) => DETAIL(r.path.split('/').pop()!) };
const LOG: MockRoute = { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } };

function open(user: any = SA, extra: MockRoute[] = [], base = {}) {
  const api = mockApi([...extra, cyclesRoute(), manualRoute(), detailRoute, ...HIER, LOG, DT_UTC, ...baseRoutes(base)]);
  renderPage(<FilterLifecycleReportPage />, { user, api });
  return api;
}
const selects = () => screen.getAllByRole('combobox') as HTMLSelectElement[];
const opts = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);
async function pick(index: 0 | 1 | 2 | 3, value: string) {
  await waitFor(() => expect(Array.from(selects()[index].options).some((o) => o.value === value)).toBe(true));
  fireEvent.change(selects()[index], { target: { value } });
}
const groupBtn = (name: string) => screen.getByText(name, { selector: 'div.truncate' }).closest('button')!;
const exportVia = async (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Filter Lifecycle Report — scope', () => {
  it('starts empty, asking for a scope; no export offered', async () => {
    const api = open();
    expect(await screen.findByText('Select a Block, Area, AHU or Filter')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    await waitFor(() => expect(opts(selects()[0])).toEqual(['All Blocks', 'Block A', 'Block B']));
    // every filter, incl. retired ones (detached → scoped by their pre-retire AHU)
    expect(opts(selects()[3])).toEqual(['All in scope', 'FLT-001', 'FLT-002', 'FLT-NEW', 'FLT-OLD (Retired)', 'FLT-RET (Retired)']);
    expect(api.unmatched).toEqual([]);
  });

  it('cascades: a block narrows areas, AHUs (incl. block-direct ones) and filters; area and AHU narrow further', async () => {
    open();
    await pick(0, 'b1');
    expect(opts(selects()[1])).toEqual(['All Areas', 'Area 1', 'Area Z']);
    expect(opts(selects()[2])).toEqual(['All AHUs', 'AHU-1']);
    expect(opts(selects()[3])).toEqual(['All in scope', 'FLT-001', 'FLT-NEW', 'FLT-OLD (Retired)']);
    expect(screen.getByText('Block Block A')).toBeInTheDocument();
    expect(screen.getByText(/— 3 filter\(s\) in scope · All Time/)).toBeInTheDocument();
    await pick(0, 'b2');
    expect(opts(selects()[2])).toEqual(['All AHUs', 'AHU-Direct']);
    expect(opts(selects()[3])).toEqual(['All in scope', 'FLT-002', 'FLT-RET (Retired)']);
    await pick(0, 'b1');
    await pick(1, 'ar1');
    expect(screen.getByText('Area Area 1')).toBeInTheDocument();
    await pick(2, 'h1');
    expect(screen.getByText('AHU AHU-1')).toBeInTheDocument();
    expect(opts(selects()[3])).toEqual(['All in scope', 'FLT-001', 'FLT-NEW', 'FLT-OLD (Retired)']);
  });

  it('broad scope: groups are closed; expanding one lists compact cycle rows, manual updates and lifecycle events in date order', async () => {
    const api = open();
    await pick(0, 'b1');
    expect(api.calls('GET', '/api/filters/cycles')).toHaveLength(0);
    fireEvent.click(groupBtn('FLT-OLD'));
    expect(await screen.findByText('2 cycle(s) · 1 manual · 1 event(s)')).toBeInTheDocument();
    const reqs = api.calls('GET', '/api/filters/cycles');
    expect(reqs[0].query.get('filterId')).toBe('fOld');
    expect(reqs[0].query.get('limit')).toBe('100');
    expect(reqs[0].query.get('from')).toBeNull();
    const group = groupBtn('FLT-OLD').parentElement!;
    expect(within(group).getByText('(Retired)')).toBeInTheDocument();
    expect(within(group).getByText('Set B')).toBeInTheDocument();
    // cycle 1 (Sep 1) → manual (Sep 5) → cycle 2 (Sep 10): cycle numbers count cycles only
    const text = group.textContent!;
    expect(text.indexOf('CC-OLD-1')).toBeLessThan(text.indexOf('Wash In → Dry In'));
    expect(text.indexOf('Wash In → Dry In')).toBeLessThan(text.indexOf('CC-OLD-2'));
    expect(within(group).getByText('CC-OLD-2').closest('div.flex')!).toHaveTextContent('#2');
    expect(within(group).getByText('Manual update by admin · forced')).toBeInTheDocument();
    // a replaced cycle names the replacer; a completed one its last-stage operator
    expect(within(group).getByText('CC-OLD-2').parentElement!).toHaveTextContent('Terminated by: qa2');
    expect(within(group).getByText('CC-OLD-1').parentElement!).toHaveTextContent('Completed by: opr1');
    expect(within(group).getByText('Replaced')).toHaveClass('bg-purple-50');
    expect(within(group).getByText('Lifecycle Events')).toBeInTheDocument();
    expect(within(group).getByText('Replaced by FLT-NEW')).toBeInTheDocument();
    expect(within(group).getByText('by qa2 · worn')).toBeInTheDocument();
    // compact rows do not expand
    expect(within(group).queryByRole('button', { name: /CC-OLD-1/ })).toBeNull();
    // collapse again
    fireEvent.click(groupBtn('FLT-OLD'));
    expect(screen.queryByText('Manual update by admin · forced')).toBeNull();
  });

  it('a group with nothing in the period says so; a failing cycles read shows its error in the group', async () => {
    allowConsoleError(/./);
    open(role('QA', ['REPORT_EXPORT']), [{ path: '/api/filters/cycles', status: 500, times: 1, body: { error: 'INTERNAL', message: 'cycles read failed' } }]);
    await pick(0, 'b2');
    fireEvent.click(groupBtn('FLT-002'));
    // first read fails (whichever group asks first) — open FLT-002 first so it is the one
    expect(await screen.findByText('cycles read failed')).toBeInTheDocument();
    fireEvent.click(groupBtn('FLT-RET'));
    expect(await screen.findByText('1 cycle(s) · 1 event(s)')).toBeInTheDocument();
    const ret = groupBtn('FLT-RET').parentElement!;
    expect(within(ret).getByText('Retired', { selector: 'span.rounded-full' })).toHaveClass('bg-amber-50');
    expect(within(ret).getByText('Retired', { selector: 'span.text-\\[13px\\]' })).toBeInTheDocument();
    expect(within(ret).getByText('by qa3')).toBeInTheDocument();
    expect(within(ret).getByText(/Terminated by:/).parentElement).toHaveTextContent('qa3');
  });

  it('a group with no cycles, manual updates or events reads empty', async () => {
    open(SA, [cyclesRoute({}), manualRoute({})]);
    await pick(3, 'f2');
    expect(await screen.findByText('No cleaning cycles, manual updates or lifecycle events in this period.')).toBeInTheDocument();
  });

  it('a date range bounds every cycle/manual read to whole local days and filters lifecycle events', async () => {
    const api = open();
    await pick(0, 'b1');
    fireEvent.change(screen.getByLabelText('Lifecycle from date'), { target: { value: '2026-09-21' } });
    fireEvent.change(screen.getByLabelText('Lifecycle to date'), { target: { value: '2026-10-02' } });
    expect(screen.getByText(/2026-09-21 → 2026-10-02/)).toBeInTheDocument();
    fireEvent.click(groupBtn('FLT-NEW'));
    await waitFor(() => expect(api.calls('GET', '/api/filters/cycles').length).toBeGreaterThan(0));
    const q = api.calls('GET', '/api/filters/cycles')[0].query;
    expect([q.get('from'), q.get('to')]).toEqual(['2026-09-21T00:00:00.000Z', '2026-10-02T23:59:59.999Z']);
    expect(api.calls('GET', '/api/filters/manual-status-changes')[0].query.get('to')).toBe('2026-10-02T23:59:59.999Z');
    // FLT-NEW was "created as replacement" on Sep 20 — outside the period
    expect(await screen.findByText('1 cycle(s)')).toBeInTheDocument();
    expect(screen.queryByText(/Created as replacement/)).toBeNull();
  });

  it('a single filter in a replacement chain reports the WHOLE chain, oldest first; cycles expand to full detail', async () => {
    const api = open(SA, [{ path: '/api/users', body: { data: [] } }]);
    await pick(3, 'f3');
    expect(await screen.findByText(/replacement chain of 2, oldest first/)).toBeInTheDocument();
    expect(screen.getByText('FLT-NEW', { selector: 'span.font-semibold' })).toBeInTheDocument();
    // two filters → groups are closed by default
    expect(groupBtn('FLT-OLD')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(groupBtn('FLT-NEW'));
    expect(await screen.findByText('Created as replacement of FLT-OLD')).toBeInTheDocument();
    // in single-filter scope a cycle is an accordion
    const cycleBtn = await screen.findByRole('button', { name: /PM/ });
    expect(cycleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(within(cycleBtn).getByText('In Progress')).toBeInTheDocument();
    fireEvent.click(cycleBtn);
    expect(await screen.findByRole('heading', { name: 'detail-cNew1' })).toBeInTheDocument();
    expect(api.calls('GET', '/api/filters/cycles/cNew1')).toHaveLength(1);
    // SUPER_ADMIN gets the edit affordance on the expanded cycle
    fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit cleaning record - detail-cNew1' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a single filter outside any chain opens by default; a failing detail fetch offers Retry; a 403 does not', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('QA', ['REPORT_EXPORT']), [
      { path: '/api/filters/cycles/c1', status: 500, times: 1, body: { error: 'INTERNAL', message: 'detail failed' } },
    ]);
    await pick(3, 'f1');
    expect(await screen.findByText('1 cycle(s) · 1 manual')).toBeInTheDocument();
    expect(groupBtn('FLT-001')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Set A')).toBeInTheDocument();
    expect(screen.getByText('Manual update by 99999999')).toBeInTheDocument();
    expect(screen.getByText('To Be Cleaned', { exact: false })).toHaveTextContent('To Be Cleaned → Cleaning Cycle Completed');
    const cycleBtn = screen.getByRole('button', { name: /Preventive/ });
    expect(cycleBtn).toHaveTextContent('Completed by: abcdef12');
    fireEvent.click(cycleBtn);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('detail failed');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'detail-c1' })).toBeInTheDocument();
    // a non-SA sees the detail but no edit button
    expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
  });

  it('a 403 on the expanded cycle explains and offers no Retry', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('QA'), [{ path: '/api/filters/cycles/c1', status: 403, body: { error: 'FORBIDDEN', message: 'Forbidden' } }]);
    await pick(3, 'f1');
    fireEvent.click(await screen.findByRole('button', { name: /Preventive/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view this.');
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('failed source lists are named with a Retry that refetches only them', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(SA, [
      { path: '/api/hierarchy/blocks', status: 500, times: 1, body: { error: 'INTERNAL', message: 'x' } },
      { path: '/api/filters/replacements', status: 500, times: 1, body: { error: 'INTERNAL', message: 'y' } },
    ]);
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('Could not load Blocks, Replacements.'));
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(api.calls('GET', '/api/hierarchy/blocks')).toHaveLength(2);
    expect(api.calls('GET', '/api/hierarchy/areas')).toHaveLength(1);
  });
});

describe('Filter Lifecycle Report — export', () => {
  it('is not offered without lifecycle.export (REPORT_EXPORT / REPORT_GENERATE)', async () => {
    open(role('OPERATOR', ['ASSET_READ']));
    await pick(3, 'f1');
    await screen.findByText('1 cycle(s) · 1 manual');
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });

  it('Excel (broad scope): one row per cycle and per manual update across the scope, logged first', async () => {
    const api = open(role('QA', ['REPORT_GENERATE']));
    vi.mocked(exportToExcel).mockImplementation(async () => { expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1); });
    await pick(0, 'b1');
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg).toMatchObject({ filename: 'lifecycle-Block-Block-A', sheetName: 'Cleaning Cycles' });
    expect(arg.head).toEqual(['Filter', 'S.No', 'Cycle', 'Start Time', 'End Time', 'By', 'Status', 'Reason']);
    expect(arg.rows).toEqual([
      ['FLT-001', '1', '-', '2026-10-01 08:00'.replace('10-01', '09-15'), '2026-09-15 11:00', 'abcdef12', 'Completed', 'Preventive'],
      ['FLT-001', '', 'Manual: To Be Cleaned → Cleaning Cycle Completed', '2026-09-16 08:00', '', '99999999', 'Manual Update', '-'],
      ['FLT-NEW', '1', '-', '2026-10-01 08:00', '-', '-', 'In Progress', 'PM'],
      ['FLT-OLD', '1', 'CC-OLD-1', '2026-09-01 08:00', '2026-09-01 12:00', 'opr1', 'Completed', '-'],
      ['FLT-OLD', '2', 'CC-OLD-2', '2026-09-10 08:00', '2026-09-20 09:00', 'qa2', 'Replaced', '-'],
      ['FLT-OLD', '', 'Manual: Wash In → Dry In', '2026-09-05 08:00', '', 'admin', 'Manual Update', 'forced'],
    ]);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Cleaning Lifecycle', format: 'Excel', recordCount: 6 });
  });

  it('Excel: nothing in scope, over the limit, and a failing read each explain themselves without a file', async () => {
    allowConsoleError(/./);
    const api = open(SA, [cyclesRoute({}), manualRoute({})], { exportLimit: { maxRecords: 1 } });
    await pick(3, 'f2');
    await exportVia('Excel');
    expect(await screen.findByText('No cleaning cycles or manual updates found for this selection and period.')).toBeInTheDocument();
    api.add(cyclesRoute({ f1: CYCLES.f1 }), manualRoute({ f1: MANUAL.f1 }));
    await pick(3, 'f1');
    await exportVia('Excel');
    expect(await screen.findByText(/2 records/)).toBeInTheDocument();
    api.add({ path: '/api/filters/manual-status-changes', status: 500, body: { error: 'INTERNAL', message: 'manual read failed' } });
    await exportVia('Excel');
    expect(await screen.findByText('manual read failed')).toBeInTheDocument();
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
  });

  it('PDF (broad scope): a section per filter with one merged cycle/manual table + lifecycle events; logged then saved', async () => {
    const api = open();
    await pick(0, 'b1');
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({
      reportKey: 'cleaning-lifecycle', title: 'Block Block A — Cleaning Lifecycle Report', subtitle: 'Period: All Time', orientation: 'portrait',
    });
    expect(report.titles()).toEqual([
      'Filter: FLT-001', 'Filter: FLT-NEW', 'Lifecycle Events (Retirement / Replacement)',
      'Filter: FLT-OLD (Retired)', 'Lifecycle Events (Retirement / Replacement)',
    ]);
    expect(report.newPage).toHaveBeenCalledTimes(2);
    const [t1, , , t4, t5] = report.tables();
    expect(t1.head).toEqual(['S.No', 'Cycle', 'Start Time', 'End Time', 'By', 'Status', 'Details']);
    expect(t1.body).toEqual([
      ['1', 'Preventive', '2026-09-15 08:00', '2026-09-15 11:00', 'abcdef12', 'Completed', '-'],
      ['-', 'Manual Update', '2026-09-16 08:00', '-', '99999999', 'Manual Update', 'To Be Cleaned -> Cleaning Cycle Completed'],
    ]);
    expect(t4.body.map((r: string[]) => r[1])).toEqual(['CC-OLD-1', 'Manual Update', 'CC-OLD-2']);
    expect(t4.body[1][6]).toBe('Wash In -> Dry In · forced');
    expect(t5.body).toEqual([['Replaced by FLT-NEW', '2026-09-20 09:00', 'qa2', 'worn']]);
    expect(report.save.mock.calls[0][0]).toMatch(/lifecycle.*Block-Block-A.*\.pdf$/);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Cleaning Lifecycle', format: 'PDF', recordCount: 8 });
  });

  it('PDF (single filter, chain): full detail per cycle on its own page, manual updates in their slot, the chain in the subtitle', async () => {
    const api = open();
    await pick(3, 'f3');
    fireEvent.change(screen.getByLabelText('Lifecycle to date'), { target: { value: '2026-10-31' } });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({
      title: 'FLT-NEW — Cleaning Lifecycle Report',
      subtitle: 'Period: Start → 2026-10-31\nReplacement chain (2 filters, oldest first): FLT-OLD -> FLT-NEW',
    });
    for (const id of ['cOld1', 'cOld2', 'cNew1']) expect(api.calls('GET', `/api/filters/cycles/${id}`).length).toBeGreaterThan(0);
    expect(report.titles()).toEqual([
      'Filter: FLT-OLD (Retired)', 'Cycle 1 — 2026-09-01 08:00', 'Stage Progress', 'Event Timeline',
      'Manual Status Updates',
      'Cycle 2 — 2026-09-10 08:00', 'Stage Progress', 'Event Timeline',
      'Lifecycle Events (Retirement / Replacement)',
      'Filter: FLT-NEW  [the filter selected]', 'Cycle 1 — 2026-10-01 08:00', 'Stage Progress', 'Event Timeline',
      'Lifecycle Events (Retirement / Replacement)',
    ]);
    const manualTable = report.tables().find((t) => t.head?.[0] === 'From');
    expect(manualTable.body).toEqual([['Wash In', 'Dry In', '2026-09-05 08:00', 'admin', 'forced']]);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Cleaning Lifecycle', format: 'PDF', recordCount: 3 + 2 + 1 });
  });

  it('PDF (single filter): lifecycle events alone still get a filter header', async () => {
    open(SA, [cyclesRoute({}), manualRoute({})]);
    await pick(3, 'fR');
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(report.titles()).toEqual(['Filter: FLT-RET (Retired)', 'Lifecycle Events (Retirement / Replacement)']);
    expect(report.tables()[0].body).toEqual([['Retired', '2026-09-25 08:00', 'qa3', '-']]);
  });

  it('PDF with nothing in the scope and period explains instead of producing an empty file', async () => {
    open(SA, [cyclesRoute({}), manualRoute({})]);
    await pick(3, 'f2');
    await exportVia('PDF');
    expect(await screen.findByText('No cleaning cycles, manual updates or lifecycle events found for this selection and period.')).toBeInTheDocument();
    expect(createReport).not.toHaveBeenCalled();
  });

  it('full-detail size guards: over 400 cycles is refused; over 100 asks first and a "No" stops it', async () => {
    const big = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, status: 'COMPLETED', startedAt: d('09-01') }));
    // the on-screen group (single filter → open by default) reads once and gets an empty list;
    // the export's own reads get the big one — keeps the page from rendering hundreds of rows
    const api = open(SA, [{ path: '/api/filters/cycles', times: 1, body: { data: [], total: 0 } }, cyclesRoute({ f2: big(401) }), manualRoute({})]);
    await pick(3, 'f2');
    await screen.findByText('No cleaning cycles, manual updates or lifecycle events in this period.');
    await exportVia('PDF');
    expect(await screen.findByText('This filter has 401 cycles — too many for a full-detail PDF (limit 400). Narrow the period.')).toBeInTheDocument();
    api.add(cyclesRoute({ f2: big(101) }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await exportVia('PDF');
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toMatch(/full-detail report for 101 cycles/);
    expect(createReport).not.toHaveBeenCalled();
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled(), { timeout: 5000 });
    expect(report.titles().filter((t) => t.startsWith('Cycle '))).toHaveLength(101);
    expect(report.newPage).toHaveBeenCalledTimes(100);
  }, 30000);

  it('PDF re-auth: gated export prompts and signs; a cancel is silent; a build failure is shown', async () => {
    const api = open(SA, [], { reauthActions: ['EXPORT_CLEANING_LIFECYCLE'] });
    await pick(3, 'f1');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await exportVia('PDF');
    await passReauth();
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
    await exportVia('Excel');
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(exportToExcel).not.toHaveBeenCalled();
    vi.mocked(createReport).mockRejectedValueOnce(new Error('PDF engine crashed'));
    await exportVia('PDF');
    expect(await screen.findByText('PDF engine crashed')).toBeInTheDocument();
  });
});
