import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

const notificationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  isRead: z.enum(['true', 'false']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  period: z.enum(['today', 'week', 'month', 'quarter', 'year', 'all']).optional(),
});

export default async function notificationRoutes(app: FastifyInstance) {
  // GET /api/notifications — list notifications for current user
  app.get('/', {
    schema: {
      tags: ['Notifications'],
      summary: 'List notifications',
      description: 'Retrieve paginated notifications for the current user. SUPER_ADMIN sees all, ADMIN sees non-SUPER_ADMIN notifications, others see only their own.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1, description: 'Page number' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Records per page' },
          isRead: { type: 'string', enum: ['true', 'false'], description: 'Filter by read status' },
          startDate: { type: 'string', description: 'Start date for custom range (ISO 8601)' },
          endDate: { type: 'string', description: 'End date for custom range (ISO 8601)' },
          period: { type: 'string', enum: ['today', 'week', 'month', 'quarter', 'year', 'all'], description: 'Predefined date period filter' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string' },
                  title: { type: 'string' },
                  message: { type: 'string' },
                  isRead: { type: 'boolean' },
                  readAt: { type: 'string', format: 'date-time' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            total: { type: 'integer' },
            unreadCount: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const query = notificationQuerySchema.parse(req.query);
    const userRole = req.user.role;
    const username = req.user.username;

    // Build where clause based on user role
    const where: Record<string, unknown> = {};

    // SUPER_ADMIN sees all notifications
    // ADMIN sees all notifications except those specifically for SUPER_ADMIN
    // Other users see only their own notifications
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

    // Date filtering
    if (query.period && query.period !== 'all') {
      const now = new Date();
      let startDate: Date;

      switch (query.period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'quarter':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = new Date(0);
      }

      where.createdAt = { gte: startDate };
    } else if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) (where.createdAt as Record<string, unknown>).gte = new Date(query.startDate);
      if (query.endDate) (where.createdAt as Record<string, unknown>).lte = new Date(query.endDate);
    }

    if (query.isRead !== undefined) {
      where.isRead = query.isRead === 'true';
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.notification.count({ where: where as any }),
      prisma.notification.count({
        where: {
          ...where,
          isRead: false,
        } as any,
      }),
    ]);

    return {
      data: notifications,
      total,
      unreadCount,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  });

  // GET /api/notifications/unread-count — quick count for badge
  app.get('/unread-count', {
    schema: {
      tags: ['Notifications'],
      summary: 'Get unread notification count',
      description: 'Return the count of unread notifications for the current user. Used for notification badge display.',
      response: {
        200: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const userRole = req.user.role;
    const username = req.user.username;

    const where: Record<string, unknown> = { isRead: false };

    if (userRole === 'SUPER_ADMIN') {
      // Super admin sees everything
    } else if (userRole === 'ADMIN') {
      where.OR = [
        { forUserId: username },
        { forRole: 'ADMIN' },
        { forRole: null, forUserId: null },
      ];
      where.NOT = { forRole: 'SUPER_ADMIN' };
    } else {
      where.forUserId = username;
    }

    const count = await prisma.notification.count({ where: where as any });
    return { count };
  });

  // PUT /api/notifications/:id/read — mark as read
  app.put('/:id/read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark notification as read',
      description: 'Mark a single notification as read by its ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Notification ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });

    return { success: true };
  });

  // PUT /api/notifications/mark-all-read — mark all as read
  app.put('/mark-all-read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark all notifications as read',
      description: 'Mark all visible notifications as read for the current user based on their role.',
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
      },
    },
  }, async (req) => {
    const userRole = req.user.role;
    const username = req.user.username;

    const where: Record<string, unknown> = { isRead: false };

    if (userRole === 'SUPER_ADMIN') {
      // Mark all as read
    } else if (userRole === 'ADMIN') {
      where.OR = [
        { forUserId: username },
        { forRole: 'ADMIN' },
        { forRole: null, forUserId: null },
      ];
      where.NOT = { forRole: 'SUPER_ADMIN' };
    } else {
      where.forUserId = username;
    }

    await prisma.notification.updateMany({
      where: where as any,
      data: { isRead: true, readAt: new Date() },
    });

    return { success: true };
  });

  // PUT /api/notifications/:id/unread — mark as unread
  app.put('/:id/unread', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark notification as unread',
      description: 'Mark a single notification as unread by its ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Notification ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: false, readAt: null },
    });

    return { success: true };
  });

  // PUT /api/notifications/bulk-read — mark multiple as read
  app.put('/bulk-read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark selected notifications as read',
      description: 'Mark multiple notifications as read by their IDs.',
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const { ids } = req.body as { ids: string[] };

    const result = await prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: { isRead: true, readAt: new Date() },
    });

    return { success: true, count: result.count };
  });

  // PUT /api/notifications/bulk-unread — mark multiple as unread
  app.put('/bulk-unread', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark selected notifications as unread',
      description: 'Mark multiple notifications as unread by their IDs.',
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const { ids } = req.body as { ids: string[] };

    const result = await prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: { isRead: false, readAt: null },
    });

    return { success: true, count: result.count };
  });

  // POST /api/notifications/bulk-delete — delete multiple (SUPER_ADMIN only)
  app.post('/bulk-delete', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Notifications'],
      summary: 'Delete selected notifications (SUPER_ADMIN)',
      description: 'Permanently delete multiple notifications by their IDs. SUPER_ADMIN only.',
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const { ids } = req.body as { ids: string[] };

    const result = await prisma.notification.deleteMany({
      where: { id: { in: ids } },
    });

    return { success: true, count: result.count };
  });

  // DELETE /api/notifications/:id — delete notification
  app.delete('/:id', {
    schema: {
      tags: ['Notifications'],
      summary: 'Delete a notification',
      description: 'Permanently delete a notification by its ID.',
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Notification ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const notification = await prisma.notification.findUnique({ where: { id } });
    if (!notification) {
      return reply.code(404).send({ error: 'Notification not found' });
    }

    await prisma.notification.delete({ where: { id } });
    return { success: true };
  });
}

// Helper function to create notifications - exported for use by other modules
export async function createNotification(data: {
  type: 'ACCOUNT_LOCKED' | 'ACCOUNT_DISABLED' | 'ACCOUNT_ENABLED' | 'PASSWORD_RESET_REQUEST' | 'PASSWORD_RESET_APPROVED' | 'PASSWORD_RESET_REJECTED' | 'USER_CREATED' | 'USER_UPDATED' | 'ROLE_CHANGED';
  title: string;
  message: string;
  targetUserId?: string;
  forUserId?: string;
  forRole?: 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'MAINTENANCE' | 'OPERATOR' | 'VIEWER';
  metadata?: Record<string, unknown>;
  createdBy?: string;
}) {
  return prisma.notification.create({
    data: {
      type: data.type,
      title: data.title,
      message: data.message,
      targetUserId: data.targetUserId,
      forUserId: data.forUserId,
      forRole: data.forRole,
      metadata: data.metadata as Parameters<typeof prisma.notification.create>[0]['data']['metadata'],
      createdBy: data.createdBy,
    },
  });
}
