/**
 * Shared organization scoping utility for Prisma where clauses.
 * Used across all filter-related services to enforce org-level data isolation.
 */
import type { RequestContext } from '../types/context.js';

export function orgScope(ctx: RequestContext): Record<string, any> {
  // SUPER_ADMIN and ADMIN see all orgs (system-wide access)
  if (ctx.scope === 'GLOBAL' || ctx.userRole === 'SUPER_ADMIN' || ctx.userRole === 'ADMIN') return {};
  // Other roles are scoped to their own organization
  if (!ctx.organizationId) return {}; // No org assigned — permission check already gates access
  return { organizationId: ctx.organizationId };
}
