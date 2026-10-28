// Replacement Schedule upload + read service.
//
// Parses the uploaded .xlsx/CSV (template from template.service.ts), validates
// each row (AHU resolves by name, qty integer >= 1, date YYYY-MM-DD not in the
// past, tolerance integer), computes the +/- tolerance window, and creates one
// ReplacementSchedule batch + ReplacementScheduleEntry rows. Also exposes list
// + due-entry reads. Mirrors bulk-upload-filter.service.ts conventions.
import ExcelJS from 'exceljs';
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { stripHtml } from '../../lib/sanitize.js';
import { AppError } from '../../lib/errors.js';
import { toDateColumnDay, dateColumnDayStart, dateColumnDayEnd } from '../../lib/date-range-guard.js';
import { FilterOperationsService } from '../filter-operations/filter-operations.service.js';
import { COUNTED_FILTER_WHERE } from '../assets/filter-workflow.js';
import { loadFilterSlots, settleMembers, type SlotFilter } from '../assets/filter-slots.js';
import { getReplacementWorkflowConfig, assertPmRole, generateQnn } from '../pm-schedules/pm-workflow.js';
import { qnnCount, qnnNextStep } from '../pm-schedules/qnn-message.js';
import { isSuperAdminOwnWork, superAdminExemptionFields } from '../../lib/super-admin-own-work.js';

export interface RowError { row: number; column?: string; value?: string; error: string; }
export interface UploadOutcome {
  results: Array<{ row: number; status: 'success' | 'error'; column?: string; value?: string; error?: string; ahuName?: string }>;
  created: number;
  failed: number;
  rows?: Array<Record<string, string>>;
  scheduleId?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Template header → canonical key (+ friendly aliases).
const HEADER_ALIASES: Record<string, string> = {
  sno: 'slNo', slno: 'slNo', serial: 'slNo',
  ahuname: 'ahuName', ahu: 'ahuName',
  filtermicron: 'filterMicron', micron: 'filterMicron', micronsize: 'filterMicron',
  filtersize: 'filterSize', size: 'filterSize', filterdimensions: 'filterSize', dimensions: 'filterSize',
  qty: 'qty', quantity: 'qty', count: 'qty',
  scheduledate: 'scheduleDate', date: 'scheduleDate',
  tolerancedays: 'toleranceDays', tolerance: 'toleranceDays',
};

interface ParsedRow {
  rowNumber: number;
  slNo: string; ahuName: string; filterMicron: string; filterSize: string;
  qty: string; scheduleDate: string; toleranceDays: string;
}

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('').trim();
    if (typeof o.text === 'string') return o.text.trim();
    if (o.result !== undefined) return String(o.result).trim();
    // Any other ExcelJS object shape (hyperlink-only, error, formula w/o result,
    // shared value, etc.) — treat as empty rather than letting String(v) stringify
    // it to the literal "[object Object]" and persist that as the filter size.
    return '';
  }
  return String(v).trim();
}

async function parseWorkbook(buffer: Buffer): Promise<{ rows: ParsedRow[]; error?: string }> {
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buffer as any).then(() => {
    const ws = wb.worksheets.find((w) => w.name === 'Replacements' && w.state !== 'veryHidden') ?? wb.worksheets[0];
    if (!ws) return { rows: [], error: 'Workbook has no readable sheet' };
    const colKey: Record<number, string> = {};
    ws.getRow(1).eachCell((cell, col) => {
      const key = HEADER_ALIASES[normalize(cellToString(cell.value))];
      if (key) colKey[col] = key;
    });
    if (!Object.values(colKey).includes('ahuName')) return { rows: [], error: 'Template is missing an "AHU Name" column' };
    if (!Object.values(colKey).includes('scheduleDate')) return { rows: [], error: 'Template is missing a "Schedule Date" column' };

    const rows: ParsedRow[] = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const r: ParsedRow = { rowNumber, slNo: '', ahuName: '', filterMicron: '', filterSize: '', qty: '', scheduleDate: '', toleranceDays: '' };
      let any = false;
      row.eachCell((cell, col) => {
        const key = colKey[col];
        if (!key) return;
        const val = cellToString(cell.value);
        (r as any)[key] = val;
        if (val) any = true;
      });
      if (any) rows.push(r);
    });
    return { rows };
  }).catch(() => ({ rows: [] as ParsedRow[], error: 'Invalid .xlsx file' }));
}

/**
 * TODAY as yyyy-mm-dd: the server-local calendar day, compared with the window's
 * DATE columns. It was the UTC date, which in India is still yesterday until
 * 05:30 — a window's last day stayed DUE and the next day's MISSED (and the
 * cleaning block that follows it) began only at 05:30 (2026-10-24).
 */
