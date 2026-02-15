import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { ROLE_PERMISSIONS, type Permission, reauthConfigSchema, type ReauthOperation } from '@digilog/shared';
import { prisma } from '../lib/prisma.js';
import { verifyVerificationToken } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (permission: Permission) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireReauth: (operationKey: ReauthOperation) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function rbacPlugin(app: FastifyInstance) {
  app.decorate('requirePermission', (permission: Permission) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const userRole = req.user?.role;
      if (!userRole) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
      }

      const perms = ROLE_PERMISSIONS[userRole as keyof typeof ROLE_PERMISSIONS];
      if (!perms || !perms.includes(permission)) {
        // Log unauthorized attempt
        await app.auditLog({
          userId: req.user.username,
          userRole,
          action: 'UNAUTHORIZED_ACTION_ATTEMPT',
          reason: `Attempted action requiring ${permission}`,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          sessionId: req.user.sessionId,
        });

        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Permission denied',
          requiredPermission: permission,
          yourRole: userRole,
        });
      }
    };
  });

  app.decorate('requireRole', (...roles: string[]) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const userRole = req.user?.role;
      if (!userRole || !roles.includes(userRole)) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Permission denied',
          requiredRoles: roles,
          yourRole: userRole,
        });
      }
    };
  });

  app.decorate('requireReauth', (operationKey: ReauthOperation) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      // Check if this operation requires re-auth
      const config = await prisma.systemConfig.findUnique({ where: { configKey: 'reauth_settings' } });
      const reauthConfig = reauthConfigSchema.parse(config?.configValue ?? {});

      if (!reauthConfig.enabledOperations.includes(operationKey)) {
        return; // Re-auth not required for this operation
      }

      const token = req.headers['x-verification-token'] as string | undefined;
      if (!token) {
        return reply.code(403).send({
          error: 'REAUTH_REQUIRED',
          message: 'Re-authentication required for this operation',
          operation: operationKey,
        });
      }

      try {
        const payload = await verifyVerificationToken(token);
        if (payload.sub !== req.user.sub) {
          return reply.code(403).send({ error: 'REAUTH_INVALID', message: 'Verification token does not match current user' });
        }
      } catch {
        return reply.code(403).send({ error: 'REAUTH_INVALID', message: 'Verification token is invalid or expired' });
      }
    };
  });
}

export default fp(rbacPlugin, { name: 'rbac', dependencies: ['auth', 'audit-logger'] });
