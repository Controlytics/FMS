import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { rolesWithPermission, type Permission } from '@digilog/shared';

interface RequireRoleProps {
  /** Explicit role list — use for edge cases like SUPER_ADMIN-only routes */
  roles?: string[];
  /** Permission key — derives allowed roles from the ROLE_PERMISSIONS matrix */
  permission?: Permission;
  children: React.ReactNode;
}

export function RequireRole({ roles, permission, children }: RequireRoleProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  const allowedRoles = permission ? rolesWithPermission(permission) : roles ?? [];

  if (!user || !allowedRoles.includes(user.role as any)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