function todayLocalDateOnly(): string {
  return toDateColumnDay(new Date()).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// AHU name -> id map (case-insensitive). Detects ambiguous (duplicate-name) AHUs.
async function buildAhuNameMap(): Promise<Map<string, string[]>> {
  const ahus = await prisma.ahu.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  const map = new Map<string, string[]>();
  for (const a of ahus) {
    const k = a.name.trim().toLowerCase();
    map.set(k, [...(map.get(k) ?? []), a.id]);
  }
  return map;
}

// Normalize a micron value for comparison (trim + lowercase).
function normMicron(s: unknown): string {
  return stripHtml(String(s ?? '')).trim().toLowerCase();
}
/** A row covers the AHU's filters of its micron; a row with no micron (uploaded before micron was required) covers them all. */
function rowCoversMicron(rowMicron: string | null | undefined, filterMicron: string): boolean {
  const m = normMicron(rowMicron);
  return !m || m === filterMicron;
}

type CountedFilter = SlotFilter & { micron: string };

/**
 * The approved, live filters under each AHU (COUNTED_FILTER_WHERE — the same
 * predicate PM and the AHU gate count), with their micron. The upload check and
 * the task rule both read it, so the Qty an upload is checked against is the Qty
 * the task then follows. Every AHU when `ahuIds` is omitted.
 */
async function countedFiltersByAhu(ahuIds?: string[]): Promise<Map<string, CountedFilter[]>> {
  const byAhu = new Map<string, CountedFilter[]>();
  if (ahuIds && ahuIds.length === 0) return byAhu;
  const rows = await prisma.assetInstance.findMany({
    where: { ...(ahuIds ? { parentId: { in: ahuIds } } : { parentId: { not: null } }), ...COUNTED_FILTER_WHERE },
    select: { id: true, parentId: true, attributes: true, createdAt: true, approvedAt: true },
  });
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = byAhu.get(r.parentId) ?? [];
    list.push({ id: r.id, parentId: r.parentId, createdAt: r.createdAt, approvedAt: r.approvedAt, micron: normMicron((r.attributes as any)?.micronSize) });
    byAhu.set(r.parentId, list);
  }
  return byAhu;
}

