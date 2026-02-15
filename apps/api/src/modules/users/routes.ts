import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema, userQuerySchema, userParamsSchema, CREATABLE_ROLES, type Role } from '@digilog/shared';

export default async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/users — Create user
  app.post('/', {
    schema: { tags: ['Users'], summary: 'Create user', description: 'Create a new user account (ADMIN+). May require re-authentication.', body: createUserSchema },
    preHandler: [app.requirePermission('USER_CREATE'), app.requireReauth('user:create')],
  }, async (req, reply) => {
    const { username, fullName, email, department, role, password, status } = req.body;

    // Check role creation permissions
    const creatableRoles = CREATABLE_ROLES[req.user.role];
    if (!creatableRoles || !creatableRoles.includes(role as Role)) {
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
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
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

  // GET /api/users — List users
  app.get('/', {
    schema: { tags: ['Users'], summary: 'List users', description: 'List all users with pagination and filtering', querystring: userQuerySchema },
    preHandler: [app.requirePermission('USER_READ')],
  }, async (req) => {
    const where: Record<string, unknown> = {};

    if (req.query.role) where.role = req.query.role;
    if (req.query.status) where.status = req.query.status;
    if (req.query.search) {
      where.OR = [
        { username: { contains: req.query.search, mode: 'insensitive' } },
        { fullName: { contains: req.query.search, mode: 'insensitive' } },
        { email: { contains: req.query.search, mode: 'insensitive' } },
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
        skip: (req.query.page - 1) * req.query.limit,
        take: req.query.limit,
      }),
      prisma.user.count({ where: where as any }),
    ]);

    return { data: users, total, page: req.query.page, limit: req.query.limit, totalPages: total > 0 ? Math.ceil(total / req.query.limit) : 0 };
  });

  // GET /api/users/:id — Get user detail
  app.get('/:id', {
    schema: { tags: ['Users'], summary: 'Get user', description: 'Get user details by ID', params: userParamsSchema },
    preHandler: [app.requirePermission('USER_READ')],
  }, async (req, reply) => {
    const { id } = req.params;
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
    schema: { tags: ['Users'], summary: 'Update user', description: 'Update user details. May require re-authentication.', params: userParamsSchema, body: updateUserSchema },
    preHandler: [app.requirePermission('USER_UPDATE'), app.requireReauth('user:update')],
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Prevent users from changing their own role or status
    if (id === req.user.sub) {
      if (req.body.role && req.body.role !== existing.role) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Cannot change your own role' });
      }
      if (req.body.status && req.body.status !== existing.status) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Cannot change your own status' });
      }
    }

    // Check role update permissions
    if (req.body.role) {
      const creatableRoles = CREATABLE_ROLES[req.user.role];
      if (!creatableRoles || !creatableRoles.includes(req.body.role as Role)) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: `Cannot assign role ${req.body.role}` });
      }
    }

    // Check email uniqueness if changed
    if (req.body.email && req.body.email !== existing.email) {
      const dup = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (dup) return reply.code(409).send({ error: 'CONFLICT', message: 'Email already exists' });
    }

    const beforeValue = { fullName: existing.fullName, email: existing.email, department: existing.department, role: existing.role, status: existing.status };

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...req.body,
        role: req.body.role as any,
        status: req.body.status as any,
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
      afterValue: req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    // Emit dedicated ROLE_ASSIGNED audit when role changes
    if (req.body.role && req.body.role !== existing.role) {
      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'ROLE_ASSIGNED',
        targetType: 'user',
        targetId: id,
        beforeValue: { role: existing.role },
        afterValue: { role: req.body.role },
        reason: `Role changed from ${existing.role} to ${req.body.role}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });
    }

    return { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, status: user.status };
  });

  // DELETE /api/users/:id
  app.delete('/:id', {
    schema: { tags: ['Users'], summary: 'Delete user', description: 'Soft-delete (disable) a user. May require re-authentication.', params: userParamsSchema },
    preHandler: [app.requirePermission('USER_DELETE'), app.requireReauth('user:delete')],
  }, async (req, reply) => {
    const { id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Don't allow deleting yourself
    if (id === req.user.sub) {
      return reply.code(400).send({ error: 'Cannot delete your own account' });
    }

    await prisma.user.update({
      where: { id },
      data: { status: 'DISABLED' as any, updatedBy: req.user.username },
    });

    // Invalidate all sessions
    await prisma.session.updateMany({
      where: { userId: id, isActive: true },
      data: { isActive: false, terminationReason: 'user_deleted' },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'USER_DELETED',
      targetType: 'user',
      targetId: id,
      beforeValue: { username: existing.username, status: existing.status },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/users/:id/enable
  app.post('/:id/enable', {
    schema: { tags: ['Users'], summary: 'Enable user', description: 'Re-enable a disabled user account', params: userParamsSchema },
    preHandler: [app.requirePermission('USER_ENABLE_DISABLE'), app.requireReauth('user:enable')],
  }, async (req, reply) => {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    await prisma.user.update({
      where: { id },
      data: { status: 'ENABLED', updatedBy: req.user.username },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'USER_ENABLED',
      targetType: 'user', targetId: id, beforeValue: { status: user.status }, afterValue: { status: 'ENABLED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/users/:id/disable
  app.post('/:id/disable', {
    schema: { tags: ['Users'], summary: 'Disable user', description: 'Disable a user account and terminate sessions', params: userParamsSchema },
    preHandler: [app.requirePermission('USER_ENABLE_DISABLE'), app.requireReauth('user:disable')],
  }, async (req, reply) => {
    const { id } = req.params;
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
      targetType: 'user', targetId: id, beforeValue: { status: user.status }, afterValue: { status: 'DISABLED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/users/:id/unlock
  app.post('/:id/unlock', {
    schema: { tags: ['Users'], summary: 'Unlock user', description: 'Unlock a locked user account', params: userParamsSchema },
    preHandler: [app.requirePermission('USER_UNLOCK')],
  }, async (req, reply) => {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    await prisma.user.update({
      where: { id },
      data: { status: 'ENABLED', failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null, updatedBy: req.user.username },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ACCOUNT_UNLOCKED',
      targetType: 'user', targetId: id,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/users/:id/reset-password
  app.post('/:id/reset-password', {
    schema: { tags: ['Users'], summary: 'Reset password', description: 'Reset a user password (sets temp password). May require re-authentication.', params: userParamsSchema, body: resetPasswordSchema },
    preHandler: [app.requirePermission('USER_RESET_PASSWORD'), app.requireReauth('user:reset-password')],
  }, async (req, reply) => {
    const { id } = req.params;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const newHash = await hashPassword(req.body.newPassword);

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
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true, message: 'Password reset successfully. User must change on next login.' };
  });
}
