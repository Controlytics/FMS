import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { signToken, signVerificationToken } from '../../lib/jwt.js';
import { loginSchema, passwordChangeSchema } from '@digilog/shared';
import { createHash } from 'node:crypto';

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post('/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { username, password } = parsed.data;

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Same message, no attemptsRemaining — prevents user enumeration
      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid user ID or password.',
      });
    }

    // Check account status
    if (user.status === 'LOCKED') {
      // Check auto-unlock for temporary lockout
      if (user.lockoutUntil && user.lockoutUntil < new Date()) {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'ENABLED', failedLoginAttempts: 0, lockoutUntil: null, lockedAt: null },
        });
      } else {
        return reply.code(403).send({
          error: 'ACCOUNT_LOCKED',
          message: 'Account locked due to multiple failed login attempts. Contact administrator.',
        });
      }
    }

    if (user.status === 'DISABLED') {
      return reply.code(403).send({
        error: 'ACCOUNT_DISABLED',
        message: 'Your account has been disabled. Contact administrator.',
      });
    }

    if (user.status === 'EXPIRED') {
      return reply.code(403).send({
        error: 'PASSWORD_EXPIRED',
        message: 'Your password has expired. Please change password to continue.',
      });
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      // Get login security config for lockout threshold
      const config = await prisma.systemConfig.findUnique({ where: { configKey: 'login_security' } });
      const loginSecurity = (config?.configValue as { maxFailedAttempts?: number; lockoutType?: string; lockoutDurationMinutes?: number }) ?? {
        maxFailedAttempts: 5,
        lockoutType: 'TEMPORARY',
        lockoutDurationMinutes: 30,
      };

      const newAttempts = user.failedLoginAttempts + 1;
      const maxAttempts = loginSecurity.maxFailedAttempts ?? 5;

      if (newAttempts >= maxAttempts) {
        const lockoutData: Record<string, unknown> = {
          failedLoginAttempts: newAttempts,
          status: 'LOCKED' as const,
          lockedAt: new Date(),
        };

        if (loginSecurity.lockoutType === 'TEMPORARY') {
          lockoutData.lockoutUntil = new Date(Date.now() + (loginSecurity.lockoutDurationMinutes ?? 30) * 60 * 1000);
        }

        await prisma.user.update({ where: { id: user.id }, data: lockoutData as any });

        await app.auditLog({
          userId: user.username,
          userName: user.fullName,
          userRole: user.role,
          action: 'ACCOUNT_LOCKED',
          targetType: 'user',
          targetId: user.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        return reply.code(403).send({
          error: 'ACCOUNT_LOCKED',
          message: 'Account locked due to multiple failed login attempts. Contact administrator.',
        });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: newAttempts, lastLogin: undefined },
      });

      await app.auditLog({
        userId: user.username,
        userName: user.fullName,
        userRole: user.role,
        action: 'LOGIN_FAILED',
        targetType: 'user',
        targetId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid user ID or password.',
        attemptsRemaining: maxAttempts - newAttempts,
      });
    }

    // Successful authentication — create session
    const sessionToken = createHash('sha256').update(crypto.randomUUID()).digest('hex');

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sessionToken,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
      },
    });

    const token = await signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
      sessionId: session.id,
    });

    // Reset failed attempts and update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lastLogin: new Date(), lockoutUntil: null },
    });

    await app.auditLog({
      userId: user.username,
      userName: user.fullName,
      userRole: user.role,
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: session.id,
    });

    return {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        forcePasswordChange: user.forcePasswordChange,
        isTemporaryPassword: user.isTemporaryPassword,
      },
      expiresIn: '8h',
    };
  });

  // POST /api/auth/logout
  app.post('/logout', async (req, reply) => {
    await prisma.session.update({
      where: { id: req.user.sessionId },
      data: { isActive: false, terminationReason: 'logout' },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'LOGOUT',
      targetType: 'session',
      targetId: req.user.sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // GET /api/auth/me
  app.get('/me', async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        department: true,
        role: true,
        status: true,
        forcePasswordChange: true,
        isTemporaryPassword: true,
        lastLogin: true,
        createdAt: true,
      },
    });

    return user;
  });

  // POST /api/auth/change-password
  app.post('/change-password', async (req, reply) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { currentPassword, newPassword } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.code(400).send({ error: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
    }

    // Get password policy
    const policyConfig = await prisma.systemConfig.findUnique({ where: { configKey: 'password_policy' } });
    const policy = (policyConfig?.configValue ?? {}) as Record<string, unknown>;

    // Validate: cannot be same as username
    if (policy.cannotBeUserId && newPassword === user.username) {
      return reply.code(400).send({ error: 'POLICY_VIOLATION', message: 'Password cannot be same as User ID' });
    }
    if (policy.cannotContainUserId && newPassword.toLowerCase().includes(user.username.toLowerCase())) {
      return reply.code(400).send({ error: 'POLICY_VIOLATION', message: 'Password cannot contain User ID' });
    }

    // Validate: cannot be same as temp password
    if (user.isTemporaryPassword) {
      const sameAsTemp = await verifyPassword(newPassword, user.passwordHash);
      if (sameAsTemp) {
        return reply.code(400).send({ error: 'POLICY_VIOLATION', message: 'New password cannot be same as temporary password' });
      }
    }

    // Check password history
    const reuseCount = (policy.preventReuseCount as number) ?? 12;
    const history = await prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: reuseCount,
    });

    for (const h of history) {
      const reused = await verifyPassword(newPassword, h.passwordHash);
      if (reused) {
        return reply.code(400).send({
          error: 'POLICY_VIOLATION',
          message: `Password cannot match any of your last ${reuseCount} passwords`,
        });
      }
    }

    // Hash and update
    const newHash = await hashPassword(newPassword);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          forcePasswordChange: false,
          isTemporaryPassword: false,
          passwordChangedAt: new Date(),
        },
      }),
      prisma.passwordHistory.create({
        data: { userId: user.id, passwordHash: newHash },
      }),
    ]);

    await app.auditLog({
      userId: user.username,
      userName: user.fullName,
      userRole: user.role,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, message: 'Password changed successfully' };
  });

  // POST /api/auth/verify (re-authentication for sensitive ops)
  app.post('/verify', async (req, reply) => {
    const body = req.body as { password?: string };
    if (!body.password) {
      return reply.code(400).send({ error: 'Password is required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'INVALID_PASSWORD', message: 'Password is incorrect' });
    }

    const verificationToken = await signVerificationToken(user.id);
    return { success: true, verificationToken };
  });
}
