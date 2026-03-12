import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const systemDef: ModuleConfigDefinition = {
  moduleKey: 'system',
  moduleName: 'Pipeline Configuration',
  description: 'Operational settings for data ingestion pipeline',
  icon: 'settings',
  category: 'advanced',
  sortOrder: 53,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/system',
  settings: [],
};
