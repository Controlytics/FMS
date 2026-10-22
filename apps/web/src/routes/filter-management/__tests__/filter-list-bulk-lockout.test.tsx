/**
 * Filters page — an account lockout during a SIGNED bulk action (2026-10-22).
 *
 * The bulk status and bulk retire/replace loops send the typed password with
 * every filter. When that password trips the lockout threshold the server
 * answers 403 ACCOUNT_LOCKED — and the loop used to count it as a per-filter
 * failure and carry on, re-sending the same wrong password for every remaining
 * filter: each one another failed signature (an audit row) against a locked
 * account, then "none updated" listing every filter as if each had its own
 * problem. The lockout is a refusal of the SIGNATURE, not of a filter: the batch
 * stops at the first one and the refusal is shown once, through onError.
 */
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, within, waitFor } from '@testing-library/react';
import { usePageTestLifecycle, role, passReauth } from './fm-test-kit';
import { setupApi, renderFilters, openFiltersTab, row, field, panel, waitForReauthConfig } from './filter-list-fixtures';

usePageTestLifecycle();

const OPERATOR = role('SUPERVISOR', ['ASSET_READ', 'FILTER_RETIRE', 'FILTER_REPLACE', 'FILTER_STATUS_UPDATE']);
const bulkBar = () => screen.getByText(/filter\(s\) selected/).closest('.rounded-xl') as HTMLElement;
const LOCKED = { error: 'ACCOUNT_LOCKED', message: 'Account locked due to multiple failed attempts. Contact administrator.' };
const opt = (state: string) => ({ state, classification: 'COMPLETE', allowed: true, isCurrent: false, startsCycle: false });

async function tickTwo() {
  await openFiltersTab();
  fireEvent.click(within(row('PF-001')).getByRole('checkbox'));
  fireEvent.click(within(row('PF-002')).getByRole('checkbox'));
}

describe('Filters page — a lockout stops a signed bulk action', () => {
  it('bulk status: one request, the lockout shown once ("Update Failed"), the panel unlocked for nothing else', async () => {
    const api = setupApi({
      base: { reauthActions: ['UPDATE_FILTER_LIFECYCLE'] },
      extra: [
        { path: /\/api\/filters\/f\d\/stage-options/, body: { hasProfile: true, options: [opt('CLEANING_CYCLE_COMPLETED')], cleaningReasons: [] } },
        { method: 'PATCH', path: /\/api\/assets\/instances\/f\d\/lifecycle-state/, status: 403, body: LOCKED },
      ],
    });
    renderFilters(OPERATOR, api);
    await waitForReauthConfig(api);
    await tickTwo();
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Update Status' }));
    const p = panel('Bulk Status Update');
    await waitFor(() => expect(within(field('New Status', p)).getByRole('option', { name: 'Cleaning Cycle Completed' })).toBeEnabled());
    fireEvent.change(field('New Status', p), { target: { value: 'CLEANING_CYCLE_COMPLETED' } });
    fireEvent.change(field('Remarks', p), { target: { value: 'Close out' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Update 2 Filter(s)' }));
    await passReauth('Wrong@1');
    expect(await screen.findByText('Update Failed')).toBeInTheDocument();
    expect(screen.getByText(LOCKED.message)).toBeInTheDocument();
    expect(screen.queryByText(/none updated/)).toBeNull();
    // the batch stopped at the first refusal: the wrong password was not sent again
    expect(api.requests.filter((r) => r.method === 'PATCH').map((r) => r.path)).toEqual(['/api/assets/instances/f1/lifecycle-state']);
    expect(screen.queryByPlaceholderText('Enter your password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('Bulk Status Update')).getByRole('button', { name: 'Update 2 Filter(s)' })).toBeEnabled();
  });

  it('bulk replace: one request, the lockout shown once ("Bulk action failed"), not "2 filter(s) failed"', async () => {
    const api = setupApi({
      base: { reauthActions: ['REPLACE_FILTER'] },
      extra: [{ method: 'POST', path: /\/api\/filters\/f\d\/replace/, status: 403, body: LOCKED }],
    });
    renderFilters(OPERATOR, api);
    await waitForReauthConfig(api);
    await tickTwo();
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Replace' }));
    const p = panel('Bulk Replacement');
    fireEvent.change(within(p).getByPlaceholderText('Enter reason for replacement...'), { target: { value: 'End of life' } });
    fireEvent.click(within(p).getByRole('button', { name: 'Replace 2 Filter(s)' }));
    await passReauth('Wrong@1');
    expect(await screen.findByText('Bulk action failed')).toBeInTheDocument();
    expect(screen.getByText(LOCKED.message)).toBeInTheDocument();
    expect(screen.queryByText(/Bulk Replacement Failed/)).toBeNull();
    expect(api.requests.filter((r) => r.method === 'POST' && /\/replace$/.test(r.path)).map((r) => r.path)).toEqual(['/api/filters/f1/replace']);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(within(panel('Bulk Replacement')).getByRole('button', { name: 'Replace 2 Filter(s)' })).toBeEnabled();
  });
});
