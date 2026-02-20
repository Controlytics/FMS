import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema, userQuerySchema, bulkDeleteUsersSchema } from '@digilog/shared';
import { createNotification } from '../notifications/routes.js';
import { validateUserId } from '../../lib/user-id-validator.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';

async function getPasswordExpiresAt(): Promise<Date | null> {
  const config = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
  const policy = config?.configValue as { passwordExpiryDays?: number } | null;
  const days = policy?.passwordExpiryDays ?? 90;
  if (days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export default async function userRoutes(app: FastifyInstance) {
  // POST /api/users — Create user
  app.post('/', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Create user',
      description: 'Create a new user. Requires SUPER_ADMIN or ADMIN role.',
      body: {
        type: 'object',
        required: ['username', 'fullName', 'email', 'role', 'password', 'confirmPassword'],
        properties: {
          username: { type: 'string', description: 'Must match User ID config' },
          fullName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          department: { type: 'string' },
          role: { type: 'string', description: 'Role name (dynamic, from roles management)' },
          password: { type: 'string', minLength: 8 },
          confirmPassword: { type: 'string' },
          status: { type: 'string', enum: ['ENABLED', 'DISABLED'] },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string' },
            department: { type: 'string', nullable: true },
            role: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_USER', req, reply);
    if (!ok) return;

    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { username, fullName, email, department, role, password, status } = parsed.data;

    // Validate User ID against configuration
    const userIdValidation = await validateUserId(username);
    if (!userIdValidation.valid) {
      return reply.code(400).send({
        error: 'USERID_POLICY_VIOLATION',
        message: userIdValidation.errors.join('. '),
        errors: userIdValidation.errors
      });
    }

    // Check role creation permissions dynamically from DB
    const creatorRole = await prisma.role.findUnique({ where: { name: req.user.role } });
    if (!creatorRole) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Your role is not recognized' });
    }
    const targetRole = await prisma.role.findUnique({ where: { name: role } });
    if (!targetRole || !targetRole.isActive) {
      return reply.code(400).send({ error: 'INVALID_ROLE', message: `Role ${role} does not exist or is inactive` });
    }
    if (targetRole.hierarchyLevel > creatorRole.hierarchyLevel) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: `Cannot create users with role ${role}` });
    }

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existing) {
      const field = existing.username === username ? 'username' : 'email';
      return reply.code(409).send({ error: 'CONFLICT', message: `${field} already exists` });
    }

    const passwordHash = await hashPassword(password);
    const passwordExpiresAt = await getPasswordExpiresAt();

    const user = await prisma.user.create({
      data: {
        username,
        fullName,
        email,
        department,
        role: role as any,
        passwordHash,
        status: (status ?? 'ENABLED') as any,
        forcePasswordChange: true,
        isTemporaryPassword: true,
        passwordExpiresAt,
        createdBy: req.user.username,
      },
    });

    // Add to password history
    await prisma.passwordHistory.create({
      data: { userId: user.id, passwordHash },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'USER_CREATED',
      targetType: 'user',
      targetId: user.id,
      afterValue: { username, fullName, email, role, status },
      signatureMeaning: 'New user account created by administrator',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    // Create notification for admins about new user
    await createNotification({
      type: 'USER_CREATED',
      title: 'New User Created',
      message: `User ${fullName} (${username}) has been created with role ${role}.`,
      targetUserId: username,
      forRole: 'ADMIN',
      metadata: { userId: user.id, role },
      createdBy: req.user.username,
    });

    return reply.code(201).send({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      department: user.department,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    });
  });

  // GET /api/users/stats — User count stats by status
  app.get('/stats', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Get user statistics',
      description: 'Returns user counts grouped by status. SUPER_ADMIN sees all users, ADMIN sees all except SUPER_ADMIN.',
      response: {
        200: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            enabled: { type: 'integer' },
            disabled: { type: 'integer' },
            locked: { type: 'integer' },
            expired: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    // ADMIN users should not see SUPER_ADMIN counts
    const roleFilter = req.user.role === 'ADMIN' ? { role: { not: 'SUPER_ADMIN' as any } } : {};

    const [total, enabled, disabled, locked, expired] = await Promise.all([
      prisma.user.count({ where: { ...roleFilter } }),
      prisma.user.count({ where: { status: 'ENABLED' as any, ...roleFilter } }),
      prisma.user.count({ where: { status: 'DISABLED' as any, ...roleFilter } }),
      prisma.user.count({ where: { status: 'LOCKED' as any, ...roleFilter } }),
      prisma.user.count({ where: { status: 'EXPIRED' as any, ...roleFilter } }),
    ]);

    return { total, enabled, disabled, locked, expired };
  });

  // GET /api/users — List users
  app.get('/', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'List users',
      description: 'Paginated user list with search and filters. Requires SUPER_ADMIN or ADMIN role.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
          role: { type: 'string' },
          status: { type: 'string', enum: ['ENABLED', 'DISABLED', 'LOCKED', 'EXPIRED'] },
          search: { type: 'string', description: 'Search by username, name, or email' },
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
                  username: { type: 'string' },
                  fullName: { type: 'string' },
                  email: { type: 'string' },
                  department: { type: 'string', nullable: true },
                  role: { type: 'string' },
                  status: { type: 'string' },
                  lastLogin: { type: 'string', format: 'date-time', nullable: true },
                  createdAt: { type: 'string', format: 'date-time' },
                  createdBy: { type: 'string', nullable: true },
                },
              },
            },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const query = userQuerySchema.parse(req.query);
    const where: Record<string, unknown> = {};

    if (query.role) where.role = query.role;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: where as any,
        select: {
          id: true, username: true, fullName: true, email: true, department: true,
          role: true, status: true, lastLogin: true, createdAt: true, createdBy: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.user.count({ where: where as any }),
    ]);

    return { data: users, total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) };
  });

  // GET /api/users/:id — Get user detail
  app.get('/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Get user by ID',
      description: 'Get full user details',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string' },
            department: { type: 'string', nullable: true },
            role: { type: 'string' },
            status: { type: 'string' },
            failedLoginAttempts: { type: 'integer' },
            forcePasswordChange: { type: 'boolean' },
            isTemporaryPassword: { type: 'boolean' },
            lastLogin: { type: 'string', format: 'date-time', nullable: true },
            passwordChangedAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            createdBy: { type: 'string', nullable: true },
            updatedBy: { type: 'string', nullable: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, username: true, fullName: true, email: true, department: true,
        role: true, status: true, failedLoginAttempts: true, forcePasswordChange: true,
        isTemporaryPassword: true, lastLogin: true, passwordChangedAt: true,
        createdAt: true, updatedAt: true, createdBy: true, updatedBy: true,
      },
    });
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return user;
  });

  // PUT /api/users/:id — Update user
  app.put('/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Update user',
      description: 'Update user properties and role',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          fullName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          department: { type: 'string' },
          role: { type: 'string' },
          status: { type: 'string', enum: ['ENABLED', 'DISABLED'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
            status: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_USER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Check role update permissions dynamically from DB
    if (parsed.data.role) {
      const creatorRole = await prisma.role.findUnique({ where: { name: req.user.role } });
      const targetRole = await prisma.role.findUnique({ where: { name: parsed.data.role } });
      if (!creatorRole || !targetRole || !targetRole.isActive || targetRole.hierarchyLevel > creatorRole.hierarchyLevel) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: `Cannot assign role ${parsed.data.role}` });
      }
    }

    // Check email uniqueness if changed
    if (parsed.data.email && parsed.data.email !== existing.email) {
      const dup = await prisma.user.findUnique({ where: { email: parsed.data.email } });
      if (dup) return reply.code(409).send({ error: 'CONFLICT', message: 'Email already exists' });
    }

    const beforeValue = { fullName: existing.fullName, email: existing.email, department: existing.department, role: existing.role, status: existing.status };

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...parsed.data,
        role: parsed.data.role as any,
        status: parsed.data.status as any,
        updatedBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'USER_UPDATED',
      targetType: 'user',
      targetId: id,
      beforeValue,
      afterValue: { ...parsed.data, username: user.username, fullName: user.fullName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, status: user.status };
  });

  // DELETE /api/users/:id — Only SUPER_ADMIN can permanently delete users
  app.delete('/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Delete user',
      description: 'Permanently delete a user and all related data. SUPER_ADMIN only.',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_USER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Don't allow deleting yourself
    if (id === req.user.sub) {
      return reply.code(400).send({ error: 'Cannot delete your own account' });
    }

    // Log audit BEFORE deleting (so we capture the user info)
    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'USER_DELETED',
      targetType: 'user',
      targetId: id,
      beforeValue: { username: existing.username, fullName: existing.fullName, email: existing.email, role: existing.role, status: existing.status },
      afterValue: { deleted: true },
      signatureMeaning: 'User account permanently deleted by administrator',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    // Delete user_configs (no FK cascade, uses UUID)
    await prisma.userConfig.deleteMany({ where: { userId: id } });

    // Delete the user — PasswordHistory and Session cascade automatically
    await prisma.user.delete({ where: { id } });

    return { success: true };
  });

  // POST /api/users/bulk-delete — Bulk permanently delete users (SUPER_ADMIN only)
  app.post('/bulk-delete', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Bulk delete users',
      description: 'Permanently delete multiple users and all related data. SUPER_ADMIN only.',
      body: {
        type: 'object',
        required: ['userIds'],
        properties: {
          userIds: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
            maxItems: 50,
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            deletedCount: { type: 'integer' },
            deletedUsers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  username: { type: 'string' },
                },
              },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('BULK_DELETE_USERS', req, reply);
    if (!ok) return;

    const parsed = bulkDeleteUsersSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { userIds } = parsed.data;

    if (userIds.includes(req.user.sub)) {
      return reply.code(400).send({ error: 'CANNOT_DELETE_SELF', message: 'Cannot delete your own account' });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, fullName: true, role: true, status: true },
    });

    if (users.length === 0) {
      return reply.code(404).send({ error: 'NO_USERS_FOUND', message: 'No users found with the provided IDs' });
    }

    const superAdmins = users.filter(u => u.role === 'SUPER_ADMIN');
    if (superAdmins.length > 0) {
      return reply.code(403).send({
        error: 'CANNOT_DELETE_SUPER_ADMIN',
        message: `Cannot delete SUPER_ADMIN users: ${superAdmins.map(u => u.username).join(', ')}`,
      });
    }

    const validIds = users.map(u => u.id);

    // Log audit BEFORE deleting
    for (const user of users) {
      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'BULK_USER_DELETED',
        targetType: 'user',
        targetId: user.id,
        beforeValue: { username: user.username, fullName: user.fullName, role: user.role, status: user.status },
        afterValue: { deleted: true },
        signatureMeaning: 'User account permanently deleted via bulk delete by administrator',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });
    }

    // Delete user_configs (no FK cascade)
    await prisma.userConfig.deleteMany({ where: { userId: { in: validIds } } });

    // Delete users — PasswordHistory and Session cascade automatically
    await prisma.user.deleteMany({ where: { id: { in: validIds } } });

    return { success: true, deletedCount: validIds.length, deletedUsers: users.map(u => ({ id: u.id, username: u.username })) };
  });

  // POST /api/users/:id/enable
  app.post('/:id/enable', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Enable user',
      description: 'Re-enable a disabled user account',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('ENABLE_USER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    await prisma.user.update({
      where: { id },
      data: { status: 'ENABLED', updatedBy: req.user.username },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'USER_ENABLED',
      targetType: 'user', targetId: id, beforeValue: { username: user.username, fullName: user.fullName, status: user.status }, afterValue: { username: user.username, status: 'ENABLED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    // Notification for admins and the user
    await createNotification({
      type: 'ACCOUNT_ENABLED',
      title: 'Account Enabled',
      message: `User ${user.fullName} (${user.username}) has been enabled.`,
      targetUserId: user.username,
      forRole: 'ADMIN',
      createdBy: req.user.username,
    });
    // Also notify the user themselves
    await createNotification({
      type: 'ACCOUNT_ENABLED',
      title: 'Your Account Has Been Enabled',
      message: `Your account has been enabled by ${req.user.username}. You can now log in.`,
      targetUserId: user.username,
      forUserId: user.username,
      createdBy: req.user.username,
    });

    return { success: true };
  });

  // POST /api/users/:id/disable
  app.post('/:id/disable', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Disable user',
      description: 'Disable a user account and terminate all active sessions',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DISABLE_USER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    await prisma.user.update({
      where: { id },
      data: { status: 'DISABLED', updatedBy: req.user.username },
    });

    // Kill sessions
    await prisma.session.updateMany({
      where: { userId: id, isActive: true },
      data: { isActive: false, terminationReason: 'account_disabled' },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'USER_DISABLED',
      targetType: 'user', targetId: id, beforeValue: { username: user.username, fullName: user.fullName, status: user.status }, afterValue: { username: user.username, status: 'DISABLED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    // Notification for admins
    await createNotification({
      type: 'ACCOUNT_DISABLED',
      title: 'Account Disabled',
      message: `User ${user.fullName} (${user.username}) has been disabled.`,
      targetUserId: user.username,
      forRole: 'ADMIN',
      createdBy: req.user.username,
    });
    // Also notify the user themselves
    await createNotification({
      type: 'ACCOUNT_DISABLED',
      title: 'Your Account Has Been Disabled',
      message: `Your account has been disabled. Please contact an administrator.`,
      targetUserId: user.username,
      forUserId: user.username,
      createdBy: req.user.username,
    });

    return { success: true };
  });

  // POST /api/users/:id/unlock
  app.post('/:id/unlock', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Unlock user',
      description: 'Unlock a locked user account with a temporary password. User must change password on next login.',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: { newPassword: { type: 'string', minLength: 8 } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UNLOCK_USER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const { newPassword } = req.body as { newPassword: string };
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const newHash = await hashPassword(newPassword);
    const passwordExpiresAt = await getPasswordExpiresAt();

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          status: 'ENABLED',
          failedLoginAttempts: 0,
          lockedAt: null,
          lockoutUntil: null,
          passwordHash: newHash,
          forcePasswordChange: true,
          isTemporaryPassword: true,
          passwordExpiresAt,
          updatedBy: req.user.username,
        },
      }),
      prisma.passwordHistory.create({
        data: { userId: id, passwordHash: newHash },
      }),
    ]);

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ACCOUNT_UNLOCKED',
      targetType: 'user', targetId: id,
      beforeValue: { username: user.username, fullName: user.fullName, status: user.status, failedLoginAttempts: user.failedLoginAttempts },
      afterValue: { username: user.username, fullName: user.fullName, status: 'ENABLED', failedLoginAttempts: 0, forcePasswordChange: true, isTemporaryPassword: true },
      signatureMeaning: 'User account unlocked by administrator with temporary password',
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true, message: 'Account unlocked with temporary password. User must change password on next login.' };
  });

  // POST /api/users/:id/reset-password
  app.post('/:id/reset-password', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Reset password',
      description: 'Admin-initiated password reset. Sets temporary password.',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: { newPassword: { type: 'string', minLength: 8 } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('RESET_PASSWORD', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const newHash = await hashPassword(parsed.data.newPassword);
    const passwordExpiresAt = await getPasswordExpiresAt();

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: {
          passwordHash: newHash,
          forcePasswordChange: true,
          isTemporaryPassword: true,
          failedLoginAttempts: 0,
          lockedAt: null,
          lockoutUntil: null,
          status: 'ENABLED',
          passwordExpiresAt,
          updatedBy: req.user.username,
        },
      }),
      prisma.passwordHistory.create({
        data: { userId: id, passwordHash: newHash },
      }),
    ]);

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'PASSWORD_RESET',
      targetType: 'user', targetId: id,
      beforeValue: { username: user.username, fullName: user.fullName, status: user.status },
      afterValue: { status: 'ENABLED', forcePasswordChange: true, isTemporaryPassword: true },
      signatureMeaning: 'Administrator reset user password',
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true, message: 'Password reset successfully. User must change on next login.' };
  });

  // GET /api/users/reset-requests — List password reset requests
  app.get('/reset-requests', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'List password reset requests',
      description: 'Get all password reset requests (pending and processed)',
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
                  userId: { type: 'string' },
                  status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
                  processedBy: { type: 'string', nullable: true },
                  notes: { type: 'string', nullable: true },
                  requestedAt: { type: 'string', format: 'date-time' },
                  processedAt: { type: 'string', format: 'date-time', nullable: true },
                  userFullName: { type: 'string' },
                  userEmail: { type: 'string' },
                  userDepartment: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    const requests = await prisma.passwordResetRequest.findMany({
      orderBy: { requestedAt: 'desc' },
    });

    // Batch-fetch all referenced users in a single query instead of N+1
    const userIds = [...new Set(requests.map(r => r.userId))];
    const users = userIds.length > 0
      ? await prisma.user.findMany({
          where: { username: { in: userIds } },
          select: { username: true, fullName: true, email: true, department: true },
        })
      : [];
    const userMap = new Map(users.map(u => [u.username, u]));

    const enrichedRequests = requests.map(request => {
      const user = userMap.get(request.userId);
      return {
        ...request,
        userFullName: user?.fullName ?? request.userId,
        userEmail: user?.email ?? '',
        userDepartment: user?.department ?? '',
      };
    });

    return { data: enrichedRequests };
  });

  // GET /api/users/reset-requests/pending — Get count of pending reset requests
  app.get('/reset-requests/pending', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Pending reset request count',
      description: 'Get count of pending password reset requests',
      response: {
        200: {
          type: 'object',
          properties: {
            count: { type: 'integer' },
          },
        },
      },
    },
  }, async () => {
    const count = await prisma.passwordResetRequest.count({
      where: { status: 'PENDING' },
    });
    return { count };
  });

  // POST /api/users/reset-requests/:id/process — Process a password reset request
  app.post('/reset-requests/:id/process', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Users'],
      summary: 'Process reset request',
      description: 'Approve or reject a password reset request',
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['approve', 'reject'] },
          newPassword: { type: 'string', description: 'Required when approving' },
          notes: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('PROCESS_RESET_REQUEST', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const body = req.body as { action: 'approve' | 'reject'; newPassword?: string; notes?: string };

    if (!body.action || !['approve', 'reject'].includes(body.action)) {
      return reply.code(400).send({ error: 'Invalid action. Must be "approve" or "reject".' });
    }

    const resetRequest = await prisma.passwordResetRequest.findUnique({ where: { id } });
    if (!resetRequest) {
      return reply.code(404).send({ error: 'Reset request not found' });
    }

    if (resetRequest.status !== 'PENDING') {
      return reply.code(400).send({ error: 'Reset request has already been processed' });
    }

    if (body.action === 'approve') {
      if (!body.newPassword || body.newPassword.length < 8) {
        return reply.code(400).send({ error: 'New password must be at least 8 characters' });
      }

      // Find the user
      const user = await prisma.user.findUnique({ where: { username: resetRequest.userId } });
      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      const newHash = await hashPassword(body.newPassword);
      const passwordExpiresAt = await getPasswordExpiresAt();

      await prisma.$transaction([
        prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash: newHash,
            forcePasswordChange: true,
            isTemporaryPassword: true,
            failedLoginAttempts: 0,
            lockedAt: null,
            lockoutUntil: null,
            status: 'ENABLED',
            passwordExpiresAt,
            updatedBy: req.user.username,
          },
        }),
        prisma.passwordHistory.create({
          data: { userId: user.id, passwordHash: newHash },
        }),
        prisma.passwordResetRequest.update({
          where: { id },
          data: {
            status: 'APPROVED',
            processedAt: new Date(),
            processedBy: req.user.username,
            notes: body.notes,
          },
        }),
      ]);

      await app.auditLog({
        userId: req.user.username, userRole: req.user.role, action: 'PASSWORD_RESET_REQUEST_APPROVED',
        targetType: 'user', targetId: user.id,
        afterValue: { requestId: id, username: resetRequest.userId },
        ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
      });

      // Notify admins about approved request
      await createNotification({
        type: 'PASSWORD_RESET_APPROVED',
        title: 'Password Reset Approved',
        message: `Password reset request for ${resetRequest.userId} has been approved.`,
        targetUserId: resetRequest.userId,
        forRole: 'ADMIN',
        createdBy: req.user.username,
      });
      // Notify the user that their request was approved
      await createNotification({
        type: 'PASSWORD_RESET_APPROVED',
        title: 'Password Reset Approved',
        message: `Your password reset request has been approved. Please login with your new temporary password.`,
        targetUserId: resetRequest.userId,
        forUserId: resetRequest.userId,
        createdBy: req.user.username,
      });

      return { success: true, message: 'Password reset approved and new password set.' };
    } else {
      // Reject
      await prisma.passwordResetRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          processedAt: new Date(),
          processedBy: req.user.username,
          notes: body.notes,
        },
      });

      await app.auditLog({
        userId: req.user.username, userRole: req.user.role, action: 'PASSWORD_RESET_REQUEST_REJECTED',
        targetType: 'password_reset_request', targetId: id,
        afterValue: { username: resetRequest.userId, notes: body.notes },
        ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
      });

      // Notify the user that their request was rejected
      await createNotification({
        type: 'PASSWORD_RESET_REJECTED',
        title: 'Password Reset Rejected',
        message: `Your password reset request has been rejected. Please contact an administrator.`,
        targetUserId: resetRequest.userId,
        forUserId: resetRequest.userId,
        createdBy: req.user.username,
      });

      return { success: true, message: 'Password reset request rejected.' };
    }
  });
}
