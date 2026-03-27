import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const filterLifecycleStatesDef: ModuleConfigDefinition = {
  moduleKey: 'filter_lifecycle_states',
  moduleName: 'Filter Lifecycle States',
  description: 'Configure lifecycle states for filter management',
  icon: 'refresh-cw',
  category: 'filter-management',
  sortOrder: 51,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: false,
  customPagePath: '/config/filter-lifecycle',
  settings: [],
};
