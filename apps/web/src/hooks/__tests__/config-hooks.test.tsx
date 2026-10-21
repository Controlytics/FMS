import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi, type MockApi, type MockRequest } from '@/test-utils/page-harness';
import { EXPORT_LIMIT_DEFAULT_MAX, EXPORT_LIMIT_DEFAULT_MESSAGE, BACKUP_FORMAT_DEFAULT } from '@digilog/shared';
import { useExportLimit } from '../use-export-limit';
import { useExportOptions } from '../use-export-options';
import { useReportLabels } from '../use-report-labels';
import { useReportPageTitles } from '../use-report-page-titles';
import { useBackupFormat } from '../use-backup-format';
import { usePaginationConfig, usePaginationDefaults } from '../use-pagination-config';

/**
 * The small read-only config hooks. Each runs through the app's REAL data path
 * (SWR + the shared `swrConfig` fetcher -> apiClient -> fetch); only `fetch` is
 * stubbed (page-harness `mockApi`). Every hook is asserted on BOTH sides: the
 * built-in fallback while/when the config is absent, and the configured value.
 */

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    {children}
  </SWRConfig>
);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.setItem('access_token', 'tok');
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  api?.restore();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

/** Normal use: no console noise. */
const expectQuietConsole = () => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
};

describe('useExportLimit', () => {
  it('uses the shared defaults until the config arrives', () => {
    api = mockApi([{ path: '/api/config/export-limit/current', body: {} }]);
    const { result } = renderHook(() => useExportLimit(), { wrapper });
    expect(result.current.maxRecords).toBe(EXPORT_LIMIT_DEFAULT_MAX);
    expect(result.current.tooLargeMessage(12345)).toBe(
      EXPORT_LIMIT_DEFAULT_MESSAGE.replace('{count}', (12345).toLocaleString()).replace('{max}', EXPORT_LIMIT_DEFAULT_MAX.toLocaleString()),
    );
  });

  it('applies the configured max and message, substituting every {count} / {max}', async () => {
    api = mockApi([{ path: '/api/config/export-limit/current', body: { maxRecords: 2500, message: '{count} > {max}! ({count} rows, cap {max})' } }]);
    const { result } = renderHook(() => useExportLimit(), { wrapper });
    await waitFor(() => expect(result.current.maxRecords).toBe(2500));
    expect(result.current.tooLargeMessage(3000)).toBe(
      `${(3000).toLocaleString()} > ${(2500).toLocaleString()}! (${(3000).toLocaleString()} rows, cap ${(2500).toLocaleString()})`,
    );
    expect(api.calls('GET', '/api/config/export-limit/current')[0].headers.authorization).toBe('Bearer tok');
    expectQuietConsole();
  });

  it('floors a fractional limit and never goes below 1', async () => {
    api = mockApi([{ path: '/api/config/export-limit/current', body: { maxRecords: 0.4 } }]);
    const { result } = renderHook(() => useExportLimit(), { wrapper });
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    await waitFor(() => expect(result.current.maxRecords).toBe(1));
  });

  it('an empty configured message falls back to the default template', async () => {
    api = mockApi([{ path: '/api/config/export-limit/current', body: { maxRecords: 7, message: '' } }]);
    const { result } = renderHook(() => useExportLimit(), { wrapper });
    await waitFor(() => expect(result.current.maxRecords).toBe(7));
    expect(result.current.tooLargeMessage(9)).toContain('exceeds the maximum export limit of 7');
  });
});

describe('useExportOptions', () => {
  it('is fail-open (both formats) while loading and for a surface with no entry', async () => {
    api = mockApi([{ path: '/api/config/export-options/current', body: { audit: 'PDF' } }]);
    const { result } = renderHook(() => useExportOptions('filters'), { wrapper });
    expect(result.current).toEqual({ pdf: true, excel: true });
    await waitFor(() => expect(api.requests.length).toBe(1));
    expect(result.current).toEqual({ pdf: true, excel: true });
  });

  it('restricts to the configured format for the surface', async () => {
    api = mockApi([{ path: '/api/config/export-options/current', body: { audit: 'PDF', pm: 'EXCEL', qnn: 'NONE' } }]);
    const audit = renderHook(() => useExportOptions('audit'), { wrapper });
    await waitFor(() => expect(audit.result.current).toEqual({ pdf: true, excel: false }));
    const pm = renderHook(() => useExportOptions('pm'), { wrapper });
    await waitFor(() => expect(pm.result.current).toEqual({ pdf: false, excel: true }));
    const qnn = renderHook(() => useExportOptions('qnn'), { wrapper });
    await waitFor(() => expect(qnn.result.current).toEqual({ pdf: false, excel: false }));
    expectQuietConsole();
  });
});