export async function processUpload(
  buffer: Buffer,
  fileName: string | undefined,
  ctx: RequestContext,
  opts: { validateOnly?: boolean } = {},
): Promise<UploadOutcome> {
  // Enforce the configured uploadRole — step 1 of the segregation-of-duties
  // chain. Steps 2 and 3 assert their roles (workflow.ts: reviewRole,
  // approvalRole), but `cfg.uploadRole` was read by NO code, so Step 1 was
  // decorative: the config def promises "Role allowed to upload replacement
  // schedules" and the UI shows it as workflow Step 1, while any holder of
  // REPLACEMENT_SCHEDULE_UPLOAD could upload regardless. LIVE at the time of
  // the fix — uploadRole was SUPERVISOR while MANAGER, QA and OPERATOR all held
  // the permission.
  //
  // Applies to the dry-run too: being able to validate an upload you may not
  // perform is pointless, and assertPmRole no-ops when uploadRole is unset, so
  // an unconfigured workflow stays permissive.
  const wf = await getReplacementWorkflowConfig();
  assertPmRole(ctx.userRole, wf.uploadRole, 'upload', 'replacement schedules');

  const parsed = await parseWorkbook(buffer);
  if (parsed.error) return { results: [{ row: 1, status: 'error', error: parsed.error }], created: 0, failed: 1 };
  const rows = parsed.rows;
  if (rows.length === 0) return { results: [{ row: 1, status: 'error', error: 'No data rows found' }], created: 0, failed: 1 };
  if (rows.length > 500) return { results: [{ row: 1, status: 'error', error: 'Maximum 500 rows per upload' }], created: 0, failed: 1 };

  const ahuMap = await buildAhuNameMap();
  const ahuFilters = await countedFiltersByAhu();
  const today = todayLocalDateOnly();

  const results: UploadOutcome['results'] = [];
  const toCreate: Array<{
    rowNumber: number; slNo: number | null; ahuId: string; ahuName: string;
    filterMicron: string | null; filterSize: string | null; qty: number;
    scheduleDate: string; toleranceDays: number; windowStart: string; windowEnd: string;
  }> = [];

  for (const r of rows) {
    const rowErrs: RowError[] = [];
    const ahuNameRaw = stripHtml(r.ahuName).trim();
    const micron = stripHtml(r.filterMicron).trim();
    const size = stripHtml(r.filterSize).trim();

    // AHU resolution
    let ahuId = '';
    if (!ahuNameRaw) rowErrs.push({ row: r.rowNumber, column: 'AHU Name', value: '', error: 'AHU Name is required' });
    else {
      const ids = ahuMap.get(ahuNameRaw.toLowerCase());
      if (!ids || ids.length === 0) rowErrs.push({ row: r.rowNumber, column: 'AHU Name', value: ahuNameRaw, error: `No AHU named "${ahuNameRaw}"` });
      else if (ids.length > 1) rowErrs.push({ row: r.rowNumber, column: 'AHU Name', value: ahuNameRaw, error: `Multiple AHUs named "${ahuNameRaw}" — names must be unique` });
      else ahuId = ids[0];
    }

    // Qty
    const qtyN = Number(r.qty);
    if (!r.qty.trim()) rowErrs.push({ row: r.rowNumber, column: 'Qty', value: '', error: 'Qty is required' });
    else if (!Number.isInteger(qtyN) || qtyN < 1) rowErrs.push({ row: r.rowNumber, column: 'Qty', value: r.qty, error: 'Qty must be a whole number >= 1' });

    // Schedule date — YYYY-MM-DD, valid calendar day, not in the past
    const dateRaw = r.scheduleDate.trim();
    let scheduleDate = '';
    if (!dateRaw) rowErrs.push({ row: r.rowNumber, column: 'Schedule Date', value: '', error: 'Schedule Date is required' });
    else if (!ISO_DATE.test(dateRaw) || new Date(`${dateRaw}T00:00:00Z`).toISOString().slice(0, 10) !== dateRaw) {
      rowErrs.push({ row: r.rowNumber, column: 'Schedule Date', value: dateRaw, error: 'Schedule Date must be a valid date (YYYY-MM-DD)' });
    } else if (dateRaw < today) {
      rowErrs.push({ row: r.rowNumber, column: 'Schedule Date', value: dateRaw, error: 'Schedule Date cannot be in the past' });
    } else scheduleDate = dateRaw;

    // Tolerance — optional; blank = 0 days (operator decision 2026-10-22,
    // D-OPS-9). There is no configurable default: the `replacement-schedule`
    // key this used to read was written by no config def, route or page.
    let tolerance = 0;
    const tolRaw = r.toleranceDays.trim();
    if (tolRaw) {
      const t = Number(tolRaw);
      if (!Number.isInteger(t) || t < 0) rowErrs.push({ row: r.rowNumber, column: 'Tolerance Days', value: tolRaw, error: 'Tolerance Days must be a whole number >= 0' });
      else tolerance = t;
    }

    // Filter Micron is required and validated against the AHU's filters below.
    // Filter Dimensions is information only (operator 2026-10-26: a row is
    // matched on micron size alone), so it is neither required nor checked.
    if (!micron) rowErrs.push({ row: r.rowNumber, column: 'Filter Micron', value: '', error: 'Filter Micron is required' });

    // Cascade validation against the live filter list: AHU → has approved filters
    // → micron exists → Qty equals that micron's filters (the Qty the task then
    // keeps in step with the AHU). Only runs when the AHU resolved and micron/qty
    // are present (otherwise the field-level errors above already fire).
    if (ahuId && micron && Number.isInteger(qtyN) && qtyN >= 1) {
      const filters = ahuFilters.get(ahuId) ?? [];
      const avail = filters.filter((f) => rowCoversMicron(micron, f.micron)).length;
      if (filters.length === 0) {
        rowErrs.push({ row: r.rowNumber, column: 'AHU Name', value: ahuNameRaw, error: `AHU "${ahuNameRaw}" has no approved filters to replace` });
      } else if (avail === 0) {
        rowErrs.push({ row: r.rowNumber, column: 'Filter Micron', value: micron, error: `Micron "${micron}" not found in AHU "${ahuNameRaw}"` });
      } else if (qtyN !== avail) {
        rowErrs.push({ row: r.rowNumber, column: 'Qty', value: r.qty, error: `Qty ${qtyN} must equal the ${avail} approved filter(s) with micron ${micron} in AHU "${ahuNameRaw}"` });
      }
    }

    if (rowErrs.length > 0) { for (const e of rowErrs) results.push({ status: 'error', ...e }); continue; }

    const slNoN = Number(r.slNo);
    toCreate.push({
      rowNumber: r.rowNumber,
      slNo: Number.isInteger(slNoN) ? slNoN : null,
      ahuId, ahuName: ahuNameRaw,
      filterMicron: micron || null, filterSize: size || null,
      qty: qtyN, scheduleDate, toleranceDays: tolerance,
      windowStart: addDays(scheduleDate, -tolerance), windowEnd: addDays(scheduleDate, tolerance),
    });
  }

  if (opts.validateOnly) {
    for (const c of toCreate) results.push({ row: c.rowNumber, status: 'success', ahuName: c.ahuName });
    results.sort((a, b) => a.row - b.row);
    return {
      results, created: 0, failed: results.filter((x) => x.status === 'error').length,
      rows: rows.map((r) => ({ slNo: r.slNo, ahuName: r.ahuName, filterMicron: r.filterMicron, filterSize: r.filterSize, qty: r.qty, scheduleDate: r.scheduleDate, toleranceDays: r.toleranceDays })),
    };
  }

  // All-or-nothing create: if any row failed validation, do not create a partial schedule.
  if (results.some((x) => x.status === 'error')) {
    results.sort((a, b) => a.row - b.row);
    return { results, created: 0, failed: results.filter((x) => x.status === 'error').length };
  }

  // Workflow ON → uploads land in PENDING_REVIEW (review + approval required
  // before they become due tasks). OFF → APPROVED immediately (current behaviour).
  // A Super Admin's own upload is not held (2026-10-24, lib/super-admin-own-work.ts):
  // APPROVED like workflow OFF, recorded REPLACEMENT_REVIEW on the audit row.
  // `wf` is fetched once at the top of this function (see the uploadRole guard).
  const reviewSkipped = wf.workflowEnabled && isSuperAdminOwnWork(ctx);
  const approvalStatus = wf.workflowEnabled && !reviewSkipped ? 'PENDING_REVIEW' as const : 'APPROVED' as const;

  const schedule = await prisma.$transaction(async (tx) => {
    // Append (2026-06-15, user request): a new upload ADDS to the existing
    // replacement schedule(s) rather than superseding them. Each upload creates
    // its own schedule row (preserving fileName / uploadedBy / date per batch);
    // prior schedules and their entries/executions are left untouched, so the
    // list, due, and tasks views show old + new together. Re-uploading the same
    // file will create duplicate rows — that's expected for plain append.
    const sch = await tx.replacementSchedule.create({
      data: { fileName: fileName ?? null, status: 'ACTIVE', uploadedBy: ctx.userSub, uploadedByName: ctx.userId },
    });
    // Audit 2026-06-08: single createMany instead of N per-row inserts.
    await tx.replacementScheduleEntry.createMany({
      data: toCreate.map((c) => ({
        scheduleId: sch.id, slNo: c.slNo, ahuId: c.ahuId, ahuName: c.ahuName,
        filterMicron: c.filterMicron, filterSize: c.filterSize, qty: c.qty,
        scheduleDate: new Date(`${c.scheduleDate}T00:00:00Z`),
        toleranceDays: c.toleranceDays,
        windowStart: new Date(`${c.windowStart}T00:00:00Z`),
        windowEnd: new Date(`${c.windowEnd}T00:00:00Z`),
        status: 'PENDING' as const,
        approvalStatus,
        submittedBy: ctx.userSub, submittedByName: ctx.userId,
      })),
    });
    return sch;
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole,
    action: 'REPLACEMENT_SCHEDULE_UPLOADED', targetType: 'replacement_schedule', targetId: schedule.id,
    afterValue: {
      fileName: fileName ?? null,
      entries: toCreate.length,
      // Detail drill-down: which AHUs/filters were in this upload batch (titled
      // values so each token is self-explanatory, matching the workflow rows).
      ahus: toCreate.map((c) => `AHU: ${c.ahuName}${c.filterSize ? ` · Size: ${c.filterSize}` : ''}${c.filterMicron ? ` · Micron: ${c.filterMicron}µ` : ''} · Qty: ${c.qty}`),
      ...superAdminExemptionFields(reviewSkipped ? ['REPLACEMENT_REVIEW'] : []),
    },
    reason: `Uploaded replacement schedule with ${toCreate.length} entr${toCreate.length === 1 ? 'y' : 'ies'}`,
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
  });

  // One QNN per upload action (surfaced in the Notifications center).
  await generateQnn('UPLOAD', {
    scheduleId: schedule.id,
    subject: 'Replacement Schedule',
    route: { reviewRole: wf.reviewRole, approvalRole: wf.approvalRole }, // the replacement workflow's roles, not PM's (2026-10-24)
    // Plain language (qnn-message.ts); the real status: a Super Admin's own upload is approved at once (2026-10-24).
    message: `Replacement schedule uploaded with ${qnnCount(toCreate.length, 'row')}.${qnnNextStep(approvalStatus, ctx.userRole)}`,
  }, ctx);

  for (const c of toCreate) results.push({ row: c.rowNumber, status: 'success', ahuName: c.ahuName });
  results.sort((a, b) => a.row - b.row);
  return { results, created: toCreate.length, failed: 0, scheduleId: schedule.id };
}

