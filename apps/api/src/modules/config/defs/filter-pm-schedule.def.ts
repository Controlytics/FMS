import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const filterPmScheduleDef: ModuleConfigDefinition = {
  moduleKey: 'filter-pm-schedule',
  moduleName: 'PM Schedule Settings',
  description: 'Enable/disable preventive maintenance scheduling module',
  icon: 'calendar',
  category: 'filter-management',
  sortOrder: 52,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: false,
  settings: [
    { key: 'enabled', type: 'boolean', label: 'Enable PM Scheduling', default: false, group: 'General' },
  ],
};
