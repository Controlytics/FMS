// Default system roles - these are created during seed
// Actual roles are now stored in the database and managed dynamically
export const DEFAULT_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  MAINTENANCE: 'MAINTENANCE',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
} as const;

// Keep ROLES export for backward compatibility
export const ROLES = DEFAULT_ROLES;

// Role is now a string type to support dynamic roles
export type Role = string;

// Single-tenant deployment: every role is GLOBAL.
// The type is retained so existing call sites that assert .scope === 'GLOBAL'
// keep compiling without modification.
export type RoleScope = 'GLOBAL';

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
}

// Default hierarchy levels for system roles
export const DEFAULT_ROLE_HIERARCHY: Record<string, number> = {
  SUPER_ADMIN: 6,
  ADMIN: 5,
  SUPERVISOR: 3,
  MAINTENANCE: 2,
  OPERATOR: 1,
  VIEWER: 0,
};

// Keep ROLE_HIERARCHY export for backward compatibility
export const ROLE_HIERARCHY = DEFAULT_ROLE_HIERARCHY;

// Role scope mapping — single-tenant: every role is GLOBAL.
export const ROLE_SCOPE: Record<string, RoleScope> = {
  SUPER_ADMIN: 'GLOBAL',
  ADMIN: 'GLOBAL',
  SUPERVISOR: 'GLOBAL',
  MAINTENANCE: 'GLOBAL',
  OPERATOR: 'GLOBAL',
  VIEWER: 'GLOBAL',
};

/**
 * @deprecated Use API endpoint /api/roles/:name/creatable instead
 */
export const CREATABLE_ROLES: Record<string, string[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'],
  ADMIN: ['ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'],
};

export const USER_STATUS = {
  ENABLED: 'ENABLED',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
  EXPIRED: 'EXPIRED',
} as const;

export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];
