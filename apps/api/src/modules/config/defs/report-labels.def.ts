import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const reportLabelsDef: ModuleConfigDefinition = {
  moduleKey: 'report-labels',
  moduleName: 'Report Labels',
  description: 'Customize report titles, subtitles, and table column headers (view + PDF)',
  icon: 'file-text',
  category: 'display',
  sortOrder: 13,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: null,
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/report-labels',
  settings: [],
};
