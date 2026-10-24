import { prisma } from '../../lib/prisma.js';
import { rangeStartOrThrow, rangeEndOrThrow } from '../../lib/date-range-guard.js';

/**
 * Quality Notification (QNN) report data + visibility. QNN rows are minted by
 * pm-workflow.generateQnn for three workflows: PM schedules, replacement
 * schedules and — since 2026-10-24 — the filter creation workflow
 * (assets/filter-qnn.ts; its rows hold the filter id in pm_schedule_entry_id and
 * their message starts "Filter …"). The report is visible to
 * the same roles as QNN notifications — config `qnn-notifications.visibleRoles`
 * (default ['ADMIN']) plus SUPER_ADMIN.
 */
export async function canSeeQnn(role?: string | null): Promise<boolean> {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  let roles: string[] = ['ADMIN'];
  try {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } });
    const v = row?.configValue as Record<string, unknown> | undefined;
    if (Array.isArray(v?.visibleRoles)) roles = v!.visibleRoles as string[];
  } catch { /* default ADMIN */ }
  return roles.includes(role);
}

export async function listQnn(query: { page?: number; limit?: number; from?: string; to?: string }) {
  const page = query.page ?? 1;
  const limit = (query.limit ?? 50) /* no page-size cap (operator decision 2026-09-04): callers get the size they ask for */;
  const where: { createdAt?: { gte?: Date; lte?: Date } } = {};
  if (query.from || query.to) {
    where.createdAt = {};
    // A bare date is the local day at both ends (lib/date-range-guard.ts); the
    // Quality Notifications page sends a bare `from`, which was UTC midnight.
    if (query.from) where.createdAt.gte = rangeStartOrThrow(query.from, 'from');
    if (query.to) where.createdAt.lte = rangeEndOrThrow(query.to, 'to');
  }
  const [data, total] = await Promise.all([
    prisma.qualityNotification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, qnn: true, action: true, ahuName: true, message: true,
        performedBy: true, performedByName: true, createdAt: true,
      },
    }),
    prisma.qualityNotification.count({ where }),
  ]);
  return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
}
