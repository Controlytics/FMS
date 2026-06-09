export interface FeaturePrivilege {
  id: string;
  label: string;
  category: string;
  icon: string;
}

/**
 * Feature privileges for the Role Privileges configuration page.
 * Single source of truth — role-privileges.tsx imports this instead of hardcoding.
 * Only includes permissions that are actually enforced by backend routes.
 */
export const FEATURE_PRIVILEGES: FeaturePrivilege[] = [
  // User Management
  { id: 'users.create', label: 'Create Users', category: 'User Management', icon: 'user-plus' },
  { id: 'users.view', label: 'View Users', category: 'User Management', icon: 'user' },
  { id: 'users.edit', label: 'Edit Users', category: 'User Management', icon: 'user-edit' },
  { id: 'users.delete', label: 'Delete Users', category: 'User Management', icon: 'user-minus' },
  { id: 'users.enable_disable', label: 'Enable/Disable Accounts', category: 'User Management', icon: 'toggle' },
  { id: 'users.unlock', label: 'Unlock Accounts', category: 'User Management', icon: 'unlock' },
  { id: 'users.reset_password', label: 'Reset Passwords', category: 'User Management', icon: 'key' },

  // System
  { id: 'config.view', label: 'View Configuration', category: 'System', icon: 'settings' },
  { id: 'config.edit', label: 'Edit Configuration', category: 'System', icon: 'settings-edit' },
  { id: 'config.field_ids', label: 'Update Field Labels', category: 'System', icon: 'tag' },
  { id: 'roles.manage', label: 'Manage Roles', category: 'System', icon: 'shield' },
  { id: 'notifications.view', label: 'View Notifications', category: 'System', icon: 'bell' },
  { id: 'notifications.manage', label: 'Manage Notifications', category: 'System', icon: 'bell' },
  { id: 'notifications.delete', label: 'Delete Notifications', category: 'System', icon: 'bell' },
  { id: 'audit.view', label: 'View Audit Trail', category: 'System', icon: 'clipboard' },
  { id: 'audit.export', label: 'Export Audit Trail', category: 'System', icon: 'clipboard' },

  // Asset Management
  { id: 'assets.view', label: 'View Assets', category: 'Asset Management', icon: 'eye' },
  { id: 'assets.create', label: 'Create Assets', category: 'Asset Management', icon: 'plus' },
  { id: 'assets.edit', label: 'Edit Assets', category: 'Asset Management', icon: 'edit' },
  { id: 'assets.delete', label: 'Delete Assets', category: 'Asset Management', icon: 'trash' },

  // Asset Relationships
  { id: 'assets.relationships.create', label: 'Create Relationships', category: 'Asset Relationships', icon: 'link' },
  { id: 'assets.relationships.delete', label: 'Delete Relationships', category: 'Asset Relationships', icon: 'link' },

  // Asset Identifiers
  { id: 'assets.identifiers.create', label: 'Assign RFID Tags / Create Identifiers', category: 'RFID & Identifiers', icon: 'wifi' },
  { id: 'assets.identifiers.delete', label: 'Unassign RFID Tags / Delete Identifiers', category: 'RFID & Identifiers', icon: 'wifi' },

  // Dashboards
  { id: 'dashboard.view', label: 'View Dashboards', category: 'Dashboards', icon: 'layout' },
  { id: 'dashboard.create', label: 'Create Dashboards', category: 'Dashboards', icon: 'plus' },
  { id: 'dashboard.manage', label: 'Manage Dashboards', category: 'Dashboards', icon: 'settings' },
  { id: 'dashboard.assign', label: 'Assign Dashboards', category: 'Dashboards', icon: 'link' },

  // Checklists
  { id: 'checklists.submit', label: 'Submit Checklists', category: 'Checklists', icon: 'clipboard-check' },
  { id: 'checklists.create', label: 'Create Checklist Profiles', category: 'Checklist Page Controls', icon: 'plus' },
  { id: 'checklists.edit', label: 'Edit Checklist Profiles', category: 'Checklist Page Controls', icon: 'edit' },
  { id: 'checklists.delete', label: 'Delete Checklist Profiles', category: 'Checklist Page Controls', icon: 'trash' },
  { id: 'checklists.toggle', label: 'Enable / Disable Checklists', category: 'Checklist Page Controls', icon: 'toggle' },

  // Filter Management
  { id: 'filters.operate', label: 'Operate Filters (Start/Advance Cycles)', category: 'Filter Management', icon: 'filter' },
  { id: 'filters.bypass', label: 'Bypass Filter Stages (Deviation)', category: 'Filter Management', icon: 'alert-circle' },
  { id: 'filters.events', label: 'View Filter Events', category: 'Filter Management', icon: 'list' },
  { id: 'filters.bulk_upload', label: 'Bulk Upload Filters', category: 'Filters Page Controls', icon: 'upload' },
  { id: 'filters.retire', label: 'Retire Filters', category: 'Filters Page Controls', icon: 'archive' },
  { id: 'filters.replace', label: 'Replace Filters', category: 'Filters Page Controls', icon: 'refresh' },
  { id: 'filters.status_update', label: 'Update Filter Status', category: 'Filters Page Controls', icon: 'edit' },
  { id: 'filters.hierarchy_create', label: 'Create Block / Area / AHU', category: 'Filters Page Controls', icon: 'plus' },
  { id: 'filters.rfid_manage', label: 'Assign / Unassign RFID Tags', category: 'Filters Page Controls', icon: 'wifi' },
  { id: 'replacement_schedule.view', label: 'View Replacement Schedule', category: 'Filters Page Controls', icon: 'calendar' },
  { id: 'replacement_schedule.upload', label: 'Upload Replacement Schedule', category: 'Filters Page Controls', icon: 'upload' },
  { id: 'replacement_schedule.review', label: 'Review Replacement Schedule', category: 'Filters Page Controls', icon: 'clipboard-check' },
  { id: 'replacement_schedule.approve', label: 'Approve Replacement Schedule', category: 'Filters Page Controls', icon: 'check-circle' },

  // Block Change
  { id: 'block_change.request', label: 'Request Block Change', category: 'Filter Management', icon: 'refresh' },
  { id: 'block_change.approve', label: 'Approve Block Change', category: 'Filter Management', icon: 'check-circle' },

  // Cleaning Profiles
  { id: 'cleaning_profiles.view', label: 'View Cleaning Profiles', category: 'Cleaning Profiles', icon: 'eye' },
  { id: 'cleaning_profiles.create', label: 'Create Cleaning Profiles', category: 'Cleaning Profile Page Controls', icon: 'plus' },
  { id: 'cleaning_profiles.edit', label: 'Edit Cleaning Profiles', category: 'Cleaning Profile Page Controls', icon: 'edit' },
  { id: 'cleaning_profiles.delete', label: 'Delete Cleaning Profiles', category: 'Cleaning Profile Page Controls', icon: 'trash' },
  { id: 'cleaning_profiles.toggle', label: 'Enable / Disable Cleaning Profiles', category: 'Cleaning Profile Page Controls', icon: 'toggle' },


  // Cleaning Cycles
  { id: 'cycles.view', label: 'View Cleaning Cycles', category: 'Cleaning Cycles', icon: 'refresh' },

  // PM Schedules
  { id: 'pm.view', label: 'View PM Schedules', category: 'PM Schedules', icon: 'eye' },
  { id: 'pm.create', label: 'Create PM Schedules', category: 'PM Schedules', icon: 'plus' },
  { id: 'pm.edit', label: 'Edit PM Schedules', category: 'PM Schedules', icon: 'edit' },
  { id: 'pm.delete', label: 'Delete PM Schedules', category: 'PM Schedules', icon: 'trash' },
  { id: 'pm.execute', label: 'Execute PM Tasks', category: 'PM Schedules', icon: 'play' },
  { id: 'pm.approve', label: 'Approve PM Schedules', category: 'PM Schedules', icon: 'check-circle' },
  { id: 'pm.review', label: 'Review PM Schedules', category: 'PM Schedules', icon: 'clipboard-check' },
  { id: 'pm.download_template', label: 'Download PM Template', category: 'PM Page Controls', icon: 'download' },
  { id: 'pm.upload', label: 'Upload PM Schedules', category: 'PM Page Controls', icon: 'upload' },
  { id: 'pm.edit_entry', label: 'Edit PM Entries', category: 'PM Page Controls', icon: 'edit' },
  { id: 'pm.resubmit', label: 'Resubmit Rejected Entries', category: 'PM Page Controls', icon: 'refresh' },

  // Equipment Groups
  { id: 'equipment_groups.view', label: 'View Equipment Groups', category: 'Equipment Group Controls', icon: 'eye' },
  { id: 'equipment_groups.create', label: 'Create Equipment Groups', category: 'Equipment Group Controls', icon: 'plus' },
  { id: 'equipment_groups.edit', label: 'Edit Equipment Groups', category: 'Equipment Group Controls', icon: 'edit' },
  { id: 'equipment_groups.delete', label: 'Delete Equipment Groups', category: 'Equipment Group Controls', icon: 'trash' },

  // UNS
  { id: 'uns.view', label: 'View UNS', category: 'UNS', icon: 'network' },
  { id: 'uns.manage', label: 'Manage UNS', category: 'UNS', icon: 'network' },

  // Admin Requests
  { id: 'admin_requests.view', label: 'Review Admin Requests', category: 'User Management', icon: 'inbox' },

  // Debug Traces
  { id: 'debug.view', label: 'View Debug Traces', category: 'Debug Traces', icon: 'terminal' },
  { id: 'debug.manage', label: 'Manage Debug Traces', category: 'Debug Traces', icon: 'terminal' },

  // Report Templates
  { id: 'report_templates.view', label: 'View Report Templates', category: 'Reports', icon: 'file-text' },
  { id: 'report_templates.create', label: 'Create Report Templates', category: 'Reports', icon: 'plus' },
  { id: 'report_templates.edit', label: 'Edit Report Templates', category: 'Reports', icon: 'edit' },
  { id: 'report_templates.delete', label: 'Delete Report Templates', category: 'Reports', icon: 'trash' },

  // Report Instances
  { id: 'reports.generate', label: 'Generate Reports', category: 'Reports', icon: 'play' },
  { id: 'reports.view', label: 'View Generated Reports', category: 'Reports', icon: 'eye' },
  { id: 'reports.sign', label: 'Sign Reports', category: 'Reports', icon: 'pen-tool' },
  { id: 'reports.delete', label: 'Delete Reports', category: 'Reports', icon: 'trash' },
  { id: 'reports.export', label: 'Export Report PDFs', category: 'Reports', icon: 'download' },

  // Audit / Versions (2026-05-02)
  { id: 'version_history.view', label: 'View Version History', category: 'Audit / Versions', icon: 'history' },
];

