import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { captureConsole, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { SA, REC, ROWS, page, auditRoutes, myActionsLoaded, rowOf } from './audit-page-fixtures';
import { AuditTrailPage } from '../index';
import { AUDIT_META_ACTIONS, canRedactRecord } from '../audit-helpers';

// Full-page renders through the real SWR/auth/re-auth stack (budget only, no behaviour change).
vi.setConfig({ testTimeout: 20_000 });

/**
 * A record of a change to the audit trail cannot be redacted (security
 * assessment P1 + operator decision, 2026-10-22). A redacted row is verified
 * against the AUDIT_RECORD_REDACTED / AUDIT_RECORDS_BULK_REDACTED row that
 * recorded it, and an AUDIT_RECORD_DELETED row holds the only surviving copy of
 * what was deleted, so the API refuses to redact any of the five audit-change
 * actions (409 META_AUDIT_IMMUTABLE) - a bulk request containing one is refused
 * whole. The page must not offer it: no Redact on such a row, and a bulk
 * redaction sends only the rows the API would redact, naming what it left out.
 */

const SINGLE_RECORD = REC({
  id: 'm1', action: 'AUDIT_RECORD_REDACTED', userId: 'sa', userRole: 'SUPER_ADMIN', targetType: 'audit_trail', targetId: 'a9',
  reason: 'Mask PII single', beforeValue: { snapshotVersion: 2, id: 'a9' }, afterValue: null,
});
const BULK_RECORD = REC({
  id: 'm2', action: 'AUDIT_RECORDS_BULK_REDACTED', userId: 'sa', userRole: 'SUPER_ADMIN', targetType: 'audit_trail', targetId: null,
  reason: 'Mask PII batch', beforeValue: { recordCount: 1, records: [{ snapshotVersion: 2, id: 'a8' }] }, afterValue: null,
});
const DELETE_RECORD = REC({
  id: 'm3', action: 'AUDIT_RECORD_DELETED', userId: 'sa', userRole: 'SUPER_ADMIN', targetType: 'audit_trail', targetId: 'a7',
  reason: 'Purge duplicate row', beforeValue: { id: 'a7', action: 'LOGIN_FAILED' }, afterValue: null,
});
// ROWS already holds a4 (redacted) and a5 (AUDIT_RECORD_UPDATED, summary mentions AHU-7).
const LIST = [...ROWS, SINGLE_RECORD, BULK_RECORD, DELETE_RECORD];
const LEFT_OUT = /\(already redacted, or a record of an earlier audit-trail change\)/;

let con: ConsoleCapture;
let prompt: MockInstance<typeof window.prompt>;
beforeEach(() => {
  con = captureConsole();
  prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
});
afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); prompt.mockRestore(); });

async function ready(api: ReturnType<typeof mockApi>) {
  await myActionsLoaded(api);
  await screen.findByText(/Mask PII single/);
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(LIST.length + 1));
}
const singleRow = () => rowOf(/Mask PII single/);
const bulkRow = () => rowOf(/Mask PII batch/);
const deleteRow = () => rowOf(/Purge duplicate row/);
const editRow = () => rowOf('AHU-7');

describe('records of an audit-trail change on the Audit Trail page', () => {
  it('are never offered Redact (redaction, deletion or edit record) - they can still be selected and deleted, never edited', async () => {
    const api = mockApi(auditRoutes({ list: page(LIST) }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);

    for (const row of [singleRow(), bulkRow(), deleteRow(), editRow()]) {
      expect(within(row).queryByTitle(/^Redact record/)).toBeNull();
      expect(within(row).queryByTitle(/^Edit record/)).toBeNull();
      expect(within(row).getByTitle(/^Delete permanently/)).toBeInTheDocument();
      expect(within(row).getByRole('checkbox')).toBeInTheDocument();
    }
    // Only the ordinary, unredacted rows keep it: a1, a2, a3.
    expect(screen.getAllByTitle(/^Redact record/)).toHaveLength(3);
    expect(con.errors).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });

  it('a bulk redaction sends only what the API would redact and says how many it left out', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/bulk-redact', body: { redacted: 3 } }, ...auditRoutes({ list: page(LIST) })]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all audit records on this page' }));
    expect(screen.getByText('8 audit records selected')).toBeInTheDocument();
    // a4 (already redacted) + a5 and the three audit-change records
    expect(screen.getByText(/^5 can't be redacted/)).toHaveTextContent(LEFT_OUT);

    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    expect(screen.getByText(/5 selected records are left out: already redacted, or a record of an earlier audit-trail change/)).toBeInTheDocument();
    expectAllControlsNamed();
    prompt.mockReturnValueOnce('Duplicate test entries');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 3 Records' }));

    await waitFor(() => expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(1));
    expect(prompt).toHaveBeenLastCalledWith('Reason for redacting 3 audit records (min 5 characters):');
    expect(api.calls('POST', '/api/audit/bulk-redact')[0].json).toEqual({ ids: ['a1', 'a2', 'a3'], reason: 'Duplicate test entries' });
    await waitFor(() => expect(screen.queryByText('Redact Audit Records')).toBeNull());
    expect(con.errors).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });

  it('a selection holding only audit-change records cannot be redacted; Delete Permanently still can', async () => {
    const api = mockApi(auditRoutes({ list: page(LIST) }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);

    fireEvent.click(within(singleRow()).getByRole('checkbox'));
    fireEvent.click(within(deleteRow()).getByRole('checkbox'));
    expect(screen.getByText('2 audit records selected')).toBeInTheDocument();
    expect(screen.getByText(/^None of these can be redacted/)).toHaveTextContent(LEFT_OUT);
    expect(screen.getByRole('button', { name: /Redact Selected/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete Permanently/ })).toBeEnabled();
    expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(0);

    // Adding one ordinary row makes exactly that row redactable.
    fireEvent.click(within(rowOf('User "101020" updated by 101010')).getByRole('checkbox'));
    expect(screen.getByText(/^2 can't be redacted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Redact Selected/ })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
    expect(screen.getByText(/2 selected records are left out/)).toBeInTheDocument();
  });
});

describe('canRedactRecord / AUDIT_META_ACTIONS', () => {
  it('offers Redact on an ordinary row only - not on a redacted row, not on any record of an audit-trail change', () => {
    expect(canRedactRecord(REC())).toBe(true);
    expect(canRedactRecord(REC({ redactedAt: '2026-10-19T00:00:00Z' }))).toBe(false);
    expect(AUDIT_META_ACTIONS.size).toBe(5);
    for (const action of AUDIT_META_ACTIONS) expect(canRedactRecord(REC({ action }))).toBe(false);
    expect(canRedactRecord(REC({ action: 'MANUAL_RECORD_DELETED' }))).toBe(true);
  });

  it('lists exactly the actions the API refuses to redact (apps/api/src/lib/audit-redaction.ts)', () => {
    const api = readFileSync(join(__dirname, '../../../../../api/src/lib/audit-redaction.ts'), 'utf-8');
    const m = api.match(/export const AUDIT_META_ACTIONS = \[([^\]]*)\]/);
    expect(m, 'AUDIT_META_ACTIONS not found in the API source').not.toBeNull();
    const apiList = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect(apiList).toHaveLength(5);
    expect([...AUDIT_META_ACTIONS].sort()).toEqual(apiList);
  });
});
