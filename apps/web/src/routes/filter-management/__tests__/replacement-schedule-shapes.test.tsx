import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, passReauth, expectSigned, type BaseRouteOpts } from './fm-test-kit';

const pdf = { addTable: vi.fn(), save: vi.fn() };
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => pdf) }));
import { createReport } from '@/lib/pdf-report';
import { ReplacementSchedulePage } from '../replacement-schedule';

usePageTestLifecycle();
beforeEach(() => { vi.mocked(createReport).mockClear(); pdf.addTable.mockClear(); pdf.save.mockClear(); });

const BASE_ENTRIES = [
  { id: 'e1', ahuName: 'AHU-1', ahuId: 'a1', filterMicron: '10', filterSize: '610x610', qty: 4, scheduleDate: '2026-11-01T00:00:00Z', toleranceDays: 5, approvalStatus: 'PENDING_REVIEW', submittedByName: 'uploader' },
  { id: 'e2', ahuName: 'AHU-1', ahuId: 'a1', filterMicron: '10', filterSize: '305x610', qty: 2, scheduleDate: '2026-11-02T00:00:00Z', toleranceDays: 5, approvalStatus: 'PENDING_APPROVAL', submittedByName: 'uploader', reviewedByName: 'mgr' },
];
const QA = { role: 'QA', username: 'qa1', permissions: ['REPLACEMENT_SCHEDULE_VIEW', 'REPLACEMENT_SCHEDULE_APPROVE'] };
const VIEWER = { role: 'OPERATOR', username: 'op', permissions: ['REPLACEMENT_SCHEDULE_VIEW'] };

