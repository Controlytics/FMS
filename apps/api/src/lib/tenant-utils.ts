import type { FastifyRequest } from 'fastify';

/**
 * Get effective tenant ID from request.
 * SUPER_ADMIN can impersonate via X-Tenant-Id header.
 */
export function getTenantId(req: FastifyRequest): string | null {
  if (req.user.role === 'SUPER_ADMIN') {
    return (req.headers['x-tenant-id'] as string) || req.user.tenantId || null;
  }
  return req.user.tenantId || null;
}
