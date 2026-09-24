import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const helpDef: ModuleConfigDefinition = {
  moduleKey: 'help',
  moduleName: 'Help Articles',
  description: 'Manage contextual help content and documentation',
  icon: 'help-circle',
  category: 'advanced',
  sortOrder: 52,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/help',
  settings: [],
};
