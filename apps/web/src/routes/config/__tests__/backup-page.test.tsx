import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, act, within, configure } from '@testing-library/react';
import { mockApi, renderPage, type MockRoute } from '@/test-utils/page-harness';
import { BackupRestorePage } from '../backup';
import { SUPER_ADMIN, commonRoutes, reauthRequired, resetEnv, signReauth, cancelReauth } from './config-test-helpers';
import { spyConsoleError, expectSilentCancel } from './reauth-cancel-assertions';

// Multi-request flows: the 5s / 1s defaults are too tight when the suite runs
// under coverage alongside other workers.
vi.setConfig({ testTimeout: 30_000 });
configure({ asyncUtilTimeout: 5_000 });


/**
 * Backup & Restore through the real data path (harness). The page uses raw
 * fetch for export / validate / restore; the harness stub serves those too.
 * Downloads are stubbed at the browser edge (createObjectURL + anchor click).
 */

let downloads: { href: string; download: string }[];
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn(() => 'blob:backup');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ href: this.href, download: this.download });
  });
});
afterEach(() => { vi.restoreAllMocks(); resetEnv(); });

const EXPORT = '/api/backup/export';
const VALIDATE = '/api/backup/validate';
const RESTORE = '/api/backup/restore';

const meta = { version: '1', timestamp: '2026-10-01T08:30:00Z', generatedBy: 'superadmin', tableCount: 3, checksum: 'abc' };
const VALID = { valid: true, checksumValid: true, checksumSupported: true, totalRecords: 12345, tableSummary: { users: 4, auditTrail: 12000, customThing: 341 }, metadata: meta, auditChain: null };

function setup(opts: { user?: any; format?: unknown; extra?: MockRoute[]; reauth?: string[] } = {}) {
  const api = mockApi([
    ...(opts.extra ?? []),
    { path: '/api/config/backup-format/current', body: opts.format ?? { defaultFormat: 'json' } },
    ...commonRoutes({ reauth: opts.reauth }),
  ]);
  const view = renderPage(<BackupRestorePage />, { user: opts.user ?? SUPER_ADMIN, api });
  return { api, container: view.container };
}

/** Wrap the harness fetch so one test can shape a response the harness cannot (headers, non-JSON). */
function wrapFetch(shape: (url: string, res: Response) => Promise<Response> | Response, captured?: RequestInit[]) {
  const inner = globalThis.fetch as typeof fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    captured?.push(init ?? {});
    const res = await inner(input, init);
    return shape(String(input), res);
  });
}

const exportBtn = () => screen.getByRole('button', { name: /Download .* Backup|Generating Backup/ });
const formatCard = (label: string) => screen.getByText(label, { selector: 'p.font-semibold' }).closest('button') as HTMLButtonElement;

async function pickFile(container: HTMLElement, name = 'backup.json', size = 2048) {
  const file = new File(['x'.repeat(size)], name, { type: 'application/json' });
  await act(async () => {
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  });
  return file;
}

