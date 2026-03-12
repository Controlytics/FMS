import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const rolePrivilegesDef: ModuleConfigDefinition = {
  moduleKey: 'role-privileges',
  moduleName: 'Role Privileges',
  description: 'Configure feature permissions by role',
  icon: 'shield-check',
  category: 'user',
  sortOrder: 22,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/role-privileges',
  settings: [],
};
