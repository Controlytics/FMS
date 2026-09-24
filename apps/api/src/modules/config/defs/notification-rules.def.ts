import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const notificationRulesDef: ModuleConfigDefinition = {
  moduleKey: 'notification-rules',
  moduleName: 'Notification Rules',
  description: 'Configure event-based alerts & recipients',
  icon: 'bell',
  category: 'notifications',
  sortOrder: 32,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: true,
  customPagePath: '/config/notification-rules',
  settings: [],
};
