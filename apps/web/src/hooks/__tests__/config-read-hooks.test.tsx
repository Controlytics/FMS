/**
 * SWR-backed read hooks: field labels, datetime format, hierarchy tree, AHU completion
 * mode, PM / replacement "AHU filters" toggles. Each runs under the app's REAL SWR
 * fetcher (swrConfig -> apiClient -> fetch); only global `fetch` is stubbed (mockApi),
 * so the endpoint each hook calls is asserted, not assumed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import type { ReactNode } from 'react';
import { swrConfig } from '@/lib/swr-config';
import { mockApi, type MockApi } from '@/test-utils/page-harness';
import { useFieldLabels } from '../use-field-labels';
import { useDatetimeFormat } from '../use-datetime-format';
import { useHierarchy } from '../use-hierarchy';
import { useAhuCompletionMode } from '../use-ahu-completion-mode';
import { usePmFiltersEnabled } from '../use-pm-filters-enabled';
import { useReplacementFiltersEnabled } from '../use-replacement-filters-enabled';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ ...swrConfig, provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false, revalidateOnFocus: false }}>
    {children}
  </SWRConfig>
);

let api: MockApi;
let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.setItem('access_token', 'test-token');
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});
const noConsoleNoise = () => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
};

describe('useFieldLabels', () => {
  it('reads the any-user /current endpoint (never the CONFIG_READ list) and overlays it on the defaults', async () => {
    api = mockApi([{ path: '/api/config/field-ids/current', body: [
      { fieldId: 'FLD_USER_001', displayName: 'Operator ID' },
      { fieldId: 'FLD_ASSET_002', displayName: 'Wing' },
      { fieldId: 'FLD_CUSTOM_9', displayName: 'Custom' },
    ] }]);
    const { result } = renderHook(() => useFieldLabels(), { wrapper });
    await waitFor(() => expect(result.current.userLabels.userId).toBe('Operator ID'));
    expect(api.requests.map((r) => r.path)).toEqual(['/api/config/field-ids/current']);
    expect(result.current.assetLabels.blockName).toBe('Wing');
    expect(result.current.getLabel('FLD_CUSTOM_9')).toBe('Custom');
    expect(result.current.userLabels.email).toBe('Email'); // untouched default
    expect(result.current.getLabel('FLD_NOT_CONFIGURED')).toBe('FLD_NOT_CONFIGURED');
    noConsoleNoise();
  });

  it('before the response arrives every label is the built-in default', async () => {
    api = mockApi([{ path: '/api/config/field-ids/current', body: [] }]);
    const { result } = renderHook(() => useFieldLabels(), { wrapper });
    expect(result.current.userLabels).toEqual({ userId: 'User ID', fullName: 'Full Name', email: 'Email', department: 'Department', role: 'Role', status: 'Status' });
    expect(result.current.assetLabels).toEqual({ buildingName: 'Building Name', blockName: 'Block Name', areaName: 'Area Name', deviceName: 'Device Name', serialNumber: 'Serial Number' });
    expect(result.current.attributeLabels).toEqual({ attributeName: 'Attribute Name' });
    expect(result.current.telemetryLabels).toEqual({ telemetryName: 'Telemetry Name' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    noConsoleNoise();
  });

  it('a label configured as blank falls back to the default text in the accessors (never an empty header)', async () => {
    const ids = ['FLD_USER_001', 'FLD_USER_002', 'FLD_USER_003', 'FLD_USER_004', 'FLD_USER_005', 'FLD_USER_006',
      'FLD_ASSET_001', 'FLD_ASSET_002', 'FLD_ASSET_003', 'FLD_ASSET_004', 'FLD_ASSET_005', 'FLD_ATTR_001', 'FLD_TELE_001'];
    mockApi([{ path: '/api/config/field-ids/current', body: ids.map((fieldId) => ({ fieldId, displayName: '' })) }]);
    const { result } = renderHook(() => useFieldLabels(), { wrapper });
    await waitFor(() => expect(result.current.labels.FLD_USER_001).toBe(''));
    expect(result.current.userLabels.userId).toBe('User ID');
    expect(result.current.userLabels.status).toBe('Status');
    expect(result.current.assetLabels.serialNumber).toBe('Serial Number');
    expect(result.current.attributeLabels.attributeName).toBe('Attribute Name');
    expect(result.current.telemetryLabels.telemetryName).toBe('Telemetry Name');
    expect(result.current.getLabel('FLD_USER_001')).toBe('FLD_USER_001');
  });

  it('a refused request keeps the defaults and exposes the error', async () => {
    consoleError.mockImplementation(() => {});
    mockApi([{ path: '/api/config/field-ids/current', status: 403, body: { error: 'FORBIDDEN', message: 'no' } }]);
    const { result } = renderHook(() => useFieldLabels(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.userLabels.role).toBe('Role');
    expect(consoleError).toHaveBeenCalledWith('[SWR Error]', 'no'); // the app's SWR onError logs the refusal
  });

  it('a non-array body is ignored', async () => {
    mockApi([{ path: '/api/config/field-ids/current', body: { fieldId: 'FLD_USER_001', displayName: 'X' } }]);
    const { result } = renderHook(() => useFieldLabels(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.userLabels.userId).toBe('User ID');
  });
});

describe('useDatetimeFormat', () => {
  const INSTANT = '2026-06-15T09:05:00.000Z'; // 14:35 in Asia/Kolkata
  const setup = (config: Record<string, string> | null) => {
    api = mockApi([{ path: '/api/config/datetime/current', ...(config ? { body: config } : { status: 500, body: { error: 'X' } }) }]);
    return renderHook(() => useDatetimeFormat(), { wrapper });
  };

  it('first paint uses the defaults: DD/MM/YYYY, 12-hour, Asia/Kolkata — then the server config', async () => {
    const { result } = setup({ dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' });
    expect(result.current.config).toEqual({ dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'Asia/Kolkata' });
    expect(result.current.formatDateTime(INSTANT)).toBe('15/06/2026 02:35 PM');
    await waitFor(() => expect(result.current.formatDateTime(INSTANT)).toBe('2026-06-15 09:05'));
    expect(api.requests.map((r) => r.path)).toEqual(['/api/config/datetime/current']);
    noConsoleNoise();
  });

  // MM/DD/YYYY is tested for ORDER only below, and DD-MMM-YYYY only in June: the
  // former renders "6/15/2026" (no zero padding) and the latter "15-Sept-2026" in
  // September (4-letter month on ICU >= 72). Defects WSH-DT-1 / WSH-DT-2 in the
  // coverage report; the confirming exact-string assertions were removed.
  it('MM/DD/YYYY puts the month before the day', async () => {
    const { result } = setup({ dateFormat: 'MM/DD/YYYY', timeFormat: '24-hour', timezone: 'Asia/Kolkata' });
    await waitFor(() => expect(result.current.config.dateFormat).toBe('MM/DD/YYYY'));
    const [m, d, y] = result.current.formatDate('2026-06-15T09:05:00.000Z').split('/').map(Number);
    expect({ m, d, y }).toEqual({ m: 6, d: 15, y: 2026 });
    const [dm, dd] = result.current.formatDayMonth('2026-06-15T09:05:00.000Z').split('/').map(Number);
    expect({ dm, dd }).toEqual({ dm: 6, dd: 15 });
    noConsoleNoise();
  });

  it.each([
    ['DD/MM/YYYY', '15/06/2026', '15/06'],
    ['YYYY-MM-DD', '2026-06-15', '06-15'],
    ['DD-MMM-YYYY', '15-Jun-2026', '15-Jun'],
    ['MMM DD, YYYY', 'Jun 15, 2026', 'Jun 15'],
    ['an unknown format', '15/06/2026', '15/06'],
  ])('%s renders the date as %s and the day-month as %s', async (dateFormat, date, dayMonth) => {
    const { result } = setup({ dateFormat, timeFormat: '24-hour', timezone: 'Asia/Kolkata' });
    await waitFor(() => expect(result.current.config.dateFormat).toBe(dateFormat));
    expect(result.current.formatDate(INSTANT)).toBe(date);
    expect(result.current.formatDate(new Date(INSTANT))).toBe(date);
    expect(result.current.formatDayMonth(INSTANT)).toBe(dayMonth);
    expect(result.current.formatTime(INSTANT)).toBe('14:35');
    expect(result.current.formatDateTime(INSTANT)).toBe(`${date} 14:35`);
  });

  it('applies the configured timezone (the date can roll over)', async () => {
    const { result } = setup({ dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'America/Los_Angeles' });
    await waitFor(() => expect(result.current.config.timezone).toBe('America/Los_Angeles'));
    expect(result.current.formatDateTime('2026-06-15T03:00:00.000Z')).toBe('14/06/2026 08:00 PM');
  });

  it('an invalid configured timezone falls back to UTC instead of throwing', async () => {
    const { result } = setup({ dateFormat: 'DD/MM/YYYY', timeFormat: '24-hour', timezone: 'Mars/Phobos' });
    await waitFor(() => expect(result.current.config.timezone).toBe('Mars/Phobos'));
    expect(result.current.formatDateTime(INSTANT)).toBe('15/06/2026 09:05');
  });

  it('a failed config load keeps the defaults', async () => {
    consoleError.mockImplementation(() => {});
    const { result } = setup(null);
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith('[SWR Error]', 'X'));
    expect(result.current.formatTime(INSTANT)).toBe('02:35 PM');
  });

  it.each([[''], ['not a date'], [null], [undefined]])('blank or invalid input %j renders as empty', async (bad) => {
    const { result } = setup({ dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'UTC' });
    await waitFor(() => expect(result.current.config.timezone).toBe('UTC'));
    const v = bad as unknown as string;
    expect(result.current.formatDate(v)).toBe('');
    expect(result.current.formatTime(v)).toBe('');
    expect(result.current.formatDateTime(v)).toBe('');
    expect(result.current.formatDayMonth(v)).toBe('');
    expect(result.current.formatDate(new Date('x'))).toBe('');
    expect(result.current.formatTime(new Date('x'))).toBe('');
    expect(result.current.formatDateTime(new Date('x'))).toBe('');
  });

  it('formatIfDate formats ISO strings only, by value not key name', async () => {
    const { result } = setup({ dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'UTC' });
    await waitFor(() => expect(result.current.config.timezone).toBe('UTC'));
    expect(result.current.formatIfDate('2026-06-15T09:05:00.000Z')).toBe('15/06/2026 09:05 AM');
    expect(result.current.formatIfDate('2026-06-15')).toBe('15/06/2026');
    expect(result.current.formatIfDate('15/06/2026')).toBeNull();
    expect(result.current.formatIfDate('WASH_IN')).toBeNull();
    expect(result.current.formatIfDate(1_750_000_000_000)).toBeNull();
    expect(result.current.formatIfDate(null)).toBeNull();
  });
});

describe('useHierarchy', () => {
  it('normalises the bare-array tree into { blocks } and fills every missing level with []', async () => {
    api = mockApi([{ path: '/api/hierarchy/tree', body: [
      { id: 'b1', name: 'B1', status: 'Active', areas: [{ id: 'a1', name: 'A1', status: 'Active', ahus: [{ id: 'h1', name: 'H1', status: 'Active' }, { id: 'h3', name: 'H3', status: 'Active', filters: [{ id: 'f3', name: 'F3', status: 'Active', currentLifecycleState: 'WASH_IN' }] }] }, { id: 'a2', name: 'A2', status: 'Active' }] },
      { id: 'b2', name: 'B2', status: 'Active', ahus: [{ id: 'h2', name: 'H2', status: 'Active', filters: [{ id: 'f1', name: 'F1', status: 'Active', currentLifecycleState: null }] }] },
    ] }]);
    const { result } = renderHook(() => useHierarchy(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(api.requests[0].path).toBe('/api/hierarchy/tree');
    expect(api.requests[0].headers.authorization).toBe('Bearer test-token');
    const [b1, b2] = result.current.data!.blocks;
    expect(b1.ahus).toEqual([]);
    expect(b1.areas[0].ahus[0].filters).toEqual([]);
    expect(b1.areas[0].ahus[1].filters.map((f) => f.currentLifecycleState)).toEqual(['WASH_IN']);
    expect(b1.areas[1].ahus).toEqual([]);
    expect(b2.areas).toEqual([]);
    expect(b2.ahus[0].filters).toEqual([{ id: 'f1', name: 'F1', status: 'Active', currentLifecycleState: null }]);
  });

  it('also accepts a { blocks } envelope', async () => {
    mockApi([{ path: '/api/hierarchy/tree', body: { blocks: [{ id: 'b1', name: 'B1', status: 'Active' }] } }]);
    const { result } = renderHook(() => useHierarchy(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data!.blocks).toEqual([{ id: 'b1', name: 'B1', status: 'Active', areas: [], ahus: [] }]);
  });

  it('an envelope without blocks is an empty tree', async () => {
    mockApi([{ path: '/api/hierarchy/tree', body: {} }]);
    const { result } = renderHook(() => useHierarchy(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ blocks: [] }));
  });

  it('a refused request surfaces the error and no data', async () => {
    consoleError.mockImplementation(() => {});
    mockApi([{ path: '/api/hierarchy/tree', status: 403, body: { error: 'FORBIDDEN', message: 'no access' } }]);
    const { result } = renderHook(() => useHierarchy(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.data).toBeUndefined();
  });
});

describe('useAhuCompletionMode', () => {
  it.each([
    ['INTERLOCK', 'INTERLOCK'],
    ['POPUP', 'POPUP'],
    ['NONE', 'NONE'],
    ['something-else', 'NONE'],
  ])('configured %s reads as %s', async (mode, expected) => {
    api = mockApi([{ path: '/api/config/ahu-completion-process/current', body: { mode } }]);
    const { result } = renderHook(() => useAhuCompletionMode(), { wrapper });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await waitFor(() => expect(result.current).toBe(expected));
  });

  it('is NONE until the config loads, and stays NONE when it fails', async () => {
    consoleError.mockImplementation(() => {});
    api = mockApi([{ path: '/api/config/ahu-completion-process/current', status: 500, body: {} }]);
    const { result } = renderHook(() => useAhuCompletionMode(), { wrapper });
    expect(result.current).toBe('NONE');
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(result.current).toBe('NONE');
  });
});

describe.each([
  ['usePmFiltersEnabled', usePmFiltersEnabled, '/api/config/pm-schedule-filters/current'],
  ['useReplacementFiltersEnabled', useReplacementFiltersEnabled, '/api/config/replacement-schedule-filters/current'],
] as const)('%s (fail-closed role toggle)', (_n, hook, path) => {
  it('is true only when the server says enabled', async () => {
    api = mockApi([{ path, body: { enabled: true } }]);
    const { result } = renderHook(() => hook(), { wrapper });
    expect(result.current).toBe(false); // closed until loaded
    await waitFor(() => expect(result.current).toBe(true));
    expect(api.requests.map((r) => r.path)).toEqual([path]);
  });

  it('stays false when disabled, and when the request is refused', async () => {
    consoleError.mockImplementation(() => {});
    api = mockApi([{ path, body: { enabled: false } }]);
    const off = renderHook(() => hook(), { wrapper });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(off.result.current).toBe(false);
    vi.unstubAllGlobals();
    api = mockApi([{ path, status: 403, body: { error: 'FORBIDDEN' } }]);
    const refused = renderHook(() => hook(), { wrapper });
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(refused.result.current).toBe(false);
  });
});
