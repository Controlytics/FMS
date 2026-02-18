export interface FeaturePrivilege {
  id: string;
  label: string;
  category: string;
  icon: string;
}

/**
 * Feature privileges for the Role Privileges configuration page.
 * Single source of truth — role-privileges.tsx imports this instead of hardcoding.
 * To add a new feature privilege: add it here and it will automatically appear
 * in the Role Privileges config page.
 */
export const FEATURE_PRIVILEGES: FeaturePrivilege[] = [
  // User Management
  { id: 'users.create', label: 'Create Users', category: 'User Management', icon: 'user-plus' },
  { id: 'users.edit', label: 'Edit Users', category: 'User Management', icon: 'user-edit' },
  { id: 'users.delete', label: 'Delete Users', category: 'User Management', icon: 'user-minus' },
  { id: 'users.reset_password', label: 'Reset Passwords', category: 'User Management', icon: 'key' },
  { id: 'users.unlock', label: 'Unlock Accounts', category: 'User Management', icon: 'unlock' },
  { id: 'users.enable_disable', label: 'Enable/Disable Accounts', category: 'User Management', icon: 'toggle' },

  // System
  { id: 'audit.view', label: 'View Audit Trail', category: 'System', icon: 'eye' },
  { id: 'audit.export', label: 'Export Audit Trail', category: 'System', icon: 'download' },
  { id: 'config.view', label: 'View Configuration', category: 'System', icon: 'settings' },
  { id: 'config.edit', label: 'Edit Configuration', category: 'System', icon: 'settings-edit' },
  { id: 'notifications.manage', label: 'Manage Notifications', category: 'System', icon: 'bell' },

  // Asset Management
  { id: 'assets.manage_templates', label: 'Manage Asset Templates', category: 'Asset Management', icon: 'template' },
  { id: 'assets.create_instances', label: 'Create Asset Instances', category: 'Asset Management', icon: 'plus-circle' },
  { id: 'assets.edit_instances', label: 'Edit Asset Instances', category: 'Asset Management', icon: 'edit' },
  { id: 'assets.manage_relationships', label: 'Manage Relationships', category: 'Asset Management', icon: 'link' },
  { id: 'assets.manage_identifiers', label: 'Manage Identifiers', category: 'Asset Management', icon: 'qr-code' },
  { id: 'assets.manage_checklists', label: 'Manage Checklists', category: 'Asset Management', icon: 'clipboard-check' },
  { id: 'assets.manage_schedules', label: 'Manage Schedules', category: 'Asset Management', icon: 'calendar' },
  { id: 'assets.configure_alarms', label: 'Configure Alarm Rules', category: 'Asset Management', icon: 'bell-alert' },
  { id: 'assets.decommission', label: 'Decommission Assets', category: 'Asset Management', icon: 'archive' },
  { id: 'assets.perform_checklists', label: 'Perform Checklists', category: 'Asset Management', icon: 'check-circle' },
];

/**
 * Feature privilege categories, auto-grouped from FEATURE_PRIVILEGES.
 */
export const FEATURE_PRIVILEGE_CATEGORIES = FEATURE_PRIVILEGES.reduce((acc, feature) => {
  if (!acc[feature.category]) acc[feature.category] = [];
  acc[feature.category].push(feature);
  return acc;
}, {} as Record<string, FeaturePrivilege[]>);