/**
 * Feature privilege categories, auto-grouped from FEATURE_PRIVILEGES.
 */
export const FEATURE_PRIVILEGE_CATEGORIES = FEATURE_PRIVILEGES.reduce((acc, feature) => {
  if (!acc[feature.category]) acc[feature.category] = [];
  acc[feature.category].push(feature);
  return acc;
}, {} as Record<string, FeaturePrivilege[]>);

/**
 * Maps feature privilege IDs to permission constants used by the API.
 * When a feature privilege is enabled/disabled in the Role Privileges page,
 * these permission constants are synced to the role's permissions array.
 *
 * **Two kinds of permission constants appear in this map — both are legitimate:**
 *
 * 1. **Backend-enforced perms** (e.g. `FCP_CREATE`, `ASSET_CREATE`, `PM_READ`):
 *    Used by `requirePermission(...)` on a real route. These are the "real
 *    gates" — the route returns 403 without them.
 *
 * 2. **FE-only display flags** (e.g. `CHECKLIST_CREATE`, `CP_PAGE_CREATE`,
 *    `EG_VIEW`, `ALARM_VIEW`, `AUDIT_EXPORT`, `NOTIFICATION_VIEW`):
 *    Used only on the React side via `perms.includes(...)` to gate UI
 *    visibility (show/hide a button or page). They do NOT appear in any
 *    `requirePermission(...)` call on the backend. The backend gate for the
 *    same action is the companion backend perm granted alongside it in this
 *    map (e.g. `checklists.create` grants BOTH `CHECKLIST_CREATE` for the
 *    FE button AND `FCP_CREATE` for the API route).
 *
 * **Do not "fix" a FE-only flag by adding it to `requirePermission(...)`
 * unilaterally** — that breaks the two-layer design and forces a seed.ts
 * change for any role that should keep the toggle enabled. If a FE flag's
 * companion backend perm is missing or wrong (e.g. the toggle grants `X` but
 * the route requires `Y`), fix the mismatch in this map and/or the route,
 * not by promoting the FE flag.
 *
 * **Not seeded ≠ broken.** A FE-only flag never needs to appear in
 * `apps/api/prisma/seed.ts` because it gets attached to a role at runtime
 * when an admin toggles the corresponding feature on the Role Privileges
 * page. The 16 currently-unseeded perms (CHECKLIST_*, CP_PAGE_*, CP_TOGGLE,
 * EG_*, PM_DOWNLOAD_TEMPLATE/UPLOAD/EDIT_ENTRY/RESUBMIT) all fall in this
 * category — they're correctly designed FE-only flags.
 */
