import { z } from 'zod';
import { PERMISSIONS } from '@digilog/shared';
import { auditLog } from '../../lib/audit.js';
import { AppError, NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import type { RequestContext } from '../../types/context.js';
import { roleRepository } from './role.repository.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createRoleSchema = z.object({
  name: z.string().min(2).max(50).regex(/^[A-Z][A-Z0-9_]*$/, 'Name must be uppercase with underscores only'),
  displayName: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  hierarchyLevel: z.number().int().min(1).max(10),
  permissions: z.array(z.string()).default([]),
  color: z.string().max(100).default('#6366f1'),
});

const updateRoleSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
  hierarchyLevel: z.number().int().min(1).max(10).optional(),
  permissions: z.array(z.string()).optional(),
  color: z.string().max(100).optional(),
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Permission metadata — labels and categories for each PERMISSIONS key
// ---------------------------------------------------------------------------

const PERMISSION_META: Record<string, { label: string; category: string }> = {
  // User management
  [PERMISSIONS.USER_CREATE]: { label: 'Create Users', category: 'User Management' },
  [PERMISSIONS.USER_READ]: { label: 'View Users', category: 'User Management' },
  [PERMISSIONS.USER_UPDATE]: { label: 'Update Users', category: 'User Management' },
  [PERMISSIONS.USER_DELETE]: { label: 'Delete Users', category: 'User Management' },
  [PERMISSIONS.USER_ENABLE_DISABLE]: { label: 'Enable/Disable Users', category: 'User Management' },
  [PERMISSIONS.USER_UNLOCK]: { label: 'Unlock Users', category: 'User Management' },
  [PERMISSIONS.USER_RESET_PASSWORD]: { label: 'Reset Passwords', category: 'User Management' },
  // Configuration
  [PERMISSIONS.CONFIG_READ]: { label: 'View Configuration', category: 'Configuration' },
  [PERMISSIONS.CONFIG_UPDATE]: { label: 'Update Configuration', category: 'Configuration' },
  [PERMISSIONS.FIELD_ID_UPDATE]: { label: 'Update Field Labels', category: 'Configuration' },
  [PERMISSIONS.ROLE_MANAGE]: { label: 'Manage Roles', category: 'Configuration' },
  [PERMISSIONS.BACKUP_MANAGE]: { label: 'Manage Backups', category: 'Configuration' },
  // Audit
  [PERMISSIONS.AUDIT_READ]: { label: 'View Audit Trail', category: 'Audit' },
  [PERMISSIONS.AUDIT_EXPORT]: { label: 'Export Audit Trail', category: 'Audit' },
  // Filter Events
  [PERMISSIONS.EVENT_READ]: { label: 'View Filter Events', category: 'Filter Management' },
  // Notifications
  [PERMISSIONS.NOTIFICATION_VIEW]: { label: 'View Notifications', category: 'Notifications' },
  [PERMISSIONS.NOTIFICATION_CREATE]: { label: 'Create Notifications', category: 'Notifications' },
  [PERMISSIONS.NOTIFICATION_UPDATE]: { label: 'Update Notifications', category: 'Notifications' },
  [PERMISSIONS.NOTIFICATION_DELETE]: { label: 'Delete Notifications', category: 'Notifications' },
  [PERMISSIONS.NOTIFICATION_MANAGE]: { label: 'Manage Notifications', category: 'Notifications' },
  // Assets & Entities
  [PERMISSIONS.ASSET_READ]: { label: 'View Assets', category: 'Assets' },
  [PERMISSIONS.ASSET_VIEW]: { label: 'View Asset Details', category: 'Assets' },
  [PERMISSIONS.ASSET_CREATE]: { label: 'Create Assets', category: 'Assets' },
  [PERMISSIONS.ASSET_UPDATE]: { label: 'Update Assets', category: 'Assets' },
  [PERMISSIONS.ASSET_DELETE]: { label: 'Delete Assets', category: 'Assets' },
  [PERMISSIONS.ENTITY_ASSIGN]: { label: 'Assign Entities', category: 'Assets' },
  // Asset Templates
  [PERMISSIONS.ASSET_TEMPLATE_CREATE]: { label: 'Create Templates', category: 'Entity Templates' },
  [PERMISSIONS.ASSET_TEMPLATE_UPDATE]: { label: 'Edit Templates', category: 'Entity Templates' },
  [PERMISSIONS.ASSET_TEMPLATE_DELETE]: { label: 'Delete Templates', category: 'Entity Templates' },
  // Asset Relationships
  [PERMISSIONS.ASSET_RELATIONSHIP_CREATE]: { label: 'Create Relationships', category: 'Entity Relationships' },
  [PERMISSIONS.ASSET_RELATIONSHIP_DELETE]: { label: 'Delete Relationships', category: 'Entity Relationships' },
  // Asset Identifiers
  [PERMISSIONS.ASSET_IDENTIFIER_CREATE]: { label: 'Assign RFID Tags / Create Identifiers', category: 'RFID & Identifiers' },
  [PERMISSIONS.ASSET_IDENTIFIER_DELETE]: { label: 'Unassign RFID Tags / Delete Identifiers', category: 'RFID & Identifiers' },
  // Dashboards
  [PERMISSIONS.DASHBOARD_CREATE]: { label: 'Create Dashboards', category: 'Dashboards' },
  [PERMISSIONS.DASHBOARD_MANAGE]: { label: 'Manage Dashboards', category: 'Dashboards' },
  [PERMISSIONS.DASHBOARD_VIEW]: { label: 'View Dashboards', category: 'Dashboards' },
  [PERMISSIONS.DASHBOARD_ASSIGN]: { label: 'Assign Dashboards', category: 'Dashboards' },
  // Rule Chains
  [PERMISSIONS.RULE_CHAIN_VIEW]: { label: 'View Rule Chains', category: 'Rule Chains' },
  [PERMISSIONS.RULE_CHAIN_CREATE]: { label: 'Create Rule Chains', category: 'Rule Chains' },
  [PERMISSIONS.RULE_CHAIN_UPDATE]: { label: 'Update Rule Chains', category: 'Rule Chains' },
  [PERMISSIONS.RULE_CHAIN_DELETE]: { label: 'Delete Rule Chains', category: 'Rule Chains' },
  // Alarms
  [PERMISSIONS.ALARM_VIEW]: { label: 'View Alarms', category: 'Alarms' },
  [PERMISSIONS.ALARM_ACKNOWLEDGE]: { label: 'Acknowledge Alarms', category: 'Alarms' },
  [PERMISSIONS.ALARM_CLEAR]: { label: 'Clear Alarms', category: 'Alarms' },
  // UNS
  [PERMISSIONS.UNS_VIEW]: { label: 'View UNS Config', category: 'UNS' },
  [PERMISSIONS.UNS_MANAGE]: { label: 'Manage UNS Config', category: 'UNS' },
  // Checklist
  [PERMISSIONS.CHECKLIST_SUBMIT]: { label: 'Submit Checklists', category: 'Filter Management' },
  // Debug
  [PERMISSIONS.READ_DEBUG_TRACE]: { label: 'View Debug Traces', category: 'Debug' },
  [PERMISSIONS.MANAGE_DEBUG_TRACE]: { label: 'Manage Debug Traces', category: 'Debug' },
  // Filter Operations (Phase 2)
  [PERMISSIONS.FILTER_OPERATE]: { label: 'Operate Filters (Advance/Submit)', category: 'Filter Management' },
  [PERMISSIONS.FILTER_BYPASS]: { label: 'Bypass Filter Stages', category: 'Filter Management' },
  [PERMISSIONS.FILTER_BULK_UPLOAD]: { label: 'Bulk Upload Filters', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_RETIRE]: { label: 'Retire Filters', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_REPLACE]: { label: 'Replace Filters', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_STATUS_UPDATE]: { label: 'Update Filter Status', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_HIERARCHY_CREATE]: { label: 'Create Block / Area / AHU', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_RFID_MANAGE]: { label: 'Assign / Unassign RFID Tags', category: 'Filters Page Controls' },
  // Checklist Page Controls
  [PERMISSIONS.CHECKLIST_CREATE]: { label: 'Create Checklist Profiles', category: 'Checklist Page Controls' },
  [PERMISSIONS.CHECKLIST_EDIT]: { label: 'Edit Checklist Profiles', category: 'Checklist Page Controls' },
  [PERMISSIONS.CHECKLIST_DELETE]: { label: 'Delete Checklist Profiles', category: 'Checklist Page Controls' },
  [PERMISSIONS.CHECKLIST_TOGGLE]: { label: 'Enable / Disable Checklists', category: 'Checklist Page Controls' },
  // Cleaning Profile Page Controls
  [PERMISSIONS.CP_PAGE_CREATE]: { label: 'Create Cleaning Profiles', category: 'Cleaning Profile Page Controls' },
  [PERMISSIONS.CP_PAGE_EDIT]: { label: 'Edit Cleaning Profiles', category: 'Cleaning Profile Page Controls' },
  [PERMISSIONS.CP_PAGE_DELETE]: { label: 'Delete Cleaning Profiles', category: 'Cleaning Profile Page Controls' },
  [PERMISSIONS.CP_TOGGLE]: { label: 'Enable / Disable Cleaning Profiles', category: 'Cleaning Profile Page Controls' },
  // Equipment Group Controls
  [PERMISSIONS.EG_VIEW]: { label: 'View Equipment Groups', category: 'Equipment Group Controls' },
  [PERMISSIONS.EG_CREATE]: { label: 'Create Equipment Groups', category: 'Equipment Group Controls' },
  [PERMISSIONS.EG_EDIT]: { label: 'Edit Equipment Groups', category: 'Equipment Group Controls' },
  [PERMISSIONS.EG_DELETE]: { label: 'Delete Equipment Groups', category: 'Equipment Group Controls' },
  // Filter Cleaning Profiles (Phase 2)
  [PERMISSIONS.FCP_READ]: { label: 'View Cleaning Profiles', category: 'Filter Management' },
  [PERMISSIONS.FCP_CREATE]: { label: 'Create Cleaning Profiles', category: 'Filter Management' },
  [PERMISSIONS.FCP_UPDATE]: { label: 'Update Cleaning Profiles', category: 'Filter Management' },
  [PERMISSIONS.FCP_DELETE]: { label: 'Delete Cleaning Profiles', category: 'Filter Management' },
  // Filter Profiles (Phase 2)
  [PERMISSIONS.FP_READ]: { label: 'View Filter Profiles', category: 'Filter Management' },
  [PERMISSIONS.FP_CREATE]: { label: 'Create Filter Profiles', category: 'Filter Management' },
  [PERMISSIONS.FP_UPDATE]: { label: 'Update Filter Profiles', category: 'Filter Management' },
  [PERMISSIONS.FP_DELETE]: { label: 'Delete Filter Profiles', category: 'Filter Management' },
  [PERMISSIONS.FP_ASSIGN]: { label: 'Assign Filter Profiles', category: 'Filter Management' },
  // PM Schedules (Phase 2)
  [PERMISSIONS.PM_READ]: { label: 'View PM Schedules', category: 'PM Scheduling' },
  [PERMISSIONS.PM_CREATE]: { label: 'Create PM Schedules', category: 'PM Scheduling' },
  [PERMISSIONS.PM_UPDATE]: { label: 'Update PM Schedules', category: 'PM Scheduling' },
  [PERMISSIONS.PM_DELETE]: { label: 'Delete PM Schedules', category: 'PM Scheduling' },
  [PERMISSIONS.PM_EXECUTE]: { label: 'Execute PM Tasks', category: 'PM Scheduling' },
  [PERMISSIONS.PM_APPROVE]: { label: 'Approve PM Schedules', category: 'PM Scheduling' },
  [PERMISSIONS.PM_DOWNLOAD_TEMPLATE]: { label: 'Download PM Template', category: 'PM Page Controls' },
  [PERMISSIONS.PM_UPLOAD]: { label: 'Upload PM Schedules', category: 'PM Page Controls' },
  [PERMISSIONS.PM_EDIT_ENTRY]: { label: 'Edit PM Entries', category: 'PM Page Controls' },
  [PERMISSIONS.PM_RESUBMIT]: { label: 'Resubmit Rejected Entries', category: 'PM Page Controls' },
  // Cleaning Cycles (Phase 2)
  [PERMISSIONS.CYCLE_READ]: { label: 'View Cleaning Cycles', category: 'Filter Management' },
  // Block Change Approval (Phase 3)
  [PERMISSIONS.BLOCK_CHANGE_REQUEST]: { label: 'Request Block Change', category: 'Filter Management' },
  [PERMISSIONS.BLOCK_CHANGE_APPROVE]: { label: 'Approve Block Changes', category: 'Filter Management' },
  // Audit 2026-05-04 fix (shared review C2): the following 15 permissions
  // existed in PERMISSIONS + were seeded but had no PERMISSION_META entry.
  // The role-edit UI rendered them under category "Other" with the raw
  // permission key as the label, leaving operators no sane way to grant
  // them. Added with consistent labels + sensible category buckets.
  [PERMISSIONS.FILTER_CREATE]: { label: 'Create Filters', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_EDIT]: { label: 'Edit Filters', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_DELETE]: { label: 'Delete Filters', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_HIERARCHY_EDIT]: { label: 'Edit Block / Area / AHU', category: 'Filters Page Controls' },
  [PERMISSIONS.FILTER_HIERARCHY_DELETE]: { label: 'Delete Block / Area / AHU', category: 'Filters Page Controls' },
  // Reports
  [PERMISSIONS.REPORT_TEMPLATE_READ]: { label: 'View Report Templates', category: 'Reports' },
  [PERMISSIONS.REPORT_TEMPLATE_CREATE]: { label: 'Create Report Templates', category: 'Reports' },
  [PERMISSIONS.REPORT_TEMPLATE_UPDATE]: { label: 'Update Report Templates', category: 'Reports' },
  [PERMISSIONS.REPORT_TEMPLATE_DELETE]: { label: 'Delete Report Templates', category: 'Reports' },
  [PERMISSIONS.REPORT_GENERATE]: { label: 'Generate Reports', category: 'Reports' },
  [PERMISSIONS.REPORT_VIEW]: { label: 'View Reports', category: 'Reports' },
  [PERMISSIONS.REPORT_SIGN]: { label: 'Sign Reports', category: 'Reports' },
  [PERMISSIONS.REPORT_DELETE]: { label: 'Delete Reports', category: 'Reports' },
  [PERMISSIONS.REPORT_EXPORT]: { label: 'Export Reports', category: 'Reports' },
  // Audit C3 — version history viewer + admin-request review (this branch)
  [PERMISSIONS.VERSION_HISTORY_VIEW]: { label: 'View Version History', category: 'Audit' },
  [PERMISSIONS.ADMIN_REQUEST_REVIEW]: { label: 'Review Admin Requests', category: 'User Management' },
};

