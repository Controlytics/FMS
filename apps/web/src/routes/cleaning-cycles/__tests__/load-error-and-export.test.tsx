import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

/**
 * M63 — none of the three cleaning-cycles pages read SWR's `error`:
 *   - Filter Cleaning Record (history.tsx): a failed fetch read "No records found".
 *   - Cycle detail (timeline.tsx): a failed fetch read "Cycle not found".
 *   - Filter Lifecycle Report: an expanded cycle spun forever, and a failed
 *     retirements / replacements / hierarchy list was silently empty, so a
 *     retired filter and its cycles just vanished from the report.
 * C-05 — `requireExportReauth` re-throws a dismissed password prompt as
 *   REAUTH_CANCELLED; history/timeline had no catch, so a cancel was an
 *   unhandled rejection and a real failure reached only the console.
 * OQ-15 — the sidebar says "Filter Cleaning Record" but the page heading said
 *   "Cleaning Cycles" (default title in lib/report-labels.ts).
 */

type Swr = { data?: any; error?: any; isLoading?: boolean };
const swrByPrefix: Record<string, Swr> = {};
const reloads: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false, mutate: vi.fn() };
    const prefix = Object.keys(swrByPrefix).find((p) => key.startsWith(p));
    const st = prefix ? swrByPrefix[prefix] : {};
    const m = (reloads[prefix ?? key] ??= vi.fn());
    return { data: st.data, error: st.error, isLoading: !!st.isLoading, mutate: m };
  },
  mutate: vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'cyc-1' }),
}));
vi.mock('@/hooks/use-can', () => ({ useCan: () => () => true }));
vi.mock('../../../hooks/use-can', () => ({ useCan: () => () => true }));
vi.mock('../../../hooks/use-auth', () => ({ useAuth: () => ({ user: { role: 'SUPER_ADMIN', permissions: [] } }) }));
vi.mock('../../../hooks/use-datetime-format', () => ({
  useDatetimeFormat: () => ({ formatDateTime: () => 'dt', formatDate: () => 'd', config: {} }),
}));
vi.mock('../../../hooks/use-pagination-config', () => ({ usePaginationDefaults: () => ({ options: [25], defaultLimit: 25 }) }));
vi.mock('@/hooks/use-export-limit', () => ({ useExportLimit: () => ({ maxRecords: 100000, tooLargeMessage: () => 'too large' }) }));
vi.mock('@/hooks/use-export-options', () => ({ useExportOptions: () => ({ pdf: false, excel: true }) }));
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/hooks/use-reauth', () => ({ useReauth: () => ({ executeWithResult: vi.fn() }) }));
vi.mock('@/components/reauth-prompt', () => ({ ReauthPrompt: () => null }));
vi.mock('@/components/SendForReviewButton', () => ({ SendForReviewButton: () => null }));
vi.mock('@/components/super-admin-record-edit', () => ({ SuperAdminEditButton: () => null, useIsSuperAdmin: () => false, PencilIcon: () => null }));
vi.mock('@/components/super-admin-cycle-edit', () => ({ SuperAdminCycleEditDialog: () => null }));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
vi.mock('../cycle-detail-view', () => ({ CycleDetailView: () => <div>cycle detail body</div> }));
const apiGet = vi.fn();
vi.mock('../../../lib/api-client', () => ({ api: { get: (...a: any[]) => apiGet(...a) } }));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
const requireExportReauth = vi.fn();
vi.mock('@/lib/report-export-log', async (orig) => ({
  ...(await orig<typeof import('@/lib/report-export-log')>()),
  requireExportReauth: (...a: any[]) => requireExportReauth(...a),
}));

import { CleaningCycleHistoryPage } from '../history';
import { CleaningCycleTimelinePage } from '../timeline';
import { FilterLifecycleReportPage } from '../filter-lifecycle';

const fail = (status: number, message = 'boom') => Object.assign(new Error(message), { status });
const CANCELLED = Object.assign(new Error('Export cancelled'), { error: 'REAUTH_CANCELLED' });

/** Collects promise rejections nobody handled while `fn` runs. */
async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const h = (e: unknown) => { seen.push(e); };
  process.on('unhandledRejection', h);
  try { await fn(); await new Promise((r) => setTimeout(r, 20)); } finally { process.off('unhandledRejection', h); }
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(swrByPrefix)) delete swrByPrefix[k];
  for (const k of Object.keys(reloads)) delete reloads[k];
});

