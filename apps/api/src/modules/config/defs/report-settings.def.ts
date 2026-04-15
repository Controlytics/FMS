import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const reportSettingsDef: ModuleConfigDefinition = {
  moduleKey: 'report-settings',
  moduleName: 'Report Settings',
  description: 'Configure report headers, footers, layout, and records per page',
  icon: 'file-text',
  category: 'display',
  sortOrder: 12,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/report-settings',
  settings: [],
};
