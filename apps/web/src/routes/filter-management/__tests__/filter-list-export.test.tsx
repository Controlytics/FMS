import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, SA, role, passReauth, expectSigned } from './fm-test-kit';
import { setupApi, renderFilters, openFiltersTab, openBlock, cancelReauth, waitForReauthConfig } from './filter-list-fixtures';

const pdf = { addTable: vi.fn(), save: vi.fn(), getSnapshot: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { createReport } from '@/lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); vi.mocked(exportToExcel).mockReset(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const EXPORTER = role('QA', ['ASSET_READ', 'FILTER_LIST_EXPORT']);
const LOG = { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } } as const;
const openMenu = (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Filters page — export', () => {
  it('Excel: the audit log is written FIRST, then the sheet gets the block rows (all pages, not just the visible one)', async () => {
    const api = setupApi({ extra: [LOG] });
    vi.mocked(exportToExcel).mockImplementation(async () => {
      expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(1);
    });
    renderFilters(EXPORTER, api);
    await openFiltersTab();
    openMenu('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Filters', format: 'Excel', recordCount: 7 });
    const arg = vi.mocked(exportToExcel).mock.calls[0][0];
    expect(arg.filename).toBe('Block-Alpha-filters');
    expect(arg.sheetName).toBe('Filters');
    expect(arg.head).toEqual(['S.No', 'Area', 'AHU', 'AHU Type', 'Filter', 'Filter Type', 'Micron Size', 'Filter Dimensions', 'Set', 'Last Cleaned', 'Status', 'RFID']);
    const byName = Object.fromEntries(arg.rows.map((r) => [r[4], r]));
    expect(byName['PF-001']).toEqual([expect.any(Number), 'Area North', 'AHU-01', 'Process', 'PF-001', 'Pre', '10', '610x610', 'Set A', expect.not.stringMatching(/^NA$/), 'Wash In', 'E200AA']);
    expect(byName['PF-002'].slice(8)).toEqual(['Set B', 'NA', 'To Be Cleaned', '']);
    expect(byName['HF-007'].slice(1, 4)).toEqual(['', 'AHU-02', '']);
    expect(byName['HF-007'][8]).toBe('');
    expect(byName['HF-007'][10]).toBe('CUSTOM STATE');
    expect(arg.rows.map((r) => r[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('PDF: report built from the same rows; logged; saved under the block name', async () => {
    const api = setupApi({ extra: [LOG] });
    renderFilters(EXPORTER, api);
    await openFiltersTab();
    // narrow with search: the export follows what the operator is looking at
    fireEvent.change(screen.getByPlaceholderText('Search filters…'), { target: { value: 'PF-00' } });
    openMenu('PDF');
    await waitFor(() => expect(pdf.save).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createReport).mock.calls[0][0]).toMatchObject({
      reportKey: 'filters', title: 'Filters', subtitle: 'Block: Block Alpha  |  Total: 6 filter(s)', orientation: 'landscape',
      legend: [{ abbr: 'NA', meaning: 'Not Applicable' }],
    });
    const table = pdf.addTable.mock.calls[0][0];
    expect(table.body).toHaveLength(6);
    expect(table.body.every((r: unknown[]) => r.every((c) => typeof c === 'string'))).toBe(true);
    expect(api.calls('POST', '/api/audit/report-export-log')[0].json).toEqual({ reportType: 'Filters', format: 'PDF', recordCount: 6 });
    expect(pdf.save.mock.calls[0][0]).toMatch(/^Block-Alpha.*\.pdf$/);
  });

  it('over the export limit: refused with the configured message; nothing logged or built', async () => {
    const api = setupApi({ extra: [LOG], base: { exportLimit: { maxRecords: 3, message: 'Max {max}, you asked {count}' } } });
    renderFilters(EXPORTER, api);
    await openFiltersTab();
    openMenu('Excel');
    expect(await screen.findByText('Max 3, you asked 7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    openMenu('PDF');
    expect(await screen.findByText('Max 3, you asked 7')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/report-export-log')).toHaveLength(0);
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(createReport).not.toHaveBeenCalled();
  });

  it('a gated export prompts; the signed log write precedes the file; a cancel is silent', async () => {
    const api = setupApi({ extra: [LOG], base: { reauthActions: ['EXPORT_FILTERS'] } });
    renderFilters(EXPORTER, api);
    await waitForReauthConfig(api);
    await openFiltersTab();
    openMenu('Excel');
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(screen.queryByText('Export failed')).toBeNull();
    openMenu('PDF');
    await passReauth();
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expectSigned(api.calls('POST', '/api/audit/report-export-log')[0]);
  });

  it('a real failure (PDF build error) is shown as "Export failed"', async () => {
    const api = setupApi({ extra: [LOG] });
    vi.mocked(createReport).mockRejectedValueOnce(new Error('Font table missing'));
    renderFilters(EXPORTER, api);
    await openFiltersTab();
    openMenu('PDF');
    expect(await screen.findByText('Font table missing')).toBeInTheDocument();
    expect(screen.getByText('Export failed')).toBeInTheDocument();
  });

  it('an Excel generation failure is shown as "Export failed"', async () => {
    const api = setupApi({ extra: [LOG] });
    vi.mocked(exportToExcel).mockImplementation(() => { throw new Error('Workbook writer crashed'); });
    renderFilters(EXPORTER, api);
    await openFiltersTab();
    openMenu('Excel');
    expect(await screen.findByText('Workbook writer crashed')).toBeInTheDocument();
  });

  it('the role-wise export matrix: Excel-only shows a single "Export as Excel" button', async () => {
    const api = setupApi({ extra: [LOG], base: { exportOptions: { filters: 'EXCEL' } } });
    renderFilters(EXPORTER, api);
    await openFiltersTab();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export as Excel' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Export$/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export as Excel' }));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalled());
  });

  it('no Export without FILTER_LIST_EXPORT; SA has it; an empty block offers none', async () => {
    const { unmount } = renderFilters(role('X', ['ASSET_READ']), setupApi());
    await openFiltersTab();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
    unmount();
    localStorage.clear();
    renderFilters(SA, setupApi());
    await openBlock('Block Beta');
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(await screen.findByText('No filters in this block')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });
});
