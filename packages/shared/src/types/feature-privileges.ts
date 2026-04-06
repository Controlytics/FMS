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
  { id: 'backup.manage', label: 'Manage Backups', category: 'System', icon: 'archive' },


  // Organization Management
  { id: 'org.view', label: 'View Organizations', category: 'System', icon: 'building' },
  { id: 'org.manage', label: 'Manage Organizations', category: 'System', icon: 'building' },

  // Entity Management
  { id: 'assets.view', label: 'View Entities', category: 'Entity Management', icon: 'eye' },
  { id: 'assets.create', label: 'Create Entities', category: 'Entity Management', icon: 'plus' },
  { id: 'assets.edit', label: 'Edit Entities', category: 'Entity Management', icon: 'edit' },
  { id: 'assets.delete', label: 'Delete Entities', category: 'Entity Management', icon: 'trash' },
  { id: 'assets.assign', label: 'Assign Entities', category: 'Entity Management', icon: 'link' },

  // Entity Templates
  { id: 'assets.templates.create', label: 'Create Templates', category: 'Entity Templates', icon: 'template' },
  { id: 'assets.templates.edit', label: 'Edit Templates', category: 'Entity Templates', icon: 'template' },
  { id: 'assets.templates.delete', label: 'Delete Templates', category: 'Entity Templates', icon: 'template' },

  // Entity Relationships
  { id: 'assets.relationships.create', label: 'Create Relationships', category: 'Entity Relationships', icon: 'link' },
  { id: 'assets.relationships.delete', label: 'Delete Relationships', category: 'Entity Relationships', icon: 'link' },

  // Entity Identifiers
  { id: 'assets.identifiers.create', label: 'Create Identifiers', category: 'Entity Identifiers', icon: 'qrcode' },
  { id: 'assets.identifiers.delete', label: 'Delete Identifiers', category: 'Entity Identifiers', icon: 'qrcode' },

  // Dashboards
  { id: 'dashboard.view', label: 'View Dashboards', category: 'Dashboards', icon: 'layout' },
  { id: 'dashboard.create', label: 'Create Dashboards', category: 'Dashboards', icon: 'plus' },
  { id: 'dashboard.manage', label: 'Manage Dashboards', category: 'Dashboards', icon: 'settings' },
  { id: 'dashboard.assign', label: 'Assign Dashboards', category: 'Dashboards', icon: 'link' },

  // Rule Chains
  { id: 'rulechains.view', label: 'View Rule Chains', category: 'Rule Chains', icon: 'eye' },
  { id: 'rulechains.create', label: 'Create Rule Chains', category: 'Rule Chains', icon: 'workflow' },
  { id: 'rulechains.edit', label: 'Edit Rule Chains', category: 'Rule Chains', icon: 'workflow' },
  { id: 'rulechains.delete', label: 'Delete Rule Chains', category: 'Rule Chains', icon: 'workflow' },

  // Alarms
  { id: 'alarms.view', label: 'View Alarms', category: 'Alarms', icon: 'alert-triangle' },
  { id: 'alarms.acknowledge', label: 'Acknowledge Alarms', category: 'Alarms', icon: 'check-circle' },
  { id: 'alarms.clear', label: 'Clear Alarms', category: 'Alarms', icon: 'bell-ring' },

  // Checklists
  { id: 'checklists.submit', label: 'Submit Checklists', category: 'Checklists', icon: 'clipboard-check' },

  // Filter Management
  { id: 'filters.operate', label: 'Operate Filters (Start/Advance Cycles)', category: 'Filter Management', icon: 'filter' },
  { id: 'filters.bypass', label: 'Bypass Filter Stages (Deviation)', category: 'Filter Management', icon: 'alert-circle' },
  { id: 'filters.events', label: 'View Filter Events', category: 'Filter Management', icon: 'list' },

  // Cleaning Profiles
  { id: 'cleaning_profiles.view', label: 'View Cleaning Profiles', category: 'Cleaning Profiles', icon: 'eye' },
  { id: 'cleaning_profiles.create', label: 'Create Cleaning Profiles', category: 'Cleaning Profiles', icon: 'plus' },
  { id: 'cleaning_profiles.edit', label: 'Edit Cleaning Profiles', category: 'Cleaning Profiles', icon: 'edit' },
  { id: 'cleaning_profiles.delete', label: 'Delete Cleaning Profiles', category: 'Cleaning Profiles', icon: 'trash' },

  // Filter Profiles
  { id: 'filter_profiles.view', label: 'View Filter Profiles', category: 'Filter Profiles', icon: 'eye' },
  { id: 'filter_profiles.create', label: 'Create Filter Profiles', category: 'Filter Profiles', icon: 'plus' },
  { id: 'filter_profiles.edit', label: 'Edit Filter Profiles', category: 'Filter Profiles', icon: 'edit' },
  { id: 'filter_profiles.delete', label: 'Delete Filter Profiles', category: 'Filter Profiles', icon: 'trash' },
  { id: 'filter_profiles.assign', label: 'Assign Filter Profiles', category: 'Filter Profiles', icon: 'link' },

  // Cleaning Cycles
  { id: 'cycles.view', label: 'View Cleaning Cycles', category: 'Cleaning Cycles', icon: 'refresh' },

  // PM Schedules
  { id: 'pm.view', label: 'View PM Schedules', category: 'PM Schedules', icon: 'eye' },
  { id: 'pm.create', label: 'Create PM Schedules', category: 'PM Schedules', icon: 'plus' },
  { id: 'pm.edit', label: 'Edit PM Schedules', category: 'PM Schedules', icon: 'edit' },
  { id: 'pm.delete', label: 'Delete PM Schedules', category: 'PM Schedules', icon: 'trash' },
  { id: 'pm.execute', label: 'Execute PM Tasks', category: 'PM Schedules', icon: 'play' },

  // UNS
  { id: 'uns.view', label: 'View UNS', category: 'UNS', icon: 'network' },
  { id: 'uns.manage', label: 'Manage UNS', category: 'UNS', icon: 'network' },

  // Admin Requests
  { id: 'admin_requests.view', label: 'Review Admin Requests', category: 'User Management', icon: 'inbox' },

  // Debug Traces
  { id: 'debug.view', label: 'View Debug Traces', category: 'Debug Traces', icon: 'terminal' },
  { id: 'debug.manage', label: 'Manage Debug Traces', category: 'Debug Traces', icon: 'terminal' },
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
  'backup.manage': ['BACKUP_MANAGE'],


  // Organization Management
  'org.view': ['ORG_VIEW'],
  'org.manage': ['ORG_MANAGE', 'ORG_CREATE', 'ORG_DELETE', 'ORG_VIEW'],

  // Entity Management
  'assets.view': ['ASSET_VIEW', 'ASSET_READ'],
  'assets.create': ['ASSET_CREATE', 'ASSET_VIEW', 'ASSET_READ'],
  'assets.edit': ['ASSET_UPDATE', 'ASSET_VIEW', 'ASSET_READ'],
  'assets.delete': ['ASSET_DELETE', 'ASSET_VIEW', 'ASSET_READ'],
  'assets.assign': ['ENTITY_ASSIGN', 'ASSET_VIEW'],

  // Entity Templates
  'assets.templates.create': ['ASSET_TEMPLATE_CREATE', 'ASSET_VIEW'],
  'assets.templates.edit': ['ASSET_TEMPLATE_UPDATE', 'ASSET_VIEW'],
  'assets.templates.delete': ['ASSET_TEMPLATE_DELETE', 'ASSET_VIEW'],

  // Entity Relationships
  'assets.relationships.create': ['ASSET_RELATIONSHIP_CREATE', 'ASSET_VIEW'],
  'assets.relationships.delete': ['ASSET_RELATIONSHIP_DELETE', 'ASSET_VIEW'],

  // Entity Identifiers
  'assets.identifiers.create': ['ASSET_IDENTIFIER_CREATE', 'ASSET_VIEW'],
  'assets.identifiers.delete': ['ASSET_IDENTIFIER_DELETE', 'ASSET_VIEW'],

  // Dashboards
  'dashboard.view': ['DASHBOARD_VIEW'],
  'dashboard.create': ['DASHBOARD_CREATE', 'DASHBOARD_VIEW'],
  'dashboard.manage': ['DASHBOARD_MANAGE', 'DASHBOARD_VIEW'],
  'dashboard.assign': ['DASHBOARD_ASSIGN', 'DASHBOARD_VIEW'],

  // Rule Chains
  'rulechains.view': ['RULE_CHAIN_VIEW'],
  'rulechains.create': ['RULE_CHAIN_CREATE'],
  'rulechains.edit': ['RULE_CHAIN_UPDATE'],
  'rulechains.delete': ['RULE_CHAIN_DELETE'],

  // Alarms
  'alarms.view': ['ALARM_VIEW', 'ASSET_VIEW'],
  'alarms.acknowledge': ['ALARM_ACKNOWLEDGE'],
  'alarms.clear': ['ALARM_CLEAR'],

  // Checklists
  'checklists.submit': ['CHECKLIST_SUBMIT'],

  // Filter Management
  'filters.operate': ['FILTER_OPERATE', 'ASSET_READ'],
  'filters.bypass': ['FILTER_BYPASS', 'ASSET_READ'],
  'filters.events': ['EVENT_READ', 'ASSET_READ'],

  // Cleaning Profiles
  'cleaning_profiles.view': ['FCP_READ'],
  'cleaning_profiles.create': ['FCP_CREATE', 'FCP_READ'],
  'cleaning_profiles.edit': ['FCP_UPDATE', 'FCP_READ'],
  'cleaning_profiles.delete': ['FCP_DELETE', 'FCP_READ'],

  // Filter Profiles
  'filter_profiles.view': ['FP_READ'],
  'filter_profiles.create': ['FP_CREATE', 'FP_READ'],
  'filter_profiles.edit': ['FP_UPDATE', 'FP_READ'],
  'filter_profiles.delete': ['FP_DELETE', 'FP_READ'],
  'filter_profiles.assign': ['FP_ASSIGN', 'FP_READ'],

  // Cleaning Cycles
  'cycles.view': ['CYCLE_READ'],

  // PM Schedules
  'pm.view': ['PM_READ'],
  'pm.create': ['PM_CREATE', 'PM_READ'],
  'pm.edit': ['PM_UPDATE', 'PM_READ'],
  'pm.delete': ['PM_DELETE', 'PM_READ'],
  'pm.execute': ['PM_EXECUTE', 'PM_READ'],

  // UNS
  'uns.view': ['UNS_VIEW'],
  'uns.manage': ['UNS_MANAGE'],

  // Admin Requests
  'admin_requests.view': ['USER_CREATE'],

  // Debug Traces
  'debug.view': ['READ_DEBUG_TRACE'],
  'debug.manage': ['MANAGE_DEBUG_TRACE'],
};