/**
 * Every schedule with its entries, each entry carrying the task rule's status
 * and the AHU filters it has replaced (`replacements`: filter in place today,
 * when, by whom), which the page's expanded AHU list shows per filter.
 *
 * 2026-10-24: the status here came from `qtyReplaced >= qty` (a counter), while
 * the tablet and the cleaning block use the AHU-filter rule — the page showed
 * CWH/RDU COMPLETED while its filters were blocked from cleaning as MISSED.
 * One rule now (`evaluateEntries`). `qty` stays the uploaded (approved) value;
 * `currentQty` is the row's Qty today (2026-10-26).
 */
export async function listSchedules() {
  const schedules = await prisma.replacementSchedule.findMany({
    orderBy: { createdAt: 'desc' },
    include: { entries: { orderBy: [{ scheduleDate: 'asc' }, { slNo: 'asc' }] } },
  });
  const progress = await evaluateEntries(schedules.flatMap((s) => s.entries));
  return schedules.map((s) => ({
    ...s,
    entries: s.entries.map((e) => {
      const p = progress.get(e.id)!;
      return {
        ...e,
        computedStatus: p.computedStatus,
        currentQty: p.currentQty,
        total: p.currentQty,
        replaced: p.replacedFilterIds.length,
        memberFilterIds: p.memberFilterIds,
        replacements: p.replacedFilterIds.map((filterId) => ({ filterId, ...p.credits.get(filterId)! })),
      };
    }),
  }));
}

