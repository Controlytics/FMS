import { NotFoundError } from '../../lib/errors.js';
import { notificationRepository } from './notification.repository.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import type { RequestContext } from '../../types/context.js';
import { z } from 'zod';
import type { NotificationType } from '@prisma/client';
import { parseRangeStart, parseRangeEnd } from '../../lib/date-range-guard.js';

// The visibility rule lives ONCE in ./visibility.ts (M30, 2026-10-19).
import { GATED_TYPES, GATED_TYPE_KEYS, visibilityWhere, isVisible } from './visibility.js';
export { GATED_TYPES };

// Which config-gated notification types this role may see. Super Admin sees all;
// otherwise a type is visible when the viewer's role is in that type's config list.
export async function gatedTypesVisibleTo(userRole: string): Promise<string[]> {
  if (userRole === 'SUPER_ADMIN') return [...GATED_TYPE_KEYS];
  const out: string[] = [];
  for (const [type, { configKey, field }] of Object.entries(GATED_TYPES)) {
    let roles: string[] = ['ADMIN'];
    try {
      const row = await prisma.systemConfig.findUnique({ where: { configKey } });
      const v = row?.configValue as Record<string, unknown> | undefined;
      if (Array.isArray(v?.[field])) roles = v![field] as string[];
    } catch { /* default ADMIN */ }
    if (roles.includes(userRole)) out.push(type);
  }
  return out;
}

// Visibility enforcing gated-type config: non-gated notifications use the normal
// per-role rules; gated types show only to roles allowed by their config.
function gatedAwareWhere(userRole: string, username: string, visibleGated: string[]): Record<string, unknown> {
  return visibilityWhere(userRole, username, visibleGated);
}

const notificationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).optional(),
  isRead: z.enum(['true', 'false']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  period: z.enum(['today', 'week', 'month', 'quarter', 'year', 'all']).optional(),
  // Free-text over the two fields the row actually DISPLAYS. Deliberately not
  // `type`: searching "PASSWORD" would then hit rows whose visible text does not
  // contain it, which reads as a broken filter.
  search: z.string().trim().max(200).optional(),
});

/**
 * AND a free-text clause onto an existing where WITHOUT touching its top-level OR.
 *
 * 🔴 `gatedAwareWhere` returns `{ OR: [...] }` — that OR *is* the visibility
 * rule. Writing `where.OR = [{ title: ... }, { message: ... }]` for the search
 * would REPLACE it, and every user would search across everybody's
 * notifications. The search must live under AND, never beside the visibility OR.
 */
function applySearchFilter(where: Record<string, unknown>, search?: string) {
  const term = search?.trim();
  if (!term) return;
  const clause = {
    OR: [
      { title: { contains: term, mode: 'insensitive' } },
      { message: { contains: term, mode: 'insensitive' } },
    ],
  };
  const existing = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [...existing, clause];
}

function applyDateFilter(where: Record<string, unknown>, period?: string, startDate?: string, endDate?: string) {
  if (period && period !== 'all') {
    const now = new Date();
    let start: Date;

    switch (period) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarter':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        start = new Date(0);
    }

    where.createdAt = { gte: start };
  } else if (startDate || endDate) {
    where.createdAt = {};
    // 2026-10-23: the start was `new Date(startDate)` — UTC midnight for a bare
    // date, 05:30 in India — so the first hours of the day dropped out.
    // parseRangeStart is the other half of the shared local-day rule.
    if (startDate) {
      const start = parseRangeStart(startDate);
      if (start) (where.createdAt as Record<string, unknown>).gte = start;
    }
    // 2026-09-03: was `new Date(endDate)`, which for a bare `yyyy-mm-dd` is
    // MIDNIGHT — so "to = today" excluded everything that happened today and a
    // same-day range returned nothing at all. parseRangeEnd is the shared rule
    // (lib/date-range-guard.ts); a null means the caller sent a non-date, which
    // the global guard deliberately lets through, so leave the bound off rather
    // than turning it into an Invalid Date that matches nothing.
    if (endDate) {
      const end = parseRangeEnd(endDate);
      if (end) (where.createdAt as Record<string, unknown>).lte = end;
    }
  }
}

