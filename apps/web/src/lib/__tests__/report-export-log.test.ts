/**
 * report-export-log — the REPORT_GENERATED audit write every download makes
 * first (fail-closed for the Audit Trail, fail-open with a warning for the
 * tablet's operational reports) and the export re-auth wrapper (coverage
 * campaign 2026-10-21). Only global `fetch` is stubbed; `reauth` is a hand-built
 * stand-in for useReauth().executeWithResult.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { REPORT_EXPORT_ACTIONS } from '@digilog/shared';
import type { useReauth } from '@/hooks/use-reauth';
import { mockApi } from '@/test-utils/page-harness';
import {
  logReportExport, logReportExportOrWarn, isReauthError, exportReauthAction, requireExportReauth, isReauthCancelled, isServerUnreachable,
} from '../report-export-log';

const URL = '/api/audit/report-export-log';
type ExecWithResult = Pick<ReturnType<typeof useReauth>, 'executeWithResult'>;
/** A stand-in for a confirmed dialog with `password` (undefined = not gated); the mock records each call. */
const confirmedWith = (password?: string): ExecWithResult => ({
  executeWithResult: vi.fn(<T,>(_a: string | string[], cb: (pw?: string) => Promise<T>) => cb(password)) as unknown as ExecWithResult['executeWithResult'],
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('logReportExport', () => {
  it('posts the export record and turns empty optional fields into absent keys', async () => {
    const m = mockApi([{ method: 'POST', path: URL, body: {} }]);
    await logReportExport({ reportType: 'Filters', format: 'PDF', recordCount: 12, period: '', search: '', startDate: '', endDate: '' });
    expect(m.calls('POST', URL)).toHaveLength(1);
    expect(m.requests[0].json).toEqual({ reportType: 'Filters', format: 'PDF', recordCount: 12 });
    expect(m.requests[0].headers['x-reauth-password']).toBeUndefined();
  });

  it('keeps the filter context when given', async () => {
    const m = mockApi([{ method: 'POST', path: URL, body: {} }]);
    await logReportExport({ reportType: 'Audit Trail', format: 'Excel', recordCount: 3, period: 'Last 7 days', search: 'wash', startDate: '2026-10-01', endDate: '2026-10-07' });
    expect(m.requests[0].json).toEqual({
      reportType: 'Audit Trail', format: 'Excel', recordCount: 3, period: 'Last 7 days', search: 'wash', startDate: '2026-10-01', endDate: '2026-10-07',
    });
  });

  it('signs the write with the re-auth password when one is given (header + body)', async () => {
    const m = mockApi([{ method: 'POST', path: URL, body: {} }]);
    await logReportExport({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, 'pw');
    expect(m.requests[0].headers['x-reauth-password']).toBe('pw');
    expect(m.requests[0].json).toEqual({ reportType: 'Filters', format: 'PDF', recordCount: 1, _currentPassword: 'pw' });
  });

  it('throws when the audit write fails (fail-closed)', async () => {
    mockApi([{ method: 'POST', path: URL, status: 500, body: { error: 'DB', message: 'audit down' } }]);
    await expect(logReportExport({ reportType: 'Filters', format: 'PDF', recordCount: 1 })).rejects.toThrow('audit down');
  });
});

describe('isReauthError / isReauthCancelled', () => {
  it.each(['REAUTH_REQUIRED', 'REAUTH_FAILED', 'REAUTH_CANCELLED', 'ACCOUNT_LOCKED'])('%s is a re-auth outcome', (code) => {
    expect(isReauthError({ error: code })).toBe(true);
  });
  it('recognises the code on `.code` too (errors built with only one of the two fields)', () => {
    expect(isReauthError({ code: 'ACCOUNT_LOCKED' })).toBe(true);
    expect(isReauthError({ code: 'BAD' })).toBe(false);
  });
  it('anything else (or nothing) is not', () => {
    expect(isReauthError({ error: 'NETWORK' })).toBe(false);
    expect(isReauthError(new Error('x'))).toBe(false);
    expect(isReauthError(null)).toBe(false);
    expect(isReauthError(undefined)).toBe(false);
  });
  it('isReauthCancelled only matches REAUTH_CANCELLED', () => {
    expect(isReauthCancelled({ error: 'REAUTH_CANCELLED' })).toBe(true);
    expect(isReauthCancelled({ error: 'REAUTH_FAILED' })).toBe(false);
    expect(isReauthCancelled(null)).toBe(false);
  });
});

describe('isServerUnreachable', () => {
  it('is true only when there was no HTTP answer or a gateway / unavailable one', () => {
    for (const e of [new TypeError('Failed to fetch'), {}, null, undefined, { status: 502 }, { status: 503 }, { status: 504 }]) {
      expect(isServerUnreachable(e)).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 409, 500]) expect(isServerUnreachable({ status })).toBe(false);
  });
});

describe('logReportExportOrWarn (fail-open for operational reports)', () => {
  it('logs and does not warn on success', async () => {
    const m = mockApi([{ method: 'POST', path: URL, body: {} }]);
    const warn = vi.fn();
    await logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn, 'pw');
    expect(m.requests[0].headers['x-reauth-password']).toBe('pw');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns but resolves (download proceeds) when the log cannot reach the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const warn = vi.fn();
    await expect(logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Not recorded in audit trail', expect.stringContaining('(Failed to fetch)'));
  });

  it('says "offline?" when the error carries no message', async () => {
    const warn = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => { throw {}; }));
    await logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn);
    expect(warn.mock.calls[0][1]).toContain('(offline?)');
  });

  it.each([502, 503, 504])('a %s gateway answer counts as unreachable: warn and allow the download', async (status) => {
    mockApi([{ method: 'POST', path: URL, status, body: { error: 'BAD_GATEWAY', message: `upstream ${status}` } }]);
    const warn = vi.fn();
    await expect(logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Not recorded in audit trail', expect.stringContaining(`upstream ${status}`));
  });

  it.each([[400, 'VALIDATION'], [403, 'FORBIDDEN'], [500, 'DB_ERROR']])(
    'a %s %s answer is the server refusing the audit row: rethrow, no file', async (status, code) => {
      mockApi([{ method: 'POST', path: URL, status, body: { error: code, message: code } }]);
      const warn = vi.fn();
      await expect(logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn)).rejects.toMatchObject({ status });
      expect(warn).not.toHaveBeenCalled();
    });

  it('the read-only hard cutoff (503 before the network) still lets an operational export through with a warning', async () => {
    localStorage.setItem('digilog_last_server_contact', String(Date.now() - 48 * 3600 * 1000));
    const m = mockApi([]);
    const warn = vi.fn();
    await expect(logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn)).resolves.toBeUndefined();
    expect(m.requests).toHaveLength(0);
    expect(warn.mock.calls[0][1]).toMatch(/Read-only mode/);
    localStorage.removeItem('digilog_last_server_contact');
  });

  it.each([
    [403, 'REAUTH_REQUIRED'],
    [403, 'REAUTH_FAILED'],
    [403, 'ACCOUNT_LOCKED'],
  ])('rethrows a %s %s refusal instead of letting the download through', async (status, code) => {
    mockApi([{ method: 'POST', path: URL, status, body: { error: code, message: code } }]);
    const warn = vi.fn();
    await expect(logReportExportOrWarn({ reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn, 'pw'))
      .rejects.toMatchObject({ error: code });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('exportReauthAction', () => {
  it('maps every report name to its own re-auth row', () => {
    for (const [name, row] of Object.entries(REPORT_EXPORT_ACTIONS)) {
      expect(exportReauthAction(name as keyof typeof REPORT_EXPORT_ACTIONS)).toBe(row);
    }
  });
});

describe('requireExportReauth', () => {
  it('prompts on the report\'s row, logs (fail-open) with the password and returns it', async () => {
    const m = mockApi([{ method: 'POST', path: URL, body: {} }]);
    const reauth = confirmedWith('pw');
    const warn = vi.fn();
    await expect(requireExportReauth(reauth, { reportType: 'Filters', format: 'Excel', recordCount: 4 }, warn)).resolves.toBe('pw');
    expect(reauth.executeWithResult).toHaveBeenCalledWith('EXPORT_FILTERS', expect.any(Function));
    expect(m.requests[0].json).toMatchObject({ reportType: 'Filters', _currentPassword: 'pw' });
  });

  it('non-strict: an unreachable log only warns and still returns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const warn = vi.fn();
    await expect(requireExportReauth(confirmedWith(undefined), { reportType: 'Filters', format: 'PDF', recordCount: 1 }, warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('strict (Audit Trail): an unreachable log rejects, so no file is produced', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const warn = vi.fn();
    await expect(requireExportReauth(confirmedWith(undefined), { reportType: 'Audit Trail', format: 'PDF', recordCount: 1 }, warn, { strict: true }))
      .rejects.toThrow('Failed to fetch');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a dismissed dialog becomes an Error with an honest message AND the REAUTH_CANCELLED code', async () => {
    const reauth = { executeWithResult: vi.fn(async () => { throw { error: 'REAUTH_CANCELLED' }; }) };
    const err: any = await requireExportReauth(reauth, { reportType: 'Filters', format: 'PDF', recordCount: 1 }, vi.fn()).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Export cancelled/);
    expect(isReauthCancelled(err)).toBe(true);
  });

  it('rethrows other failures unchanged', async () => {
    const boom = new Error('boom');
    const reauth = { executeWithResult: vi.fn(async () => { throw boom; }) };
    await expect(requireExportReauth(reauth, { reportType: 'Filters', format: 'PDF', recordCount: 1 }, vi.fn())).rejects.toBe(boom);
  });
});
