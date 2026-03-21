import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (permission: string) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireTenantAdmin: () => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireSuperAdmin: () => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
      const role = await prisma.role.findFirst({
        where: { name: userRole },
        select: { permissions: true },
      });

      const perms = (role?.permissions as string[]) || [];

      // Check direct permission match first
      let hasPermission = perms.includes(permission);

      // Fallback: check if user has the *_MANAGE parent permission
      if (!hasPermission) {
        const manageVariants = ['_CREATE', '_UPDATE', '_DELETE', '_VIEW', '_READ', '_EXPORT'];
        for (const suffix of manageVariants) {
          if (permission.endsWith(suffix)) {
            const managePermission = permission.slice(0, -suffix.length) + '_MANAGE';
            if (perms.includes(managePermission)) {
              hasPermission = true;
              break;
            }
          }
        }
      }

      if (!hasPermission) {
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
      // SUPER_ADMIN can always pass role checks
      if (userRole === 'SUPER_ADMIN') return;
      // TENANT_ADMIN passes if ADMIN is in the list (backward compat)
      if (userRole === 'TENANT_ADMIN' && roles.includes('ADMIN')) return;

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

  // Convenience: requires SUPER_ADMIN role
  app.decorate('requireSuperAdmin', () => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.user?.role !== 'SUPER_ADMIN') {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Super Admin access required',
          yourRole: req.user?.role,
        });
      }
    };
  });

  // Convenience: requires TENANT_ADMIN or higher within the tenant
  app.decorate('requireTenantAdmin', () => {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const userRole = req.user?.role;
      if (userRole === 'SUPER_ADMIN') return; // SUPER_ADMIN passes all

      if (!userRole || !['TENANT_ADMIN', 'ADMIN'].includes(userRole)) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Tenant Admin access required',
          yourRole: userRole,
        });
      }

      // Ensure user belongs to a tenant
      if (!req.user?.tenantId) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'No tenant context',
        });
      }
    };
  });
}

export default fp(rbacPlugin, { name: 'rbac', dependencies: ['auth', 'audit-logger'] });
