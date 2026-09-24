import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const notificationLogsDef: ModuleConfigDefinition = {
  moduleKey: 'notification-logs',
  moduleName: 'Notification Logs',
  description: 'View notification delivery history',
  icon: 'scroll',
  category: 'notifications',
  sortOrder: 33,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/notification-logs',
  settings: [],
};
