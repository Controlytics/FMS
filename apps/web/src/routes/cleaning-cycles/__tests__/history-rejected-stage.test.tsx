/**
 * D03-08 (2026-10-22): a stage rejected at approval and redone. The Filter
 * Cleaning Record — its table, its Excel and its PDF — shows the attempt that
 * COUNTS: the latest entry into the stage (the shared latestEntryIntoStage rule,
 * via getStageInfo). It used to show the FIRST transition, i.e. the rejected
 * attempt (Wash Out 20:59 by opA, rejected, redone 21:04 by opB: the record read
 * 20:59 / opA). The rejected attempt stays in the cycle's lifecycle and the
 * audit trail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute, type MockRequest } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, fakeReport } from './cycles-fixtures';

let report = fakeReport();
vi.mock('@/lib/pdf-report', () => ({ createReport: vi.fn(async () => report) }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
import { exportToExcel } from '@/lib/excel-export';
import { CleaningCycleHistoryPage } from '../history';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });
beforeEach(() => { report = fakeReport(); vi.mocked(exportToExcel).mockClear(); });

const T = (hhmm: string) => `2026-10-22T${hhmm}:00.000Z`;
const tr = (from: string | null, to: string, at: string, by: string, attributes: Record<string, unknown> = {}) =>
  ({ id: `${to}-${at}`, eventType: 'STATE_TRANSITION', fromState: from, toState: to, performedAt: at, performedByName: by, attributes });

const C_REJ = {
  id: 'c-rej', filterId: 'f1', filterName: 'FLT-REJ', status: 'COMPLETED', startedAt: T('20:30'),
  profileStages: ['WASH_IN', 'WASH_OUT', 'DRY_IN', 'DRY_OUT'], dryerDurationMinutes: 30, dryerStartedAt: T('21:10'),
  events: [
    tr(null, 'WASH_IN', T('20:30'), 'opA', { instrumentReadings: [{ description: 'RO water', value: 2, uom: 'bar' }] }),
    tr('WASH_IN', 'WASH_OUT', T('20:59'), 'opA'),
    // The approver's rejection: the filter goes back to Wash In.
    tr('WASH_OUT', 'WASH_IN', T('21:00'), 'qa1', { kind: 'STAGE_INTERLOCK_REJECTED', stageKey: 'WASH_OUT' }),
    tr('WASH_IN', 'WASH_OUT', T('21:04'), 'opB'),
    tr('WASH_OUT', 'DRY_IN', T('21:10'), 'opB', { action: 'DRYER_STARTED', dryerDurationMinutes: 30 }),
    tr('DRY_IN', 'DRY_IN', T('21:40'), 'opB', { action: 'DRYER_READINGS_SUBMITTED', instrumentReadings: [{ description: 'Dryer temperature', value: 60, uom: '°C' }] }),
    tr('DRY_IN', 'DRY_OUT', T('22:00'), 'opB'),
  ],
};

function open() {
  const record: MockRoute = {
    path: '/api/filters/cleaning-record',
    body: (req: MockRequest) => (req.query.get('limit') === '100'
      ? { data: Number(req.query.get('page')) === 1 ? [C_REJ] : [], total: 1 }
      : { data: [C_REJ], total: 1, totalPages: 1 }),
  };
  const api = mockApi([
    record,
    { path: '/api/hierarchy/filters', body: { data: [{ id: 'f1', name: 'FLT-REJ', status: 'Active' }] } },
    { path: '/api/hierarchy/blocks', body: { data: [] } },
    { method: 'POST', path: '/api/audit/report-export-log', status: 201, body: { ok: true } },
    DT_UTC,
    ...baseRoutes(),
  ]);
  renderPage(<CleaningCycleHistoryPage />, { user: SA, api });
  return api;
}
const cells = () =>
  within(screen.getByText('FLT-REJ', { selector: 'td div' }).closest('tr')!).getAllByRole('cell').map((c) => c.textContent);
const exportVia = async (fmt: 'PDF' | 'Excel') => {
  fireEvent.click(await screen.findByRole('button', { name: /^Export$/ }));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`Export as ${fmt}`) }));
};

describe('Filter Cleaning Record — a stage rejected at approval and redone (D03-08)', () => {
  it('the table shows the redone Wash Out (21:04), never the rejected one (20:59) or the approver', async () => {
    open();
    await screen.findByText('FLT-REJ', { selector: 'td div' });
    const row = cells();
    expect(row.slice(5, 8)).toEqual(['2026-10-22 20:30', '2026-10-22 21:04', 'opA']);
    expect(row.join('|')).not.toContain('20:59');
    expect(row).not.toContain('qa1');
  });

  it('the Excel export carries the same row', async () => {
    open();
    await screen.findByText('FLT-REJ', { selector: 'td div' });
    await exportVia('Excel');
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    const xl = vi.mocked(exportToExcel).mock.calls[0][0].rows[0];
    expect(xl.slice(4, 8)).toEqual(['2 bar', '2026-10-22 20:30', '2026-10-22 21:04', 'opA']);
    expect(xl.join('|')).not.toContain('20:59');
  });

  it('the PDF table carries the same row', async () => {
    open();
    await screen.findByText('FLT-REJ', { selector: 'td div' });
    await exportVia('PDF');
    await waitFor(() => expect(report.save).toHaveBeenCalled());
    const body = report.tables()[0].body[0];
    expect(body.slice(5, 8)).toEqual(['2026-10-22 20:30', '2026-10-22 21:04', 'opA']);
    expect(body.join('|')).not.toContain('20:59');
  });
});
