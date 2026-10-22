import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { captureConsole, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { SA, ROWS, page, auditRoutes, lastList, myActionsLoaded } from './audit-page-fixtures';
import { AuditTrailPage } from '../index';

/**
 * Audit Trail search scope (2026-10-22). The server matches names INSIDE the
 * records (a filter, an AHU) only within a date range of at most 31 days - at
 * one-year volume a whole-table value scan took 37 s - and says which it did
 * (`valueSearch`). Without a hint, a search for a filter name with no range
 * returns 0 rows and reads as "this never happened".
 */
const HINT = /Searched user, action, target and role only\. To also find names inside the records \(a filter or AHU\), set a From and To range of up to 31 days\./;

let con: ConsoleCapture;
beforeEach(() => { con = captureConsole(); });
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); });

async function typeSearch(api: ReturnType<typeof mockApi>, term: string) {
  await myActionsLoaded(api);
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: term } });
  await waitFor(() => expect(lastList(api).query.get('search')).toBe(term));
}

describe('Audit Trail — what a search covered', () => {
  it('says so when names inside the records were NOT searched (no range / range over 31 days)', async () => {
    const api = mockApi(auditRoutes({ list: page(ROWS, { valueSearch: 'skipped', valueSearchMaxDays: 31 }) }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await typeSearch(api, 'PF-B5/AHU-29');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent(HINT);
    expect(screen.getByLabelText('Search')).toHaveAttribute('aria-describedby', 'audit-filter-search-scope');
    expect(con.errors).toEqual([]);
  });

  it('is silent when the names were searched too, and when there is no search at all', async () => {
    const api = mockApi(auditRoutes({ list: page(ROWS, { valueSearch: 'applied', valueSearchMaxDays: 31 }) }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await typeSearch(api, 'PF-B5/AHU-29');
    expect(screen.queryByText(HINT)).toBeNull();
    cleanup();

    const api2 = mockApi(auditRoutes({ list: page(ROWS, { valueSearch: 'skipped', valueSearchMaxDays: 31 }) }));
    renderPage(<AuditTrailPage />, { user: SA, api: api2 });
    await myActionsLoaded(api2);
    expect(screen.queryByText(HINT)).toBeNull(); // nothing typed: nothing to explain
  });
});
