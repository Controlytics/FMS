import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, fakeReport } from './cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { FilterLifecycleReportPage, mergeTimeline, replacementChain } from '../filter-lifecycle';

/**
 * Filter Lifecycle Report against SPARSE records — the shapes live data really
 * has: filters with no AHU or set, retirements with no date or performer,
 * replacements with no names, cycles with no code/start/known status, manual
 * updates with no time — plus multi-page reads and an empty detail answer.
 */
usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockClear(); });

const d = (day: string, h = 8) => `2026-${day}T${String(h).padStart(2, '0')}:00:00.000Z`;
const LOG: MockRoute = { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } };

const HIER: MockRoute[] = [
  { path: '/api/hierarchy/blocks', body: { data: [{ id: 'bz', name: 'Block Z' }, { id: 'bp', name: 'Block P' }] } },
  { path: '/api/hierarchy/areas', body: { data: [] } },
  { path: '/api/hierarchy/ahus', body: { data: [{ id: 'hz', name: 'AHU-Z', blockId: 'bz', areaId: null }, { id: 'hp', name: 'AHU-P', blockId: 'bp', areaId: null }] } },
  { path: '/api/hierarchy/filters', body: { data: [
    { id: 'g1', name: '###', status: 'Active' },            // no AHU, no set; a name with no word characters
    { id: 'g2', name: 'G-TWO', ahuId: 'hz', status: 'Active' },
    { id: 'g3', name: 'G-PAGED', ahuId: 'hp', status: 'Active' },
  ] } },
  { path: '/api/filters/retirements', body: [
    { id: 'gR', name: 'G-NODATE' },                          // no parent, no date, no performer
    { id: 'gR2', name: 'G-RET2', preRetireParentId: 'hz', retiredAt: d('09-02') },
  ] },
  { path: '/api/filters/replacements', body: [{ oldFilterId: 'gOld', newFilterId: 'g1', replacedAt: d('09-03'), remarks: 'swap' }] },
];
const SPARSE_CYCLES = [
  { id: 'gc1', status: 'ON_HOLD', cleaningReasonKey: 'ODD', startedAt: d('09-01') },
  { id: 'gc2', status: 'COMPLETED' },
];
const SPARSE_MANUAL = [{ fromState: 'A_B', toState: 'C_D', performedAt: null, remarks: null }];
const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, status: 'COMPLETED', startedAt: d('09-01'), fromState: 'X', toState: 'Y', performedAt: d('09-01') }));

/** Per filter+page answers; anything else gets the sparse list WITHOUT a total. */
const paged = (path: string, pages: Record<string, any>, fallback: any[]): MockRoute => ({
  path, body: (r: MockRequest) => pages[`${r.query.get('filterId')}:${r.query.get('page')}`] ?? { data: fallback },
});

