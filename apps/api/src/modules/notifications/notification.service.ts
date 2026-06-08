import { NotFoundError } from '../../lib/errors.js';
import { notificationRepository } from './notification.repository.js';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

const QNN_TYPE = 'PM_SCHEDULE_QNN';

// Which roles may see QNN (Quality Notification) entries — driven by the
// 'qnn-notifications' config (multiselect of roles). Super Admin always sees them.
async function getQnnVisibleRoles(): Promise<string[]> {
  try {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'qnn-notifications' } });
    const v = row?.configValue as { visibleRoles?: unknown } | undefined;
    return Array.isArray(v?.visibleRoles) ? (v!.visibleRoles as string[]) : ['ADMIN'];
  } catch {
    return ['ADMIN'];
  }
}

const canSeeQnn = (userRole: string, qnnRoles: string[]) =>
  userRole === 'SUPER_ADMIN' || qnnRoles.includes(userRole);

// Visibility that also enforces QNN config: non-QNN notifications use the normal
// per-role rules; QNN notifications are shown only to roles allowed by config.
function qnnAwareWhere(userRole: string, username: string, qnnRoles: string[]): Record<string, unknown> {
  const normal = buildVisibilityFilter(userRole, username);
  const branches: Record<string, unknown>[] = [
    { AND: [{ type: { not: QNN_TYPE } }, normal] },
  ];
  if (canSeeQnn(userRole, qnnRoles)) branches.push({ type: QNN_TYPE });
  return { OR: branches };
}

const notificationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).optional(),
  isRead: z.enum(['true', 'false']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  period: z.enum(['today', 'week', 'month', 'quarter', 'year', 'all']).optional(),
});

function buildVisibilityFilter(userRole: string, username: string): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (userRole === 'SUPER_ADMIN') {
    // Super admin sees everything
  } else if (userRole === 'ADMIN') {
    // Admin sees: notifications for ADMIN role, or for the specific user, or general (no forUserId/forRole)
    where.OR = [
      { forUserId: username },
      { forRole: 'ADMIN' },
      { forRole: null, forUserId: null },
    ];
    // But not notifications specifically for SUPER_ADMIN
    where.NOT = { forRole: 'SUPER_ADMIN' };
  } else {
    // Regular users see only their own notifications
    where.forUserId = username;
  }

  return where;
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
    if (startDate) (where.createdAt as Record<string, unknown>).gte = new Date(startDate);
    if (endDate) (where.createdAt as Record<string, unknown>).lte = new Date(endDate);
  }
}

export const notificationService = {
  async list(query: unknown, userRole: string, username: string) {
    const parsed = notificationQuerySchema.parse(query);
    const where = qnnAwareWhere(userRole, username, await getQnnVisibleRoles());

    // Apply date filtering
    applyDateFilter(where, parsed.period, parsed.startDate, parsed.endDate);

    // Apply isRead filter
    if (parsed.isRead !== undefined) {
      where.isRead = parsed.isRead === 'true';
    }

    const [data, total, unreadCount] = await Promise.all([
      notificationRepository.findMany(where, parsed.limit ? (parsed.page - 1) * parsed.limit : 0, parsed.limit),
      notificationRepository.count(where),
      notificationRepository.count({ ...where, isRead: false }),
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
    const where = qnnAwareWhere(userRole, username, await getQnnVisibleRoles());
    where.isRead = false;
    return { count: await notificationRepository.count(where) };
  },

  async markRead(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username, canSeeQnn(userRole, await getQnnVisibleRoles()));
    await notificationRepository.markRead(id);
    return { success: true };
  },

  async markUnread(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username, canSeeQnn(userRole, await getQnnVisibleRoles()));
    await notificationRepository.markUnread(id);
    return { success: true };
  },

  async markAllRead(userRole: string, username: string) {
    const where = qnnAwareWhere(userRole, username, await getQnnVisibleRoles());
    where.isRead = false;
    await notificationRepository.markAllRead(where);
    return { success: true };
  },

  async bulkRead(ids: string[], userRole: string, username: string) {
    const result = await notificationRepository.bulkMarkRead(ids, userRole, username, canSeeQnn(userRole, await getQnnVisibleRoles()));
    return { success: true, count: result.count };
  },

  async bulkUnread(ids: string[], userRole: string, username: string) {
    const result = await notificationRepository.bulkMarkUnread(ids, userRole, username, canSeeQnn(userRole, await getQnnVisibleRoles()));
    return { success: true, count: result.count };
  },

  async bulkDelete(ids: string[], userRole: string, username: string) {
    const result = await notificationRepository.bulkDelete(ids, userRole, username, canSeeQnn(userRole, await getQnnVisibleRoles()));
    return { success: true, count: result.count };
  },

  async delete(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username, canSeeQnn(userRole, await getQnnVisibleRoles()));
    await notificationRepository.delete(id);
    return { success: true };
  },
};

// Throws a 403-like error if the notification doesn't belong to the caller (unless ADMIN/SUPER_ADMIN).
// Mirrors buildVisibilityFilter's rules so list-visibility == single-op access.
function assertNotificationVisible(notif: any, userRole: string, username: string, qnnAllowed: boolean): void {
  // QNN notifications follow the config-driven role list, not per-user addressing.
  if (notif.type === QNN_TYPE) {
    if (qnnAllowed) return;
    throw new NotFoundError('Notification not found');
  }
  if (userRole === 'SUPER_ADMIN') return;
  if (userRole === 'ADMIN') {
    if (notif.forRole === 'SUPER_ADMIN') throw new NotFoundError('Notification not found');
    return;
  }
  const isForUser = notif.forUserId === username || notif.targetUserId === username;
  if (!isForUser) throw new NotFoundError('Notification not found');
}

// Exported for use by other modules (auth.service.ts, user.service.ts)
export async function createNotification(data: {
  type: 'ACCOUNT_LOCKED' | 'ACCOUNT_DISABLED' | 'ACCOUNT_ENABLED' | 'PASSWORD_RESET_REQUEST' | 'PASSWORD_RESET_APPROVED' | 'PASSWORD_RESET_REJECTED' | 'USER_CREATED' | 'USER_UPDATED' | 'ROLE_CHANGED' | 'BLOCK_CHANGE_REQUESTED' | 'BLOCK_CHANGE_APPROVED' | 'BLOCK_CHANGE_REJECTED' | 'PM_OVERDUE' | 'PM_OVERDUE_COMPLETED' | 'PM_SCHEDULE_QNN';
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
