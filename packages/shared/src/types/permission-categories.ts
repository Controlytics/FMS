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
    { key: PERMISSIONS.APPROVAL_REVIEW, label: 'Review Approvals' },
    { key: PERMISSIONS.APPROVAL_REQUEST, label: 'Request Approvals' },
  ],
};
