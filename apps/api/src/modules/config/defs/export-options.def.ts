import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const exportOptionsDef: ModuleConfigDefinition = {
  moduleKey: 'export-options',
  moduleName: 'Export Options',
  description: 'Choose which export formats (PDF / Excel) each role can use on each page',
  icon: 'download',
  category: 'access',
  sortOrder: 6,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/export-options',
  settings: [],
};
