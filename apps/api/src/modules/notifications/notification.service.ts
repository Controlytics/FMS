import { NotFoundError } from '../../lib/errors.js';
import { notificationRepository } from './notification.repository.js';
import { z } from 'zod';

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
    const where = buildVisibilityFilter(userRole, username);

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
    const where = buildVisibilityFilter(userRole, username);
    where.isRead = false;
    return { count: await notificationRepository.count(where) };
  },

  async markRead(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username);
    await notificationRepository.markRead(id);
    return { success: true };
  },

  async markUnread(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username);
    await notificationRepository.markUnread(id);
    return { success: true };
  },

  async markAllRead(userRole: string, username: string) {
    const where = buildVisibilityFilter(userRole, username);
    where.isRead = false;
    await notificationRepository.markAllRead(where);
    return { success: true };
  },

  async bulkRead(ids: string[], username: string) {
    const result = await notificationRepository.bulkMarkRead(ids, username);
    return { success: true, count: result.count };
  },

  async bulkUnread(ids: string[], username: string) {
    const result = await notificationRepository.bulkMarkUnread(ids, username);
    return { success: true, count: result.count };
  },

  async bulkDelete(ids: string[], username: string) {
    const result = await notificationRepository.bulkDelete(ids, username);
    return { success: true, count: result.count };
  },

  async delete(id: string, userRole: string, username: string) {
    const notification = await notificationRepository.findById(id);
    if (!notification) throw new NotFoundError('Notification not found');
    assertNotificationVisible(notification, userRole, username);
    await notificationRepository.delete(id);
    return { success: true };
  },
};

// Throws a 403-like error if the notification doesn't belong to the caller (unless ADMIN/SUPER_ADMIN).
// Mirrors buildVisibilityFilter's rules so list-visibility == single-op access.
function assertNotificationVisible(notif: any, userRole: string, username: string): void {
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
  type: 'ACCOUNT_LOCKED' | 'ACCOUNT_DISABLED' | 'ACCOUNT_ENABLED' | 'PASSWORD_RESET_REQUEST' | 'PASSWORD_RESET_APPROVED' | 'PASSWORD_RESET_REJECTED' | 'USER_CREATED' | 'USER_UPDATED' | 'ROLE_CHANGED';
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
