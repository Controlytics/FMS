/**
 * My Tasks (/my-tasks) through the page harness. Coverage campaign 2026-10-21.
 *
 * Rules exercised:
 *  - Perform needs PM_EXECUTE (my_tasks.perform); without it the card says
 *    "View only";
 *  - a written-off visit ("not_performed") is terminal: amber, never green,
 *    never counted as Completed, no Perform, and its reason is shown;
 *  - an overdue task with an open, unacknowledged deviation asks for the
 *    operator's password (POST /deviations/:id/acknowledge) before cleaning;
 *  - filters (search / block / area / status / period) narrow the lists;
 *    the period is a server filter (from / to on /due).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, clearGlobalSwrCache, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC, LocationProbe } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { MyTasksPage } from '../index';
import { OverdueAckDialog } from '../overdue-ack-dialog';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const DAY = 86_400_000;
const at = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const ymd = (iso: string) => iso.slice(0, 10);

const task = (id: string, over: Record<string, any> = {}) => ({
  entryId: id, ahuId: `ahu-${id}`, ahuName: `AHU-${id}`, areaId: 'ar1', areaName: 'Area 1', blockId: 'b1', blockName: 'Block A',
  plannedDate: at(0), toleranceDays: 3, windowStart: at(-3), windowEnd: at(3),
  totalFilters: 4, cleanedCount: 1, overallStatus: 'pending', filters: [], deviation: null, ...over,
});
const dev = (over: Record<string, any> = {}) => ({
  deviationId: 'dv1', deviationNumber: 'DEV-0007', status: 'OPEN', overdueDays: 5, acknowledged: false, acknowledgedByName: null, ...over,
});
const TASKS = [
  task('01', {
    filters: [
      { filterId: 'f1', filterName: 'FLT-1', status: 'cleaned_in_window', lastCycleCompletedAt: at(-1) },
      { filterId: 'f2', filterName: 'FLT-2', status: 'pending', lastCycleCompletedAt: null },
      { filterId: 'f3', filterName: 'FLT-3', status: 'in_progress', lastCycleCompletedAt: null },
      { filterId: 'f4', filterName: 'FLT-4', status: 'skipped', lastCycleCompletedAt: null },
    ],
  }),
  task('02', { overallStatus: 'complete', cleanedCount: 4, plannedDate: at(-2), blockId: 'b2', blockName: 'Block B', areaId: 'ar2', areaName: 'Area 2' }),
  task('03', { overallStatus: 'not_performed', plannedDate: at(-20), skipReason: 'Plant shutdown', skippedByName: 'qa1', skippedAt: at(-10), areaId: null, areaName: null }),
  task('04', { overallStatus: 'in_progress', totalFilters: 0, cleanedCount: 0, blockId: null, blockName: null, areaId: null, areaName: null, plannedDate: at(30) }),
  task('05', { overallStatus: 'not_performed', skipReason: 'Written off', skippedByName: null, skippedAt: null }),
  task('06', { overallStatus: 'not_performed', skipReason: null, skippedByName: 'x' }),
];
const OVERDUE = [
  task('90', { overallStatus: 'overdue', plannedDate: at(-15), windowStart: at(-18), windowEnd: at(-12), deviation: dev() }),
  task('91', { overallStatus: 'overdue', plannedDate: at(-15), deviation: dev({ deviationId: 'dv2', acknowledged: true, acknowledgedByName: 'opr9', overdueDays: 1 }) }),
  task('92', { overallStatus: 'overdue', deviation: dev({ deviationId: 'dv3', status: 'CLOSED' }) }),
  task('93', { overallStatus: 'overdue', deviation: dev({ deviationId: 'dv4', acknowledged: true, acknowledgedByName: null }) }),
];
const PERFORMER = role('OPERATOR', ['PM_READ', 'PM_EXECUTE']);
const VIEWER = role('MANAGER', ['PM_READ']);
const BLOCKS = [{ id: 'b2', name: 'Block B' }, { id: 'b1', name: 'Block A' }];
const AREAS = [{ id: 'ar2', name: 'Area 2', blockId: 'b2' }, { id: 'ar1', name: 'Area 1', blockId: 'b1' }];

function dueRoute(tasks: any[] = TASKS, overdue: any[] = OVERDUE): MockRoute {
  return { path: '/api/pm-schedules/due', body: { tasks, overdue, settings: { showOverdueSeparately: true } } };
}
function open(user: any = PERFORMER, due: MockRoute = dueRoute(), extra: MockRoute[] = [], globalCache = false) {
  const api = mockApi([
    ...extra, due,
    { path: '/api/hierarchy/blocks', body: { data: BLOCKS } },
    { path: '/api/hierarchy/areas', body: { data: AREAS } },
    DT_UTC, ...baseRoutes(),
  ]);
  renderPage(<><MyTasksPage /><LocationProbe /></>, { user, api, route: '/my-tasks', globalCache });
  return api;
}
const cardOf = (ahu: string) => screen.getByRole('heading', { name: ahu }).closest('.rounded-2xl') as HTMLElement;
const stat = (label: string) => screen.getByText(label, { selector: 'div.text-xs' }).previousSibling as HTMLElement;
/** A filter select by its (associated) label. */
const filterSelect = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const shownCount = () => screen.getByText(/^Showing/, { selector: 'div.mt-3' }).textContent;

