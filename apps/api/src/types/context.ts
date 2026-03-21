/**
 * Request context passed from route handlers to services.
 * Decouples services from Fastify's request object.
 */
export interface RequestContext {
  userId: string;      // req.user.username
  userSub: string;     // req.user.sub (UUID)
  userRole: string;    // req.user.role
  ipAddress: string;   // req.ip
  userAgent?: string;  // req.headers['user-agent']
  sessionId: string;   // req.user.sessionId
  tenantId?: string;   // req.user.tenantId (undefined for SUPER_ADMIN)
  organizationId?: string; // req.user.organizationId
  scope?: string;      // GLOBAL | TENANT | ORGANIZATION
}

/**
 * Tenant context available on every authenticated request
 */
export interface TenantContext {
  tenantId: string | null;     // null for SUPER_ADMIN without tenant impersonation
  organizationId: string | null;
  isSuperAdmin: boolean;
  scope: 'GLOBAL' | 'TENANT' | 'ORGANIZATION';
}