describe('Filter Cleaning Record (history.tsx)', () => {
  it('M63: a failed load shows an error with Retry, not "No records found"', () => {
    swrByPrefix['/api/filters/cleaning-record'] = { error: fail(500, 'Internal server error') };
    render(<CleaningCycleHistoryPage />);
    expect(screen.queryByText('No records found')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load the cleaning record');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reloads['/api/filters/cleaning-record']).toHaveBeenCalled();
  });

  it('M63: an empty result still says "No records found"', () => {
    swrByPrefix['/api/filters/cleaning-record'] = { data: { data: [], total: 0 } };
    render(<CleaningCycleHistoryPage />);
    expect(screen.getByText('No records found')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('OQ-15: the default heading is "Filter Cleaning Record"', () => {
    swrByPrefix['/api/filters/cleaning-record'] = { data: { data: [], total: 0 } };
    render(<CleaningCycleHistoryPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Filter Cleaning Record');
  });

  describe('C-05: export', () => {
    beforeEach(() => {
      swrByPrefix['/api/filters/cleaning-record'] = { data: { data: [{ id: 'c1', status: 'COMPLETED', events: [] }], total: 1 } };
      apiGet.mockResolvedValue({ data: [{ id: 'c1', status: 'COMPLETED', events: [] }], total: 1 });
    });

    it('a cancelled password prompt is silent and leaves nothing unhandled', async () => {
      requireExportReauth.mockRejectedValue(CANCELLED);
      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<CleaningCycleHistoryPage />);
      const unhandled = await unhandledDuring(async () => {
        fireEvent.click(screen.getByRole('button', { name: /Export as Excel/i }));
        await waitFor(() => expect(requireExportReauth).toHaveBeenCalled());
      });
      expect(unhandled).toEqual([]);
      expect(toast.error).not.toHaveBeenCalled();
      expect(consoleErr).not.toHaveBeenCalled();
      consoleErr.mockRestore();
    });

    it('a real failure is shown to the operator', async () => {
      requireExportReauth.mockRejectedValue(new Error('Audit log write failed'));
      const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<CleaningCycleHistoryPage />);
      fireEvent.click(screen.getByRole('button', { name: /Export as Excel/i }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Export failed', 'Audit log write failed'));
      consoleErr.mockRestore();
    });
  });
});

describe('Cycle detail (timeline.tsx)', () => {
  it('M63: a failed load is not reported as "Cycle not found"', () => {
    swrByPrefix['/api/filters/cycles/'] = { error: fail(500, 'Internal server error') };
    render(<CleaningCycleTimelinePage />);
    expect(screen.queryByText('Cycle not found')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load this cycle');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reloads['/api/filters/cycles/']).toHaveBeenCalled();
  });

  it('M63: a real 404 still reads "Cycle not found"', () => {
    swrByPrefix['/api/filters/cycles/'] = { error: fail(404, 'Not found') };
    render(<CleaningCycleTimelinePage />);
    expect(screen.getByText('Cycle not found')).toBeInTheDocument();
  });

  it('C-05: a cancelled export prompt is silent; a real failure is shown', async () => {
    swrByPrefix['/api/filters/cycles/'] = { data: { id: 'cyc-1', filterName: 'F1', status: 'COMPLETED', startedAt: '2026-10-01T00:00:00Z', events: [] } };
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    requireExportReauth.mockRejectedValueOnce(CANCELLED);
    render(<CleaningCycleTimelinePage />);
    const unhandled = await unhandledDuring(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export as Excel/i }));
      await waitFor(() => expect(requireExportReauth).toHaveBeenCalledTimes(1));
    });
    expect(unhandled).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(consoleErr).not.toHaveBeenCalled();

    requireExportReauth.mockRejectedValueOnce(new Error('Audit log write failed'));
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Export failed', 'Audit log write failed'));
    consoleErr.mockRestore();
  });
});

describe('Filter Lifecycle Report (filter-lifecycle.tsx)', () => {
  const FILTER = { id: 'f1', name: 'FLT-001', status: 'Active', ahuId: 'a1' };

  it('M63: names a failed source list instead of rendering it as empty', () => {
    swrByPrefix['/api/hierarchy/filters'] = { data: { data: [FILTER] } };
    swrByPrefix['/api/filters/retirements'] = { error: fail(500) };
    swrByPrefix['/api/filters/replacements'] = { data: [] };
    render(<FilterLifecycleReportPage />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load Retirements');
    expect(alert).toHaveTextContent(/may be incomplete/);
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(reloads['/api/filters/retirements']).toHaveBeenCalled();
  });

  it('M63: an expanded cycle whose detail fails shows Retry, not an endless spinner', async () => {
    swrByPrefix['/api/hierarchy/filters'] = { data: { data: [FILTER] } };
    swrByPrefix['/api/filters/retirements'] = { data: [] };
    swrByPrefix['/api/filters/replacements'] = { data: [] };
    swrByPrefix['/api/filters/cycles/'] = { error: fail(500, 'Internal server error') };
    apiGet.mockImplementation(async (url: string) => (url.startsWith('/api/filters/cycles?')
      ? { data: [{ id: 'cyc-1', cycleCode: 'CC-1', status: 'COMPLETED', startedAt: '2026-10-01T00:00:00Z' }], total: 1 }
      : { data: [], total: 0 }));
    render(<FilterLifecycleReportPage />);
    // Pick the single filter -> its group opens by default and lists the cycle.
    const filterSelect = screen.getAllByRole('combobox')[3];
    fireEvent.change(filterSelect, { target: { value: 'f1' } });
    const cycleBtn = await screen.findByRole('button', { name: /CC-1/ });
    fireEvent.click(cycleBtn);
    expect(screen.queryByText(/Loading detail/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this cycle');
  });
});