describe('My Tasks — what is shown', () => {
  it('stat tiles count the full set; a written-off visit is never "Completed"', async () => {
    const api = open();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(3); // loading skeleton
    expect(await screen.findByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
    expect(stat('Due Now')).toHaveTextContent('6');
    expect(stat('Due Today')).toHaveTextContent('3'); // 01, 05, 06 are planned today
    expect(stat('Completed')).toHaveTextContent('1');
    expect(stat('Overdue')).toHaveTextContent('4');
    expect(shownCount()).toBe('Showing 10 of 10 tasks');
    expect(api.unmatched).toEqual([]);
  });

  it('each card shows its place, status, schedule, progress and any write-off reason', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    const c1 = cardOf('AHU-01');
    expect(within(c1).getByText('Block A')).toBeInTheDocument();
    expect(within(c1).getByText('Area 1')).toBeInTheDocument();
    expect(within(c1).getByText('Pending')).toBeInTheDocument();
    expect(c1).toHaveTextContent(`Scheduled: ${ymd(at(0))}`);
    expect(c1).toHaveTextContent(`Window: ${ymd(at(-3))} → ${ymd(at(3))}`);
    expect(c1).toHaveTextContent('1/4 cleaned');
    expect((c1.querySelector('[style*="width"]') as HTMLElement).style.width).toBe('25%');

    const done = cardOf('AHU-02');
    expect(within(done).getAllByText('Completed')).toHaveLength(2); // chip + terminal badge
    expect(within(done).queryByRole('button', { name: /Perform/ })).toBeNull();

    const off = cardOf('AHU-03');
    expect(within(off).getAllByText('Not Performed').length).toBeGreaterThan(0);
    expect(off).toHaveTextContent(`Not performed — Plant shutdown · recorded by qa1 on ${ymd(at(-10))}`);
    expect(within(off).queryByRole('button', { name: /Perform/ })).toBeNull();
    // Block only (no area): no separator.
    expect(within(off).queryByText('/')).toBeNull();
    expect(cardOf('AHU-05')).toHaveTextContent('Not performed — Written off');
    expect(cardOf('AHU-05')).not.toHaveTextContent('recorded by');
    // A write-off without a reason shows no reason box.
    expect(cardOf('AHU-06')).not.toHaveTextContent('Not performed —');

    const noFilters = cardOf('AHU-04');
    expect(within(noFilters).getByText('In Progress')).toBeInTheDocument();
    expect(noFilters.querySelector('[style*="width"]')).toBeNull(); // no bar with 0 filters
    expect(within(noFilters).queryByText('Block A')).toBeNull();
  });

  it('expanding a card lists its filters with their state and last cycle; collapse hides them', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    fireEvent.click(within(cardOf('AHU-01')).getByRole('button', { name: 'Expand' }));
    const chip = screen.getByText('FLT-1').closest('span') as HTMLElement;
    expect(chip).toHaveTextContent('· Done');
    expect(chip).toHaveAttribute('title', expect.stringMatching(/^Last cycle: /));
    expect(screen.getByText('FLT-2').closest('span')).toHaveAttribute('title', 'No cycles yet');
    expect(screen.getByText('FLT-3').closest('span')).toHaveTextContent('· Cleaning');
    expect(screen.getByText('FLT-4').closest('span')).toHaveTextContent('· Not Done');
    fireEvent.click(within(cardOf('AHU-01')).getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('FLT-1')).toBeNull();
    fireEvent.click(within(cardOf('AHU-04')).getByRole('button', { name: 'Expand' }));
    expect(within(cardOf('AHU-04')).getByText('This AHU has no active child filters.')).toBeInTheDocument();
  });

  it('the overdue section names its count and the deviation state of each task', async () => {
    open();
    await screen.findByRole('heading', { name: 'Overdue' });
    expect(screen.getByText('(4 AHUs past window without completion)')).toBeInTheDocument();
    const o = cardOf('AHU-90');
    expect(within(o).getByText('Overdue by 5 days')).toHaveAttribute('title', 'Deviation DEV-0007');
    const ack = cardOf('AHU-91');
    expect(within(ack).getByText('Overdue by 1 day')).toBeInTheDocument();
    expect(within(ack).getByText('Acknowledged').closest('span')).toHaveAttribute('title', 'Acknowledged by opr9');
    expect(within(cardOf('AHU-93')).getByText('Acknowledged').closest('span')).toHaveAttribute('title', 'Acknowledged');
    // A closed deviation shows no "Overdue by" chip.
    expect(within(cardOf('AHU-92')).queryByText(/Overdue by/)).toBeNull();
  });

  it('overdue cards expand and collapse like the others', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-90' });
    fireEvent.click(within(cardOf('AHU-90')).getByRole('button', { name: 'Expand' }));
    expect(within(cardOf('AHU-90')).getByText('This AHU has no active child filters.')).toBeInTheDocument();
    fireEvent.click(within(cardOf('AHU-90')).getByRole('button', { name: 'Collapse' }));
    expect(within(cardOf('AHU-90')).queryByText('This AHU has no active child filters.')).toBeNull();
  });

  it('nothing due: an encouraging empty state', async () => {
    open(PERFORMER, dueRoute([], []));
    expect(await screen.findByText('Nothing due right now')).toBeInTheDocument();
    expect(screen.getByText('Tasks will appear here when today falls inside a scheduled tolerance window')).toBeInTheDocument();
    expect(shownCount()).toBe('Showing 0 of 0 tasks');
  });

  it('one task reads singular; one overdue AHU too', async () => {
    open(PERFORMER, dueRoute([], [OVERDUE[0]]));
    expect(await screen.findByText('(1 AHU past window without completion)')).toBeInTheDocument();
    expect(shownCount()).toBe('Showing 1 of 1 task');
  });
});

