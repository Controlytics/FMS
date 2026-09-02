/**
 * PM Schedules — bulk CSV/XLSX import + downloadable template.
 *
 * Behaviour preserved verbatim from the original `PmScheduleService` split:
 * row-level resilience (bad rows go to `skipped` instead of aborting the
 * batch), AHU resolution by stable templateKind, multi-format date parsing
 * (ISO, DMY, Excel serial, Date object), and SUPER_ADMIN bypass for the
 * approval workflow.
 *
 * Rows are parsed first, then bucketed by (AHU, year) and applied one
 * schedule per `$transaction`. Per-schedule atomicity is the point: the
 * hard-replace wipe and ALL of that schedule's new entries commit together,
 * so a failure part-way through a file can never leave a schedule wiped but
 * unpopulated. Two guards refuse the wipe outright — see `evaluateGuards`.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { checkPmEnabled } from './pm-shared.js';
import { getPmWorkflowConfig, assertPmRole, generateQnn, newQnnBatchRef, qnnBatchTag } from './pm-workflow.js';
import { checkSeparation } from './pm-separation.js';

interface ParsedRow {
  rowNum: number;
  raw: Record<string, any>;
  ahu: { id: string; name: string };
  year: number;
  month: number;
  plannedDate: Date;
  toleranceDays: number;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Decide whether the hard-replace wipe may touch an existing schedule.
 * Returns an operator-facing reason when it must NOT, else null.
 *
 * Both refusals exist because the wipe is unrecoverable and happens at upload
 * time — before any approver has consented to the replacement:
 *   1. PmExecution rows are execution evidence (21 CFR §11); an upload must
 *      never destroy them. They are also FK children of the entries being
 *      deleted, so the wipe could not succeed anyway.
 *   2. With the review workflow on, replacements land in PENDING_REVIEW and
 *      may never be approved — so an upload must not wipe already-APPROVED
 *      entries and leave the schedule with nothing approved in their place.
 */
export async function evaluateGuards(
  scheduleId: string,
  ahuName: string,
  year: number,
  workflowEnabled: boolean,
): Promise<string | null> {
  const executionCount = await prisma.pmExecution.count({
    where: { scheduleEntry: { scheduleId } },
  });
  if (executionCount > 0) {
    return `Refusing to replace the ${year} schedule for AHU "${ahuName}": it has ${executionCount} recorded execution(s), which are retained evidence and cannot be deleted by an upload. Edit the affected months individually instead.`;
  }

  if (workflowEnabled) {
    const approvedCount = await prisma.pmScheduleEntry.count({
      where: { scheduleId, approvalStatus: 'APPROVED' },
    });
    if (approvedCount > 0) {
      return `Refusing to replace the ${year} schedule for AHU "${ahuName}": it has ${approvedCount} APPROVED entr${approvedCount === 1 ? 'y' : 'ies'} and the review workflow is enabled, so an upload would discard approved months in favour of entries that are not yet approved. Edit the affected months individually instead.`;
    }
  }

  return null;
}