// Replace one filter against a schedule entry: wraps the EXISTING replace action
// (filter-operations service.replace — unchanged), logs a ReplacementExecution,
// and increments qtyReplaced (COMPLETED when qty met). The route enforces the
// REPLACE_FILTER reauth before this runs, so the actual replacement stays gated.
const filterOps = new FilterOperationsService();

/**
 * Every refusal of a schedule replacement, in one place. The route runs it
 * BEFORE the REPLACE_FILTER signature (D03-09: a refused request costs no
 * password), and executeReplacement runs it again before it writes.
 */
export async function assertCanExecuteReplacement(entryId: string, oldFilterId: string) {
  const entry = await prisma.replacementScheduleEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new AppError(404, 'NOT_FOUND', 'Replacement entry not found');
  // 2026-10-08: only an APPROVED entry is a task. The task lists already showed
  // approved entries only, but this write accepted any entry id — PM refuses the
  // same case (ENTRY_NOT_APPROVED in pm-executions.ts).
  if (entry.approvalStatus !== 'APPROVED') {
    throw new AppError(409, 'ENTRY_NOT_APPROVED', 'Only an approved replacement schedule entry can be carried out.');
  }
  // The filter must belong to the task's AHU. A scanned tag from another AHU was
  // accepted and replaced, then counted against this AHU's task.
  const oldFilter = await prisma.assetInstance.findUnique({
    where: { id: oldFilterId },
    select: { parentId: true, name: true, attributes: true, approvalStatus: true, isActive: true, status: true },
  });
  if (!oldFilter) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
  if (oldFilter.parentId !== entry.ahuId) {
    throw new AppError(409, 'FILTER_NOT_IN_TASK_AHU', `Filter "${oldFilter.name}" is not in AHU "${entry.ahuName}" — this task covers that AHU's filters only.`);
  }

  // The row covers its micron's filters in the AHU, kept in step with the AHU
  // (evaluateEntries, operator rule 2026-10-26); it is complete when every one is
  // replaced. `replace()` retires the old filter and creates a new one in its
  // place, which the row is then credited with (creditedFiltersByEntry).
  const p = (await evaluateEntries([entry])).get(entry.id)!;
  if (p.computedStatus === 'COMPLETED') {
    throw new AppError(400, 'ALREADY_COMPLETE', 'Every filter this task covers has already been replaced');
  }
  // A filter this row is already credited with (its own replacement put it in,
  // or replaced that one since) is refused: replacing it again uses a new filter
  // and counts nothing. A tablet's list can be stale — a second tablet on the
  // AHU, or a batch that partly failed (2026-10-24).
  const credit = p.credits.get(oldFilterId);
  if (credit) {
    const by = credit.performedByName ? ` by ${credit.performedByName}` : '';
    throw new AppError(409, 'ALREADY_REPLACED_FOR_TASK',
      `Filter "${oldFilter.name}" was already replaced for this task (${credit.performedAt.toISOString().slice(0, 10)}${by}).`);
  }
  if (!p.toReplaceFilterIds.includes(oldFilterId)) {
    const filterMicron = String((oldFilter.attributes as any)?.micronSize ?? '').trim();
    if (!rowCoversMicron(entry.filterMicron, normMicron(filterMicron))) {
      throw new AppError(409, 'FILTER_NOT_IN_TASK_MICRON',
        `Filter "${oldFilter.name}" is micron ${filterMicron || '(not set)'} — this task replaces the micron ${entry.filterMicron} filters of "${entry.ahuName}".`);
    }
    if (!oldFilter.isActive || oldFilter.status === 'Retired') {
      throw new AppError(409, 'FILTER_NOT_IN_TASK', `Filter "${oldFilter.name}" is retired, so it cannot be replaced.`);
    }
    if (oldFilter.approvalStatus !== 'APPROVED') {
      throw new AppError(409, 'FILTER_NOT_IN_TASK', `Filter "${oldFilter.name}" has not been approved yet, so it is not part of this task.`);
    }
    throw new AppError(409, 'FILTER_NOT_IN_TASK',
      `Filter "${oldFilter.name}" was added to "${entry.ahuName}" after this task's window closed, so it is not part of this task.`);
  }
  return { entry, oldFilter };
}

