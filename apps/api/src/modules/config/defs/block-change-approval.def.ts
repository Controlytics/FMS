import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

export const blockChangeApprovalDef: ModuleConfigDefinition = {
  moduleKey: 'block-change-approval',
  moduleName: 'Block Change Approval',
  description: 'Configure which role can approve block change requests for filter cleaning',
  icon: 'shield-check',
  category: 'filter',
  sortOrder: 60,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: false,
  hasCustomPage: false,
  settings: [
    {
      key: 'approvalRole',
      type: 'string',
      label: 'Approval Role',
      description: 'The role that can approve block change requests (selected by Super Admin)',
      group: 'Approval',
      default: 'ADMIN',
    },
    {
      key: 'requireReason',
      type: 'boolean',
      label: 'Require Reason',
      description: 'Require users to provide a reason when requesting a block change',
      group: 'Approval',
      default: true,
    },
    {
      key: 'autoExpireHours',
      type: 'number',
      label: 'Auto-Expire Hours',
      description: 'Approved requests expire after this many hours (0 = no expiry)',
      group: 'Approval',
      default: 24,
    },
  ],
};
