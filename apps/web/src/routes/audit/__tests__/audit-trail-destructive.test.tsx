import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { mockApi, renderPage } from '@/test-utils/page-harness';
import { unlabeledControls, captureConsole, type ConsoleCapture } from '@/routes/users/__tests__/support/page-findings';
import { DELETER, SA, REC, page, auditRoutes as routes, listCalls, lastList, myActionsLoaded, rowOf, ack, signWith, giveReason } from './audit-page-fixtures';
import { expectAllControlsNamed } from '@/components/__tests__/support/a11y';
import { AuditTrailPage } from '../index';

// Full-page renders through the real SWR/auth/re-auth stack; under a loaded machine the
// default 5 s budget is too tight for the multi-step flows (budget only, no behaviour change).
vi.setConfig({ testTimeout: 20_000 });

/**
 * Audit Trail — the destructive and corrective actions: redact (chain-
 * preserving, SUPER_ADMIN only), hard delete (breaks the chain, AUDIT_DELETE)
 * and the SUPER_ADMIN row edit. Real SWR / apiClient / useAuth / useCan /
 * useReauth; only fetch is stubbed. The reason is typed in the confirm dialog
 * (2026-10-24 — it was window.prompt, which dropped a short reason silently);
 * window.prompt is spied on only to prove the page never calls it.
 */

const A1 = 'User "101020" updated by 101010';
const A2 = 'Failed login attempt for "intruder"';

let con: ConsoleCapture;
let prompt: MockInstance<typeof window.prompt>;
beforeEach(() => {
  con = captureConsole();
  prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
});
afterEach(() => {
  expect(prompt).not.toHaveBeenCalled();
  cleanup(); sessionStorage.clear(); localStorage.clear(); con.restore(); prompt.mockRestore();
});

async function ready(api: ReturnType<typeof mockApi>, checkboxes = 6) {
  await myActionsLoaded(api);
  await screen.findByText(A1);
  if (checkboxes) await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(checkboxes));
}
const box = (i: number) => screen.getAllByRole('checkbox')[i];

