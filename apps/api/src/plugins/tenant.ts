import fp from 'fastify-plugin';
import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import type { TenantContext } from '../types/context.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantContext: TenantContext;
  }
}

/**
 * Tenant middleware plugin.
 * Runs AFTER auth plugin. Extracts tenant context from JWT claims.
 * SUPER_ADMIN can impersonate a tenant via X-Tenant-Id header.
 */
async function tenantPlugin(app: FastifyInstance) {
  app.decorateRequest('tenantContext', {
    getter() {
      return (this as any)._tenantContext;
    },
    setter(val: TenantContext) {
      (this as any)._tenantContext = val;
    },
  } as any);

  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    // Skip if no user (public paths handled by auth plugin)
    if (!req.user) return;

    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';

    // SUPER_ADMIN can impersonate a tenant via header
    let tenantId = req.user.tenantId || null;
    if (isSuperAdmin) {
      const headerTenantId = req.headers['x-tenant-id'] as string | undefined;
      if (headerTenantId) {
        tenantId = headerTenantId;
      }
    }

    const scope = (req.user.scope as TenantContext['scope']) || (isSuperAdmin ? 'GLOBAL' : 'TENANT');

    req.tenantContext = {
      tenantId,
      organizationId: req.user.organizationId || null,
      isSuperAdmin,
      scope,
    };
  });
}

export default fp(tenantPlugin, { name: 'tenant', dependencies: ['auth'] });
