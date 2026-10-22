import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage, type MockRequest, type MockRoute } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, reauthActions, commonConfigRoutes, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { DebugTracesPage } from '../index';
import type { PipelineTrace, TraceStats } from '../types';

// Full-page renders through the real SWR/auth/re-auth stack; under a loaded machine the
// default 5 s budget is too tight for the multi-step flows (budget only, no behaviour change).
vi.setConfig({ testTimeout: 20_000 });

/**
 * Pipeline Debug Traces page. Real SWR -> apiClient -> fetch, real useReauth;
 * only fetch is stubbed.
 */

const SA = { role: 'SUPER_ADMIN', permissions: [] };

const TRACE = (over: Partial<PipelineTrace> = {}): PipelineTrace => ({
  id: 't1', time: '2026-10-20T08:30:00.000Z', messageId: 'msg-0001',
  entityId: 'ent-1234567890abcdef', entityName: 'AHU-01',
  transport: 'API', messageType: 'FILTER_ADVANCED',
  stages: [{ stage: 1, name: 'Auth & Rate Limit', status: 'SUCCESS', durationMs: 3 }],
  finalStatus: 'SUCCESS', totalDurationMs: 250,
  ...over,
});

const STATS: TraceStats = {
  successRate1h: 95, successRate24h: 85.5, avgDurationMs: 1499.6,
  topErrors: [{ code: 'ENTITY_NOT_FOUND', count: 40 }, { code: 'SCHEMA_INVALID', count: 10 }],
  byTransport: { MQTT: { total: 200, failed: 50 }, HTTP: { total: 100, failed: 1 }, API: { total: 0, failed: 0 } },
};

function list(data: PipelineTrace[], over: Record<string, unknown> = {}) {
  return { data, total: data.length, page: 1, limit: 20, totalPages: 1, ...over };
}

function routes(opts: { list?: unknown; stats?: unknown; opTrace?: unknown; reauth?: string[]; extra?: MockRoute[] } = {}): MockRoute[] {
  return [
    ...(opts.extra ?? []),
    ...commonConfigRoutes(),
    reauthActions(opts.reauth ?? []),
    { path: '/api/debug/traces/stats', body: opts.stats ?? { ...STATS, topErrors: [], byTransport: {} } },
    { path: '/api/debug/traces/operation-trace', body: opts.opTrace ?? { enabled: true } },
    { path: '/api/debug/traces', body: opts.list ?? list([]) },
  ];
}

const lastList = (api: ReturnType<typeof mockApi>) => {
  const calls = api.calls('GET', '/api/debug/traces');
  return calls[calls.length - 1];
};

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

