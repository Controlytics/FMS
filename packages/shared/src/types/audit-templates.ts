export interface AuditTemplateDefinition {
  label: string;
  category: string;
  template: string;
  placeholders: string[];
}

export const AUDIT_TEMPLATE_CATEGORIES = [
  'User Management',
  'Authentication',
  'Configuration',
  'Role Management',
  'Backup',
  'Data & Approvals',
  'Asset Management',
] as const;

export type AuditTemplateCategory = (typeof AUDIT_TEMPLATE_CATEGORIES)[number];

export const AUDIT_TEMPLATE_DEFAULTS: Record<string, AuditTemplateDefinition> = {
  // User Management
  USER_CREATED: {
    label: 'User Created',
    category: 'User Management',
    template: 'User "{targetUser}" created by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  USER_UPDATED: {
    label: 'User Updated',
    category: 'User Management',
    template: 'User "{targetUser}" updated by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  USER_UPDATED_SELF: {
    label: 'User Updated (Self)',
    category: 'User Management',
    template: 'User "{actor}" updated their own account',
    placeholders: ['actor'],
  },
  USER_DELETED: {
    label: 'User Deleted',
    category: 'User Management',
    template: 'User "{targetUser}" disabled by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  BULK_USER_DELETED: {
    label: 'Bulk User Delete',
    category: 'User Management',
    template: 'Multiple users deleted in bulk by {actor}',
    placeholders: ['actor'],
  },
  USER_ENABLED: {
    label: 'User Enabled',
    category: 'User Management',
    template: 'User "{targetUser}" enabled by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  USER_DISABLED: {
    label: 'User Disabled',
    category: 'User Management',
    template: 'User "{targetUser}" disabled by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  ACCOUNT_LOCKED: {
    label: 'Account Locked',
    category: 'User Management',
    template: 'Account "{targetUser}" locked due to failed login attempts',
    placeholders: ['targetUser'],
  },
  ACCOUNT_UNLOCKED: {
    label: 'Account Unlocked',
    category: 'User Management',
    template: 'Account "{targetUser}" unlocked by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  ROLE_ASSIGNED: {
    label: 'Role Assigned',
    category: 'User Management',
    template: 'Role assigned to "{targetUser}" by {actor}',
    placeholders: ['actor', 'targetUser'],
  },

  // Password actions
  PROFILE_UPDATED: {
    label: 'Profile Updated',
    category: 'User Management',
    template: 'Profile updated for "{targetUser}" by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  PROFILE_UPDATED_SELF: {
    label: 'Profile Updated (Self)',
    category: 'User Management',
    template: 'User "{actor}" updated their own profile',
    placeholders: ['actor'],
  },
  PASSWORD_CHANGED: {
    label: 'Password Changed',
    category: 'User Management',
    template: 'Password changed for "{targetUser}" by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  PASSWORD_CHANGED_SELF: {
    label: 'Password Changed (Self)',
    category: 'User Management',
    template: 'User "{actor}" changed their own password',
    placeholders: ['actor'],
  },
  PASSWORD_RESET: {
    label: 'Password Reset',
    category: 'User Management',
    template: 'Password reset for "{targetUser}" by {actor}',
    placeholders: ['actor', 'targetUser'],
  },
  PASSWORD_EXPIRED: {
    label: 'Password Expired',
    category: 'User Management',
    template: 'Password expired for "{targetUser}"',
    placeholders: ['targetUser'],
  },

  // Authentication
  LOGIN_SUCCESS: {
    label: 'Login Success',
    category: 'Authentication',
    template: 'User "{actor}" logged in successfully',
    placeholders: ['actor'],
  },
  LOGIN: {
    label: 'Login',
    category: 'Authentication',
    template: 'User "{actor}" logged in successfully',
    placeholders: ['actor'],
  },
  LOGIN_FAILED: {
    label: 'Login Failed',
    category: 'Authentication',
    template: 'Failed login attempt for "{actor}"',
    placeholders: ['actor'],
  },
  LOGOUT: {
    label: 'Logout',
    category: 'Authentication',
    template: 'User "{actor}" logged out',
    placeholders: ['actor'],
  },
  SESSION_TIMEOUT: {
    label: 'Session Timeout',
    category: 'Authentication',
    template: 'Session timed out for "{actor}"',
    placeholders: ['actor'],
  },
  FORCED_LOGOUT: {
    label: 'Forced Logout',
    category: 'Authentication',
    template: 'Previous sessions terminated for "{targetUser}"',
    placeholders: ['targetUser', 'actor'],
  },

  // Configuration
  CONFIG_CHANGED: {
    label: 'Config Changed',
    category: 'Configuration',
    template: 'Configuration "{configKey}" updated by {actor}',
    placeholders: ['actor', 'configKey'],
  },

  // Role Management
  ROLE_CREATED: {
    label: 'Role Created',
    category: 'Role Management',
    template: 'Role "{targetName}" created by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ROLE_UPDATED: {
    label: 'Role Updated',
    category: 'Role Management',
    template: 'Role "{targetName}" updated by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ROLE_DELETED: {
    label: 'Role Deleted',
    category: 'Role Management',
    template: 'Role "{targetName}" deleted by {actor}',
    placeholders: ['actor', 'targetName'],
  },

  // Backup
  BACKUP_CREATED: {
    label: 'Backup Created',
    category: 'Backup',
    template: 'Database backup created by {actor}',
    placeholders: ['actor'],
  },
  BACKUP_RESTORED: {
    label: 'Backup Restored',
    category: 'Backup',
    template: 'Database restored from backup by {actor}',
    placeholders: ['actor'],
  },

  // Data & Approvals
  DATA_VIEWED: {
    label: 'Data Viewed',
    category: 'Data & Approvals',
    template: '{targetType} viewed by {actor}',
    placeholders: ['actor', 'targetType'],
  },
  DATA_EXPORTED: {
    label: 'Data Exported',
    category: 'Data & Approvals',
    template: '{targetType} exported by {actor}',
    placeholders: ['actor', 'targetType'],
  },
  APPROVAL_REQUESTED: {
    label: 'Approval Requested',
    category: 'Data & Approvals',
    template: 'Approval requested for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  APPROVAL_GRANTED: {
    label: 'Approval Granted',
    category: 'Data & Approvals',
    template: 'Approval granted for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  APPROVAL_REJECTED: {
    label: 'Approval Rejected',
    category: 'Data & Approvals',
    template: 'Approval rejected for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  UNAUTHORIZED_ACTION_ATTEMPT: {
    label: 'Unauthorized Action',
    category: 'Data & Approvals',
    template: 'Unauthorized action attempted by {actor}',
    placeholders: ['actor'],
  },

  // Asset Management
  TEMPLATE_CREATED: {
    label: 'Template Created',
    category: 'Asset Management',
    template: 'Asset template "{targetName}" created by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  TEMPLATE_MODIFIED: {
    label: 'Template Modified',
    category: 'Asset Management',
    template: 'Asset template "{targetName}" modified by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  TEMPLATE_DELETED: {
    label: 'Template Deleted',
    category: 'Asset Management',
    template: 'Asset template "{targetName}" deleted by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_CREATED: {
    label: 'Asset Created',
    category: 'Asset Management',
    template: 'Asset "{targetName}" created by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_MODIFIED: {
    label: 'Asset Modified',
    category: 'Asset Management',
    template: 'Asset "{targetName}" modified by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_DECOMMISSIONED: {
    label: 'Asset Decommissioned',
    category: 'Asset Management',
    template: 'Asset "{targetName}" decommissioned by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_ATTRIBUTE_CHANGED: {
    label: 'Asset Attribute Changed',
    category: 'Asset Management',
    template: 'Attribute "{fieldName}" of asset "{targetName}" changed by {actor}',
    placeholders: ['actor', 'targetName', 'fieldName'],
  },
  ASSET_RELATIONSHIP_CREATED: {
    label: 'Relationship Created',
    category: 'Asset Management',
    template: 'Relationship created between "{sourceName}" and "{targetName}" by {actor}',
    placeholders: ['actor', 'sourceName', 'targetName'],
  },
  ASSET_RELATIONSHIP_DELETED: {
    label: 'Relationship Deleted',
    category: 'Asset Management',
    template: 'Relationship between "{sourceName}" and "{targetName}" deleted by {actor}',
    placeholders: ['actor', 'sourceName', 'targetName'],
  },
  CHECKLIST_PERFORMED: {
    label: 'Checklist Performed',
    category: 'Asset Management',
    template: 'Checklist "{checklistName}" performed on asset "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName', 'checklistName'],
  },
  CHECKLIST_CHECKED: {
    label: 'Checklist Checked',
    category: 'Asset Management',
    template: 'Checklist "{checklistName}" checked on asset "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName', 'checklistName'],
  },
  CHECKLIST_VERIFIED: {
    label: 'Checklist Verified',
    category: 'Asset Management',
    template: 'Checklist "{checklistName}" verified on asset "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName', 'checklistName'],
  },
  CHECKLIST_REJECTED: {
    label: 'Checklist Rejected',
    category: 'Asset Management',
    template: 'Checklist "{checklistName}" rejected on asset "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName', 'checklistName'],
  },
  ALARM_TRIGGERED: {
    label: 'Alarm Triggered',
    category: 'Asset Management',
    template: 'Alarm "{alarmName}" triggered on asset "{targetName}"',
    placeholders: ['targetName', 'alarmName'],
  },
  ALARM_ACKNOWLEDGED: {
    label: 'Alarm Acknowledged',
    category: 'Asset Management',
    template: 'Alarm "{alarmName}" on asset "{targetName}" acknowledged by {actor}',
    placeholders: ['actor', 'targetName', 'alarmName'],
  },
  ALARM_CLOSED: {
    label: 'Alarm Closed',
    category: 'Asset Management',
    template: 'Alarm "{alarmName}" on asset "{targetName}" closed by {actor}',
    placeholders: ['actor', 'targetName', 'alarmName'],
  },
};

/** Extract just the template strings as defaults for the config schema */
export function getDefaultTemplates(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, def] of Object.entries(AUDIT_TEMPLATE_DEFAULTS)) {
    result[key] = def.template;
  }
  return result;
}
