import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { NotificationLogsPage } from '../notification-settings/notification-logs';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth, ackMessage } from './config-test-helpers';

vi.setConfig({ testTimeout: 20_000 });
configure({ asyncUtilTimeout: 5_000 });
afterEach(resetEnv);

const LOGS = /^\/api\/notification-settings\/logs\?/;
const DATETIME = { path: '/api/config/datetime/current', body: { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' } };

const ROWS = [
  {
    id: 'l1', channel: 'EMAIL', recipient: 'qa@acme.test', subject: 'Cycle completed', message: 'Filter F-1 cleaned',
    status: 'SENT', retryCount: 0, errorMessage: null, triggeredBy: 'CYCLE_COMPLETED',
    createdAt: '2026-10-01T10:00:00Z', sentAt: '2026-10-01T10:00:05Z',
  },
  {
    id: 'l2', channel: 'SMS', recipient: '+919800000000', subject: null, message: '',
    status: 'FAILED', retryCount: 2, errorMessage: 'Gateway timeout', triggeredBy: null,
    createdAt: '2026-10-02T11:30:00Z', sentAt: null,
  },
  {
    id: 'l3', channel: 'PUSH', recipient: 'device-7', subject: 'Odd', message: 'x',
    status: 'QUEUED', retryCount: 0, errorMessage: null, triggeredBy: 'MANUAL',
    createdAt: '2026-10-03T08:00:00Z', sentAt: null,
  },
];
const STATS = { total: 42, email: { sent: 30, failed: 4 }, sms: { sent: 6, failed: 2 } };

function setup(extra: MockRoute[] = [], opts: { logs?: unknown; stats?: unknown; reauth?: string[] } = {}) {
  const api = mockApi([
    ...extra,
    { path: LOGS, body: opts.logs ?? { data: ROWS, total: ROWS.length } },
    opts.stats === null
      ? { path: '/api/notification-settings/logs/stats', status: 204 }
      : { path: '/api/notification-settings/logs/stats', body: opts.stats ?? STATS },
    { path: '/api/config/pagination/current', body: { limit: 10, count: 3, options: [10, 25, 50] } },
    DATETIME,
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  renderPage(<NotificationLogsPage />, { user: SUPER_ADMIN, api });
  return api;
}

const lastLogQuery = (api: ReturnType<typeof mockApi>) => {
  const calls = api.calls('GET', LOGS);
  return calls[calls.length - 1].query;
};

describe('Notification Logs page', () => {
  it('loads delivery stats and the log table, with "-" for missing subject / trigger', async () => {
    const api = setup();
    expect(await screen.findByText('qa@acme.test')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Notification Logs' })).toBeInTheDocument();
    // Stats tiles
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('Emails Sent').previousSibling).toHaveTextContent('30');
    expect(screen.getByText('Emails Failed').previousSibling).toHaveTextContent('4');
    expect(screen.getByText('SMS Sent').previousSibling).toHaveTextContent('6');
    expect(screen.getByText('SMS Failed').previousSibling).toHaveTextContent('2');
    // Row 2: null subject + triggeredBy render "-", retry count shown
    const smsRow = screen.getByText('+919800000000').closest('tr')!;
    expect(within(smsRow).getAllByText('-')).toHaveLength(2);
    expect(within(smsRow).getByText('(retry 2)')).toBeInTheDocument();
    // Unknown channel/status still render their raw value
    const odd = screen.getByText('device-7').closest('tr')!;
    expect(within(odd).getByText('PUSH')).toBeInTheDocument();
    expect(within(odd).getByText('QUEUED')).toBeInTheDocument();
    // Time formatted with the configured datetime format
    expect(screen.getByText('2026-10-01 10:00')).toBeInTheDocument();
    // First request: page 1, the first configured page size, no filters.
    const q = api.calls('GET', LOGS)[0].query;
    expect(q.get('page')).toBe('1');
    expect(q.get('limit')).toBe('10');
    expect(q.has('channel')).toBe(false);
    expect(api.unmatched).toEqual([]);
  });

  it('expands a row to show its message, error and sent time, and collapses it again', async () => {
    setup();
    fireEvent.click(await screen.findByText('qa@acme.test'));
    expect(screen.getByText('Filter F-1 cleaned')).toBeInTheDocument();
    expect(screen.getByText('Sent At:')).toBeInTheDocument();
    expect(screen.getByText('2026-10-01 10:00', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Error:')).toBeNull();
    // Clicking a different row swaps the detail; failed row shows the error and no Sent At.
    fireEvent.click(screen.getByText('+919800000000'));
    expect(screen.queryByText('Filter F-1 cleaned')).toBeNull();
    expect(screen.getByText('Error:')).toBeInTheDocument();
    expect(screen.getByText('Gateway timeout')).toBeInTheDocument();
    expect(screen.queryByText('Sent At:')).toBeNull();
    // Same row again collapses
    fireEvent.click(screen.getByText('+919800000000'));
    expect(screen.queryByText('Gateway timeout')).toBeNull();
  });

  it('empty result: shows the empty row, no pagination, and no stat tiles when stats are absent', async () => {
    const api = setup([], { logs: { data: [], total: 0 }, stats: null });
    expect(await screen.findByText('No notification logs found')).toBeInTheDocument();
    await waitFor(() => expect(api.calls('GET', '/api/notification-settings/logs/stats')).toHaveLength(1));
    expect(screen.queryByText('Emails Sent')).toBeNull();
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it('stats with no per-channel breakdown show zeros', async () => {
    setup([], { stats: { total: 5 } });
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(screen.getByText('Emails Sent').previousSibling).toHaveTextContent('0');
    expect(screen.getByText('SMS Failed').previousSibling).toHaveTextContent('0');
  });

  it('search, channel and status filters change the request query', async () => {
    const api = setup();
    await screen.findByText('qa@acme.test');
    fireEvent.change(screen.getByPlaceholderText('Search by recipient or subject...'), { target: { value: 'acme' } });
    await waitFor(() => expect(lastLogQuery(api).get('search')).toBe('acme'));
    const [channelSel, statusSel] = screen.getAllByRole('combobox');
    fireEvent.change(channelSel, { target: { value: 'SMS' } });
    await waitFor(() => expect(lastLogQuery(api).get('channel')).toBe('SMS'));
    fireEvent.change(statusSel, { target: { value: 'FAILED' } });
    await waitFor(() => expect(lastLogQuery(api).get('status')).toBe('FAILED'));
    const q = lastLogQuery(api);
    expect(q.get('search')).toBe('acme');
    expect(q.get('channel')).toBe('SMS');
    expect(q.get('page')).toBe('1');
  });

  it('pagination: next page and rows-per-page change the query; a filter resets to page 1', async () => {
    const api = setup([], { logs: { data: ROWS, total: 60 } });
    await screen.findByText('qa@acme.test');
    expect(await screen.findByText(/of/, { selector: 'p' })).toHaveTextContent('Showing 1–10 of 60');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastLogQuery(api).get('page')).toBe('2'));
    fireEvent.change(screen.getByPlaceholderText('Search by recipient or subject...'), { target: { value: 'x' } });
    await waitFor(() => expect(lastLogQuery(api).get('search')).toBe('x'));
    expect(lastLogQuery(api).get('page')).toBe('1');
    const rows = screen.getByText('Rows:').querySelector('select')!;
    fireEvent.change(rows, { target: { value: '25' } });
    await waitFor(() => expect(lastLogQuery(api).get('limit')).toBe('25'));
  });

  it('delete sends DELETE for the row and reloads the list, without expanding the row', async () => {
    const api = setup([{ method: 'DELETE', path: '/api/notification-settings/logs/l1', body: { ok: true } }]);
    await screen.findByText('qa@acme.test');
    const before = api.calls('GET', LOGS).length;
    const row = screen.getByText('qa@acme.test').closest('tr')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Delete' })); });
    await waitFor(() => expect(api.calls('DELETE', '/api/notification-settings/logs/l1')).toHaveLength(1));
    await waitFor(() => expect(api.calls('GET', LOGS).length).toBeGreaterThan(before));
    expect(screen.queryByText('Filter F-1 cleaned')).toBeNull();
  });

  it('delete gated up front by DELETE_NOTIFICATION_LOG prompts first, then signs the DELETE', async () => {
    const api = setup([{ method: 'DELETE', path: '/api/notification-settings/logs/l2', body: { ok: true } }], { reauth: ['DELETE_NOTIFICATION_LOG'] });
    await screen.findByText('+919800000000');
    // wait for the my-actions catalog to arrive so the prompt is up-front
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    const row = screen.getByText('+919800000000').closest('tr')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Delete' })); });
    expect(await screen.findByText(/Delete Notification Log|requires identity verification/)).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/notification-settings/logs/l2')).toHaveLength(0);
    await signReauth('pw-del');
    await waitFor(() => expect(api.calls('DELETE', '/api/notification-settings/logs/l2')).toHaveLength(1));
    const del = api.calls('DELETE', '/api/notification-settings/logs/l2')[0];
    expect(del.headers['x-reauth-password']).toBe('pw-del');
    expect(del.json).toEqual({ _currentPassword: 'pw-del' });
  });

  it('server-demanded signature on delete: prompt, then retry with the password', async () => {
    const P = '/api/notification-settings/logs/l1';
    const api = setup([reauthRequired('DELETE', P), { method: 'DELETE', path: P, body: { ok: true } }]);
    await screen.findByText('qa@acme.test');
    const row = screen.getByText('qa@acme.test').closest('tr')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Delete' })); });
    await signReauth('pw-2');
    await waitFor(() => expect(api.calls('DELETE', P)).toHaveLength(2));
    expect(api.calls('DELETE', P)[1].headers['x-reauth-password']).toBe('pw-2');
  });

  it('cancelling the signature is silent and deletes nothing', async () => {
    const P = '/api/notification-settings/logs/l1';
    const api = setup([reauthRequired('DELETE', P)]);
    await screen.findByText('qa@acme.test');
    const row = screen.getByText('qa@acme.test').closest('tr')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Delete' })); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Delete Failed' })).toBeNull();
    expect(api.calls('DELETE', P)).toHaveLength(1);
  });

  it('a refused delete is reported with the server message', async () => {
    const P = '/api/notification-settings/logs/l1';
    setup([{ method: 'DELETE', path: P, status: 403, body: { error: 'FORBIDDEN', message: 'Missing NOTIFICATION_DELETE' } }]);
    await screen.findByText('qa@acme.test');
    const row = screen.getByText('qa@acme.test').closest('tr')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Delete' })); });
    expect(await ackMessage('Delete Failed')).toContain('Missing NOTIFICATION_DELETE');
  });
});

describe('D6 — the configured page size applies on a cold load', () => {
  // The default setup configures options [10, 25, 50]: options[0] equals the
  // pre-load fallback (10), which is how the bug stayed invisible.
  const CONFIGURED = { path: '/api/config/pagination/current', body: { limit: 50, count: 3, options: [25, 50, 100] } };

  it('lists with the configured first page size, not the 10-row fallback the state was seeded from', async () => {
    const api = setup([CONFIGURED], { logs: { data: ROWS, total: 120 } });
    await screen.findByText('qa@acme.test');
    await waitFor(() => expect(lastLogQuery(api).get('limit')).toBe('25'));
    const rows = screen.getByText('Rows:').querySelector('select') as HTMLSelectElement;
    expect(rows.value).toBe('25');
    expect(await screen.findByText(/of/, { selector: 'p' })).toHaveTextContent('Showing 1–25 of 120');
  });

  it('a size the operator picks still sticks', async () => {
    const api = setup([CONFIGURED], { logs: { data: ROWS, total: 120 } });
    await screen.findByText('qa@acme.test');
    await waitFor(() => expect(lastLogQuery(api).get('limit')).toBe('25'));
    fireEvent.change(screen.getByText('Rows:').querySelector('select')!, { target: { value: '100' } });
    await waitFor(() => expect(lastLogQuery(api).get('limit')).toBe('100'));
    expect((screen.getByText('Rows:').querySelector('select') as HTMLSelectElement).value).toBe('100');
  });
});
