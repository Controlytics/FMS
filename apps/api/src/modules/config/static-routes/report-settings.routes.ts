import { type FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { auditLog } from '../../../lib/audit.js';
import { buildContext } from '../../../lib/build-context.js';
import { prisma } from '../../../lib/prisma.js';

/**
 * Report Settings — write endpoint.
 *
 * The frontend (`apps/web/src/routes/config/report-settings.tsx:61`) calls
 * `PUT /api/config/dynamic/report-settings`. The matching dynamic-routes.ts
 * factory at L62-148 is skipped for this def because
 * `report-settings.def.ts` declares `hasCustomPage: true` (dynamic-routes.ts
 * L33: "Skip — existing routes handle this"). No matching static route
 * existed, so the PUT silently 404'd and saves were lost.
 *
 * The GET surface (`/report-settings/current`) remains owned by
 * `config/routes.ts` L145-155 — public to all authenticated users so the
 * report header/footer can render in any view. Don't double-register it
 * here.
 *
 * The PUT shape mirrors what the dynamic factory would have produced for a
 * config def with `requiresReauth: false`, no `reauthAction`, no masked
 * settings, and `permissions: { write: 'CONFIG_UPDATE' }`. We do NOT
 * introduce a zod schema for the body — none exists in `@digilog/shared`
 * for report-settings, the def has no validation hooks, and adding a
 * shared schema would broaden the change surface beyond the bug fix.
 * `additionalProperties: true` matches sibling static routes
 * (tablet-access, dashboard-cards) that also store an open object on
 * SystemConfig.
 */
export async function reportSettingsRoutes(app: FastifyInstance) {
  app.put('/dynamic/report-settings', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update report settings configuration',
      description: 'Update report header/footer/layout settings. Requires CONFIG_UPDATE permission.',
      body: { type: 'object', additionalProperties: true, description: 'Report settings configuration values' },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (req) => {
    const body = req.body as Record<string, unknown>;
    const ctx = buildContext(req);

    const existing = await prisma.systemConfig.findUnique({ where: { configKey: 'report-settings' } });
    const beforeValue = (existing?.configValue ?? {}) as Record<string, unknown>;

    // Cast to Prisma's Json input type — body is an open object per the
    // route schema; SystemConfig.configValue stores it as JSONB. Sibling
    // dynamic-routes.ts uses a `Record<string, any>` shape that Prisma
    // accepts directly; we keep the stricter `unknown` typing on body and
    // cast at the persistence boundary.
    const configValue = body as Prisma.InputJsonValue;

    await prisma.systemConfig.upsert({
      where: { configKey: 'report-settings' },
      create: {
        configKey: 'report-settings',
        configValue,
        configType: 'display',
        requiresReauth: false,
        updatedBy: ctx.userId,
      },
      update: {
        configValue,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'CONFIG_CHANGED',
      targetType: 'config', targetId: 'report-settings',
      beforeValue, afterValue: body,
      signatureMeaning: 'Report Settings configuration updated',
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return { success: true, message: 'Report Settings updated' };
  });
}
