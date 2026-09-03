import { type FastifyInstance } from 'fastify';
import { enforceReauthAlways } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';

// Per-report signature LABEL config. Stored shape under configKey
// `report-signatories`:  { [reportKey]: { label: 'Printed By' | 'Reviewed By' | 'Approved By' } }
// The PDF footer always prints the User ID of whoever generated the report; this
// config only changes the LABEL in front of it, per report.
export async function reportSignatoriesRoutes(app: FastifyInstance) {
  // Read the raw config matrix (for the config page).
  app.get('/report-signatories', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: { tags: ['Config'], summary: 'Get the per-report signatory role matrix' },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'report-signatories' } });
    return (row?.configValue as any) ?? {};
  });

  // Save the matrix.
  app.put('/report-signatories', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['Config'],
      summary: 'Update the per-report signatory role matrix',
      body: { type: 'object', additionalProperties: true },
    },
  }, async (req, reply) => {
    // 2026-09-03: gated. This write was CONFIG_UPDATE-only and took no
    // signature at all. enforceReauthAlways, not enforceReauth: the action is
    // newly registered, so it is absent from system_config['action-reauth'] and
    // the config-driven check would gate nobody — the "toggle that does
    // nothing" shape. This decides who is named as signing each report.
    const { ok } = await enforceReauthAlways('UPDATE_REPORT_SIGNATORIES', req, reply);
    if (!ok) return;

    const body = req.body as Record<string, any>;
    const ctx = buildContext(req);
    const existing = await prisma.systemConfig.findUnique({ where: { configKey: 'report-signatories' } });
    await prisma.systemConfig.upsert({
      where: { configKey: 'report-signatories' },
      update: { configValue: body },
      create: { configKey: 'report-signatories', configValue: body as any, configType: 'display' },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CONFIG_CHANGED',
      targetType: 'system_config', targetId: 'report-signatories',
      beforeValue: existing?.configValue, afterValue: body,
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });
    return { success: true };
  });

  // Per-report label map for the PDF footer. Any authenticated user can read it
  // (report viewers don't have CONFIG_READ). Returns the raw config as-is.
  app.get('/report-signatories/resolved', {
    schema: { tags: ['Config'], summary: 'Per-report signature labels' },
  }, async () => {
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'report-signatories' } });
    return (row?.configValue ?? {}) as Record<string, { label?: string }>;
  });
}
