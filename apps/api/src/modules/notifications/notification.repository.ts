import { prisma } from '../../lib/prisma.js';

export const notificationRepository = {
  async findMany(where: Record<string, unknown>, skip: number, take?: number) {
    return prisma.notification.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      ...(take ? { skip, take } : {}),
    });
  },

  async count(where: Record<string, unknown>) {
    return prisma.notification.count({ where: where as any });
  },

  async findById(id: string) {
    return prisma.notification.findUnique({ where: { id } });
  },

  async create(data: {
    type: string;
    title: string;
    message: string;
    targetUserId?: string;
    forUserId?: string;
    forRole?: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
  }) {
    return prisma.notification.create({
      data: {
        type: data.type as any,
        title: data.title,
        message: data.message,
        targetUserId: data.targetUserId,
        forUserId: data.forUserId,
        forRole: data.forRole,
        metadata: data.metadata as any,
        createdBy: data.createdBy,
      },
    });
  },

  async markRead(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  },

  async markUnread(id: string) {
    return prisma.notification.update({
      where: { id },
      data: { isRead: false, readAt: null },
    });
  },

  async markAllRead(where: Record<string, unknown>) {
    return prisma.notification.updateMany({
      where: where as any,
      data: { isRead: true, readAt: new Date() },
    });
  },

  async bulkMarkRead(ids: string[], username?: string) {
    const where: any = { id: { in: ids } };
    if (username) where.OR = [{ forUserId: username }, { targetUserId: username }];
    return prisma.notification.updateMany({
      where,
      data: { isRead: true, readAt: new Date() },
    });
  },

  async bulkMarkUnread(ids: string[], username?: string) {
    const where: any = { id: { in: ids } };
    if (username) where.OR = [{ forUserId: username }, { targetUserId: username }];
    return prisma.notification.updateMany({
      where,
      data: { isRead: false, readAt: null },
    });
  },

  async delete(id: string) {
    return prisma.notification.delete({ where: { id } });
  },

  async bulkDelete(ids: string[], username?: string) {
    const where: any = { id: { in: ids } };
    if (username) where.OR = [{ forUserId: username }, { targetUserId: username }];
    return prisma.notification.deleteMany({ where });
  },
};
