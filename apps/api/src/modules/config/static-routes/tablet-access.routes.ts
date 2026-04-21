import { type FastifyInstance } from 'fastify';
import { buildContext } from '../../../lib/build-context.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';

export async function tabletAccessRoutes(app: FastifyInstance) {
  app.get('/tablet-access', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: { tags: ['Config'], summary: 'Get tablet app access configuration' },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
    return (row?.configValue as any) ?? {};
  });

  app.put('/tablet-access', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update tablet app access configuration',
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req) => {
    const body = req.body as any;
    const ctx = buildContext(req);
    await prisma.systemConfig.upsert({
      where: { configKey: 'tablet-access' },
      update: { configValue: body },
      create: { configKey: 'tablet-access', configValue: body, configType: 'security' },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'system_config', targetId: 'tablet-access',
      afterValue: body,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return { success: true };
  });

  // Authenticated-but-no-specific-permission: mobile app checks its allowed features
  app.get('/tablet-access/my-features', {
    schema: { tags: ['Config'], summary: 'Get allowed tablet features for the current user' },
  }, async (req) => {
    const role = req.user?.role;
    if (!role) return { allowed: [] };
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'tablet-access' } });
    const config = (row?.configValue as any) ?? {};
    return { role, allowed: config[role] ?? [] };
  });
}