describe('My Tasks — filters', () => {
  it('search matches AHU, block or area; Clear resets everything', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    const search = screen.getByPlaceholderText('AHU, block or area…');
    fireEvent.change(search, { target: { value: 'block b' } });
    expect(screen.getByRole('heading', { name: 'AHU-02' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AHU-01' })).toBeNull();
    expect(screen.getByText(/· filtered/)).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'area 1' } });
    expect(screen.getByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'ahu-9' } });
    expect(screen.queryByRole('heading', { name: 'AHU-01' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'AHU-90' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No matching tasks')).toBeInTheDocument();
    expect(screen.getByText('Try adjusting or clearing the filters')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(search).toHaveValue('');
    expect(screen.getByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('blocks are sorted; areas narrow to the chosen block; changing block resets the area', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    const block = filterSelect('Block');
    const area = filterSelect('Area');
    expect(Array.from(block.options).map((o) => o.text)).toEqual(['All blocks', 'Block A', 'Block B']);
    expect(Array.from(area.options).map((o) => o.text)).toEqual(['All areas', 'Area 1', 'Area 2']);
    fireEvent.change(area, { target: { value: 'ar2' } });
    expect(screen.getByRole('heading', { name: 'AHU-02' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AHU-01' })).toBeNull();
    fireEvent.change(block, { target: { value: 'b1' } });
    expect(area).toHaveValue('');
    expect(Array.from(area.options).map((o) => o.text)).toEqual(['All areas', 'Area 1']);
    expect(screen.getByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AHU-02' })).toBeNull();
    fireEvent.change(area, { target: { value: 'ar1' } });
    expect(screen.getByRole('heading', { name: 'AHU-01' })).toBeInTheDocument();
  });

  it('status narrows both lists', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    fireEvent.change(filterSelect('Status'), { target: { value: 'overdue' } });
    expect(screen.queryByRole('heading', { name: 'AHU-01' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'AHU-90' })).toBeInTheDocument();
    fireEvent.change(filterSelect('Status'), { target: { value: 'not_performed' } });
    expect(screen.getByRole('heading', { name: 'AHU-03' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Overdue' })).toBeNull();
    expect(shownCount()).toBe('Showing 3 of 10 tasks · filtered');
  });

  it('a period is a server filter: from / to ride on /due', async () => {
    const api = open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    fireEvent.change(screen.getByLabelText('Tasks from date'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/due').at(-1)!.query.get('from')).toBe('2026-11-01'));
    fireEvent.change(screen.getByLabelText('Tasks to date'), { target: { value: '2026-11-30' } });
    await waitFor(() => {
      const last = api.calls('GET', '/api/pm-schedules/due').at(-1)!;
      expect(last.query.get('from')).toBe('2026-11-01');
      expect(last.query.get('to')).toBe('2026-11-30');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Clear date range' }));
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/due').at(-1)!.url).toBe('/api/pm-schedules/due'));
  });

  it('more than a page of tasks pages each list on its own; the page size is shared', async () => {
    const many = Array.from({ length: 27 }, (_, i) => task(`p${String(i).padStart(2, '0')}`));
    const late = Array.from({ length: 26 }, (_, i) => task(`q${String(i).padStart(2, '0')}`, { overallStatus: 'overdue' }));
    // A list opens on the FIRST configured page-size option (usePageSize): 25 here.
    open(PERFORMER, dueRoute(many, late), [{ path: '/api/config/pagination/current', body: { limit: 100, count: 3, options: [25, 50, 100] } }]);
    expect(await screen.findByRole('heading', { name: 'AHU-p24' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AHU-p25' })).toBeNull();
    const [nextTasks, nextOverdue] = screen.getAllByRole('button', { name: 'Next page' });
    fireEvent.click(nextTasks);
    expect(await screen.findByRole('heading', { name: 'AHU-p26' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AHU-q00' })).toBeInTheDocument();
    fireEvent.click(nextOverdue);
    expect(await screen.findByRole('heading', { name: 'AHU-q25' })).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox', { name: /Rows/ })[0], { target: { value: '50' } });
    expect(await screen.findByRole('heading', { name: 'AHU-p00' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AHU-q00' })).toBeInTheDocument();
  });
});

describe('My Tasks — load errors', () => {
  it('PM disabled reads as a configuration notice, not an error', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(PERFORMER, { path: '/api/pm-schedules/due', status: 400, body: { error: 'PM_DISABLED', message: 'off' } });
    expect(await screen.findByText(/Preventive Maintenance scheduling is disabled/)).toBeInTheDocument();
  });

  it('the disabled message is recognised by its text too; any other failure is shown as such', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(PERFORMER, { path: '/api/pm-schedules/due', status: 400, body: { error: 'BAD', message: 'PM scheduling module is not enabled' } });
    expect(await screen.findByText(/Preventive Maintenance scheduling is disabled/)).toBeInTheDocument();
  });

  it('a server failure says "Failed to load tasks" with the reason', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(PERFORMER, { path: '/api/pm-schedules/due', status: 500, body: { error: 'X', message: 'db down' } });
    expect(await screen.findByText('Failed to load tasks: db down')).toBeInTheDocument();
  });
});

describe('My Tasks — load error without an error code', () => {
  it('a failure whose body carries only a message is still shown as a load failure', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(PERFORMER, { path: '/api/pm-schedules/due', status: 500, body: { message: 'gateway hiccup' } });
    expect(await screen.findByText('Failed to load tasks: gateway hiccup')).toBeInTheDocument();
  });
});

describe('My Tasks — Perform', () => {
  it('Perform on a task goes to Filter Operations for that AHU', async () => {
    open();
    await screen.findByRole('heading', { name: 'AHU-01' });
    fireEvent.click(within(cardOf('AHU-01')).getByRole('button', { name: /Perform/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/filters?ahuId=ahu-01');
  });

  it('a view-only role sees "View only" and no Perform', async () => {
    open(VIEWER);
    await screen.findByRole('heading', { name: 'AHU-01' });
    expect(screen.queryByRole('button', { name: /Perform/ })).toBeNull();
    expect(within(cardOf('AHU-01')).getByText('View only')).toBeInTheDocument();
  });

  it('an overdue task already acknowledged goes straight to cleaning', async () => {
    const api = open();
    await screen.findByRole('heading', { name: 'AHU-91' });
    fireEvent.click(within(cardOf('AHU-91')).getByRole('button', { name: /Perform/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/filters?ahuId=ahu-91');
    expect(api.calls('POST', /acknowledge/)).toHaveLength(0);
  });

  it('overdue + open deviation: the password is posted to acknowledge, then the task list re-reads and cleaning opens', async () => {
    await clearGlobalSwrCache();
    const api = open(PERFORMER, dueRoute(), [
      { method: 'POST', path: '/api/pm-schedules/deviations/dv1/acknowledge', status: 401, times: 1, body: { error: 'REAUTH_FAILED', message: 'Invalid password' } },
      { method: 'POST', path: '/api/pm-schedules/deviations/dv1/acknowledge', body: { ok: true } },
    ], true);
    await screen.findByRole('heading', { name: 'AHU-90' });
    fireEvent.click(within(cardOf('AHU-90')).getByRole('button', { name: /Perform/ }));
    const dlg = screen.getByRole('dialog', { name: 'Overdue cleaning confirmation' });
    expect(dlg).toHaveTextContent('These AHU-90 filters are already overdue by 5 days (4 filters).');
    expect(dlg).toHaveTextContent('Deviation DEV-0007');
    const confirm = within(dlg).getByRole('button', { name: /Confirm & Continue/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(confirm);
    expect(await within(dlg).findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/my-tasks$/);
    // Typing clears the error; Enter confirms.
    fireEvent.change(within(dlg).getByLabelText('Password'), { target: { value: 'Secret@123' } });
    expect(within(dlg).queryByText('Incorrect password. Please try again.')).toBeNull();
    const reads = api.calls('GET', '/api/pm-schedules/due').length;
    fireEvent.keyDown(within(dlg).getByLabelText('Password'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/filters?ahuId=ahu-90'));
    const posts = api.calls('POST', '/api/pm-schedules/deviations/dv1/acknowledge');
    expect(posts[1].headers['x-reauth-password']).toBe('Secret@123');
    expect(posts[1].json._currentPassword).toBe('Secret@123');
    expect(api.calls('GET', '/api/pm-schedules/due').length).toBeGreaterThan(reads);
    expect(screen.queryByRole('dialog', { name: 'Overdue cleaning confirmation' })).toBeNull();
  });

  it('Cancel or a click on the backdrop closes the confirmation with nothing sent', async () => {
    const api = open();
    await screen.findByRole('heading', { name: 'AHU-90' });
    fireEvent.click(within(cardOf('AHU-90')).getByRole('button', { name: /Perform/ }));
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Overdue cleaning confirmation' })); // inside: stays
    expect(screen.getByRole('dialog', { name: 'Overdue cleaning confirmation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Overdue cleaning confirmation' })).toBeNull();
    fireEvent.click(within(cardOf('AHU-90')).getByRole('button', { name: /Perform/ }));
    fireEvent.mouseDown(screen.getByRole('dialog', { name: 'Overdue cleaning confirmation' }).parentElement as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Overdue cleaning confirmation' })).toBeNull();
    expect(api.calls('POST', /acknowledge/)).toHaveLength(0);
  });
});

describe('OverdueAckDialog — edges', () => {
  const t = { ahuName: 'AHU-7', totalFilters: 1, deviation: { deviationId: 'd9', deviationNumber: 'DEV-9', overdueDays: 1 } };

  it('without the acknowledge gate there is no Confirm, and Enter does nothing', () => {
    const api = mockApi([]);
    const onAck = vi.fn();
    render(<OverdueAckDialog task={t} canConfirm={false} onCancel={() => {}} onAcknowledged={onAck} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('overdue by 1 day (1 filter)');
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' });
    expect(api.requests).toHaveLength(0);
    expect(onAck).not.toHaveBeenCalled();
  });

  it('a blank password is not sent; a refusal shows its message (or the HTTP status) and the dialog stays usable', async () => {
    sessionStorage.setItem('access_token', 't');
    const api = mockApi([
      { method: 'POST', path: '/api/pm-schedules/deviations/d9/acknowledge', status: 403, times: 1, body: { error: 'FORBIDDEN', message: 'Missing PM_EXECUTE' } },
      { method: 'POST', path: '/api/pm-schedules/deviations/d9/acknowledge', status: 409, body: {} },
    ]);
    const onCancel = vi.fn();
    render(<OverdueAckDialog task={t} canConfirm onCancel={onCancel} onAcknowledged={() => {}} />);
    const pw = screen.getByLabelText('Password');
    fireEvent.change(pw, { target: { value: '   ' } });
    fireEvent.keyDown(pw, { key: 'Enter' });
    expect(api.requests).toHaveLength(0);
    fireEvent.change(pw, { target: { value: 'Secret@123' } });
    fireEvent.keyDown(pw, { key: 'a' });
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Continue/ }));
    expect(await screen.findByText('Missing PM_EXECUTE')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Continue/ }));
    expect(await screen.findByText('Request failed: 409')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('while the acknowledgement is in flight the buttons lock and the backdrop does not close it', async () => {
    sessionStorage.setItem('access_token', 't');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mockApi([{ method: 'POST', path: '/api/pm-schedules/deviations/d9/acknowledge', body: { ok: true } }]);
    const onCancel = vi.fn();
    const onAck = vi.fn(() => gate);
    render(<OverdueAckDialog task={t} canConfirm onCancel={onCancel} onAcknowledged={onAck} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret@123' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Continue/ }));
    await waitFor(() => expect(onAck).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /Confirm & Continue/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText('Password'), { key: 'Enter' }); // a second confirm is ignored
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onCancel).not.toHaveBeenCalled();
    release();
    await gate;
  });
});

