import { PERMISSIONS } from './permissions.js';

export interface PermissionItem {
  key: string;
  label: string;
}

/**
 * Permission categories for role creation/editing.
 * Single source of truth — roles.tsx imports this instead of hardcoding.
 * To add a new permission: add the key to PERMISSIONS, then add it here.
 */
export const PERMISSION_CATEGORIES: Record<string, PermissionItem[]> = {
  'User Management': [
    { key: PERMISSIONS.USER_CREATE, label: 'Create Users' },
    { key: PERMISSIONS.USER_READ, label: 'View Users' },
    { key: PERMISSIONS.USER_UPDATE, label: 'Update Users' },
    { key: PERMISSIONS.USER_DELETE, label: 'Delete Users' },
    { key: PERMISSIONS.USER_ENABLE_DISABLE, label: 'Enable/Disable Users' },
    { key: PERMISSIONS.USER_UNLOCK, label: 'Unlock Users' },
    { key: PERMISSIONS.USER_RESET_PASSWORD, label: 'Reset Passwords' },
  ],
  'Configuration': [
    { key: PERMISSIONS.CONFIG_READ, label: 'View Configuration' },
    { key: PERMISSIONS.CONFIG_UPDATE, label: 'Update Configuration' },
    { key: PERMISSIONS.FIELD_ID_UPDATE, label: 'Update Field Labels' },
    { key: PERMISSIONS.ROLE_MANAGE, label: 'Manage Roles' },
  ],
  'Audit & Approvals': [
    { key: PERMISSIONS.AUDIT_READ, label: 'View Audit Trail' },
    { key: PERMISSIONS.AUDIT_EXPORT, label: 'Export Audit Trail' },
    { key: PERMISSIONS.APPROVAL_REVIEW, label: 'Review Approvals' },
    { key: PERMISSIONS.APPROVAL_REQUEST, label: 'Request Approvals' },
  ],
  'Entity Management': [
    { key: PERMISSIONS.ASSET_VIEW, label: 'View Entities' },
    { key: PERMISSIONS.ASSET_CREATE, label: 'Create Entities' },
    { key: PERMISSIONS.ASSET_UPDATE, label: 'Edit Entities' },
    { key: PERMISSIONS.ASSET_DELETE, label: 'Delete Entities' },
    { key: PERMISSIONS.ASSET_TEMPLATE_MANAGE, label: 'Manage Templates' },
    { key: PERMISSIONS.ASSET_RELATIONSHIP_MANAGE, label: 'Manage Relationships' },
    { key: PERMISSIONS.ASSET_IDENTIFIER_MANAGE, label: 'Manage Identifiers' },
  ],
  'Notifications': [
    { key: PERMISSIONS.NOTIFICATION_MANAGE, label: 'Manage Notifications' },
  ],
  'Data & Ingestion': [
    { key: PERMISSIONS.DATA_INGEST, label: 'Ingest Data' },
    { key: PERMISSIONS.DATA_VIEW, label: 'View Data' },
    { key: PERMISSIONS.DATA_MANAGE, label: 'Manage Data' },
    { key: PERMISSIONS.DATA_EXPORT, label: 'Export Data' },
  ],
  'Rule Chains': [
    { key: PERMISSIONS.RULE_CHAIN_VIEW, label: 'View Rule Chains' },
    { key: PERMISSIONS.RULE_CHAIN_MANAGE, label: 'Manage Rule Chains' },
  ],
  'Alarms': [
    { key: PERMISSIONS.ALARM_VIEW, label: 'View Alarms' },
    { key: PERMISSIONS.ALARM_MANAGE, label: 'Manage Alarms' },
  ],
  'Checklists': [
    { key: PERMISSIONS.CHECKLIST_SUBMIT, label: 'Submit Checklists' },
    { key: PERMISSIONS.CHECKLIST_REVIEW, label: 'Review Checklists' },
    { key: PERMISSIONS.CHECKLIST_APPROVE, label: 'Approve Checklists' },
  ],
  'Advanced': [
    { key: PERMISSIONS.UNS_VIEW, label: 'View UNS' },
    { key: PERMISSIONS.UNS_MANAGE, label: 'Manage UNS' },
    { key: PERMISSIONS.QR_CODE_GENERATE, label: 'Generate QR Codes' },
    { key: PERMISSIONS.HELP_MANAGE, label: 'Manage Help Articles' },
    { key: PERMISSIONS.READ_DEBUG_TRACE, label: 'View Debug Traces' },
    { key: PERMISSIONS.MANAGE_DEBUG_TRACE, label: 'Manage Debug Traces' },
    { key: PERMISSIONS.RETENTION_MANAGE, label: 'Manage Data Retention' },
    { key: PERMISSIONS.SYSTEM_CONFIG_MANAGE, label: 'Manage System Config' },
  ],
};
