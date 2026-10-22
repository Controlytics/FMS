/**
 * PM Schedule detail (/pm-schedules/:entityId) through the page harness.
 * Coverage campaign 2026-10-21.
 *
 * Rules exercised:
 *  - `GET /api/pm-schedules/:entityId` answers a literal JSON `null` when
 *    there is no schedule (D5): that reads "No PM schedule exists", never a
 *    half-empty "Version: vundefined" card;
 *  - a failed read is an error with Retry (403: a permission message, no Retry);
 *  - visits whose tolerance windows overlap are flagged (grandfathered, not
 *    blocked) and two visits in one month are told apart by day;
 *  - Start PM is signed when its re-auth row is on.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, clearGlobalSwrCache, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, passReauth, expectSigned, allowConsoleError, role } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { PmScheduleDetailPage } from '../detail';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const Y = new Date().getFullYear();
const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const ymd = (iso: string) => iso.slice(0, 10);

const EXECUTOR = role('OPERATOR', ['PM_READ', 'PM_EXECUTE']);
const READER = role('MANAGER', ['PM_READ']);

/** A visit whose window is centred `offset` days from now, ±2 days. */
const visit = (id: string, offset: number, over: Record<string, any> = {}) => ({
  id, month: 3, plannedDate: at(offset), toleranceDays: 2, windowStart: at(offset - 2), windowEnd: at(offset + 2),
  approvalStatus: 'APPROVED', execution: null, ...over,
});

/** `answer`: the schedule body, or `{ http, body }` for a non-200 answer. */
function open(user: any, answer: any, extra: MockRoute[] = [], reauthActions: string[] = [], globalCache = false) {
  const scheduleRoute: MockRoute = answer && typeof answer === 'object' && 'http' in answer
    ? { path: '/api/pm-schedules/ahu-1', status: answer.http, body: answer.body }
    : { path: '/api/pm-schedules/ahu-1', body: answer };
  const api = mockApi([...extra, scheduleRoute, DT_UTC, ...baseRoutes({ reauthActions })]);
  renderPage(<PmScheduleDetailPage />, { user, api, route: '/pm-schedules/ahu-1', path: '/pm-schedules/:entityId', globalCache });
  return api;
}
const card = (text: string) => screen.getByText(text).closest('.rounded-xl') as HTMLElement;

