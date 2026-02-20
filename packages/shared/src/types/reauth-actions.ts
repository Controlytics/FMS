export const REAUTH_ACTIONS = {
  // User Management
  CREATE_USER: { label: 'Create User', category: 'User Management' },
  UPDATE_USER: { label: 'Update User', category: 'User Management' },
  DELETE_USER: { label: 'Delete User', category: 'User Management' },
  BULK_DELETE_USERS: { label: 'Bulk Delete Users', category: 'User Management' },
  ENABLE_USER: { label: 'Enable User', category: 'User Management' },
  DISABLE_USER: { label: 'Disable User', category: 'User Management' },
  UNLOCK_USER: { label: 'Unlock User', category: 'User Management' },
  RESET_PASSWORD: { label: 'Reset Password', category: 'User Management' },
  PROCESS_RESET_REQUEST: { label: 'Process Reset Request', category: 'User Management' },

  // Config Changes
  UPDATE_PASSWORD_POLICY: { label: 'Update Password Policy', category: 'Configuration' },
  UPDATE_LOGIN_SECURITY: { label: 'Update Login Security', category: 'Configuration' },
  UPDATE_SESSION_CONFIG: { label: 'Update Session Config', category: 'Configuration' },
  UPDATE_DATETIME_CONFIG: { label: 'Update Date/Time Config', category: 'Configuration' },
  UPDATE_USERID_CONFIG: { label: 'Update User ID Config', category: 'Configuration' },
  UPDATE_BRANDING: { label: 'Update Branding', category: 'Configuration' },
  UPDATE_ROLE_CONFIG: { label: 'Update Role Config', category: 'Configuration' },

  // Role Management
  CREATE_ROLE: { label: 'Create Role', category: 'Role Management' },
  UPDATE_ROLE: { label: 'Update Role', category: 'Role Management' },
  DELETE_ROLE: { label: 'Delete Role', category: 'Role Management' },

  // Backup
  EXPORT_BACKUP: { label: 'Export Backup', category: 'Backup' },
  RESTORE_BACKUP: { label: 'Restore Backup', category: 'Backup' },

  // Entity Management
  CREATE_ASSET_TEMPLATE: { label: 'Create Entity Template', category: 'Entity Management' },
  UPDATE_ASSET_TEMPLATE: { label: 'Update Entity Template', category: 'Entity Management' },
  DELETE_ASSET_TEMPLATE: { label: 'Delete Entity Template', category: 'Entity Management' },
  CREATE_ASSET: { label: 'Create Entity', category: 'Entity Management' },
  UPDATE_ASSET: { label: 'Update Entity', category: 'Entity Management' },
  DELETE_ASSET: { label: 'Delete Entity', category: 'Entity Management' },
  CREATE_ASSET_RELATIONSHIP: { label: 'Create Entity Relationship', category: 'Entity Management' },
  DELETE_ASSET_RELATIONSHIP: { label: 'Delete Entity Relationship', category: 'Entity Management' },
  CREATE_ASSET_IDENTIFIER: { label: 'Create Entity Identifier', category: 'Entity Management' },
  DELETE_ASSET_IDENTIFIER: { label: 'Delete Entity Identifier', category: 'Entity Management' },
} as const;

export type ReauthAction = keyof typeof REAUTH_ACTIONS;

export const REAUTH_ACTION_CATEGORIES = [
  'User Management',
  'Configuration',
  'Role Management',
  'Backup',
  'Entity Management',
] as const;

export type ReauthActionCategory = (typeof REAUTH_ACTION_CATEGORIES)[number];
