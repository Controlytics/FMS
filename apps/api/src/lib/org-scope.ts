/**
 * Shared organization scoping utility for Prisma where clauses.
 * Used across all filter-related services to enforce org-level data isolation.
 */
import type { RequestContext } from '../types/context.js';

export function orgScope(ctx: RequestContext): Record<string, any> {
  if (ctx.scope === 'GLOBAL') return {};
  if (ctx.userRole === 'SUPER_ADMIN' || ctx.userRole === 'ADMIN') return {};
  if (!ctx.organizationId) return {};
  return { organizationId: ctx.organizationId };
}
