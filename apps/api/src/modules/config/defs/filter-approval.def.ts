import type { ModuleConfigDefinition } from '../../../lib/config-registry.js';

/**
 * Filter Creation Workflow role assignment (2026-09-04). Same three-step shape
 * as pm-schedule-approval: create/upload → review → approve.
 *
 * Deliberately does NOT inherit from the PM config the way
 * replacement-schedule-approval does. That inheritance exists for a historical
 * reason — replacement schedules genuinely shared the PM config before
 * 2026-06-11 — and none applies here: this workflow is new, so there is no
 * install whose behaviour would change, and coupling filter creation to the PM
 * schedule roles would make one config silently govern two unrelated surfaces.
 * A blank role here means "anyone holding the route permission", exactly as a
 * blank role means in the PM config itself.
 */
export const filterApprovalDef: ModuleConfigDefinition = {
  moduleKey: 'filter-approval',
  moduleName: 'Filter Creation Workflow',
  description: 'Configure the create/upload → review → approve workflow for new filters (single create and bulk upload): which role performs each step. Super Admin can always perform any step.',
  icon: 'clipboard-check',
  category: 'filter-management',
  sortOrder: 63,
  permissions: { read: 'CONFIG_READ', write: 'CONFIG_UPDATE' },
  requiredRole: 'SUPER_ADMIN',
  requiresReauth: true,
  // 2026-09-24 coverage sweep: every config page is a gate-able action.
  reauthAction: 'UPDATE_CONFIG_PAGE',
  hasCustomPage: false,
  settings: [
    {
      key: 'workflowEnabled',
      type: 'boolean',
      label: 'Enable Review + Approval Workflow',
      description: 'When ON, a newly created or bulk-uploaded filter must be reviewed and then approved before it can be operated — it is visible in the Filters list but cannot start a cleaning cycle. When OFF, new filters are usable immediately, as before.',
      group: 'Workflow',
      // Defaults OFF so shipping this changes nothing until an admin turns it
      // on — matching how pm-schedule-approval shipped.
      default: false,
    },
    {
      key: 'uploadRole',
      type: 'multiselect',
      label: 'Create / Upload Role',
      description: 'Roles allowed to create filters and run the bulk upload (one or more). Leave empty to allow anyone with the create/upload permission. Super Admin can always create.',
      group: 'Workflow',
      default: [],
      dynamicOptionsSource: '/api/roles/active',
      options: [],
    },
    {
      key: 'reviewRole',
      type: 'select',
      label: 'Review Role',
      description: 'Role allowed to review a newly created filter (pass it on for approval, or reject it). Super Admin can always review.',
      group: 'Workflow',
      default: '',
      dynamicOptionsSource: '/api/roles/active',
      options: [],
    },
    {
      key: 'approvalRole',
      type: 'select',
      label: 'Approval Role',
      description: 'Role allowed to approve (or reject) a reviewed filter. Only approved filters can be operated. Super Admin can always approve.',
      group: 'Workflow',
      default: '',
      dynamicOptionsSource: '/api/roles/active',
      options: [],
    },
  ],
};
