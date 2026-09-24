import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const fieldIdsDef: ModuleConfigDefinition = {
  moduleKey: 'field-ids',
  moduleName: 'Field ID Names',
  description: 'Configure field display names globally',
  icon: 'tag',
  category: 'display',
  sortOrder: 16,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/field-ids',
  settings: [],
};
