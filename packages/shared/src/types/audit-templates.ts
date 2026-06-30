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
  'Entity Management',
  'Filter Management',
  'Filter Operations',
  'Cleaning Profiles',
  'Filter Profiles',
  'Equipment Groups',
  'PM Schedules',
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

  // Entity Template Management
  ASSET_TEMPLATE_CREATED: {
    label: 'Entity Template Created',
    category: 'Entity Management',
    template: 'New entity template "{targetName}" created with attribute schema, telemetry, and lifecycle configuration by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_TEMPLATE_UPDATED: {
    label: 'Entity Template Updated',
    category: 'Entity Management',
    template: 'Entity template "{targetName}" updated (new version {version}) by {actor}',
    placeholders: ['actor', 'targetName', 'version'],
  },
  ASSET_TEMPLATE_DELETED: {
    label: 'Entity Template Deactivated',
    category: 'Entity Management',
    template: 'Entity template "{targetName}" deactivated (soft-deleted) by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_TEMPLATE_VERSION_CREATED: {
    label: 'Template Version Created',
    category: 'Entity Management',
    template: 'Version {version} snapshot of entity template "{targetName}" created by {actor}',
    placeholders: ['actor', 'targetName', 'version'],
  },

  // Entity Instance Management
  ASSET_CREATED: {
    label: 'Entity Created',
    category: 'Entity Management',
    template: 'New entity "{targetName}" created from template by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_UPDATED: {
    label: 'Entity Updated',
    category: 'Entity Management',
    template: 'Entity "{targetName}" attributes and configuration updated by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ASSET_STATUS_CHANGED: {
    label: 'Entity Status Changed',
    category: 'Entity Management',
    template: 'Entity "{targetName}" status changed from "{beforeStatus}" to "{afterStatus}" by {actor}',
    placeholders: ['actor', 'targetName', 'beforeStatus', 'afterStatus'],
  },
  ASSET_DELETED: {
    label: 'Entity Deactivated',
    category: 'Entity Management',
    template: 'Entity "{targetName}" and its descendants deactivated (cascade soft-delete) by {actor}',
    placeholders: ['actor', 'targetName'],
  },

  // Entity Relationships
  ASSET_RELATIONSHIP_CREATED: {
    label: 'Entity Relationship Created',
    category: 'Entity Management',
    template: 'Relationship created: "{sourceName}" linked to "{targetName}" by {actor}',
    placeholders: ['actor', 'sourceName', 'targetName'],
  },
  ASSET_RELATIONSHIP_DELETED: {
    label: 'Entity Relationship Deleted',
    category: 'Entity Management',
    template: 'Relationship removed: "{sourceName}" unlinked from "{targetName}" by {actor}',
    placeholders: ['actor', 'sourceName', 'targetName'],
  },

  // Entity Identifiers
  ASSET_IDENTIFIER_CREATED: {
    label: 'Filter Identifier Added',
    category: 'Filter Management',
    template: 'New identifier ({identifierType}) added to filter "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName', 'identifierType'],
  },
  ASSET_IDENTIFIER_DELETED: {
    label: 'Filter Identifier Removed',
    category: 'Filter Management',
    template: 'Identifier ({identifierType}) removed from filter "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName', 'identifierType'],
  },

  // Alarm Management
  ALARM_ACKNOWLEDGED: {
    label: 'Alarm Acknowledged',
    category: 'Entity Management',
    template: 'Alarm "{targetName}" acknowledged by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ALARM_CLEARED: {
    label: 'Alarm Cleared',
    category: 'Entity Management',
    template: 'Alarm "{targetName}" cleared by {actor}',
    placeholders: ['actor', 'targetName'],
  },

  // Phase 2: Filter Operations
  CYCLE_STARTED: {
    label: 'Cleaning Cycle Started',
    category: 'Filter Operations',
    template: 'Cleaning cycle started for filter "{targetName}" with reason "{reason}" by {actor}',
    placeholders: ['actor', 'targetName', 'reason'],
  },
  STATE_TRANSITION: {
    label: 'Filter Stage Advanced',
    category: 'Filter Operations',
    // 2026-05-20: include the previous stage so operators can audit
    // movement direction (advance vs. rewind on bypass). Genesis transitions
    // out of a null fromState render the "from" half as "(start)".
    template: 'Filter "{targetName}" advanced from "{fromStage}" to "{stage}" by {actor}',
    placeholders: ['actor', 'targetName', 'fromStage', 'stage'],
  },
  CHECKLIST_COMPLETED: {
    label: 'Checklist Completed',
    category: 'Filter Operations',
    template: 'Checklist "{targetName}" completed for filter by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  BYPASS_DEVIATION: {
    label: 'Stage Bypassed (Deviation)',
    category: 'Filter Operations',
    template: 'Stage "{stage}" bypassed for filter "{targetName}" by {actor} — deviation recorded',
    placeholders: ['actor', 'targetName', 'stage'],
  },
  CYCLE_COMPLETED: {
    label: 'Cleaning Cycle Completed',
    category: 'Filter Operations',
    template: 'Cleaning cycle completed for filter "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  CYCLE_TERMINATED: {
    label: 'Cleaning Cycle Terminated',
    category: 'Filter Operations',
    template: 'Cleaning cycle terminated for filter "{targetName}" by {actor} — reason: "{reason}"',
    placeholders: ['actor', 'targetName', 'reason'],
  },
  PARAMETER_CAPTURE: {
    label: 'Instrument Reading Captured',
    category: 'Filter Operations',
    template: 'Instrument readings captured for filter "{targetName}" at stage "{stage}" by {actor}',
    placeholders: ['actor', 'targetName', 'stage'],
  },
  STAGE_APPROVAL_APPROVED: {
    label: 'Cleaning Stage Approved (Interlock)',
    category: 'Filter Operations',
    template: 'Cleaning stage "{stageKey}" approved for filter "{filterName}" by {actor}',
    placeholders: ['actor', 'stageKey', 'filterName'],
  },
  STAGE_APPROVAL_REJECTED: {
    label: 'Cleaning Stage Rejected (Interlock)',
    category: 'Filter Operations',
    template: 'Cleaning stage "{stageKey}" rejected for filter "{filterName}" by {actor} — restart from "{rejectToStateKey}"',
    placeholders: ['actor', 'stageKey', 'filterName', 'rejectToStateKey'],
  },

  // Cleaning Profiles
  CLEANING_PROFILE_CREATED: {
    label: 'Cleaning Profile Created',
    category: 'Cleaning Profiles',
    template: 'Cleaning profile "{targetName}" created by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  CLEANING_PROFILE_UPDATED: {
    label: 'Cleaning Profile Updated',
    category: 'Cleaning Profiles',
    template: 'Cleaning profile "{targetName}" updated (new version) by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  CLEANING_PROFILE_DELETED: {
    label: 'Cleaning Profile Archived',
    category: 'Cleaning Profiles',
    template: 'Cleaning profile "{targetName}" archived by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  CLEANING_PROFILE_STATUS_CHANGED: {
    label: 'Cleaning Profile Status Changed',
    category: 'Cleaning Profiles',
    template: 'Cleaning profile "{targetName}" status changed to "{status}" by {actor}',
    placeholders: ['actor', 'targetName', 'status'],
  },

  // Filter Profiles
  FILTER_PROFILE_CREATED: {
    label: 'Filter Profile Created',
    category: 'Filter Profiles',
    template: 'Filter profile created for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  FILTER_PROFILE_UPDATED: {
    label: 'Filter Profile Updated',
    category: 'Filter Profiles',
    template: 'Filter profile updated for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  FILTER_PROFILE_ASSIGNED: {
    label: 'Filter Profile Assigned',
    category: 'Filter Profiles',
    template: 'Cleaning profile assigned to filter "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },

  // Equipment Groups
  EQUIPMENT_GROUP_CREATED: {
    label: 'Equipment Group Created',
    category: 'Equipment Groups',
    template: 'Equipment group "{targetName}" created for block by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  EQUIPMENT_GROUP_UPDATED: {
    label: 'Equipment Group Updated',
    category: 'Equipment Groups',
    template: 'Equipment group "{targetName}" instruments updated by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  EQUIPMENT_GROUP_DELETED: {
    label: 'Equipment Group Deleted',
    category: 'Equipment Groups',
    template: 'Equipment group "{targetName}" deactivated by {actor}',
    placeholders: ['actor', 'targetName'],
  },

  // PM Schedules
  PM_SCHEDULE_CREATED: {
    label: 'PM Schedule Created',
    category: 'PM Schedules',
    template: 'PM schedule created for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  PM_SCHEDULE_UPDATED: {
    label: 'PM Schedule Updated',
    category: 'PM Schedules',
    template: 'PM schedule updated for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  PM_SCHEDULE_DELETED: {
    label: 'PM Schedule Deleted',
    category: 'PM Schedules',
    template: 'PM schedule deleted for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  PM_EXECUTION_COMPLETED: {
    label: 'PM Execution Completed',
    category: 'PM Schedules',
    template: 'PM execution completed for "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },

  // Admin Requests
  ADMIN_REQUEST_SUBMITTED: {
    label: 'Admin Request Submitted',
    category: 'Data & Approvals',
    template: 'Admin request submitted — "{targetName}"',
    placeholders: ['targetName'],
  },
  ADMIN_REQUEST_APPROVED: {
    label: 'Admin Request Approved',
    category: 'Data & Approvals',
    template: 'Admin request approved — "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
  },
  ADMIN_REQUEST_REJECTED: {
    label: 'Admin Request Rejected',
    category: 'Data & Approvals',
    template: 'Admin request rejected — "{targetName}" by {actor}',
    placeholders: ['actor', 'targetName'],
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
