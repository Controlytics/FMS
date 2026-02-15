import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { passwordPolicySchema, loginSecuritySchema, sessionConfigSchema, datetimeConfigSchema, reauthConfigSchema, ALL_REAUTH_OPERATIONS, fieldIdParamsSchema, fieldIdBodySchema } from '@digilog/shared';
import { type ZodTypeAny } from 'zod';

export default async function configRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const configEndpoint = (key: string, schema: ZodTypeAny, requiresReauth: boolean) => {
    // GET
    app.get(`/${key}`, {
      schema: { tags: ['Config'], summary: `Get ${key} config`, description: `Get ${key} configuration` },
      preHandler: [app.requirePermission('CONFIG_READ')],
    }, async () => {
      const config = await prisma.systemConfig.findUnique({ where: { configKey: key } });
      return config?.configValue ?? {};
    });

    // PUT
    app.put(`/${key}`, {
      schema: { tags: ['Config'], summary: `Update ${key} config`, description: `Update ${key} configuration. May require re-authentication.`, body: schema },
      preHandler: [
        app.requirePermission('CONFIG_UPDATE'),
        ...(requiresReauth ? [app.requireReauth(`config:${key}` as any)] : []),
      ],
    }, async (req, reply) => {
      const existing = await prisma.systemConfig.findUnique({ where: { configKey: key } });
      const beforeValue = existing?.configValue;

      await prisma.systemConfig.upsert({
        where: { configKey: key },
        create: {
          configKey: key,
          configValue: req.body as any,
          configType: 'security',
          requiresReauth: requiresReauth,
          updatedBy: req.user.username,
        },
        update: {
          configValue: req.body as any,
          updatedAt: new Date(),
          updatedBy: req.user.username,
        },
      });

      await app.auditLog({
        userId: req.user.username, userRole: req.user.role, action: 'CONFIG_CHANGED',
        targetType: 'config', targetId: key,
        beforeValue: beforeValue as any, afterValue: req.body as any,
        ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
      });

      return { success: true, data: req.body };
    });
  };

  configEndpoint('password-policy', passwordPolicySchema, true);
  configEndpoint('login-security', loginSecuritySchema, true);
  configEndpoint('session', sessionConfigSchema, true);
  configEndpoint('datetime', datetimeConfigSchema, false);

  // GET /api/config/reauth-settings — SUPER_ADMIN only
  app.get('/reauth-settings', {
    schema: { tags: ['Config'], summary: 'Get reauth settings', description: 'Get re-authentication configuration (SUPER_ADMIN only)' },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async () => {
    const config = await prisma.systemConfig.findUnique({ where: { configKey: 'reauth_settings' } });
    return {
      ...(reauthConfigSchema.parse(config?.configValue ?? {})),
      availableOperations: ALL_REAUTH_OPERATIONS,
    };
  });

  // PUT /api/config/reauth-settings — SUPER_ADMIN only
  app.put('/reauth-settings', {
    schema: { tags: ['Config'], summary: 'Update reauth settings', description: 'Update re-authentication configuration (SUPER_ADMIN only)', body: reauthConfigSchema },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async (req, reply) => {
    const existing = await prisma.systemConfig.findUnique({ where: { configKey: 'reauth_settings' } });
    const beforeValue = existing?.configValue;

    await prisma.systemConfig.upsert({
      where: { configKey: 'reauth_settings' },
      create: {
        configKey: 'reauth_settings',
        configValue: req.body as any,
        configType: 'security',
        requiresReauth: false,
        updatedBy: req.user.username,
      },
      update: {
        configValue: req.body as any,
        updatedAt: new Date(),
        updatedBy: req.user.username,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'REAUTH_SETTINGS_CHANGED',
      targetType: 'config', targetId: 'reauth_settings',
      beforeValue: beforeValue as any, afterValue: req.body as any,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true, data: req.body };
  });

  // GET /api/config/field-ids — all users
  app.get('/field-ids', {
    schema: { tags: ['Config'], summary: 'Get field IDs', description: 'Get all field ID configurations' },
  }, async () => {
    const fields = await prisma.fieldIdConfig.findMany({ orderBy: { fieldId: 'asc' } });
    return fields;
  });

  // PUT /api/config/field-ids/:fieldId — SUPER_ADMIN only
  app.put('/field-ids/:fieldId', {
    schema: { tags: ['Config'], summary: 'Update field ID', description: 'Update a field ID display name (SUPER_ADMIN only)', params: fieldIdParamsSchema, body: fieldIdBodySchema },
    preHandler: [app.requirePermission('FIELD_ID_UPDATE')],
  }, async (req, reply) => {
    const { fieldId } = req.params;
    const { displayName } = req.body;

    const field = await prisma.fieldIdConfig.findUnique({ where: { fieldId } });
    if (!field) return reply.code(404).send({ error: 'Field ID not found' });

    await prisma.fieldIdConfig.update({
      where: { fieldId },
      data: { displayName: displayName.trim(), updatedBy: req.user.username, updatedAt: new Date() },
    });

    // NOT recorded in audit trail (Super Admin action)
    return { success: true };
  });
}