describe('Backup - export', () => {
  it('cancelling an up-front export signature downloads nothing and reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const { api } = setup({ reauth: ['EXPORT_BACKUP'] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    await act(async () => { fireEvent.click(exportBtn()); });
    await cancelReauth();
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    expect(exportBtn()).not.toBeDisabled();
    expectSilentCancel(consoleError);
    expect(api.calls('GET', EXPORT)).toHaveLength(0);
    expect(downloads).toHaveLength(0);
  });

  it('cancelling a server-demanded export signature downloads nothing and reports no failure (item 9)', async () => {
    const consoleError = spyConsoleError();
    const { api } = setup({ extra: [reauthRequired('GET', EXPORT)] });
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    await act(async () => { fireEvent.click(exportBtn()); });
    await cancelReauth();
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    expect(exportBtn()).not.toBeDisabled();
    expectSilentCancel(consoleError);
    expect(api.calls('GET', EXPORT)).toHaveLength(1);
    expect(downloads).toHaveLength(0);
  });

  it('preselects the configured default format, marks an override, and downloads with the server filename', async () => {
    const { api } = setup({ extra: [{ path: EXPORT, body: {} }] });
    wrapFetch((url, res) => (url.includes(EXPORT)
      ? new Response('BINARY', { status: 200, headers: { 'Content-Disposition': 'attachment; filename="digilog_2026-10-21.json"' } })
      : res));
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    expect(screen.getByText('Configured default:', { exact: false })).toHaveTextContent('Configured default: JSON');
    expect(screen.queryByText('(currently overridden for this export)')).toBeNull();
    fireEvent.click(formatCard('SQL'));
    expect(exportBtn()).toHaveTextContent('Download SQL Backup');
    expect(screen.getByText('(currently overridden for this export)')).toBeInTheDocument();
    fireEvent.click(formatCard('JSON'));
    await act(async () => { fireEvent.click(exportBtn()); });
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].download).toBe('digilog_2026-10-21.json');
    expect(api.calls('GET', EXPORT)[0].query.get('format')).toBe('json');
    expect(api.calls('GET', EXPORT)[0].headers.authorization).toBe('Bearer test-token');
    expect(api.calls('GET', EXPORT)[0].headers['x-reauth-password']).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:backup');
    expect(exportBtn()).not.toBeDisabled();
  });

  it('without a Content-Disposition name it builds one: CSV downloads as .zip, others by format', async () => {
    const { api } = setup({ extra: [{ path: EXPORT, body: {} }] });
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    fireEvent.click(formatCard('CSV (ZIP)'));
    await act(async () => { fireEvent.click(exportBtn()); });
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].download).toMatch(/^digilog_backup_.*\.zip$/);
    expect(api.calls('GET', EXPORT)[0].query.get('format')).toBe('csv');
    fireEvent.click(formatCard('BAK'));
    await act(async () => { fireEvent.click(exportBtn()); });
    await waitFor(() => expect(downloads).toHaveLength(2));
    expect(downloads[1].download).toMatch(/^digilog_backup_.*\.bak$/);
  });

  it('an unknown stored default falls back to the built-in default (DUMP)', async () => {
    setup({ format: { defaultFormat: 'xml' } });
    await waitFor(() => expect(screen.getByText('Configured default:', { exact: false })).toHaveTextContent('Configured default: DUMP'));
    expect(exportBtn()).toHaveTextContent('Download DUMP Backup');
  });

  it('a failed export shows the server message, else its code, else the HTTP status', async () => {
    setup({
      extra: [
        { path: EXPORT, times: 1, status: 500, body: { error: 'PG_DUMP_FAILED', message: 'pg_dump: invalid URI query parameter: "schema"' } },
        { path: EXPORT, times: 1, status: 500, body: { error: 'PG_DUMP_MISSING' } },
        { path: EXPORT, times: 1, status: 500, body: 'oops' },
      ],
    });
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    await act(async () => { fireEvent.click(exportBtn()); });
    expect(await screen.findByText('pg_dump: invalid URI query parameter: "schema"')).toBeInTheDocument();
    await act(async () => { fireEvent.click(exportBtn()); });
    expect(await screen.findByText('PG_DUMP_MISSING')).toBeInTheDocument();
    await act(async () => { fireEvent.click(exportBtn()); });
    expect(await screen.findByText('Export failed (HTTP 500)')).toBeInTheDocument();
    expect(downloads).toHaveLength(0);
  });

  it('a non-JSON error page (proxy) still reports the HTTP status', async () => {
    setup({ extra: [{ path: EXPORT, status: 502, body: {} }] });
    wrapFetch((url, res) => (url.includes(EXPORT) ? new Response('<html>Bad gateway</html>', { status: 502 }) : res));
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    await act(async () => { fireEvent.click(exportBtn()); });
    expect(await screen.findByText('Export failed (HTTP 502)')).toBeInTheDocument();
  });

  it('server demands a signature: prompts, then retries with the x-reauth-password header', async () => {
    const { api } = setup({ extra: [reauthRequired('GET', EXPORT), { path: EXPORT, body: {} }] });
    await waitFor(() => expect(exportBtn()).toHaveTextContent('Download JSON Backup'));
    await act(async () => { fireEvent.click(exportBtn()); });
    await signReauth('bk-pw');
    await waitFor(() => expect(api.calls('GET', EXPORT)).toHaveLength(2));
    expect(api.calls('GET', EXPORT)[1].headers['x-reauth-password']).toBe('bk-pw');
    await waitFor(() => expect(downloads).toHaveLength(1));
  });

  it('BACKUP_EXPORT alone may download; BACKUP_MANAGE too; neither -> disabled with a reason', async () => {
    setup({ user: { role: 'ADMIN', permissions: ['BACKUP_EXPORT'] } });
    await waitFor(() => expect(exportBtn()).not.toBeDisabled());
    resetEnv();
    setup({ user: { role: 'ADMIN', permissions: ['BACKUP_MANAGE'] } });
    await waitFor(() => expect(exportBtn()).not.toBeDisabled());
    resetEnv();
    setup({ user: { role: 'QA', permissions: ['CONFIG_READ'] } });
    await waitFor(() => expect(screen.getByText(/You do not have permission to download backups/)).toBeInTheDocument());
    expect(exportBtn()).toBeDisabled();
    expect(exportBtn()).toHaveAttribute('title', 'BACKUP_MANAGE permission required');
  });
});

