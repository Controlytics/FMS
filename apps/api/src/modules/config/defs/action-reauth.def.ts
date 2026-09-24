import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const actionReauthDef: ModuleConfigDefinition = {
  moduleKey: 'action-reauth',
  moduleName: 'Action Re-authentication',
  description: 'Require password verification for sensitive actions per role',
  icon: 'fingerprint',
  category: 'security',
  sortOrder: 4,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/action-reauth',
  settings: [],
};
