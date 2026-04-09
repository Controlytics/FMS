import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const dashboardCardsDef: ModuleConfigDefinition = {
  moduleKey: 'dashboard-cards',
  moduleName: 'Dashboard Cards',
  description: 'Configure which dashboard cards are visible per role',
  icon: 'layout-dashboard',
  category: 'display',
  sortOrder: 12,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/dashboard-cards',
  settings: [],
};
