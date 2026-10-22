import { apiClient } from './api-client';
import { REPORT_EXPORT_ACTIONS, type ReportExportName } from '@digilog/shared';
import type { useReauth } from '@/hooks/use-reauth';

/**
 * Every filter that produced an export, as the operator saw it: label → value
 * (names, not ids: "AHU: PF-B5/AHU-29", "Status: Completed"). Not applied =
 * leave it out, or pass '' / null / undefined / false / [] — exportFilterSet drops them.
 */
export type ReportExportFilters = Record<string, string | string[] | number | boolean | null | undefined>;

export interface ReportExportLogInput {
  /** Human report name shown in the audit trail, e.g. "Audit Trail", "Filters". */
  reportType: ReportExportName;
  format: 'PDF' | 'Excel';
  recordCount: number;
  period?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  /**
   * Every filter that produced the file (2026-10-22): the REPORT_GENERATED row
   * must say which records were exported, not only how many.
   */
  filters?: ReportExportFilters;
}

/** The applied filters only, every value as text (the API takes text and lists of text). */
export function exportFilterSet(filters: ReportExportFilters | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [label, value] of Object.entries(filters ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (Array.isArray(value)) {
      const items = value.map((v) => String(v).trim()).filter(Boolean);
      if (items.length > 0) out[label] = items;
      continue;
    }
    const text = value === true ? 'Yes' : String(value).trim();
    if (text) out[label] = text;
  }
  return out;
}

/**
 * Record a report download/generation in the audit trail (REPORT_GENERATED).
 *
 * Throws if the log write fails — callers await this BEFORE saving the file and
 * cancel the download on error (fail-closed, 21 CFR §11): every report download
 * must leave an audit record of who generated what.
 *
 * `password` is the re-auth password when the report's row (Config → Action
 * Re-auth → Reports) is switched on for the viewer's role; the server gate is
 * on this very endpoint, so the audit write IS the signed act.
 */
export async function logReportExport(input: ReportExportLogInput, password?: string): Promise<void> {
  const body = {
    reportType: input.reportType,
    format: input.format,
    recordCount: input.recordCount,
    period: input.period || undefined,
    search: input.search || undefined,
    startDate: input.startDate || undefined,
    endDate: input.endDate || undefined,
    filters: exportFilterSet(input.filters),
  };
  if (password) await apiClient.postWithReauth('/api/audit/report-export-log', body, password);
  else await apiClient.post('/api/audit/report-export-log', body);
}

/** A re-auth outcome must never be swallowed by the fail-open path below. */
export function isReauthError(e: unknown): boolean {
  const err = e as { error?: string; code?: string } | null;
  const code = err?.error ?? err?.code ?? '';
  return code === 'REAUTH_REQUIRED' || code === 'REAUTH_FAILED' || code === 'REAUTH_CANCELLED' || code === 'ACCOUNT_LOCKED';
}

/**
 * True only when the server could not be REACHED: no HTTP status at all (fetch
 * itself failed, i.e. offline) or a gateway / unavailable answer, including the
 * client's own read-only hard cutoff (503). Any other answer is the server
 * deciding: a 403 (no export permission), a 400, a 401 or a 500 means the
 * audit row was refused or not written, so the file must not be produced
 * (2026-10-21: the fail-open path used to allow the download on ANY non-re-auth
 * error, so a refused export still produced an unaudited file).
 */
export function isServerUnreachable(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === undefined || status === 502 || status === 503 || status === 504;
}

/**
 * Fail-OPEN variant for operational reports on the offline-first tablet: record
 * the export, but if logging can't reach the server (e.g. offline), warn and
 * STILL allow the download — these reports export from already-loaded data and
 * must not be blocked by connectivity. (The Audit Trail export uses the strict
 * `logReportExport` — fail-closed — because it already needs the server anyway.)
 *
 * Re-auth outcomes and every other answer the server actually gave are NOT
 * connectivity failures and are rethrown (`isServerUnreachable`).
 */
export async function logReportExportOrWarn(
  input: ReportExportLogInput,
  warn: (title: string, message: string) => void,
  password?: string,
): Promise<void> {
  try {
    await logReportExport(input, password);
  } catch (e: any) {
    if (isReauthError(e) || !isServerUnreachable(e)) throw e;
    warn(
      'Not recorded in audit trail',
      `This download couldn't be recorded in the audit trail (${e?.message ?? 'offline?'}), but the file was still generated.`,
    );
  }
}

/** The re-auth row that gates a report's download. */
export function exportReauthAction(reportType: ReportExportName): string {
  return REPORT_EXPORT_ACTIONS[reportType];
}

/**
 * Sign-and-log a report export (2026-09-24). Prompts for the password when
 * the report's row is on for this role, writes the REPORT_GENERATED audit row
 * (the gated call), and only then returns so the caller produces the file.
 *
 *   await requireExportReauth(reauth, { reportType: 'Filters', format: 'PDF', recordCount: n }, toast.warning);
 *   …build and save the file…
 *
 * Throws `{ error: 'REAUTH_CANCELLED' }` when the operator dismisses the
 * dialog — the caller's catch should treat that as "no export", not an error
 * (see `isReauthCancelled`). `strict` = fail-closed logging (Audit Trail).
 */
export async function requireExportReauth(
  reauth: Pick<ReturnType<typeof useReauth>, 'executeWithResult'>,
  input: ReportExportLogInput,
  warn: (title: string, message: string) => void,
  opts: { strict?: boolean } = {},
): Promise<string | undefined> {
  // Returns the verified password so a caller that also fetches a server-side
  // file (the PM / Replacement .xlsx GETs) can send it in x-reauth-password
  // without prompting twice.
  try {
    return await reauth.executeWithResult(exportReauthAction(input.reportType), async (password?: string) => {
      if (opts.strict) await logReportExport(input, password);
      else await logReportExportOrWarn(input, warn, password);
      return password;
    });
  } catch (e: any) {
    // A dismissed dialog reaches callers as an ordinary error with an honest
    // message; the ones that check isReauthCancelled() stay silent instead.
    if (e?.error === 'REAUTH_CANCELLED') {
      throw Object.assign(new Error('Export cancelled — the password prompt was closed before the download was signed.'), { error: 'REAUTH_CANCELLED' });
    }
    throw e;
  }
}

export function isReauthCancelled(e: unknown): boolean {
  return (e as { error?: string } | null)?.error === 'REAUTH_CANCELLED';
}