export async function importSchedules(ctx: RequestContext, rows: Array<Record<string, any>>) {
  await checkPmEnabled();

  // Load default tolerance from config
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
  const settings = (cfg?.configValue as any) ?? {};
  const defaultToleranceDays = Number(settings.defaultToleranceDays ?? 3);

  // 3-step workflow: when enabled, uploads land in PENDING_REVIEW (no auto-approve,
  // even for SUPER_ADMIN) and must be reviewed + approved before generating tasks.
  const wf = await getPmWorkflowConfig();

  // Enforce the configured uploadRole — step 1 of the SoD chain. Steps 2 and 3
  // assert their roles (pm-approval.ts: reviewRole, approvalRole), but
  // `wf.uploadRole` was read by NO code, so Step 1 was decorative even though the
  // config def promises "Role allowed to upload PM schedules" and the UI presents
  // it as workflow Step 1. Not currently exploitable on this path (only SUPERVISOR
  // and SUPER_ADMIN hold PM_UPLOAD/PM_CREATE, which happens to match the configured
  // role) — unlike the replacement path, where it WAS live. assertPmRole no-ops when
  // uploadRole is unset, so an unconfigured workflow stays permissive.
  assertPmRole(ctx.userRole, wf.uploadRole, 'upload');

  const imported: Array<{ row: number; ahuName: string; plannedDate: string; scheduleId: string; entryId: string }> = [];
  const skipped: Array<{ row: number; reason: string; data?: any }> = [];

  // Parsed rows awaiting the write phase, bucketed by (AHU, year).
  const parsed: ParsedRow[] = [];

  // Pre-fetch candidate AHUs (one scoped query) — cuts N queries to 1.
  // Filter by stable templateKind code, not by editable template.name (Step 1).
  const ahus = await prisma.assetInstance.findMany({
    where: {
      template: { templateKind: 'AHU' },
      isActive: true,
    },
    select: { id: true, name: true },
  });
  const ahuByName = new Map(ahus.map(a => [a.name.trim().toLowerCase(), a]));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // +1 for header row, +1 for 1-indexed display

    // Accept several column name variants for friendliness
    const rawName = (row.ahu_name ?? row.ahuName ?? row.AHU ?? row['AHU Name'] ?? '').toString().trim();
    // rawDate may come through as: string ("2026-04-12"), Date object (XLSX),
    // or number (Excel serial from CSV auto-detection). Normalise below.
    const rawDateRaw = row.scheduled_date ?? row.scheduledDate ?? row.date ?? row['Scheduled Date'] ?? '';
    const rawTol = (row.tolerance_days ?? row.toleranceDays ?? row['Tolerance Days'] ?? '').toString().trim();

    if (!rawName) { skipped.push({ row: rowNum, reason: 'Missing ahu_name', data: row }); continue; }
    if (rawDateRaw === '' || rawDateRaw == null) {
      skipped.push({ row: rowNum, reason: 'Missing scheduled_date', data: row });
      continue;
    }

    // Resolve AHU by name
    const ahu = ahuByName.get(rawName.toLowerCase());
    if (!ahu) { skipped.push({ row: rowNum, reason: `AHU "${rawName}" not found in your organization`, data: row }); continue; }

    // Parse date. Three shapes can arrive:
    //   1. JS Date  — XLSX with cellDates or server-supplied
    //   2. number   — Excel serial (days since 1900-01-00, float-fractional hours)
    //   3. string   — "YYYY-MM-DD" / "YYYY/MM/DD" (preferred CSV form)
    // All three are normalised to UTC midnight so the value doesn't drift
    // in a non-UTC server timezone (Asia/Kolkata locally).
    let plannedDate: Date;
    if (rawDateRaw instanceof Date) {
      plannedDate = new Date(Date.UTC(
        rawDateRaw.getUTCFullYear(),
        rawDateRaw.getUTCMonth(),
        rawDateRaw.getUTCDate(),
      ));
    } else if (typeof rawDateRaw === 'number' && Number.isFinite(rawDateRaw)) {
      // Excel serial date (1900 epoch, accounting for the 1900 leap bug: offset 25569 = days from 1970-01-01)
      const ms = Math.round((rawDateRaw - 25569) * 86400 * 1000);
      const d = new Date(ms);
      plannedDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    } else {
      const rawDateStr = String(rawDateRaw).trim();
      // YYYY-MM-DD or YYYY/MM/DD (ISO-like)
      const isoMatch = rawDateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      // DD-MM-YYYY or DD/MM/YYYY (day-first, common in India/Europe)
      const dmyMatch = !isoMatch ? rawDateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/) : null;
      if (isoMatch) {
        const [, y, m, d] = isoMatch;
        plannedDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      } else if (dmyMatch) {
        const [, d, m, y] = dmyMatch;
        plannedDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
      } else {
        plannedDate = new Date(rawDateStr); // fallback — may drift in local TZ
      }
      if (isNaN(plannedDate.getTime())) {
        skipped.push({ row: rowNum, reason: `Invalid scheduled_date "${rawDateStr}" — expected YYYY-MM-DD or DD-MM-YYYY`, data: row });
        continue;
      }
    }

    // Parse tolerance with fallback
    let toleranceDays: number;
    if (rawTol === '') {
      toleranceDays = defaultToleranceDays;
    } else {
      toleranceDays = Number(rawTol);
      if (!Number.isFinite(toleranceDays) || toleranceDays < 0 || toleranceDays > 365) {
        skipped.push({ row: rowNum, reason: `Invalid tolerance_days "${rawTol}" — expected 0-365`, data: row });
        continue;
      }
    }

    const year = plannedDate.getFullYear();
    const month = plannedDate.getMonth() + 1;
    const windowStart = new Date(plannedDate.getTime() - toleranceDays * 86400000);
    const windowEnd = new Date(plannedDate.getTime() + toleranceDays * 86400000);

    parsed.push({ rowNum, raw: row, ahu, year, month, plannedDate, toleranceDays, windowStart, windowEnd });
  }

  // Workflow ON: entries land in PENDING_REVIEW (review + approval required, no bypass).
  // Workflow OFF (legacy): SUPER_ADMIN auto-approves; others go to PENDING.
  const isSuperAdmin = ctx.userRole === 'SUPER_ADMIN';
  const approvalFields = wf.workflowEnabled
    ? {
        approvalStatus: 'PENDING_REVIEW' as const,
        submittedBy: ctx.userSub,
        submittedByName: ctx.userId,
      }
    : {
        approvalStatus: isSuperAdmin ? 'APPROVED' as const : 'PENDING' as const,
        submittedBy: ctx.userSub,
        submittedByName: ctx.userId,
        ...(isSuperAdmin ? { approvedBy: ctx.userSub, approvedByName: ctx.userId, approvedAt: new Date() } : {}),
      };

  // Bucket by (AHU, year) — one schedule per bucket, one transaction per schedule.
  const buckets = new Map<string, ParsedRow[]>();
  for (const p of parsed) {
    const key = `${p.ahu.id}::${p.year}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  }

  for (const bucket of buckets.values()) {
    const { ahu, year } = bucket[0];
    try {
      const schedule = await prisma.pmSchedule.findFirst({
        where: { entityId: ahu.id, year, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });

      // No replace guards any more — there is nothing to guard against, because
      // the upload no longer deletes anything (see below). The two old refusals
      // ("has recorded executions" / "has APPROVED entries") existed solely
      // because the import used to WIPE the schedule and repopulate it. That
      // made a whole-year re-upload impossible in practice: 13 of 15 AHUs had an
      // approved entry and were refused outright, and the suggested remedy —
      // edit each month by hand — does not scale to a year of visits per AHU.
      const existingEntries = schedule
        ? await prisma.pmScheduleEntry.findMany({
            where: { scheduleId: schedule.id },
            select: { id: true, plannedDate: true, toleranceDays: true },
          })
        : [];

      // Every uploaded row is kept (2026-08-27).
      //
      // This used to be `byMonth.set(p.month, p)` — "last wins per month" — so a
      // file with two March dates for one AHU imported only the later one and
      // said nothing. Operators schedule the same AHU many times a year with
      // irregular gaps, sometimes twice inside a month, so that collapse was
      // discarding real schedule rows silently.
      //
      // Separation is validated across the WHOLE bucket before any write: two
      // visits must not be satisfiable by one cleaning. A partial import would
      // leave a half-valid year, so a violation rejects the AHU's rows outright
      // and names the dates involved.
      // A row whose date already exists on the schedule is the SAME visit, not a
      // new one. Skipped rather than treated as an error, so re-uploading a
      // corrected file (or the same file twice) is safe and idempotent instead
      // of failing on every row that has not changed.
      const existingByDate = new Map(existingEntries.map((e) => [e.plannedDate.getTime(), e]));
      const alreadyScheduled = bucket.filter((p) => existingByDate.has(p.plannedDate.getTime()));
      const toAdd = bucket.filter((p) => !existingByDate.has(p.plannedDate.getTime()));
      for (const p of alreadyScheduled) {
        skipped.push({
          row: p.rowNum,
          reason: `AHU "${ahu.name}": ${p.plannedDate.toISOString().slice(0, 10)} is already on the ${year} schedule — left unchanged.`,
          data: p.raw,
        });
      }
      if (toAdd.length === 0) continue;

      // Separation is checked against the EXISTING entries as well as the new
      // ones. A new visit must not be satisfiable by the same cleaning as one
      // already on the schedule, and the operator cannot see the existing dates
      // from inside their spreadsheet.
      const violations = checkSeparation([
        ...existingEntries.map((e) => ({
          ref: `existing:${e.plannedDate.toISOString().slice(0, 10)}`,
          plannedDate: e.plannedDate,
          toleranceDays: e.toleranceDays,
        })),
        ...toAdd.map((p) => ({ ref: p.rowNum, plannedDate: p.plannedDate, toleranceDays: p.toleranceDays })),
      ]);
      if (violations.length > 0) {
        // EVERY row of this AHU is reported, not just the offending ones.
        //
        // Nothing for the AHU is written — the year is uploaded and reviewed as
        // one schedule, so a partial import would leave it half-valid. If only
        // the violating rows were listed, the operator would read
        // "3 imported, 1 skipped" while three rows silently went nowhere. That
        // is the same class of quiet mismatch as the last-wins-per-month
        // collapse this replaced.
        const offenders = new Map<number, string>();
        for (const v of violations) {
          // Blame whichever side is a NEW row — an existing entry is not the
          // operator's to move from a spreadsheet. When both sides are new,
          // the later one is the one to shift.
          const laterIsNew = typeof v.later.ref === 'number';
          const target = laterIsNew ? v.later.ref : v.earlier.ref;
          if (typeof target === 'number') {
            offenders.set(target, `AHU "${ahu.name}": ${v.message}`);
          }
        }
        for (const p of toAdd) {
          skipped.push({
            row: p.rowNum,
            reason: offenders.get(p.rowNum)
              ?? `AHU "${ahu.name}": not added — another new visit for this AHU overlaps, and an AHU's rows are added together. Fix the flagged row(s) and re-upload.`,
            data: p.raw,
          });
        }
        continue;
      }

      // APPEND — the upload ADDS visits and never removes or edits one.
      //
      // Existing entries keep their dates, their tolerances and above all their
      // approval state. That preserves three things the old wipe destroyed:
      // a past APPROVED visit that was actually performed (the evidence it was
      // scheduled), a past APPROVED visit that was NOT performed (an obligation
      // the missed-PM gate is still tracking), and any QA approval already
      // given. Removing a visit is a deliberate act done per entry, not a
      // side effect of uploading a file.
      const scheduleId = await prisma.$transaction(async (tx) => {
        const sid = schedule
          ? schedule.id
          : (await tx.pmSchedule.create({
              data: { entityId: ahu.id, year, status: 'ACTIVE', createdBy: ctx.userSub },
            })).id;

        await tx.pmScheduleEntry.createMany({
          data: toAdd.map((p) => ({
            scheduleId: sid,
            month: p.month,
            plannedDate: p.plannedDate,
            toleranceDays: p.toleranceDays,
            windowStart: p.windowStart,
            windowEnd: p.windowEnd,
            ...approvalFields,
          })),
        });
        return sid;
      });

      // createMany returns no rows — read the ids back for the per-row report.
      //
      // Keyed by DATE, not by month: an AHU can be visited more than once in a
      // month, so a month key would hand several rows the same entry id (and
      // the wrong one for all but the first).
      const created = await prisma.pmScheduleEntry.findMany({
        where: { scheduleId },
        select: { id: true, plannedDate: true },
      });
      const entryIdByDate = new Map(created.map((e) => [e.plannedDate.getTime(), e.id]));

      // Only the rows actually added are reported as imported — the
      // already-scheduled ones were reported as skipped above, and counting
      // them here as well would report more imports than happened.
      for (const p of toAdd) {
        imported.push({
          row: p.rowNum,
          ahuName: p.ahu.name,
          plannedDate: p.plannedDate.toISOString().slice(0, 10),
          scheduleId,
          entryId: entryIdByDate.get(p.plannedDate.getTime()) ?? '',
        });
      }
    } catch (e: any) {
      // The transaction rolled back — this schedule is unchanged on disk.
      for (const p of bucket) {
        skipped.push({ row: p.rowNum, reason: `DB error: ${e.message ?? String(e)}`, data: p.raw });
      }
    }
  }

  // Report rows in file order — the write phase groups by schedule, not by row.
  imported.sort((a, b) => a.row - b.row);
  skipped.sort((a, b) => a.row - b.row);

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_IMPORTED',
    targetType: 'pm_schedule', targetId: 'bulk',
    afterValue: { imported: imported.length, skipped: skipped.length, ahuNames: [...new Set(imported.map((i) => i.ahuName))] },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  // 2026-09-02 (operator report): ONE QNN per imported ENTRY, not one for the
  // upload as a whole.
  //
  // This used to mint a single aggregate row — "Uploaded 35 PM schedule entries
  // (pending review)" — carrying no pmScheduleEntryId, no scheduleId and no AHU
  // name, so its AHU column rendered blank and none of the 35 visits it covered
  // could be traced from the notification. Every other workflow step (REVIEW,
  // APPROVE, REJECT, RESUBMIT, EDIT) already mints per entry via mintQnn in
  // pm-approval.ts, so the upload was the odd one out and the QNN list showed
  // an AHU's review but not the upload that created it.
  //
  // Sequential on purpose: generateQnn draws from the `qnn_seq` sequence and
  // writes a row per call, and QNN numbers should follow file order. A
  // whole-year upload therefore costs one insert per visit — the same shape the
  // approve path already pays, and an upload is not a hot path.
  //
  // `qnn` still returns the FIRST number so the existing caller/response
  // contract (a single reference to quote) is unchanged; `qnns` carries them all.
  let qnn: string | null = null;
  const qnns: string[] = [];
  const pendingSuffix = wf.workflowEnabled ? ' (pending review)' : '';
  // One shared reference across every entry of this upload, so the whole batch —
  // and therefore every AHU it covered — can be recovered from any one row.
  const batchRef = imported.length > 1 ? newQnnBatchRef() : null;
  // The AHUs this upload covered, in first-seen order, for the batch tag.
  const batchAhus = [...new Set(imported.map((e) => e.ahuName))];
  for (const [i, entry] of imported.entries()) {
    qnns.push(await generateQnn('UPLOAD', {
      pmScheduleEntryId: entry.entryId || null,
      scheduleId: entry.scheduleId,
      ahuName: entry.ahuName,
      message: `Uploaded — ${entry.ahuName} (${entry.plannedDate})${pendingSuffix}`
        + qnnBatchTag(batchRef, i + 1, imported.length, batchAhus),
    }, ctx));
  }
  qnn = qnns[0] ?? null;

  return {
    imported: imported.length,
    skipped: skipped.length,
    details: { imported, skipped },
    qnn,
    /** Every QNN minted by this upload, in file order. `qnn` is the first. */
    qnns,
  };
}

/** Generate the CSV template string shown to users. */
export function getTemplateCsv(): string {
  return 'ahu_name,scheduled_date,tolerance_days\n';
}