// Derive ALL_PERMISSIONS from the shared PERMISSIONS constant (single source of truth)
const ALL_PERMISSIONS = Object.values(PERMISSIONS).map(key => ({
  key,
  label: PERMISSION_META[key]?.label ?? key,
  category: PERMISSION_META[key]?.category ?? 'Other',
}));

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const roleService = {
  /** List all roles ordered by hierarchy level. */
  async listAll() {
    return roleRepository.findAll();
  },

  /** List only active roles (minimal fields for dropdowns). */
  async listActive() {
    return roleRepository.findActive();
  },

  /** Get a single role by name. Throws NotFoundError if missing. */
  async getByName(name: string) {
    const role = await roleRepository.findByName(name);
    if (!role) {
      throw new NotFoundError('Role not found');
    }
    return role;
  },

  /** Create a new role. Validates input, checks uniqueness, audits. */
  async create(data: unknown, ctx: RequestContext) {
    const parsed = createRoleSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError('VALIDATION_ERROR', parsed.error.flatten());
    }

    // Check if role name already exists
    const existing = await roleRepository.findByName(parsed.data.name);
    if (existing) {
      throw new ConflictError('Role name already exists');
    }

    const role = await roleRepository.create({
      name: parsed.data.name,
      displayName: parsed.data.displayName,
      description: parsed.data.description,
      hierarchyLevel: parsed.data.hierarchyLevel,
      permissions: parsed.data.permissions,
      color: parsed.data.color,
      createdBy: ctx.userId,
    });

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'ROLE_CREATED',
      targetType: 'role',
      targetId: role.name,
      afterValue: role,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { success: true, data: role };
  },

  /** Update an existing role. System roles have restricted updates. */
  async update(name: string, data: unknown, ctx: RequestContext) {
    const parsed = updateRoleSchema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError('VALIDATION_ERROR', parsed.error.flatten());
    }

    const existing = await roleRepository.findByName(name);
    if (!existing) {
      throw new NotFoundError('Role not found');
    }

    let role;

    // System roles can only have permissions, color, displayName, and description updated
    if (existing.isSystem) {
      const allowedUpdates: any = {};
      if (parsed.data.permissions !== undefined) allowedUpdates.permissions = parsed.data.permissions;
      if (parsed.data.color !== undefined) allowedUpdates.color = parsed.data.color;
      if (parsed.data.displayName !== undefined) allowedUpdates.displayName = parsed.data.displayName;
      if (parsed.data.description !== undefined) allowedUpdates.description = parsed.data.description;

      role = await roleRepository.update(name, {
        ...allowedUpdates,
        updatedBy: ctx.userId,
      });
    } else {
      // Non-system roles can be fully updated
      role = await roleRepository.update(name, {
        ...parsed.data,
        updatedBy: ctx.userId,
      });
    }

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'ROLE_UPDATED',
      targetType: 'role',
      targetId: role.name,
      beforeValue: existing,
      afterValue: role,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { success: true, data: role };
  },

  /** Delete a role. Checks for assigned users first. */
  async delete(name: string, ctx: RequestContext) {
    const existing = await roleRepository.findByName(name);
    if (!existing) {
      throw new NotFoundError('Role not found');
    }

    // Check if any users have this role
    const usersWithRole = await roleRepository.countUsersByRole(name);
    if (usersWithRole > 0) {
      const err = new AppError(409, 'ROLE_HAS_USERS', 'Cannot delete role with assigned users');
      (err as any).usersCount = usersWithRole;
      throw err;
    }

    await roleRepository.delete(name);

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'ROLE_DELETED',
      targetType: 'role',
      targetId: name,
      beforeValue: {
        name: existing.name,
        displayName: existing.displayName,
        hierarchyLevel: existing.hierarchyLevel,
        permissions: existing.permissions,
      },
      afterValue: { deleted: true },
      signatureMeaning: `Custom role "${existing.displayName}" permanently deleted`,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { success: true };
  },

  /** Return the static list of all available permissions. */
  async getAllPermissions() {
    return { permissions: ALL_PERMISSIONS };
  },

  /** Get roles that a given role is allowed to create/assign. */
  async getCreatableRoles(name: string) {
    const currentRole = await roleRepository.findByName(name);
    if (!currentRole) {
      throw new NotFoundError('Role not found');
    }
    const isSuperAdmin = name === 'SUPER_ADMIN';
    return roleRepository.findCreatableRoles(currentRole.hierarchyLevel, isSuperAdmin);
  },
};
