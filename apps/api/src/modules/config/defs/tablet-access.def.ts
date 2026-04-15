import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const tabletAccessDef: ModuleConfigDefinition = {
  moduleKey: 'tablet-access',
  moduleName: 'Tablet App Access',
  description: 'Control which roles can access the tablet application and its features',
  icon: 'tablet',
  category: 'security',
  sortOrder: 15,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/tablet-access',
  settings: [],
};