export const FEATURE_TO_PERMISSION_MAP: Record<string, string[]> = {
  // User Management
  'users.create': ['USER_CREATE', 'USER_READ'],
  'users.view': ['USER_READ'],
  'users.edit': ['USER_UPDATE', 'USER_READ'],
  'users.delete': ['USER_DELETE', 'USER_READ'],
  'users.enable_disable': ['USER_ENABLE_DISABLE', 'USER_READ'],
  'users.unlock': ['USER_UNLOCK', 'USER_READ'],
  'users.reset_password': ['USER_RESET_PASSWORD', 'USER_READ'],

  // System
  'config.view': ['CONFIG_READ'],
  'config.edit': ['CONFIG_UPDATE', 'CONFIG_READ'],
  'config.field_ids': ['FIELD_ID_UPDATE', 'CONFIG_READ'],
  'roles.manage': ['ROLE_MANAGE'],
  'notifications.view': ['NOTIFICATION_VIEW'],
  'notifications.manage': ['NOTIFICATION_MANAGE', 'NOTIFICATION_CREATE', 'NOTIFICATION_UPDATE', 'NOTIFICATION_DELETE', 'NOTIFICATION_VIEW'],
  'notifications.delete': ['NOTIFICATION_DELETE'],
  'audit.view': ['AUDIT_READ'],
  'audit.export': ['AUDIT_EXPORT', 'AUDIT_READ'],

  // Asset Management
  'assets.view': ['ASSET_VIEW', 'ASSET_READ'],
  'assets.create': ['ASSET_CREATE', 'ASSET_VIEW', 'ASSET_READ'],
  'assets.edit': ['ASSET_UPDATE', 'ASSET_VIEW', 'ASSET_READ'],
  'assets.delete': ['ASSET_DELETE', 'ASSET_VIEW', 'ASSET_READ'],

  // Asset Relationships
  'assets.relationships.create': ['ASSET_RELATIONSHIP_CREATE', 'ASSET_VIEW'],
  'assets.relationships.delete': ['ASSET_RELATIONSHIP_DELETE', 'ASSET_VIEW'],

  // Asset Identifiers
  'assets.identifiers.create': ['ASSET_IDENTIFIER_CREATE', 'ASSET_VIEW'],
  'assets.identifiers.delete': ['ASSET_IDENTIFIER_DELETE', 'ASSET_VIEW'],

  // Dashboards
  'dashboard.view': ['DASHBOARD_VIEW'],
  'dashboard.create': ['DASHBOARD_CREATE', 'DASHBOARD_VIEW'],
  'dashboard.manage': ['DASHBOARD_MANAGE', 'DASHBOARD_VIEW'],
  'dashboard.assign': ['DASHBOARD_ASSIGN', 'DASHBOARD_VIEW'],

  // Checklists
  'checklists.submit': ['CHECKLIST_SUBMIT'],
  'checklists.create': ['CHECKLIST_CREATE', 'FCP_CREATE'],
  'checklists.edit': ['CHECKLIST_EDIT', 'FCP_UPDATE'],
  'checklists.delete': ['CHECKLIST_DELETE', 'FCP_DELETE'],
  'checklists.toggle': ['CHECKLIST_TOGGLE', 'FCP_UPDATE'],

  // Filter Management
  'filters.operate': ['FILTER_OPERATE', 'ASSET_READ'],
  'filters.bypass': ['FILTER_BYPASS', 'ASSET_READ'],
  'filters.events': ['EVENT_READ', 'ASSET_READ'],

  // Filters Page Controls
  'filters.bulk_upload': ['FILTER_BULK_UPLOAD', 'ASSET_CREATE'],
  'filters.retire': ['FILTER_RETIRE', 'FILTER_OPERATE', 'ASSET_READ'],
  'filters.replace': ['FILTER_REPLACE', 'FILTER_OPERATE', 'ASSET_READ'],
  'filters.status_update': ['FILTER_STATUS_UPDATE', 'ASSET_UPDATE', 'ASSET_READ'],
  'filters.hierarchy_create': ['FILTER_HIERARCHY_CREATE', 'ASSET_CREATE', 'ASSET_READ'],
  'filters.rfid_manage': ['FILTER_RFID_MANAGE', 'ASSET_IDENTIFIER_CREATE', 'ASSET_READ'],
  'replacement_schedule.view': ['REPLACEMENT_SCHEDULE_VIEW', 'REPLACEMENT_SCHEDULE_UPLOAD'],
  'replacement_schedule.upload': ['REPLACEMENT_SCHEDULE_UPLOAD'],
  'replacement_schedule.review': ['REPLACEMENT_SCHEDULE_REVIEW', 'REPLACEMENT_SCHEDULE_VIEW'],
  'replacement_schedule.approve': ['REPLACEMENT_SCHEDULE_APPROVE', 'REPLACEMENT_SCHEDULE_VIEW'],

  // Block Change
  'block_change.request': ['BLOCK_CHANGE_REQUEST'],
  'block_change.approve': ['BLOCK_CHANGE_APPROVE'],

  // Cleaning Profiles
  'cleaning_profiles.view': ['FCP_READ'],
  'cleaning_profiles.create': ['CP_PAGE_CREATE', 'FCP_CREATE', 'FCP_READ'],
  'cleaning_profiles.edit': ['CP_PAGE_EDIT', 'FCP_UPDATE', 'FCP_READ'],
  'cleaning_profiles.delete': ['CP_PAGE_DELETE', 'FCP_DELETE', 'FCP_READ'],
  'cleaning_profiles.toggle': ['CP_TOGGLE', 'FCP_UPDATE', 'FCP_READ'],

  // Equipment Groups
  'equipment_groups.view': ['EG_VIEW', 'ASSET_READ'],
  'equipment_groups.create': ['EG_CREATE', 'ASSET_CREATE', 'ASSET_READ'],
  'equipment_groups.edit': ['EG_EDIT', 'ASSET_UPDATE', 'ASSET_READ'],
  'equipment_groups.delete': ['EG_DELETE', 'ASSET_DELETE', 'ASSET_READ'],

  // Cleaning Cycles
  'cycles.view': ['CYCLE_READ'],

  // PM Schedules
  'pm.view': ['PM_READ'],
  'pm.create': ['PM_CREATE', 'PM_READ'],
  'pm.edit': ['PM_UPDATE', 'PM_READ'],
  'pm.delete': ['PM_DELETE', 'PM_READ'],
  'pm.execute': ['PM_EXECUTE', 'PM_READ'],
  'pm.approve': ['PM_APPROVE', 'PM_READ'],
  'pm.review': ['PM_REVIEW', 'PM_READ'],
  'pm.download_template': ['PM_DOWNLOAD_TEMPLATE', 'PM_READ'],
  'pm.upload': ['PM_UPLOAD', 'PM_CREATE', 'PM_READ'],
  'pm.edit_entry': ['PM_EDIT_ENTRY', 'PM_UPDATE', 'PM_READ'],
  'pm.resubmit': ['PM_RESUBMIT', 'PM_CREATE', 'PM_READ'],

  // UNS
  'uns.view': ['UNS_VIEW'],
  'uns.manage': ['UNS_MANAGE'],

  // Admin Requests (2026-05-04 — fix C4 privilege escalation)
  'admin_requests.view': ['ADMIN_REQUEST_REVIEW'],

  // Debug Traces
  'debug.view': ['READ_DEBUG_TRACE'],
  'debug.manage': ['MANAGE_DEBUG_TRACE'],

  // Report Templates
  'report_templates.view': ['REPORT_TEMPLATE_READ'],
  'report_templates.create': ['REPORT_TEMPLATE_CREATE', 'REPORT_TEMPLATE_READ'],
  'report_templates.edit': ['REPORT_TEMPLATE_UPDATE', 'REPORT_TEMPLATE_READ'],
  'report_templates.delete': ['REPORT_TEMPLATE_DELETE', 'REPORT_TEMPLATE_READ'],

  // Report Instances
  'reports.generate': ['REPORT_GENERATE', 'REPORT_VIEW'],
  'reports.view': ['REPORT_VIEW'],
  'reports.sign': ['REPORT_SIGN', 'REPORT_VIEW'],
  'reports.delete': ['REPORT_DELETE', 'REPORT_VIEW'],
  'reports.export': ['REPORT_EXPORT', 'REPORT_VIEW'],

  // Audit / Versions (2026-05-02): cross-entity history viewer.
  'version_history.view': ['VERSION_HISTORY_VIEW'],
};
