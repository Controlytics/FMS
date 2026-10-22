/**
 * Deviations — defects found by the coverage campaign (2026-10-21), pinned
 * failing-first:
 *  D-OPS-6  a failed load read "No deviations" (and "0 deviations") instead
 *           of an error with Retry.
 *  3d       every control has an accessible name (lock).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { baseRoutes, usePageTestLifecycle, SA, role, allowConsoleError } from '../../filter-management/__tests__/fm-test-kit';
import { DT_UTC } from '../../cleaning-cycles/__tests__/cycles-fixtures';
import { unnamedControls } from '../../pm-schedules/__tests__/a11y-kit';
import { DeviationsPage } from '../index';

usePageTestLifecycle();
configure({ asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30000 });

const DEV = { id: 'd1', deviationNumber: 'DEV-0001', ahuName: 'AHU-01', filterCount: 4, scheduledDate: '2026-06-20T06:00:00.000Z',
  windowStart: '2026-06-17T06:00:00.000Z', windowEnd: '2026-06-23T06:00:00.000Z', overdueDaysAtOpen: 2, liveOverdueDays: 3, status: 'OPEN' };
const LIST_OK: MockRoute = { path: '/api/pm-schedules/deviations', body: { data: [DEV], total: 1, openCount: 1, totalPages: 1 } };

function open(user: any, routes: MockRoute[]) {
  const api = mockApi([...routes, { path: '/api/users', body: { data: [] } }, DT_UTC, ...baseRoutes()]);
  renderPage(<DeviationsPage />, { user, api });
  return api;
}

describe('D-OPS-6 — a failed load is an error with Retry, never "No deviations"', () => {
  it('a 500: error + Retry, no empty state, no "0 deviations"; Retry re-reads', async () => {
    allowConsoleError(/\[SWR Error\]/);
    // Fails until the test lets it succeed: a cold load asks twice (the page size
    // settles from the pre-load default to the configured one), so a one-shot
    // failure would be answered by the second read.
    const api = open(role('QA', ['PM_READ']), [
      { path: '/api/pm-schedules/deviations', status: 500, body: { error: 'X', message: 'deviations exploded' } },
    ]);
    // Settled on the first configured page-size option (10 in the kit).
    await waitFor(() => expect(api.calls('GET', '/api/pm-schedules/deviations').at(-1)!.query.get('limit')).toBe('10'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the deviations');
    expect(alert).toHaveTextContent('deviations exploded');
    expect(screen.queryByText('No deviations')).toBeNull();
    expect(screen.queryByText(/^0 deviations/)).toBeNull();
    api.add(LIST_OK); // the server recovers
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('DEV-0001')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a 403: a permission message and no Retry', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('X', []), [{ path: '/api/pm-schedules/deviations', status: 403, body: { error: 'FORBIDDEN', message: 'Missing PM_READ' } }]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('You do not have permission to view deviations');
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('a failure with no message still explains itself', async () => {
    allowConsoleError(/\[SWR Error\]/);
    open(role('QA', ['PM_READ']), [{ path: '/api/pm-schedules/deviations', status: 502, body: { message: '' } }]);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server did not answer.');
  });
});

describe('3d — every control on Deviations has an accessible name', () => {
  it('list, toolbar, export menu, Super Admin editor', async () => {
    open(SA, [LIST_OK]);
    await screen.findByText('DEV-0001');
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^Export$/ }));
    expect(unnamedControls()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit record (Super Admin)' }));
    expect(unnamedControls()).toEqual([]);
  });
});
