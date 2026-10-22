import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * C-05 — `requireExportReauth` re-throws a dismissed export password prompt as
 * REAUTH_CANCELLED ("the caller's catch should treat that as no export"). The
 * RFID Track Record, Quality Notifications and Filters export handlers had no
 * catch: a cancel became an unhandled rejection and a real failure (audit log
 * write refused, PDF build error) reached only the console.
 *
 * RFID Track Record + QNN are mounted for real below. filter-list.tsx is 2,500
 * lines wired to ~40 hooks/endpoints and cannot be mounted in isolation, so its
 * two handlers get a source-level guard instead (see the last describe).
 */

const rows = {
  rfid: { data: [{ id: 'r1', timestamp: '2026-10-01T00:00:00Z', event: 'ASSIGN', rfidNumber: 'E200', filterName: 'F1', ahuName: 'A1', user: 'u', reason: '-' }], total: 1 },
  qnn: { data: [{ id: 'q1', qnn: 'QNN-1', action: 'APPROVED', ahuName: 'A1', message: 'm', performedByName: 'p', createdAt: '2026-10-01T00:00:00Z' }], total: 1 },
};
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (!key) return { data: undefined, mutate: vi.fn() };
    if (key.startsWith('/api/assets/identifiers/track-record')) return { data: rows.rfid, isLoading: false, mutate: vi.fn() };
    if (key === '/api/pm-schedules/qnn/visible') return { data: { visible: true }, mutate: vi.fn() };
    if (key.startsWith('/api/pm-schedules/qnn')) return { data: rows.qnn, isLoading: false, mutate: vi.fn() };
    return { data: undefined, mutate: vi.fn() };
  },
  mutate: vi.fn(),
}));
vi.mock('@/hooks/use-can', () => ({ useCan: () => () => true }));
vi.mock('../../../hooks/use-datetime-format', () => ({ useDatetimeFormat: () => ({ formatDateTime: () => 'dt' }) }));
vi.mock('@/hooks/use-pagination-config', () => ({ usePaginationDefaults: () => ({ options: [25], defaultLimit: 25 }), useReportPageSize: () => [25, () => {}] }));
vi.mock('@/hooks/use-export-limit', () => ({ useExportLimit: () => ({ maxRecords: 100000, tooLargeMessage: () => 'too large' }) }));
vi.mock('@/hooks/use-export-options', () => ({ useExportOptions: () => ({ pdf: false, excel: true }) }));
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/hooks/use-reauth', () => ({ useReauth: () => ({ executeWithResult: vi.fn() }) }));
vi.mock('@/components/reauth-prompt', () => ({ ReauthPrompt: () => null }));
vi.mock('@/components/SendForReviewButton', () => ({ SendForReviewButton: () => null }));
vi.mock('@/components/report-page-wrapper', () => ({ ReportPageWrapper: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/components/super-admin-record-edit', () => ({
  SuperAdminRecordEditDialog: () => null, SuperAdminEditButton: () => null, useIsSuperAdmin: () => false, userOptions: () => [],
}));
vi.mock('@/components/ui/pagination', () => ({ Pagination: () => null }));
vi.mock('../../../lib/api-client', () => ({
  api: { get: async (url: string) => (url.includes('track-record') ? rows.rfid : rows.qnn) },
}));
vi.mock('@/lib/excel-export', () => ({ exportToExcel: vi.fn() }));
const requireExportReauth = vi.fn();
vi.mock('@/lib/report-export-log', async (orig) => ({
  ...(await orig<typeof import('@/lib/report-export-log')>()),
  requireExportReauth: (...a: any[]) => requireExportReauth(...a),
}));

import { RfidTrackRecordPage } from '../rfid-track-record';
import { QualityNotificationsPage } from '../quality-notifications';

const CANCELLED = Object.assign(new Error('Export cancelled'), { error: 'REAUTH_CANCELLED' });

async function unhandledDuring(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const h = (e: unknown) => { seen.push(e); };
  process.on('unhandledRejection', h);
  try { await fn(); await new Promise((r) => setTimeout(r, 20)); } finally { process.off('unhandledRejection', h); }
  return seen;
}

beforeEach(() => { vi.clearAllMocks(); });

describe.each([
  ['RFID Track Record', () => <RfidTrackRecordPage />],
  ['Quality Notifications', () => <QualityNotificationsPage />],
])('C-05 — %s export', (_name, page) => {
  it('a cancelled password prompt is silent and leaves nothing unhandled', async () => {
    requireExportReauth.mockRejectedValue(CANCELLED);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(page());
    const unhandled = await unhandledDuring(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Export as Excel/i }));
      await waitFor(() => expect(requireExportReauth).toHaveBeenCalled());
    });
    expect(unhandled).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('a real failure is shown to the operator', async () => {
    requireExportReauth.mockRejectedValue(new Error('Audit log write failed'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(page());
    fireEvent.click(screen.getByRole('button', { name: /Export as Excel/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Export failed', 'Audit log write failed'));
    err.mockRestore();
  });
});

describe('C-05 — Filters page export handlers (source guard: page cannot mount alone)', () => {
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../filter-list.tsx'), 'utf8');
  const body = (name: string) => {
    const start = src.indexOf(`const ${name} = async () => {`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const end = src.indexOf('\n  };', start);
    return src.slice(start, end);
  };

  it.each(['exportFiltersExcel', 'exportFiltersPdf'])('%s catches around requireExportReauth', (name) => {
    const b = body(name);
    expect(b).toMatch(/requireExportReauth\(/);
    expect(b.indexOf('try {')).toBeGreaterThan(-1);
    expect(b.indexOf('try {')).toBeLessThan(b.indexOf('requireExportReauth('));
    expect(b).toMatch(/catch \(e\) \{ reportExportError\(e\); \}/);
  });

  it('the shared handler is silent on a cancel and toasts anything else', () => {
    const b = src.slice(src.indexOf('const reportExportError = (e: unknown) => {'), src.indexOf('const exportFiltersExcel'));
    expect(b).toMatch(/if \(isReauthCancelled\(e\)\) return;/);
    expect(b).toMatch(/toast\.error\('Export failed'/);
  });
});
