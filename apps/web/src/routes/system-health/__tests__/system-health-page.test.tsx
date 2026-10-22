import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { SystemHealthPage } from '../index';

/** System Health page: real SWR -> apiClient -> fetch; only fetch is stubbed. */

const GB = 1024 ** 3;
const HEALTH = (over: Record<string, any> = {}) => ({
  os: { hostname: 'FMS-SRV-01', platform: 'win32', arch: 'x64', release: '10.0.26300', uptimeSeconds: 90061, loadAvg: { '1m': 0.5, '5m': 0.25, '15m': 0.1 } },
  memory: { totalBytes: 16 * GB, usedBytes: 8 * GB, freeBytes: 8 * GB, usagePercent: 50 },
  cpu: { cores: 8, model: 'Intel Xeon Silver 4310', usagePercent: 75 },
  disk: { totalBytes: 512 * GB, usedBytes: 480 * GB, freeBytes: 32 * GB, usagePercent: 95, available: true, path: 'C:\\' },
  process: { nodeVersion: 'v20.11.1', pid: 4242, uptimeSeconds: 42, memoryUsage: { rss: 1536, heapTotal: 200 * 1024 * 1024, heapUsed: 50 * 1024 * 1024, external: 0 } },
  api: { totalRequests: 123456, requestsPerMinute: 37 },
  database: { connected: true, databaseSize: '84 MB', activeConnections: 6, totalTables: 61 },
  timestamp: '2026-10-20T08:30:00.000Z',
  ...over,
});

const routes = (body: unknown, extra: MockRoute[] = []): MockRoute[] => [
  ...extra,
  ...commonConfigRoutes(),
  { path: '/api/system-health', body },
];

/** The coloured inner bar of the ProgressBar inside the card titled `title`. */
function barIn(title: string): HTMLElement {
  const card = screen.getByRole('heading', { name: title }).closest('.rounded-xl') as HTMLElement;
  return card.querySelector('.h-full.rounded-full') as HTMLElement;
}

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { vi.useRealTimers(); cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

const SA = { role: 'SUPER_ADMIN', permissions: [] };

describe('System Health — metrics', () => {
  it('shows the loading state, then every metric formatted for a reader', async () => {
    const api = mockApi(routes(HEALTH()));
    renderPage(<SystemHealthPage />, { user: SA, api });
    expect(screen.getByText('Loading system metrics...')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'System Health' })).toBeInTheDocument();
    // header subtitle: server + time in the configured (24-hour, UTC) format
    expect(screen.getByText(/Server: FMS-SRV-01/)).toHaveTextContent('Last updated: 08:30');
    // uptime: days/hours/minutes, and seconds only when under a minute
    expect(screen.getByText('1d 1h 1m')).toBeInTheDocument();
    expect(screen.getByText('42s')).toBeInTheDocument();
    expect(screen.getByText('win32 x64')).toBeInTheDocument();
    // big numbers are grouped
    expect(screen.getAllByText((123456).toLocaleString())).toHaveLength(2);
    expect(screen.getByText('37 req/min')).toBeInTheDocument();
    // bytes
    expect(screen.getAllByText('8.0 GB / 16.0 GB').length).toBeGreaterThan(0);
    expect(screen.getByText('480.0 GB / 512.0 GB')).toBeInTheDocument();
    expect(screen.getByText('32.0 GB')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    expect(screen.getByText('50.0 MB / 200.0 MB')).toBeInTheDocument();
    // cpu + load average
    expect(screen.getByText('8 cores')).toBeInTheDocument();
    expect(screen.getByTitle('Intel Xeon Silver 4310')).toBeInTheDocument();
    expect(screen.getByText('0.25', { exact: false })).toBeInTheDocument();
    // database + process
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('84 MB')).toBeInTheDocument();
    expect(screen.getByText('61')).toBeInTheDocument();
    expect(screen.getByText('v20.11.1')).toBeInTheDocument();
    expect(screen.getByText('4242')).toBeInTheDocument();
    expect(screen.getByText('10.0.26300')).toBeInTheDocument();
    expect(api.unmatched).toEqual([]);
  });

  it('progress bars: normal colour up to 70 %, amber above 70 %, red above 90 %, clamped to 0–100', async () => {
    const api = mockApi(routes(HEALTH({ cpu: { cores: 4, model: 'X', usagePercent: 140 } })));
    renderPage(<SystemHealthPage />, { user: SA, api });
    await screen.findByRole('heading', { name: 'System Health' });

    const mem = barIn('Memory (RAM)');
    expect(mem).toHaveClass('bg-amber-500'); // 50 % uses the card's own colour (amber for memory)
    expect(mem.style.width).toBe('50%');
    const cpu = barIn('CPU');
    expect(cpu).toHaveClass('bg-red-500');
    expect(cpu.style.width).toBe('100%'); // 140 % clamped
    const disk = barIn('Disk');
    expect(disk).toHaveClass('bg-red-500');
    expect(disk.style.width).toBe('95%');
    const heap = barIn('Node.js Process');
    expect(heap).toHaveClass('bg-lime-500');
    expect(heap.style.width).toBe('25%');
  });

  it('a value between 70 and 90 % turns amber; a zero heap total reads 0 %', async () => {
    const h = HEALTH();
    const api = mockApi(routes({
      ...h,
      disk: { ...h.disk, usagePercent: 80 },
      process: { ...h.process, memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 } },
    }));
    renderPage(<SystemHealthPage />, { user: SA, api });
    await screen.findByRole('heading', { name: 'System Health' });
    expect(barIn('Disk')).toHaveClass('bg-amber-500');
    expect(barIn('Disk').style.width).toBe('80%');
    expect(barIn('Node.js Process').style.width).toBe('0%');
    expect(screen.getAllByText('0 B').length).toBeGreaterThan(0);
  });

  it('an unmeasurable disk says so (with its path) instead of showing a healthy 0 %', async () => {
    const h = HEALTH();
    const api = mockApi(routes({ ...h, disk: { totalBytes: null, usedBytes: null, freeBytes: null, usagePercent: null, available: false, path: 'D:\\data' } }));
    renderPage(<SystemHealthPage />, { user: SA, api });
    const note = await screen.findByTestId('disk-unavailable');
    expect(note).toHaveTextContent('Disk usage could not be measured for D:\\data. See the server log.');
    expect(screen.queryByText('0 B / 0 B')).toBeNull();
  });

  it('a null usage without a path still reads as unmeasured', async () => {
    const h = HEALTH();
    const api = mockApi(routes({ ...h, disk: { totalBytes: null, usedBytes: null, freeBytes: null, usagePercent: null } }));
    renderPage(<SystemHealthPage />, { user: SA, api });
    expect(await screen.findByTestId('disk-unavailable')).toHaveTextContent('Disk usage could not be measured. See the server log.');
  });

  it('a disconnected database is shown as Disconnected with a red dot', async () => {
    const h = HEALTH();
    const api = mockApi(routes({ ...h, database: { ...h.database, connected: false } }));
    renderPage(<SystemHealthPage />, { user: SA, api });
    const label = await screen.findByText('Disconnected');
    expect(label.previousElementSibling).toHaveClass('bg-red-500');
  });
});

