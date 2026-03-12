import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const alarmColumnsDef: ModuleConfigDefinition = {
  moduleKey: 'alarm-columns',
  moduleName: 'Alarm Columns',
  description: 'Configure alarm table column visibility per role',
  icon: 'columns',
  category: 'display',
  sortOrder: 14,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/alarm-columns',
  settings: [],
};
