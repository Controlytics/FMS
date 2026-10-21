import { useMemo } from 'react';
import useSWR from 'swr';
import type { RoleData } from '@digilog/shared';

export function useRoleColors() {
  const { data: rolesData } = useSWR<RoleData[]>('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });

  const roleColors = useMemo(() => {
    const colors: Record<string, string> = {};
    rolesData?.forEach(role => {
      colors[role.name] = `${role.color} text-white`;
    });
    return colors;
  }, [rolesData]);

  // 2026-10-21: display names come from the roles table too. The header and
  // profile page had hard-coded label maps that still listed the long-removed
  // MAINTENANCE / VIEWER roles and lacked MANAGER / QA / SHIFTOFFICER, so those
  // roles (and every custom role) showed their raw name.
  const roleLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    rolesData?.forEach(role => { labels[role.name] = role.displayName; });
    return labels;
  }, [rolesData]);

  return { roleColors, roleLabels, rolesData };
}