export const notificationService = {
  async list(query: unknown, userRole: string, username: string) {
    const parsed = notificationQuerySchema.parse(query);
    const where = gatedAwareWhere(userRole, username, await gatedTypesVisibleTo(userRole));

    // Apply date filtering
    applyDateFilter(where, parsed.period, parsed.startDate, parsed.endDate);

    // Apply isRead filter
    if (parsed.isRead !== undefined) {
      where.isRead = parsed.isRead === 'true';
    }

    // unreadCount is computed BEFORE the search clause is added, and the header
    // renders it as "N unread notifications" for the whole (period-scoped) list.
    // Scoped to the search it would mean "unread among search hits" and would
    // jump on every keystroke — and it gates the "Mark all as read" button,
    // whose own query ignores the search entirely, so the button would vanish
    // while the action it triggers still applied to everything.
    const unreadWhere = { ...where, isRead: false };
    applySearchFilter(where, parsed.search);

    const [data, total, unreadCount] = await Promise.all([
      notificationRepository.findMany(where, parsed.limit ? (parsed.page - 1) * parsed.limit : 0, parsed.limit),
      notificationRepository.count(where),
      notificationRepository.count(unreadWhere),
    ]);

    return {
      data,
      total,
      unreadCount,
      page: parsed.page,
      limit: parsed.limit ?? total,
      totalPages: parsed.limit ? Math.ceil(total / parsed.limit) : 1,
    };
  },

  async getUnreadCount(userRole: string, username: string) {
    const where = gatedAwareWhere(userRole, username, await gatedTypesVisibleTo(userRole));
    where.isRead = false;
    return { count: await notificationRepository.count(where) };
  },

  async markRead(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username, await gatedTypesVisibleTo(userRole));
    await notificationRepository.markRead(id);
    return { success: true };
  },

  async markUnread(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username, await gatedTypesVisibleTo(userRole));
    await notificationRepository.markUnread(id);
    return { success: true };
  },

  async markAllRead(userRole: string, username: string) {
    const where = gatedAwareWhere(userRole, username, await gatedTypesVisibleTo(userRole));
    where.isRead = false;
    await notificationRepository.markAllRead(where);
    return { success: true };
  },

  async bulkRead(ids: string[], userRole: string, username: string) {
    const result = await notificationRepository.bulkMarkRead(ids, userRole, username, await gatedTypesVisibleTo(userRole));
    return { success: true, count: result.count };
  },

  async bulkUnread(ids: string[], userRole: string, username: string) {
    const result = await notificationRepository.bulkMarkUnread(ids, userRole, username, await gatedTypesVisibleTo(userRole));
    return { success: true, count: result.count };
  },

  /**
   * Physical delete — no soft-delete fallback, so the audit row is the only
   * surviving record of what was destroyed (21 CFR §11.10(e)). Capture the
   * rows first (deleteMany returns a bare count), then audit-then-delete inside
   * one transaction so a delete can never commit without its audit row.
   * `ctx` replaces the old (userRole, username) pair — buildContext sets
   * ctx.userId = req.user.username, so both are derivable from it.
   */
  async bulkDelete(ids: string[], ctx: RequestContext) {
    const userRole = ctx.userRole;
    const username = ctx.userId;
    const visibleGated = await gatedTypesVisibleTo(userRole);

    const doomed = await notificationRepository.findBulkDeletable(ids, userRole, username, visibleGated);

    const result = await prisma.$transaction(async (tx) => {
      if (doomed.length > 0) {
        await auditLog({
          userId: ctx.userId, userRole: ctx.userRole,
          action: 'NOTIFICATIONS_BULK_DELETED',
          targetType: 'notification',
          // No single targetId — the destroyed rows are enumerated in beforeValue.
          beforeValue: {
            recordCount: doomed.length,
            records: doomed.map((n: any) => ({
              id: n.id, type: n.type, title: n.title,
              forUserId: n.forUserId, forRole: n.forRole, createdAt: n.createdAt,
            })),
          },
          signatureMeaning: `${doomed.length} notification(s) permanently deleted`,
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
        }, tx);
      }
      return notificationRepository.bulkDelete(ids, userRole, username, visibleGated, tx);
    });

    return { success: true, count: result.count };
  },

  async delete(id: string, ctx: RequestContext) {
    const userRole = ctx.userRole;
    const username = ctx.userId;
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username, await gatedTypesVisibleTo(userRole));

    await prisma.$transaction(async (tx) => {
      await auditLog({
        userId: ctx.userId, userRole: ctx.userRole,
        action: 'NOTIFICATION_DELETED',
        targetType: 'notification', targetId: id,
        beforeValue: {
          type: notification.type, title: notification.title, message: notification.message,
          forUserId: notification.forUserId, forRole: notification.forRole,
          isRead: notification.isRead, createdAt: notification.createdAt,
        },
        signatureMeaning: `Notification "${notification.title}" permanently deleted`,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
      }, tx);
      await notificationRepository.delete(id, tx);
    });

    return { success: true };
  },
};

// Throws a 403-like error if the notification doesn't belong to the caller (unless ADMIN/SUPER_ADMIN).
// Mirrors buildVisibilityFilter's rules so list-visibility == single-op access.
function assertNotificationVisible(notif: any, userRole: string, username: string, visibleGated: string[]): void {
  // Same rule as the list and the bulk ops (./visibility.ts). M30: this used to
  // also admit `targetUserId === username`, which the list never did.
  if (!isVisible(notif, userRole, username, visibleGated)) throw new NotFoundError('Notification not found');
}

// Exported for use by other modules (auth.service.ts, user.service.ts)
//
// A-15 (2026-10-21): `type` is Prisma's generated NotificationType, so a value
// missing from `enum NotificationType` fails tsc at the call site. It used to be
// a hand-written union that could drift from the schema — QA-D005: three
// BLOCK_CHANGE_* types were not in the enum for five months, and every one of
// those inserts failed Postgres's enum check and was lost.
export async function createNotification(data: {
  type: NotificationType;
  title: string;
  message: string;
  targetUserId?: string;
  forUserId?: string;
  forRole?: string;
  metadata?: Record<string, unknown>;
  createdBy?: string;
}) {
  return notificationRepository.create(data);
}
