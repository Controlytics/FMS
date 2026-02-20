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

  // Entity Management
  { id: 'assets.view', label: 'View Entities', category: 'Entity Management', icon: 'eye' },
  { id: 'assets.create', label: 'Create Entities', category: 'Entity Management', icon: 'plus' },
  { id: 'assets.edit', label: 'Edit Entities', category: 'Entity Management', icon: 'edit' },
  { id: 'assets.delete', label: 'Delete Entities', category: 'Entity Management', icon: 'trash' },
  { id: 'assets.templates', label: 'Manage Templates', category: 'Entity Management', icon: 'template' },
  { id: 'assets.relationships', label: 'Manage Relationships', category: 'Entity Management', icon: 'link' },
  { id: 'assets.identifiers', label: 'Manage Identifiers', category: 'Entity Management', icon: 'qrcode' },
];

/**
 * Feature privilege categories, auto-grouped from FEATURE_PRIVILEGES.
 */
export const FEATURE_PRIVILEGE_CATEGORIES = FEATURE_PRIVILEGES.reduce((acc, feature) => {
  if (!acc[feature.category]) acc[feature.category] = [];
  acc[feature.category].push(feature);
  return acc;
}, {} as Record<string, FeaturePrivilege[]>);