describe('useReportLabels', () => {
  it('resolves the built-in labels with no config, then the override once it loads', async () => {
    api = mockApi([{ path: '/api/config/report-labels/current', body: { 'audit-trail': { title: 'System Audit', columns: { user: 'Operator' } } } }]);
    const { result } = renderHook(() => useReportLabels(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.labelsFor('audit-trail').title).toBe('Audit Trail');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const l = result.current.labelsFor('audit-trail');
    expect(l.title).toBe('System Audit');
    expect(l.columns.user).toBe('Operator');
    expect(l.columns.action).toBe('Action');
    expect(result.current.config).toEqual({ 'audit-trail': { title: 'System Audit', columns: { user: 'Operator' } } });
    expectQuietConsole();
  });

  it('a failed config load still yields the defaults', async () => {
    api = mockApi([{ path: '/api/config/report-labels/current', status: 403, body: { error: 'FORBIDDEN', message: 'no' } }]);
    const { result } = renderHook(() => useReportLabels(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.config).toEqual({});
    expect(result.current.labelsFor('rfid-track-record').title).toBe('RFID Track Record');
  });
});

describe('useReportPageTitles', () => {
  it('falls back to Branding for blank overrides and uses trimmed overrides when set', async () => {
    api = mockApi([
      { path: '/api/config/branding', body: { companyName: 'Acme Pharma', appName: 'FMS' } },
      { path: '/api/config/report-page-titles/current', body: { companyName: '  Report Co ', appName: '   ' } },
    ]);
    const { result } = renderHook(() => useReportPageTitles(), { wrapper });
    await waitFor(() => expect(result.current.companyName).toBe('Report Co'));
    await waitFor(() => expect(result.current.appName).toBe('FMS'));
    expect(result.current.branding.companyName).toBe('Acme Pharma');
    expectQuietConsole();
  });

  it('with no override at all, both names come from Branding', async () => {
    api = mockApi([
      { path: '/api/config/branding', body: { companyName: 'Acme Pharma', appName: 'FMS' } },
      { path: '/api/config/report-page-titles/current', body: {} },
    ]);
    const { result } = renderHook(() => useReportPageTitles(), { wrapper });
    await waitFor(() => expect(result.current.companyName).toBe('Acme Pharma'));
    expect(result.current.appName).toBe('FMS');
  });
});

describe('useBackupFormat', () => {
  it('reports loading, then the configured default', async () => {
    api = mockApi([{ path: '/api/config/backup-format/current', body: { defaultFormat: 'json' } }]);
    const { result } = renderHook(() => useBackupFormat(), { wrapper });
    expect(result.current).toEqual({ defaultFormat: BACKUP_FORMAT_DEFAULT, isLoading: true });
    await waitFor(() => expect(result.current).toEqual({ defaultFormat: 'json', isLoading: false }));
    expectQuietConsole();
  });

  it('a stored format that is no longer offered falls back to the built-in default', async () => {
    api = mockApi([{ path: '/api/config/backup-format/current', body: { defaultFormat: 'zip' } }]);
    const { result } = renderHook(() => useBackupFormat(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.defaultFormat).toBe(BACKUP_FORMAT_DEFAULT);
  });
});

describe('usePaginationConfig / usePaginationDefaults', () => {
  it('default to [10, 25, 50] and a 20-row page before the config loads', () => {
    api = mockApi([{ path: '/api/config/pagination/current', body: {} }]);
    expect(renderHook(() => usePaginationConfig(), { wrapper }).result.current).toEqual([10, 25, 50]);
    expect(renderHook(() => usePaginationDefaults(), { wrapper }).result.current).toEqual({ options: [10, 25, 50], defaultLimit: 20 });
  });

  it('use the configured options and default limit', async () => {
    api = mockApi([{ path: '/api/config/pagination/current', body: (_req: MockRequest) => ({ limit: 30, count: 3, options: [15, 30, 60] }) }]);
    const cfg = renderHook(() => usePaginationConfig(), { wrapper });
    await waitFor(() => expect(cfg.result.current).toEqual([15, 30, 60]));
    const defs = renderHook(() => usePaginationDefaults(), { wrapper });
    await waitFor(() => expect(defs.result.current).toEqual({ options: [15, 30, 60], defaultLimit: 30 }));
    expectQuietConsole();
  });
});
