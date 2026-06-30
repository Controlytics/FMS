import { useCallback } from 'react';
import { resolveNodePermissions } from '@digilog/shared';
import { useAuth } from './use-auth';

/**
 * Centralized action-permission check keyed by PERMISSION_TREE node id.
 * Replaces ad-hoc `isSuperAdmin || perms.includes('X')` scattered across pages.
 * OR-semantics: holding ANY of the node's enforced permissions grants it
 * (matches RequireRole and the legacy per-page checks). Default-deny on unknown ids.
 */
export function useCan(): (nodeId: string) => boolean {
  const { user } = useAuth();
  const role = user?.role;
  const perms = user?.permissions ?? [];
  return useCallback(
    (nodeId: string) => {
      if (role === 'SUPER_ADMIN') return true;
      const required = resolveNodePermissions(nodeId);
      if (required.length === 0) return false; // unknown / unmapped → deny
      return required.some(p => perms.includes(p));
    },
    [role, perms],
  );
}
