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
import { randomUUID } from 'node:crypto';

import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { checkPmEnabled } from './pm-shared.js';
import { getPmWorkflowConfig, assertPmRole, generateQnn } from './pm-workflow.js';
import { generateOccurrences, defaultHorizon, validateFrequency, type Occurrence } from './pm-recurrence.js';
import { supersedePreviousSeries } from './pm-supersede.js';

/**
 * One upload row after parsing: an AHU + an anchor date + a tolerance, and
 * optionally a recurrence frequency. `frequencyDays === null` means a legacy
 * one-off row, which expands to exactly one occurrence.
 */
interface ParsedSeed {
  rowNum: number;
  raw: Record<string, any>;
  ahu: { id: string; name: string };
  anchorDate: Date;
  toleranceDays: number;
  frequencyDays: number | null;
  /** Shared by every PmSchedule row this seed writes across calendar years. */
  seriesId: string;
}

/** One generated occurrence, carrying a link back to the row that produced it. */
interface PlannedEntry extends Occurrence {
  seed: ParsedSeed;
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

  // One record per CREATED ENTRY, not per input row: a recurring row expands to
  // many entries, and the upload UI reads `details.imported[].plannedDate` to
  // widen its date filter so the new rows are visible. Reporting only the anchor
  // would leave every later occurrence of a series hidden behind the filter.
  const imported: Array<{
    row: number; ahuName: string; plannedDate: string; scheduleId: string; entryId: string;
    frequencyDays: number | null;
  }> = [];
  const skipped: Array<{ row: number; reason: string; data?: any }> = [];

  // Parsed seeds awaiting expansion; occurrences are bucketed by (AHU, year).
  const parsed: ParsedSeed[] = [];

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
    const rawFreq = (
      row.frequency_days ?? row.frequencyDays ?? row['Frequency Days'] ?? row['Frequency (days)'] ?? ''
    ).toString().trim();

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

    // Recurrence. Blank = a one-off row, exactly as before this column existed.
    // A supplied value must pass validateFrequency (multiple of 30, >= 30, and
    // wide enough that consecutive tolerance windows cannot overlap) — a bad
    // value is REFUSED with the validator's own message rather than rounded to
    // something the operator did not ask for.
    let frequencyDays: number | null;
    if (rawFreq === '') {
      frequencyDays = null;
    } else {
      const n = Number(rawFreq);
      if (!Number.isFinite(n)) {
        skipped.push({ row: rowNum, reason: `Invalid frequency_days "${rawFreq}" — expected a whole number of days`, data: row });
        continue;
      }
      const freqErr = validateFrequency(n, toleranceDays);
      if (freqErr) {
        skipped.push({ row: rowNum, reason: freqErr.message, data: row });
        continue;
      }
      frequencyDays = n;
    }

    parsed.push({
      rowNum, raw: row, ahu, anchorDate: plannedDate, toleranceDays, frequencyDays,
      seriesId: randomUUID(),
    });
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

  // ── Expand each seed into concrete occurrences ────────────────────────────
  // A one-off seed yields exactly one occurrence (unchanged legacy behaviour);
  // a recurring seed yields one per period through the horizon (31 Dec of next
  // calendar year — at the 30-day minimum that is at most 24 rows). The
  // rollover job extends the tail later; nothing here materialises forever.
  const horizon = defaultHorizon(new Date());
  const planned: PlannedEntry[] = [];
  for (const seed of parsed) {
    const occurrences = generateOccurrences({
      anchorDate: seed.anchorDate,
      frequencyDays: seed.frequencyDays,
      toleranceDays: seed.toleranceDays,
      horizonEnd: horizon,
    });
    for (const occ of occurrences) planned.push({ ...occ, seed });
  }

