import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const filterCleaningReasonsDef: ModuleConfigDefinition = {
  moduleKey: 'filter-cleaning-reasons',
  moduleName: 'Filter Cleaning Reasons',
  description: 'Configure cleaning reason codes for filter cleaning cycles',
  icon: 'list-checks',
  category: 'filter-management',
  sortOrder: 50,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: false,
  customPagePath: '/config/filter-cleaning-reasons',
  settings: [],
};
