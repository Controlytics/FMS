import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const retentionDef: ModuleConfigDefinition = {
  moduleKey: 'retention',
  moduleName: 'Data Retention',
  description: 'Configure hypertable compression and retention policies',
  icon: 'trash',
  category: 'advanced',
  sortOrder: 51,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/retention',
  settings: [],
};