  // Bucket by (AHU, year) — one schedule per bucket, one transaction per
  // schedule. A recurring series crossing a year boundary therefore lands in
  // SEVERAL buckets and writes several PmSchedule rows, tied together by the
  // seed's shared `seriesId` (PmScheduleEntry carries a month but no year, and
  // PmSchedule is unique per (entity, year, version) — so per-year rows are the
  // only representation available).
  const buckets = new Map<string, PlannedEntry[]>();
  for (const p of planned) {
    const key = `${p.seed.ahu.id}::${p.year}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  }

  // ── Pre-flight every bucket's guards BEFORE any write ─────────────────────
  // A series spans several years and therefore several buckets. Applying it
  // year-by-year would let one year be refused while another is written,
  // leaving a HALF-materialised series: the old dates still live in the blocked
  // year, the new ones in the rest, and only some rows carrying the seriesId.
  // So guards are resolved up front and a series is all-or-nothing.
  const existingByKey = new Map<string, { id: string } | null>();
  const blockByKey = new Map<string, string | null>();
  for (const [key, bucket] of buckets) {
    const ahu = bucket[0].seed.ahu;
    const year = bucket[0].year;
    const schedule = await prisma.pmSchedule.findFirst({
      where: { entityId: ahu.id, year, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    existingByKey.set(key, schedule ? { id: schedule.id } : null);
    blockByKey.set(key, schedule ? await evaluateGuards(schedule.id, ahu.name, year, wf.workflowEnabled) : null);
  }

  // Any blocked year refuses that seed's ENTIRE series (owner decision,
  // 2026-08-26). For a one-off row this is identical to the previous
  // per-bucket behaviour, since a one-off occupies exactly one bucket.
  const refusedSeeds = new Map<ParsedSeed, { year: number; block: string }>();
  for (const [key, bucket] of buckets) {
    const block = blockByKey.get(key);
    if (!block) continue;
    for (const p of bucket) {
      if (!refusedSeeds.has(p.seed)) refusedSeeds.set(p.seed, { year: p.year, block });
    }
  }
  for (const [seed, r] of refusedSeeds) {
    skipped.push({
      row: seed.rowNum,
      reason: seed.frequencyDays
        ? `Refusing the whole recurring schedule for AHU "${seed.ahu.name}" (every ${seed.frequencyDays} days from ${seed.anchorDate.toISOString().slice(0, 10)}) because its ${r.year} year cannot be replaced: ${r.block} No year was changed.`
        : r.block,
      data: seed.raw,
    });
  }

  for (const [key, wholeBucket] of buckets) {
    const ahu = wholeBucket[0].seed.ahu;
    const year = wholeBucket[0].year;
    // Drop occurrences belonging to a refused series. A bucket left empty must
    // be skipped entirely — the hard-replace below would otherwise wipe the
    // existing entries and repopulate with nothing.
    const bucket = wholeBucket.filter((p) => !refusedSeeds.has(p.seed));
    if (bucket.length === 0) continue;
    try {
      const schedule = existingByKey.get(key) ?? null;

      // Last-wins per month, mirroring the previous per-row upsert where a later
      // row for the same month overwrote the earlier one. Only multiples of 30
      // are accepted as a frequency, so one series can never contribute two
      // occurrences to the same month — a collision here means two different
      // upload ROWS targeted the same AHU and month.
      const byMonth = new Map<number, PlannedEntry>();
      for (const p of bucket) byMonth.set(p.month, p);

      // Series metadata for this schedule row comes from the LAST seed that
      // contributed to it, consistent with the last-wins rule above.
      const owningSeed = [...byMonth.values()][byMonth.size - 1].seed;

      // Hard-replace + repopulate atomically: the new file fully REPLACES the
      // schedule, so old months absent from it stop generating /due tasks.
      //
      // NOTE (Phase 5): this only replaces years the NEW file actually covers.
      // If a previous series ran further into the future than this one does,
      // those later years keep their old entries. Superseding them is the
      // explicit job of Phase 5 (supersede-on-re-upload) — see the plan.
      const scheduleId = await prisma.$transaction(async (tx) => {
        const seriesData = {
          frequencyDays: owningSeed.frequencyDays,
          anchorDate: owningSeed.frequencyDays ? owningSeed.anchorDate : null,
          seriesId: owningSeed.frequencyDays ? owningSeed.seriesId : null,
        };

        const sid = schedule
          ? schedule.id
          : (await tx.pmSchedule.create({
              data: { entityId: ahu.id, year, status: 'ACTIVE', createdBy: ctx.userSub, ...seriesData },
            })).id;

        if (schedule) {
          // Re-uploading over an existing schedule must also refresh its series
          // metadata, or the rollover job would keep extending the OLD
          // frequency/anchor after the operator changed it.
          await tx.pmSchedule.update({ where: { id: sid }, data: seriesData });
          await tx.pmScheduleEntry.deleteMany({ where: { scheduleId: sid } });
        }

        await tx.pmScheduleEntry.createMany({
          data: [...byMonth.values()].map((p) => ({
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

      // createMany returns no rows — read the ids back for the per-entry report.
      const created = await prisma.pmScheduleEntry.findMany({
        where: { scheduleId },
        select: { id: true, month: true },
      });
      const entryIdByMonth = new Map(created.map((e) => [e.month, e.id]));

      for (const p of byMonth.values()) {
        imported.push({
          row: p.seed.rowNum,
          ahuName: p.seed.ahu.name,
          plannedDate: p.plannedDate.toISOString().slice(0, 10),
          scheduleId,
          entryId: entryIdByMonth.get(p.month) ?? '',
          frequencyDays: p.seed.frequencyDays,
        });
      }
    } catch (e: any) {
      // The transaction rolled back — this schedule is unchanged on disk.
      // Report once per source row, not once per generated occurrence: a
      // 17-occurrence series failing would otherwise produce 17 identical
      // error lines for what the operator sees as a single bad row.
      for (const rowNum of new Set(bucket.map((p) => p.seed.rowNum))) {
        const seed = bucket.find((p) => p.seed.rowNum === rowNum)!.seed;
        skipped.push({ row: rowNum, reason: `DB error: ${e.message ?? String(e)}`, data: seed.raw });
      }
    }
  }

  // ── Supersede the previous series, per AHU ────────────────────────────────
  // The hard-replace above only touches years the NEW file covers. A previous
  // series that ran FURTHER into the future keeps its later years, which would
  // go on generating PM tasks from a schedule the operator has replaced. Runs
  // only for seeds that actually landed (a refused series must supersede
  // nothing) and only for recurring ones — a one-off upload has never implied
  // ending a series.
  const landedSeeds = parsed.filter((s) => s.frequencyDays && !refusedSeeds.has(s));
  for (const seed of landedSeeds) {
    const keepYears = [...new Set(planned.filter((p) => p.seed === seed).map((p) => p.year))];
    try {
      const sup = await supersedePreviousSeries(seed.ahu.id, keepYears, seed.seriesId);
      if (sup.entriesDeleted > 0 || sup.schedulesArchived > 0) {
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_IMPORTED',
          targetType: 'pm_schedule', targetId: seed.seriesId,
          afterValue: {
            ahuName: seed.ahu.name, keepYears,
            entriesDeleted: sup.entriesDeleted, schedulesArchived: sup.schedulesArchived,
            retained: sup.retained,
          },
          reason: `New recurring schedule for ${seed.ahu.name} superseded the previous series — ${sup.entriesDeleted} future unexecuted entr(y/ies) removed, ${sup.schedulesArchived} schedule row(s) archived, ${sup.retained.length} row(s) retained as evidence`,
          signatureMeaning: `Previous PM series for AHU "${seed.ahu.name}" ended by a new upload; executed, past and justified entries retained`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        });
      }
    } catch {
      // Superseding is cleanup, not the operator's requested action. The new
      // schedule is already committed and correct; failing the whole upload
      // here would be a worse outcome than leaving a stale future year behind
      // for the next run to catch.
    }
  }

  // Report in file order, then chronologically within a row — the write phase
  // groups by schedule, so a series' occurrences arrive grouped by year.
  imported.sort((a, b) => a.row - b.row || a.plannedDate.localeCompare(b.plannedDate));
  skipped.sort((a, b) => a.row - b.row);

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_IMPORTED',
    targetType: 'pm_schedule', targetId: 'bulk',
    afterValue: { imported: imported.length, skipped: skipped.length, ahuNames: [...new Set(imported.map((i) => i.ahuName))] },
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

/**
 * Generate the CSV template string shown to users.
 *
 * `frequency_days` is optional and, when blank, the row behaves exactly as it
 * did before the column existed: a single one-off PM on `scheduled_date`.
 * Supplied, it must be a multiple of 30 — 30 days means one calendar month, so
 * the PM keeps the same day-of-month every time (see pm-recurrence.ts).
 */
export function getTemplateCsv(): string {
  return 'ahu_name,scheduled_date,tolerance_days,frequency_days\n';
}