describe('Backup - validate a file', () => {
  it('shows the file, validates it, and renders a verified backup with per-table counts', async () => {
    const { api, container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }] });
    expect(screen.getByText('Click to select backup file')).toBeInTheDocument();
    // Clicking the drop zone opens the hidden picker.
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const pickerClick = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByText('Click to select backup file'));
    expect(pickerClick).toHaveBeenCalled();
    await pickFile(container, 'nightly.json', 2048);
    expect(screen.getByText('nightly.json')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(await screen.findByText('Backup file is valid')).toBeInTheDocument();
    expect(screen.getByText('VALID')).toBeInTheDocument();
    expect(api.calls('POST', VALIDATE)[0].headers.authorization).toBe('Bearer test-token');
    expect(screen.getByText('superadmin')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
    // Known tables get labels; unknown keys show raw.
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
    expect(screen.getByText('customThing')).toBeInTheDocument();
    expect(screen.queryByText('Audit Trail Integrity')).toBeNull();
    expect(screen.getByRole('button', { name: /Restore Database from This Backup/ })).not.toBeDisabled();
  });

  it('a checksum mismatch is flagged INVALID and offers no restore', async () => {
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: { ...VALID, checksumValid: false } }] });
    await pickFile(container);
    expect(await screen.findByText('Backup file integrity check failed')).toBeInTheDocument();
    expect(screen.getByText('INVALID')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore Database from This Backup/ })).toBeNull();
  });

  it('SQL/CSV backups are NOT VERIFIED (no digest) but still restorable', async () => {
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: { ...VALID, checksumSupported: false, checksumValid: false } }] });
    await pickFile(container, 'b.sql');
    expect(await screen.findByText('Structure valid — integrity not independently verifiable')).toBeInTheDocument();
    expect(screen.getByText('NOT VERIFIED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore Database from This Backup/ })).toBeInTheDocument();
  });

  it('an intact audit chain is reported as such', async () => {
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: { ...VALID, auditChain: { totalRows: 5000, preChainRows: 10, chainedRows: 4990, checksumFailures: 0, linkFailures: 0 } } }] });
    await pickFile(container);
    expect(await screen.findByText('CHAIN INTACT')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.queryByText(/These rows cannot be proven intact/)).toBeNull();
  });

  it('a refused validation shows the server message, or a generic one', async () => {
    const { container } = setup({
      extra: [
        { method: 'POST', path: VALIDATE, times: 1, status: 400, body: { error: 'BAD_FILE', message: 'Not a DigiLog backup' } },
        { method: 'POST', path: VALIDATE, times: 1, status: 400, body: { error: 'BAD_FILE' } },
      ],
    });
    await pickFile(container);
    expect(await screen.findByText('Not a DigiLog backup')).toBeInTheDocument();
    await pickFile(container);
    expect(await screen.findByText('Validation failed')).toBeInTheDocument();
    expect(screen.queryByText('Not a DigiLog backup')).toBeNull();
  });

  it('a transport failure while validating is reported', async () => {
    const { container } = setup();
    wrapFetch((url, res) => { if (url.includes(VALIDATE)) throw new TypeError('Failed to fetch'); return res; });
    await pickFile(container);
    expect(await screen.findByText('Failed to validate backup file')).toBeInTheDocument();
    expect(screen.queryByText('Validating backup file...')).toBeNull();
  });

  it('choosing no file (cancelled picker) does nothing', async () => {
    const { api, container } = setup();
    await act(async () => {
      fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [] } });
    });
    expect(api.calls('POST', VALIDATE)).toHaveLength(0);
    expect(screen.getByText('Click to select backup file')).toBeInTheDocument();
  });
});

