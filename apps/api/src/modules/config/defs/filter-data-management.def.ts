import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const filterDataManagementDef: ModuleConfigDefinition = {
  moduleKey: 'filter-data-management',
  moduleName: 'Filter Data Management',
  description: 'Edit, delete, or unretire retirement and replacement records (Super Admin only, no audit trail)',
  icon: 'shield',
  category: 'filter-management',
  sortOrder: 65,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/filter-data-management',
  settings: [],
};
