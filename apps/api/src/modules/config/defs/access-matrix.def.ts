import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const accessMatrixDef: ModuleConfigDefinition = {
  moduleKey: 'access-matrix',
  moduleName: 'Configuration Access',
  description: 'Assign configuration modules to roles — choose which configs each role can open',
  icon: 'shield-check',
  category: 'access',
  sortOrder: 5,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/access-matrix',
  settings: [],
};
