import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (permission: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function rbacPlugin(app: FastifyInstance) {
  app.decorate('requirePermission', (permission: string) => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const userRole = req.user?.role;
      if (!userRole) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
      }

      // SUPER_ADMIN bypasses all permission checks
      if (userRole === 'SUPER_ADMIN') return;

      // Fetch role permissions from database
      const role = await prisma.role.findUnique({
        where: { name: userRole },
        select: { permissions: true },
      });

      const perms = (role?.permissions as string[]) || [];
      if (!perms.includes(permission)) {
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
}

export default fp(rbacPlugin, { name: 'rbac', dependencies: ['auth', 'audit-logger'] });