describe('Backup - restore', () => {
  async function toConfirm(container: HTMLElement) {
    await pickFile(container);
    fireEvent.click(await screen.findByRole('button', { name: /Restore Database from This Backup/ }));
    return screen.findByRole('heading', { name: /Confirm Database Restore/ });
  }

  it('the confirm dialog summarises the backup; Cancel closes it without restoring', async () => {
    const { api, container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }] });
    await toConfirm(container);
    expect(screen.getByText(/Warning: This will replace ALL existing data!/)).toBeInTheDocument();
    expect(screen.getByText('12,345 total records across 3 tables')).toBeInTheDocument();
    expect(screen.queryByText('Audit trail integrity could not be verified')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: /Confirm Database Restore/ })).toBeNull();
    // Escape on a reopened dialog closes it too.
    fireEvent.click(screen.getByRole('button', { name: /Restore Database from This Backup/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: /Confirm Database Restore/ })).toBeNull();
    expect(api.calls('POST', RESTORE)).toHaveLength(0);
  });

  it('a successful restore resets the picker; no force flag is sent for a clean chain', async () => {
    const captured: RequestInit[] = [];
    const { api, container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }, { method: 'POST', path: RESTORE, body: { success: true, message: 'Restored 12345 records' } }] });
    wrapFetch((_, res) => res, captured);
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    // RESTORE_BACKUP is always-on since OD-01: asked up front, so the file is uploaded once, signed.
    expect(api.calls('POST', RESTORE)).toHaveLength(0);
    await signReauth('rs-ok');
    expect(await screen.findByText('Restore Successful')).toBeInTheDocument();
    expect(screen.getByText('Restored 12345 records')).toBeInTheDocument();
    expect(screen.getByText(/You may need to log in again/)).toBeInTheDocument();
    expect(screen.getByText('Click to select backup file')).toBeInTheDocument();
    expect(screen.queryByText('Backup file is valid')).toBeNull();
    expect(api.calls('POST', RESTORE)).toHaveLength(1);
    expect(api.calls('POST', RESTORE)[0].headers['x-reauth-password']).toBe('rs-ok');
    // FormData bodies: [validate, restore] - the restore carries the same file.
    const forms = captured.filter((c) => c.body instanceof FormData).map((c) => c.body as FormData);
    expect(forms).toHaveLength(2);
    const sent = forms[1];
    expect((sent.get('file') as File).name).toBe('backup.json');
    expect(sent.has('force')).toBe(false);
  });

  it('a 200 that is not a full success keeps the file selected', async () => {
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }, { method: 'POST', path: RESTORE, body: { success: false, message: 'Restore finished with warnings' } }] });
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await signReauth();
    expect(await screen.findByText('Restore finished with warnings')).toBeInTheDocument();
    expect(screen.getByText('backup.json')).toBeInTheDocument();
    expect(screen.getByText('Backup file is valid')).toBeInTheDocument();
  });

  it('a non-JSON failure reports the HTTP status', async () => {
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }, { method: 'POST', path: RESTORE, status: 500, body: {} }] });
    wrapFetch((url, res) => (url.includes(RESTORE) ? new Response('Internal error', { status: 500 }) : res));
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await signReauth();
    expect(await screen.findByText('Restore Failed')).toBeInTheDocument();
    expect(screen.getByText('Restore failed (HTTP 500)')).toBeInTheDocument();
  });

  it('chain anomalies found at validation need an explicit acknowledgement, then restore with force=true', async () => {
    const captured: RequestInit[] = [];
    const chain = { totalRows: 900, preChainRows: 0, chainedRows: 900, checksumFailures: 2, linkFailures: 3 };
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: { ...VALID, auditChain: chain } }, { method: 'POST', path: RESTORE, body: { success: true, message: 'Restored with override' } }] });
    wrapFetch((_, res) => res, captured);
    await pickFile(container);
    expect(await screen.findByText('ANOMALIES FOUND')).toBeInTheDocument();
    expect(screen.getByText(/These rows cannot be proven intact/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restore Database from This Backup/ }));
    expect(screen.getByText('Audit trail integrity could not be verified')).toBeInTheDocument();
    expect(screen.getByText(/5 of 900 audit\s+rows in this backup do not verify \(2 checksum mismatches, 3 broken chain links\)/)).toBeInTheDocument();
    const override = screen.getByRole('button', { name: 'Restore Anyway (Override)' });
    expect(override).toBeDisabled();
    expect(override).toHaveAttribute('title', 'Acknowledge the audit-integrity warning to continue');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(override).not.toBeDisabled();
    expect(override).not.toHaveAttribute('title');
    await act(async () => { fireEvent.click(override); });
    await signReauth();
    expect(await screen.findByText('Restored with override')).toBeInTheDocument();
    const sent = captured.filter((c) => c.body instanceof FormData).pop()!.body as FormData;
    expect(sent.get('force')).toBe('true');
  });

  it('checksum-only anomalies omit the link breakdown', async () => {
    const chain = { totalRows: 10, preChainRows: 0, chainedRows: 10, checksumFailures: 1, linkFailures: 0 };
    const { container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: { ...VALID, auditChain: chain } }] });
    await toConfirm(container);
    const note = screen.getByText(/rows in this backup do not verify/);
    expect(note.textContent).toMatch(/1 of 10 audit\s+rows in this backup do not verify\./);
    expect(note.textContent).not.toMatch(/broken chain links/);
  });

  it('a server-side chain refusal shows its report and turns the next attempt into an override', async () => {
    const captured: RequestInit[] = [];
    const report = { totalRows: 50, preChainRows: 0, chainedRows: 50, checksumFailures: 0, linkFailures: 4 };
    const { container } = setup({
      extra: [
        { method: 'POST', path: VALIDATE, body: VALID },
        { method: 'POST', path: RESTORE, times: 1, status: 409, body: { error: 'BACKUP_AUDIT_CHAIN_INVALID', message: 'Audit chain broken in backup', chainReport: report } },
        { method: 'POST', path: RESTORE, body: { success: true, message: 'Forced restore done' } },
      ],
    });
    wrapFetch((_, res) => res, captured);
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await signReauth();
    expect(await screen.findByText('Restore Failed')).toBeInTheDocument();
    expect(screen.getByText('Audit chain broken in backup')).toBeInTheDocument();
    // The server's report now drives the integrity panel.
    expect(screen.getByText('ANOMALIES FOUND')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Restore Database from This Backup/ }));
    expect(screen.getByText(/4 of 50 audit/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Anyway (Override)' })); });
    await signReauth();
    expect(await screen.findByText('Forced restore done')).toBeInTheDocument();
    expect((captured.filter((c) => c.body instanceof FormData).pop()!.body as FormData).get('force')).toBe('true');
  });

  it('a chain refusal without a report still blocks with the message', async () => {
    const { container } = setup({
      extra: [
        { method: 'POST', path: VALIDATE, body: VALID },
        { method: 'POST', path: RESTORE, status: 409, body: { error: 'BACKUP_AUDIT_CHAIN_INVALID', message: 'Chain invalid' } },
      ],
    });
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await signReauth();
    expect(await screen.findByText('Chain invalid')).toBeInTheDocument();
    expect(screen.queryByText('ANOMALIES FOUND')).toBeNull();
  });

  it('selecting a new file clears a previous refusal and acknowledgement', async () => {
    const report = { totalRows: 50, preChainRows: 0, chainedRows: 50, checksumFailures: 0, linkFailures: 4 };
    const { container } = setup({
      extra: [
        { method: 'POST', path: VALIDATE, body: VALID },
        { method: 'POST', path: RESTORE, status: 409, body: { error: 'BACKUP_AUDIT_CHAIN_INVALID', message: 'Audit chain broken', chainReport: report } },
      ],
    });
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await signReauth();
    await screen.findByText('ANOMALIES FOUND');
    await pickFile(container, 'other.json');
    await screen.findByText('Backup file is valid');
    expect(screen.queryByText('ANOMALIES FOUND')).toBeNull();
    expect(screen.queryByText('Restore Failed')).toBeNull();
  });

  it('with nothing in /my-actions the always-on restore prompt opens first; ONE upload carries the x-reauth-password header', async () => {
    const { api, container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }, { method: 'POST', path: RESTORE, body: { success: true, message: 'ok' } }] });
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    expect(api.calls('POST', RESTORE)).toHaveLength(0);
    await signReauth('rs-pw');
    await waitFor(() => expect(api.calls('POST', RESTORE)).toHaveLength(1));
    expect(api.calls('POST', RESTORE)[0].headers['x-reauth-password']).toBe('rs-pw');
    expect(await screen.findByText('Restore Successful')).toBeInTheDocument();
  });

  it('cancelling the restore signature sends nothing and reports nothing (item 9)', async () => {
    const consoleError = spyConsoleError();
    const { api, container } = setup({ reauth: ['RESTORE_BACKUP'], extra: [{ method: 'POST', path: VALIDATE, body: VALID }] });
    await waitFor(() => expect(api.calls('GET', '/api/config/action-reauth/my-actions').length).toBeGreaterThan(0));
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('POST', RESTORE)).toHaveLength(0);
    expect(screen.queryByText('Restore Failed')).toBeNull();
    expectSilentCancel(consoleError);
    expect(screen.getByRole('button', { name: /Restore Database from This Backup/ })).not.toBeDisabled();
  });

  it('cancelling the always-on restore prompt (nothing in /my-actions) uploads nothing and reports nothing (item 9)', async () => {
    const consoleError = spyConsoleError();
    const { api, container } = setup({ extra: [{ method: 'POST', path: VALIDATE, body: VALID }] });
    await toConfirm(container);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore Database' })); });
    await screen.findByPlaceholderText('Enter your password');
    expect(api.calls('POST', RESTORE)).toHaveLength(0);
    await cancelReauth();
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter your password')).toBeNull());
    expect(api.calls('POST', RESTORE)).toHaveLength(0);
    expect(screen.queryByText('Restore Failed')).toBeNull();
    expect(screen.queryByText('Restore Successful')).toBeNull();
    expectSilentCancel(consoleError);
    expect(screen.getByRole('button', { name: /Restore Database from This Backup/ })).not.toBeDisabled();
  });

  it('without BACKUP_RESTORE the restore button is disabled with the reason', async () => {
    const { container } = setup({ user: { role: 'ADMIN', permissions: ['BACKUP_MANAGE'] }, extra: [{ method: 'POST', path: VALIDATE, body: VALID }] });
    await waitFor(() => expect(exportBtn()).not.toBeDisabled());
    await pickFile(container);
    const btn = await screen.findByRole('button', { name: /Restore Database from This Backup/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'BACKUP_RESTORE permission required');
    expect(screen.getByText(/You do not have permission to restore from a backup/)).toBeInTheDocument();
  });

  it('BACKUP_RESTORE alone may restore', async () => {
    const { container } = setup({ user: { role: 'ADMIN', permissions: ['BACKUP_RESTORE'] }, extra: [{ method: 'POST', path: VALIDATE, body: VALID }] });
    await waitFor(() => expect(screen.getByText(/You do not have permission to download backups/)).toBeInTheDocument());
    await pickFile(container);
    await waitFor(() => expect(screen.getByRole('button', { name: /Restore Database from This Backup/ })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Restore Database from This Backup/ }));
    expect(within(screen.getByRole('heading', { name: /Confirm Database Restore/ }).closest('div.relative') as HTMLElement)
      .getByRole('button', { name: 'Restore Database' })).not.toBeDisabled();
  });
});
