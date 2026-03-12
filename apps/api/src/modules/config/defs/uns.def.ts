import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const unsDef: ModuleConfigDefinition = {
  moduleKey: 'uns',
  moduleName: 'UNS Configuration',
  description: 'Unified Namespace topic mapping and ISA-95 hierarchy',
  icon: 'network',
  category: 'integrations',
  sortOrder: 40,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: false,
  hasCustomPage: true,
  customPagePath: '/config/uns',
  settings: [],
};
