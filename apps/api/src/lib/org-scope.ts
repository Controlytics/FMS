/**
 * Shared organization scoping utility for Prisma where clauses.
 * Used across all filter-related services to enforce org-level data isolation.
 */
import type { RequestContext } from '../types/context.js';

export function orgScope(ctx: RequestContext): Record<string, any> {
  // Only SUPER_ADMIN with GLOBAL scope sees all orgs
  if (ctx.scope === 'GLOBAL' || ctx.userRole === 'SUPER_ADMIN') return {};
  // ADMIN and all other roles are scoped to their own organization
  if (!ctx.organizationId) return { organizationId: '__no_org__' }; // Block access if no org
  return { organizationId: ctx.organizationId };
}
