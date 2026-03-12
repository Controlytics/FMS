import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const sidebarConfigDef: ModuleConfigDefinition = {
  moduleKey: 'sidebar-config',
  moduleName: 'Sidebar Configuration',
  description: 'Configure sidebar items per user',
  icon: 'sidebar',
  category: 'display',
  sortOrder: 15,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/sidebar',
  settings: [],
};