function setup(extra: MockRoute[] = [], base: BaseRouteOpts = {}, entries: any[] = BASE_ENTRIES, filtersEnabled = true, more: any[] = []) {
  return mockApi([
    ...extra,
    { path: '/api/replacement-schedules', body: { data: [{ id: 's1', uploadedByName: 'uploader', createdAt: '2026-10-01T10:00:00Z', entries }, ...more] } },
    { path: '/api/config/replacement-schedule-filters/current', body: { enabled: filtersEnabled } },
    { path: '/api/assets/identifiers', body: { data: [] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: {} },
    ...baseRoutes(base),
  ]);
}
const rowOf = (text: string) => screen.getByText(text).closest('tr')! as HTMLElement;
const qtyOf = (row: HTMLElement) => row.querySelector('td.text-center.text-slate-700:not(.font-medium)')?.textContent;

describe('Replacement Schedule page — data shapes', () => {
  const TIE = [
    { id: 't1', ahuName: 'AHU-X', ahuId: 'ax', filterMicron: '10', filterSize: '600', qty: 1, scheduleDate: '2026-12-05T00:00:00Z', toleranceDays: 1, approvalStatus: 'APPROVED' },
    { id: 't2', ahuName: 'AHU-X', ahuId: 'ax', filterMicron: '10', filterSize: '600', qty: 2, scheduleDate: '2026-12-01T00:00:00Z', toleranceDays: 1, approvalStatus: 'APPROVED' },
    { id: 't3', ahuName: 'AHU-X', ahuId: 'ax', filterMicron: '10', filterSize: '300', qty: 3, scheduleDate: '2026-12-09T00:00:00Z', toleranceDays: 1, approvalStatus: 'SOMETHING_NEW' },
    { id: 't4', ahuName: 'AHU-X', ahuId: 'ax', filterMicron: '5', filterSize: '900', qty: 4, scheduleDate: '2026-12-09T00:00:00Z', toleranceDays: 1 },
    { id: 't5', ahuName: null, filterMicron: null, filterSize: null, qty: 5, scheduleDate: '2026-12-09T00:00:00Z', toleranceDays: 1, approvalStatus: 'APPROVED' },
  ];

  it('sorts by AHU → micron (numeric) → dimensions → date and merges the AHU / micron cells', async () => {
    // a second upload with no `entries` contributes nothing
    const api = setup([], {}, TIE, false, [{ id: 's-empty', createdAt: '2026-09-01T00:00:00Z' }]);
    renderPage(<ReplacementSchedulePage />, { user: VIEWER, api });
    await screen.findByText('900');
    const body = screen.getAllByRole('row').slice(1);
    expect(body.map(qtyOf)).toEqual(['5', '4', '3', '2', '1']);
    expect(screen.getByText('AHU-X').closest('td')).toHaveAttribute('rowspan', '4');
    expect(within(body[2]).getAllByRole('cell').find((c) => c.textContent === '10')).toHaveAttribute('rowspan', '3');
    // an unknown or missing approval status falls back to the Approved chip
    expect(within(body[2]).getByText('Approved')).toBeInTheDocument();
    expect(within(body[1]).getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText('5 scheduled replacement(s)')).toBeInTheDocument();
  });

  it('the upload preview applies the same order and merging', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/validate', body: { rows: TIE.map(({ id, ...r }) => r), results: [] } }]);
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /Upload Schedule/ }));
    fireEvent.change(screen.getByLabelText('Schedule file (.xlsx)'), { target: { files: [new File(['x'], 'a.xlsx')] } });
    await screen.findByText('5 row(s) ready — no errors.');
    const preview = screen.getByRole('heading', { name: 'Upload Replacement Schedule' }).closest('.rounded-2xl') as HTMLElement;
    const rows = within(preview).getAllByRole('row').slice(1);
    // qty column is the 2nd-from-last plain cell in each preview row
    expect(rows.map((r) => within(r).getAllByRole('cell').at(-3)!.textContent)).toEqual(['5', '4', '3', '2', '1']);
    expect(within(preview).getByText('AHU-X').closest('td')).toHaveAttribute('rowspan', '4');
  });

  it('a single entry reads "1 entry"; PDF rows fall back for missing fields and keep an unknown status', async () => {
    const api = setup([], {}, [{ id: 'only', qty: 1, approvalStatus: 'SOMETHING_NEW', toleranceDays: 0 }]);
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    expect(await screen.findByText('· 1 entry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expect(vi.mocked(createReport).mock.calls[0][0].subtitle).toBe('Total: 1 entry');
    expect(pdf.addTable.mock.calls[0][0].body[0]).toEqual(['1', '-', 'NA', 'NA', '1', '-', 'SOMETHING_NEW', '-', '-', '-']);
  });

  it('the PDF status column reads "-" when an entry has no approval status at all', async () => {
    const api = setup([], {}, [{ id: 'only', qty: 1, scheduleDate: '2026-12-01T00:00:00Z' }]);
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('· 1 entry');
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export as PDF/ }));
    await waitFor(() => expect(pdf.save).toHaveBeenCalled());
    expect(pdf.addTable.mock.calls[0][0].body[0][6]).toBe('-');
  });

  it('identifiers served as a plain array still feed the RFID column; a viewer can expand an AHU', async () => {
    const api = setup([
      { path: '/api/assets/identifiers', body: [{ assetId: 'f1', identifierType: 'RFID', identifierValue: 'E9' }] },
      { path: /\/api\/hierarchy\/filters\?ahuId=a1/, body: { data: [{ id: 'f1', name: 'FLT-A' }] } },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: VIEWER, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: 'AHU-1' }));
    expect(await screen.findByText('FLT-A')).toBeInTheDocument();
    expect(rowOf('FLT-A')).toHaveTextContent('E9');
    // no selection column for a viewer -> the expansion row spans 10 columns
    expect(screen.getByText('FLT-A').closest('table')!.closest('td')).toHaveAttribute('colspan', '10');
  });

  it('ticking a row twice unticks it; select-all twice clears the selection', async () => {
    const api = setup();
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    const box = within(rowOf('305x610')).getByRole('checkbox');
    fireEvent.click(box);
    expect(screen.getByText('1 entry selected')).toBeInTheDocument();
    fireEvent.click(box);
    expect(screen.queryByText('1 entry selected')).toBeNull();
    const [all] = screen.getAllByRole('checkbox');
    fireEvent.click(all);
    expect(all).toBeChecked();
    fireEvent.click(all);
    expect(all).not.toBeChecked();
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('a gated reject at approval is signed', async () => {
    const api = setup([{ method: 'POST', path: '/api/replacement-schedules/entries/reject', body: { processed: 1 } }], { reauthActions: ['REJECT_REPLACEMENT_SCHEDULE'] });
    renderPage(<ReplacementSchedulePage />, { user: QA, api });
    await screen.findByText('305x610');
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(within(rowOf('305x610')).getByRole('button', { name: 'Reject' }));
    const dlg = screen.getByRole('heading', { name: 'Reject Entry' }).parentElement!;
    fireEvent.change(within(dlg).getByPlaceholderText('Reason for rejection…'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Reject' }));
    await passReauth();
    expect(await screen.findByText('1 entry rejected')).toBeInTheDocument();
    expectSigned(api.calls('POST', '/api/replacement-schedules/entries/reject')[0]);
  });

  it('validate / upload responses missing optional fields still reach preview / results, with no success toast', async () => {
    const api = setup([
      { method: 'POST', path: '/api/replacement-schedules/validate', body: {} },
      { method: 'POST', path: '/api/replacement-schedules', status: 201, body: {} },
    ]);
    renderPage(<ReplacementSchedulePage />, { user: SA, api });
    await screen.findByText('610x610');
    fireEvent.click(screen.getByRole('button', { name: /Upload Schedule/ }));
    fireEvent.change(screen.getByLabelText('Schedule file (.xlsx)'), { target: { files: [new File(['x'], 'a.xlsx')] } });
    expect(await screen.findByText('0 row(s) ready — no errors.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Upload 0 row(s)' }));
    expect(await screen.findByText('Created')).toBeInTheDocument();
    expect(screen.queryByText('Schedule uploaded')).toBeNull();
  });
});
