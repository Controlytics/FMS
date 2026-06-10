import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const replacementScheduleFiltersDef: ModuleConfigDefinition = {
  moduleKey: 'replacement-schedule-filters',
  moduleName: 'Replacement Schedule — AHU Filters',
  description: 'Choose which roles can expand an AHU to see the filters under it on the Replacement Schedule page',
  icon: 'eye',
  category: 'access',
  sortOrder: 7,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/replacement-schedule-filters',
  settings: [],
};
