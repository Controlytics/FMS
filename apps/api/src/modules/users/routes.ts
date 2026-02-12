import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { createUserSchema, updateUserSchema, resetPasswordSchema, userQuerySchema, CREATABLE_ROLES, type Role } from '@digilog/shared';

export default async function userRoutes(app: FastifyInstance) {
  // POST /api/users — Create user
  app.post('/', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
  }, async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { username, fullName, email, department, role, password, status } = parsed.data;

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
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
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
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'User not found' });

    // Check role update permissions
    if (parsed.data.role) {
      const creatableRoles = CREATABLE_ROLES[req.user.role];
      if (!creatableRoles || !creatableRoles.includes(parsed.data.role as Role)) {
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
      afterValue: parsed.data,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { id: user.id, username: user.username, fullName: user.fullName, email: user.email, role: user.role, status: user.status };
  });

  // DELETE /api/users/:id
  app.delete('/:id', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
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
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
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
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
  }, async (req, reply) => {
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
      targetType: 'user', targetId: id, beforeValue: { status: user.status }, afterValue: { status: 'DISABLED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/users/:id/unlock
  app.post('/:id/unlock', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
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
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const newHash = await hashPassword(parsed.data.newPassword);

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