function open(base = {}) {
  const api = mockApi([
    paged('/api/filters/cycles', { 'g3:1': { data: many(100, 'p'), total: 101 }, 'g3:2': { data: many(1, 'q'), total: 101 } }, SPARSE_CYCLES),
    paged('/api/filters/manual-status-changes', { 'g3:1': { data: many(100, 'm'), total: 200 }, 'g3:2': { data: [], total: 200 }, 'g2:1': {} }, SPARSE_MANUAL),
    { path: '/api/filters/cycles/gc2', status: 204 },
    { path: '/api/filters/cycles/gc1', body: { id: 'gc1', status: 'ON_HOLD', startedAt: d('09-01') } },
    { path: '/api/users', body: { data: [] } },
    ...HIER, LOG, DT_UTC, ...baseRoutes(base),
  ]);
  renderPage(<FilterLifecycleReportPage />, { user: SA, api });
  return api;
}
const selects = () => screen.getAllByRole('combobox') as HTMLSelectElement[];
const opts = (sel: HTMLSelectElement) => Array.from(sel.options).map((o) => o.textContent);
async function pick(index: 0 | 3, value: string) {
  await waitFor(() => expect(Array.from(selects()[index].options).some((o) => o.value === value)).toBe(true));
  fireEvent.change(selects()[index], { target: { value } });
}
const exportVia = async (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Filter Lifecycle Report — sparse records', () => {
  it('on screen: titles fall back to the reason key / "Cycle"; an unknown status keeps its word; unnamed replacement and performer', async () => {
    open();
    await pick(3, 'g1');
    const cycleOdd = await screen.findByRole('button', { name: /ODD/ });
    expect(cycleOdd).toHaveTextContent('ON_HOLD');
    // no start time sorts first in the merged timeline (epoch 0), so the untitled cycle is #1
    expect(screen.getByRole('button', { name: /#1\s*Cycle\b/ })).toBeInTheDocument();
    expect(cycleOdd).toHaveTextContent('#2');
    expect(screen.getByText(/^A B/)).toHaveTextContent('A B → C D');
    expect(screen.getByText('Manual update by unknown user')).toBeInTheDocument();
    expect(screen.getByText('Created as replacement of a previous filter')).toBeInTheDocument();
    expect(screen.getByText('swap')).toBeInTheDocument();
    // an expanded detail with no name or events still opens the SA editor
    fireEvent.click(cycleOdd);
    await screen.findByRole('heading', { name: 'Filter' });
    fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit cleaning record -' })).toBeInTheDocument();
  });

  it('single-filter PDF: an empty detail answer is skipped, undated manual rows print "-", the file name falls back to "scope"', async () => {
    open();
    await pick(3, 'g1');
    await screen.findByRole('button', { name: /ODD/ });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    expect(report.titles().filter((t) => t.startsWith('Cycle '))).toEqual(['Cycle 1 — 2026-09-01 08:00']);
    expect(report.tables().find((t) => t.head?.[0] === 'From').body).toEqual([['A B', 'C D', '-', '-', '-']]);
    expect(report.tables().find((t) => t.head?.[0] === 'Event').body).toEqual([['Created as replacement of a previous filter', '2026-09-03 08:00', '-', 'swap']]);
    expect(report.save.mock.calls[0][0]).toMatch(/lifecycle.*scope.*\.pdf$/);
  });

  it('broad-scope PDF + Excel: sparse cycles, an undated manual update, a performer-less retirement', async () => {
    open();
    await pick(0, 'bz');
    expect(opts(selects()[3])).toEqual(['All in scope', 'G-RET2 (Retired)', 'G-TWO']);
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    const tables = report.tables();
    expect(tables.find((t) => t.head?.[0] === 'Event').body).toEqual([['Retired', '2026-09-02 08:00', '-', '-']]);
    const g2 = tables.filter((t) => t.head?.[1] === 'Cycle').at(-1);
    expect(g2.body).toEqual([
      ['1', '-', '-', '-', '-', 'Completed', '-'],
      ['2', 'ODD', '2026-09-01 08:00', '-', '-', 'ON_HOLD', '-'],
    ]);
    // the RET2 table interleaves its undated manual update
    const ret2 = tables.filter((t) => t.head?.[1] === 'Cycle')[0];
    expect(ret2.body).toContainEqual(['-', 'Manual Update', '-', '-', '-', 'Manual Update', 'A B -> C D']);
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const rows = vi.mocked(exportToExcel).mock.calls[0][0].rows;
    expect(rows).toContainEqual(['G-TWO', '1', '-', '2026-09-01 08:00', '-', '-', 'ON_HOLD', 'ODD']);
    expect(rows).toContainEqual(['G-TWO', '2', '-', '-', '-', '-', 'Completed', '-']);
    expect(rows).toContainEqual(['G-RET2', '', 'Manual: A B → C D', '-', '', '-', 'Manual Update', '-']);
  });

  it('cycle and manual reads page until the total, or an empty page, is reached', async () => {
    const api = open();
    await pick(0, 'bp');
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
    const pages = (path: string) => api.calls('GET', path).filter((r) => r.query.get('filterId') === 'g3').map((r) => r.query.get('page'));
    // the only filter in scope opens on screen (one read sequence) and the export reads again
    expect(pages('/api/filters/cycles')).toEqual(['1', '2', '1', '2']);
    expect(pages('/api/filters/manual-status-changes')).toEqual(['1', '2', '1', '2']);
    expect(vi.mocked(exportToExcel).mock.calls[0][0].rows).toHaveLength(201);
  });

  it('a cancelled PDF password prompt produces no file and no message', async () => {
    const api = open({ reauthActions: ['EXPORT_CLEANING_LIFECYCLE'] });
    await pick(0, 'bz');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await exportVia('PDF');
    await screen.findByPlaceholderText('Enter your password');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(report.save).not.toHaveBeenCalled();
    expect(screen.queryByText(/Export cancelled/)).toBeNull();
  });
});

describe('timeline helpers', () => {
  it('mergeTimeline tolerates missing lists; replacementChain of nothing is empty', () => {
    expect(mergeTimeline(undefined as any, undefined as any)).toEqual([]);
    expect(replacementChain('', new Map(), new Map())).toEqual([]);
  });
});