describe('SUPER_ADMIN — selection and redact (chain-preserving)', () => {
  it('gets selection, redact (not on a redacted or meta-audit row), delete on every row, edit (not on redacted / meta-audit rows)', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    // a1-a3 only: a4 is redacted, a5 records an audit-trail edit (the API refuses to redact it, 2026-10-22)
    expect(screen.getAllByTitle(/^Redact record/)).toHaveLength(3);
    expect(within(rowOf(/PII entered by mistake/)).queryByTitle(/^Redact record/)).toBeNull();
    expect(screen.getAllByTitle(/^Delete permanently/)).toHaveLength(5);
    expect(screen.getAllByTitle(/^Edit record/)).toHaveLength(3);
    expect(within(rowOf('AHU-7')).queryByTitle(/^Edit record/)).toBeNull();
    expect(within(rowOf('AHU-7')).queryByTitle(/^Redact record/)).toBeNull();
    await waitFor(() => expect(api.calls('GET', '/api/users')).toHaveLength(1));
    expect(api.calls('GET', '/api/users')[0].query.get('limit')).toBe('1000000');
  });

  it('select one / all / none, Clear Selection, and a re-sort clears the selection', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);

    fireEvent.click(box(1));
    expect(screen.getByText('1 audit record selected')).toBeInTheDocument();
    expect(box(1).closest('tr')).toHaveClass('bg-red-50/40');
    fireEvent.click(box(1));
    expect(screen.queryByText(/audit records? selected/)).toBeNull();

    fireEvent.click(box(0));
    expect(screen.getByText('5 audit records selected')).toBeInTheDocument();
    expect(box(0)).toBeChecked();
    fireEvent.click(box(0));
    expect(screen.queryByText(/audit records? selected/)).toBeNull();

    fireEvent.click(box(2));
    fireEvent.click(screen.getByRole('button', { name: 'Clear Selection' }));
    expect(screen.queryByText(/audit records? selected/)).toBeNull();

    fireEvent.click(box(3));
    expect(screen.getByText('1 audit record selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Action/ }));
    await waitFor(() => expect(screen.queryByText(/audit records? selected/)).toBeNull());
  });

  it('redacting one row opens the dialog; the button stays off until the reason has 5 characters, says how many are missing, and the reason is POSTed trimmed', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/a1/redact', body: { ok: true } }, ...routes()]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    const redactA1 = () => within(rowOf(A1)).getByTitle(/^Redact record/);

    // Cancel closes the dialog and sends nothing.
    fireEvent.click(redactA1());
    expect(screen.getByText('Redact Audit Record')).toBeInTheDocument();
    expect(screen.getByText(/preserves the tamper-evident hash chain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Redact Audit Record')).toBeNull();

    fireEvent.click(redactA1());
    const confirm = screen.getByRole('button', { name: 'Redact 1 Record' });
    expect(confirm).toBeDisabled();
    expect(screen.getByText('5 more characters required')).toBeInTheDocument();
    giveReason('abc ');
    expect(confirm).toBeDisabled();
    expect(screen.getByText('2 more characters required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/a1/redact')).toHaveLength(0);

    const before = listCalls(api).length;
    giveReason('  Entered in error  ');
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.calls('POST', '/api/audit/a1/redact')).toHaveLength(1));
    expect(api.calls('POST', '/api/audit/a1/redact')[0].json).toEqual({ reason: 'Entered in error' });
    await waitFor(() => expect(screen.queryByText('Redact Audit Record')).toBeNull());
    await waitFor(() => expect(listCalls(api).length).toBeGreaterThan(before));

    // A second opening starts with an empty reason.
    fireEvent.click(within(rowOf(A2)).getByTitle(/^Redact record/));
    expect(screen.getByLabelText(/Reason for this change/)).toHaveValue('');
  });

  it('a refused redaction is reported, never silent, and the dialog stays usable', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/a1/redact', status: 409, body: { error: 'ALREADY_REDACTED', message: 'Record already redacted' } }, ...routes()]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(within(rowOf(A1)).getByTitle(/^Redact record/));
    giveReason('Entered in error');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    expect(await screen.findByText('Redaction Failed')).toBeInTheDocument();
    expect(screen.getByText('Record already redacted')).toBeInTheDocument();
    await ack('Redaction Failed');
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
  });

  it('REDACT_AUDIT_RECORD re-auth: password prompt, then the redaction carries the password', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/a1/redact', body: { ok: true } }, ...routes({ reauth: ['REDACT_AUDIT_RECORD'] })]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(within(rowOf(A1)).getByTitle(/^Redact record/));
    giveReason('Entered in error');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redacting...' })).toBeDisabled();
    expect(api.calls('POST', '/api/audit/a1/redact')).toHaveLength(0);
    await signWith('Pw@12345');
    await waitFor(() => expect(api.calls('POST', '/api/audit/a1/redact')).toHaveLength(1));
    const req = api.calls('POST', '/api/audit/a1/redact')[0];
    expect(req.headers['x-reauth-password']).toBe('Pw@12345');
    expect(req.json).toEqual({ reason: 'Entered in error', _currentPassword: 'Pw@12345' });
    await waitFor(() => expect(screen.queryByText('Redact Audit Record')).toBeNull());
  });

  it('always-on signature (OD-01): the server asks for the password first; cancelling keeps the dialog and its reason, the signed retry sends the same reason', async () => {
    // Redact is in ALWAYS_REAUTH_ACTIONS, so /my-actions never lists it: the first
    // call goes out unsigned, the server answers REAUTH_REQUIRED, useReauth prompts
    // and runs the callback again with the password.
    const api = mockApi([
      { method: 'POST', path: '/api/audit/a1/redact', status: 401, times: 2, body: { error: 'REAUTH_REQUIRED', message: 'Re-authentication required', action: 'REDACT_AUDIT_RECORD' } },
      { method: 'POST', path: '/api/audit/a1/redact', body: { ok: true } },
      ...routes(),
    ]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(within(rowOf(A1)).getByTitle(/^Redact record/));
    giveReason('Entered in error');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancels[cancels.length - 1]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(screen.queryByText('Redaction Failed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
    expect(screen.getByLabelText(/Reason for this change/)).toHaveValue('Entered in error');

    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    await signWith('Pw@12345');
    await waitFor(() => expect(api.calls('POST', '/api/audit/a1/redact')).toHaveLength(3));
    const signed = api.calls('POST', '/api/audit/a1/redact')[2];
    expect(signed.headers['x-reauth-password']).toBe('Pw@12345');
    expect(signed.json).toEqual({ reason: 'Entered in error', _currentPassword: 'Pw@12345' });
    await waitFor(() => expect(screen.queryByText('Redact Audit Record')).toBeNull());
  });

  it('bulk redact: confirm dialog names the count, Cancel closes it, a short reason cannot be sent, then the ids are sent', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/bulk-redact', body: { redacted: 2 } }, ...routes()]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(box(1));
    fireEvent.click(box(2));

    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    expect(screen.getByText('Redact Audit Records')).toBeInTheDocument();
    expect(screen.getByText(/preserves the tamper-evident hash chain/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Redact Audit Records')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    giveReason('no');
    expect(screen.getByRole('button', { name: 'Redact 2 Records' })).toBeDisabled();
    expect(screen.getByText('3 more characters required')).toBeInTheDocument();
    expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(0);

    giveReason('Duplicate test entries');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 2 Records' }));
    await waitFor(() => expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(1));
    expect(api.calls('POST', '/api/audit/bulk-redact')[0].json).toEqual({ ids: ['a1', 'a2'], reason: 'Duplicate test entries' });
    await waitFor(() => expect(screen.queryByText('Redact Audit Records')).toBeNull());
    expect(screen.queryByText(/audit records? selected/)).toBeNull();
  });

  it('a refused bulk redaction is reported and the dialog button is usable again', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/bulk-redact', status: 400, body: { error: 'BAD_REQUEST', message: 'Reason too short' } }, ...routes()]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(box(1));
    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    giveReason('Duplicate test entries');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    expect(await screen.findByText('Bulk Redaction Failed')).toBeInTheDocument();
    expect(screen.getByText('Reason too short')).toBeInTheDocument();
    await ack('Bulk Redaction Failed');
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
  });

  it('cancelling the bulk-redact password prompt unwinds the busy state; the signed retry carries the password', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/bulk-redact', body: { ok: true } }, ...routes({ reauth: ['BULK_REDACT_AUDIT_RECORDS'] })]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(box(1));
    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    giveReason('Duplicate test entries');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    expect(await screen.findByText('Confirm Your Identity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Redacting...' })).toBeDisabled();
    // two Cancel buttons are on screen (bulk dialog + password dialog); the password one renders last
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancels[cancels.length - 1]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
    expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    await signWith('Pw@12345');
    await waitFor(() => expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(1));
    expect(api.calls('POST', '/api/audit/bulk-redact')[0].headers['x-reauth-password']).toBe('Pw@12345');
  });
});