describe('Debug traces — list rendering', () => {
  it('renders each trace row with entity, type, transport, status, error code and duration', async () => {
    const rows = [
      TRACE(),
      TRACE({ id: 't2', entityName: undefined, entityId: 'abcdef0123456789xyz', messageType: 'TELEMETRY', transport: 'MQTT', finalStatus: 'SUCCESS_WITH_WARNINGS', totalDurationMs: 0.4 }),
      TRACE({ id: 't3', entityName: undefined, entityId: undefined, messageType: 'ATTRIBUTES', transport: 'HTTP', finalStatus: 'FAILED', errorCode: 'ENTITY_NOT_FOUND', totalDurationMs: 1500 }),
      TRACE({ id: 't4', entityId: undefined, entityName: 'Named only', messageType: 'RPC', transport: 'WEBSOCKET', finalStatus: 'DLQ', totalDurationMs: 2 }),
    ];
    // A pagination config where the first option and the limit agree, so the
    // opening page size does not depend on which one a list page starts on.
    const api = mockApi(routes({
      list: list(rows, { total: 1234 }),
      extra: [{ path: '/api/config/pagination/current', body: { limit: 20, count: 3, options: [20, 50, 100] } }],
    }));
    renderPage(<DebugTracesPage />, { user: SA, api });

    expect(await screen.findByText('AHU-01')).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    // entityName + entityId -> id shortened to 12 chars; id only -> 16 chars
    expect(screen.getByText('ent-12345678…')).toBeInTheDocument();
    expect(screen.getByText('abcdef0123456789…')).toBeInTheDocument();
    expect(screen.getByText('Named only')).toBeInTheDocument();
    // SUCCESS_WITH_WARNINGS is shown as WARNINGS
    expect(table.getByText('WARNINGS')).toBeInTheDocument();
    expect(table.getByText('FAILED')).toBeInTheDocument();
    expect(table.getByText('DLQ')).toBeInTheDocument();
    expect(screen.getByText('ENTITY_NOT_FOUND')).toBeInTheDocument();
    // durations
    expect(table.getByText('250ms')).toBeInTheDocument();
    expect(table.getByText('<1ms')).toBeInTheDocument();
    expect(table.getByText('1.50s')).toBeInTheDocument();
    // transport + type badges carry the raw value
    expect(screen.getByText('TELEMETRY')).toBeInTheDocument();
    expect(screen.getByText('WEBSOCKET')).toBeInTheDocument();
    // progress bar: 1 successful stage of 11
    expect(screen.getAllByText('1/11')).toHaveLength(4);
    // total traces stat + pagination text use the list total
    expect(screen.getByText('(1,234 total traces)')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();

    // the settled request (a cold load may first send the pre-load default)
    await waitFor(() => expect(lastList(api).query.get('pageSize')).toBe('20'));
    const q = lastList(api).query;
    expect(q.get('page')).toBe('1');
    expect(q.get('status')).toBeNull();
    expect(api.unmatched).toEqual([]);
  });

  it('shows the loading row first, then the honest empty state', async () => {
    const api = mockApi(routes());
    renderPage(<DebugTracesPage />, { user: SA, api });
    expect(screen.getByText('Loading traces...')).toBeInTheDocument();
    expect(await screen.findByText('No traces found')).toBeInTheDocument();
    expect(screen.getByText('No pipeline traces have been recorded yet.')).toBeInTheDocument();
    expect(screen.queryByText('Filtered')).toBeNull();
  });

  it('stats cards: rates, average duration, red below 90 %, dashes before stats load', async () => {
    const api = mockApi(routes({ stats: STATS }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    // before stats arrive every rate reads "—"
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    const r1h = await screen.findByText('95.0%');
    expect(r1h).toHaveClass('text-emerald-600');
    expect(screen.getByText('85.5%')).toHaveClass('text-red-600');
    expect(screen.getByText('1.50s')).toBeInTheDocument();
  });

  it('a 1 h success rate under 90 % is red and the 24 h one at/above 90 % is brand-coloured', async () => {
    const api = mockApi(routes({ stats: { ...STATS, successRate1h: 50, successRate24h: 99, topErrors: [], byTransport: {} } }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    expect(await screen.findByText('50.0%')).toHaveClass('text-red-600');
    expect(screen.getByText('99.0%')).toHaveClass('text-brand-700');
    // no top errors / no transports -> neither panel renders
    expect(screen.queryByText('Top Error Codes')).toBeNull();
    expect(screen.queryByText('Transport Breakdown')).toBeNull();
  });

  it('top errors panel ranks codes and its Filter button filters the list by that code', async () => {
    const api = mockApi(routes({ stats: STATS }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    expect(await screen.findByText('Top Error Codes')).toBeInTheDocument();
    expect(screen.getByText('SCHEMA_INVALID')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    // transport breakdown: fail rate per transport, red above 10 %
    expect(screen.getByText('Transport Breakdown')).toBeInTheDocument();
    expect(screen.getByText('25% fail')).toHaveClass('text-red-600');
    expect(screen.getByText('1% fail')).toHaveClass('text-emerald-600');
    expect(screen.getByText('0% fail')).toBeInTheDocument();
    expect(screen.getByText('50 failed')).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Filter by ENTITY_NOT_FOUND'));
    expect(screen.getByPlaceholderText('e.g. ENTITY_NOT_FOUND')).toHaveValue('ENTITY_NOT_FOUND');
    await waitFor(() => expect(lastList(api).query.get('errorCode')).toBe('ENTITY_NOT_FOUND'));
    expect(await screen.findByText('Filtered')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting your filters to find traces.')).toBeInTheDocument();
  });
});

describe('Debug traces — filters', () => {
  it('status, transport, debounced error code + entity, and the date range all reach the query; Clear resets them', async () => {
    const api = mockApi(routes());
    renderPage(<DebugTracesPage />, { user: SA, api });
    await screen.findByText('No traces found');

    const [statusSel, transportSel] = screen.getAllByRole('combobox');
    fireEvent.change(statusSel, { target: { value: 'FAILED' } });
    await waitFor(() => expect(lastList(api).query.get('status')).toBe('FAILED'));
    fireEvent.change(transportSel, { target: { value: 'MQTT' } });
    await waitFor(() => expect(lastList(api).query.get('transport')).toBe('MQTT'));

    fireEvent.change(screen.getByPlaceholderText('e.g. ENTITY_NOT_FOUND'), { target: { value: 'TIMEOUT' } });
    fireEvent.change(screen.getByPlaceholderText('Entity ID or name...'), { target: { value: 'AHU-9' } });
    // debounced: not in the very next request, but after 300 ms
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('errorCode')).toBe('TIMEOUT');
      expect(q.get('entityId')).toBe('AHU-9');
    });

    fireEvent.change(screen.getByLabelText('Trace from date and time'), { target: { value: '2026-10-01T08:00' } });
    fireEvent.change(screen.getByLabelText('Trace to date and time'), { target: { value: '2026-10-02T08:00' } });
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('from')).toBe(new Date('2026-10-01T08:00').toISOString());
      expect(q.get('to')).toBe(new Date('2026-10-02T08:00').toISOString());
    });
    expect(screen.getByText('Filtered')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear All Filters/ }));
    await waitFor(() => {
      const q = lastList(api).query;
      for (const k of ['status', 'transport', 'errorCode', 'entityId', 'from', 'to']) expect(q.get(k)).toBeNull();
    });
    expect(screen.queryByText('Filtered')).toBeNull();
    expect(screen.getByPlaceholderText('Entity ID or name...')).toHaveValue('');
  });
});

describe('Debug traces — expanding a row', () => {
  const DETAIL = TRACE({
    id: 't1', finalStatus: 'FAILED', errorCode: 'SCHEMA_INVALID', errorMessage: 'payload.temp must be a number',
    failedStage: 'Schema Validation', payloadSize: 1024, warnings: ['clock skew 2s'],
    stages: [
      { stage: 1, name: 'Auth & Rate Limit', status: 'SUCCESS', durationMs: 4 },
      { stage: 2, name: 'Schema Validation', status: 'FAILED', durationMs: 1200, errorCode: 'SCHEMA_INVALID', errorMessage: 'temp is a string', warnings: ['coerced unit'], details: { field: 'temp' } },
      { stage: 3, name: 'Entity Resolution', status: 'SKIPPED', durationMs: 0 },
    ],
  });

  it('a keyboard user can expand and collapse a trace with its named button (aria-expanded follows)', async () => {
    const api = mockApi(routes({ list: list([TRACE()]), extra: [{ path: '/api/debug/traces/t1', body: DETAIL }] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    const btn = await screen.findByRole('button', { name: 'Expand trace AHU-01' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    btn.focus();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);
    expect(await screen.findByText('payload.temp must be a number')).toBeInTheDocument();
    const collapse = screen.getByRole('button', { name: 'Collapse trace AHU-01' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    // the button's click does not also bubble to the row (one toggle, not two)
    expect(api.calls('GET', '/api/debug/traces/t1')).toHaveLength(1);
    fireEvent.click(collapse);
    await waitFor(() => expect(screen.queryByText('payload.temp must be a number')).toBeNull());
    expect(screen.getByRole('button', { name: 'Expand trace AHU-01' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('fetches the full trace, shows the detail panel and stage timeline, and collapses on a second click', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = mockApi(routes({
      list: list([TRACE()]),
      extra: [{ path: '/api/debug/traces/t1', body: DETAIL }],
    }));
    // hold the detail answer until the spinner has been seen
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/api/debug/traces/t1')) await gate;
      return realFetch(input, init);
    }) as typeof fetch;

    renderPage(<DebugTracesPage />, { user: SA, api });
    fireEvent.click(await screen.findByText('AHU-01'));
    expect(await screen.findByText('Loading trace details…')).toBeInTheDocument();
    release();

    expect(await screen.findByText('Message ID')).toBeInTheDocument();
    expect(screen.getByText('msg-0001')).toBeInTheDocument();
    expect(screen.getByText('1,024 B')).toBeInTheDocument();
    expect(screen.getByText('3 / 11')).toBeInTheDocument();
    expect(screen.getByText('payload.temp must be a number')).toBeInTheDocument();
    expect(screen.getByText('Failed at: Schema Validation')).toBeInTheDocument();
    expect(screen.getByText('Warnings (1)')).toBeInTheDocument();
    expect(screen.getByText('clock skew 2s')).toBeInTheDocument();
    // timeline: the failed stage's own error + warning + details, unreached stages as SKIPPED
    expect(screen.getByText('temp is a string')).toBeInTheDocument();
    expect(screen.getByText('coerced unit')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText(/"field": "temp"/)).toBeInTheDocument();
    expect(screen.getByText('1.20s')).toBeInTheDocument();
    expect(screen.getAllByText('SKIPPED').length).toBe(9); // stage 3 + 8 never-reached slots
    expect(screen.getByText('UNS Path Build')).toBeInTheDocument(); // name from STAGE_NAMES
    expect(screen.getByText('Stage 6')).toBeInTheDocument(); // index with no STAGE_NAMES entry
    expect(api.calls('GET', '/api/debug/traces/t1')).toHaveLength(1);

    fireEvent.click(screen.getByText('AHU-01'));
    await waitFor(() => expect(screen.queryByText('Message ID')).toBeNull());
    // re-opening uses the cached detail: no second request
    fireEvent.click(screen.getByText('AHU-01'));
    expect(await screen.findByText('Failed at: Schema Validation')).toBeInTheDocument();
    expect(api.calls('GET', '/api/debug/traces/t1')).toHaveLength(1);
    globalThis.fetch = realFetch;
  });

  it('falls back to the list row when the detail request fails', async () => {
    const api = mockApi(routes({
      list: list([TRACE({ payloadSize: undefined })]),
      extra: [{ path: '/api/debug/traces/t1', status: 500, body: { error: 'INTERNAL', message: 'boom' } }],
    }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    fireEvent.click(await screen.findByText('AHU-01'));
    expect(await screen.findByText('Message ID')).toBeInTheDocument();
    expect(screen.getByText('msg-0001')).toBeInTheDocument();
    // no payload size on the list row -> dash; success has no error banner
    expect(screen.getByText('Payload Size').nextElementSibling).toHaveTextContent('—');
    expect(screen.queryByText(/Failed at:/)).toBeNull();
  });
});

describe('Debug traces — pagination', () => {
  it('rows-per-page buttons and Previous / Next drive the page + pageSize query', async () => {
    const api = mockApi(routes({ list: (req: MockRequest) => list([TRACE()], { total: 60, totalPages: 3, page: Number(req.query.get('page')) }) }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await screen.findByText('AHU-01');
    // Let the mount-time debounce (300 ms) settle first: it resets the page to 1
    // and would undo a click made before it fires (recorded as a defect).
    await new Promise((r) => setTimeout(r, 400));

    // The pager unmounts while a new page loads (data is undefined for the new
    // SWR key), so each step re-queries the buttons once the page has arrived.
    const prev = () => screen.getByRole('button', { name: /Previous/ });
    const next = () => screen.getByRole('button', { name: /Next/ });
    const onPage = async (n: number) => { await waitFor(() => expect(screen.getByText(/^Page/).textContent).toMatch(new RegExp('Page ' + n + ' of 3'))); };
    expect(prev()).toBeDisabled();
    fireEvent.click(next());
    await onPage(2);
    expect(lastList(api).query.get('page')).toBe('2');
    fireEvent.click(next());
    await onPage(3);
    expect(lastList(api).query.get('page')).toBe('3');
    expect(next()).toBeDisabled();
    expect(prev()).toBeEnabled();
    fireEvent.click(prev());
    await onPage(2);

    // page-size options come from /api/config/pagination/current ([10, 20, 50])
    fireEvent.click(await screen.findByRole('button', { name: '50' }));
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('pageSize')).toBe('50');
      expect(q.get('page')).toBe('1');
    });
    expect(screen.getByRole('button', { name: '50' })).toHaveClass('bg-cyan-500');
  });

  it('D1: a page change made right after load is not undone by the mount-time debounce', async () => {
    const api = mockApi(routes({ list: (req: MockRequest) => list([TRACE()], { total: 60, totalPages: 3, page: Number(req.query.get('page')) }) }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await screen.findByText('AHU-01');
    // the page size has settled (its change legitimately resets the page)
    await waitFor(() => expect(lastList(api).query.get('pageSize')).toBe('10'));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByText(/^Page/).textContent).toMatch(/Page 2 of 3/));
    // past the 300 ms debounce window: still page 2, and the last request asked for it
    await new Promise((r) => setTimeout(r, 450));
    expect(screen.getByText(/^Page/).textContent).toMatch(/Page 2 of 3/);
    expect(lastList(api).query.get('page')).toBe('2');
  });

  it('Refresh re-requests the list', async () => {
    const api = mockApi(routes({ list: list([TRACE()]) }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await screen.findByText('AHU-01');
    const before = api.calls('GET', '/api/debug/traces').length;
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(api.calls('GET', '/api/debug/traces').length).toBeGreaterThan(before));
  });
});

describe('Debug traces — operation-trace toggle (MANAGE_DEBUG_TRACES)', () => {
  it('no password needed: PUTs the flipped flag and the button reads OFF', async () => {
    const api = mockApi(routes({ extra: [{ method: 'PUT', path: '/api/debug/traces/operation-trace', body: { enabled: false } }] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    const btn = await screen.findByRole('button', { name: /Operation tracing ON/ });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(btn);
    await waitFor(() => expect(api.calls('PUT', '/api/debug/traces/operation-trace')).toHaveLength(1));
    const put = api.calls('PUT', '/api/debug/traces/operation-trace')[0];
    expect(put.json).toEqual({ enabled: false });
    expect(put.headers['x-reauth-password']).toBeUndefined();
    expect(await screen.findByRole('button', { name: /Operation tracing OFF/ })).toBeInTheDocument();
  });

  it('an absent flag is treated as ON; turning it back on from OFF sends enabled:true', async () => {
    const api = mockApi(routes({ opTrace: { enabled: false }, extra: [{ method: 'PUT', path: '/api/debug/traces/operation-trace', body: { enabled: true } }] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    fireEvent.click(await screen.findByRole('button', { name: /Operation tracing OFF/ }));
    await waitFor(() => expect(api.calls('PUT', '/api/debug/traces/operation-trace')[0]?.json).toEqual({ enabled: true }));
  });

  it('password prompt -> confirm sends the password in header + body', async () => {
    const api = mockApi(routes({ reauth: ['MANAGE_DEBUG_TRACES'], extra: [{ method: 'PUT', path: '/api/debug/traces/operation-trace', body: { enabled: false } }] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Operation tracing ON/ }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(api.calls('PUT', '/api/debug/traces/operation-trace')).toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Pw@12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('PUT', '/api/debug/traces/operation-trace')).toHaveLength(1));
    const put = api.calls('PUT', '/api/debug/traces/operation-trace')[0];
    expect(put.headers['x-reauth-password']).toBe('Pw@12345');
    expect(put.json).toEqual({ enabled: false, _currentPassword: 'Pw@12345' });
    expect(await screen.findByRole('button', { name: /Operation tracing OFF/ })).toBeInTheDocument();
  });

  it('cancelling the prompt changes nothing and shows no error', async () => {
    const api = mockApi(routes({ reauth: ['MANAGE_DEBUG_TRACES'] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Operation tracing ON/ }));
    const title = await screen.findByText('Confirm Your Identity');
    const dialog = (title.closest('[role="dialog"]') as HTMLElement) ?? document.body;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(api.calls('PUT', '/api/debug/traces/operation-trace')).toHaveLength(0);
    expect(screen.queryByText('Toggle Failed')).toBeNull();
    expect(screen.getByRole('button', { name: /Operation tracing ON/ })).toBeInTheDocument();
  });

  it('the server answering REAUTH_REQUIRED opens the prompt retroactively', async () => {
    const api = mockApi(routes({ extra: [
      { method: 'PUT', path: '/api/debug/traces/operation-trace', status: 401, times: 1, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required' } },
      { method: 'PUT', path: '/api/debug/traces/operation-trace', body: { enabled: false } },
    ] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Operation tracing ON/ }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), { target: { value: 'Pw@12345' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm|Verify)/ }));
    await waitFor(() => expect(api.calls('PUT', '/api/debug/traces/operation-trace')).toHaveLength(2));
    expect(api.calls('PUT', '/api/debug/traces/operation-trace')[1].headers['x-reauth-password']).toBe('Pw@12345');
  });

  it('a refused toggle shows the server message as an error toast', async () => {
    const api = mockApi(routes({ extra: [{ method: 'PUT', path: '/api/debug/traces/operation-trace', status: 403, body: { error: 'FORBIDDEN', message: 'Insufficient permissions' } }] }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: /Operation tracing ON/ }));
    expect(await screen.findByText('Toggle Failed')).toBeInTheDocument();
    expect(screen.getByText('Insufficient permissions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Operation tracing ON/ })).toBeInTheDocument();
  });
});

describe('Debug traces — accessibility + console', () => {
  it('every control is named — each filter by its label — and nothing is logged in normal use', async () => {
    const api = mockApi(routes({ list: list([TRACE()]), stats: STATS }));
    renderPage(<DebugTracesPage />, { user: SA, api });
    await screen.findByText('AHU-01');
    await screen.findByText('Top Error Codes');
    expect(screen.getByLabelText('Status')).toHaveDisplayValue('All Statuses');
    expect(screen.getByLabelText('Transport')).toHaveDisplayValue('All Transports');
    expect(screen.getByLabelText('Error Code')).toHaveAttribute('placeholder', 'e.g. ENTITY_NOT_FOUND');
    expect(screen.getByLabelText('Entity')).toHaveAttribute('placeholder', 'Entity ID or name...');
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
