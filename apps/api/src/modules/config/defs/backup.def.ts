import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const backupDef: ModuleConfigDefinition = {
  moduleKey: 'backup',
  moduleName: 'Backup & Restore',
  description: 'Export or restore the entire database',
  icon: 'database',
  category: 'advanced',
  sortOrder: 50,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/backup',
  settings: [],
};