describe('Cancelling the password prompt is silent (D2, D-OPS-8 pattern)', () => {
  // A dismissed prompt is not a failure: no "… Failed" dialog, nothing sent, and
  // any busy button usable again.
  const cancelPrompt = async () => {
    await screen.findByText('Confirm Your Identity');
    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancels[cancels.length - 1]);
    await waitFor(() => expect(screen.queryByText('Confirm Your Identity')).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
  };

  it('single redact', async () => {
    const api = mockApi(routes({ reauth: ['REDACT_AUDIT_RECORD'] }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(within(rowOf(A1)).getByTitle(/^Redact record/));
    giveReason('Entered in error');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    await cancelPrompt();
    expect(screen.queryByText('Redaction Failed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
    expect(api.calls('POST', '/api/audit/a1/redact')).toHaveLength(0);
  });

  it('bulk redact', async () => {
    const api = mockApi(routes({ reauth: ['BULK_REDACT_AUDIT_RECORDS'] }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.click(box(1));
    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    giveReason('Duplicate test entries');
    fireEvent.click(screen.getByRole('button', { name: 'Redact 1 Record' }));
    await cancelPrompt();
    expect(screen.queryByText('Bulk Redaction Failed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Redact 1 Record' })).toBeEnabled();
    expect(api.calls('POST', '/api/audit/bulk-redact')).toHaveLength(0);
  });

  it('single hard delete', async () => {
    const api = mockApi(routes({ reauth: ['DELETE_AUDIT_RECORD'] }));
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    fireEvent.click(within(rowOf(A2)).getByTitle(/^Delete permanently/));
    giveReason('Test data from OQ run');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
    await cancelPrompt();
    expect(screen.queryByText('Delete Failed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete 1 Record' })).toBeEnabled();
    expect(api.calls('DELETE', '/api/audit/a2')).toHaveLength(0);
  });

  it('bulk hard delete', async () => {
    const api = mockApi(routes({ reauth: ['BULK_DELETE_AUDIT_RECORDS'] }));
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    fireEvent.click(box(1));
    fireEvent.click(screen.getByRole('button', { name: /Delete Permanently/ }));
    giveReason('Test data from OQ run');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
    await cancelPrompt();
    expect(screen.queryByText('Bulk Delete Failed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete 1 Record' })).toBeEnabled();
    expect(api.calls('POST', '/api/audit/bulk-delete')).toHaveLength(0);
  });
});

describe('Hard delete (breaks the chain)', () => {
  it('AUDIT_DELETE without SUPER_ADMIN: selection + Delete Permanently, but no redact and no edit', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    expect(screen.getAllByTitle(/^Delete permanently/)).toHaveLength(5);
    expect(screen.queryByTitle(/^Redact record/)).toBeNull();
    expect(screen.queryByTitle(/^Edit record/)).toBeNull();
    fireEvent.click(box(1));
    expect(screen.getByRole('button', { name: /Delete Permanently/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Redact Selected/ })).toBeNull();
    expect(api.calls('GET', '/api/users')).toHaveLength(0);
  });

  it('deleting one row warns about the chain and sends DELETE with the reason; a short reason cannot be sent; a refusal is reported', async () => {
    const api = mockApi([
      { method: 'DELETE', path: '/api/audit/a2', status: 500, times: 1, body: { error: 'INTERNAL', message: 'trigger still enabled' } },
      { method: 'DELETE', path: '/api/audit/a2', body: { ok: true } },
      ...routes(),
    ]);
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    fireEvent.click(within(rowOf(A2)).getByTitle(/^Delete permanently/));
    expect(screen.getByText('Delete Audit Record')).toBeInTheDocument();
    expect(screen.getByText(/BREAKS the 21 CFR Part 11 tamper-evident hash chain/)).toBeInTheDocument();
    const confirm = () => screen.getByRole('button', { name: 'Delete 1 Record' });

    giveReason('tiny');
    expect(confirm()).toBeDisabled();
    expect(screen.getByText('1 more character required')).toBeInTheDocument();
    expect(api.calls('DELETE', '/api/audit/a2')).toHaveLength(0);

    giveReason('Test data from OQ run');
    fireEvent.click(confirm());
    expect(await screen.findByText('Delete Failed')).toBeInTheDocument();
    expect(screen.getByText('trigger still enabled')).toBeInTheDocument();
    await ack('Delete Failed');

    // The dialog survived the refusal with its reason; send again.
    expect(screen.getByLabelText(/Reason for this change/)).toHaveValue('Test data from OQ run');
    fireEvent.click(confirm());
    await waitFor(() => expect(api.calls('DELETE', '/api/audit/a2')).toHaveLength(2));
    expect(api.calls('DELETE', '/api/audit/a2')[1].json).toEqual({ reason: 'Test data from OQ run' });
    await waitFor(() => expect(screen.queryByText('Delete Audit Record')).toBeNull());
  });

  it('DELETE_AUDIT_RECORD re-auth: the DELETE carries the password', async () => {
    const api = mockApi([{ method: 'DELETE', path: '/api/audit/a2', body: { ok: true } }, ...routes({ reauth: ['DELETE_AUDIT_RECORD'] })]);
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    fireEvent.click(within(rowOf(A2)).getByTitle(/^Delete permanently/));
    giveReason('Test data from OQ run');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
    await signWith('Pw@12345');
    await waitFor(() => expect(api.calls('DELETE', '/api/audit/a2')).toHaveLength(1));
    const req = api.calls('DELETE', '/api/audit/a2')[0];
    expect(req.headers['x-reauth-password']).toBe('Pw@12345');
    expect(req.json).toEqual({ reason: 'Test data from OQ run', _currentPassword: 'Pw@12345' });
  });

  it('bulk delete: the confirm dialog warns about the chain; with no reason nothing can be sent; then the ids + reason are POSTed', async () => {
    const api = mockApi([{ method: 'POST', path: '/api/audit/bulk-delete', body: { deleted: 1 } }, ...routes()]);
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    fireEvent.click(box(2));
    fireEvent.click(screen.getByRole('button', { name: /Delete Permanently/ }));
    expect(screen.getByText('Delete Audit Record')).toBeInTheDocument();
    expect(screen.getByText(/BREAKS the 21 CFR Part 11 tamper-evident hash chain/)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Delete 1 Record' })).toBeDisabled();
    expect(api.calls('POST', '/api/audit/bulk-delete')).toHaveLength(0);

    giveReason('Test data from OQ run');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
    await waitFor(() => expect(api.calls('POST', '/api/audit/bulk-delete')).toHaveLength(1));
    expect(api.calls('POST', '/api/audit/bulk-delete')[0].json).toEqual({ ids: ['a2'], reason: 'Test data from OQ run' });
    await waitFor(() => expect(screen.queryByText('Delete Audit Record')).toBeNull());
  });

  it('BULK_DELETE_AUDIT_RECORDS re-auth: a refusal is reported and the button recovers; the signed retry succeeds', async () => {
    const api = mockApi([
      { method: 'POST', path: '/api/audit/bulk-delete', status: 403, times: 1, body: { error: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { method: 'POST', path: '/api/audit/bulk-delete', body: { deleted: 1 } },
      ...routes({ reauth: ['BULK_DELETE_AUDIT_RECORDS'] }),
    ]);
    renderPage(<AuditTrailPage />, { user: DELETER, api });
    await ready(api);
    fireEvent.click(box(1));
    fireEvent.click(screen.getByRole('button', { name: /Delete Permanently/ }));
    giveReason('Test data from OQ run');
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
    expect(await screen.findByRole('button', { name: 'Deleting...' })).toBeDisabled();
    await signWith('Pw@12345');
    expect(await screen.findByText('Bulk Delete Failed')).toBeInTheDocument();
    await ack('Bulk Delete Failed');
    expect(screen.getByRole('button', { name: 'Delete 1 Record' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 Record' }));
    await signWith('Pw@12345');
    await waitFor(() => expect(api.calls('POST', '/api/audit/bulk-delete')).toHaveLength(2));
    expect(api.calls('POST', '/api/audit/bulk-delete')[1].headers['x-reauth-password']).toBe('Pw@12345');
    await waitFor(() => expect(screen.queryByText('Delete Audit Record')).toBeNull());
  });
});

describe('SUPER_ADMIN row edit (UPDATE_AUDIT_RECORD)', () => {
  const EDITABLE = [
    REC({ userName: '101010', userRole: 'ADMIN', signatureMeaning: '' }),
    REC({ id: 'legacy', action: 'LEGACY_THING', userId: 'old', targetId: null, beforeValue: null, afterValue: null }),
  ];

  it('opens with the chain warning and lookups; Save sends only the changed fields + reason (a blanked role is dropped)', async () => {
    const api = mockApi([{ method: 'PUT', path: '/api/audit/a1', body: { ok: true } }, ...routes({ list: page(EDITABLE) })]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api, 3);
    await waitFor(() => expect(api.calls('GET', '/api/users')).toHaveLength(1));
    const before = listCalls(api).length;
    fireEvent.click(within(rowOf(A1)).getByTitle(/^Edit record/));

    const dlg = await screen.findByRole('dialog', { name: 'Edit audit record - USER UPDATED' });
    expect(within(dlg).getByText(/permanently breaks the audit hash chain/)).toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: 'Asha Rao (101010)' })).toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: 'Administrator' })).toBeInTheDocument();
    expect(within(dlg).getByRole('option', { name: 'USER UPDATED' })).toBeInTheDocument();
    const save = within(dlg).getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    fireEvent.change(within(dlg).getByLabelText('Target type'), { target: { value: 'user-account' } });
    fireEvent.change(within(dlg).getByLabelText('Role'), { target: { value: '' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Correcting the target' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.calls('PUT', '/api/audit/a1')).toHaveLength(1));
    expect(api.calls('PUT', '/api/audit/a1')[0].json).toEqual({ targetType: 'user-account', reason: 'Correcting the target' });
    expect(await screen.findByText('Audit record updated')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Edit audit record/ })).toBeNull();
    await waitFor(() => expect(listCalls(api).length).toBeGreaterThan(before));
  });

  it('a row whose action has no template still lists its own action first; Close dismisses the dialog', async () => {
    const api = mockApi(routes({ list: page(EDITABLE) }));
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api, 3);
    fireEvent.click(within(rowOf(/legacy thing by old/)).getByTitle(/^Edit record/));
    const dlg = await screen.findByRole('dialog', { name: 'Edit audit record - LEGACY THING' });
    const opts = within(dlg).getByLabelText(/^Action/).querySelectorAll('option');
    expect(opts[0].textContent).toBe('LEGACY THING');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: /Edit audit record/ })).toBeNull();
  });

  it('opened before the user / role lookups arrive, User and Role offer only "keep current"; a role without a display name is listed by its name', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const api = mockApi([
      { path: '/api/roles/active', body: [{ name: 'ADMIN', displayName: 'Administrator', color: 'bg-blue-600' }, { name: 'QA', color: 'bg-emerald-600' }] },
      ...routes({ list: page(EDITABLE) }),
    ]);
    const stubbed = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('/api/users') || u.includes('/api/roles/active')) await gate;
      return stubbed(input, init);
    }) as typeof fetch;
    try {
      renderPage(<AuditTrailPage />, { user: SA, api });
      await ready(api, 3);
      fireEvent.click(within(rowOf(A1)).getByTitle(/^Edit record/));
      const dlg = await screen.findByRole('dialog', { name: /Edit audit record/ });
      expect(Array.from(within(dlg).getByLabelText('User').querySelectorAll('option')).map((o) => o.textContent)).toEqual(['-- keep current --']);
      expect(Array.from(within(dlg).getByLabelText('Role').querySelectorAll('option')).map((o) => o.textContent)).toEqual(['-- keep current --']);
      release();
      await waitFor(() => expect(within(dlg).getByRole('option', { name: 'Asha Rao (101010)' })).toBeInTheDocument());
      expect(within(dlg).getByRole('option', { name: 'QA' })).toBeInTheDocument();
      expect(within(dlg).getByRole('option', { name: 'Administrator' })).toBeInTheDocument();
    } finally {
      release();
      globalThis.fetch = stubbed;
    }
  });

  it('with the re-auth row on, the PUT carries the password', async () => {
    const api = mockApi([{ method: 'PUT', path: '/api/audit/a1', body: { ok: true } }, ...routes({ list: page(EDITABLE), reauth: ['UPDATE_AUDIT_RECORD'] })]);
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api, 3);
    fireEvent.click(within(rowOf(A1)).getByTitle(/^Edit record/));
    const dlg = await screen.findByRole('dialog', { name: /Edit audit record/ });
    fireEvent.change(within(dlg).getByLabelText('Target id'), { target: { value: 'u-10' } });
    fireEvent.change(within(dlg).getByLabelText(/Reason for this change/), { target: { value: 'Correcting the target' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save changes' }));
    await signWith('Pw@12345');
    await waitFor(() => expect(api.calls('PUT', '/api/audit/a1')).toHaveLength(1));
    const put = api.calls('PUT', '/api/audit/a1')[0];
    expect(put.headers['x-reauth-password']).toBe('Pw@12345');
    expect(put.json).toEqual({ targetId: 'u-10', reason: 'Correcting the target', _currentPassword: 'Pw@12345' });
  });
});