export async function executeReplacement(entryId: string, oldFilterId: string, remarks: string, ctx: RequestContext) {
  const { entry } = await assertCanExecuteReplacement(entryId, oldFilterId);

  // The actual retire-old + create-new (RFID carries over) — existing, unchanged action.
  const result = await filterOps.replace(ctx, oldFilterId, remarks);

  const today = todayLocalDateOnly();
  const ws = entry.windowStart.toISOString().slice(0, 10);
  const we = entry.windowEnd.toISOString().slice(0, 10);
  const isWithinWindow = today >= ws && today <= we;

  await prisma.replacementExecution.create({
    data: {
      entryId, oldFilterId, newFilterId: (result as any).newFilterId ?? null,
      performedBy: ctx.userSub, performedByName: ctx.userId, isWithinWindow,
      remarks: remarks ? stripHtml(remarks).trim() : null,
    },
  });

  // Recompute the row now that the execution is recorded (old filter retired, the
  // new one in its place and credited). COMPLETED is stored: from then on the
  // row is frozen (a filter added later does not reopen it).
  const after = (await evaluateEntries([entry])).get(entry.id)!;
  const updated = await prisma.replacementScheduleEntry.update({
    where: { id: entryId },
    data: { qtyReplaced: { increment: 1 }, status: after.computedStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS' },
  });

  return {
    success: true,
    newFilterId: (result as any).newFilterId,
    newFilterName: (result as any).newFilterName,
    total: after.currentQty,
    replaced: after.replacedFilterIds.length,
    qtyReplaced: updated.qtyReplaced,
    qtyRemaining: after.toReplaceFilterIds.length,
    status: updated.status,
  };
}

/** Ids of the AHUs that are still active (A-F7, 2026-09-25): a soft-deleted AHU produces no task. */
async function activeAhuIds(): Promise<string[]> {
  const rows = await prisma.ahu.findMany({ where: { isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}


export async function listDueEntries() {
  const todayDate = toDateColumnDay(new Date());
  const entries = await prisma.replacementScheduleEntry.findMany({
    // Only APPROVED entries become due tasks (workflow ON gates this; when OFF,
    // entries default to APPROVED so behaviour is unchanged).
    // Audit 2026-09-24 (A-F7, closed 2026-09-25): an entry whose AHU was
    // soft-deleted is a record, not a task — its filters went inactive with the
    // AHU, so it would sit at 0/0 DUE → MISSED forever.
    where: { approvalStatus: 'APPROVED', windowStart: { lte: todayDate }, windowEnd: { gte: todayDate }, ahuId: { in: await activeAhuIds() } },
    orderBy: [{ windowEnd: 'asc' }],
  });
  const progress = await evaluateEntries(entries);
  return entries
    .map((e) => {
      const p = progress.get(e.id)!;
      return { ...e, computedStatus: p.computedStatus, currentQty: p.currentQty, qtyRemaining: p.toReplaceFilterIds.length };
    })
    .filter((e) => e.computedStatus === 'DUE' || e.computedStatus === 'IN_PROGRESS');
}

// ── The task rule: Qty follows the AHU (operator 2026-10-26) ────────────────
// A row covers the AHU's approved filters of its MICRON (dimensions are
// information only). A filter of that micron added to the AHU joins a row that
// is not finished and whose window has not closed; a retired or deleted one
// leaves it; a replacement takes the old filter's place (assets/filter-slots.ts).
// An overdue row takes no new filters, so it never blocks one; a completed row
// is frozen. Before this, every row covered EVERY filter of the AHU whatever its
// micron (2026-06-15), so an AHU with one row per micron needed every filter
// replaced once per row, and a filter added later re-opened finished rows and
// was blocked from cleaning by overdue ones.

export type ReplacementTaskStatus = 'PENDING' | 'DUE' | 'IN_PROGRESS' | 'COMPLETED' | 'MISSED';

export interface EntryProgress {
  /** The row's filters (the filter in each place today), frozen once it is complete. */
  memberFilterIds: string[];
  replacedFilterIds: string[];
  toReplaceFilterIds: string[];
  /** The row's Qty today. The uploaded `qty` column stays the approved record. */
  currentQty: number;
  computedStatus: ReplacementTaskStatus;
  /** The row's credits (creditedFiltersByEntry): filter in place → its replacement. */
  credits: Map<string, ReplacementCredit>;
}

type TaskEntry = { id: string; ahuId: string; filterMicron: string | null; windowStart: Date; windowEnd: Date; status: string };

/**
 * THE task rule for each entry — the web list, the tablet tasks, /due, the
 * cleaning block, the execute check and the export all read it. Batched: one
 * filter query, one credit walk and one slot walk for any number of entries.
 */
export async function evaluateEntries(entries: TaskEntry[], now: Date = new Date()): Promise<Map<string, EntryProgress>> {
  const out = new Map<string, EntryProgress>();
  if (entries.length === 0) return out;
  const today = toDateColumnDay(now).toISOString().slice(0, 10);
  const [filtersByAhu, credits] = await Promise.all([
    countedFiltersByAhu([...new Set(entries.map((e) => e.ahuId))]),
    creditedFiltersByEntry(entries.map((e) => e.id)),
  ]);
  // Join times matter only against a window or a credit; follow replacement
  // links back as far as the earliest of either.
  let since = dateColumnDayStart(entries[0].windowStart);
  for (const e of entries) { const s = dateColumnDayStart(e.windowStart); if (s < since) since = s; }
  for (const m of credits.values()) for (const c of m.values()) if (c.performedAt < since) since = c.performedAt;
  const slots = await loadFilterSlots([...filtersByAhu.values()].flat(), since);

  for (const e of entries) {
    const credited = credits.get(e.id) ?? new Map<string, ReplacementCredit>();
    const candidates = (filtersByAhu.get(e.ahuId) ?? [])
      .filter((f) => rowCoversMicron(e.filterMicron, f.micron))
      .map((f) => ({ id: f.id, joinedAt: slots.get(f.id)!.joinedAt, doneAt: credited.get(f.id)?.performedAt ?? null }));
    const { members, completedAt } = settleMembers(candidates, dateColumnDayEnd(e.windowEnd));
    // A stored COMPLETED (executeReplacement, when its replacement finished the
    // row) is terminal, so a row finished before this rule stays finished.
    const completed = e.status === 'COMPLETED' || completedAt != null;
    const replaced = members.filter((m) => m.doneAt != null).map((m) => m.id);
    const ws = e.windowStart.toISOString().slice(0, 10);
    const we = e.windowEnd.toISOString().slice(0, 10);
    let computedStatus: ReplacementTaskStatus;
    if (completed) computedStatus = 'COMPLETED';
    else if (today > we) computedStatus = 'MISSED';
    else if (today >= ws) computedStatus = replaced.length > 0 ? 'IN_PROGRESS' : 'DUE';
    else computedStatus = 'PENDING';
    out.set(e.id, {
      memberFilterIds: members.map((m) => m.id),
      replacedFilterIds: replaced,
      toReplaceFilterIds: completed ? [] : members.filter((m) => m.doneAt == null).map((m) => m.id),
      currentQty: members.length,
      computedStatus,
      credits: credited,
    });
  }
  return out;
}

/** The replacement an entry is credited with for one filter in place. */
export interface ReplacementCredit { performedAt: Date; performedByName: string | null }

/**
 * The filters each entry has replaced, as the filters in place TODAY
 * (2026-10-24). The ONE credit rule: the tablet task list, the cleaning block,
 * the execute check and the web schedule page all read it.
 *
 * It used to be "the new filter an execution installed, while that filter is
 * still active". Replacing that filter again — for another row of the same AHU
 * (one row per micron is the usual upload), or from the Filters page — retired
 * it, so the first row lost the count and listed the slot as "to replace"
 * again. On CWH/RDU (2026-10-14) a filter fitted five minutes earlier was
 * replaced again because the tablet asked for it, the micron-1 row read 1 of 6
 * after 7 replacements, and the AHU's 6 filters were blocked from cleaning.
 *
 * Now the credit follows the filter slot: from each replacement's new filter to
 * whatever replaced it, to the filter in place today. The old → new links are
 * the FILTER_REPLACED audit rows (targetId = the old filter, afterValue the new
 * one; every replace path writes one, and the Replacement List reads the same
 * rows). A redacted row has no payload, so its link is lost and that slot's
 * credit ends at the retired filter.
 *
 * Returns entryId → (filter id in place → the latest replacement crediting it).
 * Callers intersect it with the AHU's active filters.
 */
export async function creditedFiltersByEntry(entryIds: string[]): Promise<Map<string, Map<string, ReplacementCredit>>> {
  const out = new Map<string, Map<string, ReplacementCredit>>();
  if (entryIds.length === 0) return out;
  const execs = await prisma.replacementExecution.findMany({
    where: { entryId: { in: entryIds }, newFilterId: { not: null } },
    select: { entryId: true, newFilterId: true, performedAt: true, performedByName: true },
    orderBy: { performedAt: 'asc' },
  });
  // old filter → the filter that replaced it, walked out from the installed ones.
  // Bounded by the filters these entries touched, never a scan of every row.
  const next = new Map<string, string>();
  let frontier = [...new Set(execs.map((x) => x.newFilterId as string))];
  const seen = new Set(frontier);
  for (let depth = 0; frontier.length > 0 && depth < 100; depth++) {
    const rows = await prisma.auditTrail.findMany({
      where: { action: 'FILTER_REPLACED', targetType: 'filter', targetId: { in: frontier } },
      select: { targetId: true, afterValue: true },
      orderBy: { chainPosition: 'asc' },
    });
    const found: string[] = [];
    for (const r of rows) {
      const newId = (r.afterValue as { newFilterId?: unknown } | null)?.newFilterId;
      if (!r.targetId || typeof newId !== 'string') continue; // redacted: the link is lost
      next.set(r.targetId, newId);
      if (!seen.has(newId)) { seen.add(newId); found.push(newId); }
    }
    frontier = found;
  }
  for (const x of execs) {
    let id = x.newFilterId as string;
    for (let hops = 0; next.has(id) && hops < 100; hops++) id = next.get(id)!;
    const credits = out.get(x.entryId) ?? new Map<string, ReplacementCredit>();
    credits.set(id, { performedAt: x.performedAt, performedByName: x.performedByName });
    out.set(x.entryId, credits);
  }
  return out;
}

/**
 * Approved entries that can block cleaning: window closed, not stored COMPLETED.
 * Only a MISSED row blocks; evaluateEntries decides which of these are.
 */
function closedOpenEntriesWhere(extra: Record<string, unknown> = {}) {
  return { approvalStatus: 'APPROVED' as const, status: { not: 'COMPLETED' as const }, windowEnd: { lt: toDateColumnDay(new Date()) }, ...extra };
}

/**
 * The full set of filter ids blocked from STARTING a cleaning cycle: the filters
 * an overdue (MISSED) row still has to replace. A filter added to the AHU after
 * the row's window closed is not one of them (2026-10-26). Union across rows.
 */
export async function blockedFilterIdsForCleaning(): Promise<Set<string>> {
  const entries = await prisma.replacementScheduleEntry.findMany({ where: closedOpenEntriesWhere() });
  const blocked = new Set<string>();
  for (const p of (await evaluateEntries(entries)).values()) {
    if (p.computedStatus === 'MISSED') for (const id of p.toReplaceFilterIds) blocked.add(id);
  }
  return blocked;
}

/**
 * Single-filter check for the start-cycle hot path — scoped to the filter's AHU
 * so it doesn't sweep every entry.
 */
export async function isFilterBlockedForCleaning(filterId: string): Promise<boolean> {
  const filter = await prisma.assetInstance.findUnique({ where: { id: filterId }, select: { parentId: true } });
  if (!filter?.parentId) return false;
  const entries = await prisma.replacementScheduleEntry.findMany({ where: closedOpenEntriesWhere({ ahuId: filter.parentId }) });
  for (const p of (await evaluateEntries(entries)).values()) {
    if (p.computedStatus === 'MISSED' && p.toReplaceFilterIds.includes(filterId)) return true;
  }
  return false;
}

/**
 * Tablet task list — ALL approved entries (every status), each with its progress
 * so the page can group into Pending / Completed and show "remaining of total".
 * `toReplaceFilterIds` is the list the operator picks from and `memberFilterIds`
 * every filter the row covers (2026-10-26), so the tablet never re-derives the
 * micron rule. `qty`/`qtyRemaining` are aliased to total/remaining for the
 * existing FE fields.
 */
export async function listTaskEntries() {
  const entries = await prisma.replacementScheduleEntry.findMany({
    // A-F7 (2026-09-25): see listDueEntries — no task for a soft-deleted AHU.
    where: { approvalStatus: 'APPROVED', ahuId: { in: await activeAhuIds() } },
    orderBy: [{ windowEnd: 'asc' }, { slNo: 'asc' }],
  });
  if (entries.length === 0) return [];
  const progress = await evaluateEntries(entries);
  return entries.map((e) => {
    const p = progress.get(e.id)!;
    const total = p.currentQty;
    const remaining = p.toReplaceFilterIds.length;
    return {
      ...e,
      total,
      remaining,
      replaced: p.replacedFilterIds.length,
      // The row's filters credited to it (the tablet drops them from its list).
      replacedNewFilterIds: p.replacedFilterIds,
      toReplaceFilterIds: p.toReplaceFilterIds,
      memberFilterIds: p.memberFilterIds,
      computedStatus: p.computedStatus,
      // FE-compat aliases (mobile-wrapper reads qty / qtyRemaining).
      qty: total,
      qtyRemaining: remaining,
    };
  });
}
