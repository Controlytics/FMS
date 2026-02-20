import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';
import { enforceReauth } from '../../lib/reauth-check.js';

// Validation schemas
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

export default async function roleRoutes(app: FastifyInstance) {
  // GET /api/roles — List all roles
  app.get('/', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'List all roles',
      description: 'Retrieve all roles ordered by hierarchy level. Requires SUPER_ADMIN or ADMIN role.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              displayName: { type: 'string' },
              description: { type: 'string' },
              hierarchyLevel: { type: 'integer' },
              permissions: { type: 'array', items: { type: 'string' } },
              color: { type: 'string' },

              isSystem: { type: 'boolean' },
              isActive: { type: 'boolean' },
            },
          },
        },
      },
    },
  }, async (req) => {
    const roles = await prisma.role.findMany({
      orderBy: { hierarchyLevel: 'desc' },
    });
    return roles;
  });

  // GET /api/roles/active — List only active roles (for dropdowns)
  app.get('/active', {
    schema: {
      tags: ['Roles'],
      summary: 'List active roles',
      description: 'Retrieve only active roles with minimal fields, suitable for dropdown selectors.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              displayName: { type: 'string' },
              hierarchyLevel: { type: 'integer' },
              color: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (req) => {
    const roles = await prisma.role.findMany({
      where: { isActive: true },
      orderBy: { hierarchyLevel: 'desc' },
      select: {
        id: true,
        name: true,
        displayName: true,
        hierarchyLevel: true,
        color: true,
      },
    });
    return roles;
  });

  // GET /api/roles/:name — Get single role by name
  app.get('/:name', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'Get role by name',
      description: 'Retrieve a single role by its unique name. Requires SUPER_ADMIN or ADMIN role.',
      params: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Role name (e.g. SUPER_ADMIN, ADMIN, OPERATOR)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            displayName: { type: 'string' },
            description: { type: 'string' },
            hierarchyLevel: { type: 'integer' },
            permissions: { type: 'array', items: { type: 'string' } },
            color: { type: 'string' },
            isSystem: { type: 'boolean' },
            isActive: { type: 'boolean' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { name } = req.params as { name: string };
    const role = await prisma.role.findUnique({ where: { name } });
    if (!role) {
      return reply.code(404).send({ error: 'Role not found' });
    }
    return role;
  });

  // POST /api/roles — Create new role (SUPER_ADMIN only)
  app.post('/', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'Create a new role',
      description: 'Create a custom role with specified permissions, hierarchy level, and display properties. SUPER_ADMIN only.',
      body: {
        type: 'object',
        required: ['name', 'displayName', 'hierarchyLevel'],
        properties: {
          name: { type: 'string', description: 'Unique role name (uppercase with underscores, e.g. CUSTOM_ROLE)' },
          displayName: { type: 'string', description: 'Human-readable display name' },
          description: { type: 'string', description: 'Role description' },
          hierarchyLevel: { type: 'integer', minimum: 1, maximum: 10, description: 'Hierarchy level (1=lowest, 10=highest)' },
          permissions: { type: 'array', items: { type: 'string' }, description: 'Permission keys assigned to this role' },
          color: { type: 'string', description: 'Display color (hex code)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
          },
        },
        409: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_ROLE', req, reply);
    if (!ok) return;

    const parsed = createRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    // Check if role name already exists
    const existing = await prisma.role.findUnique({ where: { name: parsed.data.name } });
    if (existing) {
      return reply.code(409).send({ error: 'Role name already exists' });
    }

    const role = await prisma.role.create({
      data: {
        name: parsed.data.name,
        displayName: parsed.data.displayName,
        description: parsed.data.description,
        hierarchyLevel: parsed.data.hierarchyLevel,
        permissions: parsed.data.permissions,
        color: parsed.data.color,
        isSystem: false,
        createdBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ROLE_CREATED',
      targetType: 'role',
      targetId: role.name,
      afterValue: role,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, data: role };
  });

  // PUT /api/roles/:name — Update role (SUPER_ADMIN only)
  app.put('/:name', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'Update a role',
      description: 'Update role properties. System roles can only have permissions, color, display name, and description updated. SUPER_ADMIN only.',
      params: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Role name to update' },
        },
      },
      body: {
        type: 'object',
        properties: {
          displayName: { type: 'string', description: 'Updated display name' },
          description: { type: 'string', description: 'Updated description' },
          hierarchyLevel: { type: 'integer', minimum: 1, maximum: 10, description: 'Updated hierarchy level' },
          permissions: { type: 'array', items: { type: 'string' }, description: 'Updated permissions list' },
          color: { type: 'string', description: 'Updated color' },
          isActive: { type: 'boolean', description: 'Enable or disable the role' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        400: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            details: { type: 'object', additionalProperties: true },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_ROLE', req, reply);
    if (!ok) return;

    const { name } = req.params as { name: string };
    const parsed = updateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.role.findUnique({ where: { name } });
    if (!existing) {
      return reply.code(404).send({ error: 'Role not found' });
    }

    // System roles can only have permissions, color, and display info updated
    if (existing.isSystem) {
      const allowedUpdates: any = {};
      if (parsed.data.permissions !== undefined) allowedUpdates.permissions = parsed.data.permissions;
      if (parsed.data.color !== undefined) allowedUpdates.color = parsed.data.color;
      if (parsed.data.displayName !== undefined) allowedUpdates.displayName = parsed.data.displayName;
      if (parsed.data.description !== undefined) allowedUpdates.description = parsed.data.description;

      const role = await prisma.role.update({
        where: { name },
        data: {
          ...allowedUpdates,
          updatedBy: req.user.username,
        },
      });

      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'ROLE_UPDATED',
        targetType: 'role',
        targetId: role.name,
        beforeValue: existing,
        afterValue: role,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });

      return { success: true, data: role };
    }

    // Non-system roles can be fully updated
    const role = await prisma.role.update({
      where: { name },
      data: {
        ...parsed.data,
        updatedBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ROLE_UPDATED',
      targetType: 'role',
      targetId: role.name,
      beforeValue: existing,
      afterValue: role,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true, data: role };
  });

  // DELETE /api/roles/:name — Delete role (SUPER_ADMIN only)
  app.delete('/:name', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'Delete a role',
      description: 'Permanently delete a custom role. System roles cannot be deleted. Roles with assigned users cannot be deleted. SUPER_ADMIN only.',
      params: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Role name to delete' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        403: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        409: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            usersCount: { type: 'integer' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_ROLE', req, reply);
    if (!ok) return;

    const { name } = req.params as { name: string };

    const existing = await prisma.role.findUnique({ where: { name } });
    if (!existing) {
      return reply.code(404).send({ error: 'Role not found' });
    }

    // Check if any users have this role
    const usersWithRole = await prisma.user.count({ where: { role: name } });
    if (usersWithRole > 0) {
      return reply.code(409).send({
        error: 'Cannot delete role with assigned users',
        usersCount: usersWithRole,
      });
    }

    await prisma.role.delete({ where: { name } });

    await app.auditLog({
      userId: req.user.username,
      userRole: req.user.role,
      action: 'ROLE_DELETED',
      targetType: 'role',
      targetId: name,
      beforeValue: { name: existing.name, displayName: existing.displayName, hierarchyLevel: existing.hierarchyLevel, permissions: existing.permissions },
      afterValue: { deleted: true },
      signatureMeaning: `Custom role "${existing.displayName}" permanently deleted`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      sessionId: req.user.sessionId,
    });

    return { success: true };
  });

  // GET /api/roles/permissions/all — Get all available permissions
  app.get('/permissions/all', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'List all available permissions',
      description: 'Return the complete list of available permissions grouped by category. SUPER_ADMIN only.',
      response: {
        200: {
          type: 'object',
          properties: {
            permissions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  category: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async () => {
    return {
      permissions: [
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
        { key: 'APPROVAL_REVIEW', label: 'Review Approvals', category: 'Approvals' },
        { key: 'APPROVAL_REQUEST', label: 'Request Approvals', category: 'Approvals' },
      ],
    };
  });

  // GET /api/roles/:name/creatable — Get roles that this role can create
  app.get('/:name/creatable', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    schema: {
      tags: ['Roles'],
      summary: 'Get creatable roles for a role',
      description: 'Retrieve the list of active roles that a given role is allowed to assign to new users (roles at the same or lower hierarchy level).',
      params: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Role name to check creatable roles for' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              displayName: { type: 'string' },
              hierarchyLevel: { type: 'integer' },
              color: { type: 'string' },
            },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { name } = req.params as { name: string };

    const currentRole = await prisma.role.findUnique({ where: { name } });
    if (!currentRole) {
      return reply.code(404).send({ error: 'Role not found' });
    }

    // Get all roles with hierarchy level <= current role's level
    const creatableRoles = await prisma.role.findMany({
      where: {
        isActive: true,
        hierarchyLevel: { lte: currentRole.hierarchyLevel },
      },
      orderBy: { hierarchyLevel: 'desc' },
      select: {
        name: true,
        displayName: true,
        hierarchyLevel: true,
        color: true,
      },
    });

    return creatableRoles;
  });
}
