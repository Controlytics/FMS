// Default system roles - these are created during seed
// Actual roles are now stored in the database and managed dynamically
export const DEFAULT_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  TENANT_ADMIN: 'TENANT_ADMIN',
  ORG_ADMIN: 'ORG_ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  MAINTENANCE: 'MAINTENANCE',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
  // Backward compatibility alias
  ADMIN: 'TENANT_ADMIN',
} as const;

// Keep ROLES export for backward compatibility
export const ROLES = DEFAULT_ROLES;

// Role is now a string type to support dynamic roles
export type Role = string;

// Role scope — determines the access boundary
export type RoleScope = 'GLOBAL' | 'TENANT' | 'ORGANIZATION';

// Interface for role data from the database
export interface RoleData {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  hierarchyLevel: number;
  permissions: string[];
  color: string;
  isSystem: boolean;
  isActive: boolean;
  scope?: RoleScope;
  tenantId?: string | null;
}

// Default hierarchy levels for system roles
export const DEFAULT_ROLE_HIERARCHY: Record<string, number> = {
  SUPER_ADMIN: 6,
  TENANT_ADMIN: 5,
  ORG_ADMIN: 4,
  SUPERVISOR: 3,
  MAINTENANCE: 2,
  OPERATOR: 1,
  VIEWER: 0,
  // Backward compat
  ADMIN: 5,
};

// Keep ROLE_HIERARCHY export for backward compatibility
export const ROLE_HIERARCHY = DEFAULT_ROLE_HIERARCHY;

// Role scope mapping
export const ROLE_SCOPE: Record<string, RoleScope> = {
  SUPER_ADMIN: 'GLOBAL',
  TENANT_ADMIN: 'TENANT',
  ORG_ADMIN: 'ORGANIZATION',
  SUPERVISOR: 'ORGANIZATION',
  MAINTENANCE: 'ORGANIZATION',
  OPERATOR: 'ORGANIZATION',
  VIEWER: 'ORGANIZATION',
  ADMIN: 'TENANT',
};

/**
 * @deprecated Use API endpoint /api/roles/:name/creatable instead
 */
export const CREATABLE_ROLES: Record<string, string[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'TENANT_ADMIN', 'ORG_ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'],
  TENANT_ADMIN: ['TENANT_ADMIN', 'ORG_ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'],
  ORG_ADMIN: ['SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'],
  ADMIN: ['TENANT_ADMIN', 'ORG_ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'],
};

export const USER_STATUS = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
  EXPIRED: 'EXPIRED',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