describe('System Health — refresh controls', () => {
  it('a failed load offers Retry, which loads the metrics', async () => {
    const api = mockApi(routes(HEALTH(), [
      { path: '/api/system-health', status: 500, times: 1, body: { error: 'INTERNAL', message: 'os probe failed' } },
    ]));
    renderPage(<SystemHealthPage />, { user: SA, api });
    expect(await screen.findByText('Failed to load system health data.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'System Health' })).toBeInTheDocument();
    expect(api.calls('GET', '/api/system-health')).toHaveLength(2);
    // the failure surfaced as the page's own message, and as the SWR error toast
    expect(con.errors.some((e) => e.includes('os probe failed'))).toBe(true);
  });

  it('Refresh re-requests the metrics', async () => {
    const api = mockApi(routes(HEALTH()));
    renderPage(<SystemHealthPage />, { user: SA, api });
    await screen.findByRole('heading', { name: 'System Health' });
    const before = api.calls('GET', '/api/system-health').length;
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(api.calls('GET', '/api/system-health').length).toBe(before + 1));
  });

  it('auto-refresh counts down each second, wraps from 1 back to 10, and can be switched off and on', async () => {
    const api = mockApi(routes(HEALTH()));
    renderPage(<SystemHealthPage />, { user: SA, api });
    await screen.findByRole('heading', { name: 'System Health' });
    expect(screen.getByRole('button', { name: 'Auto-refresh (10s)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Auto-refresh (10s)' }));
    expect(screen.getByRole('button', { name: 'Auto-refresh off' })).toHaveClass('text-slate-500');

    // Only the countdown's setInterval is faked; SWR's own timers stay real.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fireEvent.click(screen.getByRole('button', { name: 'Auto-refresh off' }));
    expect(screen.getByRole('button', { name: 'Auto-refresh (10s)' })).toHaveClass('text-emerald-700');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('button', { name: 'Auto-refresh (9s)' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByRole('button', { name: 'Auto-refresh (1s)' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('button', { name: 'Auto-refresh (10s)' })).toBeInTheDocument();
  });
});

describe('System Health — accessibility + console', () => {
  it('every control is named and normal use logs nothing', async () => {
    const api = mockApi(routes(HEALTH()));
    renderPage(<SystemHealthPage />, { user: SA, api });
    await screen.findByRole('heading', { name: 'System Health' });
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
