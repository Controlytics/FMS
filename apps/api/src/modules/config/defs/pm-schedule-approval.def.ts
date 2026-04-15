import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const pmScheduleApprovalDef: ModuleConfigDefinition = {
  moduleKey: 'pm-schedule-approval',
  moduleName: 'PM Schedule Approval',
  description: 'Configure which role can approve PM schedule uploads and edits',
  icon: 'clipboard-check',
  category: 'filter-management',
  sortOrder: 61,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: false,
  settings: [
    {
      key: 'approvalRole',
      type: 'select',
      label: 'Approval Role',
      description: 'Only users with this role can approve PM schedule entries. Super Admin can always approve regardless of this setting.',
      group: 'Approval',
      default: 'ADMIN',
      dynamicOptionsSource: '/api/roles/active',
      options: [],
    },
  ],
};
