export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  MAINTENANCE: 'MAINTENANCE',
  OPERATOR: 'OPERATOR',
  VIEWER: 'VIEWER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  SUPER_ADMIN: 6,
  ADMIN: 5,
  SUPERVISOR: 4,
  MAINTENANCE: 3,
  OPERATOR: 2,
  VIEWER: 1,
};

/** Roles that a given creator role can assign to new users */
export const CREATABLE_ROLES: Record<string, Role[]> = {
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
