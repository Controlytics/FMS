/**
 * My Tasks — defects found by the coverage campaign (2026-10-21), pinned
 * failing-first:
 *  D-OPS-9  a refusal with an empty message left the overdue acknowledgement
 *           with no error text at all.
 *  3d       the Search / Block / Area / Status filters had no accessible name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, configure } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, role } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { unnamedControls } from '../../pm-schedules/__tests__/a11y-kit';
import { MyTasksPage } from '../index';
import { OverdueAckDialog } from '../overdue-ack-dialog';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const now = () => new Date().toISOString();

describe('D-OPS-9 — an empty refusal message still says something', () => {
  it('a 409 whose message is empty shows the generic line', async () => {
    sessionStorage.setItem('access_token', 't');
    mockApi([{ method: 'POST', path: '/api/pm-schedules/deviations/d9/acknowledge', status: 409, body: { message: '' } }]);
    render(<OverdueAckDialog task={{ ahuName: 'AHU-7', totalFilters: 1, deviation: { deviationId: 'd9', deviationNumber: 'DEV-9', overdueDays: 1 } }}
      canConfirm onCancel={() => {}} onAcknowledged={() => {}} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Secret@123' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Continue/ }));
    expect(await screen.findByText('Could not confirm — please try again.')).toBeInTheDocument();
  });
});

describe('My Tasks starts on the CONFIGURED page size (usePageSize, 2026-10-22)', () => {
  it('Config → Pagination 10: the first page lists 10 tasks, not the old hard-coded 25', async () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      entryId: `t${i}`, ahuId: `a${i}`, ahuName: `AHU-${String(i).padStart(2, '0')}`, areaId: null, areaName: null, blockId: null, blockName: null,
      plannedDate: now(), toleranceDays: 1, windowStart: now(), windowEnd: now(), totalFilters: 0, cleanedCount: 0, overallStatus: 'pending', filters: [],
    }));
    const api = mockApi([
      { path: '/api/pm-schedules/due', body: { tasks, overdue: [], settings: {} } },
      { path: '/api/hierarchy/blocks', body: { data: [] } }, { path: '/api/hierarchy/areas', body: { data: [] } },
      DT_UTC, ...baseRoutes({ pagination: { limit: 10, options: [10, 25, 50] } }),
    ]);
    renderPage(<MyTasksPage />, { user: role('OPERATOR', ['PM_READ', 'PM_EXECUTE']), api, route: '/my-tasks' });
    await screen.findByRole('heading', { name: 'AHU-00' });
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'AHU-10' })).toBeNull());
    expect(screen.getByRole('heading', { name: 'AHU-09' })).toBeInTheDocument();
  });
});

describe('3d — every control on My Tasks has an accessible name', () => {
  it('filters, task cards (expanded), pager, overdue acknowledgement dialog', async () => {
    const task = (id: string, over: Record<string, any> = {}) => ({
      entryId: id, ahuId: `ahu-${id}`, ahuName: `AHU-${id}`, areaId: 'ar1', areaName: 'Area 1', blockId: 'b1', blockName: 'Block A',
      plannedDate: now(), toleranceDays: 3, windowStart: now(), windowEnd: now(), totalFilters: 1, cleanedCount: 0,
      overallStatus: 'pending', filters: [{ filterId: 'f1', filterName: 'FLT-1', status: 'pending', lastCycleCompletedAt: null }], ...over,
    });
    const api = mockApi([
      { path: '/api/pm-schedules/due', body: { tasks: [task('01')], overdue: [task('90', { overallStatus: 'overdue', deviation: { deviationId: 'dv', deviationNumber: 'DEV-1', status: 'OPEN', overdueDays: 2, acknowledged: false, acknowledgedByName: null } })], settings: {} } },
      { path: '/api/hierarchy/blocks', body: { data: [{ id: 'b1', name: 'Block A' }] } },
      { path: '/api/hierarchy/areas', body: { data: [{ id: 'ar1', name: 'Area 1', blockId: 'b1' }] } },
      DT_UTC, ...baseRoutes(),
    ]);
    renderPage(<MyTasksPage />, { user: role('OPERATOR', ['PM_READ', 'PM_EXECUTE']), api, route: '/my-tasks' });
    await screen.findByRole('heading', { name: 'AHU-01' });
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Block')).toBeInTheDocument();
    expect(screen.getByLabelText('Area')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0]);
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: /Perform/ })[1]);
    expect(screen.getByRole('dialog', { name: 'Overdue cleaning confirmation' })).toBeInTheDocument();
    expect(unnamedControls()).toEqual([]);
  });
});
