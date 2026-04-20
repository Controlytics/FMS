/**
 * PM Schedule Service — CRUD, CSV upload, execution tracking for preventive maintenance.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { orgScope } from '../../lib/org-scope.js';

function orgFilter(ctx: RequestContext) { return orgScope(ctx); }

// ─── My Tasks types ──────────────────────────────────────
export type DueFilterStatus = 'pending' | 'cleaned_in_window' | 'in_progress';
export type DueOverallStatus = 'pending' | 'in_progress' | 'complete' | 'overdue';

export interface DueFilterRow {
  filterId: string;
  filterName: string;
  status: DueFilterStatus;
  lastCycleCompletedAt: Date | null;
}

export interface DueTaskRow {
  entryId: string;
  ahuId: string;
  ahuName: string;
  plannedDate: Date;
  toleranceDays: number;
  windowStart: Date;
  windowEnd: Date;
  totalFilters: number;
  cleanedCount: number;
  overallStatus: DueOverallStatus;
  filters: DueFilterRow[];
}

export interface DueTasksResponse {
  tasks: DueTaskRow[];
  overdue: DueTaskRow[];
  settings: { showOverdueSeparately: boolean };
}

async function checkPmEnabled() {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
  const val = cfg?.configValue as any;
  if (!val?.enabled) throw new AppError(404, 'PM_DISABLED', 'PM scheduling module is not enabled');
}

export class PmScheduleService {
  async getByEntity(ctx: RequestContext, entityId: string, year?: number) {
    await checkPmEnabled();
    const targetYear = year ?? new Date().getFullYear();

    // Verify entity belongs to the user's organization
    if (ctx.organizationId) {
      const entity = await prisma.assetInstance.findFirst({
        where: { id: entityId, organizationId: ctx.organizationId },
        select: { id: true },
      });
      if (!entity) throw new AppError(404, 'NOT_FOUND', 'Entity not found in your organization');
    }

    const schedule = await prisma.pmSchedule.findFirst({
      where: { entityId, year: targetYear, status: 'ACTIVE' },
      include: {
        entries: {
          orderBy: { month: 'asc' },
          include: { executions: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
      orderBy: { version: 'desc' },
    });

    if (!schedule) return null;

    return {
      ...schedule,
      entries: schedule.entries.map(e => ({
        ...e,
        execution: e.executions[0] ?? null,
      })),
    };
  }

  async create(ctx: RequestContext, data: any) {
    await checkPmEnabled();
    const { entityId, year, entries } = data;

    // Check for existing active schedule
    const existing = await prisma.pmSchedule.findFirst({
      where: { entityId, year, status: 'ACTIVE' },
    });
    if (existing) throw new AppError(409, 'CONFLICT', `Active PM schedule already exists for year ${year}`);

    const schedule = await prisma.pmSchedule.create({
      data: {
        entityId,
        year,
        status: 'ACTIVE',
        createdBy: ctx.userSub,
        entries: {
          create: entries.map((e: any) => ({
            month: e.month,
            plannedDate: new Date(e.plannedDate),
            toleranceDays: e.toleranceDays ?? 0,
            windowStart: new Date(new Date(e.plannedDate).getTime() - (e.toleranceDays ?? 0) * 86400000),
            windowEnd: new Date(new Date(e.plannedDate).getTime() + (e.toleranceDays ?? 0) * 86400000),
            notes: e.notes ?? null,
          })),
        },
      },
      include: { entries: { orderBy: { month: 'asc' } } },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'pm_schedule', targetId: schedule.id,
      afterValue: { entityId, year, entryCount: entries.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return schedule;
  }

  async update(ctx: RequestContext, id: string, data: any) {
    await checkPmEnabled();
    const existing = await prisma.pmSchedule.findUnique({
      where: { id },
      include: { entries: true },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM schedule not found');

    // Archive old version
    await prisma.pmSchedule.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    // Create new version
    const newSchedule = await prisma.pmSchedule.create({
      data: {
        entityId: existing.entityId,
        year: existing.year,
        version: existing.version + 1,
        status: 'ACTIVE',
        createdBy: ctx.userSub,
        entries: {
          create: ((entries) => {
            if (entries !== undefined && entries.length === 0) {
              throw new AppError(400, 'VALIDATION_ERROR', 'Schedule must have at least one entry');
            }
            return entries;
          })(data.entries ?? []).map((e: any) => ({
            month: e.month,
            plannedDate: new Date(e.plannedDate),
            toleranceDays: e.toleranceDays ?? 0,
            windowStart: new Date(new Date(e.plannedDate).getTime() - (e.toleranceDays ?? 0) * 86400000),
            windowEnd: new Date(new Date(e.plannedDate).getTime() + (e.toleranceDays ?? 0) * 86400000),
            notes: e.notes ?? null,
          })),
        },
      },
      include: { entries: { orderBy: { month: 'asc' } } },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
      targetType: 'pm_schedule', targetId: newSchedule.id,
      beforeValue: { version: existing.version },
      afterValue: { version: newSchedule.version },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return newSchedule;
  }

  async delete(ctx: RequestContext, id: string) {
    await checkPmEnabled();
    const existing = await prisma.pmSchedule.findUnique({
      where: { id },
      include: { entries: { include: { executions: true } } },
    });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM schedule not found');

    // Check if any executions are in progress
    const inProgress = existing.entries.some(e => e.executions.some(ex => ex.status === 'IN_PROGRESS'));
    if (inProgress) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot delete: schedule has executions in progress');
    }

    // Delete executions, entries, then schedule
    await prisma.$transaction([
      prisma.pmExecution.deleteMany({ where: { scheduleEntryId: { in: existing.entries.map(e => e.id) } } }),
      prisma.pmScheduleEntry.deleteMany({ where: { scheduleId: id } }),
      prisma.pmSchedule.delete({ where: { id } }),
    ]);

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'DELETED',
      targetType: 'pm_schedule', targetId: id,
      beforeValue: { entityId: existing.entityId, year: existing.year, version: existing.version },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async getHistory(ctx: RequestContext, entityId: string) {
    await checkPmEnabled();
    return prisma.pmSchedule.findMany({
      where: { entityId },
      orderBy: [{ year: 'desc' }, { version: 'desc' }],
      select: { id: true, year: true, version: true, status: true, createdAt: true },
    });
  }

  async createExecution(ctx: RequestContext, data: any) {
    await checkPmEnabled();
    const { scheduleEntryId, entityId, filterSet } = data;

    const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: scheduleEntryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Schedule entry not found');

    // Prevent duplicate IN_PROGRESS executions
    const existing = await prisma.pmExecution.findFirst({
      where: { scheduleEntryId, status: 'IN_PROGRESS' },
    });
    if (existing) throw new AppError(409, 'CONFLICT', 'An execution is already in progress for this entry');

    const now = new Date();
    const isWithinWindow = now >= entry.windowStart && now <= entry.windowEnd;

    const execution = await prisma.pmExecution.create({
      data: {
        scheduleEntryId,
        entityId,
        status: 'IN_PROGRESS',
        startedAt: now,
        performedBy: ctx.userSub,
        isWithinWindow,
        filterSet: filterSet ?? null,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PM_STARTED',
      targetType: 'pm_execution', targetId: execution.id,
      afterValue: { entityId, isWithinWindow, filterSet },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return execution;
  }

  /**
   * Return every PM schedule entry whose tolerance window contains `now`
   * (due) or whose window closed recently without completion (overdue),
   * grouped by AHU with each AHU's filters and per-filter cleaning status.
   *
   * Used by the My Tasks page. Pure read — no writes, no mutations, no
   * side effects. Status is computed from the latest CleaningCycle on each
   * filter against the entry's window bounds.
   */
  async getDueTasks(ctx: RequestContext) {
    await checkPmEnabled();

    // Load the PM schedule settings (default tolerance isn't relevant here —
    // only visibility mode and the overdue-section toggle).
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
    const settings = (cfg?.configValue as any) ?? {};
    const taskVisibility: string = settings.taskVisibility ?? 'GLOBAL';
    const showOverdueSeparately: boolean = settings.showOverdueSeparately ?? true;

    // Only GLOBAL is wired up in v1. PER_USER and ROLE_GATED are config
    // slots that we return a clear 501 for until they're built.
    if (taskVisibility !== 'GLOBAL') {
      throw new AppError(
        501,
        'NOT_IMPLEMENTED',
        `Task visibility mode "${taskVisibility}" is not yet implemented — only GLOBAL is supported in v1`,
      );
    }

    const now = new Date();
    // Overdue horizon: don't return entries whose window closed more than
    // 30 days ago — avoids serving years of stale history on every request.
    const overdueHorizon = new Date(now.getTime() - 30 * 86400000);

    // Fetch candidate entries (in window OR recently overdue) — only APPROVED entries
    const entries = await prisma.pmScheduleEntry.findMany({
      where: {
        schedule: { status: 'ACTIVE' },
        approvalStatus: 'APPROVED',
        OR: [
          { AND: [{ windowStart: { lte: now } }, { windowEnd: { gte: now } }] },
          { AND: [{ windowEnd: { lt: now } }, { windowEnd: { gte: overdueHorizon } }] },
        ],
      },
      include: { schedule: true },
      orderBy: { plannedDate: 'asc' },
    });

    if (entries.length === 0) {
      return { tasks: [], overdue: [], settings: { showOverdueSeparately } };
    }

    // Deduplicate AHU lookups — multiple entries can share the same AHU.
    // customAttributes.pmFilterSetMode is the per-AHU knob added in the
    // filter-set config UI: BOTH / SET_A / SET_B / DISABLED (default BOTH).
    const ahuIds = Array.from(new Set(entries.map(e => e.schedule.entityId)));
    const ahus = await prisma.assetInstance.findMany({
      where: { id: { in: ahuIds }, ...orgScope(ctx) },
      select: { id: true, name: true, organizationId: true, customAttributes: true },
    });
    const ahuById = new Map(ahus.map(a => [a.id, a]));

    // Bulk-fetch all child filters for all AHUs in one query.
    // filterSet is needed so we can apply per-AHU Set A / Set B filtering.
    const allChildFilters = await prisma.assetInstance.findMany({
      where: {
        parentId: { in: ahus.map(a => a.id) },
        isActive: true,
        status: { not: 'Retired' },
      },
      select: { id: true, name: true, parentId: true, filterSet: true },
    });
    const filtersByAhu = new Map<string, typeof allChildFilters>();
    for (const f of allChildFilters) {
      if (!f.parentId) continue;
      if (!filtersByAhu.has(f.parentId)) filtersByAhu.set(f.parentId, []);
      filtersByAhu.get(f.parentId)!.push(f);
    }

    // Bulk-fetch the latest cleaning cycle for every involved filter
    // (we take the 5 most recent per filter to also catch "in window"
    // cycles that aren't strictly the latest).
    const filterIds = allChildFilters.map(f => f.id);
    const recentCycles = filterIds.length
      ? await prisma.cleaningCycle.findMany({
          where: { filterId: { in: filterIds } },
          orderBy: [{ filterId: 'asc' }, { startedAt: 'desc' }],
        })
      : [];
    const cyclesByFilter = new Map<string, typeof recentCycles>();
    for (const c of recentCycles) {
      if (!cyclesByFilter.has(c.filterId)) cyclesByFilter.set(c.filterId, []);
      cyclesByFilter.get(c.filterId)!.push(c);
    }

    // Build result rows (types live at module scope — see top of file)
    const active: DueTaskRow[] = [];
    const overdue: DueTaskRow[] = [];

    for (const entry of entries) {
      const ahu = ahuById.get(entry.schedule.entityId);
      if (!ahu) continue; // filtered out by orgScope

      // Read the per-AHU filter-set mode. Default is BOTH (count everything).
      const ahuAttrs = (ahu.customAttributes as any) ?? {};
      const mode: 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED' = (
        ahuAttrs.pmFilterSetMode === 'SET_A' || ahuAttrs.pmFilterSetMode === 'SET_B' || ahuAttrs.pmFilterSetMode === 'DISABLED'
          ? ahuAttrs.pmFilterSetMode
          : 'BOTH'
      );

      // DISABLED: skip this AHU entirely — the task does not appear in My Tasks
      // or in the Overdue section, even if its window is open.
      if (mode === 'DISABLED') continue;

      let childFilters = filtersByAhu.get(ahu.id) ?? [];

      // SET_A / SET_B: narrow the filter list to that set. Filters with a null
      // filterSet are excluded in this mode — they explicitly belong to no set.
      if (mode === 'SET_A') {
        childFilters = childFilters.filter(f => f.filterSet === 'SET_A');
      } else if (mode === 'SET_B') {
        childFilters = childFilters.filter(f => f.filterSet === 'SET_B');
      }

      const inWindow = now >= entry.windowStart && now <= entry.windowEnd;

      const filterStatuses: DueFilterRow[] = childFilters.map(f => {
        const cycles = cyclesByFilter.get(f.id) ?? [];
        // Prefer an IN_PROGRESS cycle started before or during the window
        const inProgress = cycles.find(c =>
          c.status === 'IN_PROGRESS' && c.startedAt <= entry.windowEnd,
        );
        // Otherwise the most recent cycle that completed within the window
        const cleanedInWindow = cycles.find(c =>
          c.completedAt != null
          && c.completedAt >= entry.windowStart
          && c.completedAt <= entry.windowEnd,
        );

        let status: DueFilterStatus = 'pending';
        if (cleanedInWindow) status = 'cleaned_in_window';
        else if (inProgress) status = 'in_progress';

        return {
          filterId: f.id,
          filterName: f.name,
          status,
          lastCycleCompletedAt: cleanedInWindow?.completedAt ?? cycles[0]?.completedAt ?? null,
        };
      });

      const cleanedCount = filterStatuses.filter(s => s.status === 'cleaned_in_window').length;
      const inProgressCount = filterStatuses.filter(s => s.status === 'in_progress').length;
      const totalFilters = filterStatuses.length;

      let overallStatus: DueOverallStatus;
      if (inWindow) {
        if (totalFilters > 0 && cleanedCount === totalFilters) overallStatus = 'complete';
        else if (cleanedCount + inProgressCount > 0) overallStatus = 'in_progress';
        else overallStatus = 'pending';
      } else {
        // Window already closed
        if (totalFilters > 0 && cleanedCount === totalFilters) continue; // hide — all done
        overallStatus = 'overdue';
      }

      const row: DueTaskRow = {
        entryId: entry.id,
        ahuId: ahu.id,
        ahuName: ahu.name,
        plannedDate: entry.plannedDate,
        toleranceDays: entry.toleranceDays,
        windowStart: entry.windowStart,
        windowEnd: entry.windowEnd,
        totalFilters,
        cleanedCount,
        overallStatus,
        filters: filterStatuses,
      };

      if (overallStatus === 'overdue') overdue.push(row);
      else active.push(row);
    }

    return {
      tasks: active,
      overdue: showOverdueSeparately ? overdue : [],
      settings: { showOverdueSeparately },
    };
  }

  /**
   * Bulk import PM schedule entries from a parsed CSV/XLSX row set.
   *
   * Each row is shaped as `{ ahu_name, scheduled_date, tolerance_days? }`.
   * For each row we:
   *   1. Resolve ahu_name → AssetInstance (case-insensitive, org-scoped)
   *   2. Parse scheduled_date (ISO YYYY-MM-DD) and derive the year
   *   3. Fall back to `defaultToleranceDays` from config if tolerance_days is blank
   *   4. Upsert the PmSchedule for (ahuId, year) as ACTIVE
   *   5. Create a new PmScheduleEntry with pre-computed windowStart/windowEnd
   *
   * Bad rows are collected in `skipped` instead of aborting the whole import.
   */
  async importSchedules(ctx: RequestContext, rows: Array<Record<string, any>>) {
    await checkPmEnabled();

    // Load default tolerance from config
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-settings' } });
    const settings = (cfg?.configValue as any) ?? {};
    const defaultToleranceDays = Number(settings.defaultToleranceDays ?? 3);

    const imported: Array<{ row: number; ahuName: string; plannedDate: string; scheduleId: string; entryId: string }> = [];
    const skipped: Array<{ row: number; reason: string; data?: any }> = [];

    // Pre-fetch candidate AHUs (one scoped query) — cuts N queries to 1
    const ahuTemplate = await prisma.assetTemplate.findFirst({ where: { name: 'AHU' }, select: { id: true } });
    const ahus = await prisma.assetInstance.findMany({
      where: {
        ...(ahuTemplate ? { templateId: ahuTemplate.id } : {}),
        ...orgScope(ctx),
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

        // Upsert the entry — if same (schedule, month) exists, update date/tolerance.
        // SUPER_ADMIN uploads are auto-approved; others go to PENDING for QA review.
        const isSuperAdmin = ctx.userRole === 'SUPER_ADMIN';
        const approvalFields = {
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

    return {
      imported: imported.length,
      skipped: skipped.length,
      details: { imported, skipped },
    };
  }

  /**
   * List every AHU with its current pmFilterSetMode, per-set filter counts,
   * and whether it has a PM schedule. Used by the AHU config table on the
   * PM Schedules page. Org-scoped.
   */
  async listAhuFilterSetConfigs(ctx: RequestContext) {
    await checkPmEnabled();

    const ahuTemplate = await prisma.assetTemplate.findFirst({ where: { name: 'AHU' }, select: { id: true } });
    if (!ahuTemplate) return { ahus: [] };

    const ahus = await prisma.assetInstance.findMany({
      where: {
        templateId: ahuTemplate.id,
        ...orgScope(ctx),
        isActive: true,
      },
      select: { id: true, name: true, customAttributes: true },
      orderBy: { name: 'asc' },
    });

    // Bulk-count child filters per AHU grouped by filterSet (one query)
    const ahuIds = ahus.map(a => a.id);
    const childFilters = ahuIds.length
      ? await prisma.assetInstance.findMany({
          where: {
            parentId: { in: ahuIds },
            template: { name: 'Filter' },
            isActive: true,
            status: { not: 'Retired' },
          },
          select: { parentId: true, filterSet: true },
        })
      : [];

    const countsByAhu = new Map<string, { setA: number; setB: number; noSet: number }>();
    for (const f of childFilters) {
      if (!f.parentId) continue;
      if (!countsByAhu.has(f.parentId)) countsByAhu.set(f.parentId, { setA: 0, setB: 0, noSet: 0 });
      const c = countsByAhu.get(f.parentId)!;
      if (f.filterSet === 'SET_A') c.setA++;
      else if (f.filterSet === 'SET_B') c.setB++;
      else c.noSet++;
    }

    // Which AHUs have an active PM schedule right now? Convenience flag
    // so the UI can surface "no schedule yet" rows distinctly if it wants.
    const scheduledAhuRows = await prisma.pmSchedule.findMany({
      where: { entityId: { in: ahuIds }, status: 'ACTIVE' },
      select: { entityId: true },
      distinct: ['entityId'],
    });
    const scheduledAhus = new Set(scheduledAhuRows.map(r => r.entityId));

    return {
      ahus: ahus.map(a => {
        const attrs = (a.customAttributes as any) ?? {};
        const mode = (attrs.pmFilterSetMode === 'SET_A' || attrs.pmFilterSetMode === 'SET_B' || attrs.pmFilterSetMode === 'DISABLED')
          ? attrs.pmFilterSetMode
          : 'BOTH';
        const counts = countsByAhu.get(a.id) ?? { setA: 0, setB: 0, noSet: 0 };
        return {
          ahuId: a.id,
          ahuName: a.name,
          mode: mode as 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED',
          setACount: counts.setA,
          setBCount: counts.setB,
          noSetCount: counts.noSet,
          totalFilters: counts.setA + counts.setB + counts.noSet,
          hasActiveSchedule: scheduledAhus.has(a.id),
        };
      }),
    };
  }

  /**
   * Update the pmFilterSetMode on an AHU's customAttributes. Uses a read +
   * merge + write to preserve other keys inside customAttributes.
   */
  async updateAhuFilterSetMode(ctx: RequestContext, ahuId: string, mode: 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED') {
    await checkPmEnabled();

    // Verify the AHU exists in the user's org
    const ahu = await prisma.assetInstance.findFirst({
      where: { id: ahuId, ...orgScope(ctx) },
      select: { id: true, name: true, customAttributes: true },
    });
    if (!ahu) throw new AppError(404, 'NOT_FOUND', 'AHU not found in your organization');

    const currentAttrs = (ahu.customAttributes as any) ?? {};
    const newAttrs = { ...currentAttrs, pmFilterSetMode: mode };

    await prisma.assetInstance.update({
      where: { id: ahuId },
      data: { customAttributes: newAttrs },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'AHU_PM_FILTER_SET_MODE_UPDATED',
      targetType: 'asset_instance', targetId: ahuId,
      beforeValue: { pmFilterSetMode: currentAttrs.pmFilterSetMode ?? 'BOTH' },
      afterValue: { pmFilterSetMode: mode, ahuName: ahu.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { ahuId, ahuName: ahu.name, mode };
  }

  /** Generate the CSV template string shown to users. */
  getTemplateCsv(): string {
    return [
      'ahu_name,scheduled_date,tolerance_days',
      '# Dates accepted: YYYY-MM-DD or DD-MM-YYYY. Tolerance blank = default from config.',
      '# Example rows — delete these lines before uploading:',
      'AHU-01,2026-04-15,',
      'AHU-02,20-04-2026,5',
    ].join('\n') + '\n';
  }

  async updateExecution(ctx: RequestContext, id: string, data: any) {
    await checkPmEnabled();
    const existing = await prisma.pmExecution.findUnique({ where: { id } });
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'PM execution not found');

    // State machine validation: only IN_PROGRESS executions can be updated
    if (existing.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'VALIDATION_ERROR', `Cannot update execution in ${existing.status} status`);
    }

    const updated = await prisma.pmExecution.update({
      where: { id },
      data: {
        status: data.status,
        completedAt: data.status === 'COMPLETED' ? new Date() : undefined,
        notes: data.notes ?? existing.notes,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PM_UPDATED',
      targetType: 'pm_execution', targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: updated.status },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return updated;
  }

  // ─── QA Approval Workflow ──────────────────────────────────

  /** Check if the current user's role is allowed to approve PM schedules. */
  private async assertPmApprovalRole(userRole: string | undefined) {
    if (userRole === 'SUPER_ADMIN') return;
    const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'pm-schedule-approval' } });
    const configured = (cfg?.configValue as any)?.approvalRole;
    if (!configured || configured.trim() === '') return;
    if (userRole !== configured) {
      throw new AppError(403, 'FORBIDDEN_ROLE', `Only users with role "${configured}" can approve PM schedules`);
    }
  }

  /** List schedule entries with approval status for the PM Schedules table. */
  async listEntries(ctx: RequestContext, query: { approvalStatus?: string; year?: number; page?: number; limit?: number }) {
    await checkPmEnabled();
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const year = query.year ?? new Date().getFullYear();

    // Org-scope by fetching visible AHU IDs first (same pattern as getDueTasks)
    const orgWhere = orgFilter(ctx);
    const visibleAhus = await prisma.assetInstance.findMany({
      where: { ...orgWhere, isActive: true },
      select: { id: true },
    });
    const visibleAhuIds = visibleAhus.map(a => a.id);

    const where: any = {
      schedule: { status: 'ACTIVE', year, entityId: { in: visibleAhuIds } },
    };
    if (query.approvalStatus && query.approvalStatus !== 'ALL') {
      where.approvalStatus = query.approvalStatus;
    }

    const [entries, total] = await Promise.all([
      prisma.pmScheduleEntry.findMany({
        where,
        include: { schedule: true },
        orderBy: { plannedDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.pmScheduleEntry.count({ where }),
    ]);

    // Resolve AHU names from entityIds
    const entityIds = [...new Set(entries.map((e: any) => e.schedule?.entityId).filter(Boolean))];
    const ahus = entityIds.length > 0
      ? await prisma.assetInstance.findMany({ where: { id: { in: entityIds } }, select: { id: true, name: true } })
      : [];
    const ahuMap = new Map(ahus.map(a => [a.id, a.name]));

    const data = entries.map((e: any) => ({
      id: e.id,
      scheduleId: e.scheduleId,
      ahuId: e.schedule?.entityId,
      ahuName: ahuMap.get(e.schedule?.entityId) ?? '?',
      month: e.month,
      plannedDate: e.plannedDate,
      toleranceDays: e.toleranceDays,
      windowStart: e.windowStart,
      windowEnd: e.windowEnd,
      approvalStatus: e.approvalStatus,
      approvalRemarks: e.approvalRemarks,
      approvedByName: e.approvedByName,
      approvedAt: e.approvedAt,
      submittedByName: e.submittedByName,
      pendingPlannedDate: e.pendingPlannedDate,
      pendingToleranceDays: e.pendingToleranceDays,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Approve selected entries. If an entry has a pending edit, apply it. */
  async approveEntries(ctx: RequestContext, entryIds: string[], comment?: string) {
    await checkPmEnabled();
    await this.assertPmApprovalRole(ctx.userRole);

    const entries = await prisma.pmScheduleEntry.findMany({
      where: { id: { in: entryIds } },
    });
    if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');

    const results: string[] = [];
    for (const entry of entries) {
      if (entry.approvalStatus !== 'PENDING') {
        results.push(`${entry.id}: already ${entry.approvalStatus}`);
        continue;
      }

      // If there's a pending edit, apply it
      const hasPendingEdit = entry.pendingPlannedDate != null;
      const newPlannedDate = hasPendingEdit ? entry.pendingPlannedDate! : entry.plannedDate;
      const newTolerance = hasPendingEdit && entry.pendingToleranceDays != null ? entry.pendingToleranceDays : entry.toleranceDays;
      const windowStart = new Date(newPlannedDate.getTime() - newTolerance * 86400000);
      const windowEnd = new Date(newPlannedDate.getTime() + newTolerance * 86400000);

      await prisma.pmScheduleEntry.update({
        where: { id: entry.id },
        data: {
          approvalStatus: 'APPROVED',
          approvalRemarks: comment ?? null,
          approvedBy: ctx.userSub,
          approvedByName: ctx.userId,
          approvedAt: new Date(),
          // Apply pending edit if present
          ...(hasPendingEdit ? {
            plannedDate: newPlannedDate,
            toleranceDays: newTolerance,
            windowStart,
            windowEnd,
            pendingPlannedDate: null,
            pendingToleranceDays: null,
            pendingEditBy: null,
            pendingEditAt: null,
          } : {}),
        },
      });

      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_APPROVED',
        targetType: 'pm_schedule_entry', targetId: entry.id,
        afterValue: { comment, hasPendingEdit },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      });
      results.push(`${entry.id}: approved`);
    }

    return { processed: results.length, results };
  }

  /** Reject selected entries with mandatory remarks. */
  async rejectEntries(ctx: RequestContext, entryIds: string[], remarks: string) {
    await checkPmEnabled();
    await this.assertPmApprovalRole(ctx.userRole);
    if (!remarks || remarks.trim().length < 3) {
      throw new AppError(400, 'REMARKS_REQUIRED', 'Remarks are required when rejecting (min 3 characters)');
    }

    const entries = await prisma.pmScheduleEntry.findMany({
      where: { id: { in: entryIds } },
    });
    if (entries.length === 0) throw new AppError(404, 'NOT_FOUND', 'No entries found');

    for (const entry of entries) {
      if (entry.approvalStatus !== 'PENDING') continue;
      await prisma.pmScheduleEntry.update({
        where: { id: entry.id },
        data: {
          approvalStatus: 'REJECTED',
          approvalRemarks: remarks.trim(),
          approvedBy: ctx.userSub,
          approvedByName: ctx.userId,
          approvedAt: new Date(),
          // Clear pending edit if any
          pendingPlannedDate: null,
          pendingToleranceDays: null,
          pendingEditBy: null,
          pendingEditAt: null,
        },
      });

      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_REJECTED',
        targetType: 'pm_schedule_entry', targetId: entry.id,
        afterValue: { remarks: remarks.trim() },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      });
    }

    return { processed: entries.length };
  }

  /** Re-submit a rejected entry with corrected data. Resets to PENDING. */
  async resubmitEntry(ctx: RequestContext, entryId: string, data: { plannedDate: string; toleranceDays?: number }) {
    await checkPmEnabled();
    const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
    if (entry.approvalStatus !== 'REJECTED') {
      throw new AppError(400, 'INVALID_STATUS', 'Only rejected entries can be re-submitted');
    }

    const planned = new Date(data.plannedDate);
    if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');
    const tol = data.toleranceDays ?? entry.toleranceDays;
    const windowStart = new Date(planned.getTime() - tol * 86400000);
    const windowEnd = new Date(planned.getTime() + tol * 86400000);

    const updated = await prisma.pmScheduleEntry.update({
      where: { id: entryId },
      data: {
        plannedDate: planned,
        toleranceDays: tol,
        windowStart,
        windowEnd,
        approvalStatus: 'PENDING',
        approvalRemarks: null,
        approvedBy: null,
        approvedByName: null,
        approvedAt: null,
        submittedBy: ctx.userSub,
        submittedByName: ctx.userId,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_RESUBMITTED',
      targetType: 'pm_schedule_entry', targetId: entryId,
      afterValue: { plannedDate: data.plannedDate, toleranceDays: tol },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return updated;
  }

  /** Edit an approved entry — stores proposed values in pending columns, sets status to PENDING. */
  async editApprovedEntry(ctx: RequestContext, entryId: string, data: { plannedDate: string; toleranceDays?: number }) {
    await checkPmEnabled();
    const entry = await prisma.pmScheduleEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new AppError(404, 'NOT_FOUND', 'Entry not found');
    if (entry.approvalStatus !== 'APPROVED') {
      throw new AppError(400, 'INVALID_STATUS', 'Only approved entries can be edited (pending changes require approval)');
    }

    const planned = new Date(data.plannedDate);
    if (isNaN(planned.getTime())) throw new AppError(400, 'INVALID_DATE', 'Invalid date');

    const updated = await prisma.pmScheduleEntry.update({
      where: { id: entryId },
      data: {
        pendingPlannedDate: planned,
        pendingToleranceDays: data.toleranceDays ?? entry.toleranceDays,
        pendingEditBy: ctx.userSub,
        pendingEditAt: new Date(),
        approvalStatus: 'PENDING',
        approvalRemarks: null,
        approvedBy: null,
        approvedByName: null,
        approvedAt: null,
        submittedBy: ctx.userSub,
        submittedByName: ctx.userId,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'PM_SCHEDULE_EDIT_REQUESTED',
      targetType: 'pm_schedule_entry', targetId: entryId,
      beforeValue: { plannedDate: entry.plannedDate, toleranceDays: entry.toleranceDays },
      afterValue: { pendingPlannedDate: data.plannedDate, pendingToleranceDays: data.toleranceDays ?? entry.toleranceDays },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return updated;
  }

  /** Get counts of PENDING and REJECTED entries for the status badge. */
  async pendingCounts(ctx: RequestContext) {
    await checkPmEnabled();
    const baseWhere = { schedule: { status: 'ACTIVE' as const } };
    const [pending, rejected] = await Promise.all([
      prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'PENDING' } }),
      prisma.pmScheduleEntry.count({ where: { ...baseWhere, approvalStatus: 'REJECTED' } }),
    ]);
    return { pending, rejected };
  }
}
