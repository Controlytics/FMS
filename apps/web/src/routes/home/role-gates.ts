import type { Permission } from '@digilog/shared';

/**
 * Embedded copy of the default-role → permissions map from
 * apps/api/prisma/default-roles.ts. The web app can't import across the
 * workspace at runtime, so this is duplicated and kept honest by the drift
 * guard in __tests__/role-gates.test.ts (asserts exact set-equality).
 *
 * WHEN default-roles.ts CHANGES: update this map, or the drift test fails.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  SUPER_ADMIN: [
    'USER_CREATE','USER_READ','USER_UPDATE','USER_DELETE','USER_ENABLE_DISABLE','USER_UNLOCK','USER_RESET_PASSWORD',
    'ADMIN_REQUEST_APPROVE','ADMIN_REQUEST_REJECT',
    'CONFIG_READ','CONFIG_UPDATE','FIELD_ID_UPDATE',
    'AUDIT_READ','AUDIT_EXPORT','ROLE_MANAGE',
    'ASSET_CREATE','ASSET_UPDATE','ASSET_DELETE',
    'ASSET_IDENTIFIER_CREATE','ASSET_IDENTIFIER_DELETE','ASSET_VIEW','ASSET_READ',
    'DASHBOARD_CREATE','DASHBOARD_MANAGE','DASHBOARD_VIEW','DASHBOARD_ASSIGN',
    'NOTIFICATION_VIEW','NOTIFICATION_CREATE','NOTIFICATION_UPDATE','NOTIFICATION_DELETE','NOTIFICATION_MANAGE',
    'BACKUP_MANAGE','BACKUP_RESTORE',
    'FILTER_OPERATE','FILTER_BYPASS','CHECKLIST_SUBMIT','EVENT_READ',
    'FILTER_CREATE','FILTER_EDIT','FILTER_DELETE','FILTER_BULK_UPLOAD','FILTER_RETIRE','FILTER_REPLACE','FILTER_STATUS_UPDATE',
    'FILTER_HIERARCHY_CREATE','FILTER_HIERARCHY_EDIT','FILTER_HIERARCHY_DELETE','FILTER_RFID_MANAGE',
    'FCP_READ','FCP_CREATE','FCP_UPDATE','FCP_DELETE',
    'FP_READ','FP_CREATE','FP_UPDATE','FP_DELETE','FP_ASSIGN',
    'PM_READ','PM_CREATE','PM_UPDATE','PM_DELETE','PM_EXECUTE','PM_APPROVE',
    'CYCLE_READ','READ_DEBUG_TRACE','MANAGE_DEBUG_TRACE',
    'BLOCK_CHANGE_REQUEST','BLOCK_CHANGE_APPROVE',
    'REPORT_GENERATE','REPORT_EXPORT',
    'REPORT_REVIEW_SUBMIT','REPORT_REVIEW','REPORT_APPROVE',
    'STAGE_APPROVAL_VIEW','STAGE_APPROVAL_DECIDE',
    'VERSION_HISTORY_VIEW',
  ] as Permission[],
  ADMIN: [
    'USER_CREATE','USER_READ','USER_UPDATE','USER_ENABLE_DISABLE','USER_UNLOCK','USER_RESET_PASSWORD',
    'ADMIN_REQUEST_APPROVE','ADMIN_REQUEST_REJECT',
    'CONFIG_READ','CONFIG_UPDATE','FIELD_ID_UPDATE','ROLE_MANAGE',
    'AUDIT_READ','AUDIT_EXPORT',
    'ASSET_CREATE','ASSET_UPDATE','ASSET_DELETE',
    'ASSET_IDENTIFIER_CREATE','ASSET_IDENTIFIER_DELETE','ASSET_VIEW','ASSET_READ',
    'DASHBOARD_CREATE','DASHBOARD_MANAGE','DASHBOARD_VIEW','DASHBOARD_ASSIGN',
    'NOTIFICATION_VIEW','NOTIFICATION_CREATE','NOTIFICATION_UPDATE','NOTIFICATION_MANAGE',
    'BACKUP_MANAGE','BACKUP_RESTORE',
    'FILTER_OPERATE','FILTER_BYPASS','CHECKLIST_SUBMIT','EVENT_READ',
    'FILTER_CREATE','FILTER_EDIT','FILTER_DELETE','FILTER_BULK_UPLOAD','FILTER_RETIRE','FILTER_REPLACE','FILTER_STATUS_UPDATE',
    'FILTER_HIERARCHY_CREATE','FILTER_HIERARCHY_EDIT','FILTER_HIERARCHY_DELETE','FILTER_RFID_MANAGE',
    'FCP_READ','FCP_CREATE','FCP_UPDATE','FCP_DELETE',
    'FP_READ','FP_CREATE','FP_UPDATE','FP_DELETE','FP_ASSIGN',
    'PM_READ','PM_CREATE','PM_UPDATE','PM_EXECUTE','PM_APPROVE',
    'CYCLE_READ','READ_DEBUG_TRACE','MANAGE_DEBUG_TRACE',
    'BLOCK_CHANGE_REQUEST','BLOCK_CHANGE_APPROVE',
    'REPORT_GENERATE','REPORT_EXPORT',
    'REPORT_REVIEW_SUBMIT','REPORT_REVIEW','REPORT_APPROVE',
    'STAGE_APPROVAL_VIEW','STAGE_APPROVAL_DECIDE',
  ] as Permission[],
  SUPERVISOR: [
    'AUDIT_READ',
    'ASSET_VIEW','ASSET_READ','ASSET_CREATE',
    'DASHBOARD_VIEW',
    'FILTER_OPERATE','CHECKLIST_SUBMIT','EVENT_READ',
    'FILTER_CREATE','FILTER_EDIT',
    'FCP_READ','FP_READ','PM_READ','CYCLE_READ',
    'BLOCK_CHANGE_REQUEST',
    'STAGE_APPROVAL_VIEW','STAGE_APPROVAL_DECIDE',
    'REPORT_GENERATE','REPORT_EXPORT',
  ] as Permission[],
  MAINTENANCE: [
    'AUDIT_READ',
    'ASSET_VIEW','ASSET_READ','ASSET_CREATE','ASSET_UPDATE',
    'DASHBOARD_VIEW',
    'FILTER_OPERATE','CHECKLIST_SUBMIT','EVENT_READ',
    'FCP_READ','FP_READ','PM_READ','CYCLE_READ',
    'BLOCK_CHANGE_REQUEST',
    'REPORT_GENERATE','REPORT_EXPORT',
  ] as Permission[],
  OPERATOR: [
    'AUDIT_READ',
    'ASSET_VIEW','ASSET_READ',
    'DASHBOARD_VIEW',
    'FILTER_OPERATE','CHECKLIST_SUBMIT','EVENT_READ',
    'FCP_READ','FP_READ','PM_READ','CYCLE_READ',
    'BLOCK_CHANGE_REQUEST',
  ] as Permission[],
  VIEWER: [
    'AUDIT_READ',
    'ASSET_VIEW','ASSET_READ',
    'DASHBOARD_VIEW',
  ] as Permission[],
};

/** Roles in hierarchy order (highest → lowest). Drives legend + derivation order. */
export const ROLE_META: { name: string; displayName: string; badgeClass: string }[] = [
  { name: 'SUPER_ADMIN', displayName: 'Super Admin', badgeClass: 'bg-red-100 text-red-700 border-red-200' },
  { name: 'ADMIN',       displayName: 'Admin',       badgeClass: 'bg-purple-100 text-purple-700 border-purple-200' },
  { name: 'SUPERVISOR',  displayName: 'Supervisor',  badgeClass: 'bg-blue-100 text-blue-700 border-blue-200' },
  { name: 'MAINTENANCE', displayName: 'Maintenance', badgeClass: 'bg-amber-100 text-amber-700 border-amber-200' },
  { name: 'OPERATOR',    displayName: 'Operator',    badgeClass: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { name: 'VIEWER',      displayName: 'Viewer',      badgeClass: 'bg-slate-100 text-slate-600 border-slate-200' },
];

/**
 * Default role names that hold ANY of the given gate permissions, returned in
 * hierarchy order. Mirrors requireAnyPermission semantics. Empty gate → [].
 *
 * SUPER_ADMIN is ALWAYS included for non-empty gates because SUPER_ADMIN
 * bypasses all permission/role gates at runtime (see apps/api/src/plugins/rbac.ts).
 */
export function deriveRolesForGate(gate: Permission[]): string[] {
  if (gate.length === 0) return [];
  return ROLE_META
    .map((m) => m.name)
    .filter((name) => {
      // SUPER_ADMIN bypasses all permission/role gates (apps/api/src/plugins/rbac.ts) — always allowed on any gated step.
      if (name === 'SUPER_ADMIN') return true;

      const held = DEFAULT_ROLE_PERMISSIONS[name] ?? [];
      return gate.some((g) => held.includes(g));
    });
}
