import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const replacementScheduleFiltersDef: ModuleConfigDefinition = {
  // One config page (customPagePath) edits BOTH the PM and Replacement per-role
  // matrices. The two matrices are stored under SEPARATE keys and gated
  // independently per page — only the editing UI is unified. This def's key
  // remains `replacement-schedule-filters` for backward compatibility.
  moduleKey: 'replacement-schedule-filters',
  moduleName: 'Schedule AHU Filters',
  description: 'Choose which roles can expand an AHU to see the filters under it — set independently for the PM Schedule and Replacement Schedule pages',
  icon: 'eye',
  category: 'access',
  sortOrder: 7,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/replacement-schedule-filters',
  settings: [],
};
