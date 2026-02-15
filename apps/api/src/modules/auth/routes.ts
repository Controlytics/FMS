import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword, dummyVerify } from '../../lib/password.js';
import { signToken, signVerificationToken } from '../../lib/jwt.js';
import { loginSchema, passwordChangeSchema, passwordPolicySchema, verifyBodySchema } from '@digilog/shared';
import { createHash } from 'node:crypto';

async function validatePasswordPolicy(password: string, username: string): Promise<string[]> {
  const errors: string[] = [];
  const config = await prisma.systemConfig.findUnique({ where: { configKey: 'password_policy' } });
  const policy = passwordPolicySchema.parse(config?.configValue ?? {});

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters`);
  }
  if (policy.requireUppercase) {
    const count = (password.match(/[A-Z]/g) || []).length;
    if (count < policy.minUppercase) {
      errors.push(`Password must contain at least ${policy.minUppercase} uppercase letter(s)`);
    }
  }
  if (policy.requireLowercase) {
    const count = (password.match(/[a-z]/g) || []).length;
    if (count < policy.minLowercase) {
      errors.push(`Password must contain at least ${policy.minLowercase} lowercase letter(s)`);
    }
  }
  if (policy.requireNumbers) {
    const count = (password.match(/[0-9]/g) || []).length;
    if (count < policy.minNumbers) {
      errors.push(`Password must contain at least ${policy.minNumbers} number(s)`);
    }
  }
  if (policy.requireSpecialChars) {
    const count = (password.match(/[^A-Za-z0-9]/g) || []).length;
    if (count < policy.minSpecialChars) {
      errors.push(`Password must contain at least ${policy.minSpecialChars} special character(s)`);
    }
  }
  if (policy.cannotBeUserId && password === username) {
    errors.push('Password cannot be same as User ID');
  }
  if (policy.cannotContainUserId && password.toLowerCase().includes(username.toLowerCase())) {
    errors.push('Password cannot contain User ID');
  }

  return errors;
}

export default async function authRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/auth/login
  app.post('/login', {
    schema: {
      tags: ['Auth'],
      summary: 'Login',
      description: 'Authenticate with username and password',
      security: [],
      body: loginSchema,
    },
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const { username, password } = req.body;

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Run dummy bcrypt to prevent timing-based user enumeration
      await dummyVerify(password);
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

    // Check password expiration
    if (user.passwordExpiresAt && user.passwordExpiresAt < new Date()) {
      await prisma.user.update({
        where: { id: user.id },
        data: { forcePasswordChange: true },
      });
      user.forcePasswordChange = true;
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

    const isSecure = process.env.NODE_ENV === 'production';
    reply.setCookie('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'strict',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours in seconds
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
  app.post('/logout', {
    schema: { tags: ['Auth'], summary: 'Logout', description: 'End current session' },
  }, async (req, reply) => {
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

    reply.clearCookie('token', { path: '/' });
    return { success: true };
  });

  // GET /api/auth/me
  app.get('/me', {
    schema: { tags: ['Auth'], summary: 'Get current user', description: 'Returns the authenticated user profile' },
  }, async (req) => {
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
  app.post('/change-password', {
    schema: {
      tags: ['Auth'],
      summary: 'Change password',
      description: 'Change current user password (validates full password policy)',
      body: passwordChangeSchema,
    },
  }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.code(400).send({ error: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
    }

    // Validate password against full policy
    const policyErrors = await validatePasswordPolicy(newPassword, user.username);
    if (policyErrors.length > 0) {
      return reply.code(400).send({ error: 'POLICY_VIOLATION', message: policyErrors[0], violations: policyErrors });
    }

    // Get password policy for reuse count
    const policyConfig = await prisma.systemConfig.findUnique({ where: { configKey: 'password_policy' } });
    const policy = (policyConfig?.configValue ?? {}) as Record<string, unknown>;

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
          passwordExpiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
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
  app.post('/verify', {
    schema: {
      tags: ['Auth'],
      summary: 'Re-authenticate',
      description: 'Verify password for sensitive operations. Returns a short-lived verification token.',
      body: verifyBodySchema,
    },
  }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const valid = await verifyPassword(req.body.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: 'INVALID_PASSWORD', message: 'Password is incorrect' });
    }

    const verificationToken = await signVerificationToken(user.id);
    return { success: true, verificationToken };
  });
}
