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

  // Data Ingestion & Integration (Phase A)
  ACKNOWLEDGE_ALARM: { label: 'Acknowledge Alarm', category: 'Alarms' },
  CLEAR_ALARM: { label: 'Clear Alarm', category: 'Alarms' },
  SUBMIT_CHECKLIST_WITH_SIGNATURE: { label: 'Submit Checklist with Signature', category: 'Checklist' },
  REVIEW_CHECKLIST: { label: 'Review Checklist', category: 'Checklist' },
  APPROVE_CHECKLIST: { label: 'Approve Checklist', category: 'Checklist' },
  CREATE_RULE_CHAIN: { label: 'Create Rule Chain', category: 'Rule Chain' },
  UPDATE_RULE_CHAIN: { label: 'Update Rule Chain', category: 'Rule Chain' },
  DELETE_RULE_CHAIN: { label: 'Delete Rule Chain', category: 'Rule Chain' },
  SET_ROOT_RULE_CHAIN: { label: 'Set Root Rule Chain', category: 'Rule Chain' },
  IMPORT_RULE_CHAIN: { label: 'Import Rule Chain', category: 'Rule Chain' },
  REGENERATE_CREDENTIALS: { label: 'Regenerate Device Credentials', category: 'Connectivity' },
  OVERRIDE_UNS_PATH: { label: 'Override UNS Path', category: 'UNS' },
  UPDATE_UNS_CONFIG: { label: 'Update UNS Config', category: 'UNS' },
  CREATE_HELP_ARTICLE: { label: 'Create Help Article', category: 'Help' },
  UPDATE_HELP_ARTICLE: { label: 'Update Help Article', category: 'Help' },
  DELETE_HELP_ARTICLE: { label: 'Delete Help Article', category: 'Help' },
  UPDATE_RETENTION_POLICY: { label: 'Update Retention Policy', category: 'Retention' },
  ARCHIVE_DATA: { label: 'Archive Data', category: 'Retention' },
  EXECUTE_RETENTION: { label: 'Execute Retention', category: 'Retention' },
  UPDATE_SYSTEM_CONFIG: { label: 'Update System Config', category: 'System Config' },
  RESTART_SERVER: { label: 'Restart Server', category: 'System Config' },

  // Phase 2: Filter Management
  START_CLEANING_CYCLE: { label: 'Start Cleaning Cycle', category: 'Filter Management' },
  BYPASS_FILTER_STAGE: { label: 'Bypass Filter Stage (Deviation)', category: 'Filter Management' },
  TERMINATE_CLEANING_CYCLE: { label: 'Terminate Cleaning Cycle', category: 'Filter Management' },
  CREATE_CLEANING_PROFILE: { label: 'Create Cleaning Profile', category: 'Cleaning Profiles' },
  UPDATE_CLEANING_PROFILE: { label: 'Update Cleaning Profile', category: 'Cleaning Profiles' },
  DELETE_CLEANING_PROFILE: { label: 'Delete Cleaning Profile', category: 'Cleaning Profiles' },
  CREATE_FILTER_PROFILE: { label: 'Create Filter Profile', category: 'Filter Profiles' },
  UPDATE_FILTER_PROFILE: { label: 'Update Filter Profile', category: 'Filter Profiles' },
  DELETE_FILTER_PROFILE: { label: 'Delete Filter Profile', category: 'Filter Profiles' },
  ASSIGN_FILTER_PROFILE: { label: 'Assign Filter Profile', category: 'Filter Profiles' },
  CREATE_PM_SCHEDULE: { label: 'Create PM Schedule', category: 'PM Schedules' },
  UPDATE_PM_SCHEDULE: { label: 'Update PM Schedule', category: 'PM Schedules' },
  DELETE_PM_SCHEDULE: { label: 'Delete PM Schedule', category: 'PM Schedules' },
  CREATE_EQUIPMENT_GROUP: { label: 'Create Equipment Group', category: 'Equipment Groups' },
  UPDATE_EQUIPMENT_GROUP: { label: 'Update Equipment Group', category: 'Equipment Groups' },
  DELETE_EQUIPMENT_GROUP: { label: 'Delete Equipment Group', category: 'Equipment Groups' },
} as const;

export type ReauthAction = keyof typeof REAUTH_ACTIONS;

export const REAUTH_ACTION_CATEGORIES = [
  'User Management',
  'Configuration',
  'Role Management',
  'Backup',
  'Entity Management',
  'Alarms',
  'Checklist',
  'Rule Chain',
  'Connectivity',
  'UNS',
  'Help',
  'Retention',
  'System Config',
  'Filter Management',
  'Cleaning Profiles',
  'Filter Profiles',
  'PM Schedules',
  'Equipment Groups',
] as const;

export type ReauthActionCategory = (typeof REAUTH_ACTION_CATEGORIES)[number];
