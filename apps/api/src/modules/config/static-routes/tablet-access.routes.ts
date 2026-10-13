import { type FastifyInstance } from 'fastify';
import { enforceReauthAlways } from '../../../lib/reauth-check.js';
import { buildContext } from '../../../lib/build-context.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';
import { resolveTabletAccess } from '../../../lib/tablet-access.js';

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
  }, async (req, reply) => {
    // 2026-09-03: gated. This write was CONFIG_UPDATE-only and took no
    // signature at all. enforceReauthAlways, not enforceReauth: the action is
    // newly registered, so it is absent from system_config['action-reauth'] and
    // the config-driven check would gate nobody — the "toggle that does
    // nothing" shape. This decides which roles may log in on the tablet at all.
    const { ok } = await enforceReauthAlways('UPDATE_TABLET_ACCESS', req, reply);
    if (!ok) return;

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
  //
  // 2026-05-21 v2 — deny-by-default for unconfigured roles once the admin has
  // configured at least one role. Behaviour matrix:
  //   - SUPER_ADMIN: always allowed everything (hardcoded — admin recovery
  //     route; lets the global owner reach the tablet config UI on the tablet
  //     even if they accidentally locked the role out).
  //   - Tablet-access config doesn't exist OR is empty `{}`:
  //       → fall back to legacy default-allow (`configured: false`) so a fresh
  //         install / never-configured install behaves the same as before.
  //   - Config has at least one role configured AND this role has its own
  //     entry: respect that entry exactly (`configured: true`).
  //   - Config has at least one role configured AND this role has NO entry:
  //     deny everything (`configured: true`, `allowed: []`). This is the bit
  //     operators expect: admin opted into the allowlist UI and only checked
  //     SUPERVISOR — everyone else is locked out, not silently default-allowed.
  app.get('/tablet-access/my-features', {
    schema: { tags: ['Config'], summary: 'Get allowed tablet features for the current user' },
  }, async (req) => {
    const role = req.user?.role;
    if (!role) return { allowed: [], configured: false };

    // 2026-10-13: the rule lives in lib/tablet-access.ts so the login refusal
    // (auth.service `client: 'tablet'`) reads exactly the same answer.
    // SUPER_ADMIN is hardcoded there to everything — it cannot be locked out.
    return { role, ...(await resolveTabletAccess(role)) };
  });
}
