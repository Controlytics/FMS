import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { signToken, signVerificationToken, verifyToken } from '../../lib/jwt.js';
import { loginSchema, passwordChangeSchema } from '@digilog/shared';
import { createHash } from 'node:crypto';
import { createNotification } from '../notifications/routes.js';
import { errorResponses } from '../../lib/error-schemas.js';

// Pre-hashed dummy value for constant-time user-not-found responses (cost 12, matching BCRYPT_ROUNDS)
const DUMMY_HASH = '$2b$12$7fXFzVUc/0SLHtxesM41PODN09mcQBJ0QB/uy7BQHDWzsklxK9yh6';

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req: any) => req.ip,
      },
    },
    schema: {
      tags: ['Auth'],
      summary: 'Login',
      description: 'Authenticate with username and password. Returns JWT token.',
      security: [],
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', example: 'admin' },
          password: { type: 'string', example: 'Admin@123' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                username: { type: 'string' },
                fullName: { type: 'string' },
                role: { type: 'string' },
                forcePasswordChange: { type: 'boolean' },
                isTemporaryPassword: { type: 'boolean' },
              },
            },
            expiresIn: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { username, password } = parsed.data;

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      // Perform dummy bcrypt compare to equalize timing with valid-user path
      await verifyPassword(password, DUMMY_HASH);
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
      // If admin has reset their password, allow login (they'll be forced to change)
      if (user.isTemporaryPassword && user.forcePasswordChange) {
        await prisma.user.update({
          where: { id: user.id },
          data: { status: 'ENABLED' },
        });
      } else {
        return reply.code(403).send({
          error: 'PASSWORD_EXPIRED',
          message: 'Your password has expired. Contact an administrator to reset your password.',
        });
      }
    }

    // Verify password
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      // Get login security settings
      const loginSecConfig = await prisma.systemConfig.findUnique({ where: { configKey: 'login-security' } });
      const loginSecurity = (loginSecConfig?.configValue as { maxFailedAttempts?: number; lockoutType?: string; lockoutDurationMinutes?: number }) ?? {};
      const maxAttempts = loginSecurity.maxFailedAttempts ?? 5;
      const lockoutType = loginSecurity.lockoutType ?? 'TEMPORARY';
      const lockoutDurationMinutes = loginSecurity.lockoutDurationMinutes ?? 30;

      const newAttempts = user.failedLoginAttempts + 1;

      if (newAttempts >= maxAttempts) {
        // Apply lockout based on configured type
        const lockoutData: Record<string, unknown> = {
          failedLoginAttempts: newAttempts,
          status: 'LOCKED' as const,
          lockedAt: new Date(),
        };
        if (lockoutType === 'TEMPORARY') {
          lockoutData.lockoutUntil = new Date(Date.now() + lockoutDurationMinutes * 60 * 1000);
        }
        await prisma.user.update({
          where: { id: user.id },
          data: lockoutData as any,
        });

        await app.auditLog({
          userId: user.username,
          userName: user.fullName,
          userRole: user.role,
          action: 'ACCOUNT_LOCKED',
          targetType: 'user',
          targetId: user.id,
          afterValue: { username: user.username, fullName: user.fullName },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });

        // Notify admins about locked account
        await createNotification({
          type: 'ACCOUNT_LOCKED',
          title: 'Account Locked',
          message: `User ${user.fullName} (${user.username}) has been locked due to multiple failed login attempts.`,
          targetUserId: user.username,
          forRole: 'ADMIN',
        });
        // Notify the user themselves
        await createNotification({
          type: 'ACCOUNT_LOCKED',
          title: 'Your Account Has Been Locked',
          message: `Your account has been locked due to multiple failed login attempts. Please contact an administrator.`,
          targetUserId: user.username,
          forUserId: user.username,
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
        afterValue: { username: user.username, fullName: user.fullName },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return reply.code(401).send({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid user ID or password.',
        attemptsRemaining: maxAttempts - newAttempts,
      });
    }

    // Check password expiry at login time
    if (user.passwordExpiresAt && user.passwordExpiresAt < new Date() && !user.forcePasswordChange) {
      await prisma.user.update({
        where: { id: user.id },
        data: { forcePasswordChange: true },
      });
      user.forcePasswordChange = true;

      await app.auditLog({
        userId: user.username,
        userName: user.fullName,
        userRole: user.role,
        action: 'PASSWORD_EXPIRED',
        targetType: 'user',
        targetId: user.id,
        afterValue: { username: user.username, fullName: user.fullName },
        signatureMeaning: 'System detected expired password at login',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    // Auto-terminate any existing active sessions for this user
    const existingSessions = await prisma.session.findMany({
      where: {
        userId: user.id,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (existingSessions.length > 0) {
      await prisma.session.updateMany({
        where: {
          userId: user.id,
          isActive: true,
        },
        data: {
          isActive: false,
          terminationReason: 'new_login',
        },
      });

      await app.auditLog({
        userId: user.username,
        userName: user.fullName,
        userRole: user.role,
        action: 'FORCED_LOGOUT',
        targetType: 'session',
        targetId: existingSessions.map(s => s.id).join(','),
        afterValue: { username: user.username, fullName: user.fullName },
        signatureMeaning: 'Previous sessions auto-terminated for new login',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    // Create new session — read duration from config
    const sessionConfig = await prisma.systemConfig.findUnique({ where: { configKey: 'session' } });
    const sessionDurationHours = (sessionConfig?.configValue as { sessionDurationHours?: number })?.sessionDurationHours ?? 8;
    const sessionToken = createHash('sha256').update(crypto.randomUUID()).digest('hex');

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sessionToken,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        expiresAt: new Date(Date.now() + sessionDurationHours * 60 * 60 * 1000),
      },
    });

    const token = await signToken({
      sub: user.id,
      username: user.username,
      role: user.role,
      sessionId: session.id,
    }, sessionDurationHours);

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
      afterValue: { username: user.username, fullName: user.fullName },
      signatureMeaning: 'User authenticated with username and password',
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
      expiresIn: `${sessionDurationHours}h`,
    };
  });

  // POST /api/auth/logout
  app.post('/logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Logout',
      description: 'Terminate the current session',
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
    },
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
      afterValue: { username: req.user.username },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // POST /api/auth/beacon-logout — unauthenticated, accepts token in body
  // Used by navigator.sendBeacon() on tab/browser close
  app.post('/beacon-logout', {
    schema: {
      tags: ['Auth'],
      summary: 'Beacon logout',
      description: 'Terminate session via sendBeacon on tab/browser close. Token sent in body since sendBeacon cannot set Authorization headers.',
      security: [],
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { token } = req.body as { token: string };
    if (!token) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Token is required' });
    }

    try {
      const payload = await verifyToken(token);
      const session = await prisma.session.findFirst({
        where: { id: payload.sessionId, isActive: true },
      });

      if (session) {
        await prisma.session.update({
          where: { id: session.id },
          data: { isActive: false, terminationReason: 'tab_closed' },
        });

        await app.auditLog({
          userId: payload.username,
          userRole: payload.role,
          action: 'LOGOUT',
          targetType: 'session',
          targetId: payload.sessionId,
          afterValue: { username: payload.username, reason: 'tab_closed' },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          sessionId: payload.sessionId,
        });
      }

      return { success: true };
    } catch {
      // Token invalid/expired — session is already dead
      return { success: true };
    }
  });

  // GET /api/auth/me
  app.get('/me', {
    schema: {
      tags: ['Auth'],
      summary: 'Get current user',
      description: 'Returns the authenticated user profile',
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            username: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string' },
            department: { type: 'string', nullable: true },
            photoUrl: { type: 'string', nullable: true },
            role: { type: 'string' },
            status: { type: 'string' },
            forcePasswordChange: { type: 'boolean' },
            isTemporaryPassword: { type: 'boolean' },
            lastLogin: { type: 'string', nullable: true, format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  }, async (req) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.sub },
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        department: true,
        photoUrl: true,
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

  // PUT /api/auth/profile - Update own profile
  app.put('/profile', {
    schema: {
      tags: ['Auth'],
      summary: 'Update profile',
      description: 'Update the authenticated user\'s own profile',
      body: {
        type: 'object',
        properties: {
          fullName: { type: 'string', minLength: 2, maxLength: 100 },
          email: { type: 'string', format: 'email' },
          department: { type: 'string' },
          photoUrl: { type: 'string' },
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
            department: { type: 'string', nullable: true },
            photoUrl: { type: 'string', nullable: true },
            role: { type: 'string' },
          },
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const body = req.body as { fullName?: string; email?: string; department?: string; photoUrl?: string };

    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    // Validate email format if provided
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Invalid email format' });
    }

    // Validate fullName if provided
    if (body.fullName && (body.fullName.length < 2 || body.fullName.length > 100)) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Full name must be 2-100 characters' });
    }

    // Check email uniqueness if changed
    if (body.email && body.email !== user.email) {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Email already in use' });
      }
    }

    const beforeValue = {
      fullName: user.fullName,
      email: user.email,
      department: user.department,
      photoUrl: user.photoUrl,
    };

    const updateData: Record<string, string | null | undefined> = {};
    if (body.fullName !== undefined) updateData.fullName = body.fullName;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.department !== undefined) updateData.department = body.department || null;
    if (body.photoUrl !== undefined) updateData.photoUrl = body.photoUrl || null;

    const updatedUser = await prisma.user.update({
      where: { id: req.user.sub },
      data: updateData,
      select: {
        id: true,
        username: true,
        fullName: true,
        email: true,
        department: true,
        photoUrl: true,
        role: true,
      },
    });

    await app.auditLog({
      userId: user.username,
      userName: user.fullName,
      userRole: user.role,
      action: 'PROFILE_UPDATED',
      targetType: 'user',
      targetId: user.id,
      beforeValue,
      afterValue: { ...updateData, username: user.username, fullName: updatedUser.fullName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return updatedUser;
  });

  // POST /api/auth/change-password
  app.post('/change-password', {
    schema: {
      tags: ['Auth'],
      summary: 'Change password',
      description: 'Change the authenticated user\'s password. Validates against password policy.',
      body: {
        type: 'object',
        required: ['newPassword', 'confirmPassword'],
        properties: {
          currentPassword: { type: 'string', description: 'Required unless temporary password' },
          newPassword: { type: 'string', minLength: 8 },
          confirmPassword: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const { currentPassword, newPassword } = parsed.data;
    const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
    if (!user) return reply.code(404).send({ error: 'User not found' });

    // Skip current password verification for temporary password users
    if (!user.isTemporaryPassword) {
      // Verify current password for regular users
      if (!currentPassword) {
        return reply.code(400).send({ error: 'INVALID_PASSWORD', message: 'Current password is required' });
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return reply.code(400).send({ error: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
      }
    }

    // Get password policy
    const policyConfig = await prisma.systemConfig.findUnique({ where: { configKey: 'password-policy' } });
    const policy = (policyConfig?.configValue ?? {
      minLength: 8,
      maxLength: 128,
      requireUppercase: true,
      requireLowercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
      minUppercase: 1,
      minLowercase: 1,
      minNumbers: 1,
      minSpecialChars: 1,
      preventReuseCount: 12,
      cannotBeUserId: true,
      cannotContainUserId: true,
    }) as Record<string, unknown>;

    // Validate password length
    const minLength = (policy.minLength as number) ?? 8;
    const maxLength = (policy.maxLength as number) ?? 128;
    if (newPassword.length < minLength) {
      return reply.code(400).send({ error: 'POLICY_VIOLATION', message: `Password must be at least ${minLength} characters` });
    }
    if (newPassword.length > maxLength) {
      return reply.code(400).send({ error: 'POLICY_VIOLATION', message: `Password must be at most ${maxLength} characters` });
    }

    // Validate uppercase
    if (policy.requireUppercase) {
      const minUpper = (policy.minUppercase as number) ?? 1;
      const upperCount = (newPassword.match(/[A-Z]/g) || []).length;
      if (upperCount < minUpper) {
        return reply.code(400).send({ error: 'POLICY_VIOLATION', message: `Password must contain at least ${minUpper} uppercase letter(s)` });
      }
    }

    // Validate lowercase
    if (policy.requireLowercase) {
      const minLower = (policy.minLowercase as number) ?? 1;
      const lowerCount = (newPassword.match(/[a-z]/g) || []).length;
      if (lowerCount < minLower) {
        return reply.code(400).send({ error: 'POLICY_VIOLATION', message: `Password must contain at least ${minLower} lowercase letter(s)` });
      }
    }

    // Validate numbers
    if (policy.requireNumbers) {
      const minNum = (policy.minNumbers as number) ?? 1;
      const numCount = (newPassword.match(/[0-9]/g) || []).length;
      if (numCount < minNum) {
        return reply.code(400).send({ error: 'POLICY_VIOLATION', message: `Password must contain at least ${minNum} number(s)` });
      }
    }

    // Validate special characters
    if (policy.requireSpecialChars) {
      const minSpecial = (policy.minSpecialChars as number) ?? 1;
      const specialCount = (newPassword.match(/[^A-Za-z0-9]/g) || []).length;
      if (specialCount < minSpecial) {
        return reply.code(400).send({ error: 'POLICY_VIOLATION', message: `Password must contain at least ${minSpecial} special character(s)` });
      }
    }

    // Validate: cannot be same as username
    if (policy.cannotBeUserId !== false && newPassword === user.username) {
      return reply.code(400).send({ error: 'POLICY_VIOLATION', message: 'Password cannot be same as User ID' });
    }
    if (policy.cannotContainUserId !== false && newPassword.toLowerCase().includes(user.username.toLowerCase())) {
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

    // Calculate password expiry from policy
    const expiryDays = (policy.passwordExpiryDays as number) ?? 90;
    const passwordExpiresAt = expiryDays > 0
      ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
      : null;

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newHash,
          forcePasswordChange: false,
          isTemporaryPassword: false,
          passwordChangedAt: new Date(),
          passwordExpiresAt,
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
      afterValue: { username: user.username, fullName: user.fullName },
      signatureMeaning: 'User changed password',
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
      description: 'Re-verify password for sensitive operations. Returns a 5-min verification token.',
      body: {
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string' } },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, verificationToken: { type: 'string' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
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

  // POST /api/auth/forgot-password (public endpoint for password reset requests)
  app.post('/forgot-password', {
    config: {
      skipAuth: true,
      rateLimit: {
        max: 5,
        timeWindow: '5 minutes',
        keyGenerator: (req: any) => req.ip,
      },
    },
    schema: {
      tags: ['Auth'],
      summary: 'Forgot password',
      description: 'Submit a password reset request. Always returns success to prevent user enumeration.',
      security: [],
      body: {
        type: 'object',
        required: ['username'],
        properties: { username: { type: 'string' } },
      },
      response: {
        200: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' } } },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const body = req.body as { username?: string };
    if (!body.username) {
      return reply.code(400).send({ error: 'User ID is required' });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { username: body.username } });

    // Always return success to prevent user enumeration
    if (!user) {
      return { success: true, message: 'If the user ID exists, a password reset request has been submitted.' };
    }

    // Check for existing pending request
    const existingRequest = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.username, status: 'PENDING' },
    });

    if (existingRequest) {
      return { success: true, message: 'A password reset request is already pending. Please contact your administrator.' };
    }

    // Create password reset request
    await prisma.passwordResetRequest.create({
      data: {
        userId: user.username,
        status: 'PENDING',
      },
    });

    // Notify admins about the password reset request
    await createNotification({
      type: 'PASSWORD_RESET_REQUEST',
      title: 'Password Reset Request',
      message: `User ${user.fullName} (${user.username}) has requested a password reset.`,
      targetUserId: user.username,
      forRole: 'ADMIN',
    });

    return { success: true, message: 'Password reset request submitted. Please contact your administrator.' };
  });
}
