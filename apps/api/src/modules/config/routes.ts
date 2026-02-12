import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { passwordPolicySchema, loginSecuritySchema, sessionConfigSchema, datetimeConfigSchema } from '@digilog/shared';

export default async function configRoutes(app: FastifyInstance) {
  const configEndpoint = (key: string, schema: any, requiresReauth: boolean) => {
    // GET
    app.get(`/${key}`, {
      preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    }, async () => {
      const config = await prisma.systemConfig.findUnique({ where: { configKey: key } });
      return config?.configValue ?? {};
    });

    // PUT
    app.put(`/${key}`, {
      preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
    }, async (req, reply) => {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
      }

      const existing = await prisma.systemConfig.findUnique({ where: { configKey: key } });
      const beforeValue = existing?.configValue;

      await prisma.systemConfig.upsert({
        where: { configKey: key },
        create: {
          configKey: key,
          configValue: parsed.data,
          configType: 'security',
          requiresReauth: requiresReauth,
          updatedBy: req.user.username,
        },
        update: {
          configValue: parsed.data,
          updatedAt: new Date(),
          updatedBy: req.user.username,
        },
      });

      await app.auditLog({
        userId: req.user.username, userRole: req.user.role, action: 'CONFIG_CHANGED',
        targetType: 'config', targetId: key,
        beforeValue: beforeValue as any, afterValue: parsed.data,
        ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
      });

      return { success: true, data: parsed.data };
    });
  };

  configEndpoint('password-policy', passwordPolicySchema, true);
  configEndpoint('login-security', loginSecuritySchema, true);
  configEndpoint('session', sessionConfigSchema, true);
  configEndpoint('datetime', datetimeConfigSchema, false);

  // GET /api/config/field-ids — all users
  app.get('/field-ids', async () => {
    const fields = await prisma.fieldIdConfig.findMany({ orderBy: { fieldId: 'asc' } });
    return fields;
  });

  // PUT /api/config/field-ids/:fieldId — SUPER_ADMIN only
  app.put('/field-ids/:fieldId', {
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async (req, reply) => {
    const { fieldId } = req.params as { fieldId: string };
    const { displayName } = req.body as { displayName: string };

    if (!displayName || displayName.trim().length === 0) {
      return reply.code(400).send({ error: 'displayName is required' });
    }

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
