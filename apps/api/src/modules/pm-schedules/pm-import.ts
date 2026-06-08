/**
 * PM Schedules — bulk CSV/XLSX import + downloadable template.
 *
 * Behaviour preserved verbatim from the original `PmScheduleService` split:
 * row-level resilience (bad rows go to `skipped` instead of aborting the
 * batch), AHU resolution by stable templateKind, multi-format date parsing
 * (ISO, DMY, Excel serial, Date object), and SUPER_ADMIN bypass for the
 * approval workflow.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { checkPmEnabled } from './pm-shared.js';
import { getPmWorkflowConfig, generateQnn } from './pm-workflow.js';

export async function importSchedules(ctx: RequestContext, rows: Array<Record<string, any>>) {
  await checkPmEnabled();

  // Load default tolerance from config
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
  const settings = (cfg?.configValue as any) ?? {};
  const defaultToleranceDays = Number(settings.defaultToleranceDays ?? 3);

  // 3-step workflow: when enabled, uploads land in PENDING_REVIEW (no auto-approve,
  // even for SUPER_ADMIN) and must be reviewed + approved before generating tasks.
  const wf = await getPmWorkflowConfig();

  const imported: Array<{ row: number; ahuName: string; plannedDate: string; scheduleId: string; entryId: string }> = [];
  const skipped: Array<{ row: number; reason: string; data?: any }> = [];

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

  // Hard-replace: the FIRST time a re-uploaded AHU/year schedule is touched in
  // this upload, wipe ALL its existing entries (and their executions) so the new
  // file fully REPLACES the old schedule + tasks. Old APPROVED months not in the
  // new file therefore stop generating /due tasks.
  const clearedSchedules = new Set<string>();

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

    try {
      // Upsert the PmSchedule for (entityId, year) — findFirst + create-or-update
      let schedule = await prisma.pmSchedule.findFirst({
        where: { entityId: ahu.id, year, status: 'ACTIVE' },
        orderBy: { version: 'desc' },
      });
      if (!schedule) {
        schedule = await prisma.pmSchedule.create({
          data: {
            entityId: ahu.id,
            year,
            status: 'ACTIVE',
            createdBy: ctx.userSub,
          },
        });
      }

      // Hard-replace: wipe the AHU/year schedule's existing entries (+ executions)
      // the first time it's touched this upload, so the new file fully replaces it.
      if (!clearedSchedules.has(schedule.id)) {
        await prisma.pmExecution.deleteMany({ where: { scheduleEntry: { scheduleId: schedule.id } } });
        await prisma.pmScheduleEntry.deleteMany({ where: { scheduleId: schedule.id } });
        clearedSchedules.add(schedule.id);
      }

      // Upsert the entry — if same (schedule, month) exists, update date/tolerance.
      // Workflow ON: land in PENDING_REVIEW (review + approval required, no bypass).
      // Workflow OFF (legacy): SUPER_ADMIN auto-approves; others go to PENDING.
      const isSuperAdmin = ctx.userRole === 'SUPER_ADMIN';
      const approvalFields = wf.workflowEnabled
        ? {
            approvalStatus: 'PENDING_REVIEW' as const,
            submittedBy: ctx.userSub,
            submittedByName: ctx.userId,
            // Clear any prior decision when an existing entry is re-uploaded.
            reviewedBy: null, reviewedByName: null, reviewedAt: null, reviewRemarks: null,
            approvedBy: null, approvedByName: null, approvedAt: null,
            rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectionStage: null,
          }
        : {
            approvalStatus: isSuperAdmin ? 'APPROVED' as const : 'PENDING' as const,
            submittedBy: ctx.userSub,
            submittedByName: ctx.userId,
            ...(isSuperAdmin ? { approvedBy: ctx.userSub, approvedByName: ctx.userId, approvedAt: new Date() } : {}),
          };
      const existing = await prisma.pmScheduleEntry.findFirst({
        where: { scheduleId: schedule.id, month },
      });
      const entry = existing
        ? await prisma.pmScheduleEntry.update({
            where: { id: existing.id },
            data: { plannedDate, toleranceDays, windowStart, windowEnd, approvalRemarks: null, ...approvalFields },
          })
        : await prisma.pmScheduleEntry.create({
            data: {
              scheduleId: schedule.id,
              month,
              plannedDate,
              toleranceDays,
              windowStart,
              windowEnd,
              ...approvalFields,
            },
          });

      imported.push({ row: rowNum, ahuName: ahu.name, plannedDate: plannedDate.toISOString().slice(0, 10), scheduleId: schedule.id, entryId: entry.id });
    } catch (e: any) {
      skipped.push({ row: rowNum, reason: `DB error: ${e.message ?? String(e)}`, data: row });
    }
  }

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_IMPORTED',
    targetType: 'pm_schedule', targetId: 'bulk',
    afterValue: { imported: imported.length, skipped: skipped.length },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  // One QNN for the upload action (the bulk upload is a single user action).
  let qnn: string | null = null;
  if (imported.length > 0) {
    qnn = await generateQnn('UPLOAD', {
      message: `Uploaded ${imported.length} PM schedule entr${imported.length === 1 ? 'y' : 'ies'}${wf.workflowEnabled ? ' (pending review)' : ''}`,
    }, ctx);
  }

  return {
    imported: imported.length,
    skipped: skipped.length,
    details: { imported, skipped },
    qnn,
  };
}

/** Generate the CSV template string shown to users. */
export function getTemplateCsv(): string {
  return [
    'ahu_name,scheduled_date,tolerance_days',
    '# Dates accepted: YYYY-MM-DD or DD-MM-YYYY. Tolerance blank = default from config.',
    '# Example rows — delete these lines before uploading:',
    'AHU-01,2026-04-15,',
    'AHU-02,20-04-2026,5',
  ].join('\n') + '\n';
}
