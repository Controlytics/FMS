import { type FastifyInstance } from 'fastify';
import { brandingConfigSchema, passwordPolicySchema, loginSecuritySchema, sessionConfigSchema, datetimeConfigSchema, userIdConfigSchema, actionReauthConfigSchema, auditTemplatesSchema, paginationConfigSchema } from '@digilog/shared';
import { verifyPassword } from '../../lib/password.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { buildContext } from '../../lib/build-context.js';
import { configService } from './config.service.js';
import { configRepository } from './config.repository.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';

// Map config keys to reauth action names
const CONFIG_KEY_TO_ACTION: Record<string, string> = {
  'password-policy': 'UPDATE_PASSWORD_POLICY',
  'login-security': 'UPDATE_LOGIN_SECURITY',
  'session': 'UPDATE_SESSION_CONFIG',
  'datetime': 'UPDATE_DATETIME_CONFIG',
};

export default async function configRoutes(app: FastifyInstance) {
  const configEndpoint = (key: string, schema: any, requiresReauth: boolean) => {
    const titleKey = key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    // GET
    app.get(`/${key}`, {
      preHandler: [app.requirePermission('CONFIG_READ')],
      schema: {
        tags: ['Config'],
        summary: `Get ${titleKey} configuration`,
        description: `Retrieve the current ${titleKey} configuration. Returns defaults if not yet configured.`,
        response: {
          200: { type: 'object', additionalProperties: true, description: `${titleKey} configuration object` },
        },
      },
    }, async () => {
      return configService.getConfig(key, schema);
    });

    // PUT
    app.put(`/${key}`, {
      preHandler: [app.requirePermission('CONFIG_UPDATE')],
      schema: {
        tags: ['Config'],
        summary: `Update ${titleKey} configuration`,
        description: `Update the ${titleKey} configuration. ${requiresReauth ? 'Changes require user re-authentication.' : ''}`,
        body: { type: 'object', description: `${titleKey} configuration values` },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', additionalProperties: true },
            },
          },
          ...errorResponses,
        },
      },
    }, async (req, reply) => {
      const body = req.body as Record<string, unknown>;

      // Dynamic re-authentication from action-reauth config
      const actionKey = CONFIG_KEY_TO_ACTION[key];
      if (actionKey) {
        const { ok } = await enforceReauth(actionKey, req, reply);
        if (!ok) return;
      }

      // Hardcoded re-authentication: always required for sensitive config changes
      // Skip if dynamic enforceReauth already verified the password
      if (requiresReauth && !(req as any)._reauthVerified) {
        const currentPassword = body._currentPassword as string | undefined;
        if (!currentPassword) {
          return reply.code(401).send({ error: 'REAUTH_REQUIRED', message: 'Current password is required to modify this configuration.' });
        }
        const user = await configRepository.findUserById(req.user.sub);
        if (!user) {
          return reply.code(401).send({ error: 'REAUTH_FAILED', message: 'User not found.' });
        }
        const passwordValid = await verifyPassword(currentPassword, (user as any).passwordHash);
        if (!passwordValid) {
          return reply.code(401).send({ error: 'REAUTH_FAILED', message: 'Incorrect password. Please try again.' });
        }
        // Remove _currentPassword before schema validation
        delete body._currentPassword;
      }

      const ctx = buildContext(req);
      const data = await configService.updateConfig(key, body, schema, 'security', requiresReauth, ctx);
      return { success: true, data };
    });
  };

  configEndpoint('password-policy', passwordPolicySchema, true);
  configEndpoint('login-security', loginSecuritySchema, true);
  configEndpoint('session', sessionConfigSchema, true);
  configEndpoint('datetime', datetimeConfigSchema, false);
  configEndpoint('pagination', paginationConfigSchema, false);

  // Public pagination config for all authenticated users (no admin role required)
  app.get('/pagination/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current pagination settings',
      description: 'Retrieve the current pagination options (records per page). Available to all authenticated users.',
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Pagination configuration object' },
      },
    },
  }, async () => {
    return configService.getConfig('pagination', paginationConfigSchema);
  });

  // Dashboard cards config — read for all authenticated users, write for admins
  app.get('/dashboard-cards/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get dashboard card visibility settings',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'dashboard-cards' } });
    return row?.configValue ?? {};
  });

  app.put('/dashboard-cards', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update dashboard card visibility per role',
      body: { type: 'object', properties: { configValue: { type: 'object', additionalProperties: true } }, required: ['configValue'] },
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async (req) => {
    const { configValue } = req.body as { configValue: any };
    const ctx = buildContext(req);
    await prisma.systemConfig.upsert({
      where: { configKey: 'dashboard-cards' },
      update: { configValue, updatedBy: ctx.userSub },
      create: { configKey: 'dashboard-cards', configValue, configType: 'display', requiresReauth: false, updatedBy: ctx.userSub },
    });
    return { success: true };
  });

  // Public datetime config for all authenticated users (no admin role required)
  app.get('/datetime/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current datetime format settings',
      description: 'Retrieve the current date/time format configuration. Available to all authenticated users.',
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Datetime configuration object' },
      },
    },
  }, async () => {
    return configService.getConfig('datetime', datetimeConfigSchema);
  });

  // User ID config - SUPER_ADMIN only for PUT
  app.get('/user-id', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get User ID configuration',
      description: 'Retrieve the current User ID format and auto-generation settings.',
      response: {
        200: { type: 'object', additionalProperties: true, description: 'User ID configuration object' },
      },
    },
  }, async () => {
    return configService.getConfig('user-id', userIdConfigSchema);
  });

  app.put('/user-id', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update User ID configuration',
      description: 'Update User ID format, prefix, auto-generation, and validation settings. Requires CONFIG_UPDATE permission.',
      body: { type: 'object', description: 'User ID configuration values' },
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
            details: { type: 'object' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_USERID_CONFIG', req, reply);
    if (!ok) return;

    const ctx = buildContext(req);
    const data = await configService.updateConfig('user-id', req.body, userIdConfigSchema, 'user', false, ctx);
    return { success: true, data };
  });

  // GET next available User ID (for auto-generation)
  app.get('/user-id/next', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['Config'],
      summary: 'Get next available User ID',
      description: 'Compute and return the next auto-generated User ID based on current configuration and existing users.',
      response: {
        200: {
          type: 'object',
          properties: {
            autoGenerate: { type: 'boolean' },
            nextId: { type: ['string', 'null'] },
          },
        },
      },
    },
  }, async () => {
    return configService.getNextUserId(userIdConfigSchema);
  });

  // Validate a User ID against config
  app.post('/user-id/validate', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['Config'],
      summary: 'Validate a User ID',
      description: 'Validate a proposed User ID against the current User ID configuration rules (length, prefix, format, case).',
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', description: 'The User ID to validate' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            errors: { type: 'array', items: { type: 'string' } },
          },
        },
        400: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            error: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.body as { userId: string };
    if (!userId) {
      return reply.code(400).send({ valid: false, error: 'User ID is required' });
    }

    return configService.validateUserId(userId);
  });

  // Branding config - SUPER_ADMIN only for PUT, public GET for login page
  app.get('/branding', {
    schema: {
      tags: ['Config'],
      summary: 'Get branding configuration',
      description: 'Retrieve the current branding settings (company name, logo, colors). Public endpoint for login page.',
      response: {
        200: { type: 'object', additionalProperties: true, description: 'Branding configuration object' },
      },
    },
  }, async () => {
    return configService.getConfig('branding', brandingConfigSchema);
  });

  app.put('/branding', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update branding configuration',
      description: 'Update branding settings such as company name, logo URL, and theme colors. Requires CONFIG_UPDATE permission.',
      body: { type: 'object', description: 'Branding configuration values' },
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
            details: { type: 'object' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_BRANDING', req, reply);
    if (!ok) return;

    const ctx = buildContext(req);
    const data = await configService.updateConfig('branding', req.body, brandingConfigSchema, 'branding', false, ctx);
    return { success: true, data };
  });

  // ====== Role Configuration ======

  // GET /api/config/roles — get all role configurations
  app.get('/roles', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'List all role configurations',
      description: 'Retrieve configuration (sidebar items, home widgets, permissions) for all roles.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              sidebarItems: { type: 'array', items: { type: 'string' } },
              homeWidgets: { type: 'array', items: { type: 'string' } },
              permissions: { type: 'object', additionalProperties: true },
            },
          },
        },
      },
    },
  }, async () => {
    return configService.listRoleConfigs();
  });

  // GET /api/config/roles/:role — get single role configuration
  app.get('/roles/:role', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get role configuration',
      description: 'Retrieve configuration for a specific role. Returns defaults if not yet configured.',
      params: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', description: 'Role name (e.g. SUPER_ADMIN, ADMIN, OPERATOR)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            role: { type: 'string' },
            sidebarItems: { type: 'array', items: { type: 'string' } },
            homeWidgets: { type: 'array', items: { type: 'string' } },
            permissions: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { role } = req.params as { role: string };
    return configService.getRoleConfig(role);
  });

  // PUT /api/config/roles/:role — update role configuration
  app.put('/roles/:role', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update role configuration',
      description: 'Update sidebar items, home widgets, and permissions for a specific role. Requires CONFIG_UPDATE permission.',
      params: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', description: 'Role name to update' },
        },
      },
      body: {
        type: 'object',
        properties: {
          sidebarItems: { type: 'array', items: { type: 'string' } },
          homeWidgets: { type: 'array', items: { type: 'string' } },
          permissions: { type: 'object', additionalProperties: { type: 'boolean' } },
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
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_ROLE_CONFIG', req, reply);
    if (!ok) return;

    const { role } = req.params as { role: string };
    const { sidebarItems, homeWidgets, permissions } = req.body as {
      sidebarItems?: string[];
      homeWidgets?: string[];
      permissions?: Record<string, boolean>;
    };

    const ctx = buildContext(req);
    const config = await configService.updateRoleConfig(role, { sidebarItems, homeWidgets, permissions }, ctx);
    return { success: true, data: config };
  });

  // ====== User Configuration ======

  // GET /api/config/users/:userId — get user-specific configuration
  app.get('/users/:userId', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get user-specific configuration',
      description: 'Retrieve sidebar items, home widgets, and permissions configured for a specific user.',
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            sidebarItems: { type: 'array', items: { type: 'string' } },
            homeWidgets: { type: 'array', items: { type: 'string' } },
            permissions: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return configService.getUserConfig(userId);
  });

  // PUT /api/config/users/:userId — update user-specific configuration
  app.put('/users/:userId', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update user-specific configuration',
      description: 'Update sidebar items, home widgets, and permissions for a specific user. Overrides role-level configuration.',
      params: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'string', description: 'User ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          sidebarItems: { type: 'array', items: { type: 'string' } },
          homeWidgets: { type: 'array', items: { type: 'string' } },
          permissions: { type: 'object', additionalProperties: { type: 'boolean' } },
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
      },
    },
  }, async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const { sidebarItems, homeWidgets, permissions } = req.body as {
      sidebarItems?: string[];
      homeWidgets?: string[];
      permissions?: Record<string, boolean>;
    };

    const ctx = buildContext(req);
    const config = await configService.updateUserConfig(userId, { sidebarItems, homeWidgets, permissions }, ctx);
    return { success: true, data: config };
  });

  // GET /api/config/my-config — get current user's effective configuration
  app.get('/my-config', {
    schema: {
      tags: ['Config'],
      summary: 'Get current user effective configuration',
      description: 'Retrieve the effective configuration for the authenticated user. Checks user-specific config first, then falls back to role config.',
      response: {
        200: {
          type: 'object',
          properties: {
            sidebarItems: { type: 'array', items: { type: 'string' } },
            homeWidgets: { type: 'array', items: { type: 'string' } },
            permissions: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  }, async (req) => {
    return configService.getMyConfig(req.user.username);
  });

  // GET /api/config/field-ids — all users
  app.get('/field-ids', {
    schema: {
      tags: ['Config'],
      summary: 'List all field ID configurations',
      description: 'Retrieve all field ID label configurations. Available to all authenticated users.',
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              fieldId: { type: 'string' },
              defaultName: { type: 'string' },
              displayName: { type: 'string' },
              module: { type: 'string' },
              description: { type: 'string', nullable: true },
              updatedAt: { type: 'string' },
              updatedBy: { type: 'string', nullable: true },
            },
          },
        },
      },
    },
  }, async () => {
    return configService.listFieldIds();
  });

  // PUT /api/config/field-ids/:fieldId — SUPER_ADMIN only
  app.put('/field-ids/:fieldId', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update field ID display name',
      description: 'Update the display name for a specific field ID. Requires CONFIG_UPDATE permission.',
      params: {
        type: 'object',
        required: ['fieldId'],
        properties: {
          fieldId: { type: 'string', description: 'Field ID to update' },
        },
      },
      body: {
        type: 'object',
        required: ['displayName'],
        properties: {
          displayName: { type: 'string', description: 'New display name for the field' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        400: {
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
      },
    },
  }, async (req, reply) => {
    const { fieldId } = req.params as { fieldId: string };
    const { displayName } = req.body as { displayName: string };

    const ctx = buildContext(req);
    await configService.updateFieldId(fieldId, displayName, ctx);
    return { success: true };
  });

  // ====== Action Re-authentication Configuration ======

  // GET /api/config/action-reauth — full config (SUPER_ADMIN only)
  app.get('/action-reauth', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get action re-authentication configuration',
      description: 'Retrieve the full action re-authentication matrix. Each key is an action name, each value is an array of role names that require re-auth for that action.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async () => {
    return configService.getActionReauth();
  });

  // PUT /api/config/action-reauth — update config (SUPER_ADMIN only)
  app.put('/action-reauth', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update action re-authentication configuration',
      description: 'Set which actions require password re-authentication for each role. Pass an object mapping action names to arrays of role names.',
      body: { type: 'object', additionalProperties: true },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const data = await configService.updateActionReauth(req.body, actionReauthConfigSchema, ctx);
    return { success: true, data };
  });

  // GET /api/config/action-reauth/check?action=DELETE_USER — check single action
  app.get('/action-reauth/check', {
    schema: {
      tags: ['Config'],
      summary: 'Check if action requires re-authentication',
      description: 'Check if a specific action requires password re-authentication for the current user\'s role.',
      querystring: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', description: 'Action key (e.g. DELETE_USER)' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            required: { type: 'boolean' },
          },
        },
      },
    },
  }, async (req) => {
    const { action } = req.query as { action: string };
    return configService.checkReauth(action, req.user.role);
  });

  // ====== Audit Text Templates Configuration ======

  // GET /api/config/audit-templates — full config (SUPER_ADMIN only)
  app.get('/audit-templates', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get audit text templates',
      description: 'Retrieve the full audit text templates configuration. Returns saved templates merged with defaults.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async () => {
    return configService.getAuditTemplates();
  });

  // PUT /api/config/audit-templates — update templates (SUPER_ADMIN only)
  app.put('/audit-templates', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update audit text templates',
      description: 'Save custom audit text templates. Pass an object mapping action keys to template strings.',
      body: { type: 'object', additionalProperties: true },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const data = await configService.updateAuditTemplates(req.body, auditTemplatesSchema, ctx);
    return { success: true, data };
  });

  // GET /api/config/audit-templates/current — all authenticated users
  app.get('/audit-templates/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get effective audit text templates',
      description: 'Retrieve the effective audit text templates (saved merged with defaults). Available to all authenticated users for rendering audit trail descriptions.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async () => {
    return configService.getAuditTemplates();
  });

  // ====== Alarm Columns Configuration ======

  // GET /api/config/alarm-columns — full config (SUPER_ADMIN only)
  app.get('/alarm-columns', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get alarm column visibility configuration',
      description: 'Retrieve the alarm column visibility settings for all roles. Returns a map of role names to arrays of visible column IDs.',
      response: {
        200: { type: 'object', additionalProperties: true },
      },
    },
  }, async () => {
    return configService.getAlarmColumns();
  });

  // PUT /api/config/alarm-columns — update config (SUPER_ADMIN only)
  app.put('/alarm-columns', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update alarm column visibility configuration',
      description: 'Set which alarm columns are visible for each role. Pass an object mapping role names to arrays of column IDs.',
      body: { type: 'object', additionalProperties: true },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const data = await configService.updateAlarmColumns(req.body as Record<string, string[]>, ctx);
    return { success: true, data };
  });

  // GET /api/config/alarm-columns/current — current user's visible columns
  app.get('/alarm-columns/current', {
    schema: {
      tags: ['Config'],
      summary: 'Get current user alarm column visibility',
      description: 'Returns the list of visible alarm column IDs for the authenticated user based on their role configuration.',
      response: {
        200: {
          type: 'object',
          properties: {
            columns: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }, async (req) => {
    return configService.getMyAlarmColumns(req.user.username);
  });

  // GET /api/config/action-reauth/my-actions — all actions for current user's role
  app.get('/action-reauth/my-actions', {
    schema: {
      tags: ['Config'],
      summary: 'Get re-auth actions for current user',
      description: 'Returns all action keys that require password re-authentication for the current user\'s role. Used by frontend to show/hide re-auth dialogs.',
      response: {
        200: {
          type: 'object',
          properties: {
            actions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }, async (req) => {
    return configService.getMyActions(req.user.role);
  });

  // ====== Cleaning Profile Assignment Configuration ======

  // GET /api/config/cleaning-profile-assignment
  app.get('/cleaning-profile-assignment', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['Config'],
      summary: 'Get cleaning profile assignment configuration',
      response: { 200: { type: 'object', additionalProperties: true } },
    },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'cleaning-profile-assignment' } });
    return row?.configValue ?? { mode: 'BY_ENTITY', rules: [] };
  });

  // PUT /api/config/cleaning-profile-assignment
  app.put('/cleaning-profile-assignment', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update cleaning profile assignment configuration',
      body: {
        type: 'object',
        required: ['mode', 'rules'],
        properties: {
          mode: { type: 'string', enum: ['BY_FILTER_SIZE', 'BY_ENTITY', 'BY_AHU', 'BY_BLOCK', 'BY_FILTER_SET'] },
          rules: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      response: { 200: { type: 'object', properties: { success: { type: 'boolean' } } } },
    },
  }, async (req) => {
    const body = req.body as { mode: string; rules: any[] };
    const ctx = buildContext(req);

    const existing = await prisma.systemConfig.findUnique({ where: { configKey: 'cleaning-profile-assignment' } });

    await prisma.systemConfig.upsert({
      where: { configKey: 'cleaning-profile-assignment' },
      update: { configValue: body },
      create: { configKey: 'cleaning-profile-assignment', configValue: body as any, configType: 'filter' },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'system_config', targetId: 'cleaning-profile-assignment',
      beforeValue: existing?.configValue,
      afterValue: body,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return { success: true };
  });
}
