import { z } from 'zod';
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
// Static permissions list
// ---------------------------------------------------------------------------

const ALL_PERMISSIONS = [
  // User management
  { key: 'USER_CREATE', label: 'Create Users', category: 'User Management' },
  { key: 'USER_READ', label: 'View Users', category: 'User Management' },
  { key: 'USER_UPDATE', label: 'Update Users', category: 'User Management' },
  { key: 'USER_DELETE', label: 'Delete Users', category: 'User Management' },
  { key: 'USER_ENABLE_DISABLE', label: 'Enable/Disable Users', category: 'User Management' },
  { key: 'USER_UNLOCK', label: 'Unlock Users', category: 'User Management' },
  { key: 'USER_RESET_PASSWORD', label: 'Reset Passwords', category: 'User Management' },
  // Configuration
  { key: 'CONFIG_READ', label: 'View Configuration', category: 'Configuration' },
  { key: 'CONFIG_UPDATE', label: 'Update Configuration', category: 'Configuration' },
  { key: 'FIELD_ID_UPDATE', label: 'Update Field Labels', category: 'Configuration' },
  { key: 'ROLE_MANAGE', label: 'Manage Roles', category: 'Configuration' },
  // Audit
  { key: 'AUDIT_READ', label: 'View Audit Trail', category: 'Audit' },
  // Approvals
];

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
    return roleRepository.findCreatableRoles(currentRole.hierarchyLevel);
  },
};
