import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const qnnNotificationsDef: ModuleConfigDefinition = {
  moduleKey: 'qnn-notifications',
  moduleName: 'QNN Notifications',
  description: 'Choose which roles can see Quality Notification (QNN) entries in the Notifications center. Super Admin always sees them.',
  icon: 'bell',
  category: 'filter-management',
  sortOrder: 62,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: false,
  settings: [
    {
      key: 'visibleRoles',
      type: 'multiselect',
      label: 'Roles that can see QNN notifications',
      description: 'Users with any of these roles will see Quality Notification (QNN) entries in the Notifications center. Super Admin always sees them. Leave empty to restrict QNN notifications to Super Admin only.',
      group: 'Visibility',
      default: ['ADMIN'],
      dynamicOptionsSource: '/api/roles/active',
      options: [],
    },
  ],
};