describe('PM detail — no schedule / failed read', () => {
  it('no schedule for the year says so and links back to the list; the year arrows re-read', async () => {
    const api = open(READER, null); // the real D5 answer: 200 with a JSON null body
    expect(document.querySelector('.animate-spin')).not.toBeNull(); // loading first
    expect(await screen.findByText(`No PM schedule exists for ${Y}.`)).toBeInTheDocument();
    expect(screen.getByText(/entries then go through the PM approval workflow/)).toBeInTheDocument();
    expect(screen.queryByText(/Version:/)).toBeNull();
    expect(screen.queryByText('vundefined')).toBeNull();
    expect(screen.getByRole('link', { name: /Go to PM Schedules/ })).toHaveAttribute('href', '/pm-schedules');

    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(await screen.findByText(`No PM schedule exists for ${Y - 1}.`)).toBeInTheDocument();
    // While a year loads the page shows only a spinner, so each step waits.
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(await screen.findByText(`No PM schedule exists for ${Y}.`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(await screen.findByText(`No PM schedule exists for ${Y + 1}.`)).toBeInTheDocument();
    expect(api.calls('GET', '/api/pm-schedules/ahu-1').map((r) => r.query.get('year'))).toEqual(
      expect.arrayContaining([String(Y), String(Y - 1), String(Y + 1)]));
    expect(api.unmatched).toEqual([]);
  });

  it('a failed read is an error with Retry and a way back, not "No PM schedule exists"', async () => {
    allowConsoleError(/\[SWR Error\]/);
    const api = open(READER, { http: 500, body: { error: 'X', message: 'db down' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`Could not load the PM schedule for ${Y}`);
    expect(alert).toHaveTextContent('db down');
    expect(screen.queryByText(/No PM schedule exists/)).toBeNull();
    const before = api.calls('GET', '/api/pm-schedules/ahu-1').length;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/ahu-1').length).toBeGreaterThan(before));
    expect(within(screen.getByRole('alert')).getByRole('link', { name: 'Back to PM Schedules' })).toHaveAttribute('href', '/pm-schedules');
  });

  it('a 403 says the user may not view it and offers no Retry', async () => {
    allowConsoleError(/\[SWR Error\] Missing PM_READ/);
    open(READER, { http: 403, body: { error: 'FORBIDDEN', message: 'Missing PM_READ' } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view this PM schedule');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a failure with no message still explains itself', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(READER, { http: 502, body: { message: '' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer.');
  });
});

describe('PM detail — the year\'s visits', () => {
  it('each card shows month, planned date, window, tolerance and its state', async () => {
    const schedule = {
      version: 3, status: 'ACTIVE',
      entries: [
        visit('due', 0, { month: 1 }),
        visit('over', -30, { month: 2 }),
        visit('future', 60, { month: 4 }),
        visit('done', -90, { month: 5, execution: { status: 'COMPLETED', startedAt: at(-90), completedAt: at(-89), isWithinWindow: false } }),
        visit('prog', -120, { month: 6, execution: { status: 'IN_PROGRESS', startedAt: at(-120) } }),
      ],
    };
    open(EXECUTOR, schedule); // Start PM needs PM_EXECUTE (D-OPS-1)
    expect(await screen.findByText('v3')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    const due = card('Jan');
    expect(within(due).getByText('Due')).toBeInTheDocument();
    expect(due).toHaveTextContent(`Planned: ${ymd(at(0))}`);
    expect(due).toHaveTextContent(`Window: ${ymd(at(-2))} - ${ymd(at(2))}`);
    expect(due).toHaveTextContent('Tolerance: 2 days');
    expect(within(card('Feb')).getByText('Overdue')).toBeInTheDocument();
    const future = card('Apr');
    expect(within(future).queryByText(/Due|Overdue|Completed|In Progress/)).toBeNull();
    expect(within(future).queryByRole('button', { name: 'Start PM' })).toBeNull();
    const done = card('May');
    expect(within(done).getByText('Completed')).toBeInTheDocument();
    expect(done).toHaveTextContent(`Started: ${ymd(at(-90))}`);
    expect(done).toHaveTextContent(`Done: ${ymd(at(-89))}`);
    expect(within(done).getByText('Out of window')).toBeInTheDocument();
    const prog = card('Jun');
    expect(within(prog).getByText('In Progress')).toBeInTheDocument();
    expect(prog).not.toHaveTextContent('Done:');
    // Start PM only on an un-started visit that is due or overdue.
    expect(within(due).getByRole('button', { name: 'Start PM' })).toBeEnabled();
    expect(within(card('Feb')).getByRole('button', { name: 'Start PM' })).toBeEnabled();
    expect(within(done).queryByRole('button', { name: 'Start PM' })).toBeNull();
    // A non-ACTIVE schedule status is shown as-is, and no overlap banner.
    expect(screen.queryByText(/overlap the previous visit/)).toBeNull();
  });

  it('overlapping tolerance windows are flagged per visit and summarised; two visits in one month show their day', async () => {
    const schedule = {
      version: 1, status: 'ARCHIVED',
      entries: [
        { id: 'b', month: 3, plannedDate: `${Y}-03-25T06:00:00.000Z`, toleranceDays: 10, windowStart: `${Y}-03-15T06:00:00.000Z`, windowEnd: `${Y}-04-04T06:00:00.000Z`, approvalStatus: 'APPROVED', execution: null },
        { id: 'a', month: 3, plannedDate: `${Y}-03-10T06:00:00.000Z`, toleranceDays: 10, windowStart: `${Y}-02-28T06:00:00.000Z`, windowEnd: `${Y}-03-20T06:00:00.000Z`, approvalStatus: 'APPROVED', execution: null },
        { id: 'c', month: 9, plannedDate: `${Y}-09-10T06:00:00.000Z`, toleranceDays: 2, windowStart: `${Y}-09-08T06:00:00.000Z`, windowEnd: `${Y}-09-12T06:00:00.000Z`, approvalStatus: 'REJECTED', approvalRemarks: 'Clash', rejectedByName: 'qa2', rejectionStage: 'REVIEW', execution: null },
      ],
    };
    open(READER, schedule);
    expect(await screen.findByText('1 visit overlap the previous visit\'s tolerance window.')).toBeInTheDocument();
    // The later March visit carries the badge naming the earlier one.
    expect(screen.getByText(`Overlaps the ${Y}-03-10 visit`).closest('.rounded-xl')).toHaveTextContent(`Planned: ${Y}-03-25`);
    // Two March visits: the day is shown beside the month.
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('10', { selector: 'span' })).toBeInTheDocument();
    // September is unique: no day suffix; and the rejection is explained.
    const sep = card('Sep');
    expect(within(sep).getByText('Rejected')).toBeInTheDocument();
    expect(sep).toHaveTextContent('Rejected at review by qa2');
    expect(sep).toHaveTextContent('Remarks: Clash');
    expect(screen.getByText('ARCHIVED')).toBeInTheDocument();
  });

  it('the summary is plural for several overlapping visits', async () => {
    const mk = (id: string, d: number) => ({ id, month: 5, plannedDate: `${Y}-05-${String(d).padStart(2, '0')}T06:00:00.000Z`, toleranceDays: 5,
      windowStart: `${Y}-05-${String(d - 5).padStart(2, '0')}T06:00:00.000Z`, windowEnd: `${Y}-05-${String(d + 5).padStart(2, '0')}T06:00:00.000Z`, approvalStatus: 'APPROVED', execution: null });
    open(READER, { version: 1, status: 'ACTIVE', entries: [mk('a', 10), mk('b', 14), mk('c', 18)] });
    expect(await screen.findByText('2 visits overlap the previous visit\'s tolerance window.')).toBeInTheDocument();
  });

  it('a schedule object with no entries list renders an empty grid', async () => {
    open(READER, { version: 2, status: 'ACTIVE' });
    expect(await screen.findByText('v2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start PM' })).toBeNull();
  });
});

describe('PM detail — Start PM', () => {
  it('posts the execution for the visit and re-reads the schedule (global mutate)', async () => {
    await clearGlobalSwrCache();
    const api = open(EXECUTOR, { version: 1, status: 'ACTIVE', entries: [visit('due', 0, { month: 1 })] }, [
      { method: 'POST', path: '/api/pm-executions', status: 201, body: { id: 'x1' } },
    ], [], true);
    fireEvent.click(await screen.findByRole('button', { name: 'Start PM' }));
    await waitFor(() => expect(api.calls('POST', '/api/pm-executions')).toHaveLength(1));
    expect(api.calls('POST', '/api/pm-executions')[0].json).toEqual({ scheduleEntryId: 'due', entityId: 'ahu-1' });
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/ahu-1').length).toBeGreaterThan(1));
    expect(screen.getByRole('button', { name: 'Start PM' })).toBeEnabled();
  });

  it('a refusal shows a dismissible banner and re-enables the button', async () => {
    open(EXECUTOR, { version: 1, status: 'ACTIVE', entries: [visit('due', 0, { month: 1 })] }, [
      { method: 'POST', path: '/api/pm-executions', status: 409, times: 1, body: { error: 'ALREADY_STARTED', message: 'Already in progress' } },
      { method: 'POST', path: '/api/pm-executions', status: 500, body: { message: '' } },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Start PM' }));
    expect(await screen.findByText('Already in progress')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start PM' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(screen.queryByText('Already in progress')).toBeNull();
    // A refusal without a message still says what failed.
    fireEvent.click(screen.getByRole('button', { name: 'Start PM' }));
    expect(await screen.findByText('Failed to start PM')).toBeInTheDocument();
  });

  it('with START_PM_TASK on, the start is signed; cancelling sends nothing and re-enables Start', async () => {
    const api = open(EXECUTOR, { version: 1, status: 'ACTIVE', entries: [visit('due', 0, { month: 1 })] }, [
      { method: 'POST', path: '/api/pm-executions', status: 201, body: { id: 'x1' } },
    ], ['START_PM_TASK']);
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Start PM' }));
    expect(await screen.findByText(/Start PM Task/)).toBeInTheDocument(); // the action label in the prompt
    expect(screen.getByRole('button', { name: 'Starting...' })).toBeDisabled();
    const box = screen.getByText('Confirm Your Identity').closest('.relative') as HTMLElement;
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Start PM' })).toBeEnabled();
    expect(api.calls('POST', '/api/pm-executions')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Start PM' }));
    await passReauth();
    await waitFor(() => expect(api.calls('POST', '/api/pm-executions')).toHaveLength(1));
    expectSigned(api.calls('POST', '/api/pm-executions')[0]);
  });
});