describe('Accessibility + console (SUPER_ADMIN view with a filter chip)', () => {
  it('every control is named — filters with all three chips, selection, the record dialog and the redact confirm — and nothing is logged', async () => {
    const api = mockApi(routes());
    renderPage(<AuditTrailPage />, { user: SA, api });
    await ready(api);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('From Date & Time'), { target: { value: '2026-10-01T08:00' } });
    fireEvent.change(screen.getByLabelText('To Date & Time'), { target: { value: '2026-10-21T08:00' } });
    await screen.findByText('Search: x');
    expect(screen.getByRole('button', { name: 'Remove search filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove from-date filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove to-date filter' })).toBeInTheDocument();
    // the search is debounced (300 ms) and a filter change clears the selection:
    // select only once the filtered list has settled
    await waitFor(() => {
      const q = lastList(api).query;
      expect(q.get('search')).toBe('x');
      expect(q.get('startDate')).not.toBeNull();
      expect(q.get('endDate')).not.toBeNull();
    });
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(6));
    expect(screen.getByRole('checkbox', { name: 'Select all audit records on this page' })).toBeInTheDocument();
    fireEvent.click(box(1));
    await screen.findByText('1 audit record selected');
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });

    fireEvent.click(screen.getByRole('button', { name: /Redact Selected/ }));
    await screen.findByRole('button', { name: 'Redact 1 Record' });
    expect(screen.getByLabelText(/Reason for this change/)).toBeInTheDocument();
    expectAllControlsNamed();
    expect(unlabeledControls()).toEqual({ none: [], placeholderOnly: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getAllByTitle('View record details')[0]);
    expectAllControlsNamed();
    expect(con.errors).toEqual([]);
    expect(con.warnings).toEqual([]);
    expect(api.unmatched).toEqual([]);
  });
});
